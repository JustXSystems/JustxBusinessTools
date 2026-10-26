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

/** Extract top-level statements-ish from an effect arrow function body for return null etc. */
function extractEffectBodies(src) {
  const results = [];
  const re = /use(?:Layout|Insertion)?Effect\s*\(\s*(async\s*)?(?:\([^)]*\)|[a-zA-Z_$][\w$]*)\s*=>/g;
  let m;
  while ((m = re.exec(src))) {
    const isAsync = !!m[1];
    let i = m.index + m[0].length;
    // skip whitespace
    while (/\s/.test(src[i])) i++;
    if (src[i] === "{") {
      // block body — find matching brace
      let depth = 0;
      const start = i;
      let inStr = null,
        inLine = false,
        inBlock = false;
      for (; i < src.length; i++) {
        const c = src[i],
          n = src[i + 1];
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
          if (c === "\\") {
            i++;
            continue;
          }
          if (c === inStr) inStr = null;
          continue;
        }
        if (c === "/" && n === "/") {
          inLine = true;
          i++;
          continue;
        }
        if (c === "/" && n === "*") {
          inBlock = true;
          i++;
          continue;
        }
        if (c === '"' || c === "'" || c === "`") {
          inStr = c;
          continue;
        }
        if (c === "{") depth++;
        else if (c === "}") {
          depth--;
          if (depth === 0) {
            i++;
            break;
          }
        }
      }
      results.push({ isAsync, kind: "block", body: src.slice(start, i), index: m.index });
    } else {
      // expression body until comma at depth 0
      const start = i;
      let depth = 0;
      let inStr = null;
      for (; i < src.length; i++) {
        const c = src[i];
        if (inStr) {
          if (c === "\\") {
            i++;
            continue;
          }
          if (c === inStr) inStr = null;
          continue;
        }
        if (c === '"' || c === "'" || c === "`") {
          inStr = c;
          continue;
        }
        if (c === "(" || c === "[" || c === "{") depth++;
        else if (c === ")" || c === "]" || c === "}") depth--;
        else if (c === "," && depth === 0) break;
      }
      results.push({ isAsync, kind: "expr", body: src.slice(start, i).trim(), index: m.index });
    }
  }
  return results;
}

const hits = [];
for (const file of walk("web")) {
  const src = fs.readFileSync(file, "utf8");
  if (!src.includes("useEffect") && !src.includes("useLayoutEffect")) continue;
  for (const eff of extractEffectBodies(src)) {
    if (eff.isAsync) {
      hits.push({ file, issue: "async-effect", detail: eff.body.slice(0, 120) });
      continue;
    }
    if (eff.kind === "expr") {
      // Expression body: return value of expression becomes cleanup
      // Safe if it's setState(...) which returns void/undefined, or void expr
      const b = eff.body;
      if (b.startsWith("void ")) continue;
      if (/^set[A-Z]/.test(b)) continue; // setState returns void in practice... actually returns the value in some cases but usually undefined for useState setters
      if (b.startsWith("() =>")) continue; // returns cleanup factory? useEffect(() => () => cleanup) is VALID
      hits.push({ file, issue: "expr-return", detail: b.slice(0, 160) });
      continue;
    }
    // block: find return statements that aren't functions
    // crude: return null|false|true|number|await|identifier(
    const returns = [...eff.body.matchAll(/\breturn\s+([^;]+);/g)];
    for (const r of returns) {
      const val = r[1].trim();
      if (val.startsWith("()") || val.startsWith("(") && val.includes("=>")) continue;
      if (/^\(\)\s*=>/.test(val)) continue;
      if (/^function\b/.test(val)) continue;
      if (val === "undefined") continue;
      // Early `return;` is fine — not matched
      // `return null` BAD in React 19
      if (/^(null|false|true|\d+|['"`])/.test(val)) {
        hits.push({ file, issue: "bad-return", detail: "return " + val });
      } else if (/^[a-zA-Z_$][\w.$]*\s*\(/.test(val) && !/^\(\)\s*=>/.test(val)) {
        // return foo() — might be cleanup if foo returns function, but often Promise
        if (!/^(clear|remove|disconnect|abort|unsub|cancel|stop|dispose|destroy|close)/i.test(val)) {
          hits.push({ file, issue: "return-call", detail: "return " + val.slice(0, 100) });
        }
      }
    }
  }
}

const byIssue = {};
for (const h of hits) {
  byIssue[h.issue] = (byIssue[h.issue] || 0) + 1;
}
console.log("summary", byIssue);
for (const h of hits) {
  console.log(`\n[${h.issue}] ${h.file}\n  ${h.detail}`);
}
