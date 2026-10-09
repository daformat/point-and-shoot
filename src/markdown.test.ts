import { describe, expect, it } from "vitest";

import { toMarkdown } from "./markdown.js";

function html(source: string): HTMLElement {
  const div = document.createElement("div");
  div.innerHTML = source;
  return div;
}

const md = (source: string) =>
  toMarkdown(html(source), { baseURI: "https://example.com/page" });

describe("toMarkdown", () => {
  it("converts blocks and inline styles", () => {
    expect(
      md(
        "<h2>Title</h2><p>Some <strong>bold</strong> and <em>soft</em> text.</p>",
      ),
    ).toBe("## Title\n\nSome **bold** and *soft* text.");
  });

  it("makes links and images absolute", () => {
    expect(md('<p><a href="/x">a link</a></p>')).toBe(
      "[a link](https://example.com/x)",
    );
    expect(md('<img data-src="pic.png" alt="A pic">')).toBe(
      "![A pic](https://example.com/pic.png)",
    );
  });

  it("leaves icons out", () => {
    expect(md('<img src="i.png" width="16" height="16">')).toBe("");
  });

  it("converts lists, nested and numbered", () => {
    expect(
      md("<ol start=3><li>one</li><li>two<ul><li>sub</li></ul></li></ol>"),
    ).toBe("3. one\n4. two\n     - sub");
  });

  it("converts code and tables", () => {
    expect(md('<pre><code class="language-js">let a = 1;</code></pre>')).toBe(
      "```js\nlet a = 1;\n```",
    );
    expect(
      md(
        "<table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table>",
      ),
    ).toBe("| a | b |\n| --- | --- |\n| 1 | 2 |");
  });

  it("quotes blockquotes", () => {
    expect(md("<blockquote><p>one</p><p>two</p></blockquote>")).toBe(
      "> one\n>\n> two",
    );
  });

  it("skips forms, scripts and footnote markers", () => {
    expect(
      md("<p>Text<sup>[1]</sup></p><form><input></form><script>x()</script>"),
    ).toBe("Text");
  });

  it("escapes Markdown in text", () => {
    expect(md("<p>a*b_c</p>")).toBe("a\\*b\\_c");
  });

  it("converts a range", () => {
    const el = html("<p>Hello <b>big</b> world</p>");
    document.body.appendChild(el);
    const range = document.createRange();
    range.selectNodeContents(el.querySelector("p")!);
    expect(toMarkdown(range)).toBe("Hello **big** world");
    el.remove();
  });
});
