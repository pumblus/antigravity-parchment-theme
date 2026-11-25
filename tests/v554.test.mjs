import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const daemonSrc = fs.readFileSync(path.join(root, 'core/daemon.mjs'), 'utf8');
const runtimeSrc = fs.readFileSync(path.join(root, 'core/runtime.js'), 'utf8');
const cssSrc = fs.readFileSync(path.join(root, 'core/theme.css'), 'utf8');
const dict = JSON.parse(fs.readFileSync(path.join(root, 'core/i18n.json'), 'utf8'));

function encodeVarint(n) {
  let v = BigInt(n);
  const out = [];
  do {
    let b = Number(v & 0x7fn);
    v >>= 7n;
    if (v > 0n) b |= 0x80;
    out.push(b);
  } while (v > 0n);
  return Buffer.from(out);
}
function pbVarint(field, val) {
  return Buffer.concat([encodeVarint((field << 3) | 0), encodeVarint(val)]);
}
function pbBytes(field, bufOrStr) {
  const b = Buffer.isBuffer(bufOrStr) ? bufOrStr : Buffer.from(String(bufOrStr), 'utf8');
  return Buffer.concat([encodeVarint((field << 3) | 2), encodeVarint(b.length), b]);
}
function sliceBetween(src, a, b) {
  const i = src.indexOf(a);
  assert.ok(i >= 0, `missing start marker: ${a}`);
  const j = src.indexOf(b, i);
  assert.ok(j > i, `missing end marker: ${b}`);
  return src.slice(i, j);
}

function makeStepMeta(ts, toolName = '', toolArgsJson = '') {
  const parts = [pbBytes(1, pbVarint(1, ts))];
  if (toolName) {
    const tcParts = [pbBytes(2, toolName)];
    if (toolArgsJson) tcParts.push(pbBytes(3, toolArgsJson));
    parts.push(pbBytes(4, Buffer.concat(tcParts)));
  }
  return Buffer.concat(parts);
}

function makeUserPlanStepPayload({ plannerEnum = 0, execEnum = 0, planFlag = false } = {}) {
  const u19Parts = [];
  if (plannerEnum || execEnum) {
    const mcParts = [];
    if (plannerEnum) mcParts.push(pbVarint(1, plannerEnum));
    if (execEnum) mcParts.push(pbBytes(60, pbVarint(1, execEnum)));
    u19Parts.push(pbBytes(12, pbBytes(1, Buffer.concat(mcParts))));
  }
  if (planFlag) {
    u19Parts.push(pbBytes(18, pbBytes(3, pbBytes(1, pbVarint(6, 1)))));
  }
  return pbBytes(19, Buffer.concat(u19Parts));
}

function makeGenBlob({
  slug = '',
  label = '',
  enumId = 0,
  inTok = 100,
  outTok = 20,
  cacheRead = 0,
  thinkTok = 0,
  respTok = 0,
  stepIndices = [],
  kv = {}
}) {
  const usageParts = [];
  if (enumId) usageParts.push(pbVarint(1, enumId));
  usageParts.push(
    pbVarint(2, inTok),
    pbVarint(3, outTok),
    pbVarint(5, cacheRead),
    pbVarint(9, thinkTok),
    pbVarint(10, respTok)
  );
  const chatParts = [pbBytes(4, Buffer.concat(usageParts))];
  if (slug) chatParts.push(pbBytes(19, slug));
  if (label) chatParts.push(pbBytes(21, label));
  for (const [k, v] of Object.entries(kv)) {
    chatParts.push(pbBytes(20, Buffer.concat([pbBytes(1, k), pbBytes(2, String(v))])));
  }
  const topParts = [pbBytes(1, Buffer.concat(chatParts))];
  if (stepIndices.length > 0) {
    topParts.push(pbBytes(2, Buffer.concat(stepIndices.map((s) => encodeVarint(s)))));
  }
  return Buffer.concat(topParts);
}

