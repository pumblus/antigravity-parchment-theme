import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const runtime = fs.readFileSync(new URL('../core/runtime.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../core/theme.css', import.meta.url), 'utf8');
const gate = runtime.slice(0, runtime.indexOf('  const PATCH_VERSION')) + 'window.accepted=boot.version; })(__AG_BOOT_PAYLOAD__);';
function gateFixture({ href='http://localhost:3000/', child=false, loading=false, html=true, marker=false, preload=false }={}) {
  const listeners = new Map(), observers=[];
  const document={documentElement:html?{}:null,readyState:loading?'loading':'complete',querySelector:()=>marker?{}:null};
  const window={location:new URL(href),addEventListener:(event,fn)=>listeners.set(event,fn),removeEventListener:(event,fn)=>{if(listeners.get(event)===fn)listeners.delete(event);}};
  window.top=child?{}:window;
  if(preload)window.__APP_CONFIG__={productName:'antigravity'};
  class Observer {constructor(fn){this.fn=fn;observers.push(this);}observe(){}disconnect(){this.closed=true;}}
  const ctx=vm.createContext({window,document,MutationObserver:Observer});
  return {window,document,observers,listeners,inject:version=>vm.runInContext(gate.replace('__AG_BOOT_PAYLOAD__',JSON.stringify({version})),ctx),mark:()=>{marker=true;},dcl:()=>{document.readyState='complete';listeners.get('DOMContentLoaded')?.();}};
}
test('v542 runtime gate excludes localhost preview and arbitrary child frames without touching content',()=>{
  for(const opts of [{},{href:'http://127.0.0.1:5173/preview'},{href:'http://localhost:3000/',child:true,preload:true},{href:'plugin://other/index',child:true}]){
    const f=gateFixture(opts);f.inject('test');assert.equal(f.window.accepted,undefined);
  }
  for(const opts of [{preload:true},{marker:true},{href:'vscode-file://vscode-app/index.html'},{href:'plugin://swarm--official/index',child:true}]){
    const f=gateFixture(opts);f.inject('host');assert.equal(f.window.accepted,'host');
  }
});
test('v542 runtime gate handles preload bridge variants and never treats generic theme classes as host',()=>{
  for(const electronNative of [{setTitleBarOverlay(){}},{getZoomLevel(){},wcvBrowser:{setThemeColor(){}}}]){
    const f=gateFixture();f.window.electronNative=electronNative;
    if(electronNative.setTitleBarOverlay)f.window.nativeStorage={getItems(){}};
    f.inject('bridge');assert.equal(f.window.accepted,'bridge');
  }
  const f=gateFixture();f.window.__APP_CONFIG__={productName:'other'};f.inject('no');assert.equal(f.window.accepted,undefined);
});
test('v542 runtime pending document uses latest payload only and waits for genuine fingerprint',()=>{
  const f=gateFixture({loading:true});f.inject('old');f.inject('latest');assert.equal(f.listeners.size,1);
  f.mark();f.dcl();assert.equal(f.window.accepted,'latest');
  const n=gateFixture({loading:true});n.inject('preview');n.dcl();assert.equal(n.window.accepted,undefined);assert.equal(n.window.__ag_skip_non_host,true);
  n.mark();n.inject('later-host');assert.equal(n.window.accepted,'later-host');assert.equal(n.window.__ag_skip_non_host,undefined);
});
test('v542 runtime preload before html observes creation and cancels stale observer',()=>{
  const f=gateFixture({loading:true,html:false,preload:true});f.inject('old');f.inject('latest');assert.equal(f.observers[0].closed,true);
  f.document.documentElement={};f.observers.at(-1).fn();assert.equal(f.window.accepted,'latest');assert.equal(f.observers.at(-1).closed,true);
});
async function fixture(t,{swarm=false,colorScheme='light',html='<html><head></head><body><button id="label">Cancel</button></body></html>',host=true}={}){
  const {chromium}=createRequire(import.meta.url)('playwright');
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || (fs.existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined),headless:true});
  t.after(()=>browser.close());const context=await browser.newContext({colorScheme});const page=await context.newPage();
  await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:html}));await page.goto('http://fixture.invalid/');
  if(host)await page.evaluate(()=>{window.__APP_CONFIG__={productName:'antigravity'};});
  // Chromium cannot navigate plugin://. Exercise full runtime with a synthetic Swarm
  // identity; actual protocol/top-frame admission is independently tested above.
  const source=swarm?runtime.replace(/const IS_SWARM_PLUGIN_FRAME = !!\([\s\S]*?\n  \);/,'const IS_SWARM_PLUGIN_FRAME = true;'):runtime;
  const inject=async(extra={})=>page.evaluate(source.replace('__AG_BOOT_PAYLOAD__',()=>JSON.stringify({version:'v542-test',cssText:css,platform:'darwin',modules:{metrics:false,deadlockHealer:false,zoomShortcuts:false},i18nDict:{Cancel:'取消'},...extra})));
  return {page,context,inject};
}
test('v542 runtime real DOM preview preserves text, attributes and CSS; host boots and publishes changes',async t=>{
  const {page,inject}=await fixture(t,{host:false});const before=await page.locator('html').innerHTML();await inject();
  assert.equal(await page.locator('html').innerHTML(),before);assert.equal(await page.locator('#ag-custom-fonts').count(),0);
  await page.evaluate(()=>{window.__APP_CONFIG__={productName:'antigravity'};window.modes=[];window.__agSyncHostThemeMode=mode=>window.modes.push(mode);});
  assert.equal(await inject(),'light');assert.equal(await page.locator('#label').textContent(),'取消');
  await page.evaluate(()=>document.body.classList.add('dark'));await page.waitForFunction(()=>window.__ag_resolved_theme_mode==='dark');
  await page.evaluate(()=>document.body.classList.remove('dark'));await page.waitForFunction(()=>window.__ag_resolved_theme_mode==='light');
  assert.deepEqual(await page.evaluate(()=>window.modes),['light','dark','light']);
});
test('v542 runtime Swarm relay overrides stale inline background both ways and preserves Eric palette',async t=>{
  const {page,inject}=await fixture(t,{swarm:true,html:'<html data-theme="light" style="--background: #000000; --error: #FFFFFF; color-scheme: light"><head></head><body><button>Cancel</button></body></html>'});
  await inject({hostThemeMode:'light',preset:'claude-desktop-purewhite'});
  const state=()=>page.evaluate(()=>({mode:document.documentElement.getAttribute('data-ag-theme-mode'),bg:getComputedStyle(document.body).getPropertyValue('--background').trim(),error:getComputedStyle(document.body).getPropertyValue('--error').trim(),scheme:document.documentElement.style.colorScheme}));
  assert.deepEqual(await state(),{mode:'light',bg:'#FAF9F5',error:'#B84239',scheme:'light'});
  await page.evaluate(()=>window.__ag_set_host_theme_mode('dark'));
  assert.equal((await state()).bg,'#141413');assert.equal((await state()).mode,'dark');assert.equal((await state()).error,'#D96055');
  await page.evaluate(()=>{document.documentElement.style.setProperty('--background','#000000');window.__ag_set_host_theme_mode('light');});
  assert.equal((await state()).bg,'#FAF9F5');assert.equal((await state()).mode,'light');
  await inject({hostThemeMode:'dark',version:'hot'});assert.equal((await state()).mode,'light','live owning-host mode survives reinjection');
  await inject({enabled:false});assert.equal(await page.locator('html').getAttribute('data-theme'),'light');assert.equal(await page.locator('html').evaluate(el=>el.style.colorScheme),'light');
  assert.equal(await page.evaluate(()=>window.__ag_set_host_theme_mode),null);
});
test('v542 runtime Swarm system fallback changes repeatedly and clears stale relay without self-latching',async t=>{
  const {page,context,inject}=await fixture(t,{swarm:true,colorScheme:'dark',html:'<html data-theme="light"><body></body></html>'});await inject({hostThemeMode:'inherit'});
  const mode=()=>page.locator('html').getAttribute('data-ag-theme-mode');assert.equal(await mode(),'dark');
  await context.setDefaultTimeout(5000);await page.emulateMedia({colorScheme:'light'});await page.waitForFunction(()=>window.__ag_resolved_theme_mode==='light');
  await page.evaluate(()=>window.__ag_set_host_theme_mode('dark'));assert.equal(await mode(),'dark');
  await page.evaluate(()=>window.__ag_set_host_theme_mode(null));assert.equal(await mode(),'light');
  await page.emulateMedia({colorScheme:'dark'});await page.waitForFunction(()=>window.__ag_resolved_theme_mode==='dark');
  await page.emulateMedia({colorScheme:'light'});await page.waitForFunction(()=>window.__ag_resolved_theme_mode==='light');
  await inject({enabled:false});assert.equal(await page.locator('html').getAttribute('data-theme'),'light');assert.equal(await page.locator('html').evaluate(el=>el.style.colorScheme),'');
});
test('v542 runtime Swarm disable preserves newer native values and custom inline priority',async t=>{
  const {page,inject}=await fixture(t,{swarm:true,html:'<html data-theme="light" style="color-scheme: light !important"><body></body></html>'});await inject();
  await page.evaluate(()=>window.__ag_set_host_theme_mode('dark'));
  await inject({enabled:false});assert.equal(await page.locator('html').evaluate(el=>el.style.getPropertyPriority('color-scheme')),'important');
  await inject();await page.evaluate(()=>{document.documentElement.setAttribute('data-theme','native-new');document.documentElement.style.setProperty('color-scheme','normal');});
  // Native writes may be observed and reapplied; the saved native baseline must still survive teardown.
  await inject({enabled:false});assert.equal(await page.locator('html').getAttribute('data-theme'),'native-new');assert.equal(await page.locator('html').evaluate(el=>el.style.colorScheme),'normal');
});
