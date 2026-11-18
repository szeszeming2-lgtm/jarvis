// Local AI engine (Ollama) client: detection, models, chat streaming, downloads.
import { call, stream, isNative } from './host.js';
import { settings } from './store.js';
import { bus } from './util.js';
import * as phone from './webllm.js';

/** 'ollama' = Ollama on a computer; 'phone' = a small model running inside this browser (WebLLM). */
export const isPhone = () => settings.ai.provider === 'phone';

export const engine = {
  status: 'unknown',   // unknown | checking | offline | online | not-installed
  version: '',
  installed: null,
  models: [],          // [{name, size, details, capabilities}]
  running: [],         // from /api/ps
  caps: new Map(),     // model -> {capabilities, context}
  lastSpeed: null,     // tokens per second
  lastError: '',
};

const url = () => settings.ai.url.replace(/\/+$/, '');

function req(path, method = 'GET', body) {
  return call('ollama.request', { url: url(), path, method, body });
}

async function detectPhone() {
  engine.provider = 'phone';
  const s = await phone.support();
  engine.version = s.wasm ? 'transformers.js (processor)' : 'WebLLM';
  if (!s.ok) { engine.status = 'unsupported'; engine.lastError = s.reason; engine.models = []; bus.emit('engine', engine); return engine; }
  let keys = [];
  try { keys = await phone.downloadedKeys(); } catch (e) { engine.lastError = e.message; }
  engine.models = keys.map((k) => { const i = phone.info(k); const m = { name: k, label: i?.name || k, size: (i?.size || 0) * 1e9, details: { parameter_size: i?.name || '' }, capabilities: ['completion'], phone: true }; engine.caps.set(k, m); return m; });
  engine.running = phone.state.loadedId ? [{ name: phone.keyOf(phone.state.loadedId) }] : [];
  engine.status = 'online';
  if (!settings.ai.model || !keys.includes(settings.ai.model)) { const pick = phone.models().find((m) => m.pick)?.key; settings.ai.model = keys.includes(pick) ? pick : keys[0] || ''; bus.emit('settings', { path: 'ai.model', value: settings.ai.model }); }
  bus.emit('engine', engine);
  return engine;
}

/** Switch where the AI runs, remembering the model chosen for each. */
export async function switchProvider(p) {
  if (settings.ai.provider === p) return detect();
  settings.ai.byProvider = { ...(settings.ai.byProvider || {}), [settings.ai.provider || 'ollama']: settings.ai.model };
  settings.ai.provider = p;
  settings.ai.model = settings.ai.byProvider[p] || '';
  engine.models = []; engine.running = []; engine.status = 'unknown'; engine.lastSpeed = null;
  bus.emit('settings', { path: 'ai.provider', value: p });
  return detect();
}

export async function detect() {
  if (isPhone()) return detectPhone();
  engine.provider = 'ollama';
  // Only show "checking" the first time, so periodic re-checks don't flicker the UI.
  if (engine.status === 'unknown') { engine.status = 'checking'; bus.emit('engine', engine); }
  try {
    const d = await call('ollama.detect', { url: url() });
    engine.installed = d.installed;
    engine.version = d.version || '';
    engine.appPath = d.appPath || '';
    engine.lnaDenied = !!d.lnaDenied;
    if (d.running && d.blocked) {
      engine.status = 'blocked';   // running, but it refuses this website (web version)
      engine.models = [];
    } else if (d.running) {
      engine.status = 'online';
      await refreshModels();
    } else {
      engine.status = d.installed === false ? 'not-installed' : 'offline';
      engine.models = [];
    }
  } catch (e) {
    engine.status = 'offline';
    engine.lastError = e.message;
  }
  bus.emit('engine', engine);
  return engine;
}

