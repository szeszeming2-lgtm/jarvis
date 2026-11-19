// Transcript rendering: messages, streaming, action chips, confirmation cards.
import { h, $, iconNode, bus, truncate } from '../util.js';
import { render as md } from '../markdown.js';
import { settings } from '../store.js';
import * as sessions from '../sessions.js';
import * as assistant from '../assistant.js';
import * as voice from '../voice.js';
import { call, isNative } from '../host.js';
import { toast } from './common.js';
import { openSheet } from './sheets.js';
import * as ollama from '../ollama.js';
import { nextSuggestions } from '../suggest.js';
import { getActivity } from '../store.js';

const nodes = new Map();
let thread;
let stickToBottom = true;

export function init() {
  const tr = $('#transcript');
  thread = h('div', { class: 'thread' });
  tr.append(thread);
  tr.addEventListener('scroll', () => { stickToBottom = tr.scrollHeight - tr.scrollTop - tr.clientHeight < 80; });
  tr.addEventListener('click', onClick);
  bus.on('session', renderAll);
  bus.on('msg.add', (m) => { appendMsg(m); markLast(); scrollDown(true); updateMode(); });
  bus.on('msg.update', (m) => { refresh(m); markLast(); scrollDown(); });
  bus.on('msg.stream', (m) => schedule(m));
  assistant.setConfirmUI(confirmCard);
  // "Try saying": what you could say next, under the latest reply.
  getActivity().then((log) => { for (const e of log) if (e.result === 'ok' && e.tool) usedFeatures.add(e.tool); }).catch(() => {});
  bus.on('activity', (e) => { if (e?.tool) usedFeatures.add(e.tool); });
  for (const ev of ['msg.add', 'msg.update', 'turn.done', 'busy', 'session']) bus.on(ev, queueNext);
  bus.on('settings', (d) => { if (d?.path === 'suggestNext') queueNext(); });
}

// ---------------------------------------------------------------- "Try saying"
const usedFeatures = new Set();
let nextTimer = 0;
function queueNext() { clearTimeout(nextTimer); thread?.querySelector('.next-say')?.remove(); nextTimer = setTimeout(drawNext, 300); }
/** The current suggestions (also used by the full-screen voice view). */
export function currentSuggestions() {
  const msgs = sessions.state.current?.messages || [];
  const last = msgs[msgs.length - 1];
  if (settings.suggestNext === false || assistant.run.busy || !last || last.role === 'user' || last.pending || last.streaming) return [];
  for (const m of msgs) if (m.role === 'user') { const t = String(m.content || '').toLowerCase(); if (/^make (slides|a presentation)/.test(t)) usedFeatures.add('create'); if (/translat/.test(t)) usedFeatures.add('translate'); if (/^(fact check|research)/.test(t)) usedFeatures.add('research'); if (/flash ?cards/.test(t)) usedFeatures.add('cards'); if (/command cent/.test(t)) usedFeatures.add('command'); }
  return nextSuggestions(msgs, { where: isNative ? 'mac' : 'web', used: usedFeatures, seed: msgs.length, mode: settings.mode || 'assistant' });
}
export function useSuggestion(s) {
  if (s.fill) { const i = $('#input'); i.value = s.text; i.focus(); i.setSelectionRange(i.value.length, i.value.length); i.dispatchEvent(new Event('input', { bubbles: true })); return; }
  assistant.send(s.text);
}
function drawNext() {
  thread?.querySelector('.next-say')?.remove();
  const list = currentSuggestions();
  if (!list.length) return;
  thread.append(h('div', { class: 'next-say', role: 'group', 'aria-label': 'Things you could say next' },
    h('span', { class: 'next-label', text: 'Try saying' }),
    ...list.map((s) => h('button', { class: 'suggestion next-chip', type: 'button', title: s.text, text: s.fill ? s.text.trim() + ' …' : s.label, onclick: () => useSuggestion(s) }))));
  scrollDown();
}

function updateMode() {
  const has = !!sessions.state.current?.messages.length;
  $('#main').classList.toggle('chatting', has);
}

export function renderAll() {
  nodes.clear();
  thread.replaceChildren();
  const s = sessions.state.current;
  for (const m of s?.messages || []) appendMsg(m);
  markLast();
  updateMode();
  requestAnimationFrame(() => { const tr = $('#transcript'); tr.style.scrollBehavior = 'auto'; tr.scrollTop = tr.scrollHeight; tr.style.scrollBehavior = ''; });
}

