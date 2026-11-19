// iPhone companion: your phone and your computer, linked with the same secret phrase
// (Settings → Link devices), talk over an encrypted peer-to-peer connection:
// - the phone sees the computer's status live (processor, memory, battery, disk, AI);
// - the phone can send commands to the computer, but only after you approve that phone ON
//   THE COMPUTER (a matching 6-digit code is shown on both, and your PIN is asked if set);
// - anything a command needs your OK for is asked on the phone; sensitive actions also
//   need the computer profile's PIN, typed on the phone and checked on the computer;
// - the computer can send notifications you chose to the phone.
// These are internet messages, not phone calls or SMS, and they only arrive while JARVIS is
// open on the phone. To make a locked iPhone ring, the Mac app uses an iCloud Reminders alert.
import { read, write, settings } from './store.js';
import { bus, uid } from './util.js';
import { call, isNative } from './host.js';
import * as ls from './livesync.js';
import * as auth from './auth.js';

export const state = { me: null, devices: new Map(), status: null, statusAt: 0, results: [], pending: new Map(), waiting: new Map() };
const emit = () => bus.emit('companion', state);
const isComputer = () => isNative || !/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) && !(navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));

/** This device's random id (kept on the device, shared by its profiles). */
export async function me() {
  if (state.me) return state.me;
  let d = await read('device-id', null);
  if (!d?.id) { d = { id: uid('dv').replace(/[^A-Za-z0-9]/g, '').slice(-12), created: Date.now() }; await write('device-id', d); }
  const name = /iPhone/.test(navigator.userAgent) ? 'iPhone' : /iPad/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)) ? 'iPad' : /Android/.test(navigator.userAgent) ? 'Android phone' : isNative ? 'Mac' : 'computer';
  state.me = { id: d.id, name, kind: isComputer() ? 'computer' : 'phone' };
  return state.me;
}

/** The code both screens show when a phone asks to control the computer. */
export async function pairCode(phoneId, computerId, phrase = settings.syncPhrase) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`jarvis-pair|${phrase}|${phoneId}|${computerId}`)));
  const n = ((h[0] << 16) | (h[1] << 8) | h[2]) % 1000000;
  const s = String(n).padStart(6, '0');
  return `${s.slice(0, 3)} ${s.slice(3)}`;
}

// ---------------------------------------------------------------- approved phones (on the computer)
const approved = async () => (await read('remote-devices', [])) || [];
export async function approvedList() { return approved(); }
export async function isApproved(id) { return (await approved()).some((d) => d.id === id); }
export async function approve(dev) { const l = (await approved()).filter((d) => d.id !== dev.id); l.push({ id: dev.id, name: dev.name, at: Date.now() }); await write('remote-devices', l); auth.log('phone allowed to send commands', { detail: dev.name }).catch(() => {}); emit(); }
export async function revoke(id) { const l = await approved(); const d = l.find((x) => x.id === id); await write('remote-devices', l.filter((x) => x.id !== id)); if (d) auth.log('phone removed', { detail: d.name }).catch(() => {}); emit(); }

// ---------------------------------------------------------------- status (computer → phones)
export async function readStatus() {
  const ollama = await import('./ollama.js');
  const a = await import('./assistant.js');
  let s = {};
  try { s = (await call('system.status', {})) || {}; } catch {}
  return {
    cpu: s.cpu ?? null, memUsed: s.memUsed ?? null, memTotal: s.memTotal ?? null, battery: s.battery ?? null, diskFree: s.diskFree ?? null, uptime: s.uptime ?? null, chip: s.chip || '',
    ai: ollama.engine.status, model: settings.ai.model || '', busy: !!a.run.busy, at: Date.now(),
  };
}
let statusTimer = 0;
function startStatus() {
  clearInterval(statusTimer);
  const tick = async () => { if (!ls.connected()) return; const m = await me(); if (m.kind !== 'computer') return; ls.sendMessage({ kind: 'status', from: m.id, name: m.name, status: await readStatus() }).catch(() => {}); };
  statusTimer = setInterval(tick, 15000);
  setTimeout(tick, 1500);
}

