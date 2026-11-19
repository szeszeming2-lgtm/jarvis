// Saved links tab: everything you asked JARVIS to keep for later.
import { h, iconNode, bus, timeAgo } from '../util.js';
import { registerTab, closeSheet } from './sheets.js';
import { section, toast, dialog } from './common.js';
import { call, can } from '../host.js';
import * as links from '../links.js';

registerTab('links', (body) => {
  let q = '', showRead = false;
  const search = h('input', { class: 'field', type: 'search', placeholder: 'Search your links', 'aria-label': 'Search saved links', style: { width: '100%', marginBottom: '10px' } });
  search.addEventListener('input', () => { q = search.value; draw(); });
  const list = h('div', { class: 'list' });
  const open = (l) => { call('tool.open_url', { url: l.url }).catch(() => window.open(l.url, '_blank', 'noopener')); links.setRead(l.id, true); };
  const draw = () => {
    const items = (q.trim() ? links.search(q) : links.all()).filter((l) => showRead || !l.read || q.trim());
    list.replaceChildren(...items.map((l) => h('div', { class: 'item' + (l.read ? '' : ' on'), style: { alignItems: 'flex-start' } },
      h('span', { class: 'item-ic' }, iconNode(l.read ? 'check' : 'globe')),
      h('div', { class: 'item-main' },
        h('button', { class: 'link-title', type: 'button', text: l.title, onclick: () => open(l) }),
        h('div', { class: 'item-sub', text: `${links.hostOf(l.url)} · saved ${timeAgo(l.added)}${l.note ? ` · ${l.note}` : ''}` }),
        l.desc ? h('div', { class: 'item-sub', text: l.desc }) : null),
      h('div', { class: 'item-actions' },
        can('webFetch') ? h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Summarize', onclick: async () => { closeSheet(); const a = await import('../assistant.js'); a.send(`summarize ${l.url}`); } }) : null,
        h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: l.read ? 'Unread' : 'Read', onclick: () => links.setRead(l.id, !l.read) }),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Delete ${l.title}`, onclick: () => links.remove(l.id) }, iconNode('trash'))))));
    if (!items.length) list.append(h('div', { class: 'empty', text: links.all().length ? 'Nothing here. Try “Show read links”.' : 'No saved links yet. Paste a link into the chat, or say “save this link …”.' }));
  };
  const off = bus.on('links', draw);
  body.append(section('Saved links', 'Links you sent JARVIS, kept to read later. Saved only on your devices.', search, list,
    h('div', { class: 'flex', style: { marginTop: '10px' } },
      h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: async () => { const u = await dialog({ title: 'Save a link', text: 'Paste the web address', input: '', okLabel: 'Save' }); if (!u) return; try { links.add(u); toast('Link saved'); } catch (e) { toast(e.message, { bad: true }); } } }, iconNode('plus'), 'Add a link'),
      h('label', { class: 'flex', style: { fontSize: '13px' } }, h('input', { type: 'checkbox', onchange: (e) => { showRead = e.target.checked; draw(); } }), 'Show read links'))));
  draw();
  return off;
});
