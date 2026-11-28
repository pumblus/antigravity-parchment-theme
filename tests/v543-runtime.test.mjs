import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const runtime=fs.readFileSync(new URL('../core/runtime.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../core/theme.css',import.meta.url),'utf8');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',C='33333333-3333-4333-8333-333333333333';
let browser;
after(async()=>browser?.close());
const box=(width=760)=>`<div id="antigravity.agentSidePanelInputBox" style="width:${width}px"><div class="agy-composer-footer"><div class="left"><button data-testid="model-selector-trigger">Model</button></div><div><button data-testid="send-button">Send</button></div></div></div>`;
const pane=(name,id,width=760)=>`<section data-pane-id="${name}" data-testid="conversation-view" data-cascade-id="${id}">${box(width)}</section>`;
async function fixture(t,html,route='/c/'+A){
  const {chromium}=createRequire(import.meta.url)('playwright');browser ||= await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
  const page=await browser.newPage({viewport:{width:1800,height:1200}});t.after(()=>page.close());
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<html><head><style>.agy-composer-footer{display:flex;width:100%;align-items:center;justify-content:space-between}.left{display:flex;align-items:center;min-width:0}button{white-space:nowrap}section{margin-bottom:20px}</style></head><body>${html}</body></html>`}));
  await page.goto('http://fixture.invalid'+route);
  await page.evaluate(()=>{window.__APP_CONFIG__={productName:'antigravity'};window.requests=[];window.__agRequestMetrics=x=>window.requests.push(x);window.observers=new Set();const RO=ResizeObserver;window.ResizeObserver=class extends RO{observe(el){window.observers.add(this);super.observe(el);}disconnect(){window.observers.delete(this);super.disconnect();}};});
  const inject=(extra={})=>page.evaluate(runtime.replace('__AG_BOOT_PAYLOAD__',()=>JSON.stringify({version:'v543-test',platform:'darwin',cssText:css,modules:{metrics:true,deadlockHealer:false,coldBootHealer:false,zoomShortcuts:false},i18nDict:{Cancel:'取消',Running:'运行中'},...extra})));
  const render=(cascadeId,label,hasData=true)=>page.evaluate(payload=>window.__ag_render_metrics?.(payload),{cascadeId,hasData,inlineHtml:`${label} <span class="ag-sub-badge">Sub 2</span>`,tooltipHtml:`<div>${label} detail</div>`});
  const check=()=>page.evaluate(()=>window.__ag_check_route_fn?.());
  return {page,inject,render,check};
}
const pill='[data-ag-metrics-pill="1"]';
test('v543 runtime two panes receive separate payloads, one primary ID, own tooltips and preserved typography',async t=>{
 const {page,inject,render}=await fixture(t,pane('one',A)+pane('two',B),'/c/'+A+'+'+B+'?focused='+B);await inject();
 assert.deepEqual(await page.evaluate(()=>window.__ag_watched_cascade_ids),[A,B]);assert.equal(await render(A,'Alpha'),true);assert.equal(await render(B,'Beta'),true);
 assert.match(await page.locator('[data-pane-id="one"] '+pill).textContent(),/Alpha/);assert.match(await page.locator('[data-pane-id="two"] '+pill).textContent(),/Beta/);
 assert.equal(await page.locator('#ag-live-metrics-pill').count(),1);assert.equal(await page.locator('#ag-live-metrics-text').count(),1);
 assert.equal(await page.locator('#ag-live-metrics-pill').getAttribute('data-ag-cascade-id'),B);
 for(const [name,label] of [['one','Alpha'],['two','Beta']]){await page.locator(`[data-pane-id="${name}"] ${pill}`).hover();await page.waitForFunction(exp=>document.getElementById('ag-live-metrics-tooltip')?.getAttribute('data-visible')==='1'&&document.getElementById('ag-live-metrics-tooltip')?.textContent===exp,label+' detail');}
 const styles=await page.locator('[data-pane-id="one"] '+pill).evaluate(el=>({font:getComputedStyle(el).fontFamily,badge:getComputedStyle(el.querySelector('.ag-sub-badge')).color}));
 assert.match(styles.font,/Anthropic Sans/);assert.equal(styles.badge,'rgb(86, 85, 79)');
});
test('v543 runtime auxiliary pane scope supports btw/subagent but never borrows another pane or user data',async t=>{
 const aux=(name,id,kind)=>`<section data-pane-id="${name}"><div data-active-tab-id="${kind}__${id}"></div><div data-testid="side-question-tab-content"><div data-testid="${kind==='subagent_convo'?'subagent':'side-question'}-tab-conversation" data-cascade-id="${id}"></div>${box()}</div></section>`;
 const orphan=`<div data-testid="side-question-tab-content"><div class="prose" data-cascade-id="${B}">user data</div>${box()}</div>`;
 const {page,inject,render}=await fixture(t,pane('main',A)+aux('btw',B,'side_question')+aux('sub',C,'subagent_convo')+orphan);await inject();
 assert.deepEqual(await page.evaluate(()=>window.__ag_watched_cascade_ids),[A,B,C]);await render(A,'Main');await render(B,'Side');await render(C,'Agent');
 assert.match(await page.locator('[data-pane-id="btw"] '+pill).textContent(),/Side/);assert.match(await page.locator('[data-pane-id="sub"] '+pill).textContent(),/Agent/);
 assert.equal(await page.locator('body > [data-testid="side-question-tab-content"] '+pill).evaluate(el=>el.style.display),'none');
});
test('v543 runtime rejects stale route/pane payload and invalid aux strip identity, clears cache on departure',async t=>{
 const {page,inject,render,check}=await fixture(t,pane('one',A));await inject();await render(A,'Old');
 await page.evaluate(id=>history.pushState({},'', '/c/'+id),B);assert.equal(await render(A,'Late old'),false);assert.equal(await page.locator(pill).evaluate(el=>el.style.display),'none');
 await page.locator('[data-pane-id="one"]').evaluate((el,id)=>el.setAttribute('data-cascade-id',id),B);await check();assert.equal(await render(B,'New'),true);
 assert.equal(await page.evaluate(id=>Object.hasOwn(window.__ag_metrics_by_id,id),A),false);
 await page.evaluate(id=>history.pushState({},'', '/c/'+id),A);await page.locator('[data-pane-id="one"]').evaluate((el,id)=>el.setAttribute('data-cascade-id',id),A);await check();assert.equal(await page.locator(pill).evaluate(el=>el.style.display),'none');
});
test('v543 runtime aux tab switches wait for matching conversation and ignore hidden composers',async t=>{
 const html=`<section data-pane-id="aux"><div data-active-tab-id="side_question__${B}"></div><div data-testid="side-question-tab-content"><div data-testid="side-question-tab-conversation" data-cascade-id="${C}"></div>${box()}</div></section><section hidden>${pane('hidden',C)}</section>`;
 const {page,inject,check,render}=await fixture(t,pane('main',A)+html,'/c/'+A+'?tab=side_question__'+B);await inject();assert.deepEqual(await page.evaluate(()=>window.__ag_watched_cascade_ids),[A]);assert.equal(await render(C,'Wrong'),false);
 await page.locator('[data-testid="side-question-tab-conversation"]').evaluate((el,id)=>el.setAttribute('data-cascade-id',id),B);await check();assert.deepEqual(await page.evaluate(()=>window.__ag_watched_cascade_ids),[A,B]);assert.equal(await render(B,'Right'),true);
});
test('v543 runtime width growth/reduction reflows each pane independently without overflow',async t=>{
 const {page,inject,render}=await fixture(t,pane('wide',A,900)+pane('narrow',B,240),'/c/'+A+'+'+B);await inject();await render(A,'120 tok/s · Ctx 200k / 1M · Out 5000');await render(B,'90 tok/s · Ctx 100k / 1M · Out 9000');
 await page.waitForFunction(()=>document.querySelector('[data-pane-id="narrow"] [data-ag-metrics-pill]').getAttribute('data-ag-row-mode')==='bottom');
 assert.equal(await page.locator('[data-pane-id="wide"] '+pill).getAttribute('data-ag-row-mode'),'middle');
 await page.locator('[data-pane-id="narrow"] [id="antigravity.agentSidePanelInputBox"]').evaluate(el=>el.style.width='900px');
 await page.waitForFunction(()=>document.querySelector('[data-pane-id="narrow"] [data-ag-metrics-pill]').getAttribute('data-ag-row-mode')==='middle');
 await page.locator('[data-pane-id="wide"] [id="antigravity.agentSidePanelInputBox"]').evaluate(el=>el.style.width='220px');await page.waitForFunction(()=>document.querySelector('[data-pane-id="wide"] [data-ag-metrics-pill]').getAttribute('data-ag-row-mode')==='bottom');
 assert.equal(await page.locator('[data-pane-id="narrow"] '+pill).getAttribute('data-ag-row-mode'),'middle');
 const ok=await page.locator('[data-pane-id="wide"] '+pill).evaluate(el=>el.getBoundingClientRect().width<=el.parentElement.getBoundingClientRect().width+1);assert.equal(ok,true);
});
test('v543 runtime repeated same-version reinjection/disable cancels stale callbacks and observers',async t=>{
 const {page,inject,render,check}=await fixture(t,pane('one',A)+pane('two',B),'/c/'+A+'+'+B);await inject();await render(A,'A');await render(B,'B');
 await page.evaluate(()=>{window.oldRender=window.__ag_render_metrics;window.oldEnsure=window.__ag_ensure_metrics_pill_fn;});
 for(let i=0;i<3;i++){await inject();assert.equal(await page.locator(pill).count(),2);assert.equal(await page.evaluate(()=>window.observers.size),2);}
 assert.equal(await page.evaluate(id=>window.oldRender({cascadeId:id,hasData:true,inlineHtml:'stale'}),A),false);
 await page.locator('[data-pane-id="two"]').evaluate(el=>el.remove());await check();assert.equal(await page.evaluate(()=>window.observers.size),1);assert.equal(await page.locator(pill).count(),1);
 await page.evaluate(()=>{document.querySelector('[data-pane-id]').dispatchEvent(new Event('focusin',{bubbles:true}));});await inject({enabled:false});await page.evaluate(()=>window.oldEnsure(true));await page.waitForTimeout(500);
 assert.equal(await page.locator(pill).count(),0);assert.equal(await page.evaluate(()=>window.observers.size),0);assert.equal(await page.evaluate(()=>window.__ag_render_metrics),null);assert.equal(await page.evaluate(()=>window.requests.at(-1)),'[]');
});
test('v543 runtime cap12 keeps subscription signature aligned and hides thirteen-plus panes',async t=>{
 const ids=Array.from({length:13},(_,i)=>`${String(i+1).padStart(8,'0')}-1111-4111-8111-111111111111`);
 const {page,inject,render}=await fixture(t,ids.map((id,i)=>pane('p'+i,id)).join(''),'/c/'+ids.join('+'));await inject();
 assert.deepEqual(await page.evaluate(()=>window.__ag_watched_cascade_ids),ids.slice(0,12));assert.equal(await page.evaluate(()=>window.__ag_watched_cascade_sig),ids.slice(0,12).join(','));assert.equal(await render(ids[12],'Over budget'),false);assert.equal(await render(ids[11],'Within budget'),true);
 assert.equal(await page.locator('[data-pane-id="p12"] '+pill).evaluate(el=>el.style.display),'none');
});
test('v543 runtime new dynamic translations are literal and user history titles remain untouched',async t=>{
 const {page,inject}=await fixture(t,`<span id="effort">GPT-5.4 (Minimal)</span><span id="plan">Your Plan: Pro $&</span><span id="credits">Available AI Credits: 123</span><span id="exit">Exited with code -1.</span><span id="summary">Build · Exited with code 2</span><div data-testid="conversation-row-history"><span class="truncate">Running</span></div><div class="prose">Available AI Credits: 123</div>`,'/');await inject({modules:{metrics:false}});
 assert.equal(await page.locator('#effort').textContent(),'GPT-5.4 (最低)');assert.equal(await page.locator('#plan').textContent(),'当前套餐：Pro $&');assert.equal(await page.locator('#credits').textContent(),'可用 AI 点数：123');assert.equal(await page.locator('#exit').textContent(),'已退出，退出码 -1。');assert.equal(await page.locator('#summary').textContent(),'Build · 退出码 2');assert.equal(await page.locator('.truncate').textContent(),'Running');assert.equal(await page.locator('.prose').textContent(),'Available AI Credits: 123');
});
