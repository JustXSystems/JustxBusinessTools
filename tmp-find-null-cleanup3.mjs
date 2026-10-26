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

function extractEffectBodies(src) {
  const results = [];
  const re = /use(?:Layout|Insertion)?Effect\s*\(\s*(async\s*)?(?:\([^)]*\)|[a-zA-Z_$][\w$]*)\s*=>/g;
  let m;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length;
    while (/\s/.test(src[i])) i++;
    if (src[i] !== "{") continue;
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
    results.push(src.slice(start, i));
  }
  return results;
}

for (const file of walk("web")) {
  const src = fs.readFileSync(file, "utf8");
  for (const body of extractEffectBodies(src)) {
    // return X ? ... : null/false
    // return null
    // return foo && bar (where not clearly function)
    const patterns = [
      /\breturn\s+null\b/,
      /\breturn\s+false\b/,
      /\breturn\s+true\b/,
      /\breturn\s+[^;]*\?\s*[^:;]+?\s*:\s*null\b/,
      /\breturn\s+[^;]*&&\s*[^;]+/,
    ];
    for (const p of patterns) {
      const m = body.match(p);
      if (m) {
        console.log(file);
        console.log(" ", m[0].slice(0, 120));
        console.log(" ", body.slice(0, 200).replace(/\s+/g, " "));
        console.log("");
        break;
      }
    }
  }
}
