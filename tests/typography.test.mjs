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
    '[class*="group/file-title"] *',
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
  assert.ok(monoMatch[1].indexOf("'Anthropic Mono'") < monoMatch[1].indexOf("Consolas"));
  assert.ok(monoMatch[1].indexOf("Consolas") < monoMatch[1].indexOf("'PingFang SC'"));

  // No non-standard fractional font weights remain.
  assert.doesNotMatch(css, /font-weight:\s*(?:450|520)\b/);
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
        <p>Press <kbd id="markdown-kbd">⌘K</kbd> or run <code id="markdown-code">npm test</code></p>
      </div>
      <div class="tool-call-header">
        <code class="thought-header" id="self-code">Code header</code>
        <span class="file-path" id="self-path">file.js</span>
        <div class="katex" style="font-family: math"><span id="formula">Math</span></div>
        <span class="codicon" id="icon" style="font-family: codicon">Icon</span>
      </div>
      <textarea id="textarea">Typing</textarea>
      <input id="text-input" value="Search query">
      <div data-lexical-editor="true" id="lexical-box"><span data-lexical-text="true" id="lexical-span">Prompt</span></div>
      <p class="pointer-events-none" id="placeholder">Placeholder</p>
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
  });
}
