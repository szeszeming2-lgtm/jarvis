// Sidebar (conversation history) and HUD (system / AI / voice status).
import { h, $, iconNode, bus, dayGroup, fmtBytes } from '../util.js';
import { settings } from '../store.js';
import * as sessions from '../sessions.js';
import * as assistant from '../assistant.js';
import * as ollama from '../ollama.js';
import { voice } from '../voice.js';
import { call, can, info, isNative } from '../host.js';
import { menu, dialog, toast } from './common.js';
import { timers } from '../tools.js';
import * as reminders from '../reminders.js';
import { describeWhen } from '../when.js';

// ------------------------------------------------------------------ sidebar
export function initSidebar() {
  const list = $('#sessionList');
  const search = $('#searchInput');
  const draw = () => {
    const items = sessions.search(search.value);
    list.replaceChildren();
    if (!items.length) { list.append(h('div', { class: 'session-empty', text: search.value ? 'No conversations match.' : 'Your conversations will appear here. They are saved only on this device.' })); return; }
    let group = null;
    const pinned = items.filter((e) => e.pinned);
    if (pinned.length) list.append(h('div', { class: 'session-group', text: 'Pinned' }));
    for (const e of pinned) list.append(item(e));
    for (const e of items.filter((x) => !x.pinned)) {
      const g = dayGroup(e.updated);
      if (g !== group) { group = g; list.append(h('div', { class: 'session-group', text: g })); }
      list.append(item(e));
    }
  };
  const item = (e) => {
    const active = sessions.state.current?.id === e.id;
    const more = h('span', { class: 's-more', role: 'button', tabindex: '0', title: 'More', 'aria-label': 'Conversation options' }, iconNode('more'));
    const b = h('button', { class: 'session-item' + (active ? ' active' : ''), type: 'button', title: e.snippet || e.title, onclick: (ev) => {
      if (ev.target.closest('.s-more')) return;
      if (active) return;
      assistant.stop();
      sessions.saveNow();
      sessions.open(e.id);
    } }, e.pinned ? h('span', { class: 's-pin' }, iconNode('pin')) : null, h('span', { class: 's-title', text: e.title }), more);
    const openMenu = (ev) => { ev.stopPropagation(); menu(more, [
      { label: 'Rename', icon: 'edit', action: async () => { const v = await dialog({ title: 'Rename conversation', input: e.title, okLabel: 'Rename' }); if (v != null) sessions.rename(e.id, v); } },
      { label: e.pinned ? 'Unpin' : 'Pin to top', icon: 'pin', action: () => sessions.pin(e.id, !e.pinned) },
      { label: 'Export as Markdown', icon: 'download', action: () => exportOne(e.id) },
      'sep',
      { label: 'Delete', icon: 'trash', danger: true, action: async () => { if (await dialog({ title: 'Delete this conversation?', text: `“${e.title}” will be permanently deleted from this device.`, okLabel: 'Delete', danger: true })) sessions.remove(e.id); } },
    ], { align: 'right' }); };
    more.addEventListener('click', openMenu);
    more.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') openMenu(ev); });
    b.addEventListener('contextmenu', (ev) => { ev.preventDefault(); openMenu(ev); });
    return b;
  };
  search.addEventListener('input', draw);
  bus.on('sessions', draw);
  bus.on('session', draw);
  bus.on('session.title', draw);
  draw();
}

async function exportOne(id) {
  const s = sessions.state.current?.id === id ? sessions.state.current : await sessions.open(id);
  const mdText = sessions.toMarkdown(s, settings.assistantName);
  const name = s.title.replace(/[^\w\- ]+/g, '').slice(0, 50) + '.md';
  try { const r = await call('file.save', { name, content: mdText }); if (r?.ok) toast('Conversation exported'); } catch (e) { toast(e.message, { bad: true }); }
}

