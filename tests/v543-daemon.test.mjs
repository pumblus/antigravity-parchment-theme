import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
const source=fs.readFileSync(new URL('../core/daemon.mjs',import.meta.url),'utf8');
const slice=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
const flush=async()=>{for(let i=0;i<100;i++)await Promise.resolve();};
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
function harness(){
 let now=0,nextTimer=0;const timers=new Map(),sent=[],reads=[],budgets=[];let socket;
 const model={ids:[],sig:'',explicit:true,version:'test',renderer:true,rendered:[],held:[],hold:null,dbVersion:1,kind:'host'};
 const config={enabled:true,modules:{metrics:true,coldBootHealer:false},allowedOrigins:['http://localhost']};
 class WS{static OPEN=1;readyState=1;handlers={};constructor(){socket=this;}addEventListener(k,f){this.handlers[k]=f;}close(){this.readyState=3;this.handlers.close?.();}event(method,params){this.handlers.message({data:JSON.stringify({method,params})});}send(raw){
  const m=JSON.parse(raw);sent.push(m);let value=true;
  if(m.method==='Runtime.evaluate'){
   const e=m.params.expression;
   if(e.includes('const ack = []')){const window={__ag_patch_version:model.version,__ag_watched_cascade_sig:model.sig};if(model.renderer)window.__ag_render_metrics=p=>{model.rendered.push(p);return model.ids.includes(p.cascadeId);};value=vm.runInNewContext(e,{window});}
   else if(e.includes('Array.isArray(window.__ag_watched_cascade_ids)'))value={ids:[...model.ids],...(model.explicit?{signature:model.sig}:{})};
   else if(e.includes("return 'non_host'"))value=model.kind;
   else if(e==='TEST_INJECT')value='light';
  }
  const respond=()=>this.handlers.message({data:JSON.stringify({id:m.id,result:{identifier:'s',result:{value}}})});
  if(model.hold?.(m)){model.held.push(respond);}else queueMicrotask(respond);
 }}
 const ctx=vm.createContext({URL,path,WebSocket:WS,activeConfig:config,DatabaseSync:{},cachedInjectScript:'TEST_INJECT',cachedPatchVersion:'test',SAFE_MODE:false,
 metricsConfigEpoch:0,wslUncBackoffUntil:0,LINEAGE_TICK_MAX_OPENS:45,LINEAGE_TICK_MAX_MS:60,performance:{now:()=>now},Date:{now:()=>100000},console:{log(){},error(){}},
 setTimeout:(fn,ms)=>{timers.set(++nextTimer,{fn,ms});return nextTimer;},clearTimeout:id=>timers.delete(id),
 getDbState:cid=>({dbPath:'/fixture/'+cid+'.db',sig:'v'+model.dbVersion}),getCompositeChildSnapshot:(_cid,_dir,sig,budget)=>{budgets.push(budget);return {sig};},
 parseConversationMetrics:(cid,_ep,_state,_snap,budget)=>{reads.push(cid);budget.opens+=1;now+=model.cost||0;return {cascadeId:cid,hasData:true,inlineHtml:'v'+model.dbVersion,tooltipHtml:'t'};}});
 vm.runInContext(slice('function createMetricsPassBudget()', '\nfunction setChildMetricsCache')+slice('const attachedTargets =','\nlet isSyncing')+'\nglobalThis.api={attachTarget,attachedTargets,normalizeCascadeIdList,parseMetricsSubscriptionPayload};',ctx);
 const promise=ctx.api.attachTarget({id:'p',type:'page',url:'http://localhost:3000/',webSocketDebuggerUrl:'ws://mock'},{channel:'stable'});
 const entry=()=>ctx.api.attachedTargets.get('p');
 const open=async()=>{await socket.handlers.open();await flush();assert.equal(await promise,true);};
 const subscribe=async ids=>{model.ids=ids;model.sig=ids.join(',');socket.event('Runtime.bindingCalled',{name:'__agRequestMetrics',payload:JSON.stringify(ids),executionContextId:1});await flush();};
 return {api:ctx.api,model,config,sent,reads,budgets,open,subscribe,entry,socket,ctx,advance:ms=>now+=ms};
}
test('v543 UUID subscription parser validates, deduplicates, caps and accepts explicit empty',()=>{
 const h=harness();assert.deepEqual(Array.from(h.api.normalizeCascadeIdList(`${A}%2B${B},${A}`)),[A,B]);assert.equal(h.api.parseMetricsSubscriptionPayload('[]').valid,true);assert.equal(h.api.parseMetricsSubscriptionPayload('nonsense').valid,false);
 const ids=Array.from({length:20},(_,i)=>`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`);assert.equal(h.api.normalizeCascadeIdList(ids).length,12);
});
test('v543 multi-pane batches render by cid, deduplicate unchanged payload and unsubscribe',async()=>{
 const h=harness();await h.open();await h.subscribe([A,B]);assert.deepEqual(h.model.rendered.map(x=>x.cascadeId),[A,B]);
 const n=h.model.rendered.length;await h.entry().syncMetricsForSession();assert.equal(h.model.rendered.length,n);
 await h.subscribe([]);h.model.dbVersion++;const reads=h.reads.length;await h.entry().syncMetricsForSession();assert.equal(h.reads.length,reads);
});
test('v543 stale DOM response cannot overwrite a newer explicit subscription',async()=>{
 const h=harness();await h.open();await h.subscribe([A]);h.model.hold=m=>m.params.expression?.includes('Array.isArray(window.__ag_watched_cascade_ids)');
 const pending=h.entry().syncMetricsForSession(true);await flush();await h.subscribe([B]);h.model.hold=null;for(const done of h.model.held)done();await pending;
 h.reads.length=0;h.model.rendered=[];await h.entry().syncMetricsForSession();assert.deepEqual(h.reads,[B]);assert.deepEqual(h.model.rendered.map(p=>p.cascadeId),[B]);
});
test('v543 stale render ack cannot commit new subscription state',async()=>{
 const h=harness();await h.open();h.model.hold=m=>m.params.expression?.includes('const ack = []');await h.subscribe([A]);await h.subscribe([B]);h.model.hold=null;for(const done of h.model.held)done();await flush();
 h.model.rendered=[];await h.entry().syncMetricsForSession();assert.deepEqual(h.model.rendered.map(p=>p.cascadeId),[B]);
});
test('v543 missing renderer and false acknowledgement never suppress retry',async()=>{
 const h=harness();await h.open();h.model.renderer=false;await h.subscribe([A]);assert.equal(h.model.rendered.length,0);
 h.model.renderer=true;await h.entry().syncMetricsForSession();assert.deepEqual(h.model.rendered.map(p=>p.cascadeId),[A]);
});
test('v543 stale page signature/version rejects batch acknowledgement and permits retry',async()=>{
 const h=harness();await h.open();h.model.version='new-runtime';await h.subscribe([A]);assert.equal(h.model.rendered.length,0);h.model.version='test';await h.entry().syncMetricsForSession();assert.equal(h.model.rendered.length,1);
});
test('v543 per-pass shared time budget rotates across watched cascades without zeroing skipped panes',async()=>{
 const h=harness();await h.open();h.model.cost=65;await h.subscribe([A,B]);assert.deepEqual(h.reads,[A]);assert.deepEqual(h.model.rendered.map(p=>p.cascadeId),[A]);
 await h.entry().syncMetricsForSession();assert.deepEqual(h.reads,[A,B]);assert.deepEqual(h.model.rendered.map(p=>p.cascadeId),[A,B]);
 assert.notEqual(h.budgets[0],h.budgets[1]);
});
test('v543 all cascades within one pass share the same open budget object',async()=>{
 const h=harness();await h.open();await h.subscribe([A,B]);assert.equal(h.budgets.length,2);assert.equal(h.budgets[0],h.budgets[1]);assert.equal(h.budgets[0].opens,2);
});
test('v543 navigation invalidates pending discovery and disables old subscription reads',async()=>{
 const h=harness();await h.open();await h.subscribe([A]);h.model.hold=m=>m.params.expression?.includes('Array.isArray(window.__ag_watched_cascade_ids)');const pending=h.entry().syncMetricsForSession(true);await flush();
 h.model.kind='non_host';h.socket.event('Page.frameNavigated',{frame:{id:'main',url:'http://localhost:3000/preview'}});await flush();h.model.hold=null;for(const done of h.model.held)done();await pending;
 assert.equal(h.api.attachedTargets.has('p'),false);
});

