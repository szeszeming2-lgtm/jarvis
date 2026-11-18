// Plugins tab: recommendations, your own plugins (make, paste, import, share), the
// free plugin store, and the built-in features with on/off switches.
// A plugin is plain data (instructions, a row of actions, or a website link), never
// code, and you see exactly what it can do before you add it.
import { h, iconNode, bus } from '../util.js';
import { registerTab, closeSheet, openSheet } from './sheets.js';
import { section, toggle, toast, callout, dialog } from './common.js';
import { call } from '../host.js';
import * as plugins from '../plugins.js';
import * as skills from '../skills.js';

export function runSuggestion(rec) {
  const p = rec.plugin;
  if (rec.action === 'enable' && p.groups) { plugins.setOn(p, true); toast(`${p.name} is on`); }
  if (p.id === 'ai') return openSheet('models');
  if (rec.action === 'setup' && p.open) return openSheet(p.open);
  if (p.id === 'workout') { closeSheet(); return import('./workout.js').then((m) => m.openCoach('squats')); }
  if (p.id === 'look') { closeSheet(); return import('./look.js').then((m) => m.start({})); }
  if (p.tryText) { closeSheet(); return import('../assistant.js').then((a) => a.send(p.tryText)); }
  if (p.open) openSheet(p.open);
}

const KIND = { prompt: 'Instructions', routine: 'Actions', link: 'Website' };
const perms = (sk) => h('div', { class: 'perm-list' }, ...skills.permissions(sk).map((x) => h('span', { class: 'perm ' + x.level }, iconNode(x.icon), x.text)));
const howTo = (sk) => (sk.triggers?.length ? `Say “${sk.triggers[0]}${sk.kind !== 'routine' ? ' …' : ''}” or type /${sk.command}` : `Type /${sk.command}${sk.kind !== 'routine' ? ' …' : ''}`);

/** Review a plugin from someone else before adding it. */
async function review(list, from) {
  const layer = h('div', { class: 'sheet-layer', style: { zIndex: 76 } });
  let done;
  const result = new Promise((r) => (done = r));
  const close = (v) => { layer.remove(); done(v); };
  layer.append(h('div', { class: 'wizard glass', style: { width: 'min(560px, 100%)', textAlign: 'left' }, role: 'dialog', 'aria-modal': 'true' },
    h('h2', { style: { fontSize: '20px', margin: '0 0 6px' }, text: list.length === 1 ? `Add “${list[0].name}”?` : `Add ${list.length} plugins?` }),
    h('p', { class: 'muted', style: { margin: '0 0 12px', fontSize: '13px' }, text: `From ${from}. Plugins are plain instructions, never hidden code. Here is everything ${list.length === 1 ? 'it' : 'they'} can do:` }),
    h('div', { class: 'list' }, ...list.map((sk) => h('div', { class: 'item', style: { alignItems: 'flex-start' } },
      h('span', { class: 'item-ic' }, iconNode(sk.icon || 'puzzle')),
      h('div', { class: 'item-main' }, h('div', { class: 'item-title' }, sk.name, h('span', { class: 'pill', text: KIND[sk.kind] })), h('div', { class: 'item-sub', text: sk.description || howTo(sk) }), perms(sk),
        sk.kind === 'link' ? h('div', { class: 'item-sub mono', style: { wordBreak: 'break-all' }, text: sk.url }) : null,
        sk.kind === 'routine' ? h('div', { class: 'item-sub', text: 'Steps: ' + sk.steps.map((st) => st.tool.replace(/_/g, ' ')).join(' → ') }) : null)))),
    h('div', { class: 'flex', style: { justifyContent: 'flex-end', marginTop: '16px' } },
      h('button', { class: 'btn btn-ghost', type: 'button', text: 'Cancel', onclick: () => close(false) }),
      h('button', { class: 'btn btn-primary', type: 'button', text: 'Add', onclick: () => close(true) }))));
  layer.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(false); } });
  document.body.append(layer);
  layer.querySelector('.btn-primary')?.focus();
  return result;
}

async function addFromCode(text, from) {
  const list = skills.parseCode(text);
  if (!(await review(list, from))) return;
  skills.importSkills(list);
  toast(list.length === 1 ? `Added ${list[0].name}. ${howTo(skills.find(list[0].command) || list[0])}.` : `Added ${list.length} plugins.`, { ms: 5000 });
}

