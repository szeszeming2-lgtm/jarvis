// Calls page and the call screen (JARVIS Call), plus incoming calls from your linked devices.
import { h, iconNode, bus } from '../util.js';
import { registerTab, closeSheet } from './sheets.js';
import { section, rows, row, toast, callout, dialog } from './common.js';
import * as K from '../calls.js';

let layer = null;
const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** Open the call screen and start or join a call. */
export async function openCall({ mode = 'host', link = '', video = true, inviteDevices = false } = {}) {
  if (layer) return;
  closeSheet();
  const remoteV = h('video', { class: 'kc-remote', autoplay: true, playsinline: true });
  const localV = h('video', { class: 'kc-local', autoplay: true, playsinline: true, muted: true });
  const status = h('div', { class: 'kc-status', role: 'status', 'aria-live': 'polite', text: mode === 'host' ? 'Starting…' : 'Joining…' });
  const invite = h('div', { class: 'kc-invite', hidden: true });
  const btn = (icon, label, fn, cls = '') => h('button', { class: 'kc-btn ' + cls, type: 'button', 'aria-label': label, title: label, onclick: fn }, iconNode(icon));
  const mute = btn('mic', 'Mute', () => K.toggleMute());
  const cam = btn('video', 'Camera off', () => K.toggleCamera());
  const bar = h('div', { class: 'kc-bar' }, mute, video ? cam : null, btn('phone-off', 'Hang up', () => K.hangUp(), 'kc-end'));
  layer = h('div', { class: 'kc-layer', role: 'dialog', 'aria-label': 'JARVIS Call' }, h('div', { class: 'kc-stage' }, remoteV, h('div', { class: 'kc-avatar', 'aria-hidden': 'true' }), localV), h('div', { class: 'kc-top' }, h('b', { text: 'JARVIS Call' }), status), invite, bar);
  document.body.append(layer);
  let tick = 0;
  const draw = () => {
    const s = K.state;
    if (s.local && localV.srcObject !== s.local) localV.srcObject = s.local;
    if (s.remote && remoteV.srcObject !== s.remote) { remoteV.srcObject = s.remote; remoteV.play().catch(() => {}); }
    localV.hidden = !s.video || s.camOff;
    layer.classList.toggle('connected', s.status === 'connected');
    layer.classList.toggle('audio-only', !s.remote?.getVideoTracks().length);
    mute.replaceChildren(iconNode(s.muted ? 'mic-off' : 'mic')); mute.title = mute.ariaLabel = s.muted ? 'Unmute' : 'Mute'; mute.classList.toggle('off', s.muted);
    cam.replaceChildren(iconNode(s.camOff ? 'video-off' : 'video')); cam.title = cam.ariaLabel = s.camOff ? 'Camera on' : 'Camera off'; cam.classList.toggle('off', s.camOff);
    status.textContent = { starting: 'Starting…', waiting: 'Waiting for the other person to open the link…', joining: 'Connecting…', connected: `Connected · ${fmt(K.seconds())} · encrypted, peer to peer`, ended: s.error || 'Call ended.' }[s.status] || '';
    invite.hidden = s.status !== 'waiting';
    if (s.status === 'ended') { clearInterval(tick); setTimeout(close, s.error ? 4000 : 1200); }
  };
  const off = bus.on('call', draw);
  tick = setInterval(draw, 1000);
  function close() { off(); clearInterval(tick); layer?.remove(); layer = null; if (K.state.status !== 'ended' && K.state.status !== 'idle') K.hangUp(); }
  try {
    if (mode === 'host') {
      const link = await K.host({ video });
      const share = async () => { try { if (navigator.share) await navigator.share({ title: 'JARVIS Call', text: 'Join my call:', url: link }); else { await navigator.clipboard.writeText(link); toast('Link copied. Send it to the person you want to call.'); } } catch {} };
      invite.replaceChildren(h('div', { class: 'muted small', text: 'Send this link to the person you want to call. They open it in any browser; no app or account needed.' }),
        h('div', { class: 'kc-link mono selectable', text: link }),
        h('div', { class: 'flex', style: { justifyContent: 'center', flexWrap: 'wrap' } },
          h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: share }, iconNode('share'), navigator.share ? 'Share link' : 'Copy link'),
          h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => { const n = await inviteLinked(link, video); toast(n ? 'Your other device is ringing (JARVIS must be open on it).' : 'None of your linked devices is online right now.', { bad: !n }); } }, iconNode('phone'), 'Ring my other device')));
      if (inviteDevices) { const n = await inviteLinked(link, video); toast(n ? 'Ringing your other device…' : 'Your other device isn’t online (JARVIS must be open on it). Share the link instead.', { bad: !n, ms: 6000 }); }
    } else await K.join(link, { video });
  } catch (e) { toast(e.message, { bad: true, ms: 7000 }); close(); }
  draw();
}

