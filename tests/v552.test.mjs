import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';

const daemonSource = fs.readFileSync(new URL('../core/daemon.mjs', import.meta.url), 'utf8');
const runtimeSource = fs.readFileSync(new URL('../core/runtime.js', import.meta.url), 'utf8');
const installerSource = fs.readFileSync(new URL('../install.mjs', import.meta.url), 'utf8');
const cssSource = fs.readFileSync(new URL('../core/theme.css', import.meta.url), 'utf8');

const slice = (src, a, b) => {
  const start = src.indexOf(a);
  const end = src.indexOf(b, start);
  assert.ok(start >= 0 && end > start, `Missing slice: ${a}`);
  return src.slice(start, end);
};

const flush = async () => {
  for (let i = 0; i < 100; i++) await Promise.resolve();
};

test('v552 macOS-only static boundary removes Windows/WSL/Linux runtime and service code', () => {
  assert.doesNotMatch(daemonSource, /win32|powershell|tasklist|wsl|isUncPath|spawnSync|child_process/i);
  assert.doesNotMatch(runtimeSource, /syncWinTitleBarOverlay|data-ag-os="win32"/i);
  assert.doesNotMatch(cssSource, /data-ag-os="win32"|Segoe UI|Microsoft YaHei|Consolas/i);
  assert.doesNotMatch(installerSource, /win32|powershell|schtasks|WScript\.Shell|systemd|fc-cache|windowsHide/i);
  assert.doesNotMatch(daemonSource, /cdpAutoRelaunch|maybeAutoRelaunchColdStartWithoutCdp/);
  assert.doesNotMatch(installerSource, /function (runRelaunch|ensureCdpLaunchers|retireWindowsSuperTtc)\(/);
});

test('v552 resolveStableNodeExecPath prefers verified Homebrew/fnm symlinks and ignores mismatched targets', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-v552-node-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const cellarBin = path.join(tmp, 'brew', 'Cellar', 'node@22', '22.14.0', 'bin');
  const brewBin = path.join(tmp, 'brew', 'bin');
  const optBin = path.join(tmp, 'brew', 'opt', 'node@22', 'bin');
  const fnmInstall = path.join(tmp, 'home', '.local', 'share', 'fnm', 'node-versions', 'v24.13.1', 'installation', 'bin');
  const fnmAlias = path.join(tmp, 'home', '.local', 'share', 'fnm', 'aliases', 'default', 'bin');
  for (const d of [cellarBin, brewBin, optBin, fnmInstall, fnmAlias]) fs.mkdirSync(d, { recursive: true });

  const realCellarNode = path.join(cellarBin, 'node');
  const otherNode = path.join(tmp, 'other-node');
  fs.writeFileSync(realCellarNode, '');
  fs.writeFileSync(otherNode, '');
  fs.symlinkSync(otherNode, path.join(brewBin, 'node')); // mismatched main link
  fs.symlinkSync(realCellarNode, path.join(optBin, 'node')); // keg-only opt link matches

  const realFnmNode = path.join(fnmInstall, 'node');
  fs.writeFileSync(realFnmNode, '');
  fs.symlinkSync(realFnmNode, path.join(fnmAlias, 'node'));

  const code = slice(installerSource, 'function resolveStableNodeExecPath(', '\nfunction registerSystemService(');
  const ctx = vm.createContext({ fs, path, os, process: { env: {}, platform: 'darwin', execPath: realCellarNode } });
  vm.runInContext(code + '\nglobalThis.resolve = resolveStableNodeExecPath;', ctx);

  assert.equal(ctx.resolve(realCellarNode, 'darwin', path.join(tmp, 'home')), path.join(optBin, 'node'));
  assert.equal(ctx.resolve(realFnmNode, 'darwin', path.join(tmp, 'home')), path.join(fnmAlias, 'node'));
  assert.equal(ctx.resolve(realFnmNode, 'linux', path.join(tmp, 'home')), realFnmNode);
  assert.equal(ctx.resolve('/nonexistent/node', 'darwin', path.join(tmp, 'home')), '/nonexistent/node');
});

