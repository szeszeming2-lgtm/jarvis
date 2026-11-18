// Small DOM and data helpers shared by every module.
import { icon } from './icons.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Create an element. attrs: class, text, style, dataset, on<Event>, any attribute. Children: nodes or strings. */
export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'icon') node.prepend(iconNode(v));
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in node && typeof v !== 'string') node[k] = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function iconNode(name) {
  const tpl = document.createElement('template');
  tpl.innerHTML = icon(name);
  return tpl.content.firstElementChild;
}

/** Replace data-icon placeholders in static HTML with SVG icons. */
export function hydrateIcons(root = document) {
  for (const node of root.querySelectorAll('[data-icon]')) {
    if (node.dataset.iconDone) continue;
    node.dataset.iconDone = '1';
    node.prepend(iconNode(node.dataset.icon));
  }
}

export function uid(prefix = '') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function fmtBytes(n) {
  if (n === undefined || n === null || isNaN(n)) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1000 && i < u.length - 1) { n /= 1000; i++; }
  return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${u[i]}`;
}

export function timeAgo(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function dayGroup(ts) {
  const now = new Date();
  const d = new Date(ts);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ts >= start) return 'Today';
  if (ts >= start - 86400000) return 'Yesterday';
  if (ts >= start - 6 * 86400000) return 'This week';
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString(undefined, { month: 'long' });
  return String(d.getFullYear());
}

export class Emitter {
  constructor() { this.map = new Map(); }
  on(ev, fn) {
    if (!this.map.has(ev)) this.map.set(ev, new Set());
    this.map.get(ev).add(fn);
    return () => this.map.get(ev)?.delete(fn);
  }
  once(ev, fn) { const off = this.on(ev, (d) => { off(); fn(d); }); return off; }
  emit(ev, data) {
    for (const fn of [...(this.map.get(ev) || [])]) {
      try { fn(data); } catch (e) { console.error(`[${ev}]`, e); }
    }
  }
}

export const bus = new Emitter();

/** Deep merge plain objects (used to fill new default settings into saved ones). */
export function mergeDeep(base, extra) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = mergeDeep(base[k], v);
    } else out[k] = v;
  }
  return out;
}

export function truncate(s, n) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
}

export function greetingFor(date = new Date()) {
  const hr = date.getHours();
  if (hr < 5) return 'Working late';
  if (hr < 12) return 'Good morning';
  if (hr < 18) return 'Good afternoon';
  return 'Good evening';
}

/** Rough token estimate (good enough for trimming history). */
export const tokens = (s) => Math.ceil(String(s || '').length / 3.6);
