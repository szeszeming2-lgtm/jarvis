// Sign in with a secret phrase: every device that knows the same phrase keeps the
// same JARVIS, live, with no account and nothing stored on any server.
//
// How: the phrase is turned into (1) a meeting name and (2) an encryption key. Devices
// use the free PeerJS service only to find each other by that meeting name, then talk
// directly (WebRTC, encrypted twice: by WebRTC itself and by the phrase key). The first
// device online becomes the "hub" (the Mac app, which stays open, is ideal); the others
// join it. Each change is sent as an encrypted bundle and merged; deletions travel too.
import { settings, set, read, write } from './store.js';
import { bus } from './util.js';
import * as sync from './sync.js';

const LIB = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js';
const enc = new TextEncoder(), dec = new TextDecoder();

// 256 short, easy words: an 8-word phrase is 64 bits, far too many to guess.
const WORDS = ('apple arrow aspen atlas autumn badge bamboo banjo barley basil beacon berry bison blade blossom bonfire breeze brick bridge brook bubble cabin cactus camel canal candle canyon carbon cargo castle cedar cello chalk cherry chess cider cinder citrus clover cobalt comet copper coral cotton crater crayon crystal cupcake dahlia daisy delta denim desert diamond dolphin dragon drift eagle echo ember emerald engine falcon feather fern fiddle field fig flame flint forest fossil fox frost galaxy garden garnet geyser ginger glacier globe gold granite grape gravel harbor harvest hazel helmet heron hickory honey horizon husky iceberg indigo iris island ivory jade jasmine jelly jet jungle kayak kelp kettle kiwi koala lagoon lantern laser lava lemon lily lime linen lion lotus lunar maple marble meadow melon meteor mint mirror mocha moose mosaic moss motor mountain nectar needle nickel nova nutmeg oasis ocean olive onyx opal orbit orchid otter owl oyster paddle palm panda paper parrot peach pearl pebble pepper piano pilot pine planet plum polar poppy prairie prism puffin pumpkin quartz quill rabbit radar rain raven reef ribbon river robin rocket ruby saffron sage salmon sapphire satin saturn scarlet shadow shell sierra silver sky sparrow spice spruce squid star stone storm sugar summit sunset swan tango thistle thunder tiger timber topaz torch tulip tundra turtle twilight umber valley velvet violet volcano walnut wave whale willow window winter wolf wren yarrow zebra zenith zephyr anchor acorn alpine amber aurora avocado ballet bay birch bluebird boulder cameo cashew cobble cosmos dune elm fable glider hollow juniper kite lark lychee mango mesa nimbus oak peony quail ripple sequoia tidal').split(' ');

export const state = { status: 'off', role: '', peers: 0, lastSync: 0, error: '', added: '' };
const emit = () => bus.emit('livesync', { ...state });
let lib = null, peer = null, retryT = 0, sendT = 0, keyP = null;
const conns = new Set();
const lastSent = new WeakMap();

export function newPhrase(n = 8) {
  const r = crypto.getRandomValues(new Uint8Array(n));
  return [...r].map((x) => WORDS[x]).join(' ');
}
export const normPhrase = (p) => String(p || '').toLowerCase().replace(/[^a-z]+/g, ' ').trim().replace(/\s+/g, ' ');
/** A phrase is strong enough with 5+ words or 24+ letters. */
export const strongEnough = (p) => { const n = normPhrase(p); return n.split(' ').length >= 5 || n.replace(/ /g, '').length >= 24; };

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
/** The meeting name the devices use to find each other (not the key: a different hash). */
export async function meetingId(phrase) { return 'jarvis-' + hex(await crypto.subtle.digest('SHA-256', enc.encode('jarvis-live-sync-room|' + normPhrase(phrase)))).slice(0, 40); }

function key(phrase) {
  keyP ||= (async () => {
    const base = await crypto.subtle.importKey('raw', enc.encode(normPhrase(phrase)), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: enc.encode('jarvis-live-sync-key-v1'), iterations: 250000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  })();
  return keyP;
}
async function sealLive(obj, phrase) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(phrase), enc.encode(JSON.stringify(obj)));
  const out = new Uint8Array(12 + ct.byteLength); out.set(iv); out.set(new Uint8Array(ct), 12);
  return out;
}
async function openLive(bytes, phrase) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u8.subarray(0, 12) }, await key(phrase), u8.subarray(12));
  return JSON.parse(dec.decode(pt));
}

const deviceName = () => (/iPhone/.test(navigator.userAgent) ? 'iPhone' : /iPad/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)) ? 'iPad' : /Android/.test(navigator.userAgent) ? 'Android' : /Macintosh/.test(navigator.userAgent) ? 'Mac' : 'computer');

// ---------------------------------------------------------------- start / stop
export const signedIn = () => !!settings.syncPhrase;

export async function signIn(phrase) {
  const p = normPhrase(phrase);
  if (!strongEnough(p)) throw new Error('Use at least 5 words (or tap “Make a new phrase”) so nobody can guess it.');
  keyP = null;
  set('syncPhrase', p);
  await connect();
}

export function signOut() {
  set('syncPhrase', '');
  keyP = null;
  disconnect();
  Object.assign(state, { status: 'off', role: '', peers: 0, error: '' });
  emit();
}

function disconnect() {
  clearTimeout(retryT);
  for (const c of conns) try { c.close(); } catch {}
  conns.clear();
  try { peer?.destroy(); } catch {}
  peer = null;
}

async function library() {
  if (!lib) { await import(/* @vite-ignore */ LIB); lib = window.peerjs?.Peer || window.Peer; }
  if (!lib) throw new Error('The connection helper didn’t load. Are you online?');
  return lib;
}

const retry = (ms) => { clearTimeout(retryT); retryT = setTimeout(() => connect().catch(() => {}), ms); };

