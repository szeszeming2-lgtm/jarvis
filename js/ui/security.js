// Privacy & security screens: the extra check before sensitive actions, the app lock
// (PIN), two-step sign-in, spoken passphrase, voice recognition and sign-in history.
import { h, iconNode, timeAgo } from '../util.js';
import { section, rows, row, toggle, select, toast, dialog, callout } from './common.js';
import { settings, set, profileId } from '../store.js';
import * as auth from '../auth.js';

// ---------------------------------------------------------------- small modal
function modal(title, intro, build) {
  return new Promise((resolve) => {
    const layer = h('div', { class: 'sheet-layer', style: { zIndex: 85 } });
    const msg = h('p', { class: 'muted small', style: { minHeight: '18px', margin: '8px 0 0' } });
    const close = (v) => { layer.remove(); resolve(v); };
    const body = h('div');
    const box = h('div', { class: 'wizard glass', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, style: { width: 'min(420px, 100%)', textAlign: 'left', padding: '22px 24px' } },
      h('h3', { style: { margin: '0 0 8px', fontWeight: 600, fontSize: '17px' }, text: title }),
      intro ? h('p', { class: 'muted', style: { margin: '0 0 8px', fontSize: '13.5px', lineHeight: 1.5 }, text: intro }) : null, body, msg);
    layer.append(box);
    layer.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(null); } });
    document.body.append(layer);
    build({ body, msg, close, box });
  });
}
const secretField = (placeholder, label, numeric = true) => h('input', { class: 'field', type: 'password', inputmode: numeric ? 'numeric' : 'text', autocomplete: 'off', placeholder, 'aria-label': label, style: { width: '100%', marginTop: '8px', letterSpacing: '.2em', textAlign: 'center', fontSize: '18px' } });

/**
 * Extra check before something sensitive: your PIN (+ the two-step code when on, + your voice
 * when you asked for it). Without a PIN nothing can be checked, so it asks you to confirm and
 * suggests setting one. → true when allowed.
 */
export async function verify(reason = 'Confirm it’s you') {
  const L = await import('../lock.js');
  await L.config();
  if (!L.isOn()) {
    const ok = !!(await dialog({ title: reason, text: 'This profile has no PIN, so JARVIS can’t check who is using it. Set a PIN in Settings → Privacy to protect sensitive actions.', okLabel: 'Continue' }));
    auth.log('extra check', { ok, detail: `${reason} (no PIN set)` }).catch(() => {});
    return ok;
  }
  const needVoice = !!settings.security?.voiceStepUp && (await (await import('../voiceid.js')).enrolled(profileId));
  return !!(await modal(reason, `Enter your PIN${L.mfaOn() ? ' and the 6-digit code from your authenticator app' : ''}${needVoice ? ', then say a few words so JARVIS can check your voice' : ''}.`, ({ body, msg, close }) => {
    const pin = secretField('PIN', 'PIN');
    const code = L.mfaOn() ? Object.assign(secretField('6-digit code', 'Two-step code'), { type: 'text', autocomplete: 'one-time-code' }) : null;
    const go = async () => {
      msg.textContent = 'Checking…';
      const p = await L.checkPin(pin.value);
      if (p === 'wait') { msg.textContent = `Too many wrong tries. Wait ${L.waitLeft()} seconds.`; return; }
      if (!p) { msg.textContent = 'That PIN isn’t right.'; pin.value = ''; pin.focus(); auth.log('extra check', { ok: false, detail: reason }).catch(() => {}); return; }
      if (code) { const c = await L.checkCode(code.value); if (c !== true) { msg.textContent = c === 'wait' ? `Too many wrong tries. Wait ${L.waitLeft()} seconds.` : 'That code isn’t right.'; code.value = ''; code.focus(); auth.log('extra check', { ok: false, detail: reason + ' (code)' }).catch(() => {}); return; } }
      if (needVoice) {
        msg.textContent = 'Recording 3 seconds… say anything.';
        try { const V = await import('../voiceid.js'); const r = await V.listenAndCheck(profileId, { seconds: 3 }); if (!r.match) { msg.textContent = 'Your voice didn’t match. Try again.'; auth.log('extra check', { ok: false, detail: reason + ' (voice)' }).catch(() => {}); return; } }
        catch (e) { msg.textContent = e.message; return; }
      }
      auth.log('extra check', { ok: true, detail: reason }).catch(() => {});
      close(true);
    };
    for (const f of [pin, code]) f?.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    body.append(pin, code || '', h('div', { class: 'flex', style: { justifyContent: 'flex-end', marginTop: '14px' } },
      h('button', { class: 'btn btn-ghost', type: 'button', text: 'Cancel', onclick: () => close(null) }),
      h('button', { class: 'btn btn-primary', type: 'button', text: 'Confirm', onclick: go })));
    setTimeout(() => pin.focus(), 30);
  }));
}

