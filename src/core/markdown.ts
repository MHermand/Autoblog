// Markdown -> sanitized HTML. Safe to call from Node and from the browser
// (no Node-only APIs): `marked` renders, `sanitize-html` enforces an allowlist.

import { Marked } from "marked";
import sanitizeHtml from "sanitize-html";

const marked = new Marked({ gfm: true, breaks: false });

const ALLOWED_TAGS = [
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "br",
  "hr",
  "ul",
  "ol",
  "li",
  "blockquote",
  "strong",
  "em",
  "del",
  "a",
  "img",
  "code",
  "pre",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
];

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: {
    a: ["href", "title", "rel"],
    img: ["src", "alt", "title"],
    th: ["align"],
    td: ["align"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: ["http", "https"] },
  allowProtocolRelative: false,
  // Links are always rewritten, whatever `rel` the source carried.
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, rel: "noopener noreferrer" },
    }),
  },
};

/**
 * Renders GitHub-flavoured Markdown to HTML and sanitizes the result. Scripts,
 * event handlers, styles, iframes and any URL scheme other than http, https
 * (and mailto for links) are removed; links get `rel="noopener noreferrer"`.
 */
export function renderMarkdown(md: string): string {
  const source = typeof md === "string" ? md : "";
  const html = marked.parse(source, { async: false });
  return sanitizeHtml(html, SANITIZE_OPTIONS);
}
