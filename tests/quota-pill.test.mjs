import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const cssSrc = read('core/theme.css');
const runtimeSrc = read('core/runtime.js');

function sliceBetween(src, startMarker, endMarker) {
  const s = src.indexOf(startMarker);
  assert.ok(s >= 0, `missing start marker: ${startMarker}`);
  const e = src.indexOf(endMarker, s);
  assert.ok(e > s, `missing end marker: ${endMarker}`);
  return src.slice(s, e);
}

test('quota parser and renderers handle protobuf timestamps, warning tones, full status, and bilingual formats', () => {
  const quotaCode = sliceBetween(
    runtimeSrc,
    '  function parseQuotaResetTimeMs(rt)',
    '  function composePillTooltipHtml(pill, nowMs = Date.now())'
  );
  const ctx = vm.createContext({});
  vm.runInContext(
    `${quotaCode}\nglobalThis.api = { parseQuotaResetTimeMs, parseQuotaSummaryResponse, getQuotaTone, formatQuotaReset, formatQuotaSyncAge, buildQuotaInlineHtml, buildQuotaTooltipHtml };`,
    ctx
  );
  const {
    parseQuotaResetTimeMs,
    parseQuotaSummaryResponse,
    getQuotaTone,
    formatQuotaReset,
    buildQuotaInlineHtml,
    buildQuotaTooltipHtml
  } = ctx.api;

  const nowMs = 1795584000000;
  // Protobuf seconds string, number, BigInt, ISO string
  assert.equal(parseQuotaResetTimeMs({ seconds: '1795589767', nanos: 0 }), 1795589767000);
  assert.equal(parseQuotaResetTimeMs({ seconds: 1795589767n, nanos: 500000000 }), 1795589767500);
  assert.equal(parseQuotaResetTimeMs('2026-11-25T15:00:00Z'), Date.parse('2026-11-25T15:00:00Z'));

  const raw = {
    response: {
      groups: [
        {
          displayName: 'Gemini Models',
          buckets: [
            {
              bucketId: 'gemini-weekly',
              window: 'weekly',
              remaining: { case: 'remainingFraction', value: 0.67379695 },
              resetTime: { seconds: String(Math.floor((nowMs + (5 * 24 + 21) * 3600000) / 1000)), nanos: 0 }
            },
            {
              bucketId: 'gemini-5h',
              window: '5h',
              remaining: { case: 'remainingFraction', value: 0.78823143 },
              resetTime: { seconds: String(Math.floor((nowMs + 95 * 60000) / 1000)), nanos: 0 }
            }
          ]
        },
        {
          displayName: 'Claude and GPT models',
          buckets: [
            {
              bucketId: '3p-weekly',
              window: 'weekly',
              remaining: { case: 'remainingFraction', value: 0.09249432 },
              resetTime: { seconds: String(Math.floor((nowMs + 27 * 3600000) / 1000)), nanos: 0 }
            },
            {
              bucketId: '3p-5h',
              window: '5h',
              remaining: { case: 'remainingFraction', value: 1 },
              resetTime: { seconds: String(Math.floor((nowMs + 5 * 3600000) / 1000)), nanos: 0 }
            }
          ]
        }
      ]
    }
  };

  const snap = parseQuotaSummaryResponse(raw, nowMs);
  assert.ok(snap);
  assert.equal(snap.gemini.h5.pct, 79);
  assert.equal(snap.gemini.weekly.pct, 67);
  assert.equal(snap.claude.h5.pct, 100);
  assert.equal(snap.claude.weekly.pct, 9);

  assert.equal(getQuotaTone(79), 'ok');
  assert.equal(getQuotaTone(25), 'warn');
  assert.equal(getQuotaTone(10), 'crit');
  assert.equal(getQuotaTone(0), 'crit');

  assert.equal(formatQuotaReset(snap.gemini.h5, false, nowMs), '1h 35m 后重置');
  assert.equal(formatQuotaReset(snap.gemini.weekly, false, nowMs), '5d 21h 后重置');
  assert.equal(formatQuotaReset(snap.claude.h5, false, nowMs), '满额');
  assert.equal(formatQuotaReset(snap.claude.h5, true, nowMs), 'Full');
  assert.equal(formatQuotaReset(snap.claude.weekly, true, nowMs), '1d 3h');

  // Inline bottom pill only contains Gemini 5h & weekly in minimal slash notation
  const inlineZh = buildQuotaInlineHtml(snap, false);
  assert.match(inlineZh, /5h<\/span><span class="ag-q-num ag-q-ok">79%<\/span>/);
  assert.match(inlineZh, /周<\/span><span class="ag-q-num ag-q-ok">67%<\/span>/);
  assert.doesNotMatch(inlineZh, /Claude|>9%|100%/);

  const inlineEn = buildQuotaInlineHtml(snap, true);
  assert.match(inlineEn, /7d<\/span><span class="ag-q-num ag-q-ok">67%<\/span>/);

  // Tooltip contains dual-column concentric cards for both Gemini and Claude & GPT
  const ttZh = buildQuotaTooltipHtml(snap, false, true, nowMs);
  assert.match(ttZh, /模型用量/);
  assert.match(ttZh, /ag-tt-quota-grid/);
  assert.match(ttZh, /Gemini/);
  assert.match(ttZh, /Claude 与 GPT/);
  assert.match(ttZh, /ag-q-crit">9%/);
  assert.match(ttZh, /满额/);

  const ttEn = buildQuotaTooltipHtml(snap, true, false, nowMs);
  assert.match(ttEn, /Model Quota/);
  assert.match(ttEn, /Claude &amp; GPT/);
  assert.match(ttEn, /Full/);
  assert.doesNotMatch(ttEn, /ag-tt-sec/);
});

test('quota CSS adheres strictly to Anthropic flat parchment/Slate Dark palette with zero #FFFFFF or box-shadow', () => {
  const quotaCss = sliceBetween(
    cssSrc,
    '/* 底部常驻 Gemini 配额数字（极简斜杠）',
    '/* __AG_TOKEN_ANALYTICS_CSS_START__ */'
  ).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/#FFFFFF\b/i.test(quotaCss), 'quota CSS must not contain #FFFFFF');
  assert.ok(!/box-shadow\s*:/i.test(quotaCss), 'quota CSS must remain flat without box-shadow');
  assert.ok(quotaCss.includes('.ag-quota-inline'));
  assert.ok(quotaCss.includes('.ag-tt-quota-grid'));
  assert.ok(quotaCss.includes('.ag-tt-qcard'));
  assert.ok(quotaCss.includes('#F0EEE6'));
  assert.ok(quotaCss.includes('#191917'));
});

test('runtime discovers React Fiber retrieveUserQuotaSummary, renders Gemini slash pill + dual-card hover tooltip, supports empty chat, live lang switch, warning colors, and teardown', async (t) => {
  const { chromium } = require('playwright');
  const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH ||
      (fs.existsSync(macChrome) ? macChrome : fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
    headless: true
  });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 960, height: 700 } });
  await page.route('**/*', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><html><head><title>Antigravity</title></head><body data-agy-theme="1">
        <div id="antigravity.agentSidePanelInputBox" style="width: 680px; margin: 320px auto 0; padding: 8px;">
          <div class="agy-composer-footer" style="display:flex; width:100%; align-items:center; justify-content:space-between;">
            <div style="display:flex; align-items:center; gap:6px; min-width:0; flex:1 1 auto;">
              <button type="button" data-testid="model-selector-trigger" aria-disabled="true">Gemini 4 Neon High</button>
            </div>
            <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
              <button type="button" data-testid="input-cancel-button">Cancel</button>
            </div>
          </div>
        </div>
      </body></html>`
    })
  );

  const cid = '11111111-2222-4333-8444-555555555555';
  await page.goto(`http://127.0.0.1:41998/c/${cid}`);

  // Attach mock React Fiber mirroring Antigravity's Gdd -> Fdd.Provider -> Edd hook structure
  await page.evaluate(() => {
    const nowSec = Math.floor(Date.now() / 1000);
    window.__mockQuotaCalls = 0;
    window.__mockQuotaData = {
      response: {
        groups: [
          {
            displayName: 'Gemini Models',
            buckets: [
              {
                bucketId: 'gemini-weekly',
                window: 'weekly',
                remaining: { case: 'remainingFraction', value: 0.673 },
                resetTime: { seconds: String(nowSec + (5 * 24 + 21) * 3600), nanos: 0 }
              },
              {
                bucketId: 'gemini-5h',
                window: '5h',
                remaining: { case: 'remainingFraction', value: 0.788 },
                resetTime: { seconds: String(nowSec + 95 * 60), nanos: 0 }
              }
            ]
          },
          {
            displayName: 'Claude and GPT models',
            buckets: [
              {
                bucketId: '3p-weekly',
                window: 'weekly',
                remaining: { case: 'remainingFraction', value: 0.092 },
                resetTime: { seconds: String(nowSec + 27 * 3600), nanos: 0 }
              },
              {
                bucketId: '3p-5h',
                window: '5h',
                remaining: { case: 'remainingFraction', value: 1 },
                resetTime: { seconds: String(nowSec + 5 * 3600), nanos: 0 }
              }
            ]
          }
        ]
      }
    };
    const svc = {
      retrieveUserQuotaSummary: async () => {
        window.__mockQuotaCalls += 1;
        return window.__mockQuotaData;
      }
    };
    const eddFiber = { memoizedState: { memoizedState: [svc, [svc, false]], next: null } };
    const providerFiber = { child: eddFiber };
    const gddFiber = { child: providerFiber, return: null };
    const btn = document.querySelector('[data-testid="model-selector-trigger"]');
    btn.__reactFiber$test = { return: { return: gddFiber } };
  });

  const bootPayload = {
    version: '20261125-v6.0.3-eric.1',
    enabled: true,
    preset: 'high-contrast',
    installedLocale: 'zh-CN',
    cssText: cssSrc,
    i18nDict: {},
    modules: { i18n: true, metrics: true, quota: true, tokenAnalytics: false, coldBootHealer: false }
  };

  await page.evaluate(
    ({ src, payload }) => {
      const fn = new Function(src.replace('__AG_BOOT_PAYLOAD__', JSON.stringify(payload)));
      fn();
    },
    { src: runtimeSrc, payload: bootPayload }
  );

  // 1) Even before any conversation metrics arrive, quota-only pill mounts with Gemini 5h/weekly
  await page.waitForFunction(() => {
    const p = document.getElementById('ag-live-metrics-pill');
    return p && p.style.display === 'inline-flex' && p.textContent.includes('79%');
  });

  const emptyChatPill = await page.evaluate(() => {
    const p = document.getElementById('ag-live-metrics-pill');
    return {
      text: p.textContent,
      hasDivider: !!p.querySelector('.ag-quota-div'),
      calls: window.__mockQuotaCalls
    };
  });
  assert.equal(emptyChatPill.hasDivider, false, 'quota-only pill should not show leading divider');
  assert.match(emptyChatPill.text, /5h79%\/周67%/);
  assert.ok(emptyChatPill.calls >= 1);

  // Hover pill to verify quota-only dual-column concentric cards
  await page.hover('#ag-live-metrics-pill');
  await page.waitForFunction(() => {
    const tt = document.getElementById('ag-live-metrics-tooltip');
    return tt && tt.getAttribute('data-visible') === '1';
  });
  const ttEmpty = await page.evaluate(() => {
    const tt = document.getElementById('ag-live-metrics-tooltip');
    const cards = [...tt.querySelectorAll('.ag-tt-qcard')];
    const critEl = tt.querySelector('.ag-tt-qpct.ag-q-crit');
    return {
      cardCount: cards.length,
      text: tt.textContent,
      cardBg: getComputedStyle(cards[0]).backgroundColor,
      boxShadow: getComputedStyle(tt).boxShadow,
      critColor: critEl ? getComputedStyle(critEl).color : ''
    };
  });
  assert.equal(ttEmpty.cardCount, 2);
  assert.match(ttEmpty.text, /模型用量/);
  assert.match(ttEmpty.text, /Gemini/);
  assert.match(ttEmpty.text, /Claude 与 GPT/);
  assert.match(ttEmpty.text, /9%/);
  assert.match(ttEmpty.text, /满额/);
  assert.equal(ttEmpty.cardBg, 'rgb(240, 238, 230)'); // #F0EEE6 Ivory Medium
  assert.equal(ttEmpty.boxShadow, 'none');
  assert.equal(ttEmpty.critColor, 'rgb(184, 66, 57)'); // #B84239

  // 2) Render real conversation metrics -> divider + quota appended cleanly, tooltip has both metrics & quota
  await page.evaluate((id) => {
    window.__ag_render_metrics({
      cascadeId: id,
      hasData: true,
      dbFound: true,
      sig: 'sig-1',
      inlineHtml: '<svg class="ag-ctx-ring ag-ctx-ok" width="13" height="13"></svg><span class="ag-ring-after">128 tok/s</span><span class="ag-sep">·</span><span>TTFT 5.1s</span>',
      tooltipHtml: '<div class="ag-tt-hdr"><span>当前轮次</span></div><div class="ag-tt-row"><span class="ag-tt-lbl">生成速度</span><span class="ag-tt-val">128 tok/s</span></div>'
    });
  }, cid);

  const combinedState = await page.evaluate(() => {
    const p = document.getElementById('ag-live-metrics-pill');
    const tt = document.getElementById('ag-live-metrics-tooltip');
    return {
      pillText: p.textContent,
      hasDivider: !!p.querySelector('.ag-quota-div'),
      ttText: tt.textContent,
      hasQuotaSecHeader: !!tt.querySelector('.ag-tt-hdr.ag-tt-sec')
    };
  });
  assert.equal(combinedState.hasDivider, true);
  assert.match(combinedState.pillText, /128 tok\/s·TTFT 5\.1s5h79%\/周67%/);
  assert.match(combinedState.ttText, /当前轮次/);
  assert.match(combinedState.ttText, /模型用量/);
  assert.equal(combinedState.hasQuotaSecHeader, true);

  // 3) Live switch to English without reinjection updates pill & open tooltip immediately
  await page.evaluate(() => window.__ag_set_host_ui_lang('en'));
  const enState = await page.evaluate(() => ({
    pillText: document.getElementById('ag-live-metrics-pill').textContent,
    ttText: document.getElementById('ag-live-metrics-tooltip').textContent
  }));
  assert.match(enState.pillText, /7d67%/);
  assert.match(enState.ttText, /Model Quota/);
  assert.match(enState.ttText, /Claude & GPT/);
  assert.match(enState.ttText, /Full/);

  // 4) Switch to dark mode & verify concentric card Slate Dark surface
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-ag-theme-mode', 'dark');
    document.body.classList.add('dark');
  });
  const darkCardBg = await page.evaluate(() => getComputedStyle(document.querySelector('#ag-live-metrics-tooltip .ag-tt-qcard')).backgroundColor);
  assert.equal(darkCardBg, 'rgb(25, 25, 23)'); // #191917

  // 5) Clean teardown when enabled: false
  await page.evaluate(
    ({ src, payload }) => {
      const fn = new Function(src.replace('__AG_BOOT_PAYLOAD__', JSON.stringify(payload)));
      fn();
    },
    { src: runtimeSrc, payload: { ...bootPayload, enabled: false } }
  );
  assert.equal(await page.locator('#ag-live-metrics-pill').count(), 0);
  assert.equal(await page.locator('#ag-live-metrics-tooltip').count(), 0);
  assert.equal(await page.evaluate(() => window.__ag_quota_snapshot), null);
});
