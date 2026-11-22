import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import RichText from "../RichText";
import NotebookPreview from "../NotebookPreview";
import { normalizeMathDelimiters } from "../richTextMath";
import { notebookFixture, notes } from "./fixtures/notebook";

test("common TeX delimiters adapt without stripping environment commands or math bodies", () => {
  const environment = String.raw`\begin{aligned}x &= 1 \\ y &= 2\end{aligned}`;
  assert.equal(normalizeMathDelimiters(environment), `\n$$\n${environment}\n$$\n`);
  assert.equal(normalizeMathDelimiters(String.raw`Inline \(x^2+1\), then \[y=2\].`), "Inline $x^2+1$, then \n$$\ny=2\n$$\n.");
  const existing = String.raw`Keep $p=0.03$ and $$\begin{aligned}a&=b\end{aligned}$$.`;
  assert.equal(normalizeMathDelimiters(existing), existing);
});

test("fenced, indented and inline code preserve literal math syntax", () => {
  const code = "```python\nprint(r'\\[literal\\]')\n# \\begin{aligned}not math\\end{aligned}\n```\n\n    \\[indented code\\]\n\n`\\(inline code\\)` and ``\\[more code\\]``";
  assert.equal(normalizeMathDelimiters(code), code);
  const unfinishedFence = "~~~python\n\\[not math yet\\]";
  assert.equal(normalizeMathDelimiters(unfinishedFence), unfinishedFence);
});

test("escaped currency, escaped backslashes and incomplete TeX are not deleted", () => {
  for (const text of [String.raw`Pay \$19, then \$20.`, String.raw`\\(literal escaped delimiters\\)`, String.raw`\begin{aligned}not finished`, String.raw`An unfinished \[x+1`]) {
    assert.equal(normalizeMathDelimiters(text), text);
  }
});

test("rich Markdown produces semantic headings/lists/code and accessible MathML", () => {
  const markup = renderToStaticMarkup(<RichText text={notes} />);
  assert.match(markup, /<h3\b/);
  assert.match(markup, /<ul>/);
  assert.match(markup, /<strong>3<\/strong>/);
  assert.match(markup, /<code>density=False<\/code>/);
  assert.match(markup, /<math\b/);
  assert.match(markup, /application\/x-tex/);
  assert.ok(markup.includes("\\begin{aligned}"), "the original aligned environment survives in its math annotation");
  assert.ok(markup.includes("\\end{aligned}"));
  assert.doesNotMatch(markup, /class="katex-error"/);
});

test("raw HTML, Markdown media, links and unsafe TeX never create active elements", () => {
  const text = String.raw`<script>window.bad=1</script>

<iframe src="https://example.invalid"></iframe>

![Private figure](https://example.invalid/figure.png)

[Run this](javascript:alert(1)) and [Reference](https://example.invalid/notes).

$\includegraphics{https://example.invalid/math.png}$

$\href{javascript:alert(1)}{danger}$
`;
  const markup = renderToStaticMarkup(<RichText text={text} />);
  assert.doesNotMatch(markup, /<(?:script|iframe|img|a|object|embed)\b/i);
  assert.doesNotMatch(markup, /\shref\s*=/i);
  assert.match(markup, /Image description: Private figure/);
  assert.match(markup, /Run this/);
  assert.match(markup, /https:\/\/example.invalid\/notes/);
});

test("unsupported and recursive TeX stays readable instead of breaking the lesson", () => {
  const markup = renderToStaticMarkup(<RichText text={String.raw`Before $\def\loop{\loop}\loop$ after.`} />);
  assert.match(markup, /Before/);
  assert.match(markup, /after/);
  assert.match(markup, /katex-error/);
});

test("notebook preview preserves cell boundaries, exact code and authored math source", () => {
  const markup = renderToStaticMarkup(<NotebookPreview notebook={notebookFixture} filename="attempt.ipynb" onAsk={() => {}} />);
  assert.equal((markup.match(/<article\b/g) ?? []).length, 3);
  assert.match(markup, /Read-only uploaded notebook/);
  assert.match(markup, /Jump to a cell/);
  assert.match(markup, /Next cell/);
  assert.match(markup, /data-cell-id="plot1"/);
  assert.match(markup, /density=False/);
  assert.match(markup, /Keep this exact source/);
  assert.match(markup, /View original cell text/);
  assert.match(markup, /Ask about this cell, cell 2/);
  assert.match(markup, /<math\b/);
  assert.doesNotMatch(markup, /untrustedOutput/);
  assert.doesNotMatch(markup, /<script\b/i);
});

test("raw notebook source arrays and empty notebooks have honest readable fallbacks", () => {
  const markup = renderToStaticMarkup(<NotebookPreview filename="raw.ipynb" notebook={{ cells: [{ id: "raw", cell_type: "code", source: ["first line\n", "second line"] }] }} />);
  assert.match(markup, /first line\nsecond line/);
  const empty = renderToStaticMarkup(<NotebookPreview notebook={{ cells: [] }} filename="empty.ipynb" />);
  assert.match(empty, /No saved cells are available/);
});
