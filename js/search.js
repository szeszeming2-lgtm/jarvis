// Universal search: one box that looks through chats, projects, lists, people,
// memories, reminders, plugins, notes and settings (and files, in the Mac app).
import { read } from './store.js';
import * as sessions from './sessions.js';
import * as projects from './projects.js';
import * as lists from './lists.js';
import * as people from './people.js';
import * as memory from './memory.js';
import * as reminders from './reminders.js';
import * as skills from './skills.js';
import * as links from './links.js';
import { describeWhen } from './when.js';

export const SETTINGS_PAGES = [
  ['general', 'General settings', 'name, number, home address, briefing, link devices'], ['profiles', 'Profiles', 'users, people, family, switch, account, picture'], ['companion', 'iPhone & Mac', 'phone, remote, siri, shortcuts, pair, status'], ['models', 'AI models', 'download, choose model, ollama'], ['voice', 'Voice', 'speak, voice, wake word, microphone, push to talk'],
  ['plugins', 'Plugins', 'plugin store, add plugin'], ['workout', 'Workouts', 'exercise, reps, coach'], ['lists', 'Lists & People', 'shopping, to-do, contacts'],
  ['sync', 'Link devices', 'sync, sign in, iPad, iPhone'], ['projects', 'Projects', 'tasks, notes, documents, knowledge map'], ['planner', 'Planner', 'habits, goals, budget, stopwatch, voice notes'],
  ['memory', 'Memory', 'remember, forget'], ['links', 'Saved links', 'bookmarks, read later, reading list'], ['appearance', 'Appearance', 'theme, colors, dark, light, animations'], ['home', 'Home screen', 'dashboard, widgets, cards'],
  ['shortcuts', 'Keyboard shortcuts', 'keys, hotkeys'], ['permissions', 'Permissions', 'allow, ask, privacy, security'], ['privacy', 'Privacy & data', 'export, backup, restore, delete'], ['about', 'About & help', 'features, version, help'],
];

const terms = (q) => String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
const hit = (text, ts) => { const s = String(text || '').toLowerCase(); return ts.every((t) => s.includes(t)); };
function snippet(text, ts, len = 90) {
  const s = String(text || '').replace(/\s+/g, ' ');
  const i = Math.max(0, s.toLowerCase().indexOf(ts[0]) - 30);
  return (i > 0 ? '…' : '') + s.slice(i, i + len) + (s.length > i + len ? '…' : '');
}

/** → [{kind, title, sub, open: {type, id, …}}], best first, at most `limit`. */
export async function search(q, { limit = 40, deep = true } = {}) {
  const ts = terms(q);
  if (!ts.length) return [];
  const out = [];
  const push = (r) => { if (out.length < limit * 2) out.push(r); };
  for (const p of projects.all()) {
    if (hit(p.name, ts)) push({ kind: 'project', icon: 'folder', title: p.name, sub: `Project · ${projects.progress(p).pct}% done`, score: 10, open: { type: 'project', id: p.id } });
    for (const t of p.tasks) if (hit(t.text, ts)) push({ kind: 'task', icon: t.done ? 'check' : 'list', title: t.text, sub: `Task in ${p.name}${t.done ? ' · done' : ''}`, score: 6, open: { type: 'project', id: p.id } });
    if (p.notes && hit(p.notes, ts)) push({ kind: 'note', icon: 'note', title: `Notes: ${p.name}`, sub: snippet(p.notes, ts), score: 5, open: { type: 'project', id: p.id } });
    for (const d of p.docs) if (hit(d.name + ' ' + d.text, ts)) push({ kind: 'doc', icon: 'file', title: d.name, sub: `Document in ${p.name} · ${snippet(d.text, ts, 70)}`, score: 5, open: { type: 'project', id: p.id } });
  }
  for (const x of people.all()) if (hit([x.name, x.phone, ...(x.aliases || [])].join(' '), ts)) push({ kind: 'person', icon: 'user', title: x.name, sub: x.phone || 'Saved person', score: 8, open: { type: 'tab', tab: 'lists' } });
  for (const [name, items] of Object.entries(lists.all())) for (const i of items) if (hit(i.text, ts)) push({ kind: 'list', icon: 'list', title: i.text, sub: `${lists.title(name)} list${i.done ? ' · done' : ''}`, score: 6, open: { type: 'tab', tab: 'lists' } });
  for (const m of memory.all()) if (hit(m.text, ts)) push({ kind: 'memory', icon: 'brain', title: m.text, sub: 'Memory', score: 5, open: { type: 'tab', tab: 'memory' } });
  for (const r of reminders.upcoming()) if (hit(r.text, ts)) push({ kind: 'reminder', icon: 'bell', title: r.text, sub: `Reminder · ${describeWhen(new Date(r.due))}`, score: 7, open: { type: 'tab', tab: 'lists' } });
  for (const l of links.all()) if (hit(`${l.title} ${l.url} ${l.note} ${l.desc || ''}`, ts)) push({ kind: 'link', icon: 'globe', title: l.title, sub: `Saved link · ${l.url}`, score: 6, open: { type: 'url', url: l.url } });
  for (const s of skills.all()) if (hit(`${s.name} ${s.description} ${s.command}`, ts)) push({ kind: 'plugin', icon: s.icon || 'puzzle', title: s.name, sub: `Plugin · /${s.command}`, score: 4, open: { type: 'tab', tab: 'plugins' } });
  for (const [id, title, keys] of SETTINGS_PAGES) if (hit(`${title} ${keys}`, ts)) push({ kind: 'setting', icon: 'gear', title, sub: 'Settings', score: 3, open: { type: 'tab', tab: id } });
  // Conversations: titles and previews first, then the full text of recent ones.
  const seen = new Set();
  for (const e of sessions.state.index) {
    if (hit(`${e.title} ${e.snippet} ${e.last}`, ts)) { seen.add(e.id); push({ kind: 'chat', icon: 'message', title: e.title, sub: snippet(`${e.snippet} ${e.last}`, ts), score: 7, open: { type: 'chat', id: e.id } }); }
  }
  if (deep) {
    for (const e of sessions.state.index.slice(0, 150)) {
      if (seen.has(e.id)) continue;
      const s = await read('session-' + e.id, null);
      const m = s?.messages?.find((x) => (x.role === 'user' || x.role === 'assistant') && hit(x.content, ts));
      if (m) push({ kind: 'chat', icon: 'message', title: e.title, sub: snippet(m.content, ts), score: 4, open: { type: 'chat', id: e.id } });
      if (out.length >= limit * 2) break;
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