/** Become the hub if nobody is; otherwise join the hub. */
export async function connect() {
  if (!settings.syncPhrase) return;
  disconnect();
  state.status = 'connecting'; state.error = ''; emit();
  let Peer;
  try { Peer = await library(); } catch (e) { state.status = 'error'; state.error = e.message; emit(); retry(30000); return; }
  const room = await meetingId(settings.syncPhrase);
  peer = new Peer(room, { debug: 0 });
  peer.on('open', () => { state.role = 'hub'; state.status = conns.size ? 'connected' : 'waiting'; emit(); });
  peer.on('connection', (c) => setup(c));
  peer.on('disconnected', () => { try { peer?.reconnect(); } catch {} });
  peer.on('error', (err) => {
    if (err.type === 'unavailable-id') { joinHub(Peer, room); return; }   // another device is the hub: join it
    state.status = 'error'; state.error = err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error' ? 'Can’t reach the connection service. Are you online?' : String(err.message || err.type);
    emit(); retry(20000);
  });
}

function joinHub(Peer, room) {
  try { peer?.destroy(); } catch {}
  peer = new Peer({ debug: 0 });
  peer.on('open', () => { state.role = 'member'; setup(peer.connect(room, { reliable: true })); });
  peer.on('error', (err) => {
    // The hub just left: try again (this device may become the hub).
    if (err.type === 'peer-unavailable') { state.status = 'waiting'; emit(); retry(4000 + Math.random() * 4000); return; }
    state.status = 'error'; state.error = String(err.message || err.type); emit(); retry(20000);
  });
}

function setup(c) {
  c.on('open', () => { conns.add(c); state.peers = conns.size; state.status = 'connected'; emit(); sendTo(c, true); });
  c.on('data', (d) => receive(c, d).catch((e) => { state.error = e.message; emit(); }));
  const gone = () => {
    conns.delete(c); state.peers = conns.size;
    if (!conns.size) state.status = state.role === 'hub' ? 'waiting' : 'connecting';
    emit();
    if (state.role !== 'hub' && settings.syncPhrase) retry(3000 + Math.random() * 3000);
  };
  c.on('close', gone);
  c.on('error', gone);
}

// ---------------------------------------------------------------- sending and receiving
async function bundle() { return { ...(await sync.collect({ chats: 20 })), from: deviceName(), at: Date.now() }; }

async function sendTo(c, force = false) {
  if (!settings.syncPhrase || !c.open) return;
  const b = await bundle();
  const sig = JSON.stringify({ ...b, at: 0 }).length + ':' + hashOf(b);
  if (!force && lastSent.get(c) === sig) return;   // nothing new for this device
  lastSent.set(c, sig);
  c.send({ t: 'bundle', data: await sealLive(b, settings.syncPhrase) });
}
const hashOf = (b) => { const s = JSON.stringify({ ...b, at: 0 }); let x = 0; for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) | 0; return x; };

/** Send our data to every connected device (debounced). */
export function push(except = null) {
  clearTimeout(sendT);
  sendT = setTimeout(() => { for (const c of conns) if (c !== except) sendTo(c).catch(() => {}); }, 1500);
}

async function receive(c, msg) {
  if (msg?.t !== 'bundle') return;
  let data;
  try { data = await openLive(msg.data, settings.syncPhrase); }
  catch { state.error = 'A device with a different phrase tried to connect and was ignored.'; emit(); return; }
  const counts = await sync.apply(data, { live: true });
  await reloadAll();
  state.lastSync = Date.now();
  const added = sync.describe(counts);
  state.added = /^Everything/.test(added) ? '' : added;
  state.error = '';
  emit();
  // Pass news on (the hub relays between devices), and answer with anything the sender lacks.
  if (!/^Everything/.test(added) && state.role === 'hub') push(c);
  sendTo(c).catch(() => {});
}

/** Reload every data module after a merge so the screen updates without restarting. */
async function reloadAll() {
  const mods = await Promise.all(['./memory.js', './skills.js', './lists.js', './people.js', './reminders.js', './workout.js', './projects.js', './planner.js', './sessions.js', './links.js'].map((m) => import(m)));
  const [memory, skills, lists, people, reminders, workout, projects, planner, sessions, links] = mods;
  await Promise.all([memory.load(), skills.load(), lists.load(), people.load(), reminders.reload(), workout.load(), projects.load(), planner.load(), sessions.load(), links.load()]);
  for (const ev of ['memory', 'skills', 'lists', 'people', 'reminders', 'workouts', 'projects', 'planner', 'sessions', 'links']) bus.emit(ev, null);
  bus.emit('settings', { path: 'sync', value: null });
  bus.emit('identity');
  try { (await import('./ui/theme.js')).applyAppearance(); } catch {}
}

/** Watch for local changes and share them. Call once at start-up. */
export function start() {
  for (const ev of ['memory', 'skills', 'lists', 'people', 'reminders', 'workouts', 'projects', 'planner', 'sessions', 'links', 'tombstones']) {
    // (Reloads after a sync emit null and are ignored; repeats are skipped because unchanged data isn't re-sent.)
    bus.on(ev, (v) => { if (v !== null && conns.size) push(); });
  }
  bus.on('settings', (d) => { if (d?.path && !/^(syncPhrase|sync|briefing\.last)/.test(d.path) && conns.size) push(); });
  if (settings.syncPhrase) connect().catch(() => {});
  // Phones put pages to sleep: reconnect when JARVIS comes back to the front.
  document.addEventListener('visibilitychange', () => { if (!document.hidden && settings.syncPhrase && !conns.size) connect().catch(() => {}); });
}

export const syncNow = () => { for (const c of conns) sendTo(c, true).catch(() => {}); };
