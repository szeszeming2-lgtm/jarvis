// Safe calculator (no eval). Supports + - * / ^ %, parentheses, implicit
// multiplication, functions, constants, "15% of 80", "x times y", "square root of".

const FUNCS = {
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil,
  sin: (x) => Math.sin(x), cos: (x) => Math.cos(x), tan: (x) => Math.tan(x),
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  log: Math.log10, log10: Math.log10, log2: Math.log2, ln: Math.log, exp: Math.exp,
  fact: (n) => { if (n < 0 || n > 170 || n % 1) return NaN; let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; },
};
const CONSTS = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };

/** Turn everyday phrasing into an expression. */
export function normalize(text) {
  let s = ' ' + String(text).toLowerCase() + ' ';
  s = s.replace(/,(?=\d{3}\b)/g, '');
  s = s.replace(/[×✕]/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
  s = s.replace(/\b(what is|what's|whats|calculate|compute|evaluate|how much is|solve|equals?|please|the value of)\b/g, ' ');
  s = s.replace(/(\d+(?:\.\d+)?)\s*(?:%|percent)\s*of\s*/g, '($1/100)*');
  s = s.replace(/\bsquare root of\b/g, ' sqrt ').replace(/\bcube root of\b/g, ' cbrt ');
  s = s.replace(/\b(\d+(?:\.\d+)?)\s+squared\b/g, '($1)^2').replace(/\b(\d+(?:\.\d+)?)\s+cubed\b/g, '($1)^3');
  s = s.replace(/\bto the power of\b|\braised to\b|\bpower\b/g, '^');
  s = s.replace(/\b(times|multiplied by|x)\b/g, '*').replace(/\b(divided by|over)\b/g, '/');
  s = s.replace(/\b(plus|added to)\b/g, '+').replace(/\b(minus|less)\b/g, '-');
  s = s.replace(/\bmod(ulo)?\b/g, '%');
  s = s.replace(/(\d)\s*!/g, 'fact($1)');
  s = s.replace(/[?=]/g, ' ');
  return s.trim();
}

function tokenize(s) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    const num = s.slice(i).match(/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i);
    if (num) { out.push({ t: 'n', v: parseFloat(num[0]) }); i += num[0].length; continue; }
    const id = s.slice(i).match(/^[a-z]+\d*/i);
    if (id) { out.push({ t: 'id', v: id[0].toLowerCase() }); i += id[0].length; continue; }
    if ('+-*/^%(),'.includes(c)) { out.push({ t: c }); i++; continue; }
    throw new Error(`I don't understand "${c}"`);
  }
  // implicit multiplication: 2(3), 2pi, )(, )2
  const res = [];
  for (let k = 0; k < out.length; k++) {
    const a = out[k - 1], b = out[k];
    if (a && ((a.t === 'n' || a.t === ')' || (a.t === 'id' && CONSTS[a.v] !== undefined)) && (b.t === '(' || b.t === 'n' || b.t === 'id'))) {
      if (!(a.t === 'n' && b.t === 'n')) res.push({ t: '*' });
    }
    res.push(b);
  }
  return res;
}

export function evaluate(expr) {
  const toks = tokenize(expr);
  let p = 0;
  const peek = () => toks[p];
  const eat = (t) => { if (peek()?.t !== t) throw new Error('Check the brackets'); p++; };
  function primary() {
    const tk = toks[p++];
    if (!tk) throw new Error('The expression ends too soon');
    if (tk.t === 'n') return tk.v;
    if (tk.t === '(') { const v = sum(); eat(')'); return v; }
    if (tk.t === '-') return -power();
    if (tk.t === '+') return power();
    if (tk.t === 'id') {
      if (CONSTS[tk.v] !== undefined) return CONSTS[tk.v];
      const fn = FUNCS[tk.v];
      if (!fn) throw new Error(`Unknown word "${tk.v}"`);
      if (peek()?.t === '(') { p++; const args = [sum()]; while (peek()?.t === ',') { p++; args.push(sum()); } eat(')'); return fn(...args); }
      return fn(power());
    }
    throw new Error('Something is out of place');
  }
  function power() {
    const base = primary();
    if (peek()?.t === '^') { p++; return Math.pow(base, unary()); }
    return base;
  }
  function unary() {
    if (peek()?.t === '-') { p++; return -unary(); }
    if (peek()?.t === '+') { p++; return unary(); }
    return power();
  }
  function product() {
    let v = unary();
    while (['*', '/', '%'].includes(peek()?.t)) {
      const op = toks[p++].t;
      const r = unary();
      v = op === '*' ? v * r : op === '/' ? v / r : v % r;
    }
    return v;
  }
  function sum() {
    let v = product();
    while (['+', '-'].includes(peek()?.t)) {
      const op = toks[p++].t;
      const r = product();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  const v = sum();
  if (p < toks.length) throw new Error('Something is out of place');
  if (!isFinite(v)) throw new Error(Number.isNaN(v) ? 'That has no answer' : 'The answer is infinite');
  return v;
}

export function format(v) {
  if (Number.isInteger(v)) return v.toLocaleString('en-US');
  const r = Math.round(v * 1e10) / 1e10;
  return Math.abs(r) >= 1e15 || (Math.abs(r) < 1e-6 && r !== 0) ? r.toExponential(6) : r.toLocaleString('en-US', { maximumFractionDigits: 10 });
}

/** Returns {expression, value, text} or throws. */
export function calculate(input) {
  const expr = normalize(input);
  const value = evaluate(expr);
  return { expression: expr, value, text: format(value) };
}

/** Is this message basically just arithmetic? */
export function looksLikeMath(text) {
  const t = String(text).trim().toLowerCase();
  if (t.length > 80) return false;
  const s = normalize(t);
  if (!/\d/.test(s)) return false;
  if (!/[+\-*/^%]|sqrt|cbrt|fact|sin|cos|tan|log|ln/.test(s)) return false;
  return /^[\d\s.+\-*/^%(),a-z]*$/.test(s) && !/[a-z]{2,}/.test(s.replace(/sqrt|cbrt|fact|sin|cos|tan|asin|acos|atan|log10|log2|log|ln|exp|abs|round|floor|ceil|pi|tau|e\b/g, ''));
}