/** Ring JARVIS on your linked devices (through the encrypted companion link). */
async function inviteLinked(link, video) {
  const C = await import('../companion.js');
  const ls = await import('../livesync.js');
  if (!ls.connected()) return 0;
  const m = await C.me();
  return ls.sendMessage({ kind: 'call.invite', from: m.id, name: m.name, link, video });
}

/** Someone (your other device) is calling: ring until answered. */
export function incoming({ name, link, video }) {
  if (layer || document.querySelector('.kc-ring')) return;
  let t = 0;
  const ring = h('div', { class: 'kc-ring glass', role: 'alertdialog', 'aria-label': `${name} is calling` },
    h('div', { class: 'kc-ring-ic' }, iconNode(video ? 'video' : 'phone')), h('div', {}, h('b', { text: `Your ${name} is calling` }), h('div', { class: 'muted small', text: `JARVIS ${video ? 'video' : 'voice'} call` })),
    h('div', { class: 'flex' }, h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Decline', onclick: () => stop() }), h('button', { class: 'btn btn-sm btn-primary', type: 'button', text: 'Answer', onclick: () => { stop(); openCall({ mode: 'join', link, video }); } })));
  const stop = () => { clearInterval(t); ring.remove(); };
  document.body.append(ring);
  import('../host.js').then(({ call }) => { call('app.chime', { kind: 'wake' }).catch(() => {}); t = setInterval(() => call('app.chime', { kind: 'wake' }).catch(() => {}), 3000); });
  setTimeout(stop, 45000);
}

registerTab('calls', (body) => {
  const linkIn = h('input', { class: 'field', placeholder: 'Paste a call link', 'aria-label': 'Call link', style: { flex: 1, minWidth: 0 } });
  body.append(
    callout('<b>Free internet calls.</b> JARVIS Call works between any two browsers (iPhone, Android, Mac, Windows, Linux) with a link: no account, no app, no phone number. Sound and video go directly between the two devices and are always encrypted. These are internet calls: they can’t ring a phone number.', { icon: 'phone' }),
    section('JARVIS Call', '', rows(
      row('Start a video call', 'You get a link to send to the other person.', h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => openCall({ mode: 'host', video: true }) }, iconNode('video'), 'Video call')),
      row('Start a voice call', 'Sound only: lighter on weak connections.', h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openCall({ mode: 'host', video: false }) }, iconNode('phone'), 'Voice call')),
      row('Call my other device', 'Rings JARVIS on your linked iPhone or computer (it must be open there).', h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openCall({ mode: 'host', video: true, inviteDevices: true }) }, iconNode('phone'), 'Ring it')),
      row('Join a call', '', h('div', { class: 'flex', style: { width: '100%' } }, linkIn, h('button', { class: 'btn btn-sm', type: 'button', text: 'Join', onclick: () => { if (!K.roomFrom(linkIn.value)) { toast('That isn’t a JARVIS call link.', { bad: true }); return; } openCall({ mode: 'join', link: linkIn.value, video: true }); } }))))),
    section('Calls through other apps', 'Say “call Sam on WhatsApp”, “video call Mum on FaceTime” or “call Alex on Discord”. JARVIS opens the app; the call itself is made by that app (free if it is free there).', rows(
      row('Works with', 'FaceTime, WhatsApp, Telegram, Skype, Microsoft Teams, Messenger, Signal and Discord. Save someone’s app details in Lists & People → Apps.', h('span', { class: 'pill', text: '8 apps' })),
      row('Phone numbers', 'A normal phone call to a number uses your phone (or FaceTime Audio). JARVIS can’t make phone calls by itself: that needs a paid phone line.', h('span', { class: 'pill', text: 'Info' })))));
});
