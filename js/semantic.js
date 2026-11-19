// Search by meaning: finds things that mean the same as what you typed, even with
// different words ("car trouble" finds "the engine light came on"). It uses a small
// open model (all-MiniLM-L6-v2, Apache-2.0, ~23 MB) that runs on this device with
// transformers.js. Downloaded once, only after you turn it on. Nothing leaves the device.
import { settings, set, read, write } from './store.js';

const MODEL = 'Xenova/all-MiniLM-L6-v2';
export const SIZE_MB = 23;
export const state = { status: 'idle', progress: 0, error: '' };
let extractor = null, loading = null;
let index = null;              // { [key]: base64 int8 vector }
let saveTimer = 0;

export const enabled = () => !!settings.search?.meaning;
export const ready = () => !!extractor;

/** Download (first time) and start the model. */
export function load(onProgress = () => {}) {
  if (extractor) return Promise.resolve();
  if (settings.privacy?.localOnly && !settings.search?.meaningDownloaded) return Promise.reject(new Error('Local-only mode is on, so the search model can’t be downloaded. Turn it off in Settings → Privacy & Data.'));
  if (loading) return loading;
  state.status = 'loading'; state.error = '';
  loading = (async () => {
    const { library } = await import('./vision.js');   // same transformers.js copy as the picture AI
    const t = await library();
    const files = new Map();
    extractor = await t.pipeline('feature-extraction', MODEL, {
      dtype: 'q8', device: 'wasm',
      progress_callback: (p) => {
        if (p.status === 'progress' && p.total) files.set(p.file, [p.loaded, p.total]);
        let a = 0, b = 0; for (const [l, tt] of files.values()) { a += l; b += tt; }
        state.progress = b ? Math.min(0.99, a / Math.max(b, SIZE_MB * 1e6)) : 0.01;
        onProgress({ progress: state.progress, text: `Downloading the search model (${Math.round(a / 1e6)} of ~${SIZE_MB} MB)` });
      },
    });
    set('search.meaningDownloaded', true);
    state.status = 'ready'; state.progress = 1;
  })().catch((e) => {
    state.status = 'error'; loading = null;
    const m = String(e?.message || e);
    state.error = /fetch|network|Failed to load/i.test(m) ? 'The search model couldn’t download. Check your internet connection and try again (it’s only needed once).' : 'Search by meaning couldn’t start on this device: ' + m.slice(0, 160);
    throw new Error(state.error);
  });
  return loading;
}

// ---------------------------------------------------------------- vectors
/** Text → unit-length vector (384 numbers). */
export async function embed(texts) {
  await load();
  const list = Array.isArray(texts) ? texts : [texts];
  const out = await extractor(list.map((x) => String(x).slice(0, 1000)), { pooling: 'mean', normalize: true });
  const dim = out.dims[out.dims.length - 1];
  return list.map((_, i) => out.data.slice(i * dim, (i + 1) * dim));
}
/** Store vectors small: 1 byte per number (enough for ranking). */
export function pack(v) { let s = ''; for (let i = 0; i < v.length; i++) s += String.fromCharCode((Math.max(-127, Math.min(127, Math.round(v[i] * 400))) + 256) % 256); return btoa(s); }
export function unpack(b64) { const s = atob(b64); const v = new Float32Array(s.length); for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); v[i] = (c > 127 ? c - 256 : c) / 400; } return v; }
export function cosine(a, b) { let d = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return na && nb ? d / Math.sqrt(na * nb) : 0; }
const hash = (s) => { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return (x >>> 0).toString(36); };

/** Everything searchable, as {key, text, result}. */
async function sources() {
  const [memory, links, projects, lists, sessions, people] = await Promise.all(['./memory.js', './links.js', './projects.js', './lists.js', './sessions.js', './people.js'].map((p) => import(p)));
  const out = [];
  const add = (text, result) => { const t = String(text || '').trim(); if (t.length > 3) out.push({ key: hash(t), text: t, result }); };
  for (const m of memory.all()) add(m.text, { kind: 'memory', icon: 'brain', title: m.text, sub: 'Memory', open: { type: 'tab', tab: 'memory' } });
  for (const l of links.all()) add(`${l.title}. ${l.note || ''} ${l.desc || ''}`, { kind: 'link', icon: 'globe', title: l.title, sub: `Saved link · ${l.url}`, open: { type: 'url', url: l.url } });
  for (const p of projects.all()) {
    add(p.name, { kind: 'project', icon: 'folder', title: p.name, sub: 'Project', open: { type: 'project', id: p.id } });
    for (const t of p.tasks) add(t.text, { kind: 'task', icon: t.done ? 'check' : 'list', title: t.text, sub: `Task in ${p.name}`, open: { type: 'project', id: p.id } });
    for (const para of String(p.notes || '').split(/\n{2,}/).slice(0, 30)) add(para, { kind: 'note', icon: 'note', title: para.slice(0, 80), sub: `Notes in ${p.name}`, open: { type: 'project', id: p.id } });
    for (const d of p.docs) for (const chunk of String(d.text || '').split(/\n{2,}/).filter((c) => c.length > 40).slice(0, 25)) add(chunk.slice(0, 600), { kind: 'doc', icon: 'file', title: d.name, sub: chunk.slice(0, 90) + '…', open: { type: 'project', id: p.id } });
  }
  for (const [name, items] of Object.entries(lists.all())) for (const i of items) add(i.text, { kind: 'list', icon: 'list', title: i.text, sub: `${lists.title(name)} list`, open: { type: 'tab', tab: 'lists' } });
  for (const x of people.all()) add(`${x.name}. ${x.note || ''}`, { kind: 'person', icon: 'user', title: x.name, sub: 'Saved person', open: { type: 'tab', tab: 'lists' } });
  for (const e of sessions.state.index.slice(0, 300)) add(`${e.title}. ${e.snippet || ''} ${e.last || ''}`, { kind: 'chat', icon: 'message', title: e.title, sub: String(e.snippet || e.last || '').slice(0, 90), open: { type: 'chat', id: e.id } });
  return out.slice(0, 2500);
}

/** Search by meaning → results like search.js, best first. */
export async function search(q, { limit = 12, min = 0.25 } = {}) {
  const query = String(q || '').trim();
  if (!query) return [];
  await load();
  if (!index) index = await read('meaning-index', {});
  const items = await sources();
  const missing = items.filter((x) => !index[x.key]);
  for (let i = 0; i < missing.length; i += 16) {
    const vs = await embed(missing.slice(i, i + 16).map((x) => x.text));
    vs.forEach((v, j) => { index[missing[i + j].key] = pack(v); });
  }
  if (missing.length) {
    // Forget vectors of things that no longer exist, then save (later, in one go).
    const live = new Set(items.map((x) => x.key));
    for (const k of Object.keys(index)) if (!live.has(k)) delete index[k];
    clearTimeout(saveTimer); saveTimer = setTimeout(() => write('meaning-index', index).catch(() => {}), 1500);
  }
  const [qv] = await embed(query);
  const seen = new Set();
  return items.map((x) => ({ ...x.result, score: cosine(qv, unpack(index[x.key])) }))
    .filter((r) => r.score >= min)
    .sort((a, b) => b.score - a.score)
    .filter((r) => { const k = r.kind + r.title; if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, limit)
    .map((r) => ({ ...r, sub: `${Math.round(r.score * 100)}% match · ${r.sub}` }));
}
