// Link devices tab: send everything to your other device (AirDrop or any app),
// or receive from it. Locked with a code; no account, no server.
import { h, iconNode } from '../util.js';
import { registerTab } from './sheets.js';
import { section, toast, callout, dialog, toggle, row, rows } from './common.js';
import { call, can, isNative } from '../host.js';
import * as sync from '../sync.js';
import * as live from '../livesync.js';
import { settings } from '../store.js';
import { bus, timeAgo } from '../util.js';

/** "Sign in" with a secret phrase: live sync between your devices, no account. */
function signInSection() {
  const box = h('div');
  const statusText = () => {
    const s = live.state;
    return { off: 'Not signed in.', connecting: 'Connecting…', waiting: `Signed in. Waiting for your other devices${s.role === 'hub' ? ' (this one is the hub)' : ''}.`, connected: `Connected to ${s.peers} other device${s.peers === 1 ? '' : 's'}.${s.lastSync ? ` Last synced ${timeAgo(s.lastSync)}.` : ''}`, error: `Not connected: ${s.error}` }[s.status] || s.status;
  };
  const draw = () => {
    if (!live.signedIn()) {
      const input = h('input', { class: 'field', placeholder: 'e.g. maple orbit falcon river ember quartz lotus sky', 'aria-label': 'Secret phrase', style: { width: '100%', fontFamily: 'var(--mono)' }, autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false' });
      box.replaceChildren(
        h('p', { class: 'muted', style: { margin: '0 0 10px', fontSize: '13px', lineHeight: 1.5 }, text: 'Use the same secret phrase on your iPhone, iPad and Mac and they stay the same automatically: lists, people, reminders, projects, plugins, memories, links, chats and settings. No account, no email, no password reset: the phrase is the key, so keep it somewhere safe.' }),
        h('div', { class: 'flex', style: { marginBottom: '10px' } },
          h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { input.value = live.newPhrase(); input.focus(); toast('Write this phrase down, then type it on your other devices.', { ms: 6000 }); } }, iconNode('sparkles'), 'Make a new phrase')),
        input,
        h('div', { class: 'flex', style: { marginTop: '10px' } },
          h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => { try { await live.signIn(input.value); toast('Signed in. This device will stay in step with your others.'); } catch (e) { toast(e.message, { bad: true, ms: 6000 }); } } }, iconNode('lock'), 'Sign in with this phrase')));
      return;
    }
    const phrase = h('span', { class: 'mono', text: '•••• •••• •••• ••••' });
    box.replaceChildren(
      h('div', { class: 'callout' }, iconNode(live.state.status === 'connected' ? 'check' : live.state.status === 'error' ? 'alert' : 'refresh'), h('div', {}, h('b', { text: statusText() }), live.state.added ? h('div', { class: 'muted', text: live.state.added }) : null)),
      h('div', { class: 'flex', style: { marginTop: '10px', flexWrap: 'wrap' } },
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { live.syncNow(); live.connect(); toast('Syncing…'); } }, iconNode('refresh'), 'Sync now'),
        h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: (e) => { phrase.textContent = phrase.textContent.startsWith('•') ? settings.syncPhrase : '•••• •••• •••• ••••'; } }, 'Show phrase'), phrase,
        h('button', { class: 'btn btn-sm btn-ghost danger', type: 'button', onclick: async () => { if (await dialog({ title: 'Sign out of sync?', text: 'This device keeps everything it has, but stops syncing. Your other devices are not changed.', okLabel: 'Sign out', danger: true })) live.signOut(); } }, 'Sign out')));
  };
  const off = bus.on('livesync', draw);
  bus.on('settings', (d) => { if (d?.path === 'syncPhrase') draw(); });
  draw();
  box.dispose = off;
  return section('Sign in (secret phrase)', 'Live sync between your devices. Devices talk directly and encrypted; a free service (PeerJS) only helps them find each other and never sees your data. Syncs while JARVIS is open on both (the Mac app stays open in the background).', box);
}

const iPadOS = () => navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent);
const phone = () => /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || iPadOS();
const deviceName = () => (isNative ? 'Mac' : /iPhone/.test(navigator.userAgent) ? 'iPhone' : /iPad/.test(navigator.userAgent) || iPadOS() ? 'iPad' : /Android/.test(navigator.userAgent) ? 'Android phone' : 'browser');

