// App lock (per profile): a PIN protects this profile, and its data is encrypted on this
// device with a random key that only the PIN can unwrap (PBKDF2, 310 000 rounds + AES-GCM).
// Optional two-step sign-in: after the PIN, a 6-digit code from an authenticator app.
// Spoken passphrase: a sentence you say. On its own it never unlocks (anyone who hears it
// could repeat it): it only counts together with your enrolled voice (voice recognition).
// Wrong tries are limited: after 5, you wait 30 seconds, then longer each time.
import { read, write, setDataKey, isUnlocked, rewriteAll, profileId } from './store.js';
import { bus } from './util.js';
import * as auth from './auth.js';

const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const normPhrase = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

let cfg = null;        // {on, minutes, salt, pinWrap, voiceSalt, voiceWrap, fails, until, mfa: {on, secret, recovery[]}}
let activeKey = null;  // this profile's data key while unlocked (needed for two-step codes)
let activeRaw = null;  // its raw bytes (to change the PIN without re-encrypting everything)
let pending = null;    // {key, raw} after a right PIN, waiting for the code
let lastActive = Date.now(), timer = 0, layer = null;

export async function config() { if (!cfg) cfg = (await read('lock', null)) || { on: false, minutes: 10 }; return cfg; }
export const isOn = () => !!cfg?.on;
export const mfaOn = () => !!cfg?.mfa?.on;
export const hasPassphrase = () => !!cfg?.voiceWrap;
const save = () => write('lock', cfg);

async function kek(secret, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function wrap(raw, secret, salt) { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await kek(secret, salt), raw)); return { iv: b64(iv), d: b64(ct) }; }
async function unwrap(w, secret, salt) { return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(w.iv) }, await kek(secret, salt), unb64(w.d))); }
const importKey = (raw) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
async function sealWith(key, text) { const iv = crypto.getRandomValues(new Uint8Array(12)); return { iv: b64(iv), d: b64(new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text)))) }; }
async function openWith(key, o) { return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(o.iv) }, key, unb64(o.d))); }

export const pinOk = (pin) => /^\d{6,12}$/.test(String(pin));
const commit = (key, raw) => { activeKey = key; activeRaw = raw; setDataKey(key); lastActive = Date.now(); };

// ---------------------------------------------------------------- wrong-try limit
/** Seconds to wait before the next try (0 = go ahead). */
export function waitLeft(now = Date.now()) { return Math.max(0, Math.ceil(((cfg?.until || 0) - now) / 1000)); }
async function failed(method) {
  cfg.fails = (cfg.fails || 0) + 1;
  if (cfg.fails >= 5) cfg.until = Date.now() + Math.min(15 * 60, 30 * 2 ** (cfg.fails - 5)) * 1000;
  await save();
  auth.log('unlock', { ok: false, detail: method + (cfg.fails >= 5 ? ` · waiting ${waitLeft()} s` : '') }).catch(() => {});
}
async function succeeded(method) { cfg.fails = 0; cfg.until = 0; await save(); auth.log('unlock', { ok: true, detail: method }).catch(() => {}); }

// ---------------------------------------------------------------- turn on / off, change
/** Turn the lock on: a new random data key, wrapped by the PIN (and passphrase), then everything is re-saved encrypted. */
export async function enable(pin, { phrase = '', minutes = 10 } = {}) {
  if (!pinOk(pin)) throw new Error('Use 6 to 12 digits for your PIN.');
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const salt = crypto.getRandomValues(new Uint8Array(16)), voiceSalt = crypto.getRandomValues(new Uint8Array(16));
  cfg = { on: true, minutes, salt: b64(salt), pinWrap: await wrap(raw, String(pin), salt), fails: 0, until: 0 };
  if (normPhrase(phrase).split(' ').length >= 3) { cfg.voiceSalt = b64(voiceSalt); cfg.voiceWrap = await wrap(raw, normPhrase(phrase), voiceSalt); }
  commit(await importKey(raw), raw);
  await rewriteAll(true);
  await (await import('./media.js')).rewriteBlobs(true).catch(console.error);
  await save();
  auth.log('lock on').catch(() => {});
  startAutoLock();
  bus.emit('lock.changed', cfg);
}

/** Turn it off (needs to be unlocked): everything is re-saved without encryption. */
export async function disable() {
  if (!isUnlocked()) throw new Error('Unlock first.');
  await rewriteAll(false);
  await (await import('./media.js')).rewriteBlobs(false).catch(console.error);
  setDataKey(null); activeKey = null; activeRaw = null;
  cfg = { on: false, minutes: cfg?.minutes || 10 };
  await save();
  auth.log('lock off').catch(() => {});
  clearInterval(timer);
  bus.emit('lock.changed', cfg);
}

export async function setMinutes(n) { await config(); cfg.minutes = Math.max(0, Math.min(240, Number(n) || 0)); await save(); }

