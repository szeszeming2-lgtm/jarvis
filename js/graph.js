// Knowledge map: your projects, people, lists and memories as dots, joined when
// one mentions another (by name). Pure data so it can be tested.
import * as projects from './projects.js';
import * as people from './people.js';
import * as memory from './memory.js';
import * as lists from './lists.js';
import { settings } from './store.js';

const words = (s) => String(s || '').toLowerCase();
const mentions = (text, name) => {
  const n = words(name).trim();
  if (n.length < 3) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}\\p{N}]|$)`, 'iu').test(text);
};

/** → {nodes:[{id, kind, label, ref}], edges:[{a, b}]} */
export function graphFrom({ projectList = [], peopleList = [], memoryList = [], listMap = {}, you = 'You' }) {
  const nodes = [{ id: 'you', kind: 'you', label: you }];
  const edges = [];
  const add = (a, b) => { if (a !== b && !edges.some((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a))) edges.push({ a, b }); };
  for (const p of projectList) {
    nodes.push({ id: 'p:' + p.id, kind: 'project', label: p.name, ref: p.id, text: [p.name, p.goal, p.notes, ...p.tasks.map((t) => t.text), ...p.docs.map((d) => d.name)].join('\n') });
    add('you', 'p:' + p.id);
    for (const t of p.tasks.filter((x) => !x.done).slice(0, 4)) { nodes.push({ id: 't:' + t.id, kind: 'task', label: t.text, text: t.text }); add('p:' + p.id, 't:' + t.id); }
  }
  for (const x of peopleList) { nodes.push({ id: 'h:' + x.id, kind: 'person', label: x.name, text: x.name }); add('you', 'h:' + x.id); }
  for (const [name, items] of Object.entries(listMap)) {
    const open = items.filter((i) => !i.done);
    if (!open.length) continue;
    nodes.push({ id: 'l:' + name, kind: 'list', label: name.charAt(0).toUpperCase() + name.slice(1) + ' list', text: open.map((i) => i.text).join('\n') });
    add('you', 'l:' + name);
  }
  for (const m of memoryList.slice(-20)) nodes.push({ id: 'm:' + m.id, kind: 'memory', label: m.text, text: m.text });
  // Mentions: anything whose text names a project or person.
  const named = nodes.filter((n) => n.kind === 'project' || n.kind === 'person');
  for (const n of nodes) {
    if (n.kind === 'you') continue;
    for (const target of named) if (target.id !== n.id && mentions(n.text, target.label)) add(n.id, target.id);
  }
  // Memories that mention nothing hang off "You".
  for (const n of nodes) if (n.kind === 'memory' && !edges.some((e) => e.a === n.id || e.b === n.id)) add('you', n.id);
  return { nodes: nodes.map(({ text, ...rest }) => rest), edges };
}

export async function buildGraph() {
  return graphFrom({ projectList: projects.all(), peopleList: people.all(), memoryList: memory.all(), listMap: lists.all(), you: settings.userName?.trim() || 'You' });
}
