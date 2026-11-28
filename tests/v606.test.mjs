import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
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

test('v606 daemon: parseGenMetadataRow marks gpt-/apiProvider 31/32 as thinkUnreported & CM hook REV=3 enforces reqId + 10m TTL circuit breaker', () => {
  // 1. parseGenMetadataRow GPT thinkUnreported detection
  const protoCode =
    sliceBetween(daemonSrc, 'function parseProtoAll(', '\nfunction fmtTok(') +
    '\nconst textDecoder = new TextDecoder("utf-8", { fatal: false });\n' +
    sliceBetween(daemonSrc, 'function parseGenMetadataRow(', '\nfunction formatContextCeiling(');
  const protoCtx = vm.createContext({ TextDecoder, Uint8Array, Buffer });
  vm.runInContext(protoCode + '\nglobalThis.api = { parseGenMetadataRow };', protoCtx);

  const encodeVarint = (n) => {
    const out = [];
    let v = BigInt(n);
    while (v >= 0x80n) {
      out.push(Number((v & 0x7fn) | 0x80n));
      v >>= 7n;
    }
    out.push(Number(v));
    return Buffer.from(out);
  };
  const fieldVarint = (num, val) => Buffer.concat([encodeVarint((num << 3) | 0), encodeVarint(val)]);
  const fieldBytes = (num, buf) => Buffer.concat([encodeVarint((num << 3) | 2), encodeVarint(buf.length), buf]);
  const makeGenBlob = ({ apiProvider = 0, slug = '' }) => {
    const usage = Buffer.concat([
      fieldVarint(2, 120),
      fieldVarint(3, 45),
      ...(apiProvider ? [fieldVarint(6, apiProvider)] : [])
    ]);
    const chat = Buffer.concat([
      fieldBytes(4, usage),
      ...(slug ? [fieldBytes(19, Buffer.from(slug, 'utf8'))] : [])
    ]);
    return fieldBytes(1, chat);
  };

  assert.equal(protoCtx.api.parseGenMetadataRow({ idx: 1, data: makeGenBlob({ apiProvider: 31 }) }).thinkUnreported, true);
  assert.equal(protoCtx.api.parseGenMetadataRow({ idx: 2, data: makeGenBlob({ apiProvider: 32 }) }).thinkUnreported, true);
  assert.equal(protoCtx.api.parseGenMetadataRow({ idx: 3, data: makeGenBlob({ slug: 'gpt-5-codex' }) }).thinkUnreported, true);
  assert.equal(protoCtx.api.parseGenMetadataRow({ idx: 4, data: makeGenBlob({ slug: 'gemini-4-neon' }) }).thinkUnreported, false);

  // 2. PRELOAD_CM_HOOK_REV === 3, TTL circuit-breaker auto-recovery & reqId nonce handshake
  const cmCode = sliceBetween(daemonSrc, 'const PRELOAD_CM_HOOK_REV = 3;', '\nfunction attachTarget(');
  let fakeNow = 1_000_000;
  const cmCtx = vm.createContext({
    Date: { now: () => fakeNow },
    Map,
    Set,
    Symbol,
    Object,
    Array,
    Math
  });
  vm.runInContext(
    cmCode + '\nglobalThis.api = { PRELOAD_CM_HOOK_REV, CM_HOOK_CIRCUIT_BREAKER_TTL_MS, cmHookUnsupportedEndpoints, isCmEndpointCircuitOpen, PRELOAD_CM_INSTALLER_EXPR };',
    cmCtx
  );
  assert.equal(cmCtx.api.PRELOAD_CM_HOOK_REV, 3);
  assert.equal(cmCtx.api.CM_HOOK_CIRCUIT_BREAKER_TTL_MS, 600000);

  cmCtx.api.cmHookUnsupportedEndpoints.set('stable:9999', { zeroHits: 2, blockedUntil: fakeNow + 600000 });
  assert.equal(cmCtx.api.isCmEndpointCircuitOpen('stable:9999'), true);
  fakeNow += 600001;
  assert.equal(cmCtx.api.isCmEndpointCircuitOpen('stable:9999'), false);
  assert.equal(cmCtx.api.cmHookUnsupportedEndpoints.has('stable:9999'), false);

  // Simulate isolated-world installer verifying reqId mismatch is ignored and matching reqId merges labels
  const listeners = new Map();
  const fakeDoc = {
    documentElement: { getAttribute: (k) => (k === 'data-ag-lang' ? 'zh-CN' : null) },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    dispatchEvent(ev) {
      for (const fn of [...(listeners.get(ev.type) || [])]) fn(ev);
    }
  };
  let seenInvokeArgs = null;
  const fakeIpc = {
    send() {},
    on() {},
    invoke(channel, items) {
      seenInvokeArgs = { channel, items };
      return 'ok';
    }
  };
  const isoCtx = vm.createContext({
    document: fakeDoc,
    CustomEvent: class {
      constructor(type, init) {
        this.type = type;
        this.detail = init?.detail;
      }
    }
  });
  const installer = vm.runInContext(cmCtx.api.PRELOAD_CM_INSTALLER_EXPR, isoCtx);
  assert.equal(installer(fakeIpc), 1);

  fakeDoc.addEventListener('__ag_cm_req', (ev) => {
    const req = JSON.parse(ev.detail);
    // First emit a spoofed/stale response with mismatched reqId (must be ignored)
    fakeDoc.dispatchEvent({
      type: '__ag_cm_res',
      detail: JSON.stringify({ reqId: 'stale-req-id', items: [{ id: 'a', label: 'WRONG' }] })
    });
    // Then emit the real response matching req.reqId
    fakeDoc.dispatchEvent({
      type: '__ag_cm_res',
      detail: JSON.stringify({ reqId: req.reqId, items: [{ id: 'a', label: '独立对话' }] })
    });
  });
  fakeIpc.invoke('window:show-context-menu', [{ id: 'a', label: 'Standalone' }]);
  assert.equal(seenInvokeArgs.items[0].label, '独立对话');
});

