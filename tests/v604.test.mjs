import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const daemonSrc = read('core/daemon.mjs');
const runtimeSrc = read('core/runtime.js');
const cssSrc = read('core/theme.css');
const i18nRaw = read('core/i18n.json');
const dict = JSON.parse(i18nRaw);

let sharedBrowser;
after(async () => sharedBrowser?.close());

function sliceBetween(src, startMarker, endMarker) {
  const s = src.indexOf(startMarker);
  assert.ok(s >= 0, `Missing start marker: ${startMarker}`);
  const e = src.indexOf(endMarker, s);
  assert.ok(e > s, `Missing end marker: ${endMarker}`);
  return src.slice(s, e);
}

test('v604 dictionary expands to 2,244 entries with zero collisions and includes 2.35.2 + context menu + model leaving labels', () => {
  const keys = [...i18nRaw.matchAll(/^  ("(?:[^"\\]|\\.)*"):/gm)].map((m) => JSON.parse(m[1]));
  assert.equal(Object.keys(dict).length, 2244);
  assert.equal(keys.length, 2244);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(new Set(keys.map((k) => k.toLowerCase().replace(/[\u2018\u2019]/g, "'"))).size, keys.length);

  for (const [en, zh] of [
    ['Applies to messages sent after this turn', '对本轮之后发送的消息生效'],
    ['Applies to /btw and messages sent after this turn', '对支线提问 (/btw) 及本轮之后发送的消息生效'],
    ['Customizations views', '自定义视图'],
    ['Leaving Soon', '即将下线'],
    ['Use Hydrogen for better quality with lower quota usage.', '建议改用 Hydrogen，效果更好且配额消耗更低。'],
    ['Pin Entire Project', '置顶整个项目'],
    ['Move to Project', '移至项目'],
    ['Find References', '查找引用'],
    ['Cut', '剪切'],
    ['Paste', '粘贴'],
    ['Share', '分享']
  ]) {
    assert.equal(dict[en], zh, en);
  }
});

test('v604 CSS audit: zero :has(), zero dead/undefined --ag-* vars, zero #FFFFFF, zero drop-shadow, Clay strictly CTA-only in UI', () => {
  const uncommented = cssSrc.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/:has\(/i.test(uncommented), 'theme.css must contain zero :has() selectors anywhere');
  assert.doesNotMatch(uncommented, /#ffffff\b/i, 'No pure #FFFFFF');
  assert.doesNotMatch(uncommented, /box-shadow\s*:\s*(?!\s*(?:none|inset\s+0\s+0\s+0\s+1px)\b)/i, 'No drop shadows');
  assert.doesNotMatch(uncommented, /rgba\(\s*127\s*,\s*127\s*,\s*127/i, 'No neutral cold gray rgba(127,127,127)');

  const definedVars = new Set([...uncommented.matchAll(/(--ag-[\w-]+)\s*:/g)].map((m) => m[1]));
  const usedVars = new Set([...uncommented.matchAll(/var\((--ag-[\w-]+)/g)].map((m) => m[1]));
  const unused = [...definedVars].filter((v) => !uncommented.includes(`var(${v}`) && !runtimeSrc.includes(v));
  const undef = [...usedVars].filter((v) => !definedVars.has(v) && !runtimeSrc.includes(v));
  assert.deepEqual(unused, [], `Unused --ag-* CSS variables: ${unused.join(', ')}`);
  assert.deepEqual(undef, [], `Undefined --ag-* CSS variables: ${undef.join(', ')}`);

  // Tooltip centering transform fix & Context menu markers
  const langTtBlock = sliceBetween(cssSrc, '#ag-theme-btn-tooltip {', '#ag-theme-btn-tooltip[data-visible="1"]');
  assert.match(langTtBlock, /transform:\s*translate\(-50%,\s*-100%\)/);
  assert.ok(cssSrc.includes('/* __AG_CONTEXT_MENU_CSS_START__ */'));
  assert.ok(cssSrc.includes('/* __AG_CONTEXT_MENU_CSS_END__ */'));

  // Token Analytics UI chrome no longer misuses Clay (--ag-ta-primary) for nav icon, filter border, clear link, active row border, or checkbox accent
  const taCss = sliceBetween(cssSrc, '/* __AG_TOKEN_ANALYTICS_CSS_START__ */', '/* __AG_TOKEN_ANALYTICS_CSS_END__ */');
  assert.doesNotMatch(taCss, /color:\s*var\(--ag-ta-primary\)/);
  assert.doesNotMatch(taCss, /border-color:\s*var\(--ag-ta-primary\)/);
  assert.doesNotMatch(taCss, /accent-color:\s*var\(--ag-ta-primary\)/);
});

test('v604 2.35.2 RE_ARIA_MODEL parses period-appended runtime notes cleanly', () => {
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
    PATCH_VERSION: 'v604-unit'
  });
  vm.runInContext(lookupCode + '\nglobalThis.api = { resolveAttrTranslation, computeTextTranslation };', ctx);
  const el = { tagName: 'BUTTON', getAttribute: () => null, closest: () => null };

  assert.equal(
    ctx.api.resolveAttrTranslation('Select model: Claude Sonnet 4.6 (High). Applies to messages sent after this turn.', el),
    '模型，当前：Claude Sonnet 4.6 (高)（对本轮之后发送的消息生效）'
  );
  assert.equal(
    ctx.api.resolveAttrTranslation('Model, current: Gemini 4 Neon (High). Applies to /btw and messages sent after this turn.', el),
    '模型，当前：Gemini 4 Neon (高)（对支线提问 (/btw) 及本轮之后发送的消息生效）'
  );
  assert.equal(
    ctx.api.computeTextTranslation('The original Gemini 4 model for advanced workflows. Leaving on Nov 30.', el),
    '面向高阶工作流的初代 Gemini 4 模型，将于 11 月 30 日下线。'
  );
  assert.equal(
    ctx.api.computeTextTranslation('Use Hydrogen for better quality with lower quota usage. Leaving on Nov 30.', el),
    '建议改用 Hydrogen，效果更好且配额消耗更低，将于 11 月 30 日下线。'
  );
});

test('v604 macOS external editor probe & safe local launcher enforce strict allowlists and reject unsafe URLs', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-v604-bridge-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const htmlFile = path.join(tmp, 'preview.html');
  const jsFile = path.join(tmp, 'app.js');
  const fakeApp = path.join(tmp, 'Applications', 'Cursor.app');
  const fakeCli = path.join(fakeApp, 'Contents/Resources/app/bin/cursor');
  fs.mkdirSync(path.dirname(fakeCli), { recursive: true });
  fs.writeFileSync(htmlFile, '<h1>ok</h1>');
  fs.writeFileSync(jsFile, 'console.log(1);\n');
  fs.writeFileSync(fakeCli, '#!/bin/sh\n');

  const execCalls = [];
  const code =
    sliceBetween(daemonSrc, 'const BROWSER_PREVIEW_EXT_WHITELIST_RE =', '\nfunction readHostThemeMode()') +
    '\n' +
    sliceBetween(daemonSrc, 'function resolveSafeLocalFileFromUrl(', '\nconst PRELOAD_CM_HOOK_REV =');

  const ctx = vm.createContext({
    fs,
    path,
    os: { homedir: () => tmp },
    URL,
    pathToFileURL,
    process: { pid: 99, env: { PATH: '/usr/bin', ELECTRON_RUN_AS_NODE: '1' } },
    CACHE_DIR: path.join(tmp, '.cache'),
    SAFE_MODE: false,
    readJsonSafe: (p, fb) => {
      try {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
      } catch {
        return fb;
      }
    },
    execFile: (bin, args, opts, cb) => {
      if (typeof opts === 'function') {
        execCalls.push({ bin, args, opts: null });
        opts();
      } else {
        execCalls.push({ bin, args, opts });
        cb?.();
      }
    }
  });
  vm.runInContext(
    code +
      '\nglobalThis.api = { detectInstalledExternalEditors, resolveSafeLocalFileFromUrl, resolveSafeBrowserPreviewFileUrl, launchSafeFileUrlInDefaultBrowser, launchSafeFileInDetectedEditor };',
    ctx
  );

  // Detects ~/Applications/Cursor.app CLI binary cleanly and caches to disk
  const detected = ctx.api.detectInstalledExternalEditors({ force: true });
  const cursor = detected.byId.get('cursor');
  assert.ok(cursor, 'Cursor.app should be detected from ~/Applications');
  assert.equal(cursor.execPath, fakeCli);
  assert.equal(cursor.isMacApp, false);
  assert.ok(fs.existsSync(path.join(tmp, '.cache/external-editors.json')));

  // Safe browser preview whitelist: allows .html/.pdf/.svg, rejects .js, directories, remote hosts, non-file protocols
  const okHtml = ctx.api.resolveSafeBrowserPreviewFileUrl(pathToFileURL(htmlFile).href);
  assert.equal(okHtml.ok, true);
  assert.equal(ctx.api.resolveSafeBrowserPreviewFileUrl(pathToFileURL(jsFile).href).reason, 'extension_not_allowed');
  assert.equal(ctx.api.resolveSafeBrowserPreviewFileUrl(pathToFileURL(tmp).href).reason, 'not_regular_file');
  assert.equal(ctx.api.resolveSafeBrowserPreviewFileUrl('https://evil.example/a.html').reason, 'disallowed_protocol');
  assert.equal(ctx.api.resolveSafeBrowserPreviewFileUrl('file://remote-host/etc/passwd').reason, 'disallowed_file_host');

  // Browser launch uses /usr/bin/open with no shell
  ctx.api.launchSafeFileUrlInDefaultBrowser(okHtml.safeFileUrl);
  assert.equal(execCalls.length, 1);
  assert.equal(execCalls[0].bin, '/usr/bin/open');
  assert.deepEqual([...execCalls[0].args], [okHtml.safeFileUrl]);

  // Editor launch strips ELECTRON_RUN_AS_NODE, passes --goto file:line:1, rejects unknown editorId
  const edOk = ctx.api.launchSafeFileInDetectedEditor(
    JSON.stringify({ id: 'cursor', fileUrl: pathToFileURL(jsFile).href, line: 42 })
  );
  assert.equal(edOk.ok, true);
  assert.equal(execCalls.length, 2);
  assert.equal(execCalls[1].bin, fakeCli);
  assert.deepEqual([...execCalls[1].args], ['--goto', `${fs.realpathSync(jsFile)}:42:1`]);
  assert.equal('ELECTRON_RUN_AS_NODE' in execCalls[1].opts.env, false);
  assert.equal(
    ctx.api.launchSafeFileInDetectedEditor(JSON.stringify({ id: 'evil-bin', fileUrl: pathToFileURL(jsFile).href })).reason,
    'editor_not_installed'
  );
});

test('v604 daemon strips context menu CSS+JS when modules.contextMenu is false and always on Swarm iframes', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-v604-strip-'));
  try {
    fs.mkdirSync(path.join(tmp, 'core'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'user'), { recursive: true });
    for (const f of ['theme.css', 'i18n.json', 'runtime.js']) {
      fs.copyFileSync(path.join(root, 'core', f), path.join(tmp, 'core', f));
    }
    fs.writeFileSync(
      path.join(tmp, 'user/config.json'),
      JSON.stringify({ enabled: true, modules: { contextMenu: false } })
    );
    const code = daemonSrc
      .replace(/^#!.*\n/, '')
      .replace(/^import .*;\n/gm, '')
      .replace('fileURLToPath(import.meta.url)', JSON.stringify(path.join(tmp, 'core/daemon.mjs')))
      .replace("await import('node:sqlite').catch(() => null)", 'null');
    const ctx = vm.createContext({
      fs,
      path,
      os: { homedir: () => tmp, tmpdir: () => tmp },
      http: { get: (_o, cb) => ({ on: () => {}, destroy: () => {} }) },
      crypto: createRequire(import.meta.url)('node:crypto'),
      execFile: () => {},
      pathToFileURL,
      URL,
      TextDecoder,
      Uint8Array,
      Buffer,
      performance,
      WebSocket: class {},
      console: { log() {}, warn() {}, error() {} },
      process: { argv: ['node', 'test', '--once'], platform: 'darwin', env: {}, pid: 100, kill: () => {}, exit: () => {} },
      setInterval: () => {},
      setTimeout: () => 0,
      clearTimeout: () => {}
    });
    const out = vm.runInContext(
      `(() => { ${code.slice(0, code.indexOf('console.log(\n  `[Antigravity Daemon]'))}\n return { cachedInjectScript, cachedIframeInjectScript }; })()`,
      ctx
    );
    assert.ok(!out.cachedInjectScript.includes('.ag-ctx-card'), 'Disabled contextMenu must strip CSS');
    assert.ok(!out.cachedInjectScript.includes('buildFileMenuItems'), 'Disabled contextMenu must strip JS');
    assert.ok(!out.cachedIframeInjectScript.includes('.ag-ctx-card'), 'Swarm iframe must always strip contextMenu CSS');
    assert.ok(!out.cachedIframeInjectScript.includes('buildFileMenuItems'), 'Swarm iframe must always strip contextMenu JS');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('v604 runtime: native context menu IPC translator, macOS flat context menu UI, Shift passthrough & Anthropic styles', async (t) => {
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
    <div data-testid="conversation-view">
      <div data-markdown-root>
        <p id="prose-p">Hello world</p>
        <pre id="code-pre"><code>const answer = 42;</code></pre>
        <a id="ext-link" href="https://anthropic.com">Anthropic</a>
        <img id="chat-img" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" width="48" height="48">
        <a id="file-pill" class="inline-pill" href="file:///Users/ericzhou/demo.ts#L12-L20">demo.ts</a>
      </div>
    </div>
    <div id="antigravity.agentSidePanelInputBox" class="surface-composer">
      <div class="surface-composer-card">
        <textarea id="composer-ta">draft text</textarea>
      </div>
    </div>
    <div data-testid="conversation-list-sidebar"><div id="sidebar-item">Sidebar</div></div>
  </body></html>`);

  const bootPayload = {
    version: '20261126-v6.0.4-eric.1',
    platform: 'darwin',
    enabled: true,
    preset: 'high-contrast',
    installedLocale: 'zh-CN',
    cssText: cssSrc,
    customCss: '',
    themeVars: {},
    i18nDict: Object.assign({}, dict, { Back: '自定义返回' }),
    i18nOverrideKeys: ['Back'],
    installedEditors: [
      { id: 'cursor', label: 'Cursor', scheme: 'cursor' },
      { id: 'vscode', label: 'VS Code', scheme: 'vscode' }
    ],
    modules: {
      i18n: true,
      metrics: false,
      quota: false,
      tokenAnalytics: false,
      contextMenu: true,
      deadlockHealer: false,
      coldBootHealer: false,
      zoomShortcuts: false
    },
    config: { enabled: true }
  };

  await page.evaluate(runtimeSrc.replace('__AG_BOOT_PAYLOAD__', () => JSON.stringify(bootPayload)));

  // 1. Native context menu IPC translator (Issue #44) + user override priority + user group protection
  const nativeRes = await page.evaluate(() => {
    let translated = null;
    const onRes = (ev) => {
      translated = JSON.parse(ev.detail);
    };
    document.addEventListener('__ag_cm_res', onRes);
    const req = [
      { id: 'back', label: 'Back' },
      { id: 'fwd', label: 'Forward' },
      { id: 'pin', label: 'Pin Entire Project' },
      { id: 'def', label: 'Open (Default)' },
      {
        id: 'move-to-group',
        label: 'Move to Project',
        submenu: [
          { id: 'group-new', label: 'New Project...' },
          { id: 'group-user-123', type: 'checkbox', label: 'Share' }
        ]
      }
    ];
    document.dispatchEvent(new CustomEvent('__ag_cm_req', { detail: JSON.stringify(req) }));
    document.removeEventListener('__ag_cm_res', onRes);
    return translated;
  });
  assert.equal(nativeRes[0].label, '自定义返回', 'user/i18n.override.json takes precedence over CM_SCOPED_DICT');
  assert.equal(nativeRes[1].label, '前进');
  assert.equal(nativeRes[2].label, '置顶整个项目');
  assert.equal(nativeRes[3].label, '打开（默认）');
  assert.equal(nativeRes[4].label, '移至项目');
  assert.equal(nativeRes[4].submenu[0].label, '新建项目...');
  assert.equal(nativeRes[4].submenu[1].label, 'Share', 'User-named group/project must not be translated');

  // 2. Right-click file pill shows flat Anthropic card with line anchor & external editors submenu
  const fileMenu = await page.evaluate(() => {
    const openEditorCalls = [];
    window.__agOpenInEditor = (p) => openEditorCalls.push(JSON.parse(p));
    const pill = document.getElementById('file-pill');
    pill.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 120 }));
    const card = document.getElementById('ag-custom-context-menu');
    const cs = getComputedStyle(card);
    const bg = cs.backgroundColor;
    const shadow = cs.boxShadow;
    const radius = cs.borderRadius;
    const items = [...card.querySelectorAll('.ag-ctx-item')].map((b) => b.textContent.trim());
    const header = card.querySelector('.ag-ctx-header')?.textContent.trim();
    const openInBtn = [...card.querySelectorAll('.ag-ctx-item')].find((b) => b.textContent.includes('打开方式'));
    openInBtn.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    const sub = document.getElementById('ag-custom-context-submenu');
    const subItems = [...sub.querySelectorAll('.ag-ctx-item')].map((b) => b.textContent.trim());
    sub.querySelector('.ag-ctx-item').click();
    return {
      header,
      items,
      subItems,
      openEditorCalls,
      closedAfterClick: !document.getElementById('ag-custom-context-menu'),
      bg,
      shadow,
      radius
    };
  });
  assert.equal(fileMenu.header, 'demo.ts · L12-20');
  assert.ok(fileMenu.items.some((s) => s.includes('打开方式')));
  assert.ok(fileMenu.items.some((s) => s.includes('复制路径')));
  assert.deepEqual(fileMenu.subItems, ['Cursor', 'VS Code']);
  assert.equal(fileMenu.openEditorCalls[0].id, 'cursor');
  assert.equal(fileMenu.openEditorCalls[0].line, 12);
  assert.equal(fileMenu.closedAfterClick, true);
  assert.equal(fileMenu.bg, 'rgb(250, 249, 245)', 'Light context card uses Anthropic Ivory Light #FAF9F5');
  assert.equal(fileMenu.shadow, 'none', 'Context card enforces zero box-shadow');
  assert.equal(fileMenu.radius, '10px');

  // 3. Right-click code block offers Copy Code Block; right-click image offers Copy Image & Save Image
  const codeAndImg = await page.evaluate(() => {
    const pre = document.getElementById('code-pre');
    pre.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 80, clientY: 80 }));
    const codeLabels = [...document.querySelectorAll('#ag-custom-context-menu .ag-ctx-item')].map((b) => b.textContent.trim());

    const img = document.getElementById('chat-img');
    img.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 80, clientY: 80 }));
    const imgLabels = [...document.querySelectorAll('#ag-custom-context-menu .ag-ctx-item')].map((b) => b.textContent.trim());

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    const closedOnEsc = !document.getElementById('ag-custom-context-menu');

    // Shift + right-click passes through without opening custom menu
    pre.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, shiftKey: true, clientX: 80, clientY: 80 }));
    const shiftSkipped = !document.getElementById('ag-custom-context-menu');

    // Sidebar passes through to native menu
    document.getElementById('sidebar-item').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
    const sidebarSkipped = !document.getElementById('ag-custom-context-menu');

    return { codeLabels, imgLabels, closedOnEsc, shiftSkipped, sidebarSkipped };
  });
  assert.ok(codeAndImg.codeLabels.some((s) => s.includes('复制代码块')));
  assert.ok(codeAndImg.imgLabels.some((s) => s.includes('复制图片')));
  assert.ok(codeAndImg.imgLabels.some((s) => s.includes('另存图片')));
  assert.equal(codeAndImg.closedOnEsc, true);
  assert.equal(codeAndImg.shiftSkipped, true);
  assert.equal(codeAndImg.sidebarSkipped, true);

  // 4. Dark mode context card uses Anthropic Slate Dark card surface (#1F1E1C) & zero shadow
  const darkCard = await page.evaluate(() => {
    document.documentElement.setAttribute('data-ag-theme-mode', 'dark');
    document.body.classList.add('dark');
    document.getElementById('composer-ta').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 60 }));
    const card = document.getElementById('ag-custom-context-menu');
    const cs = getComputedStyle(card);
    return { bg: cs.backgroundColor, shadow: cs.boxShadow, border: cs.borderTopColor };
  });
  assert.equal(darkCard.bg, 'rgb(31, 30, 28)', 'Dark context card uses #1F1E1C');
  assert.equal(darkCard.shadow, 'none');
  assert.equal(darkCard.border, 'rgb(61, 61, 58)', 'Dark context card uses #3D3D3A hairline border');
});
