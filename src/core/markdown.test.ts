import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";

describe("renderMarkdown: rendering", () => {
  it("renders headings, paragraphs and inline formatting", () => {
    const html = renderMarkdown("## Title\n\nA **bold** and *italic* and ~~struck~~ text.");
    expect(html).toContain("<h2>Title</h2>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<del>struck</del>");
    expect(html).toContain("<p>");
  });

  it("renders bulleted and numbered lists", () => {
    const html = renderMarkdown("- a\n- b\n\n1. one\n2. two");
    expect(html).toMatch(/<ul>\s*<li>a<\/li>\s*<li>b<\/li>\s*<\/ul>/);
    expect(html).toMatch(/<ol>\s*<li>one<\/li>\s*<li>two<\/li>\s*<\/ol>/);
  });

  it("renders blockquotes, code, horizontal rules and line breaks", () => {
    const html = renderMarkdown("> quoted\n\n`inline`\n\n```js\nconst a = 1;\n```\n\n---\n\nline one  \nline two");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<code>inline</code>");
    expect(html).toContain("<pre><code");
    expect(html).toContain("const a = 1;");
    expect(html).toContain("<hr");
    expect(html).toContain("<br");
  });

  it("renders GFM tables", () => {
    const html = renderMarkdown("| A | B |\n|---|:-:|\n| 1 | 2 |");
    expect(html).toContain("<table>");
    expect(html).toContain("<thead>");
    expect(html).toContain("<tbody>");
    expect(html).toMatch(/<th[^>]*>A<\/th>/);
    expect(html).toMatch(/<td[^>]*>2<\/td>/);
  });

  it("renders images and links", () => {
    const html = renderMarkdown('![A cat](https://example.com/cat.png "Tom") and [a link](https://example.com/page "Home")');
    expect(html).toContain('src="https://example.com/cat.png"');
    expect(html).toContain('alt="A cat"');
    expect(html).toContain('title="Tom"');
    expect(html).toContain('href="https://example.com/page"');
    expect(html).toContain('title="Home"');
  });

  it("escapes text that merely looks like HTML", () => {
    const html = renderMarkdown("Use `<div>` and 1 < 2 & 3 > 2.");
    expect(html).toContain("&lt;div&gt;");
    expect(html).toContain("1 &lt; 2 &amp; 3 &gt; 2");
  });

  it("returns an empty string for empty or non-string input", () => {
    expect(renderMarkdown("")).toBe("");
    expect(renderMarkdown(undefined as unknown as string)).toBe("");
    expect(renderMarkdown(null as unknown as string)).toBe("");
  });

  it("is a pure function of its input", () => {
    const md = "# Hello\n\nworld";
    expect(renderMarkdown(md)).toBe(renderMarkdown(md));
  });
});

describe("renderMarkdown: links", () => {
  it("adds rel noopener noreferrer to every link", () => {
    const html = renderMarkdown("[a](https://example.com) [b](http://example.org) [c](/relative)");
    const anchors = html.match(/<a [^>]*>/g) ?? [];
    expect(anchors).toHaveLength(3);
    for (const anchor of anchors) expect(anchor).toContain('rel="noopener noreferrer"');
  });

  it("replaces any rel and drops target coming from raw HTML", () => {
    const html = renderMarkdown('<a href="https://example.com" target="_blank" rel="opener">x</a>');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain("opener\"");
    expect(html).not.toContain("target");
  });

  it("allows mailto links and relative or anchor links", () => {
    const html = renderMarkdown("[mail](mailto:hi@example.com) [rel](/blog/post) [anchor](#top)");
    expect(html).toContain('href="mailto:hi@example.com"');
    expect(html).toContain('href="/blog/post"');
    expect(html).toContain('href="#top"');
  });
});

