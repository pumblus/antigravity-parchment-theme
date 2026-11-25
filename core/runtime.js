/**
 * chuanban-antigravity-theme-patch · Browser Runtime Engine (core/runtime.js)
 * 纯正浏览器端注入脚本（零模板字符串双重转义）。
 * 由 core/daemon.mjs 读取并将文件末尾的启动载荷占位符替换为实时配置与资源对象。
 */
(function runBoot(boot, fromDcl) {
  // 0. 顶层窗口隔离：仅允许主窗口与官方内置 Swarm 协作侧栏插件帧（绝不注入 Artifact / HTML 预览等子 iframe）
  const IS_SWARM_PLUGIN_FRAME = !!(
    window.location &&
    ((window.location.protocol === 'plugin:' && /^swarm--/i.test(window.location.hostname || '')) ||
      /^plugin:\/\/swarm--/i.test(String(window.location.href || '')))
  );
  if (window.top !== window && !IS_SWARM_PLUGIN_FRAME) return;
  if (!boot || typeof boot !== 'object') return;

  if (window.__ag_boot_dcl_handler) {
    try {
      window.removeEventListener('DOMContentLoaded', window.__ag_boot_dcl_handler);
    } catch (e) {}
    window.__ag_boot_dcl_handler = null;
  }
  if (window.__ag_boot_doc_observer) {
    try {
      window.__ag_boot_doc_observer.disconnect();
    } catch (e) {}
    window.__ag_boot_doc_observer = null;
  }

  const isPreloadHost = () => {
    if (IS_SWARM_PLUGIN_FRAME || (window.location && window.location.protocol === 'vscode-file:')) {
      return true;
    }
    if (window.__APP_CONFIG__ && window.__APP_CONFIG__.productName === 'antigravity') {
      return true;
    }
    return !!(
      window.electronNative &&
      ((typeof window.electronNative.setTitleBarOverlay === 'function' &&
        window.nativeStorage &&
        typeof window.nativeStorage.getItems === 'function') ||
        (typeof window.electronNative.getZoomLevel === 'function' &&
          window.electronNative.wcvBrowser &&
          typeof window.electronNative.wcvBrowser.setThemeColor === 'function'))
    );
  };

  const isAntigravityHost = () => {
    if (isPreloadHost()) return true;
    return !!(
      typeof document !== 'undefined' &&
      typeof document.querySelector === 'function' &&
      document.querySelector(
        'link[href*="/jetbox.css"], body[data-agy-theme], body[data-newux-theme], [id="antigravity.agentSidePanelInputBox"]'
      )
    );
  };

  const scheduleBootOnDcl = () => {
    if (typeof window.addEventListener !== 'function') return;
    window.__ag_boot_dcl_handler = () => {
      window.__ag_boot_dcl_handler = null;
      runBoot(boot, true);
    };
    window.addEventListener('DOMContentLoaded', window.__ag_boot_dcl_handler, { once: true });
  };

  if (typeof document === 'undefined' || !document.documentElement) {
    if (typeof document !== 'undefined') {
      // 主窗口 Preload 桥接已就绪但 <html> 尚未创建（NewDocument 0ms）：监听节点诞生微秒级瞬时挂载防闪白
      if (isPreloadHost() && typeof MutationObserver === 'function') {
        try {
          const obs = new MutationObserver(() => {
            if (document.documentElement) {
              try {
                obs.disconnect();
              } catch (e) {}
              window.__ag_boot_doc_observer = null;
              runBoot(boot, false);
            }
          });
          window.__ag_boot_doc_observer = obs;
          obs.observe(document, { childList: true });
        } catch (e) {}
      }
      if (!fromDcl && document.readyState === 'loading') {
        scheduleBootOnDcl();
      }
    }
    return;
  }

  if (!isAntigravityHost()) {
    if (!fromDcl && document.readyState === 'loading') {
      scheduleBootOnDcl();
      return;
    }
    window.__ag_skip_non_host = true;
    return;
  }

  if (window.__ag_skip_non_host) {
    try {
      delete window.__ag_skip_non_host;
    } catch (e) {
      window.__ag_skip_non_host = false;
    }
  }

  const PATCH_VERSION = boot.version || '20261123-v5.5.5-eric.1';
  const DETECTED_OS = 'darwin';
  const ENABLED = boot.enabled !== false;
  const CSS_TEXT = boot.cssText || '';
  const CUSTOM_CSS_TEXT = boot.customCss || '';
  const THEME_VARS = boot.themeVars && typeof boot.themeVars === 'object' ? boot.themeVars : {};
  const MODULES = Object.assign(
    {
      i18n: true,
      metrics: true,
      tokenAnalytics: true,
      composerWaxSeal: true,
      deadlockHealer: true,
      coldBootHealer: false,
      zoomShortcuts: true,
      customCss: true,
      customJs: true
    },
    boot.modules || {}
  );

  const DEFAULT_PRESET = boot.preset || 'high-contrast';
  const DEFAULT_EXCLUDE_I18N =
    'code, pre, kbd, samp, textarea, input, style, script, noscript, [contenteditable="true"], [data-markdown-root], [data-testid="user-message-content"], .agy-user-bubble, .monaco-editor, .monaco-diff-editor, .xterm, [class*="onyx-key"], .prose, .markdown, [class*="chat-message"], [class*="group/file-title"], [data-uri^="file:"], [data-uri^="vscode-"], a.inline-pill[href^="file:"], a.inline-pill[href^="vscode-"], [data-testid="conversation-row-sidebar"] a[href^="/c/"], [data-testid="conversation-row-sidebar"] span.truncate, [data-testid="conversation-row-history"] a[href^="/c/"], [data-testid="conversation-row-history"] span.truncate, [data-testid="conversation-navigator-turn"], .msg-body, #raw, [data-testid="swarm-raw"], #swarm-title, #ag-live-metrics-pill, .ag-live-metrics-pill, [data-ag-metrics-pill], #ag-live-metrics-tooltip, #ag-token-nav-section, #ag-token-analytics-panel, #ag-ta-tooltip, [data-ag-token-ui]';

  function cleanupTokenAnalyticsDom() {
    try {
      document.querySelectorAll('.settings-modal-container[data-ag-token-tab-active]').forEach((el) => {
        el.removeAttribute('data-ag-token-tab-active');
      });
      document.querySelectorAll('[data-ag-native-settings-scroll]').forEach((el) => {
        el.removeAttribute('data-ag-native-settings-scroll');
      });
      for (const id of ['ag-token-nav-section', 'ag-token-analytics-panel', 'ag-ta-tooltip']) {
        document.getElementById(id)?.remove();
      }
    } catch (e) {}
    for (const k of ['__ag_on_token_analytics', '__ag_open_token_analytics_tab', '__ag_sync_token_analytics_fn']) {
      try {
        delete window[k];
      } catch (e) {
        window[k] = null;
      }
    }
  }

  const SELECTORS = Object.assign(
    {
      inputBoxId: 'antigravity.agentSidePanelInputBox',
      branchPillInBox:
        '[data-testid="branch-pill-trigger"], [data-testid="project-branch-picker"], [data-testid="project-selector-trigger"], [data-testid="location-selector-trigger"], [aria-label^="Select project"], [aria-label^="选择项目"]',
      homeGreeting: '[data-testid="home-greeting"], [data-testid="home-splash-content"]',
      excludeI18n: DEFAULT_EXCLUDE_I18N
    },
    boot.selectors || {}
  );

  // Cancel callbacks captured by the previous payload before applying new module settings.
  if (window.__ag_zoom_timer != null) {
    clearTimeout(window.__ag_zoom_timer);
    window.__ag_zoom_timer = null;
  }

  const coldBootGeneration = Symbol('cold-boot-payload');
  window.__ag_coldboot_generation = coldBootGeneration;
  window.__ag_commit_coldboot_reload = null;
  if (window.__ag_self_zoom_timer != null) clearTimeout(window.__ag_self_zoom_timer);
  window.__ag_self_zoom_timer = null;
  window.__ag_self_zooming = false;

  // 执行上一轮 user/custom.js 或内部注册的生命周期清理函数（防止热重载或卸载逃逸）
  if (Array.isArray(window.__ag_cleanup_fns) && window.__ag_cleanup_fns.length > 0) {
    const prevCleanups = window.__ag_cleanup_fns.splice(0, window.__ag_cleanup_fns.length);
    for (let i = 0; i < prevCleanups.length; i++) {
      try {
        if (typeof prevCleanups[i] === 'function') prevCleanups[i]();
      } catch (e) {}
    }
  }
  window.__ag_cleanup_fns = [];
  if (window.__ag_metrics_ro) {
    try {
      window.__ag_metrics_ro.disconnect();
    } catch (e) {}
    window.__ag_metrics_ro = null;
    window.__ag_metrics_ro_target = null;
    window.__ag_metrics_ro_observed = null;
    window.__ag_last_metrics_layout_sig = '';
  }
  if (window.__ag_metrics_raf) {
    try {
      cancelAnimationFrame(window.__ag_metrics_raf);
    } catch (e) {}
    window.__ag_metrics_raf = 0;
  }
  window.__ag_watched_cascade_sig = undefined;
  try {
    document.querySelectorAll('#ag-live-metrics-pill, .ag-live-metrics-pill, [data-ag-metrics-pill]').forEach((el) => {
      el.remove();
    });
    const staleTt = document.getElementById('ag-live-metrics-tooltip');
    if (staleTt) {
      staleTt.remove();
    }
    cleanupTokenAnalyticsDom();
  } catch (e) {}

  if (window.__ag_dcl_handler) {
    try {
      window.removeEventListener('DOMContentLoaded', window.__ag_dcl_handler);
    } catch (e) {}
    window.__ag_dcl_handler = null;
  }
  if (window.__ag_user_231_observer) {
    try {
      window.__ag_user_231_observer.disconnect();
    } catch (e) {}
    window.__ag_user_231_observer = null;
  }
  if (window.__ag_coldboot_timer) {
    try {
      clearTimeout(window.__ag_coldboot_timer);
    } catch (e) {}
    window.__ag_coldboot_timer = null;
  }

  if (window.__ag_metrics_tt_hide_timer) clearTimeout(window.__ag_metrics_tt_hide_timer);
  window.__ag_metrics_tt_hide_timer = null;

  // 全局持久化的原始英文文本映射表（支持 i18n.override.json 热重载增删改与一键还原）
  if (!window.__ag_orig_text_map) {
    window.__ag_orig_text_map = new WeakMap();
  }
  const origTextMap = window.__ag_orig_text_map;

  function restoreAllTranslations(root = document.body) {
    if (!root) return;
    try {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const rec = origTextMap.get(node);
        if (rec) {
          if (node.nodeValue === rec.lastVal) {
            node.nodeValue = rec.origRaw;
          }
          origTextMap.delete(node);
        }
      }
      const attrNames = ['title', 'placeholder', 'aria-label'];
      const attrEls = root.querySelectorAll
        ? root.querySelectorAll(
            '[data-ag-orig-title], [data-ag-orig-title-last], [data-ag-orig-placeholder], [data-ag-orig-placeholder-last], [data-ag-orig-aria-label], [data-ag-orig-aria-label-last]'
          )
        : [];
      for (let i = 0; i < attrEls.length; i++) {
        const el = attrEls[i];
        for (let j = 0; j < attrNames.length; j++) {
          const attr = attrNames[j];
          const origAttr = 'data-ag-orig-' + attr;
          const lastAttr = origAttr + '-last';
          if (el.hasAttribute(origAttr) || el.hasAttribute(lastAttr)) {
            const savedOrig = el.getAttribute(origAttr);
            const savedLast = el.getAttribute(lastAttr);
            const cur = el.getAttribute(attr);
            if (savedOrig !== null && (savedLast === null || cur === savedLast)) {
              el.setAttribute(attr, savedOrig);
            }
            el.removeAttribute(origAttr);
            el.removeAttribute(lastAttr);
            delete el['__ag_attr_ver_' + attr];
          }
        }
        delete el.__ag_attr_ver;
      }
    } catch (e) {}
  }

  function applyThemeVars(varsObj) {
    // 清理早期版本遗留的内联 style 属性，避免压制 body.dark 或被原生 iY() 冲掉
    const prevKeys = Array.isArray(window.__ag_applied_theme_vars) ? window.__ag_applied_theme_vars : [];
    for (let i = 0; i < prevKeys.length; i++) {
      const k = prevKeys[i];
      document.documentElement.style.removeProperty(k);
      if (document.body) document.body.style.removeProperty(k);
    }
    window.__ag_applied_theme_vars = [];

    const keys = Object.keys(varsObj || {});
    const globalDecls = [];
    const lightDecls = [];
    const darkDecls = [];

    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const v = varsObj[k];
      if (!k.startsWith('--') || v === null || v === undefined || String(v).trim() === '') continue;
      const cleanVal = String(v).trim().replace(/[;{}]/g, '');
      if (k.startsWith('--ag-dark-')) {
        darkDecls.push(`${k}: ${cleanVal} !important;`);
      } else if (k.startsWith('--ag-')) {
        globalDecls.push(`${k}: ${cleanVal} !important;`);
      } else {
        lightDecls.push(`${k}: ${cleanVal} !important;`);
      }
    }

    let varStyle = document.getElementById('ag-user-theme-vars');
    if (globalDecls.length === 0 && lightDecls.length === 0 && darkDecls.length === 0) {
      if (varStyle) {
        varStyle.remove();
        window.__ag_style_rev = (window.__ag_style_rev || 0) + 1;
      }
    } else {
      const head = document.head || document.getElementsByTagName('head')[0] || document.documentElement;
      if (!varStyle) {
        varStyle = document.createElement('style');
        varStyle.id = 'ag-user-theme-vars';
      }
      if (head) {
        const customStyleEl = document.getElementById('antigravity-user-custom-style');
        if (customStyleEl && customStyleEl.parentNode === head) {
          head.insertBefore(varStyle, customStyleEl);
        } else if (varStyle.parentNode !== head) {
          head.appendChild(varStyle);
        }
      }
      const blocks = [];
      if (globalDecls.length > 0) {
        blocks.push(
          `:root, html[data-ag-os][data-ag-wax-seal]:not([data-ag-disabled]), html[data-ag-os][data-ag-wax-seal]:not([data-ag-disabled]) body { ${globalDecls.join(' ')} }`
        );
      }
      if (lightDecls.length > 0) {
        blocks.push(
          `html[data-ag-os][data-ag-wax-seal]:not([data-ag-theme-mode="dark"]):not(:has(> body.dark)), html[data-ag-os][data-ag-wax-seal]:not([data-ag-theme-mode="dark"]) body:not(.dark) { ${lightDecls.join(' ')} }`
        );
      }
      if (darkDecls.length > 0) {
        blocks.push(
          `html[data-ag-os][data-ag-wax-seal]:not([data-ag-disabled])[data-ag-theme-mode="dark"], html[data-ag-os][data-ag-wax-seal]:not([data-ag-disabled])[data-ag-theme-mode="dark"] body, html[data-ag-os][data-ag-wax-seal]:not([data-ag-disabled]):has(> body.dark), html[data-ag-os][data-ag-wax-seal]:not([data-ag-disabled]) body.dark { ${darkDecls.join(' ')} }`
        );
      }
      const nextCss = blocks.join('\n');
      if (varStyle.textContent !== nextCss) {
        varStyle.textContent = nextCss;
        window.__ag_style_rev = (window.__ag_style_rev || 0) + 1;
      }
    }

    if (varsObj && varsObj['--ag-chat-font-size']) {
      document.documentElement.setAttribute('data-ag-custom-font-size', 'true');
    } else {
      document.documentElement.removeAttribute('data-ag-custom-font-size');
    }
  }

  // Antigravity 2.31.2+ BaseWindow + curtainView 底色同步与宿主内联色彩亮度解析
  function parseColorToRgb(rawColor, requireOpaque = false) {
    const s = String(rawColor || '').trim();
    if (!s) return null;
    if (/^#[0-9a-fA-F]{6}$/.test(s)) {
      return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
    }
    if (/^#[0-9a-fA-F]{3}$/.test(s)) {
      return [parseInt(s[1] + s[1], 16), parseInt(s[2] + s[2], 16), parseInt(s[3] + s[3], 16)];
    }
    const mRgb = s.match(/^rgba?\(\s*([\d.]+%?)\s*[,\s]\s*([\d.]+%?)\s*[,\s]\s*([\d.]+%?)(?:\s*[,/]\s*([\d.%]+))?\s*\)$/i);
    if (mRgb) {
      if (mRgb[4] !== undefined) {
        const a = mRgb[4].endsWith('%') ? parseFloat(mRgb[4]) / 100 : parseFloat(mRgb[4]);
        if (!Number.isFinite(a) || (requireOpaque && a < 1)) return null;
      }
      const c255 = (v) =>
        Math.max(0, Math.min(255, Math.round(v.endsWith('%') ? parseFloat(v) * 2.55 : Number(v))));
      return [c255(mRgb[1]), c255(mRgb[2]), c255(mRgb[3])];
    }
    const mSrgb = s.match(/^color\(\s*srgb\s+([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+%?)(?:\s*\/\s*([\d.%]+))?\s*\)$/i);
    if (mSrgb) {
      if (mSrgb[4] !== undefined) {
        const a = mSrgb[4].endsWith('%') ? parseFloat(mSrgb[4]) / 100 : parseFloat(mSrgb[4]);
        if (!Number.isFinite(a) || (requireOpaque && a < 1)) return null;
      }
      const f255 = (v) =>
        Math.max(0, Math.min(255, Math.round(v.endsWith('%') ? parseFloat(v) * 2.55 : parseFloat(v) * 255)));
      return [f255(mSrgb[1]), f255(mSrgb[2]), f255(mSrgb[3])];
    }
    return null;
  }

  function parseColorToHex6(rawColor) {
    const rgb = parseColorToRgb(rawColor, true);
    if (!rgb) return null;
    const h2 = (v) => v.toString(16).padStart(2, '0');
    return ('#' + h2(rgb[0]) + h2(rgb[1]) + h2(rgb[2])).toUpperCase();
  }

  function computeColorLuminance(rawColor) {
    const rgb = parseColorToRgb(rawColor, false);
    if (!rgb) return null;
    return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
  }

  let colorProbeCanvasCtx = null;
  function parseCssColorViaCanvasHex6(rawColor) {
    if (!rawColor || typeof document === 'undefined') return null;
    try {
      if (!colorProbeCanvasCtx) {
        const c = document.createElement('canvas');
        c.width = 1;
        c.height = 1;
        colorProbeCanvasCtx = c.getContext('2d', { willReadFrequently: true });
      }
      if (!colorProbeCanvasCtx) return null;
      colorProbeCanvasCtx.clearRect(0, 0, 1, 1);
      colorProbeCanvasCtx.fillStyle = 'rgba(0, 0, 0, 0)';
      colorProbeCanvasCtx.fillStyle = rawColor;
      colorProbeCanvasCtx.fillRect(0, 0, 1, 1);
      const d = colorProbeCanvasCtx.getImageData(0, 0, 1, 1).data;
      if (!d || d[3] < 242) return null;
      const h2 = (v) => v.toString(16).padStart(2, '0');
      return ('#' + h2(d[0]) + h2(d[1]) + h2(d[2])).toUpperCase();
    } catch (e) {
      return null;
    }
  }

  function resolveCssColorToHex6(propName, targetEl, fallbackHex) {
    try {
      const el = targetEl || document.body || document.documentElement;
      if (!el || typeof getComputedStyle !== 'function') return fallbackHex;
      const cs = getComputedStyle(el);
      let cur = (cs.getPropertyValue(propName) || '').trim();
      let hex = parseColorToHex6(cur);
      for (let depth = 0; depth < 4 && !hex && cur && cur.includes('var('); depth++) {
        cur = cur
          .replace(/var\(\s*(--[A-Za-z0-9_-]+)(?:\s*,\s*([^)]+))?\s*\)/g, (_, vName, fb) => {
            return (cs.getPropertyValue(vName) || fb || '').trim();
          })
          .trim();
        hex = parseColorToHex6(cur);
      }
      if (!hex && cur && !cur.includes('var(')) {
        hex = parseCssColorViaCanvasHex6(cur);
      }
      if (!hex && cur) {
        const host = document.head || document.documentElement;
        if (host) {
          const probe = document.createElement('span');
          probe.style.cssText =
            'position:fixed!important;left:-9999px!important;top:-9999px!important;pointer-events:none!important;display:none!important;';
          probe.style.setProperty('color', cur.includes('var(') ? `var(${propName})` : cur, 'important');
          host.appendChild(probe);
          try {
            const resolved = getComputedStyle(probe).color;
            hex = parseColorToHex6(resolved) || parseCssColorViaCanvasHex6(resolved);
          } finally {
            probe.remove();
          }
        }
      }
      return hex || fallbackHex;
    } catch (e) {
      return fallbackHex;
    }
  }

  function syncCurtainSurfaceColor(force = false) {
    if (IS_SWARM_PLUGIN_FRAME) return;
    try {
      const setThemeColor = window.electronNative?.wcvBrowser?.setThemeColor;
      if (typeof setThemeColor !== 'function') return;
      const targetEl = document.body || document.documentElement;
      if (!targetEl || typeof getComputedStyle !== 'function') return;
      const cs = getComputedStyle(targetEl);
      let hex = resolveCssColorToHex6('--background', targetEl, null);
      if (!hex) {
        hex = parseColorToHex6(cs.backgroundColor);
      }
      if (!hex) return;
      // Keep a single queue across reinjections. A disable/restore request must run
      // after an older in-flight theme write, never race it to the native surface.
      const state = window.__ag_curtain_write_state ||
        (window.__ag_curtain_write_state = { inFlight: false, pending: null });
      state.pending = { hex, force, write: () => setThemeColor.call(window.electronNative.wcvBrowser, hex) };
      const drain = () => {
        if (state.inFlight || !state.pending) return;
        const request = state.pending;
        state.pending = null;
        if (!request.force && window.__ag_last_curtain_hex === request.hex) return;
        state.inFlight = true;
        Promise.resolve().then(request.write).then(
          () => { window.__ag_last_curtain_hex = request.hex; },
          () => { window.__ag_last_curtain_hex = null; }
        ).finally(() => {
          state.inFlight = false;
          drain();
        });
      };
      drain();
    } catch (e) {}
  }

  // 若用户在 user/config.json 中将 enabled 设为 false，执行无损卸载还原
  if (!ENABLED) {
    // A queued ResizeObserver frame must not resurrect the pill after teardown.
    if (window.__ag_metrics_raf) cancelAnimationFrame(window.__ag_metrics_raf);
    window.__ag_metrics_raf = 0;
    window.__ag_ensure_metrics_pill_fn = null;
    window.__ag_render_metrics = null;
    const s1 = document.getElementById('ag-custom-fonts');
    if (s1) s1.remove();
    const s2 = document.getElementById('antigravity-user-custom-style');
    if (s2) s2.remove();
    document.querySelectorAll('#ag-live-metrics-pill, .ag-live-metrics-pill, [data-ag-metrics-pill]').forEach(el => el.remove());
    document.querySelectorAll('[data-ag-row-mode]').forEach(el => el.removeAttribute('data-ag-row-mode'));
    window.__ag_active_tooltip_pill = null;
    window.__ag_pill_tooltip_map = null;
    window.__ag_metrics_by_id = null;
    window.__ag_watched_cascade_ids = [];
    window.__ag_watched_cascade_id = '';
    window.__ag_watched_cascade_sig = '';
    window.__ag_last_metrics = null;
    cleanupTokenAnalyticsDom();
    window.__ag_check_route_fn = null;
    window.__ag_trigger_route_check_fn = null;
    window.__agRequestMetrics?.('[]');
    const tt = document.getElementById('ag-live-metrics-tooltip');
    if (tt) tt.remove();
    if (window.__ag_i18n_observer) {
      try {
        window.__ag_i18n_observer.disconnect();
      } catch (e) {}
      window.__ag_i18n_observer = null;
    }
    if (window.__ag_user_231_observer) {
      try {
        window.__ag_user_231_observer.disconnect();
      } catch (e) {}
      window.__ag_user_231_observer = null;
    }
    if (window.__ag_metrics_ro) {
      try {
        window.__ag_metrics_ro.disconnect();
      } catch (e) {}
      window.__ag_metrics_ro = null;
      window.__ag_metrics_ro_target = null;
      window.__ag_metrics_ro_observed = null;
      window.__ag_last_metrics_layout_sig = '';
    }
    if (window.__ag_metrics_route_watcher) {
      try {
        clearInterval(window.__ag_metrics_route_watcher);
      } catch (e) {}
      window.__ag_metrics_route_watcher = null;
    }
    if (window.__ag_theme_mode_observer) {
      try {
        window.__ag_theme_mode_observer.disconnect();
      } catch (e) {}
      window.__ag_theme_mode_observer = null;
    }
    if (window.__ag_mql_cleanup) {
      try {
        window.__ag_mql_cleanup();
      } catch (e) {}
      window.__ag_mql_cleanup = null;
    }
    if (window.__ag_zoom_timer) {
      try {
        clearTimeout(window.__ag_zoom_timer);
      } catch (e) {}
      window.__ag_zoom_timer = null;
    }
    if (window.__ag_self_zoom_timer) {
      try {
        clearTimeout(window.__ag_self_zoom_timer);
      } catch (e) {}
      window.__ag_self_zoom_timer = null;
    }
    window.__ag_self_zooming = false;
    window.__ag_zoom_keydown_fn = null;
    window.__ag_zoom_resize_fn = null;
    window.__ag_settings_click_fn = null;
    window.__ag_sync_preset_fn = null;
    window.__ag_host_theme_mode = null;
    window.__ag_set_host_theme_mode = null;
    window.__ag_resolved_theme_mode = null;
    window.__ag_last_surface_sync_key = '';
    window.__ag_body_ready = false;
    applyThemeVars({});
    document.documentElement.removeAttribute('data-ag-preset');
    document.documentElement.removeAttribute('data-ag-theme-mode');
    document.documentElement.removeAttribute('data-ag-page-type');
    document.documentElement.removeAttribute('data-ag-wax-seal');
    document.documentElement.removeAttribute('data-ag-os');
    const restoreNativeSurfaces = () => {
      syncCurtainSurfaceColor(true);
      if (IS_SWARM_PLUGIN_FRAME) {
        const saved = window.__ag_swarm_surface;
        const html = document.documentElement;
        if (saved && html) {
          // Restore only values still owned by us; never overwrite a newer native update.
          if (html.getAttribute('data-theme') === saved.appliedTheme) {
            if (saved.theme === null) html.removeAttribute('data-theme');
            else html.setAttribute('data-theme', saved.theme);
          }
          if (html.style.getPropertyValue('color-scheme') === saved.appliedScheme) {
            if (saved.scheme) html.style.setProperty('color-scheme', saved.scheme, saved.schemePriority);
            else html.style.removeProperty('color-scheme');
          }
        }
        delete window.__ag_swarm_surface;
      }
    };
    restoreAllTranslations(document.body);
    restoreNativeSurfaces();
    if (!document.body && typeof document.addEventListener === 'function') {
      if (window.__ag_disabled_dcl_fn) {
        document.removeEventListener('DOMContentLoaded', window.__ag_disabled_dcl_fn);
      }
      window.__ag_disabled_dcl_fn = () => {
        window.__ag_disabled_dcl_fn = null;
        restoreAllTranslations(document.body);
        restoreNativeSurfaces();
      };
      document.addEventListener('DOMContentLoaded', window.__ag_disabled_dcl_fn, { once: true });
    }
    window.__ag_patch_version = PATCH_VERSION + '-disabled';
    return;
  }

  if (window.__ag_disabled_dcl_fn && typeof document.removeEventListener === 'function') {
    document.removeEventListener('DOMContentLoaded', window.__ag_disabled_dcl_fn);
    window.__ag_disabled_dcl_fn = null;
  }

  // ============================================================================
  // 1. 注入更纱黑体与主题样式（#ag-custom-fonts -> #ag-user-theme-vars -> #antigravity-user-custom-style）
  // ============================================================================
  const headTarget = document.head || document.getElementsByTagName('head')[0] || document.documentElement;

  let style = document.getElementById('ag-custom-fonts');
  if (!style) {
    style = document.createElement('style');
    style.id = 'ag-custom-fonts';
    if (headTarget) headTarget.appendChild(style);
  }
  if (style && style.textContent !== CSS_TEXT) {
    style.textContent = CSS_TEXT;
    window.__ag_style_rev = (window.__ag_style_rev || 0) + 1;
  }

  document.documentElement.setAttribute('data-ag-wax-seal', MODULES.composerWaxSeal === false ? 'off' : 'on');
  const detectedOs = DETECTED_OS;
  document.documentElement.setAttribute('data-ag-os', detectedOs);
  applyThemeVars(THEME_VARS);

  let userStyle = document.getElementById('antigravity-user-custom-style');
  if (MODULES.customCss && CUSTOM_CSS_TEXT.trim()) {
    if (!userStyle) {
      userStyle = document.createElement('style');
      userStyle.id = 'antigravity-user-custom-style';
      if (headTarget) headTarget.appendChild(userStyle);
    }
    if (userStyle.textContent !== CUSTOM_CSS_TEXT) {
      userStyle.textContent = CUSTOM_CSS_TEXT;
      window.__ag_style_rev = (window.__ag_style_rev || 0) + 1;
    }
  } else if (userStyle) {
    userStyle.remove();
    window.__ag_style_rev = (window.__ag_style_rev || 0) + 1;
  }

  function ensureStylesAtEndOfHead() {
    const h = document.head || document.getElementsByTagName('head')[0];
    if (!h) return;
    const base = document.getElementById('ag-custom-fonts');
    if (!base) return;
    let needsMove = base.parentNode !== h;
    if (!needsMove) {
      for (let sib = base.nextElementSibling; sib; sib = sib.nextElementSibling) {
        if (
          sib.id !== 'ag-user-theme-vars' &&
          sib.id !== 'antigravity-user-custom-style' &&
          (sib.tagName === 'LINK' || sib.tagName === 'STYLE')
        ) {
          needsMove = true;
          break;
        }
      }
    }
    if (needsMove) {
      for (const id of ['ag-custom-fonts', 'ag-user-theme-vars', 'antigravity-user-custom-style']) {
        const el = document.getElementById(id);
        if (el) h.appendChild(el);
      }
    }
  }
  ensureStylesAtEndOfHead();

  // ============================================================================
  // 2. 防死锁守护：Antigravity 原生 TanStack Router 缺陷修复（支持热重载更新回调）
  // ============================================================================
  window.__ag_settings_click_fn = (e) => {
    if (IS_SWARM_PLUGIN_FRAME || MODULES.deadlockHealer === false) return;
    const btn = e.target && e.target.closest && e.target.closest('[data-testid="settings-button"]');
    if (!btn) return;

    const hasDialog = !!document.querySelector('[role="dialog"]');
    const urlHasSettings = window.location.search.includes('settingsOpen=true');

    if (!hasDialog && urlHasSettings) {
      const url = new URL(window.location.href);
      url.searchParams.delete('settingsOpen');
      url.searchParams.delete('settingsScreen');
      window.history.replaceState(window.history.state, '', url.toString());
    }
  };

  if (!IS_SWARM_PLUGIN_FRAME && !window.__ag_settings_guard_installed) {
    window.__ag_settings_guard_installed = true;
    document.addEventListener(
      'click',
      (e) => {
        if (typeof window.__ag_settings_click_fn === 'function') {
          window.__ag_settings_click_fn(e);
        }
      },
      true
    );
  }

  // ============================================================================
  // 2.05 冷启动内嵌兜底包漂移安全自愈（HEAD ETag 零流量比对 + 六重空输入/零交互安全门禁）
  // ============================================================================
  if (
    !IS_SWARM_PLUGIN_FRAME &&
    window.top === window &&
    MODULES.deadlockHealer !== false &&
    MODULES.coldBootHealer === true &&
    /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(String(window.location.origin || ''))
  ) {
    const markUserDirty = () => {
      window.__ag_user_interacted_dirty = true;
      if (window.__ag_coldboot_timer) {
        try {
          clearTimeout(window.__ag_coldboot_timer);
        } catch (e) {}
        window.__ag_coldboot_timer = null;
      }
    };

    if (!window.__ag_user_dirty_guard_installed) {
      window.__ag_user_dirty_guard_installed = true;
      const PURE_MOD_KEYS = new Set(['Meta', 'Control', 'Alt', 'Shift', 'CapsLock', 'NumLock', 'ScrollLock', 'Fn']);
      document.addEventListener(
        'keydown',
        (e) => {
          const k = String(e.key || '');
          if (PURE_MOD_KEYS.has(k)) return;
          if ((e.metaKey || e.ctrlKey) && !e.altKey && (k === '-' || k === '_' || k === '=' || k === '+' || k === '0')) {
            return;
          }
          markUserDirty();
        },
        { capture: true, passive: true }
      );
      for (const evtName of ['paste', 'drop', 'compositionstart', 'input']) {
        document.addEventListener(evtName, markUserDirty, { capture: true, passive: true });
      }
    }

    const readSessionHealedFlag = () => {
      try {
        return window.sessionStorage.getItem('__ag_coldboot_bundle_healed') === '1';
      } catch (e) {
        return true;
      }
    };

    const isWindowUntouchedAndIdleForColdHeal = () => {
      if (!ENABLED || MODULES.deadlockHealer === false || MODULES.coldBootHealer !== true) return false;
      if (window.__ag_coldboot_generation !== coldBootGeneration) return false;
      if (window.__ag_user_interacted_dirty) return false;
      // Never refresh a background window or a conversation with potentially unseen state.
      if (document.hidden || !document.hasFocus() || window.location.pathname !== '/') return false;
      if (document.activeElement?.matches?.('input, textarea, [contenteditable], [data-lexical-editor]')) return false;
      if (typeof performance === 'undefined' || typeof performance.now !== 'function' || performance.now() >= 25000) {
        return false;
      }
      if (readSessionHealedFlag()) return false;
      // Empty text is not proof of an empty draft: attachments and queued sends count too.
      if (document.querySelector('[data-testid*="attachment"], [data-testid*="queued-message"], [contenteditable] img, [contenteditable] video, [contenteditable] audio')) return false;
      for (const fileInput of document.querySelectorAll('input[type="file"]')) {
        if (fileInput.files && fileInput.files.length) return false;
      }
      if (
        document.querySelector(
          '[role="dialog"], [role="alertdialog"], [aria-modal="true"], [role="menu"], [data-state="open"], [data-testid="input-cancel-button"], [data-testid*="running-"], button[aria-label="Stop execution"], button[aria-label="停止执行"], button[aria-label*="Cancel ("], button[aria-label*="取消生成"]'
        )
      ) {
        return false;
      }
      const editableList = document.querySelectorAll(
        '[data-lexical-editor="true"], [contenteditable="true"], textarea, input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="file"])'
      );
      for (let i = 0; i < editableList.length; i++) {
        const el = editableList[i];
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
          if (el.tagName === 'INPUT') {
            const itype = String(el.type || '').toLowerCase();
            if (
              itype === 'hidden' ||
              itype === 'checkbox' ||
              itype === 'radio' ||
              itype === 'range' ||
              itype === 'color' ||
              itype === 'button' ||
              itype === 'submit' ||
              itype === 'reset' ||
              itype === 'file'
            ) {
              continue;
            }
          }
          if (String(el.value || '').trim() !== '') return false;
        } else {
          const txt = String(el.textContent || '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
          if (txt !== '') return false;
        }
      }
      return true;
    };

    const resolveInitialMainBundleSize = () => {
      try {
        if (typeof performance.getEntriesByType === 'function') {
          const allMain = performance
            .getEntriesByType('resource')
            .filter((e) => /\/main\.js(?:\?|$)/.test(String(e.name || '')));
          // 优先读取 <script src="/main.js"> 条目，排除本自愈器发起的 0 字节 HEAD fetch 条目防止二次复检自锁
          const scriptEntries = allMain.filter(
            (e) =>
              e.initiatorType === 'script' &&
              ((Number(e.decodedBodySize) || 0) > 0 || (Number(e.encodedBodySize) || 0) > 0)
          );
          const nonZeroEntries =
            scriptEntries.length > 0
              ? scriptEntries
              : allMain.filter(
                  (e) =>
                    e.initiatorType !== 'fetch' &&
                    ((Number(e.decodedBodySize) || 0) > 0 || (Number(e.encodedBodySize) || 0) > 0)
                );
          if (nonZeroEntries.length > 0) {
            const picked = nonZeroEntries[nonZeroEntries.length - 1];
            const sizeObj = {
              decoded: Number(picked.decodedBodySize) || 0,
              encoded: Number(picked.encodedBodySize) || 0
            };
            window.__ag_coldboot_initial_main_size = sizeObj;
            return sizeObj;
          }
        }
      } catch (e) {}
      if (
        window.__ag_coldboot_initial_main_size &&
        (window.__ag_coldboot_initial_main_size.decoded > 0 || window.__ag_coldboot_initial_main_size.encoded > 0)
      ) {
        return window.__ag_coldboot_initial_main_size;
      }
      return { decoded: 0, encoded: 0 };
    };

    // 模块初始化时即捕获初始 script 体积快照，免疫后续 ResourceTiming 250 条环形缓冲淘汰与 HEAD 探测干扰
    resolveInitialMainBundleSize();

    const probeColdBootBundleDrift = async (attempt) => {
      window.__ag_coldboot_timer = null;
      if (!isWindowUntouchedAndIdleForColdHeal()) {
        window.__ag_coldboot_probe_done = true;
        window.__ag_coldboot_healer_state = { probeDone: true, drifted: false, skippedReason: 'gate-blocked' };
        return;
      }
      try {
        const initSize = resolveInitialMainBundleSize();
        const loadedDecoded = initSize.decoded;
        const loadedEncoded = initSize.encoded;
        if (loadedDecoded <= 0 && loadedEncoded <= 0) {
          window.__ag_coldboot_probe_done = true;
          window.__ag_coldboot_healer_state = { probeDone: true, drifted: false, skippedReason: 'no-perf-entry' };
          return;
        }

        const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
        const abortTimer = ctrl ? setTimeout(() => ctrl.abort(), 2500) : null;
        let res = null;
        try {
          res = await fetch('/main.js', {
            method: 'HEAD',
            cache: 'no-store',
            signal: ctrl ? ctrl.signal : undefined
          });
        } finally {
          if (abortTimer) clearTimeout(abortTimer);
        }
        if (!res || !res.ok) {
          window.__ag_coldboot_probe_done = true;
          window.__ag_coldboot_healer_state = { probeDone: true, drifted: false, skippedReason: 'head-failed' };
          return;
        }

        const etag = String(res.headers.get('etag') || '').trim();
        const mEtag = etag.match(/^(?:W\/)?"([0-9a-f]+)-[0-9a-f]+"$/i);
        const serverDecoded = mEtag ? parseInt(mEtag[1], 16) : 0;
        const serverEncoded = Number(res.headers.get('content-length')) || 0;

        let hasDrift = false;
        if (serverDecoded > 0 && loadedDecoded > 0) {
          hasDrift = Math.abs(serverDecoded - loadedDecoded) > 1024;
        } else if (serverEncoded > 0 && loadedEncoded > 0) {
          hasDrift = Math.abs(serverEncoded - loadedEncoded) > 1024;
        }

        if (!isWindowUntouchedAndIdleForColdHeal()) {
          window.__ag_coldboot_probe_done = true;
          window.__ag_coldboot_healer_state = {
            probeDone: true,
            loadedDecoded,
            serverDecoded,
            drifted: hasDrift,
            skippedReason: 'dirty-after-head'
          };
          return;
        }

        if (hasDrift) {
          window.__ag_coldboot_probe_done = true;
          window.__ag_coldboot_healer_state = {
            probeDone: true,
            loadedDecoded,
            serverDecoded,
            drifted: true,
            reloadRequested: true
          };
          // Daemon acknowledges in this same execution context. The final safety check
          // and reload stay synchronous on the page, avoiding a CDP Page.reload race.
          if (typeof window.__agRequestHardReload !== 'function' || !window.crypto?.randomUUID) return;
          const token = window.crypto.randomUUID();
          window.__ag_commit_coldboot_reload = (candidate) => {
            if (candidate !== token || !isWindowUntouchedAndIdleForColdHeal()) return false;
            try { window.sessionStorage.setItem('__ag_coldboot_bundle_healed', '1'); }
            catch (e) { return false; }
            window.__ag_commit_coldboot_reload = null;
            window.location.reload();
            return true;
          };
          window.__agRequestHardReload(JSON.stringify({ token }));
          return;
        }

        const hasRemoteTrigger = !!document.querySelector(
          '[data-testid="project-selector-this-machine-trigger"], [data-testid="location-selector-trigger"]'
        );
        if (attempt === 1 && !hasRemoteTrigger && performance.now() < 16000) {
          window.__ag_coldboot_healer_state = {
            probeDone: false,
            attempt: 1,
            loadedDecoded,
            serverDecoded,
            drifted: false
          };
          window.__ag_coldboot_timer = setTimeout(() => {
            probeColdBootBundleDrift(2);
          }, 5500);
          return;
        }

        window.__ag_coldboot_probe_done = true;
        window.__ag_coldboot_healer_state = {
          probeDone: true,
          attempt,
          loadedDecoded,
          serverDecoded,
          drifted: false
        };
      } catch (e) {
        window.__ag_coldboot_probe_done = true;
        window.__ag_coldboot_healer_state = { probeDone: true, drifted: false, skippedReason: 'exception' };
      }
    };

    if (!window.__ag_coldboot_probe_done && isWindowUntouchedAndIdleForColdHeal() && performance.now() < 20000) {
      const delayMs = Math.max(1500, Math.round(5800 - Math.min(4300, performance.now())));
      window.__ag_coldboot_healer_state = { armed: true, delayMs, probeDone: false };
      window.__ag_coldboot_timer = setTimeout(() => {
        probeColdBootBundleDrift(1);
      }, delayMs);
    } else if (!window.__ag_coldboot_healer_state) {
      window.__ag_coldboot_healer_state = {
        armed: false,
        probeDone: true,
        skippedReason: performance.now() >= 20000 ? 'warm-window' : 'gate-blocked'
      };
    }
  }

  // ============================================================================
  // 2.1 缩放快捷键修复与 2.31.2 macOS 原生菜单快捷键防双倍缩放保护（兼容 Numpad 与欧式键盘）
  // ============================================================================
  try {
    const initZoom = window.electronNative?.getZoomLevel?.();
    if (typeof initZoom === 'number' && typeof window.__ag_settled_zoom !== 'number') {
      window.__ag_settled_zoom = initZoom;
    }
  } catch (e) {}

  window.__ag_zoom_resize_fn = () => {
    const native = window.electronNative;
    if (!native || typeof native.getZoomLevel !== 'function') return;
    try {
      const cur = native.getZoomLevel();
      if (typeof cur === 'number') {
        if (window.__ag_self_zooming) {
          window.__ag_settled_zoom = cur;
          return;
        }
        if (typeof window.__ag_settled_zoom === 'number' && Math.abs(cur - window.__ag_settled_zoom) > 0.003) {
          window.__ag_last_ext_zoom_ts = typeof performance !== 'undefined' ? performance.now() : Date.now();
        }
        window.__ag_settled_zoom = cur;
      }
    } catch (e) {}
  };

  window.__ag_zoom_keydown_fn = (e) => {
    if (MODULES.zoomShortcuts === false || MODULES.deadlockHealer === false) return;
    if (e.isComposing) return;
    const modKey = e.metaKey && !e.ctrlKey;
    if (!modKey || e.altKey) return;

    const k = String(e.key || '');
    const isCjkImeKey =
      k === 'Process' || k === 'Unidentified' || /[\uFF00-\uFFEF\u3000-\u303F]/.test(k);

    let action = null;
    if (
      k === '-' ||
      k === '_' ||
      e.code === 'NumpadSubtract' ||
      (!e.shiftKey && e.code === 'Minus' && isCjkImeKey)
    ) {
      action = 'out';
    } else if (
      k === '=' ||
      k === '+' ||
      e.code === 'NumpadAdd' ||
      (e.code === 'Equal' && isCjkImeKey)
    ) {
      action = 'in';
    } else if (!e.shiftKey && (k === '0' || e.code === 'Numpad0' || (e.code === 'Digit0' && isCjkImeKey))) {
      action = 'reset';
    }
    if (!action) return;

    // Swarm 子帧内：当 e.key 非宿主 sidecar-key-event 直接识别的 '+'/'='/'-'/'0'（如 Numpad0 'Insert'、'_'、中文输入法 'Process'/全角符号）时归一化转发
    if (IS_SWARM_PLUGIN_FRAME) {
      if (k !== '+' && k !== '=' && k !== '-' && k !== '0' && window.parent && window.parent !== window) {
        e.preventDefault();
        e.stopPropagation();
        try {
          window.parent.postMessage(
            {
              type: 'sidecar-key-event',
              payload: {
                eventType: 'keydown',
                key: action === 'in' ? '=' : action === 'out' ? '-' : '0',
                code: e.code,
                ctrlKey: !!e.ctrlKey,
                metaKey: !!e.metaKey,
                shiftKey: action === 'reset' ? false : !!e.shiftKey,
                altKey: false,
                repeat: !!e.repeat
              }
            },
            '*'
          );
        } catch (err) {}
      }
      return;
    }

    const native = window.electronNative;
    if (!native) return;

    const actionFn =
      action === 'out'
        ? native.zoomOut
        : action === 'in'
        ? native.zoomIn
        : typeof native.resetZoom === 'function'
        ? native.resetZoom
        : native.zoomReset;
    if (typeof actionFn !== 'function') return;

    if (window.__ag_zoom_timer != null) {
      clearTimeout(window.__ag_zoom_timer);
      window.__ag_zoom_timer = null;
    }

    const nowTs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const curFactor = typeof native.getZoomLevel === 'function' ? native.getZoomLevel() : null;
    const settledBefore = typeof window.__ag_settled_zoom === 'number' ? window.__ag_settled_zoom : curFactor;

    e.preventDefault();
    e.stopPropagation();

    // 若原生菜单加速器已在 keydown 到达渲染进程前刚完成缩放（macOS NSMenu），直接同步状态并跳过补触发
    if (
      !window.__ag_self_zooming &&
      ((typeof curFactor === 'number' && typeof settledBefore === 'number' && Math.abs(curFactor - settledBefore) > 0.003) ||
        nowTs - (window.__ag_last_ext_zoom_ts || 0) < 80)
    ) {
      if (typeof curFactor === 'number') window.__ag_settled_zoom = curFactor;
      return;
    }

    // preload.js 中 getZoomLevel() 底层为 webFrame.getZoomFactor()，100% 原始大小恒为 1.0
    if (action === 'reset' && typeof curFactor === 'number' && Math.abs(curFactor - 1) < 0.005) {
      return;
    }

    const markSelfZoomWindow = (ms) => {
      window.__ag_self_zooming = true;
      if (window.__ag_self_zoom_timer) clearTimeout(window.__ag_self_zoom_timer);
      window.__ag_self_zoom_timer = setTimeout(() => {
        window.__ag_self_zoom_timer = null;
        try {
          const latest = typeof native.getZoomLevel === 'function' ? native.getZoomLevel() : null;
          if (typeof latest === 'number') window.__ag_settled_zoom = latest;
        } catch (err) {}
        window.__ag_self_zooming = false;
      }, ms);
    };

    const runZoomAction = () => {
      markSelfZoomWindow(250);
      try {
        const ret = actionFn.call(native);
        const syncNext = typeof native.getZoomLevel === 'function' ? native.getZoomLevel() : null;
        if (
          typeof syncNext === 'number' &&
          (typeof curFactor !== 'number' || Math.abs(syncNext - curFactor) > 0.003)
        ) {
          window.__ag_settled_zoom = syncNext;
        }
        if (ret && typeof ret.then === 'function') {
          ret.then(
            () => {
              try {
                const asyncNext = typeof native.getZoomLevel === 'function' ? native.getZoomLevel() : null;
                if (typeof asyncNext === 'number') window.__ag_settled_zoom = asyncNext;
              } catch (err) {}
              markSelfZoomWindow(80);
            },
            () => {
              markSelfZoomWindow(40);
            }
          );
        }
      } catch (err) {
        markSelfZoomWindow(40);
      }
    };

    // macOS 原生菜单未绑定小键盘与 '_'：零延迟即时执行，确保长按连发 (e.repeat) 丝滑不吞键
    if (String(e.code || '').startsWith('Numpad') || k === '_') {
      runZoomAction();
      return;
    }

    // macOS 保留 60ms NSMenu 防双倍缩放观察窗口
    if (window.__ag_zoom_timer) {
      clearTimeout(window.__ag_zoom_timer);
      window.__ag_zoom_timer = null;
    }

    window.__ag_zoom_timer = setTimeout(() => {
      window.__ag_zoom_timer = null;
      try {
        const afterFactor = typeof native.getZoomLevel === 'function' ? native.getZoomLevel() : null;
        if (
          !window.__ag_self_zooming &&
          ((typeof curFactor === 'number' && typeof afterFactor === 'number' && Math.abs(afterFactor - curFactor) > 0.003) ||
            (typeof performance !== 'undefined' ? performance.now() : Date.now()) - (window.__ag_last_ext_zoom_ts || 0) < 80)
        ) {
          if (typeof afterFactor === 'number') window.__ag_settled_zoom = afterFactor;
          return;
        }
        runZoomAction();
      } catch (err) {}
    }, 60);
  };

  if (!window.__ag_zoom_guard_installed) {
    window.__ag_zoom_guard_installed = true;
    if (!IS_SWARM_PLUGIN_FRAME) {
      window.addEventListener(
        'resize',
        () => {
          if (typeof window.__ag_zoom_resize_fn === 'function') {
            window.__ag_zoom_resize_fn();
          }
        },
        { passive: true }
      );
    }
    window.addEventListener(
      'keydown',
      (e) => {
        if (typeof window.__ag_zoom_keydown_fn === 'function') {
          window.__ag_zoom_keydown_fn(e);
        }
      },
      true
    );
  }

  // ============================================================================
  // 3. 专属色彩预设状态联动（支持 user/config.json 热重载切换）与防白屏崩溃保护
  // ============================================================================
  const PRESETS = {
    HIGH_CONTRAST: 'high-contrast',
    CLAUDE_PUREWHITE: 'claude-desktop-purewhite',
    VINTAGE_DEEP: 'vintage-deep',
    LEGACY_WARM_WHITE: 'chuanban-warm-white',
    LEGACY_OFFICIAL: 'claude-desktop-official',
    LEGACY_CHUANBAN: 'absoulutely-chuanban'
  };

  const ALL_CUSTOM_PRESET_NAMES = new Set(Object.values(PRESETS));

  // 当用户在 user/config.json 中修改了 preset 时，同步刷新 localStorage 中的 theme-color-flavor
  if (DEFAULT_PRESET && window.__ag_last_boot_preset !== DEFAULT_PRESET) {
    window.__ag_last_boot_preset = DEFAULT_PRESET;
    try {
      Storage.prototype.setItem.call(localStorage, 'theme-color-flavor', DEFAULT_PRESET);
    } catch (e) {}
  }

  let lastSyncedHostMode = null;
  const darkColorSchemeMql =
    typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function syncChuanbanPreset() {
    try {
      const storedLight = Storage.prototype.getItem.call(localStorage, 'theme-preset-light');
      if (ALL_CUSTOM_PRESET_NAMES.has(storedLight)) {
        try {
          Storage.prototype.setItem.call(localStorage, 'theme-preset-light', 'Default Light');
        } catch (e) {}
      }
      const storedDark = Storage.prototype.getItem.call(localStorage, 'theme-preset-dark');
      if (ALL_CUSTOM_PRESET_NAMES.has(storedDark)) {
        try {
          Storage.prototype.setItem.call(localStorage, 'theme-preset-dark', 'Default Dark');
        } catch (e) {}
      }

      const flavor =
        Storage.prototype.getItem.call(localStorage, 'theme-color-flavor') || DEFAULT_PRESET || PRESETS.HIGH_CONTRAST;

      let targetPreset = PRESETS.HIGH_CONTRAST;
      if (flavor === PRESETS.HIGH_CONTRAST || flavor === PRESETS.LEGACY_WARM_WHITE || flavor === '高对比版') {
        targetPreset = PRESETS.HIGH_CONTRAST;
      } else if (
        flavor === PRESETS.CLAUDE_PUREWHITE ||
        flavor === PRESETS.LEGACY_OFFICIAL ||
        flavor === 'ClaudeDesktop 净白'
      ) {
        targetPreset = PRESETS.CLAUDE_PUREWHITE;
      } else if (flavor === PRESETS.VINTAGE_DEEP || flavor === PRESETS.LEGACY_CHUANBAN || flavor === '复古深色') {
        targetPreset = PRESETS.VINTAGE_DEEP;
      }

      const prevPreset = document.documentElement.getAttribute('data-ag-preset');
      if (prevPreset !== targetPreset) {
        document.documentElement.setAttribute('data-ag-preset', targetPreset);
      }

      const htmlEl = document.documentElement;
      const bodyEl = document.body;
      const htmlDataTheme = htmlEl ? htmlEl.getAttribute('data-theme') : null;
      const hostThemeMode = boot.hostThemeMode || null;
      const systemPrefersDark = !!(darkColorSchemeMql && darkColorSchemeMql.matches);
      let isDark = false;
      if (IS_SWARM_PLUGIN_FRAME) {
        // Prefer the owning host's live mode. Saved native values below prevent
        // our own data-theme/color-scheme writes from latching a stale dark fallback.
        const liveParentMode = window.__ag_host_theme_mode;
        const surface = window.__ag_swarm_surface || (window.__ag_swarm_surface = {
          theme: htmlEl.getAttribute('data-theme'),
          scheme: htmlEl.style.getPropertyValue('color-scheme'),
          schemePriority: htmlEl.style.getPropertyPriority('color-scheme'),
          appliedTheme: undefined, appliedScheme: undefined
        });
        if (htmlDataTheme !== surface.appliedTheme) surface.theme = htmlDataTheme;
        const nativeScheme = htmlEl.style.getPropertyValue('color-scheme');
        if (nativeScheme !== surface.appliedScheme) {
          surface.scheme = nativeScheme;
          surface.schemePriority = htmlEl.style.getPropertyPriority('color-scheme');
        }
        const inlineHostBg = (htmlEl.style.getPropertyValue('--background') || '').trim();
        const hostLum = computeColorLuminance(inlineHostBg);
        if (liveParentMode === 'dark' || liveParentMode === 'light') {
          isDark = liveParentMode === 'dark';
        } else if (hostThemeMode === 'dark' || hostThemeMode === 'light') {
          isDark = hostThemeMode === 'dark';
        } else if (hostLum !== null) {
          isDark = hostLum < 0.5;
        } else if (surface.theme === 'dark') {
          isDark = true;
        } else {
          isDark = systemPrefersDark;
        }
        const swarmMode = isDark ? 'dark' : 'light';
        surface.appliedTheme = swarmMode;
        surface.appliedScheme = swarmMode;
        if (htmlEl.getAttribute('data-theme') !== swarmMode) htmlEl.setAttribute('data-theme', swarmMode);
        if (htmlEl.style.getPropertyValue('color-scheme') !== swarmMode) htmlEl.style.setProperty('color-scheme', swarmMode);
      } else {
        const bodyExplicitDark = !!(
          htmlDataTheme === 'dark' ||
          (bodyEl &&
            (bodyEl.classList.contains('dark') ||
              bodyEl.classList.contains('theme-dark') ||
              bodyEl.classList.contains('dark-theme')))
        );
        const bodyExplicitLight = !!(
          htmlDataTheme === 'light' ||
          (bodyEl &&
            (bodyEl.classList.contains('theme-light') ||
              bodyEl.classList.contains('light-theme') ||
              bodyEl.classList.contains('light')))
        );
        let storedThemeMode = null;
        try {
          storedThemeMode = Storage.prototype.getItem.call(localStorage, 'theme-mode');
        } catch (e) {}
        const hasColorSchemeDark = !!(htmlEl && htmlEl.style.colorScheme === 'dark');
        const hasColorSchemeLight = !!(htmlEl && htmlEl.style.colorScheme === 'light');
        const bodyHydrated = !!(
          bodyEl && (bodyEl.hasAttribute('data-agy-theme') || bodyEl.hasAttribute('data-newux-theme'))
        );
        if (bodyExplicitDark) {
          isDark = true;
        } else if (bodyExplicitLight) {
          isDark = false;
        } else if (hasColorSchemeDark) {
          isDark = true;
        } else if (hasColorSchemeLight) {
          isDark = false;
        } else if (bodyHydrated) {
          isDark = false;
        } else if (hostThemeMode === 'dark') {
          isDark = true;
        } else if (hostThemeMode === 'light') {
          isDark = false;
        } else if (hostThemeMode === 'inherit') {
          isDark = systemPrefersDark;
        } else if (storedThemeMode === 'dark') {
          isDark = true;
        } else if (storedThemeMode === 'light') {
          isDark = false;
        } else {
          isDark = systemPrefersDark;
        }
      }
      const targetMode = isDark ? 'dark' : 'light';
      const prevMode = document.documentElement.getAttribute('data-ag-theme-mode');
      if (prevMode !== targetMode || prevPreset !== targetPreset) {
        document.documentElement.setAttribute('data-ag-theme-mode', targetMode);
      }
      window.__ag_resolved_theme_mode = targetMode;
      if (!IS_SWARM_PLUGIN_FRAME && lastSyncedHostMode !== targetMode &&
          typeof window.__agSyncHostThemeMode === 'function') {
        try {
          window.__agSyncHostThemeMode(targetMode);
          lastSyncedHostMode = targetMode;
        } catch (e) {}
      }
      const bodyStateFlag = bodyEl
        ? bodyEl.hasAttribute('data-agy-theme') || bodyEl.hasAttribute('data-newux-theme')
          ? 2
          : 1
        : 0;
      const surfaceSyncKey = `${targetMode}|${targetPreset}|${bodyStateFlag}|${window.__ag_style_rev || 0}`;
      if (window.__ag_last_surface_sync_key !== surfaceSyncKey) {
        if (bodyEl) {
          window.__ag_last_surface_sync_key = surfaceSyncKey;
        }
        syncCurtainSurfaceColor();
      }
    } catch (e) {}
  }

  window.__ag_sync_preset_fn = syncChuanbanPreset;
  window.__ag_set_host_theme_mode = (mode) => {
    if (!IS_SWARM_PLUGIN_FRAME || (mode !== null && mode !== 'dark' && mode !== 'light')) return;
    window.__ag_host_theme_mode = mode;
    window.__ag_sync_preset_fn?.();
  };

  if (!window.__ag_preset_hook_installed) {
    window.__ag_preset_hook_installed = true;
    try {
      const origGetItem = localStorage.getItem.bind(localStorage);
      localStorage.getItem = function (key) {
        const val = origGetItem(key);
        if (key === 'theme-preset-light' && ALL_CUSTOM_PRESET_NAMES.has(val)) {
          return 'Default Light';
        }
        if (key === 'theme-preset-dark' && ALL_CUSTOM_PRESET_NAMES.has(val)) {
          return 'Default Dark';
        }
        return val;
      };

      const origSetItem = localStorage.setItem.bind(localStorage);
      localStorage.setItem = function (key, val) {
        if (key === 'theme-preset-light' && ALL_CUSTOM_PRESET_NAMES.has(val)) {
          val = 'Default Light';
        }
        if (key === 'theme-preset-dark' && ALL_CUSTOM_PRESET_NAMES.has(val)) {
          val = 'Default Dark';
        }
        origSetItem(key, val);
        if (
          key === 'theme-preset-light' ||
          key === 'theme-preset-dark' ||
          key === 'theme-mode' ||
          key === 'theme-color-flavor'
        ) {
          setTimeout(() => {
            if (typeof window.__ag_sync_preset_fn === 'function') window.__ag_sync_preset_fn();
          }, 50);
        }
      };
    } catch (e) {}
  }

  if (window.__ag_theme_mode_observer) {
    try {
      window.__ag_theme_mode_observer.disconnect();
    } catch (e) {}
    window.__ag_theme_mode_observer = null;
  }
  if (typeof MutationObserver !== 'undefined') {
    try {
      const modeObs = new MutationObserver(() => {
        if (typeof window.__ag_sync_preset_fn === 'function') {
          window.__ag_sync_preset_fn();
        }
      });
      if (document.body) {
        modeObs.observe(document.body, { attributes: true, attributeFilter: ['class'] });
      }
      if (document.documentElement) {
        modeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
      }
      window.__ag_theme_mode_observer = modeObs;
    } catch (e) {}
  }
  if (window.__ag_mql_cleanup) {
    try {
      window.__ag_mql_cleanup();
    } catch (e) {}
    window.__ag_mql_cleanup = null;
  }
  if (typeof window.matchMedia === 'function') {
    try {
      const mql = window.matchMedia('(prefers-color-scheme: dark)');
      const onSchemeChange = () => {
        if (typeof window.__ag_sync_preset_fn === 'function') window.__ag_sync_preset_fn();
      };
      mql.addEventListener?.('change', onSchemeChange);
      window.__ag_mql_cleanup = () => mql.removeEventListener?.('change', onSchemeChange);
    } catch (e) {}
  }

  syncChuanbanPreset();
  window.__ag_patch_version = PATCH_VERSION;

  // ============================================================================
  // 3.5 模型名称同行实时指标胶囊 (Scheme C: TPS · TTFT · Ctx/256k · Out + Hover 详情卡)
  // 支持多窗格/多分屏与 /btw 独立挂载、动态宽度折行；不包含标题外挂。
  // ============================================================================
  const metricsGeneration = Symbol('metrics-payload');
  window.__ag_metrics_generation = metricsGeneration;
  const metricsIsCurrent = () => window.__ag_metrics_generation === metricsGeneration;
  const MIDDLE_ENTER_BOTTOM_PX = 165;
  const MIDDLE_EXIT_BOTTOM_PX = 180;
  const CASCADE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const AUX_CONVO_TAB_RE =
    /^(?:side_question|subagent_convo)__([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
  function extractAuxConvoTabUuid(raw) {
    const m = String(raw || '').trim().match(AUX_CONVO_TAB_RE);
    return m ? m[1].toLowerCase() : '';
  }
  function isWeakMapInstance(v) {
    return (
      v instanceof WeakMap ||
      !!(
        v &&
        typeof v.get === 'function' &&
        typeof v.set === 'function' &&
        typeof v.delete === 'function' &&
        typeof v.has === 'function'
      )
    );
  }
  if (!isWeakMapInstance(window.__ag_pill_tooltip_map)) {
    window.__ag_pill_tooltip_map = new WeakMap();
  }
  const pillTooltipMap = window.__ag_pill_tooltip_map;
  const rowStateMap = new WeakMap();
  const activeMetricsObservers = new Set();
  const activeMetricsRows = new Map();
  const activeMetricsRafs = new Set();
  const metricsRouteTimers = new Set();
  const pendingPillLayoutBoxes = new Set();
  let pillLayoutRafId = 0;
  let routeCheckRafId = 0;

  function scheduleTrackedHandle(trackSet, schedulerFn, callback) {
    let settled = false;
    let handle = 0;
    handle = schedulerFn(() => {
      settled = true;
      if (handle) trackSet.delete(handle);
      if (metricsIsCurrent()) callback();
    });
    if (!settled && handle) trackSet.add(handle);
    return settled ? 0 : handle;
  }

  function scheduleDeferredPillLayout(box) {
    if (!box || IS_SWARM_PLUGIN_FRAME || !MODULES.metrics || !metricsIsCurrent()) return;
    pendingPillLayoutBoxes.add(box);
    if (pillLayoutRafId) return;
    pillLayoutRafId = scheduleTrackedHandle(activeMetricsRafs, requestAnimationFrame, () => {
      pillLayoutRafId = 0;
      if (pendingPillLayoutBoxes.size === 0) return;
      const queued = Array.from(pendingPillLayoutBoxes);
      pendingPillLayoutBoxes.clear();
      for (let i = 0; i < queued.length; i++) {
        const b = queued[i];
        if (b && b.isConnected) {
          ensureMetricsPillForBox(b, true, false);
        }
      }
    });
  }

  if (!window.__ag_metrics_by_id || window.__ag_metrics_cache_ver !== PATCH_VERSION) {
    window.__ag_metrics_by_id = Object.create(null);
    window.__ag_metrics_cache_ver = PATCH_VERSION;
  }
  const metricsById = window.__ag_metrics_by_id;

  window.__ag_cleanup_fns.push(() => {
    if (metricsIsCurrent()) window.__ag_metrics_generation = null;
    for (const ro of activeMetricsObservers) {
      try {
        ro.disconnect();
      } catch (e) {}
    }
    activeMetricsObservers.clear();
    activeMetricsRows.clear();
    for (const rafId of activeMetricsRafs) {
      try {
        cancelAnimationFrame(rafId);
      } catch (e) {}
    }
    activeMetricsRafs.clear();
    pillLayoutRafId = 0;
    routeCheckRafId = 0;
    pendingPillLayoutBoxes.clear();
    for (const tid of metricsRouteTimers) {
      try {
        clearTimeout(tid);
      } catch (e) {}
    }
    metricsRouteTimers.clear();
    window.__ag_metrics_focusin_fn = null;
    window.__ag_metrics_click_fn = null;
    window.__ag_trigger_route_check_fn = null;
    window.__ag_check_route_fn = null;
    window.__ag_render_metrics = null;
    window.__ag_ensure_metrics_pill_fn = null;
    if (window.__ag_metrics_tt_hide_timer) clearTimeout(window.__ag_metrics_tt_hide_timer);
    window.__ag_metrics_tt_hide_timer = null;
    hideMetricsTooltipIfOwner(null);
  });

  function isPillNode(el) {
    return !!(
      el &&
      el.nodeType === 1 &&
      (el.id === 'ag-live-metrics-pill' ||
        el.hasAttribute('data-ag-metrics-pill') ||
        (el.classList && el.classList.contains('ag-live-metrics-pill')))
    );
  }

  function getPillTextEl(pill) {
    if (!pill || !pill.querySelector) return null;
    return pill.querySelector('[data-ag-metrics-text="1"], .ag-live-metrics-text, #ag-live-metrics-text');
  }

  const ESCAPED_INPUT_BOX_ID = String(SELECTORS.inputBoxId || '').trim().replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const INPUT_BOX_SELECTOR = ESCAPED_INPUT_BOX_ID ? '[id="' + ESCAPED_INPUT_BOX_ID + '"]' : '';
  const METRICS_FOCUSIN_BASE_SELECTOR =
    '[data-pane-id], [data-testid="conversation-view"], [data-testid="side-question-tab-content"], [data-media-drop-scope="subpane"], [data-side-panel-strip]';
  const METRICS_FOCUSIN_MATCH_SELECTOR = INPUT_BOX_SELECTOR
    ? `${METRICS_FOCUSIN_BASE_SELECTOR}, ${INPUT_BOX_SELECTOR}`
    : METRICS_FOCUSIN_BASE_SELECTOR;

  function getAllInputBoxes() {
    try {
      if (!INPUT_BOX_SELECTOR || typeof document.querySelectorAll !== 'function') return [];
      return Array.from(document.querySelectorAll(INPUT_BOX_SELECTOR)).filter(box =>
        box.isConnected && !box.closest('[hidden], [aria-hidden="true"], [inert]') && box.getClientRects().length > 0
      );
    } catch (e) {
      return [];
    }
  }

  function extractAllPathnameCascadeIds() {
    const out = [];
    const seen = new Set();
    try {
      let decoded = String(window.location.pathname || '');
      try {
        decoded = decodeURIComponent(decoded);
      } catch (e) {}
      const m = decoded.match(/\/c\/([^/?#]+)/i);
      if (m) {
        const parts = m[1].split(/\+|%2b/i);
        for (let i = 0; i < parts.length; i++) {
          const cid = String(parts[i] || '').trim().toLowerCase();
          if (CASCADE_UUID_RE.test(cid) && !seen.has(cid)) {
            seen.add(cid);
            out.push(cid);
          }
        }
      }
      const sp = new URLSearchParams(window.location.search || '');
      const tabs = sp.getAll('tab');
      for (let i = 0; i < tabs.length; i++) {
        const sideCid = extractAuxConvoTabUuid(tabs[i]);
        if (sideCid && !seen.has(sideCid)) {
          seen.add(sideCid);
          out.push(sideCid);
        }
      }
    } catch (e) {}
    return out;
  }

  function extractFocusedOrPrimaryCascadeId() {
    try {
      const sp = new URLSearchParams(window.location.search || '');
      const focused = String(sp.get('focused') || '').trim().toLowerCase();
      if (CASCADE_UUID_RE.test(focused)) return focused;
      const pathIds = extractAllPathnameCascadeIds();
      if (pathIds.length > 0) return pathIds[0];
      const q = String(sp.get('cascadeId') || '').trim().toLowerCase();
      if (CASCADE_UUID_RE.test(q)) return q;
      const selected = document.querySelector('[data-testid=conversation-row-sidebar][data-selected=true]');
      if (selected) {
        const cid = String(selected.getAttribute('data-cascade-id') || '').trim().toLowerCase();
        if (CASCADE_UUID_RE.test(cid)) return cid;
      }
    } catch (e) {}
    return '';
  }

  function resolveBoxCascadeId(box, totalBoxes) {
    if (!box) return '';
    try {
      const sideContainer =
        box.closest &&
        box.closest(
          '[data-testid="side-question-tab-content"], [data-testid="side-question-tab-composer"], [data-side-panel-composer], [data-media-drop-scope="subpane"]'
        );
      if (sideContainer) {
        const tabContent =
          (sideContainer.matches &&
          sideContainer.matches('[data-testid="side-question-tab-content"], [data-media-drop-scope="subpane"]')
            ? sideContainer
            : sideContainer.closest &&
              sideContainer.closest('[data-testid="side-question-tab-content"], [data-media-drop-scope="subpane"]')) ||
          sideContainer;
        const sideConv =
          tabContent && tabContent.querySelector
            ? tabContent.querySelector(
                '[data-testid="side-question-tab-conversation"][data-cascade-id], [data-testid="subagent-tab-conversation"][data-cascade-id]'
              )
            : null;
        const auxRoot =
          (box.closest && box.closest('[data-testid="aux-pane-split"], [data-pane-id]')) || tabContent;
        const strip =
          auxRoot && auxRoot.querySelector
            ? auxRoot.querySelector('[data-active-tab-id^="side_question__"], [data-active-tab-id^="subagent_convo__"]')
            : null;
        const stripCid = strip ? extractAuxConvoTabUuid(strip.getAttribute('data-active-tab-id')) : '';
        const sideCid = sideConv ? String(sideConv.getAttribute('data-cascade-id') || '').trim().toLowerCase() : '';
        if (stripCid && CASCADE_UUID_RE.test(sideCid) && stripCid !== sideCid) return '';
        const resolved = CASCADE_UUID_RE.test(sideCid) ? sideCid : stripCid;
        const routeIds = new URLSearchParams(window.location.search || '').getAll('tab').map(extractAuxConvoTabUuid).filter(Boolean);
        if (resolved && routeIds.length && !routeIds.includes(resolved)) return '';
        if (resolved) return resolved;
        return '';
      }
      const view =
        box.closest && box.closest('[data-testid="conversation-view"][data-cascade-id], [data-cascade-id]');
      if (view) {
        const cid = String(view.getAttribute('data-cascade-id') || '').trim().toLowerCase();
        if (CASCADE_UUID_RE.test(cid)) {
          const routeIds = extractAllPathnameCascadeIds();
          return routeIds.length && !routeIds.includes(cid) ? '' : cid;
        }
      }
      if (totalBoxes === 1) {
        const paneScope =
          (box.closest && box.closest('[data-pane-id], [data-testid="overview-panel-host"], main')) || document;
        const hasHomeGreeting = !!(
          (box.closest && box.closest(SELECTORS.homeGreeting)) ||
          (paneScope && paneScope.querySelector && paneScope.querySelector(SELECTORS.homeGreeting))
        );
        const hasBranchTrigger = !!(box.querySelector && box.querySelector(SELECTORS.branchPillInBox));
        if (window.location.pathname !== '/' && !hasHomeGreeting && !hasBranchTrigger) {
          return extractFocusedOrPrimaryCascadeId();
        }
      }
    } catch (e) {}
    return '';
  }

  function clearMetricsTooltipHideTimer() {
    if (window.__ag_metrics_tt_hide_timer) {
      try {
        clearTimeout(window.__ag_metrics_tt_hide_timer);
      } catch (e) {}
      window.__ag_metrics_tt_hide_timer = null;
    }
  }

  function scheduleMetricsTooltipHide(delayMs = 160) {
    clearMetricsTooltipHideTimer();
    window.__ag_metrics_tt_hide_timer = setTimeout(() => {
      window.__ag_metrics_tt_hide_timer = null;
      const tt = document.getElementById('ag-live-metrics-tooltip');
      if (tt) tt.removeAttribute('data-visible');
      window.__ag_active_tooltip_pill = null;
    }, delayMs);
  }

  function ensureMetricsTooltip() {
    let tt = document.getElementById('ag-live-metrics-tooltip');
    if (tt && tt.getAttribute('data-ag-tt-ver') !== PATCH_VERSION) {
      try {
        tt.remove();
      } catch (e) {}
      tt = null;
    }
    if (!tt && document.body) {
      tt = document.createElement('div');
      tt.id = 'ag-live-metrics-tooltip';
      tt.setAttribute('data-ag-tt-ver', PATCH_VERSION);
      document.body.appendChild(tt);
    } else if (tt && tt.parentElement !== document.body && document.body) {
      document.body.appendChild(tt);
    }
    if (tt && !tt.__ag_tt_interactive_bound) {
      tt.__ag_tt_interactive_bound = true;
      tt.addEventListener('mouseenter', () => {
        clearMetricsTooltipHideTimer();
      });
      tt.addEventListener('mouseleave', () => {
        scheduleMetricsTooltipHide(120);
      });

    }
    return tt;
  }

  function hideMetricsTooltipIfOwner(pill) {
    if (!pill || window.__ag_active_tooltip_pill === pill) {
      clearMetricsTooltipHideTimer();
      const tt = document.getElementById('ag-live-metrics-tooltip');
      if (tt) tt.removeAttribute('data-visible');
      if (!pill || window.__ag_active_tooltip_pill === pill) {
        window.__ag_active_tooltip_pill = null;
      }
    }
  }

  function findFooterRow(box) {
    if (!box) return null;
    const directFooter = box.querySelector('.agy-composer-footer');
    if (directFooter && directFooter.children.length >= 2) {
      return directFooter;
    }
    const rows = box.querySelectorAll('div.flex.w-full.items-center.justify-between');
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      if (r.getAttribute('data-testid') === 'input-box-bottom-toolbar') continue;
      if (r.querySelector('[data-testid="model-selector-trigger"], [data-testid="send-button"]')) {
        return r;
      }
    }
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      if (r.getAttribute('data-testid') !== 'input-box-bottom-toolbar') return r;
    }
    return directFooter || null;
  }

  function findPillInBox(box) {
    if (!box || !box.querySelector) return null;
    return box.querySelector('[data-ag-metrics-pill="1"], .ag-live-metrics-pill, #ag-live-metrics-pill');
  }

  function measureNaturalLeftWidth(leftGroup) {
    let w = 0;
    for (let i = 0; i < leftGroup.children.length; i++) {
      const ch = leftGroup.children[i];
      if (isPillNode(ch)) continue;
      const cw = Math.max(ch.offsetWidth || 0, ch.scrollWidth || 0);
      if (cw > 0) w += cw;
    }
    return w;
  }

  function computeNeededPillWidth(pill) {
    if (!pill || pill.style.display === 'none') return 0;
    const textEl = getPillTextEl(pill);
    const textScrollW = textEl ? textEl.scrollWidth || 0 : 0;
    return textScrollW > 0 ? Math.ceil(textScrollW + 12) : 0;
  }

  function syncMetricsResizeObserver(box, bottomRow, leftGroup, rightGroup) {
    if (typeof ResizeObserver === 'undefined' || !bottomRow) return null;
    let state = rowStateMap.get(bottomRow);
    if (!state || state.ver !== PATCH_VERSION) {
      if (state && state.ro) {
        try {
          state.ro.disconnect();
        } catch (e) {}
        activeMetricsObservers.delete(state.ro);
      }
      if (state && state.rafId) {
        try {
          cancelAnimationFrame(state.rafId);
        } catch (e) {}
        activeMetricsRafs.delete(state.rafId);
      }
      state = {
        ver: PATCH_VERSION,
        observed: new WeakSet(),
        rafId: 0,
        lastSig: '',
        lastRowW: 0,
        ro: null
      };
      const ro = new ResizeObserver(() => {
        if (state.rafId) return;
        state.rafId = scheduleTrackedHandle(activeMetricsRafs, requestAnimationFrame, () => {
          state.rafId = 0;
          if (!bottomRow.isConnected || !box.isConnected) {
            try {
              ro.disconnect();
            } catch (e) {}
            activeMetricsObservers.delete(ro);
            return;
          }
          const curLeft = bottomRow.children[0];
          if (!curLeft) return;
          const curRight = bottomRow.children[1] || null;
          const rw = bottomRow.clientWidth || 0;
          if (rw <= 0) return;
          const lw = measureNaturalLeftWidth(curLeft);
          const rgw = curRight ? curRight.offsetWidth || 0 : 0;
          const curPill = findPillInBox(box);
          const nw = computeNeededPillWidth(curPill);
          const sig = rw + ':' + lw + ':' + rgw + ':' + nw;
          if (sig !== state.lastSig) {
            ensureMetricsPillForBox(box, true, false);
          }
        });
      });
      state.ro = ro;
      activeMetricsObservers.add(ro);
      rowStateMap.set(bottomRow, state);
      activeMetricsRows.set(bottomRow, {box, state});
    }
    const ro = state.ro;
    const seen = state.observed;
    const observeOnce = (el) => {
      if (el && el.nodeType === 1 && !seen.has(el)) {
        seen.add(el);
        try {
          ro.observe(el);
        } catch (e) {}
      }
    };
    observeOnce(bottomRow);
    if (rightGroup) observeOnce(rightGroup);
    if (leftGroup) {
      for (let i = 0; i < leftGroup.children.length; i++) {
        const ch = leftGroup.children[i];
        if (!isPillNode(ch)) observeOnce(ch);
      }
    }
    return state;
  }

  function createPillElement() {
    const pill = document.createElement('div');
    pill.className = 'ag-live-metrics-pill';
    pill.setAttribute('data-ag-metrics-pill', '1');
    pill.setAttribute('data-ag-pill-ver', PATCH_VERSION);
    const span = document.createElement('span');
    span.className = 'ag-live-metrics-text';
    span.setAttribute('data-ag-metrics-text', '1');
    pill.appendChild(span);
    pill.addEventListener('mouseenter', () => {
      clearMetricsTooltipHideTimer();
      const map = isWeakMapInstance(window.__ag_pill_tooltip_map) ? window.__ag_pill_tooltip_map : pillTooltipMap;
      const ttHtml = map.get(pill);
      if (!ttHtml) return;
      const tt = ensureMetricsTooltip();
      if (!tt) return;
      if (tt.innerHTML !== ttHtml) {
        tt.innerHTML = ttHtml;
      }
      window.__ag_active_tooltip_pill = pill;
      const r = pill.getBoundingClientRect();
      const ttWidth = Math.min(450, Math.max(370, tt.offsetWidth || 400));
      const left = Math.max(12, Math.min(r.left, window.innerWidth - ttWidth - 16));
      const bottomPx = Math.min(window.innerHeight - r.top + 8, window.innerHeight - (tt.offsetHeight || 220) - 12);
      tt.style.left = left + 'px';
      tt.style.bottom = Math.max(8, bottomPx) + 'px';
      tt.setAttribute('data-visible', '1');
    });
    pill.addEventListener('mouseleave', () => {
      if (window.__ag_active_tooltip_pill !== pill) return;
      hideMetricsTooltipIfOwner(pill);
    });
    return pill;
  }

  function ensureMetricsPillForBox(box, forceLayout = false, resetHysteresis = false) {
    if (!metricsIsCurrent() || !MODULES.metrics || !box) return null;
    const bottomRow = findFooterRow(box);
    if (!bottomRow || !bottomRow.children[0]) return null;
    const leftGroup = bottomRow.children[0];
    const rightGroup = bottomRow.children[1] || null;

    let pill = findPillInBox(box);
    let isNewPill = false;
    if (!pill) {
      isNewPill = true;
      pill = createPillElement();
    } else if (!pill.hasAttribute('data-ag-metrics-pill')) {
      pill.setAttribute('data-ag-metrics-pill', '1');
      pill.setAttribute('data-ag-pill-ver', PATCH_VERSION);
      if (pill.classList && !pill.classList.contains('ag-live-metrics-pill')) {
        pill.classList.add('ag-live-metrics-pill');
      }
      const textEl = getPillTextEl(pill);
      if (textEl) {
        if (textEl.classList && !textEl.classList.contains('ag-live-metrics-text')) {
          textEl.classList.add('ag-live-metrics-text');
        }
        textEl.setAttribute('data-ag-metrics-text', '1');
      }
    }

    const rowState = syncMetricsResizeObserver(box, bottomRow, leftGroup, rightGroup);

    const rowW = bottomRow.clientWidth || 0;
    if (rowW <= 0) {
      if (pill.parentElement !== leftGroup && !(bottomRow.parentElement && pill.parentElement === bottomRow.parentElement)) {
        leftGroup.appendChild(pill);
      }
      return pill;
    }
    const leftW = measureNaturalLeftWidth(leftGroup);
    const rightW = rightGroup ? rightGroup.offsetWidth || 0 : 0;
    const neededPillW = computeNeededPillWidth(pill);
    const curLayoutSig = rowW + ':' + leftW + ':' + rightW + ':' + neededPillW;

    const isMountedHere =
      pill.parentElement === leftGroup || (bottomRow.parentElement && pill.parentElement === bottomRow.parentElement);
    if (!forceLayout && !isNewPill && isMountedHere && rowState && rowState.lastSig === curLayoutSig) {
      return pill;
    }

    if (rowState) {
      rowState.lastSig = curLayoutSig;
      rowState.lastRowW = rowW;
    }
    const availMiddleW = rowW - leftW - rightW - 8;
    const enterBottomPx = Math.max(MIDDLE_ENTER_BOTTOM_PX, neededPillW);
    const exitBottomPx = Math.max(MIDDLE_EXIT_BOTTOM_PX, enterBottomPx + 16);

    const prevMode = resetHysteresis ? 'middle' : pill.getAttribute('data-ag-row-mode') || 'middle';
    const useBottomRow = prevMode === 'bottom' ? availMiddleW < exitBottomPx : availMiddleW < enterBottomPx;
    const rowMode = useBottomRow ? 'bottom' : 'middle';

    if (bottomRow.getAttribute('data-ag-row-mode') !== rowMode) {
      bottomRow.setAttribute('data-ag-row-mode', rowMode);
    }
    if (pill.getAttribute('data-ag-row-mode') !== rowMode) {
      pill.setAttribute('data-ag-row-mode', rowMode);
    }

    if (useBottomRow) {
      const cardParent = bottomRow.parentElement;
      if (cardParent && (pill.parentElement !== cardParent || pill.previousElementSibling !== bottomRow)) {
        bottomRow.after(pill);
      }
    } else {
      if (pill.parentElement !== leftGroup) {
        leftGroup.appendChild(pill);
      }
    }

    return pill;
  }

  function pruneOrphanedPills(activeBoxes) {
    const activeSet = new Set(activeBoxes || []);
    for (const [row, {box, state}] of activeMetricsRows) {
      if (row.isConnected && activeSet.has(box)) continue;
      state.ro?.disconnect();
      activeMetricsObservers.delete(state.ro);
      if (state.rafId) { cancelAnimationFrame(state.rafId); activeMetricsRafs.delete(state.rafId); }
      rowStateMap.delete(row);
      activeMetricsRows.delete(row);
    }
    const allPills = document.querySelectorAll('[data-ag-metrics-pill="1"], .ag-live-metrics-pill, #ag-live-metrics-pill');
    const kept = [];
    for (let i = 0; i < allPills.length; i++) {
      const p = allPills[i];
      let ownerBox = null;
      for (let j = 0; j < activeBoxes.length; j++) {
        if (activeBoxes[j] && activeBoxes[j].contains && activeBoxes[j].contains(p)) {
          ownerBox = activeBoxes[j];
          break;
        }
      }
      if (!ownerBox || !activeSet.has(ownerBox)) {
        hideMetricsTooltipIfOwner(p);
        p.remove();
      } else {
        kept.push({ pill: p, box: ownerBox });
      }
    }
    if (window.__ag_active_tooltip_pill && !window.__ag_active_tooltip_pill.isConnected) {
      hideMetricsTooltipIfOwner(null);
    }
    return kept;
  }

  function assignPrimaryPillIds(mountedEntries, primaryCid) {
    if (!Array.isArray(mountedEntries) || mountedEntries.length === 0) return null;
    let primary = null;
    for (let i = 0; i < mountedEntries.length; i++) {
      const { pill, box } = mountedEntries[i];
      const focused = !(box.closest && box.closest('[data-pane-unfocused]'));
      if (focused && (!primaryCid || pill.getAttribute('data-ag-cascade-id') === primaryCid)) {
        primary = pill;
        break;
      }
    }
    if (!primary) {
      for (let i = 0; i < mountedEntries.length; i++) {
        const { pill, box } = mountedEntries[i];
        if (!(box.closest && box.closest('[data-pane-unfocused]'))) {
          primary = pill;
          break;
        }
      }
    }
    if (!primary && primaryCid) {
      for (let i = 0; i < mountedEntries.length; i++) {
        if (mountedEntries[i].pill.getAttribute('data-ag-cascade-id') === primaryCid) {
          primary = mountedEntries[i].pill;
          break;
        }
      }
    }
    if (!primary) primary = mountedEntries[0].pill;

    for (let i = 0; i < mountedEntries.length; i++) {
      const p = mountedEntries[i].pill;
      const t = getPillTextEl(p);
      if (p === primary) {
        if (p.id !== 'ag-live-metrics-pill') p.id = 'ag-live-metrics-pill';
        if (t && t.id !== 'ag-live-metrics-text') t.id = 'ag-live-metrics-text';
      } else {
        if (p.id) p.removeAttribute('id');
        if (t && t.id) t.removeAttribute('id');
      }
    }
    return primary;
  }

  function applyPayloadToPill(box, pill, payload) {
    if (!pill) return;
    const textEl = getPillTextEl(pill);
    const ttMap = isWeakMapInstance(window.__ag_pill_tooltip_map) ? window.__ag_pill_tooltip_map : pillTooltipMap;
    if (!payload || !payload.hasData) {
      pill.removeAttribute('data-ag-rendered-cid');
      if (textEl && textEl.innerHTML !== '') {
        textEl.innerHTML = '';
      }
      if (pill.style.display !== 'none') pill.style.display = 'none';
      ttMap.delete(pill);
      hideMetricsTooltipIfOwner(pill);
      return;
    }
    const renderedCid = String(payload.cascadeId || pill.getAttribute('data-ag-cascade-id') || '').trim().toLowerCase();
    if (renderedCid) {
      if (pill.getAttribute('data-ag-rendered-cid') !== renderedCid) {
        pill.setAttribute('data-ag-rendered-cid', renderedCid);
      }
    } else {
      pill.removeAttribute('data-ag-rendered-cid');
    }
    const nextTooltip = payload.tooltipHtml || '';
    ttMap.set(pill, nextTooltip);
    if (window.__ag_active_tooltip_pill === pill) {
      const tt = document.getElementById('ag-live-metrics-tooltip');
      if (tt && tt.getAttribute('data-visible') === '1' && tt.innerHTML !== nextTooltip) {
        tt.innerHTML = nextTooltip;

      }
    }
    const nextHtml = payload.inlineHtml || '';
    const textChanged = !!(textEl && textEl.innerHTML !== nextHtml);
    if (textEl && textChanged) {
      textEl.innerHTML = nextHtml;
    }
    const wasHidden = pill.style.display !== 'inline-flex';
    if (wasHidden) {
      pill.style.display = 'inline-flex';
    }
    if (wasHidden || textChanged) {
      scheduleDeferredPillLayout(box);
    }
  }

  function syncPillForResolvedCascade(box, pill, cid) {
    if (!pill) return;
    if (!cid) {
      if (pill.hasAttribute('data-ag-cascade-id')) {
        pill.removeAttribute('data-ag-cascade-id');
      }
      applyPayloadToPill(box, pill, null);
      return;
    }
    if (pill.getAttribute('data-ag-cascade-id') !== cid) {
      pill.setAttribute('data-ag-cascade-id', cid);
    }
    const renderedCid = String(pill.getAttribute('data-ag-rendered-cid') || '').trim().toLowerCase();
    const cached = metricsById[cid];
    if (cached && cached.hasData) {
      if (renderedCid !== cid || pill.style.display !== 'inline-flex') {
        applyPayloadToPill(box, pill, cached);
      }
    } else if (renderedCid !== '' || pill.style.display === 'inline-flex') {
      applyPayloadToPill(box, pill, null);
    }
  }

  function ensureMetricsPill(forceLayout = false, resetHysteresis = false) {
    if (IS_SWARM_PLUGIN_FRAME || !metricsIsCurrent()) return null;
    if (!MODULES.metrics) {
      document.querySelectorAll('#ag-live-metrics-pill, .ag-live-metrics-pill, [data-ag-metrics-pill]').forEach((el) => {
        el.style.display = 'none';
      });
      for (const ro of activeMetricsObservers) {
        try {
          ro.disconnect();
        } catch (e) {}
      }
      activeMetricsObservers.clear();
      hideMetricsTooltipIfOwner(null);
      return null;
    }
    const boxes = getAllInputBoxes();
    const totalBoxes = boxes.length;
    const resolvedIds = boxes.map(box => resolveBoxCascadeId(box, totalBoxes));
    const allowed = new Set([...new Set(resolvedIds.filter(Boolean))].slice(0, 12));
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      const pill = ensureMetricsPillForBox(box, forceLayout, resetHysteresis);
      if (pill) {
        const cid = resolvedIds[i];
        syncPillForResolvedCascade(box, pill, allowed.has(cid) ? cid : '');
      }
    }
    const kept = pruneOrphanedPills(boxes);
    return assignPrimaryPillIds(kept, extractFocusedOrPrimaryCascadeId());
  }

  window.__ag_ensure_metrics_pill_fn = ensureMetricsPill;

  window.__ag_render_metrics = function (payload) {
    try {
      if (IS_SWARM_PLUGIN_FRAME || !metricsIsCurrent() || !MODULES.metrics || !payload || typeof payload !== 'object') return false;
      const cid = String(payload.cascadeId || '').trim().toLowerCase();
      if (!CASCADE_UUID_RE.test(cid)) return false;
      const boxes = getAllInputBoxes();
      const totalBoxes = boxes.length;
      if (totalBoxes === 0) return false;
      const resolvedIds = boxes.map(box => resolveBoxCascadeId(box, totalBoxes));
      const allowedIds = [...new Set(resolvedIds.filter(Boolean))].slice(0, 12);
      const targets = boxes.filter((box, i) => resolvedIds[i] === cid);
      if (!allowedIds.includes(cid) || !targets.length) { ensureMetricsPill(false); return false; }
      metricsById[cid] = payload;
      const primaryCid = window.__ag_watched_cascade_id || extractFocusedOrPrimaryCascadeId();
      if (!primaryCid || cid === primaryCid) window.__ag_last_metrics = payload;
      let applied = false;
      let mountedNewPill = false;
      for (const box of targets) {
        let pill = findPillInBox(box);
        if (!pill) {
          pill = ensureMetricsPillForBox(box, false, false);
          if (!pill) continue;
          mountedNewPill = true;
        }
        if (pill.getAttribute('data-ag-cascade-id') !== cid) {
          pill.setAttribute('data-ag-cascade-id', cid);
        }
        applyPayloadToPill(box, pill, payload);
        applied = true;
      }
      if (mountedNewPill) {
        const kept = pruneOrphanedPills(boxes);
        assignPrimaryPillIds(kept, primaryCid);
      }
      return applied;
    } catch (e) { return false; }
  };

  function checkRouteAndMountMetrics() {
    if (!metricsIsCurrent()) return;
    try {
      if (IS_SWARM_PLUGIN_FRAME) {
        if (document.documentElement.getAttribute('data-ag-page-type') !== 'plugin') {
          document.documentElement.setAttribute('data-ag-page-type', 'plugin');
        }
        return;
      }
      if (document.hidden) return;
      const boxes = getAllInputBoxes();
      const totalBoxes = boxes.length;
      const paneCids = [];
      const activeIds = [];
      const seenIds = new Set();
      for (let i = 0; i < boxes.length; i++) {
        const boxCid = resolveBoxCascadeId(boxes[i], totalBoxes);
        paneCids.push(boxCid);
        if (boxCid && !seenIds.has(boxCid)) {
          seenIds.add(boxCid);
          activeIds.push(boxCid);
        }
      }

      const pathname = window.location.pathname;
      const isChatRoute = pathname.startsWith('/c/');
      const primaryCid = extractFocusedOrPrimaryCascadeId() || activeIds[0] || '';
      const isHome =
        pathname === '/' ||
        (!isChatRoute && !primaryCid && activeIds.length === 0) ||
        (!isChatRoute && !!document.querySelector(SELECTORS.homeGreeting));
      const pageType = isHome ? 'home' : 'chat';
      if (document.documentElement.getAttribute('data-ag-page-type') !== pageType) {
        document.documentElement.setAttribute('data-ag-page-type', pageType);
      }

      if (!MODULES.metrics) {
        document.querySelectorAll('#ag-live-metrics-pill, .ag-live-metrics-pill, [data-ag-metrics-pill]').forEach((el) => {
          if (el.style.display !== 'none') el.style.display = 'none';
        });
        hideMetricsTooltipIfOwner(null);
        window.__ag_watched_cascade_ids = [];
        window.__ag_watched_cascade_id = '';
        if (window.__ag_watched_cascade_sig !== '') {
          window.__ag_watched_cascade_sig = '';
          window.__agRequestMetrics?.('[]');
        }
        return;
      }

      const watchedIds = (boxes.length === 0 && isChatRoute ? extractAllPathnameCascadeIds() : activeIds).slice(0, 12);
      const watchedSig = watchedIds.join(',');
      const watchedSet = new Set(watchedIds);
      for (const id of Object.keys(metricsById)) if (!watchedSet.has(id)) delete metricsById[id];

      for (let i = 0; i < boxes.length; i++) {
        const box = boxes[i];
        const pill = ensureMetricsPillForBox(box, false, false);
        if (pill) {
          syncPillForResolvedCascade(box, pill, watchedSet.has(paneCids[i]) ? paneCids[i] : '');
        }
      }

      const kept = pruneOrphanedPills(boxes);
      assignPrimaryPillIds(kept, primaryCid);

      const primaryWatched = (primaryCid && seenIds.has(primaryCid) ? primaryCid : watchedIds[0]) || '';
      window.__ag_watched_cascade_ids = watchedIds;
      window.__ag_watched_cascade_id = primaryWatched;
      window.__ag_last_metrics = primaryWatched ? metricsById[primaryWatched] || null : null;

      if (watchedSig !== window.__ag_watched_cascade_sig) {
        window.__ag_watched_cascade_sig = watchedSig;
        if (typeof window.__agRequestMetrics === 'function') {
          try {
            window.__agRequestMetrics(JSON.stringify(watchedIds));
          } catch (e) {}
        }
      }
    } catch (e) {}
  }

  function scheduleRouteCheck() {
    if (IS_SWARM_PLUGIN_FRAME) return;
    if (routeCheckRafId) {
      try {
        cancelAnimationFrame(routeCheckRafId);
      } catch (e) {}
      activeMetricsRafs.delete(routeCheckRafId);
      routeCheckRafId = 0;
    }
    if (metricsRouteTimers.size > 0) {
      for (const tid of metricsRouteTimers) {
        try {
          clearTimeout(tid);
        } catch (e) {}
      }
      metricsRouteTimers.clear();
    }
    const runCheck = () => {
      if (typeof window.__ag_check_route_fn === 'function') window.__ag_check_route_fn();
    };
    routeCheckRafId = scheduleTrackedHandle(activeMetricsRafs, requestAnimationFrame, () => {
      routeCheckRafId = 0;
      scheduleTrackedHandle(metricsRouteTimers, (cb) => setTimeout(cb, 0), runCheck);
    });
    for (const delay of [120, 400]) {
      scheduleTrackedHandle(metricsRouteTimers, (cb) => setTimeout(cb, delay), runCheck);
    }
  }

  window.__ag_trigger_route_check_fn = scheduleRouteCheck;
  window.__ag_metrics_focusin_fn = (e) => {
    const t = e && e.target;
    if (!t || !t.closest) return;
    if (t.closest(METRICS_FOCUSIN_MATCH_SELECTOR)) {
      scheduleRouteCheck();
    }
  };
  window.__ag_metrics_click_fn = (e) => {
    const t = e && e.target;
    if (!t || !t.closest) return;
    if (t.closest('[data-tab-id], [data-side-panel-strip]')) {
      scheduleRouteCheck();
    }
  };

  if (!IS_SWARM_PLUGIN_FRAME && !window.__ag_metrics_focusin_installed) {
    window.__ag_metrics_focusin_installed = true;
    document.addEventListener(
      'focusin',
      (e) => {
        if (typeof window.__ag_metrics_focusin_fn === 'function') {
          window.__ag_metrics_focusin_fn(e);
        }
      },
      true
    );
  }
  if (!IS_SWARM_PLUGIN_FRAME && !window.__ag_metrics_click_installed) {
    window.__ag_metrics_click_installed = true;
    document.addEventListener(
      'click',
      (e) => {
        if (typeof window.__ag_metrics_click_fn === 'function') {
          window.__ag_metrics_click_fn(e);
        }
      },
      true
    );
  }

  if (!IS_SWARM_PLUGIN_FRAME && !window.__ag_history_hook_installed) {
    window.__ag_history_hook_installed = true;
    const triggerRouteCheck = () => window.__ag_trigger_route_check_fn?.();
    const wrapHistory = (type) => {
      const orig = history[type];
      if (typeof orig !== 'function') return;
      history[type] = function (...args) {
        const ret = orig.apply(this, args);
        triggerRouteCheck();
        return ret;
      };
    };
    wrapHistory('pushState');
    wrapHistory('replaceState');
    window.addEventListener('popstate', triggerRouteCheck);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && typeof window.__ag_check_route_fn === 'function') {
        window.__ag_check_route_fn();
      }
    });
  }

  window.__ag_check_route_fn = checkRouteAndMountMetrics;

  if (window.__ag_metrics_route_watcher) {
    try {
      clearInterval(window.__ag_metrics_route_watcher);
    } catch (e) {}
    window.__ag_metrics_route_watcher = null;
  }
  if (!IS_SWARM_PLUGIN_FRAME) {
    window.__ag_metrics_route_watcher = setInterval(checkRouteAndMountMetrics, 3000);
  }
  if (document.body || IS_SWARM_PLUGIN_FRAME) {
    checkRouteAndMountMetrics();
  }

  // ============================================================================
  // 4. 高性能界面汉化引擎（无原型词典 + WeakMap O(1) 隔离缓存 + 单遍扫描 + 首字符分流）
  // ============================================================================
  if (window.__ag_i18n_observer) {
    try {
      window.__ag_i18n_observer.disconnect();
    } catch (e) {}
    window.__ag_i18n_observer = null;
  }

  const DICT = Object.assign(Object.create(null), boot.i18nDict || {});
  window.__ag_i18n_dict = DICT;

  // 大小写不敏感兜底索引与弯撇号 (\u2018/\u2019 -> ') 归一化（2.31.1+ 并存多种大小写与排版弯引号文案）
  // 仅对首字母大写的界面文案启用大小写兜底，避免误伤小写标识符；精确匹配始终优先。
  const RE_CURLY_APOS = /[\u2018\u2019]/g;
  const DICT_APOS = new Map();
  const DICT_CI = new Map();
  for (const k in DICT) {
    const v = DICT[k];
    if (typeof v !== 'string') continue;
    const kNorm = k.indexOf('\u2019') !== -1 || k.indexOf('\u2018') !== -1 ? k.replace(RE_CURLY_APOS, "'") : k;
    if (kNorm !== k && !(kNorm in DICT) && !DICT_APOS.has(kNorm)) {
      DICT_APOS.set(kNorm, v);
    }
    const lk = kNorm.toLowerCase();
    if (!DICT_CI.has(lk)) DICT_CI.set(lk, v);
  }
  const SWARM_FRAME_ONLY_DICT = IS_SWARM_PLUGIN_FRAME
    ? {
        Coordinator: '协调器',
        Goal: '目标',
        Threads: '任务组',
        Now: '当前',
        Progress: '进度',
        Stuck: '受阻',
        Moving: '推进中',
        Waiting: '等待中',
        Resting: '休眠待命',
        'Standing by': '待命中',
        Blocked: '受阻',
        'Not started': '未开始',
        'In progress': '进行中',
        Reconnecting: '正在重连',
        'Needs you': '需您处理',
        'Planned next': '后续计划',
        Other: '其他',
        Tasks: '任务',
        Task: '任务',
        Active: '活跃中',
        Team: '团队',
        'The team': '团队成员',
        Retired: '已终止',
        Error: '错误',
        Killed: '已终止',
        Frames: '关键帧',
        Previous: '上一帧',
        Next: '下一帧',
        updating: '更新中',
        watching: '监听中',
        stopped: '已停止',
        stale: '待刷新',
        '(archived)': '（已归档）',
        '(empty)': '（空）',
        'tasks done': '项任务已完成'
      }
    : null;

  function dictLookupCore(s) {
    const exact = DICT[s];
    if (typeof exact === 'string') return exact;
    if (SWARM_FRAME_ONLY_DICT) {
      const swarmHit = SWARM_FRAME_ONLY_DICT[s];
      if (typeof swarmHit === 'string') return swarmHit;
    }
    const sNorm = s.indexOf('\u2019') !== -1 || s.indexOf('\u2018') !== -1 ? s.replace(RE_CURLY_APOS, "'") : s;
    if (sNorm !== s) {
      const exactNorm = DICT[sNorm];
      if (typeof exactNorm === 'string') return exactNorm;
    }
    if (DICT_APOS.size > 0) {
      const aposAlias = DICT_APOS.get(sNorm);
      if (typeof aposAlias === 'string') return aposAlias;
    }
    const c0 = sNorm.charCodeAt(0);
    if (c0 < 65 || c0 > 90) return undefined;
    return DICT_CI.get(sNorm.toLowerCase());
  }

  function dictLookup(s) {
    if (!s) return undefined;
    const hit = dictLookupCore(s);
    if (typeof hit === 'string') return hit;
    if (s.endsWith('\u2026')) return dictLookupCore(s.slice(0, -1) + '...');
    if (s.endsWith('...')) return dictLookupCore(s.slice(0, -3) + '\u2026');
    return undefined;
  }

  let scanBodyFn = null;
  const I18N_OBS_OPTS = {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['title', 'aria-label', 'placeholder']
  };

  if (MODULES.i18n) {
    function splitTopLevelSelectors(selStr) {
      const parts = [];
      let cur = '';
      let bracketDepth = 0;
      let parenDepth = 0;
      let quote = '';
      const s = String(selStr || '');
      for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (quote) {
          cur += ch;
          if (ch === quote && s[i - 1] !== '\\') quote = '';
          continue;
        }
        if (ch === '"' || ch === "'") {
          quote = ch;
          cur += ch;
        } else if (ch === '[') {
          bracketDepth++;
          cur += ch;
        } else if (ch === ']') {
          if (bracketDepth > 0) bracketDepth--;
          cur += ch;
        } else if (ch === '(') {
          parenDepth++;
          cur += ch;
        } else if (ch === ')') {
          if (parenDepth > 0) parenDepth--;
          cur += ch;
        } else if (ch === ',' && bracketDepth === 0 && parenDepth === 0) {
          if (cur.trim()) parts.push(cur.trim());
          cur = '';
        } else {
          cur += ch;
        }
      }
      if (cur.trim()) parts.push(cur.trim());
      return parts;
    }

    const CONTAINER_IMMUTABLE_EXCLUDE_SELECTOR =
      'code, pre, kbd, samp, style, script, noscript, [data-markdown-root], [data-testid="user-message-content"], .agy-user-bubble, .monaco-editor, .monaco-diff-editor, .xterm, [data-uri^="file:"], [data-uri^="vscode-"], a.inline-pill[href^="file:"], a.inline-pill[href^="vscode-"], #ag-live-metrics-pill, .ag-live-metrics-pill, [data-ag-metrics-pill], #ag-live-metrics-tooltip, #ag-token-nav-section, #ag-token-analytics-panel, #ag-ta-tooltip, [data-ag-token-ui], .msg-body, #raw, [data-testid="swarm-raw"], #swarm-title';
    const TEXT_IMMUTABLE_EXCLUDE_SELECTOR =
      'textarea, input, [contenteditable="true"], [data-testid="conversation-navigator-turn"], ' +
      CONTAINER_IMMUTABLE_EXCLUDE_SELECTOR;

    const mergedExcludeParts = splitTopLevelSelectors(DEFAULT_EXCLUDE_I18N);
    // Read the raw payload, not SELECTORS' defaulted value: a default container
    // exclusion is not an explicit user veto of Markdown UI metadata.
    const userExcludeParts = splitTopLevelSelectors(boot.selectors?.excludeI18n);
    for (let i = 0; i < userExcludeParts.length; i++) {
      if (!mergedExcludeParts.includes(userExcludeParts[i])) {
        mergedExcludeParts.push(userExcludeParts[i]);
      }
    }
    const EXCLUDE_SELECTOR = mergedExcludeParts.join(', ');
    // Only lift Markdown's container exclusion for its UI metadata. All other
    // immutable/user exclusions still apply, including editable content and paths.
    const MARKDOWN_ATTR_EXCLUDE_SELECTOR = splitTopLevelSelectors(DEFAULT_EXCLUDE_I18N)
      .filter(tok => !['[data-markdown-root]', '.prose', '.markdown', '.select-text'].includes(tok))
      .concat(userExcludeParts)
      .concat('[contenteditable]', '[data-lexical-editor]', '[data-composer]', '.ProseMirror', '[class*="language-"]', '[data-path]', '[data-file-path]')
      .join(', ');
    const FORM_ATTR_EXCLUDE_SELECTOR = mergedExcludeParts
      .filter((tok) => {
        const low = tok.toLowerCase().replace(/\s+/g, '');
        return (
          low !== 'input' &&
          low !== 'textarea' &&
          low !== '[contenteditable="true"]' &&
          low !== "[contenteditable='true']" &&
          low !== '[contenteditable]' &&
          low !== '[data-testid="conversation-navigator-turn"]' &&
          low !== "[data-testid='conversation-navigator-turn']"
        );
      })
      .join(', ');

    function isFormAttrTarget(el) {
      return !!(
        el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          (el.getAttribute &&
            (el.getAttribute('contenteditable') === 'true' ||
              el.getAttribute('data-testid') === 'conversation-navigator-turn')))
      );
    }

    const immutableTextExclCache = new WeakMap();
    const immutableContainerExclCache = new WeakMap();

    // 预编译模块级正则常量，消除热路径重复编译与二次匹配
    const RE_HAS_CJK = /[\u4e00-\u9fa5]/;
    const RE_PURE_ALPHA = /^\s*[a-zA-Z]+\s*$/;
    const RE_HAS_ALPHA = /[a-zA-Z]/;
    const RE_REL_TIME = /^(\d+)\s*(s|sec|secs|m|min|mins|h|hr|hrs|d|w|mo|y|yr|yrs)\s+ago$/i;
    const REL_UNIT_MAP = {
      s: '秒',
      sec: '秒',
      secs: '秒',
      m: '分钟',
      min: '分钟',
      mins: '分钟',
      h: '小时',
      hr: '小时',
      hrs: '小时',
      d: '天',
      w: '周',
      mo: '个月',
      y: '年',
      yr: '年',
      yrs: '年'
    };
    const UNIT_MAP_SHORT = { s: '秒', m: '分钟', h: '小时', d: '天', w: '周', mo: '个月', y: '年', yr: '年' };
    const NAMED_PERIOD_MAP = { weekly: '每周', daily: '每日', monthly: '每月' };
    const MONTH_SHORT_MAP = {
      jan: 1,
      feb: 2,
      mar: 3,
      apr: 4,
      may: 5,
      jun: 6,
      jul: 7,
      aug: 8,
      sep: 9,
      oct: 10,
      nov: 11,
      dec: 12
    };
    // 客户端 main.js ($Q 权限编辑器) 在 onBlur 中硬编码判断 relatedTarget.getAttribute("aria-label") === "Cancel"
    const SKIP_ARIA_LABEL_VALUES = new Set(['Cancel']);

    const RE_PCT_LEFT = /^(\d+(?:\.\d+)?)%\s*left$/i;
    const RE_WINDOW_LIMIT_COMBINED = /^(\d+)\s*([smhd])\s+limit,\s*resets in\s+(.+)$/i;
    const RE_WINDOW_LIMIT = /^(\d+)\s*([smhd])\s+limit$/i;
    const RE_NAMED_LIMIT_RESETS = /^(Weekly|Daily|Monthly)\s+limit,\s*resets in\s+(.+)$/i;
    const RE_RESETS_IN = /^Resets in\s+(.+)$/i;
    const RE_SEARCH_GOOGLE = /^Search Google for "(.+)"$/;
    const RE_UPDATED_AT =
      /^Updated\s+(?:((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}|\d{1,2}月\d{1,2}日),\s*)?((?:上午|下午)?\s*\d{1,2}:\d{2}(?:\s*[AP]M)?)$/;

    const RE_FILES_CHANGED = /^(\d+)\s+files?\s+changed$/i;
    const RE_TOOLS = /^(\d+)\s+tools?$/i;
    const RE_DEMOTED = /^(\d+)\s+demoted$/i;
    const RE_EXCLUDED = /^(\d+)\s+excluded$/i;
    const RE_TOOLS_EXCLUDED = /^(\d+)\s+tools?\s+excluded$/i;
    const RE_ACTIVE_CONVS = /^(\d+)\s+active\s+conversations?$/i;
    const RE_ARCHIVED_CONVS = /^(\d+)\s+archived\s+conversations?$/i;
    const RE_PINNED_COUNT = /^(\d+)\s+pinned(?:\s+tabs?)?$/i;
    const RE_MODELS_SELECTED = /^(\d+)\s+models?\s+selected$/i;
    const RE_BROWSER_STEPS = /^(\d+)\s+browser\s+steps?$/i;
    const RE_MEDIA_ATTACHMENTS = /^(\d+)\s+(image|audio|video)\s+attachments?$/i;
    const RE_ATTACHMENTS_COUNT = /^(\d+)\s+attachments?$/i;
    const RE_IMAGES_COUNT = /^(\d+)\s+images?$/i;
    const RE_COMMENTS_COUNT = /^(\d+)\s+comments?$/i;
    const RE_SIDE_QUESTIONS_COUNT = /^(\d+)\s+side\s+questions?$/i;
    const RE_RESUME_COMMENT_DRAFTS = /^Resume\s+(\d+)\s+comment\s+drafts?$/i;
    const RE_VIEW_SIDE_QUESTIONS = /^View\s+(\d+)\s+side\s+questions?$/i;
    const RE_SIDE_QUESTION_TITLE = /^Side\s+Question:\s*(.+)$/i;
    const RE_OPENS_EXT_LINK = /^Opens\s+external\s+link:\s*(.+)$/i;
    const RE_OPEN_CONV_ID = /^Open\s+conversation\s+([0-9a-f-]{8,36})$/i;
    const RE_OPEN_PLUGIN_NAME = /^Open\s+the\s+([^\r\n]{1,80}?)\s+plugin$/i;
    const RE_EDIT_SIDE_Q_TITLE = /^Edit\s+side\s+question\s+title:\s*(.+)$/i;
    const RE_CONNECTED_TO_HOST = /^Connected\s+to\s+([^\r\n]{1,120})$/;

    // Swarm 侧车专属动态规则（仅在 IS_SWARM_PLUGIN_FRAME 下生效，主窗口零开销零误伤）
    const RE_SWARM_NUM_OF_NUM = /^(\d+)\s+of\s+(\d+)$/i;
    const RE_SWARM_WAITING_ON = /^Waiting\s+on\s+(@?\S+)$/i;
    const RE_SWARM_N_WAITING_ON = /^(\d+)\s+waiting\s+on\s+(@\S+)$/i;
    const RE_SWARM_N_STUCK = /^(\d+)\s+stuck$/i;
    const RE_SWARM_N_NEEDS_YOU = /^(\d+)\s+needs?\s+you$/i;
    const RE_SWARM_N_THREADS_OPEN = /^(\d+)\s+threads?\s+open$/i;
    const RE_SWARM_N_ACTIVE = /^(\d+)\s+active$/i;
    const RE_SWARM_LAST_SEEN = /^last\s+seen\s+(\d+)\s*(m|h|d)\s+ago$/i;
    const RE_SWARM_NOW_FRAC = /^Now\s*·\s*(\d+)\s*\/\s*(\d+)$/i;
    const RE_SWARM_READ_SEQ = /^read\s+#(\d+)(?:\s*·\s*updated\s+(.+))?$/i;
    const RE_SWARM_PAUSED_REASON = /^paused:\s*(quota|error)$/i;
    const RE_SWARM_OV_NOTES = /^overview\s*·\s*from\s+the\s+narrator['\u2019]s\s+notes(?:\s*·\s*(.+))?$/i;
    const RE_SWARM_YOU_SUFFIX = /^([A-Za-z0-9._-]+)\s+\(you\)$/;
    const RE_SWARM_FROM_OPT = /^From\s+([A-Za-z0-9._-]+)$/;
    const RE_SWARM_TO_OPT = /^To\s+(@?[A-Za-z0-9._-]+)$/;
    const RE_SWARM_LIVE_TIP = /^(Thinking|Latest action):\s*([\s\S]+)$/;
    const RE_SWARM_RUNS_ON = /^Runs\s+on\s+(.+)$/i;
    const RE_SWARM_NARRATOR_READ = /^Narrator\s+read\s+up\s+to\s+#(\d+)\s+of\s+(\d+)$/i;
    const RE_SWARM_POSTS_SINCE_UPD = /^(\d+)\s+posts?\s+since\s+the\s+view\s+was\s+updated$/i;
    const RE_SWARM_NARRATOR_FAILED_TIP = /^The\s+narrator['\u2019]s\s+last\s+step\s+failed:\s*(.+)$/i;
    const RE_SWARM_POSTED_IN_CH = /^Posted\s+in\s+#([^\s;]+);\s*click\s+to\s+show\s+only\s+#\1$/i;
    const RE_SWARM_GOTO_SEQ = /^Go\s+to\s+#(\d+)(?:\s*\((.+)\))?$/i;
    const RE_SWARM_TPROG_DONE = /^(.+?)\s+done$/i;
    const RE_INSTALLED_COUNT = /^(\d+)\s+installed$/i;
    const RE_ACCOUNTS_COUNT = /^(\d+)\s+accounts?$/i;
    const RE_UPDATES_COUNT = /^(\d+)\s+updates?$/i;
    const RE_PROJECTS_COUNT = /^(\d+)\s+projects?$/i;
    const RE_CALLS_MB = /^(\d+)\s+calls?\s*·\s*([\d.]+\s*MB)$/i;
    const RE_TASKS_DONE = /^(\d+)\s+of\s+(\d+)\s+tasks?\s+done$/i;
    const RE_POSTS_COUNT = /^(\d+)\s+posts?$/i;
    const RE_MEMBERS_COUNT = /^(\d+)\s+members?$/i;
    const RE_MCP_FAILED_START = /^(\d+)\s+MCP servers?\s+failed to start$/i;
    const RE_UP_NEXT_COUNT = /^Up next\s*·\s*(\d+)$/i;
    const RE_USES_LOCAL_CLONE = /^Uses your local clone,\s+([^\r\n]{1,100})$/;
    const RE_PLUS_ATTACHMENTS = /^\+(\d+)\s+attachments?$/i;
    const RE_PLUS_MORE = /^\+(\d+)\s+more(\s*\(Show all\))?$/i;
    const RE_SEE_ALL = /^See all\s*\((\d+)\)$/i;
    const RE_SHOW_BREAKDOWNS = /^Show\s+(\d+)\s+breakdowns?$/i;
    const RE_SHOW_MORE_SUBAGENTS = /^Show\s+(\d+)\s+more\s+subagents?$/i;
    const RE_SHOW_EARLIER_STEPS = /^Show\s+(\d+)\s+earlier\s+steps?$/i;
    const RE_SORT_FILTER_ACTIVE = /^Sort and filter conversations\s*\((\d+)\s+active\)$/i;
    const RE_STILL_THINKING_SEC = /^Still thinking,\s*(\d+)\s*seconds?$/i;
    const RE_MARKED_READ = /^Marked\s+(\d+)\s+conversations?\s+as\s+read$/i;
    const RE_ZIPPING_FOLDER = /^Zipping\s+(.+?)(?:…|\.\.\.)$/i;
    const RE_PERM_DELETE = /^Permanently delete\s+(.*)\s+including\s+(\d+)\s+active\s+conversations\.?$/i;
    const RE_WORKED_FOR_UPDATES = /^Worked for\s+([<0-9smhd\s]+?)\s*·\s*(\d+)\s+updates?$/i;
    const RE_WORKED_FOR = /^Worked for\s+([<0-9smhd]+(?:\s+\d+[smhd])*)$/i;
    const RE_WAITING_CMD_SEC = /^Waiting for command completion\s*\(up to\s+(\d+)\s+seconds?\)$/i;
    const RE_HOME_HEY_NAME = /^Hey\s+([^\r\n]{1,40}?),\s+what should we build today\?$/i;
    const RE_HOME_WELCOME_NAME = /^Welcome back,\s*([^\r\n]{1,40}?)\.\s+Where should we pick up\?$/i;
    const RE_HOME_GOOD_SEE_NAME = /^Good to see you,\s*([^\r\n]{1,40}?)\.\s+What['\u2019]s next\?$/i;
    const RE_WORK_LOCALLY_ON = /^Work locally on\s+([^\r\n]{1,80})$/;
    const RE_WORK_IN_TARGET = /^Work in\s+(?!a New Worktree$)([^\r\n]{1,80})$/;
    const RE_WORKTREE_FROM = /^Worktree from\s+([^\r\n,]{1,80}?)(?:,\s*and reuse\s+([^\r\n]{1,80}))?$/;
    const RE_AUTO_FIG_WORKSPACE =
      /^Automatically create a new\s+(Fig|Piper|JJ)\s+workspace when the conversation starts(?:,\s*Worktree from\s+([^\r\n,]{1,80}?))?(?:,\s*and reuse\s+([^\r\n]{1,80}))?$/;
    const RE_THOUGHT_FOR = /^Thought for\s+([<0-9smhd]+(?:\s+\d+[smhd])*)$/i;
    const RE_THINKING_FOR = /^Thinking for\s+([<0-9smhd]+(?:\s+\d+[smhd])*)$/i;
    const RE_USING_BROWSER_SEC = /^Using browser\s*\((\d+)s\)$/i;
    const RE_RUNNING_FOR = /^Running\s+for\s+([<0-9smhd]+(?:\s+\d+[smhd])*)$/i;
    const RE_KEY_QUEUES_AFTER = /^(\S+)\s+Queues after the turn$/i;
    const RE_KEY_SENDS_IMMEDIATELY = /^(\S+)\s+Sends immediately$/i;
    const RE_KEY_EMPTY_NEXT_QUEUE = /^(\S+)\s+On empty prompt,\s*sends next in queue$/i;
    const RE_EPHEMERAL_SUMMARY =
      /^(Explored(?:\s+(?:\d+\s+)?(?:files?|artifacts?)(?:\s+and\s+(?:\d+\s+)?(?:files?|artifacts?))?)?|Ran\s+(?:\d+\s+)?commands?|Edited(?:\s+(?:\d+\s+)?(?:files?|artifacts?)(?:\s+and\s+(?:\d+\s+)?(?:files?|artifacts?))?)?)(?:,\s*(explored(?:\s+(?:\d+\s+)?(?:files?|artifacts?)(?:\s+and\s+(?:\d+\s+)?(?:files?|artifacts?))?)?|ran\s+(?:\d+\s+)?commands?|edited(?:\s+(?:\d+\s+)?(?:files?|artifacts?)(?:\s+and\s+(?:\d+\s+)?(?:files?|artifacts?))?)?))*$/i;
    const EPHEMERAL_CLAUSE_MAP = {
      explored: '已探索',
      'explored file': '已探索文件',
      'explored files': '已探索文件',
      'explored artifact': '已探索 Artifact',
      'explored artifacts': '已探索 Artifact',
      'explored file and artifact': '已探索文件与 Artifact',
      'explored files and artifact': '已探索文件与 Artifact',
      'explored file and artifacts': '已探索文件与 Artifact',
      'explored files and artifacts': '已探索文件与 Artifact',
      'ran command': '已运行命令',
      'ran commands': '已运行命令',
      edited: '已编辑',
      'edited file': '已编辑文件',
      'edited files': '已编辑文件',
      'edited artifact': '已编辑 Artifact',
      'edited artifacts': '已编辑 Artifact',
      'edited file and artifact': '已编辑文件与 Artifact',
      'edited files and artifact': '已编辑文件与 Artifact',
      'edited file and artifacts': '已编辑文件与 Artifact',
      'edited files and artifacts': '已编辑文件与 Artifact'
    };
    const RE_EPHEMERAL_COUNT_CLAUSE = /^(explored|edited|ran)\s+(\d+)\s+(files?|artifacts?|commands?)$/i;
    function translateEphemeralClause(clause) {
      const low = clause.trim().toLowerCase();
      if (EPHEMERAL_CLAUSE_MAP[low]) return EPHEMERAL_CLAUSE_MAP[low];
      const mCount = low.match(RE_EPHEMERAL_COUNT_CLAUSE);
      if (mCount) {
        const vMap = { explored: '已探索', edited: '已编辑', ran: '已运行' };
        const nMap = {
          file: '个文件',
          files: '个文件',
          artifact: '个 Artifact',
          artifacts: '个 Artifact',
          command: '条命令',
          commands: '条命令'
        };
        return vMap[mCount[1]] + ' ' + mCount[2] + ' ' + nMap[mCount[3]];
      }
      return clause.trim();
    }
    const RE_EPHEMERAL_ACTIVE = /^(Editing|Reading|Listing|Searching)\s+(.+)$/;
    const EPHEMERAL_VERB_MAP = {
      Editing: '正在编辑',
      Reading: '正在读取',
      Listing: '正在列出',
      Searching: '正在搜索'
    };
    const EPHEMERAL_NOUN_MAP = {
      file: '文件',
      files: '文件',
      artifact: 'Artifact',
      artifacts: 'Artifact',
      'file and artifact': '文件与 Artifact',
      'files and artifact': '文件与 Artifact',
      'file and artifacts': '文件与 Artifact',
      'files and artifacts': '文件与 Artifact'
    };
    function joinZhVerbNoun(verbZh, nounZh) {
      return /^[A-Za-z0-9]/.test(nounZh) ? verbZh + ' ' + nounZh : verbZh + nounZh;
    }
    const RE_RUNNING_CMD = /^Running\s+(?!commands?\b|processes\b|for\b|\(Dev\b)(.+)$/;
    const RE_DELETED_RECORDINGS = /^Deleted\s+(\d+)\s+recordings?\s*\(([\d.]+\s*MB)\)$/i;
    const RE_DELETE_RECORDINGS_CONFIRM =
      /^This deletes\s+(\d+)\s+call recordings?\s*\(([\d.]+\s*MB)\)\s+from your machine\.\s*You can't undo this\.$/i;
    const RE_USED_LIMIT = /^You have used (some|all|most) of your (weekly|5-hour|five-hour|daily) limit,?\s*it will fully refresh in (.*)\.?$/i;
    const RE_NOT_USED_LIMIT = /^You have not used any of your (weekly|5-hour|five-hour|daily) limit\.?$/i;
    const RE_ORCHESTRATOR_MODEL = /^Orchestrator\s*\(([^)]+)\)$/i;
    const RE_MODEL_OFFLOAD_DESC =
      /^([A-Za-z0-9 .+-]+?)\s+that may offload routine steps to\s+([A-Za-z0-9 .+-]+?)\.\s*Same\s+([A-Za-z0-9 .+-]+?)-level quality,\s*fewer tokens used\.?$/i;
    const RE_MODEL_REMOVED_ON = /^(.+?)\s+will be removed from Antigravity on\s+(.+?)\.?$/i;
    const RE_MODEL_PERIOD_LIMIT =
      /^(Gemini\b[\w .+-]*?|Claude\b[\w .+-]*?|GPT\b[\w .+-]*?|Orchestrator\b[\w .+()-]*?)\s+(Weekly|Daily|Monthly)\s+Limit$/i;
    const RE_MODEL_EFFORT_LABEL =
      /^(Gemini\b[\w .+-]*?|Claude\b[\w .+-]*?|GPT\b[\w .+-]*?)\s+(?:\((Extra\s+High|Minimal|Low|Medium|High|Extra|XHigh|Max)\)|(Extra\s+High|Minimal|Low|Medium|High|Extra|XHigh|Max))$/i;
    const RE_YOUR_PLAN = /^Your Plan:\s*([^\r\n]{1,80})$/;
    const RE_AVAILABLE_AI_CREDITS = /^Available AI Credits:\s*([^\r\n]{1,40})$/i;
    const RE_EXITED_CODE_ONLY = /^Exited with code\s+(-?\d+)(\.)?$/i;
    const RE_SUMMARY_EXITED_CODE = /^([^\r\n]{1,220}?)\s*·\s*Exited with code\s+(-?\d+)$/;
    const RE_QUOTA_RESET_SWITCH =
      /^Your quota for\s+(.+?)\s+will reset on\s+(.+?)\.\s*Switch to another available model to continue\.?$/i;
    const RE_QUOTA_REACHED_SWITCH =
      /^Your quota for\s+(.+?)\s+has been reached\.\s*Switch to another available model to continue\.?$/i;
    const RE_NEED_CREDITS_MODEL =
      /^You need\s+(?:at least\s+(\d+)|more)\s+AI Credits to send messages\.\s*To continue using\s+(.+?)\s+now,\s*purchase more AI Credits\.(?:\s*Your plan's baseline quota will refresh on\s+(.+?)\.)?(?:\s*To continue using this model now,\s*enable AI Credit overages\.)?$/i;
    const RE_BASELINE_QUOTA_REFRESH = /^Your plan's baseline quota will refresh on\s+(.+?)\.?$/i;
    const RE_ARIA_BRANCH = /^Branch, current:\s*(.*)$/i;
    const RE_ARIA_PROJECT = /^Select project(?:, current)?:\s*(.*)$/i;
    const RE_ARIA_LOCATION = /^(?:Where the agent runs, current|Select location(?:, current)?):\s*(.*)$/i;
    const RE_ARIA_VERSION = /^Version\s+(\d+(?:\.\d+)+(?:-[0-9A-Za-z.-]+)?(?:\s*·\s*[^\r\n]{1,32})?)$/i;
    const RE_ARIA_MODEL = /^(?:Select model|Model(?:\s+selector)?)(?:,\s*current)?:\s*(.*)$/i;
    const RE_ARIA_PERM_SEL =
      /^(?:(?:Permission mode|Agent permissions preset)\s+selector(?:,\s*current)?|(?:Permission mode|Agent permissions preset),\s*current):\s*(.*)$/i;
    const RE_ARIA_PERM_FIXED =
      /^(?:Permission mode|Agent permissions preset):\s*(.+?)(?:\s*,\s*(.+?)|\s+\((cannot be changed[^)]*)\))?$/i;
    const RE_ARIA_TURN = /^(?:Conversation turn\s+(\d+)\s+by\s+(User|Agent|Assistant)|Turn\s+(\d+)\s+of\s+(\d+))$/i;
    const RE_ARIA_GOTO_TURN = /^Go to turn\s+(\d+)\s+of\s+(\d+)$/i;
    const RE_ARIA_LOAD_OLDER = /^(?:Load\s+(\d+)\s+older\s+turns?.*|(Load|No more) older messages,\s*showing\s+(\d+)\s+of\s+(\d+))$/i;
    const RE_EFFORT_SUFFIX =
      /^(.*?)\s*(?:\((Extra\s+High|Minimal|Low|Medium|High|Extra|XHigh|Max)(?:\s+thinking)?\)|\b(Extra\s+High|Minimal|Low|Medium|High|Extra|XHigh|Max))(?:\s*·\s*(.+))?\s*$/i;
    const EFFORT_MAP = { minimal: '最低', low: '低', medium: '中', high: '高', extra: '超高', 'extra high': '超高', xhigh: '超高', max: '最高' };
    const MONTH_FULL_MAP = {
      january: 1,
      february: 2,
      march: 3,
      april: 4,
      may: 5,
      june: 6,
      july: 7,
      august: 8,
      september: 9,
      october: 10,
      november: 11,
      december: 12
    };

    function formatEnglishDateZh(dateStr) {
      const s = String(dateStr || '').trim().replace(/\.$/, '');
      const m = s.match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
      if (m) {
        const mon = MONTH_FULL_MAP[m[1].toLowerCase()] || MONTH_SHORT_MAP[m[1].slice(0, 3).toLowerCase()];
        if (mon) return m[3] + ' 年 ' + mon + ' 月 ' + m[2] + ' 日';
      }
      return s + ' ';
    }

    function formatCompactDurationZh(str) {
      const s = String(str || '').trim();
      if (/^<\s*\d+\s*[smhd]$/i.test(s)) return '不到 ' + formatCompactDurationZh(s.slice(1));
      return s
        .replace(/(\d+)\s*d\b/gi, '$1 天')
        .replace(/(\d+)\s*h\b/gi, '$1 小时')
        .replace(/(\d+)\s*m\b/gi, '$1 分钟')
        .replace(/(\d+)\s*s\b/gi, '$1 秒')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function formatUpdatedAtZh(datePart, timePart) {
      if (!datePart) return '更新于 ' + timePart.trim();
      const mEnDate = datePart.trim().match(/^([A-Za-z]{3})\s+(\d{1,2})$/);
      if (mEnDate) {
        const mNum = MONTH_SHORT_MAP[mEnDate[1].toLowerCase()];
        if (mNum) {
          return '更新于 ' + mNum + '月' + mEnDate[2] + '日 ' + timePart.trim();
        }
      }
      return '更新于 ' + datePart.trim() + ' ' + timePart.trim();
    }

    function isExcludedElement(el, batchSafeSet) {
      if (!el || el.nodeType !== 1) return true;
      if (immutableTextExclCache.get(el) === true) return true;
      if (batchSafeSet && batchSafeSet.has(el)) return false;
      const excludedAncestor = el.closest(EXCLUDE_SELECTOR);
      if (excludedAncestor) {
        if (
          el.isConnected &&
          ((excludedAncestor.matches && excludedAncestor.matches(TEXT_IMMUTABLE_EXCLUDE_SELECTOR)) ||
            el.closest(TEXT_IMMUTABLE_EXCLUDE_SELECTOR))
        ) {
          immutableTextExclCache.set(el, true);
        }
        return true;
      }
      if (batchSafeSet) batchSafeSet.add(el);
      return false;
    }

    const MARKDOWN_UI_ATTR_SELECTOR =
      'button[aria-label], button[title], [role="region"][aria-label], span[aria-label^="Opens external link:"], span[data-ag-orig-aria-label^="Opens external link:"]';

    function isMarkdownChromeAttrTarget(el) {
      return !!(
        el &&
        el.nodeType === 1 &&
        el.matches &&
        el.matches(MARKDOWN_UI_ATTR_SELECTOR) &&
        el.closest('[data-markdown-root]') &&
        !el.closest(MARKDOWN_ATTR_EXCLUDE_SELECTOR)
      );
    }

    function canTranslateElementAttrs(el, batchSafeSet) {
      if (!el || el.nodeType !== 1) return false;
      if (isMarkdownChromeAttrTarget(el)) return true;
      if (isFormAttrTarget(el)) {
        if (immutableContainerExclCache.get(el) === true) return false;
        if (el.closest(CONTAINER_IMMUTABLE_EXCLUDE_SELECTOR)) {
          if (el.isConnected) immutableContainerExclCache.set(el, true);
          return false;
        }
        return FORM_ATTR_EXCLUDE_SELECTOR ? !el.closest(FORM_ATTR_EXCLUDE_SELECTOR) : true;
      }
      return !isExcludedElement(el, batchSafeSet);
    }

    function isInHeaderOrBreadcrumb(el) {
      return !!(el && el.closest && el.closest('header, [data-testid="breadcrumb-segment"]'));
    }

    function computeTextTranslation(raw, contextEl) {
      if (!raw) return null;
      const trimmed = raw.trim();
      if (!trimmed) return null;

      // 1. 无原型静态词典 O(1) 精确匹配（附句尾句号自动回退；函数式 replace 防止 $&/$1 二次展开）
      let replacement = dictLookup(trimmed);
      if (typeof replacement !== 'string' && trimmed.endsWith('.')) {
        const withoutDot = dictLookup(trimmed.slice(0, -1));
        if (typeof withoutDot === 'string') {
          replacement = withoutDot.endsWith('。') ? withoutDot : withoutDot + '。';
        }
      }
      if (typeof replacement === 'string') {
        if (RE_HAS_CJK.test(replacement) && RE_PURE_ALPHA.test(raw)) {
          return replacement;
        }
        return raw.replace(trimmed, () => replacement);
      }

      // 2. 快速短路：不含任何英文字母直接跳过动态正则
      if (!RE_HAS_ALPHA.test(trimmed)) return null;

      // 3. 首字符 O(1) 分流动态正则匹配
      const c0 = trimmed.charCodeAt(0);
      if (c0 >= 48 && c0 <= 57) {
        // 以数字 '0'-'9' 开头
        if (RE_PCT_LEFT.test(trimmed)) return raw.replace(RE_PCT_LEFT, '$1% 剩余');
        const mWinComb = trimmed.match(RE_WINDOW_LIMIT_COMBINED);
        if (mWinComb) {
          const u = UNIT_MAP_SHORT[mWinComb[2].toLowerCase()] || mWinComb[2];
          return raw.replace(trimmed, () => mWinComb[1] + ' ' + u + '限额，' + formatCompactDurationZh(mWinComb[3]) + '后重置');
        }
        const mWin = trimmed.match(RE_WINDOW_LIMIT);
        if (mWin) {
          const u = UNIT_MAP_SHORT[mWin[2].toLowerCase()] || mWin[2];
          return raw.replace(trimmed, () => mWin[1] + ' ' + u + '限额');
        }
        const mRel = trimmed.match(RE_REL_TIME);
        if (mRel) {
          const unit = REL_UNIT_MAP[mRel[2].toLowerCase()] || mRel[2];
          return raw.replace(trimmed, () => mRel[1] + ' ' + unit + '前');
        }
        if (RE_UPDATES_COUNT.test(trimmed)) return raw.replace(RE_UPDATES_COUNT, '$1 条进展');
        if (RE_FILES_CHANGED.test(trimmed)) return raw.replace(RE_FILES_CHANGED, '$1 个文件变更');
        if (RE_TOOLS.test(trimmed)) return raw.replace(RE_TOOLS, '$1 个工具');
        if (RE_DEMOTED.test(trimmed)) return raw.replace(RE_DEMOTED, '$1 项已降级');
        if (RE_EXCLUDED.test(trimmed)) return raw.replace(RE_EXCLUDED, '$1 项已排除');
        if (RE_TOOLS_EXCLUDED.test(trimmed)) return raw.replace(RE_TOOLS_EXCLUDED, '$1 个工具已排除');
        if (RE_ACTIVE_CONVS.test(trimmed)) return raw.replace(RE_ACTIVE_CONVS, '$1 个进行中的对话');
        if (RE_ARCHIVED_CONVS.test(trimmed)) return raw.replace(RE_ARCHIVED_CONVS, '$1 个已归档对话');
        if (RE_PINNED_COUNT.test(trimmed)) return raw.replace(RE_PINNED_COUNT, '$1 个已固定标签页');
        if (RE_MODELS_SELECTED.test(trimmed)) return raw.replace(RE_MODELS_SELECTED, '已选择 $1 个模型');
        if (RE_BROWSER_STEPS.test(trimmed)) return raw.replace(RE_BROWSER_STEPS, '$1 个浏览器步骤');
        const mMediaAtt = trimmed.match(RE_MEDIA_ATTACHMENTS);
        if (mMediaAtt) {
          const mediaMap = { image: '图片', audio: '音频', video: '视频' };
          const mediaZh = mediaMap[mMediaAtt[2].toLowerCase()] || mMediaAtt[2];
          return raw.replace(trimmed, () => mMediaAtt[1] + ' 个' + mediaZh + '附件');
        }
        if (RE_ATTACHMENTS_COUNT.test(trimmed)) return raw.replace(RE_ATTACHMENTS_COUNT, '$1 个附件');
        if (RE_IMAGES_COUNT.test(trimmed)) return raw.replace(RE_IMAGES_COUNT, '$1 张图片');
        if (RE_COMMENTS_COUNT.test(trimmed)) return raw.replace(RE_COMMENTS_COUNT, '$1 条评论');
        if (RE_SIDE_QUESTIONS_COUNT.test(trimmed)) return raw.replace(RE_SIDE_QUESTIONS_COUNT, '$1 个支线提问');
        if (RE_INSTALLED_COUNT.test(trimmed)) return raw.replace(RE_INSTALLED_COUNT, '已安装 $1 项');
        if (RE_ACCOUNTS_COUNT.test(trimmed)) return raw.replace(RE_ACCOUNTS_COUNT, '$1 个账号');
        if (RE_PROJECTS_COUNT.test(trimmed)) return raw.replace(RE_PROJECTS_COUNT, '$1 个项目');
        if (RE_CALLS_MB.test(trimmed)) return raw.replace(RE_CALLS_MB, '$1 次通话 · $2');
        if (RE_TASKS_DONE.test(trimmed)) return raw.replace(RE_TASKS_DONE, '已完成 $1 / $2 项任务');
        if (RE_POSTS_COUNT.test(trimmed)) return raw.replace(RE_POSTS_COUNT, '$1 条发言');
        if (RE_MEMBERS_COUNT.test(trimmed)) return raw.replace(RE_MEMBERS_COUNT, '$1 名成员');
        if (RE_MCP_FAILED_START.test(trimmed)) return raw.replace(RE_MCP_FAILED_START, '$1 个 MCP 服务器启动失败');
        if (IS_SWARM_PLUGIN_FRAME) {
          if (RE_SWARM_N_WAITING_ON.test(trimmed)) return raw.replace(RE_SWARM_N_WAITING_ON, '$1 项等待 $2');
          if (RE_SWARM_N_STUCK.test(trimmed)) return raw.replace(RE_SWARM_N_STUCK, '$1 项受阻');
          if (RE_SWARM_N_NEEDS_YOU.test(trimmed)) return raw.replace(RE_SWARM_N_NEEDS_YOU, '$1 项需要您处理');
          if (RE_SWARM_N_THREADS_OPEN.test(trimmed)) return raw.replace(RE_SWARM_N_THREADS_OPEN, '$1 个任务组未完成');
          if (RE_SWARM_N_ACTIVE.test(trimmed)) return raw.replace(RE_SWARM_N_ACTIVE, '$1 项活跃');
          if (contextEl && contextEl.closest && contextEl.closest('.o2-progt') && RE_SWARM_NUM_OF_NUM.test(trimmed)) {
            return raw.replace(RE_SWARM_NUM_OF_NUM, '$1 / $2');
          }
        }
        return null;
      }
      if (c0 === 43) {
        // 以 '+' 开头
        if (RE_PLUS_ATTACHMENTS.test(trimmed)) return raw.replace(RE_PLUS_ATTACHMENTS, '+$1 个附件');
        const mPlusMore = trimmed.match(RE_PLUS_MORE);
        if (mPlusMore) {
          return raw.replace(trimmed, () => (mPlusMore[2] ? '+' + mPlusMore[1] + ' 更多（显示全部）' : '+' + mPlusMore[1] + ' 更多'));
        }
        return null;
      }

      const firstUpper = trimmed[0].toUpperCase();
      if (IS_SWARM_PLUGIN_FRAME) {
        if (firstUpper === 'W' && RE_SWARM_WAITING_ON.test(trimmed)) {
          return raw.replace(RE_SWARM_WAITING_ON, (_, target) => /^\d+$/.test(target) ? '等待 ' + target + ' 方响应' : '等待 ' + target);
        }
        if (firstUpper === 'L') {
          const mSeen = trimmed.match(RE_SWARM_LAST_SEEN);
          if (mSeen) {
            const u = UNIT_MAP_SHORT[mSeen[2].toLowerCase()] || mSeen[2];
            return raw.replace(trimmed, () => '上次活跃 ' + mSeen[1] + ' ' + u + '前');
          }
        }
        if (firstUpper === 'N' && RE_SWARM_NOW_FRAC.test(trimmed)) {
          return raw.replace(RE_SWARM_NOW_FRAC, '当前 · $1 / $2');
        }
        if (firstUpper === 'R') {
          const mRead = trimmed.match(RE_SWARM_READ_SEQ);
          if (mRead) {
            const updPart = mRead[2] ? ' · 更新于 ' + (computeTextTranslation(mRead[2].trim(), contextEl) || mRead[2].trim()) : '';
            return raw.replace(trimmed, () => '已读 #' + mRead[1] + updPart);
          }
        }
        if (firstUpper === 'P') {
          const mPaused = trimmed.match(RE_SWARM_PAUSED_REASON);
          if (mPaused) {
            return raw.replace(trimmed, () => '已暂停：' + (mPaused[1].toLowerCase() === 'quota' ? '配额耗尽' : '错误'));
          }
        }
        if (firstUpper === 'O') {
          const mOvNotes = trimmed.match(RE_SWARM_OV_NOTES);
          if (mOvNotes) {
            const rRaw = mOvNotes[1] ? mOvNotes[1].trim() : '';
            const rZh = rRaw ? dictLookup(rRaw) || rRaw : '';
            return raw.replace(trimmed, () => '概览 · 来自纪要员记录' + (rZh ? ' · ' + rZh : ''));
          }
        }
        if (firstUpper === 'F' && contextEl && contextEl.tagName === 'OPTION' && RE_SWARM_FROM_OPT.test(trimmed)) {
          return raw.replace(RE_SWARM_FROM_OPT, '来自 $1');
        }
        if (firstUpper === 'T' && contextEl && contextEl.tagName === 'OPTION' && RE_SWARM_TO_OPT.test(trimmed)) {
          return raw.replace(RE_SWARM_TO_OPT, '发给 $1');
        }
        if (trimmed.endsWith('(you)') && RE_SWARM_YOU_SUFFIX.test(trimmed)) {
          return raw.replace(RE_SWARM_YOU_SUFFIX, '$1（您）');
        }
      }
      if (firstUpper === 'S') {
        if (RE_SEE_ALL.test(trimmed)) return raw.replace(RE_SEE_ALL, '查看全部 ($1)');
        if (RE_SHOW_BREAKDOWNS.test(trimmed)) return raw.replace(RE_SHOW_BREAKDOWNS, '展开明细 ($1 项)');
        if (RE_SHOW_MORE_SUBAGENTS.test(trimmed)) return raw.replace(RE_SHOW_MORE_SUBAGENTS, '显示另外 $1 个子 Agent');
        if (RE_SHOW_EARLIER_STEPS.test(trimmed)) return raw.replace(RE_SHOW_EARLIER_STEPS, '展开前 $1 个步骤');
        if (RE_SORT_FILTER_ACTIVE.test(trimmed)) return raw.replace(RE_SORT_FILTER_ACTIVE, '排序与筛选对话（已启用 $1 项）');
        if (RE_STILL_THINKING_SEC.test(trimmed)) return raw.replace(RE_STILL_THINKING_SEC, '仍在思考（$1 秒）');
        if (RE_SIDE_QUESTION_TITLE.test(trimmed)) return raw.replace(RE_SIDE_QUESTION_TITLE, (_, q) => '支线提问：' + q);
        if (RE_SEARCH_GOOGLE.test(trimmed)) return raw.replace(RE_SEARCH_GOOGLE, (_, q) => '使用 Google 搜索“' + q + '”');
        if (!isInHeaderOrBreadcrumb(contextEl)) {
          const mSearch = trimmed.match(RE_EPHEMERAL_ACTIVE);
          if (mSearch) {
            const noun = EPHEMERAL_NOUN_MAP[mSearch[2].toLowerCase()];
            const out = noun ? joinZhVerbNoun(EPHEMERAL_VERB_MAP[mSearch[1]], noun) : EPHEMERAL_VERB_MAP[mSearch[1]] + ' ' + mSearch[2];
            return raw.replace(trimmed, () => out);
          }
        }
      } else if (firstUpper === 'P') {
        if (RE_PERM_DELETE.test(trimmed)) {
          return raw.replace(RE_PERM_DELETE, (_, target, cnt) => '永久删除 ' + target + ' 及 ' + cnt + ' 个进行中的对话。');
        }
      } else if (firstUpper === 'W' || firstUpper === 'M') {
        const mNamed = trimmed.match(RE_NAMED_LIMIT_RESETS);
        if (mNamed) {
          const pZh = NAMED_PERIOD_MAP[mNamed[1].toLowerCase()] || mNamed[1];
          return raw.replace(trimmed, () => pZh + '限额，' + formatCompactDurationZh(mNamed[2]) + '后重置');
        }
        if (firstUpper === 'W') {
          if (RE_WORKED_FOR_UPDATES.test(trimmed)) {
            return raw.replace(RE_WORKED_FOR_UPDATES, (_, dur, cnt) => '已工作 ' + formatCompactDurationZh(dur) + ' · ' + cnt + ' 条进展');
          }
          if (RE_WORKED_FOR.test(trimmed)) return raw.replace(RE_WORKED_FOR, (_, dur) => '已工作 ' + formatCompactDurationZh(dur));
          if (RE_WAITING_CMD_SEC.test(trimmed)) {
            return raw.replace(RE_WAITING_CMD_SEC, '正在等待命令完成（最多 $1 秒）');
          }
          const mWel = trimmed.match(RE_HOME_WELCOME_NAME);
          if (mWel) {
            return raw.replace(trimmed, () => '欢迎回来，' + mWel[1].trim() + '。我们从哪里继续？');
          }
          const mWorkLocal = trimmed.match(RE_WORK_LOCALLY_ON);
          if (mWorkLocal) {
            return raw.replace(trimmed, () => '在本地 ' + mWorkLocal[1].trim() + ' 中工作');
          }
          const mWorkFrom = trimmed.match(RE_WORKTREE_FROM);
          if (mWorkFrom) {
            return raw.replace(
              trimmed,
              () =>
                mWorkFrom[2]
                  ? '从 ' + mWorkFrom[1].trim() + ' 创建 Worktree，并复用 ' + mWorkFrom[2].trim()
                  : '从 ' + mWorkFrom[1].trim() + ' 创建 Worktree'
            );
          }
          const mWorkIn = trimmed.match(RE_WORK_IN_TARGET);
          if (mWorkIn) {
            return raw.replace(trimmed, () => '在 ' + mWorkIn[1].trim() + ' 中工作');
          }
        } else if (RE_MARKED_READ.test(trimmed)) {
          return raw.replace(RE_MARKED_READ, '已将 $1 个对话标为已读');
        }
      } else if (firstUpper === 'T') {
        if (RE_THOUGHT_FOR.test(trimmed)) return raw.replace(RE_THOUGHT_FOR, (_, dur) => '已思考 ' + formatCompactDurationZh(dur));
        if (RE_THINKING_FOR.test(trimmed)) return raw.replace(RE_THINKING_FOR, (_, dur) => '思考中，已用时 ' + formatCompactDurationZh(dur));
        if (RE_DELETE_RECORDINGS_CONFIRM.test(trimmed)) {
          return raw.replace(
            RE_DELETE_RECORDINGS_CONFIRM,
            '这将从您的设备中删除 $1 条通话录音（$2），此操作无法撤销。'
          );
        }
      } else if (firstUpper === 'E' || firstUpper === 'R' || firstUpper === 'L') {
        if (firstUpper === 'E') {
          const mExitOnly = trimmed.match(RE_EXITED_CODE_ONLY);
          if (mExitOnly) {
            return raw.replace(trimmed, () => '已退出，退出码 ' + mExitOnly[1] + (mExitOnly[2] ? '。' : ''));
          }
        }
        if (firstUpper === 'R') {
          if (RE_RESUME_COMMENT_DRAFTS.test(trimmed)) {
            return raw.replace(RE_RESUME_COMMENT_DRAFTS, '恢复 $1 条评论草稿');
          }
          const mResets = trimmed.match(RE_RESETS_IN);
          if (mResets) {
            return raw.replace(trimmed, () => formatCompactDurationZh(mResets[1]) + '后重置');
          }
        }
        if (RE_EPHEMERAL_SUMMARY.test(trimmed)) {
          const translatedSummary = trimmed
            .split(/,\s*/)
            .map((part) => translateEphemeralClause(part))
            .join('、');
          return raw.replace(trimmed, () => translatedSummary);
        }
        const inHdr = isInHeaderOrBreadcrumb(contextEl);
        if (!inHdr) {
          const mActive = trimmed.match(RE_EPHEMERAL_ACTIVE);
          if (mActive) {
            const noun = EPHEMERAL_NOUN_MAP[mActive[2].toLowerCase()];
            const out = noun ? joinZhVerbNoun(EPHEMERAL_VERB_MAP[mActive[1]], noun) : EPHEMERAL_VERB_MAP[mActive[1]] + ' ' + mActive[2];
            return raw.replace(trimmed, () => out);
          }
        }
        if (firstUpper === 'R') {
          if (RE_RUNNING_FOR.test(trimmed)) {
            return raw.replace(RE_RUNNING_FOR, (_, dur) => '运行中，已用时 ' + formatCompactDurationZh(dur));
          }
          if (!inHdr && RE_RUNNING_CMD.test(trimmed)) {
            return raw.replace(RE_RUNNING_CMD, (_, cmd) => '正在运行 ' + cmd);
          }
        }
      } else if (firstUpper === 'D') {
        const mNamedD = trimmed.match(RE_NAMED_LIMIT_RESETS);
        if (mNamedD) {
          const pZh = NAMED_PERIOD_MAP[mNamedD[1].toLowerCase()] || mNamedD[1];
          return raw.replace(trimmed, () => pZh + '限额，' + formatCompactDurationZh(mNamedD[2]) + '后重置');
        }
        if (RE_DELETED_RECORDINGS.test(trimmed)) {
          return raw.replace(RE_DELETED_RECORDINGS, '已删除 $1 条录音 ($2)');
        }
      } else if (firstUpper === 'U') {
        if (RE_USING_BROWSER_SEC.test(trimmed)) {
          return raw.replace(RE_USING_BROWSER_SEC, '正在操作浏览器（$1 秒）');
        }
        if (RE_UP_NEXT_COUNT.test(trimmed)) {
          return raw.replace(RE_UP_NEXT_COUNT, '接下来 · $1');
        }
        const mLocalClone = trimmed.match(RE_USES_LOCAL_CLONE);
        if (mLocalClone) {
          return raw.replace(trimmed, () => '使用本地克隆：' + mLocalClone[1].trim());
        }
        const mUpd = trimmed.match(RE_UPDATED_AT);
        if (mUpd) {
          return raw.replace(trimmed, () => formatUpdatedAtZh(mUpd[1], mUpd[2]));
        }
      } else if (firstUpper === 'V') {
        if (RE_VIEW_SIDE_QUESTIONS.test(trimmed)) {
          return raw.replace(RE_VIEW_SIDE_QUESTIONS, '查看 $1 个支线提问');
        }
        const mVer = trimmed.match(RE_ARIA_VERSION);
        if (mVer) {
          return raw.replace(trimmed, () => '版本 ' + mVer[1].trim());
        }
      } else if (firstUpper === 'Z') {
        if (RE_ZIPPING_FOLDER.test(trimmed)) {
          return raw.replace(RE_ZIPPING_FOLDER, (_, folder) => '正在打包 ' + folder + '…');
        }
      } else if (firstUpper === 'N') {
        if (trimmed === 'New' || trimmed === 'NEW') {
          const btn = contextEl && contextEl.closest && contextEl.closest('button');
          const isActionBtn = !!(
            btn &&
            !btn.hasAttribute('data-model-label') &&
            !(contextEl && contextEl.closest && contextEl.closest('[data-testid*="model-selector"]')) &&
            (btn.textContent || '').replace(/\badd\b|\+/gi, '').trim() === trimmed
          );
          return raw.replace(trimmed, () => (isActionBtn ? '新建' : '新'));
        }
      } else if (firstUpper === 'O') {
        if (RE_ORCHESTRATOR_MODEL.test(trimmed)) {
          return raw.replace(RE_ORCHESTRATOR_MODEL, '编排器 ($1)');
        }
      } else if (firstUpper === 'C') {
        if (
          trimmed === 'Comment' &&
          contextEl?.closest?.(
            'button, [role="button"], [role="menuitem"], .agy-selection-pill, .selection-popup, .inline-pill:not([data-uri^="file:"]):not([data-uri^="vscode-"])'
          )
        ) {
          return raw.replace(trimmed, () => '评论');
        }
        if (
          contextEl &&
          contextEl.closest &&
          contextEl.closest('[data-testid="ssh-machine-switcher-status"]') &&
          RE_CONNECTED_TO_HOST.test(trimmed)
        ) {
          return raw.replace(RE_CONNECTED_TO_HOST, '已连接到 $1');
        }
      } else if (firstUpper === 'Q') {
        if (
          trimmed === 'Quote' &&
          contextEl?.closest?.(
            'button, [role="button"], [role="menuitem"], .agy-selection-pill, .selection-popup, .inline-pill:not([data-uri^="file:"]):not([data-uri^="vscode-"])'
          )
        ) {
          return raw.replace(trimmed, () => '引用');
        }
      } else if (firstUpper === 'Y') {
        const mYourPlan = trimmed.match(RE_YOUR_PLAN);
        if (mYourPlan) {
          return raw.replace(trimmed, () => '当前套餐：' + mYourPlan[1].trim());
        }
        const mUsed = trimmed.match(RE_USED_LIMIT);
        if (mUsed) {
          const degreeMap = { some: '部分', all: '全部', most: '大部分' };
          const typeMap = { weekly: '每周', '5-hour': '5 小时', 'five-hour': '5 小时', daily: '每日' };
          const degree = degreeMap[mUsed[1].toLowerCase()] || mUsed[1];
          const type = typeMap[mUsed[2].toLowerCase()] || mUsed[2];
          const timeStr = mUsed[3]
            .replace(/\.$/, '')
            .replace(/(\d+)\s*days?/gi, '$1 天')
            .replace(/(\d+)\s*hours?/gi, '$1 小时')
            .replace(/(\d+)\s*minutes?/gi, '$1 分钟')
            .replace(/(\d+)\s*seconds?/gi, '$1 秒')
            .replace(/,\s*/g, ' ')
            .trim();
          return '您已消耗' + degree + type + '额度，将在 ' + timeStr + ' 后完全重置。';
        }
        const mNotUsed = trimmed.match(RE_NOT_USED_LIMIT);
        if (mNotUsed) {
          const typeMap = { weekly: '每周', '5-hour': '5 小时', 'five-hour': '5 小时', daily: '每日' };
          const type = typeMap[mNotUsed[1].toLowerCase()] || mNotUsed[1];
          return '您尚未消耗任何' + type + '额度。';
        }
        if (RE_QUOTA_RESET_SWITCH.test(trimmed)) {
          return raw.replace(
            RE_QUOTA_RESET_SWITCH,
            (_, m, dt) =>
              '您的 ' +
              (dictLookup(m.trim()) || computeTextTranslation(m.trim(), contextEl) || m.trim()) +
              ' 配额将于 ' +
              dt +
              ' 重置，请切换到其他可用模型继续。'
          );
        }
        if (RE_QUOTA_REACHED_SWITCH.test(trimmed)) {
          return raw.replace(
            RE_QUOTA_REACHED_SWITCH,
            (_, m) =>
              '您的 ' +
              (dictLookup(m.trim()) || computeTextTranslation(m.trim(), contextEl) || m.trim()) +
              ' 配额已用尽，请切换到其他可用模型继续。'
          );
        }
        const mNeedCred = trimmed.match(RE_NEED_CREDITS_MODEL);
        if (mNeedCred) {
          const amtPart = mNeedCred[1] ? '至少 ' + mNeedCred[1] + ' 点' : '更多';
          const modName =
            mNeedCred[2].trim() === 'this model'
              ? '该模型'
              : dictLookup(mNeedCred[2].trim()) || computeTextTranslation(mNeedCred[2].trim(), contextEl) || mNeedCred[2].trim();
          let out = '发送消息需要' + amtPart + ' AI 点数。若需立即继续使用 ' + modName + '，请购买更多 AI 点数。';
          if (mNeedCred[3]) out += ' 您套餐的基础配额将于 ' + mNeedCred[3] + ' 刷新。';
          if (/enable AI Credit overages/i.test(trimmed)) out += ' 若需立即继续使用该模型，请开启 AI 点数超额使用。';
          return out;
        }
        if (RE_BASELINE_QUOTA_REFRESH.test(trimmed)) {
          return raw.replace(RE_BASELINE_QUOTA_REFRESH, '您套餐的基础配额将于 $1 刷新。');
        }
      } else if (firstUpper === 'H') {
        const mHey = trimmed.match(RE_HOME_HEY_NAME);
        if (mHey) {
          return raw.replace(trimmed, () => '嗨，' + mHey[1].trim() + '，今天想做点什么？');
        }
      } else if (firstUpper === 'G') {
        const mGood = trimmed.match(RE_HOME_GOOD_SEE_NAME);
        if (mGood) {
          return raw.replace(trimmed, () => '很高兴见到你，' + mGood[1].trim() + '。接下来做什么？');
        }
      } else if (firstUpper === 'A') {
        const mAvailCred = trimmed.match(RE_AVAILABLE_AI_CREDITS);
        if (mAvailCred) {
          return raw.replace(trimmed, () => '可用 AI 点数：' + mAvailCred[1].trim());
        }
        const mAutoFig = trimmed.match(RE_AUTO_FIG_WORKSPACE);
        if (mAutoFig) {
          return raw.replace(
            trimmed,
            () =>
              '对话开始时自动新建 ' +
              mAutoFig[1] +
              ' 工作区' +
              (mAutoFig[2] ? '，从 ' + mAutoFig[2].trim() + ' 创建 Worktree' : '') +
              (mAutoFig[3] ? '，并复用 ' + mAutoFig[3].trim() : '')
          );
        }
      }

      // 跨首字母动态模型提示与限额规则（长度与特征子串前置门控，防止长文本回溯与普通英语短语误伤）
      if (trimmed.length < 220 && trimmed.includes('offload routine steps')) {
        const mOffload = trimmed.match(RE_MODEL_OFFLOAD_DESC);
        if (mOffload) {
          return raw.replace(
            trimmed,
            () =>
              mOffload[1] +
              ' 模型，可将常规步骤分流到 ' +
              mOffload[2] +
              ' 执行。保持 ' +
              mOffload[3] +
              ' 同等质量，消耗更少 Token。'
          );
        }
      }
      if (trimmed.length < 160 && trimmed.includes('removed from Antigravity')) {
        const mRemoved = trimmed.match(RE_MODEL_REMOVED_ON);
        if (mRemoved) {
          return raw.replace(
            trimmed,
            () => mRemoved[1].trim() + ' 将于 ' + formatEnglishDateZh(mRemoved[2]) + '从 Antigravity 下线。'
          );
        }
      }
      if (trimmed.length < 80 && (firstUpper === 'G' || firstUpper === 'C' || firstUpper === 'O')) {
        const mPeriodLim = trimmed.match(RE_MODEL_PERIOD_LIMIT);
        if (mPeriodLim) {
          const pZh = NAMED_PERIOD_MAP[mPeriodLim[2].toLowerCase()] || mPeriodLim[2];
          return raw.replace(trimmed, () => mPeriodLim[1].trim() + ' ' + pZh + '限额');
        }
        const mModEff = trimmed.match(RE_MODEL_EFFORT_LABEL);
        if (mModEff) {
          if (mModEff[2]) {
            const effZh = EFFORT_MAP[mModEff[2].replace(/\s+/g, ' ').toLowerCase()] || mModEff[2];
            return raw.replace(trimmed, () => mModEff[1].trim() + ' (' + effZh + ')');
          }
          if (
            mModEff[3] &&
            (!contextEl ||
              contextEl.closest?.(
                '[data-testid*="model-selector"], [data-testid*="orchestrator"], [role="menu"], [role="listbox"], [role="option"], [role="menuitem"], [role="menuitemradio"], [role="dialog"], button'
              ))
          ) {
            const effZh = EFFORT_MAP[mModEff[3].replace(/\s+/g, ' ').toLowerCase()] || mModEff[3];
            return raw.replace(trimmed, () => mModEff[1].trim() + ' · ' + effZh);
          }
        }
      }
      if (trimmed.length < 240 && trimmed.includes('Exited with code')) {
        const mSumExit = trimmed.match(RE_SUMMARY_EXITED_CODE);
        if (mSumExit) {
          return raw.replace(trimmed, () => mSumExit[1].trim() + ' · 退出码 ' + mSumExit[2]);
        }
      }

      if (trimmed.length < 64) {
        if (RE_KEY_QUEUES_AFTER.test(trimmed)) {
          return raw.replace(RE_KEY_QUEUES_AFTER, '$1 加入队列，本轮结束后发送');
        }
        if (RE_KEY_SENDS_IMMEDIATELY.test(trimmed)) {
          return raw.replace(RE_KEY_SENDS_IMMEDIATELY, '$1 立即发送');
        }
        if (RE_KEY_EMPTY_NEXT_QUEUE.test(trimmed)) {
          return raw.replace(RE_KEY_EMPTY_NEXT_QUEUE, '$1 输入为空时发送队列下一条');
        }
      }

      return null;
    }

    function translateTextNode(node) {
      const currentVal = node.nodeValue;
      if (!currentVal) return;

      const rec = origTextMap.get(node);
      if (rec && rec.lastVal === currentVal && rec.ver === PATCH_VERSION) {
        return;
      }
      const origRaw = rec && rec.lastVal === currentVal ? rec.origRaw : currentVal;

      const nextVal = computeTextTranslation(origRaw, node.parentElement);
      if (nextVal !== null) {
        origTextMap.set(node, { origRaw, lastVal: nextVal, ver: PATCH_VERSION });
        if (node.nodeValue !== nextVal) {
          node.nodeValue = nextVal;
        }
      } else if (rec && rec.lastVal === currentVal) {
        node.nodeValue = origRaw;
        origTextMap.delete(node);
      }
    }

    function translateSingleAttr(el, attrName, origDataAttr, customResolver) {
      const cur = el.getAttribute(attrName);
      if (!cur) {
        if (!el.hasAttribute(origDataAttr)) return;
        const verProp = '__ag_attr_ver_' + attrName;
        const lastDataAttr = origDataAttr + '-last';
        el.removeAttribute(origDataAttr);
        if (el.hasAttribute(lastDataAttr)) el.removeAttribute(lastDataAttr);
        delete el[verProp];
        return;
      }
      const verProp = '__ag_attr_ver_' + attrName;
      const lastDataAttr = origDataAttr + '-last';
      const savedOrig = el.getAttribute(origDataAttr);
      const savedLast = el.getAttribute(lastDataAttr);
      if (savedOrig !== null && savedLast === cur && el[verProp] === PATCH_VERSION) {
        return;
      }
      const origVal = savedOrig !== null && savedLast === cur ? savedOrig : cur;
      const trimmed = origVal.trim();
      const shouldSkipAttr = attrName === 'aria-label' && SKIP_ARIA_LABEL_VALUES.has(trimmed);
      const nextVal = shouldSkipAttr
        ? null
        : customResolver
        ? customResolver(trimmed, el)
        : typeof dictLookup(trimmed) === 'string'
        ? dictLookup(trimmed)
        : null;
      if (typeof nextVal === 'string') {
        if (savedOrig !== origVal) el.setAttribute(origDataAttr, origVal);
        if (savedLast !== nextVal) el.setAttribute(lastDataAttr, nextVal);
        el[verProp] = PATCH_VERSION;
        if (cur !== nextVal) {
          el.setAttribute(attrName, nextVal);
        }
      } else {
        if (savedOrig !== null && savedLast === cur) {
          el.setAttribute(attrName, savedOrig);
        }
        if (savedOrig !== null) el.removeAttribute(origDataAttr);
        if (savedLast !== null) el.removeAttribute(lastDataAttr);
        el[verProp] = PATCH_VERSION;
      }
    }

    function resolveAttrTranslation(atrim, el) {
      const directHit = dictLookup(atrim);
      if (typeof directHit === 'string') return directHit;
      const mModel = atrim.match(RE_ARIA_MODEL);
      if (mModel) {
        let mName = mModel[1].trim();
        if (mName === 'Select model' || mName === 'Select Model') return '模型，当前：选择模型';
        const directModelZh = dictLookup(mName) || computeTextTranslation(mName, el);
        if (directModelZh) {
          mName = directModelZh;
        } else {
          const mEff = mName.match(RE_EFFORT_SUFFIX);
          if (mEff) {
            const effRaw = mEff[2] || mEff[3];
            const effZh = EFFORT_MAP[effRaw.replace(/\s+/g, ' ').toLowerCase()] || effRaw;
            const baseRaw = mEff[1].trim();
            const baseZh = dictLookup(baseRaw) || computeTextTranslation(baseRaw, el) || baseRaw;
            const ctxTail = mEff[4] ? ' · ' + mEff[4].trim() : '';
            mName = baseZh + (mEff[2] ? ' (' + effZh + ')' : ' · ' + effZh) + ctxTail;
          }
        }
        return '模型，当前：' + mName;
      }
      const lookupPerm = (s) =>
        dictLookup(s) || dictLookup(s.charAt(0).toUpperCase() + s.slice(1)) || s;
      const mPermSel = atrim.match(RE_ARIA_PERM_SEL);
      if (mPermSel) {
        const pMode = mPermSel[1].trim();
        return '权限模式，当前：' + lookupPerm(pMode);
      }
      const mPermFixed = atrim.match(RE_ARIA_PERM_FIXED);
      if (mPermFixed) {
        const pMode = mPermFixed[1].trim();
        const rawNote = (mPermFixed[2] || mPermFixed[3] || '').trim();
        if (!rawNote) {
          return '权限模式：' + lookupPerm(pMode);
        }
        const mappedNote =
          rawNote.toLowerCase() === 'cannot be changed mid-conversation'
            ? '对话中途无法更改'
            : dictLookup(rawNote) || computeTextTranslation(rawNote, el) || rawNote;
        return '权限模式：' + lookupPerm(pMode) + '（' + mappedNote + '）';
      }
      const mGoTurn = atrim.match(RE_ARIA_GOTO_TURN);
      if (mGoTurn) {
        return '跳转至第 ' + mGoTurn[1] + ' / ' + mGoTurn[2] + ' 轮对话';
      }
      const mTurn = atrim.match(RE_ARIA_TURN);
      if (mTurn) {
        if (mTurn[3] && mTurn[4]) {
          return '第 ' + mTurn[3] + ' / ' + mTurn[4] + ' 轮对话';
        }
        const roleZh = mTurn[2].toLowerCase() === 'user' ? '用户' : 'Agent';
        return '第 ' + mTurn[1] + ' 轮对话（' + roleZh + '）';
      }
      const mOlder = atrim.match(RE_ARIA_LOAD_OLDER);
      if (mOlder) {
        if (mOlder[3] && mOlder[4]) {
          return (/^no/i.test(mOlder[2]) ? '没有更早的消息' : '加载更早的消息') + '（当前显示 ' + mOlder[3] + ' / ' + mOlder[4] + '）';
        }
        return '加载更早的 ' + mOlder[1] + ' 轮对话';
      }
      const mBranch = atrim.match(RE_ARIA_BRANCH);
      if (mBranch) {
        const bName = mBranch[1].trim();
        return '分支，当前：' + (bName === 'Select branch' ? '选择分支' : bName);
      }
      const mProj = atrim.match(RE_ARIA_PROJECT);
      if (mProj) {
        const pName = mProj[1].trim();
        return '选择项目，当前：' + (pName === 'No project' || pName === 'No Project' ? '未关联项目' : pName);
      }
      const mLoc = atrim.match(RE_ARIA_LOCATION);
      if (mLoc) {
        const locName = mLoc[1].trim();
        const mappedLoc =
          locName === 'This Computer' ? '本机' : locName === 'Remote' ? '远程' : dictLookup(locName) || locName;
        return 'Agent 运行位置，当前：' + mappedLoc;
      }
      const mVer = atrim.match(RE_ARIA_VERSION);
      if (mVer) {
        return '版本 ' + mVer[1].trim();
      }
      const mExtLink = atrim.match(RE_OPENS_EXT_LINK);
      if (mExtLink) {
        return '打开外部链接：' + mExtLink[1].trim();
      }
      const mOpenConv = atrim.match(RE_OPEN_CONV_ID);
      if (mOpenConv) {
        return '打开对话 ' + mOpenConv[1];
      }
      const mOpenPlugin = atrim.match(RE_OPEN_PLUGIN_NAME);
      if (mOpenPlugin) {
        return '打开 ' + mOpenPlugin[1].trim() + ' 插件';
      }
      const mEditSq = atrim.match(RE_EDIT_SIDE_Q_TITLE);
      if (mEditSq) {
        return '编辑支线提问标题：' + mEditSq[1].trim();
      }
      if (IS_SWARM_PLUGIN_FRAME) {
        const mLiveTip = atrim.match(RE_SWARM_LIVE_TIP);
        if (mLiveTip) {
          return (mLiveTip[1] === 'Thinking' ? '思考中：' : '最新动作：') + mLiveTip[2];
        }
        const mRunsOn = atrim.match(RE_SWARM_RUNS_ON);
        if (mRunsOn) {
          return '运行于 ' + mRunsOn[1].trim();
        }
        const mNarRead = atrim.match(RE_SWARM_NARRATOR_READ);
        if (mNarRead) {
          return '纪要员已读至 #' + mNarRead[1] + ' / 共 ' + mNarRead[2] + ' 条';
        }
        const mPostsSince = atrim.match(RE_SWARM_POSTS_SINCE_UPD);
        if (mPostsSince) {
          return '视图更新后新增 ' + mPostsSince[1] + ' 条发言';
        }
        const mNarFail = atrim.match(RE_SWARM_NARRATOR_FAILED_TIP);
        if (mNarFail) {
          return '纪要员上一步失败：' + mNarFail[1].trim();
        }
        const mPostedCh = atrim.match(RE_SWARM_POSTED_IN_CH);
        if (mPostedCh) {
          return '发布于 #' + mPostedCh[1] + '；点击仅看 #' + mPostedCh[1];
        }
        const mGotoSeq = atrim.match(RE_SWARM_GOTO_SEQ);
        if (mGotoSeq) {
          return '跳至 #' + mGotoSeq[1] + (mGotoSeq[2] ? '（' + mGotoSeq[2].trim() + '）' : '');
        }
        if (el && el.classList && el.classList.contains('o2-tprog')) {
          const mTpDone = atrim.match(RE_SWARM_TPROG_DONE);
          if (mTpDone) {
            return '已完成 ' + mTpDone[1].trim();
          }
        }
      }
      if (
        atrim === 'File' &&
        (IS_SWARM_PLUGIN_FRAME || (el && el.classList && el.classList.contains('segmented')))
      ) {
        return '文件';
      }
      if (
        el &&
        el.getAttribute &&
        el.getAttribute('data-testid') === 'running-row-stop' &&
        /^Stop\s+(.+)$/i.test(atrim)
      ) {
        return '停止 ' + atrim.replace(/^Stop\s+/i, '');
      }
      return computeTextTranslation(atrim, el);
    }

    const ATTR_TO_ORIG = {
      title: 'data-ag-orig-title',
      placeholder: 'data-ag-orig-placeholder',
      'aria-label': 'data-ag-orig-aria-label'
    };

    function translateElementAttrs(el, onlyAttrName) {
      if (!el || el.nodeType !== 1) return;
      if (onlyAttrName) {
        const origDataAttr = ATTR_TO_ORIG[onlyAttrName];
        if (origDataAttr) translateSingleAttr(el, onlyAttrName, origDataAttr, resolveAttrTranslation);
        return;
      }
      translateSingleAttr(el, 'title', 'data-ag-orig-title', resolveAttrTranslation);
      translateSingleAttr(el, 'placeholder', 'data-ag-orig-placeholder', resolveAttrTranslation);
      translateSingleAttr(el, 'aria-label', 'data-ag-orig-aria-label', resolveAttrTranslation);
    }

    function translateMarkdownChromeSubtree(container) {
      if (!container || container.nodeType !== 1) return;
      if (isMarkdownChromeAttrTarget(container)) {
        translateElementAttrs(container);
      }
      if (!container.querySelectorAll) return;
      const els = container.querySelectorAll(MARKDOWN_UI_ATTR_SELECTOR);
      for (let i = 0; i < els.length; i++) {
        const el = els[i];
        if (isMarkdownChromeAttrTarget(el)) {
          translateElementAttrs(el);
        }
      }
    }

    const walkerFilter = {
      acceptNode(node) {
        if (node.nodeType === 1) {
          if (node.matches && node.matches(EXCLUDE_SELECTOR)) {
            if (node.isConnected && node.matches(TEXT_IMMUTABLE_EXCLUDE_SELECTOR)) {
              immutableTextExclCache.set(node, true);
            }
            if (node.matches('[data-markdown-root]')) {
              translateMarkdownChromeSubtree(node);
              return NodeFilter.FILTER_REJECT;
            }
            if (
              isFormAttrTarget(node) &&
              canTranslateElementAttrs(node) &&
              (node.hasAttribute('title') || node.hasAttribute('aria-label') || node.hasAttribute('placeholder'))
            ) {
              translateElementAttrs(node);
            }
            return NodeFilter.FILTER_REJECT;
          }
          if (
            node.hasAttribute &&
            (node.hasAttribute('title') || node.hasAttribute('aria-label') || node.hasAttribute('placeholder'))
          ) {
            translateElementAttrs(node);
          }
          return NodeFilter.FILTER_SKIP;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    };

    function scanAndTranslate(root = document.body) {
      if (!root) return;
      if (root.nodeType === 3) {
        if (root.parentElement && !isExcludedElement(root.parentElement)) {
          translateTextNode(root);
        }
        return;
      }
      if (root.nodeType !== 1) return;
      if (isExcludedElement(root)) {
        if (root.closest && root.closest('[data-markdown-root]')) {
          translateMarkdownChromeSubtree(root);
          return;
        }
        if (
          isFormAttrTarget(root) &&
          canTranslateElementAttrs(root) &&
          (root.hasAttribute('title') || root.hasAttribute('aria-label') || root.hasAttribute('placeholder'))
        ) {
          translateElementAttrs(root);
        }
        return;
      }

      if (
        root.hasAttribute &&
        (root.hasAttribute('title') || root.hasAttribute('aria-label') || root.hasAttribute('placeholder'))
      ) {
        translateElementAttrs(root);
      }

      const walker = document.createTreeWalker(
        root,
        NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
        walkerFilter
      );
      while (walker.nextNode()) {
        translateTextNode(walker.currentNode);
      }
    }

    scanBodyFn = scanAndTranslate;
    if (document.body) {
      scanAndTranslate(document.body);
    }

    const dirtyRoots = new Set();
    let pending = false;
    let fallbackTimer = null;

    function flushTranslations() {
      pending = false;
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
      if (dirtyRoots.size === 0) return;

      if (dirtyRoots.size > 1500) {
        dirtyRoots.clear();
        try {
          scanAndTranslate(document.body);
        } catch (e) {}
        return;
      }

      const roots = Array.from(dirtyRoots);
      const rootSet = new Set(roots);
      dirtyRoots.clear();

      const topRoots = [];
      for (let i = 0; i < roots.length; i++) {
        const r = roots[i];
        if (!r || !r.isConnected) continue;
        let covered = false;
        for (let p = r.parentNode; p; p = p.parentNode) {
          if (rootSet.has(p)) {
            covered = true;
            break;
          }
        }
        if (!covered) topRoots.push(r);
      }

      if (topRoots.length > 120) {
        try {
          scanAndTranslate(document.body);
        } catch (e) {}
        return;
      }

      for (let i = 0; i < topRoots.length; i++) {
        try {
          scanAndTranslate(topRoots[i]);
        } catch (e) {}
      }
    }

    function scheduleFlush() {
      if (pending) return;
      pending = true;
      requestAnimationFrame(flushTranslations);
      fallbackTimer = setTimeout(flushTranslations, 80);
    }

    window.__ag_i18n_observer = new MutationObserver((mutations) => {
      const batchSafeSet = new Set();
      for (let i = 0; i < mutations.length; i++) {
        const m = mutations[i];
        if (m.type === 'characterData') {
          const t = m.target;
          if (!t) continue;
          const rec = origTextMap.get(t);
          if (rec && rec.lastVal === t.nodeValue && rec.ver === PATCH_VERSION) continue;
          if (t.parentElement && !isExcludedElement(t.parentElement, batchSafeSet)) {
            dirtyRoots.add(t);
          }
        } else if (m.type === 'attributes') {
          const el = m.target;
          const attr = m.attributeName;
          const origDataAttr = attr ? ATTR_TO_ORIG[attr] : null;
          if (!el || el.nodeType !== 1 || !origDataAttr) continue;
          if (
            el['__ag_attr_ver_' + attr] === PATCH_VERSION &&
            el.getAttribute(origDataAttr + '-last') === el.getAttribute(attr)
          ) {
            continue;
          }
          if (canTranslateElementAttrs(el, batchSafeSet)) {
            try {
              translateSingleAttr(el, attr, origDataAttr, resolveAttrTranslation);
            } catch (e) {}
          }
        } else if (m.type === 'childList' && m.addedNodes.length > 0) {
          if (m.target && m.target.nodeType === 1 && isExcludedElement(m.target, batchSafeSet)) {
            if (
              m.target.closest &&
              !m.target.closest('pre, code, .monaco-editor, .monaco-diff-editor, .xterm') &&
              m.target.closest('[data-markdown-root]')
            ) {
              for (let j = 0; j < m.addedNodes.length; j++) {
                const n = m.addedNodes[j];
                if (
                  n.nodeType === 1 &&
                  ((n.matches && n.matches(MARKDOWN_UI_ATTR_SELECTOR)) ||
                    (n.firstElementChild && n.querySelector && n.querySelector(MARKDOWN_UI_ATTR_SELECTOR)))
                ) {
                  dirtyRoots.add(n);
                }
              }
            }
            continue;
          }
          for (let j = 0; j < m.addedNodes.length; j++) {
            const n = m.addedNodes[j];
            if (n.nodeType === 1 || n.nodeType === 3) {
              dirtyRoots.add(n);
            }
          }
        }
      }
      if (dirtyRoots.size > 0) {
        scheduleFlush();
      }
    });

    if (document.body) {
      window.__ag_i18n_observer.observe(document.body, I18N_OBS_OPTS);
    }
  } else if (document.body) {
    // 若用户在配置中关闭了 i18n 模块，实时将已翻译的文本与属性还原为原始英文
    restoreAllTranslations(document.body);
  }

  // 若由 Page.addScriptToEvaluateOnNewDocument 在 <head> 早期触发（此时 document.body === null），
  // 挂载单次 DOMContentLoaded 钩子，确保样式排在原生 <link> 之后，并在 body 就绪后完成监听挂载
  if (document.body) {
    window.__ag_body_ready = true;
  } else {
    window.__ag_body_ready = false;
    window.__ag_dcl_handler = () => {
      window.__ag_dcl_handler = null;
      ensureStylesAtEndOfHead();
      if (document.body) {
        if (window.__ag_theme_mode_observer) {
          try {
            window.__ag_theme_mode_observer.observe(document.body, {
              attributes: true,
              attributeFilter: ['class']
            });
          } catch (e) {}
        } else if (typeof MutationObserver !== 'undefined') {
          try {
            const modeObs = new MutationObserver(() => {
              if (typeof window.__ag_sync_preset_fn === 'function') {
                window.__ag_sync_preset_fn();
              }
            });
            modeObs.observe(document.body, { attributes: true, attributeFilter: ['class'] });
            if (document.documentElement) {
              modeObs.observe(document.documentElement, {
                attributes: true,
                attributeFilter: ['class', 'style', 'data-theme']
              });
            }
            window.__ag_theme_mode_observer = modeObs;
          } catch (e) {}
        }
      }
      syncChuanbanPreset();
      checkRouteAndMountMetrics();
      if (typeof window.__ag_sync_token_analytics_fn === 'function' && document.body) {
        try {
          window.__ag_sync_token_analytics_fn();
        } catch (e) {}
      }
      if (MODULES.i18n && document.body) {
        if (typeof scanBodyFn === 'function') {
          try {
            scanBodyFn(document.body);
          } catch (e) {}
        }
        if (window.__ag_i18n_observer) {
          try {
            window.__ag_i18n_observer.disconnect();
            window.__ag_i18n_observer.observe(document.body, I18N_OBS_OPTS);
          } catch (e) {}
        }
      } else if (!MODULES.i18n && document.body) {
        restoreAllTranslations(document.body);
      }
      window.__ag_body_ready = true;
    };
    window.addEventListener('DOMContentLoaded', window.__ag_dcl_handler, { once: true });
  }

  /* __AG_TOKEN_ANALYTICS_JS_START__ */
  // ============================================================================
  // 4.5 系统设置弹窗「Token 统计」Tab（增量 SQLite 多维归因 · 融合精简版）
  // ============================================================================
  if (!IS_SWARM_PLUGIN_FRAME && ENABLED && MODULES.tokenAnalytics) {
    (() => {
      if (window.location && String(window.location.protocol || '').startsWith('plugin:')) return;

      const NAV_SECTION_ID = 'ag-token-nav-section';
      const NAV_BTN_ID = 'ag-token-nav-btn';
      const PANEL_ID = 'ag-token-analytics-panel';
      const HM_TOOLTIP_ID = 'ag-ta-tooltip';
      const CACHE_TTL_MS = 60000;
      const REQUEST_TIMEOUT_MS = 25000;

      const TA_SCENARIO_META = {
        tools: { label: '工具执行轮次', desc: '触发读/写/终端/检索工具的推理轮次', color: 'var(--ag-ta-c1)' },
        subagent: { label: '子 Agent', desc: 'research / self / browser 等独立子轨迹', color: 'var(--ag-ta-c2)' },
        chat: { label: '纯对话与回复', desc: '无工具调用的直接问答与总结输出', color: 'var(--ag-ta-c3)' },
        planning: { label: '规划与编排', desc: 'Orchestrator / Plan 架构规划轮次', color: 'var(--ag-ta-c4)' },
        memory: { label: '记忆与上下文压缩', desc: 'MEMORY.md 读写与上下文压缩检查点', color: 'var(--ag-ta-c5)' },
        internal: { label: 'CLI / 重试与内部', desc: 'CLI 会话与无步关联重试/中止调用', color: 'var(--ag-ta-c6)' }
      };

      const esc = (s) =>
        String(s ?? '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');

      const taFormatCompact = (n) => {
        if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return '0';
        if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
        if (n >= 1e8) return `${Math.round(n / 1e6)}M`;
        if (n >= 1e6) return `${Number((n / 1e6).toFixed(1))}M`;
        if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
        return `${Math.round(n)}`;
      };

      const taGetMetricVal = (obj, metric = 'weighted') => {
        if (!obj) return 0;
        if (metric === 'calls') return obj.calls || 0;
        if (metric === 'total') return obj.total ?? ((obj.inTok || 0) + (obj.cacheRead || 0) + (obj.outTok || 0));
        if (metric === 'billable') return obj.billable ?? ((obj.inTok || 0) + (obj.outTok || 0));
        return obj.weighted ?? Math.round((obj.inTok || 0) + 0.1 * (obj.cacheRead || 0) + 6 * (obj.outTok || 0));
      };

      const taFormatMetricVal = (obj, metric = 'weighted') =>
        metric === 'calls' ? `${taGetMetricVal(obj, metric).toLocaleString('en-US')} 次` : taFormatCompact(taGetMetricVal(obj, metric));

      const taCalcCacheRate = (obj) => {
        const inp = (obj?.inTok || 0) + (obj?.cacheRead || 0);
        return inp > 0 ? obj.cacheRead / inp : null;
      };

      const taLocalDateStr = (tsSec) => {
        const d = new Date(tsSec * 1000);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      };

      const taCalcDateRangeBounds = (rangeDays, nowSec) => {
        if (!rangeDays || rangeDays >= 365) return null;
        const effectiveSec = Math.max(Number(nowSec) || 0, Math.floor(Date.now() / 1000));
        const end = new Date(effectiveSec * 1000);
        end.setHours(0, 0, 0, 0);
        const start = new Date(end.getTime() - (rangeDays - 1) * 86400000);
        return {
          minDate: taLocalDateStr(Math.floor(start.getTime() / 1000)),
          maxDate: taLocalDateStr(Math.floor(end.getTime() / 1000))
        };
      };

      const taIsDateInRange = (dateStr, rangeDays, nowSec, precomputedBounds = undefined) => {
        if (!rangeDays || rangeDays >= 365) return true;
        if (!dateStr) return false;
        const bounds = precomputedBounds !== undefined ? precomputedBounds : taCalcDateRangeBounds(rangeDays, nowSec);
        if (!bounds) return true;
        return dateStr >= bounds.minDate && dateStr <= bounds.maxDate;
      };

      const taFilterAndSortSessions = (baseSessions, state) => {
        if (!Array.isArray(baseSessions) || baseSessions.length === 0) return [];
        const metric = state?.metric || 'weighted';
        const searchKw = String(state?.search || '').trim().toLowerCase();
        const onlyLow = Boolean(state?.onlyLowCache);
        const sortBy = state?.sort || 'metric';
        const filtered =
          !onlyLow && !searchKw
            ? baseSessions.slice()
            : baseSessions.filter((s) => {
                if (onlyLow && !s.lowCacheWarning) return false;
                if (searchKw && !s._searchHay.includes(searchKw)) return false;
                return true;
              });
        return filtered.sort((a, b) => {
          if (sortBy === 'lowCache') return (a.cacheRate ?? 1) - (b.cacheRate ?? 1);
          if (sortBy === 'recent') return (b.lastTs || 0) - (a.lastTs || 0);
          if (sortBy === 'total' || sortBy === 'weighted' || sortBy === 'inTok' || sortBy === 'outTok' || sortBy === 'calls') {
            return b[sortBy] - a[sortBy];
          }
          return taGetMetricVal(b, metric) - taGetMetricVal(a, metric);
        });
      };

      const taMakeEmptyTotals = () => ({
        calls: 0, inTok: 0, cacheRead: 0, outTok: 0, thinkTok: 0, respTok: 0, total: 0, weighted: 0, billable: 0
      });

      const taAddTotals = (acc, f) => {
        acc.calls += f.calls || 0;
        acc.inTok += f.inTok || 0;
        acc.cacheRead += f.cacheRead || 0;
        acc.outTok += f.outTok || 0;
        acc.thinkTok += f.thinkTok || 0;
        acc.respTok += f.respTok || 0;
        acc.total += f.total || 0;
        acc.weighted += f.weighted || 0;
        acc.billable += f.billable || 0;
      };

      const topKeyByScore = (scoreMap) => {
        let bestK = '';
        let bestV = -1;
        for (const [k, v] of scoreMap.entries()) {
          if (v > bestV) {
            bestV = v;
            bestK = k;
          }
        }
        return bestK;
      };

      function taBuildHeatmapGrid(dailyMap, { weeks = 26, nowSec, metric = 'weighted', rangeDays = 30, selectedDate = null, rangeBounds = undefined } = {}) {
        const effectiveSec = Math.max(Number(nowSec) || 0, Math.floor(Date.now() / 1000));
        const bounds = rangeBounds !== undefined ? rangeBounds : taCalcDateRangeBounds(rangeDays, effectiveSec);
        const end = new Date(effectiveSec * 1000);
        end.setHours(0, 0, 0, 0);
        const endWeekMonday = new Date(end.getTime() - ((end.getDay() + 6) % 7) * 86400000);
        const startMonday = new Date(endWeekMonday.getTime() - (weeks - 1) * 7 * 86400000);

        const gridDays = [];
        const weekCols = [];
        let curCol = [];
        for (let c = new Date(startMonday); c.getTime() <= end.getTime(); c = new Date(c.getTime() + 86400000)) {
          const date = `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, '0')}-${String(c.getDate()).padStart(2, '0')}`;
          const dow = (c.getDay() + 6) % 7;
          if (dow === 0 && curCol.length > 0) {
            weekCols.push(curCol);
            curCol = [];
          }
          const rec = dailyMap.get(date);
          const dayObj = {
            date,
            month: c.getMonth() + 1,
            calls: rec?.calls || 0,
            inTok: rec?.inTok || 0,
            cacheRead: rec?.cacheRead || 0,
            outTok: rec?.outTok || 0,
            total: rec?.total || 0,
            weighted: rec?.weighted || 0,
            billable: rec?.billable || 0,
            topProject: rec?.topProject || '',
            inRange: taIsDateInRange(date, rangeDays, effectiveSec, bounds),
            selected: selectedDate === date,
            level: 0
          };
          gridDays.push(dayObj);
          curCol.push(dayObj);
        }
        if (curCol.length > 0) {
          while (curCol.length < 7) curCol.push(null);
          weekCols.push(curCol);
        }

        const posVals = gridDays.map((d) => taGetMetricVal(d, metric)).filter((v) => v > 0).sort((a, b) => a - b);
        const q = (p) => (posVals.length ? posVals[Math.min(posVals.length - 1, Math.floor(posVals.length * p))] : 0);
        const [t1, t2, t3] = [q(0.25), q(0.55), q(0.82)];
        for (const d of gridDays) {
          const v = taGetMetricVal(d, metric);
          d.level = v <= 0 ? 0 : v <= t1 ? 1 : v <= t2 ? 2 : v <= t3 ? 3 : 4;
        }

        let streak = 0;
        for (let i = gridDays.length - 1; i >= 0 && gridDays[i].total > 0; i -= 1) streak += 1;
        return { weeks: weekCols, days: gridDays, last14: gridDays.slice(-14), streak };
      }

      function taComputeViewModel(payload, state) {
        const nowSec = Math.max(Number(payload?.nowSec) || 0, Math.floor(Date.now() / 1000));
        const facts = Array.isArray(payload?.facts) ? payload.facts : [];
        const conversations = payload?.conversations || {};
        const metric = state.metric || 'weighted';
        const rangeDays = Number(state.rangeDays || 30);
        const rangeBounds = taCalcDateRangeBounds(rangeDays, nowSec);

        const matchesFact = (f, opts = {}) => {
          if (!opts.ignoreDate && state.selectedDate) {
            if (f.date !== state.selectedDate) return false;
          } else if (!opts.ignoreRange && rangeBounds && (f.date < rangeBounds.minDate || f.date > rangeBounds.maxDate)) {
            return false;
          }
          if (!opts.ignoreProject && state.selectedProject !== 'ALL' && conversations[f.cid]?.projectKey !== state.selectedProject) {
            return false;
          }
          if (!opts.ignoreModel && state.selectedModel) {
            if ((state.modelGroup === 'pool' ? f.pool : f.model) !== state.selectedModel) return false;
          }
          if (!opts.ignoreScenario && state.selectedScenario && f.scenario !== state.selectedScenario) return false;
          return true;
        };

        const kpiTotals = taMakeEmptyTotals();
        const activeDates = new Map();
        const kpiRootIds = new Set();
        const kpiSubIds = new Set();
        const kpiProjKeys = new Set();
        const dailyMap = new Map();
        const dailyProjScores = new Map();
        const modelMap = new Map();
        const scenMap = new Map();
        const rootGroups = new Map();
        const projMap = new Map();

        for (const f of facts) {
          const c = conversations[f.cid];
          const mv = taGetMetricVal(f, metric);

          if (matchesFact(f)) {
            taAddTotals(kpiTotals, f);
            let ad = activeDates.get(f.date);
            if (!ad) {
              ad = { date: f.date, ...taMakeEmptyTotals() };
              activeDates.set(f.date, ad);
            }
            taAddTotals(ad, f);
            if (c) {
              const rootId = c.rootId && conversations[c.rootId] ? c.rootId : c.id;
              const rootInfo = conversations[rootId] || c;
              kpiRootIds.add(rootId);
              if (c.isSubagent) kpiSubIds.add(c.id);
              if (c.projectKey) kpiProjKeys.add(c.projectKey);
              let g = rootGroups.get(rootId);
              if (!g) {
                g = {
                  id: rootId,
                  title: rootInfo.title,
                  projectKey: rootInfo.projectKey,
                  projectName: rootInfo.projectName,
                  source: rootInfo.source,
                  lastTs: rootInfo.lastTs || 0,
                  modelScores: new Map(),
                  scenarioScores: new Map(),
                  rolled: taMakeEmptyTotals(),
                  childrenMap: new Map()
                };
                rootGroups.set(rootId, g);
              }
              taAddTotals(g.rolled, f);
              if (f.cid === rootId) {
                g.modelScores.set(f.model, (g.modelScores.get(f.model) || 0) + mv);
                g.scenarioScores.set(f.scenario, (g.scenarioScores.get(f.scenario) || 0) + mv);
              } else {
                let ch = g.childrenMap.get(f.cid);
                if (!ch) {
                  ch = {
                    id: f.cid,
                    title: c.title,
                    agentName: c.agentName || f.subagentType || 'subagent',
                    lastTs: c.lastTs || 0,
                    modelScores: new Map(),
                    ...taMakeEmptyTotals()
                  };
                  g.childrenMap.set(f.cid, ch);
                }
                taAddTotals(ch, f);
                ch.modelScores.set(f.model, (ch.modelScores.get(f.model) || 0) + mv);
                if (!g.modelScores.size) g.modelScores.set(f.model, mv);
                if (!g.scenarioScores.size) g.scenarioScores.set(f.scenario, mv);
              }
            }
          }

          if (matchesFact(f, { ignoreDate: true, ignoreRange: true })) {
            let dAcc = dailyMap.get(f.date);
            if (!dAcc) {
              dAcc = { date: f.date, ...taMakeEmptyTotals(), topProject: '' };
              dailyMap.set(f.date, dAcc);
              dailyProjScores.set(f.date, new Map());
            }
            taAddTotals(dAcc, f);
            if (c?.projectName) {
              const pm = dailyProjScores.get(f.date);
              pm.set(c.projectName, (pm.get(c.projectName) || 0) + mv);
            }
          }

          if (matchesFact(f, { ignoreModel: true })) {
            const mKey = state.modelGroup === 'pool' ? f.pool : f.model;
            let mAcc = modelMap.get(mKey);
            if (!mAcc) {
              mAcc = { key: mKey, pool: f.pool, ...taMakeEmptyTotals() };
              modelMap.set(mKey, mAcc);
            }
            taAddTotals(mAcc, f);
          }

          if (matchesFact(f, { ignoreScenario: true })) {
            let sAcc = scenMap.get(f.scenario);
            if (!sAcc) {
              sAcc = { key: f.scenario, ...taMakeEmptyTotals(), subAgents: new Set() };
              scenMap.set(f.scenario, sAcc);
            }
            taAddTotals(sAcc, f);
            if (f.subagentType) sAcc.subAgents.add(f.subagentType);
          }

          if (c && matchesFact(f, { ignoreProject: true })) {
            let pAcc = projMap.get(c.projectKey);
            if (!pAcc) {
              pAcc = {
                key: c.projectKey,
                name: c.projectName,
                rootIds: new Set(),
                subIds: new Set(),
                modelScores: new Map(),
                ...taMakeEmptyTotals()
              };
              projMap.set(c.projectKey, pAcc);
            }
            taAddTotals(pAcc, f);
            pAcc.rootIds.add(c.rootId && conversations[c.rootId] ? c.rootId : c.id);
            if (c.isSubagent) pAcc.subIds.add(c.id);
            pAcc.modelScores.set(f.model, (pAcc.modelScores.get(f.model) || 0) + mv);
          }
        }

        for (const [dt, dAcc] of dailyMap.entries()) {
          dAcc.topProject = topKeyByScore(dailyProjScores.get(dt));
        }

        const activeDayList = [...activeDates.values()];
        const peakDay = activeDayList.reduce(
          (best, d) => (!best || taGetMetricVal(d, metric) > taGetMetricVal(best, metric) ? d : best),
          null
        );
        const heatmap = taBuildHeatmapGrid(dailyMap, {
          weeks: 26,
          nowSec,
          metric,
          rangeDays,
          selectedDate: state.selectedDate,
          rangeBounds
        });
        const inRangeActive = heatmap.days.filter((d) => d.inRange && d.total > 0);
        const avgDaily =
          inRangeActive.length > 0
            ? inRangeActive.reduce((sum, d) => sum + taGetMetricVal(d, metric), 0) / inRangeActive.length
            : 0;

        const baseSessions = [...rootGroups.values()].map((g) => {
          const cacheRate = taCalcCacheRate(g.rolled);
          const primaryModel = topKeyByScore(g.modelScores);
          const children = [...g.childrenMap.values()]
            .map((ch) => ({ ...ch, primaryModel: topKeyByScore(ch.modelScores), cacheRate: taCalcCacheRate(ch) }))
            .sort((a, b) => taGetMetricVal(b, metric) - taGetMetricVal(a, metric));
          const _searchHay = `${g.title} ${g.projectName} ${g.id} ${primaryModel} ${children.map((c) => `${c.title} ${c.agentName} ${c.id} ${c.primaryModel}`).join(' ')}`.toLowerCase();
          return {
            id: g.id,
            title: g.title,
            projectKey: g.projectKey,
            projectName: g.projectName,
            source: g.source,
            lastTs: g.lastTs,
            primaryModel,
            primaryScenario: topKeyByScore(g.scenarioScores) || 'internal',
            ...g.rolled,
            cacheRate,
            lowCacheWarning: cacheRate !== null && cacheRate < 0.8 && g.rolled.inTok >= 200000,
            children,
            _searchHay
          };
        });
        const sessions = taFilterAndSortSessions(baseSessions, state);

        return {
          kpi: {
            ...kpiTotals,
            cacheRate: taCalcCacheRate(kpiTotals),
            activeDays: activeDayList.length,
            windowDays: state.selectedDate ? 1 : rangeDays >= 365 ? Math.max(1, activeDayList.length) : rangeDays,
            peakDay,
            mainSessions: kpiRootIds.size,
            subagentCount: kpiSubIds.size,
            projectCount: kpiProjKeys.size
          },
          heatmap,
          avgDaily,
          models: [...modelMap.values()]
            .map((m) => ({ ...m, cacheRate: taCalcCacheRate(m) }))
            .sort((a, b) => taGetMetricVal(b, metric) - taGetMetricVal(a, metric)),
          scenarios: [...scenMap.values()]
            .map((s) => ({ ...s, subAgents: [...s.subAgents].sort() }))
            .sort((a, b) => taGetMetricVal(b, metric) - taGetMetricVal(a, metric)),
          baseSessions,
          sessions,
          projectsSummary: [...projMap.values()]
            .map((p) => ({
              ...p,
              sessionsCount: p.rootIds.size,
              subagentCount: p.subIds.size,
              topModel: topKeyByScore(p.modelScores),
              cacheRate: taCalcCacheRate(p)
            }))
            .sort((a, b) => taGetMetricVal(b, metric) - taGetMetricVal(a, metric))
        };
      }

      const uiState = {
        metric: 'weighted',
        rangeDays: 30,
        dailyMode: 'heatmap',
        modelGroup: 'model',
        explorerMode: 'sessions',
        selectedDate: null,
        selectedProject: 'ALL',
        selectedModel: null,
        selectedScenario: null,
        search: '',
        sort: 'metric',
        onlyLowCache: false,
        expandedIds: new Set()
      };
      const dataState = { loading: false, error: null, fetchedAt: 0, lastMetricsSig: '', modalClosedSinceFetch: false, payload: null };
      const hmDayByDate = new Map();
      const pendingRequests = new Map();
      let reqSeq = 0;
      let pendingOpenTokenTab = false;
      let pendingOpenTimer = null;
      let searchDebounceTimer = null;
      let cachedBaseVm = { key: '', payloadRef: null, vm: null };
      let tabActive = false;
      let syncRaf = null;
      let disposed = false;
      let hmTooltipVisible = false;
      let hmGlobalListenersBound = false;
      let activeHmCell = null;

      function getOrComputeViewModel() {
        if (!dataState.payload) return null;
        const minuteBucket = Math.floor(Date.now() / 60000);
        const key = `${minuteBucket}|${uiState.metric}|${uiState.rangeDays}|${uiState.selectedDate || ''}|${uiState.selectedProject || 'ALL'}|${uiState.modelGroup || 'model'}|${uiState.selectedModel || ''}|${uiState.selectedScenario || ''}`;
        if (cachedBaseVm.payloadRef === dataState.payload && cachedBaseVm.key === key && cachedBaseVm.vm) {
          return {
            ...cachedBaseVm.vm,
            sessions: taFilterAndSortSessions(cachedBaseVm.vm.baseSessions, uiState)
          };
        }
        const vm = taComputeViewModel(dataState.payload, uiState);
        cachedBaseVm = { key, payloadRef: dataState.payload, vm };
        return vm;
      }

      const fmtLastActive = (tsSec) => {
        if (!tsSec) return '--';
        const d = new Date(tsSec * 1000);
        const now = new Date();
        const pad2 = (n) => String(n).padStart(2, '0');
        const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
        if (d.toDateString() === now.toDateString()) return `今天 ${hm}`;
        if (d.toDateString() === new Date(now.getTime() - 86400000).toDateString()) return `昨天 ${hm}`;
        return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${hm}`;
      };

      window.__ag_on_token_analytics = (reqId, res) => {
        const entry = pendingRequests.get(String(reqId || ''));
        if (!entry) return;
        pendingRequests.delete(String(reqId || ''));
        clearTimeout(entry.timer);
        if (res && res.ok && res.data) entry.resolve(res.data);
        else entry.reject(new Error(res?.error || '本地 Token 统计数据获取失败'));
      };

      async function fetchTokenAnalytics(force = false) {
        if (disposed) return;
        const now = Date.now();
        const curMetricsSig = String(window.__ag_last_metrics?.sig || '');
        const sigChanged = Boolean(curMetricsSig && curMetricsSig !== dataState.lastMetricsSig);
        const reopenedStale = Boolean(dataState.modalClosedSinceFetch && now - dataState.fetchedAt > 3000);
        if (!force && !sigChanged && !reopenedStale && dataState.payload && now - dataState.fetchedAt < CACHE_TTL_MS) return;
        if (typeof window.__agRequestTokenAnalytics !== 'function') {
          dataState.error = '当前环境未启用本地 SQLite Token 统计（需 Node.js >= 22.13 且启用 modules.tokenAnalytics）';
          dataState.loading = false;
          renderPanel();
          return;
        }
        if (dataState.loading && !force) return;
        dataState.loading = true;
        dataState.error = null;
        if (dataState.payload) {
          const refreshBtn = document.getElementById(PANEL_ID)?.querySelector('#ag-ta-refresh-btn');
          if (refreshBtn) {
            refreshBtn.textContent = '刷新中…';
            refreshBtn.disabled = true;
          }
        } else {
          renderPanel();
        }
        const reqId = `ta-${Date.now()}-${++reqSeq}`;
        try {
          const data = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
              pendingRequests.delete(reqId);
              reject(new Error('读取本地 SQLite 统计超时 (25s)'));
            }, REQUEST_TIMEOUT_MS);
            pendingRequests.set(reqId, { resolve, reject, timer });
            try {
              window.__agRequestTokenAnalytics(JSON.stringify({ reqId, maxDays: 365, force }));
            } catch (err) {
              clearTimeout(timer);
              pendingRequests.delete(reqId);
              reject(err);
            }
          });
          if (disposed) return;
          dataState.payload = data;
          cachedBaseVm = { key: '', payloadRef: null, vm: null };
          dataState.fetchedAt = Date.now();
          dataState.lastMetricsSig = String(window.__ag_last_metrics?.sig || '');
          dataState.modalClosedSinceFetch = false;
        } catch (err) {
          if (!disposed) dataState.error = String(err?.message || err || '获取 Token 统计失败');
        } finally {
          if (!disposed) {
            dataState.loading = false;
            renderPanel();
          }
        }
      }

      function findActiveSettingsModal() {
        for (const container of document.querySelectorAll('.settings-modal-container')) {
          const backdrop = container.closest('.settings-modal-backdrop');
          if (backdrop?.getAttribute('aria-hidden') === 'true' || backdrop?.classList.contains('animate-modalFadeOut')) continue;
          if (container.classList.contains('animate-modalScaleOut')) continue;
          const r = container.getBoundingClientRect();
          if (r.width > 200 && r.height > 200) return container;
        }
        return null;
      }

      function ensureHmTooltip() {
        let tip = document.getElementById(HM_TOOLTIP_ID);
        if (!tip && document.body) {
          tip = document.createElement('div');
          tip.id = HM_TOOLTIP_ID;
          tip.setAttribute('data-ag-token-ui', '1');
          document.body.appendChild(tip);
        }
        return tip;
      }

      const onGlobalDismiss = () => {
        if (hmTooltipVisible) hideHmTooltip();
      };
      const onGlobalPointerMove = (ev) => {
        if (!hmTooltipVisible) return;
        if (!tabActive || !activeHmCell || !activeHmCell.isConnected) {
          hideHmTooltip();
          return;
        }
        const t = ev.target;
        if (!(t instanceof Element) || !t.closest('.ag-ta-hm-cell')) hideHmTooltip();
      };
      const onGlobalKeyDown = (ev) => {
        if (hmTooltipVisible && ev.key === 'Escape') hideHmTooltip();
      };
      function bindHmGlobalListeners() {
        if (hmGlobalListenersBound || disposed) return;
        hmGlobalListenersBound = true;
        window.addEventListener('scroll', onGlobalDismiss, { capture: true, passive: true });
        window.addEventListener('wheel', onGlobalDismiss, { capture: true, passive: true });
        window.addEventListener('resize', onGlobalDismiss, { passive: true });
        window.addEventListener('blur', onGlobalDismiss);
        document.addEventListener('pointermove', onGlobalPointerMove, { passive: true });
        document.addEventListener('keydown', onGlobalKeyDown, true);
      }
      function unbindHmGlobalListeners() {
        if (!hmGlobalListenersBound) return;
        hmGlobalListenersBound = false;
        window.removeEventListener('scroll', onGlobalDismiss, true);
        window.removeEventListener('wheel', onGlobalDismiss, true);
        window.removeEventListener('resize', onGlobalDismiss);
        window.removeEventListener('blur', onGlobalDismiss);
        document.removeEventListener('pointermove', onGlobalPointerMove);
        document.removeEventListener('keydown', onGlobalKeyDown, true);
      }
      function hideHmTooltip() {
        hmTooltipVisible = false;
        activeHmCell = null;
        unbindHmGlobalListeners();
        const tip = document.getElementById(HM_TOOLTIP_ID);
        if (tip && tip.getAttribute('data-visible') !== '0') tip.setAttribute('data-visible', '0');
      }
      function positionHmTooltip(tip, cell) {
        if (!tip || !cell || !cell.isConnected) return hideHmTooltip();
        const rect = cell.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return hideHmTooltip();
        const tipRect = tip.getBoundingClientRect();
        const tw = tipRect.width || 225;
        const th = tipRect.height || 120;
        const x = Math.max(8, Math.min(window.innerWidth - tw - 8, rect.left + rect.width / 2 - tw / 2));
        let y = rect.top - th - 8;
        if (y < 8) y = Math.min(window.innerHeight - th - 8, rect.bottom + 8);
        tip.style.left = `${Math.round(x)}px`;
        tip.style.top = `${Math.round(y)}px`;
      }
      function showHmTooltipForCell(cell) {
        if (!cell || !cell.isConnected || !tabActive) return;
        const d = hmDayByDate.get(cell.getAttribute('data-hm-date') || '');
        const tip = d ? ensureHmTooltip() : null;
        if (!d || !tip) return;
        const cRate = taCalcCacheRate(d);
        const cRateStr = cRate !== null ? `${(cRate * 100).toFixed(1)}%` : '--';
        tip.innerHTML =
          `<div class="ag-ta-tt-hdr ag-ta-num-font"><span>${esc(d.date)}</span><span style="color:var(--ag-ta-primary);">${esc(taFormatMetricVal(d, uiState.metric))}</span></div>` +
          (d.calls > 0
            ? `<div class="ag-ta-tt-row"><span>加权等效</span><strong class="ag-ta-num-font">${taFormatCompact(d.weighted)}</strong></div>` +
              `<div class="ag-ta-tt-row"><span>总 Tokens</span><strong class="ag-ta-num-font">${taFormatCompact(d.total)}</strong></div>` +
              `<div class="ag-ta-tt-row"><span>新入 / 缓读 / 出</span><strong class="ag-ta-num-font">${taFormatCompact(d.inTok)} / ${taFormatCompact(d.cacheRead)} / ${taFormatCompact(d.outTok)}</strong></div>` +
              `<div class="ag-ta-tt-row"><span>调用 / 缓存命中</span><strong class="ag-ta-num-font">${d.calls} 次 · ${cRateStr}</strong></div>` +
              (d.topProject
                ? `<div class="ag-ta-tt-row" style="margin-top:4px;padding-top:4px;border-top:1px solid var(--ag-ta-border);"><span>主力项目</span><strong>${esc(d.topProject)}</strong></div>`
                : '')
            : `<div style="color:var(--ag-ta-muted);">当日无本地调用记录</div>`);
        activeHmCell = cell;
        hmTooltipVisible = true;
        bindHmGlobalListeners();
        tip.setAttribute('data-visible', '1');
        positionHmTooltip(tip, cell);
      }

      function ensurePanelSkeleton(panel) {
        if (panel.dataset.agSkeletonReady === '1') return;
        panel.dataset.agSkeletonReady = '1';
        panel.innerHTML = `
      <div class="ag-ta-wrap">
        <div class="ag-ta-hdr">
          <div>
            <div class="ag-ta-title-row">
              <h1 class="ag-ta-h1">Token 消耗分析</h1>
              <span id="ag-ta-header-badge" class="ag-ta-pill-meta ag-ta-num-font">待同步</span>
            </div>
            <p class="ag-ta-sub">基于本机 <span class="ag-ta-mono">conversations/*.db</span> 与 <span class="ag-ta-mono">conversation_summaries.db</span> 只读增量归因</p>
          </div>
          <div class="ag-ta-controls">
            <div class="ag-ta-seg" id="ag-ta-metric-sw">
              <button type="button" class="ag-ta-seg-btn active" data-metric="weighted">加权等效</button>
              <button type="button" class="ag-ta-seg-btn" data-metric="total">总 Tokens</button>
              <button type="button" class="ag-ta-seg-btn" data-metric="billable">净新消耗</button>
              <button type="button" class="ag-ta-seg-btn" data-metric="calls">调用次数</button>
            </div>
            <div class="ag-ta-seg" id="ag-ta-range-sw">
              <button type="button" class="ag-ta-seg-btn" data-range="1">今日</button>
              <button type="button" class="ag-ta-seg-btn" data-range="7">7天</button>
              <button type="button" class="ag-ta-seg-btn active" data-range="30">30天</button>
              <button type="button" class="ag-ta-seg-btn" data-range="90">90天</button>
              <button type="button" class="ag-ta-seg-btn" data-range="365">全部</button>
            </div>
            <button type="button" id="ag-ta-refresh-btn" class="ag-ta-refresh" title="点击增量刷新；按住 Shift 点击强制忽略磁盘缓存全量重算">刷新</button>
          </div>
        </div>
        <div id="ag-ta-filters-bar" class="ag-ta-filters-bar" hidden>
          <span>当前联动筛选：</span>
          <div id="ag-ta-filter-pills" style="display:flex;flex-wrap:wrap;gap:6px;"></div>
          <button type="button" id="ag-ta-clear-filters" class="ag-ta-clear-btn">清除全部</button>
        </div>
        <div id="ag-ta-status-banner" class="ag-ta-banner" hidden></div>
        <div id="ag-ta-kpi-grid" class="ag-ta-kpis"></div>
        <section class="ag-ta-card">
          <div class="ag-ta-card-head">
            <div>
              <h2 class="ag-ta-card-h2">按日消耗记录</h2>
              <p class="ag-ta-card-desc">悬停查看单日详情，点击任意日期格子可联动筛选下方模型、场景与会话</p>
            </div>
            <div class="ag-ta-controls">
              <div class="ag-ta-seg" id="ag-ta-daily-sw">
                <button type="button" class="ag-ta-seg-btn active" data-dmode="heatmap">贡献网格</button>
                <button type="button" class="ag-ta-seg-btn" data-dmode="bars">近14日趋势</button>
              </div>
              <div id="ag-ta-hm-legend" class="ag-ta-hm-legend">
                <span>少</span><span class="ag-ta-hm-sw" data-lvl="0"></span><span class="ag-ta-hm-sw" data-lvl="1"></span><span class="ag-ta-hm-sw" data-lvl="2"></span><span class="ag-ta-hm-sw" data-lvl="3"></span><span class="ag-ta-hm-sw" data-lvl="4"></span><span>多</span>
              </div>
            </div>
          </div>
          <div id="ag-ta-hm-wrap" class="ag-ta-hm-scroll">
            <div class="ag-ta-hm-inner">
              <div id="ag-ta-hm-months" class="ag-ta-hm-months"></div>
              <div class="ag-ta-hm-body">
                <div class="ag-ta-hm-days"><span>一</span><span>三</span><span>五</span><span>日</span></div>
                <div id="ag-ta-hm-grid" class="ag-ta-hm-grid"></div>
              </div>
            </div>
          </div>
          <div id="ag-ta-bars-wrap" hidden>
            <div id="ag-ta-bars-chart" class="ag-ta-bars-chart"></div>
            <div class="ag-ta-legend" style="justify-content:flex-end;border-top:none;margin-top:4px;padding-top:4px;">
              <span class="ag-ta-legend-item"><span class="ag-ta-swatch ag-ta-seg-in"></span>新输入</span>
              <span class="ag-ta-legend-item"><span class="ag-ta-swatch ag-ta-seg-cache"></span>缓存读取</span>
              <span class="ag-ta-legend-item"><span class="ag-ta-swatch ag-ta-seg-out"></span>输出（含思考）</span>
            </div>
          </div>
          <div id="ag-ta-daily-footer" class="ag-ta-foot"></div>
        </section>
        <section class="ag-ta-split">
          <div class="ag-ta-card ag-ta-card-col">
            <div class="ag-ta-card-head">
              <div><h2 class="ag-ta-card-h2">按模型统计</h2><p class="ag-ta-card-desc">点击模型行联动筛选</p></div>
              <div class="ag-ta-seg" id="ag-ta-model-sw">
                <button type="button" class="ag-ta-seg-btn active" data-mg="model">具体模型</button>
                <button type="button" class="ag-ta-seg-btn" data-mg="pool">配额池</button>
              </div>
            </div>
            <div id="ag-ta-model-list" class="ag-ta-list"></div>
            <div class="ag-ta-legend">
              <span class="ag-ta-legend-item"><span class="ag-ta-swatch ag-ta-seg-in"></span>新输入</span>
              <span class="ag-ta-legend-item"><span class="ag-ta-swatch ag-ta-seg-cache"></span>缓存命中</span>
              <span class="ag-ta-legend-item"><span class="ag-ta-swatch ag-ta-seg-think"></span>思考</span>
              <span class="ag-ta-legend-item"><span class="ag-ta-swatch ag-ta-seg-out"></span>正文回复</span>
            </div>
          </div>
          <div class="ag-ta-card ag-ta-card-col">
            <div class="ag-ta-card-head">
              <div><h2 class="ag-ta-card-h2">按场景统计</h2><p class="ag-ta-card-desc">工具执行 / 子 Agent / 纯对话 / 规划 / 记忆压缩</p></div>
              <span class="ag-ta-badge" title="所有数字来自本机已落盘的 conversations/*.db，不含未落盘的云端后台任务">本地轨迹口径</span>
            </div>
            <div id="ag-ta-scenario-list" class="ag-ta-list"></div>
            <div class="ag-ta-foot"><span>仅统计本地已落盘对话轨迹；点击场景行可联动筛选</span></div>
          </div>
        </section>
        <section class="ag-ta-card">
          <div class="ag-ta-card-head">
            <div><h2 class="ag-ta-card-h2">按会话与项目统计</h2><p class="ag-ta-card-desc">同名项目已合并大小写并折叠 <span class="ag-ta-mono">/tmp</span>，支持父会话展开子 Agent 轨迹</p></div>
            <div class="ag-ta-seg" id="ag-ta-explorer-sw">
              <button type="button" class="ag-ta-seg-btn active" data-emode="sessions">会话明细</button>
              <button type="button" class="ag-ta-seg-btn" data-emode="projects">项目汇总</button>
            </div>
          </div>
          <div id="ag-ta-project-chips" class="ag-ta-chips"></div>
          <div class="ag-ta-toolbar">
            <div class="ag-ta-search-wrap">
              <svg class="ag-ta-search-icon" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
              <input id="ag-ta-search-input" class="ag-ta-input" type="text" placeholder="搜索会话标题、项目名或 ID…" />
            </div>
            <select id="ag-ta-sort-select" class="ag-ta-select">
              <option value="metric">排序：按当前指标</option>
              <option value="weighted">排序：加权等效</option>
              <option value="total">排序：总 Tokens</option>
              <option value="inTok">排序：未缓存输入</option>
              <option value="outTok">排序：输出 Tokens</option>
              <option value="calls">排序：调用次数</option>
              <option value="lowCache">排序：低缓存命中优先</option>
              <option value="recent">排序：最近活跃</option>
            </select>
            <label class="ag-ta-check-lbl"><input id="ag-ta-lowcache-cb" type="checkbox" /><span>仅低缓存预警 (&lt;80%)</span></label>
          </div>
          <div id="ag-ta-sessions-wrap" class="ag-ta-table-wrap">
            <table class="ag-ta-table">
              <thead><tr><th>会话 / 项目</th><th>主力模型 &amp; 场景</th><th class="ag-ta-num">调用</th><th class="ag-ta-num">消耗与构成</th><th class="ag-ta-num">缓存命中</th><th class="ag-ta-num">最近活跃</th></tr></thead>
              <tbody id="ag-ta-sessions-tbody"></tbody>
            </table>
          </div>
          <div id="ag-ta-projects-wrap" class="ag-ta-proj-grid" hidden></div>
        </section>
      </div>`;

        panel.addEventListener('click', (e) => {
          const el = e.target instanceof Element ? e.target : null;
          if (!el) return;
          const btn = el.closest('[data-metric], [data-range], [data-dmode], [data-mg], [data-emode], [data-hm-date], [data-bar-date], [data-model-key], [data-scen-key], [data-proj-key], [data-proj-card], [data-toggle-sub], [data-clear-filter], #ag-ta-refresh-btn, #ag-ta-clear-filters');
          if (!btn) return;
          if (btn.id === 'ag-ta-refresh-btn') return void fetchTokenAnalytics(e.shiftKey ? 'hard' : true);
          if (btn.id === 'ag-ta-clear-filters') {
            uiState.selectedDate = null;
            uiState.selectedProject = 'ALL';
            uiState.selectedModel = null;
            uiState.selectedScenario = null;
            return renderPanel();
          }
          const clr = btn.getAttribute('data-clear-filter');
          if (clr) {
            if (clr === 'date') uiState.selectedDate = null;
            else if (clr === 'project') uiState.selectedProject = 'ALL';
            else if (clr === 'model') uiState.selectedModel = null;
            else if (clr === 'scenario') uiState.selectedScenario = null;
            return renderPanel();
          }
          const subId = btn.getAttribute('data-toggle-sub');
          if (subId) {
            if (uiState.expandedIds.has(subId)) uiState.expandedIds.delete(subId);
            else uiState.expandedIds.add(subId);
            return renderExplorerOnly();
          }
          if (btn.hasAttribute('data-metric')) uiState.metric = btn.getAttribute('data-metric') || 'weighted';
          else if (btn.hasAttribute('data-range')) {
            const nextRange = Number(btn.getAttribute('data-range') || 30);
            uiState.rangeDays = nextRange;
            if (uiState.selectedDate && !taIsDateInRange(uiState.selectedDate, nextRange, dataState.payload?.nowSec)) {
              uiState.selectedDate = null;
            }
          }
          else if (btn.hasAttribute('data-dmode')) uiState.dailyMode = btn.getAttribute('data-dmode') || 'heatmap';
          else if (btn.hasAttribute('data-mg')) {
            uiState.modelGroup = btn.getAttribute('data-mg') || 'model';
            uiState.selectedModel = null;
          } else if (btn.hasAttribute('data-emode')) uiState.explorerMode = btn.getAttribute('data-emode') || 'sessions';
          else if (btn.hasAttribute('data-hm-date') || btn.hasAttribute('data-bar-date')) {
            hideHmTooltip();
            const dt = btn.getAttribute('data-hm-date') || btn.getAttribute('data-bar-date');
            uiState.selectedDate = uiState.selectedDate === dt ? null : dt;
          } else if (btn.hasAttribute('data-model-key')) {
            const k = btn.getAttribute('data-model-key');
            uiState.selectedModel = uiState.selectedModel === k ? null : k;
          } else if (btn.hasAttribute('data-scen-key')) {
            const k = btn.getAttribute('data-scen-key');
            uiState.selectedScenario = uiState.selectedScenario === k ? null : k;
          } else if (btn.hasAttribute('data-proj-key')) {
            uiState.selectedProject = btn.getAttribute('data-proj-key') || 'ALL';
          } else if (btn.hasAttribute('data-proj-card')) {
            uiState.selectedProject = btn.getAttribute('data-proj-card') || 'ALL';
            uiState.explorerMode = 'sessions';
          }
          renderPanel();
        });

        panel.addEventListener('scroll', hideHmTooltip, { passive: true });
        panel.addEventListener('wheel', hideHmTooltip, { passive: true });
        panel.querySelector('#ag-ta-hm-wrap')?.addEventListener('scroll', hideHmTooltip, { passive: true });
        const hmGrid = panel.querySelector('#ag-ta-hm-grid');
        if (hmGrid) {
          hmGrid.addEventListener('pointerover', (e) => {
            const cell = e.target instanceof Element ? e.target.closest('.ag-ta-hm-cell[data-hm-date]') : null;
            if (cell) showHmTooltipForCell(cell);
            else hideHmTooltip();
          });
          hmGrid.addEventListener('pointerleave', hideHmTooltip);
          hmGrid.addEventListener('mouseleave', hideHmTooltip);
        }
        panel.querySelector('#ag-ta-search-input')?.addEventListener('input', (e) => {
          uiState.search = e.target.value || '';
          if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
          searchDebounceTimer = setTimeout(() => {
            searchDebounceTimer = null;
            renderExplorerOnly();
          }, 80);
        });
        panel.querySelector('#ag-ta-sort-select')?.addEventListener('change', (e) => {
          uiState.sort = e.target.value || 'metric';
          renderExplorerOnly();
        });
        panel.querySelector('#ag-ta-lowcache-cb')?.addEventListener('change', (e) => {
          uiState.onlyLowCache = Boolean(e.target.checked);
          renderExplorerOnly();
        });
      }

      function syncPanelSwitchers(panel) {
        const specs = [
          ['#ag-ta-metric-sw', 'data-metric', uiState.metric],
          ['#ag-ta-range-sw', 'data-range', String(uiState.rangeDays)],
          ['#ag-ta-daily-sw', 'data-dmode', uiState.dailyMode],
          ['#ag-ta-model-sw', 'data-mg', uiState.modelGroup],
          ['#ag-ta-explorer-sw', 'data-emode', uiState.explorerMode]
        ];
        for (const [sel, attr, val] of specs) {
          panel.querySelectorAll(`${sel} .ag-ta-seg-btn`).forEach((b) => {
            b.classList.toggle('active', b.getAttribute(attr) === val);
          });
        }
        panel.querySelector('#ag-ta-hm-wrap').hidden = uiState.dailyMode !== 'heatmap';
        panel.querySelector('#ag-ta-hm-legend').hidden = uiState.dailyMode !== 'heatmap';
        panel.querySelector('#ag-ta-bars-wrap').hidden = uiState.dailyMode !== 'bars';
        panel.querySelector('#ag-ta-sessions-wrap').hidden = uiState.explorerMode !== 'sessions';
        panel.querySelector('#ag-ta-projects-wrap').hidden = uiState.explorerMode !== 'projects';
        const si = panel.querySelector('#ag-ta-search-input');
        if (si && si.value !== uiState.search) si.value = uiState.search;
        const ss = panel.querySelector('#ag-ta-sort-select');
        if (ss && ss.value !== uiState.sort) ss.value = uiState.sort;
        const cb = panel.querySelector('#ag-ta-lowcache-cb');
        if (cb && cb.checked !== uiState.onlyLowCache) cb.checked = uiState.onlyLowCache;
      }

      function renderExplorerSections(panel, vm) {
        const chipsEl = panel.querySelector('#ag-ta-project-chips');
        if (chipsEl) {
          chipsEl.innerHTML = [{ key: 'ALL', name: '全部项目' }, ...(dataState.payload?.projects || [])]
            .map((p) => `<button type="button" class="ag-ta-chip ${uiState.selectedProject === p.key ? 'active' : ''}" data-proj-key="${esc(p.key)}">${esc(p.name)}</button>`)
            .join('');
        }
        const tbody = panel.querySelector('#ag-ta-sessions-tbody');
        if (tbody) {
          if (!vm || vm.sessions.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="ag-ta-empty">${dataState.loading ? '正在扫描本地会话数据库…' : '当前筛选条件下没有匹配的会话记录'}</td></tr>`;
          } else {
            const rowsHtml = [];
            for (const s of vm.sessions.slice(0, 80)) {
              const hasKids = s.children.length > 0;
              const isExp = uiState.expandedIds.has(s.id);
              const tot = Math.max(1, s.total);
              const inP = (s.inTok / tot) * 100;
              const cP = (s.cacheRead / tot) * 100;
              const oP = Math.max(0, 100 - inP - cP);
              const rateText = s.cacheRate !== null ? `${(s.cacheRate * 100).toFixed(1)}%` : '--';
              rowsHtml.push(
                `<tr><td class="ag-ta-sess-td"><div class="ag-ta-sess-cell">` +
                  (hasKids ? `<button type="button" class="ag-ta-exp-btn" data-toggle-sub="${esc(s.id)}">${isExp ? '▾' : '▸'}</button>` : `<span class="ag-ta-exp-pad"></span>`) +
                  `<div style="min-width:0;flex:1 1 auto;"><div class="ag-ta-sess-title" title="${esc(s.title)}">${esc(s.title)}</div><div class="ag-ta-sess-tags">` +
                  `<span class="ag-ta-badge ag-ta-mono" title="${esc(s.projectName)}">${esc(s.projectName)}</span>` +
                  (s.source === 'cli' ? `<span class="ag-ta-badge ag-ta-mono">CLI</span>` : '') +
                  (hasKids ? `<span class="ag-ta-sub-badge">含 ${s.children.length} 个子 Agent</span>` : '') +
                  `<span class="ag-ta-mono" style="color:var(--ag-ta-muted);font-size:11px;">${esc(s.id.slice(0, 8))}</span></div></div></div></td>` +
                  `<td class="ag-ta-model-td"><div class="ag-ta-model-cell" title="${esc(s.primaryModel || '--')}">${esc(s.primaryModel || '--')}</div><div style="color:var(--ag-ta-muted);font-size:11px;margin-top:2px;">${esc(TA_SCENARIO_META[s.primaryScenario]?.label || s.primaryScenario)}</div></td>` +
                  `<td class="ag-ta-num ag-ta-num-font">${s.calls}</td>` +
                  `<td class="ag-ta-num"><div class="ag-ta-num-font" style="font-weight:600;">${esc(taFormatMetricVal(s, uiState.metric))}</div>` +
                  `<div class="ag-ta-mini-bar" title="新入 ${taFormatCompact(s.inTok)} · 缓读 ${taFormatCompact(s.cacheRead)} · 出 ${taFormatCompact(s.outTok)}"><div class="ag-ta-seg-in" style="width:${inP}%"></div><div class="ag-ta-seg-cache" style="width:${cP}%"></div><div class="ag-ta-seg-out" style="width:${oP}%"></div></div></td>` +
                  `<td class="ag-ta-num ag-ta-num-font"><span class="${s.lowCacheWarning ? 'ag-ta-lowcache' : ''}">${rateText}</span></td>` +
                  `<td class="ag-ta-num ag-ta-num-font" style="color:var(--ag-ta-muted);">${esc(fmtLastActive(s.lastTs))}</td></tr>`
              );
              if (hasKids && isExp) {
                for (const c of s.children) {
                  rowsHtml.push(
                    `<tr class="ag-ta-subrow"><td class="ag-ta-sess-td" style="padding-left:24px;"><div style="display:flex;align-items:center;gap:6px;max-width:100%;min-width:0;"><span style="color:var(--ag-ta-muted);">↳</span><span class="ag-ta-badge ag-ta-mono">${esc(c.agentName)}</span><span style="color:var(--ag-ta-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(c.title)}">${esc(c.title)}</span></div></td>` +
                      `<td class="ag-ta-model-td" style="color:var(--ag-ta-muted);"><div class="ag-ta-model-cell" title="${esc(c.primaryModel || '--')}">${esc(c.primaryModel || '--')}</div></td>` +
                      `<td class="ag-ta-num ag-ta-num-font" style="color:var(--ag-ta-muted);">${c.calls}</td>` +
                      `<td class="ag-ta-num ag-ta-num-font" style="color:var(--ag-ta-muted);">${esc(taFormatMetricVal(c, uiState.metric))}</td>` +
                      `<td class="ag-ta-num ag-ta-num-font" style="color:var(--ag-ta-muted);">${c.cacheRate !== null ? `${(c.cacheRate * 100).toFixed(1)}%` : '--'}</td>` +
                      `<td class="ag-ta-num ag-ta-num-font" style="color:var(--ag-ta-muted);">子轨迹</td></tr>`
                  );
                }
              }
            }
            tbody.innerHTML = rowsHtml.join('');
          }
        }
        const projWrap = panel.querySelector('#ag-ta-projects-wrap');
        if (projWrap) {
          if (!vm || vm.projectsSummary.length === 0) {
            projWrap.innerHTML = `<div class="ag-ta-empty" style="grid-column:1/-1;">当前筛选条件下无项目数据</div>`;
          } else {
            const projSum = Math.max(1, vm.projectsSummary.reduce((acc, p) => acc + taGetMetricVal(p, uiState.metric), 0));
            projWrap.innerHTML = vm.projectsSummary
              .map((p) => {
                const share = (taGetMetricVal(p, uiState.metric) / projSum) * 100;
                const rate = p.cacheRate !== null ? `${(p.cacheRate * 100).toFixed(1)}%` : '--';
                return (
                  `<div class="ag-ta-proj-card" data-proj-card="${esc(p.key)}">` +
                  `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;"><span class="ag-ta-mono" style="font-weight:600;font-size:13px;">${esc(p.name)}</span><span class="ag-ta-num-font" style="font-weight:600;color:var(--ag-ta-primary);">${esc(taFormatMetricVal(p, uiState.metric))}</span></div>` +
                  `<div class="ag-ta-track" style="margin:7px 0;"><div class="ag-ta-track-inner" style="width:${Math.max(4, share)}%;background-color:var(--ag-ta-primary);"></div></div>` +
                  `<div class="ag-ta-num-font" style="display:flex;justify-content:space-between;gap:8px;font-size:11.5px;color:var(--ag-ta-muted);"><span>${p.sessionsCount} 会话 · ${p.subagentCount} 个子 Agent · ${p.calls} 次</span><span>缓存 ${rate} · 占 ${share.toFixed(1)}%</span></div>` +
                  `<div style="margin-top:5px;font-size:11.5px;color:var(--ag-ta-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">主力模型：${esc(p.topModel || '--')}</div></div>`
                );
              })
              .join('');
          }
        }
      }

      function renderExplorerOnly() {
        const panel = document.getElementById(PANEL_ID);
        const vm = panel ? getOrComputeViewModel() : null;
        if (panel && vm) renderExplorerSections(panel, vm);
      }

      function renderPanel() {
        const panel = document.getElementById(PANEL_ID);
        if (!panel || panel.hidden) return;
        ensurePanelSkeleton(panel);
        syncPanelSwitchers(panel);

        const refreshBtn = panel.querySelector('#ag-ta-refresh-btn');
        if (refreshBtn) {
          refreshBtn.textContent = dataState.loading ? '刷新中…' : '刷新';
          refreshBtn.disabled = Boolean(dataState.loading);
        }

        const banner = panel.querySelector('#ag-ta-status-banner');
        if (banner) {
          if (dataState.error) {
            banner.hidden = false;
            banner.setAttribute('data-kind', 'error');
            banner.textContent = dataState.error;
          } else if (dataState.loading && !dataState.payload) {
            banner.hidden = false;
            banner.removeAttribute('data-kind');
            banner.textContent = '正在从本地 SQLite 增量统计全部会话消耗…';
          } else {
            banner.hidden = true;
          }
        }

        const badge = panel.querySelector('#ag-ta-header-badge');
        const st = dataState.payload?.stats;
        if (badge && st) {
          badge.textContent = `${st.scannedDbs}/${st.dbCount} 会话库 · ${st.totalCalls} 次调用 · ${dataState.payload.elapsedMs}ms`;
        }

        const filterPills = [];
        if (uiState.selectedDate) filterPills.push(['date', `日期: ${uiState.selectedDate}`]);
        if (uiState.selectedProject !== 'ALL') {
          const pName = dataState.payload?.projects?.find((p) => p.key === uiState.selectedProject)?.name || uiState.selectedProject;
          filterPills.push(['project', `项目: ${pName}`]);
        }
        if (uiState.selectedModel) filterPills.push(['model', `模型: ${uiState.selectedModel}`]);
        if (uiState.selectedScenario) {
          filterPills.push(['scenario', `场景: ${TA_SCENARIO_META[uiState.selectedScenario]?.label || uiState.selectedScenario}`]);
        }
        const fBar = panel.querySelector('#ag-ta-filters-bar');
        const fWrap = panel.querySelector('#ag-ta-filter-pills');
        if (fBar && fWrap) {
          fBar.hidden = filterPills.length === 0;
          fWrap.innerHTML = filterPills
            .map(([k, lbl]) => `<button type="button" class="ag-ta-filter-pill" data-clear-filter="${k}"><span>${esc(lbl)}</span><span style="opacity:0.65;">×</span></button>`)
            .join('');
        }

        const vm = getOrComputeViewModel();
        if (!vm) return;
        const { kpi } = vm;
        const metricLabels = {
          weighted: '加权等效消耗（主指标）',
          total: '总消耗 Tokens',
          billable: '净新消耗（非缓存）',
          calls: 'LLM 总调用次数'
        };
        const ratePct = kpi.cacheRate !== null ? (kpi.cacheRate * 100).toFixed(1) : '--';
        const rateTone = kpi.cacheRate !== null ? (kpi.cacheRate >= 0.8 ? 'ok' : 'warn') : '';
        const peakText = kpi.peakDay ? `${kpi.peakDay.date.slice(5)} (${taFormatMetricVal(kpi.peakDay, uiState.metric)})` : '--';

        panel.querySelector('#ag-ta-kpi-grid').innerHTML =
          `<div class="ag-ta-card"><div class="ag-ta-kpi-lbl">${esc(metricLabels[uiState.metric])}</div><div class="ag-ta-kpi-val ag-ta-num-font">${esc(taFormatMetricVal(kpi, uiState.metric))}</div><div class="ag-ta-kpi-sub ag-ta-num-font">新入 ${taFormatCompact(kpi.inTok)} · 缓读 ${taFormatCompact(kpi.cacheRead)} · 出 ${taFormatCompact(kpi.outTok)}</div></div>` +
          `<div class="ag-ta-card"><div class="ag-ta-kpi-lbl">平均缓存命中率</div><div class="ag-ta-kpi-val ag-ta-num-font" data-tone="${rateTone}">${ratePct === '--' ? '--' : `${ratePct}%`}</div><div class="ag-ta-kpi-sub">总输入 <span class="ag-ta-num-font">${taFormatCompact(kpi.inTok + kpi.cacheRead)}</span> · 思考 <span class="ag-ta-num-font">${taFormatCompact(kpi.thinkTok)}</span></div></div>` +
          `<div class="ag-ta-card"><div class="ag-ta-kpi-lbl">活跃天数 &amp; 单日峰值</div><div class="ag-ta-kpi-val ag-ta-num-font">${kpi.activeDays} <span style="font-size:12px;font-weight:400;color:var(--ag-ta-muted);">/ ${kpi.windowDays} 天</span></div><div class="ag-ta-kpi-sub ag-ta-num-font">峰值 ${esc(peakText)}</div></div>` +
          `<div class="ag-ta-card"><div class="ag-ta-kpi-lbl">归因覆盖范围</div><div class="ag-ta-kpi-val ag-ta-num-font">${kpi.mainSessions} <span style="font-size:12px;font-weight:400;color:var(--ag-ta-muted);">主会话</span></div><div class="ag-ta-kpi-sub">覆盖 <span class="ag-ta-num-font">${kpi.projectCount}</span> 个项目 · 含 <span class="ag-ta-num-font">${kpi.subagentCount}</span> 个子 Agent</div></div>`;

        hideHmTooltip();
        hmDayByDate.clear();
        const monthsHtml = [];
        const colsHtml = [];
        let lastMonth = -1;
        for (const wk of vm.heatmap.weeks) {
          const firstDay = wk.find(Boolean);
          const mTxt = firstDay && firstDay.month !== lastMonth ? `${(lastMonth = firstDay.month)}月` : '';
          monthsHtml.push(`<div class="ag-ta-hm-mlbl">${mTxt}</div>`);
          const cells = wk.map((d) => {
            if (!d) return '<div class="ag-ta-hm-pad"></div>';
            hmDayByDate.set(d.date, d);
            const cls = `ag-ta-hm-cell${d.selected ? ' selected' : ''}${!d.inRange && !uiState.selectedDate ? ' out-range' : ''}`;
            return `<div class="${cls}" data-lvl="${d.level}" data-hm-date="${esc(d.date)}"></div>`;
          });
          colsHtml.push(`<div class="ag-ta-hm-col">${cells.join('')}</div>`);
        }
        panel.querySelector('#ag-ta-hm-months').innerHTML = monthsHtml.join('');
        panel.querySelector('#ag-ta-hm-grid').innerHTML = colsHtml.join('');

        const last14 = vm.heatmap.last14;
        const max14 = Math.max(1, ...last14.map((d) => taGetMetricVal(d, uiState.metric)));
        panel.querySelector('#ag-ta-bars-chart').innerHTML = last14
          .map((d) => {
            const val = taGetMetricVal(d, uiState.metric);
            const hPct = Math.max(val > 0 ? 6 : 2, Math.round((val / max14) * 100));
            const sum = Math.max(1, d.total);
            const inP = (d.inTok / sum) * 100;
            const cP = (d.cacheRead / sum) * 100;
            const oP = Math.max(0, 100 - inP - cP);
            return `<div class="ag-ta-bar-col ${d.selected ? 'selected' : ''}" data-bar-date="${esc(d.date)}" title="${esc(d.date)}: ${esc(taFormatMetricVal(d, uiState.metric))}"><div class="ag-ta-bar-val ag-ta-num-font">${esc(taFormatMetricVal(d, uiState.metric))}</div><div class="ag-ta-bar-stack" style="height:${hPct}%;"><div class="ag-ta-seg-out" style="height:${oP}%;"></div><div class="ag-ta-seg-cache" style="height:${cP}%;"></div><div class="ag-ta-seg-in" style="height:${inP}%;"></div></div><div class="ag-ta-bar-dt ag-ta-num-font">${esc(d.date.slice(8))}</div></div>`;
          })
          .join('');

        const avgStr = uiState.metric === 'calls' ? `${Math.round(vm.avgDaily)} 次/日` : `${taFormatCompact(vm.avgDaily)}/日`;
        panel.querySelector('#ag-ta-daily-footer').innerHTML =
          `<div style="display:flex;flex-wrap:wrap;gap:14px;"><span>当前连续活跃：<strong class="ag-ta-num-font" style="color:var(--ag-ta-fg);">${vm.heatmap.streak} 天</strong></span><span>窗口内活跃日均：<strong class="ag-ta-num-font" style="color:var(--ag-ta-fg);">${avgStr}</strong></span></div>` +
          `<span>${uiState.selectedDate ? `已锁定单日：${esc(uiState.selectedDate)}（再次点击取消）` : '展示近 26 周（高亮当前时间窗）'}</span>`;

        const modelListEl = panel.querySelector('#ag-ta-model-list');
        if (vm.models.length === 0) {
          modelListEl.innerHTML = '<div class="ag-ta-empty">当前筛选下无模型记录</div>';
        } else {
          const mSum = Math.max(1, vm.models.reduce((acc, m) => acc + taGetMetricVal(m, uiState.metric), 0));
          const mMax = Math.max(1, ...vm.models.map((m) => taGetMetricVal(m, uiState.metric)));
          modelListEl.innerHTML = vm.models
            .map((m) => {
              const val = taGetMetricVal(m, uiState.metric);
              const tot = Math.max(1, m.total);
              const inW = (m.inTok / tot) * 100;
              const cacheW = (m.cacheRead / tot) * 100;
              const thinkW = (m.thinkTok / tot) * 100;
              const respW = Math.max(0, 100 - inW - cacheW - thinkW);
              const rateStr = m.cacheRate !== null ? `${Math.round(m.cacheRate * 100)}%` : '--';
              return (
                `<div class="ag-ta-row-btn ${uiState.selectedModel === m.key ? 'active' : ''}" data-model-key="${esc(m.key)}">` +
                `<div class="ag-ta-row-top"><div class="ag-ta-row-name"><span title="${esc(m.key)}">${esc(m.key)}</span>${uiState.modelGroup === 'model' ? `<span class="ag-ta-badge">${esc(m.pool)}</span>` : ''}</div>` +
                `<div class="ag-ta-row-nums ag-ta-num-font"><span style="color:var(--ag-ta-muted);">${m.calls}次 · ${rateStr}</span><span style="font-weight:600;">${esc(taFormatMetricVal(m, uiState.metric))}</span><span style="color:var(--ag-ta-muted);width:38px;text-align:right;">${((val / mSum) * 100).toFixed(1)}%</span></div></div>` +
                `<div class="ag-ta-track"><div class="ag-ta-track-inner" style="width:${Math.max(4, (val / mMax) * 100)}%;"><div class="ag-ta-seg-in" style="width:${inW}%;"></div><div class="ag-ta-seg-cache" style="width:${cacheW}%;"></div><div class="ag-ta-seg-think" style="width:${thinkW}%;"></div><div class="ag-ta-seg-out" style="width:${respW}%;"></div></div></div></div>`
              );
            })
            .join('');
        }

        const scenListEl = panel.querySelector('#ag-ta-scenario-list');
        if (vm.scenarios.length === 0) {
          scenListEl.innerHTML = '<div class="ag-ta-empty">当前筛选下无场景记录</div>';
        } else {
          const sSum = Math.max(1, vm.scenarios.reduce((acc, s) => acc + taGetMetricVal(s, uiState.metric), 0));
          const sMax = Math.max(1, ...vm.scenarios.map((s) => taGetMetricVal(s, uiState.metric)));
          scenListEl.innerHTML = vm.scenarios
            .map((s) => {
              const meta = TA_SCENARIO_META[s.key] || { label: s.key, desc: '', color: 'var(--ag-ta-c6)' };
              const val = taGetMetricVal(s, uiState.metric);
              const extra = s.subAgents.length > 0 ? ` (${s.subAgents.join(', ')})` : '';
              return (
                `<div class="ag-ta-row-btn ${uiState.selectedScenario === s.key ? 'active' : ''}" data-scen-key="${esc(s.key)}">` +
                `<div class="ag-ta-row-top"><div class="ag-ta-row-name"><span class="ag-ta-swatch" style="background-color:${meta.color};"></span><span class="ag-ta-row-label" title="${esc(meta.label + extra)}">${esc(meta.label + extra)}</span></div>` +
                `<div class="ag-ta-row-nums ag-ta-num-font"><span style="color:var(--ag-ta-muted);">${s.calls}次</span><span style="font-weight:600;">${esc(taFormatMetricVal(s, uiState.metric))}</span><span style="color:var(--ag-ta-muted);width:38px;text-align:right;">${((val / sSum) * 100).toFixed(1)}%</span></div></div>` +
                `<div class="ag-ta-track"><div class="ag-ta-track-inner" style="width:${Math.max(4, (val / sMax) * 100)}%;background-color:${meta.color};"></div></div>` +
                `<div style="margin-top:3px;font-size:11px;color:var(--ag-ta-muted);">${esc(meta.desc)}</div></div>`
              );
            })
            .join('');
        }

        renderExplorerSections(panel, vm);
      }

      function setTokenTabActive(modal, active) {
        if (!modal) return;
        tabActive = Boolean(active);
        if (tabActive) modal.setAttribute('data-ag-token-tab-active', '1');
        else {
          modal.removeAttribute('data-ag-token-tab-active');
          hideHmTooltip();
        }
        document.getElementById(NAV_BTN_ID)?.setAttribute('data-active', tabActive ? '1' : '0');
        const panel = document.getElementById(PANEL_ID);
        if (panel) {
          panel.hidden = !tabActive;
          if (tabActive) {
            renderPanel();
            void fetchTokenAnalytics(false);
          }
        }
      }

      const observedModalEls = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
      const backdropObs = typeof MutationObserver !== 'undefined' ? new MutationObserver(() => scheduleModalSync()) : null;

      function observeModalStateAttrs(modal) {
        if (!backdropObs || !observedModalEls || !modal) return;
        for (const el of [modal, modal.closest?.('.settings-modal-backdrop')]) {
          if (el && !observedModalEls.has(el)) {
            observedModalEls.add(el);
            backdropObs.observe(el, { attributes: true, attributeFilter: ['aria-hidden', 'class'] });
          }
        }
      }

      function syncSettingsModal() {
        if (disposed || !document.body) return;
        const modal = findActiveSettingsModal();
        if (!modal) {
          if (hmTooltipVisible) hideHmTooltip();
          if (dataState.fetchedAt > 0) dataState.modalClosedSinceFetch = true;
          if (tabActive) tabActive = false;
          return;
        }
        observeModalStateAttrs(modal);
        const sidebar = modal.querySelector('[data-testid="settings-sidebar"]');
        if (!sidebar) return;
        const anchorBtn = sidebar.querySelector(
          '[data-testid="settings-nav-item-Models"], [data-testid="settings-nav-item-General"], [data-testid="settings-nav-item-Appearance"]'
        );
        const navContainer = (anchorBtn?.closest('.group\\/nav-item') || anchorBtn)?.parentElement || sidebar.querySelector('.overflow-y-auto');
        const nativeScroll = [...modal.querySelectorAll('div.overflow-auto')].find(
          (el) => !sidebar.contains(el) && !el.closest('[data-ag-token-ui]')
        );
        if (!navContainer || !nativeScroll?.parentElement) return;
        const hostParent = nativeScroll.parentElement;

        if (nativeScroll.getAttribute('data-ag-native-settings-scroll') !== '1') {
          nativeScroll.setAttribute('data-ag-native-settings-scroll', '1');
        }

        let navSection = document.getElementById(NAV_SECTION_ID);
        if (!navSection) {
          navSection = document.createElement('div');
          navSection.id = NAV_SECTION_ID;
          navSection.setAttribute('data-ag-token-ui', '1');
          navSection.innerHTML =
            `<div class="ag-ta-nav-divider"></div><div class="ag-ta-nav-heading">本地扩展</div>` +
            `<div class="relative mx-2"><button type="button" id="${NAV_BTN_ID}" data-ag-token-tab="1" data-active="0">` +
            `<svg class="ag-ta-nav-icon" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path d="M3 3v18h18"/><rect x="7" y="10" width="3" height="7" rx="1"/><rect x="12" y="6" width="3" height="11" rx="1"/><rect x="17" y="13" width="3" height="4" rx="1"/></svg>` +
            `<span>Token 统计</span></button></div>`;
          navSection.querySelector(`#${NAV_BTN_ID}`)?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (tabActive && modal.getAttribute('data-ag-token-tab-active') === '1') return;
            setTokenTabActive(modal, true);
          });
        }
        if (navSection.parentElement !== navContainer) navContainer.appendChild(navSection);

        let panel = document.getElementById(PANEL_ID);
        if (!panel) {
          panel = document.createElement('div');
          panel.id = PANEL_ID;
          panel.setAttribute('data-ag-token-ui', '1');
          panel.hidden = true;
        }
        if (panel.parentElement !== hostParent) hostParent.appendChild(panel);

        if (!modal.__ag_token_click_bound) {
          modal.__ag_token_click_bound = true;
          modal.addEventListener(
            'click',
            (e) => {
              const t = e.target;
              if (!(t instanceof Element) || t.closest('[data-ag-token-ui]')) return;
              const clickedNav =
                t.closest('[data-testid^="settings-nav-item-"]') ||
                (sidebar.contains(t) && t.closest('.group\\/nav-item, button'));
              if (
                clickedNav &&
                !t.closest('[data-testid="settings-app-version-copy"], [data-testid="settings-app-version-caption"], [data-testid="settings-upload-debug-bundle-button"]') &&
                modal.getAttribute('data-ag-token-tab-active') === '1'
              ) {
                setTokenTabActive(modal, false);
              }
            },
            true
          );
        }

        if (pendingOpenTokenTab) {
          pendingOpenTokenTab = false;
          if (pendingOpenTimer) {
            clearTimeout(pendingOpenTimer);
            pendingOpenTimer = null;
          }
          setTokenTabActive(modal, true);
        } else {
          document.getElementById(NAV_BTN_ID)?.setAttribute('data-active', tabActive ? '1' : '0');
          panel.hidden = !tabActive;
          if (tabActive) modal.setAttribute('data-ag-token-tab-active', '1');
          else modal.removeAttribute('data-ag-token-tab-active');
        }
      }

      window.__ag_open_token_analytics_tab = () => {
        const modal = findActiveSettingsModal();
        if (modal) {
          syncSettingsModal();
          setTokenTabActive(modal, true);
          return;
        }
        pendingOpenTokenTab = true;
        if (pendingOpenTimer) clearTimeout(pendingOpenTimer);
        pendingOpenTimer = setTimeout(() => {
          pendingOpenTokenTab = false;
          pendingOpenTimer = null;
        }, 3500);
        document.querySelector('[data-testid="settings-button"]')?.click();
      };

      const MODAL_FAST_SKIP_SEL =
        '[data-markdown-root], [data-testid="conversation-view"], [id="antigravity.agentSidePanelInputBox"], .monaco-editor, .monaco-diff-editor, .xterm, [data-ag-token-ui], [data-ag-metrics-pill], #ag-live-metrics-pill, #ag-live-metrics-tooltip';
      const MODAL_RELEVANT_SEL =
        '.settings-modal-container, .settings-modal-backdrop, [data-testid="settings-sidebar"], [role="dialog"]';

      function scheduleModalSync() {
        if (disposed || syncRaf) return;
        syncRaf = requestAnimationFrame(() => {
          syncRaf = null;
          syncSettingsModal();
        });
      }

      const nodeTouchesSettingsModal = (n) =>
        n instanceof Element && (Boolean(n.matches?.(MODAL_RELEVANT_SEL)) || Boolean(n.firstElementChild && n.querySelector?.(MODAL_RELEVANT_SEL)));

      const nodeListTouchesSettingsModal = (nodes) => {
        for (let i = 0; i < nodes.length; i++) {
          if (nodeTouchesSettingsModal(nodes[i])) return true;
        }
        return false;
      };

      let modalObserverStarted = false;
      const modalObs =
        typeof MutationObserver !== 'undefined'
          ? new MutationObserver((mutations) => {
              for (let i = 0; i < mutations.length; i++) {
                const m = mutations[i];
                const t = m.target;
                if (t instanceof Element && t.closest?.(MODAL_FAST_SKIP_SEL)) continue;
                if (
                  pendingOpenTokenTab ||
                  (tabActive && !document.getElementById(PANEL_ID)?.isConnected) ||
                  (t instanceof Element && t.closest?.(MODAL_RELEVANT_SEL)) ||
                  (m.type === 'childList' &&
                    (nodeListTouchesSettingsModal(m.addedNodes) || nodeListTouchesSettingsModal(m.removedNodes)))
                ) {
                  scheduleModalSync();
                  break;
                }
              }
            })
          : null;

      function ensureObserverStarted() {
        if (disposed || modalObserverStarted || !modalObs || !document.body) return;
        modalObserverStarted = true;
        modalObs.observe(document.body, { childList: true, subtree: true });
      }

      window.__ag_sync_token_analytics_fn = () => {
        if (disposed) return;
        ensureObserverStarted();
        syncSettingsModal();
      };

      ensureObserverStarted();
      syncSettingsModal();

      window.__ag_cleanup_fns.push(() => {
        disposed = true;
        unbindHmGlobalListeners();
        hmDayByDate.clear();
        activeHmCell = null;
        hmTooltipVisible = false;
        cachedBaseVm = { key: '', payloadRef: null, vm: null };
        modalObs?.disconnect();
        backdropObs?.disconnect();
        if (syncRaf) cancelAnimationFrame(syncRaf);
        if (pendingOpenTimer) clearTimeout(pendingOpenTimer);
        if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
        for (const entry of pendingRequests.values()) clearTimeout(entry.timer);
        pendingRequests.clear();
        cleanupTokenAnalyticsDom();
      });
    })();
  } else {
    cleanupTokenAnalyticsDom();
  }
  /* __AG_TOKEN_ANALYTICS_JS_END__ */

  // ============================================================================
  // 5. 开放用户自定义前端脚本钩子 (user/custom.js，沙箱异常隔离，同时提供 ctx 与 boot)
  // ============================================================================
  window.__AG_PATCH_CTX__ = {
    version: PATCH_VERSION,
    preset: DEFAULT_PRESET,
    config: boot.config || {},
    modules: MODULES,
    features: MODULES,
    themeVars: THEME_VARS,
    dict: DICT,
    get metrics() {
      return window.__ag_last_metrics || null;
    },
    syncPreset: syncChuanbanPreset,
    ensureMetricsPill,
    onCleanup(fn) {
      if (typeof fn === 'function') {
        window.__ag_cleanup_fns.push(fn);
      }
    }
  };

  if (MODULES.customJs && boot.customJs && typeof boot.customJs === 'string' && boot.customJs.trim()) {
    try {
      const fn = new Function('ctx', 'boot', boot.customJs);
      fn(window.__AG_PATCH_CTX__, window.__AG_PATCH_CTX__);
    } catch (err) {
      console.error('[Antigravity Patch] Error in user/custom.js:', err);
    }
  }
  if (!IS_SWARM_PLUGIN_FRAME) return window.__ag_resolved_theme_mode || null;
})(__AG_BOOT_PAYLOAD__);
