// JARVIS core entry point: boots the app and wires the main screen together.
import { $, h, hydrateIcons, iconNode, bus, greetingFor, sleep } from './util.js';
import { info, isNative, call, can } from './host.js';
import { settings, loadSettings, set } from './store.js';
import * as ollama from './ollama.js';
import * as sessions from './sessions.js';
import * as memory from './memory.js';
import * as skills from './skills.js';
import * as assistant from './assistant.js';
import * as voice from './voice.js';
import { Visualizer } from './visualizer.js';
import * as chat from './ui/chat.js';
import { initSidebar, initHud } from './ui/panels.js';
import { openSheet, closeSheet, isOpen as sheetOpen } from './ui/sheets.js';
import { openWizard } from './ui/wizard.js';
import { applyAppearance } from './ui/theme.js';
import { toast, menu, matches, prettyKey } from './ui/common.js';
import './ui/settings.js';
import './ui/models.js';
import './ui/memory-skills.js';

const app = { viz: null, ready: false, engine: ollama.engine, assistant, sessions, settings, voice };
window.__jarvis = app; // handy for tests and debugging

async function boot() {
  const hi = await info();
  window.__deviceRam = hi.ramGB || 8;
  document.documentElement.classList.toggle('native', isNative);
  if (hi.titlebar) document.documentElement.style.setProperty('--titlebar', hi.titlebar + 'px');
  await loadSettings();
  applyAppearance();
  hydrateIcons();
  await Promise.all([memory.load(), skills.load(), sessions.load()]);
  sessions.create();

  app.viz = new Visualizer($('#visualizer'));
  chat.init();
  initSidebar();
  initHud();
  wireComposer();
  wireTopbar();
  wireVoice();
  wireShortcuts();
  applyLayout();
  renderWelcome();
  bus.on('theme', () => app.viz.readColors());
  bus.on('identity', () => { renderWelcome(); $('#brandName').textContent = settings.assistantName.toUpperCase(); document.title = settings.assistantName; });
  bus.on('home', () => { applyLayout(); renderWelcome(); });
  bus.on('session', (s) => { $('#sessionTitle').value = s.title; renderWelcome(); });
  bus.on('session.title', (s) => { if (s === sessions.state.current) $('#sessionTitle').value = s.title; });
  bus.on('wizard.open', openWizard);
  bus.on('wizard.closed', () => { renderWelcome(); syncWake(); $('#input').focus(); });
  bus.on('timer.done', (d) => { const text = `Your ${d.label ? d.label + ' ' : ''}timer is done.`; toast(text, { icon: 'clock', ms: 8000 }); if (settings.voice.speak !== 'never') voice.speak(text); app.viz.kick(1); });
  $('#brandName').textContent = settings.assistantName.toUpperCase();
  document.title = settings.assistantName;

  ollama.detect().then(() => { updateModelChip(); if (ollama.engine.status === 'online') ollama.warm(); });
  bus.on('engine', updateModelChip);
  bus.on('settings', (d) => { if (d.path.startsWith('ai.')) updateModelChip(); if (d.path === 'voice.speak') updateSpeakToggle(); });
  setInterval(() => { if (ollama.engine.status !== 'online' && !document.hidden) ollama.detect(); }, 15000);

  if (!settings.setupDone) openWizard();
  else syncWake();
  app.ready = true;
  bus.emit('ready');
  // Web version: cache the interface so it opens offline (never inside the desktop app).
  if (!isNative && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !/[?&]nosw\b/.test(location.search)) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('offline cache', e));
  }
  call('app.ready', {}).catch(() => {});
}

