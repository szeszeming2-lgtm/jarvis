// Lists & People tab: tick things off, add items, and keep the numbers you text and call.
import { h, iconNode, bus } from '../util.js';
import { registerTab } from './sheets.js';
import { section, toast, dialog, callout, menu } from './common.js';
import { APPS } from '../messaging.js';
import * as lists from '../lists.js';
import * as people from '../people.js';

let current = 'shopping';

registerTab('lists', (body) => {
  const tabs = h('div', { class: 'seg', style: { flexWrap: 'wrap', marginBottom: '12px' } });
  const listBox = h('div', { class: 'list' });
  const addInput = h('input', { class: 'field grow', placeholder: 'Add items (separate with commas)', 'aria-label': 'Add items' });
  const peopleBox = h('div', { class: 'list' });

  const drawTabs = () => {
    tabs.replaceChildren(...lists.names().map((n) => {
      const count = lists.open(n).length;
      return h('button', { type: 'button', class: n === current ? 'on' : '', text: `${lists.title(n)}${count ? ` (${count})` : ''}`, onclick: () => { current = n; drawAll(); } });
    }), h('button', { type: 'button', title: 'New list', 'aria-label': 'New list', onclick: async () => {
      const name = await dialog({ title: 'New list', text: 'For example: Packing, Gifts, Movies to watch', input: '', okLabel: 'Create' });
      if (name?.trim()) { current = lists.create(name); drawAll(); }
    } }, iconNode('plus')));
  };
  const drawList = () => {
    const items = lists.items(current);
    const open = items.filter((i) => !i.done), done = items.filter((i) => i.done);
    const row = (i) => h('div', { class: 'item', style: { padding: '9px 12px', opacity: i.done ? 0.55 : 1 } },
      h('button', { class: 'icon-btn' + (i.done ? ' on' : ''), type: 'button', 'aria-label': i.done ? `Untick ${i.text}` : `Tick off ${i.text}`, onclick: () => { lists.toggle(current, i.id); } }, iconNode(i.done ? 'check' : 'target')),
      h('div', { class: 'item-main' }, h('div', { class: 'item-title selectable', style: { textDecoration: i.done ? 'line-through' : 'none' }, text: i.text })),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Delete ${i.text}`, onclick: () => lists.del(current, i.id) }, iconNode('x')));
    listBox.replaceChildren(...open.map(row), ...done.map(row));
    if (!items.length) listBox.append(h('div', { class: 'empty', text: `Nothing on your ${current} list. Try saying “add eggs and milk to my ${current} list”.` }));
  };
  const HINT = {
    discord: ['Discord DM link', 'In Discord, right-click your chat with them → Copy Link, then paste it here.', 'https://discord.com/channels/@me/…'],
    whatsapp: ['WhatsApp number', 'With the country code.', '+'],
    telegram: ['Telegram username', 'Their @username.', '@'],
    skype: ['Skype name', 'For example live:theirname.', 'live:'],
    teams: ['Teams email', 'Their work email.', ''],
    messenger: ['Messenger username', 'The part after m.me/ in their profile link.', ''],
  };
  const editApp = (p, anchor) => menu(anchor, people.HANDLES.map((app) => ({
    label: APPS[app].label, sub: p[app] ? 'saved' : '', icon: app === 'discord' || app === 'telegram' || app === 'messenger' ? 'message' : 'phone',
    action: async () => {
      const [title, text, ph] = HINT[app];
      const v = await dialog({ title: `${p.name}’s ${title}`, text: text + ' Leave empty to remove it.', input: p[app] || ph, okLabel: 'Save' });
      if (v == null) return;
      if (!v.trim() || v.trim() === ph) { delete p[app]; people.upsert({ name: p.name }); return; }
      try { people.upsert({ name: p.name, [app]: v.trim() }); toast(`Saved. Say “call ${p.name} on ${APPS[app].label}”.`); } catch (e) { toast(e.message, { bad: true }); }
    },
  })));
  const drawPeople = () => {
    peopleBox.replaceChildren(...people.all().map((p) => {
      const apps = people.HANDLES.filter((a) => p[a]).map((a) => APPS[a].label);
      const appBtn = h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Apps', 'aria-label': `${p.name}’s apps`, onclick: (e) => editApp(p, e.currentTarget) });
      return h('div', { class: 'item', style: { padding: '9px 12px' } },
        h('span', { class: 'item-ic' }, iconNode('user')),
        h('div', { class: 'item-main' }, h('div', { class: 'item-title', text: p.name }), h('div', { class: 'item-sub mono', text: [p.phone, ...apps].filter(Boolean).join(' · ') || 'no number yet' })),
        h('div', { class: 'item-actions' },
          p.phone ? h('a', { class: 'btn btn-sm btn-ghost', href: `sms:${p.phone}`, text: 'Text' }) : null,
          p.phone ? h('a', { class: 'btn btn-sm btn-ghost', href: `tel:${p.phone}`, text: 'Call' }) : null,
          appBtn,
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Remove ${p.name}`, onclick: () => people.remove(p.id) }, iconNode('trash'))));
    }));
    if (!people.all().length) peopleBox.append(h('div', { class: 'empty', text: 'No one saved yet. Say “save Mom’s number as +1 555 123 4567”, or add someone here.' }));
  };
  const drawAll = () => { drawTabs(); drawList(); drawPeople(); };
  const add = () => {
    const items = lists.splitItems(addInput.value);
    if (!items.length) return;
    lists.add(current, items);
    addInput.value = '';
    addInput.focus();
  };
  addInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  const offs = [bus.on('lists', drawAll), bus.on('people', drawPeople)];
  body.append(
    section('Lists', 'Saved on this device. Ask JARVIS to add, read or tick things off, or edit them here.', tabs,
      h('div', { class: 'flex', style: { marginBottom: '10px' } }, addInput, h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: add }, iconNode('plus'), 'Add')),
      listBox,
      h('div', { class: 'flex', style: { marginTop: '10px' } },
        h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Remove ticked items', onclick: () => lists.clear(current, { onlyDone: true }) }),
        h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Copy list', onclick: () => navigator.clipboard?.writeText(lists.asText(current)).then(() => toast('Copied')) }),
        !['shopping', 'to-do', 'notes'].includes(current) ? h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Delete this list', onclick: async () => { if (await dialog({ title: `Delete the ${current} list?`, okLabel: 'Delete', danger: true })) { lists.dropList(current); current = 'shopping'; drawAll(); } } }) : null)),
    section('People', 'Names, numbers and app names for “text Mom…”, “call Sam on Discord” or “WhatsApp Jo saying hi”. Stored only on this device.', peopleBox,
      h('button', { class: 'btn btn-sm', type: 'button', style: { marginTop: '10px' }, onclick: async () => {
        const name = await dialog({ title: 'Add someone', text: 'Name (for example Mom, Sam, Dr Lee)', input: '', okLabel: 'Next' });
        if (!name?.trim()) return;
        const phone = await dialog({ title: `${name.trim()}’s number`, text: 'Phone number with country code, or an iMessage email. Leave empty if you only use apps like Discord (add those with the Apps button).', input: '+', okLabel: 'Save' });
        if (phone == null) return;
        const num = phone.trim() === '+' ? '' : phone.trim();
        try { people.upsert({ name, phone: num, allowEmpty: true }); if (!num) toast('Saved. Tap Apps to add their Discord, WhatsApp and more.'); } catch (e) { toast(e.message, { bad: true }); }
      } }, iconNode('plus'), 'Add someone')),
    callout('Texts and calls open your phone’s own Messages or Phone app with everything filled in. You press Send or Call, so nothing goes out without you.', { icon: 'shield' }),
  );
  if (!lists.names().includes(current)) current = lists.names()[0] || 'shopping';
  drawAll();
  return () => offs.forEach((f) => f());
});
