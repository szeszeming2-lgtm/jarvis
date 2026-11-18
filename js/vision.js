// The on-device picture AI: SmolVLM-256M (Apache-2.0) running in the browser with
// transformers.js. Used on phones, and on computers without an Ollama vision model.
// About 180 MB, downloaded once (after the user says yes) and kept in the browser's
// cache. Pictures never leave the device.
import { settings, set } from './store.js';

const LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/dist/transformers.min.js';
const MODEL = 'HuggingFaceTB/SmolVLM-256M-Instruct';
// Smallest files that still work on both WebGPU and the plain (WASM) fallback.
const DTYPE = { embed_tokens: 'quantized', vision_encoder: 'q4', decoder_model_merged: 'q4' };
export const SIZE_MB = 180;
export const NAME = 'SmolVLM picture AI';

export const state = { status: 'idle', progress: 0, error: '', device: '' };
let lib = null, processor = null, model = null, loading = null;

export const downloaded = () => !!settings.ai?.pictureAI;
export const ready = () => !!model;

async function library() {
  if (!lib) {
    lib = await import(/* @vite-ignore */ LIB);
    lib.env.allowLocalModels = false;
    lib.env.useBrowserCache = true;
    // Load the WASM helper straight from the CDN; the default turns it into a blob: link, which the app's security rules block.
    lib.env.useWasmCache = false;
  }
  return lib;
}

/** Download (first time) and start the model. onProgress({progress 0..1, text}). */
export function load(onProgress = () => {}) {
  if (model) return Promise.resolve();
  if (loading) return loading;
  state.status = 'loading'; state.error = '';
  loading = (async () => {
    const t = await library();
    const files = new Map();
    const progress_callback = (p) => {
      if (p.status === 'progress' && p.total) files.set(p.file, [p.loaded, p.total]);
      if (p.status === 'done' && files.has(p.file)) { const [, tot] = files.get(p.file); files.set(p.file, [tot, tot]); }
      let a = 0, b = 0;
      for (const [l, tt] of files.values()) { a += l; b += tt; }
      // The three model files dominate; before they start, show a little movement.
      state.progress = b ? Math.min(0.99, a / Math.max(b, SIZE_MB * 1e6)) : 0.01;
      onProgress({ progress: state.progress, text: downloaded() ? 'Starting the picture AI' : `Downloading the picture AI (${Math.round(a / 1e6)} of ~${SIZE_MB} MB)` });
    };
    const gpu = !!navigator.gpu && !!(await navigator.gpu.requestAdapter().catch(() => null));
    state.device = gpu ? 'webgpu' : 'wasm';
    processor = await t.AutoProcessor.from_pretrained(MODEL, { progress_callback });
    try {
      model = await t.AutoModelForVision2Seq.from_pretrained(MODEL, { dtype: DTYPE, device: state.device, progress_callback });
    } catch (e) {
      if (state.device !== 'webgpu') throw e;
      state.device = 'wasm'; // some phones list WebGPU but can't run this model on it
      model = await t.AutoModelForVision2Seq.from_pretrained(MODEL, { dtype: DTYPE, device: 'wasm', progress_callback });
    }
    set('ai.pictureAI', true);
    state.status = 'ready'; state.progress = 1;
    onProgress({ progress: 1, text: 'Picture AI ready' });
  })().catch((e) => {
    state.status = 'error'; state.error = friendly(e);
    loading = null;
    throw new Error(state.error);
  });
  return loading;
}

function friendly(e) {
  const m = String(e?.message || e);
  if (/quota|QuotaExceeded/i.test(m)) return 'There isn’t enough free space on this device for the picture AI (about 180 MB).';
  if (/fetch|network|Failed to load/i.test(m)) return 'The picture AI couldn’t download. Check your internet connection and try again (it’s only needed once).';
  return 'The picture AI couldn’t start on this device: ' + m.slice(0, 160);
}

const b64ToBlob = (b64, type = 'image/jpeg') => { const s = atob(b64); const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return new Blob([a], { type }); };

/**
 * Ask about a picture. image: base64 JPEG (no data: prefix). Streams words to onToken.
 * Small model: short, plain questions work best, so the question is kept simple.
 */
export async function ask(image, question, { onToken = () => {}, maxTokens = 160, signal } = {}) {
  await load();
  const t = lib;
  const raw = await t.RawImage.fromBlob(b64ToBlob(image));
  const q = String(question || '').trim();
  const text = !q || /^(what('?s| is) (this|that|it)\??|identify (this|it)|what am i looking at\??)$/i.test(q) ? 'What is this? Describe it in one or two sentences.' : q;
  const messages = [{ role: 'user', content: [{ type: 'image' }, { type: 'text', text }] }];
  const prompt = processor.apply_chat_template(messages, { add_generation_prompt: true });
  const inputs = await processor(prompt, [raw], { do_image_splitting: false });
  let out = '';
  const streamer = new t.TextStreamer(processor.tokenizer, { skip_prompt: true, skip_special_tokens: true, callback_function: (s) => { out += s; onToken(s); } });
  const stopper = t.InterruptableStoppingCriteria ? new t.InterruptableStoppingCriteria() : null;
  signal?.addEventListener('abort', () => stopper?.interrupt());
  const ids = await model.generate({ ...inputs, max_new_tokens: maxTokens, do_sample: false, repetition_penalty: 1.1, streamer, ...(stopper ? { stopping_criteria: stopper } : {}) });
  if (!out.trim()) {
    const decoded = processor.batch_decode(ids.slice(null, [inputs.input_ids.dims.at(-1), null]), { skip_special_tokens: true });
    out = decoded[0] || '';
  }
  return out.trim();
}

/** Free the memory (e.g. when leaving the camera). The download stays cached. */
export async function unload() { try { await model?.dispose?.(); } catch {} model = null; loading = null; state.status = 'idle'; }