// ------------------------------------------------------------------ welcome
const SUGGESTIONS = [
  ['sparkles', 'What can you do?', 'What can you do for me? Give me a few examples.'],
  ['cpu', 'System report', 'Give me a system status report'],
  ['clock', 'Set a 10 min timer', 'set a timer for 10 minutes'],
  ['broom', 'Tidy my Downloads', 'Organize my Downloads folder by file type'],
  ['coffee', 'Morning briefing', '/brief'],
  ['calculator', '18% tip on $64', 'what is 18% of 64'],
];
function renderWelcome() {
  const name = settings.userName?.trim();
  const hon = settings.honorific;
  const who = name || (hon === 'sir' || hon === "ma'am" ? hon : '');
  $('#greeting').replaceChildren(`${greetingFor()}${who ? ', ' : '.'}`, who ? h('b', { text: who }) : '', who ? '.' : '');
  const st = ollama.engine.status;
  $('#greetingSub').textContent = st === 'online' && settings.ai.model ? `${settings.assistantName} online. How can I help?` : st === 'checking' || st === 'unknown' ? 'Bringing systems online…' : st === 'blocked' ? 'One quick step left: connect me to Ollama (click “Connect to Ollama” above).' : `${settings.assistantName} is ready for instant commands. Set up the AI engine for full conversations.`;
  const box = $('#suggestions');
  box.replaceChildren();
  if (!settings.home.suggestions) return;
  for (const [ic, label, text] of SUGGESTIONS) {
    if (text.startsWith('Give me a system') && !can('status')) continue;
    if (text.startsWith('Organize') && !can('files')) continue;
    box.append(h('button', { class: 'suggestion', type: 'button', onclick: () => assistant.send(text) }, iconNode(ic), label));
  }
}

function applyLayout() {
  $('#app').classList.toggle('no-sidebar', !settings.home.sidebar);
  $('#app').classList.toggle('no-hud', !settings.home.hud);
  $('#hudToggle').classList.toggle('on', settings.home.hud);
}

// ------------------------------------------------------------------ top bar
function wireTopbar() {
  $('#sidebarToggle').addEventListener('click', () => { set('home.sidebar', !settings.home.sidebar); applyLayout(); });
  $('#hudToggle').addEventListener('click', () => { set('home.hud', !settings.home.hud); applyLayout(); });
  $('#newChatBtn').addEventListener('click', newChat);
  $('#speakToggle').addEventListener('click', () => {
    if (settings.voice.speak === 'never') set('voice.speak', settings.voice._lastSpeak || 'voice');
    else { set('voice._lastSpeak', settings.voice.speak); set('voice.speak', 'never'); voice.stopSpeaking(); }
    updateSpeakToggle();
    toast(settings.voice.speak === 'never' ? 'Spoken replies off' : settings.voice.speak === 'always' ? 'Spoken replies on' : 'Replies are spoken when you talk', { icon: 'speaker' });
  });
  updateSpeakToggle();
  const title = $('#sessionTitle');
  title.addEventListener('change', () => { const s = sessions.state.current; if (s.messages.length) sessions.rename(s.id, title.value); else { s.title = title.value; s.titled = true; } });
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { title.blur(); $('#input').focus(); } });
  document.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openSheet(b.dataset.open)));
  $('#modelChip').addEventListener('click', () => {
    const e = ollama.engine;
    if (e.status !== 'online' && !isNative) { openSheet('models'); return; }
    const items = [{ header: 'AI model' }];
    for (const m of e.models) items.push({ label: m.name, icon: 'layers', on: m.name === settings.ai.model, sub: (m.details?.parameter_size || ''), action: () => { set('ai.model', m.name); ollama.warm(m.name); toast(`Now using ${m.name}`); } });
    if (!e.models.length) items.push({ label: e.status === 'online' ? 'No models installed' : 'AI engine not running', icon: 'alert' });
    items.push('sep', { label: 'Model Manager…', icon: 'sliders', action: () => openSheet('models') });
    if (e.status !== 'online') items.push({ label: 'Check engine again', icon: 'refresh', action: () => ollama.detect() });
    menu($('#modelChip'), items, { align: 'right' });
  });
}

function updateSpeakToggle() {
  const b = $('#speakToggle');
  const on = settings.voice.speak !== 'never';
  b.replaceChildren(iconNode(on ? 'speaker' : 'speaker-off'));
  b.classList.toggle('on', settings.voice.speak === 'always');
  b.title = { voice: 'Replies are spoken when you talk (click to mute)', always: 'Replies are always spoken (click to mute)', never: 'Spoken replies are off (click to turn on)' }[settings.voice.speak];
}