/** New PIN (while unlocked; ask for the old one first with auth's extra check). */
export async function changePin(newPin) {
  if (!activeRaw) throw new Error('Unlock first.');
  if (!pinOk(newPin)) throw new Error('Use 6 to 12 digits for your PIN.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  cfg.salt = b64(salt); cfg.pinWrap = await wrap(activeRaw, String(newPin), salt);
  await save();
  auth.log('PIN changed').catch(() => {});
}
/** Set or clear the spoken passphrase (while unlocked). */
export async function setPassphrase(phrase) {
  if (!activeRaw) throw new Error('Unlock first.');
  if (!phrase) { delete cfg.voiceWrap; delete cfg.voiceSalt; await save(); return; }
  if (normPhrase(phrase).split(' ').length < 3) throw new Error('Use at least 3 words.');
  const s = crypto.getRandomValues(new Uint8Array(16));
  cfg.voiceSalt = b64(s); cfg.voiceWrap = await wrap(activeRaw, normPhrase(phrase), s);
  await save();
}

// ---------------------------------------------------------------- unlocking
/**
 * First step with the PIN. → 'ok' (unlocked) | 'code' (now the two-step code) | 'wrong' | 'wait'.
 */
export async function tryUnlock(pin) {
  await config();
  if (waitLeft()) return 'wait';
  let raw;
  try { raw = await unwrap(cfg.pinWrap, String(pin), unb64(cfg.salt)); } catch { await failed('PIN'); return 'wrong'; }
  const key = await importKey(raw);
  if (mfaOn()) { pending = { key, raw }; return 'code'; }
  commit(key, raw); await succeeded('PIN');
  return 'ok';
}

/**
 * Spoken passphrase: only together with a voice that matched this profile's voiceprint
 * (checked by voiceid.js on the same recording). → 'ok' | 'code' | 'wrong' | 'wait' | 'voice'.
 */
export async function tryPassphrase(text, { voiceMatched = false } = {}) {
  await config();
  if (waitLeft()) return 'wait';
  if (!cfg.voiceWrap) return 'wrong';
  if (!voiceMatched) { await failed('passphrase without a voice match'); return 'voice'; }
  let raw;
  try { raw = await unwrap(cfg.voiceWrap, normPhrase(text), unb64(cfg.voiceSalt)); } catch { await failed('passphrase'); return 'wrong'; }
  const key = await importKey(raw);
  if (mfaOn()) { pending = { key, raw }; return 'code'; }
  commit(key, raw); await succeeded('voice + passphrase');
  return 'ok';
}

/** Second step: the 6-digit code (or a recovery code). → 'ok' | 'wrong' | 'wait'. */
export async function tryCode(code) {
  if (!pending) return 'wrong';
  if (waitLeft()) return 'wait';
  if (await codeOk(pending.key, code)) { commit(pending.key, pending.raw); pending = null; await succeeded('PIN + code'); return 'ok'; }
  await failed('two-step code');
  return 'wrong';
}
async function codeOk(key, code) {
  const c = String(code || '').trim();
  if (/^\d{6}$/.test(c.replace(/\s/g, ''))) {
    try { return await auth.checkTotp(await openWith(key, cfg.mfa.secret), c); } catch { return false; }
  }
  const h = await auth.hashCode(c);
  const i = (cfg.mfa?.recovery || []).indexOf(h);
  if (i < 0) return false;
  cfg.mfa.recovery.splice(i, 1);   // each recovery code works once
  await save();
  auth.log('recovery code used', { detail: `${cfg.mfa.recovery.length} left` }).catch(() => {});
  return true;
}

/** Extra check before something sensitive (doesn't change the lock). → true | false | 'wait'. */
export async function checkPin(pin) {
  await config();
  if (!cfg.on) return false;
  if (waitLeft()) return 'wait';
  try { await unwrap(cfg.pinWrap, String(pin), unb64(cfg.salt)); cfg.fails = 0; await save(); return true; } catch { await failed('PIN check'); return false; }
}
export async function checkCode(code) {
  if (!mfaOn()) return true;
  if (!activeKey) return false;
  if (waitLeft()) return 'wait';
  if (await codeOk(activeKey, code)) return true;
  await failed('code check');
  return false;
}

// ---------------------------------------------------------------- two-step sign-in setup
/** Start: a new secret to add to an authenticator app (nothing is saved yet). */
export function mfaBegin(account) { const secret = auth.newSecret(); return { secret, url: auth.otpauthUrl(secret, account) }; }
/** Finish: the code from the app proves it was added. Returns one-time recovery codes. */
export async function mfaConfirm(secret, code) {
  if (!cfg?.on || !activeKey) throw new Error('Turn on the app lock (with a PIN) first.');
  if (!(await auth.checkTotp(secret, code))) throw new Error('That code didn’t match. Check the time on your phone and try the newest code.');
  const codes = auth.newRecoveryCodes();
  cfg.mfa = { on: true, secret: await sealWith(activeKey, secret), recovery: await Promise.all(codes.map(auth.hashCode)) };
  await save();
  auth.log('two-step sign-in on').catch(() => {});
  return codes;
}
export async function mfaOff() { if (!cfg?.mfa) return; delete cfg.mfa; await save(); auth.log('two-step sign-in off').catch(() => {}); }
export const recoveryLeft = () => cfg?.mfa?.recovery?.length || 0;

// ---------------------------------------------------------------- lock screen
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };

