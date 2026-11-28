#!/usr/bin/env node
/**
 * antigravity-parchment-theme · CDP Theme & Live Metrics Daemon (core/daemon.mjs)
 *
 * 架构特性（融合版 v6.0.6-eric.1 · macOS 专用）：
 * 1. 动态 Node 分级：
 *    - Node >= 22.0：完整启用昼夜双模式独立主题（暖纸浅色 + 暖墨深色）、Anthropic 三族字体、单层扁平输入框、扩展汉化（含 Electron 原生右键菜单跨隔离世界免 GC 汉化）、仿 Claude 右键浮窗卡片与 macOS 外部 IDE / 本地浏览器白名单安全桥接、宿主隔离、Browser 级 CDP 事件发现与在线快路径、死锁修复与实验性冷启动普通重载（默认关闭）及 curtainView/Swarm 适配。
 *    - Node >= 22.13：动态 `await import('node:sqlite')` 解锁底部实时会话指标胶囊（O(1) 增量尾行解析）与设置弹窗「Token 统计」增量归因分析；低版本优雅降级绝不崩溃。
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
import { execFile } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const CORE_DIR = path.join(ROOT_DIR, 'core');
const USER_DIR = path.join(ROOT_DIR, 'user');
const CACHE_DIR = path.join(ROOT_DIR, '.cache');

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
const BASE_VERSION = '20261128-v6.0.6-eric.1';
let cachedBundleSig = '';
let cachedInjectScript = '';
let cachedIframeInjectScript = '';
let cachedPatchVersion = '';
let metricsConfigEpoch = 0;
const lastBestEffortPayloadCache = new Map(); // initialized before the first bundle rebuild
const metricsCache = new Map(); // dbPath -> { sig, payload }
const incrementalMetricsMap = new Map(); // dbPath -> { rowCount, maxIdx, userStepsCount, lastUserStepIdx, items, validItems, totalIn, totalCache, totalOut, totalThink, totalResp }
const tokenAnalyticsDbCache = new Map(); // dbPath -> { sig, parsed, _inc }
const tokenAnalyticsSummariesCache = new Map(); // summariesDbPath -> { sig, map }
const tokenAnalyticsCacheState = {
  diskLoaded: false,
  persistTimer: null,
  flushInFlight: false,
  flushPending: false,
  coldDirty: false,
  hotDirty: false,
  lastJsonDataRef: null,
  lastJsonStr: ''
};
let lastTokenAnalyticsAccessMs = 0;
let inFlightTokenAnalyticsPromise = null;
let inFlightTokenAnalyticsKey = '';
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
  installedLocale: 'zh-CN',
  metricsMode: 'compact',
  contextLimit: 256000,
  contextLimitOverride: 0,
  modules: {
    theme: true,
    i18n: true,
    metrics: true,
    quota: true,
    tokenAnalytics: true,
    contextMenu: true,
    composerWaxSeal: true,
    deadlockHealer: true,
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
let cfgWriteSeq = 0;

function normalizeUiLangValue(rawVal) {
  const s = String(rawVal || '').trim().toLowerCase();
  if (s === 'en' || s === 'en-us' || s === 'english' || s === 'off' || s === 'false' || s === '0') {
    return 'en';
  }
  return 'target';
}

function broadcastUiLangToTargets(rawUiLang, excludeTargetId = null) {
  if (!activeConfig.enabled) return;
  const normLang = normalizeUiLangValue(rawUiLang);
  const wantI18n = normLang !== 'en';
  if (activeConfig.modules && typeof activeConfig.modules === 'object') {
    activeConfig.modules.i18n = wantI18n;
    metricsConfigEpoch += 1;
  }
  const expr = `window.__ag_set_host_ui_lang && window.__ag_set_host_ui_lang(${JSON.stringify(normLang)})`;
  const tasks = [];
  for (const [id, entry] of attachedTargets.entries()) {
    if (!entry?.hostConfirmed) continue;
    if (entry.updateNewDocScript) {
      tasks.push(entry.updateNewDocScript().catch(() => {}));
    }
    if (!excludeTargetId || id !== excludeTargetId) {
      if (entry.send) {
        tasks.push(entry.send('Runtime.evaluate', { expression: expr, returnByValue: false }).catch(() => {}));
      }
    }
    if (entry.type !== 'iframe') {
      if (wantI18n && entry.ensurePreloadContextMenuHook) {
        tasks.push(entry.ensurePreloadContextMenuHook().catch(() => {}));
      } else if (!wantI18n && entry.removePreloadContextMenuHook) {
        tasks.push(entry.removePreloadContextMenuHook().catch(() => {}));
      }
      if (entry.syncMetricsForSession) {
        tasks.push(entry.syncMetricsForSession(true).catch(() => {}));
      }
    }
  }
  if (tasks.length > 0) {
    void Promise.allSettled(tasks);
  }
}

function persistUiLangToUserConfig(rawUiLang, skipNewDocSync = false) {
  if (SAFE_MODE) return false;
  const normLang = normalizeUiLangValue(rawUiLang);
  const wantI18n = normLang !== 'en';
  const cfgPath = path.join(USER_DIR, 'config.json');
  const tmpPath = `${cfgPath}.tmp-${process.pid}-ul-${++cfgWriteSeq}`;
  try {
    fs.mkdirSync(USER_DIR, { recursive: true });
    let currentObj = {};
    if (fs.existsSync(cfgPath)) {
      let parsed = null;
      try {
        const rawText = fs.readFileSync(cfgPath, 'utf8').replace(/^\uFEFF/, '');
        parsed = JSON.parse(rawText);
      } catch {
        return false;
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return false;
      }
      currentObj = parsed;
    }
    const curModules =
      currentObj.modules && typeof currentObj.modules === 'object' && !Array.isArray(currentObj.modules)
        ? currentObj.modules
        : {};
    if (curModules.i18n === wantI18n && 'i18n' in curModules) {
      return true;
    }
    const nextModules = Object.assign({ i18n: wantI18n }, curModules, { i18n: wantI18n });
    const updatedObj = {};
    let inserted = false;
    for (const [k, v] of Object.entries(currentObj)) {
      if (k === 'modules') {
        updatedObj.modules = nextModules;
        inserted = true;
      } else {
        updatedObj[k] = v;
      }
    }
    if (!inserted) {
      updatedObj.modules = nextModules;
    }
    fs.writeFileSync(tmpPath, `${JSON.stringify(updatedObj, null, 2)}\n`, 'utf8');
    fs.renameSync(tmpPath, cfgPath);
    if (rebuildBundleIfNeeded({ fromUiPersist: true }) && !skipNewDocSync) {
      const tasks = [];
      for (const [, entry] of attachedTargets.entries()) {
        if (entry?.hostConfirmed && entry.updateNewDocScript) {
          tasks.push(entry.updateNewDocScript().catch(() => {}));
        }
      }
      if (tasks.length > 0) void Promise.allSettled(tasks);
    }
    return true;
  } catch {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {}
    return false;
  }
}

const BROWSER_PREVIEW_EXT_WHITELIST_RE = /^\.(html?|pdf|svg)$/i;
const EXTERNAL_EDITOR_PROBE_TTL_MS = 300000;
const EXTERNAL_EDITORS_CACHE_FILE = path.join(CACHE_DIR, 'external-editors.json');
let lastOpenExternalActionAt = 0;
let cachedExternalEditors = {
  probedAt: 0,
  sig: '',
  publicList: [],
  byId: new Map()
};

const EXTERNAL_EDITOR_SPECS = [
  {
    id: 'vscode',
    label: 'VS Code',
    scheme: 'vscode',
    family: 'vscode',
    macApps: ['/Applications/Visual Studio Code.app', '~/Applications/Visual Studio Code.app'],
    macCliRel: 'Contents/Resources/app/bin/code'
  },
  {
    id: 'vscode-insiders',
    label: 'VS Code Insiders',
    scheme: 'vscode-insiders',
    family: 'vscode',
    macApps: ['/Applications/Visual Studio Code - Insiders.app', '~/Applications/Visual Studio Code - Insiders.app'],
    macCliRel: 'Contents/Resources/app/bin/code-insiders'
  },
  {
    id: 'cursor',
    label: 'Cursor',
    scheme: 'cursor',
    family: 'vscode',
    macApps: ['/Applications/Cursor.app', '~/Applications/Cursor.app'],
    macCliRel: 'Contents/Resources/app/bin/cursor'
  },
  {
    id: 'windsurf',
    label: 'Windsurf',
    scheme: 'windsurf',
    family: 'vscode',
    macApps: ['/Applications/Windsurf.app', '~/Applications/Windsurf.app'],
    macCliRel: 'Contents/Resources/app/bin/windsurf'
  },
  {
    id: 'zed',
    label: 'Zed',
    scheme: 'zed',
    family: 'zed',
    macApps: ['/Applications/Zed.app', '~/Applications/Zed.app'],
    macCliRel: 'Contents/MacOS/cli'
  },
  {
    id: 'idea',
    label: 'IntelliJ IDEA',
    scheme: 'jetbrains',
    family: 'jetbrains',
    macApps: [
      '/Applications/IntelliJ IDEA.app',
      '/Applications/IntelliJ IDEA CE.app',
      '~/Applications/IntelliJ IDEA.app',
      '~/Applications/IntelliJ IDEA CE.app'
    ],
    macCliRel: 'Contents/MacOS/idea'
  },
  {
    id: 'pycharm',
    label: 'PyCharm',
    scheme: 'jetbrains',
    family: 'jetbrains',
    macApps: [
      '/Applications/PyCharm.app',
      '/Applications/PyCharm CE.app',
      '~/Applications/PyCharm.app',
      '~/Applications/PyCharm CE.app'
    ],
    macCliRel: 'Contents/MacOS/pycharm'
  },
  {
    id: 'webstorm',
    label: 'WebStorm',
    scheme: 'jetbrains',
    family: 'jetbrains',
    macApps: ['/Applications/WebStorm.app', '~/Applications/WebStorm.app'],
    macCliRel: 'Contents/MacOS/webstorm'
  },
  {
    id: 'goland',
    label: 'GoLand',
    scheme: 'jetbrains',
    family: 'jetbrains',
    macApps: ['/Applications/GoLand.app', '~/Applications/GoLand.app'],
    macCliRel: 'Contents/MacOS/goland'
  },
  {
    id: 'clion',
    label: 'CLion',
    scheme: 'jetbrains',
    family: 'jetbrains',
    macApps: ['/Applications/CLion.app', '~/Applications/CLion.app'],
    macCliRel: 'Contents/MacOS/clion'
  },
  {
    id: 'rustrover',
    label: 'RustRover',
    scheme: 'jetbrains',
    family: 'jetbrains',
    macApps: ['/Applications/RustRover.app', '~/Applications/RustRover.app'],
    macCliRel: 'Contents/MacOS/rustrover'
  },
  {
    id: 'sublimetext',
    label: 'Sublime Text',
    scheme: '',
    family: 'sublime',
    macApps: ['/Applications/Sublime Text.app', '~/Applications/Sublime Text.app'],
    macCliRel: 'Contents/SharedSupport/bin/subl'
  }
];
const EXTERNAL_EDITOR_SPEC_MAP = new Map(EXTERNAL_EDITOR_SPECS.map((s) => [s.id, s]));

function isExistingRegularFile(filePath) {
  try {
    return Boolean(filePath && fs.statSync(filePath, { throwIfNoEntry: false })?.isFile());
  } catch {
    return false;
  }
}

function isValidMacEditorEntryOnDisk(spec, execPath, isMacApp = false) {
  if (!spec || typeof execPath !== 'string' || !execPath || /[\0\r\n]/.test(execPath) || !path.isAbsolute(execPath)) {
    return false;
  }
  if (isMacApp) {
    try {
      return fs.existsSync(execPath);
    } catch {
      return false;
    }
  }
  return isExistingRegularFile(execPath);
}

function applyExternalEditorsEntries(entries, probedAt = Date.now()) {
  const byId = new Map();
  const publicList = [];
  for (const entry of entries) {
    byId.set(entry.id, entry);
    publicList.push({
      id: entry.id,
      label: entry.label,
      scheme: entry.scheme
    });
  }
  cachedExternalEditors = {
    probedAt,
    sig: entries.map((e) => `${e.id}:${e.execPath}`).join('|'),
    publicList,
    byId
  };
  return cachedExternalEditors;
}

function loadExternalEditorsDiskCache(now = Date.now()) {
  if (SAFE_MODE) return null;
  try {
    const raw = readJsonSafe(EXTERNAL_EDITORS_CACHE_FILE, null);
    if (!raw || typeof raw !== 'object' || raw.v !== 1 || raw.platform !== 'darwin') return null;
    const probedAt = Number(raw.probedAt);
    if (!Number.isFinite(probedAt) || probedAt <= 0 || now - probedAt >= EXTERNAL_EDITOR_PROBE_TTL_MS) {
      return null;
    }
    if (!Array.isArray(raw.entries)) return null;
    const validEntries = [];
    for (const item of raw.entries) {
      if (!item || typeof item !== 'object') continue;
      const spec = EXTERNAL_EDITOR_SPEC_MAP.get(String(item.id || ''));
      const execPath = typeof item.execPath === 'string' ? item.execPath : '';
      const isMacApp = Boolean(item.isMacApp);
      if (!spec || !isValidMacEditorEntryOnDisk(spec, execPath, isMacApp)) continue;
      validEntries.push({
        id: spec.id,
        label: spec.label,
        scheme: spec.scheme,
        family: spec.family,
        execPath,
        isMacApp
      });
    }
    return applyExternalEditorsEntries(validEntries, probedAt);
  } catch {
    return null;
  }
}

function saveExternalEditorsDiskCache(state) {
  if (SAFE_MODE || !state || !state.byId) return;
  const tmpPath = `${EXTERNAL_EDITORS_CACHE_FILE}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const payload = {
      v: 1,
      platform: 'darwin',
      probedAt: state.probedAt,
      entries: Array.from(state.byId.values()).map((e) => ({
        id: e.id,
        execPath: e.execPath,
        isMacApp: Boolean(e.isMacApp)
      }))
    };
    fs.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    fs.renameSync(tmpPath, EXTERNAL_EDITORS_CACHE_FILE);
  } catch {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {}
  }
}

function pruneMissingCachedExternalEditors() {
  if (cachedExternalEditors.probedAt <= 0) return cachedExternalEditors;
  let changed = false;
  const kept = [];
  for (const [id, entry] of cachedExternalEditors.byId.entries()) {
    const spec = EXTERNAL_EDITOR_SPEC_MAP.get(id);
    if (isValidMacEditorEntryOnDisk(spec, entry.execPath, entry.isMacApp)) {
      kept.push(entry);
    } else {
      changed = true;
    }
  }
  return changed ? applyExternalEditorsEntries(kept, cachedExternalEditors.probedAt) : cachedExternalEditors;
}

function detectInstalledExternalEditors(opts = {}) {
  const force = Boolean(opts && opts.force);
  const now = Date.now();
  if (!force && cachedExternalEditors.probedAt > 0 && now - cachedExternalEditors.probedAt < EXTERNAL_EDITOR_PROBE_TTL_MS) {
    return pruneMissingCachedExternalEditors();
  }
  if (!force) {
    const diskHit = loadExternalEditorsDiskCache(now);
    if (diskHit) return diskHit;
  }
  const home = os.homedir();
  const entries = [];
  for (const spec of EXTERNAL_EDITOR_SPECS) {
    let resolvedPath = '';
    let isMacApp = false;
    for (const rawApp of spec.macApps || []) {
      const appPath = rawApp.startsWith('~/') ? path.join(home, rawApp.slice(2)) : rawApp;
      if (!fs.existsSync(appPath)) continue;
      if (spec.macCliRel) {
        const cliPath = path.join(appPath, spec.macCliRel);
        if (isExistingRegularFile(cliPath)) {
          resolvedPath = cliPath;
          isMacApp = false;
          break;
        }
      }
      resolvedPath = appPath;
      isMacApp = true;
      break;
    }
    if (resolvedPath) {
      entries.push({
        id: spec.id,
        label: spec.label,
        scheme: spec.scheme,
        family: spec.family,
        execPath: resolvedPath,
        isMacApp
      });
    }
  }
  const next = applyExternalEditorsEntries(entries, now);
  saveExternalEditorsDiskCache(next);
  return next;
}

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

function rebuildBundleIfNeeded(opts = {}) {
  const fromUiPersist = !!(opts && opts.fromUiPersist);
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
  const externalEditorsState = detectInstalledExternalEditors();
  const sig =
    [...coreFiles, ...userFiles].map(getFileMtimeSig).join('|') +
    `|hostTheme:${hostThemeMode || ''}|editors:${externalEditorsState.sig}|safe:${SAFE_MODE}|cli:${CLI_CHANNEL || ''}`;
  if (sig === cachedBundleSig && cachedInjectScript) {
    return false;
  }

  const userCfg = SAFE_MODE ? {} : readJsonSafe(path.join(USER_DIR, 'config.json'), {});
  const enabled = SAFE_MODE ? true : userCfg.enabled !== false;
  const channel = CLI_CHANNEL || userCfg.channel || 'auto';
  const preset = userCfg.preset || 'high-contrast';
  const rawInstalledLocale = String(userCfg.installedLocale || 'zh-CN').trim() || 'zh-CN';
  const installedLocale =
    rawInstalledLocale === 'none' || rawInstalledLocale === 'zh-CN' ? rawInstalledLocale : 'zh-CN';
  const prevActiveI18nEnabled = activeConfig?.modules ? activeConfig.modules.i18n !== false : null;
  const rawCtxLimit = Number(userCfg.contextLimit);
  const contextLimit = Number.isFinite(rawCtxLimit) && rawCtxLimit > 0 ? rawCtxLimit : 256000;
  const rawCtxOverride = Number(userCfg.contextLimitOverride);
  const contextLimitOverride = Number.isFinite(rawCtxOverride) && rawCtxOverride > 0 ? rawCtxOverride : 0;
  const rawMetricsMode = String(userCfg.metricsMode || 'compact').trim().toLowerCase();
  const metricsMode = rawMetricsMode === 'full' || rawMetricsMode === 'legacy' ? 'full' : 'compact';
  if (
    activeConfig &&
    (contextLimit !== activeConfig.contextLimit ||
      contextLimitOverride !== activeConfig.contextLimitOverride ||
      metricsMode !== activeConfig.metricsMode)
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
      theme: true,
      i18n: true,
      metrics: true,
      quota: true,
      tokenAnalytics: true,
      contextMenu: true,
      composerWaxSeal: true,
      deadlockHealer: true,
      zoomShortcuts: true,
      cdpEventDiscovery: true,
      customCss: true,
      customJs: true
    },
    rawModules
  );
  if (SAFE_MODE && activeConfig?.modules && typeof activeConfig.modules.i18n === 'boolean') {
    modules.i18n = activeConfig.modules.i18n;
  }
  if (!DatabaseSync) {
    modules.metrics = false;
    modules.tokenAnalytics = false;
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
    installedLocale,
    metricsMode,
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

  const userOverrideDict =
    installedLocale === 'none' || SAFE_MODE
      ? {}
      : normalizeOverrideDict(readJsonSafe(path.join(USER_DIR, 'i18n.override.json'), {}));
  const i18nOverrideKeys = Object.keys(userOverrideDict);

  const mergedDict =
    installedLocale === 'none'
      ? {}
      : Object.assign({}, readJsonSafe(path.join(CORE_DIR, 'i18n.json'), {}), userOverrideDict);

  const customJs = !SAFE_MODE && modules.customJs ? readTextSafe(path.join(USER_DIR, 'custom.js'), '') : '';
  const runtimeTemplate = readTextSafe(path.join(CORE_DIR, 'runtime.js'), '');
  const installedEditors = modules.contextMenu !== false ? externalEditorsState.publicList : [];

  const { i18n: _omitI18nFromHash, ...hashModules } = modules;
  const hash = crypto
    .createHash('sha256')
    .update(String(enabled))
    .update(runtimeTemplate)
    .update(baseCss)
    .update(customCss)
    .update(JSON.stringify(mergedDict))
    .update(customJs)
    .update(
      JSON.stringify({
        preset,
        installedLocale,
        i18nOverrideKeys,
        metricsMode,
        modules: hashModules,
        installedEditors,
        themeVars,
        selectors: activeConfig.selectors,
        hostThemeMode
      })
    )
    .digest('hex')
    .slice(0, 8);

  if (!fromUiPersist && enabled) {
    if (prevActiveI18nEnabled !== null && (modules.i18n !== false) !== prevActiveI18nEnabled) {
      broadcastUiLangToTargets(modules.i18n === false ? 'en' : 'target', null);
    }
  }

  const channelTag = channel === 'insiders' ? 'insiders' : 'stable';
  cachedPatchVersion = `${BASE_VERSION}-${channelTag}-${hash}`;

  const RE_STRIP_TA_CSS = /\/\* __AG_TOKEN_ANALYTICS_CSS_START__ \*\/[\s\S]*?\/\* __AG_TOKEN_ANALYTICS_CSS_END__ \*\//g;
  const RE_STRIP_TA_JS = /\/\* __AG_TOKEN_ANALYTICS_JS_START__ \*\/[\s\S]*?\/\* __AG_TOKEN_ANALYTICS_JS_END__ \*\//g;
  const RE_STRIP_CM_CSS = /\/\* __AG_CONTEXT_MENU_CSS_START__ \*\/[\s\S]*?\/\* __AG_CONTEXT_MENU_CSS_END__ \*\//g;
  const RE_STRIP_CM_JS = /\/\* __AG_CONTEXT_MENU_JS_START__ \*\/[\s\S]*?\/\* __AG_CONTEXT_MENU_JS_END__ \*\//g;
  const WIDGETS_CSS_MARKER = '/* __AG_WIDGETS_CSS_START__ */';

  const stripThemeCssIfDisabled = (rawCss) => {
    if (modules.theme !== false) return rawCss;
    const wIdx = rawCss.indexOf(WIDGETS_CSS_MARKER);
    return wIdx >= 0 ? rawCss.slice(wIdx) : '';
  };

  let pageCss = stripThemeCssIfDisabled(baseCss);
  if (!modules.tokenAnalytics) pageCss = pageCss.replace(RE_STRIP_TA_CSS, '');
  let pageRuntime = modules.tokenAnalytics
    ? runtimeTemplate
    : runtimeTemplate.replace(RE_STRIP_TA_JS, '  cleanupTokenAnalyticsDom();');
  if (modules.contextMenu === false) {
    pageCss = pageCss.replace(RE_STRIP_CM_CSS, '');
    pageRuntime = pageRuntime.replace(RE_STRIP_CM_JS, '  cleanupContextMenuDom();');
  }

  const bootPayload = {
    version: cachedPatchVersion,
    platform: 'darwin',
    hostThemeMode,
    enabled,
    preset,
    installedLocale,
    cssText: pageCss,
    customCss,
    themeVars,
    i18nDict: mergedDict,
    i18nOverrideKeys,
    modules,
    installedEditors,
    selectors: activeConfig.selectors,
    config: {
      enabled,
      channel,
      preset,
      installedLocale,
      metricsMode,
      contextLimit,
      contextLimitOverride,
      modules,
      themeVars
    },
    customJs
  };

  cachedInjectScript = pageRuntime.replace('})(__AG_BOOT_PAYLOAD__);', () => `})(${JSON.stringify(bootPayload)});`);

  // Swarm 子 iframe 不承载设置弹窗与自定义右键浮窗，固定裁剪对应 CSS+JS 且保持同一 version 哈希
  const iframeModules = Object.assign({}, modules, { tokenAnalytics: false, quota: false, contextMenu: false });
  const iframePayload = Object.assign({}, bootPayload, {
    cssText: stripThemeCssIfDisabled(baseCss).replace(RE_STRIP_TA_CSS, '').replace(RE_STRIP_CM_CSS, ''),
    modules: iframeModules,
    installedEditors: [],
    config: Object.assign({}, bootPayload.config, { modules: iframeModules })
  });
  cachedIframeInjectScript = runtimeTemplate
    .replace(RE_STRIP_TA_JS, '')
    .replace(RE_STRIP_CM_JS, '')
    .replace('})(__AG_BOOT_PAYLOAD__);', () => `})(${JSON.stringify(iframePayload)});`);
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