function pasteCode() {
  const area = h('textarea', { class: 'field', rows: 7, placeholder: '{"jarvisPlugin":1,"name":"…"}', style: { width: '100%', fontFamily: 'var(--mono)', fontSize: '12.5px' }, 'aria-label': 'Plugin code' });
  const layer = h('div', { class: 'sheet-layer', style: { zIndex: 75 } });
  const close = () => layer.remove();
  layer.append(h('div', { class: 'wizard glass', style: { width: 'min(560px, 100%)', textAlign: 'left' }, role: 'dialog', 'aria-modal': 'true' },
    h('h2', { style: { fontSize: '20px', margin: '0 0 6px' }, text: 'Paste plugin code' }),
    h('p', { class: 'muted', style: { margin: '0 0 10px', fontSize: '13px' }, text: 'Someone shared a JARVIS plugin with you? Paste its code here. You’ll see what it can do before it’s added.' }),
    area,
    h('div', { class: 'flex', style: { justifyContent: 'flex-end', marginTop: '14px' } },
      h('button', { class: 'btn btn-ghost', type: 'button', text: 'Cancel', onclick: close }),
      h('button', { class: 'btn btn-primary', type: 'button', text: 'Next', onclick: async () => { try { await addFromCode(area.value, 'pasted code'); close(); } catch (e) { toast(e.message, { bad: true }); } } }))));
  layer.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  document.body.append(layer);
  area.focus();
}

async function importFile() {
  try {
    const f = await call('file.open', { accept: '.json,.txt', types: ['json', 'txt'] });
    if (f) await addFromCode(f.text, f.name || 'a file');
  } catch (e) { toast(e.message, { bad: true }); }
}

