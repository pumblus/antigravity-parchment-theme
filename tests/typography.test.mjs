import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const css = readFileSync(new URL('../core/theme.css', import.meta.url), 'utf8');

const fonts = {
  sans: /^"?Anthropic Sans"?,/,
  mono: /^"?Anthropic Mono"?,/,
  serif: /^"?Anthropic Serif"?,/,
  serifDisplay: /^"?Anthropic Serif Display"?,/,
};

const contexts = [
  ['code', 'code', '', 'mono'],
  ['pre', 'pre', '', 'mono'],
  ['samp', 'samp', '', 'mono'],
  ['kbd', 'kbd', '', 'sans'],
  ['language', 'div', 'class="language-js"', 'mono'],
  ...['monaco-editor', 'xterm', 'file-title', 'file-path'].map(c => [c, 'div', `class="${c}"`, 'mono']),
  ...['data-path', 'data-file-path'].map(c => [c, 'div', `${c}="test.js"`, 'mono']),
  ['markdown-root', 'div', 'data-markdown-root', 'serif'],
  ...['prose', 'markdown', 'select-text', 'agy-user-bubble'].map(c => [c, 'div', `class="${c}"`, 'serif']),
  ['article', 'article', '', 'serif'],
  ['user-content', 'div', 'data-testid="user-message-content"', 'serif'],
  ['editable', 'div', 'contenteditable="true"', 'sans'],
  ['lexical', 'div', 'data-lexical-editor="true"', 'sans'],
  ['composer', 'div', 'data-composer', 'sans'],
  ['prosemirror', 'div', 'class="ProseMirror"', 'sans'],
];

const headers = ['thought-header', 'thinking-header', 'step-title', 'step-header', 'tool-call-header'];

test('Anthropic font aliases, PingFang CJK fallback order, and discrete weights follow spec', () => {
  for (const alias of [
    'AnthropicSansWebVariable-TextRegular',
    'AnthropicSansWebVariable-TextLight',
    'AnthropicSansWebVariable-TextMedium',
    'AnthropicSansWebVariable-TextSemibold',
    'AnthropicSansWebVariable-TextBold',
    'Anthropic Sans Web Display Light',
    'AnthropicSansText-Regular',
    'AnthropicSansText-Medium',
    'AnthropicSansText-Semibold',
    'AnthropicSansText-Bold',
    'AnthropicSansText-Italic',
    'AnthropicSansText-BoldItalic',
    'AnthropicSerifWebWeb-TextRegular',
    'AnthropicSerifWebWeb-TextSemibold',
    'AnthropicSerifWebWeb-TextBold',
    'Anthropic Serif Web Display Light',
    'AnthropicSerifText-Regular',
    'AnthropicSerifText-Medium',
    'AnthropicSerifText-Semibold',
    'AnthropicSerifText-Bold',
    'AnthropicSerifText-Italic',
    'AnthropicSerifText-SemiboldItalic',
    'AnthropicSerifDisplay-Regular',
    'AnthropicSerifDisplay-Semibold',
    'AnthropicSerifDisplay-Bold',
    'AnthropicSansDisplay-Regular',
    'AnthropicSansDisplay-Bold',
    'AnthropicMonoWebWeb-Regular',
    'AnthropicMonoWebWeb-RegularItalic',
    'Anthropic Mono Web Regular',
  ]) {
    assert.ok(css.includes(`local('${alias}')`), alias);
  }

  for (const selector of [
    '[class*="group/file-title"] .select-text',
    '[data-uri^="file:"]',
    '[class*="file-path"]',
    '[data-path]',
    '[data-file-path]',
    '.monaco-editor',
    '.xterm',
    '[data-lexical-editor="true"] ~ p.pointer-events-none',
    '.bg-sidebar :is([data-active="true"], [data-active=""])',
  ]) {
    assert.ok(css.includes(selector), selector);
  }

  // Western fonts & fallbacks precede PingFang SC, and PingFang SC precedes secondary CJK fallbacks.
  const sansMatch = css.match(/--font-sans:\s*([^;]+);/);
  const serifMatch = css.match(/--font-serif:\s*([^;]+);/);
  const monoMatch = css.match(/--font-mono:\s*([^;]+);/);
  assert.ok(sansMatch && serifMatch && monoMatch);
  assert.ok(!sansMatch[1].includes("'Anthropic Sans Display'"), 'Display optical size is kept out of small UI stack');
  assert.ok(sansMatch[1].indexOf("'Anthropic Sans'") < sansMatch[1].indexOf("Arial"));
  assert.ok(sansMatch[1].indexOf("Arial") < sansMatch[1].indexOf("'PingFang SC'"));
  assert.ok(sansMatch[1].indexOf("'PingFang SC'") < sansMatch[1].indexOf("'Sarasa UI SC'"));
  assert.ok(serifMatch[1].indexOf("'Anthropic Serif'") < serifMatch[1].indexOf("Georgia"));
  assert.ok(serifMatch[1].indexOf("Georgia") < serifMatch[1].indexOf("'PingFang SC'"));
  assert.ok(serifMatch[1].indexOf("'PingFang SC'") < serifMatch[1].indexOf("'Sarasa UI SC'"));
  assert.ok(!serifMatch[1].includes('Sarasa Mono Slab SC'), 'Serif prose does not use monospace CJK');
  assert.ok(monoMatch[1].indexOf("'Anthropic Mono'") < monoMatch[1].indexOf("Monaco"));
  assert.ok(monoMatch[1].indexOf("Monaco") < monoMatch[1].indexOf("'PingFang SC'"));

  // No non-standard fractional font weights remain.
  assert.doesNotMatch(css, /font-weight:\s*(?:450|520)\b/);
});

