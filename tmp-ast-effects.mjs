import fs from "fs";
import path from "path";
import ts from "typescript";

function walk(d, o = []) {
  for (const n of fs.readdirSync(d)) {
    if (n === "node_modules" || n === ".next") continue;
    const p = path.join(d, n);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, o);
    else if (/\.tsx?$/.test(n)) o.push(p);
  }
  return o;
}

function isCleanup(e) {
  if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) return true;
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.CommaToken) {
    return isCleanup(e.right);
  }
  return false;
}

function analyzeCallback(arg, file, sf) {
  let body;
  if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) body = arg.body;
  else return;
  const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  if (ts.isBlock(body)) {
    for (const stmt of body.statements) {
      if (!ts.isReturnStatement(stmt) || !stmt.expression) continue;
      const e = stmt.expression;
      if (isCleanup(e)) continue;
      console.log(`RETURN ${file}:${lineOf(e)}`);
      console.log(`  ${e.getText(sf).slice(0, 160)}`);
    }
  } else {
    if (isCleanup(body)) return;
    console.log(`EXPR ${file}:${lineOf(body)}`);
    console.log(`  ${body.getText(sf).slice(0, 160)}`);
  }
}

function checkFile(file) {
  const src = fs.readFileSync(file, "utf8");
  if (!src.includes("useEffect") && !src.includes("useLayoutEffect") && !src.includes("useInsertionEffect")) return;
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const name = node.expression.getText(sf);
      if (name === "useEffect" || name === "useLayoutEffect" || name === "useInsertionEffect") {
        const arg = node.arguments[0];
        if (arg) analyzeCallback(arg, file, sf);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

for (const root of ["web/components", "web/app", "web/hooks", "web/lib"]) {
  if (!fs.existsSync(root)) continue;
  for (const f of walk(root)) {
    try {
      checkFile(f);
    } catch (err) {
      console.error("fail", f, err.message);
    }
  }
}
