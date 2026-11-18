// Incoming "call" from JARVIS: opened from the 📞 link it texts you.
// Answer → JARVIS speaks the message out loud and listens for your reply.
import { h, iconNode } from '../util.js';
import { settings } from '../store.js';
import * as voice from '../voice.js';
import { can } from '../host.js';

/** If the page was opened from a call link (#call=…), show the incoming-call screen. */
export function checkForCall() {
  if (!location.hash.startsWith('#call')) return false;
  const p = new URLSearchParams(location.hash.slice(1));
  const message = (p.get('call') || '').slice(0, 300);
  const from = (p.get('from') || settings.assistantName || 'JARVIS').slice(0, 30);
  history.replaceState(null, '', location.pathname + location.search);
  showCall({ message, from });
  return true;
}

export function showCall({ message = '', from = 'JARVIS' }) {
  const who = settings.userName?.trim() || (['sir', "ma'am"].includes(settings.honorific) ? settings.honorific : '');
  const greeting = `Hello${who ? ' ' + who : ''}, it’s ${from}. ${message ? `You asked me to call you: ${message}.` : 'You asked me to call you.'}`;
  const status = h('div', { class: 'call-status', text: 'Incoming call…' });
  const said = h('div', { class: 'call-said' });
  let started = Date.now();
  let timer = 0;
  const end = () => { clearInterval(timer); voice.stopSpeaking(); if (voice.voice.listening) voice.stopListening(); layer.remove(); };
  const answer = async () => {
    buttons.replaceChildren(h('button', { class: 'call-btn decline', type: 'button', 'aria-label': 'Hang up', onclick: end }, iconNode('phone'), h('span', { text: 'Hang up' })));
    layer.classList.add('live');
    started = Date.now();
    status.textContent = '0:00';
    timer = setInterval(() => { const s = Math.floor((Date.now() - started) / 1000); status.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }, 1000);
    said.textContent = greeting;
    voice.stopSpeaking();
    voice.speak(greeting + (can('voiceIn') ? ' What would you like to do?' : ''));
    // After JARVIS finishes speaking, listen for the reply (it continues in the normal chat).
    const { bus } = await import('../util.js');
    const off = bus.on('voice.done', async () => {
      off();
      if (!document.body.contains(layer)) return;
      try { await voice.listen('command'); said.textContent = 'Listening…'; }
      catch { said.textContent = 'Type your reply in the chat, or hang up.'; }
    });
    const off2 = bus.on('voice.final', () => { off2(); setTimeout(end, 400); });
  };
  const buttons = h('div', { class: 'call-buttons' },
    h('button', { class: 'call-btn decline', type: 'button', 'aria-label': 'Decline', onclick: end }, iconNode('phone'), h('span', { text: 'Decline' })),
    h('button', { class: 'call-btn accept', type: 'button', 'aria-label': 'Answer', onclick: answer }, iconNode('phone'), h('span', { text: 'Answer' })));
  const layer = h('div', { class: 'call-screen', role: 'dialog', 'aria-label': `${from} is calling` },
    h('div', { class: 'call-orb', 'aria-hidden': 'true' }, h('span'), h('span'), h('span')),
    h('div', { class: 'call-name', text: from }),
    status,
    message ? h('div', { class: 'call-topic', text: message }) : null,
    said,
    buttons,
    h('div', { class: 'call-note', text: 'A free call from your own JARVIS. Nothing leaves your devices.' }));
  document.body.append(layer);
  navigator.vibrate?.([400, 200, 400, 200, 400]);
}
