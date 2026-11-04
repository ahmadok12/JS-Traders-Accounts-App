/**
 * Calculator formulas — a tiny, safe expression language (no eval).
 *   numbers 430, 0.5 · variables L N ROOM … · strings 'Centre'
 *   + - * / ( ) · comparisons == != < <= > >= · && || ! · cond ? a : b
 *   functions ceil floor round min max abs
 * Examples: "ceil(L/8)*N"  "ROOM=='Centre' ? N : 0"  "L*N+50"
 */
export type Value = number | string | boolean;
export type Vars = Record<string, Value>;

export interface CalcVariable {
  key: string; label: string;
  /** input variables */ type?: "number" | "choice"; default?: number | string; options?: string[]; step?: number; hint?: string;
  /** derived variables (shown, not typed) */ formula?: string;
  /** short name and unit for summaries: "Length 430 ft" */ short?: string; unit?: string;
}

/** "Length 430 ft · Width 50 ft · Lines 4 · Feed room Centre" from a package's saved inputs */
export function describeInputs(defs: CalcVariable[] | null | undefined, inputs: Record<string, unknown> | null | undefined): string {
  const inp = inputs ?? {};
  const known = (defs ?? []).filter((d) => !d.formula && d.key in inp)
    .map((d) => `${d.short ?? d.label.replace(/\s*\(.*\)\s*$/, "")} ${String(inp[d.key])}${d.unit ? ` ${d.unit}` : ""}`);
  const rest = Object.keys(inp).filter((k) => !(defs ?? []).some((d) => d.key === k)).map((k) => `${k} ${String(inp[k])}`);
  return [...known, ...rest].join(" · ");
}

type Tok = { t: "num"; v: number } | { t: "str"; v: string } | { t: "id"; v: string } | { t: "op"; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i; while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const v = Number(src.slice(i, j));
      if (!Number.isFinite(v)) throw new Error(`Bad number "${src.slice(i, j)}"`);
      out.push({ t: "num", v }); i = j; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i; while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      out.push({ t: "id", v: src.slice(i, j) }); i = j; continue;
    }
    if (c === "'" || c === '"') {
      const j = src.indexOf(c, i + 1);
      if (j < 0) throw new Error("Text is missing its closing quote");
      out.push({ t: "str", v: src.slice(i + 1, j) }); i = j + 1; continue;
    }
    const two = src.slice(i, i + 2);
    if (["==", "!=", "<=", ">=", "&&", "||"].includes(two)) { out.push({ t: "op", v: two }); i += 2; continue; }
    if ("+-*/()?:<>!,".includes(c)) { out.push({ t: "op", v: c }); i++; continue; }
    throw new Error(`Unexpected "${c}"`);
  }
  return out;
}

const FUNCS: Record<string, (...a: number[]) => number> = {
  ceil: (x) => Math.ceil(x - 1e-9), floor: (x) => Math.floor(x + 1e-9), round: (x) => Math.round(x),
  min: (...a) => Math.min(...a), max: (...a) => Math.max(...a), abs: (x) => Math.abs(x),
};

const num = (v: Value): number => (typeof v === "number" ? v : typeof v === "boolean" ? (v ? 1 : 0) : Number(v));
const truthy = (v: Value) => (typeof v === "string" ? v !== "" : num(v) !== 0);