function buildTaVm(DatabaseSync, cacheDir, { safeMode = false, runOnce = false } = {}) {
  const taCode =
    sliceBetween(daemonSrc, 'function parseProtoAll(', 'function fmtTok(') +
    '\n' +
    sliceBetween(daemonSrc, 'const textDecoder =', 'const MAX_CHILD_METRICS_CACHE_SIZE =') +
    '\n' +
    sliceBetween(daemonSrc, 'function getDbStatByPath(', 'function resolveConversationDbPath(') +
    '\n' +
    sliceBetween(daemonSrc, 'const TA_MEM_FILE_RE =', '// ============================================================================\n// 5. CDP 目标发现');

  const ctx = vm.createContext({
    fs,
    path,
    os,
    crypto,
    process,
    Buffer,
    performance,
    TextDecoder,
    DatabaseSync,
    setImmediate,
    setTimeout,
    clearTimeout,
    BASE_VERSION: '20261123-v5.5.5-eric.1',
    CACHE_DIR: cacheDir,
    SAFE_MODE: safeMode,
    RUN_ONCE: runOnce,
    daemonExiting: false,
    tokenAnalyticsDbCache: new Map(),
    tokenAnalyticsSummariesCache: new Map(),
    tokenAnalyticsCacheState: {
      diskLoaded: false,
      persistTimer: null,
      flushInFlight: false,
      flushPending: false,
      lastJsonDataRef: null,
      lastJsonStr: ''
    },
    lastTokenAnalyticsAccessMs: 0,
    inFlightTokenAnalyticsPromise: null,
    inFlightTokenAnalyticsKey: ''
  });
  vm.runInContext(
    `${taCode}\nglobalThis.api={queryTokenAnalytics,runTokenAnalyticsQuery,flushTokenAnalyticsDiskCacheAsync,taClassifyModelPool,TA_CACHE_FILE,TA_CACHE_SALT,tokenAnalyticsDbCache,tokenAnalyticsCacheState};`,
    ctx
  );
  return ctx.api;
}