describe("renderMarkdown: sanitization", () => {
  it("removes script tags and their content", () => {
    const html = renderMarkdown("Hello\n\n<script>alert('xss')</script>\n\nWorld");
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain("alert");
    expect(html).toContain("Hello");
    expect(html).toContain("World");
  });

  it("removes inline scripts hidden in a paragraph", () => {
    const html = renderMarkdown("text <script>alert(1)</script> more");
    expect(html).not.toMatch(/script|alert/i);
  });

  it("strips javascript: links, whatever the casing or whitespace", () => {
    for (const href of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", " javascript:alert(1)", "java\tscript:alert(1)"]) {
      const html = renderMarkdown(`<a href="${href}">click</a>`);
      expect(html).not.toMatch(/javascript/i);
      expect(html).not.toMatch(/alert/i);
    }
    const md = renderMarkdown("[click](javascript:alert(1))");
    expect(md).not.toMatch(/javascript/i);
    expect(md).toContain("click");
  });

  it("strips other unsafe schemes", () => {
    for (const url of ["data:text/html;base64,PHNjcmlwdD4=", "vbscript:msgbox(1)", "file:///etc/passwd", "ftp://example.com/x"]) {
      const html = renderMarkdown(`[x](${url})`);
      expect(html).not.toMatch(/href=/);
    }
  });

  it("strips unsafe image sources and event handlers", () => {
    expect(renderMarkdown("![x](javascript:alert(1))")).not.toMatch(/javascript/i);
    expect(renderMarkdown("![x](data:image/svg+xml;base64,AAAA)")).not.toContain("data:");
    expect(renderMarkdown('<img src="https://example.com/a.png" onerror="alert(1)">')).not.toMatch(/onerror|alert/i);
    expect(renderMarkdown('<img src="x" onerror="alert(1)">')).not.toMatch(/onerror|alert/i);
  });

  it("does not allow mailto as an image source", () => {
    expect(renderMarkdown("![x](mailto:a@b.c)")).not.toContain("mailto");
  });

  it("blocks protocol-relative URLs", () => {
    expect(renderMarkdown("[x](//evil.example/path)")).not.toContain("evil.example");
    expect(renderMarkdown("![x](//evil.example/a.png)")).not.toContain("evil.example");
  });

  it("removes event handler attributes and style from allowed tags", () => {
    const html = renderMarkdown('<p onclick="alert(1)" style="color:red" class="x" id="y">hi</p>');
    expect(html).toBe("<p>hi</p>");
  });

  it("removes iframes, objects, embeds, forms, styles and svg", () => {
    const html = renderMarkdown(
      [
        '<iframe src="https://evil.example"></iframe>',
        '<object data="x"></object>',
        '<embed src="x">',
        '<form action="/steal"><input name="pw"></form>',
        "<style>body{display:none}</style>",
        '<svg onload="alert(1)"><circle/></svg>',
        '<link rel="stylesheet" href="https://evil.example/x.css">',
        '<meta http-equiv="refresh" content="0;url=https://evil.example">',
        "safe text",
      ].join("\n\n"),
    );
    expect(html).not.toMatch(/iframe|object|embed|<form|<input|<style|svg|<link|<meta|evil\.example|display:none/i);
    expect(html).toContain("safe text");
  });

  it("neutralizes HTML comments and CDATA", () => {
    const html = renderMarkdown("a <!-- <script>alert(1)</script> --> b <![CDATA[x]]>");
    expect(html).not.toMatch(/script|alert|<!--/i);
  });

  it("keeps text of disallowed but harmless tags", () => {
    const html = renderMarkdown("<div><span>kept</span></div>");
    expect(html).toContain("kept");
    expect(html).not.toMatch(/<div|<span/);
  });

  it("resists nested and malformed tag tricks", () => {
    const html = renderMarkdown('<scr<script>ipt>alert(1)</scr</script>ipt><a href="javascript&#58;alert(1)">x</a>');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/javascript/i);
  });

  it("allows nothing beyond the allowlisted tags", () => {
    const html = renderMarkdown(
      "# h1\n\n## h2\n\n### h3\n\n#### h4\n\n**b** *i* ~~d~~ `c`\n\n- l\n\n> q\n\n---\n\n| a |\n|---|\n| b |\n\n[l](https://e.com) ![i](https://e.com/i.png)",
    );
    const tags = new Set([...html.matchAll(/<\/?([a-z0-9]+)/gi)].map((m) => m[1].toLowerCase()));
    const allowed = new Set([
      "h1", "h2", "h3", "h4", "h5", "h6", "p", "br", "hr", "ul", "ol", "li", "blockquote", "strong", "em", "del",
      "a", "img", "code", "pre", "table", "thead", "tbody", "tr", "th", "td",
    ]);
    for (const tag of tags) expect(allowed.has(tag)).toBe(true);
  });
});
