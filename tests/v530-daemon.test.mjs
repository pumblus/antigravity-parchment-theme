import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
const source = fs.readFileSync(new URL('../core/daemon.mjs', import.meta.url), 'utf8');
const parent = '11111111-1111-4111-8111-111111111111';
const child = '22222222-2222-4222-8222-222222222222';
const grand = '33333333-3333-4333-8333-333333333333';
const varint = n => { const a=[]; do {let b=n%128;n=Math.floor(n/128);a.push(b|(n?128:0));}while(n);return Buffer.from(a); };
const field = (n,v) => typeof v==='number' ? Buffer.concat([varint(n*8),varint(v)]) : Buffer.concat([varint(n*8+2),varint(v.length),v]);
const proto = (...pairs) => Buffer.concat(pairs.map(([n,v])=>field(n,v)));
function generation(out=100, wait=1, stream=1, maxCtx=1000000) {
 return proto([1,proto([4,proto([2,1000],[3,out],[5,2000],[9,20],[10,out-20])],[9,proto([10,proto([4,maxCtx])])],[11,proto([1,wait])],[12,proto([1,stream])])]);
}
async function harness(t, config={}) {
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
 code+='\nreturn {getBundle:()=>cachedInjectScript,parseConversationMetrics,readTrajectoryLineage,loadChildScalarMetrics,getCompositeChildSnapshot,findDescendantIds,refreshLineageIndex,activeConfig,metricsConfigEpoch,metricsCache,incrementalMetricsMap,childMetricsCache,lineageStateByDir,rebuildBundleIfNeeded};';
 const api=await vm.runInContext('(async()=>{'+code+'})()',context);
 const makeDb=(id,data=generation(),parentId='',rootId='')=>{const p=path.join(dir,id+'.db');const db=new DatabaseSync(p);db.exec('CREATE TABLE gen_metadata(idx INTEGER PRIMARY KEY, data BLOB); CREATE TABLE steps(idx INTEGER,step_type INTEGER); CREATE TABLE trajectory_metadata_blob(data BLOB);');db.prepare('INSERT INTO gen_metadata VALUES(0,?)').run(data);db.exec('INSERT INTO steps VALUES(0,14),(1,15)');db.prepare('INSERT INTO trajectory_metadata_blob VALUES(?)').run(proto([5,Buffer.from(parentId)],[6,Buffer.from(rootId)]));db.close();return p;};
 return {api,context,dir,tmp,calls,makeDb};
}
test('v530 actual top-level cold startup supports custom context limits without TDZ or host effects',async t=>{
 for(const cfg of [{contextLimit:500000},{contextLimitOverride:1000000},{contextLimit:Infinity},{}]){const h=await harness(t,cfg);assert.equal(h.api.activeConfig.modules.coldBootHealer,false);assert.equal(h.calls.length,0);}
 assert.doesNotMatch(source,/ensureZhTitlePatch|probeZhTitle|resolveWorkingPython|antigravity-zh-title-patch\.py|spawnSync|execSync|\bshell\s*:\s*true|['"]Page\.reload['"]/);
});
test('v530 explicit origins still strictly override defaults',async t=>{for(const allowedOrigins of [[],['plugin://swarm--mine']]){const h=await harness(t,{allowedOrigins});assert.deepEqual(Array.from(h.api.activeConfig.allowedOrigins),allowedOrigins);}});
test('v530 temporary SQLite parses model context, stream ratio, override and tail replacement',async t=>{
 const h=await harness(t,{metricsMode:'full'});const p=h.makeDb(parent);let n=0;const run=()=>h.api.parseConversationMetrics(parent,h.dir,{dbPath:p,sig:'s'+(++n)},{sig:'c'+n,descendantIds:[]});
 let result=run();assert.match(result.inlineHtml,/100 tok\/s/);assert.match(result.inlineHtml,/TTFT/);assert.match(result.inlineHtml,/\/1M/);
 const db=new DatabaseSync(p);t.after(()=>db.close());db.prepare('UPDATE gen_metadata SET data=?').run(generation(100,99,1));result=run();assert.match(result.inlineHtml,/1 tok\/s/);assert.match(result.inlineHtml,/Hold/);assert.match(result.tooltipHtml,/总计 100 /);
 db.prepare('UPDATE gen_metadata SET data=?').run(generation(200,1,2));result=run();assert.match(result.tooltipHtml,/总计 200 /);assert.doesNotMatch(result.tooltipHtml,/总计 300 /);
 h.api.activeConfig.contextLimitOverride=500000;result=run();assert.match(result.inlineHtml,/\/500k/);
 db.prepare('INSERT INTO gen_metadata VALUES(1,?)').run(generation(50));result=run();assert.match(result.tooltipHtml,/总计 250 /);
 db.exec('DELETE FROM gen_metadata WHERE idx=1');result=run();assert.match(result.tooltipHtml,/总计 200 /);
});
test('v530 child lineage includes grandchildren once, safely aggregates and caches read-only metrics',async t=>{
 const h=await harness(t);h.makeDb(parent);h.makeDb(child,generation(200),parent,parent);h.makeDb(grand,generation(300),child,parent);
 const snap=h.api.getCompositeChildSnapshot(parent,h.dir,'main');assert.deepEqual(Array.from(snap.descendantIds),[child,grand]);
 const result=h.api.parseConversationMetrics(parent,h.dir,null,snap);assert.match(result.inlineHtml,/\+2 sub/);assert.match(result.tooltipHtml,/总计 600/);
 const opens=h.calls.length;h.api.parseConversationMetrics(parent,h.dir,null,snap);assert.equal(h.calls.length,opens);
 const nested=h.api.getCompositeChildSnapshot(child,h.dir,'child');assert.deepEqual(Array.from(nested.descendantIds),[grand]);
 const state=h.api.lineageStateByDir.get(h.dir);state.byParent.set(grand,new Set([parent,child]));assert.deepEqual(Array.from(h.api.findDescendantIds(parent,state)),[child,grand]);
 assert.equal(h.api.loadChildScalarMetrics('../outside',h.dir).exists,false);
});
test('v530 metadata validation and deferred/busy child reads preserve last known totals',async t=>{
 const h=await harness(t);const p=h.makeDb(child,generation(200),'../outside','bad');const meta=h.api.readTrajectoryLineage(p);assert.equal(meta.parentId,'');assert.equal(meta.rootId,'');
 const good=h.api.loadChildScalarMetrics(child,h.dir,'before');assert.equal(good.metrics.totalOut,200);
 const deferred=h.api.loadChildScalarMetrics(child,h.dir,'changed',false);assert.equal(deferred.deferred,true);assert.equal(deferred.staleMetrics.totalOut,200);
 const db=new DatabaseSync(p);try{db.exec('BEGIN EXCLUSIVE');const busy=h.api.loadChildScalarMetrics(child,h.dir,'busy');assert.equal(busy.transientError,true);assert.equal(busy.staleMetrics.totalOut,200);}finally{db.exec('ROLLBACK');db.close();}
});
test('v530 lineage indexing obeys per-tick open budget and retries metadata populated later',async t=>{
 const h=await harness(t);h.makeDb(parent);const p=h.makeDb(child,generation(200));
 for(let i=10;i<60;i++)h.makeDb(`${String(i).padStart(8,'0')}-1111-4111-8111-111111111111`,generation(),parent,parent);
 const first=h.api.refreshLineageIndex(h.dir);assert.ok(h.calls.length<=45);assert.equal(first.isDraining,true);
 for(let i=0;i<5&&h.api.refreshLineageIndex(h.dir).isDraining;i++);assert.equal(h.api.refreshLineageIndex(h.dir).isDraining,false);
 const db=new DatabaseSync(p);db.prepare('UPDATE trajectory_metadata_blob SET data=?').run(proto([5,Buffer.from(parent)],[6,Buffer.from(parent)]));db.close();
 // Ensure a deterministic signature change without sleeps or real timers.
 const future=new Date(Date.now()+5000);fs.utimesSync(p,future,future);h.api.lineageStateByDir.get(h.dir).lastPendingScanAt=0;
 h.api.refreshLineageIndex(h.dir);assert.ok(h.api.findDescendantIds(parent,h.api.lineageStateByDir.get(h.dir)).includes(child));
});
test('v530 config hot reload invalidates rendered payload cache and applies override',async t=>{
 const h=await harness(t,{metricsMode:'full'});h.makeDb(parent);const old=h.api.parseConversationMetrics(parent,h.dir);assert.match(old.inlineHtml,/\/1M/);assert.ok(h.api.metricsCache.size>0);
 const cfg=path.join(h.tmp,'user/config.json');fs.writeFileSync(cfg,JSON.stringify({metricsMode:'full',contextLimitOverride:500000}));const future=new Date(Date.now()+5000);fs.utimesSync(cfg,future,future);
 assert.equal(h.api.rebuildBundleIfNeeded(),true);assert.equal(h.api.metricsCache.size,0);const next=h.api.parseConversationMetrics(parent,h.dir);assert.match(next.inlineHtml,/\/500k/);
});
test('v530 lineage rotation rechecks >64 placeholders and corrects existing parent relationships',async t=>{
 const h=await harness(t);h.makeDb(parent);h.makeDb(grand);const ids=[];
 for(let i=100;i<170;i++){const id=`${i.toString().padStart(8,'0')}-1111-4111-8111-111111111111`;ids.push(id);h.makeDb(id);}
 for(let i=0;i<10;i++){if(!h.api.refreshLineageIndex(h.dir).isDraining)break;}
 const state=h.api.lineageStateByDir.get(h.dir);assert.ok(state.nodes.size>64);
 for(const id of ids){const p=path.join(h.dir,id+'.db');const db=new DatabaseSync(p);db.prepare('UPDATE trajectory_metadata_blob SET data=?').run(proto([5,Buffer.from(parent)],[6,Buffer.from(parent)]));db.close();const stamp=new Date(Date.now()+10000);fs.utimesSync(p,stamp,stamp);}
 for(let i=0;i<12;i++){state.lastPendingScanAt=0;h.api.refreshLineageIndex(h.dir);}
 assert.equal(h.api.findDescendantIds(parent,state).length,70);
 const id=ids[0],p=path.join(h.dir,id+'.db'),db=new DatabaseSync(p);db.prepare('UPDATE trajectory_metadata_blob SET data=?').run(proto([5,Buffer.from(grand)],[6,Buffer.from(grand)]));db.close();const stamp=new Date(Date.now()+20000);fs.utimesSync(p,stamp,stamp);
 for(let i=0;i<6;i++){state.lastPendingScanAt=0;h.api.refreshLineageIndex(h.dir);}
 assert.equal(h.api.findDescendantIds(parent,state).includes(id),false);assert.equal(h.api.findDescendantIds(grand,state).includes(id),true);
});
test('v530 child-only writes invalidate parent capsule cache and deleted children leave the index',async t=>{
 const h=await harness(t,{metricsMode:'full'});const p=h.makeDb(parent);const cp=h.makeDb(child,generation(200),parent,parent);
 const beforeStat=fs.statSync(p);const first=h.api.parseConversationMetrics(parent,h.dir);assert.match(first.tooltipHtml,/总计 300/);
 const cached=h.api.parseConversationMetrics(parent,h.dir);assert.equal(cached,first);
 const db=new DatabaseSync(cp);db.prepare('UPDATE gen_metadata SET data=?').run(generation(400));db.close();
 let stamp=new Date(Date.now()+10000);fs.utimesSync(cp,stamp,stamp);
 const updated=h.api.parseConversationMetrics(parent,h.dir);assert.notEqual(updated,first);assert.notEqual(updated.sig,first.sig);assert.match(updated.tooltipHtml,/总计 500/);
 assert.equal(fs.statSync(p).mtimeMs,beforeStat.mtimeMs);assert.equal(fs.statSync(p).size,beforeStat.size);
 fs.unlinkSync(cp);stamp=new Date(Date.now()+20000);fs.utimesSync(h.dir,stamp,stamp);
 const removed=h.api.parseConversationMetrics(parent,h.dir);assert.doesNotMatch(removed.inlineHtml,/ag-sub-badge/);assert.match(removed.tooltipHtml,/总计 100/);
 assert.equal(h.api.lineageStateByDir.get(h.dir).nodes.has(child),false);
 h.makeDb(child,generation(600),parent,parent);stamp=new Date(Date.now()+30000);fs.utimesSync(h.dir,stamp,stamp);fs.utimesSync(cp,stamp,stamp);
 const recreated=h.api.parseConversationMetrics(parent,h.dir);assert.match(recreated.tooltipHtml,/总计 700/);
});
test('v530 budget-limited child aggregation stays partial until all totals are indexed and loaded',async t=>{
 const h=await harness(t);h.makeDb(parent);
 for(let i=200;i<300;i++)h.makeDb(`${i.toString().padStart(8,'0')}-1111-4111-8111-111111111111`,generation(100),parent,parent);
 let first=h.api.parseConversationMetrics(parent,h.dir);
 assert.equal(first.hasData,true);assert.equal(first.isDraining,true);assert.match(first.tooltipHtml,/同步中/);
 assert.equal(h.api.metricsCache.has(path.join(h.dir,parent+'.db')),false);
 // Drain metadata separately to exercise the scalar-open budget independently.
 for(let i=0;i<20;i++)if(!h.api.refreshLineageIndex(h.dir).isDraining)break;
 h.api.childMetricsCache.clear();
 const partial=h.api.parseConversationMetrics(parent,h.dir);assert.equal(partial.isDraining,false);assert.equal(partial.partialStale,true);assert.match(partial.tooltipHtml,/同步中/);assert.equal(h.api.metricsCache.has(path.join(h.dir,parent+'.db')),false);
 let done=partial;for(let i=0;i<20&&(done.isDraining||done.partialStale);i++)done=h.api.parseConversationMetrics(parent,h.dir);
 assert.equal(done.isDraining,false);assert.equal(done.partialStale,false);assert.match(done.inlineHtml,/\+100 sub/);assert.match(done.tooltipHtml,/总计 10k/);assert.equal([...h.api.childMetricsCache.values()].reduce((sum,m)=>sum+m.totalOut,0),10000);assert.doesNotMatch(done.tooltipHtml,/同步中/);
 assert.equal(h.api.parseConversationMetrics(parent,h.dir),done);
});
test('v530 transient stat failures keep known lineage eligible for retry without directory changes',async t=>{
 const h=await harness(t);h.makeDb(parent);const cp=h.makeDb(child,generation(200),parent,parent);h.makeDb(grand);
 h.api.refreshLineageIndex(h.dir);const state=h.api.lineageStateByDir.get(h.dir);assert.equal(state.nodes.get(child).parentId,parent);
 const dirMtime=fs.statSync(h.dir).mtimeMs;
 const original=h.context.fs.statSync;h.context.fs.statSync=(p,...args)=>{if(p===cp)throw Error('temporary EACCES');return original(p,...args);};
 state.lastPendingScanAt=0;h.api.refreshLineageIndex(h.dir);assert.equal(state.nodes.get(child).parentId,parent);
 h.context.fs.statSync=original;
 const db=new DatabaseSync(cp);db.prepare('UPDATE trajectory_metadata_blob SET data=?').run(proto([5,Buffer.from(grand)],[6,Buffer.from(grand)]));db.close();const stamp=new Date(Date.now()+10000);fs.utimesSync(cp,stamp,stamp);
 // SQLite journal creation can alter dir mtime: restore it to prove rotation is sufficient.
 fs.utimesSync(h.dir,new Date(dirMtime),new Date(dirMtime));state.dirMtimeMs=fs.statSync(h.dir).mtimeMs;state.scanningDirMtimeMs=state.dirMtimeMs;
 state.lastPendingScanAt=0;h.api.refreshLineageIndex(h.dir);assert.equal(state.nodes.get(child).parentId,grand);assert.equal(h.api.findDescendantIds(parent,state).includes(child),false);
});
test('v530 emitted bundle preserves explicit exclusion provenance without injecting browser defaults',async t=>{
 for(const selectors of [{},{excludeI18n:'.private'},{excludeI18n:'.prose'},{excludeI18n:'[data-markdown-root]'},{excludeI18n:'.monaco-editor, .private'},{excludeI18n:''}]){
  const h=await harness(t,{selectors});const browser=vm.createContext({});vm.runInContext(h.api.getBundle(),browser);
  assert.equal(browser.__testBoot.selectors.excludeI18n,selectors.excludeI18n);
  assert.equal(Object.hasOwn(browser.__testBoot.selectors,'excludeI18n'),Object.hasOwn(selectors,'excludeI18n'));
 }
 // All protections formerly appended by the daemon remain immutable runtime defaults.
 const runtime=fs.readFileSync(new URL('../core/runtime.js',import.meta.url),'utf8');
 const defaults=runtime.slice(runtime.indexOf('const DEFAULT_EXCLUDE_I18N'),runtime.indexOf('const SELECTORS'));
 for(const selector of ['.monaco-editor','.monaco-diff-editor','.xterm','[data-markdown-root]','[data-testid="user-message-content"]','.agy-user-bubble','[class*="onyx-key"]'])assert.ok(defaults.includes(selector),selector);
 assert.match(runtime,/splitTopLevelSelectors\(DEFAULT_EXCLUDE_I18N\)/);
});
test('translation review macOS trash defaults preserve exact personal overrides', async t => {
 const h=await harness(t);
 fs.writeFileSync(path.join(h.tmp,'core/i18n.json'),JSON.stringify({Trash:'废纸篓','Move to Trash':'移到废纸篓'}));
 const stamp=new Date(Date.now()+7000);fs.utimesSync(path.join(h.tmp,'core/i18n.json'),stamp,stamp);
 assert.equal(h.api.rebuildBundleIfNeeded(),true);
 const browser=vm.createContext({});vm.runInContext(h.api.getBundle(),browser);
 assert.equal(browser.__testBoot.platform,'darwin');
 assert.equal(browser.__testBoot.i18nDict.Trash,'废纸篓');
 assert.equal(browser.__testBoot.i18nDict['Move to Trash'],'移到废纸篓');
 fs.writeFileSync(path.join(h.tmp,'user/i18n.override.json'),JSON.stringify({exact:{Trash:'我的自定义名称'}}));
 assert.equal(h.api.rebuildBundleIfNeeded(),true);vm.runInContext(h.api.getBundle(),browser);
 assert.equal(browser.__testBoot.i18nDict.Trash,'我的自定义名称');
});
test('translation review metrics labels distinguish model capacity from compression and parent totals', async t => {
 const h=await harness(t,{metricsMode:'full'});h.makeDb(parent);h.makeDb(child,generation(200),parent,parent);
 const result=h.api.parseConversationMetrics(parent,h.dir);assert.match(result.tooltipHtml,/上下文窗口用量/);assert.match(result.tooltipHtml,/剩余容量/);assert.match(result.tooltipHtml,/主会话累计/);assert.match(result.tooltipHtml,/主会话累计输入/);assert.match(result.tooltipHtml,/总计 300 \(主 100 \+ 子 200\)/);assert.doesNotMatch(result.tooltipHtml,/压缩水位|距压缩/);
});