/** Ask for a new PIN twice. → the PIN or null. */
function newPin(title = 'Choose a PIN') {
  return modal(title, '6 to 12 digits. If you forget it, this profile’s encrypted data can’t be recovered (keep a backup).', ({ body, msg, close }) => {
    const a = secretField('New PIN', 'New PIN'), b = secretField('Type it again', 'Type the PIN again');
    const go = () => {
      if (!/^\d{6,12}$/.test(a.value)) { msg.textContent = 'Use 6 to 12 digits.'; return; }
      if (a.value !== b.value) { msg.textContent = 'The two PINs don’t match.'; b.value = ''; b.focus(); return; }
      close(a.value);
    };
    b.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    body.append(a, b, h('div', { class: 'flex', style: { justifyContent: 'flex-end', marginTop: '14px' } },
      h('button', { class: 'btn btn-ghost', type: 'button', text: 'Cancel', onclick: () => close(null) }),
      h('button', { class: 'btn btn-primary', type: 'button', text: 'Next', onclick: go })));
    setTimeout(() => a.focus(), 30);
  });
}

// ---------------------------------------------------------------- the settings section
export function securitySection() {
  const box = h('div');
  const draw = async () => {
    const L = await import('../lock.js');
    const V = await import('../voiceid.js');
    const P = await import('../profiles.js');
    const c = await L.config();
    const me = P.active();
    const voiceOn = await V.enrolled(profileId);
    const parts = [];
    // App lock
    if (!c.on) {
      parts.push(rows(row('App lock', `Off. Protect ${me?.name ? `${me.name}’s profile` : 'this profile'} with a PIN: its chats, memories, lists, people, projects, notes and recordings are then encrypted on this device, so nobody else using it can read them.`,
        h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: async () => {
          const pin = await newPin(); if (!pin) return;
          try { toast('Encrypting your data…', { ms: 2500 }); await L.enable(pin, { minutes: 10 }); toast('App lock is on. Your data is encrypted.'); draw(); } catch (e) { toast(e.message, { bad: true }); }
        } }, iconNode('lock'), 'Turn on'))));
    } else {
      parts.push(rows(
        row('App lock', 'On. Data encrypted on this device.', h('div', { class: 'flex' },
          h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => { (await import('./sheets.js')).closeSheet(); L.lockNow(); } }, iconNode('lock'), 'Lock now'),
          h('button', { class: 'btn btn-sm', type: 'button', text: 'Change PIN', onclick: async () => { if (!(await verify('Change your PIN'))) return; const pin = await newPin('New PIN'); if (!pin) return; try { await L.changePin(pin); toast('PIN changed.'); } catch (e) { toast(e.message, { bad: true }); } } }),
          h('button', { class: 'btn btn-sm btn-ghost danger', type: 'button', text: 'Turn off', onclick: async () => { if (!(await verify('Turn off the app lock'))) return; if (!(await dialog({ title: 'Turn off the app lock?', text: 'This profile’s data is saved without encryption again, and two-step sign-in is turned off.', okLabel: 'Turn off', danger: true }))) return; try { await L.mfaOff(); await L.disable(); toast('App lock is off.'); draw(); } catch (e) { toast(e.message, { bad: true }); } } }))),
        row('Lock after', 'Minutes without using JARVIS (0 = only when you lock it).', select(String(c.minutes ?? 10), [['0', 'Never'], ['2', '2 minutes'], ['5', '5 minutes'], ['10', '10 minutes'], ['30', '30 minutes'], ['60', '1 hour']], async (v) => { await L.setMinutes(Number(v)); toast('Saved.'); }, 'Lock after')),
        row('Two-step sign-in', L.mfaOn() ? `On: after the PIN, a 6-digit code from your authenticator app. ${L.recoveryLeft()} recovery code${L.recoveryLeft() === 1 ? '' : 's'} left.` : 'Off. Add a second step: a 6-digit code from an authenticator app (the iPhone’s Passwords app, Google Authenticator, Microsoft Authenticator…). Works offline.',
          L.mfaOn() ? h('button', { class: 'btn btn-sm btn-ghost danger', type: 'button', text: 'Turn off', onclick: async () => { if (!(await verify('Turn off two-step sign-in'))) return; await L.mfaOff(); toast('Two-step sign-in is off.'); draw(); } })
            : h('button', { class: 'btn btn-sm btn-primary', type: 'button', text: 'Set up', onclick: async () => { if (await setupMfa(L, me?.name)) draw(); } })),
        row('Spoken passphrase', c.voiceWrap ? 'Set. It only unlocks together with a voice match (voice recognition below), never on its own.' : 'Optional. A secret sentence you say. It only ever counts together with voice recognition, because anyone who hears a passphrase could repeat it.',
          c.voiceWrap ? h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Remove', onclick: async () => { await L.setPassphrase(''); toast('Passphrase removed.'); draw(); } })
            : h('button', { class: 'btn btn-sm', type: 'button', text: 'Add', onclick: async () => { const p = await dialog({ title: 'Spoken passphrase', text: 'At least 3 words, like “blue rocket over the lake”. Say it where nobody can hear.', input: '', okLabel: 'Save' }); if (!p) return; try { await L.setPassphrase(p); toast(voiceOn ? 'Passphrase saved.' : 'Passphrase saved. Set up voice recognition too: the passphrase only works with it.'); draw(); } catch (e) { toast(e.message, { bad: true }); } } })),
      ));
    }
    // Voice recognition (who is speaking), separate from the passphrase (what is said)
    parts.push(rows(
      row('Voice recognition', voiceOn ? 'Set up. JARVIS can tell your voice apart from other enrolled profiles. It is never enough on its own to unlock or approve something sensitive.' : `Optional. Record your voice 3 times (about 4 seconds each) so JARVIS can tell enrolled people apart. Needs a one-time ~${V.SIZE_MB} MB download. Your voiceprint stays on this device.`,
        h('div', { class: 'flex' },
          voiceOn ? h('button', { class: 'btn btn-sm', type: 'button', text: 'Test', onclick: () => testVoice(V) }) : null,
          voiceOn ? h('button', { class: 'btn btn-sm btn-ghost danger', type: 'button', text: 'Remove', onclick: async () => { if (!(await dialog({ title: 'Remove your voiceprint?', okLabel: 'Remove', danger: true }))) return; await V.forget(profileId); toast('Voiceprint removed.'); draw(); } })
            : h('button', { class: 'btn btn-sm btn-primary', type: 'button', text: 'Set up', onclick: async () => { if (await enrollVoice(V)) draw(); } }))),
      voiceOn && c.on ? row('Also check my voice', 'For sensitive actions, ask for your voice as well as your PIN.', toggle(!!settings.security?.voiceStepUp, (v) => set('security.voiceStepUp', v), 'Also check my voice')) : null,
    ));
    // History
    const hist = await auth.history(profileId);
    parts.push(h('details', { class: 'reasoning', style: { marginTop: '10px' } }, h('summary', { text: `Sign-in history (${hist.length})` }),
      h('div', { class: 'log-list' }, ...(hist.length ? hist.slice(0, 60).map((e) => h('div', { text: `${new Date(e.at).toLocaleString()} · ${e.ok ? '✓' : '✗'} ${e.event}${e.detail ? ' · ' + e.detail : ''}` })) : [h('div', { text: 'Nothing yet.' })]))));
    box.replaceChildren(...parts);
  };
  draw();
  return section('Security', 'Locks, two-step sign-in and voice recognition for this profile. Everything is checked on this device; nothing is sent anywhere.', box);
}

