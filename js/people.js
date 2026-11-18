// People you text and call, saved on this device ("Mom → +1 555 0100").
// The web version can't read your phone's contacts, so this list fills that gap.
import { read, write } from './store.js';
import { bus, uid } from './util.js';

let people = [];
export async function load() { people = await read('people', []); return people; }
const save = () => { write('people', people).catch(console.error); bus.emit('people', people); };
export const all = () => people;

const norm = (s) => String(s || '').toLowerCase().replace(/^(my|our)\s+/, '').replace(/[’']s$/, '').trim();

export function find(name) {
  const q = norm(name);
  if (!q) return null;
  return people.find((p) => norm(p.name) === q || (p.aliases || []).some((a) => norm(a) === q))
    || people.find((p) => norm(p.name).split(/\s+/)[0] === q);
}

export function upsert({ name, phone, aliases = [] }) {
  name = String(name || '').trim().replace(/^(my|our)\s+/i, '');
  phone = String(phone || '').trim();
  if (!name || !phone) throw new Error('A name and a number are needed.');
  if (!/^\+?[\d\s().-]{5,20}$/.test(phone) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(phone)) throw new Error('That number doesn’t look right.');
  const existing = find(name);
  if (existing) { existing.phone = phone; existing.aliases = [...new Set([...(existing.aliases || []), ...aliases])]; }
  else people.push({ id: uid('p'), name: name.charAt(0).toUpperCase() + name.slice(1), phone, aliases });
  save();
  return find(name);
}

export function remove(id) { people = people.filter((p) => p.id !== id); save(); }
