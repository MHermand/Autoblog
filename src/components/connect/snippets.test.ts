import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  LIST_RESPONSE_EXAMPLE,
  NEXT_ARTICLE_PAGE,
  NEXT_LIST_PAGE,
  PLAIN_JS_HTML,
  POST_RESPONSE_EXAMPLE,
} from "./snippets";

const ORIGIN = "https://blog.example.com";

function syntaxErrors(code: string): string[] {
  const { diagnostics } = ts.transpileModule(code, {
    reportDiagnostics: true,
    compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    fileName: "snippet.tsx",
  });
  return (diagnostics ?? []).map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
}

describe("connect snippets", () => {
  it("embed the instance origin", () => {
    for (const snippet of [PLAIN_JS_HTML, NEXT_LIST_PAGE, NEXT_ARTICLE_PAGE]) {
      expect(snippet(ORIGIN)).toContain(`${ORIGIN}/api/posts`);
    }
  });

  it("plain JavaScript snippet is valid JavaScript", () => {
    const script = /<script type="module">([\s\S]*)<\/script>/.exec(PLAIN_JS_HTML(ORIGIN))?.[1];
    expect(script).toBeTruthy();
    expect(syntaxErrors(script as string)).toEqual([]);
  });

  it("Next.js snippets are valid TSX and fetch with revalidate: 300", () => {
    for (const snippet of [NEXT_LIST_PAGE, NEXT_ARTICLE_PAGE]) {
      const code = snippet(ORIGIN);
      expect(syntaxErrors(code)).toEqual([]);
      expect(code).toContain("revalidate: 300");
    }
  });

  it("response examples are valid JSON", () => {
    expect(() => JSON.parse(LIST_RESPONSE_EXAMPLE)).not.toThrow();
    expect(() => JSON.parse(POST_RESPONSE_EXAMPLE)).not.toThrow();
  });
});
