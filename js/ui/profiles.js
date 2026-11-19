// Profiles screens: the Profiles tab (create, edit, switch, delete, lock, import/export),
// the "Who's using JARVIS?" picker, and the profile button in the sidebar.
import { h, $, iconNode } from '../util.js';
import { registerTab, refresh, closeSheet } from './sheets.js';
import { section, rows, row, toggle, toast, dialog, callout, menu } from './common.js';
import { settings, set, profileId } from '../store.js';
import * as P from '../profiles.js';
import * as auth from '../auth.js';
import { verify, modal } from './security.js';

/** A round picture or initials. */
export function avatar(p, size = 36) {
  const a = h('span', { class: 'avatar-pic', style: { width: size + 'px', height: size + 'px', fontSize: Math.round(size * 0.4) + 'px', background: p?.picture ? 'none' : p?.color || 'var(--accent)' }, 'aria-hidden': 'true' });
  if (p?.picture) a.append(h('img', { src: p.picture, alt: '' }));
  else a.textContent = P.initials(p);
  return a;
}

/** A picture file → a small square JPEG (keeps the profile list light). */
export function pictureFrom(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\//.test(file?.type || '')) { reject(new Error('Pick a picture file.')); return; }
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = c.height = 160;
      const s = Math.min(img.width, img.height);
      c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 160, 160);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => reject(new Error('That picture couldn’t be opened.'));
    img.src = URL.createObjectURL(file);
  });
}

// ---------------------------------------------------------------- create / edit form
function profileForm({ title, p = null }) {
  return modal(title, p ? '' : 'A new profile has its own memory, chats, settings, voice, reminders, lists, projects, notes and permissions.', ({ body, msg, close }) => {
    let picture = p?.picture || '', color = p?.color || P.COLORS[P.all().length % P.COLORS.length];
    const name = h('input', { class: 'field', value: p?.name || '', placeholder: 'Name', 'aria-label': 'Profile name', maxlength: 30, style: { width: '100%', marginTop: '8px' } });
    const preview = h('span');
    const drawPreview = () => preview.replaceChildren(avatar({ name: name.value || '?', picture, color }, 56));
    name.addEventListener('input', drawPreview);
    const file = h('input', { type: 'file', accept: 'image/*', hidden: true });
    file.addEventListener('change', async () => { try { picture = await pictureFrom(file.files[0]); drawPreview(); } catch (e) { msg.textContent = e.message; } });
    const colors = h('div', { class: 'flex', style: { gap: '6px', flexWrap: 'wrap' } }, ...P.COLORS.map((c) => h('button', { class: 'color-dot', type: 'button', 'aria-label': `Colour ${c}`, style: { background: c }, onclick: () => { color = c; drawPreview(); } })));
    const askPin = h('input', { type: 'checkbox', checked: true });
    const go = async () => {
      try {
        if (p) { await P.update(p.id, { name: name.value, picture, color }); close(true); return; }
        const made = await P.create({ name: name.value, picture, color, askPin: askPin.checked });
        auth.log('profile created', { profile: 'device', detail: made.name }).catch(() => {});
        close(made);
      } catch (e) { msg.textContent = e.message; }
    };
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    drawPreview();
    body.append(
      h('div', { class: 'flex', style: { gap: '14px', alignItems: 'center' } }, preview, h('div', { class: 'flex', style: { gap: '6px', flexWrap: 'wrap' } },
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => file.click() }, iconNode('image'), 'Picture'),
        picture ? h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Remove picture', onclick: () => { picture = ''; drawPreview(); } }) : null)),
      file, name, h('div', { class: 'muted small', style: { margin: '10px 0 4px' }, text: 'Colour' }), colors,
      p ? '' : h('label', { class: 'flex small', style: { marginTop: '12px' } }, askPin, h('span', { text: 'Protect it with a PIN when it opens (recommended)' })),
      h('div', { class: 'flex', style: { justifyContent: 'flex-end', marginTop: '16px' } },
        h('button', { class: 'btn btn-ghost', type: 'button', text: 'Cancel', onclick: () => close(null) }),
        h('button', { class: 'btn btn-primary', type: 'button', text: p ? 'Save' : 'Create profile', onclick: go })));
    setTimeout(() => name.focus(), 30);
  });
}

