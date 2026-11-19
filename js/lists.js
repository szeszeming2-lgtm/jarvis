// Lists: shopping, to-do, notes, or any list the user names. Stored on this device.
import { read, write, tombstone } from './store.js';
import { bus, uid } from './util.js';

let lists = {};   // name -> [{id, text, done, added}]

export async function load() { lists = await read('lists', null) || { shopping: [], 'to-do': [], notes: [] }; return lists; }
const save = () => { write('lists', lists).catch(console.error); bus.emit('lists', lists); };

const ALIASES = { grocery: 'shopping', groceries: 'shopping', 'grocery list': 'shopping', shop: 'shopping', todo: 'to-do', 'to do': 'to-do', tasks: 'to-do', task: 'to-do', 'things to do': 'to-do', note: 'notes' };
export function normName(name) {
  let n = String(name || '').toLowerCase().replace(/\blist\b/g, '').replace(/^(my|the|our)\s+/, '').replace(/[^\p{L}\p{N}\s-]/gu, '').trim();
  return ALIASES[n] || n || 'to-do';
}

export const names = () => Object.keys(lists);
export const items = (name) => lists[normName(name)] || [];
export const open = (name) => items(name).filter((i) => !i.done);
export const all = () => lists;

/** Split "eggs, milk and bread" into ["eggs", "milk", "bread"]. */
export function splitItems(text) {
  return String(text || '').split(/\s*(?:,|;|\band\b|\n|&)\s*/i).map((s) => s.trim().replace(/^(some|a|an|the)\s+/i, '').replace(/[.!?]+$/, '')).filter((s) => s.length > 0 && s.length < 120);
}

export function add(name, newItems) {
  const key = normName(name);
  lists[key] ||= [];
  const added = [];
  for (const raw of newItems) {
    const text = raw.trim();
    if (!text) continue;
    const existing = lists[key].find((i) => i.text.toLowerCase() === text.toLowerCase());
    if (existing) { existing.done = false; continue; }
    lists[key].push({ id: uid('i'), text, done: false, added: Date.now() });
    added.push(text);
  }
  save();
  return { list: key, added, count: open(key).length };
}

/** Tick off items that match (by words). Returns the ones removed. */
export function remove(name, which) {
  const key = normName(name);
  const done = [];
  for (const w of which) {
    const q = w.toLowerCase().trim();
    const hit = (lists[key] || []).find((i) => !i.done && (i.text.toLowerCase() === q || i.text.toLowerCase().includes(q) || q.includes(i.text.toLowerCase())));
    if (hit) { hit.done = true; hit.updated = Date.now(); done.push(hit.text); }
  }
  save();
  return { list: key, removed: done, count: open(key).length };
}

export function toggle(name, id) { const it = items(name).find((i) => i.id === id); if (it) { it.done = !it.done; it.updated = Date.now(); save(); } }
const gone = (key, items) => tombstone(...items.map((i) => `list:${key}:${i.text.trim()}`));
export function del(name, id) { const key = normName(name); gone(key, (lists[key] || []).filter((i) => i.id === id)); lists[key] = (lists[key] || []).filter((i) => i.id !== id); save(); }
export function clear(name, { onlyDone = false } = {}) { const key = normName(name); gone(key, (lists[key] || []).filter((i) => !onlyDone || i.done)); lists[key] = onlyDone ? (lists[key] || []).filter((i) => !i.done) : []; save(); return { list: key }; }
export function create(name) { const key = normName(name); lists[key] ||= []; save(); return key; }
export function dropList(name) { const key = normName(name); gone(key, lists[key] || []); delete lists[key]; save(); }

export function asText(name) {
  const key = normName(name);
  const list = open(key);
  return list.length ? `${title(key)}:\n${list.map((i) => '• ' + i.text).join('\n')}` : `Your ${key} list is empty.`;
}
export const title = (key) => key.charAt(0).toUpperCase() + key.slice(1);
