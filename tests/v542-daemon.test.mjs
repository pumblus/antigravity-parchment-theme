import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../core/daemon.mjs',import.meta.url),'utf8');
const slice=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
const flush=async()=>{for(let i=0;i<100;i++)await Promise.resolve();};
function harness() {
 let now=100000,id=0;const timers=new Map(),sockets=[],sent=[];
 const models=new Map();
 const config={enabled:true,modules:{metrics:false,coldBootHealer:false},allowedOrigins:['http://localhost','http://127.0.0.1','vscode-file://','plugin://swarm--'],endpoints:[]};
 class WS {
  static OPEN=1;readyState=1;handlers={};
  constructor(url){this.model=models.get(url);this.url=url;sockets.push(this);}
  addEventListener(k,f){this.handlers[k]=f;}
  close(){this.readyState=3;this.handlers.close?.();}
  event(method,params){this.handlers.message({data:JSON.stringify({method,params})});}
  send(raw){const m=JSON.parse(raw);sent.push({...m,url:this.url});let value=true;
   if(m.method==='Runtime.evaluate'){
    const e=m.params.expression;
    if(m.params.contextId)value=this.model.contexts?.get(m.params.contextId)===true;
    else if(e.includes('injected: window.__ag_patch_version'))value={kind:this.model.kind,injected:this.model.injected,mode:this.model.mode};
    else if(e.includes('ok: window.__ag_patch_version'))value={ok:this.model.injected,mode:this.model.mode};
    else if(e.includes("return 'non_host'"))value=this.model.kind;
    else if(e.includes('TEST_INJECT')){this.model.injected=true;value=this.model.mode;}
   }
   const respond=()=>this.handlers.message?.({data:JSON.stringify({id:m.id,result:{identifier:'script-'+m.id,result:{value}}})});
   if(this.model.hold?.(m)){this.model.held.push(respond);}else queueMicrotask(respond);
  }
 }
 const context=vm.createContext({URL,WebSocket:WS,activeConfig:config,DatabaseSync:null,SAFE_MODE:false,RUN_ONCE:false,cachedInjectScript:'TEST_INJECT',cachedIframeInjectScript:'TEST_INJECT',cachedPatchVersion:'test',rebuildBundleIfNeeded:()=>false,inFlightTokenAnalyticsPromise:null,tokenAnalyticsDbCache:new Map(),tokenAnalyticsSummariesCache:new Map(),lastTokenAnalyticsAccessMs:0,
 console:{log(){},error(){}},Date:{now:()=>now},fs:{readFileSync:()=>{throw Error('no host reads');}},http:{get(){throw Error('no network');}},setTimeout:(fn,ms)=>{timers.set(++id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)});
 vm.runInContext(slice('const attachedTargets =','\nconsole.log(')+'\nglobalThis.api={attachTarget,attachedTargets,targetThemeModes,targetMetaMap,skippedNonHostTargets,syncThemeToChildIframes,resolveParentThemeMode,isAllowedOrigin,sync,HOST_PROBE_EXPRESSION};',context);
 async function attach(name,options={}){
  const model={kind:'host',mode:'light',contexts:new Map([[1,true],[2,false]]),held:[],...options};const url='ws://mock/'+name;models.set(url,model);
  const target={id:name,type:options.type||'page',url:options.url||'http://localhost:3000/',parentId:options.parentId,webSocketDebuggerUrl:url};
  const endpoint={channel:options.channel||'stable'};context.api.targetMetaMap.set(name,{type:target.type,parentId:target.parentId,channel:endpoint.channel});
  const promise=context.api.attachTarget(target,endpoint),ws=sockets.at(-1);const opened=ws.handlers.open();await flush();
  return {model,target,endpoint,ws,promise,opened};
 }
 const fire=async ms=>{const item=[...timers].find(([,x])=>x.ms===ms);assert.ok(item,'timer '+ms);timers.delete(item[0]);item[1].fn();await flush();};
 return {api:context.api,context,config,attach,sent,timers,fire,advance:ms=>now+=ms};
}
test('v542 daemon denies ordinary localhost page without adding injection scripts or bindings',async()=>{
 const h=harness(),t=await h.attach('preview',{kind:'non_host'});assert.equal(await t.promise,false);assert.equal(h.api.attachedTargets.size,0);assert.ok(h.api.skippedNonHostTargets.has('preview'));
 assert.equal(h.sent.some(m=>m.method==='Runtime.addBinding'||m.method==='Page.addScriptToEvaluateOnNewDocument'||m.params.expression==='TEST_INJECT'),false);
});
test('v542 loading host retries then promotes; pending never receives skin payload',async()=>{
 const h=harness(),t=await h.attach('host',{kind:'pending'});assert.equal(h.sent.some(m=>m.method==='Page.addScriptToEvaluateOnNewDocument'),false);
 t.model.kind='host';await h.fire(30);assert.equal(await t.promise,true);assert.equal(h.api.attachedTargets.get('host').hostConfirmed,true);
});
test('v542 pending probes are bounded and closing cleans connection timers',async()=>{
 const h=harness(),t=await h.attach('host',{kind:'pending'});
 const delays=[30,50,100,200];
 for(let i=0;i<40&&t.ws.readyState===1;i++)await h.fire(delays[Math.min(i,delays.length-1)]);
 assert.equal(t.ws.readyState,3);assert.equal(h.api.attachedTargets.size,0);assert.equal(h.timers.size,0);
});
test('v542 navigation from host to preview revokes admission and unregisters future script',async()=>{
 const h=harness(),t=await h.attach('host');assert.equal(await t.promise,true);t.model.kind='non_host';const at=h.sent.length;
 t.ws.event('Page.frameNavigated',{frame:{id:'main',url:'http://localhost:3000/preview'}});await flush();
 assert.equal(t.ws.readyState,3);assert.equal(h.api.targetThemeModes.has('host'),false);assert.ok(h.sent.slice(at).some(m=>m.method==='Page.removeScriptToEvaluateOnNewDocument'));
 assert.equal(h.sent.slice(at).some(m=>m.params.expression==='TEST_INJECT'),false);
});
test('v542 stale initial host probe cannot authorize a newly navigated preview',async()=>{
 const h=harness(),t=await h.attach('race',{hold:m=>m.method==='Runtime.evaluate'&&m.params.expression.includes("return 'non_host'")});
 t.model.kind='non_host';t.model.hold=null;t.ws.event('Page.frameNavigated',{frame:{id:'main',url:'http://localhost:3000/preview'}});await flush();for(const f of t.model.held)f();await flush();
 assert.equal(h.sent.some(m=>m.method==='Page.addScriptToEvaluateOnNewDocument'),false);assert.equal(t.ws.readyState,3);
});
test('v542 known parent routes theme to correct window; ambiguous and disappearing parents clear relay',async()=>{
 const h=harness();await h.attach('one',{mode:'dark'});await h.attach('two',{mode:'light'});
 const frame=await h.attach('child',{type:'iframe',url:'plugin://swarm--fixture/',parentId:'one'});assert.equal(await frame.promise,true);
 assert.equal(h.api.resolveParentThemeMode(h.api.attachedTargets.get('child'),frame.endpoint),'dark');
 const unknown=await h.attach('unknown',{type:'iframe',url:'plugin://swarm--other/'});assert.equal(h.api.resolveParentThemeMode(h.api.attachedTargets.get('unknown'),unknown.endpoint),null);
 h.api.syncThemeToChildIframes();await flush();assert.ok(h.sent.some(m=>m.url===frame.ws.url&&m.params.expression?.includes('__ag_set_host_theme_mode("dark")')));
 h.api.attachedTargets.delete('one');h.api.targetThemeModes.delete('one');h.api.syncThemeToChildIframes();await flush();assert.ok(h.sent.some(m=>m.url===frame.ws.url&&m.params.expression?.includes('__ag_set_host_theme_mode(null)')));
});
test('v542 relay allows only unique same-channel fallback and handles cycles without looping',async()=>{
 const h=harness();await h.attach('one',{mode:'dark'});await h.attach('insider',{mode:'light',channel:'insiders'});
 assert.equal(h.api.resolveParentThemeMode({}, {channel:'stable'}),'dark');assert.equal(h.api.resolveParentThemeMode({}, {channel:'insiders'}),'light');
 h.api.targetMetaMap.set('loop',{type:'iframe',parentId:'loop'});assert.equal(h.api.resolveParentThemeMode({parentId:'loop'},{channel:'stable'}),null);
 assert.equal(h.api.resolveParentThemeMode({parentId:'missing'},{channel:'stable'}),null);
});
test('v542 host theme binding verifies requesting context and rejects malformed or child events',async()=>{
 const h=harness(),t=await h.attach('host');assert.equal(await t.promise,true);
 const emit=(payload,executionContextId)=>t.ws.event('Runtime.bindingCalled',{name:'__agSyncHostThemeMode',payload,executionContextId});
 emit('dark',2);emit('garbage',1);emit('dark',undefined);await flush();assert.equal(h.api.targetThemeModes.get('host'),'light');
 emit('dark',1);await flush();assert.equal(h.api.targetThemeModes.get('host'),'dark');
 h.config.enabled=false;emit('light',1);await flush();assert.equal(h.api.targetThemeModes.get('host'),'dark');
});
test('v542 new-document relay registration is serialized and deduplicates unchanged mode',async()=>{
 const h=harness();await h.attach('host',{mode:'dark'});const t=await h.attach('child',{type:'iframe',url:'plugin://swarm--fixture/',parentId:'host'});assert.equal(await t.promise,true);
 const entry=h.api.attachedTargets.get('child');const count=()=>h.sent.filter(m=>m.url===t.ws.url&&m.method==='Page.addScriptToEvaluateOnNewDocument').length;const before=count();
 await Promise.all([entry.updateNewDocScript(),entry.updateNewDocScript()]);assert.equal(count(),before);
 h.api.targetThemeModes.set('host','light');await Promise.all([entry.updateNewDocScript(),entry.updateNewDocScript()]);assert.equal(count(),before+1);
 assert.match(h.sent.filter(m=>m.url===t.ws.url&&m.method==='Page.addScriptToEvaluateOnNewDocument').at(-1).params.source,/__ag_host_theme_mode="light"/);
});
test('v542 built-in loopback allowlist rejects lookalike domains and preserves custom/empty lists',()=>{
 const h=harness();for(const u of ['http://localhost:123/','http://127.0.0.1:3000/x'])assert.equal(h.api.isAllowedOrigin(u),true);
 for(const u of ['http://localhost.evil/','http://127.0.0.1.evil/','http://localhost@evil/','http://user@localhost/'])assert.equal(h.api.isAllowedOrigin(u),false);
 h.config.allowedOrigins=[];assert.equal(h.api.isAllowedOrigin('http://localhost/'),false);
 h.config.allowedOrigins=['https://trusted.example/scope'];assert.equal(h.api.isAllowedOrigin('https://trusted.example/scope/a'),true);assert.equal(h.api.isAllowedOrigin('https://trusted.example/other'),false);
});
test('v542 host probe recognizes native shapes but not unrelated pages and loading state',()=>{
 const h=harness();const probe=(window,doc)=>vm.runInNewContext(h.api.HOST_PROBE_EXPRESSION,{window,document:doc});const doc={documentElement:{},readyState:'complete',querySelector:()=>null};
 assert.equal(probe({location:{protocol:'http:',hostname:'localhost'}},doc),'non_host');assert.equal(probe({}, {...doc,readyState:'loading'}),'pending');
 assert.equal(probe({__APP_CONFIG__:{productName:'antigravity'}},doc),'host');
 assert.equal(probe({electronNative:{getZoomLevel(){},wcvBrowser:{setThemeColor(){}}}},doc),'host');
 assert.equal(probe({electronNative:{setTitleBarOverlay(){}},nativeStorage:{getItems(){}}},doc),'host');
});
test('v542 BOM-safe config reader accepts only objects and never writes config',()=>{
 for(const [raw,expected] of [['\ufeff{"enabled":false}',false],['[]','fallback'],['null','fallback'],['broken','fallback']]){
  const ctx=vm.createContext({fs:{existsSync:()=>true,readFileSync:()=>raw}});vm.runInContext(slice('function readJsonSafe(', '\nfunction readTextSafe')+'globalThis.read=readJsonSafe;',ctx);
  const result=ctx.read('fixture',{enabled:'fallback'});assert.equal(result.enabled,expected);
 }
 assert.doesNotMatch(source,/persistDarkPresetToUserConfig|__agSetDarkPreset|execFile|ensureZhTitlePatch|['"]Page\.reload['"]/);
});
test('v542 skipped cache retries same URL after backoff and immediately retries same-origin navigation',async()=>{
 const h=harness();h.config.endpoints=[{fallbackPort:123,channel:'stable'}];
 h.context.testTargets=[{id:'preview',type:'page',url:'http://localhost:3000/preview',webSocketDebuggerUrl:'ws://mock/preview'}];h.context.attempts=[];
 vm.runInContext('fetchTargetsResult=async()=>({reachable:true,targets:testTargets});fetchBrowserVersionInfo=async()=>({wsUrl:"",externalBrowser:false});ensureBrowserWatcher=async()=>false;attachTarget=async target=>{attempts.push(target.id);return false;};',h.context);
 h.api.skippedNonHostTargets.set('preview',{url:'http://localhost:3000/preview',origin:'http://localhost:3000',skippedAt:100000,attempts:1,titleHadAg:false});
 await h.api.sync();assert.equal(h.context.attempts.length,0);
 h.advance(8000);await h.api.sync();assert.equal(h.context.attempts.length,1);
 h.api.skippedNonHostTargets.set('preview',{url:'http://localhost:3000/preview',origin:'http://localhost:3000',skippedAt:108000,attempts:3,titleHadAg:false});
 await h.api.sync();assert.equal(h.context.attempts.length,1);
 h.context.testTargets[0].url='http://localhost:3000/app';
 await h.api.sync();assert.equal(h.context.attempts.length,2);
 h.context.testTargets=[];h.advance(10);await h.api.sync();assert.equal(h.api.skippedNonHostTargets.size,0);assert.equal(h.api.targetMetaMap.size,0);
});
test('v542 delayed promotion cannot inject across navigation while Page.enable is pending',async()=>{
 const h=harness(),t=await h.attach('race',{hold:m=>m.method==='Page.enable'});assert.equal(h.sent.some(m=>m.params.expression==='TEST_INJECT'),false);
 t.model.kind='non_host';t.model.hold=null;t.ws.event('Page.frameNavigated',{frame:{id:'main',url:'http://localhost:3000/preview'}});await flush();for(const f of t.model.held)f();await flush();
 assert.equal(h.sent.some(m=>m.params.expression==='TEST_INJECT'),false);assert.equal(h.sent.some(m=>m.method==='Page.addScriptToEvaluateOnNewDocument'),false);
});
test('v542 relay retries missing runtime setter and stale failures cannot invalidate newer delivery',async()=>{
 const h=harness();await h.attach('host',{mode:'dark'});const responses=[];const entry={type:'iframe',hostConfirmed:true,parentId:'host',endpoint:{channel:'stable'},send:(_method,params)=>{assert.match(params.expression,/typeof window\.__ag_set_host_theme_mode/);assert.equal(params.returnByValue,true);return new Promise(resolve=>responses.push(resolve));}};
 h.api.attachedTargets.set('frame',entry);h.api.syncThemeToChildIframes();assert.equal(entry.lastParentThemeMode,'dark');responses.shift()({result:{result:{}}});await flush();assert.equal(entry.lastParentThemeMode,undefined);
 h.api.syncThemeToChildIframes();const old=responses.shift();h.api.targetThemeModes.set('host','light');h.api.syncThemeToChildIframes();responses.shift()({result:{result:{value:true}}});await flush();old(null);await flush();assert.equal(entry.lastParentThemeMode,'light');
});
