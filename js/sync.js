// Link devices: make your phone and computer have the same JARVIS (lists, people,
// reminders, plugins, memory, workouts, chats and your settings) without any
// account or server. One device packs everything into a file locked with a code;
// you AirDrop (or send) the file to the other device and type the code there.
// Nothing is uploaded anywhere. Merging only adds and updates; it never deletes.
import { read, write, settings, saveSettingsNow } from './store.js';

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // no 0/O, 1/I/L
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** "K7QM-3XRP-W9TD": 12 characters, about 59 bits. */
export function newCode() {
  const r = crypto.getRandomValues(new Uint8Array(12));
  const c = [...r].map((x) => ALPHABET[x % ALPHABET.length]).join('');
  return `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8)}`;
}
export const normCode = (c) => String(c || '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');

async function keyFrom(code, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(normCode(code)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function gzip(u8, on) {
  if (!on || typeof CompressionStream === 'undefined') return u8;
  return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
}
async function gunzip(u8) { return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()); }

/** Lock data with a code. Returns the file text. */
export async function seal(data, code, from = '') {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const zipped = typeof CompressionStream !== 'undefined';
  const plain = await gzip(enc.encode(JSON.stringify(data)), zipped);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFrom(code, salt), plain));
  return JSON.stringify({ jarvisLink: 1, from, at: Date.now(), gz: zipped, salt: b64(salt), iv: b64(iv), data: b64(ct) });
}

/** Unlock a file with its code. */
export async function open(text, code) {
  let f;
  try { f = JSON.parse(text); } catch { throw new Error('That isn’t a JARVIS link file.'); }
  if (!f?.jarvisLink || !f.data) throw new Error('That isn’t a JARVIS link file.');
  let plain;
  try { plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(f.iv) }, await keyFrom(code, unb64(f.salt)), unb64(f.data))); }
  catch { throw new Error('That code doesn’t match this file. Check the code on the other device.'); }
  if (f.gz) plain = await gunzip(plain);
  return { from: f.from || 'your other device', at: f.at, data: JSON.parse(dec.decode(plain)) };
}

// Settings that describe *you* travel; device things (AI engine, voice, keys, permissions) stay put.
const SHARED = ['assistantName', 'userName', 'honorific', 'personality', 'replyLanguage', 'aboutYou', 'customInstructions', 'profile', 'weather', 'briefing', 'reminders', 'skills', 'memory', 'appearance', 'theme', 'accent', 'instantCommands'];
const pick = (s) => Object.fromEntries(SHARED.filter((k) => s[k] !== undefined).map((k) => [k, structuredClone(s[k])]));

/** Everything worth syncing from this device. Chats: the newest `chats` conversations. */
export async function collect({ chats = 40 } = {}) {
  const index = await read('sessions', []);
  const keep = [...index].sort((a, b) => (b.updated || 0) - (a.updated || 0)).slice(0, chats);
  const sessions = [];
  for (const e of keep) {
    const s = await read('session-' + e.id, null);
    if (s) sessions.push({ ...s, messages: s.messages.map(({ images, ...m }) => m) }); // pictures stay on the device they were taken on
  }
  return {
    v: 1,
    settings: pick(settings),
    memory: await read('memory', []), skills: await read('skills', []), lists: await read('lists', {}), people: await read('people', []),
    reminders: await read('reminders', []), workouts: await read('workouts', []),
    projects: await read('projects', []), planner: await read('planner', {}),
    sessionIndex: keep, sessions,
  };
}

const when = (x) => x?.updated || x?.ts || x?.created || x?.added || 0;
/** Union of two arrays by a key; the newer copy wins a tie. */
export function mergeBy(local = [], incoming = [], keyOf = (x) => x.id, combine = (a, b) => (when(b) > when(a) ? b : a)) {
  const out = new Map();
  for (const x of local) if (x) out.set(keyOf(x), x);
  let added = 0;
  for (const y of incoming) {
    if (!y) continue;
    const k = keyOf(y);
    if (!out.has(k)) { out.set(k, y); added++; } else out.set(k, combine(out.get(k), y));
  }
  return { list: [...out.values()], added };
}

const low = (s) => String(s || '').toLowerCase().trim();