async function share(sk) {
  const code = skills.toCode(sk);
  const text = `JARVIS plugin “${sk.name}”. In JARVIS: Plugins → Paste plugin code.\n\n${code}`;
  try {
    if (navigator.share && /iPhone|iPad|Android/i.test(navigator.userAgent)) { await navigator.share({ title: `JARVIS plugin: ${sk.name}`, text }); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(code); toast('Plugin code copied. Send it to a friend; they paste it under Plugins.'); }
  catch { await call('app.copy', { text: code }).then(() => toast('Plugin code copied.')).catch(() => dialog({ title: 'Plugin code', text: 'Copy this and send it:', input: code })); }
}

registerTab('plugins', (body) => {
  const recBox = h('div', { class: 'list' });
  const mineBox = h('div', { class: 'list' });
  const storeBox = h('div');
  const allBox = h('div', { class: 'list' });
  let filter = '';
  const search = h('input', { class: 'field', type: 'search', placeholder: 'Search the store', 'aria-label': 'Search plugins', style: { width: '100%', marginBottom: '10px' } });
  search.addEventListener('input', () => { filter = search.value.trim().toLowerCase(); drawStore(); });

  const drawStore = () => {
    const groups = [['link', 'Website shortcuts'], ['prompt', 'Helpers (AI instructions)'], ['routine', 'Action combos']];
    const match = (g) => !filter || `${g.name} ${g.description} ${g.command}`.toLowerCase().includes(filter);
    storeBox.replaceChildren(...groups.map(([k, label]) => {
      const items = skills.GALLERY.filter((g) => g.kind === k && match(g));
      if (!items.length) return null;
      return h('div', { style: { marginBottom: '12px' } }, h('div', { class: 'pop-label', style: { padding: '4px 2px' }, text: label }), h('div', { class: 'list' }, ...items.map((g) => h('div', { class: 'item', style: { alignItems: 'flex-start' } },
        h('span', { class: 'item-ic' }, iconNode(g.icon)),
        h('div', { class: 'item-main' }, h('div', { class: 'item-title', text: g.name }), h('div', { class: 'item-sub', text: g.description }), perms(g)),
        h('div', { class: 'item-actions' }, skills.installed(g.id) ? h('span', { class: 'pill ok', text: 'Added' }) : h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { skills.install(g.id); toast(`Added ${g.name}. ${howTo(g)}.`, { ms: 4500 }); } }, iconNode('plus'), 'Add'))))));
    }));
    if (!storeBox.children.length) storeBox.append(h('div', { class: 'empty', text: 'Nothing matches. Make your own plugin above.' }));
  };

  const draw = async () => {
    const recs = await plugins.recommend(3);
    recBox.replaceChildren(...recs.map((r) => h('div', { class: 'item on' },
      h('span', { class: 'item-ic' }, iconNode(r.plugin.icon)),
      h('div', { class: 'item-main' }, h('div', { class: 'item-title', text: r.plugin.name }), h('div', { class: 'item-sub', text: r.reason })),
      h('button', { class: 'btn btn-sm btn-primary', type: 'button', text: r.action === 'setup' ? 'Set up' : r.action === 'enable' ? 'Add' : 'Try it', onclick: () => runSuggestion(r) }))));
    if (!recs.length) recBox.append(h('div', { class: 'empty', text: 'You’re using everything. Nice!' }));

    mineBox.replaceChildren(...skills.all().map((sk) => h('div', { class: 'item' + (sk.enabled !== false ? ' on' : ''), style: { alignItems: 'flex-start' } },
      h('span', { class: 'item-ic' }, iconNode(sk.icon || 'puzzle')),
      h('div', { class: 'item-main' }, h('div', { class: 'item-title' }, sk.name, h('span', { class: 'pill', text: KIND[sk.kind] || sk.kind })), h('div', { class: 'item-sub', text: howTo(sk) }), perms(sk)),
      h('div', { class: 'item-actions' },
        h('button', { class: 'icon-btn', type: 'button', title: 'Share', 'aria-label': `Share ${sk.name}`, onclick: () => share(sk) }, iconNode('share')),
        h('button', { class: 'icon-btn', type: 'button', title: 'Edit', 'aria-label': `Edit ${sk.name}`, onclick: () => import('./memory-skills.js').then((m) => m.editSkill(sk)) }, iconNode('edit')),
        h('button', { class: 'icon-btn', type: 'button', title: 'Remove', 'aria-label': `Remove ${sk.name}`, onclick: async () => { if (await dialog({ title: `Remove “${sk.name}”?`, okLabel: 'Remove', danger: true })) skills.remove(sk.id); } }, iconNode('trash')),
        toggle(sk.enabled !== false, (v) => skills.toggle(sk.id, v), `Turn ${sk.name} on or off`)))));
    if (!skills.all().length) mineBox.append(h('div', { class: 'empty', text: 'No plugins added yet. Add some from the store below or make your own.' }));

    allBox.replaceChildren(...plugins.available().map((p) => h('div', { class: 'item' + (plugins.isOn(p) ? ' on' : '') },
      h('span', { class: 'item-ic' }, iconNode(p.icon)),
      h('div', { class: 'item-main' }, h('div', { class: 'item-title', text: p.name }), h('div', { class: 'item-sub', text: p.desc })),
      h('div', { class: 'item-actions' },
        (p.tryText || p.id === 'look') && plugins.isOn(p) ? h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Try', onclick: () => runSuggestion({ plugin: p, action: 'try' }) }) : null,
        toggle(plugins.isOn(p), (on) => { plugins.setOn(p, on); setTimeout(draw, 50); }, p.name)))));
    drawStore();
  };
  const offs = [bus.on('skills', draw), bus.on('settings', (d) => { if (d.path.startsWith('skills')) draw(); })];
  body.append(
    callout('<b>Plugins</b> add things JARVIS can do. They’re free, work on your device, and are plain instructions (never hidden code), so you always see what one can do before adding it. Actions still follow your Permissions.', { icon: 'puzzle' }),
    section('Recommended for you', 'Based on what you haven’t tried yet.', recBox),
    section('Your plugins', 'Ones you added or made. Share any of them with a friend.', mineBox,
      h('div', { class: 'flex', style: { marginTop: '10px' } },
        h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => import('./memory-skills.js').then((m) => m.editSkill(null)) }, iconNode('plus'), 'Make a plugin'),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => import('./memory-skills.js').then((m) => m.editSkill(null, { kind: 'link' })) }, iconNode('globe'), 'Website shortcut'),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: pasteCode }, iconNode('copy'), 'Paste plugin code'),
        h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: importFile }, iconNode('upload'), 'Import file'))),
    section('Plugin store', `${skills.GALLERY.length} free plugins. Tap Add, then use it by saying its phrase.`, search, storeBox),
    section('Built-in features', 'Turn off what you don’t need.', allBox),
  );
  draw();
  return () => offs.forEach((f) => f());
});
