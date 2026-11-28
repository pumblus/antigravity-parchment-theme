import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const daemonSrc = read('core/daemon.mjs');
const runtimeSrc = read('core/runtime.js');
const cssSrc = read('core/theme.css');
const dict = JSON.parse(read('core/i18n.json'));

let sharedBrowser;
after(async () => sharedBrowser?.close());

function sliceBetween(src, startMarker, endMarker) {
  const s = src.indexOf(startMarker);
  assert.ok(s >= 0, `Missing start marker: ${startMarker}`);
  const e = src.indexOf(endMarker, s);
  assert.ok(e > s, `Missing end marker: ${endMarker}`);
  return src.slice(s, e);
}

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
const pbVarint = (field, val) => Buffer.concat([encodeVarint((field << 3) | 0), encodeVarint(val)]);
const pbBytes = (field, bufOrStr) => {
  const b = Buffer.isBuffer(bufOrStr) ? bufOrStr : Buffer.from(String(bufOrStr), 'utf8');
  return Buffer.concat([encodeVarint((field << 3) | 2), encodeVarint(b.length), b]);
};
const makeGenBlob = ({ slug = 'gemini-4-neon', label = 'Gemini 4 Neon', inTok = 500, outTok = 50 } = {}) =>
  pbBytes(
    1,
    Buffer.concat([
      pbBytes(4, Buffer.concat([pbVarint(2, inTok), pbVarint(3, outTok)])),
      pbBytes(19, slug),
      pbBytes(21, label)
    ])
  );

