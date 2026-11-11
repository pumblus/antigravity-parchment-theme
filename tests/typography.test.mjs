import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const css = readFileSync(new URL('../core/theme.css', import.meta.url), 'utf8');
const fonts = {
  sans: /^"?Anthropic Sans"?,/, mono: /^"?Anthropic Mono"?,/,
  serif: /^"?Anthropic Serif"?,/, typing: /^"?Sarasa Mono Slab SC"?,/,
  display: /^"?Anthropic Sans Display"?,/,
};
const contexts = [
  ['code', 'code', '', 'mono'], ['pre', 'pre', '', 'mono'], ['kbd', 'kbd', '', 'mono'], ['samp', 'samp', '', 'mono'],
  ['language', 'div', 'class="language-js"', 'mono'],
  ...['monaco-editor', 'xterm', 'file-title', 'file-path'].map(c => [c, 'div', `class="${c}"`, 'mono']),
  ...['data-path', 'data-file-path'].map(c => [c, 'div', `${c}="test.js"`, 'mono']),
  ['markdown-root', 'div', 'data-markdown-root', 'serif'],
  ...['prose', 'markdown', 'select-text', 'agy-user-bubble'].map(c => [c, 'div', `class="${c}"`, 'serif']),
  ['article', 'article', '', 'serif'], ['user-content', 'div', 'data-testid="user-message-content"', 'serif'],
  ['editable', 'div', 'contenteditable="true"', 'typing'],
  ['lexical', 'div', 'data-lexical-editor="true"', 'typing'],
  ['composer', 'div', 'data-composer', 'typing'], ['prosemirror', 'div', 'class="ProseMirror"', 'typing'],
];
const headers = ['thought-header', 'thinking-header', 'step-title', 'step-header', 'tool-call-header'];
test('upstream font aliases, code/file selectors and Lexical typography stay present', () => {
  for (const alias of ['AnthropicSansWebVariable-TextRegular', 'AnthropicSansWebVariable-TextLight', 'AnthropicSansWebVariable-TextSemibold', 'AnthropicSansWebVariable-TextBold', 'Anthropic Sans Web Display Light', 'AnthropicSerifWebWeb-TextRegular', 'Anthropic Serif Web Display Light', 'AnthropicMonoWebWeb-Regular', 'Anthropic Mono Web Regular', 'AnthropicSansText-Regular', 'AnthropicSansText-Bold', 'AnthropicSansDisplay-Regular', 'AnthropicSansDisplay-Bold']) assert.ok(css.includes(`local('${alias}')`), alias);
  for (const selector of ['[class*="group/file-title"] *', '[class*="file-path"]', '[data-path]', '[data-file-path]', '.monaco-editor', '.xterm', '[data-lexical-editor="true"] ~ p.pointer-events-none', '.bg-sidebar :is([data-active="true"], [data-active=""])']) assert.ok(css.includes(selector), selector);
  assert.ok(css.includes("'Sarasa Mono Slab SC', '等距更纱黑体 Slab SC', 'Anthropic Mono', 'Anthropic Mono Web', ui-monospace, monospace !important"));
});
for (const mode of ['light', 'dark']) {
  test(`typography computed styles (${mode})`, async t => {
    const executablePath = process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
    const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await browser.newPage();
    const nested = contexts.map(([id, tag, attrs]) => `<${tag} ${attrs}><span id="nested-${id}">Nested content</span></${tag}>`).join('');
    const ancestor = contexts.map(([id, tag, attrs]) => `<${tag} ${attrs}><span class="thought-header" id="ancestor-${id}">Protected heading</span></${tag}>`).join('');
    const labels = headers.map((name, i) => `<div class="${name} font-mono" id="class-${i}"><span class="font-mono" id="class-label-${i}">Title</span></div><div data-testid="${name}" class="font-mono" id="testid-${i}"><strong class="font-mono" id="testid-label-${i}">Title</strong></div>`).join('');
    await page.setContent(`<html data-ag-theme-mode="${mode}"><head></head><body class="${mode === 'dark' ? 'dark' : ''}" data-agy-font="inter">
      ${labels}<div class="tool-call-header">${nested}</div>${ancestor}
      <div class="thought"><p class="font-mono" id="generic-mono">True monospace</p><div data-markdown-root><p id="thought-prose">Thought body</p></div></div>
      <div class="thinking"><code id="thinking-code">x = 1</code></div>
      <h1 data-testid="home-greeting" id="greeting">Hello</h1>
      <div data-markdown-root><h1 id="markdown-h1">Heading</h1><h2 id="markdown-h2">Subheading</h2><h2 data-testid="home-greeting" id="protected-greeting">Prose greeting</h2></div>
      <div class="tool-call-header"><code class="thought-header" id="self-code">Code header</code><span class="file-path" id="self-path">file.js</span><div class="katex" style="font-family: math"><span id="formula">Math</span></div><span class="codicon" id="icon" style="font-family: codicon">Icon</span></div>
      <textarea id="textarea">Typing</textarea><div data-lexical-editor="true"></div><p class="pointer-events-none" id="placeholder">Placeholder</p>
    </body></html>`);
    await page.addStyleTag({ content: css });
    const family = id => page.locator(`#${id}`).evaluate(el => getComputedStyle(el).fontFamily);
    await t.test('explicit headers and labels use Sans', async () => {
      for (let i = 0; i < headers.length; i++) for (const prefix of ['class', 'class-label', 'testid', 'testid-label']) assert.match(await family(`${prefix}-${i}`), fonts.sans, `${prefix}-${headers[i]}`);
    });
    await t.test('nested code, prose, editors and paths retain their font', async () => {
      for (const [id, , , expected] of contexts) assert.match(await family(`nested-${id}`), fonts[expected], id);
      assert.match(await family('self-code'), fonts.mono); assert.match(await family('self-path'), fonts.mono);
      assert.equal(await family('formula'), 'math'); assert.equal(await family('icon'), 'codicon');
    });
    await t.test('headers inside protected ancestors are not restyled', async () => {
      for (const [id, , , expected] of contexts) assert.match(await family(`ancestor-${id}`), fonts[expected], id);
    });
    await t.test('generic mono, thought bodies and composer stay upstream', async () => {
      for (const [id, font] of [['generic-mono', 'mono'], ['thought-prose', 'serif'], ['thinking-code', 'mono'], ['textarea', 'typing'], ['placeholder', 'typing']]) assert.match(await family(id), fonts[font], id);
    });
    await t.test('only home greeting uses Display, Markdown headings remain Serif', async () => {
      assert.match(await family('greeting'), fonts.display);
      for (const id of ['markdown-h1', 'markdown-h2', 'protected-greeting']) assert.match(await family(id), fonts.serif);
    });
    await t.test('browser parses font aliases and keeps upstream variable aliases first', async () => {
      const faces = await page.evaluate(() => [...document.styleSheets].flatMap(s => [...s.cssRules]).filter(r => r.type === CSSRule.FONT_FACE_RULE).map(r => ({ family: r.style.fontFamily, src: r.style.getPropertyValue('src'), weight: r.style.fontWeight })));
      const normal = faces.find(f => f.family === '"Anthropic Sans"' && f.weight === '300 599');
      assert.ok(normal); assert.ok(normal.src.indexOf('AnthropicSansWebVariable-TextRegular') < normal.src.indexOf('Anthropic Sans Text Regular'));
      for (const alias of ['Anthropic Sans Web Display Light', 'AnthropicSansText-Regular']) assert.ok(normal.src.includes(alias));
      assert.ok(faces.some(f => f.src.includes('AnthropicMonoWebWeb-Regular')));
      assert.ok(faces.some(f => f.src.includes('AnthropicSansDisplay-Bold')));
    });
  });
}