export async function refreshModels() {
  if (isPhone()) { await detectPhone(); return engine.models; }
  const tags = await req('/api/tags');
  engine.models = (tags.models || []).sort((a, b) => a.size - b.size);
  // Capabilities come with /api/tags on new Ollama versions; ask /api/show otherwise.
  await Promise.all(engine.models.map(async (m) => {
    if (!m.capabilities) {
      try {
        const s = await req('/api/show', 'POST', { model: m.name });
        m.capabilities = s.capabilities || ['completion'];
        m.contextMax = findCtx(s.model_info);
      } catch { m.capabilities = ['completion']; }
    } else if (!m.contextMax) m.contextMax = m.details?.context_length || null;
    engine.caps.set(m.name, m);
  }));
  try { engine.running = (await req('/api/ps')).models || []; } catch { engine.running = []; }
  // Pick a model if none chosen (or the chosen one was removed).
  if (!settings.ai.model || !engine.models.find((m) => m.name === settings.ai.model)) {
    const pick = recommendInstalled();
    if (pick) { settings.ai.model = pick.name; bus.emit('settings', { path: 'ai.model', value: pick.name }); }
  }
  bus.emit('engine', engine);
  return engine.models;
}

function findCtx(info = {}) {
  for (const [k, v] of Object.entries(info)) if (k.endsWith('.context_length')) return v;
  return null;
}

/** Best installed chat model for this device's memory. */
export function recommendInstalled(ramGB = window.__deviceRam || 8) {
  const chat = engine.models.filter((m) => !(m.capabilities || []).includes('embedding') || (m.capabilities || []).includes('completion'))
    .filter((m) => !/embed/i.test(m.name));
  if (!chat.length) return null;
  const budget = ramGB * 1e9 * 0.45;
  const fits = chat.filter((m) => m.size <= budget);
  return (fits.length ? fits[fits.length - 1] : chat[0]);
}

/** A model that can look at images: the chosen one, the main model if it can see, or any installed vision model. */
export function visionModel() {
  if (isPhone()) return '';
  const can = (n) => n && (engine.caps.get(n)?.capabilities || []).includes('vision');
  if (can(settings.ai.visionModel)) return settings.ai.visionModel;
  if (can(settings.ai.model)) return settings.ai.model;
  return engine.models.find((m) => (m.capabilities || []).includes('vision'))?.name || '';
}

export const modelInfo = (name = settings.ai.model) => engine.caps.get(name) || engine.models.find((m) => m.name === name);
export const hasCap = (cap, name = settings.ai.model) => (modelInfo(name)?.capabilities || []).includes(cap);

export function contextLength(ramGB = window.__deviceRam || 8) {
  if (isPhone()) return phone.state.mode === 'wasm' ? 1536 : 3072; // phones: shorter prompts answer much faster (the processor backup even more so)
  const c = settings.ai.contextLength;
  if (c !== 'auto') return Number(c);
  const max = modelInfo()?.contextMax || 8192;
  const pick = ramGB <= 8 ? 4096 : ramGB <= 16 ? 8192 : 16384;
  return Math.min(pick, max);
}

/**
 * Stream a chat. handlers: onContent(delta), onThinking(delta), onTools(calls), onDone(final)
 * Returns { promise, cancel }.
 */
