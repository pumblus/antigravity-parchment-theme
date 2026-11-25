import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
const source = fs.readFileSync(new URL('../install.mjs', import.meta.url), 'utf8');
const names = ['daemon.mjs', 'runtime.js', 'theme.css', 'i18n.json'];
function core(dir, label = 'old') {
  fs.mkdirSync(dir, { recursive: true });
  const files = {};
  for (const name of names) {
    const bytes = Buffer.from(`${label}:${name}\n`); fs.writeFileSync(path.join(dir, name), bytes);
    files[name] = { bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ name: 'chuanban-antigravity-theme-patch', version: label, files }));
}
function harness(t, options = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-v520-test-')); t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const home = path.join(tmp, 'home'), src = path.join(tmp, 'source'), target = path.join(tmp, 'target');
  fs.mkdirSync(home); core(path.join(src, 'core'), 'new'); fs.mkdirSync(path.join(src, 'user'));
  fs.writeFileSync(path.join(src, 'user/config.json'), '{"enabled":true,"channel":"auto","preset":"high-contrast"}\n');
  for (const file of ['custom.css', 'custom.js', 'i18n.override.json']) fs.writeFileSync(path.join(src, 'user', file), 'template');
  for (const doc of ['install.mjs', 'README.md', 'SKILL.md', 'FORK.md', 'CHANGELOG.md']) fs.writeFileSync(path.join(src, doc), 'fixture');
  const calls = [];
  const denied = name => (...args) => { calls.push([name, ...args]); throw new Error('Unexpected host effect: ' + name); };
  const context = vm.createContext({ fs: options.fs || fs, path, os: { homedir: () => home, tmpdir: () => tmp }, crypto, Buffer, pathToFileURL,
    process: { argv: ['node', path.join(src, 'install.mjs')], platform: 'darwin', versions: { node: '24.0.0' }, execPath: '/fake/node', pid: 42, env: {}, getuid: () => 501, emitWarning() {}, kill: denied('kill'), exit(code) { throw new Error('exit ' + code); } },
    console: { log() {}, warn() {}, error() {} }, execSync: denied('execSync'), spawnSync: denied('spawnSync'), spawn: denied('spawn'),
    Atomics: { wait() {} }, Int32Array, SharedArrayBuffer,
  });
  let code = source.replace(/^import .*;\n/gm, '').replace('const __filename = fileURLToPath(import.meta.url);', `const __filename = ${JSON.stringify(path.join(src, 'install.mjs'))};`);
  code = code.slice(0, code.indexOf('switch (subcommand)'));
  code += `\ndetectEnvironment = async () => { hostCalls.push('detect'); return {nodeBasicOk:true}; }; inspectLiveWindow = async () => { hostCalls.push('inspect'); return {}; }; stopRunningDaemonProcesses = () => hostCalls.push('stop');\nglobalThis.api = {runInstall, runRollback, runUninstall, isValidCoreBackup, canonicalPath, isSameTargetPath, buildDistZip, registerSystemService}; globalThis.setArgs = values => args.splice(0,args.length,...values);`;
  context.hostCalls = calls;
  vm.runInContext(code, context);
  return { tmp, src, target, home, calls, ctx: context, api: context.api,
    run: (command, flags = ['--target-dir', target]) => { context.setArgs([command, ...flags]); return context.api['run' + command[0].toUpperCase() + command.slice(1)](); } };
}

