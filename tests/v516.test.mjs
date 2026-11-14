import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
const runtime = fs.readFileSync(new URL('../core/runtime.js', import.meta.url), 'utf8');
const daemon = fs.readFileSync(new URL('../core/daemon.mjs', import.meta.url), 'utf8');
function section(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `Missing extraction boundary: ${start}`);
  return source.slice(a, b);
}
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
function curtain(swarm = false) {
  let color = '#123456'; const calls = [], writes = [];
  const owner = { setThemeColor(hex) { assert.equal(this, owner); calls.push(hex); const d = deferred(); writes.push(d); return d.promise; } };
  const window = {electronNative: {wcvBrowser: owner}};
  const ctx = vm.createContext({window, IS_SWARM_PLUGIN_FRAME: swarm, document:{body:{}}, getComputedStyle:()=>({getPropertyValue:()=>color})});
  const code = section(runtime, '  function parseColorToRgb', '  // 若用户在');
  const inject = () => vm.runInContext('(() => {' + code + '\nglobalThis.sync = syncCurtainSurfaceColor;})()', ctx);
  inject();
  return {ctx,window,calls,writes,inject,setColor:value=>{color=value;}};
}
test('curtain caches only success, retries failures, and coalesces writes', async () => {
  const c = curtain(); c.ctx.sync(); await tick();
  assert.equal(c.window.__ag_last_curtain_hex, undefined);
  c.writes[0].reject(new Error('temporary')); await tick();
  c.ctx.sync(); await tick(); assert.equal(c.calls.length,2);
  c.writes[1].resolve(); await tick(); assert.equal(c.window.__ag_last_curtain_hex,'#123456');
  c.ctx.sync(); await tick(); assert.equal(c.calls.length,2);
  c.setColor('#ABCDEF'); c.ctx.sync(); c.ctx.sync(); await tick();
  assert.equal(c.calls.length,3); c.writes[2].resolve(); await tick();
  assert.equal(c.calls.length,3);
});
test('curtain serializes disable restoration across reinjection and keeps latest color', async () => {
  const c=curtain(); c.ctx.sync(); await tick();
  c.inject(); c.setColor('#FFFFFF'); c.ctx.sync(true); await tick();
  assert.deepEqual(c.calls,['#123456']);
  c.writes[0].resolve(); await tick(); assert.deepEqual(c.calls,['#123456','#FFFFFF']);
  c.writes[1].resolve(); await tick(); assert.equal(c.window.__ag_last_curtain_hex,'#FFFFFF');
});
test('curtain never calls native writer in Swarm', async () => {
  const c=curtain(true); c.ctx.sync(true); await tick(); assert.equal(c.calls.length,0);
});
function zoom() {
  let factor=1, count=0, now=1000, id=0; const timers=new Map();
  const window={electronNative:{getZoomLevel:()=>factor, zoomIn:()=>{count++;factor+=0.2;},zoomOut:()=>{count++;factor-=0.2;}, resetZoom:()=>{count++;factor=1;}}, addEventListener(){}};
  const ctx=vm.createContext({window,IS_SWARM_PLUGIN_FRAME:false,MODULES:{},detectedOs:'darwin',performance:{now:()=>now},setTimeout:fn=>{timers.set(++id,fn);return id;},clearTimeout:key=>timers.delete(key)});
  const init=section(runtime,'  // Cancel callbacks captured','  // 执行上一轮');
  const code=section(runtime,'  try {\n    const initZoom','  if (!window.__ag_zoom_guard_installed)');
  const inject=()=>vm.runInContext('(() => {'+init+code+'})()',ctx); inject();
  return {window,ctx,inject,timers,count:()=>count,setFactor:x=>{factor=x;},press:key=>window.__ag_zoom_keydown_fn({key,code:key==='0'?'Digit0':'Equal',metaKey:true,preventDefault(){},stopPropagation(){}}), flush:()=>{now+=100;for(const fn of [...timers.values()])fn();timers.clear();}};
}
test('zoom reset at factor one cancels pending zoom', () => {
  const z=zoom(); z.press('+'); assert.equal(z.timers.size,1); z.press('0'); z.flush(); assert.equal(z.count(),0);
});
test('zoom native short circuit cancels pending callback even if factor later returns', () => {
  const z=zoom(); z.press('+'); z.setFactor(1.2); z.press('+'); z.setFactor(1); z.flush(); assert.equal(z.count(),0);
});
test('zoom reinjection cancels previous callback when module is disabled', () => {
  const z=zoom(); z.press('+'); z.ctx.MODULES.zoomShortcuts=false; z.inject(); z.flush(); assert.equal(z.count(),0);
});
test('zoom ordinary key still applies exactly once', () => {
  const z=zoom(); z.press('+'); z.flush(); assert.equal(z.count(),1);
});
test('frame guard admits top and Swarm but excludes preview frames', () => {
  const guard=section(runtime,'  const IS_SWARM_PLUGIN_FRAME','  const PATCH_VERSION');
  for(const [href,top,accepted] of [['https://localhost/',true,true],['https://localhost/preview',false,false],['plugin://swarm--official/index',false,true],['plugin://other/index',false,false]]) {
    const u=new URL(href); const window={location:{protocol:u.protocol,hostname:u.hostname,href}}; window.top=top?window:{};
    const ctx=vm.createContext({window,boot:{}}); vm.runInContext('(function(){'+guard+'globalThis.accepted=true;})()',ctx); assert.equal(!!ctx.accepted,accepted,href);
  }
});
test('daemon explicit origin arrays remain restrictive and defaults include Swarm', () => {
  const defaults=section(daemon,'  const DEFAULT_ALLOWED_ORIGINS','  activeConfig =');
  const expression=daemon.match(/allowedOrigins: Array\.isArray\(userCfg\.allowedOrigins\)([\s\S]*?),\n    endpoints/);
  assert.ok(expression);
  const run=userCfg=>vm.runInNewContext(defaults+'Array.isArray(userCfg.allowedOrigins)'+expression[1],{userCfg});
  assert.deepEqual(Array.from(run({allowedOrigins:[]})),[]);
  assert.deepEqual(Array.from(run({allowedOrigins:['https://localhost:1234/']})),['https://localhost:1234/']);
  assert.ok(run({}).includes('plugin://swarm--'));
});