/** Merge an incoming bundle into this device's data (pure: returns the new data + counts). */
export function merge(local, incoming) {
  const counts = {};
  const m = (name, a, b, key, combine) => { const r = mergeBy(a, b, key, combine); counts[name] = r.added; return r.list; };
  const out = {};
  out.memory = m('memories', local.memory, incoming.memory, (x) => low(x.text));
  out.skills = m('plugins', local.skills, incoming.skills, (x) => low(x.command), (a) => a);
  out.people = m('people', local.people, incoming.people, (x) => low(x.name), (a, b) => ({ ...b, ...Object.fromEntries(Object.entries(a).filter(([, v]) => v !== '' && v != null)), id: a.id }));
  out.reminders = m('reminders', local.reminders, incoming.reminders, (x) => x.id, (a, b) => ({ ...a, done: a.done || b.done }));
  out.workouts = m('workouts', local.workouts, incoming.workouts, (x) => x.id);
  out.projects = m('projects', local.projects, incoming.projects, (x) => x.id);
  // Planner: habits joined by name (ticked days from both), goals and money entries by id.
  const lp = local.planner || {}, ip = incoming.planner || {};
  out.planner = {
    ...lp,
    habits: m('habits', lp.habits, ip.habits, (x) => low(x.name), (a, b) => ({ ...a, days: { ...(b.days || {}), ...(a.days || {}) } })),
    goals: m('goals', lp.goals, ip.goals, (x) => x.id),
    money: m('money entries', lp.money, ip.money, (x) => x.id),
    budget: lp.budget?.monthly ? lp.budget : ip.budget || lp.budget || { monthly: 0 },
    stopwatch: lp.stopwatch || { start: 0, elapsed: 0, laps: [] },
  };
  out.lists = { ...(local.lists || {}) };
  counts['list items'] = 0;
  for (const [name, items] of Object.entries(incoming.lists || {})) {
    const r = mergeBy(out.lists[name] || [], items, (x) => low(x.text), (a, b) => ({ ...a, done: a.done || b.done }));
    out.lists[name] = r.list; counts['list items'] += r.added;
  }
  const idx = mergeBy(local.sessionIndex || [], incoming.sessionIndex || [], (x) => x.id);
  out.sessionIndex = idx.list.sort((a, b) => (b.updated || 0) - (a.updated || 0));
  counts.chats = idx.added;
  const newer = new Set((incoming.sessionIndex || []).filter((e) => { const l = (local.sessionIndex || []).find((x) => x.id === e.id); return !l || (e.updated || 0) > (l.updated || 0); }).map((e) => e.id));
  out.sessions = (incoming.sessions || []).filter((s) => newer.has(s.id));
  // Settings: the incoming device's "about you" settings, but never empty values over filled ones.
  out.settings = {};
  for (const [k, v] of Object.entries(incoming.settings || {})) {
    if (v === '' || v == null) continue;
    out.settings[k] = v && typeof v === 'object' && !Array.isArray(v) ? { ...(local.settings?.[k] || {}), ...Object.fromEntries(Object.entries(v).filter(([, x]) => x !== '' && x != null)) } : v;
  }
  if (out.settings.briefing) out.settings.briefing.last = local.settings?.briefing?.last || '';
  return { data: out, counts };
}

/** Apply an incoming bundle to this device. Returns the counts of what was added. */
export async function apply(incoming) {
  const local = await collect({ chats: 100000 });
  local.lists = await read('lists', {});
  const { data, counts } = merge(local, incoming);
  // Past reminders from the other device were already announced there.
  const now = Date.now();
  for (const r of data.reminders) if (!r.done && r.due < now - 60000 && !local.reminders.some((x) => x.id === r.id)) r.done = true;
  await write('memory', data.memory); await write('skills', data.skills); await write('people', data.people);
  await write('reminders', data.reminders); await write('workouts', data.workouts); await write('lists', data.lists);
  await write('projects', data.projects); await write('planner', data.planner);
  for (const s of data.sessions) await write('session-' + s.id, s);
  await write('sessions', data.sessionIndex);
  Object.assign(settings, data.settings);
  settings.setupDone = true;
  await saveSettingsNow();
  return counts;
}

/** Short sentence: "Added 3 people, 12 list items and 2 plugins." */
export function describe(counts) {
  const parts = Object.entries(counts).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${n === 1 ? k.replace(/ies$/, 'y').replace(/s$/, '').replace(/^people$/, 'person') : k}`);
  return parts.length ? `Added ${parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts.at(-1) : parts[0]}. Your settings now match too.` : 'Everything was already the same. Your settings now match too.';
}
