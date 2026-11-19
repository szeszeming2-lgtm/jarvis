// Command Center: one dashboard for your day, missions, projects, habits, focus,
// system status and recent chats. Widgets can be hidden and reordered (Customize).
import { h, iconNode, bus, timeAgo, fmtBytes } from '../util.js';
import { registerTab, closeSheet, show } from './sheets.js';
import { toast } from './common.js';
import { settings, set } from '../store.js';
import { call, can } from '../host.js';
import * as reminders from '../reminders.js';
import * as lists from '../lists.js';
import * as sessions from '../sessions.js';

export const WIDGETS = {
  today: 'Today', missions: 'Missions', projects: 'Projects', habits: 'Habits & goals', focus: 'Focus',
  system: 'System', chats: 'Recent chats', quick: 'Quick commands', report: 'Daily report',
};
const order = () => { const o = settings.command?.order || Object.keys(WIDGETS); return [...o.filter((k) => WIDGETS[k]), ...Object.keys(WIDGETS).filter((k) => !o.includes(k))]; };
const hidden = () => new Set(settings.command?.hidden || []);
let editing = false;

registerTab('command', (body) => {
  const grid = h('div', { class: 'cc-grid' });
  const draw = async () => {
    const cards = [];
    for (const k of order()) {
      if (hidden().has(k) && !editing) continue;
      const c = h('section', { class: 'cc-card glass' + (hidden().has(k) ? ' off' : ''), dataset: { w: k } }, h('div', { class: 'cc-title' }, h('span', { text: WIDGETS[k] }),
        editing ? h('span', { class: 'cc-edit' },
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Move ${WIDGETS[k]} up`, onclick: () => move(k, -1) }, '↑'),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Move ${WIDGETS[k]} down`, onclick: () => move(k, 1) }, '↓'),
          h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: hidden().has(k) ? 'Show' : 'Hide', onclick: () => toggleHide(k) })) : null));
      try { c.append(...(await (W[k]?.() || [])).filter(Boolean)); } catch (e) { c.append(h('div', { class: 'muted', text: 'Couldn’t load this.' })); }
      cards.push(c);
    }
    grid.replaceChildren(...cards);
    drawSystem(grid);
  };
  const move = (k, d) => { const o = order(); const i = o.indexOf(k); const j = i + d; if (j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j], o[i]]; set('command.order', o); draw(); };
  const toggleHide = (k) => { const s = hidden(); s.has(k) ? s.delete(k) : s.add(k); set('command.hidden', [...s]); draw(); };
  const editBtn = h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Customize', onclick: () => { editing = !editing; editBtn.textContent = editing ? 'Done' : 'Customize'; draw(); } });
  body.append(h('div', { class: 'flex', style: { justifyContent: 'space-between', marginBottom: '10px' } }, h('div', { class: 'muted', style: { fontSize: '13px' }, text: 'Everything at a glance. It updates as you go.' }), editBtn), grid);
  draw();
  const offs = ['reminders', 'lists', 'missions', 'projects', 'planner', 'sessions'].map((ev) => bus.on(ev, () => { if (!editing) draw(); }));
  const t = setInterval(() => { if (!editing && !document.hidden) drawSystem(grid); }, 5000);
  return () => { offs.forEach((f) => f()); clearInterval(t); };
});

const row = (icon, title, sub, onclick) => h(onclick ? 'button' : 'div', { class: 'cc-row', type: onclick ? 'button' : undefined, onclick }, iconNode(icon), h('span', {}, h('b', { text: title }), sub ? h('small', { text: sub }) : null));
const bar = (pct) => h('div', { class: 'progress' }, h('i', { style: { width: Math.max(0, Math.min(100, pct)) + '%' } }));
const empty = (t) => h('div', { class: 'muted', style: { fontSize: '12.5px' }, text: t });
const go = (tab) => () => show(tab);
const ask = (text) => async () => { closeSheet(); (await import('../assistant.js')).send(text); };

