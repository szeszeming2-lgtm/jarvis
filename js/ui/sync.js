// Link devices tab: send everything to your other device (AirDrop or any app),
// or receive from it. Locked with a code; no account, no server.
import { h, iconNode } from '../util.js';
import { registerTab } from './sheets.js';
import { section, toast, callout, dialog, toggle, row, rows } from './common.js';
import { call, can, isNative } from '../host.js';
import * as sync from '../sync.js';

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
    callout('<b>Same JARVIS on every device, no account needed.</b> Your phone and computer each keep their own copy. Linking sends a locked file from one to the other (AirDrop works great), so nothing ever goes to a server.', { icon: 'refresh' }),
    section('Send to another device', 'From this device to your other one.', rows(
      row('Include chats', 'Your 40 most recent conversations (pictures stay here).', toggle(chats, (v) => (chats = v), 'Include chats')),
      row('', '', h('button', { class: 'btn btn-primary', type: 'button', onclick: send }, iconNode('upload'), 'Send everything'))), out),
    section('Receive from another device', 'Got a JARVIS link file? Open it here.', h('button', { class: 'btn', type: 'button', onclick: receive }, iconNode('download'), 'Receive (choose the file)')),
    section('What’s shared', '', h('ul', { class: 'muted', style: { margin: 0, paddingLeft: '18px', lineHeight: 1.7, fontSize: '13px' } },
      h('li', { text: 'Lists, people, reminders, plugins, memories, workouts, recent chats.' }),
      h('li', { text: 'Your name, number, home, city, briefing and reply settings, theme.' }),
      h('li', { text: 'Not shared: the AI model, voice and permissions (each device keeps its own).' }))),
  );
});
