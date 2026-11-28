import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('v555 adds 2.34.0 Orchestrator localization entries without collisions', () => {
  const raw = read('core/i18n.json');
  const dict = JSON.parse(raw);
  const keys = [...raw.matchAll(/^  ("(?:[^"\\]|\\.)*"):/gm)].map((m) => JSON.parse(m[1]));

  assert.equal(Object.keys(dict).length, 2258);
  assert.equal(keys.length, 2258);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(new Set(keys.map((k) => k.toLowerCase().replace(/[\u2018\u2019]/g, "'"))).size, keys.length);

  assert.equal(
    dict[
      'Choose the models Orchestrator uses. A larger, smarter orchestrator model with a faster, cheaper executor gives high quality for fewer tokens.'
    ],
    '选择编排器使用的模型组合。将更强的高阶编排模型与更快、更省的执行模型搭配，可在保持高质量的同时消耗更少 Token。'
  );
  assert.equal(
    dict['Offloads routine steps to a faster executor. Same quality, fewer tokens used.'],
    '将常规步骤分流至更快的执行模型。保持同等质量，消耗更少 Token。'
  );
});

test('v555 ships MIT LICENSE, packs it in dist zip, and keeps macOS-only daemon boundary', () => {
  const license = read('LICENSE');
  assert.match(license, /^MIT License\b/);
  assert.match(license, /Copyright \(c\) 2026 忒修斯的船板 \(Anarcadia\)/);

  const installSrc = read('install.mjs');
  const includeBlock = installSrc.slice(
    installSrc.indexOf('const includeItems = ['),
    installSrc.indexOf('].filter(', installSrc.indexOf('const includeItems = ['))
  );
  assert.match(includeBlock, /'LICENSE'/);

  const daemonSrc = read('core/daemon.mjs');
  const runtimeSrc = read('core/runtime.js');
  assert.match(daemonSrc, /const BASE_VERSION = '20261128-v6\.0\.6-eric\.1';/);
  assert.match(runtimeSrc, /const PATCH_VERSION = boot\.version \|\| '20261128-v6\.0\.6-eric\.1';/);
  assert.doesNotMatch(daemonSrc, /KEEP_ALIVE_ONLY|ag-theme-daemon\.log/);
  assert.doesNotMatch(installSrc, /inspectWindowsTaskXmlTriggers|inspectWindowsKeepAliveTask/);
});