// ---------------------------------------------------------------- phone side
/** Send a command to the computer. → Promise of { ok, text } (or { needsApproval, code }). */
export async function sendCommand(text, { timeoutMs = 120000 } = {}) {
  const m = await me();
  const computer = [...state.devices.values()].find((d) => d.kind === 'computer');
  if (!ls.connected() || !computer) throw new Error('Your computer isn’t connected. Open JARVIS on it (the Mac app can stay open), signed in with the same secret phrase.');
  const id = uid('rc');
  const p = new Promise((resolve, reject) => {
    state.waiting.set(id, { resolve, text, at: Date.now() });
    setTimeout(() => { if (state.waiting.has(id)) { state.waiting.delete(id); reject(new Error('Your computer didn’t answer in time.')); emit(); } }, timeoutMs);
  });
  await ls.sendMessage({ kind: 'cmd', id, to: computer.id, from: m.id, name: m.name, text: String(text).slice(0, 2000) });
  emit();
  return p;
}
/** Answer an approval the computer asked for. */
export async function answerConfirm(id, answer, pin = '') {
  const c = state.pending.get(id);
  if (!c) return;
  state.pending.delete(id); emit();
  const m = await me();
  await ls.sendMessage({ kind: 'confirm.answer', id, to: c.from, from: m.id, answer, pin });
}

// ---------------------------------------------------------------- computer side
const queue = [];
let running = false;
async function runCommand(msg) {
  const m = await me();
  if (!(await isApproved(msg.from))) {
    const code = await pairCode(msg.from, m.id);
    ls.sendMessage({ kind: 'cmd.result', id: msg.id, to: msg.from, needsApproval: true, code, text: `This ${m.name} needs to allow your ${msg.name || 'phone'} first. Check that the code ${code} is on both screens, then tap Allow on the ${m.name}.` });
    bus.emit('companion.pair', { id: msg.from, name: msg.name || 'phone', code });
    return;
  }
  queue.push(msg);
  if (running) return;
  running = true;
  while (queue.length) {
    const job = queue.shift();
    const a = await import('./assistant.js');
    const sessions = await import('./sessions.js');
    const s = sessions.state.current || sessions.create();
    const before = s.messages.length;
    a.run.remoteConfirm = (payload) => askPhone(job, payload);
    let ok = true;
    try { await a.send(job.text); } catch (e) { ok = false; }
    a.run.remoteConfirm = null;
    const out = s.messages.slice(before).filter((x) => (x.role === 'assistant' && (x.content || x.error)) || (x.role === 'tool' && x.display));
    const text = out.map((x) => (x.role === 'tool' ? `• ${x.display}` : x.error || x.content)).join('\n\n').slice(0, 4000) || 'Done.';
    auth.log('phone command', { detail: `${job.name || 'phone'}: ${job.text.slice(0, 60)}` }).catch(() => {});
    ls.sendMessage({ kind: 'cmd.result', id: job.id, to: job.from, ok: ok && !out.some((x) => x.error), text });
  }
  running = false;
}
/** Ask the phone to approve an action; sensitive ones also need this profile's PIN. */
async function askPhone(job, { tool, args, info }) {
  const L = await import('./lock.js');
  await L.config();
  const sensitive = !!(info?.danger || tool?.alwaysAsk || tool?.category === 'commands' || tool?.category === 'files');
  const needPin = sensitive && L.isOn();
  const id = uid('cf');
  const answer = new Promise((resolve) => {
    approvals.set(id, resolve);
    setTimeout(() => { if (approvals.has(id)) { approvals.delete(id); resolve({ answer: 'deny' }); } }, 120000);
  });
  ls.sendMessage({ kind: 'confirm', id, to: job.from, from: (await me()).id, title: info?.title || `Run ${tool?.name}`, detail: info?.detail || '', needPin, danger: !!info?.danger });
  const r = await answer;
  if (r.answer !== 'allow' && r.answer !== 'always') return 'deny';
  if (needPin) {
    const okPin = await L.checkPin(r.pin || '');
    auth.log('extra check from phone', { ok: okPin === true, detail: info?.title || tool?.name }).catch(() => {});
    if (okPin !== true) return 'deny';
  }
  return 'allow';   // "always" from a phone is treated as just this once
}
const approvals = new Map();

