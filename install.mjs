#!/usr/bin/env node
/**
 * antigravity-parchment-theme · macOS 一键安装、自检、安全模式验证、打包与回滚 CLI (install.mjs)
 * Forked from Anarcadia/chuanban-antigravity-theme-patch (MIT License)
 *
 * 支持子命令：
 *   node install.mjs install [--channel auto|stable|insiders] [--preset high-contrast] [--target-dir <dir>]
 *   node install.mjs install-fonts --from <font-folder-path>
 *   node install.mjs doctor  [--channel auto|stable|insiders] [--target-dir <dir>]
 *   node install.mjs verify  [--safe-mode] [--channel auto|stable|insiders] [--target-dir <dir>]
 *   node install.mjs rollback [--target-dir <dir>]
 *   node install.mjs uninstall [--target-dir <dir>]
 *   node install.mjs build-manifest
 *   node install.mjs pack
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import crypto from 'node:crypto';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 屏蔽 Node 22.x 动态探测 node:sqlite 时的 ExperimentalWarning 噪声，保持 doctor/verify JSON 输出纯净
const _origEmitWarning = process.emitWarning;
process.emitWarning = function (warning, ...rest) {
  const type = typeof rest[0] === 'string' ? rest[0] : rest[0] && rest[0].type;
  if (type === 'ExperimentalWarning' || (warning && warning.name === 'ExperimentalWarning')) return;
  return _origEmitWarning.call(this, warning, ...rest);
};

const GOOGLE_DRIVE_URL = 'https://drive.google.com/drive/folders/1NX92SgVUqtSjWg6bt6sIJXy-cn7J_boC';
const UPSTREAM_REPO_URL = 'https://github.com/Anarcadia/chuanban-antigravity-theme-patch';
const GITHUB_REPO_URL = 'https://github.com/pumblus/antigravity-parchment-theme';
const MANIFEST_NAME = 'antigravity-parchment-theme';
const ALLOWED_MANIFEST_NAMES = new Set([MANIFEST_NAME, 'chuanban-antigravity-theme-patch']);

const args = process.argv.slice(2);
const subcommand = args.find((a) => !a.startsWith('-')) || 'help';
const hasFlag = (f) => args.some((a) => a === f || a.startsWith(f + '='));
function getArg(flag, fallback = null) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && i + 1 < args.length) return args[i + 1];
    if (args[i].startsWith(flag + '=')) return args[i].slice(flag.length + 1);
  }
  return fallback;
}

function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function canonicalPath(p) {
  const resolved = path.resolve(p);
  try {
    return fs.realpathSync.native ? fs.realpathSync.native(resolved) : fs.realpathSync(resolved);
  } catch {
    const parent = path.dirname(resolved);
    if (parent && parent !== resolved) return path.join(canonicalPath(parent), path.basename(resolved));
    return resolved;
  }
}

function isSameTargetPath(a, b) {
  const pa = canonicalPath(a);
  const pb = canonicalPath(b);
  return process.platform === 'darwin'
    ? pa.toLowerCase() === pb.toLowerCase()
    : pa === pb;
}

function assertMacOsHost(action) {
  if (process.platform !== 'darwin') {
    throw new Error(`This macOS-only fork does not support ${action} on ${process.platform}.`);
  }
}

function resolveGlobalInstallDir() {
  return path.join(os.homedir(), '.gemini', 'antigravity', 'theme-patch');
}

function resolveDefaultTargetDir() {
  const installed = resolveGlobalInstallDir();
  if (fs.existsSync(path.join(installed, 'core', 'daemon.mjs'))) {
    return installed;
  }
  return __dirname;
}

// ============================================================================
// 1. 生成与校验 core/manifest.json 及 dist/ 发行包
// ============================================================================
function buildManifest(baseDir = __dirname) {
  const coreDir = path.join(baseDir, 'core');
  const files = ['daemon.mjs', 'runtime.js', 'theme.css', 'i18n.json'];
  const entries = {};
  for (const name of files) {
    const p = path.join(coreDir, name);
    if (!fs.existsSync(p)) {
      throw new Error(`Missing core file: ${p}`);
    }
    const stat = fs.statSync(p);
    entries[name] = {
      sha256: sha256File(p),
      bytes: stat.size
    };
  }
  const manifest = {
    name: MANIFEST_NAME,
    version: '6.0.6-eric.1',
    minNodeVersion: '22.0.0',
    fullMetricsNodeVersion: '22.13.0',
    distribution: {
      githubRepo: GITHUB_REPO_URL,
      upstreamRepo: UPSTREAM_REPO_URL
    },
    files: entries
  };
  const manifestPath = path.join(coreDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return manifest;
}

function buildDistZip(baseDir = __dirname) {
  const manifest = buildManifest(baseDir);
  const distDir = path.join(baseDir, 'dist');
  fs.mkdirSync(distDir, { recursive: true });
  const zipName = `${manifest.name}-v${manifest.version}.zip`;
  const zipPath = path.join(distDir, zipName);
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

  const includeItems = [
    'LICENSE',
    'SKILL.md',
    'README.md',
    'FORK.md',
    'CHANGELOG.md',
    'install.mjs',
    '.gitattributes',
    '.gitignore',
    'core',
    'user',
    'assets'
  ].filter((item) => fs.existsSync(path.join(baseDir, item)));

  const allowedUserFiles = new Set(['config.json', 'custom.css', 'custom.js', 'i18n.override.json']);
  const skipNames = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);
  const entriesToPack = [];
  const collectEntries = (relPosix) => {
    const fullPath = path.join(baseDir, ...relPosix.split('/'));
    if (!fs.existsSync(fullPath)) return;
    const st = fs.statSync(fullPath);
    if (st.isDirectory()) {
      for (const child of fs.readdirSync(fullPath).sort()) {
        if (skipNames.has(child)) continue;
        if (relPosix === 'user' && !allowedUserFiles.has(child)) continue;
        collectEntries(`${relPosix}/${child}`);
      }
    } else if (st.isFile()) {
      entriesToPack.push({ abs: fullPath, entry: relPosix });
    }
  };
  for (const item of includeItems) {
    collectEntries(item.replace(/\\/g, '/'));
  }

  const r = spawnSync('zip', ['-q', zipPath, ...entriesToPack.map((e) => e.entry)], {
    cwd: baseDir,
    stdio: 'inherit'
  });
  if (r.status !== 0) throw new Error('zip command failed');
  // 逐文件校验 zip 内 core/* 的 SHA-256 与字节数与 manifest 完全一致，杜绝脏包发布
  for (const [name, meta] of Object.entries(manifest.files)) {
    const uz = spawnSync('unzip', ['-p', zipPath, `core/${name}`], { maxBuffer: 20 * 1024 * 1024 });
    if (uz.status !== 0) {
      fs.unlinkSync(zipPath);
      throw new Error(`Verification failed: missing core/${name} in ${zipName}`);
    }
    const actualSha = crypto.createHash('sha256').update(uz.stdout).digest('hex');
    if (actualSha !== meta.sha256 || uz.stdout.length !== meta.bytes) {
      fs.unlinkSync(zipPath);
      throw new Error(
        `Verification failed for core/${name} in ${zipName}: expected ${meta.sha256} (${meta.bytes}B), got ${actualSha} (${uz.stdout.length}B)`
      );
    }
  }
  return { zipPath, version: manifest.version, filesVerified: Object.keys(manifest.files).length };
}

function verifyCoreIntegrity(baseDir = __dirname) {
  const coreDir = path.join(baseDir, 'core');
  const manifestPath = path.join(coreDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return { ok: false, reason: 'missing manifest.json', modified: [] };
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const modified = [];
  for (const [name, meta] of Object.entries(manifest.files || {})) {
    const p = path.join(coreDir, name);
    if (!fs.existsSync(p)) {
      modified.push({ file: name, status: 'missing' });
      continue;
    }
    const actualHash = sha256File(p);
    if (actualHash !== meta.sha256) {
      modified.push({ file: name, status: 'modified', expected: meta.sha256, actual: actualHash });
    }
  }
  return { ok: modified.length === 0, manifest, modified };
}

// ============================================================================
// 2. 环境、字体、argv.json 与实时 CDP 窗口检查
// ============================================================================
// Diagnostics only: never start/stop apps or infer CDP readiness from argv.json.
function parseDevToolsPort(raw) {
  const first = String(raw || '').trim().split(/\r?\n/)[0];
  const port = /^\d+$/.test(first) ? Number(first) : 0;
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

function parseMacHostProcesses(output) {
  const hosts = [];
  for (const line of String(output).split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    if (!match) continue;
    // Anchor the actual executable, not a shell command mentioning the app.
    const app = match[2].match(/^(.+\/Antigravity( - Insiders)?\.app\/Contents\/MacOS\/Antigravity)(?:\s+(.*))?$/);
    if (!app || !app[1].startsWith('/') || /\s-/.test(app[1].slice(0, app[1].indexOf('/Antigravity')))) continue;
    const argv = app[3] || '';
    if (/(?:^|\s)--(?:type|import)(?:=|\s)|--ms-enable-electron-run-as-node|sidecar_sdk/.test(argv)) continue;
    hosts.push({ pid: Number(match[1]), channel: app[2] ? 'insiders' : 'stable',
      hasCdpFlag: /(?:^|\s)--remote-debugging-port(?:=|\s)\d+(?=\s|$)/.test(argv) });
  }
  return hosts;
}

function probeHostProcesses() {
  // Other platforms deliberately report unknown, rather than an unsafe guess.
  if (process.platform !== 'darwin') return { known: false, processes: [] };
  try {
    const result = spawnSync('/bin/ps', ['-axo', 'pid=,command='], {
      encoding: 'utf8', timeout: 1500, maxBuffer: 4 * 1024 * 1024
    });
    if (result.error || result.status !== 0) return { known: false, processes: [] };
    return { known: true, processes: parseMacHostProcesses(result.stdout) };
  } catch { return { known: false, processes: [] }; }
}

function httpGetLocalJson(port, urlPath, timeoutMs = 450, maxBytes = 0) {
  return new Promise((resolve) => {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return resolve({ ok: false, statusCode: 0, value: null });
    }
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
        return done({ ok: false, statusCode: res.statusCode || 0, value: null });
      }
      let data = '';
      res.on('error', () => done({ ok: false, statusCode: res.statusCode || 0, value: null }));
      res.on('data', (chunk) => {
        data += chunk;
        if (maxBytes > 0 && data.length > maxBytes) {
          req.destroy();
          done({ ok: false, statusCode: res.statusCode || 0, value: null });
        }
      });
      res.on('end', () => {
        try {
          done({ ok: true, statusCode: res.statusCode || 0, value: JSON.parse(data) });
        } catch {
          done({ ok: false, statusCode: res.statusCode || 0, value: null });
        }
      });
    });
    req.on('error', () => done({ ok: false, statusCode: 0, value: null }));
    req.on('timeout', () => {
      req.destroy();
      done({ ok: false, statusCode: 0, value: null });
    });
  });
}

async function probeCdpEndpoint(port) {
  const res = await httpGetLocalJson(port, '/json/version', 450, 65536);
  if (!res.ok || !res.value || typeof res.value !== 'object' || Array.isArray(res.value)) return false;
  try {
    const value = res.value;
    const url = new URL(value.webSocketDebuggerUrl);
    return (
      typeof value.Browser === 'string' &&
      url.protocol === 'ws:' &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) &&
      Number(url.port) === port &&
      !url.username &&
      !url.password &&
      url.pathname.startsWith('/devtools/browser/')
    );
  } catch {
    return false;
  }
}

function classifyCdpStatus({ livePort, portFileExists, processKnown, processes }) {
  // This establishes a live CDP endpoint, not an authenticated Antigravity host.
  // Host identity and injection are separately verified by inspectLiveWindow.
  if (livePort) return 'endpoint_reachable';
  if (!processKnown) return portFileExists ? 'stale_port_file_process_unknown' : 'process_unknown';
  if (!processes.length) return portFileExists ? 'stale_port_file_app_not_running' : 'app_not_running';
  if (processes.some(p => p.hasCdpFlag)) return 'flag_present_endpoint_unreachable';
  return 'running_without_cdp_flag';
}

async function detectEnvironment(channel = 'auto') {
  const nodeVer = process.versions.node;
  const [major, minor] = nodeVer.split('.').map((n) => parseInt(n, 10));
  const nodeBasicOk = major >= 22;

  let sqliteAvailable = false;
  try {
    const mod = await import('node:sqlite').catch(() => null);
    sqliteAvailable = !!(mod && typeof mod.DatabaseSync === 'function');
  } catch {
    sqliteAvailable = false;
  }

  const home = os.homedir();
  const fontDirs = [path.join(home, 'Library/Fonts'), '/Library/Fonts'];

  let allFontFiles = [];
  for (const d of fontDirs) {
    try {
      if (fs.existsSync(d)) {
        allFontFiles.push(...fs.readdirSync(d));
      }
    } catch {}
  }

  const hasAnthropicFont = allFontFiles.some((f) => /Anthropic/i.test(f));
  const hasSarasaFont = allFontFiles.some((f) => /Sarasa|更纱/i.test(f));

  const checkSingleChannel = (ch) => {
    const isInsiders = ch === 'insiders';
    const appDirName = isInsiders ? 'Antigravity - Insiders' : 'Antigravity';
    const portFile = path.join(home, 'Library/Application Support', appDirName, 'DevToolsActivePort');
    const appPath = isInsiders ? '/Applications/Antigravity - Insiders.app' : '/Applications/Antigravity.app';
    const portFileExists = fs.existsSync(portFile);
    const appExists = fs.existsSync(appPath);
    return {
      channel: ch,
      appExists,
      portFile,
      portFileExists
    };
  };

  const channels = { stable: checkSingleChannel('stable'), insiders: checkSingleChannel('insiders') };
  const processProbe = probeHostProcesses();
  const selected = channel === 'auto' ? ['stable', 'insiders'] : [channel === 'insiders' ? 'insiders' : 'stable'];
  for (const ch of selected) {
    const info = channels[ch];
    let recordedPort = null;
    try { recordedPort = parseDevToolsPort(fs.readFileSync(info.portFile, 'utf8')); } catch {}
    const candidates = [...new Set([recordedPort, info.appExists ? (ch === 'insiders' ? 9223 : 9222) : null].filter(Boolean))];
    let livePort = null;
    for (const port of candidates) if (await probeCdpEndpoint(port)) { livePort = port; break; }
    const processes = processProbe.processes.filter(p => p.channel === ch);
    Object.assign(info, { recordedPort, livePort, processKnown: processProbe.known, processes });
    info.cdpStatus = classifyCdpStatus(info);
  }
  const chosen = selected.map(ch => channels[ch]);
  const chInfo = chosen.find(info => info.livePort) || chosen.find(info => info.portFileExists) || chosen[0];

  return {
    nodeVer,
    major,
    minor,
    nodeBasicOk,
    sqliteAvailable,
    tier: sqliteAvailable
      ? 'FULL (>= 22.13, Theme + Fonts + i18n + SQLite Live Metrics)'
      : nodeBasicOk
      ? 'STANDARD (22.0~22.12, Theme + Fonts + i18n; SQLite Metrics gracefully disabled)'
      : 'UNSUPPORTED (< 22.0, requires Node 22+)',
    hasAnthropicFont,
    hasSarasaFont,
    channel,
    appExists: chosen.some(info => info.appExists),
    portFile: chInfo.portFile,
    portFileExists: chosen.some(info => info.portFileExists),
    cdpStatus: chInfo.cdpStatus,
    cdpGuidance: 'Antigravity 2.33 requires an explicit launch flag; argv.json is not proof of CDP access. Save work and quit the app yourself before a separately authorized launch with --remote-debugging-port=0. This installer never restarts the app.',
    channels
  };
}

function isAllowedOrigin(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return false;
  try {
    const url = new URL(urlStr);
    if (url.protocol === 'vscode-file:') return true;
    return ['http:', 'https:'].includes(url.protocol) && ['127.0.0.1', 'localhost'].includes(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}

function fetchTargetsFromPort(port) {
  return httpGetLocalJson(port, '/json/list', 450).then((res) => (res.ok && Array.isArray(res.value) ? res.value : []));
}

async function inspectLiveWindow(portFileOrEnv, fallbackPort = 9222) {
  const candidateFiles = [];
  const candidatePorts = [];

  if (portFileOrEnv && typeof portFileOrEnv === 'object' && portFileOrEnv.channels) {
    if (portFileOrEnv.portFile) candidateFiles.push(portFileOrEnv.portFile);
    if (portFileOrEnv.channel !== 'insiders' && portFileOrEnv.channels.stable?.portFile) candidateFiles.push(portFileOrEnv.channels.stable.portFile);
    if (portFileOrEnv.channel !== 'stable' && portFileOrEnv.channels.insiders?.portFile) candidateFiles.push(portFileOrEnv.channels.insiders.portFile);
    if (portFileOrEnv.channel !== 'insiders' && portFileOrEnv.channels.stable?.appExists !== false) candidatePorts.push(9222);
    if (portFileOrEnv.channel !== 'stable' && portFileOrEnv.channels.insiders?.appExists) candidatePorts.push(9223);
  } else if (typeof portFileOrEnv === 'string' && portFileOrEnv) {
    candidateFiles.push(portFileOrEnv);
    if (fallbackPort > 0) candidatePorts.push(fallbackPort);
  } else if (fallbackPort > 0) {
    candidatePorts.push(fallbackPort);
  }

  let port = null;
  let targets = [];
  const triedPorts = new Set();

  for (const pf of candidateFiles) {
    if (pf && fs.existsSync(pf)) {
      let first = '';
      try { first = fs.readFileSync(pf, 'utf8').trim().split(/\r?\n/)[0]; } catch {}
      const parsed = /^\d+$/.test(first) ? Number(first) : 0;
      if (parsed > 0 && parsed <= 65535 && !triedPorts.has(parsed)) {
        triedPorts.add(parsed);
        const res = await fetchTargetsFromPort(parsed);
        if (res.length > 0) {
          port ||= parsed;
          targets.push(...res.map(target => ({ ...target, diagnosticPort: parsed })));
        }
      }
    }
  }
  {
    for (const fb of candidatePorts) {
      if (fb > 0 && !triedPorts.has(fb)) {
        triedPorts.add(fb);
        const fbTargets = await fetchTargetsFromPort(fb);
        if (fbTargets.length > 0) {
          port ||= fb;
          targets.push(...fbTargets.map(target => ({ ...target, diagnosticPort: fb })));
        }
      }
    }
  }
  if (!port || targets.length === 0) {
    return { reachable: false, reason: 'No active CDP port responded (checked DevToolsActivePort & fallback port 9222)' };
  }

  const pages = targets.filter(
    (t) =>
      t.type === 'page' &&
      t.webSocketDebuggerUrl &&
      !String(t.url || '').startsWith('devtools://') &&
      isAllowedOrigin(t.url) &&
      !String(t.title || '').includes('Launchpad')
  );

  if (pages.length === 0) {
    return { reachable: true, port, pages: 0, reason: 'No active workbench page target' };
  }

  const evaluatePageState = (candidate) =>
    new Promise((resolve) => {
      const ws = new WebSocket(candidate.webSocketDebuggerUrl);
      const timer = setTimeout(() => {
        try {
          ws.close();
        } catch {}
        resolve(null);
      }, 2000);
      ws.addEventListener('open', () => {
        ws.send(
          JSON.stringify({
            id: 1,
            method: 'Runtime.evaluate',
            params: {
              expression: `(() => {
                const pills = typeof document !== 'undefined' && typeof document.querySelectorAll === 'function'
                  ? Array.from(document.querySelectorAll('[data-ag-metrics-pill="1"], #ag-live-metrics-pill'))
                  : [];
                const primaryPill = (typeof document !== 'undefined' && document.getElementById('ag-live-metrics-pill')) || pills[0] || null;
                return {
                  __isHost: !!(
                    (window.location && window.location.protocol === 'vscode-file:') ||
                    (window.__APP_CONFIG__ && window.__APP_CONFIG__.productName === 'antigravity') ||
                    (window.electronNative && (
                      (typeof window.electronNative.setTitleBarOverlay === 'function' && window.nativeStorage && typeof window.nativeStorage.getItems === 'function') ||
                      (typeof window.electronNative.getZoomLevel === 'function' && window.electronNative.wcvBrowser && typeof window.electronNative.wcvBrowser.setThemeColor === 'function')
                    )) ||
                    (typeof document !== 'undefined' && typeof document.querySelector === 'function' && document.querySelector('link[href*="/jetbox.css"], body[data-agy-theme], body[data-newux-theme], [id="antigravity.agentSidePanelInputBox"]'))
                  ),
                  version: window.__ag_patch_version || null,
                  bodyReady: window.__ag_body_ready === true,
                  hasStyle: !!document.getElementById('ag-custom-fonts'),
                  hasUserStyle: !!document.getElementById('antigravity-user-custom-style'),
                  preset: document.documentElement ? document.documentElement.getAttribute('data-ag-preset') : null,
                  themeMode: document.documentElement ? document.documentElement.getAttribute('data-ag-theme-mode') : null,
                  uiLang: document.documentElement ? document.documentElement.getAttribute('data-ag-lang') : null,
                  pageType: document.documentElement ? document.documentElement.getAttribute('data-ag-page-type') : null,
                  waxSeal: document.documentElement ? document.documentElement.getAttribute('data-ag-wax-seal') : null,
                  dictCount: window.__ag_i18n_dict ? Object.keys(window.__ag_i18n_dict).length : 0,
                  protoSafe: window.__ag_i18n_dict ? Object.getPrototypeOf(window.__ag_i18n_dict) === null : false,
                  pillMounted: pills.length > 0,
                  pillCount: pills.length,
                  pillText: primaryPill ? (primaryPill.textContent || null) : null
                };
              })()`,
              returnByValue: true
            }
          })
        );
      });
      ws.addEventListener('message', (ev) => {
        try {
          const msg = JSON.parse(String(ev.data));
          if (msg.id === 1) {
            clearTimeout(timer);
            ws.close();
            resolve(msg.result?.result?.value || null);
          }
        } catch {}
      });
      ws.addEventListener('error', () => {
        clearTimeout(timer);
        resolve(null);
      });
    });

  let selected = null;
  let firstHostCandidate = null;

  for (const candidate of pages) {
    const rawState = await evaluatePageState(candidate);
    if (rawState === null) {
      continue;
    }
    const isHost = rawState.__isHost === true;
    const cleanState = { ...rawState };
    delete cleanState.__isHost;
    if (isHost) {
      if (cleanState.hasStyle === true) {
        selected = { page: candidate, state: cleanState };
        break;
      }
      if (!firstHostCandidate) {
        firstHostCandidate = { page: candidate, state: cleanState };
      }
    }
  }

  if (!selected) {
    selected = firstHostCandidate;
  }
  if (!selected) {
    return { reachable: true, port, pages: 0, reason: 'No active workbench page target' };
  }

  return {
    reachable: true,
    port: selected.page.diagnosticPort || port,
    targetId: selected.page.id,
    title: selected.page.title,
    state: selected.state
  };
}

// ============================================================================
// 3. 子命令实现：doctor / install / verify / rollback / uninstall
// ============================================================================
function extractBaseSemverTuple(verStr) {
  const m = String(verStr || '').match(/v?(\d+)\.(\d+)\.(\d+)/i);
  if (!m) return null;
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}

function compareSemverTuples(a, b) {
  if (!a || !b) return 0;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  }
  return 0;
}

function inspectSourceSync(sourceDir, targetDir) {
  if (isSameTargetPath(sourceDir, targetDir)) {
    return { sameDirectory: true, inSync: true, sourceOlder: false, outdatedFiles: [] };
  }
  const srcManifestPath = path.join(sourceDir, 'core', 'manifest.json');
  const dstManifestPath = path.join(targetDir, 'core', 'manifest.json');
  if (!fs.existsSync(srcManifestPath)) return null;
  if (!fs.existsSync(dstManifestPath)) {
    return {
      sourceDir,
      targetDir,
      inSync: false,
      sourceOlder: false,
      reason: 'target_manifest_missing',
      outdatedFiles: ['core/manifest.json']
    };
  }
  try {
    const srcManifest = JSON.parse(fs.readFileSync(srcManifestPath, 'utf8'));
    const dstManifest = JSON.parse(fs.readFileSync(dstManifestPath, 'utf8'));
    const fileNames = new Set([
      ...Object.keys(srcManifest.files || {}),
      ...Object.keys(dstManifest.files || {})
    ]);
    const outdatedFiles = [];
    for (const name of fileNames) {
      const srcFile = path.join(sourceDir, 'core', name);
      const dstFile = path.join(targetDir, 'core', name);
      const srcSha = fs.existsSync(srcFile) ? sha256File(srcFile) : null;
      const dstSha = fs.existsSync(dstFile) ? sha256File(dstFile) : null;
      if (srcSha !== dstSha) {
        outdatedFiles.push(`core/${name}`);
      }
    }
    if (sha256File(srcManifestPath) !== sha256File(dstManifestPath)) {
      outdatedFiles.push('core/manifest.json');
    }
    const srcInstaller = path.join(sourceDir, 'install.mjs');
    const dstInstaller = path.join(targetDir, 'install.mjs');
    if (fs.existsSync(srcInstaller) && fs.existsSync(dstInstaller) && sha256File(srcInstaller) !== sha256File(dstInstaller)) {
      outdatedFiles.push('install.mjs');
    }
    const verCmp = compareSemverTuples(
      extractBaseSemverTuple(srcManifest.version),
      extractBaseSemverTuple(dstManifest.version)
    );
    const sourceOlder = verCmp < 0;
    return {
      sourceDir,
      targetDir,
      sourceVersion: srcManifest.version || null,
      targetVersion: dstManifest.version || null,
      sourceOlder,
      inSync: outdatedFiles.length === 0,
      outdatedFiles,
      syncHint:
        outdatedFiles.length > 0 && !sourceOlder
          ? `node ${JSON.stringify(path.join(sourceDir, 'install.mjs'))} install`
          : null
    };
  } catch {
    return null;
  }
}

async function runDoctor() {
  const channel = getArg('--channel', 'auto');
  const targetDir = path.resolve(getArg('--target-dir', resolveDefaultTargetDir()));
  const env = await detectEnvironment(channel);
  const integrity = verifyCoreIntegrity(targetDir);
  const sourceSync = inspectSourceSync(__dirname, targetDir);
  const live = await inspectLiveWindow(env);

  const report = {
    ok: Boolean(env.nodeBasicOk && integrity.ok && live.state?.hasStyle && live.state?.bodyReady),
    coreReady: Boolean(env.nodeBasicOk && integrity.ok),
    injectionReady: Boolean(live.state?.hasStyle && live.state?.bodyReady),
    node: {
      version: env.nodeVer,
      execPath: process.execPath,
      serviceExecPath: resolveStableNodeExecPath(),
      tier: env.tier
    },
    fonts: {
      anthropicInstalled: env.hasAnthropicFont,
      sarasaInstalled: env.hasSarasaFont,
      downloadUrl: !env.hasAnthropicFont || !env.hasSarasaFont ? GOOGLE_DRIVE_URL : null
    },
    antigravity: {
      channel: env.channel,
      appExists: env.appExists,
      portFile: env.portFile,
      portFileExists: env.portFileExists,
      channels: env.channels,
      cdpStatus: env.cdpStatus,
      cdpGuidance: env.cdpGuidance
    },
    coreIntegrity: {
      targetDir,
      clean: integrity.ok,
      modifiedFiles: integrity.modified,
      ...(sourceSync && !sourceSync.sameDirectory ? { sourceSync } : {})
    },
    liveWindow: live
  };

  console.log(JSON.stringify(report, null, 2));
  if (!env.nodeBasicOk) {
    console.error('\n[ERROR] Node.js >= 22.0.0 is required. Current:', env.nodeVer);
    process.exit(1);
  }
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const item of fs.readdirSync(src)) {
    const s = path.join(src, item);
    const d = path.join(dest, item);
    const st = fs.statSync(s);
    if (st.isDirectory()) {
      copyDirRecursive(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

function checkDaemonPidState(pid) {
  if (!pid || pid <= 0 || pid === process.pid) return 'not_daemon';
  try {
    process.kill(pid, 0);
  } catch (err) {
    return err && err.code === 'EPERM' ? 'uncertain' : 'not_daemon';
  }
  return 'confirmed';
}

function stopRunningDaemonProcesses() {
  const tmpDir = os.tmpdir();
  const stopped = [];
  try {
    for (const f of fs.readdirSync(tmpDir)) {
      if (f.startsWith('ag-theme-daemon-') && f.endsWith('.pid')) {
        const pidPath = path.join(tmpDir, f);
        const pid = parseInt(fs.readFileSync(pidPath, 'utf8').trim(), 10);
        const pidState = checkDaemonPidState(pid);
        if (pidState === 'confirmed') {
          try {
            process.kill(pid, 'SIGTERM');
            stopped.push(pid);
          } catch {}
        } else if (pidState === 'uncertain') {
          console.warn(`[Install] Skipping PID file unlink for PID ${pid} (EPERM).`);
          continue;
        }
        try {
          fs.unlinkSync(pidPath);
        } catch {}
      }
    }
  } catch {}
  return stopped;
}

function resolveStableNodeExecPath(execPath = process.execPath, platform = process.platform, home = os.homedir()) {
  if (platform !== 'darwin') return execPath;
  let realExec = '';
  try {
    realExec = fs.realpathSync(execPath);
  } catch {
    return execPath;
  }

  const dynamicCellarCandidates = [];
  for (const probePath of [execPath, realExec]) {
    const m = String(probePath || '').match(/^(.*)\/Cellar\/([^/]+)\/[^/]+\/bin\/(node)$/i);
    if (m) {
      const brewPrefix = m[1];
      const formula = m[2];
      const binName = m[3];
      dynamicCellarCandidates.push(path.join(brewPrefix, 'bin', binName));
      dynamicCellarCandidates.push(path.join(brewPrefix, 'opt', formula, 'bin', binName));
    }
  }

  const envExtra = process.env.AG_STABLE_NODE_CANDIDATES
    ? String(process.env.AG_STABLE_NODE_CANDIDATES)
        .split(path.delimiter)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const staticCandidates = [
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
    '/opt/homebrew/opt/node/bin/node',
    '/usr/local/opt/node/bin/node',
    '/opt/homebrew/opt/node@22/bin/node',
    '/opt/homebrew/opt/node@24/bin/node',
    path.join(home, 'Library', 'Application Support', 'fnm', 'aliases', 'default', 'bin', 'node'),
    path.join(home, '.local', 'share', 'fnm', 'aliases', 'default', 'bin', 'node')
  ];

  const seen = new Set();
  for (const cand of [...envExtra, ...dynamicCellarCandidates, ...staticCandidates]) {
    if (!cand || seen.has(cand)) continue;
    seen.add(cand);
    try {
      if (fs.existsSync(cand) && fs.realpathSync(cand) === realExec) {
        return cand;
      }
    } catch {}
  }
  return execPath;
}

function registerSystemService(targetDir, wrapperDaemon) {
  assertMacOsHost('LaunchAgent registration');
  const home = os.homedir();
  const serviceNodeExec = resolveStableNodeExecPath();
  const launchAgentsDir = path.join(home, 'Library', 'LaunchAgents');
  fs.mkdirSync(launchAgentsDir, { recursive: true });
  const existingCustomFontPlist = path.join(launchAgentsDir, 'com.antigravity.customfont.plist');
  const themePlist = path.join(launchAgentsDir, 'com.antigravity.theme.plist');
  const activePlist = fs.existsSync(existingCustomFontPlist) ? existingCustomFontPlist : themePlist;
  const label = path.basename(activePlist, '.plist');

  const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${label}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${serviceNodeExec}</string>
        <string>--disable-warning=ExperimentalWarning</string>
        <string>${wrapperDaemon}</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/Library/Frameworks/Python.framework/Versions/Current/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/antigravity-font-daemon.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/antigravity-font-daemon.err</string>
</dict>
</plist>
`;
  const prevPlist = fs.existsSync(activePlist) ? fs.readFileSync(activePlist, 'utf8') : '';
  const plistChanged = prevPlist !== plistContent;
  if (plistChanged) {
    fs.writeFileSync(activePlist, plistContent, 'utf8');
  }

  const uid = process.getuid ? process.getuid() : 501;
  const domainTarget = `gui/${uid}/${label}`;
  const sleepSync = (ms) => {
    try {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    } catch {}
  };
  const queryServiceState = () => {
    const r = spawnSync('launchctl', ['print', domainTarget], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const out = String(r.stdout || '');
    return { loaded: r.status === 0, running: r.status === 0 && /\bpid\s*=\s*\d+/i.test(out) };
  };

  let runningNow = false;
  try {
    const initial = queryServiceState();
    if (initial.loaded && !plistChanged) {
      spawnSync('launchctl', ['kickstart', '-k', domainTarget], { stdio: 'ignore' });
    } else {
      if (initial.loaded) {
        spawnSync('launchctl', ['bootout', domainTarget], { stdio: 'ignore' });
        for (let i = 0; i < 20 && queryServiceState().loaded; i++) {
          sleepSync(100);
        }
      }
      for (let i = 0; i < 6; i++) {
        if (!queryServiceState().loaded) {
          const bootRes = spawnSync('launchctl', ['bootstrap', `gui/${uid}`, activePlist], { stdio: 'ignore' });
          if (bootRes.status !== 0 && !queryServiceState().loaded) {
            spawnSync('launchctl', ['load', '-w', activePlist], { stdio: 'ignore' });
          }
        }
        if (queryServiceState().loaded) break;
        sleepSync(120);
      }
      spawnSync('launchctl', ['kickstart', '-k', domainTarget], { stdio: 'ignore' });
    }
    for (let i = 0; i < 5; i++) {
      const st = queryServiceState();
      if (st.running) {
        runningNow = true;
        break;
      }
      sleepSync(60);
    }
    if (!runningNow) runningNow = queryServiceState().running;
  } catch {}
  return { platform: 'darwin', serviceFile: activePlist, label, nodeExec: serviceNodeExec, runningNow };
}

async function runInstall() {
  const cliChannel = getArg('--channel', null);
  const channel = cliChannel || 'auto';
  const preset = getArg('--preset', null);
  const defaultTarget = resolveGlobalInstallDir();
  const targetDir = path.resolve(getArg('--target-dir', defaultTarget));
  const isCustomSandboxTarget =
    hasFlag('--target-dir') || !isSameTargetPath(targetDir, defaultTarget);
  if (isCustomSandboxTarget && hasFlag('--register-service')) {
    throw new Error('--register-service is not supported for an isolated --target-dir; omit --target-dir for a global install.');
  }
  if (!isCustomSandboxTarget) {
    assertMacOsHost('install');
  }

  assertTargetContained(targetDir);

  const env = isCustomSandboxTarget
    ? { nodeBasicOk: Number(process.versions.node.split('.')[0]) >= 22, nodeVer: process.versions.node }
    : await detectEnvironment(channel);
  if (!env.nodeBasicOk) {
    console.error(`[ERROR] Node.js >= 22.0.0 is required (current: ${env.nodeVer}).`);
    process.exit(1);
  }

  buildManifest(__dirname);

  const srcCore = path.join(__dirname, 'core');
  const srcUser = path.join(__dirname, 'user');
  const targetCore = path.join(targetDir, 'core');
  const targetPrev = path.join(targetDir, 'core.prev');
  const backupsDir = path.join(targetDir, 'backups');
  const targetUser = path.join(targetDir, 'user');

  let backupCreated = null;
  if (!isSameTargetPath(__dirname, targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });

    // Snapshot every replaced core byte before deletion, including modified/corrupt trees.
    // Invalid snapshots are quarantined and must never displace the last valid core.prev.
    const existingCore = fs.lstatSync(targetCore, { throwIfNoEntry: false });
    const coreNeedsReplacement = !existingCore || snapshotFingerprint(targetCore) !== snapshotFingerprint(srcCore);
    if (existingCore && coreNeedsReplacement) {
      const valid = isValidCoreBackup(targetCore);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      fs.mkdirSync(backupsDir, { recursive: true });
      const snapshotContainer = fs.mkdtempSync(path.join(backupsDir, stamp + (valid ? '-core-' : '-invalid-')));
      const snapshot = path.join(snapshotContainer, 'snapshot');
      const before = snapshotFingerprint(targetCore);
      fs.cpSync(targetCore, snapshot, { recursive: true, dereference: false, verbatimSymlinks: true });
      if (snapshotFingerprint(snapshot) !== before || snapshotFingerprint(targetCore) !== before) {
        throw new Error(`Core snapshot verification failed; installed core left untouched: ${snapshot}`);
      }
      backupCreated = snapshot;
      const srcManifestPath = path.join(srcCore, 'manifest.json');
      const targetManifestPath = path.join(targetCore, 'manifest.json');
      if (valid && (sha256File(srcManifestPath) !== sha256File(targetManifestPath) || !fs.existsSync(targetPrev))) {
        fs.rmSync(targetPrev, { recursive: true, force: true });
        copyDirRecursive(snapshot, targetPrev);
        if (!isValidCoreBackup(targetPrev)) throw new Error('core.prev copy verification failed; installed core left untouched');
      }
    }

    if (coreNeedsReplacement) {
      fs.rmSync(targetCore, { recursive: true, force: true });
      copyDirRecursive(srcCore, targetCore);
    }

    // Existing user files are never overwritten, even by legacy sync flags.
    const USER_TEMPLATE_FILES = ['config.json', 'custom.css', 'i18n.override.json', 'custom.js'];
    fs.mkdirSync(targetUser, { recursive: true });
    for (const item of USER_TEMPLATE_FILES) {
      const s = path.join(srcUser, item);
      const d = path.join(targetUser, item);
      if (fs.existsSync(s) && !fs.existsSync(d)) {
        fs.copyFileSync(s, d);
      }
    }

    for (const docFile of ['install.mjs', 'SKILL.md', 'README.md', 'FORK.md', 'CHANGELOG.md']) {
      const s = path.join(__dirname, docFile);
      const d = path.join(targetDir, docFile);
      if (fs.existsSync(s)) fs.copyFileSync(s, d);
    }
  }

  // 更新 user/config.json（仅在显式传入 CLI 参数或首次初始化时更新对应字段，保留用户自定义）
  const userConfigPath = path.join(targetUser, 'config.json');
  const currentCfg = fs.existsSync(userConfigPath)
    ? JSON.parse(fs.readFileSync(userConfigPath, 'utf8'))
    : {};
  if (typeof currentCfg.enabled !== 'boolean') currentCfg.enabled = true;
  if (cliChannel) {
    currentCfg.channel = cliChannel;
  } else if (!currentCfg.channel) {
    currentCfg.channel = 'auto';
  }
  if (preset) {
    currentCfg.preset = preset;
  } else if (!currentCfg.preset) {
    currentCfg.preset = 'high-contrast';
  }
  // Preserve user selectors and file formatting. Runtime compatibility normalization
  // happens in memory; installing a theme must not discard custom selectors.
  const originalCfg = fs.existsSync(userConfigPath)
    ? fs.readFileSync(userConfigPath, 'utf8')
    : null;
  if (originalCfg === null || ((cliChannel || preset) && JSON.stringify(JSON.parse(originalCfg)) !== JSON.stringify(currentCfg))) {
    fs.writeFileSync(userConfigPath, JSON.stringify(currentCfg, null, 2) + '\n', 'utf8');
  }

  const realDaemon = path.join(targetCore, 'daemon.mjs');
  let argvStatus = { skipped: true, reason: 'custom-target-dir' };
  let serviceInfo = { skipped: true, reason: 'custom-target-dir' };

  if (!isCustomSandboxTarget) {
    // 2.33 ignores the legacy argv setting. Do not silently change launch/security settings.
    argvStatus = { skipped: true, reason: 'explicit-launch-opt-in-required', guidance: env.cdpGuidance };

    // 创建兼容包装脚本 ~/.gemini/antigravity/scripts/antigravity-font-daemon.mjs
    const scriptsDir = path.join(os.homedir(), '.gemini', 'antigravity', 'scripts');
    fs.mkdirSync(scriptsDir, { recursive: true });
    const wrapperDaemon = path.join(scriptsDir, 'antigravity-font-daemon.mjs');
    const realDaemonUrl = pathToFileURL(realDaemon).href;
    fs.writeFileSync(
      wrapperDaemon,
      `#!/usr/bin/env node\n// Auto-generated wrapper -> ${realDaemon}\nawait import(${JSON.stringify(realDaemonUrl)});\n`,
      { encoding: 'utf8', mode: 0o755 }
    );

    // 注册/更新 macOS LaunchAgent 自启服务
    serviceInfo = registerSystemService(targetDir, wrapperDaemon);

    // 立即执行一次 --once 同步注入
    spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', realDaemon, '--once'], {
      stdio: 'inherit'
    });
  }

  const live = isCustomSandboxTarget ? { skipped: true, reason: 'custom-target-dir' } : await inspectLiveWindow(env);
  console.log(
    '\n[Install Complete]',
    JSON.stringify(
      {
        ok: true,
        targetDir,
        backupCreated,
        argvStatus,
        serviceInfo,
        config: currentCfg,
        liveWindow: live
      },
      null,
      2
    )
  );
}

async function runVerify() {
  const safeMode = hasFlag('--safe-mode');
  const channel = getArg('--channel', 'auto');
  const targetDir = path.resolve(getArg('--target-dir', resolveDefaultTargetDir()));
  const daemonPath = path.join(targetDir, 'core', 'daemon.mjs');

  const daemonArgs = ['--disable-warning=ExperimentalWarning', daemonPath, '--once'];
  if (safeMode) daemonArgs.push('--safe-mode');
  if (channel && channel !== 'auto') daemonArgs.push('--channel', channel);

  spawnSync(process.execPath, daemonArgs, { stdio: 'inherit' });
  const env = await detectEnvironment(channel);
  const live = await inspectLiveWindow(env);
  const ok = Boolean(live.reachable && live.state?.hasStyle && live.state?.bodyReady);
  console.log(
    JSON.stringify(
      {
        ok,
        version: live.state?.version || null,
        themeStyle: Boolean(live.state?.hasStyle),
        safeMode,
        channel,
        live
      },
      null,
      2
    )
  );
}

// A byte/link inventory also covers malformed manifests, extra files and empty folders.
function snapshotFingerprint(root) {
  const entries = [];
  const walk = (file, relative) => {
    const st = fs.lstatSync(file);
    if (st.isSymbolicLink()) entries.push([relative, 'link', fs.readlinkSync(file)]);
    else if (st.isFile()) entries.push([relative, 'file', st.size, sha256File(file)]);
    else if (st.isDirectory()) {
      entries.push([relative, 'dir']);
      for (const name of fs.readdirSync(file).sort()) walk(path.join(file, name), path.join(relative, name));
    } else throw new Error(`Cannot safely snapshot special core file: ${file}`);
  };
  walk(root, '');
  return JSON.stringify(entries);
}

// Backups must be complete, self-contained core snapshots, never user directories.
function isValidCoreBackup(dir) {
  const required = ['daemon.mjs', 'runtime.js', 'theme.css', 'i18n.json'];
  try {
    if (!fs.lstatSync(dir).isDirectory()) return false;
    const names = fs.readdirSync(dir).sort();
    if (JSON.stringify(names) !== JSON.stringify([...required, 'manifest.json'].sort())) return false;
    for (const name of names) if (!fs.lstatSync(path.join(dir, name)).isFile()) return false;
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    if (!ALLOWED_MANIFEST_NAMES.has(manifest.name) || typeof manifest.version !== 'string' || !manifest.version) return false;
    if (!manifest.files || JSON.stringify(Object.keys(manifest.files).sort()) !== JSON.stringify(required.slice().sort())) return false;
    return required.every(name => {
      const meta = manifest.files[name];
      const file = path.join(dir, name);
      return meta && Number.isSafeInteger(meta.bytes) && meta.bytes >= 0 &&
        typeof meta.sha256 === 'string' && /^[a-f0-9]{64}$/.test(meta.sha256) &&
        fs.statSync(file).size === meta.bytes && sha256File(file) === meta.sha256;
    });
  } catch { return false; }
}

// Reject nested links escaping the selected target before touching mutable directories.
function assertTargetContained(targetDir) {
  const root = canonicalPath(targetDir);
  for (const part of ['core', 'core.prev', 'backups', 'user', 'user/config.json', 'user/custom.css', 'user/custom.js', 'user/i18n.override.json', 'install.mjs', 'SKILL.md', 'README.md', 'FORK.md', 'CHANGELOG.md']) {
    const rel = path.relative(root, canonicalPath(path.join(targetDir, part)));
    if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
      throw new Error(`Target path escapes selected directory: ${part}`);
    }
  }
}

async function runRollback() {
  const defaultTarget = resolveGlobalInstallDir();
  const targetDir = path.resolve(getArg('--target-dir', resolveDefaultTargetDir()));
  const isCustomSandboxTarget =
    hasFlag('--target-dir') || !isSameTargetPath(targetDir, defaultTarget);
  if (isCustomSandboxTarget && hasFlag('--register-service')) {
    throw new Error('--register-service is not supported for an isolated --target-dir; omit --target-dir for a global install.');
  }
  if (!isCustomSandboxTarget) {
    assertMacOsHost('rollback');
  }
  assertTargetContained(targetDir);
  const targetCore = path.join(targetDir, 'core');
  const targetPrev = path.join(targetDir, 'core.prev');
  const backupsDir = path.join(targetDir, 'backups');

  let restoreSource = null;
  if (isValidCoreBackup(targetPrev)) {
    restoreSource = targetPrev;
  } else if (fs.existsSync(backupsDir)) {
    const candidates = fs.readdirSync(backupsDir).sort().reverse();
    for (const name of candidates) {
      if (name.endsWith('-user') || name.includes('-invalid-')) continue;
      const dir = path.join(backupsDir, name);
      // Retain compatibility with older direct snapshots and new verified containers.
      const candidate = name.includes('-core-') ? path.join(dir, 'snapshot') : dir;
      if (isValidCoreBackup(candidate)) { restoreSource = candidate; break; }
    }
  }

  if (!restoreSource) {
    console.error(`[ERROR] No valid core backup found at ${targetPrev} or ${backupsDir}`);
    process.exit(1);
  }

  // Copy and validate before replacing anything. Keep the previous core until rename succeeds.
  const staging = fs.mkdtempSync(path.join(targetDir, '.rollback-'));
  const stagedCore = path.join(staging, 'core');
  const previousCore = path.join(staging, 'previous');
  try {
    copyDirRecursive(restoreSource, stagedCore);
    if (!isValidCoreBackup(stagedCore)) throw new Error('Core backup changed or copy was incomplete');
    const hadCore = fs.existsSync(targetCore);
    if (hadCore) fs.renameSync(targetCore, previousCore);
    try { fs.renameSync(stagedCore, targetCore); }
    catch (err) {
      if (hadCore) fs.renameSync(previousCore, targetCore);
      throw err;
    }
    fs.rmSync(staging, { recursive: true, force: true });
  } catch (err) {
    // Leave staging for recovery if a failed restore also prevented reverting the rename.
    if (!fs.existsSync(previousCore)) fs.rmSync(staging, { recursive: true, force: true });
    throw err;
  }

  // 重启守护进程并立即执行一次 --once 重新注入（沙箱 --target-dir 隔离模式下跳过全局服务干预）
  const realDaemon = path.join(targetCore, 'daemon.mjs');
  if (!isCustomSandboxTarget) {
    const uid = process.getuid ? process.getuid() : 501;
    try {
      execSync(`launchctl kickstart -k gui/${uid}/com.antigravity.customfont 2>/dev/null || launchctl kickstart -k gui/${uid}/com.antigravity.theme 2>/dev/null || true`);
    } catch {}
    spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', realDaemon, '--once'], {
      stdio: 'inherit'
    });
  }

  const env = isCustomSandboxTarget ? null : await detectEnvironment('auto');
  const live = isCustomSandboxTarget ? { skipped: true, reason: 'custom-target-dir' } : await inspectLiveWindow(env);
  console.log(
    JSON.stringify(
      {
        ok: true,
        restoredFrom: restoreSource,
        restoredTo: targetCore,
        live
      },
      null,
      2
    )
  );
}

function runInstallFonts() {
  assertMacOsHost('install-fonts');
  const fromDir = getArg('--from', null);
  if (!fromDir || !fs.existsSync(fromDir)) {
    console.error('Usage: node install.mjs install-fonts --from <font-folder-path>');
    process.exit(1);
  }
  const home = os.homedir();
  const destDir = path.join(home, 'Library', 'Fonts');

  fs.mkdirSync(destDir, { recursive: true });
  const installed = [];
  const skippedSamePath = [];

  const walkFonts = (dir) => {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      const st = fs.statSync(full);
      if (st.isDirectory()) {
        walkFonts(full);
      } else if (/\.(ttf|otf|ttc)$/i.test(entry)) {
        const destPath = path.join(destDir, entry);
        if (isSameTargetPath(full, destPath)) {
          skippedSamePath.push(destPath);
        } else {
          fs.copyFileSync(full, destPath);
          installed.push(destPath);
        }
      }
    }
  };

  walkFonts(path.resolve(fromDir));
  console.log(
    JSON.stringify(
      {
        ok: true,
        platform: process.platform,
        destDir,
        installedCount: installed.length,
        skippedCount: skippedSamePath.length,
        installed,
        skippedSamePath
      },
      null,
      2
    )
  );
}

async function runUninstall() {
  const home = os.homedir();
  const defaultTarget = resolveGlobalInstallDir();
  const targetDir = path.resolve(getArg('--target-dir', resolveDefaultTargetDir()));
  const isCustomSandboxTarget =
    hasFlag('--target-dir') || !isSameTargetPath(targetDir, defaultTarget);
  if (isCustomSandboxTarget && hasFlag('--register-service')) {
    throw new Error('--register-service is not supported for an isolated --target-dir; omit --target-dir for a global install.');
  }
  const userConfigPath = path.join(targetDir, 'user', 'config.json');
  const realDaemon = path.join(targetDir, 'core', 'daemon.mjs');

  if (isCustomSandboxTarget) {
    const localCacheDir = path.join(targetDir, '.cache');
    try {
      if (fs.existsSync(localCacheDir)) fs.rmSync(localCacheDir, { recursive: true, force: true });
    } catch {}
    console.log(`[Uninstall] Cleaned custom sandbox target (${targetDir}); global daemon and services were left untouched.`);
    return;
  }
  assertMacOsHost('uninstall');

  // 1. 先移除 macOS LaunchAgent 自启服务（防止 KeepAlive 自动拉起），再终止残留后台守护进程，消除与 --once 还原注入的并发竞态
  const uid = process.getuid ? process.getuid() : 501;
  const launchAgentsDir = path.join(home, 'Library', 'LaunchAgents');
  for (const label of ['com.antigravity.customfont', 'com.antigravity.theme']) {
    try {
      execSync(`launchctl bootout gui/${uid}/${label} 2>/dev/null || true`);
    } catch {}
    for (let i = 0; i < 15; i++) {
      const res = spawnSync('launchctl', ['print', `gui/${uid}/${label}`], { stdio: 'ignore' });
      if (res.status !== 0) break;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
    try {
      const plistFile = path.join(launchAgentsDir, `${label}.plist`);
      if (fs.existsSync(plistFile)) fs.unlinkSync(plistFile);
    } catch {}
  }
  stopRunningDaemonProcesses();
  try {
    const cacheDir = path.join(targetDir, '.cache');
    if (fs.existsSync(cacheDir)) fs.rmSync(cacheDir, { recursive: true, force: true });
  } catch {}

  // 2. 在无后台守护进程干扰的纯净状态下，向打开的窗口发送一次禁用还原载荷，即时卸载样式并恢复英文原貌
  if (fs.existsSync(userConfigPath) && fs.existsSync(realDaemon)) {
    const origRaw = fs.readFileSync(userConfigPath, 'utf8');
    let temporarilyDisabled = false;
    try {
      const cfg = JSON.parse(origRaw);
      cfg.enabled = false;
      fs.writeFileSync(userConfigPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
      temporarilyDisabled = true;
      spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', realDaemon, '--once'], {
        stdio: 'ignore'
      });
    } finally {
      if (temporarilyDisabled) fs.writeFileSync(userConfigPath, origRaw, 'utf8');
    }
  }
  console.log('[Uninstall] Stopped daemon, removed LaunchAgent, and unloaded live styles. User config in ~/.gemini/antigravity/theme-patch/user/ is preserved.');
}

// ============================================================================
// 4. 路由分发
// ============================================================================
switch (subcommand) {
  case 'build-manifest': {
    const m = buildManifest(__dirname);
    console.log('Built core/manifest.json:', m.version, 'files:', Object.keys(m.files).length);
    break;
  }
  case 'pack': {
    const packed = buildDistZip(__dirname);
    console.log('Packed & verified dist archive:', packed.zipPath, `(verified ${packed.filesVerified} core files)`);
    break;
  }
  case 'doctor':
    await runDoctor();
    break;
  case 'install':
    await runInstall();
    break;
  case 'install-fonts':
    runInstallFonts();
    break;
  case 'verify':
    await runVerify();
    break;
  case 'rollback':
    await runRollback();
    break;
  case 'uninstall':
    await runUninstall();
    break;
  default:
    console.log(`Usage:
  node install.mjs install       [--channel auto|stable|insiders] [--preset high-contrast]
  node install.mjs install-fonts --from <font-folder-path>
  node install.mjs doctor        [--channel auto|stable|insiders]
  node install.mjs verify        [--safe-mode] [--channel auto|stable|insiders]
  node install.mjs rollback
  node install.mjs uninstall
  node install.mjs build-manifest
  node install.mjs pack`);
    break;
}