function markLast() {
  thread.querySelectorAll('.msg.last').forEach((n) => n.classList.remove('last'));
  const all = thread.querySelectorAll('.msg.assistant');
  all[all.length - 1]?.classList.add('last');
}

function scrollDown(force = false) {
  if (!force && !stickToBottom) return;
  const tr = $('#transcript');
  tr.scrollTop = tr.scrollHeight;
}

let queued = new Set(), rafId = 0;
function schedule(m) {
  queued.add(m);
  if (rafId) return;
  rafId = requestAnimationFrame(() => { rafId = 0; for (const x of queued) refresh(x); queued.clear(); scrollDown(); });
}

function appendMsg(m) {
  const n = build(m);
  if (!n) return;
  nodes.set(m.id, n);
  thread.append(n);
}

function refresh(m) {
  const old = nodes.get(m.id);
  const n = build(m);
  if (!old) { if (n) { nodes.set(m.id, n); thread.append(n); } return; }
  if (!n) { old.remove(); nodes.delete(m.id); return; }
  // Keep the open/closed state of reasoning blocks while streaming.
  const wasOpen = old.querySelector('details.reasoning')?.open;
  n.style.animation = 'none';
  old.replaceWith(n);
  if (wasOpen) n.querySelector('details.reasoning')?.setAttribute('open', '');
  nodes.set(m.id, n);
}

function build(m) {
  if (m.role === 'user') {
    return h('div', { class: 'msg user', dataset: { id: m.id } },
      h('div', { class: 'msg-body selectable' },
        m.skill ? h('div', { class: 'pill accent', style: { marginBottom: '6px' }, text: `Skill · ${m.skill}` }) : null,
        m.content,
        m.images?.length ? h('div', { class: 'msg-images' }, ...m.images.map((src) => h('img', { src, alt: 'Attached picture' }))) : null,
        m.attachment ? h('div', { class: 'chip', style: { marginTop: '8px' } }, iconNode('file'), h('span', { text: m.attachment.name })) : null));
  }
  if (m.role === 'tool') return toolRow(m);
  if (m.role === 'assistant') {
    if (m.hidden) return null;
    if (m.error) return errorCard(m);
    if (!m.content && !m.thinking && !m.pending && m.tool_calls?.length) return null;
    const body = h('div', { class: 'msg-body selectable' });
    if (m.thinking && settings.ai.thinking) {
      const d = h('details', { class: 'reasoning' }, h('summary', { text: m.pending || !m.content ? 'Reasoning…' : 'Reasoning' }), h('div', { text: m.thinking }));
      body.append(d);
    }
    // Research / agent team: show each finished step with a tick.
    if (m.steps?.length) body.append(h('ol', { class: 'deep-steps' }, ...m.steps.map((s, i) => h('li', { class: m.pending && i === m.steps.length - 1 ? 'now' : 'done' }, iconNode(m.pending && i === m.steps.length - 1 ? 'refresh' : 'check'), h('span', { text: s })))));
    if (m.pending && !m.content) body.append(h('div', { class: 'thinking-dots', 'aria-label': 'Thinking' }, h('i'), h('i'), h('i')), m.loading && !m.steps?.length ? h('div', { class: 'muted', style: { fontSize: '12.5px' }, text: m.loading }) : null);
    else {
      const c = h('div');
      c.innerHTML = md(m.content); // markdown.js escapes all model text
      if (m.streaming) c.append(h('span', { class: 'cursor' }));
      body.append(c);
    }
    if (m.cards?.length) body.append(flashcards(m.cards));
    if (m.htmlPreview) {
      // Preview without running scripts (the saved file runs fully in your browser).
      const f = h('iframe', { class: 'html-preview', title: 'Preview of the page', sandbox: '', loading: 'lazy' });
      f.srcdoc = m.htmlPreview;
      body.append(h('div', { class: 'item-sub', text: 'Preview (buttons and scripts work in the saved file):' }), f);
    }
    if (m.agentNotes?.length) body.append(h('details', { class: 'reasoning agent-notes' }, h('summary', { text: `How the team worked (${m.agentNotes.map((a) => a.name).join(' → ')})` }),
      ...m.agentNotes.map((a) => { const d = h('div', { class: 'agent-note' }, h('b', {}, iconNode(a.icon), ' ', a.name)); const c = h('div'); c.innerHTML = md(a.text); d.append(c); return d; })));
    if (m.buttons?.length) body.append(h('div', { class: 'msg-buttons' }, ...m.buttons.map((b, i) => h('button', { class: 'btn btn-sm' + (i === 0 ? ' btn-primary' : ''), type: 'button', text: b.label, onclick: () => pressButton(b) }))));
    if (m.stopped) body.append(h('div', { class: 'muted', style: { fontSize: '12px', marginTop: '6px' }, text: 'Stopped.' }));
    const meta = h('div', { class: 'msg-meta' },
      h('button', { type: 'button', title: 'Copy', onclick: () => copy(m.content) }, iconNode('copy'), 'Copy'),
      h('button', { type: 'button', title: 'Read aloud', onclick: () => { voice.stopSpeaking(); voice.speak(m.content); } }, iconNode('speaker'), 'Speak'),
      m.stats?.tps ? h('span', { text: `${m.stats.tps} tok/s · ${m.stats.secs}s` }) : null,
      m.model && !m.instant ? h('span', { text: m.model }) : m.instant ? h('span', { text: 'instant' }) : null);
    return h('div', { class: 'msg assistant', dataset: { id: m.id } }, h('div', { class: 'avatar', 'aria-hidden': 'true' }), h('div', { style: { flex: 1, minWidth: 0 } }, body, meta));
  }
  return null;
}


