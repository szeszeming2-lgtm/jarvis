// App lock: a PIN (and optionally a spoken passphrase) protects JARVIS. Your data is
// encrypted on this device with a random key; the PIN and the passphrase each unlock it.
// It also locks itself after some minutes of not being used.
// Note: the spoken passphrase is a secret sentence you say, not a voiceprint, so anyone who
// hears it could use it. That's explained in the settings.
import { read, write, setDataKey, isUnlocked, rewriteAll } from './store.js';
import { bus } from './util.js';

const enc = new TextEncoder();
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const normPhrase = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

let cfg = null;      // {on, salt, pinWrap, voiceWrap, voiceSalt, minutes}
let lastActive = Date.now(), timer = 0, layer = null;

export async function config() { if (!cfg) cfg = (await read('lock', null)) || { on: false, minutes: 10 }; return cfg; }
export const isOn = () => !!cfg?.on;

async function kek(secret, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function wrap(raw, secret, salt) { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await kek(secret, salt), raw)); return { iv: b64(iv), d: b64(ct) }; }
async function unwrap(w, secret, salt) { return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(w.iv) }, await kek(secret, salt), unb64(w.d))); }
const importKey = (raw) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);

/** Turn the lock on: a new random data key, wrapped by the PIN (and passphrase), then everything is re-saved encrypted. */
export async function enable(pin, { phrase = '', minutes = 10 } = {}) {
  if (!/^\d{4,12}$/.test(String(pin))) throw new Error('Use 4 to 12 digits for your PIN.');
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const salt = crypto.getRandomValues(new Uint8Array(16)), voiceSalt = crypto.getRandomValues(new Uint8Array(16));
  cfg = { on: true, minutes, salt: b64(salt), pinWrap: await wrap(raw, String(pin), salt) };
  if (normPhrase(phrase).split(' ').length >= 3) { cfg.voiceSalt = b64(voiceSalt); cfg.voiceWrap = await wrap(raw, normPhrase(phrase), voiceSalt); }
  setDataKey(await importKey(raw));
  await rewriteAll(true);
  await write('lock', cfg);
  startAutoLock();
  bus.emit('lock.changed', cfg);
}

/** Turn it off (needs to be unlocked): everything is re-saved without encryption. */
export async function disable() {
  if (!isUnlocked()) throw new Error('Unlock first.');
  await rewriteAll(false);
  setDataKey(null);
  cfg = { on: false, minutes: cfg?.minutes || 10 };
  await write('lock', cfg);
  clearInterval(timer);
  bus.emit('lock.changed', cfg);
}

export async function setMinutes(n) { await config(); cfg.minutes = Math.max(0, Math.min(240, Number(n) || 0)); await write('lock', cfg); }

/** Try a PIN or a spoken passphrase. Returns true when unlocked. */
export async function tryUnlock(secret, kind = 'pin') {
  await config();
  try {
    const raw = kind === 'voice' ? await unwrap(cfg.voiceWrap, normPhrase(secret), unb64(cfg.voiceSalt)) : await unwrap(cfg.pinWrap, String(secret), unb64(cfg.salt));
    setDataKey(await importKey(raw));
    lastActive = Date.now();
    return true;
  } catch { return false; }
}

// ---------------------------------------------------------------- lock screen
/** Show the lock screen until unlocked. firstStart: data isn't loaded yet. */
export function showLock({ firstStart = false } = {}) {
  if (layer) return layer.done;
  let resolve;
  const done = new Promise((r) => (resolve = r));
  const pin = document.createElement('input');
  Object.assign(pin, { type: 'password', inputMode: 'numeric', autocomplete: 'off', placeholder: 'PIN', className: 'field lock-pin' });
  pin.setAttribute('aria-label', 'PIN');
  const msg = document.createElement('div'); msg.className = 'lock-msg';
  msg.textContent = firstStart ? 'JARVIS is locked. Your data is encrypted until you unlock it.' : 'Locked after a while without use.';
  const go = async () => {
    msg.textContent = 'Checking…';
    if (await tryUnlock(pin.value, 'pin')) { finish(); return; }
    msg.textContent = 'That PIN isn’t right.'; pin.value = ''; pin.focus();
    layer.querySelector('.lock-box').animate([{ transform: 'translateX(-8px)' }, { transform: 'translateX(8px)' }, { transform: 'none' }], { duration: 250 });
  };
  pin.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  const btn = document.createElement('button'); btn.className = 'btn btn-primary'; btn.type = 'button'; btn.textContent = 'Unlock'; btn.onclick = go;
  const box = document.createElement('div'); box.className = 'lock-box glass';
  const orb = document.createElement('div'); orb.className = 'lock-orb';
  const title = document.createElement('div'); title.className = 'lock-title'; title.textContent = 'Locked';
  box.append(orb, title, msg, pin, btn);
  if (cfg?.voiceWrap) {
    const say = document.createElement('button'); say.className = 'btn btn-ghost'; say.type = 'button'; say.textContent = '🎤 Say my passphrase';
    say.onclick = async () => {
      const voice = await import('./voice.js');
      try {
        const check = async (text) => { msg.textContent = 'Checking…'; if (await tryUnlock(text, 'voice')) finish(); else msg.textContent = `That wasn’t it (heard “${text}”).`; };
        voice.voice.capture = check;
        // Before JARVIS has fully started nothing else is listening, so take the words directly.
        const off = bus.on('voice.final', (text) => { off(); if (voice.voice.capture === check) { voice.voice.capture = null; check(text); } });
        await voice.listen('command'); msg.textContent = 'Listening… say your passphrase.';
      } catch (e) { voice.voice.capture = null; msg.textContent = e.message; }
    };
    box.append(say);
  }
  layer = document.createElement('div'); layer.className = 'lock-layer'; layer.setAttribute('role', 'dialog'); layer.setAttribute('aria-label', 'JARVIS is locked');
  layer.append(box); layer.done = done;
  document.body.append(layer);
  setTimeout(() => pin.focus(), 50);
  function finish() { layer.remove(); layer = null; bus.emit('lock.unlocked'); resolve(true); }
  return done;
}

export function lockNow() { if (isOn() && isUnlocked()) showLock(); }

export function startAutoLock() {
  clearInterval(timer);
  if (!cfg?.on) return;
  const bump = () => { lastActive = Date.now(); };
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) document.addEventListener(ev, bump, { passive: true });
  timer = setInterval(() => { if (cfg?.on && cfg.minutes > 0 && !layer && Date.now() - lastActive > cfg.minutes * 60000) showLock(); }, 15000);
}