test('Anthropic UI specification tokens: zero pure #FFFFFF, zero drop shadows, warm parchment & Slate Dark', () => {
  // Strip comments before checking hex tokens so documentation notes about "零 #FFFFFF" do not trigger false positives.
  const uncommented = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(uncommented, /#ffffff\b/i, 'No pure #FFFFFF cold white surfaces or text');
  assert.doesNotMatch(uncommented, /#74221a\b/i, 'Legacy dark-red wax-seal border removed');
  assert.doesNotMatch(uncommented, /#2f71e3\b/i, 'Legacy cold Google blue dark-mode primary removed');
  assert.doesNotMatch(uncommented, /#070708\b/i, 'Legacy cold onyx black background removed');

  for (const token of [
    '--color-slate-dark: #141413',
    '--color-slate-medium: #3D3D3A',
    '--color-stone: #CCCBC8',
    '--color-ivory-light: #FAF9F5',
    '--color-ivory-medium: #F0EEE6',
    '--color-oat-warm: #E3DACC',
    '--color-clay: #D97757',
    '--color-clay-deep: #C6613F',
  ]) {
    assert.ok(uncommented.includes(token), token);
  }
});

for (const mode of ['light', 'dark']) {
  test(`typography computed styles (${mode})`, async t => {
    const { chromium } = require('playwright');
    const executablePath = process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
    const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await browser.newPage();
    const nested = contexts.map(([id, tag, attrs]) => `<${tag} ${attrs}><span id="nested-${id}">Nested content</span></${tag}>`).join('');
    const ancestor = contexts.map(([id, tag, attrs]) => `<${tag} ${attrs}><span class="thought-header" id="ancestor-${id}">Protected heading</span></${tag}>`).join('');
    const labels = headers
      .map(
        (name, i) =>
          `<div class="${name} font-mono" id="class-${i}"><span class="font-mono" id="class-label-${i}">Title</span></div>` +
          `<div data-testid="${name}" class="font-mono" id="testid-${i}"><strong class="font-mono" id="testid-label-${i}">Title</strong></div>`
      )
      .join('');

    await page.setContent(`<html data-ag-theme-mode="${mode}"><head></head><body class="${mode === 'dark' ? 'dark' : ''}" data-agy-font="inter">
      ${labels}<div class="tool-call-header">${nested}</div>${ancestor}
      <div class="thought"><p class="font-mono" id="generic-mono">True monospace</p><div data-markdown-root><p id="thought-prose">Thought body</p></div></div>
      <div class="thinking"><code id="thinking-code">x = 1</code></div>
      <h1 data-testid="home-greeting" id="greeting">Hello</h1>
      <div data-markdown-root>
        <h1 id="markdown-h1">Heading</h1>
        <h2 id="markdown-h2">Subheading</h2>
        <h2 data-testid="home-greeting" id="protected-greeting">Prose greeting</h2>
        <p>Press <kbd id="markdown-kbd">⌘K</kbd>, visit <a href="https://anthropic.com" id="markdown-link">Anthropic</a>, or run <code id="markdown-code">npm test</code></p>
        <pre id="markdown-pre"><code>const ok = true;</code></pre>
      </div>
      <div class="agy-user-bubble" id="user-bubble">User prompt</div>
      <div role="dialog" id="modal-dialog"><div class="agy-card" id="dialog-card"><span class="text-sm">Card</span></div></div>
      <div class="agy-overlay" role="menu" id="context-menu"><div class="agy-overlay-item" role="menuitem" id="menu-item">Item</div></div>
      <div class="agy-sidebar-row" id="sidebar-row"><span class="truncate">Session</span></div>
      <div id="antigravity.agentSidePanelInputBox" class="surface-composer bg-card-border">
        <div class="surface-composer-card bg-card" id="composer-card">
          <div data-lexical-editor="true" id="lexical-box"><span data-lexical-text="true" id="lexical-span">Prompt</span></div>
          <p class="pointer-events-none" id="placeholder">Placeholder</p>
          <button data-testid="model-selector-trigger" class="rounded-full" id="model-pill" style="border-radius: 9999px">Model</button>
          <button data-testid="send-button" class="rounded-full" id="send-btn" style="border-radius: 9999px">Send</button>
        </div>
      </div>
      <div class="tool-call-header">
        <code class="thought-header" id="self-code">Code header</code>
        <span class="file-path" id="self-path">file.js</span>
        <div class="katex" style="font-family: math"><span id="formula">Math</span></div>
        <span class="codicon" id="icon" style="font-family: codicon">Icon</span>
      </div>
      <textarea id="textarea">Typing</textarea>
      <input id="text-input" placeholder="Search conversations" value="Search query">
      <div contenteditable="true"><code id="code-in-editable">const a = 1;</code></div>
      <div class="monaco-editor"><textarea id="monaco-textarea"></textarea></div>
      <div class="xterm"><textarea id="xterm-textarea"></textarea></div>
      <div id="ag-live-metrics-pill"><span id="ag-live-metrics-text">68 tok/s · 0.4s</span></div>
      <div id="ag-live-metrics-tooltip">
        <div class="ag-tt-hdr" id="tt-hdr">实时会话遥测</div>
        <div class="ag-tt-row"><span class="ag-tt-lbl" id="tt-lbl">生成速度</span><span class="ag-tt-val" id="tt-val">68.2 tok/s</span></div>
      </div>
    </body></html>`);
    await page.addStyleTag({ content: css });
    const family = id => page.locator(`#${id}`).evaluate(el => getComputedStyle(el).fontFamily);
    const styleOf = (id, prop) => page.locator(`#${id}`).evaluate((el, p) => getComputedStyle(el)[p], prop);

    await t.test('explicit headers and labels use Sans', async () => {
      for (let i = 0; i < headers.length; i++) {
        for (const prefix of ['class', 'class-label', 'testid', 'testid-label']) {
          assert.match(await family(`${prefix}-${i}`), fonts.sans, `${prefix}-${headers[i]}`);
        }
      }
    });

    await t.test('nested code, prose, editors, inputs and paths retain their spec font', async () => {
      for (const [id, , , expected] of contexts) {
        assert.match(await family(`nested-${id}`), fonts[expected], id);
      }
      assert.match(await family('self-code'), fonts.mono);
      assert.match(await family('self-path'), fonts.mono);
      assert.equal(await family('formula'), 'math');
      assert.equal(await family('icon'), 'codicon');
    });

    await t.test('headers inside protected ancestors are not restyled', async () => {
      for (const [id, , , expected] of contexts) {
        assert.match(await family(`ancestor-${id}`), fonts[expected], id);
      }
    });

    await t.test('composer and inputs use Sans while code inside editors and Monaco/xterm stay Mono', async () => {
      for (const [id, font] of [
        ['generic-mono', 'mono'],
        ['thought-prose', 'serif'],
        ['thinking-code', 'mono'],
        ['textarea', 'sans'],
        ['text-input', 'sans'],
        ['lexical-box', 'sans'],
        ['lexical-span', 'sans'],
        ['placeholder', 'sans'],
        ['markdown-kbd', 'sans'],
        ['markdown-code', 'mono'],
        ['code-in-editable', 'mono'],
        ['monaco-textarea', 'mono'],
        ['xterm-textarea', 'mono'],
      ]) {
        assert.match(await family(id), fonts[font], id);
      }
    });

    await t.test('home greeting uses Anthropic Serif Display (400), Markdown prose & headings use Anthropic Serif', async () => {
      assert.match(await family('greeting'), fonts.serifDisplay);
      assert.equal(await styleOf('greeting', 'fontWeight'), '400');
      assert.equal(await styleOf('greeting', 'letterSpacing'), 'normal');
      for (const id of ['markdown-h1', 'markdown-h2', 'protected-greeting']) {
        assert.match(await family(id), fonts.serif);
        assert.equal(await styleOf(id, 'fontWeight'), '600');
      }
      assert.equal(await styleOf('thought-prose', 'letterSpacing'), 'normal');
    });

    await t.test('metrics pill and tooltip are unified on Anthropic Sans with tabular numerals', async () => {
      for (const id of ['ag-live-metrics-pill', 'ag-live-metrics-text', 'ag-live-metrics-tooltip', 'tt-hdr', 'tt-lbl', 'tt-val']) {
        assert.match(await family(id), fonts.sans, id);
      }
      assert.equal(await styleOf('ag-live-metrics-pill', 'fontVariantNumeric'), 'tabular-nums');
      assert.equal(await styleOf('tt-val', 'fontVariantNumeric'), 'tabular-nums');
    });

    await t.test('browser parses discrete weights/italics and keeps upstream variable aliases first', async () => {
      const faces = await page.evaluate(() =>
        [...document.styleSheets]
          .flatMap(s => [...s.cssRules])
          .filter(r => r.type === CSSRule.FONT_FACE_RULE)
          .map(r => ({
            family: r.style.fontFamily,
            src: r.style.getPropertyValue('src'),
            weight: r.style.fontWeight,
            style: r.style.fontStyle,
          }))
      );
      const sans400 = faces.find(f => f.family === '"Anthropic Sans"' && f.weight === '400' && f.style === 'normal');
      const sans500 = faces.find(f => f.family === '"Anthropic Sans"' && f.weight === '500' && f.style === 'normal');
      const sans600 = faces.find(f => f.family === '"Anthropic Sans"' && f.weight === '600' && f.style === 'normal');
      const serif400 = faces.find(f => f.family === '"Anthropic Serif"' && f.weight === '400' && f.style === 'normal');
      const serifDisplay400 = faces.find(f => f.family === '"Anthropic Serif Display"' && f.weight === '400' && f.style === 'normal');
      assert.ok(sans400 && sans500 && sans600 && serif400 && serifDisplay400);
      assert.ok(sans400.src.indexOf('AnthropicSansWebVariable-TextRegular') < sans400.src.indexOf('Anthropic Sans Text Regular'));
      assert.ok(serif400.src.indexOf('AnthropicSerifWebWeb-TextRegular') < serif400.src.indexOf('Anthropic Serif Text Regular'));
      assert.ok(faces.some(f => f.family === '"Anthropic Serif"' && f.style === 'italic' && f.src.includes('AnthropicSerifText-Italic')));
      assert.ok(faces.some(f => f.family === '"Anthropic Sans"' && f.style === 'italic' && f.src.includes('AnthropicSansText-Italic')));
      assert.ok(faces.some(f => f.family === '"Anthropic Mono"' && f.style === 'italic' && f.src.includes('AnthropicMonoWebWeb-RegularItalic')));
    });

    await t.test('UI surfaces, 1px hairline borders, zero drop-shadow, Clay CTA & underlined links follow Anthropic spec', async () => {
      const bodyVars = await page.evaluate(() => {
        const cs = getComputedStyle(document.body);
        return {
          bg: cs.getPropertyValue('--background').trim(),
          sidebar: cs.getPropertyValue('--sidebar').trim(),
          fg: cs.getPropertyValue('--foreground').trim(),
          border: cs.getPropertyValue('--border').trim(),
          primary: cs.getPropertyValue('--primary').trim(),
        };
      });
      if (mode === 'light') {
        assert.equal(bodyVars.bg, '#FAF9F5');
        assert.equal(bodyVars.sidebar, '#F0EEE6');
        assert.equal(bodyVars.fg, '#141413');
        assert.equal(bodyVars.border, '#CCCBC8');
        assert.equal(bodyVars.primary, '#D97757');
      } else {
        assert.equal(bodyVars.bg, '#141413');
        assert.equal(bodyVars.sidebar, '#191917');
        assert.equal(bodyVars.fg, '#FAF9F5');
        assert.equal(bodyVars.border, '#3D3D3A');
        assert.equal(bodyVars.primary, '#D97757');
      }

      const composerTray = page.locator('[id="antigravity.agentSidePanelInputBox"]');
      assert.equal(await composerTray.evaluate(el => getComputedStyle(el).boxShadow), 'none');
      assert.equal(await composerTray.evaluate(el => getComputedStyle(el).borderTopWidth), '1px');
      assert.equal(await styleOf('composer-card', 'boxShadow'), 'none');
      assert.equal(await styleOf('composer-card', 'borderTopWidth'), '1px');

      // Primary Send CTA uses Anthropic Clay (#D97757 -> rgb(217, 119, 87)) with #FAF9F5 text and zero shadow.
      assert.equal(await styleOf('send-btn', 'backgroundColor'), 'rgb(217, 119, 87)');
      assert.equal(await styleOf('send-btn', 'color'), 'rgb(250, 249, 245)');
      assert.equal(await styleOf('send-btn', 'boxShadow'), 'none');

      // Prose links keep a persistent 1px editorial underline; code blocks, bubbles & tooltips stay flat.
      assert.equal(await styleOf('markdown-link', 'textDecorationLine'), 'underline');
      assert.equal(await styleOf('markdown-link', 'textDecorationThickness'), '1px');
      assert.equal(await styleOf('markdown-pre', 'boxShadow'), 'none');
      assert.equal(await styleOf('user-bubble', 'boxShadow'), 'none');
      assert.equal(await styleOf('ag-live-metrics-tooltip', 'boxShadow'), 'none');

      // macOS HIG concentric border-radius hierarchy & continuous corner curvature (preserving rounded-full pills).
      assert.equal(await styleOf('modal-dialog', 'borderRadius'), '12px');
      assert.equal(await composerTray.evaluate(el => getComputedStyle(el).borderRadius), '12px');
      assert.equal(await styleOf('composer-card', 'borderRadius'), '11px');
      assert.equal(await styleOf('user-bubble', 'borderRadius'), '10px');
      assert.equal(await styleOf('dialog-card', 'borderRadius'), '10px');
      assert.equal(await styleOf('markdown-pre', 'borderRadius'), '10px');
      assert.equal(await styleOf('context-menu', 'borderRadius'), '10px');
      assert.equal(await styleOf('ag-live-metrics-tooltip', 'borderRadius'), '10px');
      assert.equal(await styleOf('menu-item', 'borderRadius'), '6px');
      assert.equal(await styleOf('sidebar-row', 'borderRadius'), '6px');
      assert.equal(await styleOf('text-input', 'borderRadius'), '6px');
      assert.equal(await styleOf('markdown-code', 'borderRadius'), '4px');
      assert.equal(await styleOf('markdown-kbd', 'borderRadius'), '4px');
      assert.equal(await styleOf('model-pill', 'borderRadius'), '9999px');
      assert.equal(await styleOf('send-btn', 'borderRadius'), '9999px');

      const supportsContinuous = await page.evaluate(() => CSS.supports('corner-shape', 'superellipse(1.5)'));
      if (supportsContinuous) {
        assert.equal(await styleOf('composer-card', 'cornerShape'), 'superellipse(1.5)');
        assert.equal(await styleOf('context-menu', 'cornerShape'), 'superellipse(1.5)');
        // Chromium may serialize superellipse(1) as its equivalent named shape, round.
        for (const id of ['model-pill', 'send-btn']) {
          assert.ok(['superellipse(1)', 'round'].includes(await styleOf(id, 'cornerShape')));
        }
      }
    });
  });
}

test('typography computed macOS styles keep normal variation settings and no Windows rules', async t => {
  assert.doesNotMatch(css, /data-ag-os="win32"|Segoe UI|Microsoft YaHei|Consolas/i);
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(`<html data-ag-os="darwin"><body data-agy-font="inter"><article id="prose">
    <p id="normal">Normal <em id="italic">Italic</em></p>
    <span class="font-medium" id="medium">Medium <em id="medium-italic">Italic</em></span>
    <strong id="bold">Bold <em id="bold-italic">Italic</em></strong>
    <code id="code"><strong><em id="nested-code">Code</em></strong></code>
    <span class="file-path"><strong id="path">file.js</strong></span>
    <div contenteditable="true"><strong id="editable">Draft</strong></div>
    <div class="katex"><em id="math">Formula</em></div>
  </article></body></html>`);
  await page.addStyleTag({ content: css });
  const variation = id => page.locator('#' + id).evaluate(el => getComputedStyle(el).fontVariationSettings);
  for (const id of ['prose','normal','italic','medium','medium-italic','bold','bold-italic','code','nested-code','path','editable','math']) assert.equal(await variation(id), 'normal', 'darwin ' + id);
  assert.match(await page.locator('#code').evaluate(el => getComputedStyle(el).fontFamily), fonts.mono);
});


test('typography computed v530 PDF scope, ligatures, plugin headings and neutral sub badge', async t => {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless: true });
  t.after(() => browser.close()); const page = await browser.newPage();
  await page.setContent(`<html data-ag-os="darwin" data-ag-page-type="plugin"><body data-agy-font="inter"><style>
  .pdf-sdk-root { --sdk-font-family: Arial; --sdk-font-family-mono: monospace; --sdk-comment-font-family: Arial; --agy-gsf-fvs: 'opsz' 20; }
  body {font-variant-ligatures:no-contextual}
  </style><div class="pdf-sdk-root" id="pdf"><span>PDF</span></div>
  <h2 class="swarm-title" id="heading">Title</h2><code><strong id="code-heading">Code</strong></code>
  <div id="ag-live-metrics-pill"><span class="ag-sub-badge" id="badge">+2 sub</span></div>
  <div id="ag-live-metrics-tooltip">Metrics</div></body></html>`);
  await page.addStyleTag({ content: css });
  const get = (id, prop) => page.locator('#' + id).evaluate((el, prop) => getComputedStyle(el).getPropertyValue(prop).trim(), prop);
  assert.match(await get('pdf','--sdk-font-family'), /Anthropic Sans/);
  assert.match(await get('pdf','--sdk-font-family-mono'), /Anthropic Mono/);
  assert.match(await get('pdf','--sdk-comment-font-family'), /Anthropic Sans/);
  assert.equal(await get('pdf','--agy-gsf-fvs'), 'normal');
  assert.equal(await page.locator('body').evaluate(el=>getComputedStyle(el).fontVariantLigatures), 'normal');
  assert.equal(await get('heading','font-variation-settings'), 'normal');
  assert.equal(await get('badge','background-color'), 'rgb(227, 218, 204)');
  assert.equal(await get('ag-live-metrics-tooltip','position'), 'fixed');
  assert.equal(await get('ag-live-metrics-tooltip','box-shadow'), 'none');
  await page.locator('body').evaluate(el => el.classList.add('dark'));
  assert.equal(await get('badge','background-color'), 'rgb(43, 42, 39)');
  assert.equal(await get('code-heading','font-variation-settings'), 'normal');
  await page.locator('body').evaluate(el => el.removeAttribute('data-agy-font'));
  assert.equal(await get('pdf','--sdk-font-family'), 'Arial', 'SDK variables are not global when patch font scope is absent');
});
