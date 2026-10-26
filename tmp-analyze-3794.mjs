import fs from "fs";
import os from "path";
import { tmpdir } from "os";
import path from "path";

const s = fs.readFileSync(path.join(tmpdir(), "jbt-3794.js"), "utf8");
console.log("size", s.length);
console.log("header", s.slice(0, 200));

// Find webpack module IDs
const ids = [...s.matchAll(/[,{](\d{2,5}):\(/g)].map((m) => m[1]);
console.log("module ids sample", [...new Set(ids)].slice(0, 30));

// Key library fingerprints
for (const n of [
  "react-dom",
  "Scheduler",
  "useEffectEvent",
  "forwardRef",
  "createPortal",
  "hydrateRoot",
  "Next.js",
  "next/dist",
  "__next",
  "AppRouter",
  "usePathname",
  "Report only",
  "Minified React error",
]) {
  console.log(n, s.includes(n));
}

// Is this basically the react-dom client?
console.log("commitHook-like ix", /function ix\(/.test(s));
console.log("has destroy_", s.includes("destroy_"));
console.log("has useEffectEvent reexport count", (s.match(/useEffectEvent/g) || []).length);