test('v552 installer blocks non-macOS host lifecycle actions while preserving isolated sandbox/CI commands', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-v552-os-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const code = installerSource
    .replace(/^import .*;\r?\n/gm, '')
    .replace('const __filename = fileURLToPath(import.meta.url);', `const __filename = ${JSON.stringify(path.join(tmp, 'install.mjs'))};`)
    .slice(0, installerSource.indexOf('switch (subcommand)'));
  const ctx = vm.createContext({
    fs, path, os: { homedir: () => path.join(tmp, 'home'), tmpdir: () => tmp }, crypto: {}, http: {},
    fileURLToPath: () => '', pathToFileURL: (p) => ({ href: 'file://' + p }),
    execSync() { throw Error('unexpected execSync'); }, spawnSync() { throw Error('unexpected spawnSync'); },
    process: { argv: ['node', 'install.mjs'], platform: 'linux', versions: { node: '24.0.0' }, execPath: '/usr/bin/node', pid: 1, env: {}, emitWarning() {}, exit(c) { throw Error('exit ' + c); } },
    console: { log() {}, warn() {}, error() {} }, Atomics: { wait() {} }, Int32Array, SharedArrayBuffer
  });
  const body = installerSource
    .replace(/^import .*;\r?\n/gm, '')
    .replace('const __filename = fileURLToPath(import.meta.url);', `const __filename = ${JSON.stringify(path.join(tmp, 'install.mjs'))};`);
  vm.runInContext(body.slice(0, body.indexOf('switch (subcommand)')) + '\nglobalThis.api={assertMacOsHost,runInstall,runRollback,runUninstall,runInstallFonts,registerSystemService};globalThis.setArgs=v=>args.splice(0,args.length,...v);', ctx);

  const globalCore = path.join(tmp, 'home', '.gemini', 'antigravity', 'theme-patch', 'core');
  fs.mkdirSync(globalCore, { recursive: true });
  fs.writeFileSync(path.join(globalCore, 'daemon.mjs'), '// stub');

  assert.throws(() => ctx.api.assertMacOsHost('install'), /macOS-only/);
  assert.throws(() => ctx.api.registerSystemService(tmp, '/w'), /macOS-only/);
  assert.throws(() => ctx.api.runInstallFonts(), /macOS-only/);
  ctx.setArgs(['install']);
  await assert.rejects(ctx.api.runInstall(), /macOS-only/);
  ctx.setArgs(['rollback']);
  await assert.rejects(ctx.api.runRollback(), /macOS-only/);
  ctx.setArgs(['uninstall']);
  await assert.rejects(ctx.api.runUninstall(), /macOS-only/);
  assert.ok(code.length > 0);
});

test('v552 daemon HOST_PROBE_EXPRESSION treats transient cold-start protocols as pending', () => {
  const code = slice(daemonSource, 'const HOST_PROBE_EXPRESSION =', '\nfunction readPort(');
  const ctx = vm.createContext({});
  vm.runInContext(code + '\nglobalThis.expr = HOST_PROBE_EXPRESSION;', ctx);
  const probe = (protocol) => vm.runInNewContext(ctx.expr, {
    window: { location: { protocol, hostname: '', href: `${protocol}//blank` } },
    document: { documentElement: {}, readyState: 'complete', querySelector: () => null }
  });
  assert.equal(probe('about:'), 'pending');
  assert.equal(probe('chrome-error:'), 'pending');
  assert.equal(probe('data:'), 'pending');
  assert.equal(probe('http:'), 'non_host');
});