function parseProtoAll(buf, tolerant = false) {
  const fields = [];
  if (!buf || typeof buf.length !== 'number' || buf.length === 0) return fields;
  let i = 0;
  const n = buf.length;
  while (i < n) {
    let tag = 0;
    let shift = 0;
    while (i < n) {
      const b = buf[i++];
      tag |= (b & 0x7f) << shift;
      if (!(b & 0x80)) break;
      shift += 7;
      if (shift > 35) return fields;
    }
    const fn = tag >>> 3;
    const wt = tag & 7;
    if (fn <= 0 || fn > 10000) break;
    if (wt === 0) {
      let val = 0;
      let m = 1;
      while (i < n) {
        const b = buf[i++];
        val += (b & 0x7f) * m;
        if (!(b & 0x80)) break;
        m *= 128;
        if (m > 2 ** 64) return fields;
      }
      fields.push({ f: fn, w: 0, v: val });
    } else if (wt === 2) {
      let len = 0;
      let s = 0;
      while (i < n) {
        const b = buf[i++];
        len |= (b & 0x7f) << s;
        if (!(b & 0x80)) break;
        s += 7;
        if (s > 35) return fields;
      }
      if (len < 0 || i + len > n) {
        if (tolerant && i < n) {
          fields.push({ f: fn, w: 2, buf: buf.subarray(i), partial: true });
        }
        break;
      }
      fields.push({ f: fn, w: 2, buf: buf.subarray(i, i + len) });
      i += len;
    } else if (wt === 1) {
      if (i + 8 > n) break;
      fields.push({ f: fn, w: 1, buf: buf.subarray(i, i + 8) });
      i += 8;
    } else if (wt === 5) {
      if (i + 4 > n) break;
      fields.push({ f: fn, w: 5, buf: buf.subarray(i, i + 4) });
      i += 4;
    } else {
      break;
    }
  }
  return fields;
}