test('v520 isolated install/reinstall/rollback/uninstall preserve every user byte and host state', async t => {
  const h = harness(t); core(path.join(h.target, 'core'));
  fs.mkdirSync(path.join(h.target, 'user'));
  const userFiles = { 'config.json': '{ "selectors": {"excludeI18n":".mine"} }\r\n', 'custom.css': 'personal\r\n', 'custom.js': 'mine;', 'i18n.override.json': '{ }\n' };
  for (const [name, bytes] of Object.entries(userFiles)) fs.writeFileSync(path.join(h.target, 'user', name), bytes);
  await h.run('install', ['--target-dir', h.target, '--sync-user']);
  assert.equal(fs.readFileSync(path.join(h.target, 'core/daemon.mjs'), 'utf8'), 'new:daemon.mjs\n');
  assert.equal(fs.readFileSync(path.join(h.target, 'FORK.md'), 'utf8'), 'fixture');
  assert.equal(fs.readFileSync(path.join(h.target, 'CHANGELOG.md'), 'utf8'), 'fixture');
  const before = fs.readFileSync(path.join(h.target, 'core.prev/manifest.json'), 'utf8');
  await h.run('install'); assert.equal(fs.readFileSync(path.join(h.target, 'core.prev/manifest.json'), 'utf8'), before);
  await h.run('rollback'); assert.equal(fs.readFileSync(path.join(h.target, 'core/daemon.mjs'), 'utf8'), 'old:daemon.mjs\n');
  await h.run('uninstall');
  for (const [name, bytes] of Object.entries(userFiles)) assert.equal(fs.readFileSync(path.join(h.target, 'user', name), 'utf8'), bytes, name);
  assert.deepEqual(h.calls, []); assert.deepEqual(fs.readdirSync(h.home), []);
});

test('v520 backup validation rejects incomplete, malformed, hash/size mismatched and linked snapshots', t => {
  const h = harness(t); const dir = path.join(h.tmp, 'backup');
  const reset = () => { fs.rmSync(dir, { recursive: true, force: true }); core(dir); };
  reset(); assert.equal(h.api.isValidCoreBackup(dir), true);
  for (const file of ['manifest.json', ...names]) { reset(); fs.unlinkSync(path.join(dir, file)); assert.equal(h.api.isValidCoreBackup(dir), false, file); }
  for (const modify of [m => {m.files = {};}, m => {m.files['theme.css'].bytes++;}, m => {m.files['theme.css'].sha256 = '0'.repeat(64);}, m => {m.files['../outside'] = m.files['theme.css'];}, m => {m.name = 'user-backup';}]) {
    reset(); const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'))); modify(manifest); fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest)); assert.equal(h.api.isValidCoreBackup(dir), false);
  }
  reset(); fs.writeFileSync(path.join(dir, 'manifest.json'), '{bad'); assert.equal(h.api.isValidCoreBackup(dir), false);
  reset(); fs.writeFileSync(path.join(dir, 'extra.js'), 'unexpected'); assert.equal(h.api.isValidCoreBackup(dir), false);
  reset(); fs.renameSync(path.join(dir, 'theme.css'), path.join(h.tmp, 'external.css')); fs.symlinkSync(path.join(h.tmp, 'external.css'), path.join(dir, 'theme.css')); assert.equal(h.api.isValidCoreBackup(dir), false);
  reset(); const alias = path.join(h.tmp, 'alias'); fs.symlinkSync(dir, alias); assert.equal(h.api.isValidCoreBackup(alias), false);
});

test('v520 rollback skips user backups and invalid newest snapshots, preserving core if none valid', async t => {
  const h = harness(t); core(path.join(h.target, 'core'), 'current'); core(path.join(h.target, 'core.prev'), 'broken');
  fs.unlinkSync(path.join(h.target, 'core.prev/theme.css'));
  core(path.join(h.target, 'backups/999-user'), 'user'); core(path.join(h.target, 'backups/998-bad'), 'bad'); fs.writeFileSync(path.join(h.target, 'backups/998-bad/runtime.js'), 'bad');
  await assert.rejects(h.run('rollback'), /exit 1/); assert.equal(fs.readFileSync(path.join(h.target, 'core/daemon.mjs'), 'utf8'), 'current:daemon.mjs\n');
  core(path.join(h.target, 'backups/100-valid'), 'valid'); await h.run('rollback');
  assert.equal(fs.readFileSync(path.join(h.target, 'core/daemon.mjs'), 'utf8'), 'valid:daemon.mjs\n'); assert.deepEqual(h.calls, []);
});