/** Show the lock screen until unlocked. firstStart: data isn't loaded yet. */
export function showLock({ firstStart = false } = {}) {
  if (layer) return layer.done;
  let resolve;
  const done = new Promise((r) => (resolve = r));
  pending = null;
  const box = el('div', 'lock-box glass');
  const msg = el('div', 'lock-msg', firstStart ? 'This profile is locked. Its data stays encrypted until you unlock it.' : 'Locked after a while without use.');
  const field = el('input', 'field lock-pin');
  Object.assign(field, { type: 'password', inputMode: 'numeric', autocomplete: 'off', placeholder: 'PIN' });
  field.setAttribute('aria-label', 'PIN');
  let step = 'pin';
  const shake = () => box.animate([{ transform: 'translateX(-8px)' }, { transform: 'translateX(8px)' }, { transform: 'none' }], { duration: 250 });
  const toCode = () => {
    step = 'code'; field.value = ''; field.placeholder = '6-digit code';
    field.type = 'text'; field.setAttribute('aria-label', 'Two-step code'); field.autocomplete = 'one-time-code';
    msg.textContent = 'Now the 6-digit code from your authenticator app (or a recovery code).'; field.focus();
  };
  const result = (r) => {
    if (r === 'ok') return finish();
    if (r === 'code') return toCode();
    if (r === 'wait') { msg.textContent = `Too many wrong tries. Wait ${waitLeft()} seconds.`; return shake(); }
    if (r === 'voice') { msg.textContent = 'Your voice didn’t match this profile, so the passphrase alone isn’t enough. Use your PIN.'; return shake(); }
    msg.textContent = step === 'code' ? 'That code isn’t right.' : 'That PIN isn’t right.';
    field.value = ''; field.focus(); shake();
  };
  const go = async () => { if (!field.value.trim()) return; msg.textContent = 'Checking…'; result(step === 'code' ? await tryCode(field.value) : await tryUnlock(field.value)); };
  field.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  const btn = el('button', 'btn btn-primary', 'Unlock'); btn.type = 'button'; btn.onclick = go;
  const who = el('div', 'lock-who');
  import('./profiles.js').then((P) => {
    const p = P.active();
    if (!p) return;
    who.replaceChildren(avatarEl(p), el('span', '', p.name));
    if (P.all().length > 1) {
      const sw = el('button', 'btn btn-ghost btn-sm', 'Switch profile'); sw.type = 'button';
      sw.onclick = () => import('./ui/profiles.js').then((m) => m.pickProfile({ reason: 'switch' }));
      box.append(sw);
    }
  }).catch(() => {});
  box.append(el('div', 'lock-orb'), el('div', 'lock-title', 'Locked'), who, msg, field, btn);
  if (cfg?.voiceWrap) {
    const say = el('button', 'btn btn-ghost', '🎤 Voice + passphrase'); say.type = 'button';
    say.onclick = async () => {
      try {
        const V = await import('./voiceid.js');
        if (!(await V.enrolled(profileId))) { msg.textContent = 'Set up voice recognition first (Settings → Privacy). A passphrase alone can’t unlock.'; return; }
        msg.textContent = 'Recording 4 seconds… say your passphrase.';
        const r = await V.listenAndCheck(profileId, { seconds: 4, transcribe: true });
        msg.textContent = 'Checking…';
        result(await tryPassphrase(r.text, { voiceMatched: r.match }));
      } catch (e) { msg.textContent = e.message; }
    };
    box.append(say);
  }
  layer = el('div', 'lock-layer'); layer.setAttribute('role', 'dialog'); layer.setAttribute('aria-label', 'JARVIS is locked');
  layer.append(box); layer.done = done;
  document.body.append(layer);
  if (waitLeft()) msg.textContent = `Too many wrong tries. Wait ${waitLeft()} seconds.`;
  setTimeout(() => field.focus(), 50);
  function finish() { layer.remove(); layer = null; bus.emit('lock.unlocked'); resolve(true); }
  return done;
}
function avatarEl(p) {
  const a = el('span', 'avatar-sm');
  if (p.picture) { const i = document.createElement('img'); i.src = p.picture; i.alt = ''; a.append(i); }
  else { a.textContent = String(p.name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase(); a.style.background = p.color || 'var(--accent)'; }
  return a;
}

export function lockNow() { if (isOn() && isUnlocked()) showLock(); }

export function startAutoLock() {
  clearInterval(timer);
  if (!cfg?.on) return;
  const bump = () => { lastActive = Date.now(); };
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) document.addEventListener(ev, bump, { passive: true });
  timer = setInterval(() => { if (cfg?.on && cfg.minutes > 0 && !layer && Date.now() - lastActive > cfg.minutes * 60000) showLock(); }, 15000);
}
