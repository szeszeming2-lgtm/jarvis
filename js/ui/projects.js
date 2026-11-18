// Projects tab: your projects (notes, tasks with progress, documents, conversations)
// and a knowledge map that shows how your projects, people, lists and memories connect.
import { h, iconNode, bus, timeAgo } from '../util.js';
import { registerTab, closeSheet } from './sheets.js';
import { section, toast, dialog, callout } from './common.js';
import { call } from '../host.js';
import * as projects from '../projects.js';
import * as sessions from '../sessions.js';

let openId = null;
let view = 'list'; // list | map
/** Open a project's page next time the Projects tab is shown. */
export function openProject(id) { openId = id; view = 'list'; }

registerTab('projects', (body) => {
  const draw = () => {
    body.replaceChildren();
    const p = openId && projects.get(openId);
    if (p) return drawProject(body, p);
    body.append(
      h('div', { class: 'seg', style: { marginBottom: '12px' } },
        h('button', { class: view === 'list' ? 'on' : '', type: 'button', onclick: () => { view = 'list'; draw(); } }, 'Projects'),
        h('button', { class: view === 'map' ? 'on' : '', type: 'button', onclick: () => { view = 'map'; draw(); } }, 'Knowledge map')));
    if (view === 'map') return drawMap(body);
    const list = h('div', { class: 'list' });
    for (const x of projects.all()) {
      const pr = projects.progress(x);
      list.append(h('button', { class: 'item project-row', type: 'button', onclick: () => { openId = x.id; draw(); } },
        h('span', { class: 'item-ic' }, iconNode(x.icon || 'folder')),
        h('div', { class: 'item-main' },
          h('div', { class: 'item-title', text: x.name }),
          h('div', { class: 'item-sub', text: `${pr.total ? `${pr.done}/${pr.total} tasks` : 'No tasks yet'} · ${x.docs.length} doc${x.docs.length === 1 ? '' : 's'} · ${x.chats.length} chat${x.chats.length === 1 ? '' : 's'} · ${timeAgo(x.updated)}` }),
          h('div', { class: 'progress' }, h('i', { style: { width: pr.pct + '%' } }))),
        h('span', { class: 'mono muted', text: pr.pct + '%' })));
    }
    if (!projects.all().length) list.append(h('div', { class: 'empty', text: 'No projects yet. Make one for anything you’re working on: a trip, a school subject, a business idea. Or say “new project kitchen renovation”.' }));
    body.append(
      section('Your projects', 'Notes, tasks, documents and chats in one place. Saved only on this device.', list,
        h('button', { class: 'btn btn-sm btn-primary', type: 'button', style: { marginTop: '10px' }, onclick: async () => {
          const name = await dialog({ title: 'New project', text: 'What is it called?', input: '', okLabel: 'Create' });
          if (!name?.trim()) return;
          const np = projects.create(name); openId = np.id; draw();
        } }, iconNode('plus'), 'New project')),
      projects.archived().length ? section('Archived', '', h('div', { class: 'list' }, ...projects.archived().map((x) => h('div', { class: 'item' }, h('span', { class: 'item-ic' }, iconNode('folder')), h('div', { class: 'item-main' }, h('div', { class: 'item-title', text: x.name })),
        h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Restore', onclick: () => projects.archive(x.id, false) }))))) : '');
  };

  function drawProject(box, p) {
    const pr = projects.progress(p);
    const back = h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => { openId = null; draw(); } }, iconNode('chevron'), 'All projects');
    back.querySelector('svg')?.style.setProperty('transform', 'rotate(90deg)');
    const title = h('input', { class: 'field project-title', value: p.name, 'aria-label': 'Project name' });
    title.addEventListener('change', () => projects.rename(p.id, title.value));
    const goal = h('input', { class: 'field', value: p.goal || '', placeholder: 'Goal (optional): what does done look like?', 'aria-label': 'Project goal', style: { width: '100%' } });
    goal.addEventListener('change', () => projects.setGoal(p.id, goal.value));
    // Tasks
    const taskIn = h('input', { class: 'field', placeholder: 'Add a task and press Enter', 'aria-label': 'New task', style: { flex: 1 } });
    const addTask = () => { if (!taskIn.value.trim()) return; projects.addTask(p.id, taskIn.value); taskIn.value = ''; };
    taskIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addTask(); } });
    const tasks = h('div', { class: 'list' }, ...[...p.tasks.filter((t) => !t.done), ...p.tasks.filter((t) => t.done)].map((t) => h('div', { class: 'item' },
      h('input', { type: 'checkbox', checked: t.done, 'aria-label': `Done: ${t.text}`, onchange: (e) => projects.toggleTask(p.id, t.id, e.target.checked) }),
      h('div', { class: 'item-main' }, h('div', { class: 'item-title', style: { textDecoration: t.done ? 'line-through' : 'none', opacity: t.done ? 0.6 : 1 }, text: t.text })),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Delete ${t.text}`, onclick: () => projects.removeTask(p.id, t.id) }, iconNode('x')))));
    // Notes (saved as you type)
    const notes = h('textarea', { class: 'field', rows: 6, placeholder: 'Notes, ideas, links…', 'aria-label': 'Project notes', style: { width: '100%', fontFamily: 'inherit', fontSize: '13.5px', lineHeight: 1.5 } });
    notes.value = p.notes || '';
    let t0 = 0; notes.addEventListener('input', () => { clearTimeout(t0); t0 = setTimeout(() => projects.setNotes(p.id, notes.value), 500); });
    // Documents
    const docs = h('div', { class: 'list' }, ...p.docs.map((d) => h('div', { class: 'item' }, h('span', { class: 'item-ic' }, iconNode('file')),
      h('div', { class: 'item-main' }, h('div', { class: 'item-title', text: d.name }), h('div', { class: 'item-sub', text: `${Math.round(d.text.length / 100) / 10}k characters · ${timeAgo(d.added)}` })),
      h('div', { class: 'item-actions' },
        h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Ask about it', onclick: async () => { closeSheet(); const a = await import('../assistant.js'); projects.linkChat(p.id, sessions.state.current?.id); a.send(`Summarize “${d.name}” in a few key points.`, { attachment: { name: d.name, path: d.name, text: d.text.slice(0, 24000) } }); } }),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Remove ${d.name}`, onclick: () => projects.removeDoc(p.id, d.id) }, iconNode('trash'))))));
    const addDoc = async () => {
      try {
        const f = await call('file.open', { accept: '.txt,.md,.csv,.json,.html,.pdf,.docx,.xlsx', types: ['txt', 'md', 'csv', 'json', 'html', 'pdf', 'docx', 'xlsx'] });
        if (!f) return;
        const { readAnyFile } = await import('../documents.js');
        const text = await readAnyFile(f);
        projects.addDoc(p.id, { name: f.name, text });
        toast(`Added ${f.name}`);
      } catch (e) { toast(e.message, { bad: true }); }
    };
    // Conversations
    const chats = h('div', { class: 'list' }, ...p.chats.map((cid) => { const e = sessions.state.index.find((x) => x.id === cid); if (!e) return null; return h('div', { class: 'item' }, h('span', { class: 'item-ic' }, iconNode('message')),
      h('div', { class: 'item-main' }, h('div', { class: 'item-title', text: e.title }), h('div', { class: 'item-sub', text: timeAgo(e.updated) })),
      h('div', { class: 'item-actions' }, h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Open', onclick: async () => { await sessions.open(cid); closeSheet(); } }),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Unlink chat', onclick: () => projects.unlinkChat(p.id, cid) }, iconNode('x')))); }).filter(Boolean));
    box.append(
      h('div', { class: 'flex', style: { justifyContent: 'space-between', marginBottom: '10px' } }, back,
        h('div', { class: 'flex' },
          h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Archive', onclick: () => { projects.archive(p.id); openId = null; draw(); } }),
          h('button', { class: 'btn btn-sm btn-ghost danger', type: 'button', text: 'Delete', onclick: async () => { if (await dialog({ title: `Delete “${p.name}”?`, text: 'Its notes, tasks and documents are removed. Linked chats stay in your history.', okLabel: 'Delete', danger: true })) { projects.remove(p.id); openId = null; draw(); } } }))),
      title, goal,
      h('div', { class: 'project-progress' }, h('div', { class: 'progress' }, h('i', { style: { width: pr.pct + '%' } })), h('span', { class: 'mono', text: `${pr.pct}% · ${pr.done} of ${pr.total} tasks done` })),
      section('Tasks', '', tasks, h('div', { class: 'flex', style: { marginTop: '8px' } }, taskIn, h('button', { class: 'btn btn-sm', type: 'button', onclick: addTask }, iconNode('plus'), 'Add'))),
      section('Notes', 'Saved as you type.', notes),
      section('Documents', 'Kept inside the project so you can ask about them later. PDF, Word, Excel and text files.', docs, h('button', { class: 'btn btn-sm', type: 'button', style: { marginTop: '8px' }, onclick: addDoc }, iconNode('upload'), 'Add a document')),
      section('Conversations', 'Chats about this project. The AI sees the project’s tasks and notes in them.', chats,
        h('div', { class: 'flex', style: { marginTop: '8px' } },
          h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => { const s = sessions.create(); projects.linkChat(p.id, s.id); s.projectId = p.id; closeSheet(); toast(`New chat in ${p.name}`); } }, iconNode('plus'), 'New chat in this project'),
          sessions.state.current?.messages.length ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { projects.linkChat(p.id, sessions.state.current.id); toast('Current chat added'); } }, 'Add the current chat') : null)));
  }

  const offs = [bus.on('projects', () => draw()), bus.on('sessions', () => { if (openId) draw(); })];
  draw();
  return () => offs.forEach((f) => f());
});