function updateModelChip() {
  const e = ollama.engine;
  const dot = $('#modelDot');
  const txt = $('#modelChipText');
  dot.className = 'dot ' + (e.status === 'online' ? (settings.ai.model ? 'ok' : 'warn') : e.status === 'checking' ? 'busy' : 'bad');
  if (e.status === 'blocked') dot.className = 'dot warn';
  txt.textContent = e.status === 'online' ? (settings.ai.model || 'No model installed') : e.status === 'checking' ? 'Checking AI engine…' : e.status === 'not-installed' ? 'AI engine not installed' : e.status === 'blocked' ? 'Connect to Ollama' : 'AI engine offline';
  if (!assistant.run.busy && !voice.voice.listening && !voice.voice.speaking) setOrb(e.status === 'online' ? 'idle' : 'offline');
  renderWelcome();
}

function newChat() {
  assistant.stop();
  sessions.saveNow();
  sessions.create();
  $('#input').focus();
}

// ------------------------------------------------------------------ composer
function wireComposer() {
  const input = $('#input');
  const send = $('#sendBtn');
  const grow = () => { input.style.height = 'auto'; input.style.height = Math.min(200, input.scrollHeight) + 'px'; send.classList.toggle('ready', !!input.value.trim() && !assistant.run.busy); };
  input.addEventListener('input', () => { grow(); slashMenu(); });
  input.addEventListener('keydown', (e) => {
    const menuBox = $('#slashMenu');
    if (!menuBox.hidden && ['ArrowDown', 'ArrowUp', 'Tab'].includes(e.key)) { e.preventDefault(); moveSlash(e.key === 'ArrowUp' ? -1 : 1); return; }
    if (!menuBox.hidden && e.key === 'Enter' && menuBox.querySelector('.sel') && !/\s/.test(input.value.trim())) { e.preventDefault(); menuBox.querySelector('.sel').click(); return; }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
    if (e.key === 'Escape' && !menuBox.hidden) { e.preventDefault(); e.stopPropagation(); menuBox.hidden = true; }
  });
  send.addEventListener('click', () => (assistant.run.busy || voice.voice.speaking ? stopAll() : submit()));
  $('#attachBtn').addEventListener('click', attach);
  bus.on('busy', (on) => {
    send.classList.toggle('stop', on);
    send.replaceChildren(iconNode(on ? 'stop' : 'send'));
    send.title = on ? 'Stop (Esc)' : 'Send';
    grow();
    if (!on && !voice.voice.listening) setOrb(voice.voice.speaking ? 'speaking' : ollama.engine.status === 'online' ? 'idle' : 'offline');
  });
  bus.on('state', (s) => { if (s === 'thinking') setOrb('thinking'); else if (s === 'speaking') setOrb('speaking'); else if (s === 'streaming') setOrb('thinking'); else if (s === 'waiting') setOrb('idle', 'Awaiting your approval'); });
  bus.on('msg.stream', () => app.viz.kick(0.05));
  function submit() {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    grow();
    $('#slashMenu').hidden = true;
    assistant.send(text);
  }
}

function stopAll() {
  assistant.stop();
  voice.stopSpeaking();
  if (voice.voice.listening && voice.voice.mode !== 'wake') voice.stopListening();
}

async function attach() {
  try {
    const f = await call('file.pickDocument', {}).catch(async (e) => { if (/desktop app/.test(e.message)) return call('file.open', { accept: '.txt,.md,.csv,.json,.html,.js,.py' }); throw e; });
    if (!f) return;
    let doc = f;
    if (!f.text && f.path) doc = await call('tool.read_document', { path: f.path });
    const text = (doc.text || '').slice(0, 24000);
    const input = $('#input');
    const q = input.value.trim() || `Summarize “${f.name}” in a few key points.`;
    input.value = '';
    assistant.send(q, { attachment: { name: f.name, path: f.path, text } });
  } catch (e) { toast(e.message, { bad: true }); }
}

