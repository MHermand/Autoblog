// Guards the "pure and generic" contract of the domain modules: nothing
// deployment-specific baked into the code, and no I/O or framework imports.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MODULES = ["article", "markdown", "prompts", "schedule", "seo", "settings", "slug", "topics"];

const source = (name: string) => readFileSync(join(__dirname, `${name}.ts`), "utf8");

// Infrastructure names that must stay out of the domain layer.
const FORBIDDEN_WORDS = ["supabase", "tiptap", "next/"];

describe.each(MODULES)("src/core/%s.ts", (name) => {
  const code = source(name);

  it("references no infrastructure", () => {
    const lower = code.toLowerCase();
    for (const word of FORBIDDEN_WORDS) {
      expect(lower, `found "${word}"`).not.toContain(word);
    }
  });

  it("hardcodes no timezone other than UTC (it comes from the settings)", () => {
    const withoutComments = code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(withoutComments).not.toMatch(/["'`](?:Africa|America|Asia|Atlantic|Australia|Europe|Indian|Pacific)\/[A-Za-z_]+["'`]/);
  });

  it("imports no framework, database, network or Node I/O module", () => {
    const imports = [...code.matchAll(/(?:from|import)\s+["']([^"']+)["']/g)].map((m) => m[1]);
    for (const specifier of imports) {
      const allowed = specifier.startsWith("./") || ["zod", "marked", "sanitize-html"].includes(specifier);
      expect(allowed, `unexpected import "${specifier}"`).toBe(true);
    }
    expect(code).not.toMatch(/\bfetch\s*\(/);
    expect(code).not.toMatch(/\bprocess\.env\b/);
  });
});
