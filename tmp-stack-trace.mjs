import fs from "fs";
import path from "path";
import os from "os";

const react = fs.readFileSync(path.join(os.tmpdir(), "jbt-react.js"), "utf8");
const app = fs.readFileSync(path.join(os.tmpdir(), "jbt-3794.js"), "utf8");

const offsets = [93479, 121621, 120884, 121082, 120946, 121016];
console.log("=== React chunk frames ===");
for (const off of offsets) {
  console.log("\n--- offset", off, "---");
  console.log(react.slice(Math.max(0, off - 180), off + 120));
}

// Find function ix definition nearby 93479
const around = react.slice(90000, 95000);
const ixDef = around.match(/function ix\([^)]*\)\{[^]{0,400}/);
console.log("\n=== ix def near 90k ===\n", ixDef?.[0]?.slice(0, 500));

// Broader search for function ix
let i = react.indexOf("function ix(");
console.log("\nix defs:", [...react.matchAll(/function ix\(/g)].length);
while (i >= 0) {
  console.log(react.slice(i, i + 350));
  console.log("---");
  i = react.indexOf("function ix(", i + 1);
  if (i > 0 && i < react.length) {
    // only first 3
  }
  break;
}

console.log("\n=== 3794 overview ===");
console.log("size", app.length);
console.log("useEffectEvent", app.includes("useEffectEvent"));
console.log("has Ims", /IMS|imsdealer|Stock In|useIms/.test(app));
console.log("has Bos", /BosApp|useBos/.test(app));

// What modules are in 3794?
const push = app.match(/push\(\[\[3794\],\{/);
console.log("is webpack chunk 3794", !!push);

// Find useEffectEvent usage context
i = app.indexOf("useEffectEvent");
console.log("\nuseEffectEvent contexts:");
let n = 0;
while (i >= 0 && n < 5) {
  console.log(app.slice(Math.max(0, i - 100), i + 150));
  console.log("---");
  i = app.indexOf("useEffectEvent", i + 1);
  n++;
}

// List export names / searchable strings unique to identify source files
for (const s of [
  "useBosData",
  "useImsData",
  "Couldn't load this section",
  "Justx IMS",
  "Loading CSS chunk",
  "CommandPalette",
  "AppShell",
  "Field",
  "DataTable",
  "Segmented",
  "WidgetCard",
  "bos-stack",
  "ims-",
]) {
  console.log(s, app.includes(s));
}