// Slash menu for skills
let slashIndex = 0;
function slashMenu() {
  const input = $('#input');
  const box = $('#slashMenu');
  const v = input.value;
  if (!v.startsWith('/') || /\s/.test(v)) { box.hidden = true; return; }
  const q = v.slice(1).toLowerCase();
  const list = skills.all().filter((s) => s.enabled !== false && (s.command.includes(q) || s.name.toLowerCase().includes(q)));
  if (!list.length) { box.hidden = true; return; }
  slashIndex = Math.min(slashIndex, list.length - 1);
  box.replaceChildren(...list.map((s, i) => h('div', { class: 'slash-item' + (i === slashIndex ? ' sel' : ''), role: 'option', onclick: () => {
    input.value = '/' + s.command + ' ';
    box.hidden = true;
    input.focus();
    if (s.kind === 'routine') { input.value = ''; assistant.send('/' + s.command); }
  } }, iconNode(s.icon || 'puzzle'), h('b', { text: '/' + s.command }), h('span', { text: s.description || s.name }))));
  box.hidden = false;
}
function moveSlash(d) {
  const items = [...document.querySelectorAll('.slash-item')];
  if (!items.length) return;
  slashIndex = (slashIndex + d + items.length) % items.length;
  items.forEach((n, i) => n.classList.toggle('sel', i === slashIndex));
  items[slashIndex].scrollIntoView({ block: 'nearest' });
}

// ------------------------------------------------------------------ voice + orb
let orbLabel = '';
function setOrb(state, label) {
  app.viz?.setState(state);
  const labels = { idle: 'Standing by', listening: 'Listening', thinking: 'Processing', speaking: 'Speaking', offline: 'AI engine offline', error: 'Error' };
  orbLabel = label || labels[state] || '';
  if (state === 'idle' && voice.voice.listening && voice.voice.mode === 'wake') orbLabel = `Say “${settings.voice.wakeWord}”`;
  $('#orbStatus').textContent = orbLabel;
  $('#micBtn').classList.toggle('live', state === 'listening');
  $('#main').classList.toggle('voice-live', state === 'listening' && !!voice.voice.partial);
}

function wireVoice() {
  const mic = $('#micBtn');
  const toggleListen = async () => {
    if (voice.voice.listening && voice.voice.mode === 'command') { voice.stopListening(); return; }
    if (assistant.run.busy && !assistant.run.confirmResolvers.size) assistant.stop();
    try { await voice.listen('command'); setOrb('listening'); }
    catch (e) { toast(e.message, { bad: true, ms: 6000 }); setOrb('error', 'Microphone unavailable'); setTimeout(() => setOrb('idle'), 2500); }
  };
  mic.addEventListener('click', toggleListen);
  $('#orbHit').addEventListener('click', () => { if (voice.voice.speaking || assistant.run.busy) stopAll(); else toggleListen(); });
  app.toggleListen = toggleListen;

  bus.on('voice.level', (l) => app.viz.setLevel(l));
  bus.on('voice.word', () => app.viz.kick(0.55));
  bus.on('voice.partial', (t) => {
    const p = $('#partial');
    p.hidden = !t;
    p.textContent = t;
    $('#main').classList.toggle('voice-live', !!t);
  });
  bus.on('voice.state', (v) => {
    if (v.listening && v.mode === 'command') setOrb('listening');
    else if (v.speaking) setOrb('speaking');
    else if (assistant.run.busy) setOrb('thinking');
    else setOrb(ollama.engine.status === 'online' ? 'idle' : 'offline');
    if (!v.listening) { $('#partial').hidden = true; $('#main').classList.remove('voice-live'); }
  });
  bus.on('voice.wake', () => { setOrb('listening'); app.viz.kick(1); call('app.chime', { kind: 'wake' }).catch(() => {}); });
  bus.on('voice.final', (text) => {
    $('#partial').hidden = true;
    if (assistant.run.confirmResolvers.size) { bus.emit('voice.final.confirm', text); return; }
    assistant.send(text, { viaVoice: true });
  });
  bus.on('voice.nothing', () => { setOrb('idle', 'Didn’t catch that'); setTimeout(() => syncWake(), 600); });
  bus.on('voice.error', (m) => { toast(m, { bad: true, ms: 6000 }); });
  bus.on('voice.ended', () => setTimeout(syncWake, 400));
  // Conversation flow: after a spoken reply, listen again if asked to.
  bus.on('voice.done', () => {
    if (assistant.run.confirmResolvers.size && assistant.run.lastViaVoice) { voice.listen('command').catch(() => {}); return; }
    if (settings.voice.continuous && assistant.run.lastViaVoice && !assistant.run.busy) { voice.listen('command').catch(() => {}); return; }
    syncWake();
  });
  bus.on('turn.done', ({ viaVoice }) => { if (!voice.voice.speaking) { if (viaVoice && settings.voice.continuous && settings.voice.speak === 'never') voice.listen('command').catch(() => {}); else syncWake(); } });
  bus.on('wake.changed', syncWake);
  bus.on('voice.stopped', () => setTimeout(syncWake, 300));
  // Barge-in: listen for "stop" while speaking.
  bus.on('voice.state', (v) => {
    if (v.speaking && settings.voice.bargeIn && can('wake') && !voice.voice.listening) voice.listen('bargein').catch(() => {});
  });
}