export function chat({ model, messages, tools, think, options = {} }, handlers = {}) {
  if (isPhone()) {
    const key = model || settings.ai.model;
    engine.lastRequest = { model: key, tools: [], messages: messages.length, provider: 'phone' };
    const t0 = performance.now();
    const s = phone.chat({ key, messages, temperature: Number(settings.ai.temperature), onDelta: handlers.onContent, onLoad: handlers.onLoad });
    return {
      cancel: s.cancel,
      promise: s.promise.then(({ usage } = {}) => {
        const tps = usage?.extra?.decode_tokens_per_s;
        if (tps) engine.lastSpeed = tps;
        engine.running = [{ name: key }];
        bus.emit('engine', engine);
        return { final: { eval_count: usage?.completion_tokens || 0, total_duration: (performance.now() - t0) * 1e6 }, toolCalls: [] };
      }),
    };
  }
  const body = {
    model: model || settings.ai.model,
    messages,
    stream: true,
    keep_alive: keepAliveValue(),
    options: { temperature: Number(settings.ai.temperature), num_ctx: contextLength(), ...options },
  };
  if (tools?.length) body.tools = tools;
  if (hasCap('thinking', body.model)) body.think = !!think;
  engine.lastRequest = { model: body.model, tools: (body.tools || []).map((t) => t.function.name), messages: messages.length, num_ctx: body.options.num_ctx };
  let final = null;
  const toolCalls = [];
  const s = stream(url(), '/api/chat', body, (c) => {
    if (c.error) throw new Error(c.error);
    const m = c.message || {};
    if (m.thinking) handlers.onThinking?.(m.thinking);
    if (m.content) handlers.onContent?.(m.content);
    if (m.tool_calls?.length) toolCalls.push(...m.tool_calls);
    if (c.done) {
      final = c;
      if (c.eval_count && c.eval_duration) engine.lastSpeed = c.eval_count / (c.eval_duration / 1e9);
      engine.lastStats = { prompt: c.prompt_eval_count, output: c.eval_count, total: c.total_duration };
      bus.emit('engine', engine);
      refreshRunning();
    }
  });
  return {
    cancel: s.cancel,
    promise: s.promise.then(() => ({ final, toolCalls })),
  };
}

/** Fill in a JSON form reliably (Ollama structured output). */
export async function extract({ system, user, schema, model = settings.ai.model }) {
  if (isPhone()) return phone.extract({ key: model, system, user, schema });
  const body = { model, stream: false, format: schema, keep_alive: keepAliveValue(), options: { temperature: 0, num_predict: 200 }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] };
  if (hasCap('thinking', model)) body.think = false;
  const r = await req('/api/chat', 'POST', body);
  return JSON.parse(r.message?.content || '{}');
}

/** One-shot, non-streaming generation for small jobs (titles). */
export async function quick(prompt, { maxTokens = 24 } = {}) {
  if (isPhone()) {
    let out = '';
    await phone.chat({ key: settings.ai.model, messages: [{ role: 'system', content: 'Answer briefly.' }, { role: 'user', content: prompt }], temperature: 0.3, maxTokens, onDelta: (d) => (out += d) }).promise;
    return out.trim();
  }
  const body = { model: settings.ai.model, stream: false, messages: [{ role: 'user', content: prompt }], keep_alive: keepAliveValue(), options: { temperature: 0.3, num_predict: maxTokens } };
  if (hasCap('thinking')) body.think = false;
  const r = await req('/api/chat', 'POST', body);
  return r.message?.content?.trim() || '';
}

function keepAliveValue() {
  const k = settings.ai.keepAlive;
  return k === '-1' || k === -1 ? -1 : k === '0' || k === 0 ? 0 : k;
}

export function pull(name, onProgress) {
  if (isPhone()) {
    let stop = false;
    const promise = phone.load(name, (p) => { if (!stop) onProgress?.({ status: p.text, completed: Math.round(p.progress * 1000), total: 1000 }); }).then(() => detectPhone());
    return { promise, cancel: () => { stop = true; } };
  }
  return stream(url(), '/api/pull', { model: name, stream: true }, (c) => {
    if (c.error) throw new Error(c.error);
    onProgress?.(c);
  });
}

export async function refreshRunning() {
  if (isPhone()) return;
  try { engine.running = (await req('/api/ps')).models || []; bus.emit('engine', engine); } catch {}
}

export async function remove(name) { if (isPhone()) { await phone.remove(name); await detectPhone(); return; } await req('/api/delete', 'DELETE', { model: name }); await refreshModels(); }
export async function unload(name) { if (isPhone()) { await phone.unload(); await detectPhone(); return; } await req('/api/chat', 'POST', { model: name, messages: [], keep_alive: 0 }); await refreshModels(); }
export async function warm(name = settings.ai.model) {
  if (!name) return;
  if (isPhone()) { try { await phone.load(name); engine.running = [{ name }]; bus.emit('engine', engine); } catch {} return; }
  try { await req('/api/chat', 'POST', { model: name, messages: [], keep_alive: keepAliveValue() }); } catch {}
  try { engine.running = (await req('/api/ps')).models || []; bus.emit('engine', engine); } catch {}
}

