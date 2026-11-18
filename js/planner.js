// Planner: habits (with streaks), goals (with progress), a simple budget, and a
// stopwatch. Everything is saved only on this device.
import { read, write } from './store.js';
import { bus, uid } from './util.js';

let data = { habits: [], goals: [], money: [], budget: { monthly: 0 }, stopwatch: { start: 0, elapsed: 0, laps: [] } };
export async function load() { data = { ...data, ...(await read('planner', {})) }; return data; }
const save = () => { write('planner', data).catch(console.error); bus.emit('planner', data); };
export const all = () => data;

const pad = (n) => String(n).padStart(2, '0');
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const norm = (s) => String(s || '').toLowerCase().replace(/^(my|the|a)\s+/, '').trim();

// ---------------------------------------------------------------- habits
export function addHabit(name) {
  name = String(name || '').trim().replace(/^(?:to |a )/i, '');
  if (!name) throw new Error('What habit?');
  const have = findHabit(name);
  if (have) return have;
  const h = { id: uid('hb'), name: name.charAt(0).toUpperCase() + name.slice(1), days: {}, created: Date.now() };
  data.habits.push(h); save(); return h;
}
export const findHabit = (name) => { const q = norm(name); return data.habits.find((h) => norm(h.name) === q) || data.habits.find((h) => norm(h.name).includes(q) || q.includes(norm(h.name))); };
export function checkHabit(name, on = true, day = dayKey()) {
  const h = typeof name === 'object' ? name : findHabit(name) || addHabit(name);
  if (on) h.days[day] = true; else delete h.days[day];
  save();
  return { ...h, streak: streak(h) };
}
export function removeHabit(id) { data.habits = data.habits.filter((h) => h.id !== id); save(); }
/** Days in a row up to today (or yesterday if today isn't ticked yet). */
export function streak(h, today = new Date()) {
  const d = new Date(today);
  if (!h.days[dayKey(d)]) d.setDate(d.getDate() - 1);
  let n = 0;
  while (h.days[dayKey(d)]) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
export function last7(h, today = new Date()) {
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(today); d.setDate(d.getDate() - (6 - i)); return { day: dayKey(d), label: d.toLocaleDateString(undefined, { weekday: 'narrow' }), done: !!h.days[dayKey(d)] }; });
}

// ---------------------------------------------------------------- goals
export function addGoal({ title, target = 0, unit = '', due = '' }) {
  title = String(title || '').trim();
  if (!title) throw new Error('What’s the goal?');
  const g = { id: uid('gl'), title: title.charAt(0).toUpperCase() + title.slice(1), target: Number(target) || 0, unit: String(unit || ''), progress: 0, due, created: Date.now(), log: [] };
  data.goals.push(g); save(); return g;
}
export const findGoal = (q) => { q = norm(q); return data.goals.find((g) => norm(g.title) === q) || data.goals.find((g) => norm(g.title).includes(q) || q.includes(norm(g.title))); };
/** Add to (or set) a goal's progress. With no target, progress is a percentage. */
export function updateGoal(q, amount, { set = false } = {}) {
  const g = typeof q === 'object' ? q : findGoal(q);
  if (!g) throw new Error(`I couldn’t find the goal “${q}”.`);
  const before = g.progress;
  g.progress = Math.max(0, set ? Number(amount) : g.progress + Number(amount));
  if (!g.target) g.progress = Math.min(100, g.progress);
  g.log.push({ at: Date.now(), change: g.progress - before });
  if (goalPct(g) >= 100 && !g.doneAt) g.doneAt = Date.now();
  save();
  return { ...g, pct: goalPct(g) };
}
export const goalPct = (g) => Math.round(Math.min(100, g.target ? (g.progress / g.target) * 100 : g.progress));
export function removeGoal(id) { data.goals = data.goals.filter((g) => g.id !== id); save(); }

// ---------------------------------------------------------------- budget
const CATS = [
  ['Food', /\b(lunch|dinner|breakfast|food|groceries|grocery|coffee|restaurant|snack|pizza|meal|takeaway|takeout|cafe)\b/i],
  ['Transport', /\b(bus|train|taxi|uber|lyft|gas|petrol|fuel|parking|metro|subway|ticket|car)\b/i],
  ['Shopping', /\b(clothes|shoes|amazon|shopping|gift|book|game|toy)\b/i],
  ['Bills', /\b(rent|bill|electric|water|internet|phone|insurance|subscription|netflix|spotify)\b/i],
  ['Fun', /\b(movie|cinema|concert|bar|party|games?|fun)\b/i],
  ['Health', /\b(doctor|pharmacy|medicine|gym|dentist)\b/i],
];
export const guessCategory = (note) => (CATS.find(([, re]) => re.test(note)) || ['Other'])[0];

