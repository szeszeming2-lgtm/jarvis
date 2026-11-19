// Mission Control board: objectives → approved plans → agents at work → your OK for
// device changes → final reports. Updates live while the agents work.
import { h, iconNode, bus, timeAgo } from '../util.js';
import { registerTab, closeSheet } from './sheets.js';
import { section, toast, dialog, callout } from './common.js';
import { render as md } from '../markdown.js';
import * as M from '../missions.js';

const open = new Set();   // tasks whose output is expanded
const STATUS = { planning: 'Planning', 'awaiting-approval': 'Needs your OK', queued: 'Queued', running: 'Working', waiting: 'Needs your OK', paused: 'Paused', done: 'Done', failed: 'Stopped by an error', stopped: 'Stopped' };
const COLS = [['todo', 'To do'], ['running', 'Working'], ['needs-approval', 'Needs you'], ['done', 'Done']];

registerTab('mission', (body) => {
  const goals = h('textarea', { class: 'field', rows: 3, placeholder: 'One objective per line (up to 10), e.g.\nPlan a 3-day trip to Rome on a budget\nMake a study plan for my biology test on Friday\nWrite a short speech for my sister’s birthday', 'aria-label': 'Objectives', style: { width: '100%', fontFamily: 'inherit', fontSize: '14px', lineHeight: 1.5 } });
  const list = h('div', { class: 'missions' });
  let t = 0;
  const draw = () => { clearTimeout(t); t = setTimeout(() => list.replaceChildren(...M.all().map(card)), 80); };
  const launch = () => { try { const made = M.add(goals.value); goals.value = ''; toast(`${made.length} mission${made.length === 1 ? '' : 's'} started. The Planner is on it.`); } catch (e) { toast(e.message, { bad: true }); } };
  goals.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); launch(); } });
  const off = bus.on('missions', draw);
  body.append(
    callout('<b>Mission Control.</b> Give JARVIS big objectives. For each one, a Planner agent makes a task list for you to approve; then specialist agents (Researcher, Writer, Analyst, Coder, Organizer) do the work, and an Editor reports what got done. Nothing on your device changes without your OK. Agents take turns, because your device runs one AI at a time.', { icon: 'target' }),
    section('New objectives', '', goals, h('div', { class: 'flex', style: { marginTop: '8px' } },
      h('button', { class: 'btn btn-primary', type: 'button', onclick: launch }, iconNode('zap'), 'Launch missions'),
      h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Pause all', onclick: () => { M.pauseAll(); toast('All missions paused'); } }))),
    list);
  draw();
  return off;
});