export async function startEngine() {
  if (!isNative) throw new Error('Open the Ollama app on your computer, then press Check again.');
  return call('ollama.start', {});
}

/** Curated, free, open models from the Ollama library. Sizes are approximate downloads. */
export const CATALOG = [
  { name: 'qwen3:0.6b', label: 'Qwen3 0.6B', size: 0.52, ram: 4, tier: 'Tiny', note: 'Fastest. Basic chat on any computer.', tools: true },
  { name: 'gemma3:1b', label: 'Gemma 3 1B', size: 0.82, ram: 4, tier: 'Tiny', note: 'Small and friendly. Good for older Macs.' },
  { name: 'llama3.2:1b', label: 'Llama 3.2 1B', size: 1.3, ram: 4, tier: 'Tiny', note: 'Light everyday chat.', tools: true },
  { name: 'qwen3:1.7b', label: 'Qwen3 1.7B', size: 1.4, ram: 8, tier: 'Light', note: 'Great speed/quality balance. Uses abilities well.', tools: true, pick: true },
  { name: 'llama3.2:3b', label: 'Llama 3.2 3B', size: 2.0, ram: 8, tier: 'Light', note: 'Solid all-rounder for 8 GB computers.', tools: true },
  { name: 'qwen3:4b', label: 'Qwen3 4B', size: 2.6, ram: 8, tier: 'Light', note: 'Smarter, still quick on Apple Silicon.', tools: true },
  { name: 'moondream', label: 'Moondream 2', size: 1.7, ram: 4, tier: 'Tiny', note: 'Tiny vision model: says what is in a picture or on screen. Good for older computers.', vision: true },
  { name: 'qwen2.5vl:3b', label: 'Qwen2.5-VL 3B', size: 3.2, ram: 8, tier: 'Light', note: 'Vision model that reads screen text well. Best for “what’s this?” on screen.', vision: true },
  { name: 'gemma3:4b', label: 'Gemma 3 4B', size: 3.3, ram: 8, tier: 'Light', note: 'Strong writing. Can also look at images.', vision: true },
  { name: 'qwen3:8b', label: 'Qwen3 8B', size: 5.2, ram: 16, tier: 'Balanced', note: 'Much better knowledge and reasoning.', tools: true },
  { name: 'llama3.1:8b', label: 'Llama 3.1 8B', size: 4.9, ram: 16, tier: 'Balanced', note: 'Popular, reliable general model.', tools: true },
  { name: 'gemma3:12b', label: 'Gemma 3 12B', size: 8.1, ram: 16, tier: 'Balanced', note: 'High quality writing and analysis. Can see images.', vision: true },
  { name: 'qwen3:14b', label: 'Qwen3 14B', size: 9.3, ram: 24, tier: 'Power', note: 'Near top quality on 24–32 GB machines.', tools: true },
  { name: 'gemma3:27b', label: 'Gemma 3 27B', size: 17, ram: 32, tier: 'Power', note: 'Best quality here. Needs a strong computer. Can see images.', vision: true },
];

export function bestVisionPick(ramGB = 8) {
  return CATALOG.find((m) => m.name === (ramGB >= 8 ? 'qwen2.5vl:3b' : 'moondream'));
}
export function catalogFor(ramGB) {
  return CATALOG.map((m) => ({ ...m, fits: m.ram <= Math.max(4, ramGB || 8), installed: engine.models.some((x) => x.name === m.name) }));
}

export function bestCatalogPick(ramGB = 8) {
  if (ramGB < 8) return CATALOG.find((m) => m.name === 'qwen3:0.6b');
  if (ramGB < 16) return CATALOG.find((m) => m.name === 'qwen3:1.7b');
  if (ramGB < 24) return CATALOG.find((m) => m.name === 'qwen3:4b');
  return CATALOG.find((m) => m.name === 'qwen3:8b');
}
