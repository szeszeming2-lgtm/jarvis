// Real push notifications, free and without a server of our own:
// - Your phone (or any browser) subscribes with its browser maker's push service (Apple,
//   Google, Mozilla, Microsoft) using the standard Push API.
// - The JARVIS Mac app sends the notifications: each one is encrypted for that phone
//   (RFC 8291, "aes128gcm") and signed with a key that belongs to your Mac (VAPID, RFC 8292),
//   then handed to the push service. Only the phone can read it.
// - They arrive even when JARVIS is closed on the phone, as long as the Mac app is running.
//   On iPhone this needs iOS 16.4 or newer and JARVIS added to the Home Screen.
import { read, write } from './store.js';
import { call, can } from './host.js';

const enc = new TextEncoder();
export const b64u = (u8) => { let s = ''; for (const b of u8) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
export const unb64u = (s) => { let t = String(s).replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/'); while (t.length % 4) t += '='; return Uint8Array.from(atob(t), (c) => c.charCodeAt(0)); };
const cat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { out.set(p, i); i += p.length; } return out; };
async function hkdf(salt, ikm, info, len) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
}
const pointToJwk = (raw, d) => ({ kty: 'EC', crv: 'P-256', x: b64u(raw.slice(1, 33)), y: b64u(raw.slice(33, 65)), ...(d ? { d } : {}), ext: true });

// ---------------------------------------------------------------- encryption (RFC 8291)
/**
 * Encrypt a message for one subscription. Returns the request body.
 * uaPublic: the phone's p256dh key (65 bytes), authSecret: its auth secret (16 bytes).
 * `as` (the sender's one-time key pair) and `salt` are only given in tests.
 */
export async function encrypt(payload, uaPublic, authSecret, { as = null, salt = null } = {}) {
  const pair = as || (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']));
  const asPublic = as?.publicRaw || new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const ua = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: ua }, pair.privateKey, 256));
  const ikm = await hkdf(authSecret, secret, cat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const s = salt || crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(s, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(s, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, cat(payload, new Uint8Array([2]))));
  return cat(s, new Uint8Array([0, 0, 16, 0]), new Uint8Array([asPublic.length]), asPublic, ct);
}
/** The receiving side (what the phone's browser does), used in tests. */
export async function decrypt(body, uaPrivateKey, uaPublic, authSecret) {
  const salt = body.slice(0, 16), idlen = body[20], asPublic = body.slice(21, 21 + idlen), ct = body.slice(21 + idlen);
  const as = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: as }, uaPrivateKey, 256));
  const ikm = await hkdf(authSecret, secret, cat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const pt = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ct));
  let end = pt.length - 1; while (end > 0 && pt[end] === 0) end--;   // padding
  return pt.slice(0, end);
}
export const importPrivate = (raw, d, usage = ['deriveBits'], name = 'ECDH') => crypto.subtle.importKey('jwk', pointToJwk(raw, d), { name, namedCurve: 'P-256' }, false, usage);

// ---------------------------------------------------------------- sender identity (VAPID, RFC 8292)
const SUBJECT = 'https://szeszeming2-lgtm.github.io/jarvis/';
/** This Mac's push key pair (made once, kept in this profile's data). → { publicRaw, privateKey } */
export async function vapid() {
  let saved = await read('push-vapid', null);
  if (!saved?.d) {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
    const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    saved = { d: jwk.d, pub: b64u(pub) };
    await write('push-vapid', saved);
  }
  const publicRaw = unb64u(saved.pub);
  return { publicRaw, privateKey: await importPrivate(publicRaw, saved.d, ['sign'], 'ECDSA') };
}
/** The Authorization header for one push service. */
export async function vapidHeader(endpoint, keys, { now = Date.now(), subject = SUBJECT } = {}) {
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, enc.encode(`${head}.${claims}`)));
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${b64u(keys.publicRaw)}`;
}

// ---------------------------------------------------------------- the sending side (Mac app)
export const canSend = () => can('pushSend');
export async function subscriptions() { return (await read('push-subs', [])) || []; }
export async function addSubscription(sub, name = 'phone') {
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) throw new Error('That isn’t a push subscription.');
  if (!/^https:\/\//.test(sub.endpoint)) throw new Error('That isn’t a push subscription.');
  const list = (await subscriptions()).filter((s) => s.endpoint !== sub.endpoint);
  list.push({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, name: String(name).slice(0, 40), at: Date.now() });
  await write('push-subs', list.slice(-10));
}
export async function removeSubscription(endpoint) { await write('push-subs', (await subscriptions()).filter((s) => s.endpoint !== endpoint)); }

/** Send to every subscribed device. → { sent, failed } */
export async function sendAll(data) {
  if (!canSend()) return { sent: 0, failed: 0, reason: 'Only the JARVIS Mac app can send push notifications.' };
  const keys = await vapid();
  const payload = enc.encode(JSON.stringify(data).slice(0, 2800));
  let sent = 0, failed = 0;
  for (const s of await subscriptions()) {
    try {
      const body = await encrypt(payload, unb64u(s.keys.p256dh), unb64u(s.keys.auth));
      const r = await call('push.send', { url: s.endpoint, body: btoa(String.fromCharCode(...body)), headers: { Authorization: await vapidHeader(s.endpoint, keys), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: data.urgent ? 'high' : 'normal' } });
      if (r.status >= 200 && r.status < 300) sent++;
      else { failed++; if (r.status === 404 || r.status === 410) await removeSubscription(s.endpoint); }   // the phone unsubscribed
    } catch { failed++; }
  }
  return { sent, failed };
}

// ---------------------------------------------------------------- the receiving side (phone)
/** Can this browser get push notifications? → { ok, why } */
export function receiveSupport() {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  const standalone = matchMedia?.('(display-mode: standalone)').matches || navigator.standalone;
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return { ok: false, why: ios && !standalone ? 'On iPhone and iPad, push works only from the Home Screen app: tap Share → Add to Home Screen, open JARVIS from there, then turn this on (iOS 16.4 or newer).' : 'This browser can’t receive push notifications.' };
  }
  if (ios && !standalone) return { ok: false, why: 'On iPhone and iPad, push works only from the Home Screen app: tap Share → Add to Home Screen, open JARVIS from there, then turn this on.' };
  return { ok: true };
}
/** Subscribe this browser with the Mac's public key. → the subscription to give to the Mac. */
export async function subscribe(publicKeyB64u) {
  const sup = receiveSupport();
  if (!sup.ok) throw new Error(sup.why);
  if (Notification.permission !== 'granted' && (await Notification.requestPermission()) !== 'granted') throw new Error('Notifications weren’t allowed. You can allow them in Settings → Notifications → JARVIS.');
  const reg = await navigator.serviceWorker.ready;
  const old = await reg.pushManager.getSubscription();
  if (old) await old.unsubscribe().catch(() => {});
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: unb64u(publicKeyB64u) });
  return sub.toJSON();
}
export async function unsubscribe() { const reg = await navigator.serviceWorker?.getRegistration(); const s = await reg?.pushManager?.getSubscription(); if (s) await s.unsubscribe(); return !!s; }
export async function subscribed() { try { const reg = await navigator.serviceWorker?.getRegistration(); return !!(await reg?.pushManager?.getSubscription()); } catch { return false; } }