test('v552 daemon Browser CDP event discovery attaches created targets, guards races, and filters external Chrome on fallbackPort', async () => {
  let now = 200000;
  let nextTimer = 0;
  const timers = new Map();
  const sockets = [];
  const attachedUrls = [];
  const versionResponses = new Map();
  const listResponses = new Map();

  class MockWS {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 3;
    readyState = 0;
    handlers = {};
    sent = [];
    constructor(url) {
      this.url = url;
      sockets.push(this);
    }
    addEventListener(k, f) {
      (this.handlers[k] ||= []).push(f);
    }
    emit(k, ev) {
      for (const fn of this.handlers[k] || []) fn(ev);
    }
    open() {
      if (this.readyState === 3) return;
      this.readyState = 1;
      this.emit('open');
    }
    send(raw) {
      const m = JSON.parse(raw);
      this.sent.push(m);
      if (this.url.includes('/devtools/page/')) {
        let value = true;
        if (m.method === 'Runtime.evaluate') {
          if (m.params.expression.includes("return 'non_host'")) value = 'host';
          else if (m.params.expression === 'TEST_INJECT') {
            attachedUrls.push(this.url);
            value = 'light';
          }
        }
        queueMicrotask(() => this.emit('message', { data: JSON.stringify({ id: m.id, result: { identifier: 's-' + m.id, result: { value } } }) }));
      }
    }
    close() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      this.emit('close');
    }
  }

  const http = {
    get(opts, cb) {
      const req = new EventEmitter();
      req.destroy = () => {};
      queueMicrotask(() => {
        const table = opts.path === '/json/version' ? versionResponses : listResponses;
        const entry = table.get(opts.port);
        if (!entry) {
          req.emit('error', new Error('ECONNREFUSED'));
          return;
        }
        const res = new EventEmitter();
        res.statusCode = entry.statusCode ?? 200;
        res.resume = () => {};
        cb(res);
        res.emit('data', JSON.stringify(entry.body));
        res.emit('end');
      });
      return req;
    }
  };

  const config = {
    enabled: true,
    modules: { metrics: false, coldBootHealer: false, cdpEventDiscovery: true },
    allowedOrigins: ['http://localhost', 'http://127.0.0.1', 'vscode-file://', 'plugin://swarm--'],
    endpoints: [
      { channel: 'stable', portFile: '/port-stable', fallbackPort: 9222, channelInstalled: true },
      { channel: 'insiders', portFile: '/port-insiders', fallbackPort: 9223, channelInstalled: true }
    ]
  };
  const portFiles = new Map([['/port-stable', '9555\n/devtools/browser/ag-id\n']]);
  listResponses.set(9555, { body: [] }); // 0-window tray state keeps watcher alive
  listResponses.set(9223, { body: [{ id: 'chrome-tab', type: 'page', url: 'http://localhost:3000/', webSocketDebuggerUrl: 'ws://127.0.0.1:9223/devtools/page/chrome-tab' }] });
  versionResponses.set(9223, { body: { Browser: 'Chrome/140.0.0.0', 'User-Agent': 'Mozilla/5.0 Chrome/140.0', webSocketDebuggerUrl: 'ws://127.0.0.1:9223/devtools/browser/chrome' } });

  const ctx = vm.createContext({
    URL,
    http,
    WebSocket: MockWS,
    activeConfig: config,
    DatabaseSync: null,
    SAFE_MODE: false,
    RUN_ONCE: false,
    cachedInjectScript: 'TEST_INJECT',
    cachedPatchVersion: 'v552-test',
    rebuildBundleIfNeeded: () => false,
    console: { log() {}, error() {} },
    Date: { now: () => now },
    fs: {
      readFileSync: (p) => {
        if (portFiles.has(p)) return portFiles.get(p);
        throw Error('ENOENT');
      }
    },
    setTimeout: (fn, ms) => {
      timers.set(++nextTimer, { fn, ms });
      return nextTimer;
    },
    clearTimeout: (id) => timers.delete(id)
  });

  vm.runInContext(
    slice(daemonSource, 'const attachedTargets =', '\nconsole.log(') +
      '\nglobalThis.api={sync,browserWatchers,attachedTargets,attachingTargetIds,skippedNonHostTargets,isSkippedNonHost,isExternalNonHostBrowserProduct,readPortInfo,closeAllBrowserWatchers};',
    ctx
  );

  // External browser detection allows Electron / Antigravity and blocks standalone Chrome/Edge/Brave
  assert.equal(ctx.api.isExternalNonHostBrowserProduct('Chrome/144.0.0.0', 'Mozilla/5.0 Chrome/144.0'), true);
  assert.equal(ctx.api.isExternalNonHostBrowserProduct('Edg/132.0.0.0', 'Mozilla/5.0'), true);
  assert.equal(ctx.api.isExternalNonHostBrowserProduct('Chrome/144.0.0.0', 'Antigravity/2.33.0 Electron/44.0.0'), false);
  assert.deepEqual({ ...ctx.api.readPortInfo('/port-stable') }, { port: 9555, browserWsPath: '/devtools/browser/ag-id' });

  // Sync connects Browser watcher on 9555 even with 0 open windows, and rejects external Chrome on fallback 9223
  await ctx.api.sync();
  assert.equal(ctx.api.browserWatchers.has('stable:9555'), true);
  assert.equal(ctx.api.browserWatchers.has('insiders:9223'), false);
  assert.equal(ctx.api.attachedTargets.size, 0);

  const watcherWs = sockets.find((s) => s.url === 'ws://127.0.0.1:9555/devtools/browser/ag-id');
  assert.ok(watcherWs);
  watcherWs.open();
  assert.equal(watcherWs.sent[0].method, 'Target.setDiscoverTargets');
  assert.equal(watcherWs.sent[0].params.discover, true);

  // Event-driven Target.targetCreated attaches immediately
  now += 50;
  watcherWs.emit('message', {
    data: JSON.stringify({
      method: 'Target.targetCreated',
      params: { targetInfo: { targetId: 'win-1', type: 'page', title: 'Antigravity', url: 'http://localhost:3000/' } }
    })
  });
  const pageWs = sockets.find((s) => s.url === 'ws://127.0.0.1:9555/devtools/page/win-1');
  assert.ok(pageWs);
  pageWs.open();
  await flush();
  assert.equal(ctx.api.attachedTargets.has('win-1'), true);
  assert.deepEqual(attachedUrls, ['ws://127.0.0.1:9555/devtools/page/win-1']);

  // Target.targetDestroyed while attaching aborts cleanly without leak
  watcherWs.emit('message', {
    data: JSON.stringify({
      method: 'Target.targetCreated',
      params: { targetInfo: { targetId: 'transient-1', type: 'page', title: 'Antigravity', url: 'http://localhost:3000/' } }
    })
  });
  const transientWs = sockets.find((s) => s.url === 'ws://127.0.0.1:9555/devtools/page/transient-1');
  assert.ok(transientWs);
  watcherWs.emit('message', { data: JSON.stringify({ method: 'Target.targetDestroyed', params: { targetId: 'transient-1' } }) });
  transientWs.open();
  await flush();
  assert.equal(ctx.api.attachedTargets.has('transient-1'), false);
  assert.equal(ctx.api.attachingTargetIds.has('transient-1'), false);
  assert.equal(transientWs.readyState, 3);

  // Race guard: target attached at/after syncStartMs is preserved even if sync snapshot missed it
  now += 50;
  ctx.api.attachedTargets.get('win-1').attachedAt = now + 10;
  listResponses.set(9555, { body: [] });
  await ctx.api.sync();
  assert.equal(ctx.api.attachedTargets.has('win-1'), true);
  // Once an older target is absent from a newer sync snapshot, it is cleaned up
  now += 100;
  await ctx.api.sync();
  assert.equal(ctx.api.attachedTargets.has('win-1'), false);

  // Title transitioning to Antigravity unlocks skippedNonHostTargets after 150ms
  ctx.api.skippedNonHostTargets.set('cold-1', {
    url: 'http://localhost:3000/',
    origin: 'http://localhost:3000',
    skippedAt: now,
    attempts: 1,
    titleHadAg: false
  });
  assert.equal(ctx.api.isSkippedNonHost({ id: 'cold-1', url: 'http://localhost:3000/', title: 'Loading' }, now + 200), true);
  assert.equal(ctx.api.isSkippedNonHost({ id: 'cold-1', url: 'http://localhost:3000/', title: 'Antigravity' }, now + 150), false);

  // Disabling cdpEventDiscovery closes browser watchers on next sync
  config.modules.cdpEventDiscovery = false;
  await ctx.api.sync();
  assert.equal(ctx.api.browserWatchers.size, 0);
  assert.equal(watcherWs.readyState, 3);
});

