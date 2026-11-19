// AI that runs inside the browser itself (phones, tablets, any computer without Ollama).
// Uses WebLLM (Apache-2.0, by the MLC team) on the device's GPU through WebGPU.
// Devices whose browser can't use the graphics chip (older iPhones/iPads, some Androids)
// get a slower backup: transformers.js running small models on the processor (WASM).
// Free, private, no account: the model downloads once, then works offline.
import { bus } from './util.js';
import { library as tfLibrary } from './vision.js';

export const LIB_URL = 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.87/lib/index.js';

/** Phone-friendly models. size = approximate one-time download in GB. */
export const PHONE_MODELS = [
  { key: 'SmolLM2-360M-Instruct', label: 'Tiny', name: 'SmolLM2 360M', size: 0.27, note: 'For older phones. Very quick, but simple answers.' },
  { key: 'Qwen2.5-0.5B-Instruct', label: 'Small', name: 'Qwen2.5 0.5B', size: 0.35, note: 'Light and fast. Good for quick questions.' },
  { key: 'Llama-3.2-1B-Instruct', label: 'Recommended', name: 'Llama 3.2 1B', size: 0.7, note: 'Best balance on most iPhones and Android phones.', pick: true },
  { key: 'Qwen3-1.7B', label: 'Smart', name: 'Qwen3 1.7B', size: 1.1, note: 'Smarter. Needs a newer phone (iPhone 15 Pro or later, or 8 GB Android).', thinking: true },
];

/** Backup models for devices without a usable graphics chip (run on the processor; slower). */
export const WASM_MODELS = [
  // (SmolLM2 135M was tried and dropped: too small to answer correctly.)
  { key: 'wasm:SmolLM2-360M', repo: 'HuggingFaceTB/SmolLM2-360M-Instruct', label: 'Quick', name: 'SmolLM2 360M', size: 0.37, note: 'Faster, simpler answers.' },
  { key: 'wasm:Qwen2.5-0.5B', repo: 'onnx-community/Qwen2.5-0.5B-Instruct', label: 'Recommended', name: 'Qwen2.5 0.5B', size: 0.51, note: 'Best answers without a graphics chip.', pick: true },
];
const isWasmKey = (k) => String(k || '').startsWith('wasm:');

export const state = { lib: null, engine: null, loadedId: '', loading: null, progress: 0, text: '', f16: null, support: null, mode: '', wasm: null };

/** The models this device can run (graphics-chip models, or the processor backups). */
export const models = () => (state.mode === 'wasm' ? WASM_MODELS : PHONE_MODELS);

/** Can this device run it? → {ok, f16, wasm, reason}. Without WebGPU it falls back to the processor. */
export async function support() {
  if (state.support) return state.support;
  const backup = (why) => {
    state.mode = typeof WebAssembly === 'object' ? 'wasm' : '';
    state.support = state.mode ? { ok: true, wasm: true, reason: why } : { ok: false, reason: 'This browser can’t run an AI on the device. Use a recent Safari or Chrome.' };
    return state.support;
  };
  if (!('gpu' in navigator)) return backup(/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)) ? 'Your iPhone or iPad doesn’t give the browser its graphics chip (that needs iOS 26 or newer), so the AI runs on the processor instead: smaller and slower, but it works.' : 'This browser doesn’t give websites the graphics chip, so the AI runs on the processor instead: smaller and slower, but it works.');
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return backup('This device’s graphics chip isn’t available to the browser, so the AI runs on the processor instead: smaller and slower, but it works.');
    state.f16 = adapter.features.has('shader-f16');
    state.mode = 'webgpu';
    state.support = { ok: true, f16: state.f16, maxBuffer: adapter.limits.maxStorageBufferBindingSize };
  } catch (e) { return backup(e.message); }
  return state.support;
}

/** Full WebLLM model id for this device (f16 shaders when available, else f32). */
export function fullId(key) {
  if (!key) return '';
  if (isWasmKey(key)) return key;
  if (/-MLC$/.test(key)) return key;
  return `${key}-${state.f16 === false ? 'q4f32_1' : 'q4f16_1'}-MLC`;
}
export const keyOf = (id) => String(id || '').replace(/-q4f(16|32)_1-MLC$/, '');
export const info = (keyOrId) => [...PHONE_MODELS, ...WASM_MODELS].find((m) => m.key === keyOf(keyOrId));

async function lib() {
  if (!state.lib) state.lib = await import(/* @vite-ignore */ LIB_URL);
  return state.lib;
}

export async function isDownloaded(key) {
  if (isWasmKey(key)) {
    try { const c = await caches.open('transformers-cache'); return !!(await c.match(`https://huggingface.co/${info(key).repo}/resolve/main/onnx/model_quantized.onnx`)); } catch { return false; }
  }
  try { await support(); const w = await lib(); return await w.hasModelInCache(fullId(key)); } catch { return false; }
}

export async function downloadedKeys() {
  await support();
  const out = [];
  for (const m of models()) if (await isDownloaded(m.key)) out.push(m.key);
  return out;
}