// ---------------------------------------------------------------- the picker
/**
 * "Who's using JARVIS?". reason 'start': before anything is loaded (resolves with the id);
 * 'switch': while running (switching restarts JARVIS as that profile).
 */
export function pickProfile({ reason = 'switch' } = {}) {
  return new Promise((resolve) => {
    const layer = h('div', { class: 'picker-layer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Choose a profile' });
    const msg = h('p', { class: 'muted small', style: { minHeight: '18px' } });
    const pick = async (p) => {
      if (reason === 'start') { await P.choose(p.id); layer.remove(); resolve(p.id); return; }
      if (p.id === P.activeId()) { layer.remove(); resolve(p.id); return; }
      msg.textContent = `Opening ${p.name}…`;
      await P.switchTo(p.id);
    };
    const grid = h('div', { class: 'picker-grid' });
    (async () => {
      for (const p of P.all()) {
        const locked = await P.isLocked(p.id);
        grid.append(h('button', { class: 'picker-card' + (p.id === P.activeId() ? ' on' : ''), type: 'button', 'data-id': p.id, onclick: () => pick(p) },
          avatar(p, 76), h('b', { text: p.name }), locked ? h('small', {}, iconNode('lock'), ' PIN') : h('small', { text: ' ' })));
      }
    })();
    // Who's talking? (only when voices are enrolled)
    const voiceBtn = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', hidden: true }, iconNode('mic'), 'Find me by voice');
    import('../store.js').then(async (S) => {
      const vp = (await S.read('voiceprints', {})) || {};
      if (Object.keys(vp).some((k) => vp[k]?.v)) voiceBtn.hidden = false;
    });
    voiceBtn.onclick = async () => {
      try {
        const V = await import('../voiceid.js');
        msg.textContent = 'Recording 3 seconds… say hello.';
        const { samples } = await V.recordSeconds(3);
        msg.textContent = 'Listening…';
        const who = await V.identify(await V.embed(samples));
        if (!who) { msg.textContent = 'I don’t recognise that voice. Tap your profile instead.'; return; }
        const p = P.get(who.id);
        msg.textContent = `That sounds like ${p?.name}. Tap to continue (a PIN is still needed if the profile has one).`;
        grid.querySelectorAll('.picker-card').forEach((c) => c.classList.toggle('found', c.dataset.id === who.id));
      } catch (e) { msg.textContent = e.message; }
    };
    layer.append(h('div', { class: 'picker-box' },
      h('div', { class: 'picker-title', text: 'Who’s using JARVIS?' }), grid, msg,
      h('div', { class: 'flex', style: { justifyContent: 'center' } }, voiceBtn,
        reason === 'switch' ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'Cancel', onclick: () => { layer.remove(); resolve(null); } }) : null)));
    document.body.append(layer);
  });
}

// ---------------------------------------------------------------- sidebar button
export function initProfileButton() {
  const btn = $('#profileBtn');
  if (!btn) return;
  const draw = () => { const p = P.active(); btn.replaceChildren(avatar(p, 30)); btn.title = `${p?.name || 'Profile'} · switch or manage profiles`; btn.setAttribute('aria-label', btn.title); };
  draw();
  btn.addEventListener('click', async () => {
    const L = await import('../lock.js');
    await L.config();
    menu(btn, [
      { header: P.active()?.name || 'Profile' },
      ...P.all().filter((p) => p.id !== P.activeId()).map((p) => ({ label: `Switch to ${p.name}`, icon: 'user', action: () => P.switchTo(p.id) })),
      ...(L.isOn() ? [{ label: 'Lock', icon: 'lock', action: () => L.lockNow() }] : []),
      'sep',
      { label: 'Manage profiles', icon: 'gear', action: () => import('./sheets.js').then((m) => m.openSheet('profiles')) },
    ]);
  });
  return draw;
}

