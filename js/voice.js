// Voice: offline speech in (native recognizer) and out (system voices).
// Streams replies sentence by sentence so JARVIS starts talking quickly.
import { call, events, can } from './host.js';
import { settings } from './store.js';
import { bus, uid } from './util.js';
import { toSpeech } from './markdown.js';

export const voice = {
  listening: false, mode: null, speaking: false, partial: '', currentText: '', error: '',
  wakeArmed: false, // wake listening should be running when idle
  capture: null,    // a screen (like Circle to Ask) can take the next thing you say instead of the chat
};

const pendingUtterances = new Set();
const setState = () => bus.emit('voice.state', { ...voice });

// ------------------------------------------------------------------ speaking
export function speak(text, { lang = '' } = {}) {
  const clean = toSpeech(text);
  if (!clean || !can('voiceOut')) return;
  const id = uid('u');
  pendingUtterances.add(id);
  voice.speaking = true;
  voice.currentText += ' ' + clean.toLowerCase();
  setState();
  call('speech.speak', { id, text: clean, voice: lang ? '' : settings.voice.voice, lang, rate: Number(settings.voice.rate), pitch: Number(settings.voice.pitch), volume: Number(settings.voice.volume) })
    .catch((e) => { pendingUtterances.delete(id); finishIfDone(); bus.emit('toast', { text: 'Voice error: ' + e.message, bad: true }); });
}

export function stopSpeaking() {
  stream.raw = ''; stream.pos = 0; stream.active = false;
  const was = voice.speaking || pendingUtterances.size;
  pendingUtterances.clear();
  voice.speaking = false;
  voice.currentText = '';
  call('speech.stop').catch(() => {});
  setState();
  if (was) bus.emit('voice.stopped');
}

function finishIfDone() {
  if (pendingUtterances.size || stream.active) return;
  if (voice.speaking) {
    voice.speaking = false;
    voice.currentText = '';
    setState();
    bus.emit('voice.done');
  }
}

events.on('speech.start', () => { voice.speaking = true; setState(); });
events.on('speech.word', (d) => bus.emit('voice.word', d));
events.on('speech.end', (d) => { pendingUtterances.delete(d.id); finishIfDone(); });

// Sentence streaming
const stream = { raw: '', pos: 0, active: false };
export function beginStream() { stream.raw = ''; stream.pos = 0; stream.active = true; }
export function feed(delta) { if (!stream.active) return; stream.raw += delta; drain(false); }
export function endStream() { if (!stream.active) return; drain(true); stream.active = false; finishIfDone(); }

function drain(final) {
  for (let guard = 0; guard < 50; guard++) {
    const rest = stream.raw.slice(stream.pos);
    if (!rest) return;
    const fence = rest.indexOf('```');
    if (fence === 0) {
      const close = rest.indexOf('```', 3);
      if (close < 0) { if (final) { speak('I have put the code on screen.'); stream.pos = stream.raw.length; } return; }
      speak('I have put the code on screen.');
      stream.pos += close + 3;
      continue;
    }
    if (fence > 0) { speak(rest.slice(0, fence)); stream.pos += fence; continue; }
    if (final) { speak(rest); stream.pos = stream.raw.length; return; }
    const cut = boundary(rest);
    if (cut > 0) { speak(rest.slice(0, cut)); stream.pos += cut; continue; }
    return;
  }
}