// ---------------------------------------------------------------- processor (WASM) backup
async function loadWasm(key, report) {
  const m = info(key);
  if (!m?.repo) throw new Error('Unknown model.');
  const t = await tfLibrary();
  const files = new Map();
  const progress_callback = (p) => {
    if (p.status === 'progress' && p.total) files.set(p.file, [p.loaded, p.total]);
    let a = 0, b = 0; for (const [l, tt] of files.values()) { a += l; b += tt; }
    report({ progress: b ? Math.min(0.99, a / Math.max(b, m.size * 1e9)) : 0.01, text: `Fetching ${Math.round(a / 1e6)}MB` });
  };
  const tokenizer = await t.AutoTokenizer.from_pretrained(m.repo, { progress_callback });
  const model = await t.AutoModelForCausalLM.from_pretrained(m.repo, { dtype: 'q8', device: 'wasm', progress_callback });
  report({ progress: 1, text: 'Finish loading' });
  state.wasm = { key, tokenizer, model, t };
  return state.wasm;
}

function wasmGenerate(messages, { temperature = 0.7, maxTokens = 500, onDelta } = {}) {
  const { tokenizer, model, t } = state.wasm;
  const inputs = tokenizer.apply_chat_template(messages, { add_generation_prompt: true, return_dict: true });
  const stopper = new t.InterruptableStoppingCriteria();
  let text = '';
  const streamer = new t.TextStreamer(tokenizer, { skip_prompt: true, skip_special_tokens: true, callback_function: (s) => { text += s; onDelta?.(s); } });
  const promise = model.generate({ ...inputs, max_new_tokens: maxTokens, do_sample: temperature > 0, temperature: Math.max(0.01, temperature), top_p: 0.9, repetition_penalty: 1.1, streamer, stopping_criteria: stopper })
    .then((ids) => ({ text, tokens: ids?.dims?.at?.(-1) - inputs.input_ids.dims.at(-1) }));
  return { promise, cancel: () => stopper.interrupt() };
}

// iPhones (and some Androids) take the graphics chip away from Safari while it is in the
// background or short on memory. WebLLM then quietly drops the model, and the next question
// fails with "Model not loaded…". We notice that, load the model again and carry on.
const DROPPED = /not loaded|reload\(model\)|ModelNotLoaded|device (?:was |is |has been )?lost|GPUDevice|Instance reference|disposed|destroyed/i;
/** Did the engine drop its model (the page still thinks it is loaded)? */
const dropped = () => { const m = state.engine?.loadedModelIdToPipeline; return m instanceof Map && !m.has(state.loadedId); };
/** Forget the loaded model so the next load() starts fresh (a new engine gets a new graphics device). */
export async function reset() {
  const e = state.engine;
  state.engine = null; state.loadedId = '';
  try { await e?.unload(); } catch {}
}
/** Run fn(engine); if the phone dropped the model, load it again and try once more. */
async function withEngine(key, onLoad, fn) {
  let engine = await load(key, onLoad);
  try { return await fn(engine, false); }
  catch (e) {
    if (!DROPPED.test(String(e?.message || e)) || e?.partial) throw e;
    await reset();
    engine = await load(key, onLoad);
    return fn(engine, true);
  }
}

/** Download (if needed) and load a model onto the GPU. onProgress({progress 0..1, text}). */
export async function load(key, onProgress) {
  const id = fullId(key);
  if (isWasmKey(key) && state.wasm?.key === key) return state.wasm;
  if (state.engine && state.loadedId === id && dropped()) await reset();
  if (state.engine && state.loadedId === id) return state.engine;
  if (state.loading) { await state.loading.catch(() => {}); if (state.loadedId === id) return state.engine; }
  const s = await support();
  if (!s.ok) throw new Error(s.reason);
  const report = (r) => {
    state.progress = r.progress ?? state.progress;
    state.text = r.text || '';
    onProgress?.({ progress: state.progress, text: friendly(r.text || '') });
    bus.emit('phoneai.progress', { key, progress: state.progress, text: friendly(r.text || '') });
  };
  state.loading = (async () => {
    if (isWasmKey(key)) {
      await loadWasm(key, report);
      state.loadedId = key;
      try { await navigator.storage?.persist?.(); } catch {}
      return state.wasm;
    }
    const w = await lib();
    if (state.engine) { state.engine.setInitProgressCallback?.(report); await state.engine.reload(id); }
    else state.engine = await w.CreateMLCEngine(id, { initProgressCallback: report });
    state.loadedId = id;
    try { await navigator.storage?.persist?.(); } catch {}
    return state.engine;
  })();
  try { return await state.loading; }
  catch (e) { state.loadedId = ''; throw new Error(explain(e)); }
  finally { state.loading = null; bus.emit('phoneai.progress', { key, progress: 1, text: '', done: true }); }
}

function friendly(t) {
  const m = t.match(/(\d+)MB/);
  if (/Fetching|Loading model from cache|fetch/i.test(t)) return m ? `Downloading… ${m[1]} MB` : 'Downloading…';
  if (/Loading GPU shader|shader/i.test(t)) return 'Preparing the AI for this phone’s graphics chip…';
  if (/Finish loading|ready/i.test(t)) return 'Ready';
  return t.length > 90 ? t.slice(0, 90) + '…' : t;
}