test('v606 i18n dynamic rules: <1% left, less than a minute & compact d/h/m/s duration, and skipAriaLabels extension', () => {
  const lookupCode =
    sliceBetween(runtimeSrc, '  const SWARM_FRAME_ONLY_DICT =', '  let scanBodyFn = null;') +
    '\n' +
    sliceBetween(runtimeSrc, '    const RE_HAS_CJK =', '    function translateTextNode(node)') +
    '\n' +
    sliceBetween(runtimeSrc, '    function resolveAttrTranslation(atrim, el)', '    const ATTR_TO_ORIG =');

  const ctx = vm.createContext({
    IS_SWARM_PLUGIN_FRAME: false,
    SELECTORS: { skipAriaLabels: ['CustomSkip'] },
    DICT: Object.assign(Object.create(null), dict),
    DICT_APOS: new Map(),
    DICT_CI: new Map(Object.entries(dict).map(([k, v]) => [k.toLowerCase(), v])),
    RE_CURLY_APOS: /[\u2018\u2019]/g,
    PATCH_VERSION: 'v606-unit'
  });
  vm.runInContext(lookupCode + '\nglobalThis.api = { computeTextTranslation, SKIP_ARIA_LABEL_VALUES };', ctx);
  const el = { tagName: 'SPAN', getAttribute: () => null, closest: () => null };

  assert.equal(ctx.api.computeTextTranslation('<1% left', el), '<1% 剩余');
  assert.equal(
    ctx.api.computeTextTranslation('You have used all of your 5-hour limit, it will fully refresh in less than a minute.', el),
    '您已消耗全部5 小时额度，将在 不到 1 分钟 后完全重置。'
  );
  assert.equal(
    ctx.api.computeTextTranslation('You have used most of your weekly limit, it will fully refresh in 2d 3h 15m.', el),
    '您已消耗大部分每周额度，将在 2 天 3 小时 15 分钟 后完全重置。'
  );
  assert.equal(ctx.api.SKIP_ARIA_LABEL_VALUES.has('Cancel'), true);
  assert.equal(ctx.api.SKIP_ARIA_LABEL_VALUES.has('CustomSkip'), true);
});

