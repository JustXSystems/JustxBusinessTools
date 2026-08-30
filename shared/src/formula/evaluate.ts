/**
 * Safe arithmetic formula DSL for computed tracker fields.
 * Supports: numbers, field refs, + - * / %, parentheses, abs/min/max/round.
 * No JS eval.
 */

export type FormulaResult =
  | { ok: true; value: number }
  | { ok: false; error: string };

type Token =
  | { kind: "num"; value: number }
  | { kind: "id"; value: string }
  | { kind: "op"; value: string };

function tokenize(src: string): Token[] | { error: string } {
  const tokens: Token[] = [];
  let i = 0;
  const s = src.trim();
  if (!s) return { error: "Formula is empty" };

  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j += 1;
      const raw = s.slice(i, j);
      const n = Number(raw);
      if (!Number.isFinite(n)) return { error: `Invalid number "${raw}"` };
      tokens.push({ kind: "num", value: n });
      i = j;
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let j = i;
      while (j < s.length && /[a-zA-Z0-9_]/.test(s[j])) j += 1;
      tokens.push({ kind: "id", value: s.slice(i, j) });
      i = j;
      continue;
    }
    if ("+-*/%(),".includes(ch)) {
      tokens.push({ kind: "op", value: ch });
      i += 1;
      continue;
    }
    return { error: `Unexpected character "${ch}"` };
  }
  return tokens;
}

const FUNCS = new Set(["abs", "min", "max", "round"]);

class Parser {
  private i = 0;
  constructor(
    private tokens: Token[],
    private vars: Record<string, number>,
  ) {}

  private peek(): Token | undefined {
    return this.tokens[this.i];
  }

  private take(): Token {
    const t = this.tokens[this.i];
    if (!t) throw new Error("Unexpected end of formula");
    this.i += 1;
    return t;
  }

  private expectOp(op: string) {
    const t = this.take();
    if (t.kind !== "op" || t.value !== op) throw new Error(`Expected "${op}"`);
  }

  parse(): number {
    const v = this.expr();
    if (this.i < this.tokens.length) throw new Error("Unexpected trailing tokens");
    return v;
  }

  private expr(): number {
    let v = this.term();
    while (this.peek()?.kind === "op" && (this.peek()!.value === "+" || this.peek()!.value === "-")) {
      const op = this.take().value;
      const r = this.term();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }

  private term(): number {
    let v = this.unary();
    while (
      this.peek()?.kind === "op" &&
      (this.peek()!.value === "*" || this.peek()!.value === "/" || this.peek()!.value === "%")
    ) {
      const op = this.take().value;
      const r = this.unary();
      if (op === "*") v *= r;
      else if (op === "/") {
        if (r === 0) throw new Error("Division by zero");
        v /= r;
      } else {
        if (r === 0) throw new Error("Modulo by zero");
        v %= r;
      }
    }
    return v;
  }

  private unary(): number {
    if (this.peek()?.kind === "op" && this.peek()!.value === "-") {
      this.take();
      return -this.unary();
    }
    if (this.peek()?.kind === "op" && this.peek()!.value === "+") {
      this.take();
      return this.unary();
    }
    return this.primary();
  }

  private primary(): number {
    const t = this.peek();
    if (!t) throw new Error("Unexpected end of formula");

    if (t.kind === "num") {
      this.take();
      return t.value;
    }

    if (t.kind === "id") {
      this.take();
      if (FUNCS.has(t.value) && this.peek()?.kind === "op" && this.peek()!.value === "(") {
        return this.call(t.value);
      }
      if (!(t.value in this.vars)) throw new Error(`Unknown field "${t.value}"`);
      const n = this.vars[t.value];
      if (!Number.isFinite(n)) throw new Error(`Field "${t.value}" is not a number`);
      return n;
    }

    if (t.kind === "op" && t.value === "(") {
      this.take();
      const v = this.expr();
      this.expectOp(")");
      return v;
    }

    throw new Error("Invalid expression");
  }

  private call(name: string): number {
    this.expectOp("(");
    const args: number[] = [];
    if (!(this.peek()?.kind === "op" && this.peek()!.value === ")")) {
      args.push(this.expr());
      while (this.peek()?.kind === "op" && this.peek()!.value === ",") {
        this.take();
        args.push(this.expr());
      }
    }
    this.expectOp(")");

    if (name === "abs") {
      if (args.length !== 1) throw new Error("abs() takes 1 argument");
      return Math.abs(args[0]);
    }
    if (name === "min") {
      if (args.length < 1) throw new Error("min() needs arguments");
      return Math.min(...args);
    }
    if (name === "max") {
      if (args.length < 1) throw new Error("max() needs arguments");
      return Math.max(...args);
    }
    if (name === "round") {
      if (args.length === 1) return Math.round(args[0]);
      if (args.length === 2) {
        const p = Math.max(0, Math.min(8, Math.floor(args[1])));
        const f = 10 ** p;
        return Math.round(args[0] * f) / f;
      }
      throw new Error("round() takes 1 or 2 arguments");
    }
    throw new Error(`Unknown function "${name}"`);
  }
}

/** Collect identifier refs used as variables (not function names). */
export function formulaRefs(expression: string): string[] | { error: string } {
  const tokens = tokenize(expression);
  if ("error" in tokens) return tokens;
  const refs: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind !== "id") continue;
    const next = tokens[i + 1];
    if (FUNCS.has(t.value) && next?.kind === "op" && next.value === "(") continue;
    refs.push(t.value);
  }
  return [...new Set(refs)];
}

export function validateFormula(expression: string, allowedKeys: string[]): string | null {
  const refs = formulaRefs(expression);
  if ("error" in refs) return refs.error;
  const allowed = new Set(allowedKeys);
  for (const r of refs) {
    if (!allowed.has(r)) return `Unknown field "${r}"`;
  }
  const sample: Record<string, number> = {};
  for (const k of refs) sample[k] = 1;
  const result = evaluateFormula(expression, sample);
  return result.ok ? null : result.error;
}

export function evaluateFormula(
  expression: string,
  vars: Record<string, number>,
): FormulaResult {
  const tokens = tokenize(expression);
  if ("error" in tokens) return { ok: false, error: tokens.error };
  try {
    const value = new Parser(tokens, vars).parse();
    if (!Number.isFinite(value)) return { ok: false, error: "Result is not a finite number" };
    return { ok: true, value };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Formula failed" };
  }
}
