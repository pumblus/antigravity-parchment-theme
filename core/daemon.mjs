#!/usr/bin/env node
/**
 * chuanban-antigravity-theme-patch · CDP Theme & Live Metrics Daemon (core/daemon.mjs)
 *
 * 架构特性（融合版 v5.5.2-eric.1 · macOS 专用）：
 * 1. 动态 Node 分级：
 *    - Node >= 22.0：完整启用昼夜双模式独立主题（暖纸浅色 + 暖墨深色）、Anthropic 三族字体、输入框三态、扩展汉化、宿主隔离、Browser 级 CDP 事件发现、死锁修复与实验性冷启动普通重载（默认关闭）及 curtainView/Swarm 适配。
 *    - Node >= 22.13：动态 `await import('node:sqlite')` 解锁底部实时会话指标胶囊（O(1) 增量尾行解析）；低版本优雅降级绝不崩溃。
 * 2. 模块化与热重载：
 *    - 周期性检测 `user/config.json`、`user/custom.css`、`user/i18n.override.json`、`user/custom.js` 的 mtime，
 *      用户或对方 Agent 修改 `user/` 层后 2.5 秒内自动重新构建签名并热更新至所有打开的 Antigravity 窗口。
 * 3. 双通道同进程共生：
 *    - 默认 `channel: "auto"` 同时探测 Stable 与 Insiders 调试端口（亦可通过 `--channel stable|insiders` 锁定单通道）。
 * 4. 安全模式隔离：
 *    - 支持 `--safe-mode` 启动参数，一键绕过 `user/` 改装层，仅加载 `core/` 黄金内核用于故障定界。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const CORE_DIR = path.join(ROOT_DIR, 'core');
const USER_DIR = path.join(ROOT_DIR, 'user');

// ============================================================================
// 0. 动态探测 node:sqlite（Node >= 22.13 自动解锁，低版本优雅降级）
// ============================================================================
let DatabaseSync = null;
try {
  const sqliteMod = await import('node:sqlite').catch(() => null);
  if (sqliteMod && typeof sqliteMod.DatabaseSync === 'function') {
    DatabaseSync = sqliteMod.DatabaseSync;
  }
} catch {
  DatabaseSync = null;
}

// ============================================================================
// 1. CLI 参数解析（同时兼容 --flag value 与 --flag=value）与跨平台路径探测
// ============================================================================
const args = process.argv.slice(2);
const hasFlag = (f) => args.some((a) => a === f || a.startsWith(f + '='));
function getArg(flag, fallback = null) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && i + 1 < args.length) return args[i + 1];
    if (args[i].startsWith(flag + '=')) return args[i].slice(flag.length + 1);
  }
  return fallback;
}

const SAFE_MODE = hasFlag('--safe-mode');
const RUN_ONCE = hasFlag('--once');
const CLI_CHANNEL = getArg('--channel', null);

function readJsonSafe(filePath, fallback = {}) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function readTextSafe(filePath, fallback = '') {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return fallback;
  }
}

function getFileMtimeSig(filePath) {
  try {
    const st = fs.statSync(filePath, { throwIfNoEntry: false });
    return st ? `${st.mtimeMs}:${st.size}` : '0:0';
  } catch {
    return '0:0';
  }
}

function resolveChannelPaths(singleChannel = 'stable', userCfg = {}) {
  const home = os.homedir();
  const isInsiders = singleChannel === 'insiders';
  const appDirName = isInsiders ? 'Antigravity - Insiders' : 'Antigravity';
  const geminiSubDir = isInsiders ? '.gemini/antigravity-insiders' : '.gemini/antigravity';
  const defaultPortFile = path.join(home, 'Library', 'Application Support', appDirName, 'DevToolsActivePort');

  const defaultConvDir = path.join(home, geminiSubDir, 'conversations');
  const dotDir = path.join(home, isInsiders ? '.antigravity-insiders' : '.antigravity');
  const argvPath = path.join(dotDir, 'argv.json');
  let fallbackPort = isInsiders ? 9223 : 9222;
  try {
    if (fs.existsSync(argvPath)) {
      const stripped = fs
        .readFileSync(argvPath, 'utf8')
        .replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');
      const m = stripped.match(/"remote-debugging-port"\s*:\s*(\d+)/);
      const parsedArgvPort = m ? parseInt(m[1], 10) : 0;
      if (Number.isInteger(parsedArgvPort) && parsedArgvPort > 0 && parsedArgvPort <= 65535) {
        fallbackPort = parsedArgvPort;
      }
    }
  } catch {}

  const portFile = getArg('--port-file', userCfg.portFile || defaultPortFile);
  const channelInstalled =
    fs.existsSync(portFile) || fs.existsSync(path.dirname(defaultPortFile)) || fs.existsSync(dotDir);
  const explicitConvDir = getArg('--conversations-dir', userCfg.conversationsDir || '');
  const primaryConvDir = explicitConvDir || defaultConvDir;

  const rawFallbackPort = Number(userCfg.fallbackPort);
  const rawPort = Number(userCfg.port);
  const customFallbackPort =
    Number.isInteger(rawFallbackPort) && rawFallbackPort > 0 && rawFallbackPort <= 65535
      ? rawFallbackPort
      : Number.isInteger(rawPort) && rawPort > 0 && rawPort <= 65535
        ? rawPort
        : 0;

  return {
    channel: singleChannel,
    portFile,
    geminiSubDir,
    explicitConvDir: Boolean(explicitConvDir),
    fallbackPort: customFallbackPort || fallbackPort,
    channelInstalled,
    conversationsDir: primaryConvDir
  };
}

function resolveActiveChannelEndpoints(channelMode = 'auto', userCfg = {}) {
  const explicitPortFile = getArg('--port-file', userCfg.portFile || '');
  if (explicitPortFile) {
    const ch = channelMode === 'insiders' ? 'insiders' : 'stable';
    return [resolveChannelPaths(ch, userCfg)];
  }
  if (channelMode === 'stable') {
    return [resolveChannelPaths('stable', userCfg)];
  }
  if (channelMode === 'insiders') {
    return [resolveChannelPaths('insiders', userCfg)];
  }
  // 'auto' 或 'both'：同时轮询 Stable 与 Insiders 两个通道，互不抢占
  return [resolveChannelPaths('stable', userCfg), resolveChannelPaths('insiders', userCfg)];
}

// ============================================================================
// 2. 动态构建注入载荷（支持 core/ + user/ 实时合并与热更新签名）
// ============================================================================
const BASE_VERSION = '20261120-v5.5.2-eric.1';
let cachedBundleSig = '';
let cachedInjectScript = '';
let cachedPatchVersion = '';
let metricsConfigEpoch = 0;
const lastBestEffortPayloadCache = new Map(); // initialized before the first bundle rebuild
const metricsCache = new Map(); // dbPath -> { sig, payload }
const incrementalMetricsMap = new Map(); // dbPath -> { rowCount, maxIdx, userStepsCount, lastUserStepIdx, items, validItems, totalIn, totalCache, totalOut, totalThink, totalResp }
const MAX_METRICS_CACHE_SIZE = 30;

function setMetricsCache(dbPath, entry) {
  if (metricsCache.has(dbPath)) metricsCache.delete(dbPath);
  metricsCache.set(dbPath, entry);
  if (metricsCache.size > MAX_METRICS_CACHE_SIZE) {
    const oldestKey = metricsCache.keys().next().value;
    if (oldestKey) {
      metricsCache.delete(oldestKey);
      incrementalMetricsMap.delete(oldestKey);
    }
  }
}

function setIncrementalMetrics(dbPath, state) {
  if (incrementalMetricsMap.has(dbPath)) incrementalMetricsMap.delete(dbPath);
  incrementalMetricsMap.set(dbPath, state);
  if (incrementalMetricsMap.size > MAX_METRICS_CACHE_SIZE) {
    const oldestKey = incrementalMetricsMap.keys().next().value;
    if (oldestKey) incrementalMetricsMap.delete(oldestKey);
  }
}

let activeConfig = {
  enabled: true,
  channel: 'auto',
  preset: 'high-contrast',
  contextLimit: 256000,
  contextLimitOverride: 0,
  modules: {
    i18n: true,
    metrics: true,
    composerWaxSeal: true,
    deadlockHealer: true,
    coldBootHealer: false,
    zoomShortcuts: true,
    cdpEventDiscovery: true,
    customCss: true,
    customJs: true
  },
  themeVars: {},
  allowedOrigins: [
    'http://127.0.0.1',
    'https://127.0.0.1',
    'http://localhost',
    'https://localhost',
    'vscode-file://',
    'plugin://swarm--'
  ],
  endpoints: []
};

function normalizeOverrideDict(rawObj) {
  if (!rawObj || typeof rawObj !== 'object') return {};
  const source = rawObj.exact && typeof rawObj.exact === 'object' ? rawObj.exact : rawObj;
  const clean = {};
  for (const [k, v] of Object.entries(source)) {
    if (k.startsWith('_')) continue;
    if (typeof v === 'string') {
      clean[k] = v;
    }
  }
  return clean;
}

const HOST_CONFIG_PATH = path.join(os.homedir(), '.gemini', 'config', 'config.json');
let cachedHostCfgFileSig = '';
let cachedHostThemeMode = null;

function readHostThemeMode() {
  const fileSig = getFileMtimeSig(HOST_CONFIG_PATH);
  if (fileSig === cachedHostCfgFileSig) {
    return cachedHostThemeMode;
  }
  cachedHostCfgFileSig = fileSig;
  if (fileSig === '0:0') {
    cachedHostThemeMode = null;
    return null;
  }
  try {
    const hostCfg = readJsonSafe(HOST_CONFIG_PATH, {});
    const raw = String(hostCfg?.userSettings?.themeMode || '').toUpperCase();
    if (raw === 'THEME_MODE_DARK') cachedHostThemeMode = 'dark';
    else if (raw === 'THEME_MODE_LIGHT') cachedHostThemeMode = 'light';
    else if (raw === 'THEME_MODE_INHERIT') cachedHostThemeMode = 'inherit';
    else cachedHostThemeMode = null;
  } catch {
    cachedHostThemeMode = null;
  }
  return cachedHostThemeMode;
}

function rebuildBundleIfNeeded() {
  const coreFiles = [
    path.join(CORE_DIR, 'theme.css'),
    path.join(CORE_DIR, 'i18n.json'),
    path.join(CORE_DIR, 'runtime.js')
  ];
  const userFiles = SAFE_MODE
    ? []
    : [
        path.join(USER_DIR, 'config.json'),
        path.join(USER_DIR, 'custom.css'),
        path.join(USER_DIR, 'i18n.override.json'),
        path.join(USER_DIR, 'custom.js')
      ];

  const hostThemeMode = readHostThemeMode();
  const sig =
    [...coreFiles, ...userFiles].map(getFileMtimeSig).join('|') +
    `|hostTheme:${hostThemeMode || ''}|safe:${SAFE_MODE}|cli:${CLI_CHANNEL || ''}`;
  if (sig === cachedBundleSig && cachedInjectScript) {
    return false;
  }

  const userCfg = SAFE_MODE ? {} : readJsonSafe(path.join(USER_DIR, 'config.json'), {});
  const enabled = SAFE_MODE ? true : userCfg.enabled !== false;
  const channel = CLI_CHANNEL || userCfg.channel || 'auto';
  const preset = userCfg.preset || 'high-contrast';
  const rawCtxLimit = Number(userCfg.contextLimit);
  const contextLimit = Number.isFinite(rawCtxLimit) && rawCtxLimit > 0 ? rawCtxLimit : 256000;
  const rawCtxOverride = Number(userCfg.contextLimitOverride);
  const contextLimitOverride = Number.isFinite(rawCtxOverride) && rawCtxOverride > 0 ? rawCtxOverride : 0;
  if (
    activeConfig &&
    (contextLimit !== activeConfig.contextLimit || contextLimitOverride !== activeConfig.contextLimitOverride)
  ) {
    metricsCache.clear();
    lastBestEffortPayloadCache.clear();
    metricsConfigEpoch += 1;
  }

  const rawModules = Object.assign({}, userCfg.features || {}, userCfg.modules || {});
  if (typeof rawModules.metricsCapsule === 'boolean' && typeof rawModules.metrics !== 'boolean') {
    rawModules.metrics = rawModules.metricsCapsule;
  }
  const modules = Object.assign(
    {
      i18n: true,
      metrics: true,
      composerWaxSeal: true,
      deadlockHealer: true,
      coldBootHealer: false,
      zoomShortcuts: true,
      cdpEventDiscovery: true,
      customCss: true,
      customJs: true
    },
    rawModules
  );
  if (!DatabaseSync) {
    modules.metrics = false;
  }
  modules.metricsCapsule = modules.metrics;

  const themeVars = !SAFE_MODE && userCfg.themeVars && typeof userCfg.themeVars === 'object' ? userCfg.themeVars : {};
  const endpoints = resolveActiveChannelEndpoints(channel, userCfg);

  const normalizedSelectors = Object.assign({}, userCfg.selectors || {});
  if (
    normalizedSelectors.branchPillInBox &&
    !String(normalizedSelectors.branchPillInBox).includes('project-branch-picker')
  ) {
    delete normalizedSelectors.branchPillInBox;
  }
  if (normalizedSelectors.homeGreeting && !String(normalizedSelectors.homeGreeting).includes('home-splash-content')) {
    delete normalizedSelectors.homeGreeting;
  }
  // Preserve the provenance of user exclusions. Runtime always merges its own
  // immutable/default protections; appending them here would falsely make them
  // explicit user exclusions and prevent the narrow Markdown UI-attribute exception.

  const DEFAULT_ALLOWED_ORIGINS = [
    'http://127.0.0.1',
    'https://127.0.0.1',
    'http://localhost',
    'https://localhost',
    'vscode-file://',
    'plugin://swarm--'
  ];

  activeConfig = {
    enabled,
    channel,
    preset,
    contextLimit,
    contextLimitOverride,
    modules,
    themeVars,
    selectors: normalizedSelectors,
    allowedOrigins: Array.isArray(userCfg.allowedOrigins)
      ? userCfg.allowedOrigins
      : DEFAULT_ALLOWED_ORIGINS,
    endpoints
  };

  const baseCss = readTextSafe(path.join(CORE_DIR, 'theme.css'), '');
  const customCss = !SAFE_MODE && modules.customCss ? readTextSafe(path.join(USER_DIR, 'custom.css'), '') : '';

  const baseDict = readJsonSafe(path.join(CORE_DIR, 'i18n.json'), {});
  const rawOverrideDict = !SAFE_MODE ? readJsonSafe(path.join(USER_DIR, 'i18n.override.json'), {}) : {};
  const overrideDict = normalizeOverrideDict(rawOverrideDict);
  const mergedDict = Object.assign({}, baseDict, overrideDict);

  const customJs = !SAFE_MODE && modules.customJs ? readTextSafe(path.join(USER_DIR, 'custom.js'), '') : '';
  const runtimeTemplate = readTextSafe(path.join(CORE_DIR, 'runtime.js'), '');

  const hash = crypto
    .createHash('sha256')
    .update(String(enabled))
    .update(runtimeTemplate)
    .update(baseCss)
    .update(customCss)
    .update(JSON.stringify(mergedDict))
    .update(customJs)
    .update(JSON.stringify({ preset, modules, themeVars, selectors: activeConfig.selectors, hostThemeMode }))
    .digest('hex')
    .slice(0, 8);

  const channelTag = channel === 'insiders' ? 'insiders' : 'stable';
  cachedPatchVersion = `${BASE_VERSION}-${channelTag}-${hash}`;

  const bootPayload = {
    version: cachedPatchVersion,
    platform: 'darwin',
    hostThemeMode,
    enabled,
    preset,
    cssText: baseCss,
    customCss,
    themeVars,
    i18nDict: mergedDict,
    modules,
    selectors: activeConfig.selectors,
    config: {
      enabled,
      channel,
      preset,
      contextLimit,
      contextLimitOverride,
      modules,
      themeVars
    },
    customJs
  };

  cachedInjectScript = runtimeTemplate.replace('})(__AG_BOOT_PAYLOAD__);', () => `})(${JSON.stringify(bootPayload)});`);
  cachedBundleSig = sig;
  return true;
}

rebuildBundleIfNeeded();

// ============================================================================
// 3. 单实例 PID 锁（防止重复启动守护进程）
// ============================================================================
function checkDaemonPidState(pid) {
  if (!pid || pid <= 0 || pid === process.pid) return 'not_daemon';
  try {
    process.kill(pid, 0);
  } catch (err) {
    return err && err.code === 'EPERM' ? 'uncertain' : 'not_daemon';
  }
  return 'confirmed';
}

const pidKey = CLI_CHANNEL || 'default';
const PID_FILE = path.join(os.tmpdir(), `ag-theme-daemon-${pidKey}.pid`);
if (!RUN_ONCE) {
  try {
    if (fs.existsSync(PID_FILE)) {
      const oldPid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
      const pidState = checkDaemonPidState(oldPid);
      if (pidState === 'confirmed') {
        try {
          process.kill(oldPid, 'SIGTERM');
        } catch {}
      } else if (pidState === 'uncertain') {
        console.warn(`[Daemon] Existing PID ${oldPid} could not be signaled (EPERM); skipping duplicate startup.`);
        process.exit(0);
      }
    }
    fs.writeFileSync(PID_FILE, String(process.pid), 'utf8');
    const cleanPid = () => {
      try {
        if (fs.existsSync(PID_FILE) && fs.readFileSync(PID_FILE, 'utf8').trim() === String(process.pid)) {
          fs.unlinkSync(PID_FILE);
        }
      } catch {}
    };
    process.on('exit', cleanPid);
    process.on('SIGINT', () => {
      daemonExiting = true;
      closeAllBrowserWatchers();
      cleanPid();
      process.exit(0);
    });
    process.on('SIGTERM', () => {
      daemonExiting = true;
      closeAllBrowserWatchers();
      cleanPid();
      process.exit(0);
    });
  } catch {}
}

// ============================================================================
// 4. SQLite + Protobuf 实时会话指标解析器（读取 ~/.gemini/antigravity/conversations/<id>.db）
// ============================================================================

function parseProto(buf) {
  let i = 0;
  const out = new Map();
  while (i < buf.length) {
    let tag = 0;
    let shift = 0;
    while (i < buf.length) {
      const b = buf[i++];
      tag |= (b & 0x7f) << shift;
      if (!(b & 0x80)) break;
      shift += 7;
    }
    const fn = tag >>> 3;
    const wt = tag & 7;
    if (fn <= 0 || fn > 10000) break;
    if (wt === 0) {
      let val = 0;
      let s = 0;
      while (i < buf.length) {
        const b = buf[i++];
        val += (b & 0x7f) * Math.pow(2, s);
        if (!(b & 0x80)) break;
        s += 7;
      }
      out.set(fn, val);
    } else if (wt === 2) {
      let len = 0;
      let s = 0;
      while (i < buf.length) {
        const b = buf[i++];
        len |= (b & 0x7f) << s;
        if (!(b & 0x80)) break;
        s += 7;
      }
      if (len < 0 || i + len > buf.length) break;
      out.set(fn, buf.subarray(i, i + len));
      i += len;
    } else if (wt === 1) {
      if (i + 8 > buf.length) break;
      out.set(fn, buf.subarray(i, i + 8));
      i += 8;
    } else if (wt === 5) {
      if (i + 4 > buf.length) break;
      out.set(fn, buf.subarray(i, i + 4));
      i += 4;
    } else {
      break;
    }
  }
  return out;
}

function fmtTok(n) {
  if (!n || n <= 0) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M';
  if (n >= 10000) return Math.round(n / 1000) + 'k';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

function fmtNum(n) {
  return (n || 0).toLocaleString('en-US');
}

const resolvedCascadeDbCache = new Map();
const lastKnownDbStateCache = new Map(); // dbPath -> { dbPath, rawSig, sig }
const UUID_RE = /^[0-9a-f-]{36}$/i;
const DB_FILE_RE = /^([0-9a-f-]{36})\.db$/i;
const textDecoder = new TextDecoder('utf-8', { fatal: false });
const MAX_CHILD_METRICS_CACHE_SIZE = 4096;
const MAX_NO_META_PENDING_IDS = 64;
const LINEAGE_TICK_MAX_OPENS = 45;
const LINEAGE_TICK_MAX_MS = 60;
const NO_META_RESCAN_LOCAL_MS = 2500;
const childMetricsCache = new Map(); // dbPath -> { sig, hasData, calls, totalIn, totalCache, totalOut, totalThink, totalResp }
const lineageStateByDir = new Map(); // conversationsDir -> dirState
function createMetricsPassBudget() {
  return { startedAt: performance.now(), opens: 0, directories: new Map() };
}
function metricsBudgetAvailable(budget) {
  return !budget || (budget.opens < LINEAGE_TICK_MAX_OPENS && performance.now() - budget.startedAt < LINEAGE_TICK_MAX_MS);
}
function consumeMetricsOpen(budget) {
  if (!metricsBudgetAvailable(budget)) return false;
  if (budget) budget.opens += 1;
  return true;
}

function setChildMetricsCache(dbPath, entry) {
  setBoundedMap(childMetricsCache, dbPath, entry, MAX_CHILD_METRICS_CACHE_SIZE);
}

function setBoundedMap(map, key, val, maxEntries = 64) {
  if (map.has(key)) map.delete(key);
  map.set(key, val);
  if (map.size > maxEntries) {
    const oldestKey = map.keys().next().value;
    if (oldestKey !== undefined) map.delete(oldestKey);
  }
}

function readUtf8(val) {
  if (!val) return '';
  if (typeof val === 'string') return val;
  if (val instanceof Uint8Array) return textDecoder.decode(val);
  return '';
}

function getDbStatByPath(dbPath) {
  try {
    const st = fs.statSync(dbPath, { throwIfNoEntry: false });
    if (!st) return null;
    const wst = fs.statSync(`${dbPath}-wal`, { throwIfNoEntry: false });
    const walSig = wst ? `${wst.mtimeMs}:${wst.size}` : '0:0';
    return {
      dbPath,
      mtimeMs: Math.max(st.mtimeMs || 0, wst ? wst.mtimeMs || 0 : 0),
      sig: `${st.mtimeMs}:${st.size}|${walSig}`
    };
  } catch {
    return null;
  }
}

function resolveConversationDbPath(cascadeId, endpointOrDir) {
  if (!cascadeId || !endpointOrDir) return '';
  if (Array.isArray(endpointOrDir)) {
    const dirs = endpointOrDir.filter(Boolean);
    for (let i = 0; i < dirs.length; i++) {
      const candidate = path.join(dirs[i], `${cascadeId}.db`);
      if (fs.existsSync(candidate)) return candidate;
    }
    return dirs.length > 0 ? path.join(dirs[0], `${cascadeId}.db`) : '';
  }
  if (typeof endpointOrDir === 'string') {
    return path.join(endpointOrDir, `${cascadeId}.db`);
  }

  const primaryDir = endpointOrDir.conversationsDir || '';
  const cacheKey = `${endpointOrDir.channel || 'default'}|${primaryDir}|${cascadeId}`;
  const cachedPath = resolvedCascadeDbCache.get(cacheKey);
  if (cachedPath) {
    if (fs.existsSync(cachedPath)) {
      return cachedPath;
    }
    resolvedCascadeDbCache.delete(cacheKey);
  }

  if (primaryDir) {
    const primaryCandidate = path.join(primaryDir, `${cascadeId}.db`);
    if (fs.existsSync(primaryCandidate)) {
      setBoundedMap(resolvedCascadeDbCache, cacheKey, primaryCandidate, 64);
      return primaryCandidate;
    }
    return primaryCandidate;
  }

  return '';
}

function getDbState(cascadeId, endpointOrDir) {
  try {
    const dbPath = resolveConversationDbPath(cascadeId, endpointOrDir);
    if (!dbPath) return null;
    const st = fs.statSync(dbPath, { throwIfNoEntry: false });
    if (!st) {
      lastKnownDbStateCache.delete(dbPath);
      return null;
    }
    const wst = fs.statSync(`${dbPath}-wal`, { throwIfNoEntry: false });
    const walSig = wst ? `${wst.mtimeMs}:${wst.size}` : '0:0';
    const rawSig = `${st.mtimeMs}:${st.size}|${walSig}`;
    const stateObj = {
      dbPath,
      rawSig,
      sig: `${dbPath}#${rawSig}`
    };
    setBoundedMap(lastKnownDbStateCache, dbPath, stateObj, 64);
    return stateObj;
  } catch {
    return null;
  }
}

function readTrajectoryLineage(dbPath) {
  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true, timeout: 20 });
    const row = db.prepare('SELECT data FROM trajectory_metadata_blob LIMIT 1').get();
    if (!row || !row.data) {
      return { ok: true, hasMeta: false, parentId: '', rootId: '' };
    }
    const meta = parseProto(row.data);
    const rawParentId = readUtf8(meta.get(5)).trim();
    const parentId = UUID_RE.test(rawParentId) ? rawParentId : '';
    const rawRootId = readUtf8(meta.get(6)).trim();
    const rootId = UUID_RE.test(rawRootId) ? rawRootId : '';
    // An initially empty blob may gain lineage after creation; keep it eligible for rescan.
    return { ok: true, hasMeta: Boolean(parentId || rootId), parentId, rootId };
  } catch (err) {
    const msg = String(err?.message || '');
    if (/no such table/i.test(msg)) {
      return { ok: true, hasMeta: false, parentId: '', rootId: '' };
    }
    if (!/locked|busy/i.test(msg)) {
      return { ok: true, hasMeta: false, permanentInvalid: true, parentId: '', rootId: '' };
    }
    return { ok: false, error: err };
  } finally {
    try {
      db?.close();
    } catch {}
  }
}

function addAdjacencyEdge(map, key, childId) {
  if (!key || !childId || key === childId) return;
  let set = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  set.add(childId);
}

function removeAdjacencyEdge(map, key, childId) {
  if (!key) return;
  const set = map.get(key);
  if (!set) return;
  set.delete(childId);
  if (set.size === 0) map.delete(key);
}

function setNodeLineage(dirState, uuid, node) {
  const prev = dirState.nodes.get(uuid);
  if (prev) {
    if (prev.parentId && prev.parentId !== node.parentId) {
      removeAdjacencyEdge(dirState.byParent, prev.parentId, uuid);
    }
    if (prev.rootId && prev.rootId !== node.rootId) {
      removeAdjacencyEdge(dirState.byRoot, prev.rootId, uuid);
    }
  }
  dirState.nodes.set(uuid, node);
  if (node.parentId) addAdjacencyEdge(dirState.byParent, node.parentId, uuid);
  if (node.rootId) addAdjacencyEdge(dirState.byRoot, node.rootId, uuid);
}

function deleteNodeLineage(dirState, uuid) {
  const prev = dirState.nodes.get(uuid);
  if (prev) {
    removeAdjacencyEdge(dirState.byParent, prev.parentId, uuid);
    removeAdjacencyEdge(dirState.byRoot, prev.rootId, uuid);
    dirState.nodes.delete(uuid);
  }
  dirState.noMetaPending.delete(uuid);
}

function rememberNoMetaPending(dirState, uuid, statSig) {
  if (dirState.noMetaPending.has(uuid)) dirState.noMetaPending.delete(uuid);
  dirState.noMetaPending.set(uuid, statSig);
  while (dirState.noMetaPending.size > MAX_NO_META_PENDING_IDS) {
    const oldest = dirState.noMetaPending.keys().next().value;
    if (oldest === undefined) break;
    dirState.noMetaPending.delete(oldest);
  }
}

function refreshLineageIndex(conversationsDir, budget = null) {
  if (!conversationsDir || !DatabaseSync) {
    return { dirState: null, isDraining: false, backoffSkipped: false };
  }
  let dirState = lineageStateByDir.get(conversationsDir);
  if (!dirState) {
    dirState = {
      dirMtimeMs: -1,
      scanningDirMtimeMs: -1,
      lastPendingScanAt: 0,
      recheckCursor: 0,
      unindexedQueue: [],
      unindexedSet: new Set(),
      noMetaPending: new Map(),
      nodes: new Map(),
      byParent: new Map(),
      byRoot: new Map()
    };
    lineageStateByDir.set(conversationsDir, dirState);
  }

  const nowMs = Date.now();

  let dirSt;
  try { dirSt = fs.statSync(conversationsDir, { throwIfNoEntry: false }); }
  catch { return { dirState, isDraining: dirState.unindexedQueue.length > 0 }; }
  if (!dirSt || !dirSt.isDirectory()) {
    return { dirState, isDraining: false };
  }

  const dirChanged = dirSt.mtimeMs !== dirState.dirMtimeMs && dirSt.mtimeMs !== dirState.scanningDirMtimeMs;

  if (dirChanged) {
    let entries;
    try {
      entries = fs.readdirSync(conversationsDir);
    } catch {
      return { dirState, isDraining: dirState.unindexedQueue.length > 0 };
    }

    const seenIds = new Set();
    let enqueued = false;
    for (let i = 0; i < entries.length; i++) {
      const m = entries[i].match(DB_FILE_RE);
      if (!m) continue;
      const uuid = m[1];
      seenIds.add(uuid);
      const existingNode = dirState.nodes.get(uuid);
      if (dirState.unindexedSet.has(uuid)) continue;

      const dbPath = path.join(conversationsDir, entries[i]);
      const statInfo = getDbStatByPath(dbPath);
      if (!statInfo) continue;

      if (existingNode && existingNode.statSig === statInfo.sig) continue;
      if (dirState.noMetaPending.has(uuid) && dirState.noMetaPending.get(uuid) === statInfo.sig) {
        continue;
      }
      dirState.unindexedQueue.push({ uuid, dbPath, mtimeMs: statInfo.mtimeMs, statSig: statInfo.sig });
      dirState.unindexedSet.add(uuid);
      enqueued = true;
    }

    for (const existingId of Array.from(dirState.nodes.keys())) {
      if (!seenIds.has(existingId)) {
        deleteNodeLineage(dirState, existingId);
      }
    }
    if (dirState.unindexedQueue.length > 0) {
      const nextQueue = [];
      for (let i = 0; i < dirState.unindexedQueue.length; i++) {
        const item = dirState.unindexedQueue[i];
        if (seenIds.has(item.uuid)) {
          nextQueue.push(item);
        } else {
          dirState.unindexedSet.delete(item.uuid);
        }
      }
      if (enqueued || nextQueue.length !== dirState.unindexedQueue.length) {
        nextQueue.sort((a, b) => b.mtimeMs - a.mtimeMs);
      }
      dirState.unindexedQueue = nextQueue;
    }
    dirState.scanningDirMtimeMs = dirSt.mtimeMs;
  } else if (dirState.unindexedQueue.length === 0) {
    if (dirState.nodes.size > 0 && nowMs - dirState.lastPendingScanAt >= NO_META_RESCAN_LOCAL_MS) {
      dirState.lastPendingScanAt = nowMs;
      const newlyChanged = [];
      // Rotate over ALL known nodes, not only the bounded pending cache. Metadata
      // can arrive late or correct an existing relationship without directory mtime changes.
      const known = Array.from(dirState.nodes.entries());
      const count = Math.min(MAX_NO_META_PENDING_IDS, known.length);
      for (let scan = 0; scan < count; scan++) {
        const [uuid, node] = known[dirState.recheckCursor++ % known.length];
        const prevSig = node.statSig;
        const dbPath = path.join(conversationsDir, `${uuid}.db`);
        const statInfo = getDbStatByPath(dbPath);
        if (!statInfo) {
          // A failed stat can be transient (permissions/lock). Keep the node
          // eligible for rotation; only a complete directory scan proves deletion.
          continue;
        }
        if (statInfo.sig !== prevSig && !dirState.unindexedSet.has(uuid)) {
          newlyChanged.push({ uuid, dbPath, mtimeMs: statInfo.mtimeMs, statSig: statInfo.sig });
          dirState.unindexedSet.add(uuid);
        }
      }
      if (newlyChanged.length > 0) {
        newlyChanged.sort((a, b) => b.mtimeMs - a.mtimeMs);
        dirState.unindexedQueue.push(...newlyChanged);
      }
    }
  }

  if (dirState.unindexedQueue.length === 0) {
    if (dirState.scanningDirMtimeMs >= 0) {
      dirState.dirMtimeMs = dirState.scanningDirMtimeMs;
    }
    return { dirState, isDraining: false };
  }

  const tPerfStart = performance.now();
  let opens = 0;
  let qIdx = 0;
  const busyRetry = [];

  while (qIdx < dirState.unindexedQueue.length) {
    if (!metricsBudgetAvailable(budget)) break;
    if (opens > 0 && (opens >= LINEAGE_TICK_MAX_OPENS || performance.now() - tPerfStart >= LINEAGE_TICK_MAX_MS)) {
      break;
    }
    const item = dirState.unindexedQueue[qIdx++];
    dirState.unindexedSet.delete(item.uuid);
    opens += 1;
    if (budget) budget.opens += 1;
    const res = readTrajectoryLineage(item.dbPath);
    if (res.ok) {
      if (res.hasMeta) {
        dirState.noMetaPending.delete(item.uuid);
        setNodeLineage(dirState, item.uuid, {
          hasMeta: true,
          parentId: res.parentId,
          rootId: res.rootId,
          statSig: item.statSig
        });
      } else {
        setNodeLineage(dirState, item.uuid, {
          hasMeta: false,
          parentId: '',
          rootId: '',
          statSig: item.statSig
        });
        if (!res.permanentInvalid) {
          rememberNoMetaPending(dirState, item.uuid, item.statSig);
          dirState.lastPendingScanAt = Date.now();
        } else {
          dirState.noMetaPending.delete(item.uuid);
        }
      }
    } else {
      busyRetry.push(item);
      dirState.unindexedSet.add(item.uuid);
    }
  }

  if (qIdx > 0 || busyRetry.length > 0) {
    const remaining = dirState.unindexedQueue.slice(qIdx);
    if (busyRetry.length > 0) {
      remaining.push(...busyRetry);
    }
    dirState.unindexedQueue = remaining;
  }

  if (dirState.unindexedQueue.length === 0 && dirState.scanningDirMtimeMs >= 0) {
    dirState.dirMtimeMs = dirState.scanningDirMtimeMs;
  }

  return {
    dirState,
    isDraining: dirState.unindexedQueue.length > 0
  };
}

function findDescendantIds(cascadeId, dirState) {
  if (!dirState) return [];
  const visited = new Set([cascadeId]);
  const queue = [];

  const selfNode = dirState.nodes.get(cascadeId);
  if (!selfNode || !selfNode.parentId) {
    const rootSet = dirState.byRoot.get(cascadeId);
    if (rootSet) {
      for (const id of rootSet) {
        if (id === cascadeId || visited.has(id)) continue;
        visited.add(id);
        queue.push(id);
      }
    }
  }

  const directSet = dirState.byParent.get(cascadeId);
  if (directSet) {
    for (const id of directSet) {
      if (id === cascadeId || visited.has(id)) continue;
      visited.add(id);
      queue.push(id);
    }
  }

  let qi = 0;
  while (qi < queue.length) {
    const curId = queue[qi++];
    const nextSet = dirState.byParent.get(curId);
    if (!nextSet) continue;
    for (const id of nextSet) {
      if (id === cascadeId || visited.has(id)) continue;
      visited.add(id);
      queue.push(id);
    }
  }

  queue.sort();
  return queue;
}

function getCompositeChildSnapshot(cascadeId, conversationsDir, parentSig = '', budget = null) {
  if (!cascadeId || !UUID_RE.test(cascadeId) || !conversationsDir) {
    return {
      conversationsDir: '',
      descendantIds: [],
      childSigs: new Map(),
      isDraining: false,
      partialStale: false,
      sig: parentSig
    };
  }

  let directorySnapshot = budget?.directories.get(conversationsDir);
  if (!directorySnapshot) {
    directorySnapshot = refreshLineageIndex(conversationsDir, budget);
    budget?.directories.set(conversationsDir, directorySnapshot);
  }
  const { dirState, isDraining } = directorySnapshot;
  const descendantIds = findDescendantIds(cascadeId, dirState);
  const childSigs = new Map();
  const childSigParts = [];
  let partialStale = false;

  for (let i = 0; i < descendantIds.length; i++) {
    const cid = descendantIds[i];
    if (!metricsBudgetAvailable(budget)) {
      partialStale = true;
      childSigs.set(cid, 'budget_deferred');
      childSigParts.push(`${cid}=budget_deferred`);
      continue;
    }
    const statInfo = getDbStatByPath(path.join(conversationsDir, `${cid}.db`));
    childSigs.set(cid, statInfo ? statInfo.sig : 'missing');
    childSigParts.push(`${cid}=${statInfo ? statInfo.sig : '0:0|0:0'}`);
  }

  return {
    conversationsDir,
    descendantIds,
    childSigs,
    isDraining: Boolean(isDraining),
    partialStale,
    sig: `${parentSig}|children:${childSigParts.join(',')}${isDraining ? '|draining' : ''}${partialStale ? '|stale' : ''}`
  };
}

function loadChildScalarMetrics(childId, conversationsDir, knownStatSig = null, allowUncachedOpen = true, budget = null) {
  if (!UUID_RE.test(childId) || !conversationsDir || knownStatSig === 'missing') return { exists: false };
  const dbPath = path.join(conversationsDir, `${childId}.db`);
  const cached = childMetricsCache.get(dbPath);
  if (knownStatSig === 'budget_deferred') {
    return { exists: true, deferred: true, staleMetrics: cached || null };
  }
  if (!knownStatSig && !allowUncachedOpen) {
    return cached ? { exists: true, deferred: true, staleMetrics: cached } : { exists: true, deferred: true, staleMetrics: null };
  }
  const sig = knownStatSig || getDbStatByPath(dbPath)?.sig || '';
  if (!sig) return { exists: false };

  if (cached && cached.sig === sig) {
    setChildMetricsCache(dbPath, cached);
    return { exists: true, fromCache: true, metrics: cached };
  }
  if (!allowUncachedOpen || !consumeMetricsOpen(budget)) {
    return { exists: true, deferred: true, staleMetrics: cached || null };
  }

  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true, timeout: 20 });
    const rows = db.prepare('SELECT idx, data FROM gen_metadata ORDER BY idx ASC').all();
    let calls = 0;
    let totalIn = 0;
    let totalCache = 0;
    let totalOut = 0;
    let totalThink = 0;
    let totalResp = 0;
    for (let i = 0; i < rows.length; i++) {
      const p = parseGenMetadataRow(rows[i]);
      if (p.ctx > 0 || p.outTok > 0) {
        calls += 1;
        totalIn += p.inTok;
        totalCache += p.cacheRead;
        totalOut += p.outTok;
        totalThink += p.thinkTok;
        totalResp += p.respTok;
      }
    }
    const entry = {
      sig,
      hasData: calls > 0,
      calls,
      totalIn,
      totalCache,
      totalOut,
      totalThink,
      totalResp
    };
    setChildMetricsCache(dbPath, entry);
    return { exists: true, fromCache: false, metrics: entry };
  } catch (err) {
    const msg = String(err?.message || '');
    if (/locked|busy/i.test(msg)) {
      return { exists: true, fromCache: false, transientError: true, staleMetrics: cached || null };
    }
    const emptyEntry = {
      sig,
      hasData: false,
      calls: 0,
      totalIn: 0,
      totalCache: 0,
      totalOut: 0,
      totalThink: 0,
      totalResp: 0
    };
    setChildMetricsCache(dbPath, emptyEntry);
    return { exists: true, fromCache: false, metrics: emptyEntry };
  } finally {
    try {
      db?.close();
    } catch {}
  }
}

function parseGenMetadataRow(r) {
  const top = parseProto(r.data);
  const chatRaw = top.get(1);
  const chat = chatRaw instanceof Uint8Array ? parseProto(chatRaw) : new Map();
  const usageRaw = chat.get(4);
  const usage = usageRaw instanceof Uint8Array ? parseProto(usageRaw) : new Map();
  const chatStartRaw = chat.get(9);
  const chatStart = chatStartRaw instanceof Uint8Array ? parseProto(chatStartRaw) : new Map();
  const ctxWinRaw = chatStart.get(10);
  const ctxWin = ctxWinRaw instanceof Uint8Array ? parseProto(ctxWinRaw) : new Map();
  const maxCtx = ctxWin.get(4) || 0;
  const ttftRaw = chat.get(11);
  const ttftMap = ttftRaw instanceof Uint8Array ? parseProto(ttftRaw) : new Map();
  const streamRaw = chat.get(12);
  const streamMap = streamRaw instanceof Uint8Array ? parseProto(streamRaw) : new Map();

  const inTok = usage.get(2) || 0;
  const outTok = usage.get(3) || 0;
  const cacheRead = usage.get(5) || 0;
  const thinkTok = usage.get(9) || 0;
  const respTok = usage.get(10) || 0;
  const ttft = (ttftMap.get(1) || 0) + (ttftMap.get(2) || 0) / 1e9;
  const stream = (streamMap.get(1) || 0) + (streamMap.get(2) || 0) / 1e9;

  return {
    idx: r.idx,
    inTok,
    outTok,
    cacheRead,
    ctx: inTok + cacheRead,
    maxCtx,
    thinkTok,
    respTok,
    ttft,
    stream,
    totDur: ttft + stream
  };
}

function formatContextCeiling(tokens) {
  if (tokens >= 1000000) {
    return `${Number((tokens / 1000000).toFixed(1))}M`;
  }
  return `${Math.round(tokens / 1000)}k`;
}

function parseConversationMetrics(cascadeId, endpointOrDir, precomputedState = null, precomputedChildSnap = null, budget = null) {
  if (!DatabaseSync) return null;
  if (!cascadeId || !UUID_RE.test(cascadeId)) return null;
  const state = precomputedState || getDbState(cascadeId, endpointOrDir);
  if (!state || !state.dbPath || !state.sig) return { cascadeId, hasData: false };
  const { dbPath, sig } = state;
  const conversationsDir = path.dirname(dbPath);
  const childSnap =
    precomputedChildSnap || getCompositeChildSnapshot(cascadeId, conversationsDir, state.rawSig || sig, budget);
  const compositeSig = childSnap?.sig || sig;

  const cached = metricsCache.get(dbPath);
  if (cached && cached.sig === compositeSig && !childSnap?.isDraining && !childSnap?.partialStale) {
    return cached.payload;
  }

  if (!consumeMetricsOpen(budget)) {
    return { cascadeId, transientError: true, budgetDeferred: true, cachedPayload: cached?.payload || lastBestEffortPayloadCache.get(dbPath) || null };
  }
  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true, timeout: 200 });
    const metaStat = db.prepare('SELECT COUNT(*) AS cnt, COALESCE(MAX(idx), -1) AS maxIdx FROM gen_metadata').get();
    const rowCount = metaStat?.cnt ?? 0;
    const maxIdx = metaStat?.maxIdx ?? -1;
    if (rowCount === 0 || maxIdx < 0) {
      db.close();
      db = null;
      incrementalMetricsMap.delete(dbPath);
      const emptyPayload = {
        cascadeId,
        hasData: false,
        sig: compositeSig,
        isDraining: Boolean(childSnap?.isDraining),
        partialStale: Boolean(childSnap?.partialStale)
      };
      if (!childSnap?.isDraining && !childSnap?.partialStale) {
        setMetricsCache(dbPath, { sig: compositeSig, payload: emptyPayload });
      }
      return emptyPayload;
    }

    // 利用 idx_steps_step_type 覆盖索引直接在 SQLite C 引擎内完成聚合计数，0 数组分配
    // 注意：gen_metadata.idx 与 steps.idx 属于两套独立递增坐标系，绝不可混用！
    const userStat = db
      .prepare('SELECT COUNT(*) AS cnt, COALESCE(MAX(idx), -1) AS lastIdx FROM steps WHERE step_type = 14')
      .get();
    const lastUserStepIdx = userStat?.lastIdx ?? -1;
    const userStepsCount = userStat?.cnt ?? 0;
    const turnStat = db
      .prepare('SELECT COUNT(*) AS cnt FROM steps WHERE step_type = 15 AND idx > ?')
      .get(lastUserStepIdx);
    const rawTurnSteps = turnStat?.cnt ?? 0;

    let inc = incrementalMetricsMap.get(dbPath);
    if (
      inc &&
      (rowCount < inc.rowCount ||
        maxIdx < inc.maxIdx ||
        userStepsCount < inc.userStepsCount ||
        lastUserStepIdx < inc.lastUserStepIdx ||
        (lastUserStepIdx !== inc.lastUserStepIdx && userStepsCount <= inc.userStepsCount))
    ) {
      inc = null;
    }

    if (inc) {
      const startIdx = inc.maxIdx;
      const deltaRows = db.prepare('SELECT idx, data FROM gen_metadata WHERE idx >= ? ORDER BY idx ASC').all(startIdx);
      while (inc.items.length > 0 && inc.items[inc.items.length - 1].idx >= startIdx) {
        const popped = inc.items.pop();
        inc.totalIn -= popped.inTok;
        inc.totalCache -= popped.cacheRead;
        inc.totalOut -= popped.outTok;
        inc.totalThink -= popped.thinkTok;
        inc.totalResp -= popped.respTok;
      }
      while (inc.validItems.length > 0 && inc.validItems[inc.validItems.length - 1].idx >= startIdx) {
        inc.validItems.pop();
      }
      if (inc.items.length + deltaRows.length === rowCount) {
        for (let i = 0; i < deltaRows.length; i++) {
          const p = parseGenMetadataRow(deltaRows[i]);
          inc.items.push(p);
          inc.totalIn += p.inTok;
          inc.totalCache += p.cacheRead;
          inc.totalOut += p.outTok;
          inc.totalThink += p.thinkTok;
          inc.totalResp += p.respTok;
          if (p.ctx > 0 || p.outTok > 0) {
            inc.validItems.push(p);
          }
        }
        inc.rowCount = rowCount;
        inc.maxIdx = maxIdx;
        inc.userStepsCount = userStepsCount;
        inc.lastUserStepIdx = lastUserStepIdx;
      } else {
        inc = null;
      }
    }

    if (!inc) {
      const rows = db.prepare('SELECT idx, data FROM gen_metadata ORDER BY idx ASC').all();
      const items = [];
      const validItems = [];
      let totalIn = 0;
      let totalCache = 0;
      let totalOut = 0;
      let totalThink = 0;
      let totalResp = 0;
      for (let i = 0; i < rows.length; i++) {
        const p = parseGenMetadataRow(rows[i]);
        items.push(p);
        totalIn += p.inTok;
        totalCache += p.cacheRead;
        totalOut += p.outTok;
        totalThink += p.thinkTok;
        totalResp += p.respTok;
        if (p.ctx > 0 || p.outTok > 0) {
          validItems.push(p);
        }
      }
      inc = {
        rowCount: rows.length,
        maxIdx: rows.length > 0 ? rows[rows.length - 1].idx : -1,
        userStepsCount,
        lastUserStepIdx,
        items,
        validItems,
        totalIn,
        totalCache,
        totalOut,
        totalThink,
        totalResp
      };
    }

    db.close();
    db = null;
    setIncrementalMetrics(dbPath, inc);

    const { validItems: valid, totalIn, totalCache, totalOut, totalThink, totalResp } = inc;
    if (valid.length === 0) {
      const emptyPayload = {
        cascadeId,
        hasData: false,
        sig: compositeSig,
        isDraining: Boolean(childSnap?.isDraining),
        partialStale: Boolean(childSnap?.partialStale)
      };
      if (!childSnap?.isDraining && !childSnap?.partialStale) {
        setMetricsCache(dbPath, { sig: compositeSig, payload: emptyPayload });
      }
      return emptyPayload;
    }

    const descendantIds = childSnap?.descendantIds || [];
    const isDraining = Boolean(childSnap?.isDraining);
    let partialStale = Boolean(childSnap?.partialStale);
    let childCount = 0;
    let childCalls = 0;
    let childIn = 0;
    let childCache = 0;
    let childOut = 0;
    let childThink = 0;
    let childResp = 0;
    let childSqlOpens = 0;
    const tChildPerfStart = performance.now();

    for (let i = 0; i < descendantIds.length; i++) {
      const childId = descendantIds[i];
      if (childId === cascadeId) continue;

      const knownChildSig = childSnap.childSigs?.get(childId) || null;
      const allowUncachedOpen =
        childSqlOpens === 0 ||
        (childSqlOpens < LINEAGE_TICK_MAX_OPENS && performance.now() - tChildPerfStart < LINEAGE_TICK_MAX_MS);
      const childRes = loadChildScalarMetrics(
        childId,
        conversationsDir,
        knownChildSig,
        allowUncachedOpen,
        budget
      );
      if (!childRes.exists) continue;
      if (!childRes.fromCache && !childRes.deferred) {
        childSqlOpens += 1;
      }

      let cm = null;
      if (childRes.deferred || childRes.transientError) {
        partialStale = true;
        if (childRes.staleMetrics && childRes.staleMetrics.hasData) {
          cm = childRes.staleMetrics;
        } else {
          continue;
        }
      } else {
        cm = childRes.metrics;
      }

      if (!cm || !cm.hasData) continue;
      childCount += 1;
      childCalls += cm.calls;
      childIn += cm.totalIn;
      childCache += cm.totalCache;
      childOut += cm.totalOut;
      childThink += cm.totalThink;
      childResp += cm.totalResp;
    }

    // 统计最后一条用户提问之后的模型规划步数，并从有效调用末尾切片汇总，消除按位置对齐的错位风险
    const turnSlice = rawTurnSteps > 0 ? valid.slice(-rawTurnSteps) : [];
    const turnSteps = turnSlice.length;
    let turnOut = 0;
    let turnThink = 0;
    let turnResp = 0;
    let turnDur = 0;
    for (let i = 0; i < turnSlice.length; i++) {
      turnOut += turnSlice[i].outTok;
      turnThink += turnSlice[i].thinkTok;
      turnResp += turnSlice[i].respTok;
      turnDur += turnSlice[i].totDur;
    }

    const last = valid[valid.length - 1];
    const fallbackContextLimit = activeConfig.contextLimit || 256000;
    const contextLimitTokens =
      activeConfig.contextLimitOverride > 0
        ? activeConfig.contextLimitOverride
        : last.maxCtx > 0
          ? last.maxCtx
          : fallbackContextLimit;
    const limitStr = formatContextCeiling(contextLimitTokens);

    const rawStreamTps = last.stream >= 0.5 ? last.outTok / last.stream : 0;
    const e2eTps = last.totDur > 0 ? last.outTok / last.totDur : 0;
    const streamRatio = last.totDur > 0 ? last.stream / last.totDur : 0;
    const useStream =
      rawStreamTps > 0 &&
      rawStreamTps <= 600 &&
      (streamRatio >= 0.15 || (last.stream >= 2.0 && rawStreamTps <= 250));
    const displayTps = useStream ? rawStreamTps : e2eTps;
    const ctxPct = Math.round((last.ctx / contextLimitTokens) * 100);
    const ctxClass = ctxPct >= 90 ? 'ag-ctx-crit' : ctxPct >= 75 ? 'ag-ctx-warn' : 'ag-ctx-ok';
    const lastCacheRate = last.ctx > 0 ? ((last.cacheRead / last.ctx) * 100).toFixed(1) : '0.0';
    const sessionCacheRate = totalIn + totalCache > 0 ? ((totalCache / (totalIn + totalCache)) * 100).toFixed(1) : '0.0';
    const remainCtx = Math.max(0, contextLimitTokens - last.ctx);

    const subSyncing = isDraining || partialStale;
    const subInlineHtml =
      childCount > 0 ? `<span class="ag-sep">·</span><span class="ag-sub-badge">+${childCount} sub</span>` : '';
    const inlineHtml = [
      `<span>${Math.round(displayTps)} tok/s</span>`,
      `<span class="ag-sep">·</span>`,
      `<span>${useStream ? 'TTFT' : 'Hold'} ${last.ttft.toFixed(1)}s</span>`,
      `<span class="ag-sep">·</span>`,
      `<span>Ctx ${fmtTok(last.ctx)}/${limitStr} <span class="${ctxClass}">(${ctxPct}%)</span></span>`,
      `<span class="ag-sep">·</span>`,
      `<span>Out ${fmtTok(last.outTok)}</span>`,
      subInlineHtml
    ].join('');

    const turnRowHtml =
      turnSteps > 1
        ? `<div class="ag-tt-row"><span class="ag-tt-lbl">本轮合计 (${turnSteps}步)</span><span class="ag-tt-val">输出 ${fmtNum(turnOut)} (思考 ${fmtNum(turnThink)} + 响应 ${fmtNum(turnResp)}) | 耗时 ${turnDur.toFixed(1)}s</span></div>`
        : '';

    const combinedOut = totalOut + childOut;
    const subRowHtml =
      childCount > 0
        ? `<div class="ag-tt-row"><span class="ag-tt-lbl">子 Agent (${childCount}${subSyncing ? ' · 同步中' : ''})</span><span class="ag-tt-val">${childCalls} 次 · 新增 ${fmtTok(childIn)} + 缓存 ${fmtTok(childCache)} · 输出 ${fmtTok(childOut)}</span></div>`
        : descendantIds.length > 0 && subSyncing
          ? `<div class="ag-tt-row"><span class="ag-tt-lbl">子 Agent (同步中)</span><span class="ag-tt-val">正在索引 ${descendantIds.length} 个子会话…</span></div>`
          : '';
    const outputRowHtml =
      childCount > 0
        ? `<div class="ag-tt-row"><span class="ag-tt-lbl">累计输出量</span><span class="ag-tt-val">总计 ${fmtTok(combinedOut)} (主 ${fmtTok(totalOut)} + 子 ${fmtTok(childOut)})</span></div>`
        : `<div class="ag-tt-row"><span class="ag-tt-lbl">累计输出量</span><span class="ag-tt-val">总计 ${fmtTok(totalOut)} (思考链 ${fmtTok(totalThink)} + 正文/工具 ${fmtTok(totalResp)})</span></div>`;
    const tooltipRows = [
      `<div class="ag-tt-hdr">本轮最新调用 (Gen #${last.idx + 1})</div>`,
      `<div class="ag-tt-row"><span class="ag-tt-lbl">生成速度</span><span class="ag-tt-val">${useStream ? `流式 ${rawStreamTps.toFixed(1)} tok/s | ` : ''}端到端（含等待） ${e2eTps.toFixed(1)} tok/s</span></div>`,
      `<div class="ag-tt-row"><span class="ag-tt-lbl">响应耗时</span><span class="ag-tt-val">${useStream ? `TTFT ${last.ttft.toFixed(2)}s | 流式 ${last.stream.toFixed(2)}s | 总计 ${last.totDur.toFixed(2)}s` : `等待 ${last.ttft.toFixed(2)}s | 刷出 ${last.stream.toFixed(2)}s | 总计 ${last.totDur.toFixed(2)}s`}</span></div>`,
      `<div class="ag-tt-row"><span class="ag-tt-lbl">当前上下文</span><span class="ag-tt-val">${fmtNum(last.ctx)} (新增 ${fmtNum(last.inTok)} + 缓存 ${fmtNum(last.cacheRead)}, ${lastCacheRate}%)</span></div>`,
      `<div class="ag-tt-row"><span class="ag-tt-lbl">本步输出量</span><span class="ag-tt-val">${fmtNum(last.outTok)} (思考链 ${fmtNum(last.thinkTok)} + 正文/工具 ${fmtNum(last.respTok)})</span></div>`,
      turnRowHtml,
      `<div class="ag-tt-hdr ag-tt-sec">主会话累计 (${userStepsCount} 轮提问 / ${valid.length} 次有效调用)</div>`,
      `<div class="ag-tt-row"><span class="ag-tt-lbl">上下文窗口用量</span><span class="ag-tt-val">${fmtTok(last.ctx)} / ${limitStr} (${ctxPct}%) · 剩余容量 ${fmtTok(remainCtx)}</span></div>`,
      `<div class="ag-tt-row"><span class="ag-tt-lbl">主会话累计输入</span><span class="ag-tt-val">新增 ${fmtTok(totalIn)} + 缓存读取 ${fmtTok(totalCache)} (命中率 ${sessionCacheRate}%)</span></div>`,
      subRowHtml,
      outputRowHtml
    ];
    const tooltipHtml = tooltipRows.join('');

    const payload = {
      cascadeId,
      hasData: true,
      sig: compositeSig,
      isDraining,
      partialStale,
      inlineHtml,
      tooltipHtml
    };
    setBoundedMap(lastBestEffortPayloadCache, dbPath, payload, 64);
    if (!isDraining && !partialStale) {
      setMetricsCache(dbPath, { sig: compositeSig, payload });
    }
    return payload;
  } catch {
    // 若遇 SQLITE_BUSY 等瞬态锁竞争，标记 transientError 使得上层不锁死 lastPushedHash，下一轮自动重试
    return {
      cascadeId,
      transientError: true,
      cachedPayload: cached?.payload || null
    };
  } finally {
    try {
      db?.close();
    } catch {}
  }
}

// ============================================================================
// 5. CDP 目标发现、WebSocket 会话挂载与热更新推送
// ============================================================================
const attachedTargets = new Map();
const targetThemeModes = new Map();
const targetMetaMap = new Map();
const skippedNonHostTargets = new Map(); // targetId -> { url, origin, skippedAt, attempts, titleHadAg }
const browserWatchers = new Map(); // `${channel}:${port}` -> { ws, wsUrl, port, channel, endpoint, reconnectAfterMs, closing }
const browserWatcherBackoffUntil = new Map(); // `${channel}:${port}` -> timestamp ms
const attachingTargetIds = new Set();
const destroyedWhileAttaching = new Set();
let daemonExiting = false;

function getTargetOriginKey(urlStr) {
  const raw = String(urlStr || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw);
    if (u.origin && u.origin !== 'null') return u.origin.toLowerCase();
    return `${u.protocol}//${u.host}`.toLowerCase();
  } catch {
    return raw.slice(0, 120).toLowerCase();
  }
}

// CDP may omit parentId. Never guess between multiple host windows.
function resolveParentThemeTarget(target, endpoint) {
  let curId = target?.parentId || null;
  const seen = new Set();
  while (curId && !seen.has(curId)) {
    seen.add(curId);
    const entry = attachedTargets.get(curId);
    if (entry?.type === 'page') {
      return entry.hostConfirmed && entry.endpoint?.channel === endpoint?.channel ? curId : null;
    }
    const meta = targetMetaMap.get(curId);
    if (!meta || meta.type === 'page') return null;
    curId = meta.parentId || null;
  }
  if (seen.size) return null;
  const candidates = [...attachedTargets].filter(([, entry]) =>
    entry.hostConfirmed && entry.type === 'page' && entry.endpoint?.channel === endpoint?.channel
  );
  return candidates.length === 1 ? candidates[0][0] : null;
}

function resolveParentThemeMode(target, endpoint) {
  const id = resolveParentThemeTarget(target, endpoint);
  return id ? targetThemeModes.get(id) || null : null;
}

function syncThemeToChildIframes() {
  for (const [, entry] of attachedTargets.entries()) {
    if (!entry.hostConfirmed || entry.type !== 'iframe') continue;
    const mode = activeConfig.enabled ? resolveParentThemeMode(entry, entry.endpoint) : null;
    if (entry.lastParentThemeMode === mode) continue;
    entry.lastParentThemeMode = mode;
    const relayGeneration = (entry.themeRelayGeneration || 0) + 1;
    entry.themeRelayGeneration = relayGeneration;
    const retry = () => { if (entry.themeRelayGeneration === relayGeneration) entry.lastParentThemeMode = undefined; };
    entry.send('Runtime.evaluate', {
      expression: `typeof window.__ag_set_host_theme_mode === 'function' && (window.__ag_set_host_theme_mode(${JSON.stringify(mode)}), true)`,
      returnByValue: true
    }).then(result => { if (result?.result?.result?.value !== true || result.error || result.result?.exceptionDetails) retry(); }).catch(retry);
    entry.updateNewDocScript?.().catch(() => {});
  }
}


function isExemptInternalTarget(target) {
  const url = String(target?.url || '');
  if (target?.type === 'iframe' && url.startsWith('plugin://swarm--')) return true;
  if (url.startsWith('vscode-file://')) return true;
  return false;
}

const HOST_PROBE_EXPRESSION = `(function(){
  try {
    var loc = window.location;
    var isSwarm = !!(loc && ((loc.protocol === 'plugin:' && /^swarm--/i.test(loc.hostname || '')) || /^plugin:\\/\\/swarm--/i.test(String(loc.href || ''))));
    if (isSwarm || (loc && loc.protocol === 'vscode-file:')) return 'host';
    if (window.__APP_CONFIG__ && window.__APP_CONFIG__.productName === 'antigravity') return 'host';
    if (
      window.electronNative &&
      ((typeof window.electronNative.setTitleBarOverlay === 'function' &&
        window.nativeStorage &&
        typeof window.nativeStorage.getItems === 'function') ||
        (typeof window.electronNative.getZoomLevel === 'function' &&
          window.electronNative.wcvBrowser &&
          typeof window.electronNative.wcvBrowser.setThemeColor === 'function'))
    ) return 'host';
    if (
      typeof document !== 'undefined' &&
      typeof document.querySelector === 'function' &&
      document.querySelector('link[href*="/jetbox.css"], body[data-agy-theme], body[data-newux-theme], [id="antigravity.agentSidePanelInputBox"]')
    ) return 'host';
    if (
      typeof document === 'undefined' ||
      !document.documentElement ||
      document.readyState === 'loading' ||
      (loc && (loc.protocol === 'chrome-error:' || loc.protocol === 'about:' || loc.protocol === 'data:'))
    ) {
      return 'pending';
    }
    return 'non_host';
  } catch (e) {
    return 'pending';
  }
})()`;

function readPort(portFile) {
  return readPortInfo(portFile).port;
}

function readPortInfo(portFile) {
  try {
    const raw = fs.readFileSync(portFile, 'utf8').trim();
    const lines = raw.split(/\r?\n/);
    const port = /^\d+$/.test(lines[0]) ? Number(lines[0]) : 0;
    const validPort = Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
    const wsPath = (lines[1] || '').trim();
    return {
      port: validPort,
      browserWsPath: wsPath.startsWith('/') ? wsPath : ''
    };
  } catch {
    return { port: null, browserWsPath: '' };
  }
}

function isExternalNonHostBrowserProduct(browserStr, userAgentStr = '') {
  const b = String(browserStr || '').trim();
  const ua = String(userAgentStr || '').trim();
  if (!b && !ua) return false;
  if (/electron|antigravity/i.test(b) || /electron\/|antigravity\//i.test(ua)) return false;
  return /^(?:Headless)?Chrome\/|^Edg\/|^Brave\//i.test(b);
}

function isValidLoopbackWsUrl(rawWs, port) {
  try {
    const u = new URL(String(rawWs || '').trim());
    return (
      (u.protocol === 'ws:' || u.protocol === 'wss:') &&
      (u.hostname === '127.0.0.1' || u.hostname === 'localhost') &&
      Number(u.port) === Number(port) &&
      !u.username &&
      !u.password
    );
  } catch {
    return false;
  }
}

function httpGetLocalJson(port, urlPath, timeoutMs = 450) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (val) => {
      if (!settled) {
        settled = true;
        resolve(val);
      }
    };
    const req = http.get({ host: '127.0.0.1', port, path: urlPath, timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) {
        res.resume?.();
        return done({ ok: false, value: null });
      }
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          done({ ok: true, value: JSON.parse(data) });
        } catch {
          done({ ok: false, value: null });
        }
      });
      res.on('error', () => done({ ok: false, value: null }));
    });
    req.on('error', () => done({ ok: false, value: null }));
    req.on('timeout', () => {
      req.destroy();
      done({ ok: false, value: null });
    });
  });
}

async function fetchBrowserVersionInfo(port) {
  const res = await httpGetLocalJson(port, '/json/version', 450);
  const parsed = res.value;
  if (!res.ok || !parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { wsUrl: '', externalBrowser: false };
  }
  const rawWs = typeof parsed.webSocketDebuggerUrl === 'string' ? parsed.webSocketDebuggerUrl.trim() : '';
  return {
    wsUrl: isValidLoopbackWsUrl(rawWs, port) ? rawWs : '',
    externalBrowser: isExternalNonHostBrowserProduct(parsed.Browser, parsed['User-Agent'])
  };
}

async function fetchBrowserWsUrl(port, rejectExternal = false) {
  const info = await fetchBrowserVersionInfo(port);
  if (rejectExternal && info.externalBrowser) return '';
  return info.wsUrl;
}

async function fetchTargetsResult(port) {
  const res = await httpGetLocalJson(port, '/json/list', 450);
  if (res.ok && Array.isArray(res.value)) {
    return { reachable: true, targets: res.value };
  }
  return { reachable: false, targets: [] };
}

function fetchTargets(port) {
  return fetchTargetsResult(port).then((res) => res.targets);
}

function isAllowedOrigin(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return false;
  return activeConfig.allowedOrigins.some((prefix) => {
    if (typeof prefix !== 'string' || !prefix) return false;
    if (['http://localhost', 'https://localhost', 'http://127.0.0.1', 'https://127.0.0.1'].includes(prefix)) {
      try {
        const url = new URL(urlStr), allowed = new URL(prefix);
        return url.protocol === allowed.protocol && url.hostname === allowed.hostname && !url.username && !url.password;
      } catch { return false; }
    }
    return urlStr.startsWith(prefix);
  });
}

function isEventDiscoveryEnabled() {
  const isRunOnce = typeof RUN_ONCE !== 'undefined' && Boolean(RUN_ONCE);
  return Boolean(
    !isRunOnce &&
      !daemonExiting &&
      activeConfig.enabled &&
      activeConfig.modules?.cdpEventDiscovery !== false
  );
}

function closeAllBrowserWatchers() {
  for (const [, entry] of browserWatchers.entries()) {
    entry.closing = true;
    try {
      entry.ws?.close();
    } catch {}
  }
  browserWatchers.clear();
  browserWatcherBackoffUntil.clear();
}

function isSkippedNonHost(t, nowMs = Date.now()) {
  const id = String(t?.id || t?.targetId || '').trim();
  if (!id) return false;
  const skipped = skippedNonHostTargets.get(id);
  if (!skipped) return false;
  const url = String(t.url || '');
  if (skipped.url && url && skipped.url !== url) return false;
  const originKey = getTargetOriginKey(url);
  if (skipped.origin && originKey && skipped.origin !== originKey) return false;
  const attempts = skipped.attempts || 1;
  const ageMs = nowMs - (skipped.skippedAt || 0);
  const titleHasAg = String(t.title || '').includes('Antigravity');
  if (titleHasAg && !skipped.titleHadAg && attempts < 6 && ageMs >= 150) return false;
  if (titleHasAg && attempts < 6 && ageMs >= 3000) return false;
  if (attempts < 3 && ageMs >= 8000) return false;
  return true;
}

function isCandidateTargetInfo(t, nowMs = Date.now()) {
  if (!t || typeof t !== 'object') return false;
  const id = String(t.id || t.targetId || '').trim();
  if (!id) return false;
  const type = String(t.type || '');
  const url = String(t.url || '');
  if (!(type === 'page' || (type === 'iframe' && url.startsWith('plugin://swarm--')))) {
    return false;
  }
  if (url.startsWith('devtools://')) return false;
  if (!isAllowedOrigin(url)) return false;
  if (String(t.title || '').includes('Launchpad')) return false;
  if (isSkippedNonHost(t, nowMs)) return false;
  return true;
}

function handleBrowserTargetUpsert(info, watcherEntry) {
  if (!isEventDiscoveryEnabled()) return;
  if (!info || typeof info !== 'object') return;
  const targetId = String(info.targetId || info.id || '').trim();
  if (!targetId) return;

  const url = String(info.url || '');
  const title = String(info.title || '');
  const prevMeta = targetMetaMap.get(targetId);
  const nextParentId = info.parentId || prevMeta?.parentId || null;
  targetMetaMap.set(targetId, {
    type: info.type || prevMeta?.type || '',
    parentId: nextParentId,
    channel: watcherEntry.channel || prevMeta?.channel || 'stable',
    updatedAt: Date.now()
  });

  const skipped = skippedNonHostTargets.get(targetId);
  if (
    skipped &&
    (!isAllowedOrigin(url) ||
      (skipped.url && url && skipped.url !== url) ||
      (skipped.origin && getTargetOriginKey(url) !== skipped.origin))
  ) {
    skippedNonHostTargets.delete(targetId);
  }

  const existingAttached = attachedTargets.get(targetId);
  if (existingAttached) {
    if (url || title) {
      existingAttached.updateTargetUrl?.(url, title);
    }
    return;
  }

  if (attachingTargetIds.has(targetId)) return;
  if (!isCandidateTargetInfo(info, Date.now())) return;

  const syntheticTarget = {
    id: targetId,
    type: info.type,
    title: info.title || '',
    url,
    parentId: nextParentId,
    webSocketDebuggerUrl: `ws://127.0.0.1:${watcherEntry.port}/devtools/page/${targetId}`
  };
  void attachTarget(syntheticTarget, watcherEntry.endpoint);
}

function handleBrowserTargetDestroyed(rawTargetId) {
  const targetId = String(rawTargetId || '').trim();
  if (!targetId) return;
  if (attachingTargetIds.has(targetId)) {
    destroyedWhileAttaching.add(targetId);
  }
  const entry = attachedTargets.get(targetId);
  if (entry) {
    attachedTargets.delete(targetId);
    try {
      entry.ws?.close();
    } catch {}
  }
  targetThemeModes.delete(targetId);
  targetMetaMap.delete(targetId);
  skippedNonHostTargets.delete(targetId);
  syncThemeToChildIframes();
}

async function ensureBrowserWatcher(endpoint, port, browserWsPath = '', isFallbackPort = false) {
  if (!isEventDiscoveryEnabled() || !port) return false;
  const channel = endpoint?.channel || 'stable';
  const watcherKey = `${channel}:${port}`;

  // 同通道切换了新端口时，主动关闭旧端口上的残留 BrowserWatcher
  for (const [key, entry] of Array.from(browserWatchers.entries())) {
    if (entry.channel === channel && entry.port !== port) {
      entry.closing = true;
      browserWatchers.delete(key);
      browserWatcherBackoffUntil.delete(key);
      try {
        entry.ws?.close();
      } catch {}
    }
  }

  const desiredWsUrl = browserWsPath && browserWsPath.startsWith('/') ? `ws://127.0.0.1:${port}${browserWsPath}` : '';
  const existing = browserWatchers.get(watcherKey);
  if (existing && existing.ws) {
    const isAlive = existing.ws.readyState === WebSocket.CONNECTING || existing.ws.readyState === WebSocket.OPEN;
    const sameEndpointUrl = !desiredWsUrl || existing.wsUrl === desiredWsUrl;
    if (isAlive && sameEndpointUrl) {
      existing.endpoint = endpoint;
      return true;
    }
    existing.closing = true;
    browserWatchers.delete(watcherKey);
    try {
      existing.ws.close();
    } catch {}
  }

  const backoffUntil = browserWatcherBackoffUntil.get(watcherKey) || 0;
  if (Date.now() < backoffUntil) {
    return false;
  }

  const wsUrl = desiredWsUrl || (await fetchBrowserWsUrl(port, isFallbackPort));
  if (!wsUrl || !isEventDiscoveryEnabled()) return false;

  const existingAfterAwait = browserWatchers.get(watcherKey);
  if (
    existingAfterAwait &&
    existingAfterAwait.ws &&
    (existingAfterAwait.ws.readyState === WebSocket.CONNECTING || existingAfterAwait.ws.readyState === WebSocket.OPEN) &&
    existingAfterAwait.wsUrl === wsUrl
  ) {
    existingAfterAwait.endpoint = endpoint;
    return true;
  }

  try {
    const ws = new WebSocket(wsUrl);
    const watcherEntry = {
      ws,
      wsUrl,
      port,
      channel,
      endpoint,
      reconnectAfterMs: 0,
      closing: false
    };
    browserWatchers.set(watcherKey, watcherEntry);

    let msgId = 1;
    let disconnected = false;
    const handleDisconnect = () => {
      if (disconnected) return;
      disconnected = true;
      clearTimeout(watcherConnectTimer);
      if (browserWatchers.get(watcherKey) === watcherEntry) {
        browserWatchers.delete(watcherKey);
      }
      if (!watcherEntry.closing && isEventDiscoveryEnabled()) {
        const until = Date.now() + 5000;
        watcherEntry.reconnectAfterMs = until;
        browserWatcherBackoffUntil.set(watcherKey, until);
      }
    };

    const watcherConnectTimer = setTimeout(() => {
      if (!disconnected && ws.readyState === WebSocket.CONNECTING) {
        try {
          ws.close();
        } catch {}
        handleDisconnect();
      }
    }, 3000);

    ws.addEventListener('open', () => {
      clearTimeout(watcherConnectTimer);
      if (watcherEntry.closing || !isEventDiscoveryEnabled()) {
        try {
          ws.close();
        } catch {}
        return;
      }
      browserWatcherBackoffUntil.delete(watcherKey);
      watcherEntry.reconnectAfterMs = 0;
      try {
        ws.send(
          JSON.stringify({
            id: msgId++,
            method: 'Target.setDiscoverTargets',
            params: { discover: true }
          })
        );
        console.log(`[Daemon] Browser CDP watcher connected (${channel}:${port})`);
      } catch {}
    });

    ws.addEventListener('message', (event) => {
      if (watcherEntry.closing || !isEventDiscoveryEnabled()) return;
      let msg;
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!msg || !msg.method) return;
      if (msg.method === 'Target.targetCreated' || msg.method === 'Target.targetInfoChanged') {
        handleBrowserTargetUpsert(msg.params?.targetInfo, watcherEntry);
      } else if (msg.method === 'Target.targetDestroyed') {
        handleBrowserTargetDestroyed(msg.params?.targetId);
      }
    });

    ws.addEventListener('close', handleDisconnect);
    ws.addEventListener('error', handleDisconnect);
    return true;
  } catch {
    if (isEventDiscoveryEnabled()) {
      browserWatcherBackoffUntil.set(watcherKey, Date.now() + 5000);
    }
    return false;
  }
}

const CASCADE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_WATCHED_CASCADES = 12;

function normalizeCascadeIdList(raw) {
  const candidates = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === 'string') candidates.push(item);
    }
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed) {
      let decoded = trimmed;
      try {
        decoded = decodeURIComponent(trimmed);
      } catch {}
      for (const part of decoded.split(/[+,]/)) {
        candidates.push(part);
      }
    }
  }
  const seen = new Set();
  const out = [];
  for (const item of candidates) {
    const clean = String(item || '').trim().toLowerCase();
    if (!CASCADE_UUID_RE.test(clean) || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
    if (out.length >= MAX_WATCHED_CASCADES) break;
  }
  return out;
}

function parseMetricsSubscriptionPayload(rawPayload) {
  const raw = String(rawPayload ?? '').trim();
  if (!raw) return { valid: false, ids: [] };
  if (raw.startsWith('[')) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        return { valid: true, ids: normalizeCascadeIdList(arr) };
      }
    } catch {}
    return { valid: false, ids: [] };
  }
  const ids = normalizeCascadeIdList(raw);
  return { valid: ids.length > 0, ids };
}

function attachTarget(target, endpoint) {
  const wsUrl = target.webSocketDebuggerUrl;
  if (!wsUrl) return Promise.resolve(false);
  if (attachedTargets.has(target.id) || attachingTargetIds.has(target.id)) {
    return Promise.resolve(false);
  }
  attachingTargetIds.add(target.id);
  destroyedWhileAttaching.delete(target.id);

  return new Promise((resolveAttach) => {
    let ws = null;
    let settled = false;
    const finishAttach = (ok) => {
      if (!settled) {
        settled = true;
        clearTimeout(attachTimeout);
        attachingTargetIds.delete(target.id);
        if (destroyedWhileAttaching.delete(target.id)) {
          if (attachedTargets.get(target.id)?.ws === ws) {
            attachedTargets.delete(target.id);
          }
          targetThemeModes.delete(target.id);
          targetMetaMap.delete(target.id);
          skippedNonHostTargets.delete(target.id);
          try {
            ws?.close();
          } catch {}
          resolveAttach(false);
          return;
        }
        resolveAttach(ok);
      }
    };
    const attachTimeout = setTimeout(() => finishAttach(false), 2500);

    try {
      ws = new WebSocket(wsUrl);
      let msgId = 1;
      let watchedCascadeIds = [];
      let hasExplicitSubscription = false;
      let subscriptionGeneration = 0;
      let metricsCursor = 0;
      let metricsSyncPromise = null;
      let metricsQueuedForce = false;
      const perCascadeState = new Map();
      const resetMetricsSubscription = () => {
        subscriptionGeneration += 1;
        hasExplicitSubscription = false;
        watchedCascadeIds = [];
        perCascadeState.clear();
      };
      const acceptMetricsSubscription = (ids, explicit = true) => {
        if (hasExplicitSubscription === explicit && ids.join(',') === watchedCascadeIds.join(',')) return false;
        subscriptionGeneration += 1;
        watchedCascadeIds = ids;
        hasExplicitSubscription = explicit;
        metricsCursor = 0;
        perCascadeState.clear();
        return true;
      };
      let evalScriptId = null;
      const pendingCallbacks = new Map();

      const send = (method, params = {}) =>
        new Promise((resolve) => {
          if (ws.readyState !== WebSocket.OPEN) return resolve(null);
          const id = msgId++;
          const timer = setTimeout(() => {
            pendingCallbacks.delete(id);
            resolve(null);
          }, 2500);
          pendingCallbacks.set(id, (msg) => {
            clearTimeout(timer);
            resolve(msg);
          });
          ws.send(JSON.stringify({ id, method, params }));
        });

      let newDocQueue = Promise.resolve();
      let lastNewDocSig = '';

      const buildTargetInjectScript = () => {
        if (!activeConfig.enabled || target.type !== 'iframe') {
          return { script: cachedInjectScript, parentMode: '' };
        }
        const entry = attachedTargets.get(target.id);
        const parentMode = resolveParentThemeMode(entry || target, entry?.endpoint || endpoint) || '';
        if (parentMode !== 'dark' && parentMode !== 'light') {
          return {
            script: `window.__ag_host_theme_mode=null;\n${cachedInjectScript}`,
            parentMode: ''
          };
        }
        return {
          script: `window.__ag_host_theme_mode=${JSON.stringify(parentMode)};\n${cachedInjectScript}`,
          parentMode
        };
      };

      const updateNewDocScript = (force = false) => {
        newDocQueue = newDocQueue
          .then(async () => {
            if (!hostConfirmed || nonHostSettled || ws.readyState !== WebSocket.OPEN) return;
            const { script, parentMode } = buildTargetInjectScript();
            const nextSig = `${activeConfig.enabled}|${cachedPatchVersion}|${parentMode}`;
            if (!force && evalScriptId && nextSig === lastNewDocSig) return;
            if (evalScriptId) {
              await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: evalScriptId });
              evalScriptId = null;
            }
            if (activeConfig.enabled && hostConfirmed && !nonHostSettled) {
              const addRes = await send('Page.addScriptToEvaluateOnNewDocument', { source: script });
              if (addRes?.result?.identifier) {
                evalScriptId = addRes.result.identifier;
                lastNewDocSig = nextSig;
                if (!hostConfirmed || nonHostSettled) {
                  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: evalScriptId });
                  evalScriptId = null;
                }
              }
            } else {
              lastNewDocSig = nextSig;
            }
          })
          .catch(() => {});
        return newDocQueue;
      };

      const inject = async () => {
        resetMetricsSubscription();
        if (!hostConfirmed || nonHostSettled || !isAllowedOrigin(currentTargetUrl)) return false;
        const generation = navigationGeneration;
        const { script } = buildTargetInjectScript();
        const res = await send('Runtime.evaluate', {
          expression: script,
          returnByValue: true
        });
        if (!res || ws.readyState !== WebSocket.OPEN || destroyedWhileAttaching.has(target.id) || generation !== navigationGeneration || !hostConfirmed || nonHostSettled) return false;
        if (res?.error) {
          console.error(`[Daemon] Injection error on ${target.id}:`, res.error.message || res.error);
          return false;
        } else if (res?.result?.exceptionDetails) {
          console.error(
            `[Daemon] Injection failed on ${target.id}: Script Exception:`,
            res.result.exceptionDetails.exception?.description || res.result.exceptionDetails.text
          );
          return false;
        } else {
          if (target.type === 'page') {
            if (!activeConfig.enabled) {
              targetThemeModes.delete(target.id);
            } else {
              const resolvedMode = res?.result?.result?.value;
              if (resolvedMode === 'dark' || resolvedMode === 'light') {
                const prevMode = targetThemeModes.get(target.id);
                targetThemeModes.set(target.id, resolvedMode);
                if (prevMode !== resolvedMode) {
                  syncThemeToChildIframes(target.id, resolvedMode);
                }
              }
            }
          }
          console.log(`[Daemon] Injected (${cachedPatchVersion}) into target ${target.id} [${endpoint.channel}]`);
          return true;
        }
      };

      const runMetricsSync = async (force = false, skipDomEval = false) => {
        const admitted = () => hostConfirmed && !nonHostSettled && ws.readyState === WebSocket.OPEN &&
          target.type === 'page' && isAllowedOrigin(currentTargetUrl) && DatabaseSync && activeConfig.modules.metrics && activeConfig.enabled;
        if (!admitted()) return;
        const navigation = navigationGeneration;
        let generation = subscriptionGeneration;
        const version = cachedPatchVersion;
        const valid = () => admitted() && navigation === navigationGeneration && generation === subscriptionGeneration && version === cachedPatchVersion;
        if (!skipDomEval && (!hasExplicitSubscription || force)) {
          const evalRes = await send('Runtime.evaluate', {
            expression: `(function(){
              if (Array.isArray(window.__ag_watched_cascade_ids) && typeof window.__ag_watched_cascade_sig === 'string') {
                return { ids: window.__ag_watched_cascade_ids, signature: window.__ag_watched_cascade_sig };
              }
              var out = [];
              var seen = {};
              var add = function(v) {
                var s = String(v || '').trim().toLowerCase();
                if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) && !seen[s]) {
                  seen[s] = true;
                  out.push(s);
                }
              };
              var addTab = function(v) {
                var m = String(v || '').trim().match(/^(?:side_question|subagent_convo)__([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
                if (m) add(m[1]);
              };
              var views = document.querySelectorAll('[data-testid="conversation-view"][data-cascade-id], [data-testid="side-question-tab-conversation"][data-cascade-id], [data-testid="subagent-tab-conversation"][data-cascade-id]');
              for (var i = 0; i < views.length; i++) add(views[i].getAttribute('data-cascade-id'));
              var activeTabs = document.querySelectorAll('[data-active-tab-id^="side_question__"], [data-active-tab-id^="subagent_convo__"]');
              for (var t = 0; t < activeTabs.length; t++) addTab(activeTabs[t].getAttribute('data-active-tab-id'));
              try {
                var dec = decodeURIComponent(window.location.pathname || '');
                var m = dec.match(/\\/c\\/([^/?#]+)/i);
                if (m) {
                  var parts = m[1].split(/[+%]/);
                  for (var j = 0; j < parts.length; j++) add(parts[j]);
                }
                var sp = new URLSearchParams(window.location.search || '');
                add(sp.get('focused'));
                add(sp.get('cascadeId'));
                var tabs = sp.getAll('tab');
                for (var u = 0; u < tabs.length; u++) addTab(tabs[u]);
              } catch (e) {}
              if (out.length === 0) {
                var sel = document.querySelectorAll('[data-testid=conversation-row-sidebar][data-selected=true]');
                for (var k = 0; k < sel.length; k++) add(sel[k].getAttribute('data-cascade-id'));
              }
              return { ids: out };
            })()`,
            returnByValue: true
          });
          if (!valid()) return;
          const raw = evalRes?.result?.result?.value;
          if (raw && typeof raw === 'object' && Array.isArray(raw.ids)) {
            const ids = normalizeCascadeIdList(raw.ids);
            // DOM fallback is provisional. An empty/unhydrated page must keep being
            // polled until its runtime supplies a matching explicit signature.
            const explicit = typeof raw.signature === 'string' && raw.signature === ids.join(',');
            acceptMetricsSubscription(ids, explicit);
            generation = subscriptionGeneration;
          }
        }
        if (!valid() || watchedCascadeIds.length === 0) return;
        const ids = [...watchedCascadeIds];
        const subscriptionSig = ids.join(',');
        const currentEndpoint = attachedTargets.get(target.id)?.endpoint || endpoint;
        // One shared budget for the entire cascade batch, not one budget per pane.
        // This is a soft CPU/open budget: a single blocking filesystem/SQLite call is not interruptible.
        const budget = createMetricsPassBudget();
        const pendingUpdates = [];
        const start = metricsCursor % ids.length;
        for (let i = 0; i < ids.length; i++) {
          if (!metricsBudgetAvailable(budget)) break;
          const index = (start + i) % ids.length;
          const cid = ids[index];
          metricsCursor = (index + 1) % ids.length;
          let state = perCascadeState.get(cid);
          if (!state) { state = { lastPushedHash: '', lastRenderedSig: '' }; perCascadeState.set(cid, state); }
          const dbState = getDbState(cid, currentEndpoint);
          const dir = dbState?.dbPath ? path.dirname(dbState.dbPath) : '';
          const childSnap = dir ? getCompositeChildSnapshot(cid, dir, dbState.rawSig || dbState.sig, budget) : null;
          const sig = childSnap?.sig || dbState?.sig || 'empty';
          const sessionKey = `${cid}@${sig}|${metricsConfigEpoch}`;
          if (!force && !childSnap?.isDraining && !childSnap?.partialStale && sessionKey === state.lastPushedHash) continue;
          const payload = parseConversationMetrics(cid, currentEndpoint, dbState, childSnap, budget);
          if (!payload || payload.transientError) {
            if (force && payload?.cachedPayload) pendingUpdates.push({ cid, payload: payload.cachedPayload });
            continue;
          }
          const renderedSig = `${payload.hasData ? '1' : '0'}\n${payload.inlineHtml || ''}\n${payload.tooltipHtml || ''}`;
          if (force || renderedSig !== state.lastRenderedSig) {
            pendingUpdates.push({ cid, payload, state, renderedSig, sessionKey, canCommitHash: !payload.isDraining && !payload.partialStale });
          } else state.lastPushedHash = !payload.isDraining && !payload.partialStale ? sessionKey : '';
        }
        if (!valid() || !pendingUpdates.length) return;
        const payloads = pendingUpdates.map(u => u.payload);
        const response = await send('Runtime.evaluate', {
          expression: `(function(){
            if (window.__ag_patch_version !== ${JSON.stringify(version)} ||
                window.__ag_watched_cascade_sig !== ${JSON.stringify(subscriptionSig)} ||
                typeof window.__ag_render_metrics !== 'function') return [];
            const ack = [];
            for (const p of ${JSON.stringify(payloads)}) {
              if (window.__ag_render_metrics(p) === true) ack.push(p.cascadeId);
            }
            return ack;
          })()`,
          returnByValue: true
        });
        if (!valid() || response?.error || response?.result?.exceptionDetails) return;
        const ack = response?.result?.result?.value;
        if (!Array.isArray(ack)) return;
        const accepted = new Set(ack);
        for (const u of pendingUpdates) {
          if (!u.state || !accepted.has(u.cid) || perCascadeState.get(u.cid) !== u.state) continue;
          u.state.lastRenderedSig = u.renderedSig;
          u.state.lastPushedHash = u.canCommitHash ? u.sessionKey : '';
        }
      };

      const syncMetricsForSession = (force = false, skipDomEval = false) => {
        if (metricsSyncPromise) {
          metricsQueuedForce ||= force;
          return metricsSyncPromise;
        }
        const requestedForce = force || metricsQueuedForce;
        metricsQueuedForce = false;
        metricsSyncPromise = runMetricsSync(requestedForce, skipDomEval).catch(() => {}).finally(() => {
          metricsSyncPromise = null;
          // Coalesce subscription bursts. The next normal scheduler pass services the
          // newest generation; no unbounded immediate retry loop can drain DB budgets.
        });
        return metricsSyncPromise;
      };

      const checkAndInject = async () => {
        try {
          if (!hostConfirmed || nonHostSettled || ws.readyState !== WebSocket.OPEN) return;
          const generation = navigationGeneration;
          if (!isAllowedOrigin(currentTargetUrl)) {
            if (attachedTargets.get(target.id)?.ws === ws) {
              attachedTargets.delete(target.id);
              targetThemeModes.delete(target.id);
            }
            try {
              ws.close();
            } catch {}
            return;
          }
          if (isExemptInternalTarget({ type: target.type, url: currentTargetUrl })) {
            const checkRes = await send('Runtime.evaluate', {
              expression:
                '({ ok: window.__ag_patch_version === ' +
                JSON.stringify(cachedPatchVersion) +
                ' && (' +
                JSON.stringify(!activeConfig.enabled) +
                ' || (window.__ag_body_ready === true && !!document.getElementById("ag-custom-fonts"))), mode: ' +
                JSON.stringify(target.type === 'iframe' ? 'iframe' : 'page') +
                ' === "iframe" ? (window.__ag_host_theme_mode || null) : (window.__ag_resolved_theme_mode || null) })',
              returnByValue: true
            });
            if (generation !== navigationGeneration || !hostConfirmed || nonHostSettled) return;
            const checkVal = checkRes?.result?.result?.value;
            if (!checkVal || checkVal.ok !== true) {
              await inject();
              await syncMetricsForSession(true);
            } else if (activeConfig.enabled && target.type === 'page') {
              if (checkVal.mode === 'dark' || checkVal.mode === 'light') {
                const prevMode = targetThemeModes.get(target.id);
                targetThemeModes.set(target.id, checkVal.mode);
                if (prevMode !== checkVal.mode) {
                  syncThemeToChildIframes(target.id, checkVal.mode);
                }
              }
            } else if (activeConfig.enabled && target.type === 'iframe') {
              const entry = attachedTargets.get(target.id);
              const parentMode = resolveParentThemeMode(entry || target, entry?.endpoint || endpoint);
              if (checkVal.mode !== parentMode) {
                await send('Runtime.evaluate', {
                  expression: `window.__ag_set_host_theme_mode && window.__ag_set_host_theme_mode(${JSON.stringify(parentMode)})`,
                  returnByValue: false
                });
                await updateNewDocScript();
              } else if (!evalScriptId) {
                await updateNewDocScript();
              }
            }
            return;
          }
          const checkRes = await send('Runtime.evaluate', {
            expression: `({
              injected: window.__ag_patch_version === ${JSON.stringify(cachedPatchVersion)} && (${JSON.stringify(!activeConfig.enabled)} || (window.__ag_body_ready === true && !!document.getElementById("ag-custom-fonts"))),
              skipNonHost: window.__ag_skip_non_host === true,
              kind: ${HOST_PROBE_EXPRESSION},
              mode: window.__ag_resolved_theme_mode || null
            })`,
            returnByValue: true
          });
          if (generation !== navigationGeneration || !hostConfirmed || nonHostSettled) return;
          const state = checkRes?.result?.result?.value;
          if (!state || typeof state !== 'object') return;
          if (state.skipNonHost || state.kind === 'non_host') {
            await markNonHostAndDetach(currentTargetUrl);
            return;
          }
          if (state.kind === 'pending') {
            return;
          }
          if (state.injected !== true) {
            await inject();
            await syncMetricsForSession(true);
          } else if (activeConfig.enabled && target.type === 'page') {
            if (!evalScriptId) {
              await updateNewDocScript();
            }
            if (state.mode === 'dark' || state.mode === 'light') {
              const prevMode = targetThemeModes.get(target.id);
              targetThemeModes.set(target.id, state.mode);
              if (prevMode !== state.mode) {
                syncThemeToChildIframes(target.id, state.mode);
              }
            }
          }
        } catch {}
      };

      let currentTargetUrl = String(target.url || '');
      let currentTargetTitle = String(target.title || '');
      let navigationGeneration = 0;
      let hostConfirmed = false;
      let nonHostSettled = false;
      let pendingProbe = false;
      let probingPending = false;
      let pendingRecheckQueued = false;
      let pendingRetryCount = 0;
      let pendingRetryTimer = null;
      let runtimeEnabled = false;
      let pageEnabled = false;
      let bindingsAdded = false;
      let initialAttachDone = false;
      let navDebounceTimer = null;
      let lastHardReloadAt = 0;

      const clearPendingTimer = () => {
        if (pendingRetryTimer) {
          clearTimeout(pendingRetryTimer);
          pendingRetryTimer = null;
        }
      };

      const probeHostKind = async () => {
        const generation = navigationGeneration;
        const res = await send('Runtime.evaluate', {
          expression: HOST_PROBE_EXPRESSION,
          returnByValue: true
        });
        if (generation !== navigationGeneration) return 'pending';
        const val = res?.result?.result?.value;
        return val === 'host' || val === 'non_host' || val === 'pending' ? val : 'pending';
      };

      const markNonHostAndDetach = async (reasonUrl = currentTargetUrl) => {
        if (nonHostSettled) return;
        nonHostSettled = true;
        pendingProbe = false;
        hostConfirmed = false;
        clearPendingTimer();
        if (navDebounceTimer) {
          clearTimeout(navDebounceTimer);
          navDebounceTimer = null;
        }
        const skippedUrl = String(reasonUrl || target.url || '');
        const originKey = getTargetOriginKey(skippedUrl);
        if (skippedUrl || originKey) {
          const prevSkipped = skippedNonHostTargets.get(target.id);
          const sameEntry =
            prevSkipped &&
            (!prevSkipped.url || prevSkipped.url === skippedUrl) &&
            (!prevSkipped.origin || prevSkipped.origin === originKey);
          const attempts = sameEntry ? (prevSkipped.attempts || 1) + 1 : 1;
          const titleHasAg = String(currentTargetTitle || target.title || '').includes('Antigravity');
          skippedNonHostTargets.set(target.id, {
            url: skippedUrl,
            origin: originKey,
            skippedAt: Date.now(),
            attempts,
            titleHadAg: Boolean((sameEntry && prevSkipped.titleHadAg) || titleHasAg)
          });
        }
        if (evalScriptId && ws.readyState === WebSocket.OPEN) {
          const idToRemove = evalScriptId;
          evalScriptId = null;
          try {
            await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: idToRemove });
          } catch {}
        }
        if (attachedTargets.get(target.id)?.ws === ws) {
          attachedTargets.delete(target.id);
          targetThemeModes.delete(target.id);
        }
        clearTimeout(attachTimeout);
        try {
          ws.close();
        } catch {}
        finishAttach(false);
      };

      const promoteToHost = async () => {
        if (hostConfirmed || nonHostSettled || ws.readyState !== WebSocket.OPEN) return false;
        const generation = navigationGeneration;
        hostConfirmed = true;
        pendingProbe = false;
        clearPendingTimer();
        skippedNonHostTargets.delete(target.id);
        const entry = attachedTargets.get(target.id);
        if (entry && entry.ws === ws) {
          entry.hostConfirmed = true;
        }
        console.log(`[Daemon] Attached target: ${target.id} (${target.title || 'Untitled'}) [${endpoint.channel}]`);
        if (!pageEnabled) {
          pageEnabled = true;
          await send('Page.enable');
        }
        if (!runtimeEnabled) {
          runtimeEnabled = true;
          await send('Runtime.enable');
        }
        if (ws.readyState !== WebSocket.OPEN || nonHostSettled || !hostConfirmed || generation !== navigationGeneration) {
          finishAttach(false);
          return false;
        }
        if (!bindingsAdded) {
          bindingsAdded = true;
          await send('Runtime.addBinding', { name: '__agRequestMetrics' });
          if (target.type === 'page') {
            await send('Runtime.addBinding', { name: '__agRequestHardReload' });
            await send('Runtime.addBinding', { name: '__agSyncHostThemeMode' });
          }
        }
        if (ws.readyState !== WebSocket.OPEN || nonHostSettled || !hostConfirmed || generation !== navigationGeneration) {
          finishAttach(false);
          return false;
        }
        await updateNewDocScript(true);
        if (generation !== navigationGeneration || !hostConfirmed || nonHostSettled) return false;
        const ok = await inject();
        await syncMetricsForSession(true);
        initialAttachDone = true;
        clearTimeout(attachTimeout);
        finishAttach(ok);
        return ok;
      };

      const PENDING_RETRY_DELAYS_MS = [30, 50, 100, 200];
      const schedulePendingRetry = () => {
        clearPendingTimer();
        if (!pendingProbe || hostConfirmed || nonHostSettled || ws.readyState !== WebSocket.OPEN) return;
        if (pendingRetryCount >= 40) {
          pendingProbe = false;
          if (attachedTargets.get(target.id)?.ws === ws) {
            attachedTargets.delete(target.id);
            targetThemeModes.delete(target.id);
          }
          clearTimeout(attachTimeout);
          try {
            ws.close();
          } catch {}
          finishAttach(false);
          return;
        }
        const delayMs = PENDING_RETRY_DELAYS_MS[Math.min(pendingRetryCount, PENDING_RETRY_DELAYS_MS.length - 1)];
        pendingRetryCount += 1;
        pendingRetryTimer = setTimeout(() => {
          pendingRetryTimer = null;
          void recheckPendingHost();
        }, delayMs);
      };

      const recheckPendingHost = async () => {
        if (!pendingProbe || hostConfirmed || nonHostSettled || ws.readyState !== WebSocket.OPEN) return;
        if (probingPending) {
          pendingRecheckQueued = true;
          return;
        }
        probingPending = true;
        try {
          if (!isAllowedOrigin(currentTargetUrl)) {
            pendingProbe = false;
            clearPendingTimer();
            if (attachedTargets.get(target.id)?.ws === ws) {
              attachedTargets.delete(target.id);
              targetThemeModes.delete(target.id);
            }
            clearTimeout(attachTimeout);
            try {
              ws.close();
            } catch {}
            finishAttach(false);
            return;
          }
          if (isExemptInternalTarget({ type: target.type, url: currentTargetUrl })) {
            await promoteToHost();
            return;
          }
          const kind = await probeHostKind();
          if (ws.readyState !== WebSocket.OPEN || nonHostSettled || hostConfirmed) return;
          if (kind === 'host') {
            await promoteToHost();
          } else if (kind === 'non_host') {
            await markNonHostAndDetach(currentTargetUrl);
          } else if (!pendingRecheckQueued) {
            schedulePendingRetry();
          }
        } finally {
          probingPending = false;
          if (pendingRecheckQueued) {
            pendingRecheckQueued = false;
            if (pendingProbe && !hostConfirmed && !nonHostSettled && ws.readyState === WebSocket.OPEN) {
              void recheckPendingHost();
            }
          }
        }
      };

      ws.addEventListener('open', async () => {
        if (destroyedWhileAttaching.has(target.id) || ws.readyState !== WebSocket.OPEN || nonHostSettled) {
          finishAttach(false);
          return;
        }
        if (isExemptInternalTarget(target)) {
          await promoteToHost();
          return;
        }
        if (!runtimeEnabled) {
          runtimeEnabled = true;
          await send('Runtime.enable');
        }
        if (ws.readyState !== WebSocket.OPEN || nonHostSettled || destroyedWhileAttaching.has(target.id)) {
          finishAttach(false);
          return;
        }
        const kind = await probeHostKind();
        if (ws.readyState !== WebSocket.OPEN || nonHostSettled || destroyedWhileAttaching.has(target.id)) {
          finishAttach(false);
          return;
        }
        if (kind === 'host') {
          await promoteToHost();
          return;
        }
        if (kind === 'non_host') {
          await markNonHostAndDetach(currentTargetUrl);
          return;
        }
        pendingProbe = true;
        if (!pageEnabled) {
          pageEnabled = true;
          await send('Page.enable');
        }
        if (ws.readyState !== WebSocket.OPEN || nonHostSettled || destroyedWhileAttaching.has(target.id)) {
          finishAttach(false);
          return;
        }
        await recheckPendingHost();
      });

      ws.addEventListener('message', (event) => {
        try {
          const msg = JSON.parse(String(event.data));
          if (msg.id && pendingCallbacks.has(msg.id)) {
            const cb = pendingCallbacks.get(msg.id);
            pendingCallbacks.delete(msg.id);
            cb(msg);
            return;
          }
          if (msg.method === 'Runtime.bindingCalled' && msg.params?.name === '__agRequestMetrics') {
            if (!hostConfirmed || nonHostSettled || target.type !== 'page' || !activeConfig.enabled) return;
            const parsed = parseMetricsSubscriptionPayload(msg.params.payload);
            if (parsed.valid && acceptMetricsSubscription(parsed.ids)) syncMetricsForSession(true, true);
            return;
          }
          if (msg.method === 'Runtime.bindingCalled' && msg.params?.name === '__agSyncHostThemeMode') {
            const mode = String(msg.params.payload || '').trim();
            const contextId = msg.params.executionContextId;
            if (hostConfirmed && target.type === 'page' && activeConfig.enabled &&
                (mode === 'dark' || mode === 'light') && Number.isInteger(contextId) && contextId > 0) {
              const generation = navigationGeneration;
              send('Runtime.evaluate', {
                contextId,
                expression: `window.top === window && window.__ag_resolved_theme_mode === ${JSON.stringify(mode)} && (${HOST_PROBE_EXPRESSION}) === 'host'`,
                returnByValue: true
              }).then(res => {
                if (res?.result?.result?.value !== true || !hostConfirmed || nonHostSettled ||
                    !activeConfig.enabled || generation !== navigationGeneration) return;
                targetThemeModes.set(target.id, mode);
                syncThemeToChildIframes();
              }).catch(() => {});
            }
            return;
          }
          if (msg.method === 'Runtime.bindingCalled' && msg.params?.name === '__agRequestHardReload') {
            if (
              !hostConfirmed ||
              target.type !== 'page' ||
              !activeConfig.enabled ||
              activeConfig.modules.deadlockHealer === false ||
              activeConfig.modules.coldBootHealer !== true
            ) {
              return;
            }
            const now = Date.now();
            if (now - lastHardReloadAt < 60000) return;
            lastHardReloadAt = now;
            // Never reload a target just because a child execution context called a binding.
            // The page-owned callback checks generation, token, focus, drafts and activity
            // synchronously with location.reload; no unchecked Page.reload fallback exists.
            let request;
            try { request = JSON.parse(msg.params.payload || '{}'); } catch { return; }
            const contextId = msg.params.executionContextId;
            if (!Number.isInteger(contextId) || contextId <= 0 ||
                typeof request.token !== 'string' || !/^[0-9a-f-]{36}$/i.test(request.token)) return;
            send('Runtime.evaluate', {
              contextId,
              expression: `window.top === window && /^https?:\\/\\/(?:127\\.0\\.0\\.1|localhost)(?::\\d+)?$/i.test(window.location.origin) && typeof window.__ag_commit_coldboot_reload === 'function' && window.__ag_commit_coldboot_reload(${JSON.stringify(request.token)})`,
              returnByValue: true
            });
            return;
          }
          if (
            msg.method === 'Page.frameNavigated' &&
            (!msg.params?.frame?.parentId || msg.params.frame.id === target.id) &&
            msg.params?.frame?.url
          ) {
            currentTargetUrl = String(msg.params.frame.url);
            navigationGeneration += 1;
            resetMetricsSubscription();
            hostConfirmed = false;
            pendingProbe = true;
            pendingRetryCount = 0;
            targetThemeModes.delete(target.id);
            syncThemeToChildIframes();
          }
          if (
            msg.method === 'Page.frameNavigated' ||
            msg.method === 'Page.loadEventFired' ||
            msg.method === 'Page.domContentEventFired'
          ) {
            if (!msg.params?.frame || !msg.params.frame.parentId || msg.params.frame.id === target.id) {
              if (pendingProbe && !hostConfirmed && !nonHostSettled) {
                void recheckPendingHost();
                return;
              }
              if (!initialAttachDone) return;
              if (navDebounceTimer) clearTimeout(navDebounceTimer);
              navDebounceTimer = setTimeout(() => {
                navDebounceTimer = null;
                checkAndInject();
              }, 120);
            }
          }
        } catch {}
      });

      const closeHandler = () => {
        resetMetricsSubscription();
        clearTimeout(attachTimeout);
        clearPendingTimer();
        pendingProbe = false;
        if (navDebounceTimer) {
          clearTimeout(navDebounceTimer);
          navDebounceTimer = null;
        }
        for (const [, cb] of pendingCallbacks) cb(null);
        pendingCallbacks.clear();
        if (attachedTargets.get(target.id)?.ws === ws) {
          attachedTargets.delete(target.id);
          targetThemeModes.delete(target.id);
        }
        finishAttach(false);
      };
      ws.addEventListener('close', closeHandler);
      ws.addEventListener('error', closeHandler);

      attachedTargets.set(target.id, {
        ws,
        type: target.type,
        parentId: target.parentId || null,
        attachedAt: Date.now(),
        send,
        updateNewDocScript,
        inject,
        checkAndInject,
        syncMetricsForSession,
        endpoint,
        get hostConfirmed() {
          return hostConfirmed;
        },
        set hostConfirmed(v) {
          hostConfirmed = Boolean(v);
        },
        updateTargetUrl: (u, nextTitle = '') => {
          let changed = false;
          if (nextTitle) {
            const tStr = String(nextTitle);
            if (tStr !== currentTargetTitle) {
              currentTargetTitle = tStr;
              if (tStr.includes('Antigravity')) changed = true;
            }
          }
          if (u) {
            const nextUrl = String(u);
            if (nextUrl !== currentTargetUrl) {
              currentTargetUrl = nextUrl;
              changed = true;
            }
          }
          if (changed && pendingProbe && !hostConfirmed && !nonHostSettled && ws.readyState === WebSocket.OPEN) {
            void recheckPendingHost();
          }
        },
        setActiveCascade: (cid) => {
          acceptMetricsSubscription(normalizeCascadeIdList(cid));
        }
      });
    } catch {
      clearTimeout(attachTimeout);
      finishAttach(false);
    }
  });
}

let isSyncing = false;
let syncTickCount = 0;
// This fork is runtime-only: never execute an unversioned external binary-patch script.

const fallbackBackoffUntil = new Map();

async function sync() {
  if (isSyncing) return;
  isSyncing = true;
  const syncStartMs = Date.now();
  syncTickCount = (syncTickCount + 1) % 6000;
  try {
    const bundleChanged = rebuildBundleIfNeeded();
    if (!activeConfig.enabled) {
      targetThemeModes.clear();
    }
    if (!isEventDiscoveryEnabled()) {
      closeAllBrowserWatchers();
    }
    const shouldHeartbeatCheck = bundleChanged || syncTickCount % 6 === 1;

    const activeTargetIds = new Set();
    const seenRawTargetIds = new Set();
    const pendingPages = [];
    const pendingIframes = [];

    const probedPorts = new Set();
    const nowMs = Date.now();
    for (const endpoint of activeConfig.endpoints) {
      const portInfo = readPortInfo(endpoint.portFile);
      let activePort = portInfo.port;
      let activeBrowserWsPath = portInfo.browserWsPath;
      let fromPortFile = false;
      let reachable = false;
      let targets = [];
      if (activePort && !probedPorts.has(activePort)) {
        probedPorts.add(activePort);
        const res = await fetchTargetsResult(activePort);
        reachable = res.reachable;
        targets = res.targets;
        if (reachable) fromPortFile = true;
      }
      if (
        !reachable &&
        endpoint.channelInstalled !== false &&
        endpoint.fallbackPort &&
        !probedPorts.has(endpoint.fallbackPort) &&
        (RUN_ONCE || nowMs >= (fallbackBackoffUntil.get(endpoint.fallbackPort) || 0))
      ) {
        probedPorts.add(endpoint.fallbackPort);
        const res = await fetchTargetsResult(endpoint.fallbackPort);
        if (!res.reachable) {
          fallbackBackoffUntil.set(endpoint.fallbackPort, nowMs + 10000);
        } else {
          const verInfo = await fetchBrowserVersionInfo(endpoint.fallbackPort);
          if (verInfo.externalBrowser) {
            fallbackBackoffUntil.set(endpoint.fallbackPort, nowMs + 10000);
          } else {
            reachable = true;
            targets = res.targets;
            fallbackBackoffUntil.delete(endpoint.fallbackPort);
            activePort = endpoint.fallbackPort;
            activeBrowserWsPath = '';
          }
        }
      }
      if (!reachable) continue;

      if (isEventDiscoveryEnabled() && activePort) {
        await ensureBrowserWatcher(endpoint, activePort, activeBrowserWsPath, !fromPortFile);
      }
      if (targets.length === 0) continue;

      for (const t of targets) {
        if (!t?.id) continue;
        seenRawTargetIds.add(t.id);
        targetMetaMap.set(t.id, {
          type: t.type,
          parentId: t.parentId || null,
          channel: endpoint.channel,
          updatedAt: Date.now()
        });
        const skipped = skippedNonHostTargets.get(t.id);
        if (
          skipped &&
          (!isAllowedOrigin(t.url) ||
            (skipped.url && String(t.url || '') && skipped.url !== String(t.url)) ||
            (skipped.origin && getTargetOriginKey(t.url) !== skipped.origin))
        ) {
          skippedNonHostTargets.delete(t.id);
        }
      }

      const pages = targets.filter((t) => Boolean(t.webSocketDebuggerUrl) && isCandidateTargetInfo(t, nowMs));

      for (const page of pages) {
        activeTargetIds.add(page.id);
        if (page.type === 'iframe') {
          pendingIframes.push({ page, endpoint });
        } else {
          pendingPages.push({ page, endpoint });
        }
      }
    }

    const syncTargetBatch = async (items) => {
      const attachPromises = [];
      for (const { page, endpoint } of items) {
        if (!attachedTargets.has(page.id)) {
          if (!attachingTargetIds.has(page.id)) {
            attachPromises.push(attachTarget(page, endpoint));
          }
        } else {
          const entry = attachedTargets.get(page.id);
          entry.endpoint = endpoint;
          entry.parentId = page.parentId || entry.parentId || null;
          entry.updateTargetUrl?.(page.url, page.title);
          if (entry.hostConfirmed) {
            if (bundleChanged && entry.updateNewDocScript) {
              await entry.updateNewDocScript();
            }
            if (shouldHeartbeatCheck && entry.checkAndInject) await entry.checkAndInject();
            if (entry.syncMetricsForSession) await entry.syncMetricsForSession(bundleChanged);
          }
        }
      }
      if (attachPromises.length > 0) {
        await Promise.allSettled(attachPromises);
      }
    };

    // 先同步宿主 page 目标以获取权威深浅色状态，再同步子 Swarm iframe（确保 --once 与冷启动零闪烁）
    await syncTargetBatch(pendingPages);
    await syncTargetBatch(pendingIframes);

    // 清理已关闭的目标连接（防竞态误杀：跳过本轮快照开始后由 BrowserWS 新附着的目标）
    for (const [id, entry] of attachedTargets.entries()) {
      if (!activeTargetIds.has(id)) {
        if (entry.attachedAt && entry.attachedAt >= syncStartMs) {
          continue;
        }
        try {
          entry.ws.close();
        } catch {}
        attachedTargets.delete(id);
        targetThemeModes.delete(id);
      }
    }
    if (seenRawTargetIds.size > 0) {
      for (const [id, skipped] of skippedNonHostTargets.entries()) {
        if (!seenRawTargetIds.has(id) && (skipped?.skippedAt || 0) < syncStartMs) {
          skippedNonHostTargets.delete(id);
        }
      }
      for (const [id, meta] of targetMetaMap.entries()) {
        if (
          !seenRawTargetIds.has(id) &&
          !attachedTargets.has(id) &&
          !attachingTargetIds.has(id) &&
          (meta?.updatedAt || 0) < syncStartMs
        ) {
          targetMetaMap.delete(id);
        }
      }
    } else if (attachedTargets.size === 0 && attachingTargetIds.size === 0) {
      for (const [id, skipped] of skippedNonHostTargets.entries()) {
        if ((skipped?.skippedAt || 0) < syncStartMs) {
          skippedNonHostTargets.delete(id);
        }
      }
      for (const [id, meta] of targetMetaMap.entries()) {
        if ((meta?.updatedAt || 0) < syncStartMs) {
          targetMetaMap.delete(id);
        }
      }
    }
    syncThemeToChildIframes();
  } finally {
    isSyncing = false;
  }
}

console.log(
  `[Antigravity Daemon] Started (${cachedPatchVersion}) | channel=${activeConfig.channel} | sqlite=${!!DatabaseSync} | safeMode=${SAFE_MODE}`
);

await sync();
if (RUN_ONCE) {
  daemonExiting = true;
  closeAllBrowserWatchers();
  for (const [, entry] of attachedTargets.entries()) {
    try {
      entry.ws.close();
    } catch {}
  }
  process.exit(0);
} else {
  setInterval(sync, 2500);
}
