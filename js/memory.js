// Long-term memory: short facts the user controls. Stored locally, never shared.
import { read, write } from './store.js';
import { bus, uid } from './util.js';

let items = [];
let loaded = false;

export async function load() {
  items = await read('memory', []);
  loaded = true;
  return items;
}

const save = () => { write('memory', items).catch(console.error); bus.emit('memory', items); };

export const all = () => items;

export async function add(text, source = 'you') {
  if (!loaded) await load();
  text = String(text || '').trim().replace(/\s+/g, ' ');
  if (!text) throw new Error('Nothing to remember.');
  if (text.length > 400) text = text.slice(0, 400);
  const dup = items.find((m) => m.text.toLowerCase() === text.toLowerCase());
  if (dup) return dup;
  const m = { id: uid('m'), text, source, created: Date.now(), pinned: false, enabled: true };
  items.unshift(m);
  save();
  return m;
}

export async function update(id, patch) {
  const m = items.find((x) => x.id === id);
  if (m) { Object.assign(m, patch, { updated: Date.now() }); save(); }
  return m;
}

export async function remove(id) { items = items.filter((m) => m.id !== id); save(); }
export async function clear() { items = []; save(); }
export async function replaceAll(list) { items = list; save(); }

const STOP = new Set('a an the and or but of to in on at for with my me i is are was be it that this you your what who how do does did can could would should will about from'.split(' '));
const words = (s) => String(s).toLowerCase().match(/[\p{L}\p{N}']+/gu)?.filter((w) => w.length > 2 && !STOP.has(w)) || [];

export function search(q) {
  const qs = words(q);
  if (!qs.length) return [];
  return items.filter((m) => { const t = m.text.toLowerCase(); return qs.some((w) => t.includes(w)); });
}

/** Memories to include in the prompt: pinned first, then the most relevant, then recent. */
export function forPrompt(query, max = 14) {
  const on = items.filter((m) => m.enabled !== false);
  if (on.length <= max) return on;
  const qs = new Set(words(query));
  const scored = on.map((m) => {
    const ws = words(m.text);
    const hit = ws.filter((w) => qs.has(w)).length;
    return { m, score: (m.pinned ? 100 : 0) + hit * 10 + (m.created / 1e13) };
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, max).map((x) => x.m);
}