const W = {
  async today() {
    const end = new Date(); end.setHours(23, 59, 59, 999);
    const rem = reminders.upcoming().filter((r) => r.due <= end.getTime()).slice(0, 4);
    const todo = lists.open('to-do').slice(0, 4);
    const out = [h('div', { class: 'cc-big', text: new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) })];
    if (settings.weather?.lat != null) { try { const w = await (await import('../weather.js')).forecast(); out.push(row('sun', `${w.now.icon} ${w.now.temp}${w.units} · ${w.now.sky}`, `Today ${w.days[0].low}–${w.days[0].high}${w.units}`)); } catch {} }
    out.push(...rem.map((r) => row('bell', r.text, new Date(r.due).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }), go('lists'))));
    out.push(...todo.map((t) => row('check', t.text, 'To-do', go('lists'))));
    if (!rem.length && !todo.length) out.push(empty('Nothing due today.'));
    out.push(h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Morning briefing', onclick: ask('good morning') }));
    return out;
  },
  async missions() {
    const M = await import('../missions.js');
    const ms = M.all().filter((m) => m.status !== 'stopped').slice(0, 4);
    return ms.length ? [...ms.map((m) => { const p = M.progress(m); return h('div', { class: 'cc-row-wrap' }, row('zap', m.goal, `${{ planning: 'Planning', 'awaiting-approval': 'Needs your OK', queued: 'Queued', running: 'Working', waiting: 'Needs your OK', paused: 'Paused', done: 'Done', failed: 'Error' }[m.status] || m.status} · ${p.done}/${p.total}`, go('mission')), bar(p.pct)); }),
    ] : [empty('No missions yet.'), h('button', { class: 'btn btn-sm', type: 'button', text: 'Start a mission', onclick: go('mission') })];
  },
  async projects() {
    const pj = await import('../projects.js');
    const ps = pj.all().slice(0, 4);
    return ps.length ? ps.map((p) => { const pr = pj.progress(p); return h('div', { class: 'cc-row-wrap' }, row('folder', p.name, `${pr.done}/${pr.total} tasks · ${timeAgo(p.updated)}`, go('projects')), bar(pr.pct)); }) : [empty('No projects yet. Say “new project …”.')];
  },
  async habits() {
    const P = await import('../planner.js');
    const day = P.dayKey();
    const out = P.all().habits.slice(0, 5).map((hb) => h('button', { class: 'cc-row', type: 'button', onclick: () => P.checkHabit(hb, !hb.days[day]) }, iconNode(hb.days[day] ? 'check' : 'target'), h('span', {}, h('b', { text: hb.name }), h('small', { text: hb.days[day] ? `Done · ${P.streak(hb)}-day streak` : 'Tap when done' }))));
    for (const g of P.all().goals.slice(0, 3)) out.push(h('div', { class: 'cc-row-wrap' }, row('target', g.title, `${P.goalPct(g)}%`), bar(P.goalPct(g))));
    return out.length ? out : [empty('No habits or goals yet.'), h('button', { class: 'btn btn-sm', type: 'button', text: 'Open Planner', onclick: go('planner') })];
  },
  async focus() {
    const P = await import('../planner.js');
    const f = P.focusState?.();
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const mins = Math.round((P.all().focus || []).filter((x) => x.start >= start.getTime()).reduce((s, x) => s + (x.minutes || 0), 0));
    return [h('div', { class: 'cc-big', text: f?.running ? `${f.left} left` : `${mins} min today` }),
      h('div', { class: 'item-sub', text: f?.running ? `Focusing on: ${f.task || 'your task'}` : 'Focus sessions keep JARVIS quiet and count your time.' }),
      h('button', { class: 'btn btn-sm', type: 'button', text: f?.running ? 'Open focus' : 'Start 25-min focus', onclick: f?.running ? go('planner') : ask('start a focus session') })];
  },
  async system() {
    return [h('div', { class: 'cc-sys', text: 'Reading…' })];
  },
  async chats() {
    const list = sessions.state.index.slice(0, 5);
    return list.length ? list.map((e) => row('message', e.title, timeAgo(e.updated), async () => { await sessions.open(e.id); closeSheet(); })) : [empty('No chats yet.')];
  },
  async quick() {
    const q = settings.home?.quick || [];
    return [h('div', { class: 'cc-quick' }, ...q.slice(0, 8).map((x) => h('button', { class: 'suggestion', type: 'button', onclick: ask(x.text || x.command || x) }, iconNode(x.icon || 'zap'), x.label || x.text || x)))];
  },
  async report() {
    return [h('div', { class: 'item-sub', text: 'What you got done today and what’s next.' }),
      h('div', { class: 'flex' }, h('button', { class: 'btn btn-sm btn-primary', type: 'button', text: 'Today’s report', onclick: ask('daily report') }), h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Weekly goals', onclick: ask('how are my goals') }))];
  },
};

async function drawSystem(grid) {
  const box = grid.querySelector('.cc-sys');
  if (!box) return;
  if (can('status')) {
    try {
      const s = await call('system.status');
      const memPct = (s.memUsed / s.memTotal) * 100;
      box.replaceChildren(
        h('div', { class: 'cc-kv' }, h('span', { text: 'CPU' }), h('b', { text: Math.round(s.cpu) + '%' })), bar(s.cpu),
        h('div', { class: 'cc-kv' }, h('span', { text: 'Memory' }), h('b', { text: `${(s.memUsed / 1e9).toFixed(1)} / ${(s.memTotal / 1e9).toFixed(0)} GB` })), bar(memPct),
        s.battery?.level != null ? h('div', { class: 'cc-kv' }, h('span', { text: 'Battery' }), h('b', { text: `${Math.round(s.battery.level)}%${s.battery.charging ? ' ⚡' : ''}` })) : null,
        s.diskFree ? h('div', { class: 'cc-kv' }, h('span', { text: 'Free storage' }), h('b', { text: fmtBytes(s.diskFree) })) : null,
        h('div', { class: 'cc-kv' }, h('span', { text: 'Internet' }), h('b', { text: navigator.onLine ? 'Online' : 'Offline' })),
        h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Check my computer', onclick: ask('diagnose my computer') }));
      return;
    } catch {}
  }
  let used = '';
  try { const e = await navigator.storage?.estimate?.(); if (e) used = fmtBytes(e.usage || 0); } catch {}
  box.replaceChildren(h('div', { class: 'cc-kv' }, h('span', { text: 'Internet' }), h('b', { text: navigator.onLine ? 'Online' : 'Offline' })),
    used ? h('div', { class: 'cc-kv' }, h('span', { text: 'JARVIS storage' }), h('b', { text: used })) : null,
    h('div', { class: 'item-sub', text: 'Live CPU and memory need the Mac app.' }));
}

