// AI that runs inside the browser itself (phones, tablets, any computer without Ollama).
// Uses WebLLM (Apache-2.0, by the MLC team) on the device's GPU through WebGPU.
// Free, private, no account: the model downloads once, then works offline.
import { bus } from './util.js';

export const LIB_URL = 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.87/lib/index.js';

/** Phone-friendly models. size = approximate one-time download in GB. */
export const PHONE_MODELS = [
  { key: 'SmolLM2-360M-Instruct', label: 'Tiny', name: 'SmolLM2 360M', size: 0.27, note: 'For older phones. Very quick, but simple answers.' },
  { key: 'Qwen2.5-0.5B-Instruct', label: 'Small', name: 'Qwen2.5 0.5B', size: 0.35, note: 'Light and fast. Good for quick questions.' },
  { key: 'Llama-3.2-1B-Instruct', label: 'Recommended', name: 'Llama 3.2 1B', size: 0.7, note: 'Best balance on most iPhones and Android phones.', pick: true },
  { key: 'Qwen3-1.7B', label: 'Smart', name: 'Qwen3 1.7B', size: 1.1, note: 'Smarter. Needs a newer phone (iPhone 15 Pro or later, or 8 GB Android).', thinking: true },
];

export const state = { lib: null, engine: null, loadedId: '', loading: null, progress: 0, text: '', f16: null, support: null };

/** Can this device run it? → {ok, reason, f16} */
export async function support() {
  if (state.support) return state.support;
  if (!('gpu' in navigator)) {
    state.support = { ok: false, reason: /iPhone|iPad|iPod/.test(navigator.userAgent) ? 'This needs iOS 26 or newer (Settings → General → Software Update), opened in Safari.' : 'This browser doesn’t support WebGPU yet. Use a recent Chrome, Edge or Safari.' };
    return state.support;
  }
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) { state.support = { ok: false, reason: 'This device’s graphics chip isn’t available to the browser.' }; return state.support; }
    state.f16 = adapter.features.has('shader-f16');
    state.support = { ok: true, f16: state.f16, maxBuffer: adapter.limits.maxStorageBufferBindingSize };
  } catch (e) { state.support = { ok: false, reason: e.message }; }
  return state.support;
}

/** Full WebLLM model id for this device (f16 shaders when available, else f32). */
export function fullId(key) {
  if (!key) return '';
  if (/-MLC$/.test(key)) return key;
  return `${key}-${state.f16 === false ? 'q4f32_1' : 'q4f16_1'}-MLC`;
}
export const keyOf = (id) => String(id || '').replace(/-q4f(16|32)_1-MLC$/, '');
export const info = (keyOrId) => PHONE_MODELS.find((m) => m.key === keyOf(keyOrId));

async function lib() {
  if (!state.lib) state.lib = await import(/* @vite-ignore */ LIB_URL);
  return state.lib;
}

export async function isDownloaded(key) {
  try { await support(); const w = await lib(); return await w.hasModelInCache(fullId(key)); } catch { return false; }
}

export async function downloadedKeys() {
  const out = [];
  for (const m of PHONE_MODELS) if (await isDownloaded(m.key)) out.push(m.key);
  return out;
}

/** Download (if needed) and load a model onto the GPU. onProgress({progress 0..1, text}). */
export async function load(key, onProgress) {
  const id = fullId(key);
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
  let cancelled = false;
  const promise = (async () => {
    const engine = await load(key, onLoad);
    if (cancelled) return {};
    const extra = info(key)?.thinking ? { extra_body: { enable_thinking: false } } : {};
    const stream = await engine.chat.completions.create({ messages: toChat(messages), stream: true, temperature, max_tokens: maxTokens, stream_options: { include_usage: true }, ...extra });
    let usage = null;
    for await (const chunk of stream) {
      if (cancelled) break;
      const d = chunk.choices?.[0]?.delta?.content;
      if (d) onDelta?.(d.replace(/<\/?think>/g, ''));
      if (chunk.usage) usage = chunk.usage;
    }
    return { usage };
  })();
  return { promise, cancel: () => { cancelled = true; try { state.engine?.interruptGenerate(); } catch {} } };
}

/** Fill in a JSON form (structured output). */
export async function extract({ key, system, user, schema }) {
  const engine = await load(key);
  const extra = info(key)?.thinking ? { extra_body: { enable_thinking: false } } : {};
  const r = await engine.chat.completions.create({
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    temperature: 0, max_tokens: 220, response_format: { type: 'json_object', schema: JSON.stringify(schema) }, ...extra,
  });
  const text = r.choices?.[0]?.message?.content || '{}';
  return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1) || '{}');
}

export async function unload() {
  try { await state.engine?.unload(); } catch {}
  state.engine = null; state.loadedId = '';
}

export async function remove(key) {
  if (state.loadedId === fullId(key)) await unload();
  const w = await lib();
  await w.deleteModelAllInfoInCache(fullId(key));
}