const parent = '11111111-1111-4111-8111-111111111111';
const child = '22222222-2222-4222-8222-222222222222';
const grand = '33333333-3333-4333-8333-333333333333';
const varint = n => { const a=[]; do {let b=n%128;n=Math.floor(n/128);a.push(b|(n?128:0));}while(n);return Buffer.from(a); };
const field = (n,v) => typeof v==='number' ? Buffer.concat([varint(n*8),varint(v)]) : Buffer.concat([varint(n*8+2),varint(v.length),v]);
const proto = (...pairs) => Buffer.concat(pairs.map(([n,v])=>field(n,v)));
function generation(out=100, wait=1, stream=1, maxCtx=1000000) {
 return proto([1,proto([4,proto([2,1000],[3,out],[5,2000],[9,20],[10,out-20])],[9,proto([10,proto([4,maxCtx])])],[11,proto([1,wait])],[12,proto([1,stream])])]);
}
async function realHarness(t, config={}) {
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ag-v530-'));t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
 fs.mkdirSync(path.join(tmp,'core'));fs.mkdirSync(path.join(tmp,'user'));const dir=path.join(tmp,'conversations');fs.mkdirSync(dir);
 fs.writeFileSync(path.join(tmp,'core/runtime.js'),'(function(boot){globalThis.__testBoot=boot;})(__AG_BOOT_PAYLOAD__);');fs.writeFileSync(path.join(tmp,'core/theme.css'),'');fs.writeFileSync(path.join(tmp,'core/i18n.json'),'{}');fs.writeFileSync(path.join(tmp,'user/config.json'),JSON.stringify(config));
 const calls=[]; const fail=()=>{throw Error('Host effects forbidden');};
 const safeFs={};for(const name of ['statSync','existsSync','readFileSync','readdirSync']) safeFs[name]=(...args)=>{
  const p=String(args[0]);if(!p.startsWith(tmp+path.sep)&&p!==tmp){ if(name==='existsSync')return false;if(name==='statSync'&&args[1]?.throwIfNoEntry===false)return undefined;throw Error('Outside fixture: '+p); }return fs[name](...args);
 };
 class ReadonlyDb {constructor(p,opts){assert.ok(p.startsWith(dir+path.sep));assert.equal(opts.readOnly,true);calls.push(p);return new DatabaseSync(p,opts);}}
 const http={get(_opts,cb){const events={};queueMicrotask(()=>events.error?.(Error('stub offline')));return {on(k,f){events[k]=f;return this;},destroy(){}};}};
 const context=vm.createContext({fs:safeFs,path,os:{homedir:()=>tmp,tmpdir:()=>tmp},http,crypto,TextDecoder,Uint8Array,Buffer,performance,DB:ReadonlyDb,spawnSync:fail,WebSocket:class {constructor(){fail();}},console:{log(){},warn(){},error(){}},process:{argv:['node','fixture','--once'],platform:'darwin',env:{},pid:42,kill:fail,on:fail,exit:n=>{assert.equal(n,0);}},setInterval:fail,setTimeout:fail,clearTimeout:fail});
 let code=source.replace(/^#!.*\n/,'').replace(/^import .*;\n/gm,'').replace("fileURLToPath(import.meta.url)",JSON.stringify(path.join(tmp,'core/daemon.mjs'))).replace("await import('node:sqlite').catch(() => null)",'({DatabaseSync: DB})');
 code+='\nreturn {getBundle:()=>cachedInjectScript,parseConversationMetrics,readTrajectoryLineage,loadChildScalarMetrics,getCompositeChildSnapshot,findDescendantIds,refreshLineageIndex,activeConfig,metricsConfigEpoch,metricsCache,incrementalMetricsMap,childMetricsCache,lineageStateByDir,rebuildBundleIfNeeded,createMetricsPassBudget,metricsBudgetAvailable};';
 const api=await vm.runInContext('(async()=>{'+code+'})()',context);
 const makeDb=(id,data=generation(),parentId='',rootId='')=>{const p=path.join(dir,id+'.db');const db=new DatabaseSync(p);db.exec('CREATE TABLE gen_metadata(idx INTEGER PRIMARY KEY, data BLOB); CREATE TABLE steps(idx INTEGER,step_type INTEGER); CREATE TABLE trajectory_metadata_blob(data BLOB);');db.prepare('INSERT INTO gen_metadata VALUES(0,?)').run(data);db.exec('INSERT INTO steps VALUES(0,14),(1,15)');db.prepare('INSERT INTO trajectory_metadata_blob VALUES(?)').run(proto([5,Buffer.from(parentId)],[6,Buffer.from(rootId)]));db.close();return p;};
 return {api,context,dir,tmp,calls,makeDb};
}
test('v543 real SQLite lineage refresh is once per directory and shared open budget defers parents without empty payload',async t=>{
 const h=await realHarness(t);h.makeDb(parent);h.makeDb(child);
 for(let i=100;i<170;i++)h.makeDb(`${i.toString().padStart(8,'0')}-1111-4111-8111-111111111111`,generation(100),parent,parent);
 const budget=h.api.createMetricsPassBudget();const first=h.api.getCompositeChildSnapshot(parent,h.dir,'p',budget);const count=h.calls.length;
 const second=h.api.getCompositeChildSnapshot(child,h.dir,'c',budget);assert.equal(h.calls.length,count);assert.equal(budget.directories.size,1);assert.ok(count<=45);
 budget.opens=45;const result=h.api.parseConversationMetrics(parent,h.dir,null,first,budget);assert.equal(result.transientError,true);assert.equal(result.budgetDeferred,true);assert.equal(result.hasData,undefined);assert.equal(h.calls.length,count);
 assert.ok(first.isDraining);assert.ok(second.isDraining);
});
test('v543 real SQLite child and parent opens share one budget with cached fallback',async t=>{
 const h=await realHarness(t);h.makeDb(parent);h.makeDb(grand);
 for(let i=200;i<270;i++)h.makeDb(`${i.toString().padStart(8,'0')}-1111-4111-8111-111111111111`,generation(100),parent,parent);
 for(let i=0;i<10;i++)if(!h.api.refreshLineageIndex(h.dir).isDraining)break;
 const before=h.calls.length,budget=h.api.createMetricsPassBudget();const snap=h.api.getCompositeChildSnapshot(parent,h.dir,'p',budget);
 const result=h.api.parseConversationMetrics(parent,h.dir,null,snap,budget);assert.equal(result.hasData,true);assert.equal(result.partialStale,true);assert.ok(h.calls.length-before<=45);assert.ok(budget.opens<=45);
 const second=h.api.parseConversationMetrics(grand,h.dir,null,h.api.getCompositeChildSnapshot(grand,h.dir,'g',budget),budget);
 assert.ok(second.transientError||second.hasData);assert.ok(h.calls.length-before<=45);
 const exhausted={...h.api.createMetricsPassBudget(),opens:45};const old=h.api.parseConversationMetrics(parent,h.dir,null,snap,exhausted);assert.equal(old.transientError,true);assert.equal(old.cachedPayload.hasData,true);
});
test('v543 elapsed shared budget blocks additional database opens',async t=>{
 const h=await realHarness(t);h.makeDb(parent);let now=0;h.context.performance={now:()=>now};const budget=h.api.createMetricsPassBudget();now=61;
 const before=h.calls.length;const result=h.api.parseConversationMetrics(parent,h.dir,{dbPath:path.join(h.dir,parent+'.db'),sig:'s'},{sig:'s',descendantIds:[]},budget);
 assert.equal(result.budgetDeferred,true);assert.equal(h.calls.length,before);
});
test('v543 provisional empty DOM discovery keeps polling until initialized explicit runtime subscription',async()=>{
 const h=harness();h.model.explicit=false;await h.open();const count=()=>h.sent.filter(m=>m.params.expression?.includes('Array.isArray(window.__ag_watched_cascade_ids)')).length;const initial=count();
 h.model.ids=[A];h.model.sig=A;await h.entry().syncMetricsForSession();assert.equal(count(),initial+1);assert.equal(h.model.rendered.length,1);
 await h.entry().syncMetricsForSession();assert.equal(count(),initial+2);assert.equal(h.model.rendered.length,1);
 h.model.explicit=true;await h.entry().syncMetricsForSession();const confirmed=count();await h.entry().syncMetricsForSession();assert.equal(count(),confirmed);
});