// ---------------------------------------------------------------- notifications (computer → phone)
/** Send a notification to linked phones (only what you chose in settings). → how many got it. */
export async function notifyPhones(title, body = '', kind = 'info') {
  const f = settings.companion?.forward || {};
  if (kind !== 'test' && f[kind] === false) return 0;
  if (!ls.connected()) return 0;
  const m = await me();
  return ls.sendMessage({ kind: 'notify', from: m.id, name: m.name, title: String(title).slice(0, 160), body: String(body).slice(0, 400), type: kind });
}
async function showOnPhone(n) {
  bus.emit('toast', { text: `${n.name || 'Computer'}: ${n.title}${n.body ? ' ' + n.body : ''}`, icon: 'bell', ms: 8000 });
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg?.showNotification) await reg.showNotification(n.title, { body: n.body, tag: 'jarvis-' + Date.now() });
      else new Notification(n.title, { body: n.body });
    }
  } catch {}
}

// ---------------------------------------------------------------- start
export async function start() {
  const m = await me();
  const hello = (c) => ls.sendMessage({ kind: 'hello', from: m.id, name: m.name, dkind: m.kind }, c).catch(() => {});
  ls.onOpen(hello);
  ls.onMessage(async (msg) => {
    if (!msg || msg.from === m.id) return;
    if (msg.to && msg.to !== m.id) return;   // for another device (the hub passed it on)
    switch (msg.kind) {
      case 'hello':
        state.devices.set(msg.from, { id: msg.from, name: msg.name, kind: msg.dkind, seen: Date.now() });
        if (!msg.reply) ls.sendMessage({ kind: 'hello', reply: true, from: m.id, name: m.name, dkind: m.kind }).catch(() => {});
        if (m.kind === 'computer') ls.sendMessage({ kind: 'status', from: m.id, name: m.name, status: await readStatus() }).catch(() => {});
        emit(); break;
      case 'status':
        state.devices.set(msg.from, { ...(state.devices.get(msg.from) || {}), id: msg.from, name: msg.name, kind: 'computer', seen: Date.now() });
        state.status = msg.status; state.statusAt = Date.now(); emit(); break;
      case 'status.get': if (m.kind === 'computer') ls.sendMessage({ kind: 'status', from: m.id, name: m.name, status: await readStatus() }).catch(() => {}); break;
      case 'cmd': if (m.kind === 'computer' && settings.companion?.commands !== false) runCommand(msg); else if (m.kind === 'computer') ls.sendMessage({ kind: 'cmd.result', id: msg.id, to: msg.from, ok: false, text: 'Commands from phones are turned off on this computer (Settings → iPhone & Mac).' }); break;
      case 'cmd.result': {
        const w = state.waiting.get(msg.id);
        state.results.unshift({ id: msg.id, text: w?.text || '', reply: msg.text, ok: !!msg.ok, needsApproval: !!msg.needsApproval, at: Date.now() });
        state.results = state.results.slice(0, 20);
        if (w && !msg.needsApproval) { state.waiting.delete(msg.id); w.resolve({ ok: !!msg.ok, text: msg.text }); }
        if (w && msg.needsApproval) { state.waiting.delete(msg.id); w.resolve({ ok: false, needsApproval: true, code: msg.code, text: msg.text }); }
        emit(); break;
      }
      case 'confirm': state.pending.set(msg.id, msg); emit(); bus.emit('companion.confirm', msg); break;
      case 'confirm.answer': { const r = approvals.get(msg.id); if (r) { approvals.delete(msg.id); r({ answer: msg.answer, pin: msg.pin }); } break; }
      case 'notify': if (m.kind === 'phone' || settings.companion?.showAll) showOnPhone(msg); break;
      default: break;
    }
  });
  ls.sendMessage({ kind: 'hello', from: m.id, name: m.name, dkind: m.kind }).catch(() => {});
  startStatus();
}
export const askStatus = async () => ls.sendMessage({ kind: 'status.get', from: (await me()).id }).catch(() => 0);
export { isComputer };
