import fs from "fs";
import path from "path";

function walk(d, out = []) {
  for (const name of fs.readdirSync(d)) {
    if (name === "node_modules" || name === ".next") continue;
    const p = path.join(d, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(tsx|ts)$/.test(name)) out.push(p);
  }
  return out;
}

const files = walk("web");
const hits = [];

for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  // Find useEffect / useLayoutEffect call starts
  const re = /use(?:Layout|Insertion)?Effect\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    const start = m.index;
    // Walk to matching closing paren of useEffect( ... )
    let i = start + m[0].length;
    let depth = 1;
    let inStr = null;
    let inLine = false;
    let inBlock = false;
    for (; i < src.length && depth > 0; i++) {
      const c = src[i];
      const n = src[i + 1];
      if (inLine) {
        if (c === "\n") inLine = false;
        continue;
      }
      if (inBlock) {
        if (c === "*" && n === "/") {
          inBlock = false;
          i++;
        }
        continue;
      }
      if (inStr) {
        if (c === "\\" ) { i++; continue; }
        if (c === inStr) inStr = null;
        continue;
      }
      if (c === "/" && n === "/") { inLine = true; i++; continue; }
      if (c === "/" && n === "*") { inBlock = true; i++; continue; }
      if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
      if (c === "(") depth++;
      else if (c === ")") depth--;
    }
    const body = src.slice(start, i);
    // Flag non-function returns inside the effect callback
    // Look for return null/false/true/number/object/promise-like at effect top level-ish
    const bad = [...body.matchAll(/\breturn\s+(null|false|true|0|1|undefined)\b/g)];
    const badCall = [...body.matchAll(/\breturn\s+([a-zA-Z_$][\w.$]*)\s*\(/g)].filter((x) => {
      const name = x[1];
      // Allow returning a cleanup factory call that creates a function? rare.
      // Flag likely value-returning calls
      return !/^(clear|remove|disconnect|abort|unsub|cancel|stop|dispose|destroy|close|teardown)/i.test(name);
    });
    // Implicit return of call: useEffect(() => foo(), ...)
    const impl = body.match(/use(?:Layout|Insertion)?Effect\(\s*\(\)\s*=>\s*(?!\{)([^,]+),/);

    if (bad.length || (impl && !/^set[A-Z]/.test(impl[1].trim()) && !impl[1].includes("=>"))) {
      hits.push({
        file,
        bad: bad.map((b) => b[0]),
        impl: impl?.[1]?.trim(),
        snip: body.slice(0, 280).replace(/\s+/g, " "),
      });
    }
    // Also flag return <non-arrow-call>
    for (const b of badCall) {
      if (/return\s+\(\s*\)\s*=>/.test(body)) continue;
      hits.push({
        file,
        bad: [b[0]],
        snip: body.slice(Math.max(0, b.index - 40), b.index + 80).replace(/\s+/g, " "),
      });
    }
  }
}

// Dedupe by file+snip
const seen = new Set();
for (const h of hits) {
  const k = h.file + h.snip.slice(0, 80);
  if (seen.has(k)) continue;
  seen.add(k);
  console.log("\n" + h.file);
  if (h.bad?.length) console.log("  bad returns:", h.bad.join(", "));
  if (h.impl) console.log("  impl body:", h.impl);
  console.log(" ", h.snip.slice(0, 220));
}
console.log("\nTotal unique", seen.size);
