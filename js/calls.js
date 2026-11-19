// JARVIS Call: free voice and video calls over the internet, no account, no phone number.
// One person starts a call and shares the link; the other opens it in any modern browser
// (iPhone, Android, Mac, Windows, Linux). Sound and video go directly between the two
// devices with WebRTC, which is always encrypted; the free PeerJS service only helps them
// find each other (and relays the stream when a network blocks direct connections).
// These are internet calls, not phone calls: they can't ring a phone number.
// For calls to people's phones and apps, JARVIS opens FaceTime, WhatsApp, Telegram, Skype,
// Teams, Messenger, Signal or Discord ("call Sam on WhatsApp").
import { bus } from './util.js';
import { library } from './livesync.js';

export const SITE = 'https://szeszeming2-lgtm.github.io/jarvis/';
export const state = { status: 'idle', role: '', room: '', video: true, muted: false, camOff: false, started: 0, error: '', local: null, remote: null, getMedia: null };
const emit = () => bus.emit('call', { ...state });
let peer = null, call = null, joinTimer = 0;

const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
export const newRoom = () => `jarvis-call-${hex(10)}`;
export const linkFor = (room) => `${SITE}#join=${room}`;
/** A call link (or just its code) → the room, or ''. */
export function roomFrom(text) { const m = String(text || '').match(/(jarvis-call-[0-9a-f]{20})/); return m ? m[1] : ''; }

async function media(video) {
  if (state.getMedia) return state.getMedia(video);   // tests
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser can’t use the microphone. Try Safari, Chrome, Edge or Firefox.');
  try { return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: video ? { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } : false }); }
  catch (e) { throw new Error(/NotAllowed|Permission|denied/i.test(e.name + e.message) ? `Allow the microphone${video ? ' and camera' : ''} for JARVIS, then try again.` : /NotFound/i.test(e.name) ? `No microphone${video ? ' or camera' : ''} was found.` : e.message); }
}

function wire(c) {
  call = c;
  c.on('stream', (s) => { clearTimeout(joinTimer); state.remote = s; if (state.status !== 'connected') { state.status = 'connected'; state.started = Date.now(); } emit(); });
  c.on('close', () => end('The other person left.'));
  c.on('error', (e) => end(`The call stopped: ${e?.type || e?.message || 'connection lost'}.`));
}

/** Start a call and wait for the other person. → the link to share. */
export async function host({ video = true } = {}) {
  if (state.status !== 'idle' && state.status !== 'ended') throw new Error('A call is already going.');
  Object.assign(state, { status: 'starting', role: 'host', video, muted: false, camOff: !video, error: '', remote: null, started: 0, room: newRoom() });
  emit();
  let Peer;
  try { state.local = await media(video); Peer = await library(); } catch (e) { state.local?.getTracks().forEach((t) => t.stop()); Object.assign(state, { status: 'idle', local: null }); emit(); throw e; }
  peer = new Peer(state.room, { debug: 0 });
  peer.on('open', () => { state.status = 'waiting'; emit(); });
  peer.on('call', (c) => {
    if (call) { c.close(); return; }   // one other person at a time
    c.answer(state.local);
    wire(c);
  });
  peer.on('disconnected', () => { try { peer?.reconnect(); } catch {} });
  peer.on('error', (e) => { if (state.status !== 'connected') end(e.type === 'network' || e.type === 'server-error' ? 'Can’t reach the call service. Are you online?' : String(e.message || e.type)); });
  return linkFor(state.room);
}

/** Join a call from its link. */
export async function join(link, { video = true, name = '' } = {}) {
  const room = roomFrom(link);
  if (!room) throw new Error('That isn’t a JARVIS call link.');
  if (state.status !== 'idle' && state.status !== 'ended') throw new Error('A call is already going.');
  Object.assign(state, { status: 'joining', role: 'guest', room, video, muted: false, camOff: !video, error: '', remote: null, started: 0 });
  emit();
  let Peer;
  try { state.local = await media(video); Peer = await library(); } catch (e) { state.local?.getTracks().forEach((t) => t.stop()); Object.assign(state, { status: 'idle', local: null }); emit(); throw e; }
  peer = new Peer({ debug: 0 });
  peer.on('open', () => {
    wire(peer.call(room, state.local, { metadata: { name: String(name).slice(0, 40) } }));
    joinTimer = setTimeout(() => { if (state.status !== 'connected') end('Nobody answered: the person who started the call must keep it open. Ask them to start it again.'); }, 30000);
  });
  peer.on('error', (e) => end(e.type === 'peer-unavailable' ? 'That call has ended or hasn’t started yet.' : e.type === 'network' || e.type === 'server-error' ? 'Can’t reach the call service. Are you online?' : String(e.message || e.type)));
}

export function toggleMute() { state.muted = !state.muted; state.local?.getAudioTracks().forEach((t) => { t.enabled = !state.muted; }); emit(); return state.muted; }
export function toggleCamera() { state.camOff = !state.camOff; state.local?.getVideoTracks().forEach((t) => { t.enabled = !state.camOff; }); emit(); return state.camOff; }

function end(reason = '') {
  clearTimeout(joinTimer);
  if (state.status === 'idle' || state.status === 'ended') return;
  try { call?.close(); } catch {}
  try { peer?.destroy(); } catch {}
  call = null; peer = null;
  state.local?.getTracks().forEach((t) => t.stop());
  Object.assign(state, { status: 'ended', error: reason, local: null, remote: null });
  emit();
}
export const hangUp = () => end('');
export const seconds = () => (state.started ? Math.round((Date.now() - state.started) / 1000) : 0);