/** Keep wake-word listening running when it is enabled and JARVIS is idle. */
async function syncWake() {
  if (!settings.voice.wake || !can('wake') || !settings.setupDone) { if (voice.voice.mode === 'wake') voice.stopListening(); return; }
  if (voice.voice.listening || voice.voice.speaking || assistant.run.busy) return;
  try { await voice.listen('wake'); setOrb(ollama.engine.status === 'online' ? 'idle' : 'offline'); }
  catch (e) { console.warn('wake', e); }
}

// ------------------------------------------------------------------ shortcuts
function wireShortcuts() {
  const sendHotkeys = () => call('app.setHotkeys', { summon: settings.shortcuts.globalSummon }).catch(() => {});
  sendHotkeys();
  bus.on('shortcuts', sendHotkeys);
  document.addEventListener('keydown', (e) => {
    if (document.querySelector('.kbd.rec')) return;
    const sc = settings.shortcuts;
    if (matches(e, sc.stop) && e.key === 'Escape') {
      if (!$('#wizardLayer').hidden) return;
      if (document.querySelector('.sheet-layer:not(#sheetLayer)')) return;
      if (sheetOpen()) { closeSheet(); e.preventDefault(); return; }
      if (assistant.run.busy || voice.voice.speaking || (voice.voice.listening && voice.voice.mode === 'command')) { stopAll(); e.preventDefault(); }
      return;
    }
    if (!$('#wizardLayer').hidden) return;
    const act = { newChat, search: () => { if (!settings.home.sidebar) { set('home.sidebar', true); applyLayout(); } $('#searchInput').focus(); }, settings: () => (sheetOpen() ? closeSheet() : openSheet('general')), focusInput: () => $('#input').focus(), listen: () => app.toggleListen(), toggleSidebar: () => $('#sidebarToggle').click(), toggleHud: () => $('#hudToggle').click() };
    for (const [k, fn] of Object.entries(act)) {
      if (matches(e, sc[k])) { e.preventDefault(); fn(); return; }
    }
  });
  // Native menu / global hotkey commands
  import('./host.js').then(({ events }) => {
    events.on('command', (d) => {
      const c = d.name;
      if (c === 'summon') { closeSheet(); app.toggleListen?.(); }
      else if (c === 'newChat') newChat();
      else if (c === 'settings') openSheet(d.tab || 'general');
      else if (c === 'listen') app.toggleListen?.();
      else if (c === 'stop') stopAll();
      else if (c === 'toggleSidebar') $('#sidebarToggle').click();
      else if (c === 'toggleHud') $('#hudToggle').click();
      else if (c === 'send' && d.text) assistant.send(d.text, { viaVoice: !!d.voice });
    });
  });
}

boot().catch((e) => {
  console.error(e);
  document.body.append(h('div', { class: 'toast bad', style: { position: 'fixed', left: '20px', bottom: '20px', zIndex: 999 }, text: 'JARVIS failed to start: ' + e.message }));
});

export { app };