function explain(e) {
  const m = String(e?.message || e);
  if (/QuotaExceeded|quota|storage/i.test(m)) return 'There isn’t enough free storage on this device for that model. Free some space or pick a smaller one.';
  if (/device lost|out of memory|OOM|allocate|buffer size/i.test(m)) return 'This model is too big for this device’s memory. Pick a smaller one (Tiny or Small).';
  if (/network|fetch|Failed to fetch|NetworkError/i.test(m)) return 'The download was interrupted. Check your internet connection and try again — it continues where it stopped.';
  if (DROPPED.test(m)) return 'The phone took the AI out of memory (this happens when the browser was in the background). Tap Try again and it loads again.';
  return m;
}

const toChat = (messages) => {
  // WebLLM wants plain OpenAI-style messages: one system message first, no tool messages.
  const sys = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const rest = messages.filter((m) => m.role === 'user' || (m.role === 'assistant' && m.content)).map((m) => ({ role: m.role, content: String(m.content) }));
  while (rest.length && rest[0].role === 'assistant') rest.shift();
  // Merge back-to-back messages from the same speaker (the model expects alternating turns).
  const merged = [];
  for (const m of rest) {
    if (merged.length && merged[merged.length - 1].role === m.role) merged[merged.length - 1].content += '\n\n' + m.content;
    else merged.push({ ...m });
  }
  return [{ role: 'system', content: sys }, ...merged];
};

/** Stream a chat reply. Returns {promise → {usage}, cancel}. */
export function chat({ key, messages, temperature = 0.7, maxTokens = 700, onDelta, onLoad }) {
  let cancelled = false, stop = null;
  const promise = (async () => {
    if (isWasmKey(key)) {
      await load(key, onLoad);
      if (cancelled) return {};
      const g = wasmGenerate(toChat(messages), { temperature, maxTokens: Math.min(maxTokens, 280), onDelta }); // ~6 words/s on a processor: keep answers short
      stop = g.cancel;
      const r = await g.promise;
      return { usage: { completion_tokens: r.tokens } };
    }
    const extra = info(key)?.thinking ? { extra_body: { enable_thinking: false } } : {};
    return withEngine(key, onLoad, async (engine) => {
      if (cancelled) return {};
      let usage = null, wrote = false;
      try {
        const stream = await engine.chat.completions.create({ messages: toChat(messages), stream: true, temperature, max_tokens: maxTokens, stream_options: { include_usage: true }, ...extra });
        for await (const chunk of stream) {
          if (cancelled) break;
          const d = chunk.choices?.[0]?.delta?.content;
          if (d) { wrote = true; onDelta?.(d.replace(/<\/?think>/g, '')); }
          if (chunk.usage) usage = chunk.usage;
        }
      } catch (e) {
        // Part of the answer is already on screen: don't start over and repeat it.
        if (wrote) { if (DROPPED.test(String(e?.message || e))) state.loadedId = ''; throw Object.assign(new Error(explain(e)), { partial: true }); }
        throw e;
      }
      return { usage };
    });
  })().catch((e) => { throw e?.partial ? e : new Error(explain(e)); });
  return { promise, cancel: () => { cancelled = true; try { stop?.(); state.engine?.interruptGenerate(); } catch {} } };
}

/** Fill in a JSON form (structured output). */
export async function extract({ key, system, user, schema }) {
  if (isWasmKey(key)) {
    // No grammar support here: ask for JSON and read it as well as we can (an empty form if not).
    await load(key);
    const keys = Object.keys(schema?.properties || {});
    const g = wasmGenerate([{ role: 'system', content: `${system}\nReply with only one JSON object with the keys: ${keys.join(', ')}.` }, { role: 'user', content: user }], { temperature: 0, maxTokens: 160 });
    const text = (await g.promise).text;
    try { return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch { return {}; }
  }
  const extra = info(key)?.thinking ? { extra_body: { enable_thinking: false } } : {};
  const r = await withEngine(key, undefined, (engine) => engine.chat.completions.create({
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    temperature: 0, max_tokens: 220, response_format: { type: 'json_object', schema: JSON.stringify(schema) }, ...extra,
  }));
  const text = r.choices?.[0]?.message?.content || '{}';
  return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1) || '{}');
}

export async function unload() {
  try { await state.engine?.unload(); } catch {}
  try { await state.wasm?.model?.dispose?.(); } catch {}
  state.engine = null; state.wasm = null; state.loadedId = '';
}

export async function remove(key) {
  if (state.loadedId === fullId(key)) await unload();
  if (isWasmKey(key)) {
    const c = await caches.open('transformers-cache');
    for (const req of await c.keys()) if (req.url.includes(`/${info(key).repo}/`)) await c.delete(req);
    return;
  }
  const w = await lib();
  await w.deleteModelAllInfoInCache(fullId(key));
}
