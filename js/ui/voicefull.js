// Full-screen voice view: when you talk to JARVIS, the animated core fills the screen with
// big captions (what you said, what JARVIS answers) and the "Try saying" ideas. It opens by
// itself when you start talking (Settings → Voice → Full screen when I talk) and closes when
// the conversation ends, or with ✕ / Esc. The real core is moved in here, so it keeps reacting
// to your voice exactly as before.
import { h, $, iconNode, bus } from '../util.js';
import { settings } from '../store.js';
import { toSpeech } from '../markdown.js';
import * as voice from '../voice.js';
import * as assistant from '../assistant.js';
import * as sessions from '../sessions.js';
import { currentSuggestions, useSuggestion } from './chat.js';

let layer = null, home = [], idleTimer = 0, offs = [];
export const isOpen = () => !!layer;

const lastOf = (role) => [...(sessions.state.current?.messages || [])].reverse().find((m) => m.role === role && (m.content || m.pending));
const tail = (s, n) => (s.length > n ? '…' + s.slice(s.length - n).replace(/^\S*\s/, '') : s);

function draw() {
  if (!layer) return;
  const you = lastOf('user'), me = lastOf('assistant');
  const youEl = layer.querySelector('.vf-you'), meEl = layer.querySelector('.vf-me');
  const partial = voice.voice.listening && voice.voice.mode === 'command' ? voice.voice.partial : '';
  youEl.textContent = partial || (you ? String(you.content || '') : '');
  youEl.classList.toggle('live', !!partial);
  const ans = me && (!you || (sessions.state.current.messages.indexOf(me) > sessions.state.current.messages.indexOf(you))) ? me : null;
  meEl.textContent = ans ? (ans.pending && !ans.content ? '…' : tail(toSpeech(ans.content || '') || String(ans.error || ''), 320)) : '';
  // Buttons follow what's happening.
  const busy = assistant.run.busy || voice.voice.speaking;
  const mic = layer.querySelector('.vf-mic');
  mic.classList.toggle('live', voice.voice.listening && voice.voice.mode === 'command');
  mic.replaceChildren(iconNode(busy ? 'stop' : 'mic'));
  mic.setAttribute('aria-label', busy ? 'Stop' : voice.voice.listening ? 'Stop listening' : 'Talk');
  layer.querySelector('.vf-hint').textContent = voice.voice.listening && voice.voice.mode === 'command' ? 'Listening… just talk' : busy ? (voice.voice.speaking ? 'Tap ■ to interrupt' : 'Thinking…') : 'Tap the microphone to talk';
  // "Try saying" when it's your turn.
  const sug = layer.querySelector('.vf-suggest');
  const list = busy || voice.voice.listening ? [] : currentSuggestions();
  sug.replaceChildren(...(list.length ? [h('span', { class: 'next-label', text: 'Try saying' }), ...list.map((s) => h('button', { class: 'suggestion next-chip', type: 'button', text: s.fill ? s.text.trim() + ' …' : s.label, onclick: () => { if (s.fill) { close(); useSuggestion(s); } else assistant.send(s.text); } }))] : []));
}

/** Close by itself a few seconds after the conversation goes quiet. */
function watchIdle() {
  clearTimeout(idleTimer);
  if (!layer || layer.dataset.manual === '1') return;
  const active = assistant.run.busy || voice.voice.speaking || (voice.voice.listening && voice.voice.mode === 'command');
  if (!active) idleTimer = setTimeout(() => { if (!(assistant.run.busy || voice.voice.speaking || (voice.voice.listening && voice.voice.mode === 'command'))) close(); }, 12000);
}

export function open({ manual = false } = {}) {
  if (layer) { if (manual) layer.dataset.manual = '1'; return; }
  const orb = $('#orbWrap'), status = $('#orbStatus');
  if (!orb || !status) return;
  home = [orb, status].map((n) => ({ n, parent: n.parentNode, next: n.nextSibling }));
  const mic = h('button', { class: 'vf-mic', type: 'button', 'aria-label': 'Talk' }, iconNode('mic'));
  mic.addEventListener('click', () => { if (assistant.run.busy || voice.voice.speaking) { assistant.stop(); voice.stopSpeaking(); } else (window.__jarvis?.toggleListen || (() => voice.listen('command').catch(() => {})))(); });
  layer = h('div', { class: 'voice-full', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Voice conversation', dataset: { manual: manual ? '1' : '0' } },
    h('div', { class: 'vf-top' },
      h('span', { class: 'vf-name', text: settings.assistantName }),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Type instead', title: 'Type instead', onclick: () => { close(); $('#input')?.focus(); } }, iconNode('keyboard')),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close full screen', title: 'Close (Esc)', onclick: () => close() }, iconNode('x'))),
    h('div', { class: 'vf-stage' }),
    h('div', { class: 'vf-captions', 'aria-live': 'polite' }, h('div', { class: 'vf-you' }), h('div', { class: 'vf-me' })),
    h('div', { class: 'vf-suggest' }),
    h('div', { class: 'vf-bottom' }, mic, h('div', { class: 'vf-hint' })));
  layer.querySelector('.vf-stage').append(orb, status);
  document.body.append(layer);
  document.documentElement.classList.add('vf-open');
  const redraw = () => { draw(); watchIdle(); };
  offs = [
    ...['voice.state', 'voice.partial', 'msg.add', 'msg.update', 'msg.stream', 'turn.done', 'busy', 'session'].map((ev) => bus.on(ev, redraw)),
    // JARVIS needs your OK, or a settings page opens: show the normal screen.
    bus.on('state', (s) => { if (s === 'waiting') close(); }),
    bus.on('sheet', (tab) => { if (tab) close(); }),
  ];
  document.addEventListener('keydown', onKey, true);
  redraw();
}

function onKey(e) { if (e.key === 'Escape' && layer) { e.preventDefault(); e.stopPropagation(); close(); } }

export function close() {
  if (!layer) return;
  clearTimeout(idleTimer);
  offs.forEach((f) => f()); offs = [];
  document.removeEventListener('keydown', onKey, true);
  for (const { n, parent, next } of home) parent.insertBefore(n, next && next.parentNode === parent ? next : null);
  layer.remove(); layer = null;
  document.documentElement.classList.remove('vf-open');
}

/** Open by itself when you start talking (not for the lock screen, translator or other screens that borrow the microphone). */
export function init() {
  bus.on('voice.state', (v) => {
    if (layer || settings.voice?.fullscreen === false) return;
    if (v.listening && v.mode === 'command' && !voice.voice.capture && !document.querySelector('.sheet-layer:not([hidden]), .lock-layer, .call-screen, .ask-layer')) open();
  });
}