function card(m) {
  const pr = M.progress(m);
  const head = h('div', { class: 'ms-head' },
    h('div', { class: 'ms-goal', text: m.goal }),
    h('span', { class: 'pill ms-status ' + m.status, text: STATUS[m.status] || m.status }));
  const controls = h('div', { class: 'flex ms-controls' },
    ['queued', 'running'].includes(m.status) ? h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Pause', onclick: () => M.pause(m.id) }) : null,
    ['paused', 'failed', 'stopped'].includes(m.status) ? h('button', { class: 'btn btn-sm', type: 'button', text: 'Resume', onclick: () => M.resume(m.id) }) : null,
    !['done', 'stopped'].includes(m.status) ? h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Stop', onclick: () => M.stop(m.id) }) : null,
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Delete mission', onclick: async () => { if (await dialog({ title: 'Delete this mission?', okLabel: 'Delete', danger: true })) M.remove(m.id); } }, iconNode('trash')));
  const parts = [head, h('div', { class: 'progress' }, h('i', { style: { width: pr.pct + '%' } })), h('div', { class: 'item-sub', text: m.status === 'planning' ? 'The Planner is writing the task list…' : `${pr.done} of ${pr.total} tasks done · started ${timeAgo(m.created)}` })];

  if (m.status === 'awaiting-approval') {
    // Checkpoint 1: review the plan.
    parts.push(h('div', { class: 'ms-plan' }, h('div', { class: 'pop-label', text: 'Plan: check it, then approve' }),
      ...m.tasks.map((tk, i) => h('div', { class: 'ms-plan-row' }, h('span', { class: 'mono muted', text: `${i + 1}.` }), agentTag(tk.agent),
        h('span', { class: 'grow', text: tk.title }),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Edit task', onclick: async () => { const v = await dialog({ title: 'Edit task', input: tk.title, okLabel: 'Save' }); if (v?.trim()) M.editTask(m.id, tk.id, v.trim()); } }, iconNode('edit')),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Remove task', onclick: () => M.removeTask(m.id, tk.id) }, iconNode('x')))),
      h('div', { class: 'flex', style: { marginTop: '8px' } },
        h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => M.approvePlan(m.id) }, iconNode('check'), 'Approve plan and start'),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => { const v = await dialog({ title: 'Add a task', text: 'Start with the agent if you like, e.g. “Researcher: find prices”', input: '', okLabel: 'Add' }); if (!v?.trim()) return; const p = M.parsePlan(v)[0]; M.addTask(m.id, p?.agent || 'Writer', p?.title || v.trim()); } }, iconNode('plus'), 'Add a task'))));
  } else if (m.tasks.length) {
    // Live board.
    parts.push(h('div', { class: 'ms-board' }, ...COLS.map(([st, label]) => {
      const tasks = m.tasks.filter((x) => (st === 'done' ? ['done', 'skipped'].includes(x.status) : st === 'todo' ? ['todo', 'failed'].includes(x.status) : x.status === st));
      return h('div', { class: 'ms-col ' + st }, h('div', { class: 'ms-col-head', text: `${label} · ${tasks.length}` }), ...tasks.map((tk) => taskCard(m, tk)));
    })));
  }
  if (m.report) {
    const rep = h('div', { class: 'msg-body ms-report' }); rep.innerHTML = md(m.report);
    parts.push(h('div', { class: 'pop-label', text: 'Final report' }), rep, h('div', { class: 'flex' },
      h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => { const pj = await import('../projects.js'); const p = pj.create(m.goal.slice(0, 60)); pj.setNotes(p.id, m.report); pj.addTask(p.id, m.tasks.filter((x) => x.status !== 'done').map((x) => x.title).join(';') || ''); toast(`Saved as the project “${p.name}”`); } }, iconNode('folder'), 'Save as a project'),
      h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: async () => { closeSheet(); (await import('../assistant.js')).announce(`**Mission report: ${m.goal}**\n\n${m.report}`); } }, iconNode('message'), 'Show in chat'),
      h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => navigator.clipboard?.writeText(m.report).then(() => toast('Copied')) }, iconNode('copy'), 'Copy')));
  }
  if (m.log.length) parts.push(h('details', { class: 'reasoning ms-log' }, h('summary', { text: `Activity (${m.log.length})` }), ...m.log.slice(0, 25).map((l) => h('div', { text: `${new Date(l.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} · ${l.text}` }))));
  parts.push(controls);
  return h('div', { class: 'ms-card glass' }, ...parts);
}

function agentTag(agent) { return h('span', { class: 'ms-agent', title: M.AGENTS[agent]?.job || '' }, iconNode(M.AGENTS[agent]?.icon || 'sparkles'), agent); }

function taskCard(m, tk) {
  const isOpen = open.has(tk.id);
  const el = h('div', { class: 'ms-task ' + tk.status },
    h('button', { class: 'ms-task-top', type: 'button', onclick: () => { isOpen ? open.delete(tk.id) : open.add(tk.id); bus.emit('missions', M.all()); } },
      agentTag(tk.agent), h('span', { class: 'ms-task-title', text: tk.title })),
    tk.status === 'running' ? h('div', { class: 'item-sub', text: tk.step || 'Working…' }) : null,
    tk.status === 'failed' ? h('div', { class: 'item-sub', style: { color: 'var(--danger)' }, text: tk.error || 'Failed' }) : null);
  if (tk.status === 'needs-approval' && tk.action) {
    // Checkpoint 2: approve a change to the device.
    el.append(h('div', { class: 'ms-action' }, h('b', { text: `${tk.agent} wants to: ${tk.action.tool.replace(/_/g, ' ')}` }),
      h('pre', { class: 'mono', text: JSON.stringify(tk.action.args, null, 1).slice(0, 600) }),
      h('div', { class: 'flex' }, h('button', { class: 'btn btn-sm btn-primary', type: 'button', text: 'Approve', onclick: () => M.decideAction(m.id, tk.id, true) }), h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'No', onclick: () => M.decideAction(m.id, tk.id, false) }))));
  }
  if (isOpen && tk.output) { const o = h('div', { class: 'msg-body ms-output' }); o.innerHTML = md(tk.output); el.append(o); }
  if (tk.actionResult) el.append(h('div', { class: 'item-sub', text: tk.actionResult }));
  return el;
}
