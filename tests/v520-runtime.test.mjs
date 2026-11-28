import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const runtime = fs.readFileSync(new URL('../core/runtime.js', import.meta.url), 'utf8');
const daemon = fs.readFileSync(new URL('../core/daemon.mjs', import.meta.url), 'utf8');
const slice = (src, a, b) => {
  const start = src.indexOf(a);
  const end = src.indexOf(b, start);
  assert.ok(start >= 0 && end > start, a);
  return src.slice(start, end);
};

test('legacy coldBootHealer and __agRequestHardReload dead code are removed from runtime and daemon', () => {
  assert.doesNotMatch(runtime, /coldBootHealer|__agRequestHardReload|__ag_commit_coldboot_reload|__ag_coldboot_timer/);
  assert.doesNotMatch(daemon, /coldBootHealer|__agRequestHardReload|lastHardReloadAt/);
});

test('macOS PID validation distinguishes live, missing, self and EPERM states without spawning', () => {
  const code = slice(daemon, 'function checkDaemonPidState(', '\nconst pidKey');
  const run = (pid, killImpl) => {
    const ctx = vm.createContext({ process: { pid: 10, kill: killImpl } });
    vm.runInContext(code + 'globalThis.check=checkDaemonPidState;', ctx);
    return ctx.check(pid);
  };
  assert.equal(run(10, () => {}), 'not_daemon');
  assert.equal(run(123, () => {}), 'confirmed');
  assert.equal(
    run(123, () => {
      const e = Error('perm');
      e.code = 'EPERM';
      throw e;
    }),
    'uncertain'
  );
  assert.equal(
    run(123, () => {
      const e = Error('missing');
      e.code = 'ESRCH';
      throw e;
    }),
    'not_daemon'
  );
});

test('local metrics directory resolution resolves primary path cleanly without WSL code', () => {
  assert.doesNotMatch(daemon, /resolveWin32WslConversationsDirs|wslUncBackoffUntil|isUncPath|spawnSync/);
  const ctx = vm.createContext({ path, TextDecoder, fs: { existsSync: () => false }, process: { platform: 'darwin' } });
  vm.runInContext(
    slice(daemon, 'const resolvedCascadeDbCache', '\nfunction getDbState') + 'globalThis.resolve=resolveConversationDbPath;',
    ctx
  );
  assert.equal(
    ctx.resolve('a', { conversationsDir: '/explicit', explicitConvDir: true, portFile: '/port' }),
    path.join('/explicit', 'a.db')
  );
});