// ---------------------------------------------------------------- the Profiles tab
registerTab('profiles', (body) => {
  const list = h('div', { class: 'list' });
  const draw = async () => {
    const items = [];
    for (const p of P.all()) {
      const me = p.id === P.activeId();
      const locked = await P.isLocked(p.id);
      items.push(h('div', { class: 'item' + (me ? ' on' : '') },
        avatar(p, 40),
        h('div', { class: 'item-main' }, h('div', { class: 'item-title' }, h('span', { text: p.name }), me ? h('span', { class: 'pill ok', text: 'In use' }) : null),
          h('div', { class: 'item-sub', text: `${locked ? '🔒 PIN, encrypted' : 'No PIN (not protected from others on this device)'} · created ${new Date(p.created).toLocaleDateString()}` })),
        h('div', { class: 'item-actions' },
          me ? null : h('button', { class: 'btn btn-sm btn-primary', type: 'button', text: 'Switch', onclick: () => P.switchTo(p.id) }),
          me ? h('button', { class: 'btn btn-sm', type: 'button', text: 'Edit', onclick: async () => { if (await profileForm({ title: 'Edit profile', p })) { toast('Saved.'); draw(); initProfileButton(); } } }) : null,
          me ? null : h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Delete ${p.name}`, title: 'Delete', onclick: () => deleteProfile(p, locked).then((d) => d && draw()) }, iconNode('trash')))));
    }
    list.replaceChildren(...items);
  };
  draw();
  body.append(
    callout('<b>One JARVIS, several people.</b> Each profile has its own memory, chats, settings, voice, reminders, lists, projects, notes, recordings and permissions. Give each profile a PIN (Settings → Privacy) so its data is encrypted and others on this device can’t open it. A profile without a PIN is kept separate but isn’t protected.', { icon: 'user' }),
    section('Profiles', '', list, h('div', { class: 'flex', style: { marginTop: '10px' } },
      h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: async () => {
        const made = await profileForm({ title: 'New profile' });
        if (!made) return;
        draw();
        if (await dialog({ title: `Switch to ${made.name} now?`, text: 'JARVIS restarts as the new profile. You can switch back any time from the sidebar.', okLabel: 'Switch now', cancelLabel: 'Later' })) P.switchTo(made.id);
      } }, iconNode('plus'), 'New profile'))),
    section('Start-up', '', rows(
      row('Ask who’s using JARVIS', 'When there is more than one profile, show the profile picker when JARVIS opens.', toggle(P.askAtStart(), (v) => P.setAskAtStart(v), 'Ask at start')))),
    section('This profile’s settings', 'Move your settings to another profile or device. Secrets (your sync phrase, PIN and sign-in settings) are never included.', rows(
      row('Export settings', 'Saves a small file.', h('button', { class: 'btn btn-sm', type: 'button', onclick: exportSettings }, iconNode('download'), 'Export')),
      row('Import settings', 'Replaces this profile’s settings with the ones in the file.', h('button', { class: 'btn btn-sm', type: 'button', onclick: importSettings }, iconNode('upload'), 'Import')))),
  );
});

async function deleteProfile(p, locked) {
  const n = await P.sizeOf(p.id);
  // That person's own PIN is needed if they set one (their data is theirs).
  if (locked) {
    const ok = await modal(`Delete ${p.name}?`, `${p.name}’s profile is protected. Enter ${p.name}’s PIN to delete it.`, ({ body, msg, close }) => {
      const pin = h('input', { class: 'field', type: 'password', inputmode: 'numeric', placeholder: `${p.name}’s PIN`, 'aria-label': 'PIN', style: { width: '100%', marginTop: '8px' } });
      const go = async () => { msg.textContent = 'Checking…'; if (await checkOtherPin(p.id, pin.value)) close(true); else { msg.textContent = 'That PIN isn’t right.'; pin.value = ''; auth.log('profile delete', { ok: false, profile: p.id, detail: 'wrong PIN' }).catch(() => {}); } };
      pin.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      body.append(pin, h('div', { class: 'flex', style: { justifyContent: 'flex-end', marginTop: '14px' } }, h('button', { class: 'btn btn-ghost', type: 'button', text: 'Cancel', onclick: () => close(null) }), h('button', { class: 'btn btn-danger', type: 'button', text: 'Next', onclick: go })));
      setTimeout(() => pin.focus(), 30);
    });
    if (!ok) return false;
  }
  const typed = await dialog({ title: `Delete ${p.name}?`, text: `This permanently deletes ${p.name}’s profile and everything in it (${n} saved item${n === 1 ? '' : 's'}: chats, memories, lists, reminders, notes, recordings and settings). It can’t be undone. Type the name to confirm.`, input: '', okLabel: 'Delete forever', danger: true });
  if (typed == null) return false;
  if (typed.trim().toLowerCase() !== p.name.toLowerCase()) { toast('The name didn’t match, so nothing was deleted.', { bad: true }); return false; }
  try { await P.remove(p.id); auth.log('profile deleted', { profile: 'device', detail: p.name }).catch(() => {}); toast(`${p.name}’s profile was deleted.`); return true; }
  catch (e) { toast(e.message, { bad: true }); return false; }
}
/** Check another profile's PIN (its lock settings are readable; its data isn't). */
async function checkOtherPin(id, pin) {
  const S = await import('../store.js');
  const cfg = await S.readOf(id, 'lock');
  if (!cfg?.pinWrap) return false;
  try {
    const enc = new TextEncoder(), unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
    const base = await crypto.subtle.importKey('raw', enc.encode(String(pin)), 'PBKDF2', false, ['deriveKey']);
    const k = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: unb64(cfg.salt), iterations: 310000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(cfg.pinWrap.iv) }, k, unb64(cfg.pinWrap.d));
    return true;
  } catch { return false; }
}

async function exportSettings() {
  if (!(await verify('Export this profile’s settings'))) return;
  const data = JSON.stringify(P.exportSettings(), null, 2);
  const name = `JARVIS settings - ${P.active()?.name || 'profile'}.json`.replace(/[^\w .-]+/g, '');
  const { call, isNative } = await import('../host.js');
  try {
    if (isNative) { const r = await call('file.save', { name, content: data }); if (!r?.ok) throw new Error('Not saved.'); toast('Settings saved.'); }
    else { const a = h('a', { href: URL.createObjectURL(new Blob([data], { type: 'application/json' })), download: name }); document.body.append(a); a.click(); a.remove(); toast('Settings downloaded.'); }
    auth.log('settings exported').catch(() => {});
  } catch (e) { toast(e.message, { bad: true }); }
}

function importSettings() {
  const input = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
  input.addEventListener('change', async () => {
    try {
      const s = P.readImport(await input.files[0].text());
      if (!(await verify('Import settings into this profile'))) return;
      if (!(await dialog({ title: 'Replace this profile’s settings?', text: `Settings from the file (${Object.keys(s).length} groups) replace this profile’s settings. Chats, memories and lists aren’t changed. JARVIS restarts afterwards.`, okLabel: 'Import' }))) return;
      for (const [k, v] of Object.entries(s)) set(k, v);
      auth.log('settings imported').catch(() => {});
      const S = await import('../store.js'); await S.flush();
      location.reload();
    } catch (e) { toast(e.message, { bad: true }); }
    input.remove();
  });
  document.body.append(input);
  input.click();
}

export { checkOtherPin, deleteProfile };