test('Phase 2B static slimming audit: dead legacy code removed, RTL blockquote logical border, zero :has()/#FFFFFF', () => {
  assert.doesNotMatch(cssSrc, /data-newux-theme|claude-desktop-purewhite|vintage-deep/);
  assert.match(cssSrc, /blockquote\s*\{\s*border-inline-start:\s*2px solid/);
  assert.doesNotMatch(runtimeSrc, /parseCssColorViaCanvasHex6|data-newux-theme|CLAUDE_PUREWHITE|theme-color-flavor|__ag_preset_hook_installed|__ag_zoom_timer|__ag_zoom_resize_fn/);
  assert.doesNotMatch(daemonSrc, /coldBootHealer|__agRequestHardReload/);
});

test('Phase 2A i18n: 2.36.0 floating composer, skipped step, org-disabled, prepaid wallet & dynamic rules', () => {
  for (const [en, zh] of [
    ['Subagent needs approval', '子 Agent 需要审批'],
    ['Question waiting', '有待回答的问题'],
    ['Compacting', '正在压缩上下文'],
    ['Unread message', '未读消息'],
    ['Conversation input', '对话输入'],
    ['Skipped', '已跳过'],
    ['See more', '查看更多'],
    ['See more in Plugins', '查看更多插件'],
    ['See less in Plugins', '收起更多插件'],
    ['Plugins are disabled by your organization.', '您的组织已禁用插件。'],
    ['The plugin marketplace is disabled by your organization.', '您的组织已禁用插件市场。'],
    ['Disabled by your organization', '已被您的组织禁用'],
    ['Organization prepaid wallet is empty', '组织预付钱包余额已耗尽']
  ]) {
    assert.equal(dict[en], zh, en);
  }

  const lookupCode =
    sliceBetween(runtimeSrc, '  const SWARM_FRAME_ONLY_DICT =', '  let scanBodyFn = null;') +
    '\n' +
    sliceBetween(runtimeSrc, '    const RE_HAS_CJK =', '    function translateTextNode(node)') +
    '\n' +
    sliceBetween(runtimeSrc, '    function resolveAttrTranslation(atrim, el)', '    const ATTR_TO_ORIG =');

  const ctx = vm.createContext({
    IS_SWARM_PLUGIN_FRAME: false,
    DICT: Object.assign(Object.create(null), dict),
    DICT_APOS: new Map(),
    DICT_CI: new Map(Object.entries(dict).map(([k, v]) => [k.toLowerCase(), v])),
    RE_CURLY_APOS: /[\u2018\u2019]/g,
    PATCH_VERSION: 'v236-unit'
  });
  vm.runInContext(lookupCode + '\nglobalThis.api = { computeTextTranslation, resolveAttrTranslation };', ctx);

  const plainEl = { tagName: 'SPAN', getAttribute: () => null, closest: () => null };
  const attBadgeEl = {
    tagName: 'SPAN',
    getAttribute: () => null,
    closest: (sel) => (sel.includes('aux-pane-floating-composer-attachment-badge') ? {} : null)
  };
  const cmtBadgeEl = {
    tagName: 'SPAN',
    getAttribute: () => null,
    closest: (sel) => (sel.includes('aux-pane-floating-composer-comment-badge') ? {} : null)
  };

  assert.equal(ctx.api.computeTextTranslation('See 12 more', plainEl), '查看其余 12 项');
  assert.equal(ctx.api.computeTextTranslation('See more in Google Workspace', plainEl), '查看更多（Google Workspace 办公套件）');
  assert.equal(ctx.api.computeTextTranslation('See less in Science', plainEl), '收起更多（Science）');
  assert.equal(ctx.api.computeTextTranslation('2 tasks running', plainEl), '2 个任务运行中');
  assert.equal(ctx.api.computeTextTranslation('1 Attached', plainEl), '1 个附件');
  assert.equal(ctx.api.computeTextTranslation(' Attached', attBadgeEl), ' 个附件');
  assert.equal(ctx.api.computeTextTranslation(' Comment', cmtBadgeEl), ' 评论');
  assert.equal(ctx.api.computeTextTranslation('In progress', plainEl), '进行中');
  assert.equal(
    ctx.api.resolveAttrTranslation('Subagent needs approval \u2014 restore split view', plainEl),
    '子 Agent 需要审批 — 恢复分栏视图'
  );
  assert.equal(
    ctx.api.resolveAttrTranslation('2 tasks running \u2014 restore split view', plainEl),
    '2 个任务运行中 — 恢复分栏视图'
  );
});

test('Phase 3 daemon: hot/cold split Token Analytics cache avoids rewriting cold file on hot-only changes & migrates legacy', async (t) => {
  const { DatabaseSync } = await import('node:sqlite');
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-hotcold-'));
  t.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

  const convDir = path.join(tmpRoot, 'conversations');
  const cacheDir = path.join(tmpRoot, '.cache');
  fs.mkdirSync(convDir, { recursive: true });

  const makeDb = (id, outTok, ageDays) => {
    const p = path.join(convDir, `${id}.db`);
    const db = new DatabaseSync(p);
    db.exec('CREATE TABLE trajectory_metadata_blob (data BLOB); CREATE TABLE steps (idx INTEGER, step_type INTEGER, metadata BLOB, step_payload BLOB); CREATE TABLE gen_metadata (idx INTEGER, data BLOB);');
    db.prepare('INSERT INTO gen_metadata VALUES (0, ?)').run(makeGenBlob({ outTok }));
    db.close();
    const ts = new Date(Date.now() - ageDays * 86400 * 1000);
    fs.utimesSync(p, ts, ts);
    return p;
  };

  const coldId = '11111111-1111-4111-8111-111111111111';
  const hotId = '22222222-2222-4222-8222-222222222222';
  const coldDb = makeDb(coldId, 111, 15);
  const hotDb = makeDb(hotId, 222, 0.01);

  const buildVm = () => {
    const taCode =
      sliceBetween(daemonSrc, 'function parseProtoAll(', 'function fmtTok(') +
      '\n' +
      sliceBetween(daemonSrc, 'const textDecoder =', 'const MAX_CHILD_METRICS_CACHE_SIZE =') +
      '\n' +
      sliceBetween(daemonSrc, 'function getDbStatByPath(', 'function resolveConversationDbPath(') +
      '\n' +
      sliceBetween(daemonSrc, 'const TA_MEM_FILE_RE =', '// ============================================================================\n// 5. CDP 目标发现');
    const ctx = vm.createContext({
      fs, path, os, crypto, process, Buffer, performance, TextDecoder, DatabaseSync,
      setImmediate, setTimeout, clearTimeout,
      BASE_VERSION: '20261128-v6.0.6-eric.1',
      CACHE_DIR: cacheDir,
      SAFE_MODE: false,
      RUN_ONCE: false,
      daemonExiting: false,
      tokenAnalyticsDbCache: new Map(),
      tokenAnalyticsSummariesCache: new Map(),
      tokenAnalyticsCacheState: {
        diskLoaded: false, persistTimer: null, flushInFlight: false, flushPending: false,
        coldDirty: false, hotDirty: false, lastJsonDataRef: null, lastJsonStr: ''
      },
      lastTokenAnalyticsAccessMs: 0,
      inFlightTokenAnalyticsPromise: null,
      inFlightTokenAnalyticsKey: ''
    });
    vm.runInContext(
      `${taCode}\nglobalThis.api={queryTokenAnalytics,flushTokenAnalyticsDiskCacheAsync,TA_CACHE_HOT_FILE,TA_CACHE_COLD_FILE,TA_CACHE_LEGACY_FILE,TA_CACHE_SALT,tokenAnalyticsDbCache,tokenAnalyticsCacheState};`,
      ctx
    );
    return ctx.api;
  };

  const api1 = buildVm();
  const nowSec = Math.floor(Date.now() / 1000);
  const r1 = await api1.queryTokenAnalytics({ conversationsDir: convDir }, { maxDays: 365, nowSec });
  assert.equal(r1.stats.cacheMisses, 2);
  if (api1.tokenAnalyticsCacheState.persistTimer) clearTimeout(api1.tokenAnalyticsCacheState.persistTimer);
  await api1.flushTokenAnalyticsDiskCacheAsync();

  assert.ok(fs.existsSync(api1.TA_CACHE_HOT_FILE), 'hot cache file created');
  assert.ok(fs.existsSync(api1.TA_CACHE_COLD_FILE), 'cold cache file created');
  const hotJson1 = JSON.parse(fs.readFileSync(api1.TA_CACHE_HOT_FILE, 'utf8'));
  const coldJson1 = JSON.parse(fs.readFileSync(api1.TA_CACHE_COLD_FILE, 'utf8'));
  assert.ok(hotJson1.entries[hotDb] && !hotJson1.entries[coldDb], 'hot cache holds only hot DB');
  assert.ok(coldJson1.entries[coldDb] && !coldJson1.entries[hotDb], 'cold cache holds only cold DB');

  // Set a distinctive past mtime on the cold cache file to detect any rewrite
  const sentinelTime = new Date(Date.now() - 60000);
  fs.utimesSync(api1.TA_CACHE_COLD_FILE, sentinelTime, sentinelTime);
  const coldStatBefore = fs.statSync(api1.TA_CACHE_COLD_FILE);

  // Mutate ONLY the hot DB and re-query + flush
  const hdb = new DatabaseSync(hotDb);
  hdb.prepare('INSERT INTO gen_metadata VALUES (1, ?)').run(makeGenBlob({ outTok: 333 }));
  hdb.close();
  const freshStamp = new Date(Date.now() + 2000);
  fs.utimesSync(hotDb, freshStamp, freshStamp);

  const r2 = await api1.queryTokenAnalytics({ conversationsDir: convDir }, { maxDays: 365, nowSec });
  assert.equal(r2.stats.cacheHits, 1, 'cold DB remains cache hit');
  assert.equal(r2.stats.cacheMisses, 1, 'only hot DB reparsed');
  assert.equal(api1.tokenAnalyticsCacheState.coldDirty, false, 'cold tier stays clean');
  assert.equal(api1.tokenAnalyticsCacheState.hotDirty, true, 'hot tier marked dirty');
  if (api1.tokenAnalyticsCacheState.persistTimer) clearTimeout(api1.tokenAnalyticsCacheState.persistTimer);
  await api1.flushTokenAnalyticsDiskCacheAsync();

  const coldStatAfter = fs.statSync(api1.TA_CACHE_COLD_FILE);
  assert.equal(coldStatAfter.mtimeMs, coldStatBefore.mtimeMs, 'cold cache file must NOT be rewritten on hot-only change');

  // Cold restart loads BOTH tiers cleanly
  const api2 = buildVm();
  const r3 = await api2.queryTokenAnalytics({ conversationsDir: convDir }, { maxDays: 365, nowSec });
  assert.equal(r3.stats.cacheHits, 2);
  assert.equal(r3.stats.cacheMisses, 0);

  // Legacy single-file migration splits and cleans up token-analytics-index.json
  const combinedEntries = { ...coldJson1.entries, ...JSON.parse(fs.readFileSync(api1.TA_CACHE_HOT_FILE, 'utf8')).entries };
  fs.unlinkSync(api1.TA_CACHE_HOT_FILE);
  fs.unlinkSync(api1.TA_CACHE_COLD_FILE);
  fs.writeFileSync(api1.TA_CACHE_LEGACY_FILE, JSON.stringify({ salt: api1.TA_CACHE_SALT, updatedAt: Date.now(), entries: combinedEntries }), 'utf8');

  const apiMig = buildVm();
  const rMig = await apiMig.queryTokenAnalytics({ conversationsDir: convDir }, { maxDays: 365, nowSec });
  assert.equal(rMig.stats.cacheHits, 2);
  if (apiMig.tokenAnalyticsCacheState.persistTimer) clearTimeout(apiMig.tokenAnalyticsCacheState.persistTimer);
  await apiMig.flushTokenAnalyticsDiskCacheAsync();
  assert.equal(fs.existsSync(api1.TA_CACHE_LEGACY_FILE), false, 'legacy cache file removed after migration');
  assert.equal(fs.existsSync(api1.TA_CACHE_HOT_FILE), true);
  assert.equal(fs.existsSync(api1.TA_CACHE_COLD_FILE), true);
});

test('Phase 3 daemon: modules.theme=false strips core theme/font CSS while preserving widget CSS', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-modtheme-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  fs.mkdirSync(path.join(tmp, 'core'));
  fs.mkdirSync(path.join(tmp, 'user'));
  fs.writeFileSync(path.join(tmp, 'core/runtime.js'), '(function(boot){globalThis.__boot=boot;})(__AG_BOOT_PAYLOAD__);');
  fs.writeFileSync(path.join(tmp, 'core/theme.css'), cssSrc);
  fs.writeFileSync(path.join(tmp, 'core/i18n.json'), '{"Cancel":"取消"}');
  fs.writeFileSync(path.join(tmp, 'user/config.json'), JSON.stringify({ modules: { theme: false } }));

  const safeFs = {};
  for (const name of ['statSync', 'existsSync', 'readFileSync', 'readdirSync']) {
    safeFs[name] = (...args) => {
      const p = String(args[0]);
      if (!p.startsWith(tmp + path.sep) && p !== tmp) {
        if (name === 'existsSync') return false;
        if (name === 'statSync' && args[1]?.throwIfNoEntry === false) return undefined;
        throw Error('Outside fixture: ' + p);
      }
      return fs[name](...args);
    };
  }
  const fail = () => { throw Error('forbidden'); };
  const http = { get(_o, _cb) { const e = {}; queueMicrotask(() => e.error?.(Error('offline'))); return { on(k, f) { e[k] = f; return this; }, destroy() {} }; } };
  const ctx = vm.createContext({
    fs: safeFs, path, os: { homedir: () => tmp, tmpdir: () => tmp }, http, crypto, TextDecoder, Uint8Array, Buffer, performance,
    spawnSync: fail, WebSocket: class { constructor() { fail(); } }, console: { log() {}, warn() {}, error() {} },
    process: { argv: ['node', 'fixture', '--once'], platform: 'darwin', env: {}, pid: 42, kill: fail, on: fail, exit() {} },
    setInterval: fail, setTimeout: fail, clearTimeout: fail
  });
  let code = daemonSrc
    .replace(/^#!.*\n/, '')
    .replace(/^import .*;\n/gm, '')
    .replace('fileURLToPath(import.meta.url)', JSON.stringify(path.join(tmp, 'core/daemon.mjs')))
    .replace("await import('node:sqlite').catch(() => null)", '({DatabaseSync: null})');
  code += '\nreturn { getScript: () => cachedInjectScript, getIframeScript: () => cachedIframeInjectScript };';
  const api = await vm.runInContext('(async()=>{' + code + '})()', ctx);

  const bootCtx = vm.createContext({});
  vm.runInContext(api.getScript(), bootCtx);
  assert.equal(bootCtx.__boot.modules.theme, false);
  assert.ok(bootCtx.__boot.cssText.startsWith('/* __AG_WIDGETS_CSS_START__ */'), 'theme/font CSS stripped before widget marker');
  assert.ok(bootCtx.__boot.cssText.includes('#ag-live-metrics-pill'), 'widget CSS preserved');
  assert.ok(!bootCtx.__boot.cssText.includes('@font-face'), 'font-face rules omitted when modules.theme=false');
});

test('Phase 2A + Phase 3 real Chrome DOM: 2.36.0 floating composer corners, cascade metrics binding, and modules.theme=false hot-toggle', async (t) => {
  const { chromium } = createRequire(import.meta.url)('playwright');
  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  sharedBrowser ||= await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || (fs.existsSync(chromePath) ? chromePath : undefined)
  });
  const page = await sharedBrowser.newPage({ viewport: { width: 1200, height: 800 } });
  t.after(() => page.close());

  const activeCid = '54040a15-4293-426f-ab80-67008f27e75c';
  await page.route('**/*', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html>
      <html>
        <head>
          <style>
            :root { --background: #232A2E; --card: #2D353B; --foreground: #D3C6AA; --border: #475258; --muted: #343F44; --muted-foreground: #859289; --secondary-foreground: #9DA9A0; --sidebar-secondary: #3D484D; }
          </style>
        </head>
        <body data-agy-theme="default">
          <!-- Regular composer with real queued-message tray (must keep flat inner top corners) -->
          <div id="regular-composer" class="surface-composer" style="width:600px;">
            <div class="queued-tray">Queued message</div>
            <div class="surface-composer-card">Regular body</div>
          </div>

          <!-- Hidden/background main conversation composer (simulating totalBoxes === 2 when side panel is maximized) -->
          <div data-testid="conversation-view" data-cascade-id="${activeCid}" style="width:600px;">
            <div id="antigravity.agentSidePanelInputBox" class="surface-composer">
              <div class="surface-composer-card">
                <div class="agy-composer-footer"><div><span>Model</span></div><div><button data-testid="send-button">Send</button></div></div>
              </div>
            </div>
          </div>

          <!-- 2.36.0 Collapsed floating composer pill -->
          <div id="collapsed-pill" data-testid="aux-pane-floating-composer" data-mode="collapsed" class="agy-floating-composer-pill surface-composer" style="width:260px;">
            <div id="pill-shelf" data-testid="aux-pane-floating-composer-shelf" data-open="false" aria-hidden="true" class="agy-floating-composer-shelf-wrap">
              <div class="agy-floating-composer-shelf-inner"></div>
            </div>
            <div id="pill-card" class="surface-composer-card">Ask anything</div>
          </div>

          <!-- 2.36.0 Expanded floating composer (matches N5 -> Atb exact DOM hierarchy!) -->
          <div data-testid="aux-pane-floating-composer" data-mode="expanded" class="agy-floating-composer-expanded" style="width:568px;">
            <div id="antigravity.agentSidePanelInputBox" class="surface-composer" data-test-floating="1">
              <div class="voice-glow-ring" aria-hidden="true"></div>
              <div id="expanded-shelf-wrapper" class="relative z-[1]">
                <div id="expanded-shelf" data-testid="aux-pane-floating-composer-shelf" data-open="false" aria-hidden="true" class="agy-floating-composer-shelf-wrap">
                  <div class="agy-floating-composer-shelf-inner"></div>
                </div>
              </div>
              <div id="expanded-card" class="surface-composer-card">
                <div class="agy-composer-footer" style="display:flex;justify-content:space-between;width:540px;">
                  <div style="display:flex;"><span>Gemini 4 Neon</span></div>
                  <div><button data-testid="send-button">Send</button></div>
                </div>
              </div>
            </div>
          </div>
        </body>
      </html>`
    })
  );
  await page.goto(`http://127.0.0.1:12345/c/${activeCid}?project=test`);
  await page.evaluate(() => {
    window.__curtainCalls = [];
    window.__metricsRequests = [];
    window.electronNative = { wcvBrowser: { setThemeColor: (hex) => { window.__curtainCalls.push(hex); return Promise.resolve(); } } };
    window.__agRequestMetrics = (json) => window.__metricsRequests.push(json);
  });

  const inject = (modules = {}, cssOverride = cssSrc) =>
    page.evaluate(
      runtimeSrc.replace('__AG_BOOT_PAYLOAD__', () =>
        JSON.stringify({
          version: '20261128-v6.0.6-eric.1',
          platform: 'darwin',
          enabled: true,
          preset: 'high-contrast',
          cssText: cssOverride,
          i18nDict: dict,
          modules: { theme: true, i18n: true, metrics: true, quota: false, tokenAnalytics: false, contextMenu: false, deadlockHealer: false, zoomShortcuts: false, ...modules }
        })
      )
    );

  // 1) Theme ON: verify expanded floating composer top corners are 11px (NOT 0px!) and wrapper has zero border-bottom
  await inject({ theme: true });
  const geomClosed = await page.evaluate(() => {
    const expCard = getComputedStyle(document.getElementById('expanded-card'));
    const expWrap = getComputedStyle(document.getElementById('expanded-shelf-wrapper'));
    const pillCard = getComputedStyle(document.getElementById('pill-card'));
    const regCard = getComputedStyle(document.querySelector('#regular-composer .surface-composer-card'));
    return {
      expTopLeft: expCard.borderTopLeftRadius,
      expTopRight: expCard.borderTopRightRadius,
      expWrapBorderB: expWrap.borderBottomWidth,
      expWrapBg: expWrap.backgroundColor,
      pillTopLeft: pillCard.borderTopLeftRadius,
      regTopLeft: regCard.borderTopLeftRadius
    };
  });
  assert.equal(geomClosed.expTopLeft, '11px', 'expanded floating composer inner top-left must remain 11px when shelf is closed');
  assert.equal(geomClosed.expTopRight, '11px', 'expanded floating composer inner top-right must remain 11px when shelf is closed');
  assert.equal(geomClosed.expWrapBorderB, '0px', '0px shelf wrapper must not draw a bottom border line');
  assert.equal(geomClosed.expWrapBg, 'rgba(0, 0, 0, 0)', '0px shelf wrapper must stay transparent');
  assert.equal(geomClosed.pillTopLeft, '11px', 'collapsed floating pill inner top-left must be 11px');
  assert.equal(geomClosed.regTopLeft, '0px', 'regular composer with real queued tray still flattens card top corners');

  // 2) Shelf opens (data-open="true"): shelf itself gets warm tray bg + 1px divider + 11px top radius
  const geomOpen = await page.evaluate(() => {
    const shelf = document.getElementById('expanded-shelf');
    shelf.setAttribute('data-open', 'true');
    shelf.setAttribute('aria-hidden', 'false');
    const cs = getComputedStyle(shelf);
    return { bg: cs.backgroundColor, borderB: cs.borderBottomWidth, tl: cs.borderTopLeftRadius, tr: cs.borderTopRightRadius };
  });
  assert.equal(geomOpen.bg, 'rgb(240, 238, 230)', 'open floating shelf uses parchment tray bg');
  assert.equal(geomOpen.borderB, '1px', 'open floating shelf gets 1px bottom divider');
  assert.equal(geomOpen.tl, '11px');
  assert.equal(geomOpen.tr, '11px');

  // 3) Floating expanded composer resolves active cascadeId even with totalBoxes === 2 and receives live metrics
  const metricsBound = await page.evaluate((cid) => {
    window.__ag_render_metrics?.({
      cascadeId: cid,
      hasData: true,
      sig: 'sig-floating-1',
      inlineHtml: '<span class="ag-ring-after">34% · 128 tok/s · TTFT 1.1s</span>',
      tooltipHtml: '<div>Detail</div>'
    });
    const floatingBox = document.querySelector('[data-test-floating="1"]');
    const pill = floatingBox?.querySelector('.ag-live-metrics-pill');
    return pill ? pill.textContent : '';
  }, activeCid);
  assert.match(metricsBound, /128 tok\/s/, 'expanded floating composer binds to active conversation live metrics');

  // 4) Hot-toggle modules.theme=false: strips theme styles, restores native Everforest-like host palette & curtain color once, preserves widgets
  const widgetsOnlyCss = cssSrc.slice(cssSrc.indexOf('/* __AG_WIDGETS_CSS_START__ */'));
  const curtainCountBeforeOff = await page.evaluate(() => window.__curtainCalls.length);
  await inject({ theme: false }, widgetsOnlyCss);
  const themeOffState = await page.evaluate(() => {
    const csBody = getComputedStyle(document.body);
    return {
      hasFonts: !!document.getElementById('ag-font-faces'),
      hasTheme: !!document.getElementById('ag-custom-fonts'),
      hasWidgets: !!document.getElementById('ag-ui-widgets'),
      presetAttr: document.documentElement.getAttribute('data-ag-preset'),
      waxSealAttr: document.documentElement.getAttribute('data-ag-wax-seal'),
      hostBg: csBody.getPropertyValue('--background').trim(),
      pillFg: csBody.getPropertyValue('--ag-pill-fg').trim(),
      curtainCalls: window.__curtainCalls.slice()
    };
  });
  assert.equal(themeOffState.hasFonts, false);
  assert.equal(themeOffState.hasTheme, false);
  assert.equal(themeOffState.hasWidgets, true);
  assert.equal(themeOffState.presetAttr, null);
  assert.equal(themeOffState.waxSealAttr, null);
  assert.equal(themeOffState.hostBg, '#232A2E', 'native host theme --background shines through untouched');
  assert.equal(themeOffState.pillFg, '#9DA9A0', 'widget pill inherits host --secondary-foreground');
  assert.ok(themeOffState.curtainCalls.length > curtainCountBeforeOff, 'restores host curtain color once on theme true->false');
  assert.equal(themeOffState.curtainCalls.at(-1), '#232A2E', 'restored curtain hex matches native host --background');

  // Further sync calls while modules.theme=false must NOT write curtain color
  const countAfterRestore = themeOffState.curtainCalls.length;
  await page.evaluate(() => { window.__ag_sync_preset_fn?.(); });
  assert.equal(await page.evaluate(() => window.__curtainCalls.length), countAfterRestore);
});
