import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BOS_COLOR_TOKENS,
  BOS_MOTION_TOKENS,
  BOS_RADIUS_TOKENS,
  BOS_SPACE_TOKENS,
} from "@/components/bos/tokens";

const stylesDir = path.resolve(__dirname, "../../components/bos/styles");
const tokensCss = readFileSync(path.join(stylesDir, "bos.tokens.css"), "utf8");

/** Extracts `--name: value;` declarations from the first rule matching `selector {`. */
function declarations(selector: string): Map<string, string> {
  const start = tokensCss.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`selector not found: ${selector}`);
  const body = tokensCss.slice(start, tokensCss.indexOf("}", start));
  const out = new Map<string, string>();
  for (const m of body.matchAll(/(--bos-[\w-]+)\s*:\s*([^;]+);/g)) out.set(m[1], m[2].trim());
  return out;
}

const root = declarations(".bos");
const light = declarations('.bos[data-bos-theme="light"]');
const dark = declarations('.bos[data-bos-theme="dark"]');

describe("BOS token single source of truth", () => {
  it("every color token has matching light/dark CSS values", () => {
    for (const t of BOS_COLOR_TOKENS) {
      if (t.group === "pastels") {
        expect(root.get(t.cssVar)?.toUpperCase(), t.cssVar).toBe(t.light.toUpperCase());
        continue;
      }
      expect(light.get(t.cssVar)?.toUpperCase(), `${t.cssVar} (light)`).toBe(t.light.toUpperCase());
      expect(dark.get(t.cssVar)?.toUpperCase(), `${t.cssVar} (dark)`).toBe(t.dark.toUpperCase());
    }
  });

  it("scale tokens match", () => {
    for (const t of [...BOS_RADIUS_TOKENS, ...BOS_SPACE_TOKENS, ...BOS_MOTION_TOKENS]) {
      expect(root.get(t.cssVar), t.cssVar).toBe(t.value);
    }
  });

  it("light and dark themes define the same token set", () => {
    expect([...dark.keys()].sort()).toEqual([...light.keys()].sort());
  });

  it("never styles bare elements outside a .bos scope", () => {
    const files = ["bos.tokens.css", "bos.components.css", "bos.patterns.css"];
    for (const file of files) {
      const css = readFileSync(path.join(stylesDir, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      const selectors = css
        .replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "")
        .split("}")
        .map((chunk) => chunk.split("{")[0])
        .flatMap((sel) => sel.split(","))
        .map((s) => s.trim())
        .filter((s) => s && !s.startsWith("@") && !/^(from|to|\d+%)$/.test(s));
      for (const sel of selectors) {
        // `.bos` must be a whole class: `.bos-row` alone would leak to the host page.
        const scoped = /^\.bos(?=$|[\s.:[>])/.test(sel) || /^body\.bos-printing(?=$|[\s.:[>])/.test(sel);
        expect(scoped, `${file}: ${sel}`).toBe(true);
      }
    }
  });
});