// ------------------------------------------------------------------ HUD
const hist = { cpu: [], mem: [] };
let statusTimer = null;
export function initHud() {
  const hud = $('#hud');
  const cards = {};
  const build = () => {
    hud.replaceChildren();
    const c = settings.home.hudCards;
    if (c.clock) hud.append(cards.clock = card('Local time', h('div', { class: 'clock', id: 'hudClock' }), h('div', { class: 'clock-date', id: 'hudDate' })));
    if (c.reminders) hud.append(cards.reminders = card('Reminders', h('div', { id: 'hudRem' })));
    if (c.system) hud.append(cards.system = card('System', h('div', { id: 'hudSys' }, h('div', { class: 'muted', style: { fontSize: '12px' }, text: can('status') ? 'Reading sensors…' : 'Live system stats need the desktop app.' }))));
    if (c.ai) hud.append(cards.ai = card('AI core', h('div', { id: 'hudAi' })));
    if (c.voice) hud.append(cards.voice = card('Voice', h('div', { id: 'hudVoice' })));
    if (c.quick) hud.append(cards.quick = card('Quick actions', h('div', { class: 'quick-grid', id: 'hudQuick' })));
    tickClock(); drawAi(); drawVoice(); drawQuick(); drawRem(); pollStatus(true);
  };
  build();
  bus.on('home', build);
  bus.on('engine', drawAi);
  bus.on('settings', (d) => { if (d.path.startsWith('ai.')) drawAi(); if (d.path.startsWith('voice.')) drawVoice(); });
  bus.on('voice.state', drawVoice);
  bus.on('reminders', drawRem);
  setInterval(drawRem, 30000);
  bus.on('timer.start', drawVoice);
  bus.on('timer.done', drawVoice);
  setInterval(tickClock, 1000);
  clearInterval(statusTimer);
  statusTimer = setInterval(() => pollStatus(false), 4000);
}

function card(title, ...children) {
  return h('section', { class: 'hud-card glass' }, h('div', { class: 'hud-title' }, h('span', { text: title }), h('b', { text: '●' })), ...children);
}