function toolRow(m) {
  const cls = m.running ? 'run' : m.ok ? 'ok' : 'no';
  const ic = m.running ? 'refresh' : m.ok ? 'check' : m.declined ? 'x' : 'alert';
  const row = h('div', { class: 'actions-row', dataset: { id: m.id } },
    h('span', { class: 'chip ' + cls, title: m.display }, iconNode(ic), h('span', { text: m.display || m.tool_name })));
  if (m.undo) row.append(h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Undo', onclick: () => assistant.undo(m) }));
  if (m.reminderId && !isNative) row.append(h('button', { class: 'btn btn-sm btn-ghost', type: 'button', title: 'Save it to your phone or computer calendar so it reminds you even when JARVIS is closed', onclick: () => import('../reminders.js').then((r) => r.exportICS(m.reminderId)).catch((e) => toast(e.message, { bad: true })) }, iconNode('download'), /iPhone|iPad|iPod/.test(navigator.userAgent) ? 'Add to iPhone Calendar' : 'Add to Calendar'));
  if (m.picture) row.append(h('div', { class: 'made-picture' }, h('img', { src: m.picture, alt: 'Picture made by JARVIS' }),
    h('div', { class: 'flex' },
      h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => { const r = await call('file.save', { name: 'JARVIS-picture.png', base64: m.picture.split(',')[1] }).catch((e) => toast(e.message, { bad: true })); if (r?.ok) toast('Picture saved'); } }, iconNode('download'), 'Save'),
      h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: async () => { const img = new Image(); img.src = m.picture; await img.decode(); (await import('./imageedit.js')).openEditor(img); } }, iconNode('edit'), 'Edit'))));
  if (m.reveal) row.append(h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Show in Finder', onclick: () => call('tool.reveal', { path: m.reveal }).catch((e) => toast(e.message, { bad: true })) }));
  if (m.files?.length) {
    const list = h('div', { style: { width: '100%', display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' } });
    for (const f of m.files.slice(0, 8)) {
      list.append(h('div', { class: 'item', style: { padding: '7px 10px' } },
        h('span', { class: 'item-ic', style: { width: '28px', height: '28px' } }, iconNode(f.isDir ? 'folder' : 'file')),
        h('div', { class: 'item-main' }, h('div', { class: 'item-title', text: f.name }), h('div', { class: 'item-sub mono', text: truncate(f.path, 90) })),
        h('div', { class: 'item-actions' },
          h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Open', onclick: () => call('tool.open_path', { path: f.path }).catch((e) => toast(e.message, { bad: true })) }),
          h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Reveal', onclick: () => call('tool.reveal', { path: f.path }).catch((e) => toast(e.message, { bad: true })) }))));
    }
    row.append(list);
  }
  return row;
}

function errorCard(m) {
  const actions = h('div', { class: 'flex' });
  if (m.errorKind === 'offline' && !isNative) {
    actions.append(h('button', { class: 'btn btn-primary btn-sm', type: 'button', text: 'Show me how', onclick: () => openSheet('models') }));
  } else if (m.errorKind === 'offline') {
    actions.append(
      h('button', { class: 'btn btn-primary btn-sm', type: 'button', text: ollama.engine.status === 'not-installed' ? 'Set up the AI engine' : 'Start the AI engine', onclick: async () => {
        if (ollama.engine.status === 'not-installed') return openSheet('models');
        try { await ollama.startEngine(); toast('Starting the AI engine…'); setTimeout(() => ollama.detect(), 2500); } catch (e) { toast(e.message, { bad: true }); }
      } }),
      h('button', { class: 'btn btn-sm', type: 'button', text: 'Open Model Manager', onclick: () => openSheet('models') }));
  } else if (m.errorKind === 'novision') {
    const pick = ollama.bestVisionPick(window.__deviceRam || 8);
    actions.append(h('button', { class: 'btn btn-primary btn-sm', type: 'button', text: `Get ${pick.label} (free, ${pick.size} GB)`, onclick: () => openSheet('models') }));
  } else if (m.errorKind === 'pictureai') {
    actions.append(h('button', { class: 'btn btn-primary btn-sm', type: 'button', text: `Download and answer (${m.sizeMB || 210} MB)`, onclick: (e) => { e.currentTarget.closest('.notice-card')?.remove(); const s = sessions.state.current; const i = s.messages.indexOf(m); if (i >= 0) s.messages.splice(i, 1); assistant.answerPicture(m.forMsg); } }));
    if (!ollama.isPhone()) { const pick = ollama.bestVisionPick(window.__deviceRam || 8); actions.append(h('button', { class: 'btn btn-sm', type: 'button', text: `Or a bigger one: ${pick.label} (${pick.size} GB)`, onclick: () => openSheet('models') })); }
  } else if (m.errorKind === 'gpu') {
    // Reloading gives the graphics chip back; the question is asked again afterwards.
    actions.append(
      h('button', { class: 'btn btn-primary btn-sm', type: 'button', text: 'Restart JARVIS', onclick: () => {
        const s = sessions.state.current;
        let u = s.messages.indexOf(m) - 1;
        while (u >= 0 && s.messages[u].role !== 'user') u--;
        if (u < 0) { location.reload(); return; }
        try { sessionStorage.setItem('jarvis-gpu-resend', JSON.stringify({ sid: s.id, text: s.messages[u].content, at: Date.now() })); } catch {}
        s.messages.splice(u);
        sessions.saveNow(s).catch(() => {}).finally(() => location.reload());
      } }),
      h('button', { class: 'btn btn-sm', type: 'button', text: 'Use a smaller model', onclick: () => openSheet('models') }));
  } else if (m.errorKind === 'nomodel') {
    actions.append(h('button', { class: 'btn btn-primary btn-sm', type: 'button', text: 'Get a free model', onclick: () => openSheet('models') }));
  }
  actions.append(h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Try again', onclick: () => retry(m) }));
  return h('div', { class: 'card glass notice-card', dataset: { id: m.id } },
    h('span', { class: 'ic' }, iconNode('alert')),
    h('div', { class: 'grow' }, h('div', { text: m.error, style: { fontSize: '13.5px', lineHeight: 1.5 } }), actions));
}

/** A flip-card deck: tap to turn over, arrows to move. */
function flashcards(cards) {
  let i = 0, flipped = false, order = cards.map((_, k) => k);
  const face = h('div', { class: 'fc-face' });
  const count = h('span', { class: 'mono muted' });
  const card = h('button', { class: 'fc-card', type: 'button', 'aria-live': 'polite', onclick: () => { flipped = !flipped; draw(); } }, face);
  const draw = () => { const c = cards[order[i]]; card.classList.toggle('back', flipped); face.replaceChildren(h('small', { text: flipped ? 'Answer' : 'Question' }), h('div', { text: flipped ? c.a : c.q })); count.textContent = `${i + 1} / ${cards.length}`; };
  const go = (d) => { i = (i + d + cards.length) % cards.length; flipped = false; draw(); };
  draw();
  return h('div', { class: 'fc' }, card, h('div', { class: 'flex', style: { justifyContent: 'space-between', marginTop: '8px' } },
    h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: '← Back', onclick: () => go(-1) }), count,
    h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Shuffle', onclick: () => { order = order.sort(() => Math.random() - 0.5); i = 0; flipped = false; draw(); } }),
    h('button', { class: 'btn btn-sm', type: 'button', text: 'Next →', onclick: () => go(1) })));
}

async function pressButton(b) {
  if (b.send) return assistant.send(b.send);
  if (b.open) return openSheet(b.open);
  if (b.plugin) {
    const p = await import('../plugins.js');
    const { runSuggestion } = await import('./plugins.js');
    const plugin = b.plugin === 'ai' ? { id: 'ai', name: 'The free AI', open: 'models' } : p.PLUGINS.find((x) => x.id === b.plugin);
    if (!plugin) return;
    if (b.plugin === 'ai') return openSheet('models');
    runSuggestion({ plugin, action: b.action });
  }
}

function retry(m) {
  const s = sessions.state.current;
  const i = s.messages.indexOf(m);
  if (i < 0) return;
  let u = i - 1;
  while (u >= 0 && s.messages[u].role !== 'user') u--;
  if (u < 0) return;
  const userMsg = s.messages[u];
  s.messages.splice(u);
  renderAll();
  assistant.send(userMsg.content, { viaVoice: !!userMsg.voice });
}

function copy(text) {
  navigator.clipboard?.writeText(text).then(() => toast('Copied')).catch(() => call('app.copy', { text }).then(() => toast('Copied')));
}

function onClick(e) {
  const a = e.target.closest('a[data-href]');
  if (a) { e.preventDefault(); call('app.openExternal', { url: a.dataset.href }).catch(() => window.open(a.dataset.href, '_blank', 'noopener')); return; }
  const cb = e.target.closest('.copy-code');
  if (cb) { copy(cb.nextElementSibling?.textContent || ''); cb.textContent = 'Copied'; setTimeout(() => (cb.textContent = 'Copy'), 1500); }
}

// ---------------------------------------------------------------- confirmations
function confirmCard({ tool, args, info }) {
  return new Promise((resolve) => {
    const danger = !!info.danger || tool.category === 'commands';
    const canAlways = tool.category && tool.category !== 'commands' && !tool.alwaysAsk;
    const detail = h('div', { class: 'confirm-detail' }, info.detail ? h('div', { text: info.detail }) : null, info.preview ? h('pre', { text: info.preview }) : null);
    const done = (answer, label) => {
      card.querySelector('.confirm-actions').replaceWith(h('div', { class: 'confirm-done', text: label }));
      card.classList.remove('confirm-card');
      bus.emit('state', 'thinking');
      document.removeEventListener('keydown', keys, true);
      resolve(answer);
    };
    const allowBtn = h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => done('allow', '✓ Allowed') }, iconNode('check'), 'Allow');
    const card = h('div', { class: 'card glass confirm-card' + (danger ? ' danger' : ''), role: 'alertdialog', 'aria-label': info.title },
      h('div', { class: 'confirm-head' }, h('span', { class: 'ic' }, iconNode(tool.icon || 'shield')), h('div', {}, h('small', { text: `${settings.assistantName} would like to` }), h('span', { text: info.title }))),
      detail,
      h('div', { class: 'confirm-actions' },
        allowBtn,
        canAlways ? h('button', { class: 'btn btn-sm', type: 'button', text: 'Always allow', title: 'Stop asking for this kind of action (change it any time in Settings → Permissions)', onclick: () => done('always', '✓ Allowed — won’t ask again for this') }) : null,
        h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Don’t allow', onclick: () => done('deny', '✕ Not allowed') })));
    // Voice: "yes" / "no" while the card is open.
    const offVoice = bus.on('voice.final.confirm', (t) => {
      if (/^(yes|yeah|yep|sure|ok|okay|do it|go ahead|allow|confirm)\b/i.test(t)) done('allow', '✓ Allowed by voice');
      else if (/^(no|nope|don'?t|stop|cancel|deny)\b/i.test(t)) done('deny', '✕ Not allowed');
    });
    const keys = (e) => { if (e.key === 'Escape' && document.activeElement?.closest('.confirm-card')) { e.preventDefault(); done('deny', '✕ Not allowed'); } };
    document.addEventListener('keydown', keys, true);
    const origResolve = resolve;
    resolve = (a) => { offVoice(); origResolve(a); };
    thread.append(card);
    scrollDown(true);
    setTimeout(() => allowBtn.focus({ preventScroll: true }), 50);
    if (assistant.run.lastViaVoice && settings.voice.speak !== 'never') voice.speak(`May I ${info.title.charAt(0).toLowerCase() + info.title.slice(1)}?`);
    bus.emit('confirm.open', { tool: tool.name });
  });
}
