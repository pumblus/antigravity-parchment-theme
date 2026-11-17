import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../install.mjs', import.meta.url), 'utf8');
const fn = (name, next) => source.slice(source.indexOf(name), source.indexOf(next, source.indexOf(name)));
const allowCode = fn('function isAllowedOrigin(', '\nfunction fetchTargetsFromPort');
function harness(states) {
  const commands = [];
  class Socket {
    handlers = {};
    constructor(url) { this.id = url.slice(5); queueMicrotask(() => this.handlers.open()); }
    addEventListener(name, cb) { this.handlers[name] = cb; }
    close() {}
    send(raw) { const cmd = JSON.parse(raw); commands.push(cmd); queueMicrotask(() => this.handlers.message({data: JSON.stringify({id:cmd.id,result:{result:{value:states[this.id]}}})})); }
  }
  const context = vm.createContext({ URL, WebSocket: Socket, setTimeout, clearTimeout, fs: { existsSync: () => false },
    fetchTargetsFromPort: async () => Object.keys(states).map(id => ({id, type:'page', title:id, url:'http://localhost:3000/'+id, webSocketDebuggerUrl:'ws://'+id})) });
  vm.runInContext(allowCode + fn('async function inspectLiveWindow(', '\n// ============================================================================\n// 3.') + '\nglobalThis.inspect = inspectLiveWindow; globalThis.allowed=isAllowedOrigin;', context);
  return {inspect:context.inspect,allowed:context.allowed,commands};
}
test('v542 diagnostics skip local previews and choose verified styled workbench', async () => {
  const h = harness({preview:{__isHost:false,hasStyle:true},loading:null,host1:{__isHost:true,hasStyle:false},host2:{__isHost:true,hasStyle:true,bodyReady:true}});
  const result = await h.inspect(null);
  assert.equal(result.targetId,'host2'); assert.equal(result.state.hasStyle,true);
  assert.equal(Object.hasOwn(result.state,'__isHost'),false);
  assert.ok(h.commands.every(m => m.method==='Runtime.evaluate'));
});
test('v542 diagnostics never label unreadable or nonhost page as workbench', async () => {
  const h = harness({preview:{__isHost:false},loading:null}); const result = await h.inspect(null);
  assert.equal(result.pages,0); assert.equal(result.targetId,undefined); assert.match(result.reason,/No active workbench/);
});
test('v542 diagnostics retain verified host without style for useful failure report', async () => {
  const h = harness({preview:{__isHost:false},host:{__isHost:true,hasStyle:false,bodyReady:true}});
  const result = await h.inspect(null); assert.equal(result.targetId,'host'); assert.equal(result.state.hasStyle,false);
});
test('v542 diagnostics URL gate rejects localhost-prefix spoofing and credentials', () => {
  const h = harness({});
  for(const url of ['http://localhost:3000/a','https://127.0.0.1:9000/','vscode-file://vscode-app/index.html']) assert.equal(h.allowed(url),true,url);
  for(const url of ['http://localhost.evil.test/','http://127.0.0.10/','http://localhost@evil.test/','http://user@localhost/','file:///tmp/index.html','bad']) assert.equal(h.allowed(url),false,url);
});
test('v542 verify success requires actual injected host and body, not no-target result', () => {
  assert.match(source,/const ok = Boolean\(live\.reachable && live\.state\?\.hasStyle && live\.state\?\.bodyReady\)/);
  assert.doesNotMatch(fn('async function runVerify(', '\nasync function'),/live\.pages === 0/);
});