async function setupMfa(L, account) {
  const { secret, url } = L.mfaBegin(account);
  const codes = await modal('Two-step sign-in', 'Add JARVIS to your authenticator app, then type the 6-digit code it shows.', ({ body, msg, close }) => {
    const code = Object.assign(secretField('6-digit code', 'Code from the app'), { type: 'text', autocomplete: 'one-time-code' });
    const go = async () => { try { close(await L.mfaConfirm(secret, code.value)); } catch (e) { msg.textContent = e.message; code.value = ''; code.focus(); } };
    code.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    body.append(
      h('ol', { class: 'muted small', style: { paddingLeft: '18px', lineHeight: 1.6 } },
        h('li', {}, 'On an iPhone: tap “Add to Passwords” below. Elsewhere: open your authenticator app and choose “Enter a setup key”.'),
        h('li', {}, 'Setup key (also works by typing): ', h('b', { class: 'mono selectable', text: secret.match(/.{1,4}/g).join(' ') })),
        h('li', {}, 'Type the 6-digit code the app shows.')),
      h('div', { class: 'flex' },
        h('a', { class: 'btn btn-sm', href: url, text: 'Add to Passwords / app' }),
        h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Copy key', onclick: () => navigator.clipboard?.writeText(secret).then(() => toast('Copied')) })),
      code,
      h('div', { class: 'flex', style: { justifyContent: 'flex-end', marginTop: '14px' } }, h('button', { class: 'btn btn-ghost', type: 'button', text: 'Cancel', onclick: () => close(null) }), h('button', { class: 'btn btn-primary', type: 'button', text: 'Turn on', onclick: go })));
    setTimeout(() => code.focus(), 30);
  });
  if (!codes) return false;
  await modal('Save your recovery codes', 'If you lose your phone, each of these works once instead of a code. Write them down or keep them somewhere safe. They won’t be shown again.', ({ body, close }) => {
    body.append(h('div', { class: 'mono selectable', style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', margin: '10px 0', fontSize: '15px' } }, ...codes.map((c) => h('span', { text: c }))),
      h('div', { class: 'flex', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn btn-sm', type: 'button', text: 'Copy all', onclick: () => navigator.clipboard?.writeText(codes.join('\n')).then(() => toast('Copied')) }), h('button', { class: 'btn btn-primary', type: 'button', text: 'I saved them', onclick: () => close(true) })));
  });
  toast('Two-step sign-in is on.');
  return true;
}

async function enrollVoice(V) {
  if (!(await V.downloaded()) && !(await dialog({ title: 'Set up voice recognition?', text: `JARVIS downloads a free voice-recognition model once (about ${V.SIZE_MB} MB). It runs on this device: your recordings and voiceprint are never uploaded. You record yourself 3 times (about 4 seconds each). Remember: a voice can be imitated or recorded, so it never replaces your PIN.`, okLabel: 'Download and start' }))) return false;
  return !!(await modal('Voice recognition', 'Say a different sentence each time, in your normal voice, somewhere quiet.', ({ body, msg, close }) => {
    const bar = h('div', { class: 'progress', style: { margin: '10px 0' } }, h('i'));
    const vectors = [];
    const btn = h('button', { class: 'btn btn-primary', type: 'button', text: 'Record 1 of 3' });
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        if (!V.ready()) { msg.textContent = 'Getting voice recognition ready…'; await V.load((p) => { msg.textContent = p.text; bar.firstChild.style.width = Math.round(p.progress * 100) + '%'; }); }
        msg.textContent = 'Recording… keep talking for 4 seconds.';
        const { samples } = await V.recordSeconds(4, (l) => { bar.firstChild.style.width = Math.round(l * 100) + '%'; });
        msg.textContent = 'Learning your voice…';
        vectors.push(await V.embed(samples));
        if (vectors.length < 3) { btn.textContent = `Record ${vectors.length + 1} of 3`; msg.textContent = 'Got it. Say something else.'; btn.disabled = false; return; }
        await V.enroll(profileId, vectors);
        toast('Voice recognition is set up.');
        close(true);
      } catch (e) { msg.textContent = e.message; btn.disabled = false; if (/different/.test(e.message)) { vectors.length = 0; btn.textContent = 'Record 1 of 3'; } }
    };
    body.append(bar, h('div', { class: 'flex', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn btn-ghost', type: 'button', text: 'Cancel', onclick: () => close(null) }), btn));
  }));
}

async function testVoice(V) {
  toast('Recording 3 seconds… say anything.', { icon: 'mic' });
  try {
    const { samples } = await V.recordSeconds(3);
    const vec = await V.embed(samples);
    const me = await V.check(profileId, vec);
    const who = await V.identify(vec);
    const P = await import('../profiles.js');
    toast(me.match ? `That’s you (${Math.round(me.score * 100)}% match).` : who ? `That sounds like ${P.get(who.id)?.name || 'another profile'}, not you.` : `I don’t recognise that voice (${Math.round(me.score * 100)}% match with yours).`, { bad: !me.match, ms: 6000 });
  } catch (e) { toast(e.message, { bad: true }); }
}

export { modal };

/** Offered once when a new profile opens (it asked for a PIN). */
export async function offerPin() {
  const P = await import('../profiles.js');
  if (!(await dialog({ title: `Protect ${P.active()?.name || 'this profile'} with a PIN?`, text: 'With a PIN, this profile’s chats, memories, lists, notes and recordings are encrypted on this device, so other people using it can’t open them.', okLabel: 'Choose a PIN', cancelLabel: 'Not now' }))) return;
  const pin = await newPin(); if (!pin) return;
  try { const L = await import('../lock.js'); await L.enable(pin, { minutes: 10 }); toast('This profile is protected.'); } catch (e) { toast(e.message, { bad: true }); }
}
