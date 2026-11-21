import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
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

test('v553 CSS adapts 2.34.0 browser holes, file inline-pills, removes trailing wildcards, and aligns Token Analytics to Anthropic spec', () => {
  assert.ok(cssSrc.includes(':not([data-has-three-layer-browser-hole="true"])'));
  assert.ok(cssSrc.includes('[data-main-content-body]:not([data-has-browser-hole="true"])::after'));
  assert.ok(!cssSrc.includes(':not(:has([data-browser-hole="true"]))'));
  assert.ok(cssSrc.includes('[data-uri^="file:"]'));
  assert.ok(cssSrc.includes('.inline-pill:not([data-uri^="file:"]):not([data-uri^="vscode-"])'));

  for (const forbidden of [
    'pre *,',
    '[class*="group/file-title"] *,',
    '.agy-send-button) * {',
    '[class*="opacity-0"] *'
  ]) {
    assert.ok(!cssSrc.includes(forbidden), `unexpected wildcard selector: ${forbidden}`);
  }

  const taStart = cssSrc.indexOf('/* __AG_TOKEN_ANALYTICS_CSS_START__ */');
  const taEnd = cssSrc.indexOf('/* __AG_TOKEN_ANALYTICS_CSS_END__ */');
  assert.ok(taStart > 0 && taEnd > taStart);
  const taCss = cssSrc.slice(taStart, taEnd);
  assert.ok(!/#FFFFFF\b/i.test(taCss), 'Token Analytics CSS must not use pure #FFFFFF');
  assert.ok(!/#0E0E12\b|#2F71E3\b|claude-warm/i.test(taCss), 'Token Analytics CSS must not carry upstream cold dark or claude-warm presets');
  assert.ok(!/box-shadow\s*:\s*(?!\s*none\b)/i.test(taCss), 'Token Analytics CSS must remain flat with zero drop shadows');
});

test('v553 i18n adds 80 entries with unified terminology, ellipsis fallback, effortless model labels, and Quote/Comment context guards', () => {
  assert.equal(Object.keys(dict).length, 1956);
  assert.equal(dict['Where each worker is, by thread'], '按任务组查看各成员当前位置');
  assert.equal(dict['Cannot promote during Battle Mode — end the battle first'], '对战模式进行中无法转为独立对话，请先结束当前对战');
  assert.equal(
    dict['Neon that may offload routine steps to Hydrogen. Same Neon-level quality, fewer tokens used.'],
    'Neon 模型，可将常规步骤分流到 Hydrogen 执行。保持 Neon 同等质量，消耗更少 Token。'
  );
  assert.equal(dict.Comment, undefined);
  assert.equal(dict.Quote, undefined);

  const lookupCode =
    sliceBetween(runtimeSrc, '  const SWARM_FRAME_ONLY_DICT =', '  let scanBodyFn = null;') +
    '\n' +
    sliceBetween(runtimeSrc, '    const RE_HAS_CJK =', '    function translateTextNode(node)');
  const ctx = vm.createContext({
    IS_SWARM_PLUGIN_FRAME: false,
    DICT: dict,
    DICT_APOS: new Map(),
    DICT_CI: new Map(Object.entries(dict).map(([k, v]) => [k.toLowerCase(), v])),
    RE_CURLY_APOS: /[\u2018\u2019]/g,
    EXCLUDE_SELECTOR: 'code',
    TEXT_IMMUTABLE_EXCLUDE_SELECTOR: 'code',
    MARKDOWN_ATTR_EXCLUDE_SELECTOR: 'code',
    FORM_ATTR_EXCLUDE_SELECTOR: 'code',
    immutableTextExclCache: new WeakMap(),
    immutableContainerExclCache: new WeakMap(),
    isFormAttrTarget: () => false
  });
  vm.runInContext(`${lookupCode}\nglobalThis.api={dictLookup,computeTextTranslation};`, ctx);

  // Ellipsis bidirectional fallback: dict has "...", lookup with "…" succeeds
  assert.equal(ctx.api.dictLookup('Tell the agent what to do instead\u2026'), '告诉 Agent 改用什么方式执行…');
  assert.equal(ctx.api.dictLookup('Tell the agent what to do instead...'), '告诉 Agent 改用什么方式执行…');

  // Unparenthesized 2.34.0 model effort suffix inside selector/button context vs plain text
  const menuEl = { closest: (sel) => (sel.includes('[role="menuitem"]') ? {} : null) };
  const plainEl = { closest: () => null };
  assert.equal(ctx.api.computeTextTranslation('Gemini 4 Neon Extra High', menuEl), 'Gemini 4 Neon · 超高');
  assert.equal(ctx.api.computeTextTranslation('Gemini 4 Neon Extra High', plainEl), null);
  assert.equal(ctx.api.computeTextTranslation('Gemini 4 Neon (High)', plainEl), 'Gemini 4 Neon (高)');

  // Quote & Comment context guard
  const btnEl = { closest: (sel) => (sel.includes('button') ? {} : null) };
  assert.equal(ctx.api.computeTextTranslation('Comment', btnEl), '评论');
  assert.equal(ctx.api.computeTextTranslation('Quote', btnEl), '引用');
  assert.equal(ctx.api.computeTextTranslation('Comment', plainEl), null);
  assert.equal(ctx.api.computeTextTranslation('Quote', plainEl), null);
});

test('v553 daemon SQLite Token Analytics aggregates main + subagent trajectories, merges projects, and caches incrementally', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-ta-v553-'));
  const convDir = path.join(tmpRoot, 'conversations');
  fs.mkdirSync(convDir, { recursive: true });

  const nowSec = Math.floor(Date.now() / 1000);
  const rootId = '11111111-1111-1111-1111-111111111111';
  const subId = '22222222-2222-2222-2222-222222222222';
  const tmpConvId = '33333333-3333-3333-3333-333333333333';

  const sumDb = new DatabaseSync(path.join(tmpRoot, 'conversation_summaries.db'));
  sumDb.exec(`CREATE TABLE conversation_summaries (
    conversation_id TEXT PRIMARY KEY, title TEXT, workspace_uris TEXT, project_id TEXT,
    source TEXT, agent_name TEXT, parent_conversation_id TEXT, nesting_depth INTEGER, last_modified_time TEXT
  );`);
  const insSum = sumDb.prepare(
    'INSERT INTO conversation_summaries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const isoNow = new Date(nowSec * 1000).toISOString();
  insSum.run(rootId, 'Refactor Theme Patch', '["file:///Users/eric/Repo/Alpha"]', '', 'CORTEX_TRAJECTORY_SOURCE_DESKTOP', '', '', 0, isoNow);
  insSum.run(subId, 'Subagent Audit', '["file:///Users/eric/repo/alpha"]', '', 'CORTEX_TRAJECTORY_SOURCE_DESKTOP', 'research', rootId, 1, isoNow);
  insSum.run(tmpConvId, 'Scratch Run', '["file:///tmp/sandbox"]', '', 'CORTEX_TRAJECTORY_SOURCE_CLI', '', '', 0, isoNow);
  sumDb.close();

  const makeGenBlob = ({ slug, label, inTok, outTok, cacheRead, thinkTok, respTok, stepIndices }) => {
    const usage = Buffer.concat([
      pbVarint(2, inTok),
      pbVarint(3, outTok),
      pbVarint(5, cacheRead),
      pbVarint(9, thinkTok),
      pbVarint(10, respTok)
    ]);
    const chat = Buffer.concat([
      pbBytes(4, usage),
      pbBytes(19, slug),
      pbBytes(21, label)
    ]);
    const packedSteps = Buffer.concat(stepIndices.map((s) => encodeVarint(s)));
    return Buffer.concat([pbBytes(1, chat), pbBytes(2, packedSteps)]);
  };

  const makeConvDb = (id, rows, stepDefs, metaBuf = null) => {
    const db = new DatabaseSync(path.join(convDir, `${id}.db`));
    db.exec(`
      CREATE TABLE trajectory_metadata_blob (data BLOB);
      CREATE TABLE steps (idx INTEGER, step_type INTEGER, metadata BLOB, step_payload BLOB);
      CREATE TABLE gen_metadata (idx INTEGER, data BLOB);
    `);
    if (metaBuf) db.prepare('INSERT INTO trajectory_metadata_blob VALUES (?)').run(metaBuf);
    const insStep = db.prepare('INSERT INTO steps VALUES (?, ?, ?, ?)');
    for (const s of stepDefs) {
      const tsBuf = pbBytes(1, pbVarint(1, s.ts));
      insStep.run(s.idx, s.type, tsBuf, s.payload || Buffer.alloc(0));
    }
    const insGen = db.prepare('INSERT INTO gen_metadata VALUES (?, ?)');
    rows.forEach((r, idx) => insGen.run(idx, makeGenBlob(r)));
    db.close();
  };

  makeConvDb(
    rootId,
    [
      { slug: 'gemini-4-neon', label: 'Gemini 4 Neon', inTok: 1000, outTok: 200, cacheRead: 9000, thinkTok: 80, respTok: 120, stepIndices: [1] },
      { slug: 'gemini-pro-orchestrator-neon', label: '', inTok: 500, outTok: 100, cacheRead: 4500, thinkTok: 40, respTok: 60, stepIndices: [2] }
    ],
    [
      { idx: 1, type: 132, ts: nowSec - 60 },
      { idx: 2, type: 15, ts: nowSec - 30 }
    ]
  );
  makeConvDb(
    subId,
    [{ slug: 'claude-opus-5-5-high', label: '', inTok: 2000, outTok: 300, cacheRead: 2000, thinkTok: 100, respTok: 200, stepIndices: [1] }],
    [{ idx: 1, type: 132, ts: nowSec - 20 }],
    Buffer.concat([pbBytes(5, rootId), pbBytes(6, rootId)])
  );
  makeConvDb(
    tmpConvId,
    [{ slug: 'gemini-4-hydrogen', label: '', inTok: 400, outTok: 50, cacheRead: 0, thinkTok: 10, respTok: 40, stepIndices: [1] }],
    [{ idx: 1, type: 15, ts: nowSec - 10 }]
  );

  const taCode =
    sliceBetween(daemonSrc, 'const textDecoder =', 'const MAX_CHILD_METRICS_CACHE_SIZE =') +
    '\n' +
    sliceBetween(daemonSrc, 'function getDbStatByPath(', 'function resolveConversationDbPath(') +
    '\n' +
    sliceBetween(daemonSrc, 'const TA_MEMORY_PATH_RE =', '// ============================================================================\n// 5. CDP 目标发现');

  const ctx = vm.createContext({
    fs,
    path,
    os,
    performance,
    TextDecoder,
    DatabaseSync,
    setImmediate,
    tokenAnalyticsDbCache: new Map(),
    tokenAnalyticsSummariesCache: new Map(),
    lastTokenAnalyticsAccessMs: 0,
    inFlightTokenAnalyticsPromise: null,
    inFlightTokenAnalyticsKey: ''
  });
  vm.runInContext(`${taCode}\nglobalThis.api={queryTokenAnalytics,runTokenAnalyticsQuery};`, ctx);

  try {
    const first = await ctx.api.runTokenAnalyticsQuery({ channel: 'stable', conversationsDir: convDir }, { maxDays: 30, nowSec });
    assert.equal(first.stats.dbCount, 3);
    assert.equal(first.stats.scannedDbs, 3);
    assert.equal(first.stats.totalCalls, 4);
    assert.equal(first.stats.cacheMisses, 3);
    assert.equal(first.stats.cacheHits, 0);
    // Case-insensitive macOS project merge + /tmp folding => 2 projects (Alpha & /tmp)
    assert.equal(first.projects.length, 2);
    assert.ok(first.projects.some((p) => p.name === 'Alpha'));
    assert.ok(first.projects.some((p) => p.key === '__tmp__'));
    assert.equal(first.conversations[subId].isSubagent, true);
    assert.equal(first.conversations[subId].rootId, rootId);
    assert.ok(first.facts.some((f) => f.cid === rootId && f.scenario === 'tools' && f.pool === 'Gemini'));
    assert.ok(first.facts.some((f) => f.cid === rootId && f.scenario === 'planning' && f.model === 'Orchestrator (Neon)'));
    assert.ok(first.facts.some((f) => f.cid === subId && f.scenario === 'subagent' && f.pool === 'Claude & GPT'));
    assert.ok(first.facts.some((f) => f.cid === tmpConvId && f.scenario === 'internal'));

    const second = await ctx.api.runTokenAnalyticsQuery({ channel: 'stable', conversationsDir: convDir }, { maxDays: 30, nowSec });
    assert.equal(second.stats.cacheHits, 3);
    assert.equal(second.stats.cacheMisses, 0);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('v553 daemon strips Token Analytics for Swarm iframes/disabled module and skips /json/list on BrowserWatcher fast path', async () => {
  // 1) Payload stripping verification via daemon rebuildBundleIfNeeded source check + regex simulation
  const RE_STRIP_TA_CSS = /\/\* __AG_TOKEN_ANALYTICS_CSS_START__ \*\/[\s\S]*?\/\* __AG_TOKEN_ANALYTICS_CSS_END__ \*\//g;
  const RE_STRIP_TA_JS = /\/\* __AG_TOKEN_ANALYTICS_JS_START__ \*\/[\s\S]*?\/\* __AG_TOKEN_ANALYTICS_JS_END__ \*\//g;
  const strippedCss = cssSrc.replace(RE_STRIP_TA_CSS, '');
  const strippedJs = runtimeSrc.replace(RE_STRIP_TA_JS, '');
  assert.ok(cssSrc.length - strippedCss.length > 8000, 'CSS stripping saves substantial bytes');
  assert.ok(runtimeSrc.length - strippedJs.length > 20000, 'JS stripping saves substantial bytes');
  assert.ok(!strippedCss.includes('#ag-token-analytics-panel'));
  assert.ok(!strippedJs.includes('TA_SCENARIO_META') && !strippedJs.includes('taComputeViewModel'));

  // 2) BrowserWatcher online fast path skips HTTP /json/list on non-heartbeat ticks
  let listCalls = 0;
  let metricsSyncCalls = 0;
  const http = {
    get(opts, cb) {
      if (opts.path === '/json/list') listCalls += 1;
      const req = new EventEmitter();
      req.destroy = () => {};
      queueMicrotask(() => {
        const res = new EventEmitter();
        res.statusCode = 200;
        res.resume = () => {};
        cb(res);
        res.emit('data', '[]');
        res.emit('end');
      });
      return req;
    }
  };
  class FakeWS {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 3;
    readyState = 1;
    addEventListener() {}
    close() { this.readyState = 3; }
    send() {}
  }

  const daemonSlice = sliceBetween(daemonSrc, 'const attachedTargets =', '\nconsole.log(');
  const ctx = vm.createContext({
    URL,
    http,
    WebSocket: FakeWS,
    activeConfig: {
      enabled: true,
      modules: { metrics: true, cdpEventDiscovery: true, tokenAnalytics: true },
      allowedOrigins: ['http://localhost', 'plugin://swarm--'],
      endpoints: [{ channel: 'stable', portFile: '/port-stable', fallbackPort: 9222, channelInstalled: true }]
    },
    DatabaseSync: null,
    SAFE_MODE: false,
    RUN_ONCE: false,
    cachedInjectScript: 'PAGE_INJECT',
    cachedIframeInjectScript: 'IFRAME_INJECT',
    cachedPatchVersion: 'v553-test',
    rebuildBundleIfNeeded: () => false,
    inFlightTokenAnalyticsPromise: null,
    tokenAnalyticsDbCache: new Map([['/fake.db', { sig: '1', parsed: {} }]]),
    tokenAnalyticsSummariesCache: new Map(),
    lastTokenAnalyticsAccessMs: 0,
    console: { log() {}, error() {} },
    Date: { now: () => 900000 },
    fs: { readFileSync: () => '9555\n/devtools/browser/ag\n' },
    setTimeout,
    clearTimeout
  });
  vm.runInContext(`${daemonSlice}\nglobalThis.api={sync,browserWatchers,attachedTargets,tokenAnalyticsDbCache};`, ctx);

  // Tick 1 is heartbeat (1 % 6 === 1) -> full scan + idle cache eviction (>600s)
  await ctx.api.sync();
  assert.equal(listCalls, 1);
  assert.equal(ctx.api.tokenAnalyticsDbCache.size, 0, 'idle Token Analytics cache cleared on tick 1');

  // Re-populate live BrowserWatcher and confirmed page + iframe, then run Tick 2 (non-heartbeat fast path)
  ctx.api.browserWatchers.set('stable:9555', { ws: new FakeWS(), port: 9555, channel: 'stable' });
  ctx.api.attachedTargets.set('p1', {
    ws: new FakeWS(),
    type: 'page',
    hostConfirmed: true,
    endpoint: { channel: 'stable' },
    syncMetricsForSession: async () => { metricsSyncCalls += 1; }
  });
  ctx.api.attachedTargets.set('f1', {
    ws: new FakeWS(),
    type: 'iframe',
    hostConfirmed: true,
    endpoint: { channel: 'stable' },
    send: async () => null,
    syncMetricsForSession: async () => { throw new Error('iframe must not sync metrics'); }
  });
  await ctx.api.sync();
  assert.equal(listCalls, 1, 'non-heartbeat tick skipped /json/list HTTP poll');
  assert.equal(metricsSyncCalls, 1, 'fast path synced confirmed page metrics without touching iframe');
});

test('v553 runtime isolates file inline-pills, translates UI Quote/Comment, and mounts/unmounts Token Analytics tab in Settings modal', async () => {
  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || (fs.existsSync(chromePath) ? chromePath : undefined)
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    await page.setContent(`<!doctype html><html><body data-agy-theme="light">
      <div id="antigravity.agentSidePanelInputBox"></div>
      <div id="content">
        <button class="inline-pill" id="file-pill" data-uri="file:///Users/eric/Quote.ts"><span class="select-text">Quote</span></button>
        <button class="inline-pill" id="ui-pill"><span class="select-text">Quote</span></button>
        <button id="comment-btn">Comment</button>
        <span id="plain-quote">Quote</span>
      </div>
      <div class="settings-modal-backdrop">
        <div class="settings-modal-container" style="width:960px;height:680px;display:flex;">
          <div data-testid="settings-sidebar" style="width:220px;">
            <div class="nav-list">
              <div class="group/nav-item"><button data-testid="settings-nav-item-General" class="bg-sidebar-secondary">General</button></div>
            </div>
          </div>
          <div style="flex:1;position:relative;">
            <div class="overflow-auto" id="native-scroll">Native Settings Content</div>
          </div>
        </div>
      </div>
    </body></html>`);

    const boot = {
      version: '20261121-v5.5.3-eric.1',
      platform: 'darwin',
      enabled: true,
      preset: 'high-contrast',
      cssText: cssSrc,
      customCss: '',
      themeVars: {},
      i18nDict: dict,
      modules: { i18n: true, metrics: false, tokenAnalytics: true, customCss: false, customJs: false },
      selectors: {},
      config: { enabled: true, preset: 'high-contrast', modules: { i18n: true, metrics: false, tokenAnalytics: true } },
      customJs: ''
    };
    const injected = runtimeSrc.replace('})(__AG_BOOT_PAYLOAD__);', () => `})(${JSON.stringify(boot)});`);

    await page.evaluate(() => {
      window.__taRequests = [];
      window.__agRequestTokenAnalytics = (raw) => {
        const req = JSON.parse(raw);
        window.__taRequests.push(req);
        const nowSec = Math.floor(Date.now() / 1000);
        const today = new Date(nowSec * 1000);
        const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        setTimeout(() => {
          window.__ag_on_token_analytics(req.reqId, {
            ok: true,
            data: {
              version: 1,
              nowSec,
              elapsedMs: 4.2,
              stats: { dbCount: 2, scannedDbs: 2, failedDbs: 0, totalCalls: 3, conversationCount: 2, projectCount: 1, cacheHits: 1, cacheMisses: 1 },
              projects: [{ key: '/users/eric/alpha', name: 'Alpha', path: '/Users/eric/Alpha', isTemp: false }],
              conversations: {
                'root-1': { id: 'root-1', title: 'Main Task', projectKey: '/users/eric/alpha', projectName: 'Alpha', source: 'desktop', isSubagent: false, agentName: '', parentId: '', rootId: 'root-1', lastTs: nowSec, models: ['Gemini 4 Neon'] },
                'sub-1': { id: 'sub-1', title: 'Child Research', projectKey: '/users/eric/alpha', projectName: 'Alpha', source: 'desktop', isSubagent: true, agentName: 'research', parentId: 'root-1', rootId: 'root-1', lastTs: nowSec, models: ['Claude Opus 5.5 (High)'] }
              },
              facts: [
                { date: dateStr, cid: 'root-1', model: 'Gemini 4 Neon', pool: 'Gemini', scenario: 'tools', subagentType: '', calls: 2, inTok: 1000, cacheRead: 9000, outTok: 200, thinkTok: 80, respTok: 120, total: 10200, weighted: 3100, billable: 1200 },
                { date: dateStr, cid: 'sub-1', model: 'Claude Opus 5.5 (High)', pool: 'Claude & GPT', scenario: 'subagent', subagentType: 'research', calls: 1, inTok: 500, cacheRead: 1500, outTok: 100, thinkTok: 40, respTok: 60, total: 2100, weighted: 1250, billable: 600 }
              ],
              dailySummary: []
            }
          });
        }, 0);
      };
    });
    await page.evaluate(injected);
    await page.waitForTimeout(80);

    // File inline-pill stays untranslated & mono; UI inline-pill & Comment button translate & stay sans; plain Quote stays untranslated
    const uiCheck = await page.evaluate(() => ({
      fileText: document.querySelector('#file-pill .select-text').textContent,
      fileFont: getComputedStyle(document.querySelector('#file-pill .select-text')).fontFamily,
      uiPillText: document.querySelector('#ui-pill .select-text').textContent,
      uiPillFont: getComputedStyle(document.querySelector('#ui-pill .select-text')).fontFamily,
      commentText: document.querySelector('#comment-btn').textContent,
      plainQuote: document.querySelector('#plain-quote').textContent,
      hasNavBtn: Boolean(document.getElementById('ag-token-nav-btn')),
      panelHiddenInitially: document.getElementById('ag-token-analytics-panel')?.hidden
    }));
    assert.equal(uiCheck.fileText, 'Quote');
    assert.ok(uiCheck.fileFont.includes('Anthropic Mono'), uiCheck.fileFont);
    assert.equal(uiCheck.uiPillText, '引用');
    assert.ok(uiCheck.uiPillFont.includes('Anthropic Sans'), uiCheck.uiPillFont);
    assert.equal(uiCheck.commentText, '评论');
    assert.equal(uiCheck.plainQuote, 'Quote');
    assert.equal(uiCheck.hasNavBtn, true);
    assert.equal(uiCheck.panelHiddenInitially, true);

    // Click Token Analytics nav button -> activates panel, hides native scroll, fetches & renders data
    await page.click('#ag-token-nav-btn');
    await page.waitForTimeout(80);
    const activeState = await page.evaluate(() => ({
      tabActiveAttr: document.querySelector('.settings-modal-container').getAttribute('data-ag-token-tab-active'),
      nativeHidden: getComputedStyle(document.getElementById('native-scroll')).display === 'none',
      panelVisible: !document.getElementById('ag-token-analytics-panel').hidden,
      reqCount: window.__taRequests.length,
      kpiText: document.getElementById('ag-ta-kpi-grid').textContent,
      sessionsText: document.getElementById('ag-ta-sessions-tbody').textContent,
      hasSubToggle: Boolean(document.querySelector('[data-toggle-sub="root-1"]'))
    }));
    assert.equal(activeState.tabActiveAttr, '1');
    assert.equal(activeState.nativeHidden, true);
    assert.equal(activeState.panelVisible, true);
    assert.equal(activeState.reqCount, 1);
    assert.ok(activeState.kpiText.includes('加权等效消耗'));
    assert.ok(activeState.sessionsText.includes('Main Task'));
    assert.equal(activeState.hasSubToggle, true);

    // Expand subagent row via delegated click
    await page.click('[data-toggle-sub="root-1"]');
    const expandedText = await page.evaluate(() => document.getElementById('ag-ta-sessions-tbody').textContent);
    assert.ok(expandedText.includes('Child Research'));

    // Click native settings nav item -> restores native scroll seamlessly
    await page.click('[data-testid="settings-nav-item-General"]');
    const restored = await page.evaluate(() => ({
      tabActiveAttr: document.querySelector('.settings-modal-container').getAttribute('data-ag-token-tab-active'),
      nativeVisible: getComputedStyle(document.getElementById('native-scroll')).display !== 'none',
      panelHidden: document.getElementById('ag-token-analytics-panel').hidden
    }));
    assert.equal(restored.tabActiveAttr, null);
    assert.equal(restored.nativeVisible, true);
    assert.equal(restored.panelHidden, true);

    // Re-inject with enabled: false -> removes all Token Analytics DOM
    const disabledBoot = { ...boot, enabled: false, version: '20261121-v5.5.3-eric.1-off' };
    await page.evaluate(runtimeSrc.replace('})(__AG_BOOT_PAYLOAD__);', () => `})(${JSON.stringify(disabledBoot)});`));
    const cleaned = await page.evaluate(() => ({
      nav: document.getElementById('ag-token-nav-section'),
      panel: document.getElementById('ag-token-analytics-panel'),
      tip: document.getElementById('ag-ta-tooltip')
    }));
    assert.equal(cleaned.nav, null);
    assert.equal(cleaned.panel, null);
    assert.equal(cleaned.tip, null);
  } finally {
    await browser.close();
  }
});