test('v554 static checks: composer eliminates :not(:has), Token Analytics CSS keeps flat Anthropic spec, daemon stays macOS-only', () => {
  const composerBlock = sliceBetween(cssSrc, '/* 输入框单层 1px 扁平细边几何', '/* 显式关闭外框三态模块时固定 1px 石色细边 */').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!composerBlock.includes(':has('), 'composer border cascade must not use :has(...)');
  assert.ok(!/#74221a\b/i.test(composerBlock), 'composer border must stay Anthropic flat neutral border');

  const taCss = sliceBetween(cssSrc, '/* __AG_TOKEN_ANALYTICS_CSS_START__ */', '/* __AG_TOKEN_ANALYTICS_CSS_END__ */');
  assert.ok(taCss.includes('td.ag-ta-sess-td'));
  assert.ok(taCss.includes('.ag-ta-model-cell'));
  assert.ok(taCss.includes('scrollbar-width: auto'));
  assert.ok(taCss.includes('transition: none;'));
  assert.ok(!/#FFFFFF\b/i.test(taCss));
  assert.ok(!/box-shadow\s*:\s*(?!\s*none\b)/i.test(taCss));

  assert.ok(daemonSrc.includes('const taParseProtoAll = parseProtoAll;'));
  assert.ok(daemonSrc.includes('WHEN step_type = 14 THEN step_payload'));
  assert.ok(daemonSrc.includes('JSON.parse(${safeJsonLiteral})'));
  for (const forbidden of ['wsl.exe', 'wslSqliteStagingCache', 'inspectWin32WslProbeDemand', 'headHex']) {
    assert.ok(!daemonSrc.includes(forbidden), `daemon must not include ${forbidden}`);
  }
});

test('v554 daemon Token Analytics: memory JSON guard, Orchestrator plan timeline, empty DB short-circuit, incremental delta & Undo fallback', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-ta-v554-'));
  const convDir = path.join(tmpRoot, 'conversations');
  const cacheDir = path.join(tmpRoot, '.cache');
  fs.mkdirSync(convDir, { recursive: true });

  const nowSec = Math.floor(Date.now() / 1000);
  const convId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const emptyId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const dbPath = path.join(convDir, `${convId}.db`);
  const emptyDbPath = path.join(convDir, `${emptyId}.db`);

  const initDb = (p) => {
    const db = new DatabaseSync(p);
    db.exec(`
      CREATE TABLE trajectory_metadata_blob (data BLOB);
      CREATE TABLE steps (idx INTEGER, step_type INTEGER, metadata BLOB, step_payload BLOB);
      CREATE TABLE gen_metadata (idx INTEGER, data BLOB);
    `);
    return db;
  };

  try {
    // 1) Empty DB with 0 gen_metadata rows should short-circuit cleanly
    const edb = initDb(emptyDbPath);
    edb.prepare('INSERT INTO steps VALUES (?, ?, ?, ?)').run(0, 132, makeStepMeta(nowSec - 100), Buffer.alloc(1024));
    edb.close();

    // 2) Rich DB exercising:
    //    - step 1: user step enabling plan mode (same planner/exec enum => driven by inPlanPhase)
    //    - step 2: tool step in plan phase => planning + Orchestrator (Neon)
    //    - step 3: step_type=101 "Plan mode is off:" => leaves plan phase
    //    - step 4: step_type=132 with large step_payload mentioning MEMORY.md in prose (must NOT trigger memory!)
    //    - step 5: step_type=132 with tool args Path="/Users/eric/MEMORY.md" (MUST trigger memory!)
    //    - step 6: step_type=132 with exit_plan_mode tool => planning
    //    - gen with gemini-4-argon + used_claude=true => pool must stay Argon, not Claude & GPT
    const db = initDb(dbPath);
    const insStep = db.prepare('INSERT INTO steps VALUES (?, ?, ?, ?)');
    insStep.run(1, 14, makeStepMeta(nowSec - 600), makeUserPlanStepPayload({ plannerEnum: 77, execEnum: 77, planFlag: true }));
    insStep.run(2, 132, makeStepMeta(nowSec - 500, 'read_file', JSON.stringify({ Path: '/Users/eric/app.ts' })), Buffer.from('MEMORY.md mention in payload'));
    insStep.run(3, 101, makeStepMeta(nowSec - 450), Buffer.from('Plan mode is off: now executing'));
    insStep.run(4, 132, makeStepMeta(nowSec - 400, 'write_file', JSON.stringify({ Path: '/Users/eric/notes.md', Content: 'see MEMORY.md' })), Buffer.from('MEMORY.md /memories/ fake payload'));
    insStep.run(5, 132, makeStepMeta(nowSec - 300, 'write_file', JSON.stringify({ TargetFile: '/Users/eric/proj/MEMORY.md' })), Buffer.alloc(0));
    insStep.run(6, 132, makeStepMeta(nowSec - 200, 'exit_plan_mode', '{}'), Buffer.alloc(0));

    const insGen = db.prepare('INSERT INTO gen_metadata VALUES (?, ?)');
    insGen.run(0, makeGenBlob({ slug: 'gemini-4-neon', label: 'Gemini 4 Neon (High)', enumId: 77, inTok: 1000, outTok: 100, stepIndices: [2] }));
    insGen.run(1, makeGenBlob({ slug: 'gemini-4-argon', label: '', enumId: 88, inTok: 1200, outTok: 120, stepIndices: [4], kv: { used_claude: 'true' } }));
    insGen.run(2, makeGenBlob({ slug: 'gpt-oss-120b-medium', label: '', inTok: 800, outTok: 80, stepIndices: [5] }));
    insGen.run(3, makeGenBlob({ slug: 'gemini-4-carbon', label: 'Gemini 4 Carbon', inTok: 600, outTok: 60, stepIndices: [6] }));
    db.close();

    const api = buildTaVm(DatabaseSync, cacheDir);
    const r1 = await api.runTokenAnalyticsQuery({ channel: 'stable', conversationsDir: convDir }, { maxDays: 30, nowSec });
    assert.equal(r1.stats.dbCount, 2);
    assert.equal(r1.stats.totalCalls, 4);
    assert.ok(r1.facts.some((f) => f.model === 'Orchestrator (Neon · High)' && f.scenario === 'planning' && f.pool === 'Gemini'));
    assert.ok(r1.facts.some((f) => f.model === 'Gemini 4 Argon' && f.scenario === 'tools' && f.pool === 'Argon'));
    assert.ok(r1.facts.some((f) => f.model === 'GPT-OSS 120B (Medium)' && f.scenario === 'memory' && f.pool === 'Claude'));
    assert.ok(r1.facts.some((f) => f.model === 'Orchestrator (Carbon)' && f.scenario === 'planning'));

    // 3) Verify _inc state kept for recent (<24h) DB and incremental delta append works
    const cached1 = api.tokenAnalyticsDbCache.get(dbPath);
    assert.ok(cached1?._inc && cached1._inc.genCount === 4 && cached1._inc.anchorIdx === 1);

    const db2 = new DatabaseSync(dbPath);
    db2.prepare('INSERT INTO steps VALUES (?, ?, ?, ?)').run(7, 15, makeStepMeta(nowSec - 60), Buffer.alloc(0));
    db2.prepare('INSERT INTO gen_metadata VALUES (?, ?)').run(
      4,
      makeGenBlob({ slug: 'claude-sonnet-5-5-medium', label: '', inTok: 500, outTok: 50, stepIndices: [7] })
    );
    db2.close();

    const r2 = await api.runTokenAnalyticsQuery({ channel: 'stable', conversationsDir: convDir }, { maxDays: 30, nowSec });
    assert.equal(r2.stats.totalCalls, 5);
    assert.ok(r2.facts.some((f) => f.model === 'Claude Sonnet 5.5 (Medium)' && f.scenario === 'chat' && f.pool === 'Claude'));

    // 4) Simulate Undo rewriting frozen anchor row (idx=2) while keeping row count >= prev => anchor fails -> full rescan picks up change
    const db3 = new DatabaseSync(dbPath);
    db3.prepare('UPDATE gen_metadata SET data = ? WHERE idx = 2').run(
      makeGenBlob({ slug: 'claude-opus-4-6-thinking', label: '', inTok: 9999, outTok: 111, stepIndices: [4] })
    );
    db3.close();
    const bumpTime = new Date(Date.now() + 2000);
    fs.utimesSync(dbPath, bumpTime, bumpTime);

    const r3 = await api.runTokenAnalyticsQuery({ channel: 'stable', conversationsDir: convDir }, { maxDays: 30, nowSec });
    assert.equal(r3.stats.totalCalls, 5);
    assert.ok(r3.facts.some((f) => f.model === 'Claude Opus 4.6 (Thinking)' && f.inTok === 9999));

    // 5) Disk cache flush + cold reload + salt mismatch auto-invalidation + force='hard' + SAFE_MODE skip
    if (api.tokenAnalyticsCacheState.persistTimer) {
      clearTimeout(api.tokenAnalyticsCacheState.persistTimer);
      api.tokenAnalyticsCacheState.persistTimer = null;
    }
    await api.flushTokenAnalyticsDiskCacheAsync();
    assert.ok(fs.existsSync(api.TA_CACHE_FILE), 'disk index file created');

    const apiCold = buildTaVm(DatabaseSync, cacheDir);
    const rCold = await apiCold.runTokenAnalyticsQuery({ channel: 'stable', conversationsDir: convDir }, { maxDays: 30, nowSec });
    assert.equal(rCold.stats.cacheHits, 2);
    assert.equal(rCold.stats.cacheMisses, 0);
    assert.equal(rCold.stats.totalCalls, 5);

    const rHard = await apiCold.runTokenAnalyticsQuery({ channel: 'stable', conversationsDir: convDir }, { maxDays: 30, nowSec, force: 'hard' });
    assert.equal(rHard.stats.cacheHits, 0);
    assert.equal(rHard.stats.cacheMisses, 2);

    // Corrupt salt -> auto unlink & rescan
    fs.writeFileSync(api.TA_CACHE_FILE, JSON.stringify({ salt: 'stale-salt', entries: {} }), 'utf8');
    const apiStale = buildTaVm(DatabaseSync, cacheDir);
    const rStale = await apiStale.runTokenAnalyticsQuery({ channel: 'stable', conversationsDir: convDir }, { maxDays: 30, nowSec });
    assert.equal(rStale.stats.cacheHits, 0);
    assert.equal(rStale.stats.cacheMisses, 2);

    // SAFE_MODE ignores disk cache completely
    fs.writeFileSync(api.TA_CACHE_FILE, JSON.stringify({ salt: api.TA_CACHE_SALT, entries: { [dbPath]: { sig: 'fake', parsed: { ok: true, calls: [] } } } }), 'utf8');
    const apiSafe = buildTaVm(DatabaseSync, cacheDir, { safeMode: true });
    const rSafe = await apiSafe.runTokenAnalyticsQuery({ channel: 'stable', conversationsDir: convDir }, { maxDays: 30, nowSec });
    assert.equal(rSafe.stats.cacheMisses, 2);

    // 6) Sandbox uninstall removes .cache/
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-uninstall-v554-'));
    try {
      const sbCache = path.join(sandbox, '.cache');
      fs.mkdirSync(sbCache, { recursive: true });
      fs.writeFileSync(path.join(sbCache, 'token-analytics-index.json'), '{}', 'utf8');
      execFileSync(process.execPath, [path.join(root, 'install.mjs'), 'uninstall', '--target-dir', sandbox], { stdio: 'pipe' });
      assert.equal(fs.existsSync(sbCache), false, 'sandbox uninstall removes .cache/');
    } finally {
      fs.rmSync(sandbox, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('v554 runtime Token Analytics: Today range, Shift+hard refresh, debounced search, on-demand tooltip listeners & table truncation', async () => {
  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || (fs.existsSync(chromePath) ? chromePath : undefined)
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1120, height: 820 } });
    await page.setContent(`<!doctype html><html><body data-agy-theme="light">
      <div id="antigravity.agentSidePanelInputBox"></div>
      <div class="settings-modal-backdrop">
        <div class="settings-modal-container" style="width:940px;height:680px;display:flex;">
          <div data-testid="settings-sidebar" style="width:200px;">
            <div class="nav-list">
              <div class="group/nav-item"><button data-testid="settings-nav-item-General">General</button></div>
            </div>
          </div>
          <div style="flex:1;position:relative;min-width:0;">
            <div class="overflow-auto" id="native-scroll">Native Settings Content</div>
          </div>
        </div>
      </div>
    </body></html>`);

    const boot = {
      version: '20261123-v5.5.5-eric.1',
      platform: 'darwin',
      enabled: true,
      preset: 'high-contrast',
      cssText: cssSrc,
      customCss: '',
      themeVars: {},
      i18nDict: dict,
      modules: { i18n: false, metrics: false, tokenAnalytics: true, customCss: false, customJs: false },
      selectors: {},
      config: { enabled: true, preset: 'high-contrast', modules: { i18n: false, metrics: false, tokenAnalytics: true } },
      customJs: ''
    };
    const injected = runtimeSrc.replace('})(__AG_BOOT_PAYLOAD__);', () => `})(${JSON.stringify(boot)});`);

    await page.evaluate(() => {
      window.__taListenerCounts = { wheel: 0, keydown: 0 };
      const origWinAdd = window.addEventListener.bind(window);
      const origWinRem = window.removeEventListener.bind(window);
      window.addEventListener = function (type, fn, opts) {
        if (type === 'wheel') window.__taListenerCounts.wheel += 1;
        return origWinAdd(type, fn, opts);
      };
      window.removeEventListener = function (type, fn, opts) {
        if (type === 'wheel') window.__taListenerCounts.wheel -= 1;
        return origWinRem(type, fn, opts);
      };
      const origDocAdd = document.addEventListener.bind(document);
      const origDocRem = document.removeEventListener.bind(document);
      document.addEventListener = function (type, fn, opts) {
        if (type === 'keydown') window.__taListenerCounts.keydown += 1;
        return origDocAdd(type, fn, opts);
      };
      document.removeEventListener = function (type, fn, opts) {
        if (type === 'keydown') window.__taListenerCounts.keydown -= 1;
        return origDocRem(type, fn, opts);
      };

      const pad2 = (n) => String(n).padStart(2, '0');
      const fmtDay = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
      const now = new Date();
      const todayStr = fmtDay(now);
      const oldDate = new Date(now.getTime() - 10 * 86400000);
      const oldStr = fmtDay(oldDate);
      window.__taDates = { todayStr, oldStr };
      window.__taRequests = [];
      window.__agRequestTokenAnalytics = (raw) => {
        const req = JSON.parse(raw);
        window.__taRequests.push(req);
        const nowSec = Math.floor(Date.now() / 1000);
        setTimeout(() => {
          window.__ag_on_token_analytics(req.reqId, {
            ok: true,
            data: {
              version: 1,
              nowSec,
              elapsedMs: 3.1,
              stats: { dbCount: 2, scannedDbs: 2, failedDbs: 0, totalCalls: 3, conversationCount: 2, projectCount: 1, cacheHits: 2, cacheMisses: 0 },
              projects: [{ key: '/users/eric/alpha', name: 'Alpha', path: '/Users/eric/Alpha', isTemp: false }],
              conversations: {
                'today-sess': {
                  id: 'today-sess',
                  title: 'Very Long Session Title '.repeat(8),
                  projectKey: '/users/eric/alpha',
                  projectName: 'Alpha',
                  source: 'desktop',
                  isSubagent: false,
                  agentName: '',
                  parentId: '',
                  rootId: 'today-sess',
                  lastTs: nowSec,
                  models: ['Orchestrator (Gemini 4 Neon · Extra High)']
                },
                'old-sess': {
                  id: 'old-sess',
                  title: 'Older Ten Day Session',
                  projectKey: '/users/eric/alpha',
                  projectName: 'Alpha',
                  source: 'desktop',
                  isSubagent: false,
                  agentName: '',
                  parentId: '',
                  rootId: 'old-sess',
                  lastTs: nowSec - 10 * 86400,
                  models: ['Claude Opus 5.5 (High)']
                }
              },
              facts: [
                { date: todayStr, cid: 'today-sess', model: 'Orchestrator (Gemini 4 Neon · Extra High)', pool: 'Gemini', scenario: 'planning', subagentType: '', calls: 2, inTok: 1000, cacheRead: 9000, outTok: 200, thinkTok: 80, respTok: 120, total: 10200, weighted: 3100, billable: 1200 },
                { date: oldStr, cid: 'old-sess', model: 'Claude Opus 5.5 (High)', pool: 'Claude & GPT', scenario: 'tools', subagentType: '', calls: 1, inTok: 500, cacheRead: 1500, outTok: 100, thinkTok: 40, respTok: 60, total: 2100, weighted: 1250, billable: 600 }
              ],
              dailySummary: []
            }
          });
        }, 10);
      };
    });

    await page.evaluate(injected);
    await page.waitForTimeout(50);

    // Zero global listeners before hovering heatmap
    assert.deepEqual(await page.evaluate(() => window.__taListenerCounts), { wheel: 0, keydown: 0 });

    await page.click('#ag-token-nav-btn');
    await page.waitForTimeout(80);

    // Table truncation classes exist and both sessions visible under 30d
    const initCheck = await page.evaluate(() => ({
      hasTodayBtn: Boolean(document.querySelector('#ag-ta-range-sw [data-range="1"]')),
      sessTdCount: document.querySelectorAll('td.ag-ta-sess-td').length,
      modelCellCount: document.querySelectorAll('.ag-ta-model-cell').length,
      tbodyText: document.getElementById('ag-ta-sessions-tbody').textContent,
      listeners: window.__taListenerCounts
    }));
    assert.equal(initCheck.hasTodayBtn, true);
    assert.equal(initCheck.sessTdCount, 2);
    assert.equal(initCheck.modelCellCount, 2);
    assert.ok(initCheck.tbodyText.includes('Older Ten Day Session'));
    assert.deepEqual(initCheck.listeners, { wheel: 0, keydown: 0 });

    // Select old date cell, then switch to "今日" (data-range="1") -> clears out-of-range selectedDate & hides old session
    const oldStr = await page.evaluate(() => window.__taDates.oldStr);
    await page.click(`.ag-ta-hm-cell[data-hm-date="${oldStr}"]`);
    assert.ok((await page.textContent('#ag-ta-filter-pills')).includes(oldStr));
    await page.click('#ag-ta-range-sw [data-range="1"]');
    const todayState = await page.evaluate(() => ({
      filtersActive: document.getElementById('ag-ta-filters-bar').getAttribute('data-active'),
      tbodyText: document.getElementById('ag-ta-sessions-tbody').textContent
    }));
    assert.equal(todayState.filtersActive, '0', 'out-of-range selectedDate cleared on range switch');
    assert.ok(todayState.tbodyText.includes('Very Long Session Title'));
    assert.ok(!todayState.tbodyText.includes('Older Ten Day Session'));

    // Hover heatmap cell -> shows tooltip and mounts global listeners; Escape hides and unmounts global listeners
    const todayStr = await page.evaluate(() => window.__taDates.todayStr);
    await page.dispatchEvent(`.ag-ta-hm-cell[data-hm-date="${todayStr}"]`, 'pointerover', { bubbles: true });
    const afterHover = await page.evaluate(() => ({
      visible: document.getElementById('ag-ta-tooltip')?.getAttribute('data-visible'),
      listeners: window.__taListenerCounts
    }));
    assert.equal(afterHover.visible, '1');
    assert.deepEqual(afterHover.listeners, { wheel: 1, keydown: 1 });

    await page.keyboard.press('Escape');
    const afterEsc = await page.evaluate(() => ({
      visible: document.getElementById('ag-ta-tooltip')?.getAttribute('data-visible'),
      listeners: window.__taListenerCounts
    }));
    assert.equal(afterEsc.visible, '0');
    assert.deepEqual(afterEsc.listeners, { wheel: 0, keydown: 0 });

    // Shift+click refresh sends force: 'hard'
    await page.click('#ag-ta-refresh-btn', { modifiers: ['Shift'] });
    await page.waitForTimeout(60);
    const reqs = await page.evaluate(() => window.__taRequests);
    assert.equal(reqs[reqs.length - 1].force, 'hard');

    // Debounced search filters sessions after 80ms
    await page.click('#ag-ta-range-sw [data-range="30"]');
    await page.fill('#ag-ta-search-input', 'Older Ten');
    await page.waitForTimeout(130);
    const searched = await page.textContent('#ag-ta-sessions-tbody');
    assert.ok(searched.includes('Older Ten Day Session'));
    assert.ok(!searched.includes('Very Long Session Title'));
  } finally {
    await browser.close();
  }
});
