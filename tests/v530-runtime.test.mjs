import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const runtime = fs.readFileSync(new URL('../core/runtime.js', import.meta.url), 'utf8');
function unit(swarm = false, dict = {}) {
  const ctx = vm.createContext({ IS_SWARM_PLUGIN_FRAME: swarm, DICT: Object.assign(Object.create(null), dict), PATCH_VERSION: 'v530-test', origTextMap: new WeakMap() });
  const lookup = runtime.slice(runtime.indexOf('  const RE_CURLY_APOS ='), runtime.indexOf('  let scanBodyFn'));
  const rules = runtime.slice(runtime.indexOf('    const RE_HAS_CJK ='), runtime.indexOf('    const walkerFilter ='));
  vm.runInContext(lookup + rules + '\nglobalThis.api={dictLookup,computeTextTranslation,resolveAttrTranslation};', ctx);
  return ctx.api;
}
test('v530 translations keep Swarm-only terminology scoped and user exact overrides first', () => {
  const main = unit(), swarm = unit(true);
  for (const [en, zh] of [['Coordinator','协调器'], ['Threads','任务组'], ['stale','待刷新'], ['(empty)','（空）']]) {
    assert.equal(main.dictLookup(en), undefined); assert.equal(swarm.dictLookup(en), zh);
  }
  assert.equal(unit(true, {Threads:'我的工作流'}).dictLookup('Threads'), '我的工作流');
  for (const [en, zh] of [['3 stuck','3 项受阻'], ['2 waiting on @alice','2 项等待 @alice'], ['Now · 2 / 7','当前 · 2 / 7'], ['paused: quota','已暂停：配额耗尽']]) {
    assert.equal(main.computeTextTranslation(en, null), null); assert.equal(swarm.computeTextTranslation(en, null), zh);
  }
  assert.equal(swarm.computeTextTranslation('2 of 7', null), null);
  assert.equal(swarm.computeTextTranslation('2 of 7', {closest: s => s === '.o2-progt'}), '2 / 7');
  assert.equal(swarm.computeTextTranslation('From alice', {tagName:'SPAN'}), null);
  assert.equal(swarm.computeTextTranslation('From alice', {tagName:'OPTION'}), '来自 alice');
  assert.equal(swarm.resolveAttrTranslation('Thinking: $& <original>'), '思考中：$& <original>');
  assert.equal(swarm.resolveAttrTranslation('Posted in #dev; click to show only #dev'), '发布于 #dev；点击仅看 #dev');
});
test('v530 dynamic labels preserve user names, URLs and replacement tokens literally', () => {
  const api = unit();
  for (const [en, zh] of [['2 images','2 张图片'], ['3 side questions','3 个支线提问'], ['Resume 2 comment drafts','恢复 2 条评论草稿'], ['View 4 side questions','查看 4 个支线提问'], ['Side Question: $& <task>','支线提问：$& <task>']]) assert.equal(api.computeTextTranslation(en,null),zh);
  assert.equal(api.resolveAttrTranslation('Opens external link: https://example.test/$&'), '打开外部链接：https://example.test/$&');
  assert.equal(api.resolveAttrTranslation('Edit side question title: $1'), '编辑支线提问标题：$1');
  assert.equal(api.computeTextTranslation('Connected to my-host', null), null);
  assert.equal(api.computeTextTranslation('Connected to my-host', {closest:s=>s.includes('ssh-machine-switcher-status')}), '已连接到 my-host');
});
async function fixture(t, html, pathname = '/') {
  const {chromium} = createRequire(import.meta.url)('playwright');
  const executablePath = process.env.CHROMIUM_PATH || (fs.existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
  const browser = await chromium.launch({executablePath,headless:true}); t.after(()=>browser.close());
  const page = await browser.newPage();
  await page.addInitScript(() => { window.__APP_CONFIG__ = { productName: 'antigravity' }; });
  await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:html}));
  await page.goto('http://fixture.invalid'+pathname);
  const inject = async (extra={}) => page.evaluate(runtime.replace('__AG_BOOT_PAYLOAD__',()=>JSON.stringify({version:'v530-test',cssText:'',platform:'darwin',modules:{metrics:false,deadlockHealer:false,zoomShortcuts:false},i18nDict:{'Copy code':'复制代码','Cancel':'取消','Threads':'自定义工作流'},...extra})));
  return {page,inject};
}
test('v530 runtime Markdown UI metadata translates without touching prose, code or custom exclusions', async t => {
  const {page,inject}=await fixture(t, `<div data-markdown-root class="prose"><p id="prose">2 images</p><button id="copy" title="Copy code" aria-label="Cancel">Copy code</button><span id="link" aria-label="Opens external link: https://example.test/$&">link</span><pre><button id="code" title="Copy code">Code</button></pre><div contenteditable="plaintext-only"><button id="edit" title="Copy code">Draft</button></div><div class="user-private"><button id="private" title="Copy code">Mine</button></div><div data-testid="user-message-content"><button id="user" title="Copy code">User</button></div></div>`);
  await inject({selectors:{excludeI18n:'.user-private'}});
  assert.equal(await page.locator('#copy').getAttribute('title'),'复制代码');
  assert.equal(await page.locator('#copy').getAttribute('aria-label'),'Cancel');
  assert.equal(await page.locator('#copy').textContent(),'Copy code');
  assert.equal(await page.locator('#prose').textContent(),'2 images');
  for(const id of ['code','edit','private','user']) assert.equal(await page.locator('#'+id).getAttribute('title'),'Copy code',id);
  await page.locator('[data-markdown-root]').evaluate(el=>{ const b=document.createElement('button');b.id='added';b.title='Copy code';el.appendChild(b); });
  await page.waitForFunction(()=>document.querySelector('#added').title==='复制代码');
  await page.locator('#copy').evaluate(el=>el.title='View 2 side questions');
  await page.waitForFunction(()=>document.querySelector('#copy').title==='查看 2 个支线提问');
  const key='Opens external link: https://example.test/$&';
  await inject({version:'override',selectors:{excludeI18n:'.user-private'},i18nDict:{[key]:'我的链接'}});
  assert.equal(await page.locator('#link').getAttribute('aria-label'),'我的链接');
  await inject({version:'remove',selectors:{excludeI18n:'.user-private'},i18nDict:{}});
  assert.equal(await page.locator('#link').getAttribute('aria-label'),'打开外部链接：https://example.test/$&');
  await inject({enabled:false});
  assert.equal(await page.locator('#link').getAttribute('aria-label'),key);
  assert.equal(await page.locator('#copy').getAttribute('title'),'View 2 side questions');
});
test('v530 runtime metrics accepts dynamic context/stream/subagent payload and isolates conversation switches', async t => {
  const id='11111111-1111-4111-8111-111111111111';
  const {page,inject}=await fixture(t, '<div id="antigravity.agentSidePanelInputBox"><div class="agy-composer-footer flex w-full items-center justify-between"><div><button data-testid="model-selector-trigger">Model</button></div><div><button data-testid="send-button">Send</button></div></div></div>', '/c/'+id);
  await inject({modules:{metrics:true,deadlockHealer:false,zoomShortcuts:false}});
  await page.evaluate(id=>window.__ag_render_metrics({hasData:true,cascadeId:id,inlineHtml:'Ctx 128k/1M <span class="ag-sub-badge">Sub 2</span>',tooltipHtml:'<div>Stream 80% · subagent 2</div>'}),id);
  assert.match(await page.locator('#ag-live-metrics-text').textContent(),/Ctx 128k\/1M.*Sub 2/);
  await page.locator('#ag-live-metrics-pill').hover();
  assert.match(await page.locator('#ag-live-metrics-tooltip').textContent(),/Stream 80%/);
  await page.evaluate(()=>window.__ag_render_metrics({hasData:true,cascadeId:'different',inlineHtml:'stale',tooltipHtml:'stale'}));
  assert.equal(await page.locator('#ag-live-metrics-pill').evaluate(el=>el.style.display),'inline-flex');
  assert.match(await page.locator('#ag-live-metrics-text').textContent(),/Ctx 128k\/1M.*Sub 2/);
  await page.evaluate(()=>{ window.__ag_metrics_raf=requestAnimationFrame(()=>window.__ag_ensure_metrics_pill_fn?.(true)); });
  await inject({enabled:false});
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#ag-live-metrics-pill').count(),0);
  assert.equal(await page.evaluate(()=>window.__ag_render_metrics),null);
});

