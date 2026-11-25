import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
let chromium;
const root = fileURLToPath(new URL('../', import.meta.url));
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const dict = JSON.parse(read('core/i18n.json'));
const runtime = read('core/runtime.js');
let browser;
after(async () => { await browser?.close(); });
function payload(overrides = {}) {
  return { version: 'integration-test', cssText: read('core/theme.css'), i18nDict: dict,
    modules: { metrics: false, deadlockHealer: false, zoomShortcuts: false }, ...overrides };
}
async function inject(page, boot = payload()) {
  await page.evaluate(runtime.replace('__AG_BOOT_PAYLOAD__', JSON.stringify(boot)));
}
async function fixture(t, html) {
  chromium ||= createRequire(import.meta.url)('playwright').chromium;
  browser ||= await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless: true });
  const page = await browser.newPage();
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.addInitScript(() => { window.__APP_CONFIG__ = { productName: 'antigravity' }; });
  await page.goto('http://fixture.invalid/');
  t.after(() => page.close());
  return page;
}
test('core manifest matches every shipped byte', () => {
  const manifest = JSON.parse(read('core/manifest.json'));
  assert.equal(manifest.version, '5.5.5-eric.1');
  for (const [name, meta] of Object.entries(manifest.files)) {
    const bytes = fs.readFileSync(path.join(root, 'core', name));
    assert.equal(bytes.length, meta.bytes, name);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), meta.sha256, name);
  }
});
test('dictionary keeps upstream coverage and clear permission labels without case duplicates', () => {
  assert.equal(Object.keys(dict).length, 1958);
  const keys = [...read('core/i18n.json').matchAll(/^  ("(?:[^"\\]|\\.)*"):/gm)].map(m => JSON.parse(m[1]));
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(new Set(keys.map(k => k.toLowerCase().replace(/[‘’]/g, "'"))).size, keys.length);
  assert.equal(dict.Turbo, '完全模式（Turbo）');
  assert.equal(dict['Turbo mode'], dict.Turbo);
  assert.equal(dict.Thinking, '正在思考');
  assert.equal(Object.hasOwn(dict, 'New'), false, 'New must reach contextual translation');
  assert.equal(dict['Good Response'], '回答不错');
  assert.equal(dict['Running command >'], '正在执行命令 >');
  assert.equal(dict['Mark Unread'], '标记为未读');
  assert.equal(dict['Cancel (⌃C)'], '取消生成 (⌃C)');
  assert.equal(dict['Enable Sandbox Mode'], '启用沙盒模式');
  const warning = dict[Object.keys(dict).find(key => key.startsWith('Allow the agent to automatically view'))];
  assert.match(warning, /提示注入/); assert.match(warning, /凭证文件、密钥/);
});
test('no automatic external title-patch execution or destructive sync-user switch', () => {
  assert.doesNotMatch(read('core/daemon.mjs'), /ensureZhTitlePatch|antigravity-zh-title-patch\.py|execFile\(/);
  assert.doesNotMatch(read('install.mjs'), /hasFlag\(['"]--sync-user/);
});
// Exercise the real translation functions without substituting for browser DOM tests.
function translationUnit(dictionary = dict, version = 'unit-1', originalMap = new WeakMap()) {
  const lookupStart = runtime.indexOf('  const RE_CURLY_APOS =');
  const lookupEnd = runtime.indexOf('  let scanBodyFn', lookupStart);
  const start = runtime.indexOf('    const RE_HAS_CJK =');
  const end = runtime.indexOf('    const walkerFilter =', start);
  assert.ok(lookupStart > 0 && lookupEnd > lookupStart && start > 0 && end > start);
  const ctx = vm.createContext({ IS_SWARM_PLUGIN_FRAME: false, DICT: Object.assign(Object.create(null), dictionary), PATCH_VERSION: version, origTextMap: originalMap });
  vm.runInContext(runtime.slice(lookupStart, lookupEnd) + runtime.slice(start, end) + '\nglobalThis.api = { dictLookup, computeTextTranslation, translateTextNode, translateSingleAttr, resolveAttrTranslation };', ctx);
  return ctx;
}
test('translation units resolve exact, dynamic and permission labels safely', () => {
  const ctx = translationUnit(); const tr = ctx.api.computeTextTranslation;
  for (const [input, expected] of [['Turbo', '完全模式（Turbo）'], ['Thinking', '正在思考'],
    ['Running command >', '正在执行命令 >'], ['Thought for 8s', '已思考 8 秒'],
    ['Worked for 2m 3s', '已工作 2 分钟 3 秒'], ['12 files changed', '12 个文件变更'],
    ['unknown text', null], ['中文原文', null], ['__proto__', null]]) assert.equal(tr(input, null), expected, input);
  assert.equal(ctx.api.resolveAttrTranslation('Permission mode selector, current: Turbo'), '权限模式，当前：完全模式（Turbo）');
  assert.match(ctx.api.resolveAttrTranslation('Permission mode: Turbo (Cannot be changed mid-conversation)'), /完全模式.*对话中途无法更改/);
  ctx.DICT.literal = '$& $1 中文'; assert.equal(tr(' literal ', null), '$& $1 中文');
});
test('translation units preserve Turbo risk semantics and support 2.32.0 templates', () => {
  const { api } = translationUnit();
  for (const [input, expected] of [
    ['Local Checkout', '本地'],
    ['2 MCP servers failed to start', '2 个 MCP 服务器启动失败'],
    ['Uses your local clone, example', '使用本地克隆：example'],
    ['Hey Eric, what should we build today?', '嗨，Eric，今天想做点什么？'],
    ['Work locally on main', '在本地 main 中工作'],
    ['Turbo mode', '完全模式（Turbo）'],
  ]) assert.equal(api.computeTextTranslation(input, null), expected, input);
  assert.match(api.resolveAttrTranslation('Agent permissions preset: Auto (Preview), Automatically decide if commands run.'), /自动.*预览.*自动判断/);
  assert.match(api.resolveAttrTranslation('Agent permissions preset: Turbo, Run all commands without restrictions.'), /完全模式.*不受限制/);
  assert.doesNotMatch(api.resolveAttrTranslation('Agent permissions preset: Turbo, Run all commands without restrictions.'), /极速/);
  const custom = translationUnit({ "What's next?": '默认译文', 'Good Response': '原始反馈', 'Good response': '精确覆盖' });
  assert.equal(custom.api.dictLookup('What’s next?'), '默认译文');
  assert.equal(custom.api.dictLookup('Good response'), '精确覆盖');
  const curlyOverride = translationUnit({ 'What’s next?': '自定义弯引号' });
  assert.equal(curlyOverride.api.dictLookup("What's next?"), '自定义弯引号');
});
test('translation units support 2.31.2 New context, orchestrators and extra effort', () => {
  const { api } = translationUnit();
  const actionButton = { textContent: '+ New', hasAttribute: () => false };
  const action = { closest: selector => selector === 'button' ? actionButton : null };
  const modelButton = { textContent: 'New', hasAttribute: name => name === 'data-model-label' };
  const badge = { closest: selector => selector === 'button' ? modelButton : null };
  assert.equal(api.computeTextTranslation('New', action), '新建');
  assert.equal(api.computeTextTranslation('NEW', { closest: () => null }), '新');
  assert.equal(api.computeTextTranslation('New', badge), '新');
  assert.equal(api.computeTextTranslation('new', null), null, 'lowercase identifiers are untouched');
  assert.equal(api.computeTextTranslation('Orchestrator (Neon)', null), '编排器 (Neon)');
  assert.equal(api.computeTextTranslation('Extra High', null), '超高');
  assert.equal(api.resolveAttrTranslation('Model selector, current: Gemini 4 Hydrogen Extra High'), '模型，当前：Gemini 4 Hydrogen · 超高');
  assert.equal(api.resolveAttrTranslation('Model selector, current: Orchestrator (Carbon) (Extra High)'), '模型，当前：编排器 (Carbon) (超高)');
  assert.equal(api.computeTextTranslation('12 comments', null), '12 条评论');
  assert.equal(api.computeTextTranslation('Gemini 4 Neon Monthly Limit', null), 'Gemini 4 Neon 每月限额');
  assert.equal(api.computeTextTranslation('Budget Monthly Limit', null), null, 'ordinary phrases are not model limits');
});
test('translation units preserve 2.31.1 case fallback and exact-match priority', () => {
  const ctx = translationUnit({ ...dict, 'Mixed Label': '标准', 'Mixed label': '精确自定义' });
  assert.equal(ctx.api.dictLookup('Mixed label'), '精确自定义');
  assert.equal(ctx.api.dictLookup('MIXED LABEL'), '标准');
  assert.equal(ctx.api.dictLookup('mixed LABEL'), undefined);
  assert.equal(ctx.api.dictLookup('Mcp Tools'), 'MCP 工具');
  assert.equal(ctx.api.dictLookup('Good response'), '回答不错');
  assert.equal(ctx.api.computeTextTranslation('Mcp Tools.', null), 'MCP 工具。');
});
test('translation units support 2.31.1 turn-navigation and exhausted-history labels', () => {
  const { api } = translationUnit();
  for (const [input, expected] of [
    ['Go to turn 2 of 7', '跳转至第 2 / 7 轮对话'],
    ['Load older messages, showing 10 of 20', '加载更早的消息（当前显示 10 / 20）'],
    ['No more older messages, showing 20 of 20', '没有更早的消息（当前显示 20 / 20）'],
    ['Load 5 older turns', '加载更早的 5 轮对话']
  ]) assert.equal(api.resolveAttrTranslation(input), expected, input);
});
test('translation units restore originals after override removal and preserve React updates', () => {
  const originalMap = new WeakMap(); const node = { nodeValue: 'Turbo', parentElement: null };
  translationUnit(dict, 'first', originalMap).api.translateTextNode(node);
  assert.equal(node.nodeValue, '完全模式（Turbo）');
  translationUnit({ ...dict, Turbo: '自定义权限' }, 'second', originalMap).api.translateTextNode(node);
  assert.equal(node.nodeValue, '自定义权限');
  const removed = { ...dict }; delete removed.Turbo;
  const ctx = translationUnit(removed, 'third', originalMap);
  ctx.api.translateTextNode(node); assert.equal(node.nodeValue, 'Turbo');
  node.nodeValue = 'Thinking'; ctx.api.translateTextNode(node); assert.equal(node.nodeValue, '正在思考');
  node.nodeValue = 'React supplied a new value'; ctx.api.translateTextNode(node);
  assert.equal(node.nodeValue, 'React supplied a new value');
});
test('translation units preserve Cancel aria-label and restore attributes', () => {
  const ctx = translationUnit(); const attrs = new Map([['aria-label', 'Cancel'], ['title', 'Turbo']]);
  const el = { getAttribute: key => attrs.has(key) ? attrs.get(key) : null, hasAttribute: key => attrs.has(key),
    setAttribute: (key, val) => attrs.set(key, val), removeAttribute: key => attrs.delete(key) };
  ctx.api.translateSingleAttr(el, 'aria-label', 'data-ag-orig-aria-label', ctx.api.resolveAttrTranslation);
  assert.equal(attrs.get('aria-label'), 'Cancel');
  ctx.api.translateSingleAttr(el, 'title', 'data-ag-orig-title', ctx.api.resolveAttrTranslation);
  assert.equal(attrs.get('title'), '完全模式（Turbo）');
  const removed = { ...dict }; delete removed.Turbo; const next = translationUnit(removed, 'unit-2');
  next.api.translateSingleAttr(el, 'title', 'data-ag-orig-title', next.api.resolveAttrTranslation);
  assert.equal(attrs.get('title'), 'Turbo'); assert.equal(attrs.has('data-ag-orig-title'), false);
});
test('runtime translates UI while isolating user content', async t => {
  const page = await fixture(t, `<button id="turbo" aria-label="Permission mode selector, current: Turbo">Turbo</button>
    <button id="run" title="Running command >">Running command &gt;</button><button id="thought">Thought for 8s</button>
    <button id="thinking">Thinking</button><button id="case">Good response</button>
    <pre id="pre">Turbo</pre><code id="code">Thinking</code><div data-markdown-root id="prose">Running command &gt;</div>
    <div class="monaco-editor" id="monaco">Turbo</div><div class="xterm" id="terminal">Thinking</div>
    <div contenteditable="true" id="composer">Turbo</div><input id="input" value="Turbo" placeholder="Thinking"><span id="new"></span>`);
  await inject(page);
  await page.waitForFunction(() => document.querySelector('#turbo').textContent === '完全模式（Turbo）');
  assert.match(await page.locator('#turbo').getAttribute('aria-label'), /完全模式/);
  assert.equal(await page.locator('#run').textContent(), '正在执行命令 >');
  assert.equal(await page.locator('#run').getAttribute('title'), '正在执行命令 >');
  assert.equal(await page.locator('#thought').textContent(), '已思考 8 秒');
  assert.equal(await page.locator('#thinking').textContent(), '正在思考');
  assert.equal(await page.locator('#case').textContent(), '回答不错');
  for (const [id, val] of Object.entries({ pre: 'Turbo', code: 'Thinking', prose: 'Running command >', monaco: 'Turbo', terminal: 'Thinking', composer: 'Turbo' })) assert.equal(await page.locator('#' + id).textContent(), val, id);
  assert.equal(await page.locator('#input').inputValue(), 'Turbo');
  assert.equal(await page.locator('#input').getAttribute('placeholder'), '正在思考');
  await page.locator('#new').evaluate(el => el.textContent = 'Mark Unread');
  await page.waitForFunction(() => document.querySelector('#new').textContent === '标记为未读');
});
test('runtime 2.31.2 attributes and New labels preserve editable and user content', async t => {
  const page = await fixture(t, `<button class="rounded-full" id="new-action">New</button>
    <button data-model-label id="new-model">New</button><span id="new-badge">New</span>
    <div contenteditable="true" data-lexical-editor="true" id="lexical" aria-label="Thinking">Thinking</div>
    <button data-testid="conversation-navigator-turn" id="turn" aria-label="Go to turn 2 of 8"></button>
    <div class="msg-body" id="swarm-message">Thinking</div><pre id="raw">New</pre>
    <div data-testid="swarm-raw" id="swarm-raw">Thinking</div><h2 id="swarm-title">Thinking</h2>`);
  await inject(page);
  await page.waitForFunction(() => document.querySelector('#new-action').textContent === '新建');
  for (const id of ['new-model', 'new-badge']) assert.equal(await page.locator('#' + id).textContent(), '新');
  assert.equal(await page.locator('#lexical').textContent(), 'Thinking');
  assert.equal(await page.locator('#lexical').getAttribute('aria-label'), '正在思考');
  assert.equal(await page.locator('#turn').getAttribute('aria-label'), '跳转至第 2 / 8 轮对话');
  for (const id of ['swarm-message', 'swarm-raw', 'swarm-title']) assert.equal(await page.locator('#' + id).textContent(), 'Thinking');
  assert.equal(await page.locator('#raw').textContent(), 'New');
});
test('runtime hot reload is repeatable and disabling restores UI with cleanup', async t => {
  const page = await fixture(t, '<button id="label" title="Turbo">Turbo</button>');
  const customJs = 'window.testRuns = (window.testRuns || 0) + 1; ctx.onCleanup(() => { window.testCleanups = (window.testCleanups || 0) + 1; });';
  await inject(page, payload({ customJs }));
  await inject(page, payload({ customJs, version: 'second', i18nDict: { ...dict, Turbo: '测试权限模式' } }));
  await page.waitForFunction(() => document.querySelector('#label').textContent === '测试权限模式');
  assert.equal(await page.locator('#ag-custom-fonts').count(), 1);
  assert.deepEqual(await page.evaluate(() => [window.testRuns, window.testCleanups]), [2, 1]);
  await inject(page, payload({ enabled: false }));
  assert.equal(await page.locator('#label').textContent(), 'Turbo');
  assert.equal(await page.locator('#label').getAttribute('title'), 'Turbo');
  assert.equal(await page.locator('#ag-custom-fonts').count(), 0);
  assert.equal(await page.evaluate(() => window.testCleanups), 2);
  await inject(page); await page.waitForFunction(() => document.querySelector('#label').textContent === '完全模式（Turbo）');
});
// Real file-copy logic in a VM; all service/CDP/subprocess/app operations are stubbed.
function isolatedInstaller(sourceDir, targetDir, home, extraArgs = []) {
  let code = fs.readFileSync(path.join(sourceDir, 'install.mjs'), 'utf8');
  code = code.replace(/^import .*;\r?\n/gm, '').replace('const __filename = fileURLToPath(import.meta.url);', `const __filename = ${JSON.stringify(path.join(sourceDir, 'install.mjs'))};`);
  code = code.slice(0, code.indexOf('switch (subcommand) {'));
  code += '\ndetectEnvironment = async () => ({nodeBasicOk:true}); inspectLiveWindow = async () => ({reachable:false}); registerSystemService = () => ({stubbed:true}); globalThis.run = runInstall;';
  const deny = () => { throw new Error('Unexpected OS subprocess'); };
  const ctx = vm.createContext({ fs, path, crypto, os: { ...os, homedir: () => home }, fileURLToPath, pathToFileURL, http: {},
    execSync: deny, spawn: deny, spawnSync: () => ({status:0}),
    process: { argv: ['node', 'install.mjs', 'install', '--target-dir', targetDir, ...extraArgs], execPath: process.execPath, platform: process.platform, versions: process.versions, env: {}, exit: deny, emitWarning() {} }, console: { log() {}, error() {} } });
  vm.runInContext(code, ctx); return ctx.run();
}
test('installer preserves user bytes/selectors and stable backups across upgrades', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'theme-install-test-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const source = path.join(temp, 'source'), target = path.join(temp, 'installed'), home = path.join(temp, 'home');
  fs.mkdirSync(source); fs.mkdirSync(home);
  for (const name of ['core', 'user', 'install.mjs', 'README.md', 'SKILL.md', 'FORK.md', 'CHANGELOG.md']) fs.cpSync(path.join(root, name), path.join(source, name), { recursive: true });
  fs.mkdirSync(path.join(target, 'user'), { recursive: true });
  const files = { 'config.json': '{"enabled":false,"channel":"stable","preset":"vintage-deep","selectors":{"inputBoxId":"antigravity.agentSidePanelInputBox","custom":"#mine"},"privateSetting":true}\n',
    'custom.css': '/* user style */\n', 'custom.js': '// user hook\n', 'i18n.override.json': '{"Turbo":"我的权限模式"}\n', 'extra.txt': 'keep me\n' };
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(target, 'user', name), text);
  const checkFiles = () => { for (const [name, text] of Object.entries(files)) assert.equal(fs.readFileSync(path.join(target, 'user', name), 'utf8'), text, name); };
  await isolatedInstaller(source, target, home); checkFiles();
  const oldCss = fs.readFileSync(path.join(target, 'core/theme.css'), 'utf8');
  fs.appendFileSync(path.join(source, 'core/theme.css'), '\n/* test update */\n');
  await isolatedInstaller(source, target, home);
  const backups = fs.readdirSync(path.join(target, 'backups')); assert.equal(backups.length, 1);
  assert.equal(fs.readFileSync(path.join(target, 'core.prev/theme.css'), 'utf8'), oldCss);
  await isolatedInstaller(source, target, home); checkFiles();
  assert.deepEqual(fs.readdirSync(path.join(target, 'backups')), backups);
  assert.equal(fs.readFileSync(path.join(target, 'core.prev/theme.css'), 'utf8'), oldCss);
  await isolatedInstaller(source, target, home, ['--channel', 'insiders']);
  const config = JSON.parse(fs.readFileSync(path.join(target, 'user/config.json')));
  assert.equal(config.channel, 'insiders'); assert.equal(config.enabled, false);
  assert.equal(config.selectors.custom, '#mine'); assert.equal(config.privateSetting, true);
});
test('translation review audits all 32 divergent and 16 supplemental entries', () => {
 const review=JSON.parse(read('translation-review.json'));
 assert.equal(review.sameKeyDifferences,32);assert.equal(review.additionalKeys,16);assert.equal(review.entries.length,48);
 for(const item of review.entries)assert.equal(dict[item.key],item.chosen,item.key);
 assert.equal(Object.keys(dict).length,1958);
 for(const key of ['Notice','Display'])assert.equal(dict[key],key==='Notice'?'提示':'显示');
 assert.equal(dict['At mention code block'],'引用代码块（@）');
 assert.equal(dict['Agent response'],'Agent 回复');
 assert.equal(Object.values(dict).some(v=>v.includes('智能体')),false);
 const warning=dict[Object.keys(dict).find(k=>k.startsWith('Allow the agent to automatically view'))];
 for(const token of ['查看和编辑','凭证文件','密钥','提示注入','其他漏洞利用','攻击的目标'])assert.ok(warning.includes(token),token);
});
test('translation review permission presets agree across static and dynamic accessibility labels', () => {
 const {api}=translationUnit();
 for(const mode of ['Turbo','Auto','Strict','Auto (Preview)']){
  const expected='权限模式，当前：'+dict[mode];
  assert.equal(api.resolveAttrTranslation('Agent permissions preset selector, current: '+mode),expected);
  assert.equal(api.resolveAttrTranslation('Permission mode selector, current: '+mode),expected);
 }
 const exact='Agent permissions preset selector, current: Auto';
 assert.equal(translationUnit({...dict,[exact]:'私人标签'}).api.resolveAttrTranslation(exact),'私人标签');
 assert.equal(api.computeTextTranslation('Every command requires approval.',null),'每条命令都需您批准。');
 assert.equal(api.computeTextTranslation('Ask before sensitive operations.',null),'执行敏感操作前先征求您的确认。');
 assert.equal(api.computeTextTranslation('Run all commands without restrictions.',null),'不受限制地执行所有命令。');
});
test('translation review distinguishes active elapsed states and queue timing', () => {
 const {api}=translationUnit();
 for(const [en,zh] of [['Thought for 8s','已思考 8 秒'],['Thinking for 8s','思考中，已用时 8 秒'],['Thinking for <1s','思考中，已用时 不到 1 秒'],['Thought for <1m','已思考 不到 1 分钟'],['Worked for 2m 3s','已工作 2 分钟 3 秒'],['Worked for 2m · 3 updates','已工作 2 分钟 · 3 条进展'],['Running for 1h 2m','运行中，已用时 1 小时 2 分钟'],['⌘Enter Queues after the turn','⌘Enter 加入队列，本轮结束后发送']])assert.equal(api.computeTextTranslation(en,null),zh,en);
});
test('translation review preserves privacy, billing and review distinctions', () => {
 const review=JSON.parse(read('translation-review.json'));for(const item of review.sharedCorrections)assert.equal(dict[item.key],item.chosen,item.key);
 assert.equal(dict['Telemetry will be enabled for this conversation; click to disable.'],'此对话将启用遥测上报；点击可关闭。');
 assert.equal(dict['Enable AI Credit Overages'],'启用 AI 点数超额使用');
 assert.equal(dict['Allow full browser script execution without prompting.'],'允许执行所有浏览器脚本，不请求确认。');
 const strict=dict[Object.keys(dict).find(k=>k.startsWith('Enforce settings that prevent'))];for(const word of ['定向漏洞利用','所有 Agent 操作','人工审阅','antigravity.google/docs/strict-mode'])assert.ok(strict.includes(word),word);
 assert.equal(dict['Plan Review Policy'],'计划审阅策略');
});
