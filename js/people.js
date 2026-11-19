// People you text and call, saved on this device ("Mom → +1 555 0100").
// The web version can't read your phone's contacts, so this list fills that gap.
import { read, write, tombstone } from './store.js';
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

export const HANDLES = ['discord', 'telegram', 'skype', 'teams', 'messenger', 'whatsapp'];

/** Add or update someone. phone is optional when an app handle is given. */
export function upsert({ name, phone = '', aliases = [], allowEmpty = false, ...handles }) {
  name = String(name || '').trim().replace(/^(my|our)\s+/i, '');
  phone = String(phone || '').trim();
  const extra = Object.fromEntries(Object.entries(handles).filter(([k, v]) => HANDLES.includes(k) && String(v || '').trim()).map(([k, v]) => [k, String(v).trim()]));
  if (!name) throw new Error('A name is needed.');
  if (!allowEmpty && !phone && !Object.keys(extra).length && !find(name)) throw new Error('A number (or an app username) is needed.');
  if (phone && !/^\+?[\d\s().-]{5,20}$/.test(phone) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(phone)) throw new Error('That number doesn’t look right.');
  const existing = find(name);
  if (existing) {
    if (phone) existing.phone = phone;
    Object.assign(existing, extra);
    existing.updated = Date.now();
    existing.aliases = [...new Set([...(existing.aliases || []), ...aliases])];
  } else people.push({ id: uid('p'), name: name.charAt(0).toUpperCase() + name.slice(1), phone, aliases, created: Date.now(), ...extra });
  save();
  return find(name);
}

export function remove(id) { const p = people.find((x) => x.id === id); if (p) tombstone('person:' + p.name.trim()); people = people.filter((x) => x.id !== id); save(); }
