import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import fr from "../../messages/fr.json";

type Tree = { [key: string]: string | Tree };

/** Flattens a message tree into "a.b.c" -> string. */
function flatten(tree: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out[path] = value;
    else Object.assign(out, flatten(value, path));
  }
  return out;
}

/** Variable names used by a message: {name}, {count, plural, ...} and <tag>…</tag>. */
function placeholders(message: string): string[] {
  const vars = new Set<string>();
  for (const match of message.matchAll(/\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*[,}]/g)) vars.add(match[1]);
  for (const match of message.matchAll(/<([A-Za-z]+)>/g)) vars.add(`<${match[1]}>`);
  return [...vars].sort();
}

const enFlat = flatten(en as Tree);
const frFlat = flatten(fr as Tree);

describe("messages", () => {
  it("en.json and fr.json have identical key sets", () => {
    const enKeys = Object.keys(enFlat).sort();
    const frKeys = Object.keys(frFlat).sort();
    expect(frKeys.filter((k) => !(k in enFlat)), "keys only in fr.json").toEqual([]);
    expect(enKeys.filter((k) => !(k in frFlat)), "keys only in en.json").toEqual([]);
  });

  it("uses the same placeholders in both languages", () => {
    for (const key of Object.keys(enFlat)) {
      expect(placeholders(frFlat[key] ?? ""), key).toEqual(placeholders(enFlat[key]));
    }
  });

  it("has no empty messages", () => {
    for (const [key, value] of [...Object.entries(enFlat), ...Object.entries(frFlat)]) {
      expect(value.trim(), key).not.toBe("");
    }
  });
});