function boundary(s) {
  const re = /[.!?…:](?=["')\]]?\s)["')\]]?\s+|\n\s*\n/g;
  let m, last = -1;
  while ((m = re.exec(s))) {
    const end = m.index + m[0].length;
    // avoid splitting "e.g. " or "3. " list numbers or decimals
    const before = s.slice(Math.max(0, m.index - 4), m.index + 1);
    if (/\b(e\.g|i\.e|mr|mrs|ms|dr|vs|etc)\.$/i.test(before) || /^\s*\d+\.$/.test(s.slice(s.lastIndexOf('\n', m.index) + 1, m.index + 1))) continue;
    if (end >= 18) last = end;
    if (last > 0 && last > 60) break;
  }
  return last;
}

// ------------------------------------------------------------------ listening
export async function ensurePermission() {
  let p = await call('listen.permission');
  if (p.mic === 'granted' && (p.speech === 'granted' || p.speech === 'n/a')) return p;
  p = await call('listen.request');
  if (p.mic !== 'granted' && p.mic !== 'prompt') throw new Error('Microphone access is off. Turn it on in System Settings → Privacy & Security → Microphone.');
  if (p.speech === 'denied') throw new Error('Speech recognition is off. Turn it on in System Settings → Privacy & Security → Speech Recognition.');
  return p;
}

export async function listen(mode = 'command', { locale = '' } = {}) {
  if (!can('voiceIn')) throw new Error('Voice input needs the JARVIS desktop app (or a browser with speech recognition).');
  if (mode === 'command' && voice.speaking) stopSpeaking();
  await ensurePermission();
  voice.partial = '';
  voice.error = '';
  const ww = [settings.voice.wakeWord || settings.assistantName].map((w) => w.toLowerCase().trim()).filter(Boolean);
  if (mode === 'bargein') ww.push('stop', 'wait', 'hold on', 'cancel');
  await call('listen.start', {
    mode: mode === 'bargein' ? 'wake' : mode, locale: locale || settings.voice.locale, offlineOnly: !!settings.voice.offlineOnly,
    wakeWords: ww, silenceMs: Number(settings.voice.silenceMs) || 1400,
    gate: { low: 0.012, normal: 0.003, high: 0 }[settings.voice.sensitivity || 'normal'] ?? 0.003, // quiet sounds below this are ignored
  });
  voice.listening = true;
  voice.mode = mode;
  setState();
}

export function stopListening() {
  voice.listening = false;
  voice.mode = null;
  voice.partial = '';
  call('listen.stop').catch(() => {});
  setState();
}

events.on('listen.started', (d) => { voice.listening = true; voice.mode = voice.mode || d.mode; setState(); });
events.on('listen.level', (d) => bus.emit('voice.level', d.level));
events.on('listen.partial', (d) => { voice.partial = d.text; bus.emit('voice.partial', d.text); });
events.on('listen.wake', (d) => {
  // Ignore our own voice being heard through the speakers.
  if (voice.speaking && d.word && voice.currentText.includes(d.word) && !['stop', 'wait', 'cancel', 'hold on'].includes(d.word)) return;
  if (voice.speaking) stopSpeaking();
  voice.mode = 'command';
  setState();
  bus.emit('voice.wake', d);
});
events.on('listen.final', (d) => {
  voice.partial = '';
  voice.listening = false;
  voice.mode = null;
  setState();
  const text = (d.text || '').trim();
  if (text) bus.emit('voice.final', text);
  else bus.emit('voice.nothing');
});
events.on('listen.error', (d) => { voice.error = d.message; bus.emit('voice.error', d.message); });
events.on('listen.end', () => {
  const wasWake = voice.mode === 'wake' || voice.mode === 'bargein';
  voice.listening = false;
  voice.mode = null;
  setState();
  bus.emit('voice.ended', { wasWake });
});

export async function voices() {
  try { return await call('speech.voices'); } catch { return []; }
}

/** Pick a default voice: a natural British English voice if the user has one, JARVIS-style. */
export function defaultVoice(list) {
  const pref = [
    (v) => /en-GB/i.test(v.lang) && /premium/i.test(v.quality) && /daniel|jamie|arthur|oliver|malcolm/i.test(v.name),
    (v) => /en-GB/i.test(v.lang) && /enhanced|premium/i.test(v.quality),
    (v) => /en-GB/i.test(v.lang) && /daniel|arthur|oliver/i.test(v.name),
    (v) => /en-GB/i.test(v.lang) && !/novelty|bad|bells|bubbles|boing|whisper|zarvox|trinoids|jester|organ|cellos|wobble|superstar|albert|bahh|good news/i.test(v.name),
    (v) => /^en/i.test(v.lang) && /premium|enhanced/i.test(v.quality),
    (v) => /^en/i.test(v.lang),
  ];
  for (const f of pref) { const v = list.find(f); if (v) return v.id; }
  return list[0]?.id || '';
}
