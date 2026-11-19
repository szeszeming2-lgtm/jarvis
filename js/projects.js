// Projects: a folder for each thing you're working on, with notes, tasks (and
// progress), documents and linked conversations. Saved only on this device.
import { read, write, tombstone } from './store.js';
import { bus, uid } from './util.js';

let projects = [];
export async function load() { projects = await read('projects', []); return projects; }
const save = () => { write('projects', projects).catch(console.error); bus.emit('projects', projects); };
export const all = () => projects.filter((p) => !p.archived);
export const archived = () => projects.filter((p) => p.archived);
export const get = (id) => projects.find((p) => p.id === id);

const norm = (s) => String(s || '').toLowerCase().replace(/^(the|my|our)\s+/, '').replace(/\s+project$/, '').trim();
export function find(name) {
  const q = norm(name);
  if (!q) return null;
  return projects.find((p) => norm(p.name) === q) || projects.find((p) => norm(p.name).includes(q) || q.includes(norm(p.name)));
}

const touch = (p) => { p.updated = Date.now(); save(); return p; };

export function create(name, { goal = '', icon = 'folder' } = {}) {
  name = String(name || '').trim().replace(/^(?:a |the |my )/i, '').replace(/\s+project$/i, '');
  if (!name) throw new Error('What should the project be called?');
  if (find(name) && norm(find(name).name) === norm(name)) return find(name);
  const p = { id: uid('pj'), name: name.charAt(0).toUpperCase() + name.slice(1), icon, goal, notes: '', tasks: [], docs: [], chats: [], created: Date.now(), updated: Date.now() };
  projects.unshift(p);
  save();
  return p;
}

export function rename(id, name) { const p = get(id); if (p && name.trim()) { p.name = name.trim(); touch(p); } }
export function setNotes(id, notes) { const p = get(id); if (p) { p.notes = String(notes).slice(0, 100000); touch(p); } }
export function setGoal(id, goal) { const p = get(id); if (p) { p.goal = String(goal).slice(0, 300); touch(p); } }
export function archive(id, on = true) { const p = get(id); if (p) { p.archived = on; touch(p); } }
export function remove(id) { tombstone('project:' + id); projects = projects.filter((p) => p.id !== id); save(); }

export function addTask(id, text, due = null) {
  const p = get(id);
  if (!p) throw new Error('That project is gone.');
  const items = String(text || '').split(/\s*[\n;]\s*/).map((s) => s.trim()).filter(Boolean);
  const added = items.map((t) => ({ id: uid('t'), text: t.slice(0, 300), done: false, due, added: Date.now() }));
  p.tasks.push(...added);
  touch(p);
  return added;
}
export function toggleTask(id, taskId, done) { const p = get(id); const t = p?.tasks.find((x) => x.id === taskId); if (t) { t.done = done ?? !t.done; t.doneAt = t.done ? Date.now() : null; touch(p); } }
export function removeTask(id, taskId) { const p = get(id); if (p) { p.tasks = p.tasks.filter((t) => t.id !== taskId); touch(p); } }
/** Tick off a task by words ("finish the logo"). */
export function completeTask(id, words) {
  const p = get(id);
  const q = norm(words);
  const t = p?.tasks.find((x) => !x.done && norm(x.text) === q) || p?.tasks.find((x) => !x.done && norm(x.text).includes(q));
  if (!t) return null;
  toggleTask(id, t.id, true);
  return t;
}

export function addDoc(id, { name, text }) {
  const p = get(id);
  if (!p) throw new Error('That project is gone.');
  const d = { id: uid('d'), name: String(name || 'Document').slice(0, 120), text: String(text || '').slice(0, 60000), added: Date.now() };
  p.docs.push(d);
  touch(p);
  return d;
}
export function removeDoc(id, docId) { const p = get(id); if (p) { p.docs = p.docs.filter((d) => d.id !== docId); touch(p); } }

export function linkChat(id, sessionId) { const p = get(id); if (p && sessionId && !p.chats.includes(sessionId)) { p.chats.push(sessionId); touch(p); } }
export function unlinkChat(id, sessionId) { const p = get(id); if (p) { p.chats = p.chats.filter((c) => c !== sessionId); touch(p); } }
export const projectOfChat = (sessionId) => projects.find((p) => p.chats.includes(sessionId));

/** {done, total, pct} */
export function progress(p) {
  const total = p.tasks.length, done = p.tasks.filter((t) => t.done).length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

/** Short text the AI gets when a chat belongs to a project. */
export function contextFor(p) {
  if (!p) return '';
  const open = p.tasks.filter((t) => !t.done).slice(0, 12).map((t) => '- ' + t.text).join('\n');
  const { done, total } = progress(p);
  return `This conversation belongs to the user's project "${p.name}"${p.goal ? ` (goal: ${p.goal})` : ''}. Progress: ${done} of ${total} tasks done.${open ? `\nOpen tasks:\n${open}` : ''}${p.notes ? `\nProject notes (start):\n${p.notes.slice(0, 1200)}` : ''}${p.docs.length ? `\nDocuments in the project: ${p.docs.map((d) => d.name).join(', ')}` : ''}`;
}
