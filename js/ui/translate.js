// Live conversation translator: two people, two languages, one device between you.
// Each person taps their side and speaks (or types); JARVIS translates with the AI on
// this device and says it out loud in the other person's language.
import { h, iconNode, bus } from '../util.js';
import { registerTab, refresh } from './sheets.js';
import { section, toast } from './common.js';
import { settings, set } from '../store.js';
import { can } from '../host.js';
import * as voice from '../voice.js';

import { LANGS, nameOf } from '../languages.js';

const turns = [];   // this conversation only (not saved)
let busy = false;

export async function translate(text, from, to) {
  const { complete } = await import('../research.js');
  const out = await complete(`You are a live interpreter. Translate the message from ${nameOf(from)} into ${nameOf(to)}. Keep the meaning and tone, use natural everyday ${nameOf(to)}. Reply with ONLY the translation: no quotes, notes or explanations.`, text);
  return String(out || '').replace(/^["“]|["”]$/g, '').replace(/^(?:translation|traducción|traduction)\s*:\s*/i, '').trim();
}

registerTab('translate', (body) => {
  const tr = settings.translator || {};
  const a = tr.a || (LANGS.find((l) => l[0] === settings.voice.locale) ? settings.voice.locale : 'en-US');
  const b = tr.b || (a.startsWith('es') ? 'en-US' : 'es-ES');
  const select = (value, key, label) => {
    const s = h('select', { class: 'field', 'aria-label': label }, ...LANGS.map(([c, n]) => h('option', { value: c, text: n, selected: c === value })));
    s.addEventListener('change', () => { set('translator', { ...(settings.translator || {}), a, b, [key]: s.value }); refresh(); });
    return s;
  };
  const log = h('div', { class: 'tr-log', 'aria-live': 'polite' });
  const status = h('p', { class: 'muted small', text: '' });
  const draw = () => {
    log.replaceChildren(...turns.map((t) => h('div', { class: 'tr-turn ' + t.side },
      h('small', { class: 'muted', text: `${nameOf(t.from)} → ${nameOf(t.to)}` }),
      h('div', { class: 'tr-orig', text: t.text }),
      h('div', { class: 'tr-out' }, t.pending ? h('span', { class: 'muted', text: 'Translating…' }) : t.error ? h('span', { class: 'bad', text: t.error }) : t.out,
        !t.pending && !t.error ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Say it again', title: 'Say it again', onclick: () => voice.speak(t.out, { lang: t.to }) }, iconNode('volume')) : null))));
    if (!turns.length) log.append(h('div', { class: 'empty', text: 'Tap a side and speak, or type below. Each turn is translated and spoken in the other language.' }));
    log.scrollTop = log.scrollHeight;
  };
  const handle = async (side, text) => {
    const from = side === 'a' ? a : b, to = side === 'a' ? b : a;
    const t = { side, from, to, text: text.trim(), pending: true };
    if (!t.text) return;
    turns.push(t); draw();
    busy = true;
    try {
      t.out = await translate(t.text, from, to);
      if (!t.out) throw new Error('The AI gave no translation. Try again.');
      t.pending = false; draw();
      if (settings.translator?.speak !== false) voice.speak(t.out, { lang: to });
    } catch (e) { t.pending = false; t.error = /model|engine|offline|connect/i.test(e.message) ? 'The AI isn’t ready. Open AI Models and get a free model first.' : e.message; draw(); }
    busy = false;
  };
  const listenFor = async (side, btn) => {
    if (busy) return;
    if (voice.voice.listening) { voice.voice.capture = null; voice.stopListening(); btn.classList.remove('live'); status.textContent = ''; return; }
    const code = side === 'a' ? a : b;
    try {
      voice.stopSpeaking();
      voice.voice.capture = (text) => { btn.classList.remove('live'); status.textContent = ''; handle(side, text); };
      await voice.listen('command', { locale: code });
      btn.classList.add('live');
      status.textContent = `Listening for ${nameOf(code)}… tap again to stop.`;
    } catch (e) { voice.voice.capture = null; btn.classList.remove('live'); status.textContent = ''; toast(e.message, { bad: true, ms: 8000 }); }
  };
  const side = (key, code) => {
    const btn = h('button', { class: 'tr-mic', type: 'button', 'aria-label': `Speak ${nameOf(code)}` }, iconNode('mic'), h('span', { text: `Speak ${nameOf(code)}` }));
    btn.addEventListener('click', () => listenFor(key, btn));
    const input = h('input', { class: 'field', type: 'text', placeholder: `Or type in ${nameOf(code)}`, 'aria-label': `Type in ${nameOf(code)}` });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && input.value.trim()) { handle(key, input.value); input.value = ''; } });
    return h('div', { class: 'tr-side' }, select(code, key, key === 'a' ? 'Your language' : 'Their language'), can('voiceIn') ? btn : null, input);
  };
  const off = bus.on('voice.nothing', () => { status.textContent = 'I didn’t hear anything. Tap and try again.'; body.querySelectorAll('.tr-mic.live').forEach((x) => x.classList.remove('live')); });
  draw();
  body.append(section('Live translator', 'Two people, two languages. Translation uses the AI on this device; speech uses your device’s own recognition (on the Mac it works offline for most languages; in browsers it may need “Offline only” turned off in Settings → Voice). Nothing here is saved.',
    h('div', { class: 'tr-sides' }, side('a', a), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Swap languages', title: 'Swap languages', onclick: () => { set('translator', { ...(settings.translator || {}), a: b, b: a }); refresh(); } }, iconNode('refresh')), side('b', b)),
    status,
    log,
    h('div', { class: 'flex' },
      h('label', { class: 'flex small' }, (() => { const c = h('input', { type: 'checkbox', checked: settings.translator?.speak !== false }); c.addEventListener('change', () => set('translator', { ...(settings.translator || {}), a, b, speak: c.checked })); return c; })(), h('span', { text: 'Say translations out loud' })),
      h('button', { class: 'btn', type: 'button', text: 'Clear', onclick: () => { turns.length = 0; draw(); } }))));
  return () => { off(); if (voice.voice.capture) { voice.voice.capture = null; if (voice.voice.listening) voice.stopListening(); } };
});