registerTab('sync', (body) => {
  let chats = true;
  const out = h('div');
  const send = async () => {
    const code = sync.newCode();
    out.replaceChildren(h('div', { class: 'muted', text: 'Packing everything up…' }));
    try {
      const data = await sync.collect({ chats: chats ? 40 : 0 });
      const text = await sync.seal(data, code, deviceName());
      const name = `JARVIS-link-${new Date().toISOString().slice(0, 10)}.json`;
      const codeBox = h('div', { class: 'link-code', 'aria-label': 'Your code', text: code });
      const shareIt = async () => {
        try {
          const file = new File([text], name, { type: 'application/json' });
          if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: 'JARVIS link file' }); return; }
        } catch (e) { if (e.name === 'AbortError') return; }
        if (can('shareFile')) { await call('app.shareFile', { name, content: text }); return; }
        await call('file.save', { name, content: text, type: 'application/json' });
        toast('Saved. Now AirDrop or send that file to your other device.');
      };
      out.replaceChildren(
        h('ol', { class: 'link-steps' },
          h('li', {}, h('b', { text: 'Send the file' }), ' to your other device. ', phone() ? 'Pick AirDrop (or Messages, Mail, Files).' : isNative ? 'Pick AirDrop (or Messages, Mail).' : 'It downloads; then AirDrop it or send it to yourself.', h('div', { style: { marginTop: '8px' } }, h('button', { class: 'btn btn-primary', type: 'button', onclick: shareIt }, iconNode('share'), phone() || isNative ? 'Send with AirDrop…' : 'Save the file'))),
          h('li', {}, h('b', { text: 'On the other device' }), ' open JARVIS → Settings → Link devices → Receive, choose the file, and type this code:', codeBox),
          h('li', {}, 'Done. Both devices then have the same lists, people, reminders, plugins, memory, workouts', chats ? ', chats' : '', ' and settings.')),
        callout('Keep the code to yourself: the file can’t be opened without it. Do this again any time to bring them back in step.', { icon: 'lock' }));
    } catch (e) { out.replaceChildren(); toast(e.message, { bad: true }); }
  };
  const receive = async () => {
    try {
      const f = await call('file.open', { accept: '.json,application/json,text/plain', types: ['json'] });
      if (!f?.text) return;
      const code = await dialog({ title: 'Type the code', text: 'It’s shown on the device that sent the file (like K7QM-3XRP-W9TD).', input: '', okLabel: 'Unlock' });
      if (!code) return;
      const got = await sync.open(f.text, code);
      const d = got.data;
      const sum = `${d.people?.length || 0} people · ${Object.values(d.lists || {}).reduce((n, l) => n + l.length, 0)} list items · ${d.reminders?.filter((r) => !r.done).length || 0} reminders · ${d.skills?.length || 0} plugins · ${d.memory?.length || 0} memories · ${d.sessions?.length || 0} chats`;
      if (!(await dialog({ title: `Merge from your ${got.from}?`, text: `${sum}.\n\nThis adds what’s new and updates your settings. Nothing on this device is deleted.`, okLabel: 'Merge' }))) return;
      const counts = await sync.apply(d);
      toast(sync.describe(counts), { ms: 6000 });
      setTimeout(() => location.reload(), 1600);
    } catch (e) { toast(e.message, { bad: true, ms: 6000 }); }
  };
  body.append(
    signInSection(),
    callout('<b>Same JARVIS on every device, no account needed.</b> Your phone and computer each keep their own copy. Linking sends a locked file from one to the other (AirDrop works great), so nothing ever goes to a server.', { icon: 'refresh' }),
    section('Or send a one-time copy', 'From this device to your other one, by AirDrop or any app.', rows(
      row('Include chats', 'Your 40 most recent conversations (pictures stay here).', toggle(chats, (v) => (chats = v), 'Include chats')),
      row('', '', h('button', { class: 'btn btn-primary', type: 'button', onclick: send }, iconNode('upload'), 'Send everything'))), out),
    section('Receive from another device', 'Got a JARVIS link file? Open it here.', h('button', { class: 'btn', type: 'button', onclick: receive }, iconNode('download'), 'Receive (choose the file)')),
    section('What’s shared', '', h('ul', { class: 'muted', style: { margin: 0, paddingLeft: '18px', lineHeight: 1.7, fontSize: '13px' } },
      h('li', { text: 'Lists, people, reminders, plugins, memories, workouts, projects, habits, goals, budget, recent chats.' }),
      h('li', { text: 'Your name, number, home, city, briefing and reply settings, theme.' }),
      h('li', { text: 'Not shared: the AI model, voice and permissions (each device keeps its own).' }))),
  );
});
