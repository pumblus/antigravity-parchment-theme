import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const runtime=fs.readFileSync(new URL('../core/runtime.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../core/theme.css',import.meta.url),'utf8');
let browser;
after(async()=>browser?.close());
async function fixture(t,marker=true){
 const {chromium}=createRequire(import.meta.url)('playwright');
 browser ||= await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const page=await browser.newPage();t.after(()=>page.close());
 await page.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:`<html><head><style>body[data-agy-theme]{--nux-composer-radius:99px;--nux-radius-lg:99px}body[data-agy-theme] .surface-composer>.surface-composer-card{background:red!important;border-radius:99px!important;box-shadow:0 0 9px red!important}body[data-agy-theme] .agy-sidebar-row[data-selected="true"]{background:red!important;box-shadow:0 0 9px red!important}</style></head><body ${marker?'data-agy-theme="default"':''}><div class="surface-composer"><div class="surface-composer-card"><input id="focus"></div></div><div class="agy-sidebar-row" data-selected="true"><span>Title</span></div><article class="prose">Prose <strong>bold</strong> <code>code</code></article></body></html>`}));
 await page.goto('http://fixture.invalid/');
 const inject=extra=>page.evaluate(runtime.replace('__AG_BOOT_PAYLOAD__',()=>JSON.stringify({platform:'darwin',cssText:css,themeMode:'light',modules:{metrics:false,deadlockHealer:false,coldBootHealer:false,zoomShortcuts:false},...extra})));
 return {page,inject};
}
async function snapshot(page){return page.evaluate(()=>{
 const props=['fontFamily','fontWeight','color','backgroundColor','borderRadius','borderColor','boxShadow','textShadow'];
 const result={};for(const selector of ['body','.surface-composer-card','.agy-sidebar-row','.prose','.prose strong','.prose code']){const s=getComputedStyle(document.querySelector(selector));result[selector]=Object.fromEntries(props.map(p=>[p,s[p]]));}
 const body=getComputedStyle(document.body);result.geometry=['--nux-composer-frame-radius','--nux-composer-radius','--nux-radius-lg','--nux-radius-md','--nux-overlay-inset'].map(p=>body.getPropertyValue(p).trim());return result;
 });}
for(const mode of ['light','dark'])test(`v550 runtime bare 2.33 host retains legacy ${mode} fusion styles, including focused composer`,async t=>{
 const {page,inject}=await fixture(t);await inject({themeMode:mode});
 assert.equal(await page.evaluate(()=>window.__ag_patch_version),'20261121-v5.5.3-eric.1');
 for(const focus of [false,true]){
  if(focus)await page.locator('#focus').focus();
  await page.waitForTimeout(220);
  const modern=await snapshot(page);
  assert.deepEqual(modern.geometry,['12px','11px','10px','10px','4px']);
  assert.match(modern.body.fontFamily,/Anthropic Sans/);assert.match(modern.body.fontFamily,/PingFang SC/);
  assert.match(modern['.prose'].fontFamily,/Anthropic Serif/);assert.match(modern['.prose code'].fontFamily,/Anthropic Mono/);
  for(const selector of ['.surface-composer-card','.agy-sidebar-row']){assert.equal(modern[selector].boxShadow,'none');assert.notEqual(modern[selector].backgroundColor,'rgb(255, 0, 0)');}
  for(const selector of ['body','.prose','.prose strong','.prose code'])assert.equal(modern[selector].textShadow,'none');
  await page.locator('body').evaluate(el=>el.setAttribute('data-newux-theme','onyx'));
  assert.deepEqual(await snapshot(page),modern);
  await page.locator('body').evaluate(el=>el.removeAttribute('data-newux-theme'));
 }
 assert.equal(await page.locator('link[href*="fonts.googleapis.com"]').count(),0);
 await inject({enabled:false});assert.equal(await page.locator('#ag-custom-fonts').count(),0);
});
test('v550 runtime does not widen host detection to ordinary pages or inject external fonts',async t=>{
 const {page,inject}=await fixture(t,false);await inject();
 assert.equal(await page.evaluate(()=>window.__ag_patch_version),undefined);
 assert.equal(await page.locator('#ag-custom-fonts').count(),0);
 assert.doesNotMatch(runtime,/fonts\.googleapis\.com|ag-google-sans-flex-fonts/);
 assert.doesNotMatch(css,/Google Sans Flex|AgSarasaUI/);
});
