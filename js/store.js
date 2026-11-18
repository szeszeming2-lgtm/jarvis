// Local persistence + settings. Everything lives on this device:
// the native shell writes JSON files to its data folder; the browser uses localStorage.
import { call } from './host.js';
import { bus, mergeDeep, debounce } from './util.js';

export async function read(key, fallback = null) {
  try {
    const raw = await call('store.read', { key });
    return raw == null ? fallback : JSON.parse(raw);
  } catch (e) {
    console.warn('read failed', key, e);
    return fallback;
  }
}

export async function write(key, value) {
  return call('store.write', { key, value: JSON.stringify(value) });
}

export async function remove(key) { return call('store.remove', { key }); }
export async function list(prefix = '') { try { return await call('store.list', { prefix }); } catch { return []; } }

const pending = new Map();
/** Debounced write so fast typing/streaming doesn't hammer the disk. */
export function writeSoon(key, getValue, ms = 400) {
  if (!pending.has(key)) pending.set(key, debounce(() => write(key, getValue()).catch(console.error), ms));
  pending.get(key)();
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
  smartTitles: false,
  launchAtLogin: false,
  ai: {
    provider: 'ollama',        // ollama (a computer) | phone (in this browser, WebLLM)
    byProvider: {},
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
    continuous: false,         // keep listening after a spoken reply
    bargeIn: false,            // say "stop" to interrupt (experimental)
    silenceMs: 1400,
  },
  memory: { enabled: true, allowSave: true },
  skills: { disabledGroups: [] },
  profile: { phone: '' },
  weather: { place: '', lat: null, lon: null, units: 'auto' },          // only stored on this device; used for "text me"
  reminders: { system: true },      // desktop app: also add to the Reminders app
  permissions: {
    apps: 'allow', web: 'allow', findFiles: 'allow', readFiles: 'ask', writeFiles: 'ask',
    organize: 'ask', system: 'ask', shortcuts: 'ask', commands: 'off', quitApps: 'ask',
    reminders: 'allow', messages: 'ask', calls: 'ask', screen: 'ask',
  },
  appearance: {
    theme: 'reactor', accent: '', visualizer: 'reactor', motion: 'full', glass: 'full', fontScale: 1,
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