test('v520 symlink-equivalent explicit targets and nonexistent suffixes stay isolated', async t => {
  const h = harness(t); const global = path.join(h.home, '.gemini/antigravity/theme-patch');
  core(path.join(global, 'core'), 'old'); const alias = path.join(h.tmp, 'alias'); fs.symlinkSync(global, alias);
  assert.equal(h.api.isSameTargetPath(alias, global), true);
  assert.equal(h.api.canonicalPath(path.join(alias, 'new/deep')), path.join(fs.realpathSync(global), 'new/deep'));
  await h.run('install', ['--target-dir', alias]); await h.run('install', ['--target-dir', global]);
  await h.run('rollback', ['--target-dir', alias]); await h.run('uninstall', ['--target-dir', alias]);
  assert.deepEqual(h.calls, []); assert.equal(fs.existsSync(path.join(h.home, '.gemini/antigravity/scripts')), false);
});

test('v520 rejects global-service override for isolated lifecycle commands', async t => {
  const h = harness(t);
  for (const command of ['install', 'rollback', 'uninstall']) await assert.rejects(h.run(command, ['--target-dir', h.target, '--register-service']), /not supported.*isolated/);
  assert.deepEqual(h.calls, []); assert.equal(fs.existsSync(h.target), false);
});

test('v520 install refuses escaped user symlinks and preserves last valid backup on corrupt upgrade', async t => {
  const h = harness(t); fs.mkdirSync(h.target); const external = path.join(h.tmp, 'external'); fs.mkdirSync(external); fs.symlinkSync(external, path.join(h.target, 'user'));
  await assert.rejects(h.run('install'), /escapes/); assert.deepEqual(fs.readdirSync(external), []);
  fs.unlinkSync(path.join(h.target, 'user')); core(path.join(h.target, 'core'), 'corrupt'); fs.unlinkSync(path.join(h.target, 'core/theme.css')); core(path.join(h.target, 'core.prev'), 'safe');
  await h.run('install'); assert.equal(fs.readFileSync(path.join(h.target, 'core.prev/daemon.mjs'), 'utf8'), 'safe:daemon.mjs\n');
});

test('v520 rollback copy failure retains installed core', async t => {
  const safeFs = Object.create(fs); safeFs.copyFileSync = (src, dest) => { if (String(dest).includes('.rollback-')) throw new Error('simulated copy failure'); return fs.copyFileSync(src, dest); };
  const h = harness(t, { fs: safeFs }); core(path.join(h.target, 'core'), 'current'); core(path.join(h.target, 'core.prev'), 'old');
  await assert.rejects(h.run('rollback'), /simulated copy failure/);
  assert.equal(fs.readFileSync(path.join(h.target, 'core/daemon.mjs'), 'utf8'), 'current:daemon.mjs\n');
});

test('v520 default global install still registers and injects using stubs only', async t => {
  const h = harness(t); vm.runInContext("registerSystemService = () => { hostCalls.push('register'); return {}; }; spawnSync = () => { hostCalls.push('inject'); return {status:0}; };", h.ctx);
  await h.run('install', []);
  assert.deepEqual(h.calls, ['detect', 'register', 'inject', 'inspect']);
  assert.equal(fs.existsSync(path.join(h.home, '.gemini/antigravity/scripts/antigravity-font-daemon.mjs')), true);
});

test('v520 LaunchAgent runningNow requires PID, not loaded state', t => {
  const h = harness(t); h.ctx.pidOutput = 'state = waiting';
  vm.runInContext("spawnSync = () => ({status:0, stdout:pidOutput});", h.ctx);
  assert.equal(h.api.registerSystemService(h.target, '/fake/wrapper').runningNow, false);
  h.ctx.pidOutput = 'state = running\npid = 123'; assert.equal(h.api.registerSystemService(h.target, '/fake/wrapper').runningNow, true);
});