function parseProto(buf) {
  const out = new Map();
  for (const fld of parseProtoAll(buf, false)) {
    out.set(fld.f, fld.w === 0 ? fld.v : fld.buf);
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
      const LINEAGE_COLD_AGE_MS = 7 * 86400 * 1000;
      // Rotate over active/unconfirmed nodes so unlimited history (>7d confirmed DBs)
      // does not burn stat() syscalls every scan tick; dirChanged still catches additions/deletions.
      const known = Array.from(dirState.nodes.entries()).filter(
        ([, node]) => !node.hasMeta || !node.mtimeMs || nowMs - node.mtimeMs < LINEAGE_COLD_AGE_MS
      );
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
        } else if (statInfo.sig === prevSig && nowMs - statInfo.mtimeMs >= 300000) {
          dirState.noMetaPending.delete(uuid);
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
          statSig: item.statSig,
          mtimeMs: item.mtimeMs || 0
        });
      } else {
        setNodeLineage(dirState, item.uuid, {
          hasMeta: false,
          parentId: '',
          rootId: '',
          statSig: item.statSig,
          mtimeMs: item.mtimeMs || 0
        });
        if (!res.permanentInvalid && Date.now() - item.mtimeMs < 300000) {
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
  const estCtx = ctxWin.get(1) || 0;
  const maxCtx = ctxWin.get(4) || 0;
  const ttftRaw = chat.get(11);
  const ttftMap = ttftRaw instanceof Uint8Array ? parseProto(ttftRaw) : new Map();
  const streamRaw = chat.get(12);
  const streamMap = streamRaw instanceof Uint8Array ? parseProto(streamRaw) : new Map();

  const inTok = usage.get(2) || 0;
  const outTok = usage.get(3) || 0;
  const cacheRead = usage.get(5) || 0;
  const apiProvider = usage.get(6) || 0;
  const thinkTok = usage.get(9) || 0;
  const respTok = usage.get(10) || 0;
  const slugRaw = chat.get(19);
  const slug = slugRaw instanceof Uint8Array ? textDecoder.decode(slugRaw) : '';
  const thinkUnreported =
    !usage.has(9) &&
    thinkTok === 0 &&
    (apiProvider === 26 || apiProvider === 31 || apiProvider === 32 || /^(?:claude|gpt)-/i.test(slug));
  const ttft = (ttftMap.get(1) || 0) + (ttftMap.get(2) || 0) / 1e9;
  const stream = (streamMap.get(1) || 0) + (streamMap.get(2) || 0) / 1e9;

  return {
    idx: r.idx,
    inTok,
    outTok,
    cacheRead,
    ctx: inTok + cacheRead,
    estCtx,
    maxCtx,
    thinkTok,
    respTok,
    thinkUnreported,
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
  if (!state || !state.dbPath || !state.sig) return { cascadeId, hasData: false, dbFound: false };
  const { dbPath, sig } = state;
  const conversationsDir = path.dirname(dbPath);
  const childSnap =
    precomputedChildSnap || getCompositeChildSnapshot(cascadeId, conversationsDir, state.rawSig || sig, budget);
  const isEnMetrics = activeConfig.modules?.i18n === false || activeConfig.installedLocale === 'none';
  const compositeSig = `${childSnap?.sig || sig}|${isEnMetrics ? 'en' : 'zh'}|${activeConfig.metricsMode === 'full' ? 'full' : 'compact'}`;

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
        dbFound: true,
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
    const rawUserLastIdx = userStat?.lastIdx ?? -1;
    const rawUserStepsCount = userStat?.cnt ?? 0;
    let lastTurnStepIdx = rawUserLastIdx;
    let effectiveTurnsCount = rawUserStepsCount;
    let isSubagentWakeTurns = false;
    if (rawUserStepsCount === 0) {
      // 子 Agent 与 Swarm Worker 会话不含 step_type=14，改按外部消息唤醒边界切分轮次（合并连发 [Message] 并排除后台 /task- 与系统广播）
      isSubagentWakeTurns = true;
      try {
        const wakeStat = db
          .prepare(
            `SELECT COUNT(*) AS cnt, COALESCE(MAX(s.idx), -1) AS lastIdx
             FROM steps s
             WHERE s.step_type = 101
               AND instr(substr(s.step_payload, 1, 1024), CAST('[Message]' AS BLOB)) > 0
               AND instr(substr(s.step_payload, 1, 1024), CAST('/task-' AS BLOB)) = 0
               AND instr(substr(s.step_payload, 1, 1024), CAST('sender=system' AS BLOB)) = 0
               AND NOT EXISTS (
                 SELECT 1 FROM steps p
                 WHERE p.idx = s.idx - 1
                   AND p.step_type = 101
                   AND instr(substr(p.step_payload, 1, 1024), CAST('[Message]' AS BLOB)) > 0
               )`
          )
          .get();
        const wakeCnt = wakeStat?.cnt ?? 0;
        lastTurnStepIdx = wakeStat?.lastIdx ?? -1;
        effectiveTurnsCount = wakeCnt > 0 ? wakeCnt : 1;
      } catch {
        isSubagentWakeTurns = false;
      }
    }
    const turnStat = db
      .prepare('SELECT COUNT(*) AS cnt FROM steps WHERE step_type = 15 AND idx > ?')
      .get(lastTurnStepIdx);
    const rawTurnSteps = turnStat?.cnt ?? 0;

    let inc = incrementalMetricsMap.get(dbPath);
    if (
      inc &&
      (rowCount < inc.rowCount ||
        maxIdx < inc.maxIdx ||
        effectiveTurnsCount < inc.userStepsCount ||
        lastTurnStepIdx < inc.lastUserStepIdx ||
        isSubagentWakeTurns !== Boolean(inc.isSubagentWakeTurns) ||
        (lastTurnStepIdx !== inc.lastUserStepIdx && effectiveTurnsCount <= inc.userStepsCount))
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
        inc.userStepsCount = effectiveTurnsCount;
        inc.lastUserStepIdx = lastTurnStepIdx;
        inc.isSubagentWakeTurns = isSubagentWakeTurns;
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
        userStepsCount: effectiveTurnsCount,
        lastUserStepIdx: lastTurnStepIdx,
        isSubagentWakeTurns,
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

    const userStepsCount = effectiveTurnsCount;
    const { validItems: valid, totalIn, totalCache, totalOut, totalThink, totalResp } = inc;
    if (valid.length === 0) {
      const emptyPayload = {
        cascadeId,
        hasData: false,
        dbFound: true,
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
    let turnIn = 0;
    let turnOut = 0;
    let turnThink = 0;
    let turnResp = 0;
    let turnDur = 0;
    let turnAllThinkUnreported = turnSlice.length > 0;
    for (let i = 0; i < turnSlice.length; i++) {
      turnIn += turnSlice[i].inTok;
      turnOut += turnSlice[i].outTok;
      turnThink += turnSlice[i].thinkTok;
      turnResp += turnSlice[i].respTok;
      turnDur += turnSlice[i].totDur;
      if (!turnSlice[i].thinkUnreported || turnSlice[i].thinkTok > 0) {
        turnAllThinkUnreported = false;
      }
    }
    let sessionAllThinkUnreported = totalThink === 0 && valid.length > 0;
    if (sessionAllThinkUnreported) {
      for (let i = 0; i < valid.length; i++) {
        if (!valid[i].thinkUnreported) {
          sessionAllThinkUnreported = false;
          break;
        }
      }
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
    const isFullMetrics = activeConfig.metricsMode === 'full';
    const turnsUnitEn = isSubagentWakeTurns
      ? userStepsCount === 1
        ? 'wake'
        : 'wakes'
      : userStepsCount === 1
        ? 'turn'
        : 'turns';
    const turnsUnitZh = isSubagentWakeTurns ? '次唤醒' : '轮提问';
    const combinedOut = totalOut + childOut;
    let inlineHtml = '';
    let tooltipHtml = '';

    if (isFullMetrics) {
      const subInlineHtml =
        childCount > 0 ? `<span class="ag-sep">·</span><span class="ag-sub-badge">+${childCount} sub</span>` : '';
      inlineHtml = [
        `<span>${Math.round(displayTps)} tok/s</span>`,
        `<span class="ag-sep">·</span>`,
        `<span>${useStream ? 'TTFT' : 'Hold'} ${last.ttft.toFixed(1)}s</span>`,
        `<span class="ag-sep">·</span>`,
        `<span>Ctx ${fmtTok(last.ctx)}/${limitStr} <span class="${ctxClass}">(${ctxPct}%)</span></span>`,
        `<span class="ag-sep">·</span>`,
        `<span>Out ${fmtTok(last.outTok)}</span>`,
        subInlineHtml
      ].join('');

      const turnOutDetailEn = turnAllThinkUnreported
        ? `Out ${fmtNum(turnOut)} (Think+Resp merged)`
        : `Out ${fmtNum(turnOut)} (Think ${fmtNum(turnThink)} + Resp ${fmtNum(turnResp)})`;
      const turnOutDetailZh = turnAllThinkUnreported
        ? `输出 ${fmtNum(turnOut)} (含思考链)`
        : `输出 ${fmtNum(turnOut)} (思考 ${fmtNum(turnThink)} + 响应 ${fmtNum(turnResp)})`;
      const turnRowHtml =
        turnSteps > 1
          ? isEnMetrics
            ? `<div class="ag-tt-row"><span class="ag-tt-lbl">Turn Total (${turnSteps} steps)</span><span class="ag-tt-val">${turnOutDetailEn} | ${turnDur.toFixed(1)}s</span></div>`
            : `<div class="ag-tt-row"><span class="ag-tt-lbl">本轮合计 (${turnSteps}步)</span><span class="ag-tt-val">${turnOutDetailZh} | 耗时 ${turnDur.toFixed(1)}s</span></div>`
          : '';
      const subRowHtml =
        childCount > 0
          ? isEnMetrics
            ? `<div class="ag-tt-row"><span class="ag-tt-lbl">Subagents (${childCount}${subSyncing ? ' · syncing' : ''})</span><span class="ag-tt-val">${childCalls} calls · New ${fmtTok(childIn)} + Cache ${fmtTok(childCache)} · Out ${fmtTok(childOut)}</span></div>`
            : `<div class="ag-tt-row"><span class="ag-tt-lbl">子 Agent (${childCount}${subSyncing ? ' · 同步中' : ''})</span><span class="ag-tt-val">${childCalls} 次 · 新增 ${fmtTok(childIn)} + 缓存 ${fmtTok(childCache)} · 输出 ${fmtTok(childOut)}</span></div>`
          : descendantIds.length > 0 && subSyncing
            ? isEnMetrics
              ? `<div class="ag-tt-row"><span class="ag-tt-lbl">Subagents (syncing)</span><span class="ag-tt-val">Indexing ${descendantIds.length} sub-sessions…</span></div>`
              : `<div class="ag-tt-row"><span class="ag-tt-lbl">子 Agent (同步中)</span><span class="ag-tt-val">正在索引 ${descendantIds.length} 个子会话…</span></div>`
            : '';
      const outputRowHtml =
        childCount > 0
          ? isEnMetrics
            ? `<div class="ag-tt-row"><span class="ag-tt-lbl">Total Output</span><span class="ag-tt-val">Total ${fmtTok(combinedOut)} (Main ${fmtTok(totalOut)} + Sub ${fmtTok(childOut)})</span></div>`
            : `<div class="ag-tt-row"><span class="ag-tt-lbl">累计输出量</span><span class="ag-tt-val">总计 ${fmtTok(combinedOut)} (主 ${fmtTok(totalOut)} + 子 ${fmtTok(childOut)})</span></div>`
          : sessionAllThinkUnreported
            ? isEnMetrics
              ? `<div class="ag-tt-row"><span class="ag-tt-lbl">Total Output</span><span class="ag-tt-val">Total ${fmtTok(totalOut)} (Think+Resp merged)</span></div>`
              : `<div class="ag-tt-row"><span class="ag-tt-lbl">累计输出量</span><span class="ag-tt-val">总计 ${fmtTok(totalOut)} (接口合并计入思考链)</span></div>`
            : isEnMetrics
              ? `<div class="ag-tt-row"><span class="ag-tt-lbl">Total Output</span><span class="ag-tt-val">Total ${fmtTok(totalOut)} (Think ${fmtTok(totalThink)} + Resp ${fmtTok(totalResp)})</span></div>`
              : `<div class="ag-tt-row"><span class="ag-tt-lbl">累计输出量</span><span class="ag-tt-val">总计 ${fmtTok(totalOut)} (思考链 ${fmtTok(totalThink)} + 正文/工具 ${fmtTok(totalResp)})</span></div>`;
      const stepOutValEn = last.thinkUnreported
        ? `${fmtNum(last.outTok)} (Think+Resp merged)`
        : `${fmtNum(last.outTok)} (Think ${fmtNum(last.thinkTok)} + Resp ${fmtNum(last.respTok)})`;
      const stepOutValZh = last.thinkUnreported
        ? `${fmtNum(last.outTok)} (接口合并计入思考链)`
        : `${fmtNum(last.outTok)} (思考链 ${fmtNum(last.thinkTok)} + 正文/工具 ${fmtNum(last.respTok)})`;

      tooltipHtml = isEnMetrics
        ? [
            `<div class="ag-tt-hdr">Latest Call (Gen #${last.idx + 1})</div>`,
            `<div class="ag-tt-row"><span class="ag-tt-lbl">Throughput</span><span class="ag-tt-val">${useStream ? `Stream ${rawStreamTps.toFixed(1)} tok/s | ` : ''}E2E ${e2eTps.toFixed(1)} tok/s</span></div>`,
            `<div class="ag-tt-row"><span class="ag-tt-lbl">Latency</span><span class="ag-tt-val">${useStream ? `TTFT ${last.ttft.toFixed(2)}s | Stream ${last.stream.toFixed(2)}s | Total ${last.totDur.toFixed(2)}s` : `Wait ${last.ttft.toFixed(2)}s | Flush ${last.stream.toFixed(2)}s | Total ${last.totDur.toFixed(2)}s`}</span></div>`,
            `<div class="ag-tt-row"><span class="ag-tt-lbl">Context</span><span class="ag-tt-val">${fmtNum(last.ctx)} (New ${fmtNum(last.inTok)} + Cache ${fmtNum(last.cacheRead)}, ${lastCacheRate}%)</span></div>`,
            `<div class="ag-tt-row"><span class="ag-tt-lbl">Step Output</span><span class="ag-tt-val">${stepOutValEn}</span></div>`,
            turnRowHtml,
            `<div class="ag-tt-hdr ag-tt-sec">Main Session Total (${userStepsCount} ${turnsUnitEn} / ${valid.length} calls)</div>`,
            `<div class="ag-tt-row"><span class="ag-tt-lbl">Context Window</span><span class="ag-tt-val">${fmtTok(last.ctx)} / ${limitStr} (${ctxPct}%) · ${fmtTok(remainCtx)} left</span></div>`,
            `<div class="ag-tt-row"><span class="ag-tt-lbl">Main Input</span><span class="ag-tt-val">New ${fmtTok(totalIn)} + Cache ${fmtTok(totalCache)} (${sessionCacheRate}% hit)</span></div>`,
            subRowHtml,
            outputRowHtml
          ].join('')
        : [
            `<div class="ag-tt-hdr">本轮最新调用 (Gen #${last.idx + 1})</div>`,
            `<div class="ag-tt-row"><span class="ag-tt-lbl">生成速度</span><span class="ag-tt-val">${useStream ? `流式 ${rawStreamTps.toFixed(1)} tok/s | ` : ''}端到端（含等待） ${e2eTps.toFixed(1)} tok/s</span></div>`,
            `<div class="ag-tt-row"><span class="ag-tt-lbl">响应耗时</span><span class="ag-tt-val">${useStream ? `TTFT ${last.ttft.toFixed(2)}s | 流式 ${last.stream.toFixed(2)}s | 总计 ${last.totDur.toFixed(2)}s` : `等待 ${last.ttft.toFixed(2)}s | 刷出 ${last.stream.toFixed(2)}s | 总计 ${last.totDur.toFixed(2)}s`}</span></div>`,
            `<div class="ag-tt-row"><span class="ag-tt-lbl">当前上下文</span><span class="ag-tt-val">${fmtNum(last.ctx)} (新增 ${fmtNum(last.inTok)} + 缓存 ${fmtNum(last.cacheRead)}, ${lastCacheRate}%)</span></div>`,
            `<div class="ag-tt-row"><span class="ag-tt-lbl">本步输出量</span><span class="ag-tt-val">${stepOutValZh}</span></div>`,
            turnRowHtml,
            `<div class="ag-tt-hdr ag-tt-sec">主会话累计 (${userStepsCount} ${turnsUnitZh} / ${valid.length} 次有效调用)</div>`,
            `<div class="ag-tt-row"><span class="ag-tt-lbl">上下文窗口用量</span><span class="ag-tt-val">${fmtTok(last.ctx)} / ${limitStr} (${ctxPct}%) · 剩余容量 ${fmtTok(remainCtx)}</span></div>`,
            `<div class="ag-tt-row"><span class="ag-tt-lbl">主会话累计输入</span><span class="ag-tt-val">新增 ${fmtTok(totalIn)} + 缓存读取 ${fmtTok(totalCache)} (命中率 ${sessionCacheRate}%)</span></div>`,
            subRowHtml,
            outputRowHtml
          ].join('');
    } else {
      const clampedPct = Math.max(0, Math.min(100, ctxPct));
      const ringVisualPct = last.ctx > 0 && clampedPct < 5 ? 5 : clampedPct;
      const ringCircum = 36.44;
      const ringOffset = (ringCircum * (1 - ringVisualPct / 100)).toFixed(2);
      const ringSvg = `<svg class="ag-ctx-ring ${ctxClass}" width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><circle class="ag-ctx-ring-track" cx="8" cy="8" r="5.8" fill="none" stroke-width="2.1"/><circle class="ag-ctx-ring-fill" cx="8" cy="8" r="5.8" fill="none" stroke-width="2.1" stroke-linecap="round" stroke-dasharray="${ringCircum}" stroke-dashoffset="${ringOffset}" transform="rotate(-90 8 8)"/></svg>`;
      const subInlineHtml =
        childCount > 0 ? `<span class="ag-sep">·</span><span class="ag-sub-badge">+${childCount} sub</span>` : '';

      inlineHtml = [
        ringSvg,
        `<span class="ag-ring-after">${Math.round(displayTps)} tok/s</span>`,
        `<span class="ag-sep">·</span>`,
        `<span>${useStream ? 'TTFT' : 'Hold'} ${last.ttft.toFixed(1)}s</span>`,
        subInlineHtml
      ].join('');

      const turnDisplayNum = userStepsCount > 0 ? userStepsCount : last.idx + 1;
      const effectiveTurnSteps = turnSteps > 0 ? turnSteps : 1;
      const effectiveTurnDur = turnSteps > 0 ? turnDur : last.totDur;
      const turnDurStr = effectiveTurnDur >= 10 ? `${Math.round(effectiveTurnDur)}s` : `${effectiveTurnDur.toFixed(1)}s`;

      const effectiveTurnIn = turnSteps > 0 ? turnIn : last.inTok;
      const effectiveTurnOut = turnSteps > 0 ? turnOut : last.outTok;
      const effectiveTurnThink = turnSteps > 0 ? turnThink : last.thinkTok;
      const effectiveTurnResp = turnSteps > 0 ? turnResp : last.respTok;
      const effectiveThinkUnreported = turnSteps > 0 ? turnAllThinkUnreported : Boolean(last.thinkUnreported);
      const splitSum = (effectiveTurnThink || 0) + (effectiveTurnResp || 0);
      const thinkRatioPct = splitSum > 0 ? Math.round(((effectiveTurnThink || 0) / splitSum) * 100) : 0;
      const respRatioPct = 100 - thinkRatioPct;

      const resolveCacheTier = (rateVal) =>
        rateVal >= 95 ? 'good' : rateVal >= 90 ? 'fair' : rateVal >= 50 ? 'low' : 'bad';
      const lastCacheTier = resolveCacheTier(Number(lastCacheRate) || 0);
      const sessionCacheTier = resolveCacheTier(Number(sessionCacheRate) || 0);
      const ctxVolTier = last.ctx > 400000 ? 'bad' : last.ctx >= 200000 ? 'fair' : 'good';

      const compactSplitRowEn = effectiveThinkUnreported
        ? `<div class="ag-tt-row ag-tt-row-merged"><span class="ag-tt-lbl">Output</span><span class="ag-tt-val">${fmtTok(effectiveTurnOut)} <span class="ag-tt-lbl">(Think+Resp merged)</span></span></div>`
        : `<div class="ag-tt-row ag-tt-row-merged"><span class="ag-tt-lbl">Output Split</span><span class="ag-tt-split-group"><span class="ag-tt-split-ratio ag-tt-think-lbl">Think ${thinkRatioPct}%</span><span class="ag-tt-split-track"><span class="ag-tt-split-think" style="width:${thinkRatioPct}%"></span><span class="ag-tt-split-resp" style="width:${respRatioPct}%"></span></span><span class="ag-tt-split-ratio ag-tt-resp-lbl">Resp ${respRatioPct}%</span></span></div>`;
      const compactSplitRowZh = effectiveThinkUnreported
        ? `<div class="ag-tt-row ag-tt-row-merged"><span class="ag-tt-lbl">本轮输出</span><span class="ag-tt-val">${fmtTok(effectiveTurnOut)} <span class="ag-tt-lbl">(接口合并计入思考链)</span></span></div>`
        : `<div class="ag-tt-row ag-tt-row-merged"><span class="ag-tt-lbl">输出比例</span><span class="ag-tt-split-group"><span class="ag-tt-split-ratio ag-tt-think-lbl">思考链 ${thinkRatioPct}%</span><span class="ag-tt-split-track"><span class="ag-tt-split-think" style="width:${thinkRatioPct}%"></span><span class="ag-tt-split-resp" style="width:${respRatioPct}%"></span></span><span class="ag-tt-split-ratio ag-tt-resp-lbl">正文/工具 ${respRatioPct}%</span></span></div>`;
      const turnHdrLabelEn = isSubagentWakeTurns ? `Wake #${turnDisplayNum}` : `Turn #${turnDisplayNum}`;
      const turnHdrLabelZh = isSubagentWakeTurns ? `第${turnDisplayNum}次唤醒` : `第${turnDisplayNum}轮`;
      const subCompactRowHtml =
        childCount > 0
          ? isEnMetrics
            ? `<div class="ag-tt-row"><span class="ag-tt-lbl">Subagents (${childCount}${subSyncing ? ' · syncing' : ''})</span><span class="ag-tt-val">${childCalls} calls · Out ${fmtTok(childOut)} (Total ${fmtTok(combinedOut)})</span></div>`
            : `<div class="ag-tt-row"><span class="ag-tt-lbl">子 Agent (${childCount}${subSyncing ? ' · 同步中' : ''})</span><span class="ag-tt-val">${childCalls} 次 · 输出 ${fmtTok(childOut)}（总计 ${fmtTok(combinedOut)}）</span></div>`
          : '';

      tooltipHtml = isEnMetrics
        ? [
            `<div class="ag-tt-hdr"><span>Current Turn</span><span class="ag-tt-hdr-meta">${turnHdrLabelEn} · ${effectiveTurnSteps} ${effectiveTurnSteps === 1 ? 'step' : 'steps'} · ${turnDurStr}</span></div>`,
            `<div class="ag-tt-row"><span class="ag-tt-lbl">Throughput</span><span class="ag-tt-val">${useStream ? `Stream ${rawStreamTps.toFixed(1)} tok/s | ` : ''}E2E ${e2eTps.toFixed(1)} tok/s</span></div>`,
            `<div class="ag-tt-row"><span class="ag-tt-lbl">Latency</span><span class="ag-tt-val">${useStream ? `TTFT ${last.ttft.toFixed(2)}s | Stream ${last.stream.toFixed(2)}s | Total ${last.totDur.toFixed(2)}s` : `Wait ${last.ttft.toFixed(2)}s | Flush ${last.stream.toFixed(2)}s | Total ${last.totDur.toFixed(2)}s`}</span></div>`,
            `<div class="ag-tt-row ag-tt-row-merged"><span class="ag-tt-lbl">Net Input</span><span class="ag-tt-compact-right"><span class="ag-tt-val">+${fmtTok(effectiveTurnIn)}</span><span class="ag-tt-cache-tag ag-cache-${lastCacheTier}">Cache ${lastCacheRate}%</span></span></div>`,
            compactSplitRowEn,
            `<div class="ag-tt-hdr ag-tt-sec"><span>Session Total</span><span class="ag-tt-hdr-meta">${userStepsCount} ${turnsUnitEn} / ${valid.length} calls</span></div>`,
            `<div class="ag-tt-row ag-tt-row-merged"><span class="ag-tt-bar-group"><span class="ag-tt-ctx-bar"><span class="ag-tt-ctx-fill ${ctxClass}" style="width:${clampedPct}%"></span></span><span class="ag-tt-bar-lbl ag-tt-num-${ctxVolTier}">${fmtTok(last.ctx)}/${limitStr} (${ctxPct}%)</span></span><span class="ag-tt-nowrap"><span class="ag-tt-lbl">Avg Cache </span><span class="ag-tt-val ag-tt-num-${sessionCacheTier}">${sessionCacheRate}%</span></span></div>`,
            subCompactRowHtml
          ].join('')
        : [
            `<div class="ag-tt-hdr"><span>当前轮次</span><span class="ag-tt-hdr-meta">${turnHdrLabelZh} 总${effectiveTurnSteps}步 共耗时${turnDurStr}</span></div>`,
            `<div class="ag-tt-row"><span class="ag-tt-lbl">生成速度</span><span class="ag-tt-val">${useStream ? `流式 ${rawStreamTps.toFixed(1)} tok/s | ` : ''}端到端 ${e2eTps.toFixed(1)} tok/s</span></div>`,
            `<div class="ag-tt-row"><span class="ag-tt-lbl">响应耗时</span><span class="ag-tt-val">${useStream ? `TTFT ${last.ttft.toFixed(2)}s | 流式 ${last.stream.toFixed(2)}s | 总计 ${last.totDur.toFixed(2)}s` : `等待 ${last.ttft.toFixed(2)}s | 刷出 ${last.stream.toFixed(2)}s | 总计 ${last.totDur.toFixed(2)}s`}</span></div>`,
            `<div class="ag-tt-row ag-tt-row-merged"><span class="ag-tt-lbl">本轮净增</span><span class="ag-tt-compact-right"><span class="ag-tt-val">+${fmtTok(effectiveTurnIn)}</span><span class="ag-tt-cache-tag ag-cache-${lastCacheTier}">缓存率 ${lastCacheRate}%</span></span></div>`,
            compactSplitRowZh,
            `<div class="ag-tt-hdr ag-tt-sec"><span>会话总计</span><span class="ag-tt-hdr-meta">${userStepsCount} ${turnsUnitZh} / ${valid.length} 次调用</span></div>`,
            `<div class="ag-tt-row ag-tt-row-merged"><span class="ag-tt-bar-group"><span class="ag-tt-ctx-bar"><span class="ag-tt-ctx-fill ${ctxClass}" style="width:${clampedPct}%"></span></span><span class="ag-tt-bar-lbl ag-tt-num-${ctxVolTier}">${fmtTok(last.ctx)}/${limitStr} (${ctxPct}%)</span></span><span class="ag-tt-nowrap"><span class="ag-tt-lbl">全轮次平均缓存 </span><span class="ag-tt-val ag-tt-num-${sessionCacheTier}">${sessionCacheRate}%</span></span></div>`,
            subCompactRowHtml
          ].join('');
    }

    const payload = {
      cascadeId,
      hasData: true,
      dbFound: true,
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
// 4.5 SQLite 全量增量 Token 统计分析（系统设置弹窗「Token 统计」Tab · macOS 精简版）
// ============================================================================
const TA_MEM_FILE_RE = /(?:^|[\\/])MEMORY\.md$|[\\/]\.gemini[\\/]antigravity[\\/]knowledge[\\/]|[\\/]memories[\\/]/i;
const TA_SLUG_LABELS = {
  'gemini-pro-orchestrator': 'Orchestrator (Carbon)',
  'gemini-pro-orchestrator-neon': 'Orchestrator (Neon)',
  'gemini-pro-orchestrator-g1-pro': 'Orchestrator (Argon)',
  'gemini-pro-orchestrator-argon': 'Orchestrator (Argon)',
  'gemini-pro-orchestrator-carbon': 'Orchestrator (Carbon)',
  'gemini-flash-worker-agy': 'Gemini 4 Hydrogen (Orchestrator)',
  'gemini-4-hydrogen': 'Gemini 4 Hydrogen',
  'gemini-4-hydrogen-low': 'Gemini 4 Hydrogen (Low)',
  'gemini-4-hydrogen-medium': 'Gemini 4 Hydrogen (Medium)',
  'gemini-4-hydrogen-high': 'Gemini 4 Hydrogen (High)',
  'gemini-4-hydrogen-xhigh': 'Gemini 4 Hydrogen (Extra High)',
  'gemini-4-hydrogen-sonar': 'Gemini 4 Hydrogen (Sonar)',
  'gemini-4-hydrogen-tiered-high': 'Gemini 4 Hydrogen (High)',
  'gemini-4-hydrogen-tiered-xhigh': 'Gemini 4 Hydrogen (Extra High)',
  'gemini-4-argon': 'Gemini 4 Argon',
  'gemini-4-argon-b': 'Gemini 4 Argon (High)',
  'gemini-4-argon-low': 'Gemini 4 Argon (Low)',
  'gemini-4-argon-medium': 'Gemini 4 Argon (Medium)',
  'gemini-4-argon-high': 'Gemini 4 Argon (High)',
  'gemini-4-argon-trial': 'Gemini 4 Argon',
  'gemini-4-carbon': 'Gemini 4 Carbon',
  'gemini-4-carbon-low': 'Gemini 4 Carbon (Low)',
  'gemini-4-carbon-medium': 'Gemini 4 Carbon (Medium)',
  'gemini-4-carbon-high': 'Gemini 4 Carbon (High)',
  'gemini-4-neon': 'Gemini 4 Neon',
  'gemini-4-neon-low': 'Gemini 4 Neon (Low)',
  'gemini-4-neon-medium': 'Gemini 4 Neon (Medium)',
  'gemini-4-neon-high': 'Gemini 4 Neon (High)',
  'gemini-4-neon-xhigh': 'Gemini 4 Neon (XHigh)',
  'gemini-3.8-flash': 'Gemini 3.8 Flash',
  'gemini-3.8-flash-n': 'Gemini 3.8 Flash',
  'gemini-3.8-flash-low': 'Gemini 3.8 Flash (Low)',
  'gemini-3.8-flash-medium': 'Gemini 3.8 Flash (Medium)',
  'gemini-3.8-flash-high': 'Gemini 3.8 Flash (High)',
  'gemini-3.8-flash-tiered': 'Gemini 3.8 Flash',
  'gemini-3.7-flash': 'Gemini 3.7 Flash',
  'gemini-3.5-flash': 'Gemini 3.5 Flash',
  'gemini-3.5-flash-lite': 'Gemini 3.5 Flash Lite',
  'gemini-3-pro': 'Gemini 3 Pro',
  'gemini-2.5-pro': 'Gemini 2.5 Pro',
  'claude-sonnet-4-6': 'Claude Sonnet 4.6',
  'claude-sonnet-5-5': 'Claude Sonnet 5.5',
  'claude-sonnet-5-5-low': 'Claude Sonnet 5.5 (Low)',
  'claude-sonnet-5-5-medium': 'Claude Sonnet 5.5 (Medium)',
  'claude-sonnet-5-5-high': 'Claude Sonnet 5.5 (High)',
  'claude-opus-4-6': 'Claude Opus 4.6',
  'claude-opus-4-6-thinking': 'Claude Opus 4.6 (Thinking)',
  'claude-opus-5-5': 'Claude Opus 5.5',
  'claude-opus-5-5-low': 'Claude Opus 5.5 (Low)',
  'claude-opus-5-5-medium': 'Claude Opus 5.5 (Medium)',
  'claude-opus-5-5-high': 'Claude Opus 5.5 (High)',
  'claude-opus-5-5-max': 'Claude Opus 5.5 (Max)',
  'gpt-oss-120b-medium': 'GPT-OSS 120B (Medium)',
  'gpt-oss-120b-maas': 'GPT-OSS 120B',
  'gpt-oss-20b-maas': 'GPT-OSS 20B'
};

const TA_CACHE_SCHEMA_REV = 6;
const TA_HOT_WINDOW_MS = 7 * 86400 * 1000;
const TA_CACHE_HOT_FILE = path.join(CACHE_DIR, 'token-analytics-hot.json');
const TA_CACHE_COLD_FILE = path.join(CACHE_DIR, 'token-analytics-cold.json');
const TA_CACHE_LEGACY_FILE = path.join(CACHE_DIR, 'token-analytics-index.json');
const TA_CACHE_FILE = TA_CACHE_HOT_FILE;
const TA_CACHE_SALT = crypto
  .createHash('sha1')
  .update(
    JSON.stringify({
      v: BASE_VERSION,
      rev: TA_CACHE_SCHEMA_REV,
      slugs: TA_SLUG_LABELS,
      memRe: TA_MEM_FILE_RE.source
    })
  )
  .digest('hex')
  .slice(0, 16);

function withReadOnlyDb(dbPath, timeoutMs, fn) {
  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true, timeout: timeoutMs });
    return fn(db);
  } finally {
    try {
      db?.close();
    } catch {}
  }
}

const taParseProtoAll = parseProtoAll;

function taParsePackedVarints(buf) {
  const out = [];
  if (!buf || typeof buf.length !== 'number') return out;
  let i = 0;
  while (i < buf.length) {
    let v = 0;
    let s = 0;
    while (i < buf.length) {
      const b = buf[i++];
      v |= (b & 0x7f) << s;
      if (!(b & 0x80)) break;
      s += 7;
      if (s > 35) return out;
    }
    out.push(v);
  }
  return out;
}

const taGetField = (fields, num) => fields.find((x) => x.f === num);
const taGetAllFields = (fields, num) => fields.filter((x) => x.f === num);
const taFieldToStr = (f) => (f?.buf ? textDecoder.decode(f.buf) : '');

function taInspectToolArgsForMemory(toolName, argsBuf) {
  if (/^memory_/i.test(toolName)) return true;
  if (!argsBuf || argsBuf.length === 0) return false;
  const headSample = textDecoder.decode(argsBuf.length > 4096 ? argsBuf.subarray(0, 4096) : argsBuf);
  if (!/memory|memories|knowledge/i.test(headSample)) return false;
  try {
    const obj = JSON.parse(textDecoder.decode(argsBuf));
    const pathVal = String(
      obj?.Path || obj?.TargetFile || obj?.File || obj?.path || obj?.file_path || obj?.uri || ''
    ).trim();
    return Boolean(pathVal && TA_MEM_FILE_RE.test(pathVal));
  } catch {
    return false;
  }
}

function taInspectStepMetadata(metaBuf, isToolStep) {
  let ts = 0;
  let isExitPlan = false;
  let hasMemoryPath = false;
  if (!metaBuf || !metaBuf.length) return { ts, isExitPlan, hasMemoryPath };
  let toolChecked = !isToolStep;
  for (const fld of taParseProtoAll(metaBuf, true)) {
    if (ts === 0 && fld.w === 2 && fld.buf.length >= 2 && fld.buf.length <= 24) {
      const sec = taGetField(taParseProtoAll(fld.buf), 1)?.v;
      if (sec && sec > 1700000000 && sec < 1900000000) ts = sec;
    } else if (!toolChecked && fld.f === 4 && fld.w === 2 && fld.buf.length >= 8) {
      toolChecked = true;
      let tName = '';
      let tArgsBuf = null;
      for (const tcFld of taParseProtoAll(fld.buf, true)) {
        if (tcFld.f === 2 && tcFld.w === 2 && !tcFld.partial) {
          tName = textDecoder.decode(tcFld.buf);
        } else if (tcFld.f === 3 && tcFld.w === 2) {
          tArgsBuf = tcFld.buf;
        }
      }
      if (tName === 'exit_plan_mode') isExitPlan = true;
      hasMemoryPath = taInspectToolArgsForMemory(tName, tArgsBuf);
    }
    if (ts > 0 && toolChecked) break;
  }
  return { ts, isExitPlan, hasMemoryPath };
}

function taResolveStepLookup(stepTs, fallbackSec) {
  const sorted = [...stepTs.keys()].sort((a, b) => a - b);
  return (stepIdx) => {
    if (stepTs.has(stepIdx)) return stepTs.get(stepIdx);
    let lo = 0;
    let hi = sorted.length - 1;
    let best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (sorted[mid] <= stepIdx) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (best >= 0) return stepTs.get(sorted[best]);
    return sorted.length > 0 ? stepTs.get(sorted[0]) : fallbackSec;
  };
}

function taExtractUserStepPlanConfig(payloadBuf) {
  if (!payloadBuf || !payloadBuf.length) return null;
  const u19 = taGetField(taParseProtoAll(payloadBuf), 19);
  if (!u19?.buf) return null;
  const u19Fields = taParseProtoAll(u19.buf);
  let plannerEnum = 0;
  let execEnum = 0;
  let planFlag = false;
  const mc12 = taGetField(u19Fields, 12);
  if (mc12?.buf) {
    const mc1 = taGetField(taParseProtoAll(mc12.buf), 1);
    if (mc1?.buf) {
      const mcFields = taParseProtoAll(mc1.buf);
      plannerEnum = taGetField(mcFields, 1)?.v || 0;
      const f60 = taGetField(mcFields, 60);
      if (f60?.buf) execEnum = taGetField(taParseProtoAll(f60.buf), 1)?.v || 0;
    }
  }
  const u18 = taGetField(u19Fields, 18);
  if (u18?.buf) {
    const f3 = taGetField(taParseProtoAll(u18.buf), 3);
    if (f3?.buf) {
      const f1 = taGetField(taParseProtoAll(f3.buf), 1);
      if (f1?.buf) planFlag = taParseProtoAll(f1.buf).some((x) => x.f === 6 && x.v === 1);
    }
  }
  return { orchestrator: Boolean(execEnum > 0 || planFlag), plannerEnum, execEnum };
}

function taResolvePlanStateLookup(planTimeline) {
  if (!Array.isArray(planTimeline) || planTimeline.length === 0) return () => null;
  return (stepIdx) => {
    let lo = 0;
    let hi = planTimeline.length - 1;
    let best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (planTimeline[mid].idx <= stepIdx) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return best >= 0 ? planTimeline[best] : null;
  };
}

function taNormalizePath(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  if (s.startsWith('file://')) {
    s = s.slice(7);
    try {
      s = decodeURIComponent(s);
    } catch {}
  }
  s = s.replace(/\/{2,}/g, '/');
  if (s.length > 1) s = s.replace(/\/+$/, '');
  return s || '/';
}

const TA_NORMALIZED_OS_TMP = taNormalizePath(os.tmpdir()).toLowerCase();

function taIsTempPath(p) {
  if (!p) return false;
  const low = p.toLowerCase();
  if (TA_NORMALIZED_OS_TMP.length > 1 && (low === TA_NORMALIZED_OS_TMP || low.startsWith(`${TA_NORMALIZED_OS_TMP}/`))) {
    return true;
  }
  return /^(?:\/private)?\/tmp(?:\/|$)|^\/var\/folders(?:\/|$)/i.test(low);
}

function taParseWorkspaceUrisList(workspaceUris) {
  if (!workspaceUris) return [];
  if (Array.isArray(workspaceUris)) return workspaceUris.map(taNormalizePath).filter(Boolean);
  const str = String(workspaceUris).trim();
  if (!str) return [];
  if (str.startsWith('[')) {
    try {
      const arr = JSON.parse(str);
      if (Array.isArray(arr)) return arr.map(taNormalizePath).filter(Boolean);
    } catch {}
  }
  const decoded = taNormalizePath(str);
  return decoded ? [decoded] : [];
}

function taNormalizeProjectInfo(workspaceUris, projectId = '') {
  const paths = taParseWorkspaceUrisList(workspaceUris);
  const nonTemp = paths.find((p) => !taIsTempPath(p));
  const chosen = nonTemp || paths[0] || '';
  if (!chosen || (String(projectId || '').trim() === 'outside-of-project' && !nonTemp)) {
    return { key: '__none__', name: '未绑定项目', rawBasename: '未绑定项目', path: '', isTemp: false };
  }
  if (taIsTempPath(chosen)) {
    return { key: '__tmp__', name: '临时目录 (/tmp)', rawBasename: '临时目录 (/tmp)', path: '/tmp', isTemp: true };
  }
  const parts = chosen.split('/').filter(Boolean);
  const base = parts[parts.length - 1] || chosen;
  return { key: chosen.toLowerCase(), name: base, rawBasename: base, path: chosen, isTemp: false };
}

function taClassifyModelPool({ label = '', slug = '', modelEnum = '', usedClaude = '', apiProvider = 0 } = {}) {
  const combined = `${label} ${slug} ${modelEnum}`.toLowerCase();
  if (combined.includes('argon')) return 'Argon';
  if (combined.includes('claude') || combined.includes('gpt')) return 'Claude';
  if (combined.includes('gemini') || combined.includes('orchestrator')) return 'Gemini';
  if (apiProvider === 26 || apiProvider === 31 || apiProvider === 32) return 'Claude';
  if (String(usedClaude).toLowerCase() === 'true') return 'Claude';
  return 'Gemini';
}

function taNormalizeModelLabel({ label = '', slug = '', modelEnum = '', enumId = 0 } = {}) {
  const trimmedLabel = String(label || '').trim();
  if (trimmedLabel) return trimmedLabel;
  const trimmedSlug = String(slug || '').trim();
  if (trimmedSlug) return TA_SLUG_LABELS[trimmedSlug] || trimmedSlug;
  if (modelEnum) return String(modelEnum).trim();
  return `model-${enumId || 'unknown'}`;
}

function taFormatOrchestratorModelLabel(label) {
  const trimmed = String(label || '').trim();
  if (!trimmed || /orchestrator/i.test(trimmed)) return trimmed;
  let core = trimmed.replace(/^Gemini\s+4\s+/i, '');
  const parenMatch = core.match(/^(.+?)\s*\(([^()]+)\)$/);
  if (parenMatch) core = `${parenMatch[1].trim()} · ${parenMatch[2].trim()}`;
  return `Orchestrator (${core})`;
}

function taResolveCallScenario(baseScenario, isSubagent, source) {
  if (isSubagent) return 'subagent';
  if (baseScenario === 'planning' || baseScenario === 'memory') return baseScenario;
  if (source === 'cli') return 'internal';
  return baseScenario || 'internal';
}

function taParseIsoSeconds(val) {
  if (!val) return 0;
  const str = String(val).trim();
  if (!str || str.startsWith('0001-01-01')) return 0;
  const ms = Date.parse(str.includes('T') ? str : str.replace(' ', 'T'));
  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
}

function taToLocalDateString(tsSec) {
  const d = new Date(tsSec * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function taLoadSummariesCached(summariesDbPath, force) {
  if (!summariesDbPath) return new Map();
  const sigInfo = getDbStatByPath(summariesDbPath);
  if (!sigInfo) return new Map();
  const cached = tokenAnalyticsSummariesCache.get(summariesDbPath);
  if (force !== 'hard' && cached && cached.sig === sigInfo.sig) return cached.map;
  try {
    const fresh = withReadOnlyDb(summariesDbPath, 150, (db) => {
      const map = new Map();
      const rows = db
        .prepare(
          `SELECT conversation_id, title, workspace_uris, project_id, source, agent_name,
                  parent_conversation_id, nesting_depth, last_modified_time
           FROM conversation_summaries`
        )
        .all();
      for (const r of rows) {
        if (!r?.conversation_id) continue;
        map.set(r.conversation_id, {
          id: r.conversation_id,
          title: String(r.title || '').trim(),
          workspaceUris: String(r.workspace_uris || ''),
          projectId: String(r.project_id || ''),
          source: String(r.source || '') === 'CORTEX_TRAJECTORY_SOURCE_CLI' ? 'cli' : 'desktop',
          agentName: String(r.agent_name || '').trim(),
          parentId: String(r.parent_conversation_id || '').trim(),
          nestingDepth: Number(r.nesting_depth || 0) || 0,
          lastModifiedSec: taParseIsoSeconds(r.last_modified_time)
        });
      }
      return map;
    });
    tokenAnalyticsSummariesCache.set(summariesDbPath, { sig: sigInfo.sig, map: fresh });
    return fresh;
  } catch {
    return cached ? cached.map : new Map();
  }
}

function taParseGenMetadataRowToCall(row, { lookupTs, lookupPlanState, stepByIdx, compactionStepIndices, trajParentId, state }) {
  const top = taParseProtoAll(row.data);
  const chatField = taGetField(top, 1);
  if (!chatField?.buf) return null;
  const chat = taParseProtoAll(chatField.buf);
  const usageField = taGetField(chat, 4);
  if (!usageField?.buf) return null;
  const usage = taParseProtoAll(usageField.buf);

  const kv = {};
  for (const entry of taGetAllFields(chat, 20)) {
    const pair = taParseProtoAll(entry.buf);
    const k = taFieldToStr(taGetField(pair, 1));
    if (k) kv[k] = taFieldToStr(taGetField(pair, 2));
  }

  const stepIndicesField = taGetField(top, 2);
  const stepIndices = stepIndicesField?.buf ? taParsePackedVarints(stepIndicesField.buf) : [];
  const refStep = stepIndices.length > 0 ? stepIndices[0] : Number(kv.last_step_index) || 0;
  const ts = lookupTs(refStep);

  let hasStep132 = false;
  let hasStep15 = false;
  let hasLinkedStep = false;
  let hasMemoryStep = false;
  let hasExitPlanStep = false;
  let hasNearbyCompaction = false;
  for (const sIdx of stepIndices) {
    const info = stepByIdx.get(sIdx);
    if (info) {
      hasLinkedStep = true;
      if (info.stepType === 132) hasStep132 = true;
      else if (info.stepType === 15) hasStep15 = true;
      if (info.hasMemoryPath) hasMemoryStep = true;
      if (info.isExitPlan) hasExitPlanStep = true;
    }
    if (
      compactionStepIndices.has(sIdx) ||
      compactionStepIndices.has(sIdx - 1) ||
      compactionStepIndices.has(sIdx + 1)
    ) {
      hasNearbyCompaction = true;
    }
  }
  if (!hasNearbyCompaction && stepIndices.length === 0 && refStep > 0) {
    hasNearbyCompaction =
      compactionStepIndices.has(refStep) ||
      compactionStepIndices.has(refStep - 1) ||
      compactionStepIndices.has(refStep + 1);
  }

  const slug = taFieldToStr(taGetField(chat, 19));
  const rawLabel = taFieldToStr(taGetField(chat, 21));
  const enumId = taGetField(usage, 1)?.v || taGetField(chat, 3)?.v || 0;
  const apiProvider = taGetField(usage, 6)?.v || 0;
  const modelEnum = kv.model_enum || '';
  const usedClaude = kv.used_claude || '';
  const baseLabel = taNormalizeModelLabel({ label: rawLabel, slug, modelEnum, enumId });
  const pool = taClassifyModelPool({ label: baseLabel, slug, modelEnum, usedClaude, apiProvider });

  const slugLower = String(slug || '').toLowerCase();
  const labelTrim = String(baseLabel || '').trim();
  const planSt = lookupPlanState(refStep);
  let isOrchestratorPlanning = false;
  if (slugLower.includes('worker')) {
    isOrchestratorPlanning = false;
  } else if (slugLower.includes('orchestrator') || /^orchestrator\b/i.test(labelTrim)) {
    isOrchestratorPlanning = true;
  } else if (hasExitPlanStep) {
    isOrchestratorPlanning = true;
  } else if (planSt?.orchestrator) {
    if (planSt.plannerEnum > 0 && planSt.execEnum > 0 && planSt.plannerEnum !== planSt.execEnum) {
      isOrchestratorPlanning = enumId === planSt.plannerEnum;
    } else {
      isOrchestratorPlanning = Boolean(planSt.inPlanPhase);
    }
  }

  let baseScenario = 'internal';
  if (isOrchestratorPlanning) {
    baseScenario = 'planning';
  } else if (hasNearbyCompaction || hasMemoryStep) {
    baseScenario = 'memory';
  } else if (hasLinkedStep) {
    if (hasStep132) baseScenario = 'tools';
    else if (hasStep15) baseScenario = 'chat';
  }

  const inTok = taGetField(usage, 2)?.v || 0;
  const outTok = taGetField(usage, 3)?.v || 0;
  const cacheRead = taGetField(usage, 5)?.v || 0;
  const thinkTok = taGetField(usage, 9)?.v || 0;
  const respTok = taGetField(usage, 10)?.v || 0;

  const subagentType = String(kv.subagent_type || '').trim();
  const parentCascadeId = String(kv.parent_cascade_id || '').trim();
  const rootCascadeId = String(kv.root_cascade_id || '').trim();
  if (!state.firstParentCascadeId && parentCascadeId) state.firstParentCascadeId = parentCascadeId;
  if (!state.firstRootCascadeId && rootCascadeId) state.firstRootCascadeId = rootCascadeId;
  if (!state.firstSubagentType && subagentType) state.firstSubagentType = subagentType;
  if (inTok === 0 && cacheRead === 0 && outTok === 0) return null;

  const isSubagentCall = Boolean(trajParentId || state.firstParentCascadeId || subagentType);
  const finalModelLabel =
    isOrchestratorPlanning && !isSubagentCall ? taFormatOrchestratorModelLabel(baseLabel) : baseLabel;

  return {
    gIdx: row.idx,
    ts,
    model: finalModelLabel,
    pool,
    inTok,
    cacheRead,
    outTok,
    thinkTok,
    respTok,
    total: inTok + cacheRead + outTok,
    weighted: Math.round(inTok + 0.1 * cacheRead + 6 * outTok),
    billable: inTok + outTok,
    baseScenario,
    subagentType
  };
}

function taIngestStepRow(row, stepTs, stepByIdx, compactionStepIndices, planTimeline, planCursor) {
  const { ts, isExitPlan, hasMemoryPath } = taInspectStepMetadata(row.metadata, row.step_type === 132);
  if (ts > 0) stepTs.set(row.idx, ts);
  if (row.step_type === 23) compactionStepIndices.add(row.idx);
  if (row.step_type === 14 && row.step_payload) {
    const cfg = taExtractUserStepPlanConfig(row.step_payload);
    if (cfg) {
      planCursor.cur = { ...cfg, inPlanPhase: cfg.orchestrator };
      planTimeline.push({ ...planCursor.cur, idx: row.idx });
    }
  } else if (row.step_type === 101 && row.step_payload && planCursor.cur.orchestrator) {
    const headStr = textDecoder.decode(row.step_payload);
    if (headStr.includes('Plan mode is off:') && planCursor.cur.inPlanPhase) {
      planCursor.cur = { ...planCursor.cur, inPlanPhase: false };
      planTimeline.push({ ...planCursor.cur, idx: row.idx });
    } else if (headStr.includes('[plan review]') && !planCursor.cur.inPlanPhase) {
      planCursor.cur = { ...planCursor.cur, inPlanPhase: true };
      planTimeline.push({ ...planCursor.cur, idx: row.idx });
    }
  }
  stepByIdx.set(row.idx, { stepType: row.step_type, hasMemoryPath, isExitPlan });
}

const TA_STEPS_SELECT_BASE = `SELECT idx, step_type, metadata,
  CASE
    WHEN step_type = 14 THEN step_payload
    WHEN step_type = 101 THEN substr(step_payload, 1, 1024)
    ELSE NULL
  END AS step_payload
  FROM steps`;

function taParseConversationDetailDb(dbPath, statInfo, prevCacheEntry = null) {
  const dbId = path.basename(dbPath, '.db');
  try {
    return withReadOnlyDb(dbPath, 150, (db) => {
      const fallbackSec = Math.floor((statInfo?.mtimeMs || Date.now()) / 1000);
      let trajParentId = '';
      let trajRootId = '';
      let trajWorkspaceUri = '';
      let trajProjectId = '';
      try {
        const mrow = db.prepare('SELECT data FROM trajectory_metadata_blob LIMIT 1').get();
        if (mrow?.data) {
          const mf = taParseProtoAll(mrow.data);
          trajParentId = taFieldToStr(taGetField(mf, 5)).trim();
          trajRootId = taFieldToStr(taGetField(mf, 6)).trim();
          trajWorkspaceUri = taFieldToStr(taGetField(mf, 7)).trim();
          trajProjectId = taFieldToStr(taGetField(mf, 18)).trim();
          if (!trajWorkspaceUri) {
            const wsField = taGetField(mf, 1);
            if (wsField?.buf) {
              const wsSub = taParseProtoAll(wsField.buf);
              trajWorkspaceUri =
                taFieldToStr(taGetField(wsSub, 1)).trim() || taFieldToStr(taGetField(wsSub, 2)).trim();
            }
          }
        }
      } catch {}

      const gmStat = db.prepare('SELECT COUNT(*) AS cnt, COALESCE(MAX(idx), -1) AS maxIdx FROM gen_metadata').get();
      const genCount = Number(gmStat?.cnt || 0);
      const maxGenIdx = Number(gmStat?.maxIdx ?? -1);
      if (genCount === 0) {
        return {
          ok: true,
          dbId,
          mtimeSec: fallbackSec,
          trajMeta: {
            parentId: trajParentId,
            rootId: trajRootId,
            subagentType: '',
            workspaceUri: trajWorkspaceUri,
            projectId: trajProjectId
          },
          calls: [],
          _inc: null
        };
      }

      const stStat = db.prepare('SELECT COUNT(*) AS cnt, COALESCE(MAX(idx), -1) AS maxIdx FROM steps').get();
      const stepCount = Number(stStat?.cnt || 0);
      const maxStepIdx = Number(stStat?.maxIdx ?? -1);

      const prevInc = prevCacheEntry?._inc;
      const prevParsed = prevCacheEntry?.parsed;
      const startStepIdx = prevInc ? Math.max(0, prevInc.maxStepIdx - 4) : 0;
      const startGenIdx = prevInc ? Math.max(0, prevInc.maxGenIdx - 1) : 0;
      let anchorValid = false;
      if (
        prevInc &&
        prevParsed?.ok &&
        genCount >= prevInc.genCount &&
        maxGenIdx >= prevInc.maxGenIdx &&
        stepCount >= prevInc.stepCount &&
        maxStepIdx >= prevInc.maxStepIdx
      ) {
        if (startGenIdx > 0 && prevInc.anchorIdx >= 0) {
          const prefixCnt = db.prepare('SELECT COUNT(*) AS cnt FROM gen_metadata WHERE idx < ?').get(startGenIdx)?.cnt ?? -1;
          const aRow = db
            .prepare('SELECT length(data) AS len, hex(substr(data, 1, 24)) AS hex FROM gen_metadata WHERE idx = ?')
            .get(prevInc.anchorIdx);
          anchorValid = Boolean(
            prefixCnt === prevInc.frozenGenCount &&
              aRow &&
              aRow.len === prevInc.anchorLen &&
              aRow.hex === prevInc.anchorHex
          );
        } else {
          anchorValid = startGenIdx === 0;
        }
      }

      if (anchorValid) {
        const deltaSteps = db.prepare(`${TA_STEPS_SELECT_BASE} WHERE idx >= ? ORDER BY idx ASC`).all(startStepIdx);
        const deltaGenRows = db.prepare('SELECT idx, data FROM gen_metadata WHERE idx >= ? ORDER BY idx ASC').all(startGenIdx);
        const baseCalls = prevParsed.calls.filter((c) => typeof c.gIdx === 'number' && c.gIdx < startGenIdx);
        if (baseCalls.length + deltaGenRows.length <= genCount) {
          const stepTs = new Map(prevInc.stepTs);
          const stepByIdx = new Map(prevInc.stepByIdx);
          const compactionStepIndices = new Set(prevInc.compactionStepIndices);
          for (const k of [...stepTs.keys()]) if (k >= startStepIdx) stepTs.delete(k);
          for (const k of [...stepByIdx.keys()]) if (k >= startStepIdx) stepByIdx.delete(k);
          for (const k of [...compactionStepIndices]) if (k >= startStepIdx) compactionStepIndices.delete(k);
          const planTimeline = prevInc.planTimeline.filter((p) => p.idx < startStepIdx);
          const lastPt = planTimeline.length > 0 ? planTimeline[planTimeline.length - 1] : null;
          const planCursor = {
            cur: lastPt
              ? {
                  orchestrator: Boolean(lastPt.orchestrator),
                  plannerEnum: lastPt.plannerEnum || 0,
                  execEnum: lastPt.execEnum || 0,
                  inPlanPhase: Boolean(lastPt.inPlanPhase)
                }
              : { orchestrator: false, plannerEnum: 0, execEnum: 0, inPlanPhase: false }
          };
          for (const row of deltaSteps) {
            taIngestStepRow(row, stepTs, stepByIdx, compactionStepIndices, planTimeline, planCursor);
          }
          const lookupTs = taResolveStepLookup(stepTs, fallbackSec);
          const lookupPlanState = taResolvePlanStateLookup(planTimeline);
          const lineageState = {
            firstParentCascadeId: prevInc.firstParentCascadeId || '',
            firstRootCascadeId: prevInc.firstRootCascadeId || '',
            firstSubagentType: prevInc.firstSubagentType || ''
          };
          for (const row of deltaGenRows) {
            const c = taParseGenMetadataRowToCall(row, {
              lookupTs,
              lookupPlanState,
              stepByIdx,
              compactionStepIndices,
              trajParentId,
              state: lineageState
            });
            if (c) baseCalls.push(c);
          }
          const nextStartGenIdx = Math.max(0, maxGenIdx - 1);
          const nextFrozenCnt =
            nextStartGenIdx > 0
              ? db.prepare('SELECT COUNT(*) AS cnt FROM gen_metadata WHERE idx < ?').get(nextStartGenIdx)?.cnt ?? 0
              : 0;
          const nextFrozenRow =
            nextStartGenIdx > 0
              ? db
                  .prepare('SELECT idx, length(data) AS len, hex(substr(data, 1, 24)) AS hex FROM gen_metadata WHERE idx < ? ORDER BY idx DESC LIMIT 1')
                  .get(nextStartGenIdx)
              : null;
          return {
            ok: true,
            dbId,
            mtimeSec: fallbackSec,
            trajMeta: {
              parentId: trajParentId || lineageState.firstParentCascadeId,
              rootId: trajRootId || lineageState.firstRootCascadeId,
              subagentType: lineageState.firstSubagentType,
              workspaceUri: trajWorkspaceUri,
              projectId: trajProjectId
            },
            calls: baseCalls,
            _inc: {
              genCount,
              maxGenIdx,
              stepCount,
              maxStepIdx,
              frozenGenCount: nextFrozenCnt,
              anchorIdx: nextFrozenRow ? nextFrozenRow.idx : -1,
              anchorLen: nextFrozenRow ? nextFrozenRow.len : 0,
              anchorHex: nextFrozenRow ? nextFrozenRow.hex : '',
              stepTs,
              stepByIdx,
              compactionStepIndices,
              planTimeline,
              firstParentCascadeId: lineageState.firstParentCascadeId,
              firstRootCascadeId: lineageState.firstRootCascadeId,
              firstSubagentType: lineageState.firstSubagentType
            }
          };
        }
      }

      const stepTs = new Map();
      const stepByIdx = new Map();
      const compactionStepIndices = new Set();
      const planTimeline = [];
      const planCursor = { cur: { orchestrator: false, plannerEnum: 0, execEnum: 0, inPlanPhase: false } };

      for (const row of db.prepare(`${TA_STEPS_SELECT_BASE} ORDER BY idx ASC`).all()) {
        taIngestStepRow(row, stepTs, stepByIdx, compactionStepIndices, planTimeline, planCursor);
      }
      const lookupTs = taResolveStepLookup(stepTs, fallbackSec);
      const lookupPlanState = taResolvePlanStateLookup(planTimeline);

      const calls = [];
      const lineageState = { firstParentCascadeId: '', firstRootCascadeId: '', firstSubagentType: '' };
      const allGenRows = db.prepare('SELECT idx, data FROM gen_metadata ORDER BY idx ASC').all();
      for (const row of allGenRows) {
        const c = taParseGenMetadataRowToCall(row, {
          lookupTs,
          lookupPlanState,
          stepByIdx,
          compactionStepIndices,
          trajParentId,
          state: lineageState
        });
        if (c) calls.push(c);
      }

      const nextStartGenIdx = Math.max(0, maxGenIdx - 1);
      let fullFrozenCnt = 0;
      let lastFrozenGen = null;
      if (nextStartGenIdx > 0) {
        for (const row of allGenRows) {
          if (row.idx < nextStartGenIdx) {
            fullFrozenCnt += 1;
            lastFrozenGen = row;
          }
        }
      }
      const fullAnchorHex = lastFrozenGen?.data
        ? Buffer.from(lastFrozenGen.data.subarray(0, Math.min(24, lastFrozenGen.data.length))).toString('hex').toUpperCase()
        : '';

      return {
        ok: true,
        dbId,
        mtimeSec: fallbackSec,
        trajMeta: {
          parentId: trajParentId || lineageState.firstParentCascadeId,
          rootId: trajRootId || lineageState.firstRootCascadeId,
          subagentType: lineageState.firstSubagentType,
          workspaceUri: trajWorkspaceUri,
          projectId: trajProjectId
        },
        calls,
        _inc: {
          genCount,
          maxGenIdx,
          stepCount,
          maxStepIdx,
          frozenGenCount: fullFrozenCnt,
          anchorIdx: lastFrozenGen ? lastFrozenGen.idx : -1,
          anchorLen: lastFrozenGen?.data ? lastFrozenGen.data.length : 0,
          anchorHex: fullAnchorHex,
          stepTs,
          stepByIdx,
          compactionStepIndices,
          planTimeline,
          firstParentCascadeId: lineageState.firstParentCascadeId,
          firstRootCascadeId: lineageState.firstRootCascadeId,
          firstSubagentType: lineageState.firstSubagentType
        }
      };
    });
  } catch (err) {
    return { ok: false, dbId, error: err?.message || String(err) };
  }
}

const yieldEventLoop = () => new Promise((resolve) => setImmediate(resolve));

async function loadTokenAnalyticsCacheTier(filePath) {
  try {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    const obj = JSON.parse(raw);
    if (!obj || obj.salt !== TA_CACHE_SALT || !obj.entries || typeof obj.entries !== 'object') {
      await fs.promises.unlink(filePath).catch(() => {});
      return { loaded: false, invalid: true };
    }
    let count = 0;
    for (const [dbPath, item] of Object.entries(obj.entries)) {
      if (item && typeof item.sig === 'string' && item.parsed?.ok && Array.isArray(item.parsed.calls)) {
        tokenAnalyticsDbCache.set(dbPath, {
          sig: item.sig,
          mtimeMs: Number(item.mtimeMs) || 0,
          parsed: item.parsed,
          _inc: null
        });
        count += 1;
      }
    }
    return { loaded: true, count, invalid: false };
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      await fs.promises.unlink(filePath).catch(() => {});
      return { loaded: false, invalid: true };
    }
    return { loaded: false, invalid: false };
  }
}

async function loadTokenAnalyticsDiskCacheIfNeeded(force) {
  if (SAFE_MODE) return;
  if (force === 'hard') {
    tokenAnalyticsDbCache.clear();
    tokenAnalyticsSummariesCache.clear();
    tokenAnalyticsCacheState.diskLoaded = true;
    tokenAnalyticsCacheState.coldDirty = true;
    tokenAnalyticsCacheState.hotDirty = true;
    return;
  }
  if (tokenAnalyticsCacheState.diskLoaded || tokenAnalyticsDbCache.size > 0) return;
  tokenAnalyticsCacheState.diskLoaded = true;
  const coldRes = await loadTokenAnalyticsCacheTier(TA_CACHE_COLD_FILE);
  const hotRes = await loadTokenAnalyticsCacheTier(TA_CACHE_HOT_FILE);
  if (!coldRes.loaded && !hotRes.loaded && !coldRes.invalid && !hotRes.invalid) {
    const legacyRes = await loadTokenAnalyticsCacheTier(TA_CACHE_LEGACY_FILE);
    if (legacyRes.loaded) {
      tokenAnalyticsCacheState.coldDirty = true;
      tokenAnalyticsCacheState.hotDirty = true;
    }
  }
  if (coldRes.invalid) tokenAnalyticsCacheState.coldDirty = true;
  if (hotRes.invalid) tokenAnalyticsCacheState.hotDirty = true;
}

async function writeTokenAnalyticsTierAtomic(targetFile, entriesObj) {
  const tmpFile = `${targetFile}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.promises.mkdir(CACHE_DIR, { recursive: true });
    await fs.promises.writeFile(
      tmpFile,
      JSON.stringify({ salt: TA_CACHE_SALT, updatedAt: Date.now(), entries: entriesObj }),
      'utf8'
    );
    await fs.promises.rename(tmpFile, targetFile);
    return true;
  } catch {
    await fs.promises.unlink(tmpFile).catch(() => {});
    return false;
  }
}

async function flushTokenAnalyticsDiskCacheAsync() {
  if (SAFE_MODE || RUN_ONCE || daemonExiting || tokenAnalyticsDbCache.size === 0) return;
  if (tokenAnalyticsCacheState.flushInFlight) {
    tokenAnalyticsCacheState.flushPending = true;
    return;
  }
  tokenAnalyticsCacheState.flushInFlight = true;
  try {
    do {
      tokenAnalyticsCacheState.flushPending = false;
      if (SAFE_MODE || RUN_ONCE || daemonExiting || tokenAnalyticsDbCache.size === 0) break;
      const hotCutoffMs = Date.now() - TA_HOT_WINDOW_MS;
      const hotEntries = Object.create(null);
      const coldEntries = Object.create(null);
      let coldCount = 0;
      for (const [dbPath, item] of tokenAnalyticsDbCache.entries()) {
        if (item && item.sig && item.parsed?.ok) {
          const mtimeMs = Number(item.mtimeMs) || 0;
          const record = { sig: item.sig, mtimeMs, parsed: item.parsed };
          if (mtimeMs > 0 && mtimeMs < hotCutoffMs) {
            coldEntries[dbPath] = record;
            coldCount += 1;
          } else {
            hotEntries[dbPath] = record;
          }
        }
      }
      const needColdWrite =
        Boolean(tokenAnalyticsCacheState.coldDirty) ||
        (coldCount > 0 && !fs.existsSync(TA_CACHE_COLD_FILE));
      const needHotWrite =
        Boolean(tokenAnalyticsCacheState.hotDirty) ||
        needColdWrite ||
        !fs.existsSync(TA_CACHE_HOT_FILE);

      let hotOk = true;
      let coldOk = true;
      if (needHotWrite) {
        hotOk = await writeTokenAnalyticsTierAtomic(TA_CACHE_HOT_FILE, hotEntries);
        if (hotOk) tokenAnalyticsCacheState.hotDirty = false;
      }
      if (needColdWrite) {
        if (coldCount > 0) {
          coldOk = await writeTokenAnalyticsTierAtomic(TA_CACHE_COLD_FILE, coldEntries);
        } else {
          await fs.promises.unlink(TA_CACHE_COLD_FILE).catch(() => {});
          coldOk = true;
        }
        if (coldOk) tokenAnalyticsCacheState.coldDirty = false;
      }
      if (hotOk && coldOk && fs.existsSync(TA_CACHE_LEGACY_FILE)) {
        await fs.promises.unlink(TA_CACHE_LEGACY_FILE).catch(() => {});
      }
    } while (tokenAnalyticsCacheState.flushPending);
  } finally {
    tokenAnalyticsCacheState.flushInFlight = false;
  }
}

function scheduleTokenAnalyticsDiskPersist() {
  if (SAFE_MODE || RUN_ONCE || daemonExiting) return;
  if (tokenAnalyticsCacheState.persistTimer) clearTimeout(tokenAnalyticsCacheState.persistTimer);
  tokenAnalyticsCacheState.persistTimer = setTimeout(() => {
    tokenAnalyticsCacheState.persistTimer = null;
    void flushTokenAnalyticsDiskCacheAsync();
  }, 2000);
  if (typeof tokenAnalyticsCacheState.persistTimer.unref === 'function') {
    tokenAnalyticsCacheState.persistTimer.unref();
  }
}

async function queryTokenAnalytics(
  endpoint,
  { maxDays = 365, force = false, nowSec = Math.floor(Date.now() / 1000) } = {}
) {
  lastTokenAnalyticsAccessMs = Date.now();
  const t0 = performance.now();
  await loadTokenAnalyticsDiskCacheIfNeeded(force);
  let sliceStartMs = performance.now();
  const convDir =
    endpoint?.conversationsDir || path.join(os.homedir(), endpoint?.geminiSubDir || '.gemini/antigravity', 'conversations');

  const summaries = fs.existsSync(convDir)
    ? taLoadSummariesCached(path.join(path.dirname(convDir), 'conversation_summaries.db'), force)
    : new Map();
  const dbCandidateById = new Map();

  if (fs.existsSync(convDir)) {
    let entries = [];
    try {
      entries = fs.readdirSync(convDir).filter((name) => name.endsWith('.db'));
      entries.sort((a, b) => {
        const sa = summaries.get(a.slice(0, -3))?.lastModifiedSec || 0;
        const sb = summaries.get(b.slice(0, -3))?.lastModifiedSec || 0;
        return sb - sa || a.localeCompare(b);
      });
    } catch {}

    let statIter = 0;
    for (const fileName of entries) {
      const dbPath = path.join(convDir, fileName);
      const sigInfo = getDbStatByPath(dbPath);
      if (sigInfo) {
        dbCandidateById.set(path.basename(fileName, '.db'), { dbPath, sigInfo });
      }
      statIter += 1;
      if (statIter % 80 === 0 && performance.now() - sliceStartMs >= 16) {
        await yieldEventLoop();
        sliceStartMs = performance.now();
      }
    }
  }

  const activePaths = new Set();
  const parsedDbs = [];
  const failedDbs = [];
  let cacheHits = 0;
  let cacheMisses = 0;
  let missesSinceYield = 0;
  const hotCutoffMs = Date.now() - TA_HOT_WINDOW_MS;

  const dbEntries = [...dbCandidateById.values()].sort(
    (a, b) => (b.sigInfo.mtimeMs || 0) - (a.sigInfo.mtimeMs || 0) || a.dbPath.localeCompare(b.dbPath)
  );
  for (const { dbPath, sigInfo } of dbEntries) {
    activePaths.add(dbPath);
    const cached = force !== 'hard' ? tokenAnalyticsDbCache.get(dbPath) : null;
    if (cached && cached.sig === sigInfo.sig) {
      if (!cached.mtimeMs && sigInfo.mtimeMs) {
        cached.mtimeMs = sigInfo.mtimeMs;
      }
      cacheHits += 1;
      parsedDbs.push(cached.parsed);
      continue;
    }

    cacheMisses += 1;
    missesSinceYield += 1;
    const rawResult = taParseConversationDetailDb(dbPath, sigInfo, force !== 'hard' ? cached : null);
    if (rawResult.ok) {
      const { _inc, ...compactParsed } = rawResult;
      const mtimeMs = sigInfo.mtimeMs || 0;
      const keepInc = _inc && Date.now() - mtimeMs < 86400000 ? _inc : null;
      const wasCold = Boolean(cached && cached.mtimeMs > 0 && cached.mtimeMs < hotCutoffMs);
      tokenAnalyticsDbCache.set(dbPath, { sig: sigInfo.sig, mtimeMs, parsed: compactParsed, _inc: keepInc });
      if (mtimeMs > 0 && mtimeMs < hotCutoffMs) {
        tokenAnalyticsCacheState.coldDirty = true;
      } else {
        tokenAnalyticsCacheState.hotDirty = true;
        if (wasCold) tokenAnalyticsCacheState.coldDirty = true;
      }
      parsedDbs.push(compactParsed);
    } else if (cached?.parsed) {
      parsedDbs.push(cached.parsed);
    } else {
      failedDbs.push({ dbId: rawResult.dbId, error: rawResult.error });
    }

    if (missesSinceYield >= 8 || performance.now() - sliceStartMs >= 16) {
      await yieldEventLoop();
      sliceStartMs = performance.now();
      missesSinceYield = 0;
    }
  }

  let prunedCount = 0;
  for (const [oldPath, oldItem] of Array.from(tokenAnalyticsDbCache.entries())) {
    if (!activePaths.has(oldPath)) {
      if (oldItem && oldItem.mtimeMs > 0 && oldItem.mtimeMs < hotCutoffMs) {
        tokenAnalyticsCacheState.coldDirty = true;
      } else {
        tokenAnalyticsCacheState.hotDirty = true;
      }
      tokenAnalyticsDbCache.delete(oldPath);
      prunedCount += 1;
    }
  }
  if (cacheMisses > 0 || prunedCount > 0 || force === 'hard' || tokenAnalyticsCacheState.coldDirty || tokenAnalyticsCacheState.hotDirty) {
    scheduleTokenAnalyticsDiskPersist();
  }

  const cutoffSec = maxDays > 0 ? nowSec - maxDays * 86400 : 0;
  const rawMetaById = new Map();
  for (const parsed of parsedDbs) {
    const id = parsed.dbId;
    const sum = summaries.get(id);
    const parentId = sum?.parentId || parsed.trajMeta.parentId || '';
    const rawRoot = parsed.trajMeta.rootId || '';
    const agentName = sum?.agentName || parsed.trajMeta.subagentType || '';
    const isSubagent = Boolean(
      (sum && sum.nestingDepth > 0) || parentId || agentName || (rawRoot && rawRoot !== id)
    );
    rawMetaById.set(id, {
      id,
      title: sum?.title || '',
      source: sum?.source || 'desktop',
      agentName,
      parentId,
      rawRoot,
      isSubagent,
      proj: taNormalizeProjectInfo(
        sum?.workspaceUris || parsed.trajMeta.workspaceUri || '',
        sum?.projectId || parsed.trajMeta.projectId || ''
      ),
      parsed
    });
  }

  const resolveRootId = (id) => {
    const seen = new Set();
    let cur = id;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const m = rawMetaById.get(cur);
      if (!m) break;
      if (m.parentId && rawMetaById.has(m.parentId) && m.parentId !== cur) {
        cur = m.parentId;
        continue;
      }
      if (m.rawRoot && rawMetaById.has(m.rawRoot) && m.rawRoot !== cur) {
        cur = m.rawRoot;
        continue;
      }
      return cur;
    }
    const m = rawMetaById.get(id);
    return m?.parentId || m?.rawRoot || id;
  };

  const resolvedMetaById = new Map();
  const projectRegistry = new Map();
  for (const [id, m] of rawMetaById.entries()) {
    const rootId = resolveRootId(id);
    const proj = m.proj.key === '__none__' && rootId !== id && rawMetaById.has(rootId) ? rawMetaById.get(rootId).proj : m.proj;
    let reg = projectRegistry.get(proj.key);
    if (!reg) {
      reg = { key: proj.key, path: proj.path, isTemp: proj.isTemp, votes: new Map() };
      projectRegistry.set(proj.key, reg);
    }
    reg.votes.set(proj.rawBasename, (reg.votes.get(proj.rawBasename) || 0) + 1);
    if (!reg.path && proj.path) reg.path = proj.path;

    resolvedMetaById.set(id, {
      id,
      title: m.title || (m.isSubagent ? `${m.agentName || 'subagent'} 子任务 (${id.slice(0, 8)})` : `会话 ${id.slice(0, 8)}`),
      source: m.source,
      agentName: m.agentName,
      parentId: m.parentId || (m.isSubagent && rootId !== id ? rootId : ''),
      rootId,
      isSubagent: m.isSubagent,
      projectKey: proj.key,
      parsed: m.parsed
    });
  }

  const projects = [...projectRegistry.values()]
    .map((p) => {
      let name = p.key;
      if (p.key === '__none__') name = '未绑定项目';
      else if (p.key === '__tmp__') name = '临时目录 (/tmp)';
      else {
        const best = [...p.votes.entries()].sort(
          (a, b) => b[1] - a[1] || (/^[A-Z]/.test(b[0]) ? 1 : 0) - (/^[A-Z]/.test(a[0]) ? 1 : 0) || a[0].localeCompare(b[0])
        )[0];
        name = best?.[0] || p.key;
      }
      return { key: p.key, name, path: p.path, isTemp: p.isTemp };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  const projNameByKey = new Map(projects.map((p) => [p.key, p.name]));

  const factsMap = new Map();
  const conversations = {};
  const dailyMap = new Map();
  let totalCalls = 0;

  for (const meta of resolvedMetaById.values()) {
    const windowCalls = cutoffSec > 0 ? meta.parsed.calls.filter((c) => c.ts >= cutoffSec) : meta.parsed.calls;
    if (windowCalls.length === 0) continue;

    let lastTs = 0;
    const modelSet = new Set();
    for (const c of windowCalls) {
      totalCalls += 1;
      if (c.ts > lastTs) lastTs = c.ts;
      modelSet.add(c.model);

      const callIsSubagent = meta.isSubagent || Boolean(c.subagentType);
      const rawSubType =
        c.subagentType === 'worker' && meta.agentName ? meta.agentName : c.subagentType || meta.agentName;
      const subagentType = callIsSubagent ? rawSubType || 'subagent' : '';
      const scenario = taResolveCallScenario(c.baseScenario, callIsSubagent, meta.source);
      const date = taToLocalDateString(c.ts || meta.parsed.mtimeSec);
      const fKey = `${date}\x00${meta.id}\x00${c.model}\x00${c.pool}\x00${scenario}\x00${subagentType}`;
      let fact = factsMap.get(fKey);
      if (!fact) {
        fact = {
          date,
          cid: meta.id,
          model: c.model,
          pool: c.pool,
          scenario,
          subagentType,
          calls: 0,
          inTok: 0,
          cacheRead: 0,
          outTok: 0,
          thinkTok: 0,
          respTok: 0,
          total: 0,
          weighted: 0,
          billable: 0
        };
        factsMap.set(fKey, fact);
      }
      fact.calls += 1;
      fact.inTok += c.inTok;
      fact.cacheRead += c.cacheRead;
      fact.outTok += c.outTok;
      fact.thinkTok += c.thinkTok;
      fact.respTok += c.respTok;
      fact.total += c.total;
      fact.weighted += c.weighted;
      fact.billable += c.billable;

      let dAcc = dailyMap.get(date);
      if (!dAcc) {
        dAcc = { date, calls: 0, inTok: 0, cacheRead: 0, outTok: 0, total: 0, weighted: 0, billable: 0 };
        dailyMap.set(date, dAcc);
      }
      dAcc.calls += 1;
      dAcc.inTok += c.inTok;
      dAcc.cacheRead += c.cacheRead;
      dAcc.outTok += c.outTok;
      dAcc.total += c.total;
      dAcc.weighted += c.weighted;
      dAcc.billable += c.billable;
    }

    conversations[meta.id] = {
      id: meta.id,
      title: meta.title,
      projectKey: meta.projectKey,
      projectName: projNameByKey.get(meta.projectKey) || '未绑定项目',
      source: meta.source,
      isSubagent: meta.isSubagent,
      agentName: meta.agentName,
      parentId: meta.parentId,
      rootId: meta.rootId,
      lastTs,
      models: [...modelSet]
    };
  }

  const usedProjectKeys = new Set(Object.values(conversations).map((c) => c.projectKey));
  const activeProjects = projects.filter((p) => usedProjectKeys.has(p.key));

  return {
    version: 1,
    generatedAt: new Date(nowSec * 1000).toISOString(),
    nowSec,
    defaultMetric: 'weighted',
    elapsedMs: Number((performance.now() - t0).toFixed(2)),
    stats: {
      dbCount: dbEntries.length,
      scannedDbs: parsedDbs.length,
      failedDbs: failedDbs.length,
      totalCalls,
      conversationCount: Object.keys(conversations).length,
      projectCount: activeProjects.length,
      cacheHits,
      cacheMisses
    },
    projects: activeProjects,
    conversations,
    facts: [...factsMap.values()].sort((a, b) => (b.date !== a.date ? b.date.localeCompare(a.date) : b.weighted - a.weighted)),
    dailySummary: [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date))
  };
}

function runTokenAnalyticsQuery(endpoint, opts = {}) {
  const key = `${endpoint?.channel || 'default'}|${endpoint?.conversationsDir || ''}|${opts.maxDays || 365}`;
  if (!opts.force && inFlightTokenAnalyticsPromise && inFlightTokenAnalyticsKey === key) {
    return inFlightTokenAnalyticsPromise;
  }
  const prev = inFlightTokenAnalyticsPromise;
  const run = (async () => {
    if (prev) {
      try {
        await prev;
      } catch {}
    }
    return queryTokenAnalytics(endpoint, opts);
  })();
  inFlightTokenAnalyticsKey = key;
  inFlightTokenAnalyticsPromise = run;
  run
    .finally(() => {
      if (inFlightTokenAnalyticsPromise === run) {
        inFlightTokenAnalyticsPromise = null;
        inFlightTokenAnalyticsKey = '';
      }
    })
    .catch(() => {});
  return run;
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

function redactTargetLabelForLog(raw) {
  return String(raw || '').replace(/([?&#](?:access_)?token=)[^&#\s)]+/gi, '$1<redacted>');
}

let lastIframeInjectLogAt = 0;
let lastIframeInjectLogVer = '';
let suppressedIframeInjectCount = 0;

function shouldLogIframeTargetLifecycle(patchVer) {
  const now = Date.now();
  if (patchVer !== lastIframeInjectLogVer || now - lastIframeInjectLogAt >= 600000) {
    const extra = suppressedIframeInjectCount > 0 ? ` (+${suppressedIframeInjectCount} routine iframe mounts)` : '';
    lastIframeInjectLogVer = patchVer;
    lastIframeInjectLogAt = now;
    suppressedIframeInjectCount = 0;
    return { log: true, suffix: extra };
  }
  suppressedIframeInjectCount += 1;
  return { log: false, suffix: '' };
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

function resolveSafeLocalFileFromUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return { ok: false, reason: 'invalid_type' };
  const raw = rawUrl.trim();
  if (!raw || raw.length > 4096 || /[\0\r\n]/.test(raw)) {
    return { ok: false, reason: 'invalid_url' };
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: 'malformed_url' };
  }
  const proto = parsed.protocol.toLowerCase();
  if (proto !== 'file:' && proto !== 'vscode-file:') {
    return { ok: false, reason: 'disallowed_protocol' };
  }
  const hostLow = (parsed.hostname || '').toLowerCase();
  if (hostLow && hostLow !== 'localhost') {
    return { ok: false, reason: 'disallowed_file_host' };
  }
  let pathname = parsed.pathname || '';
  if (proto === 'vscode-file:') {
    pathname = pathname.replace(/^\/vscode-app(?=\/)/i, '');
  }
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return { ok: false, reason: 'invalid_uri_encoding' };
  }
  if (!decoded || !decoded.startsWith('/') || /[\0\r\n]/.test(decoded)) {
    return { ok: false, reason: 'invalid_posix_path' };
  }
  let realPath = '';
  try {
    realPath = fs.realpathSync(decoded);
  } catch {
    return { ok: false, reason: 'realpath_failed' };
  }
  if (!realPath || !realPath.startsWith('/') || /[\0\r\n]/.test(realPath)) {
    return { ok: false, reason: 'invalid_resolved_path' };
  }
  let st;
  try {
    st = fs.statSync(realPath);
  } catch {
    return { ok: false, reason: 'stat_failed' };
  }
  if (!st.isFile()) {
    return { ok: false, reason: 'not_regular_file' };
  }
  return { ok: true, realPath };
}

function resolveSafeBrowserPreviewFileUrl(rawPayload) {
  const fileRes = resolveSafeLocalFileFromUrl(rawPayload);
  if (!fileRes.ok) return fileRes;
  const { realPath } = fileRes;
  const ext = path.extname(realPath);
  if (!BROWSER_PREVIEW_EXT_WHITELIST_RE.test(ext)) {
    return { ok: false, reason: 'extension_not_allowed', ext };
  }
  const safeFileUrl = pathToFileURL(realPath).href;
  if (!safeFileUrl.startsWith('file://') || /[\0\r\n]/.test(safeFileUrl)) {
    return { ok: false, reason: 'invalid_safe_file_url' };
  }
  return { ok: true, realPath, safeFileUrl };
}

function launchSafeFileUrlInDefaultBrowser(safeFileUrl) {
  if (!safeFileUrl || typeof safeFileUrl !== 'string') return;
  execFile('/usr/bin/open', [safeFileUrl], () => {});
}

function launchSafeFileInDetectedEditor(rawPayload) {
  if (typeof rawPayload !== 'string' || rawPayload.length > 4608) {
    return { ok: false, reason: 'invalid_payload' };
  }
  let req;
  try {
    req = JSON.parse(rawPayload);
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }
  const editorId = typeof req?.id === 'string' ? req.id.trim().toLowerCase() : '';
  const editors = detectInstalledExternalEditors();
  const editor = editors.byId.get(editorId);
  if (!editor || !editor.execPath) {
    return { ok: false, reason: 'editor_not_installed' };
  }
  if (!fs.existsSync(editor.execPath)) {
    return { ok: false, reason: 'editor_missing_on_disk' };
  }
  const fileRes = resolveSafeLocalFileFromUrl(req?.fileUrl);
  if (!fileRes.ok) return fileRes;
  const { realPath } = fileRes;
  const rawLine = Number(req?.line);
  const line = Number.isInteger(rawLine) && rawLine > 0 && rawLine <= 10000000 ? rawLine : 0;

  let editorArgs;
  if (editor.family === 'jetbrains') {
    editorArgs = line > 0 ? ['--line', String(line), realPath] : [realPath];
  } else if (editor.family === 'zed') {
    editorArgs = [line > 0 ? `${realPath}:${line}:1` : realPath];
  } else if (editor.family === 'sublime') {
    editorArgs = [line > 0 ? `${realPath}:${line}` : realPath];
  } else {
    editorArgs = ['--goto', line > 0 ? `${realPath}:${line}:1` : realPath];
  }

  const cleanEnv = { ...process.env };
  delete cleanEnv.ELECTRON_RUN_AS_NODE;

  if (editor.isMacApp) {
    execFile('/usr/bin/open', ['-a', editor.execPath, '--args', ...editorArgs], { env: cleanEnv }, () => {});
  } else {
    execFile(editor.execPath, editorArgs, { env: cleanEnv }, () => {});
  }
  return { ok: true, editorId, realPath, line };
}

const PRELOAD_CM_HOOK_REV = 3;
const CM_HOOK_CIRCUIT_BREAKER_TTL_MS = 10 * 60 * 1000;
const cmHookUnsupportedEndpoints = new Map(); // key: `${channel}:${port}` -> { zeroHits, blockedUntil }

function isCmEndpointCircuitOpen(endpointKey) {
  const rec = cmHookUnsupportedEndpoints.get(endpointKey);
  if (!rec) return false;
  if (rec.blockedUntil > 0 && Date.now() < rec.blockedUntil) return true;
  if (rec.blockedUntil > 0) cmHookUnsupportedEndpoints.delete(endpointKey);
  return false;
}

// Runs inside Electron Isolated Context: unwraps ipcRenderer or owner along prototype chain, installs REV=3 CustomEvent wrapper (with reqId nonce) + mergeLabelsOnly + clean unhook
const PRELOAD_CM_INSTALLER_EXPR = `(function(cand) {
  const ipc = cand && typeof cand === 'object'
    ? (typeof cand.invoke === 'function' && typeof cand.send === 'function' && typeof cand.on === 'function'
        ? cand
        : (cand.ipcRenderer && typeof cand.ipcRenderer.invoke === 'function' && typeof cand.ipcRenderer.send === 'function'
            ? cand.ipcRenderer
            : null))
    : null;
  if (!ipc) return 0;
  let owner = ipc;
  while (owner && owner !== Object.prototype && !Object.prototype.hasOwnProperty.call(owner, 'invoke')) {
    owner = Object.getPrototypeOf(owner);
  }
  if (!owner || owner === Object.prototype || typeof owner.invoke !== 'function') return 0;
  const origInvoke = typeof owner.__ag_orig_invoke === 'function' ? owner.__ag_orig_invoke : owner.invoke;
  if (typeof owner.__ag_orig_invoke !== 'function') {
    Object.defineProperty(owner, '__ag_orig_invoke', {
      value: origInvoke,
      configurable: true,
      enumerable: false,
      writable: false
    });
  }
  function mergeLabelsOnly(origArr, transArr) {
    if (!Array.isArray(origArr) || !Array.isArray(transArr) || origArr.length !== transArr.length) {
      return origArr;
    }
    let changed = false;
    const out = new Array(origArr.length);
    for (let i = 0; i < origArr.length; i++) {
      const o = origArr[i];
      const t = transArr[i];
      if (!o || typeof o !== 'object') {
        out[i] = o;
        continue;
      }
      if (!t || typeof t !== 'object' || (o.id ?? '') !== (t.id ?? '') || (o.type ?? '') !== (t.type ?? '')) {
        return origArr;
      }
      const nextLabel = typeof t.label === 'string' && typeof o.label === 'string' ? t.label : o.label;
      let nextSub = o.submenu;
      if (Array.isArray(o.submenu) && o.submenu.length > 0 && Array.isArray(t.submenu)) {
        nextSub = mergeLabelsOnly(o.submenu, t.submenu);
      }
      if (nextLabel !== o.label || nextSub !== o.submenu) {
        changed = true;
        const copy = Object.assign({}, o, { label: nextLabel });
        if (Array.isArray(o.submenu)) copy.submenu = nextSub;
        out[i] = copy;
      } else {
        out[i] = o;
      }
    }
    return changed ? out : origArr;
  }
  let cmReqSeq = 0;
  const wrapper = function(channel, ...args) {
    if (
      channel === 'window:show-context-menu' &&
      Array.isArray(args[0]) &&
      args[0].length > 0 &&
      typeof document !== 'undefined' &&
      document.documentElement
    ) {
      const uiLang = document.documentElement.getAttribute('data-ag-lang');
      if (uiLang && uiLang !== 'en') {
        const reqId = 'cm-' + Date.now() + '-' + (++cmReqSeq) + '-' + Math.random().toString(36).slice(2, 8);
        let resItems = null;
        const onRes = (ev) => {
          if (resItems !== null || !ev || typeof ev.detail !== 'string') return;
          try {
            const parsedRes = JSON.parse(ev.detail);
            if (parsedRes && parsedRes.reqId === reqId && Array.isArray(parsedRes.items)) {
              resItems = parsedRes.items;
            }
          } catch (e0) {}
        };
        document.addEventListener('__ag_cm_res', onRes);
        try {
          document.dispatchEvent(new CustomEvent('__ag_cm_req', { detail: JSON.stringify({ reqId, items: args[0] }) }));
          if (resItems) {
            args[0] = mergeLabelsOnly(args[0], resItems);
          }
        } catch (e) {
        } finally {
          try {
            document.removeEventListener('__ag_cm_res', onRes);
          } catch (e2) {}
        }
      }
    }
    return origInvoke.apply(this, [channel, ...args]);
  };
  try {
    Object.defineProperty(owner, 'invoke', {
      value: wrapper,
      writable: true,
      enumerable: false,
      configurable: true
    });
  } catch (e) {
    return 0;
  }
  if (owner.invoke !== wrapper) return 0;
  const symIpc = Symbol.for('ag.ipcR');
  const symUnhook = Symbol.for('ag.unhookCm');
  Object.defineProperty(globalThis, symIpc, { value: owner, configurable: true, enumerable: false, writable: true });
  Object.defineProperty(globalThis, symUnhook, {
    value: function() {
      try {
        if (typeof owner.__ag_orig_invoke === 'function') {
          Object.defineProperty(owner, 'invoke', {
            value: owner.__ag_orig_invoke,
            writable: true,
            enumerable: false,
            configurable: true
          });
        }
        delete owner.__ag_orig_invoke;
        delete globalThis.__ag_preload_cm_hook_rev;
        delete globalThis[symIpc];
        delete globalThis[symUnhook];
      } catch (e) {}
    },
    configurable: true,
    enumerable: false,
    writable: true
  });
  globalThis.__ag_preload_cm_hook_rev = ${PRELOAD_CM_HOOK_REV};
  return 1;
})`;

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
      let preloadIsolatedContextId = null;
      let preloadCmHookedContextId = null;
      let preloadCmHookInFlight = null;
      const cmHookAttemptsByCtx = new Map();

      const send = (method, params = {}, timeoutMs = 2500) =>
        new Promise((resolve) => {
          if (ws.readyState !== WebSocket.OPEN) return resolve(null);
          const id = msgId++;
          const timer = setTimeout(() => {
            pendingCallbacks.delete(id);
            resolve(null);
          }, timeoutMs);
          pendingCallbacks.set(id, (msg) => {
            clearTimeout(timer);
            resolve(msg);
          });
          ws.send(JSON.stringify({ id, method, params }));
        });

      const removePreloadContextMenuHook = async () => {
        preloadCmHookedContextId = null;
        const ctxId = preloadIsolatedContextId;
        if (target.type !== 'page' || ctxId === null || ws.readyState !== WebSocket.OPEN) {
          return false;
        }
        try {
          await send('Runtime.evaluate', {
            contextId: ctxId,
            returnByValue: true,
            expression: `(function(){ const fn = globalThis[Symbol.for('ag.unhookCm')]; if (typeof fn === 'function') { fn(); return true; } return false; })()`
          });
          return true;
        } catch {
          return false;
        }
      };

      const ensurePreloadContextMenuHook = () => {
        const endpointKey = `${endpoint.channel}:${endpoint.port}`;
        if (
          target.type !== 'page' ||
          !hostConfirmed ||
          nonHostSettled ||
          !activeConfig.enabled ||
          activeConfig.modules?.i18n === false ||
          activeConfig.installedLocale === 'none' ||
          preloadIsolatedContextId === null ||
          ws.readyState !== WebSocket.OPEN ||
          isCmEndpointCircuitOpen(endpointKey)
        ) {
          return Promise.resolve(false);
        }
        if (preloadCmHookedContextId === preloadIsolatedContextId) {
          return Promise.resolve(true);
        }
        if (preloadCmHookInFlight) {
          return preloadCmHookInFlight;
        }
        const ctxId = preloadIsolatedContextId;
        const attemptRec = cmHookAttemptsByCtx.get(ctxId) || { count: 0, nextAllowedAt: 0 };
        if (Date.now() < attemptRec.nextAllowedAt) {
          return Promise.resolve(false);
        }

        preloadCmHookInFlight = (async () => {
          const objGroup = `ag-preload-cm-${ctxId}`;
          try {
            const fastRes = await send('Runtime.evaluate', {
              contextId: ctxId,
              returnByValue: true,
              expression: `(function() {
                if (globalThis.__ag_preload_cm_hook_rev === ${PRELOAD_CM_HOOK_REV}) return 2;
                const cached = globalThis[Symbol.for('ag.ipcR')];
                if (cached) return ${PRELOAD_CM_INSTALLER_EXPR}(cached);
                return 0;
              })()`
            });
            const fastVal = Number(fastRes?.result?.result?.value) || 0;
            if (fastVal > 0) {
              preloadCmHookedContextId = ctxId;
              cmHookAttemptsByCtx.delete(ctxId);
              cmHookUnsupportedEndpoints.delete(endpointKey);
              return true;
            }
            if (ws.readyState !== WebSocket.OPEN || preloadIsolatedContextId !== ctxId) {
              return false;
            }

            const winRes = await send('Runtime.evaluate', {
              contextId: ctxId,
              objectGroup: objGroup,
              expression: 'window'
            });
            const winObjId = winRes?.result?.result?.objectId;
            if (winObjId) {
              const listenersRes = await send('DOMDebugger.getEventListeners', { objectId: winObjId });
              const listeners = listenersRes?.result?.listeners || [];
              for (const l of listeners) {
                if (!l?.handler?.objectId) continue;
                const propsRes = await send('Runtime.getProperties', {
                  objectId: l.handler.objectId,
                  ownProperties: false
                });
                const scopesProp = (propsRes?.result?.internalProperties || []).find((p) => p.name === '[[Scopes]]');
                if (!scopesProp?.value?.objectId) continue;
                const scopesArrRes = await send('Runtime.getProperties', {
                  objectId: scopesProp.value.objectId,
                  ownProperties: true
                });
                for (const sp of scopesArrRes?.result?.result || []) {
                  if (!sp?.value?.objectId || sp.value.description === 'Global') continue;
                  const varsRes = await send('Runtime.getProperties', {
                    objectId: sp.value.objectId,
                    ownProperties: true
                  });
                  for (const v of varsRes?.result?.result || []) {
                    if (!v?.value?.objectId) continue;
                    const installRes = await send('Runtime.callFunctionOn', {
                      objectId: v.value.objectId,
                      returnByValue: true,
                      functionDeclaration: `function() { return ${PRELOAD_CM_INSTALLER_EXPR}(this); }`
                    });
                    if (Number(installRes?.result?.result?.value) > 0) {
                      preloadCmHookedContextId = ctxId;
                      cmHookAttemptsByCtx.delete(ctxId);
                      cmHookUnsupportedEndpoints.delete(endpointKey);
                      return true;
                    }
                  }
                }
              }
            }

            if (ws.readyState !== WebSocket.OPEN || preloadIsolatedContextId !== ctxId) {
              return false;
            }

            const protoRes = await send('Runtime.evaluate', {
              contextId: ctxId,
              objectGroup: objGroup,
              expression: 'Object.prototype'
            });
            const protoId = protoRes?.result?.result?.objectId;
            if (!protoId) {
              const idx = Math.min(attemptRec.count, 2);
              attemptRec.count += 1;
              attemptRec.nextAllowedAt = Date.now() + [5000, 30000, 300000][idx];
              cmHookAttemptsByCtx.set(ctxId, attemptRec);
              return false;
            }
            const qoRes = await send(
              'Runtime.queryObjects',
              { prototypeObjectId: protoId, objectGroup: objGroup },
              6000
            );
            const arrId = qoRes?.result?.objects?.objectId;
            if (!arrId) {
              const idx = Math.min(attemptRec.count, 2);
              attemptRec.count += 1;
              attemptRec.nextAllowedAt = Date.now() + [5000, 30000, 300000][idx];
              cmHookAttemptsByCtx.set(ctxId, attemptRec);
              return false;
            }
            const hookRes = await send('Runtime.callFunctionOn', {
              objectId: arrId,
              returnByValue: true,
              functionDeclaration: `function() {
                const installFn = ${PRELOAD_CM_INSTALLER_EXPR};
                for (let i = 0; i < this.length; i++) {
                  const o = this[i];
                  if (!o || typeof o !== 'object') continue;
                  try {
                    if (installFn(o) > 0) return 1;
                  } catch (e) {}
                }
                return 0;
              }`
            });
            if ((Number(hookRes?.result?.result?.value) || 0) > 0) {
              preloadCmHookedContextId = ctxId;
              cmHookAttemptsByCtx.delete(ctxId);
              cmHookUnsupportedEndpoints.delete(endpointKey);
              return true;
            }
            const idx = Math.min(attemptRec.count, 2);
            attemptRec.count += 1;
            attemptRec.nextAllowedAt = Date.now() + [5000, 30000, 300000][idx];
            cmHookAttemptsByCtx.set(ctxId, attemptRec);
            const epRec = cmHookUnsupportedEndpoints.get(endpointKey) || { zeroHits: 0, blockedUntil: 0 };
            epRec.zeroHits += 1;
            if (epRec.zeroHits >= 2) {
              epRec.blockedUntil = Date.now() + CM_HOOK_CIRCUIT_BREAKER_TTL_MS;
              console.warn(`[Daemon] Preload IpcRenderer not found on ${endpointKey} (${epRec.zeroHits}x); native context menu i18n paused for 10m.`);
            }
            cmHookUnsupportedEndpoints.set(endpointKey, epRec);
            return false;
          } catch {
            const idx = Math.min(attemptRec.count, 2);
            attemptRec.count += 1;
            attemptRec.nextAllowedAt = Date.now() + [5000, 30000, 300000][idx];
            cmHookAttemptsByCtx.set(ctxId, attemptRec);
            return false;
          } finally {
            try {
              await send('Runtime.releaseObjectGroup', { objectGroup: objGroup });
            } catch {}
            preloadCmHookInFlight = null;
            if (
              preloadIsolatedContextId !== null &&
              preloadIsolatedContextId !== ctxId &&
              preloadCmHookedContextId !== preloadIsolatedContextId
            ) {
              queueMicrotask(() => {
                void ensurePreloadContextMenuHook();
              });
            }
          }
        })();
        return preloadCmHookInFlight;
      };

      let newDocQueue = Promise.resolve();
      let lastNewDocSig = '';

      const buildTargetInjectScript = () => {
        const uiLangVal = activeConfig.modules?.i18n === false ? 'en' : 'target';
        if (target.type !== 'iframe') {
          return {
            script: activeConfig.enabled
              ? `window.__ag_host_ui_lang=${JSON.stringify(uiLangVal)};\n${cachedInjectScript}`
              : cachedInjectScript,
            parentMode: '',
            uiLangVal
          };
        }
        if (!activeConfig.enabled) {
          return { script: cachedIframeInjectScript, parentMode: '', uiLangVal };
        }
        const entry = attachedTargets.get(target.id);
        const parentMode = resolveParentThemeMode(entry || target, entry?.endpoint || endpoint) || '';
        const modeVal = parentMode === 'dark' || parentMode === 'light' ? parentMode : null;
        return {
          script: `window.__ag_host_theme_mode=${modeVal ? JSON.stringify(modeVal) : 'null'};\nwindow.__ag_host_ui_lang=${JSON.stringify(uiLangVal)};\n${cachedIframeInjectScript}`,
          parentMode: modeVal || '',
          uiLangVal
        };
      };

      const updateNewDocScript = (force = false) => {
        newDocQueue = newDocQueue
          .then(async () => {
            if (!hostConfirmed || nonHostSettled || ws.readyState !== WebSocket.OPEN) return;
            const { script, parentMode, uiLangVal } = buildTargetInjectScript();
            const nextSig = `${activeConfig.enabled}|${cachedPatchVersion}|${uiLangVal || ''}|${parentMode}`;
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
            const isRunOnce = typeof RUN_ONCE !== 'undefined' && RUN_ONCE;
            if (!activeConfig.enabled) {
              targetThemeModes.delete(target.id);
              if (isRunOnce) {
                await removePreloadContextMenuHook();
              } else {
                void removePreloadContextMenuHook();
              }
            } else {
              const resolvedMode = res?.result?.result?.value;
              if (resolvedMode === 'dark' || resolvedMode === 'light') {
                const prevMode = targetThemeModes.get(target.id);
                targetThemeModes.set(target.id, resolvedMode);
                if (prevMode !== resolvedMode) {
                  syncThemeToChildIframes(target.id, resolvedMode);
                }
              }
              if (activeConfig.modules?.i18n === false || activeConfig.installedLocale === 'none') {
                if (isRunOnce) {
                  await removePreloadContextMenuHook();
                } else {
                  void removePreloadContextMenuHook();
                }
              } else if (isRunOnce) {
                await ensurePreloadContextMenuHook();
              } else {
                void ensurePreloadContextMenuHook();
              }
            }
          }
          if (target.type === 'iframe') {
            const gate = shouldLogIframeTargetLifecycle(cachedPatchVersion);
            if (gate.log) {
              console.log(
                `[Daemon] Injected (${cachedPatchVersion}) into iframe ${target.id} [${endpoint.channel}]${gate.suffix}`
              );
            }
          } else {
            console.log(`[Daemon] Injected (${cachedPatchVersion}) into target ${target.id} [${endpoint.channel}]`);
          }
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
          const renderedSig = `${payload.hasData ? '1' : '0'}:${payload.dbFound ? '1' : '0'}\n${payload.inlineHtml || ''}\n${payload.tooltipHtml || ''}`;
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

      let queuedMetricsSync = null;
      const syncMetricsForSession = (force = false, skipDomEval = false) => {
        if (metricsSyncPromise) {
          queuedMetricsSync = {
            force: Boolean(queuedMetricsSync?.force || force),
            skipDomEval: queuedMetricsSync ? Boolean(queuedMetricsSync.skipDomEval && skipDomEval) : Boolean(skipDomEval)
          };
          return metricsSyncPromise;
        }
        metricsSyncPromise = (async () => {
          let curForce = force;
          let curSkip = skipDomEval;
          try {
            let hops = 0;
            while (hops < 2) {
              hops += 1;
              await runMetricsSync(curForce, curSkip);
              if (!queuedMetricsSync) break;
              curForce = queuedMetricsSync.force;
              curSkip = queuedMetricsSync.skipDomEval;
              queuedMetricsSync = null;
            }
          } catch {}
          finally {
            queuedMetricsSync = null;
            metricsSyncPromise = null;
          }
        })();
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
            if (activeConfig.modules?.i18n === false || activeConfig.installedLocale === 'none') {
              void removePreloadContextMenuHook();
            } else {
              void ensurePreloadContextMenuHook();
            }
          }
        } catch {}
      };

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
        if (target.type === 'iframe') {
          const gate = shouldLogIframeTargetLifecycle(cachedPatchVersion);
          if (gate.log) {
            console.log(
              `[Daemon] Attached iframe: ${target.id} (${redactTargetLabelForLog(target.title || target.url || 'iframe')}) [${endpoint.channel}]${gate.suffix}`
            );
          }
        } else {
          console.log(
            `[Daemon] Attached target: ${target.id} (${redactTargetLabelForLog(target.title || 'Untitled')}) [${endpoint.channel}]`
          );
        }
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
          if (target.type === 'page') {
            await send('Runtime.addBinding', { name: '__agRequestMetrics' });
            await send('Runtime.addBinding', { name: '__agSetUiLang' });
            await send('Runtime.addBinding', { name: '__agSyncHostThemeMode' });
            await send('Runtime.addBinding', { name: '__agRequestTokenAnalytics' });
            await send('Runtime.addBinding', { name: '__agOpenInBrowser' });
            await send('Runtime.addBinding', { name: '__agOpenInEditor' });
          }
        }
        if (ws.readyState !== WebSocket.OPEN || nonHostSettled || !hostConfirmed || generation !== navigationGeneration) {
          finishAttach(false);
          return false;
        }
        await updateNewDocScript(true);
        if (generation !== navigationGeneration || !hostConfirmed || nonHostSettled) return false;
        const ok = await inject();
        if (target.type === 'page') {
          await syncMetricsForSession(true);
        }
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
          if (msg.method === 'Runtime.executionContextCreated') {
            const ctx = msg.params?.context;
            if (
              ctx &&
              ctx.name === 'Electron Isolated Context' &&
              ctx.auxData?.isDefault === false &&
              (!ctx.auxData.frameId || ctx.auxData.frameId === target.id)
            ) {
              preloadIsolatedContextId = ctx.id;
              if (hostConfirmed && target.type === 'page' && activeConfig.enabled) {
                void ensurePreloadContextMenuHook();
              }
            }
            return;
          }
          if (msg.method === 'Runtime.executionContextsCleared') {
            preloadIsolatedContextId = null;
            preloadCmHookedContextId = null;
            cmHookAttemptsByCtx.clear();
            return;
          }
          if (msg.method === 'Runtime.executionContextDestroyed') {
            const deadId = msg.params?.executionContextId;
            if (deadId !== undefined) {
              cmHookAttemptsByCtx.delete(deadId);
            }
            if (deadId === preloadIsolatedContextId) {
              preloadIsolatedContextId = null;
              preloadCmHookedContextId = null;
            }
            return;
          }
          if (
            msg.method === 'Runtime.bindingCalled' &&
            (msg.params?.name === '__agOpenInBrowser' || msg.params?.name === '__agOpenInEditor')
          ) {
            if (
              !hostConfirmed ||
              nonHostSettled ||
              target.type !== 'page' ||
              !activeConfig.enabled ||
              activeConfig.modules?.contextMenu === false
            ) {
              return;
            }
            const nowAction = Date.now();
            if (nowAction - lastOpenExternalActionAt < 350) return;
            lastOpenExternalActionAt = nowAction;
            if (msg.params.name === '__agOpenInBrowser') {
              const checked = resolveSafeBrowserPreviewFileUrl(msg.params.payload);
              if (checked.ok && checked.safeFileUrl) {
                launchSafeFileUrlInDefaultBrowser(checked.safeFileUrl);
              }
            } else {
              launchSafeFileInDetectedEditor(msg.params.payload);
            }
            return;
          }
          if (msg.method === 'Runtime.bindingCalled' && msg.params?.name === '__agRequestMetrics') {
            if (!hostConfirmed || nonHostSettled || target.type !== 'page' || !activeConfig.enabled) return;
            const parsed = parseMetricsSubscriptionPayload(msg.params.payload);
            if (parsed.valid) {
              const changed = acceptMetricsSubscription(parsed.ids);
              if (changed || parsed.ids.length > 0) {
                syncMetricsForSession(true, true);
              }
            }
            return;
          }
          if (msg.method === 'Runtime.bindingCalled' && msg.params?.name === '__agSetUiLang') {
            if (!hostConfirmed || nonHostSettled || target.type !== 'page' || !activeConfig.enabled) return;
            const normLang = normalizeUiLangValue(msg.params.payload);
            const persistedOk = SAFE_MODE ? true : persistUiLangToUserConfig(normLang, true);
            if (persistedOk) {
              broadcastUiLangToTargets(normLang, target.id);
            }
            return;
          }
          if (msg.method === 'Runtime.bindingCalled' && msg.params?.name === '__agRequestTokenAnalytics') {
            if (
              !hostConfirmed ||
              nonHostSettled ||
              target.type !== 'page' ||
              !activeConfig.enabled ||
              !activeConfig.modules.tokenAnalytics ||
              !DatabaseSync
            ) {
              return;
            }
            let req = {};
            try {
              req = msg.params.payload ? JSON.parse(String(msg.params.payload)) : {};
            } catch {}
            const reqId = String(req?.reqId || '');
            const maxDays = Number(req?.maxDays) > 0 ? Number(req.maxDays) : 365;
            const force = req?.force === 'hard' ? 'hard' : Boolean(req?.force);
            void (async () => {
              let payloadJson = '';
              try {
                const data = await runTokenAnalyticsQuery(endpoint, { maxDays, force });
                const hasCacheState = typeof tokenAnalyticsCacheState !== 'undefined';
                if (hasCacheState && tokenAnalyticsCacheState.lastJsonDataRef === data && tokenAnalyticsCacheState.lastJsonStr) {
                  payloadJson = tokenAnalyticsCacheState.lastJsonStr;
                } else {
                  payloadJson = JSON.stringify({ ok: true, data });
                  if (hasCacheState) {
                    tokenAnalyticsCacheState.lastJsonDataRef = data;
                    tokenAnalyticsCacheState.lastJsonStr = payloadJson;
                  }
                }
              } catch (err) {
                payloadJson = JSON.stringify({ ok: false, error: err?.message || String(err || 'token analytics failed') });
              }
              if (ws.readyState === WebSocket.OPEN && hostConfirmed && !nonHostSettled) {
                const safeJsonLiteral = JSON.stringify(payloadJson).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
                try {
                  await send('Runtime.evaluate', {
                    expression: `if (typeof window.__ag_on_token_analytics === 'function') { window.__ag_on_token_analytics(${JSON.stringify(reqId)}, JSON.parse(${safeJsonLiteral})); }`,
                    returnByValue: false
                  });
                } catch {}
              }
            })();
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
        ensurePreloadContextMenuHook,
        removePreloadContextMenuHook,
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
    if (
      syncTickCount % 24 === 1 &&
      !inFlightTokenAnalyticsPromise &&
      !(typeof tokenAnalyticsCacheState !== 'undefined' && tokenAnalyticsCacheState.persistTimer) &&
      (tokenAnalyticsDbCache.size > 0 || tokenAnalyticsSummariesCache.size > 0) &&
      Date.now() - lastTokenAnalyticsAccessMs > 600000
    ) {
      tokenAnalyticsDbCache.clear();
      tokenAnalyticsSummariesCache.clear();
      if (typeof tokenAnalyticsCacheState !== 'undefined') {
        tokenAnalyticsCacheState.diskLoaded = false;
        tokenAnalyticsCacheState.lastJsonDataRef = null;
        tokenAnalyticsCacheState.lastJsonStr = '';
      }
    }
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
    const fullScannedChannels = new Set();
    const reachableChannels = new Set();
    const pendingPages = [];
    const pendingIframes = [];
    const fastPathPageEntries = [];

    const probedPorts = new Set();
    const nowMs = Date.now();
    for (const endpoint of activeConfig.endpoints) {
      const portInfo = readPortInfo(endpoint.portFile);
      let activePort = portInfo.port;
      let activeBrowserWsPath = portInfo.browserWsPath;

      // BrowserWatcher 在线时的非心跳拍快路径：跳过 /json/list HTTP 轮询（削减 5/6 轮询），每 6 拍或配置热更新仍执行全量对账
      const liveWatcher =
        !RUN_ONCE && !shouldHeartbeatCheck && isEventDiscoveryEnabled() && activePort
          ? browserWatchers.get(`${endpoint.channel}:${activePort}`)
          : null;
      if (liveWatcher && liveWatcher.ws && liveWatcher.ws.readyState === WebSocket.OPEN) {
        probedPorts.add(activePort);
        reachableChannels.add(endpoint.channel);
        liveWatcher.endpoint = endpoint;
        for (const [id, entry] of attachedTargets.entries()) {
          if ((entry.endpoint?.channel || 'stable') !== endpoint.channel) continue;
          const rs = entry.ws?.readyState;
          if (rs === WebSocket.OPEN || rs === WebSocket.CONNECTING) {
            activeTargetIds.add(id);
            if (entry.hostConfirmed && entry.type !== 'iframe' && entry.syncMetricsForSession) {
              fastPathPageEntries.push(entry);
            }
          }
        }
        continue;
      }

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

      fullScannedChannels.add(endpoint.channel);
      if (fromPortFile || targets.length > 0) {
        reachableChannels.add(endpoint.channel);
      }

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
            if (entry.type !== 'iframe' && entry.syncMetricsForSession) {
              await entry.syncMetricsForSession(bundleChanged);
            }
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
    for (const entry of fastPathPageEntries) {
      if (entry.hostConfirmed && entry.ws?.readyState === WebSocket.OPEN && entry.syncMetricsForSession) {
        await entry.syncMetricsForSession(false);
      }
    }

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
    if (fullScannedChannels.size > 0) {
      for (const [id, skipped] of skippedNonHostTargets.entries()) {
        const metaCh = targetMetaMap.get(id)?.channel;
        if ((!metaCh || fullScannedChannels.has(metaCh)) && !seenRawTargetIds.has(id) && (skipped?.skippedAt || 0) < syncStartMs) {
          skippedNonHostTargets.delete(id);
        }
      }
      for (const [id, meta] of targetMetaMap.entries()) {
        if (
          (!meta?.channel || fullScannedChannels.has(meta.channel)) &&
          !seenRawTargetIds.has(id) &&
          !attachedTargets.has(id) &&
          !attachingTargetIds.has(id) &&
          (meta?.updatedAt || 0) < syncStartMs
        ) {
          targetMetaMap.delete(id);
        }
      }
    } else if (reachableChannels.size === 0 && attachedTargets.size === 0 && attachingTargetIds.size === 0) {
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
