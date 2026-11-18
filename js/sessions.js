// Conversation sessions. Index in "sessions"; each conversation in "session-<id>".
import { read, write, remove as removeKey, writeSoon } from './store.js';
import { bus, uid, truncate } from './util.js';

export const state = { index: [], current: null };

export async function load() {
  state.index = await read('sessions', []);
  return state.index;
}

const saveIndex = () => writeSoon('sessions', () => state.index, 300);

export function create() {
  const s = { id: uid('c'), title: 'New conversation', created: Date.now(), updated: Date.now(), messages: [], titled: false };
  state.current = s;
  bus.emit('session', s);
  return s;
}

export async function open(id) {
  const s = await read('session-' + id, null);
  if (!s) {
    state.index = state.index.filter((x) => x.id !== id);
    saveIndex();
    bus.emit('sessions', state.index);
    return create();
  }
  state.current = s;
  bus.emit('session', s);
  return s;
}

/** Persist the current conversation (debounced) and refresh its index entry. */
export function touch(s = state.current) {
  if (!s || !s.messages.length) return;
  s.updated = Date.now();
  const firstUser = s.messages.find((m) => m.role === 'user');
  const last = [...s.messages].reverse().find((m) => (m.role === 'assistant' || m.role === 'user') && m.content);
  const entry = {
    id: s.id, title: s.title, created: s.created, updated: s.updated, pinned: !!s.pinned,
    count: s.messages.filter((m) => m.role === 'user').length,
    snippet: truncate(firstUser?.content || '', 120), last: truncate(last?.content || '', 160),
  };
  const i = state.index.findIndex((x) => x.id === s.id);
  if (i >= 0) state.index[i] = entry; else state.index.unshift(entry);
  writeSoon('session-' + s.id, () => s, 350);
  saveIndex();
  bus.emit('sessions', state.index);
}

export function saveNow(s = state.current) {
  if (!s || !s.messages.length) return Promise.resolve();
  touch(s);
  return write('session-' + s.id, s);
}

export async function rename(id, title) {
  title = truncate(String(title).trim() || 'Untitled', 80);
  const e = state.index.find((x) => x.id === id);
  if (e) e.title = title;
  if (state.current?.id === id) { state.current.title = title; state.current.titled = true; touch(); }
  else {
    const s = await read('session-' + id, null);
    if (s) { s.title = title; s.titled = true; await write('session-' + id, s); }
  }
  saveIndex();
  bus.emit('sessions', state.index);
}

export async function pin(id, on) {
  const e = state.index.find((x) => x.id === id);
  if (e) e.pinned = on;
  if (state.current?.id === id) state.current.pinned = on;
  const s = state.current?.id === id ? state.current : await read('session-' + id, null);
  if (s) { s.pinned = on; await write('session-' + id, s); }
  saveIndex();
  bus.emit('sessions', state.index);
}

export async function remove(id) {
  state.index = state.index.filter((x) => x.id !== id);
  await removeKey('session-' + id);
  saveIndex();
  bus.emit('sessions', state.index);
  if (state.current?.id === id) create();
}

export async function removeAll() {
  for (const e of state.index) await removeKey('session-' + e.id);
  state.index = [];
  await write('sessions', []);
  bus.emit('sessions', state.index);
  create();
}

export function autoTitle(s) {
  const first = s.messages.find((m) => m.role === 'user')?.content || 'New conversation';
  let t = first.replace(/\s+/g, ' ').replace(/^(hey|hi|hello|ok|okay)?\s*(jarvis)?[,!.\s]*/i, '').trim();
  t = t.charAt(0).toUpperCase() + t.slice(1);
  return truncate(t || 'New conversation', 48);
}

export function toMarkdown(s, assistantName = 'JARVIS') {
  const lines = [`# ${s.title}`, '', `_${new Date(s.created).toLocaleString()}_`, ''];
  for (const m of s.messages) {
    if (m.role === 'user') lines.push(`**You:** ${m.content}`, '');
    else if (m.role === 'assistant' && m.content) lines.push(`**${assistantName}:** ${m.content}`, '');
    else if (m.role === 'tool' && m.display) lines.push(`> ${m.display}`, '');
  }
  return lines.join('\n');
}

export async function exportAll() {
  const out = [];
  for (const e of state.index) { const s = await read('session-' + e.id, null); if (s) out.push(s); }
  return out;
}

export function search(q) {
  q = q.trim().toLowerCase();
  const list = [...state.index].sort((a, b) => (b.pinned - a.pinned) || (b.updated - a.updated));
  if (!q) return list;
  return list.filter((e) => [e.title, e.snippet, e.last].some((t) => (t || '').toLowerCase().includes(q)));
}