test('v520 keeps macOS-only fork packaging and version', () => {
  assert.doesNotMatch(source, /win32|powershell|schtasks|WScript\.Shell|systemd|fc-cache/i);
  assert.doesNotMatch(source, /hasFlag\(['"]--sync-user/);
  assert.match(source, /version: '5\.5\.5-eric\.1'/);
  assert.match(source, /https:\/\/github.com\/pumblus\/chuanban-antigravity-theme-patch/);
  const pack = source.slice(source.indexOf('function buildDistZip'), source.indexOf('function verifyCoreIntegrity'));
  assert.match(pack, /'FORK\.md'/); assert.match(pack, /'CHANGELOG\.md'/);
});

test('v520 rollback rename failure restores the previous core', async t => {
  const safeFs = Object.create(fs); safeFs.renameSync = (src, dest) => {
    if (String(src).includes('.rollback-') && path.basename(src) === 'core') throw new Error('simulated rename failure');
    return fs.renameSync(src, dest);
  };
  const h = harness(t, { fs: safeFs }); core(path.join(h.target, 'core'), 'current'); core(path.join(h.target, 'core.prev'), 'old');
  await assert.rejects(h.run('rollback'), /simulated rename failure/);
  assert.equal(fs.readFileSync(path.join(h.target, 'core/daemon.mjs'), 'utf8'), 'current:daemon.mjs\n');
});

test('v520 global rollback/uninstall use only simulated service calls and preserve config', async t => {
  const h = harness(t); const global = path.join(h.home, '.gemini/antigravity/theme-patch');
  core(path.join(global, 'core'), 'current'); core(path.join(global, 'core.prev'), 'old');
  fs.mkdirSync(path.join(global, 'user')); const original = '{ "enabled": true, "selectors": { "x": "y" } }\r\n';
  fs.writeFileSync(path.join(global, 'user/config.json'), original);
  vm.runInContext("execSync = () => { hostCalls.push('exec'); return ''; }; spawnSync = () => { hostCalls.push('spawn'); return {status:1}; };", h.ctx);
  await h.run('rollback', []); assert.equal(fs.readFileSync(path.join(global, 'core/daemon.mjs'), 'utf8'), 'old:daemon.mjs\n');
  await h.run('uninstall', []); assert.equal(fs.readFileSync(path.join(global, 'user/config.json'), 'utf8'), original);
  assert.ok(h.calls.includes('stop')); assert.ok(h.calls.includes('exec')); assert.ok(h.calls.includes('spawn'));
});

test('v520 uninstall restores exact config bytes when simulated injection throws', async t => {
  const h = harness(t); const global = path.join(h.home, '.gemini/antigravity/theme-patch'); core(path.join(global, 'core'));
  fs.mkdirSync(path.join(global, 'user')); const original = '{ "enabled": true }\r\n'; fs.writeFileSync(path.join(global, 'user/config.json'), original);
  vm.runInContext("execSync = () => ''; spawnSync = command => { if(command === '/fake/node') throw new Error('injection failed'); return {status:1}; };", h.ctx);
  await assert.rejects(h.run('uninstall', []), /injection failed/);
  assert.equal(fs.readFileSync(path.join(global, 'user/config.json'), 'utf8'), original);
});

test('v520 changed and corrupt cores are preserved byte-for-byte in excluded quarantine', async t => {
  const h = harness(t); core(path.join(h.target, 'core'), 'changed'); core(path.join(h.target, 'core.prev'), 'safe');
  const originals = { 'theme.css': Buffer.from('/* hand edited */\r\n'), 'extra.bin': Buffer.from([0, 255, 13, 10]), 'manifest.json': Buffer.from('{malformed\r\n') };
  for (const [name, bytes] of Object.entries(originals)) fs.writeFileSync(path.join(h.target, 'core', name), bytes);
  fs.mkdirSync(path.join(h.target, 'core/empty')); fs.symlinkSync('extra.bin', path.join(h.target, 'core/link'));
  await h.run('install');
  const dir = path.join(h.target, 'backups', fs.readdirSync(path.join(h.target, 'backups')).find(n => n.includes('-invalid-')), 'snapshot');
  for (const [name, bytes] of Object.entries(originals)) assert.deepEqual(fs.readFileSync(path.join(dir, name)), bytes);
  assert.equal(fs.readlinkSync(path.join(dir, 'link')), 'extra.bin'); assert.ok(fs.statSync(path.join(dir, 'empty')).isDirectory());
  assert.equal(fs.readFileSync(path.join(h.target, 'core.prev/daemon.mjs'), 'utf8'), 'safe:daemon.mjs\n');
  fs.rmSync(path.join(h.target, 'core.prev'), { recursive: true });
  // Even if somebody repairs a quarantined manifest, it remains excluded from auto rollback.
  fs.rmSync(dir, { recursive: true }); core(dir, 'quarantine');
  await assert.rejects(h.run('rollback'), /exit 1/);
  assert.equal(fs.readFileSync(path.join(h.target, 'core/daemon.mjs'), 'utf8'), 'new:daemon.mjs\n');
});

test('v520 snapshot corruption or copy failure aborts before deleting installed core', async t => {
  for (const fail of ['throw', 'corrupt']) {
    const safeFs = Object.create(fs); safeFs.cpSync = (src, dest, opts) => {
      if (fail === 'throw') throw new Error('snapshot copy failed');
      fs.cpSync(src, dest, opts); fs.writeFileSync(path.join(dest, 'theme.css'), 'corrupted copy');
    };
    const h = harness(t, { fs: safeFs }); core(path.join(h.target, 'core'), 'original');
    await assert.rejects(h.run('install'), /snapshot (copy|verification) failed/i);
    for (const name of names) assert.equal(fs.readFileSync(path.join(h.target, 'core', name), 'utf8'), `original:${name}\n`);
    assert.deepEqual(h.calls, []);
  }
});

test('v520 rollback accepts verified snapshot containers after core.prev is missing', async t => {
  const h = harness(t); core(path.join(h.target, 'core'), 'old'); await h.run('install');
  fs.rmSync(path.join(h.target, 'core.prev'), { recursive: true }); await h.run('rollback');
  assert.equal(fs.readFileSync(path.join(h.target, 'core/daemon.mjs'), 'utf8'), 'old:daemon.mjs\n');
});

test('v530 shipped core installs and rolls back only inside a temporary target', async t => {
  const h = harness(t); const shipped = new URL('../core/', import.meta.url);
  for (const name of [...names, 'manifest.json']) fs.copyFileSync(new URL(name, shipped), path.join(h.src, 'core', name));
  core(path.join(h.target, 'core'), 'previous-fusion');
  fs.mkdirSync(path.join(h.target, 'user')); const config = '{ "contextLimit": 840000, "modules":{"coldBootHealer":false}, "selectors":{"excludeI18n":".mine"} }\r\n';
  fs.writeFileSync(path.join(h.target, 'user/config.json'), config);
  await h.run('install');
  assert.equal(h.api.isValidCoreBackup(path.join(h.target, 'core')), true);
  for (const name of names) assert.deepEqual(fs.readFileSync(path.join(h.target, 'core', name)), fs.readFileSync(new URL(name, shipped)), name);
  await h.run('rollback');
  assert.equal(fs.readFileSync(path.join(h.target, 'core/daemon.mjs'), 'utf8'), 'previous-fusion:daemon.mjs\n');
  assert.equal(fs.readFileSync(path.join(h.target, 'user/config.json'), 'utf8'), config);
  assert.deepEqual(h.calls, []); assert.deepEqual(fs.readdirSync(h.home), []);
});
