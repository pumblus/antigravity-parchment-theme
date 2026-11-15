import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
const runtime = fs.readFileSync(new URL('../core/runtime.js', import.meta.url), 'utf8');
const daemon = fs.readFileSync(new URL('../core/daemon.mjs', import.meta.url), 'utf8');
const slice = (src, a, b) => { const start=src.indexOf(a),end=src.indexOf(b,start);assert.ok(start>=0&&end>start,a);return src.slice(start,end); };
const flush = async () => {for(let i=0;i<35;i++) await Promise.resolve();};
const coldCode = slice(runtime,'  // 2.05 冷启动','  // 2.1 缩放');
function clock() {let id=0;const timers=new Map();return {timers,setTimeout:(fn,ms)=>{timers.set(++id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),fire:ms=>{const found=[...timers].find(([,t])=>t.ms===ms);assert.ok(found,`timer ${ms}`);timers.delete(found[0]);found[1].fn();}};}
function page(options={}) {
 const time=clock(),listeners={},session=new Map();let reloads=0,fetches=0,resolveHead;
 const state={blocked:false,editables:[],focus:true,...options};
 const window={location:{origin:'http://localhost:3000',pathname:'/',reload:()=>reloads++},crypto:{randomUUID:()=> '11111111-1111-4111-8111-111111111111'},sessionStorage:{getItem:k=>session.get(k),setItem:(k,v)=>session.set(k,v)}};window.top=options.child?{}:window;
 const document={hidden:false,activeElement:null,hasFocus:()=>state.focus,addEventListener:(k,f)=>{(listeners[k]||=[]).push(f);},querySelector:selector=>selector.includes('role="dialog"')?(state.blocked?{}:null):selector.includes('attachment')?(state.attachment?{}:null):{},querySelectorAll:selector=>selector==='input[type="file"]'?(state.files||[]):state.editables};
 const ctx=vm.createContext({window,document,ENABLED:options.enabled!==false,MODULES:{coldBootHealer:options.optIn},IS_SWARM_PLUGIN_FRAME:!!options.swarm,performance:{now:()=>5000,getEntriesByType:()=>[{name:'http://localhost:3000/main.js',decodedBodySize:2000,encodedBodySize:2000}]},...time,fetch:()=>{fetches++;return new Promise(r=>{resolveHead=r;});}});
 function inject(){vm.runInContext("(() => {const coldBootGeneration=Symbol();window.__ag_coldboot_generation=coldBootGeneration;window.__ag_commit_coldboot_reload=null;"+coldCode+'})()',ctx);}
 inject();
 return {ctx,window,document,time,state,inject,session,reloads:()=>reloads,fetches:()=>fetches,fire:()=>time.fire(1500),respond:async()=>{resolveHead({ok:true,headers:{get:k=>k==='etag'?'"3000-abcd"':null}});await flush();},event:k=>{for(const f of listeners[k]||[])f({key:'a'});}};
}
async function connection(p,options={}) {
 const time=clock(),sent=[],contexts=new Map([[1,p.ctx]]);let socket;
 class WS {static OPEN=1;readyState=1;handlers={};constructor(){socket=this;}addEventListener(k,f){this.handlers[k]=f;}send(raw){const m=JSON.parse(raw);sent.push(m);let value=true;
  if(m.method==='Runtime.evaluate'&&m.params.contextId){const ctx=contexts.get(m.params.contextId);value=ctx?vm.runInContext(m.params.expression,ctx):false;}
  queueMicrotask(()=>this.handlers.message({data:JSON.stringify({id:m.id,result:{identifier:'test-script',result:{value}}})}));
 }}
 const config={enabled:true,modules:{coldBootHealer:true,metrics:false,...options.modules}};
 const ctx=vm.createContext({WebSocket:WS,...time,console:{log(){},error(){}},activeConfig:config,DatabaseSync:null,cachedInjectScript:'true',cachedPatchVersion:'test',attachedTargets:new Map(),Date:{now:()=>100000}});
 vm.runInContext(slice(daemon,'function attachTarget(', '\nlet isSyncing')+'\nglobalThis.attach=attachTarget;',ctx);
 const promise=ctx.attach({id:options.id||'page-1',type:options.type||'page',webSocketDebuggerUrl:'ws://mock'}, {channel:'stable'});
 await socket.handlers.open();assert.equal(await promise,true);
 const event=(payload,contextId=1)=>socket.handlers.message({data:JSON.stringify({method:'Runtime.bindingCalled',params:{name:'__agRequestHardReload',payload,executionContextId:contextId}})});
 p.window.__agRequestHardReload=payload=>event(payload);
 return {sent,event,contexts,config};
}
test('cold healer defaults are disabled in daemon and page, requiring literal true',()=>{
 assert.equal((daemon.match(/coldBootHealer: false/g)||[]).length,2);assert.match(runtime,/coldBootHealer: false/);
 for(const optIn of [undefined,false,'true',1]){const p=page({optIn});assert.equal(p.time.timers.size,0);assert.equal(p.fetches(),0);}
});
test('cold healer full mock CDP chain reloads only requesting safe page once',async()=>{
 const p=page({optIn:true}),other=page({optIn:true});const c=await connection(p);
 assert.ok(c.sent.some(m=>m.method==='Runtime.addBinding'&&m.params.name==='__agRequestHardReload'));
 p.fire();await p.respond();assert.equal(p.reloads(),1);assert.equal(other.reloads(),0);
 assert.equal(p.session.get('__ag_coldboot_bundle_healed'),'1');assert.ok(c.sent.some(m=>m.params.contextId===1));
 assert.ok(c.sent.every(m=>m.method!=='Page.reload'));
 c.event(JSON.stringify({token:'11111111-1111-4111-8111-111111111111'}));await flush();assert.equal(p.reloads(),1);
});
test('cold healer rejects draft, dialog/running, focus and navigation changes after HEAD',async()=>{
 for(const change of [p=>p.state.editables.push({tagName:'TEXTAREA',value:'draft'}),p=>p.state.blocked=true,p=>p.state.attachment=true,p=>p.state.files=[{files:[{}]}],p=>p.document.hidden=true,p=>p.state.focus=false,p=>p.window.location.pathname='/c/a',p=>p.document.activeElement={matches:()=>true},p=>p.event('compositionstart'),p=>p.event('input'),p=>p.event('paste'),p=>p.event('drop')]){
  const p=page({optIn:true});await connection(p);p.fire();change(p);await p.respond();assert.equal(p.reloads(),0);
 }
});
test('cold healer rechecks complete gate after binding dispatch, has no unsafe fallback',async()=>{
 for(const change of [p=>p.state.blocked=true,p=>p.state.editables.push({tagName:'INPUT',type:'text',value:'new draft'}),p=>p.event('compositionstart'),p=>p.inject()]){
 const p=page({optIn:true});const c=await connection(p);p.window.__agRequestHardReload=payload=>{change(p);c.event(payload);};p.fire();await p.respond();assert.equal(p.reloads(),0);assert.equal([...p.time.timers.values()].some(x=>x.ms===280),false);
 }
});
test('cold healer stale fetch cannot reload after reinjection or disabling',async()=>{
 const p=page({optIn:true});await connection(p);p.fire();p.ctx.MODULES.coldBootHealer=false;p.inject();await p.respond();assert.equal(p.reloads(),0);
});
test('cold healer daemon rejects disabled mode, malformed binding and child contexts',async()=>{
 for(const modules of [{coldBootHealer:false},{coldBootHealer:'true'},{deadlockHealer:false}]){
 const p=page({optIn:true});await connection(p,{modules});p.fire();await p.respond();assert.equal(p.reloads(),0);
 }
 for(const payload of ['bad','{}',JSON.stringify({token:'not-a-token'})]){const p=page({optIn:true});const c=await connection(p);c.event(payload);assert.equal(c.sent.filter(m=>m.params.contextId).length,0);}
 const p=page({optIn:true});const c=await connection(p);const child=page({child:true,optIn:true});let childCalled=false;child.window.__ag_commit_coldboot_reload=()=>{childCalled=true;};c.contexts.set(2,child.ctx);
 c.event(JSON.stringify({token:'11111111-1111-4111-8111-111111111111'}),2);await flush();assert.equal(childCalled,false);assert.equal(p.reloads(),0);
});
test('cold healer disabled for Swarm, subframes and existing conversation routes',()=>{
 for(const options of [{swarm:true},{child:true}])assert.equal(page({optIn:true,...options}).time.timers.size,0);
 const p=page({optIn:true});p.window.location.pathname='/c/abc';p.fire();assert.equal(p.fetches(),0);
});
test('Windows process validation fails closed on uncertain WMI and rejects unrelated node',()=>{
 const code=slice(daemon,'function checkDaemonPidState(', '\nconst pidKey');
 for(const [commandLine,expected] of [['node unrelated.js','not_daemon'],['node daemon.mjs','confirmed'],['','uncertain']]){
 const ctx=vm.createContext({process:{pid:1,platform:'win32',kill(){}},spawnSync:(bin)=>({status:0,stdout:bin==='tasklist'?'node.exe':commandLine})});
 vm.runInContext(code+'globalThis.check=checkDaemonPidState;',ctx);assert.equal(ctx.check(123),expected);
 }
});
test('WSL metrics explicit directory suppresses UNC discovery',()=>{
 let probes=0;const ctx=vm.createContext({path,TextDecoder,fs:{existsSync:()=>false},process:{platform:'win32'},wslUncBackoffUntil:0,resolveWin32WslConversationsDirs:()=>{probes++;return [];}});
 vm.runInContext(slice(daemon,'const resolvedCascadeDbCache', '\nfunction getDbState')+'globalThis.resolve=resolveConversationDbPath;',ctx);
 assert.equal(ctx.resolve('a',{conversationsDir:'/explicit',explicitConvDir:true,portFile:'/port'}),path.join('/explicit','a.db'));assert.equal(probes,0);
});

test('cold healer session-storage failure and missing binding never use fallback reload', async()=>{
 for (const mode of ['storage','binding']) {
  const p=page({optIn:true});if(mode==='storage'){await connection(p);p.window.sessionStorage.setItem=()=>{throw Error('denied');};}
  p.fire();await p.respond();assert.equal(p.reloads(),0);assert.equal([...p.time.timers.values()].some(x=>x.ms===280),false);
 }
});
test('cold healer forged token and non-loopback origin cannot reach reload',async()=>{
 const p=page({optIn:true});const c=await connection(p);let payload;
 p.window.__agRequestHardReload=value=>{payload=value;};p.fire();await p.respond();
 assert.equal(p.window.__ag_commit_coldboot_reload('22222222-2222-4222-8222-222222222222'),false);
 p.window.location.origin='https://localhost.attacker.example';c.event(payload);await flush();assert.equal(p.reloads(),0);
});