// ---------------------------------------------------------------- knowledge map
async function drawMap(box) {
  const { buildGraph } = await import('../graph.js');
  const g = await buildGraph();
  const W = 640, H = 460;
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'kmap');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Knowledge map: ${g.nodes.length} things, ${g.edges.length} connections`);
  const pos = layout(g, W, H);
  for (const e of g.edges) {
    const a = pos.get(e.a), b = pos.get(e.b);
    const l = document.createElementNS(svgNS, 'line');
    Object.entries({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'kmap-edge' }).forEach(([k, v]) => l.setAttribute(k, v));
    svg.append(l);
  }
  for (const n of g.nodes) {
    const p = pos.get(n.id);
    const gEl = document.createElementNS(svgNS, 'g');
    gEl.setAttribute('class', `kmap-node ${n.kind}`);
    gEl.setAttribute('transform', `translate(${p.x},${p.y})`);
    const c = document.createElementNS(svgNS, 'circle');
    c.setAttribute('r', n.kind === 'project' ? 11 : n.kind === 'you' ? 14 : 7);
    const t = document.createElementNS(svgNS, 'text');
    t.setAttribute('y', n.kind === 'project' || n.kind === 'you' ? 26 : 19);
    t.setAttribute('text-anchor', 'middle');
    t.textContent = n.label.length > 22 ? n.label.slice(0, 21) + '…' : n.label;
    const tip = document.createElementNS(svgNS, 'title'); tip.textContent = `${n.kind}: ${n.label}`;
    gEl.append(c, t, tip);
    if (n.kind === 'project') { gEl.style.cursor = 'pointer'; gEl.addEventListener('click', () => { openId = n.ref; view = 'list'; box.dispatchEvent(new Event('redraw')); import('./sheets.js').then((m) => m.show('projects')); }); }
    svg.append(gEl);
  }
  const legend = h('div', { class: 'kmap-legend' }, ...[['you', 'You'], ['project', 'Projects'], ['person', 'People'], ['list', 'Lists'], ['memory', 'Memories'], ['task', 'Tasks']].map(([k, l]) => h('span', { class: 'kmap-key ' + k }, h('i'), l)));
  box.append(callout('How your things connect: lines join things that mention each other (a person named in a project’s notes, a memory about a project…). Click a project to open it.', { icon: 'info' }),
    g.nodes.length > 1 ? svg : h('div', { class: 'empty', text: 'Add projects, people or memories and they’ll show up here.' }), legend);
}

/** Simple force layout (deterministic), "You" in the middle. */
function layout(g, W, H) {
  const pos = new Map();
  g.nodes.forEach((n, i) => { const a = (i / g.nodes.length) * Math.PI * 2; const r = n.kind === 'you' ? 0 : n.kind === 'project' ? 120 : 190; pos.set(n.id, { x: W / 2 + r * Math.cos(a), y: H / 2 + r * Math.sin(a) * 0.85, vx: 0, vy: 0 }); });
  for (let it = 0; it < 220; it++) {
    for (const a of g.nodes) for (const b of g.nodes) {
      if (a === b) continue;
      const p = pos.get(a.id), q = pos.get(b.id);
      const dx = p.x - q.x, dy = p.y - q.y, d2 = Math.max(80, dx * dx + dy * dy);
      p.vx += (dx / d2) * 900; p.vy += (dy / d2) * 900;
    }
    for (const e of g.edges) {
      const p = pos.get(e.a), q = pos.get(e.b);
      const dx = q.x - p.x, dy = q.y - p.y, d = Math.max(1, Math.hypot(dx, dy)), f = (d - 80) * 0.02;
      p.vx += (dx / d) * f; p.vy += (dy / d) * f; q.vx -= (dx / d) * f; q.vy -= (dy / d) * f;
    }
    for (const n of g.nodes) {
      const p = pos.get(n.id);
      if (n.kind === 'you') { p.x = W / 2; p.y = H / 2; p.vx = p.vy = 0; continue; }
      p.vx += (W / 2 - p.x) * 0.002; p.vy += (H / 2 - p.y) * 0.002;
      p.x = Math.max(30, Math.min(W - 30, p.x + p.vx * 0.5)); p.y = Math.max(20, Math.min(H - 30, p.y + p.vy * 0.5));
      p.vx *= 0.6; p.vy *= 0.6;
    }
  }
  return pos;
}