export function logMoney({ amount, note = '', kind = 'expense', category = '', date = Date.now() }) {
  const a = Math.abs(Number(String(amount).replace(/[^\d.,-]/g, '').replace(',', '.')));
  if (!(a > 0)) throw new Error('How much?');
  const e = { id: uid('mn'), amount: Math.round(a * 100) / 100, kind: kind === 'income' ? 'income' : 'expense', note: String(note).trim(), category: category || (kind === 'income' ? 'Income' : guessCategory(note)), date };
  data.money.push(e); save();
  return { ...e, month: monthSummary() };
}
export function removeMoney(id) { data.money = data.money.filter((m) => m.id !== id); save(); }
export function setMonthlyBudget(n) { data.budget.monthly = Math.max(0, Number(n) || 0); save(); }

/** This month's totals: {spent, income, left, byCategory:[[cat, total]], budget, over} */
export function monthSummary(now = new Date()) {
  const m = now.getMonth(), y = now.getFullYear();
  const items = data.money.filter((e) => { const d = new Date(e.date); return d.getMonth() === m && d.getFullYear() === y; });
  const spent = items.filter((e) => e.kind === 'expense').reduce((s, e) => s + e.amount, 0);
  const income = items.filter((e) => e.kind === 'income').reduce((s, e) => s + e.amount, 0);
  const by = {};
  for (const e of items.filter((x) => x.kind === 'expense')) by[e.category] = (by[e.category] || 0) + e.amount;
  const budget = data.budget.monthly || 0;
  return { spent: round(spent), income: round(income), byCategory: Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, round(v)]), budget, left: budget ? round(budget - spent) : null, over: budget ? spent > budget : false, count: items.length };
}
const round = (n) => Math.round(n * 100) / 100;
export const money = (n) => { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: currencyCode(), maximumFractionDigits: 2 }).format(n); } catch { return '$' + n.toFixed(2); } };
function currencyCode() {
  const loc = navigator.language || 'en-US';
  const region = (loc.split('-')[1] || '').toUpperCase();
  return { US: 'USD', CA: 'CAD', GB: 'GBP', AU: 'AUD', NZ: 'NZD', IN: 'INR', JP: 'JPY', CN: 'CNY', HK: 'HKD', SG: 'SGD', MY: 'MYR', KR: 'KRW', BR: 'BRL', MX: 'MXN', ZA: 'ZAR', CH: 'CHF', SE: 'SEK', NO: 'NOK', DK: 'DKK', PH: 'PHP', ID: 'IDR', TW: 'TWD', TH: 'THB', VN: 'VND' }[region] || (['DE', 'FR', 'ES', 'IT', 'NL', 'IE', 'PT', 'BE', 'AT', 'FI', 'GR'].includes(region) ? 'EUR' : 'USD');
}

// ---------------------------------------------------------------- stopwatch
export function stopwatch() { const s = data.stopwatch; return { running: !!s.start, ms: s.elapsed + (s.start ? Date.now() - s.start : 0), laps: s.laps }; }
export function startStopwatch() { const s = data.stopwatch; if (!s.start) { s.start = Date.now(); save(); } return stopwatch(); }
export function stopStopwatch() { const s = data.stopwatch; if (s.start) { s.elapsed += Date.now() - s.start; s.start = 0; save(); } return stopwatch(); }
export function lap() { const st = stopwatch(); data.stopwatch.laps.push(st.ms); save(); return stopwatch(); }
export function resetStopwatch() { data.stopwatch = { start: 0, elapsed: 0, laps: [] }; save(); return stopwatch(); }
export function fmtMs(ms) {
  const t = Math.floor(ms / 10), cs = t % 100, s = Math.floor(t / 100) % 60, m = Math.floor(t / 6000) % 60, h = Math.floor(t / 360000);
  return `${h ? h + ':' + pad(m) : m}:${pad(s)}.${pad(cs)}`;
}
export function spokenTime(ms) {
  const s = Math.round(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return [h ? `${h} hour${h === 1 ? '' : 's'}` : '', m ? `${m} minute${m === 1 ? '' : 's'}` : '', `${r} second${r === 1 ? '' : 's'}`].filter(Boolean).join(' ');
}
