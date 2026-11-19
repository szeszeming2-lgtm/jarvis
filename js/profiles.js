// Profiles: several people can share one JARVIS, each with their own memory, chats,
// settings, voice, reminders, lists, projects, notes, recordings, permissions and lock.
// The first profile ("default") is the data JARVIS already had, so nothing moves.
// Privacy: a profile with a PIN is encrypted with its own key, so other people using this
// device can't read it. A profile without a PIN is only kept apart, not protected.
import { read, write, useProfile, keysOf, wipeProfile, readOf, writeOf, flush, profileId, mediaDbName, settings } from './store.js';
import { uid } from './util.js';

export const COLORS = ['#2ad4ff', '#ff6a8a', '#ffb23f', '#34f5b0', '#b18cff', '#ff8a3d', '#5b9bff', '#e6e6e6'];
let data = null;   // { active, list: [{ id, name, picture, color, created }], askAtStart }

/** Read the profile list and switch the store to the active profile. Call first thing at start-up. */
export async function init() {
  data = await read('profiles', null);
  if (!data || !Array.isArray(data.list) || !data.list.length) {
    data = { active: 'default', list: [{ id: 'default', name: '', picture: '', color: COLORS[0], created: Date.now() }], askAtStart: false };
  }
  if (!data.list.some((p) => p.id === data.active)) data.active = data.list[0].id;
  const def = data.list.find((p) => p.id === 'default');
  if (def && !def.name) { const s = await readOf('default', 'settings'); def.name = String(s?.userName || '').trim().slice(0, 30) || 'Me'; }
  await write('profiles', data);
  useProfile(data.active);
  return data;
}

export const all = () => data?.list || [];
export const get = (id) => all().find((p) => p.id === id) || null;
export const active = () => get(data?.active) || all()[0];
export const activeId = () => data?.active || 'default';
export const askAtStart = () => !!data?.askAtStart && all().length > 1;
export async function setAskAtStart(on) { data.askAtStart = !!on; await write('profiles', data); }
export const initials = (p) => String(p?.name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

const clean = (s) => String(s || '').trim().replace(/\s+/g, ' ');
/** A unique, simple name. */
export function validName(name, exceptId = '') {
  const n = clean(name);
  if (n.length < 1 || n.length > 30) throw new Error('Use a name of 1 to 30 characters.');
  if (!/^[\p{L}\p{N} ._'’-]+$/u.test(n)) throw new Error('Use letters, numbers, spaces, dots, dashes or apostrophes.');
  if (all().some((p) => p.id !== exceptId && clean(p.name).toLowerCase() === n.toLowerCase())) throw new Error('Another profile already has that name.');
  return n;
}
const okPicture = (pic) => (!pic ? '' : /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(pic) && pic.length < 120000 ? pic : (() => { throw new Error('That picture can’t be used. Try a different one.'); })());

/** A new profile starts fresh, with the same AI chosen so it works straight away. */
export async function create({ name, picture = '', color = '', askPin = false }) {
  const n = validName(name);
  const id = uid('pf').replace(/[^A-Za-z0-9]/g, '').slice(-10).toLowerCase();
  const p = { id, name: n, picture: okPicture(picture), color: COLORS.includes(color) ? color : COLORS[all().length % COLORS.length], created: Date.now() };
  data.list.push(p);
  if (data.list.length === 2) data.askAtStart = true;
  await write('profiles', data);
  const ai = { ...settings.ai };
  delete ai.phoneSaved;
  await writeOf(id, 'settings', { setupDone: true, userName: n, ai, voice: { locale: settings.voice?.locale || 'en-US' } });
  if (askPin) await writeOf(id, 'onboard', { askPin: true });
  return p;
}

export async function update(id, { name, picture, color } = {}) {
  const p = get(id);
  if (!p) throw new Error('That profile no longer exists.');
  if (name !== undefined) p.name = validName(name, id);
  if (picture !== undefined) p.picture = okPicture(picture);
  if (color !== undefined && COLORS.includes(color)) p.color = color;
  await write('profiles', data);
  return p;
}

/** Is this profile protected with a PIN? */
export async function isLocked(id) { return !!(await readOf(id, 'lock'))?.on; }

/** Pick a profile before anything is loaded (start-up picker): no reload needed. */
export async function choose(id) {
  if (!get(id)) throw new Error('That profile no longer exists.');
  data.active = id;
  await write('profiles', data);
  useProfile(id);
}

/** Switch while JARVIS is running: save everything, then start again as that profile. */
export async function switchTo(id) {
  if (!get(id)) throw new Error('That profile no longer exists.');
  if (id === activeId()) return false;
  await flush();
  try { const s = await import('./sessions.js'); await s.saveNow(); } catch {}
  data.active = id;
  await write('profiles', data);
  try { sessionStorage.setItem('jarvis-picked', id); } catch {}
  location.reload();
  return true;
}

/** Delete a profile and everything it stored. Not the one in use, and never the last one. */
export async function remove(id) {
  const p = get(id);
  if (!p) throw new Error('That profile no longer exists.');
  if (id === profileId || id === activeId()) throw new Error('Switch to another profile first.');
  if (all().length < 2) throw new Error('You can’t delete the only profile.');
  await wipeProfile(id);
  try { indexedDB.deleteDatabase(mediaDbName(id)); } catch {}
  const vp = (await read('voiceprints', {})) || {};
  if (vp[id]) { delete vp[id]; await write('voiceprints', vp); }
  data.list = data.list.filter((x) => x.id !== id);
  if (data.list.length < 2) data.askAtStart = false;
  await write('profiles', data);
  return true;
}

/** How much a profile has stored (for the delete confirmation). */
export async function sizeOf(id) { return (await keysOf(id)).length; }

// ---------------------------------------------------------------- settings import / export
// Secrets never leave the device in an export: the sync phrase, lock and sign-in settings.
const SECRET = ['syncPhrase', '_changed', 'setupDone'];
export function exportSettings() {
  const s = JSON.parse(JSON.stringify(settings));
  for (const k of SECRET) delete s[k];
  if (s.ai) delete s.ai.phoneSaved;
  return { app: 'JARVIS', kind: 'profile-settings', version: 1, profile: active()?.name || '', exported: new Date().toISOString(), settings: s };
}
/** Returns the setting groups that were imported. */
export function readImport(text) {
  let o;
  try { o = typeof text === 'string' ? JSON.parse(text) : text; } catch { throw new Error('That file isn’t a JARVIS settings file.'); }
  if (o?.app !== 'JARVIS' || o?.kind !== 'profile-settings' || typeof o.settings !== 'object' || !o.settings) throw new Error('That file isn’t a JARVIS settings file.');
  const s = { ...o.settings };
  for (const k of SECRET) delete s[k];
  return s;
}