/** Evaluate a formula with the given variables. Throws a readable Error on a bad formula / unknown name. */
export function evaluate(src: string, vars: Vars): Value {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.t === "op" && peek()!.v === v;
  const expect = (v: string) => { if (!isOp(v)) throw new Error(`Expected "${v}"`); p++; };

  const ternary = (): Value => {
    const c = or();
    if (isOp("?")) { p++; const a = ternary(); expect(":"); const b = ternary(); return truthy(c) ? a : b; }
    return c;
  };
  const or = (): Value => { let l = and(); while (isOp("||")) { p++; const r = and(); l = truthy(l) || truthy(r); } return l; };
  const and = (): Value => { let l = cmp(); while (isOp("&&")) { p++; const r = cmp(); l = truthy(l) && truthy(r); } return l; };
  const cmp = (): Value => {
    let l = add();
    while (peek()?.t === "op" && ["==", "!=", "<", "<=", ">", ">="].includes(String(peek()!.v))) {
      const op = String(toks[p++].v); const r = add();
      const s = typeof l === "string" || typeof r === "string";
      const a = s ? String(l).toLowerCase() : num(l), b = s ? String(r).toLowerCase() : num(r);
      l = op === "==" ? a === b : op === "!=" ? a !== b : op === "<" ? a < b : op === "<=" ? a <= b : op === ">" ? a > b : a >= b;
    }
    return l;
  };
  const add = (): Value => {
    let l = mul();
    while (isOp("+") || isOp("-")) { const op = String(toks[p++].v); const r = mul(); l = op === "+" ? num(l) + num(r) : num(l) - num(r); }
    return l;
  };
  const mul = (): Value => {
    let l = unary();
    while (isOp("*") || isOp("/")) {
      const op = String(toks[p++].v); const r = unary();
      if (op === "/" && num(r) === 0) throw new Error("Division by zero");
      l = op === "*" ? num(l) * num(r) : num(l) / num(r);
    }
    return l;
  };
  const unary = (): Value => {
    if (isOp("-")) { p++; return -num(unary()); }
    if (isOp("+")) { p++; return num(unary()); }
    if (isOp("!")) { p++; return !truthy(unary()); }
    return atom();
  };
  const atom = (): Value => {
    const t = toks[p++];
    if (!t) throw new Error("Formula ends too early");
    if (t.t === "num" || t.t === "str") return t.v;
    if (t.t === "op" && t.v === "(") { const v = ternary(); expect(")"); return v; }
    if (t.t === "id") {
      if (isOp("(")) {
        const f = FUNCS[t.v.toLowerCase()];
        if (!f) throw new Error(`Unknown function "${t.v}"`);
        p++;
        const args: number[] = [];
        if (!isOp(")")) { args.push(num(ternary())); while (isOp(",")) { p++; args.push(num(ternary())); } }
        expect(")");
        return f(...args);
      }
      if (t.v === "true") return true;
      if (t.v === "false") return false;
      if (!(t.v in vars)) throw new Error(`Unknown name "${t.v}"`);
      return vars[t.v];
    }
    throw new Error(`Unexpected "${t.v}"`);
  };

  const v = ternary();
  if (p < toks.length) throw new Error(`Unexpected "${(toks[p] as { v: unknown }).v}"`);
  return v;
}

/** A quantity from a formula: a number ≥ 0, rounded to 4 decimals (whole-unit items are rounded up by the caller's rules). */
export function evalQty(src: string, vars: Vars): number {
  const v = num(evaluate(src, vars));
  if (!Number.isFinite(v)) throw new Error("Not a number");
  return Math.max(0, Math.round(v * 10000) / 10000);
}

/** Input values (typed) + derived variables, in the order the template lists them. */
export function resolveVars(defs: CalcVariable[], inputs: Record<string, string | number>): { vars: Vars; errors: Record<string, string> } {
  const vars: Vars = {};
  const errors: Record<string, string> = {};
  for (const d of defs) {
    try {
      if (d.formula) vars[d.key] = evaluate(d.formula, vars);
      else if (d.type === "choice") vars[d.key] = String(inputs[d.key] ?? d.default ?? d.options?.[0] ?? "");
      else {
        const raw = inputs[d.key] ?? d.default ?? "";
        const v = typeof raw === "number" ? raw : Number(String(raw).replace(/,/g, ""));
        if (String(raw).trim() === "" || !Number.isFinite(v) || v < 0) { errors[d.key] = "Enter a number"; vars[d.key] = 0; }
        else vars[d.key] = v;
      }
    } catch (e) { errors[d.key] = (e as Error).message; vars[d.key] = 0; }
  }
  return { vars, errors };
}