test('v606 runtime: excludes Review/Diff .code-line & hot-restores code tokens, protects 5 dynamic testids, supports REV=3 CM & custom CM overrides, bilingual Token Analytics, and Swarm select preservation', async (t) => {
  const { chromium } = createRequire(import.meta.url)('playwright');
  const executablePath =
    process.env.CHROMIUM_PATH ||
    (fs.existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : fs.existsSync('/usr/bin/chromium')
        ? '/usr/bin/chromium'
        : undefined);
  sharedBrowser ||= await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  const page = await sharedBrowser.newPage();
  t.after(() => page.close());

  await page.setContent(`<!doctype html><html><head></head><body data-agy-theme="default">
    <div id="review-pane">
      <div id="review-hdr">Review</div>
      <div class="code-line">
        <div class="line-content">
          <span id="tok-allow" class="token">Allow</span>
          <span id="tok-copy" class="token">复制</span>
          <span id="tok-default" class="token">Default</span>
        </div>
      </div>
      <div class="view-lines"><span id="view-tok">Share</span></div>
    </div>
    <div data-testid="coordinator-card-title" id="coord-title">Allow</div>
    <div data-testid="coordinator-card-latest-line" id="coord-line">Share</div>
    <div data-testid="context-provider-hover-card-title" id="ctx-prov">Default</div>
    <div data-testid="ask-question-header-text" id="ask-hdr">Settings</div>
    <div data-testid="ask-question-option-text" id="ask-opt">Continue</div>

    <div data-testid="conversation-view">
      <div data-markdown-root>
        <pre id="code-pre"><code>const x = 1;</code></pre>
      </div>
    </div>

    <div class="settings-modal-backdrop">
      <div class="settings-modal-container" style="width:900px;height:620px;display:flex;">
        <div data-testid="settings-sidebar">
          <div class="group/nav-item"><button data-testid="settings-nav-item-Appearance">Appearance</button></div>
        </div>
        <div style="flex:1;display:flex;flex-direction:column;">
          <div class="overflow-auto" style="flex:1;">Native settings</div>
        </div>
      </div>
    </div>
  </body></html>`);

  // Simulate a code token that was previously mistranslated before hot-upgrade
  await page.evaluate(() => {
    const tokCopy = document.getElementById('tok-copy');
    const txt = tokCopy.firstChild;
    const wm = new WeakMap();
    wm.set(txt, { origRaw: 'Copy', lastVal: '复制' });
    window.__ag_orig_text_map = wm;
  });

  const bootPayload = {
    version: '20261128-v6.0.6-eric.1',
    platform: 'darwin',
    enabled: true,
    preset: 'high-contrast',
    installedLocale: 'zh-CN',
    cssText: cssSrc,
    customCss: '',
    themeVars: {},
    i18nDict: Object.assign({}, dict, { 'Copy Code Block': '自定义复制代码块' }),
    i18nOverrideKeys: ['Copy Code Block'],
    installedEditors: [],
    selectors: { excludeI18n: '.user-extra-excl' },
    modules: {
      i18n: true,
      metrics: false,
      quota: false,
      tokenAnalytics: true,
      contextMenu: true,
      deadlockHealer: false,
      coldBootHealer: false,
      zoomShortcuts: false
    },
    config: { enabled: true }
  };

  await page.evaluate(runtimeSrc.replace('__AG_BOOT_PAYLOAD__', () => JSON.stringify(bootPayload)));

  // 1. Review header translated, .code-line/.view-lines & 5 new testids untouched, and mistranslated token hot-restored
  const i18nCheck = await page.evaluate(() => ({
    reviewHdr: document.getElementById('review-hdr').textContent,
    tokAllow: document.getElementById('tok-allow').textContent,
    tokCopy: document.getElementById('tok-copy').textContent,
    tokDefault: document.getElementById('tok-default').textContent,
    viewTok: document.getElementById('view-tok').textContent,
    coordTitle: document.getElementById('coord-title').textContent,
    coordLine: document.getElementById('coord-line').textContent,
    ctxProv: document.getElementById('ctx-prov').textContent,
    askHdr: document.getElementById('ask-hdr').textContent,
    askOpt: document.getElementById('ask-opt').textContent
  }));
  assert.equal(i18nCheck.reviewHdr, '审阅');
  assert.equal(i18nCheck.tokAllow, 'Allow');
  assert.equal(i18nCheck.tokCopy, 'Copy', 'Previously mistranslated .code-line .token must hot-restore to original English');
  assert.equal(i18nCheck.tokDefault, 'Default');
  assert.equal(i18nCheck.viewTok, 'Share');
  assert.equal(i18nCheck.coordTitle, 'Allow');
  assert.equal(i18nCheck.coordLine, 'Share');
  assert.equal(i18nCheck.ctxProv, 'Default');
  assert.equal(i18nCheck.askHdr, 'Settings');
  assert.equal(i18nCheck.askOpt, 'Continue');

  // 2. Native context menu REV=3 { reqId, items } protocol + Standalone + group-outside
  const cmRev3 = await page.evaluate(() => {
    let reply = null;
    const onRes = (ev) => {
      reply = JSON.parse(ev.detail);
    };
    document.addEventListener('__ag_cm_res', onRes);
    document.dispatchEvent(
      new CustomEvent('__ag_cm_req', {
        detail: JSON.stringify({
          reqId: 'cm-test-42',
          items: [
            { id: 'standalone', label: 'Standalone' },
            {
              id: 'move-to-group',
              label: 'Move to Group',
              submenu: [
                { id: 'group-outside', label: 'Standalone' },
                { id: 'group-user-abc', type: 'checkbox', label: 'Standalone' }
              ]
            }
          ]
        })
      })
    );
    document.removeEventListener('__ag_cm_res', onRes);
    return reply;
  });
  assert.equal(cmRev3.reqId, 'cm-test-42');
  assert.equal(cmRev3.items[0].label, '独立对话');
  assert.equal(cmRev3.items[1].submenu[0].label, '独立对话', 'group-outside fixed action must translate');
  assert.equal(cmRev3.items[1].submenu[1].label, 'Standalone', 'User-named group item must remain untouched');

  // 3. Custom context menu respects user/i18n.override.json via __ag_lookup_user_override
  const customCmOverride = await page.evaluate(() => {
    document.getElementById('code-pre').dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 80, clientY: 80 })
    );
    const labels = [...document.querySelectorAll('#ag-custom-context-menu .ag-ctx-item')].map((b) => b.textContent.trim());
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return labels;
  });
  assert.ok(customCmOverride.includes('自定义复制代码块'), `Expected override label, got: ${customCmOverride.join(', ')}`);

  // 4. Token Analytics full bilingual switch (zh <-> en) + Claude & GPT pool display + no duplicate click listeners
  const taCheck = await page.evaluate(async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const today = new Date(nowSec * 1000);
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    let fetchCount = 0;
    window.__agRequestTokenAnalytics = (raw) => {
      fetchCount += 1;
      const req = JSON.parse(raw);
      window.__ag_on_token_analytics(req.reqId, {
        ok: true,
        data: {
          nowSec,
          elapsedMs: 12,
          stats: { scannedDbs: 2, dbCount: 2, totalCalls: 3 },
          projects: [{ key: 'demo', name: 'demo' }],
          conversations: {
            c1: { id: 'c1', rootId: 'c1', title: 'Test Session', projectKey: 'demo', projectName: 'demo', source: 'desktop', isSubagent: false, lastTs: nowSec }
          },
          facts: [
            { cid: 'c1', date: todayStr, model: 'Claude Sonnet 4.6', pool: 'Claude', scenario: 'tools', calls: 3, inTok: 1000, cacheRead: 9000, outTok: 500, thinkTok: 0, respTok: 500, total: 10500, weighted: 4900, billable: 1500 }
          ]
        }
      });
    };

    document.getElementById('ag-token-nav-btn').click();
    await new Promise((r) => setTimeout(r, 30));
    const zhTitle = document.querySelector('#ag-token-analytics-panel .ag-ta-h1')?.textContent;
    const zhPoolBadge = document.querySelector('#ag-token-analytics-panel .ag-ta-pool-badge')?.textContent;
    const zhScen = document.querySelector('#ag-ta-scenario-list .ag-ta-row-label')?.textContent;

    window.__ag_set_host_ui_lang('en');
    await new Promise((r) => setTimeout(r, 30));
    const enTitle = document.querySelector('#ag-token-analytics-panel .ag-ta-h1')?.textContent;
    const enScen = document.querySelector('#ag-ta-scenario-list .ag-ta-row-label')?.textContent;
    const enKpiLbl = document.querySelector('#ag-ta-kpi-grid .ag-ta-kpi-lbl')?.textContent;

    // Switch back to zh and click Refresh once: ensure fetchCount increments by exactly 1 (no stacked listeners)
    window.__ag_set_host_ui_lang('target');
    await new Promise((r) => setTimeout(r, 30));
    const beforeRefresh = fetchCount;
    document.getElementById('ag-ta-refresh-btn').click();
    await new Promise((r) => setTimeout(r, 30));
    const afterRefresh = fetchCount;
    const backZhTitle = document.querySelector('#ag-token-analytics-panel .ag-ta-h1')?.textContent;

    return { zhTitle, zhPoolBadge, zhScen, enTitle, enScen, enKpiLbl, refreshDelta: afterRefresh - beforeRefresh, backZhTitle };
  });
  assert.equal(taCheck.zhTitle, 'Token 消耗分析');
  assert.equal(taCheck.zhPoolBadge, 'Claude & GPT');
  assert.equal(taCheck.zhScen, '工具执行轮次');
  assert.equal(taCheck.enTitle, 'Token Analytics');
  assert.equal(taCheck.enScen, 'Tool Execution');
  assert.equal(taCheck.enKpiLbl, 'Weighted Equivalent (Primary)');
  assert.equal(taCheck.refreshDelta, 1, 'Repeated language switches must not stack duplicate click handlers on #ag-token-analytics-panel');
  assert.equal(taCheck.backZhTitle, 'Token 消耗分析');

  // 5. Swarm DOM shield preserves SELECT.value across innerHTML rewrites and language toggles
  const swarmPage = await sharedBrowser.newPage();
  t.after(() => swarmPage.close());
  await swarmPage.setContent(`<!doctype html><html><head></head><body>
    <select id="f-channel">
      <option value="">All channels</option>
      <option value="dev">#dev</option>
    </select>
  </body></html>`);
  // Run inside simulated Swarm frame check by patching IS_SWARM_PLUGIN_FRAME true
  const swarmRuntime = runtimeSrc.replace(
    'const IS_SWARM_PLUGIN_FRAME = !!(',
    'const IS_SWARM_PLUGIN_FRAME = true || !!('
  );
  await swarmPage.evaluate(
    swarmRuntime.replace(
      '__AG_BOOT_PAYLOAD__',
      () =>
        JSON.stringify({
          version: '20261128-v6.0.6-eric.1',
          platform: 'darwin',
          enabled: true,
          installedLocale: 'zh-CN',
          cssText: '',
          i18nDict: Object.assign({}, dict, { 'All channels': '全部频道' }),
          modules: { i18n: true, metrics: false, quota: false, tokenAnalytics: false, contextMenu: false, deadlockHealer: false, coldBootHealer: false, zoomShortcuts: false }
        })
    )
  );
  const selectRes = await swarmPage.evaluate(() => {
    const sel = document.getElementById('f-channel');
    sel.value = 'dev';
    sel.innerHTML = '<option value="">All channels</option><option value="dev">#dev</option><option value="ops">#ops</option>';
    const valAfterRewrite = sel.value;
    const opt0Zh = sel.options[0].textContent;
    window.__ag_set_host_ui_lang('en');
    const valAfterEn = sel.value;
    const opt0En = sel.options[0].textContent;
    return { valAfterRewrite, opt0Zh, valAfterEn, opt0En };
  });
  assert.equal(selectRes.valAfterRewrite, 'dev');
  assert.equal(selectRes.opt0Zh, '全部频道');
  assert.equal(selectRes.valAfterEn, 'dev');
  assert.equal(selectRes.opt0En, 'All channels');
});
