// Local persistence + settings. Everything lives on this device:
// the native shell writes JSON files to its data folder; the browser uses localStorage.
import { call } from './host.js';
import { bus, mergeDeep } from './util.js';

// ---------------------------------------------------------------- encryption at rest (App lock)
// When the app lock is on, everything except the lock settings and reminders (which must
// fire even before you unlock) is stored encrypted with AES-GCM. The data key is random;
// your PIN (and optional spoken passphrase) only unlock it, via PBKDF2.
let dataKey = null;
export const isUnlocked = () => !!dataKey;
export const setDataKey = (k) => { dataKey = k; };
const PLAIN = (key) => key === 'lock' || key === 'reminders' || key.startsWith('weather-cache') || DEVICE.has(key);

// ---------------------------------------------------------------- profiles
// Each profile keeps its own data under its own key prefix ("p.<id>.settings" …). The first
// profile ("default") uses the keys JARVIS always used, so existing data stays where it is.
// A few keys belong to the device, not to a profile: the profile list, the sign-in history
// and the enrolled voiceprints (for telling profiles apart).
export const DEVICE = new Set(['profiles', 'auth-log', 'voiceprints', 'device-id']);
let prefix = '';
export let profileId = 'default';
export const prefixOf = (id) => (!id || id === 'default' ? '' : `p.${id}.`);
/** Use this profile's data from now on (call before anything is read). */
export function useProfile(id) { profileId = id || 'default'; prefix = prefixOf(profileId); }
const K = (key) => (DEVICE.has(key) ? key : prefix + key);
/** Keys of a profile (without its prefix). The default profile never sees other profiles' keys. */
export async function keysOf(id = profileId) {
  const p = prefixOf(id);
  let all = [];
  try { all = await call('store.list', { prefix: p }); } catch {}
  return all.filter((k) => (p ? true : !k.startsWith('p.') && !DEVICE.has(k))).map((k) => k.slice(p.length));
}
/** Remove everything a profile stored (never the device keys or other profiles). */
export async function wipeProfile(id) {
  if (id === profileId) throw new Error('Switch to another profile first.');
  const p = prefixOf(id);
  for (const k of await keysOf(id)) await call('store.remove', { key: p + k });
}
/** Read another profile's plain (unencrypted) key, e.g. its lock settings. */
export async function readOf(id, key, fallback = null) {
  try { const raw = await call('store.read', { key: prefixOf(id) + key }); return raw == null || isSealed(raw) ? fallback : JSON.parse(raw); } catch { return fallback; }
}
export async function writeOf(id, key, value) { if (dataKeyNeeded(key)) throw new Error('Not allowed.'); return call('store.write', { key: prefixOf(id) + key, value: JSON.stringify(value) }); }
const dataKeyNeeded = (key) => !PLAIN(key) && key !== 'settings' && key !== 'onboard';
const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function seal(text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, dataKey, new TextEncoder().encode(text)));
  return JSON.stringify({ jenc: 1, iv: b64(iv), d: b64(ct) });
}
async function unseal(raw) {
  const o = JSON.parse(raw);
  if (!dataKey) throw Object.assign(new Error('JARVIS is locked.'), { locked: true });
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(o.iv) }, dataKey, unb64(o.d)));
}
const isSealed = (raw) => typeof raw === 'string' && raw.startsWith('{"jenc":1');
/** Files (recordings…): encrypted the same way while the lock is on. */
export async function sealBytes(blob) {
  if (!dataKey) return blob;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, dataKey, await blob.arrayBuffer());
  return { jenc: 1, iv, data, type: blob.type || '' };
}
export async function unsealBytes(v) {
  if (!v || !v.jenc) return v;
  if (!dataKey) throw Object.assign(new Error('JARVIS is locked.'), { locked: true });
  return new Blob([await crypto.subtle.decrypt({ name: 'AES-GCM', iv: v.iv }, dataKey, v.data)], { type: v.type });
}
/** The name of this profile's file database. */
export const mediaDbName = (id = profileId) => (id === 'default' ? 'jarvis-media' : `jarvis-media-${id}`);

