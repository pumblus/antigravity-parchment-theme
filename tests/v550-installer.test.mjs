import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {EventEmitter} from 'node:events';
const source = fs.readFileSync(new URL('../install.mjs', import.meta.url), 'utf8');
const helpers = source.slice(source.indexOf('function parseDevToolsPort('), source.indexOf('async function detectEnvironment('));
function harness(overrides = {}) {
  const context = vm.createContext({URL, process:{platform:'darwin'}, spawnSync:()=>({status:0,stdout:''}), ...overrides});
  vm.runInContext(helpers, context); return context;
}
test('v550 strict DevTools port parsing rejects malformed/out-of-range values', () => {
  const h=harness();
  for(const raw of ['123junk','0','65536','-1','1.2','']) assert.equal(h.parseDevToolsPort(raw),null);
  assert.equal(h.parseDevToolsPort('4567\n/devtools/browser/id\n'),4567);
});
test('v550 Mac process parser only accepts main host executable and exact flag', () => {
  const h=harness();const result=h.parseMacHostProcesses(`12 /Applications/Antigravity.app/Contents/MacOS/Antigravity --remote-debugging-port=0\n13 /Applications/Antigravity - Insiders.app/Contents/MacOS/Antigravity\n14 /bin/sh -c /Applications/Antigravity.app/Contents/MacOS/Antigravity\n15 /Applications/Antigravity.app/Contents/MacOS/Antigravity --type=renderer\n16 /Applications/Antigravity.app/Contents/Frameworks/Antigravity Helper.app/Contents/MacOS/Antigravity Helper`);
  assert.equal(result.length,2);assert.equal(result[0].hasCdpFlag,true);assert.equal(result[1].channel,'insiders');assert.equal(result[1].hasCdpFlag,false);
});
test('v550 failed or unsupported process probe remains unknown, never not-running', () => {
  assert.equal(harness({spawnSync:()=>({status:1,stdout:''})}).probeHostProcesses().known,false);
  assert.equal(harness({process:{platform:'linux'},spawnSync:()=>{throw Error('must not run')}}).probeHostProcesses().known,false);
});
test('v550 stale files and flags never establish live CDP readiness', () => {
 const h=harness(); const base={livePort:null,portFileExists:false,processKnown:true,processes:[]};
 assert.equal(h.classifyCdpStatus(base),'app_not_running');
 assert.equal(h.classifyCdpStatus({...base,portFileExists:true}),'stale_port_file_app_not_running');
 assert.equal(h.classifyCdpStatus({...base,processes:[{hasCdpFlag:false}]}),'running_without_cdp_flag');
 assert.equal(h.classifyCdpStatus({...base,processes:[{hasCdpFlag:true}]}),'flag_present_endpoint_unreachable');
 assert.equal(h.classifyCdpStatus({...base,processKnown:false}),'process_unknown');
 assert.equal(h.classifyCdpStatus({...base,livePort:1234}),'endpoint_reachable');
});
test('v550 endpoint check validates response shape, loopback and matching port without executing commands', async () => {
 async function probe(value,statusCode=200) {
  const http={get(options,callback){assert.equal(options.host,'127.0.0.1');assert.equal(options.path,'/json/version');const req=new EventEmitter();req.destroy=()=>{};queueMicrotask(()=>{const res=new EventEmitter();res.statusCode=statusCode;callback(res);res.emit('data',JSON.stringify(value));res.emit('end')});return req;}};
  return harness({http}).probeCdpEndpoint(1234);
 }
 assert.equal(await probe({Browser:'Chrome',webSocketDebuggerUrl:'ws://127.0.0.1:1234/devtools/browser/id'}),true);
 for (const url of ['ws://evil.test:1234/devtools/browser/id','ws://127.0.0.1:9999/devtools/browser/id','ws://u@127.0.0.1:1234/devtools/browser/id']) assert.equal(await probe({Browser:'Chrome',webSocketDebuggerUrl:url}),false);
 assert.equal(await probe([]),false);assert.equal(await probe({Browser:'Chrome',webSocketDebuggerUrl:'ws://127.0.0.1:1234/devtools/browser/id'},500),false);
});
test('v550 installer cannot silently opt in launch security or invoke upstream relaunch machinery', () => {
 const install=source.slice(source.indexOf('async function runInstall('),source.indexOf('async function runVerify('));
 assert.doesNotMatch(install,/ensureArgvRemoteDebugging\(/);
 assert.match(install,/explicit-launch-opt-in-required/);
 assert.doesNotMatch(source,/function (runRelaunch|ensureCdpLaunchers|maybeAutoRelaunchColdStartWithoutCdp)\(/);
 const daemon=fs.readFileSync(new URL('../core/daemon.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(daemon,/cdpAutoRelaunch|maybeAutoRelaunchColdStartWithoutCdp/);
});
test('v550 daemon ignores malformed recorded ports rather than throwing HTTP range errors', () => {
 const daemon=fs.readFileSync(new URL('../core/daemon.mjs',import.meta.url),'utf8');
 const code=daemon.slice(daemon.indexOf('function readPort('),daemon.indexOf('function fetchTargets('));
 for (const [raw,want] of [['99999',null],['123abc',null],['9222\n/id',9222]]) {
  const h=vm.createContext({fs:{readFileSync:()=>raw}});vm.runInContext(code,h);assert.equal(h.readPort('unused'),want);
 }
});
test('v550 doctor distinguishes source integrity from real injected-host readiness', () => {
 const doctor=source.slice(source.indexOf('async function runDoctor('),source.indexOf('function copyDirRecursive('));
 assert.match(doctor,/ok: Boolean\(env.nodeBasicOk && integrity.ok && live.state\?\.hasStyle && live.state\?\.bodyReady\)/);
 assert.match(doctor,/coreReady:/);assert.match(doctor,/injectionReady:/);
});
test('v550 auto diagnostics continue past unrelated first endpoint to verified host', async () => {
 const start=source.indexOf('async function inspectLiveWindow(');
 const code=source.slice(start,source.indexOf('// ============================================================================\n// 3.',start));
 class Socket {
  handlers={};constructor(url){this.url=url;queueMicrotask(()=>this.handlers.open());}
  addEventListener(name,fn){this.handlers[name]=fn;}close(){}
  send(){queueMicrotask(()=>this.handlers.message({data:JSON.stringify({id:1,result:{result:{value:{__isHost:this.url.endsWith('host'),hasStyle:true,bodyReady:true}}}})}));}
 }
 const ports=[];const h=vm.createContext({fs:{existsSync:()=>false},WebSocket:Socket,setTimeout,clearTimeout,isAllowedOrigin:()=>true,
 fetchTargetsFromPort:async port=>{ports.push(port);return [{id:String(port),type:'page',url:'http://localhost/',title:'test',webSocketDebuggerUrl:port===9222?'ws://preview':'ws://host'}];}});
 vm.runInContext(code,h);const live=await h.inspectLiveWindow({channel:'auto',channels:{stable:{appExists:true},insiders:{appExists:true}}});
 assert.equal(live.targetId,'9223');assert.equal(live.port,9223);assert.deepEqual(ports,[9222,9223]);
});
