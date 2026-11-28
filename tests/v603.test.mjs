import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const cssSrc = read('core/theme.css');
const runtimeSrc = read('core/runtime.js');
const daemonSrc = read('core/daemon.mjs');
const installSrc = read('install.mjs');
const dict = JSON.parse(read('core/i18n.json'));

function sliceBetween(src, startMarker, endMarker) {
  const s = src.indexOf(startMarker);
  assert.ok(s >= 0, `missing start marker: ${startMarker}`);
  const e = src.indexOf(endMarker, s);
  assert.ok(e > s, `missing end marker: ${endMarker}`);
  return src.slice(s, e);
}

const varint = (n) => {
  const a = [];
  do {
    let b = n % 128;
    n = Math.floor(n / 128);
    a.push(b | (n ? 128 : 0));
  } while (n);
  return Buffer.from(a);
};
const field = (n, v) =>
  typeof v === 'number'
    ? Buffer.concat([varint(n * 8), varint(v)])
    : Buffer.concat([varint(n * 8 + 2), varint(v.length), v]);
const proto = (...pairs) => Buffer.concat(pairs.map(([n, v]) => field(n, v)));

test('v603 CSS enforces single-layer composer, zero :has(), 3-way split markers, and Anthropic flat tokens', () => {
  const uncommented = cssSrc.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(cssSrc.includes('/* __AG_THEME_RULES_START__ */'), 'missing @font-face isolation marker');
  assert.ok(cssSrc.includes('/* __AG_WIDGETS_CSS_START__ */'), 'missing UI widgets isolation marker');
  assert.ok(!/html[^,{]*:has\(|:not\(:has\(|\.bg-sidebar[^,{]*:has\(/i.test(uncommented), 'theme.css must contain zero global/sidebar :has() selectors');
  assert.ok(!/#FFFFFF\b/i.test(uncommented), 'theme.css must contain zero pure #FFFFFF');
  assert.ok(!/claude-warm|morandi|Google Sans Flex/i.test(uncommented), 'fork theme.css must stay Anthropic-only');
  assert.ok(uncommented.includes('[data-testid="conversation-list-sidebar"]'));
  assert.ok(uncommented.includes('[data-ag-lang-toggle-group="1"]'));
  assert.ok(uncommented.includes('.ag-ctx-ring'));
  assert.ok(uncommented.includes('.ag-ta-list--model'));
  assert.ok(uncommented.includes('container-type: inline-size'));

  // Widgets & Token Analytics CSS must remain flat (zero drop shadows)
  const widgetsCss = cssSrc.slice(cssSrc.indexOf('/* __AG_WIDGETS_CSS_START__ */')).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/box-shadow\s*:\s*(?!\s*none\b)/i.test(widgetsCss), 'widgets CSS must have zero drop shadows');
});

test('v603 daemon supports compact SVG ring, Claude merged-thinking, wake-turn SQL boundary, Remote SSH dbFound, and config uiLang persistence', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-v603-daemon-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  fs.mkdirSync(path.join(tmp, 'core'));
  fs.mkdirSync(path.join(tmp, 'user'));
  const convDir = path.join(tmp, 'conversations');
  fs.mkdirSync(convDir);

  fs.writeFileSync(path.join(tmp, 'core/runtime.js'), '(function(boot){globalThis.__testBoot=boot;})(__AG_BOOT_PAYLOAD__);');
  fs.writeFileSync(path.join(tmp, 'core/theme.css'), '');
  fs.writeFileSync(path.join(tmp, 'core/i18n.json'), '{}');
  const cfgPath = path.join(tmp, 'user/config.json');
  fs.writeFileSync(
    cfgPath,
    JSON.stringify({ enabled: true, preset: 'high-contrast', modules: { i18n: true, metrics: true }, customKeep: 42 }, null, 2) + '\n'
  );

  const fail = () => {
    throw new Error('Host effects forbidden');
  };
  const safeFs = {};
  for (const name of ['statSync', 'existsSync', 'readFileSync', 'readdirSync', 'writeFileSync', 'renameSync', 'unlinkSync', 'mkdirSync']) {
    safeFs[name] = (...args) => {
      const p = String(args[0]);
      if (!p.startsWith(tmp + path.sep) && p !== tmp) {
        if (name === 'existsSync') return false;
        if (name === 'statSync' && args[1]?.throwIfNoEntry === false) return undefined;
        throw new Error('Outside fixture: ' + p);
      }
      return fs[name](...args);
    };
  }
  class ReadonlyDb {
    constructor(p, opts) {
      assert.ok(p.startsWith(convDir + path.sep));
      assert.equal(opts.readOnly, true);
      return new DatabaseSync(p, opts);
    }
  }
  const http = {
    get(_opts, cb) {
      const events = {};
      queueMicrotask(() => events.error?.(new Error('stub offline')));
      return {
        on(k, f) {
          events[k] = f;
          return this;
        },
        destroy() {}
      };
    }
  };
  const ctx = vm.createContext({
    fs: safeFs,
    path,
    os: { homedir: () => tmp, tmpdir: () => tmp },
    http,
    crypto,
    TextDecoder,
    Uint8Array,
    Buffer,
    performance,
    DB: ReadonlyDb,
    spawnSync: fail,
    WebSocket: class {
      constructor() {
        fail();
      }
    },
    console: { log() {}, warn() {}, error() {} },
    process: {
      argv: ['node', 'fixture', '--once'],
      platform: 'darwin',
      env: {},
      pid: 42,
      kill: fail,
      on: fail,
      exit: (n) => {
        assert.equal(n, 0);
      }
    },
    setInterval: fail,
    setTimeout: fail,
    clearTimeout: fail
  });
  let code = daemonSrc
    .replace(/^#!.*\n/, '')
    .replace(/^import .*;\n/gm, '')
    .replace('fileURLToPath(import.meta.url)', JSON.stringify(path.join(tmp, 'core/daemon.mjs')))
    .replace("await import('node:sqlite').catch(() => null)", '({DatabaseSync: DB})');
  code +=
    '\nreturn { parseConversationMetrics, persistUiLangToUserConfig, activeConfig, rebuildBundleIfNeeded, getBundle: () => cachedInjectScript, getVersion: () => cachedPatchVersion };';
  const api = await vm.runInContext('(async()=>{' + code + '})()', ctx);

  // 1) Missing DB (Remote SSH scenario) returns dbFound: false and hasData: false
  const missingId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const missingRes = api.parseConversationMetrics(missingId, convDir);
  assert.equal(missingRes.hasData, false);
  assert.equal(missingRes.dbFound, false);

  // 2) Claude generation with apiProvider=26 (Anthropic) and field 9 absent -> compact SVG ring + merged-thinking display
  const claudeId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const claudeDbPath = path.join(convDir, `${claudeId}.db`);
  const db = new DatabaseSync(claudeDbPath);
  db.exec('CREATE TABLE gen_metadata(idx INTEGER PRIMARY KEY, data BLOB); CREATE TABLE steps(idx INTEGER, step_type INTEGER, step_payload BLOB); CREATE TABLE trajectory_metadata_blob(data BLOB);');
  const claudeGen = proto([
    1,
    proto(
      [4, proto([2, 10000], [3, 500], [5, 40000], [6, 26], [10, 500])],
      [9, proto([10, proto([4, 200000])])],
      [11, proto([1, 1])],
      [12, proto([1, 2])],
      [19, Buffer.from('claude-opus-5-5-high')]
    )
  ]);
  db.prepare('INSERT INTO gen_metadata VALUES(0, ?)').run(claudeGen);
  // Subagent wake-turn boundary: step_type=101 with [Message] (counts as turn) vs /task- (ignored)
  db.prepare('INSERT INTO steps VALUES(0, 101, ?), (1, 101, ?), (2, 15, ?)').run(
    Buffer.from('[Message] from coordinator: start audit'),
    Buffer.from('[Message] /task-123 status ping'),
    Buffer.alloc(0)
  );
  db.close();

  const compactRes = api.parseConversationMetrics(claudeId, convDir);
  assert.equal(compactRes.hasData, true);
  assert.equal(compactRes.dbFound, true);
  assert.match(compactRes.inlineHtml, /<svg class="ag-ctx-ring/);
  assert.match(compactRes.inlineHtml, /stroke-dashoffset="27\.33"/);
  assert.match(compactRes.inlineHtml, /250 tok\/s/);
  assert.match(compactRes.tooltipHtml, /25%/);
  assert.match(compactRes.tooltipHtml, /已含思考|合并计入/);
  assert.match(compactRes.tooltipHtml, /1 次唤醒/);

  // 3) English metrics mode when modules.i18n is false
  api.activeConfig.modules.i18n = false;
  const enRes = api.parseConversationMetrics(claudeId, convDir, { dbPath: claudeDbPath, sig: 'en-check' }, { sig: 'c-en', descendantIds: [] });
  assert.match(enRes.tooltipHtml, /Session Total|Current Turn/);
  assert.match(enRes.tooltipHtml, /merged/i);
  api.activeConfig.modules.i18n = true;

  // 4) persistUiLangToUserConfig updates only modules.i18n and preserves other keys & does not bump cachedPatchVersion
  const verBefore = api.getVersion();
  const wrote = api.persistUiLangToUserConfig('en');
  assert.equal(wrote, true);
  const parsedCfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  assert.equal(parsedCfg.modules.i18n, false);
  assert.equal(parsedCfg.customKeep, 42);
  assert.equal(parsedCfg.preset, 'high-contrast');
  // Patch version is decoupled from modules.i18n toggle
  api.rebuildBundleIfNeeded();
  assert.equal(api.getVersion(), verBefore);
});

test('v603 i18n covers 2.35.1 dynamic rules, breadcrumb protection, subagent plural guard, and colon/ellipsis fallbacks', () => {
  assert.equal(Object.keys(dict).length, 2258);
  const lookupCode =
    sliceBetween(runtimeSrc, '  const SWARM_FRAME_ONLY_DICT =', '  let scanBodyFn = null;') +
    '\n' +
    sliceBetween(runtimeSrc, '    const RE_HAS_CJK =', '    function translateTextNode(node)') +
    '\n' +
    sliceBetween(runtimeSrc, '    function resolveAttrTranslation(atrim, el)', '    const ATTR_TO_ORIG =');

  const makeApi = (isSwarm) => {
    const ctx = vm.createContext({
      IS_SWARM_PLUGIN_FRAME: isSwarm,
      DICT: Object.assign(Object.create(null), dict),
      DICT_APOS: new Map(),
      DICT_CI: new Map(Object.entries(dict).map(([k, v]) => [k.toLowerCase(), v])),
      RE_CURLY_APOS: /[\u2018\u2019]/g,
      origTextMap: new WeakMap(),
      EXCLUDE_SELECTOR: 'code',
      TEXT_IMMUTABLE_EXCLUDE_SELECTOR: 'code',
      MARKDOWN_ATTR_EXCLUDE_SELECTOR: 'code',
      FORM_ATTR_EXCLUDE_SELECTOR: 'code',
      immutableTextExclCache: new WeakMap(),
      immutableContainerExclCache: new WeakMap(),
      isFormAttrTarget: () => false
    });
    vm.runInContext(`${lookupCode}\nglobalThis.api={dictLookup,computeTextTranslation,resolveAttrTranslation};`, ctx);
    return ctx.api;
  };

  const mainApi = makeApi(false);
  const swarmApi = makeApi(true);

  // Trailing colon & bare ellipsis fallbacks
  assert.equal(mainApi.dictLookup('Settings:'), '系统设置：');
  assert.equal(mainApi.dictLookup('Thinking\u2026'), '正在思考…');

  // 2.35.1 dynamic templates
  assert.equal(mainApi.computeTextTranslation('2/5 steps · 1 failed · 1 skipped. Show plan', null), '2/5 步 · 1 失败 · 1 跳过。显示计划');
  assert.equal(mainApi.computeTextTranslation('3 subagents/tasks running', null), '3 个子 Agent/任务运行中');
  assert.equal(mainApi.computeTextTranslation('2 background tasks', null), '2 个后台任务');
  assert.equal(mainApi.computeTextTranslation('1 waiting on you', null), '1 项等待您处理');
  assert.equal(mainApi.computeTextTranslation('Today 14:30', null), '今天 14:30');
  assert.equal(mainApi.computeTextTranslation('Yesterday 09:15 AM', null), '昨天 09:15 AM');
  assert.equal(mainApi.computeTextTranslation('Open Subagent: Swarm Worker (reviewer) (active)', null), '打开子 Agent：蜂群协作者 (reviewer) (active)');
  assert.equal(mainApi.computeTextTranslation('Invoked subagent: research subagent', null), '已调用子 Agent：调研子 Agent');
  assert.equal(mainApi.computeTextTranslation('Dismissed: stale warning', null), '已忽略：stale warning');
  assert.equal(mainApi.computeTextTranslation('Revoke all: github', null), '全部撤销：github');
  assert.equal(mainApi.computeTextTranslation('Resolved "Fix bug"', null), '已标为已处理“Fix bug”');
  assert.equal(mainApi.resolveAttrTranslation('Project: MyApp', null), '项目：MyApp');
  assert.equal(mainApi.resolveAttrTranslation('Send', { tagName: 'BUTTON' }), '发送');

  // Breadcrumb user-entity protection: must NOT translate project/conversation names inside breadcrumb
  const projSeg = {
    getAttribute: (a) => (a === 'aria-label' ? 'Project: Settings' : a === 'href' ? '/p/123' : null),
    closest: (sel) => (sel === '[data-testid="breadcrumb-segment"]' ? projSeg : null)
  };
  assert.equal(mainApi.computeTextTranslation('Settings', projSeg), null);

  // Subagent plural 's' guard must NOT strip duration '(12s)'
  const subNodeEl = {
    textContent: 'Worked (12s)',
    closest: (sel) => (sel === '[data-testid="subagent-node"]' ? subNodeEl : null)
  };
  assert.equal(mainApi.computeTextTranslation('s', subNodeEl, { previousSibling: { nodeType: 3, nodeValue: '12' } }), null);
  const subCountEl = {
    textContent: '(2 subagents)',
    closest: (sel) => (sel === '[data-testid="subagent-node"]' ? subCountEl : null)
  };
  assert.equal(
    mainApi.computeTextTranslation('s', subCountEl, { previousSibling: { nodeType: 3, nodeValue: ' subagent' } }),
    ''
  );

  // Swarm Hive rules
  assert.equal(swarmApi.computeTextTranslation('Coordinator · 3 of 5 done', null), '协调器 · 已完成 3 / 5');
  assert.equal(swarmApi.computeTextTranslation('over 2m 10s', null), '历时 2 分钟 10 秒');
  assert.equal(swarmApi.resolveAttrTranslation('@worker-1 · Task · Working', null), '@worker-1 · 任务 · 正在工作');
  assert.equal(swarmApi.dictLookup('Updates automatically'), '自动更新');
});

test('v603 doctor inspectSourceSync reports stale installed files without touching host', () => {
  const fnCode =
    sliceBetween(installSrc, 'function sha256File(', 'function assertMacOsHost(') +
    '\n' +
    sliceBetween(installSrc, 'function extractBaseSemverTuple(', 'async function runDoctor(');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-v603-sync-'));
  try {
    const srcDir = path.join(tmp, 'src');
    const dstDir = path.join(tmp, 'dst');
    fs.mkdirSync(path.join(srcDir, 'core'), { recursive: true });
    fs.mkdirSync(path.join(dstDir, 'core'), { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'core/daemon.mjs'), 'v603');
    fs.writeFileSync(path.join(dstDir, 'core/daemon.mjs'), 'v555');
    fs.writeFileSync(path.join(srcDir, 'core/manifest.json'), JSON.stringify({ version: '6.0.3-eric.1', files: { 'daemon.mjs': {} } }));
    fs.writeFileSync(path.join(dstDir, 'core/manifest.json'), JSON.stringify({ version: '5.5.5-eric.1', files: { 'daemon.mjs': {} } }));
    fs.writeFileSync(path.join(srcDir, 'install.mjs'), 'new');
    fs.writeFileSync(path.join(dstDir, 'install.mjs'), 'old');

    const ctx = vm.createContext({ fs, path, crypto, process });
    vm.runInContext(`${fnCode}\nglobalThis.inspectSourceSync = inspectSourceSync;`, ctx);

    const same = ctx.inspectSourceSync(srcDir, srcDir);
    assert.equal(same.sameDirectory, true);
    assert.equal(same.inSync, true);

    const diff = ctx.inspectSourceSync(srcDir, dstDir);
    assert.equal(diff.inSync, false);
    assert.equal(diff.sourceOlder, false);
    assert.ok(diff.outdatedFiles.includes('core/daemon.mjs'));
    assert.ok(diff.outdatedFiles.includes('install.mjs'));
    assert.match(diff.syncHint, /install\.mjs.*install/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('v603 runtime mounts [EN | 中文] toggle without touching native theme buttons, isolates #ag-font-faces, and enforces single-layer composer', async (t) => {
  const { chromium } = require('playwright');
  const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH ||
      (fs.existsSync(macChrome) ? macChrome : fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
    headless: true
  });
  t.after(() => browser.close());

  const page = await browser.newPage();
  await page.route('**/*', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><html><head><title>Antigravity</title></head><body data-agy-theme="1">
        <div class="agy-card">
          <div class="py-2 px-3 w-full bg-transparent flex justify-between gap-4 items-center">
            <div><span id="theme-lbl">Theme</span></div>
            <div data-slot="toggle-group" role="group">
              <button id="native-sys" aria-label="System"><svg><path d="M263.85-140z"/></svg></button>
              <button id="native-light" aria-label="Light"><svg><path d="M565-395z"/></svg></button>
              <button id="native-dark" aria-label="Dark"><svg><path d="M481.15-140z"/></svg></button>
            </div>
          </div>
        </div>
        <div id="sample-ui">Settings</div>
      </body></html>`
    })
  );
  await page.goto('http://127.0.0.1:41999/');

  const persisted = [];
  await page.exposeFunction('__agSetUiLang', (val) => persisted.push(val));

  const bootPayload = {
    version: '20261125-v6.0.3-eric.1',
    enabled: true,
    preset: 'high-contrast',
    installedLocale: 'zh-CN',
    cssText: cssSrc,
    i18nDict: { Settings: '设置', Theme: '主题' },
    modules: { i18n: true, metrics: false, tokenAnalytics: false, coldBootHealer: false }
  };
  await page.evaluate(
    ({ src, payload }) => {
      const fn = new Function(src.replace('__AG_BOOT_PAYLOAD__', JSON.stringify(payload)));
      fn();
    },
    { src: runtimeSrc, payload: bootPayload }
  );

  // 1) 3-way CSS split mounted cleanly
  assert.equal(await page.locator('#ag-font-faces').count(), 1);
  assert.equal(await page.locator('#ag-custom-fonts').count(), 1);
  assert.equal(await page.locator('#ag-ui-widgets').count(), 1);

  // 2) Native 3 theme buttons untouched (no custom theme buttons injected into native group)
  assert.equal(await page.locator('[data-slot="toggle-group"]:not([data-ag-lang-toggle-group="1"]) button').count(), 3);
  assert.equal(await page.locator('#native-sys').getAttribute('data-ag-native-theme-slot'), null);

  // 3) Language toggle mounted and translates immediately
  assert.equal(await page.locator('[data-ag-lang-row="1"]').count(), 1);
  assert.equal(await page.locator('#sample-ui').textContent(), '设置');
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-ag-lang')), 'zh-CN');

  // 4) Clicking EN restores English without reinjection and calls __agSetUiLang('en')
  await page.click('button[data-ag-lang-btn="en"]');
  assert.equal(await page.locator('#sample-ui').textContent(), 'Settings');
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-ag-lang')), 'en');
  assert.equal(await page.locator('[data-ag-lang-row-label="1"]').textContent(), 'Language');
  await page.waitForTimeout(200);
  assert.deepEqual(persisted, ['en']);

  // 5) Clicking 中文 restores Chinese immediately
  await page.click('button[data-ag-lang-btn="target"]');
  assert.equal(await page.locator('#sample-ui').textContent(), '设置');
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-ag-lang')), 'zh-CN');
  assert.equal(await page.locator('[data-ag-lang-row-label="1"]').textContent(), '界面语言');

  // 6) Disabling removes all 3 style tags and language row cleanly
  await page.evaluate(
    ({ src, payload }) => {
      const fn = new Function(src.replace('__AG_BOOT_PAYLOAD__', JSON.stringify(payload)));
      fn();
    },
    { src: runtimeSrc, payload: { ...bootPayload, enabled: false } }
  );
  assert.equal(await page.locator('#ag-font-faces').count(), 0);
  assert.equal(await page.locator('#ag-custom-fonts').count(), 0);
  assert.equal(await page.locator('#ag-ui-widgets').count(), 0);
  assert.equal(await page.locator('[data-ag-lang-row="1"]').count(), 0);
  assert.equal(await page.locator('#sample-ui').textContent(), 'Settings');
});