test('v552 runtime syncChuanbanPreset short-circuits redundant surface sync until state or style changes', () => {
  let curtainCalls = 0;
  const attrs = new Map();
  const bodyAttrs = new Set(['data-agy-theme']);
  const docEl = {
    style: { colorScheme: '' },
    getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
    setAttribute: (k, v) => attrs.set(k, v)
  };
  const body = {
    classList: { contains: () => false },
    hasAttribute: (k) => bodyAttrs.has(k)
  };
  const store = new Map();
  const Storage = { prototype: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) } };
  const window = { __ag_style_rev: 1, matchMedia: () => ({ matches: false }) };
  const code = slice(runtimeSource, '  let lastSyncedHostMode = null;', '\n  window.__ag_sync_preset_fn =');
  const ctx = vm.createContext({
    window,
    document: { documentElement: docEl, body },
    Storage,
    localStorage: {},
    boot: {},
    IS_SWARM_PLUGIN_FRAME: false,
    DEFAULT_PRESET: 'high-contrast',
    PRESETS: { HIGH_CONTRAST: 'high-contrast', CLAUDE_PUREWHITE: 'claude-desktop-purewhite', VINTAGE_DEEP: 'vintage-deep', LEGACY_WARM_WHITE: 'a', LEGACY_OFFICIAL: 'b', LEGACY_CHUANBAN: 'c' },
    ALL_CUSTOM_PRESET_NAMES: new Set(),
    computeColorLuminance: () => null,
    syncCurtainSurfaceColor: () => { curtainCalls += 1; }
  });
  vm.runInContext(code + '\nglobalThis.syncPreset = syncChuanbanPreset;', ctx);

  ctx.syncPreset();
  assert.equal(curtainCalls, 1);
  // Repeated body mutations (e.g. modal scroll lock) with unchanged theme/style skip getComputedStyle work
  ctx.syncPreset();
  ctx.syncPreset();
  assert.equal(curtainCalls, 1);
  // Style revision bump invalidates cache and triggers sync again
  window.__ag_style_rev = 2;
  ctx.syncPreset();
  assert.equal(curtainCalls, 2);
});