for (const selector of ['[data-markdown-root]', '.prose', '.markdown', '.select-text']) {
  test(`v530 runtime Markdown metadata respects explicit user exclusion ${selector}`, async t => {
    const {page,inject}=await fixture(t, '<div data-markdown-root class="prose markdown select-text"><button id="copy" title="Copy code">Copy code</button></div>');
    await inject({selectors:{excludeI18n:selector}});
    assert.equal(await page.locator('#copy').getAttribute('title'),'Copy code');
    await page.locator('#copy').evaluate(el=>el.title='View 2 side questions');
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#copy').getAttribute('title'),'View 2 side questions');
  });
}

test('v530 runtime default configuration translates Markdown UI metadata but preserves prose', async t => {
  const {page,inject}=await fixture(t, '<div data-markdown-root class="prose"><p id="prose">2 images</p><button id="copy" title="Copy code">Copy code</button><pre><button id="code" title="Copy code">Copy code</button></pre></div>');
  await inject();
  assert.equal(await page.locator('#copy').getAttribute('title'),'复制代码');
  assert.equal(await page.locator('#copy').textContent(),'Copy code');
  assert.equal(await page.locator('#prose').textContent(),'2 images');
  assert.equal(await page.locator('#code').getAttribute('title'),'Copy code');
});
test('translation review Swarm group/status terms stay frame-scoped and retain overrides', () => {
 const main=unit(),swarm=unit(true);
 for(const [en,zh] of [['Threads','任务组'],['Stuck','受阻'],['Retired','已终止']]){assert.equal(swarm.dictLookup(en),zh);assert.equal(main.dictLookup(en),undefined);}
 for(const [en,zh] of [['3 threads open','3 个任务组未完成'],['Waiting on 3','等待 3 方响应'],['Waiting on @alice','等待 @alice']]){assert.equal(swarm.computeTextTranslation(en,null),zh);assert.equal(main.computeTextTranslation(en,null),null);}
 assert.equal(unit(true,{Threads:'我的术语'}).dictLookup('Threads'),'我的术语');
});