// All filesystem/service operations are in-memory stubs. No launchctl or real sleeps.
test('macOS service status requires a PID, not merely a loaded job', () => {
  const installer = fs.readFileSync(new URL('../install.mjs', import.meta.url), 'utf8');
  const code = section(installer, 'function registerSystemService(', 'async function runInstall(');
  for (const [status, stdout, expected] of [
    [0, 'state = waiting\n', false],
    [0, 'state = running\npid = 12345\n', true],
    [1, 'pid = 12345\n', false],
  ]) {
    const calls = [], files = new Map();
    const ctx = vm.createContext({
      path, os: { homedir: () => '/fake-home' },
      process: { platform: 'darwin', execPath: '/fake-node', getuid: () => 501 },
      fs: { mkdirSync() {}, existsSync: p => files.has(p), readFileSync: p => files.get(p), writeFileSync: (p, value) => files.set(p, value) },
      Atomics: { wait() {} },
      spawnSync: (bin, args) => {
        assert.equal(bin, 'launchctl'); calls.push(args[0]);
        return args[0] === 'print' ? { status, stdout } : { status: 0 };
      },
    });
    vm.runInContext(code + '\nglobalThis.register = registerSystemService;', ctx);
    assert.equal(ctx.register('/fake-target', '/fake-daemon').runningNow, expected);
    // Reinstall exercises the unchanged-plist kickstart path as well.
    assert.equal(ctx.register('/fake-target', '/fake-daemon').runningNow, expected);
    assert.ok(calls.includes('kickstart'));
  }
});