function tickClock() {
  const c = $('#hudClock');
  if (!c) return;
  const d = new Date();
  c.textContent = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  $('#hudDate').textContent = d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

const kv = (k, v, id) => h('div', { class: 'hud-row' }, h('span', { text: k }), h('span', { class: 'v', text: v, id }));
const meter = (pct, hot) => h('div', { class: 'meter' + (hot ? ' hot' : '') }, h('i', { style: { width: Math.max(2, Math.min(100, pct)) + '%' } }));

async function pollStatus(first) {
  const box = $('#hudSys');
  if (!box || !can('status') || document.hidden) return;
  try {
    const s = await call('system.status');
    hist.cpu.push(s.cpu); hist.mem.push((s.memUsed / s.memTotal) * 100);
    if (hist.cpu.length > 40) { hist.cpu.shift(); hist.mem.shift(); }
    const memPct = (s.memUsed / s.memTotal) * 100;
    const kids = [
      kv('CPU', `${Math.round(s.cpu)}%`), meter(s.cpu, s.cpu > 85),
      kv('Memory', `${(s.memUsed / 1e9).toFixed(1)} / ${(s.memTotal / 1e9).toFixed(0)} GB`), meter(memPct, memPct > 88),
    ];
    if (s.battery?.level != null) kids.push(kv('Battery', `${Math.round(s.battery.level)}%${s.battery.charging ? ' ⚡' : ''}`), meter(s.battery.level, s.battery.level < 15));
    if (s.diskFree) kids.push(kv('Storage free', fmtBytes(s.diskFree)));
    if (s.uptime) kids.push(kv('Uptime', fmtUptime(s.uptime)));
    kids.push(spark());
    box.replaceChildren(...kids);
  } catch (e) { if (first) box.replaceChildren(h('div', { class: 'muted', style: { fontSize: '12px' }, text: 'Status unavailable.' })); }
}

function spark() {
  const w = 240, ht = 34;
  const path = (arr) => arr.map((v, i) => `${i ? 'L' : 'M'}${(i / 39) * w},${ht - (v / 100) * (ht - 2) - 1}`).join(' ');
  const svg = `<svg class="spark" viewBox="0 0 ${w} ${ht}" preserveAspectRatio="none" aria-hidden="true"><path d="${path(hist.mem)}" fill="none" stroke="rgba(var(--accent2-rgb),.8)" stroke-width="1.4"/><path d="${path(hist.cpu)}" fill="none" stroke="rgba(var(--accent-rgb),.95)" stroke-width="1.6"/></svg>`;
  const t = document.createElement('template');
  t.innerHTML = svg;
  return t.content.firstElementChild;
}

const fmtUptime = (s) => { const d = Math.floor(s / 86400), hr = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return d ? `${d}d ${hr}h` : hr ? `${hr}h ${m}m` : `${m}m`; };

function drawAi() {
  const box = $('#hudAi');
  if (!box) return;
  const e = ollama.engine;
  const m = ollama.modelInfo();
  const loaded = e.running.find((r) => r.name === settings.ai.model);
  const status = { online: 'Online', offline: 'Offline', 'not-installed': 'Not installed', checking: 'Checking…', blocked: 'Not connected' }[e.status] || '—';
  box.replaceChildren(
    kv('Engine', `${status}${e.version ? ' · v' + e.version : ''}`),
    kv('Model', settings.ai.model || 'None'),
    m ? kv('Size', `${m.details?.parameter_size || ''} · ${fmtBytes(m.size)}`) : null,
    kv('State', loaded ? 'Loaded in memory' : e.status === 'online' && m ? 'Sleeping (loads on use)' : '—'),
    kv('Speed', e.lastSpeed ? `${e.lastSpeed.toFixed(1)} tokens/s` : '—'),
    kv('Context', e.status === 'online' && m ? `${ollama.contextLength().toLocaleString()} tokens` : '—'),
    kv('Abilities', settings.ai.tools && ollama.hasCap('tools') ? 'Enabled' : settings.ai.tools ? 'Model can’t use them' : 'Off'),
  );
}

function drawVoice() {
  const box = $('#hudVoice');
  if (!box) return;
  const v = settings.voice;
  const st = voice.speaking ? 'Speaking' : voice.listening ? (voice.mode === 'wake' ? `Waiting for “${v.wakeWord}”` : 'Listening') : 'Ready';
  const kids = [
    kv('Microphone', can('voiceIn') ? st : 'Unavailable'),
    kv('Replies', { voice: 'Spoken when you talk', always: 'Always spoken', never: 'Text only' }[v.speak]),
    kv('Wake word', v.wake && can('wake') ? `“${v.wakeWord}”` : 'Off'),
    kv('Recognition', isNative ? (v.offlineOnly ? 'On-device only' : 'On-device preferred') : v.offlineOnly ? 'Browser, offline only' : 'Browser'),
  ];
  for (const t of timers.values()) {
    const left = Math.max(0, t.ends - Date.now());
    kids.push(kv('Timer' + (t.label ? ` · ${t.label}` : ''), `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}`));
  }
  box.replaceChildren(...kids);
}
setInterval(() => { if (timers.size) drawVoice(); }, 1000);

function drawRem() {
  const box = $('#hudRem');
  if (!box) return;
  const list = reminders.upcoming().slice(0, 5);
  if (!list.length) { box.replaceChildren(h('div', { class: 'muted', style: { fontSize: '12px', lineHeight: 1.5 }, text: 'None yet. Try “remind me in 20 minutes to stretch”.' })); return; }
  box.replaceChildren(...list.map((r) => h('div', { class: 'rem-row' },
    iconNode('bell'),
    h('div', { class: 'grow' }, h('div', { text: r.text }), h('span', { text: describeWhen(new Date(r.due)) })),
    h('button', { type: 'button', title: 'Cancel reminder', 'aria-label': `Cancel reminder: ${r.text}`, onclick: () => reminders.cancel(r.id) }, iconNode('x')))));
}

function drawQuick() {
  const box = $('#hudQuick');
  if (!box) return;
  box.replaceChildren(...settings.home.quick.map((q) => h('button', { class: 'quick-btn', type: 'button', title: q.text, onclick: () => assistant.send(q.text) }, iconNode(q.icon || 'bolt'), h('span', { text: q.label }))));
}