export async function read(key, fallback = null) {
  try {
    let raw = await call('store.read', { key: K(key) });
    if (raw == null) return fallback;
    if (isSealed(raw)) raw = await unseal(raw);
    return JSON.parse(raw);
  } catch (e) {
    console.warn('read failed', key, e);
    return fallback;
  }
}

/** Re-save every stored item encrypted (lock on) or plain (lock off). */
export async function rewriteAll(encrypt) {
  const keys = await keysOf(profileId);   // only this profile's data
  for (const k of keys) {
    if (PLAIN(k)) continue;
    let raw = await call('store.read', { key: K(k) });
    if (raw == null) continue;
    if (isSealed(raw)) raw = await unseal(raw);
    await call('store.write', { key: K(k), value: encrypt ? await seal(raw) : raw });
  }
}

// Deletions are remembered (key → when) so a synced device deletes them too instead of
// bringing them back. Keys look like "list:shopping:milk", "person:sam", "chat:<id>".
let tombs = null;
export async function tombstones() { if (!tombs) tombs = (await read('tombstones', {})) || {}; return tombs; }
export function tombstone(...keys) {
  tombstones().then((t) => { const now = Date.now(); for (const k of keys) if (k) t[String(k).toLowerCase()] = now; return write('tombstones', t); })
    .then(() => bus.emit('tombstones', 1)).catch(console.error);
}
export function setTombstones(t) { tombs = t; return write('tombstones', t); }

export async function write(key, value) {
  const text = JSON.stringify(value);
  return call('store.write', { key: K(key), value: dataKey && !PLAIN(key) ? await seal(text) : text });
}

export async function remove(key) { return call('store.remove', { key: K(key) }); }
/** This profile's keys that start with `start`. */
export async function list(start = '') { return (await keysOf(profileId)).filter((k) => k.startsWith(start)); }

const pending = new Map();   // key → { timer, getValue }
/** Debounced write so fast typing/streaming doesn't hammer the disk. */
export function writeSoon(key, getValue, ms = 400) {
  const p = pending.get(key) || { timer: 0, getValue };
  p.getValue = getValue;
  clearTimeout(p.timer);
  p.timer = setTimeout(() => { pending.delete(key); write(key, getValue()).catch(console.error); }, ms);
  pending.set(key, p);
}
/** Save everything that is still waiting (before switching profile or reloading). */
export async function flush() {
  const all = [...pending.entries()];
  pending.clear();
  await Promise.all(all.map(([key, p]) => { clearTimeout(p.timer); return write(key, p.getValue()).catch(console.error); }));
}

