// Search everything (⌘K / Ctrl+K, or the search button): one box over chats, projects,
// lists, people, memories, reminders, plugins and settings, plus files in the Mac app.
import { h, iconNode } from '../util.js';
import { call, can } from '../host.js';
import { search } from '../search.js';
import { openSheet } from './sheets.js';
import * as sessions from '../sessions.js';

let layer = null;

export function openSearch(q = '') {
  if (layer) { layer.querySelector('input').focus(); return; }
  const input = h('input', { class: 'field search-input', type: 'search', placeholder: 'Search chats, projects, lists, people, notes…', 'aria-label': 'Search everything', value: q, autocomplete: 'off' });
  const results = h('div', { class: 'search-results', role: 'listbox' });
  let items = [], sel = 0, seq = 0;
  const close = () => { layer?.remove(); layer = null; document.removeEventListener('keydown', onKey, true); };
  const go = async (r) => {
    close();
    const o = r.open;
    if (o.type === 'chat') { await sessions.open(o.id); return; }
    if (o.type === 'project') { const m = await import('./projects.js'); m.openProject?.(o.id); openSheet('projects'); return; }
    if (o.type === 'file') { call('tool.reveal', { path: o.path }).catch(() => {}); return; }
    if (o.type === 'url') { call('tool.open_url', { url: o.url }).catch(() => window.open(o.url, '_blank', 'noopener')); return; }
    if (o.type === 'tab') openSheet(o.tab);
  };
  const draw = () => {
    results.replaceChildren(...items.map((r, i) => h('button', { class: 'search-row' + (i === sel ? ' sel' : ''), type: 'button', role: 'option', 'aria-selected': i === sel, onclick: () => go(r), onmousemove: () => { if (sel !== i) { sel = i; draw(); } } },
      h('span', { class: 'item-ic' }, iconNode(r.icon)), h('span', { class: 'search-text' }, h('b', { text: r.title }), h('small', { text: r.sub })), h('span', { class: 'pill', text: r.kind }))));
    if (!items.length) results.append(h('div', { class: 'empty', text: input.value.trim() ? 'Nothing found. Try fewer words.' : 'Type to search everything in JARVIS.' }));
  };
  const run = async () => {
    const my = ++seq, q2 = input.value.trim();
    items = q2 ? await search(q2, { limit: 30 }) : [];
    if (my !== seq) return;
    sel = 0; draw();
    // Mac app: files too (Spotlight), after a short pause.
    if (q2.length >= 3 && can('files')) {
      try {
        const f = await call('tool.find_files', { query: q2, limit: 6 });
        if (my !== seq) return;
        items = [...items, ...(f.files || []).slice(0, 6).map((x) => ({ kind: 'file', icon: x.isDir ? 'folder' : 'file', title: x.name, sub: x.folder || x.path, open: { type: 'file', path: x.path } }))];
        draw();
      } catch {}
    }
  };
  let t = 0;
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 160); });
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); draw(); results.children[sel]?.scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); results.children[sel]?.scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'Enter' && items[sel]) { e.preventDefault(); go(items[sel]); }
  };
  document.addEventListener('keydown', onKey, true);
  layer = h('div', { class: 'sheet-layer search-layer', onclick: (e) => { if (e.target === layer) close(); } },
    h('div', { class: 'search-box glass', role: 'dialog', 'aria-label': 'Search everything' },
      h('div', { class: 'search-head' }, iconNode('search'), input, h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close search', onclick: close }, iconNode('x'))),
      results));
  document.body.append(layer);
  draw();
  input.focus();
  if (q) run();
}
