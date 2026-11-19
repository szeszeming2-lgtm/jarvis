// Voice recognition (who is speaking), optional and separate from the spoken passphrase
// (what is said). It uses an open speaker-verification model, WavLM Base Plus SV
// (Microsoft, MIT licence; ~100 MB, downloaded once after you agree) that runs on this
// device and turns a few seconds of speech into a "voiceprint": 512 numbers describing how
// a voice sounds. They can't be turned back into your voice, and they never leave the device.
//
// How it's used: to tell enrolled profiles apart ("who's talking?"), and as one extra factor
// together with something you know. A voice match alone never unlocks anything or approves
// a sensitive action: recordings and good imitations can fool any voice system.
import { read, write } from './store.js';
import * as auth from './auth.js';

const MODEL = 'Xenova/wavlm-base-plus-sv';
export const SIZE_MB = 105;
export const THRESHOLD = 0.86;   // the model's recommended same-speaker cut-off (cosine similarity)
export const state = { status: 'idle', progress: 0, error: '' };
let processor = null, model = null, loading = null;

export const ready = () => !!model;
export const downloaded = async () => !!(await read('voiceprints', {}))?._model;

export function load(onProgress = () => {}) {
  if (model) return Promise.resolve();
  if (loading) return loading;
  state.status = 'loading';
  loading = (async () => {
    const { settings } = await import('./store.js');
    if (settings.privacy?.localOnly && !(await downloaded())) throw new Error('Local-only mode is on, so the voice model can’t be downloaded. Turn it off in Settings → Privacy & Data.');
    const { library } = await import('./vision.js');
    const t = await library();
    const files = new Map();
    const progress_callback = (p) => {
      if (p.status === 'progress' && p.total) files.set(p.file, [p.loaded, p.total]);
      let a = 0, b = 0; for (const [l, tt] of files.values()) { a += l; b += tt; }
      state.progress = b ? Math.min(0.99, a / Math.max(b, SIZE_MB * 1e6)) : 0.01;
      onProgress({ progress: state.progress, text: `Downloading voice recognition (${Math.round(a / 1e6)} of ~${SIZE_MB} MB)` });
    };
    processor = await t.AutoProcessor.from_pretrained(MODEL, { progress_callback });
    model = await (t.AutoModelForXVector || t.AutoModel).from_pretrained(MODEL, { dtype: 'q8', device: 'wasm', progress_callback });
    const vp = (await read('voiceprints', {})) || {};
    vp._model = true; await write('voiceprints', vp);
    state.status = 'ready';
  })().catch((e) => { loading = null; state.status = 'error'; state.error = /fetch|network/i.test(String(e)) ? 'The voice model couldn’t download. Check your internet connection (it’s only needed once).' : String(e.message || e); throw new Error(state.error); });
  return loading;
}

// ---------------------------------------------------------------- vectors
const norm = (v) => { let s = 0; for (const x of v) s += x * x; s = Math.sqrt(s) || 1; return Float32Array.from(v, (x) => x / s); };
export function cosine(a, b) { let d = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return na && nb ? d / Math.sqrt(na * nb) : 0; }
const pack = (v) => btoa(String.fromCharCode(...new Uint8Array(Float32Array.from(v).buffer)));
const unpack = (s) => new Float32Array(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer);
/** The average of several voiceprints (enrolment). */
export function average(list) { const out = new Float32Array(list[0].length); for (const v of list) for (let i = 0; i < v.length; i++) out[i] += v[i]; return norm(out); }

/** 16 kHz mono samples → voiceprint. */
export async function embed(samples) {
  if (!samples || samples.length < 16000) throw new Error('That was too short. Speak for at least 2 seconds.');
  if (rms(samples) < 0.004) throw new Error('I couldn’t hear anything. Check the microphone and speak a little louder.');
  await load();
  const inputs = await processor(samples);
  const { embeddings } = await model(inputs);
  return norm(embeddings.data);
}
const rms = (s) => { let t = 0; for (let i = 0; i < s.length; i += 4) t += s[i] * s[i]; return Math.sqrt(t / (s.length / 4)); };

// ---------------------------------------------------------------- recording
/** Record a few seconds from the microphone → { blob, samples }. */
export async function recordSeconds(seconds = 4, onLevel) {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('This browser can’t record audio.');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const type = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', ''].find((t) => !t || MediaRecorder.isTypeSupported(t));
  const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const an = ctx.createAnalyser(); an.fftSize = 512; ctx.createMediaStreamSource(stream).connect(an);
  const buf = new Uint8Array(an.fftSize);
  const tick = setInterval(() => { an.getByteTimeDomainData(buf); let s = 0; for (const v of buf) s += ((v - 128) / 128) ** 2; onLevel?.(Math.min(1, Math.sqrt(s / buf.length) * 4)); }, 100);
  const blob = await new Promise((res) => { rec.onstop = () => res(new Blob(chunks, { type: rec.mimeType || 'audio/webm' })); rec.start(250); setTimeout(() => rec.stop(), seconds * 1000); });
  clearInterval(tick); stream.getTracks().forEach((t) => t.stop()); ctx.close().catch(() => {});
  const { toSamples } = await import('./media.js');
  return { blob, samples: await toSamples(blob) };
}

// ---------------------------------------------------------------- enrolment and checks
/** Voiceprints are kept per profile in a device list (so the right profile can be found by voice). */
async function prints() { return (await read('voiceprints', {})) || {}; }
export async function enrolled(id) { return !!(await prints())[id]?.v; }
export async function enroll(id, vectors) {
  if (!vectors?.length) throw new Error('Nothing recorded.');
  // The samples must sound like the same person, or the enrolment would be unreliable.
  for (let i = 1; i < vectors.length; i++) if (cosine(vectors[0], vectors[i]) < THRESHOLD - 0.1) throw new Error('The recordings sound too different (noise, or another person?). Try again in a quiet place.');
  const vp = await prints();
  vp[id] = { v: pack(average(vectors)), at: Date.now(), samples: vectors.length };
  await write('voiceprints', vp);
  auth.log('voice recognition set up', { profile: id }).catch(() => {});
}
export async function forget(id) { const vp = await prints(); if (vp[id]) { delete vp[id]; await write('voiceprints', vp); auth.log('voice recognition removed', { profile: id }).catch(() => {}); } }

/** How much a voiceprint matches a profile (0..1) and whether it passes. */
export async function check(id, vector) {
  const p = (await prints())[id];
  if (!p?.v) return { match: false, score: 0, enrolled: false };
  const score = cosine(unpack(p.v), vector);
  return { match: score >= THRESHOLD, score, enrolled: true };
}
/** Which enrolled profile is speaking? → { id, score } or null. */
export async function identify(vector) {
  let best = null;
  for (const [id, p] of Object.entries(await prints())) {
    if (!p?.v) continue;
    const score = cosine(unpack(p.v), vector);
    if (!best || score > best.score) best = { id, score };
  }
  return best && best.score >= THRESHOLD ? best : null;
}

/** Record, then check the voice (and optionally turn the words into text, for a passphrase). */
export async function listenAndCheck(id, { seconds = 4, transcribe = false, onLevel } = {}) {
  const { blob, samples } = await recordSeconds(seconds, onLevel);
  const vector = await embed(samples);
  const r = await check(id, vector);
  let text = '';
  if (transcribe) { const m = await import('./media.js'); text = (await m.transcribe(blob)).text || ''; }
  auth.log('voice check', { ok: r.match, detail: `score ${r.score.toFixed(2)}`, profile: id }).catch(() => {});
  return { ...r, text };
}
