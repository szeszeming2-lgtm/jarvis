// "Use offline" page: a checklist of what JARVIS needs on this device to work with no
// internet, one button to save what's missing, and plain notes on what needs internet.
import { h, iconNode } from '../util.js';
import { registerTab, refresh } from './sheets.js';
import { section, rows, row, toast, dialog, callout } from './common.js';
import { isNative } from '../host.js';
import * as O from '../offline.js';

const LABELS = { app: 'JARVIS itself', keep: 'Keep it on this device', ai: 'The AI (chat)', voiceIn: 'Talking to JARVIS', voiceOut: 'Spoken replies' };
const ORDER = ['app', 'keep', 'ai', 'voiceIn', 'voiceOut'];

registerTab('offline', (body) => {
  const list = h('div', { class: 'rows' });
  const status = h('div', { class: 'muted small', style: { minHeight: '18px' } });
  const bar = h('div', { class: 'progress', style: { display: 'none', marginTop: '6px' } }, h('i'));
  const go = h('button', { class: 'btn btn-primary', type: 'button', style: { width: '100%', justifyContent: 'center', minHeight: '46px' } }, iconNode('download'), 'Get ready for offline');
  let state = null;
  const draw = async () => {
    status.textContent = 'Checking…';
    state = await O.readiness();
    list.replaceChildren(...ORDER.filter((k) => state[k]).map((k) => {
      const p = state[k];
      return row(LABELS[k], p.detail, h('span', { class: 'pill ' + (p.ok ? 'ok' : p.info ? '' : 'warn'), text: p.ok ? 'Ready' : p.info ? 'Info' : p.sizeMB ? `${p.sizeMB} MB` : 'Not yet' }));
    }));
    const todo = ORDER.filter((k) => state[k] && !state[k].ok && state[k].fix);
    go.hidden = isNative || !todo.length;
    status.textContent = isNative ? '' : todo.length ? `${todo.length} thing${todo.length === 1 ? '' : 's'} to save.` : '✓ Ready: JARVIS works on this device with no internet.';
  };
  go.onclick = async () => {
    const todo = ORDER.filter((k) => state[k] && !state[k].ok && state[k].fix).map((k) => state[k].fix);
    const mb = ORDER.reduce((n, k) => n + (state[k] && !state[k].ok && state[k].sizeMB ? state[k].sizeMB : 0), 0);
    if (mb && !(await dialog({ title: `Download about ${mb} MB?`, text: `This is done once. Wi-Fi is best. After that JARVIS works with no internet${state.voiceIn && !state.voiceIn.ok ? ', including talking to it' : ''}.`, okLabel: 'Download' }))) return;
    go.disabled = true; bar.style.display = '';
    try {
      const done = await O.prepare(todo, (p) => { status.textContent = p.text || ''; if (p.progress != null) bar.firstChild.style.width = Math.round(p.progress * 100) + '%'; });
      toast(`Done: ${done.join(', ')}.`, { ms: 6000 });
    } catch (e) { toast(e.message, { bad: true, ms: 8000 }); }
    go.disabled = false; bar.style.display = 'none';
    draw();
  };
  const w = O.whereNow();
  body.append(
    callout(isNative ? '<b>The Mac app works offline.</b> The AI (Ollama), speech recognition and voices all run on this Mac. Only weather, news, research, page reading and syncing need the internet.' : '<b>Use JARVIS with no internet.</b> Save these once while you’re online. Then JARVIS opens, chats, keeps your lists, reminders and notes, and can even hear you, in Airplane Mode.', { icon: 'wifi' }),
    w.ios ? callout(w.standalone ? 'You’re using the <b>Home Screen app</b>. On iPhone it keeps its own copy, separate from Safari: get ready here, and open JARVIS from the Home Screen when you’re offline.' : 'You’re in <b>Safari</b>. On iPhone, Safari and the Home Screen app keep separate copies. Best: tap Share → Add to Home Screen, open JARVIS from there and get ready in that one (iPhone also keeps Home Screen apps’ data more reliably).', { warn: !w.standalone, icon: 'phone' }) : null,
    section('Ready for offline?', '', list, status, bar, go,
      h('button', { class: 'btn btn-sm btn-ghost', type: 'button', style: { marginTop: '8px' }, onclick: draw }, iconNode('refresh'), 'Check again')),
    section('Works offline', '', h('ul', { class: 'muted', style: { lineHeight: 1.7, margin: 0, paddingLeft: '18px' } },
      ...['Chat with the AI on this device', 'Lists, notes, to-dos, people, projects, habits, goals, budget', 'Reminders, timers, stopwatch, calculator, unit converter', 'Your saved chats, memories and links', 'Spoken replies; talking to JARVIS (with offline voice typing saved)', 'Picture questions (once the picture AI is saved)', 'Focus sessions, Command Center, profiles and the app lock'].map((t) => h('li', { text: t })))),
    section('Needs the internet', '', h('ul', { class: 'muted', style: { lineHeight: 1.7, margin: 0, paddingLeft: '18px' } },
      ...['Weather, news, deep research, fact checks and reading web pages', 'Syncing with your other devices, the iPhone companion and push notifications', 'JARVIS Call and calls through other apps', 'The first download of the AI and voice typing'].map((t) => h('li', { text: t })))),
    section('Test it', 'Turn on Airplane Mode, close JARVIS completely (swipe it away), open it again and send a message.', h('span')));
  draw();
});
