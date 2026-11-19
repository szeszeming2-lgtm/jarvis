// "iPhone & Mac" tab: link status, the computer's live status, commands from the phone,
// approvals, allowed phones, notifications, and Siri & Shortcuts set-up.
import { h, iconNode, bus, fmtBytes, timeAgo } from '../util.js';
import { registerTab, refresh, openSheet } from './sheets.js';
import { section, rows, row, toggle, toast, callout } from './common.js';
import { settings, set } from '../store.js';
import * as C from '../companion.js';

const pct = (a, b) => (a != null && b ? Math.round((a / b) * 100) + '%' : '–');
const SITE = 'https://szeszeming2-lgtm.github.io/jarvis/';

/** The approval card a phone shows when the computer needs an OK. */
export function confirmCard(c, onDone = () => {}) {
  const pin = c.needPin ? h('input', { class: 'field', type: 'password', inputmode: 'numeric', placeholder: 'Computer PIN', 'aria-label': 'PIN of the computer profile', style: { width: '140px' } }) : null;
  const answer = (a) => { C.answerConfirm(c.id, a, pin?.value || ''); onDone(); };
  return h('div', { class: 'card glass notice-card' + (c.danger ? ' danger' : '') },
    h('span', { class: 'ic' }, iconNode(c.danger ? 'alert' : 'shield')),
    h('div', { style: { flex: 1, minWidth: 0 } },
      h('b', { text: c.title }), c.detail ? h('div', { class: 'muted small', style: { whiteSpace: 'pre-wrap' }, text: c.detail }) : null,
      c.needPin ? h('div', { class: 'muted small', text: 'Sensitive: your computer’s PIN is needed. It is checked on the computer, over the encrypted link.' }) : null,
      h('div', { class: 'flex', style: { marginTop: '8px' } }, pin, h('button', { class: 'btn btn-sm btn-primary', type: 'button', text: 'Allow', onclick: () => answer('allow') }), h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Don’t allow', onclick: () => answer('deny') }))));
}

registerTab('companion', (body) => {
  const offs = [];
  const draw = async () => {
    const m = await C.me();
    const ls = await import('../livesync.js');
    const linked = ls.signedIn();
    const online = [...C.state.devices.values()].filter((d) => Date.now() - (d.seen || 0) < 120000);
    const parts = [
      callout('<b>Your phone and computer, together.</b> Linked with your secret phrase, they talk over an encrypted connection: the phone can check the computer and send it commands; the computer can send you notifications. These are internet messages, not phone calls or texts, and they arrive while JARVIS is open on the phone. A locked iPhone can only be made to ring by the Mac app’s iCloud Reminders alert.', { icon: 'phone' }),
    ];
    if (!linked) {
      parts.push(section('Not linked yet', 'Sign in with the same secret phrase on your phone and your computer first.', rows(row('Link devices', 'Takes a minute: make a phrase on the computer, type it on the phone.', h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => openSheet('sync') }, iconNode('refresh'), 'Link devices')))));
    } else {
      parts.push(section('Connected devices', '', rows(...(online.length ? online.map((d) => row(d.name, `${d.kind === 'computer' ? 'Computer' : 'Phone or tablet'} · seen ${timeAgo(d.seen)}`, h('span', { class: 'pill ok', text: 'Online' }))) : [row('Nobody else online', 'Open JARVIS on your other device (signed in with the same phrase).', h('span', { class: 'pill warn', text: 'Waiting' }))]))));
    }
    if (m.kind === 'phone') parts.push(phoneSide(online));
    else parts.push(await computerSide());
    parts.push(siriSection(m));
    body.replaceChildren(...parts);
  };

  function phoneSide(online) {
    const comp = online.find((d) => d.kind === 'computer');
    const s = C.state.status;
    const statusBox = s && comp ? rows(
      row('Processor', s.chip || '', h('b', { text: s.cpu != null ? `${Math.round(s.cpu)}%` : '–' })),
      row('Memory', s.memTotal ? `${fmtBytes(s.memUsed)} of ${fmtBytes(s.memTotal)}` : '', h('b', { text: pct(s.memUsed, s.memTotal) })),
      s.battery ? row('Battery', s.battery.charging ? 'Charging' : 'On battery', h('b', { text: `${s.battery.level ?? '–'}%` })) : null,
      s.diskFree != null ? row('Free disk space', '', h('b', { text: fmtBytes(s.diskFree) })) : null,
      row('JARVIS', `AI: ${s.ai}${s.model ? ' · ' + s.model : ''}`, h('b', { text: s.busy ? 'Working…' : 'Ready' })),
      row('Updated', '', h('span', { class: 'muted', text: timeAgo(s.at) }))) : h('p', { class: 'muted', text: comp ? 'Waiting for the first status…' : 'Your computer isn’t connected right now.' });
    const input = h('input', { class: 'field', placeholder: `Ask your ${comp?.name || 'computer'}…`, 'aria-label': 'Command for the computer', style: { flex: 1, minWidth: 0 } });
    const go = async (text) => {
      const t = (text ?? input.value).trim(); if (!t) return;
      input.value = '';
      toast('Sent to your computer…', { icon: 'refresh' });
      try { const r = await C.sendCommand(t); if (r.needsApproval) toast(`Allow this phone on your computer. Check the code ${r.code} is the same on both.`, { ms: 12000 }); } catch (e) { toast(e.message, { bad: true, ms: 7000 }); }
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    const quick = ['What’s using my storage?', 'What apps are running?', 'Check my Mac', 'Set volume to 30', 'Open Spotify', 'Evening summary'];
    const pending = [...C.state.pending.values()];
    return h('div', {},
      ...pending.map((c) => confirmCard(c, draw)),
      section(`Your ${comp?.name || 'computer'}`, 'Live status, every 15 seconds while both are open.', statusBox, h('button', { class: 'btn btn-sm btn-ghost', type: 'button', style: { marginTop: '6px' }, onclick: () => C.askStatus() }, iconNode('refresh'), 'Update now')),
      section('Send a command', 'Runs on the computer as if you typed it there. Anything that needs your OK asks here first.', h('div', { class: 'flex' }, input, h('button', { class: 'btn btn-primary', type: 'button', onclick: () => go() }, iconNode('send'), 'Send')),
        h('div', { class: 'flex', style: { flexWrap: 'wrap', gap: '6px', marginTop: '8px' } }, ...quick.map((q) => h('button', { class: 'suggestion next-chip', type: 'button', text: q, onclick: () => go(q) }))),
        h('div', { class: 'list', style: { marginTop: '10px' } }, ...C.state.results.slice(0, 8).map((r) => h('div', { class: 'item', style: { alignItems: 'flex-start' } }, h('span', { class: 'item-ic' }, iconNode(r.ok ? 'check' : r.needsApproval ? 'lock' : 'alert')), h('div', { class: 'item-main' }, h('div', { class: 'item-title', text: r.text || 'Command' }), h('div', { class: 'item-sub', style: { whiteSpace: 'pre-wrap' }, text: r.reply })))))),
      pushPhone(),
      section('Notifications while JARVIS is open', 'Shown inside JARVIS (and as a notification if allowed) while it is open here.', rows(
        row('Allow notifications', 'Notification' in window ? `Now: ${Notification.permission}` : 'This browser can’t show notifications.', 'Notification' in window && Notification.permission !== 'granted' ? h('button', { class: 'btn btn-sm', type: 'button', text: 'Allow', onclick: async () => { const r = await Notification.requestPermission(); toast(r === 'granted' ? 'Notifications allowed.' : 'Not allowed. On iPhone this works from the Home Screen app.'); draw(); } }) : h('span', { class: 'pill', text: 'Notification' in window ? Notification.permission : 'n/a' })))));
  }

  /** Phone: real push notifications from the Mac app, even when JARVIS is closed here. */
  function pushPhone() {
    const box = h('div', { class: 'rows' });
    (async () => {
      const P = await import('../push.js');
      const sup = P.receiveSupport();
      const on = sup.ok && (await P.subscribed());
      box.replaceChildren(row('Push notifications', sup.ok ? (on ? 'On: notifications from your Mac arrive even when JARVIS is closed here (the Mac app must be running).' : 'Get notifications from your Mac even when JARVIS is closed here. Free: sent by the Mac app through Apple’s (or your browser’s) push service, encrypted for this phone.') : sup.why,
        !sup.ok ? h('span', { class: 'pill warn', text: 'Not here' })
          : on ? h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Turn off', onclick: async () => { await P.unsubscribe(); toast('Push notifications are off on this phone.'); draw(); } })
            : h('button', { class: 'btn btn-sm btn-primary', type: 'button', text: 'Turn on', onclick: async (e) => { e.currentTarget.disabled = true; try { await C.enablePush(); toast('Push notifications are on. Try “Send a test push” on your Mac.'); } catch (err) { toast(err.message, { bad: true, ms: 9000 }); } draw(); } })));
    })();
    return section('Push notifications', 'Real notifications, even when JARVIS is closed on this phone.', box);
  }

  async function pushComputer() {
    const P = await import('../push.js');
    if (!P.canSend()) return section('Push notifications', 'Only the JARVIS Mac app can send push notifications to your phone (browsers can’t). Use the Mac app on your computer for this.', rows());
    const subs = await P.subscriptions();
    return section('Push notifications', 'Phones that get real notifications from this Mac, even when JARVIS is closed on them. Turn it on from the phone (iPhone: from the Home Screen app).', rows(
      ...(subs.length ? subs.map((s) => row(s.name, `Since ${new Date(s.at).toLocaleDateString()} · ${new URL(s.endpoint).hostname}`, h('button', { class: 'btn btn-sm btn-ghost danger', type: 'button', text: 'Remove', onclick: async () => { await P.removeSubscription(s.endpoint); toast('Removed.'); draw(); } }))) : [row('No phones yet', 'On your phone: Settings → iPhone & Mac → Push notifications → Turn on.', h('span', { class: 'pill', text: '0' }))]),
      subs.length ? row('Test', '', h('button', { class: 'btn btn-sm', type: 'button', text: 'Send a test push', onclick: async () => { const r = await P.sendAll({ title: 'Test from JARVIS', body: 'Push notifications work.', tag: 'jarvis-test' }); toast(r.sent ? `Sent to ${r.sent} phone${r.sent === 1 ? '' : 's'}.` : `Not delivered${r.failed ? ` (${r.failed} failed)` : ''}.`, { bad: !r.sent }); } })) : null));
  }

  async function computerSide() {
    const list = await C.approvedList();
    const f = settings.companion?.forward || {};
    const fw = (key, label, desc) => row(label, desc, toggle(f[key] !== false, (v) => set(`companion.forward.${key}`, v), label));
    return h('div', {},
      section('Commands from your phone', 'A phone must be allowed here once. Commands follow your Permissions; anything that needs an OK is asked on the phone, and sensitive actions need this profile’s PIN.', rows(
        row('Allow commands from phones', '', toggle(settings.companion?.commands !== false, (v) => set('companion.commands', v), 'Allow commands')),
        ...(list.length ? list.map((d) => row(d.name, `Allowed ${new Date(d.at).toLocaleDateString()}`, h('button', { class: 'btn btn-sm btn-ghost danger', type: 'button', text: 'Remove', onclick: async () => { await C.revoke(d.id); toast(`${d.name} can no longer send commands.`); draw(); } }))) : [row('No phones allowed yet', 'Send a command from your phone; this computer then asks you to allow it.', h('span', { class: 'pill', text: '0' }))]))),
      await pushComputer(),
      section('Notifications to your phone', 'Sent over the encrypted link to JARVIS on your phone (not texts or calls). For a locked iPhone, the Mac app can also ring it with an iCloud Reminders alert (texts and calls to yourself).', rows(
        fw('reminder', 'Reminders', 'When a reminder is due.'), fw('mission', 'Missions', 'When a mission needs your OK or is done.'), fw('briefing', 'Briefings', 'Morning briefing and evening summary.'), fw('security', 'Security', 'New apps, sign-in problems.'),
        row('Test', '', h('button', { class: 'btn btn-sm', type: 'button', text: 'Send a test', onclick: async () => { const n = await C.notifyPhones('Test from JARVIS', 'If you see this, notifications work.', 'test'); toast(n ? `Sent to ${n} device${n === 1 ? '' : 's'}.` : 'No phone is connected right now.', { bad: !n }); } })))));
  }

  function siriSection(m) {
    const ask = `${SITE}#ask=`, mac = `${SITE}#mac=`;
    const copy = (t) => navigator.clipboard?.writeText(t).then(() => toast('Copied')).catch(() => toast(t, { ms: 10000 }));
    const add = (file) => { const url = `${SITE}assets/shortcuts/${file}`; import('../host.js').then(({ call, isNative }) => (isNative ? call('tool.open_url', { url }) : (location.href = url))).catch(() => window.open(url, '_blank')); };
    return section('Siri & Shortcuts', 'Siri can start JARVIS with a shortcut. iPhones don’t let any app keep listening while locked, so Siri handles “Hey Siri” and may ask you to unlock the phone before JARVIS opens. Shortcuts open JARVIS in Safari: if you use the Home Screen app, link Safari too (same secret phrase).', rows(
      row('“Hey Siri, Ask JARVIS”', 'Tap Add, then “Add Shortcut” in the Shortcuts app. Siri asks what you need and opens JARVIS with it.', h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => add('Ask-JARVIS.shortcut') }, iconNode('plus'), 'Add shortcut')),
      row('“Hey Siri, Ask my Mac”', 'Sends what you say to your linked Mac (the Mac app must be open, and this phone allowed there).', h('button', { class: 'btn btn-sm', type: 'button', onclick: () => add('Ask-my-Mac.shortcut') }, iconNode('plus'), 'Add shortcut')),
      row('Make your own', 'In Shortcuts: “Dictate Text” → “URL” (paste the link, then add the text) → “Open URLs”.', h('div', { class: 'flex' }, h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => copy(ask) }, iconNode('copy'), 'JARVIS link'), h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => copy(mac) }, iconNode('copy'), 'Mac link'))),
      m.kind === 'computer' ? row('On the Mac', 'Siri on the Mac can run the same shortcuts. The Mac app also listens for its own wake word while it’s open.', h('span', { class: 'pill', text: 'Info' })) : null));
  }

  offs.push(bus.on('companion', () => draw()), bus.on('livesync', () => draw()));
  draw();
  return () => offs.forEach((f) => f());
});
