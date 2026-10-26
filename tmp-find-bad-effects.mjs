import fs from "fs";
import path from "path";
import { execSync } from "child_process";

// ripgrep for suspicious useEffect / useLayoutEffect patterns across web/
const root = "web";
const files = [];
function walk(d) {
  for (const name of fs.readdirSync(d)) {
    if (name === "node_modules" || name === ".next") continue;
    const p = path.join(d, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.(tsx|ts|jsx|js)$/.test(name)) files.push(p);
  }
}
walk(root);

const hits = [];
for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  // Skip if no effects
  if (!/use(Layout|Insertion)?Effect\(/.test(src)) continue;

  // 1) Expression-body effect that isn't clearly a cleanup factory or void setter
  // useEffect(() => foo(...), deps)  — returns foo's return value
  const reExpr =
    /use(?:Layout|Insertion)?Effect\(\s*\(\)\s*=>\s*(?!set[A-Z]|[\s]*\()([^,{;\n]+(?:\([^)]*\))?)\s*,/g;
  let m;
  while ((m = reExpr.exec(src))) {
    const expr = m[1].trim();
    // Allow known-safe: setMounted(true), setX(...), () => cleanup patterns already excluded
    if (/^set[A-Za-z0-9_]+\(/.test(expr)) continue;
    if (/^endRef\.|^ref\./.test(expr)) continue; // scrollIntoView etc void
    hits.push({ file, kind: "expr-body", expr, snip: src.slice(m.index, m.index + 120).replace(/\s+/g, " ") });
  }

  // 2) return <call>( that looks async / fetch / .then
  const reRet = /use(?:Layout|Insertion)?Effect\(\(\)\s*=>\s*\{[^}]{0,800}?return\s+([^;]+);/gs;
  while ((m = reRet.exec(src))) {
    const ret = m[1].trim();
    if (ret.startsWith("()") || ret.startsWith("(") || ret === "undefined") continue;
    if (/^function|^async\s*\(|^\(\)\s*=>/.test(ret)) continue; // proper cleanup
    if (/^\(\s*\)\s*=>/.test(ret)) continue;
    // Flag returns that look like values/promises
    if (
      /\.then\s*\(|await\s+|fetch\s*\(|Promise\.|refresh\s*\(|load[A-Z]\w*\s*\(|reload\s*\(|\.finally\s*\(/.test(ret) ||
      (/^[a-zA-Z_$][\w.$]*\(/.test(ret) && !/^clear|^remove|^disconnect|^abort|^unsub|^cancel|^stop|^dispose|^destroy|^close|^teardown/.test(ret))
    ) {
      hits.push({ file, kind: "return-call", expr: ret, snip: src.slice(m.index, m.index + 160).replace(/\s+/g, " ") });
    }
  }

  // 3) async effect
  if (/use(?:Layout|Insertion)?Effect\(\s*async\s*\(/.test(src)) {
    hits.push({ file, kind: "async-effect", expr: "async", snip: "async useEffect" });
  }
}

console.log("hits", hits.length);
for (const h of hits) {
  console.log("\n" + h.kind, h.file);
  console.log(" ", h.expr);
  console.log(" ", h.snip.slice(0, 200));
}
