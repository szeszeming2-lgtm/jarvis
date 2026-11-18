// Plugins tab: recommendations at the top, then every plugin with an on/off switch.
import { h, iconNode, bus } from '../util.js';
import { registerTab, show, closeSheet, openSheet } from './sheets.js';
import { section, toggle, toast, callout } from './common.js';
import * as plugins from '../plugins.js';

export function runSuggestion(rec) {
  const p = rec.plugin;
  if (rec.action === 'enable' && p.groups) { plugins.setOn(p, true); toast(`${p.name} is on`); }
  if (p.id === 'ai') return openSheet('models');
  if (rec.action === 'setup' && p.open) return openSheet(p.open);
  if (p.id === 'workout') { closeSheet(); return import('./workout.js').then((m) => m.openCoach('squats')); }
  if (p.tryText) { closeSheet(); return import('../assistant.js').then((a) => a.send(p.tryText)); }
  if (p.open) openSheet(p.open);
}

registerTab('plugins', (body) => {
  const recBox = h('div', { class: 'list' });
  const allBox = h('div', { class: 'list' });
  const draw = async () => {
    const recs = await plugins.recommend(3);
    recBox.replaceChildren(...recs.map((r) => h('div', { class: 'item on' },
      h('span', { class: 'item-ic' }, iconNode(r.plugin.icon)),
      h('div', { class: 'item-main' }, h('div', { class: 'item-title', text: r.plugin.name }), h('div', { class: 'item-sub', text: r.reason })),
      h('button', { class: 'btn btn-sm btn-primary', type: 'button', text: r.action === 'setup' ? 'Set up' : r.action === 'enable' ? 'Add' : 'Try it', onclick: () => runSuggestion(r) }))));
    if (!recs.length) recBox.append(h('div', { class: 'empty', text: 'You’re using everything. Nice!' }));
    allBox.replaceChildren(...plugins.available().map((p) => h('div', { class: 'item' + (plugins.isOn(p) ? ' on' : '') },
      h('span', { class: 'item-ic' }, iconNode(p.icon)),
      h('div', { class: 'item-main' }, h('div', { class: 'item-title', text: p.name }), h('div', { class: 'item-sub', text: p.desc })),
      h('div', { class: 'item-actions' },
        p.tryText && plugins.isOn(p) ? h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Try', onclick: () => runSuggestion({ plugin: p, action: 'try' }) }) : null,
        toggle(plugins.isOn(p), (on) => { plugins.setOn(p, on); setTimeout(draw, 50); }, p.name)))));
  };
  const offs = [bus.on('skills', draw), bus.on('settings', (d) => { if (d.path.startsWith('skills')) draw(); })];
  body.append(
    callout('<b>Plugins</b> are the things JARVIS can do for you. They’re all free and run on your device. Turn off the ones you don’t need, or try the recommendations.', { icon: 'puzzle' }),
    section('Recommended for you', 'Based on what you haven’t tried yet.', recBox),
    section('All plugins', '', allBox),
    h('p', { class: 'muted', style: { fontSize: '12.5px' } }, 'Want your own shortcuts? ', h('a', { href: '#', style: { color: 'var(--accent)' }, onclick: (e) => { e.preventDefault(); show('skills'); } }, 'Create a skill'), '.'),
  );
  draw();
  return () => offs.forEach((f) => f());
});
