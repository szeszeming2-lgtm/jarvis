// Sign-in security, all on this device:
// - Sign-in history: unlocks, failed tries, profile changes, new devices (never PINs or codes).
// - Two-step sign-in: a 6-digit code from an authenticator app (the iPhone's Passwords app,
//   Google Authenticator…), standard TOTP (RFC 6238), plus one-time recovery codes.
// - Extra check before sensitive actions (deleting a profile, exporting, turning the lock off…).
import { read, write, profileId } from './store.js';

// ---------------------------------------------------------------- sign-in history
const MAX = 300;
/** Record an event. Never pass secrets: details are cleaned anyway. */
export async function log(event, { ok = true, detail = '', profile = profileId } = {}) {
  const list = (await read('auth-log', [])) || [];
  list.unshift({ at: Date.now(), profile, event: String(event).slice(0, 60), ok: !!ok, detail: redactText(detail).slice(0, 120) });
  await write('auth-log', list.slice(0, MAX));
}
/** This profile's history (and device-wide events). */
export async function history(id = profileId) { return ((await read('auth-log', [])) || []).filter((e) => e.profile === id || e.profile === 'device'); }

// ---------------------------------------------------------------- keep secrets out of logs
const SECRET_KEY = /pin|pass(word|phrase)?|secret|token|api.?key|code|otp|phrase|credential/i;
/** A copy with secret-looking fields hidden. */
export function redact(v, depth = 0) {
  if (depth > 4 || v == null) return v;
  if (Array.isArray(v)) return v.map((x) => redact(x, depth + 1));
  if (typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = SECRET_KEY.test(k) ? '•••' : redact(x, depth + 1); return o; }
  return v;
}
export const redactText = (s) => String(s || '').replace(/\b(pin|password|passcode|code|secret|token|api[ _-]?key)\b(\s*(?:is|=|:)?\s*)\S+/gi, '$1$2•••');

// ---------------------------------------------------------------- one-time codes (TOTP)
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(bytes) {
  let bits = 0, val = 0, out = '';
  for (const b of bytes) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
export function unbase32(s) {
  const clean = String(s).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, val = 0; const out = [];
  for (const ch of clean) { val = (val << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  return new Uint8Array(out);
}
export const newSecret = () => base32(crypto.getRandomValues(new Uint8Array(20)));

/** The 6-digit code for a moment in time. */
export async function totp(secret, at = Date.now(), step = 30, digits = 6) {
  const counter = Math.floor(at / 1000 / step);
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) { msg[i] = c & 255; c = Math.floor(c / 256); }
  const key = await crypto.subtle.importKey('raw', unbase32(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** digits).padStart(digits, '0');
}
/** Accept the code for now, or 30 seconds either side (phone clocks drift). */
export async function checkTotp(secret, code, at = Date.now()) {
  const c = String(code || '').replace(/\D/g, '');
  if (c.length !== 6) return false;
  for (const d of [0, -1, 1]) if ((await totp(secret, at + d * 30000)) === c) return true;
  return false;
}
/** otpauth:// link: tapping it on an iPhone offers to add the code to Passwords. */
export const otpauthUrl = (secret, account) => `otpauth://totp/${encodeURIComponent('JARVIS')}:${encodeURIComponent(account || 'me')}?secret=${secret}&issuer=JARVIS&algorithm=SHA1&digits=6&period=30`;

// Recovery codes: shown once, kept only as hashes.
const sha = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');
export function newRecoveryCodes(n = 8) {
  return Array.from({ length: n }, () => { const s = base32(crypto.getRandomValues(new Uint8Array(5))).toLowerCase(); return `${s.slice(0, 4)}-${s.slice(4, 8)}`; });
}
export const hashCode = (c) => sha('jarvis-recovery|' + String(c).toLowerCase().replace(/[^a-z0-9]/g, ''));