test('v552 translation audit fixes mistranslations, removes fabricated scope, and unifies terminology', () => {
  const dict = JSON.parse(fs.readFileSync(new URL('../core/i18n.json', import.meta.url), 'utf8'));
  assert.equal(dict['Configure allowed and denied URLs for reading.'], '配置允许或拒绝读取的网址规则。');
  assert.doesNotMatch(dict['Configure allowed and denied URLs for reading.'], /文件读取/);
  assert.equal(
    dict['When toggled on, Antigravity collects usage data to help Google enhance performance and features.'],
    '开启后，Antigravity 会收集使用数据，帮助 Google 改进性能与功能。'
  );
  assert.doesNotMatch(
    dict['When toggled on, Antigravity collects usage data to help Google enhance performance and features.'],
    /匿名/
  );
  assert.equal(dict['Legal Help'], '法律帮助');
  assert.equal(dict['to ask for content changes for legal reasons.'], '，出于法律原因申请内容变更。');
  assert.equal(dict['This page isn’t working'], '此网页无法正常工作');
  assert.equal(dict['Nothing stuck'], '暂无受阻项');
  assert.equal(dict['Nothing blocked'], '暂无阻塞项');
  assert.equal(dict["Cannot promote a subagent's side question"], '无法将子 Agent 的支线提问转为独立对话');
  assert.equal(dict['Cannot promote while side question is running'], '支线提问运行中，无法转为独立对话');
  assert.equal(dict['Use full Git clones for Best of N'], '为多方案择优（Best of N）使用完整 Git 克隆');
  assert.equal(dict['Delete MCP Server'], '删除 MCP 服务器');
  assert.equal(dict['Accounts'], '账号');
  assert.equal(dict['Our most advanced model yet.'], '我们迄今最先进的模型。');
  assert.equal(Object.values(dict).some((v) => v.includes('「') || v.includes('」')), false);

  // Verify dynamic runtime translations align with static dictionary
  const lookupCode = slice(runtimeSource, '  const RE_CURLY_APOS =', '  let scanBodyFn');
  const transCode = slice(runtimeSource, '    const RE_HAS_CJK =', '    const walkerFilter =');
  const makeCtx = (swarm) => {
    const ctx = vm.createContext({
      IS_SWARM_PLUGIN_FRAME: swarm,
      DICT: Object.assign(Object.create(null), dict),
      PATCH_VERSION: 'v552-i18n',
      origTextMap: new WeakMap()
    });
    vm.runInContext(lookupCode + transCode + '\nglobalThis.tr = computeTextTranslation;', ctx);
    return ctx.tr;
  };
  const tr = makeCtx(false);
  const trSwarm = makeCtx(true);
  assert.equal(tr('Using browser (5s)', null), '正在操作浏览器（5 秒）');
  assert.equal(
    tr('Carbon that may offload routine steps to Hydrogen. Same Carbon-level quality, fewer tokens used.', null),
    'Carbon 模型，可将常规步骤分流到 Hydrogen 执行。保持 Carbon 同等质量，消耗更少 Token。'
  );
  assert.equal(
    tr('Neon that may offload routine steps to Hydrogen. Same Neon-level quality, fewer tokens used.', null),
    'Neon 模型，可将常规步骤分流到 Hydrogen 执行。保持 Neon 同等质量，消耗更少 Token。'
  );
  assert.equal(trSwarm("overview · from the narrator's notes · live", null), '概览 · 来自纪要员记录 · live');
});

test('v552 codebase cleanup removes dead functions, unused CSS variables, and duplicate local fonts', () => {
  assert.doesNotMatch(installerSource, /\bALLOWED_ORIGINS\b|function (inspectJsoncRootObject|ensureArgvRemoteDebugging)\(/);
  assert.doesNotMatch(daemonSource, /function getDbSignature\(/);
  assert.doesNotMatch(runtimeSource, /function extractCascadeId\(/);
  assert.doesNotMatch(
    cssSource,
    /--ag-(composer-card|seal-home|seal-chat|send-btn)-(focus-)?shadow\b|--ag-send-btn-border\b/
  );
  assert.doesNotMatch(cssSource, /local\('Anthropic Serif Web Text Light'\),\s*local\('Anthropic Serif Web Text Light'\)/);
});
