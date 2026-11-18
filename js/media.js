// Voice notes, audio transcription and video summaries, all on this device.
// Recordings are kept in the browser's database (IndexedDB), not the small settings store.
// Speech-to-text: Whisper base (MIT licence) through transformers.js, ~77 MB, downloaded
// once after the user agrees. It understands ~100 languages and can translate to English.
import { read, write, settings } from './store.js';
import { call, isNative } from './host.js';
import { bus, uid } from './util.js';
import { library } from './vision.js';

const WHISPER = 'onnx-community/whisper-base';
export const WHISPER_MB = 80;

// ---------------------------------------------------------------- blob store
function db() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('jarvis-media', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('blobs');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx(mode, fn) { const d = await db(); return new Promise((res, rej) => { const t = d.transaction('blobs', mode); const out = fn(t.objectStore('blobs')); t.oncomplete = () => res(out?.result); t.onerror = () => rej(t.error); }); }
export const putBlob = (id, blob) => tx('readwrite', (s) => s.put(blob, id));
export const getBlob = (id) => tx('readonly', (s) => s.get(id));
export const delBlob = (id) => tx('readwrite', (s) => s.delete(id));

// ---------------------------------------------------------------- voice notes
let notes = [];
export async function loadNotes() { notes = await read('voicenotes', []); return notes; }
const saveNotes = () => { write('voicenotes', notes).catch(console.error); bus.emit('voicenotes', notes); };
export const allNotes = () => notes;

/** Start recording; returns {stop() → Promise<note>, cancel(), level()}. */
export async function record() {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('This browser can’t record audio.');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  // MP4/AAC first: Apple's speech recognition (Mac app) can read it, and every browser can play it.
  const type = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', ''].find((t) => !t || MediaRecorder.isTypeSupported(t));
  const rec = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 48000 } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const started = Date.now();
  rec.start(500);
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const an = ctx.createAnalyser(); an.fftSize = 512;
  ctx.createMediaStreamSource(stream).connect(an);
  const buf = new Uint8Array(an.fftSize);
  const end = () => { stream.getTracks().forEach((t) => t.stop()); ctx.close().catch(() => {}); };
  return {
    started,
    level: () => { an.getByteTimeDomainData(buf); let s = 0; for (const v of buf) s += ((v - 128) / 128) ** 2; return Math.min(1, Math.sqrt(s / buf.length) * 4); },
    cancel: () => { try { rec.stop(); } catch {} end(); },
    stop: () => new Promise((res, rej) => {
      rec.onstop = async () => {
        end();
        try {
          const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
          const n = { id: uid('vn'), title: `Voice note ${new Date().toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`, created: Date.now(), seconds: Math.round((Date.now() - started) / 1000), type: blob.type, size: blob.size, text: '' };
          await putBlob(n.id, blob);
          notes.unshift(n); saveNotes();
          res(n);
        } catch (e) { rej(e); }
      };
      rec.stop();
    }),
  };
}
export async function removeNote(id) { notes = notes.filter((n) => n.id !== id); saveNotes(); await delBlob(id).catch(() => {}); }
export function renameNote(id, title) { const n = notes.find((x) => x.id === id); if (n) { n.title = title; saveNotes(); } }
export function setNoteText(id, text) { const n = notes.find((x) => x.id === id); if (n) { n.text = text; saveNotes(); } }

// ---------------------------------------------------------------- speech to text
let asr = null, asrLoading = null;
export const whisperReady = () => !!asr;
export async function whisperDownloaded() {
  try { const c = await caches.open('transformers-cache'); return !!(await c.match(`https://huggingface.co/${WHISPER}/resolve/main/onnx/decoder_model_merged_quantized.onnx`)); } catch { return false; }
}

export function loadWhisper(onProgress = () => {}) {
  if (asr) return Promise.resolve(asr);
  if (asrLoading) return asrLoading;
  asrLoading = (async () => {
    const t = await library();
    const files = new Map();
    asr = await t.pipeline('automatic-speech-recognition', WHISPER, {
      dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' }, device: 'wasm',
      progress_callback: (p) => {
        if (p.status === 'progress' && p.total) files.set(p.file, [p.loaded, p.total]);
        let a = 0, b = 0; for (const [l, tt] of files.values()) { a += l; b += tt; }
        onProgress({ progress: b ? a / Math.max(b, WHISPER_MB * 1e6) : 0, text: `Downloading speech-to-text (${Math.round(a / 1e6)} of ~${WHISPER_MB} MB)` });
      },
    });
    return asr;
  })().catch((e) => { asrLoading = null; throw e; });
  return asrLoading;
}

/** Any audio/video Blob → 16 kHz mono samples (what Whisper wants). */
export async function toSamples(blob) {
  const ab = await blob.arrayBuffer();
  const ctx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 16000, 16000);
  let decoded;
  try { decoded = await ctx.decodeAudioData(ab.slice(0)); } catch { throw new Error('That file’s sound couldn’t be read. Try an MP3, M4A, WAV or MP4 file.'); }
  const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
  const src = off.createBufferSource(); src.buffer = decoded; src.connect(off.destination); src.start();
  const out = await off.startRendering();
  return { samples: out.getChannelData(0), seconds: decoded.duration };
}

const b64 = async (blob) => { const u8 = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };

/** Transcribe a Blob. language: '' = detect; translate: true → English. */
export async function transcribe(blob, { language = '', translate = false, onProgress } = {}) {
  if (isNative) {
    // Mac app: macOS's own offline speech recognition (no download), then the AI translates if asked.
    onProgress?.({ progress: 0.3, text: 'Listening to the recording' });
    const ext = (blob.name || '').split('.').pop() || ({ 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'audio/aac': 'aac' }[blob.type?.split(';')[0]] || 'm4a');
    const r = await call('speech.transcribeFile', { base64: await b64(blob), ext, locale: settings.voice?.locale || 'en-US' });
    let text = String(r?.text || '').trim();
    if (translate && text) { const { complete } = await import('./research.js'); text = await complete('Translate the text into natural English. Reply with only the translation.', text); }
    return { text, seconds: 0 };
  }
  const p = await loadWhisper(onProgress);
  const { samples, seconds } = await toSamples(blob);
  if (seconds > 60 * 60) throw new Error('That recording is over an hour long. Try a shorter one.');
  const r = await p(samples, { chunk_length_s: 30, stride_length_s: 5, return_timestamps: false, task: translate ? 'translate' : 'transcribe', ...(language ? { language } : {}) });
  return { text: String(r.text || '').trim(), seconds: Math.round(seconds) };
}

// ---------------------------------------------------------------- video
/** Pick `n` evenly spaced frames from a video file → [{t, data (base64 JPEG), thumb}]. */
export async function videoFrames(file, n = 4) {
  const url = URL.createObjectURL(file);
  try {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
    await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('That video couldn’t be opened.')); });
    const out = [];
    for (let i = 0; i < n; i++) {
      const t = (v.duration * (i + 0.5)) / n;
      await new Promise((res) => { v.onseeked = res; v.currentTime = t; });
      const c = document.createElement('canvas');
      const k = Math.min(1, 768 / Math.max(v.videoWidth, v.videoHeight));
      c.width = Math.round(v.videoWidth * k); c.height = Math.round(v.videoHeight * k);
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      const data = c.toDataURL('image/jpeg', 0.82).split(',')[1];
      out.push({ t: Math.round(t), data, thumb: c.toDataURL('image/jpeg', 0.6) });
    }
    return { frames: out, duration: Math.round(v.duration) };
  } finally { URL.revokeObjectURL(url); }
}