// ---------------------------------------------------------------- settings
export const DEFAULTS = {
  version: 1,
  setupDone: false,
  assistantName: 'JARVIS',
  userName: '',
  honorific: 'sir',            // sir | ma'am | boss | name | none
  personality: 'classic',      // classic | friendly | concise | custom
  aboutYou: '',
  customInstructions: '',
  replyLanguage: 'auto',
  instantCommands: true,
  suggestNext: true,         // “Try saying” suggestions under each reply
  search: { meaning: false, meaningDownloaded: false },
  translator: { a: '', b: '', speak: true },
  autoSuggest: { dismissed: [] },
  companion: { commands: true, forward: { reminder: true, mission: true, briefing: true, security: true, info: false, focus: false } },
  security: { voiceStepUp: false },
  smartTitles: false,
  launchAtLogin: false,
  ai: {
    provider: 'ollama',        // ollama (a computer) | phone (in this browser, WebLLM)
    byProvider: {},
    phoneSaved: [],            // on-device models known to be saved here (shown even when offline)
    url: 'http://127.0.0.1:11434',
    model: '',
    temperature: 0.7,
    contextLength: 'auto',     // auto | 2048 | 4096 | 8192 | 16384 | 32768
    keepAlive: '5m',           // 0 | 5m | 30m | -1
    thinking: false,           // show model reasoning when supported
    visionModel: '',           // '' = pick an installed model that can see images
    tools: true,               // let the model use abilities
    maxHistory: 30,
  },
  voice: {
    speak: 'voice',            // voice (when you talked) | always | never
    voice: '',
    rate: 0.52,                // 0..1 mapped by host
    pitch: 1.0,
    volume: 1.0,
    locale: 'en-US',
    offlineOnly: true,
    wake: false,
    wakeWord: 'jarvis',
    continuous: true,          // keep listening after a spoken reply (say “that’s all” to stop)
    fullscreen: true,          // full-screen voice view while you talk
    bargeIn: false,            // say "stop" to interrupt (experimental)
    silenceMs: 1400,
  },
  memory: { enabled: true, allowSave: true },
  skills: { disabledGroups: [] },
  profile: { phone: '', home: '', travel: 'd', maps: 'auto' },   // home address: only on this device, for "take me home"
  weather: { place: '', lat: null, lon: null, units: 'auto' },          // only stored on this device; used for "text me"
  reminders: { system: true, textMe: true },      // desktop app: also add to the Reminders app; text you when one is due
  briefing: { on: true, time: '07:30', text: true, speak: true, last: '', evening: true, eveningTime: '21:00', lastEvening: '' },
  mode: 'assistant', modeLang: 'Spanish',
  privacy: { localOnly: false },
  notify: { quiet: false, quietStart: '22:00', quietEnd: '07:00', newApps: false },
  emergency: { contacts: [], number: '' },   // AI mode (modes.js) and the translator's target language
  permissions: {
    apps: 'allow', web: 'allow', findFiles: 'allow', readFiles: 'ask', writeFiles: 'ask',
    organize: 'ask', system: 'ask', shortcuts: 'ask', commands: 'off', quitApps: 'ask',
    reminders: 'allow', messages: 'ask', calls: 'ask', screen: 'ask',
  },
  appearance: {
    theme: 'reactor', accent: '', visualizer: 'reactor', motion: 'full', glass: 'full', fontScale: 1, compact: false, background: 'grid',
  },
  home: {
    sidebar: true, hud: true, suggestions: true,
    hudCards: { clock: true, reminders: true, system: true, ai: true, voice: true, quick: true },
    quick: [
      { label: 'System report', icon: 'cpu', text: 'Give me a system status report' },
      { label: 'Open Safari', icon: 'globe', text: 'open Safari' },
      { label: 'Tidy Downloads', icon: 'broom', text: 'Organize my Downloads folder by file type' },
      { label: 'New note', icon: 'note', text: 'Create a note called Ideas' },
    ],
  },
  shortcuts: {
    newChat: 'Mod+N', search: 'Mod+K', settings: 'Mod+,', toggleSidebar: 'Mod+\\',
    toggleHud: 'Mod+I', listen: 'Mod+Shift+L', stop: 'Escape', focusInput: 'Mod+L', look: 'Mod+Shift+I',
    globalSummon: 'Alt+Mod+J', globalLook: 'Alt+Mod+I',
  },
};

export const settings = structuredClone(DEFAULTS);

export async function loadSettings() {
  const saved = await read('settings', null);
  if (saved) Object.assign(settings, mergeDeep(DEFAULTS, saved));
  return settings;
}

/** Set a nested key like 'voice.rate' and persist. */
export function set(path, value) {
  const parts = path.split('.');
  let o = settings;
  for (const p of parts.slice(0, -1)) o = o[p] ??= {};
  o[parts.at(-1)] = value;
  // Remember when each part changed, so live sync knows which device's setting is newer.
  if (parts[0] !== '_changed' && parts[0] !== 'syncPhrase') { settings._changed ||= {}; settings._changed[parts[0]] = Date.now(); }
  writeSoon('settings', () => settings, 200);
  bus.emit('settings', { path, value });
}

export function get(path) {
  return path.split('.').reduce((o, p) => (o == null ? o : o[p]), settings);
}

export function saveSettingsNow() { return write('settings', settings); }

// ---------------------------------------------------------------- activity log
const LOG_MAX = 300;
let logCache = null;
export async function logActivity(entry) {
  if (!logCache) logCache = await read('activity', []);
  logCache.unshift({ ts: Date.now(), ...entry });
  logCache.length = Math.min(logCache.length, LOG_MAX);
  writeSoon('activity', () => logCache, 800);
  bus.emit('activity', entry);
}
export async function getActivity() { if (!logCache) logCache = await read('activity', []); return logCache; }
export async function clearActivity() { logCache = []; await write('activity', []); }
