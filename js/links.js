// Saved links (read later): paste or say a link and JARVIS keeps it, with its page title
// when it can read it (the Mac app reads pages itself; browsers can't read other sites).
import { read, write, tombstone } from './store.js';
import { bus, uid } from './util.js';
import { call, can } from './host.js';

let links = [];
export async function load() { links = await read('links', []); return links; }
const save = () => { write('links', links).catch(console.error); bus.emit('links', links); };
export const all = () => links;

/** The first web link in some text ("example.com/page" counts too). */
export function findUrl(text) {
  const t = String(text || '');
  const m = t.match(/https?:\/\/[^\s<>"'”)]+/i) || t.match(/\b(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|edu|gov|io|co|ai|app|dev|uk|ca|au|de|fr|jp|me|tv|ly|gg|info|news|blog|shop)(?:\/[^\s<>"'”)]*)?/i);
  if (!m) return '';
  let u = m[0].replace(/[.,;:!?]+$/, '');
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; }
}
export const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

export function add(url, { note = '', title = '' } = {}) {
  const u = findUrl(url);
  if (!u) throw new Error('That doesn’t look like a web link.');
  const have = links.find((l) => l.url === u);
  if (have) { if (note) have.note = note; have.read = false; save(); return { ...have, existed: true }; }
  const l = { id: uid('lk'), url: u, title: title || hostOf(u), note: String(note).slice(0, 500), added: Date.now(), read: false };
  links.unshift(l);
  save();
  fetchTitle(l);
  return l;
}

/** Mac app: read the page title in the background. */
async function fetchTitle(l) {
  if (!can('webFetch')) return;
  try {
    const r = await call('web.get', { url: l.url });
    const doc = new DOMParser().parseFromString(String(r.text || '').slice(0, 300000), 'text/html');
    const t = (doc.querySelector('meta[property="og:title"]')?.content || doc.title || '').trim();
    const d = (doc.querySelector('meta[name="description"], meta[property="og:description"]')?.content || '').trim();
    if (t) l.title = t.slice(0, 200);
    if (d) l.desc = d.slice(0, 300);
    save();
  } catch {}
}

export function setRead(id, on = true) { const l = links.find((x) => x.id === id); if (l) { l.read = on; save(); } }
export function remove(id) { const l = links.find((x) => x.id === id); if (l) tombstone('link:' + l.url); links = links.filter((x) => x.id !== id); save(); }
export function search(q) {
  const ts = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  return links.filter((l) => ts.every((t) => `${l.title} ${l.url} ${l.note} ${l.desc || ''}`.toLowerCase().includes(t)));
}

/** Readable text of a saved page (Mac app). */
export async function pageText(url) {
  if (!can('webFetch')) throw new Error('Reading web pages needs the JARVIS Mac app (browsers block websites from reading other sites).');
  const r = await call('web.get', { url });
  const { htmlToText } = await import('./research.js');
  return htmlToText(r.text, 20000);
}
