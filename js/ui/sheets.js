// The Settings sheet: a tabbed glass panel. Each tab is a function that builds its content.
import { h, $, iconNode, hydrateIcons, bus } from '../util.js';

const TABS = [
  ['general', 'General', 'user'],
  ['models', 'AI Models', 'layers'],
  ['voice', 'Voice', 'mic'],
  ['memory', 'Memory', 'brain'],
  ['skills', 'Skills', 'puzzle'],
  ['appearance', 'Appearance', 'palette'],
  ['home', 'Home Screen', 'home'],
  ['shortcuts', 'Keyboard Shortcuts', 'keyboard'],
  ['permissions', 'Permissions', 'shield'],
  ['privacy', 'Privacy & Data', 'lock'],
  ['about', 'About & Help', 'info'],
];
const builders = new Map();
export const registerTab = (id, fn) => builders.set(id, fn);

let current = null;
let cleanup = null;

export function isOpen() { return !$('#sheetLayer').hidden; }

export function openSheet(tab = 'general') {
  const layer = $('#sheetLayer');
  if (layer.hidden) {
    const nav = h('nav', { class: 'sheet-nav', 'aria-label': 'Settings sections' }, h('h2', { text: 'Settings' }),
      ...TABS.map(([id, label, ic]) => h('button', { class: 'sheet-tab', type: 'button', dataset: { tab: id }, onclick: () => show(id) }, iconNode(ic), label)));
    const main = h('div', { class: 'sheet-main' },
      h('div', { class: 'sheet-head' }, h('h3', { id: 'sheetTitle' }), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close settings', title: 'Close (Esc)', onclick: closeSheet }, iconNode('x'))),
      h('div', { class: 'sheet-body', id: 'sheetBody' }));
    layer.replaceChildren(h('div', { class: 'sheet glass', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Settings' }, nav, main));
    layer.hidden = false;
    layer.onmousedown = (e) => { if (e.target === layer) closeSheet(); };
  }
  show(tab);
}

export function show(tab) {
  if (!builders.has(tab)) tab = 'general';
  cleanup?.();
  cleanup = null;
  current = tab;
  for (const b of document.querySelectorAll('.sheet-tab')) b.classList.toggle('active', b.dataset.tab === tab);
  $('#sheetTitle').textContent = TABS.find((t) => t[0] === tab)[1];
  const body = $('#sheetBody');
  body.replaceChildren();
  body.scrollTop = 0;
  const res = builders.get(tab)(body);
  if (typeof res === 'function') cleanup = res;
  hydrateIcons(body);
  bus.emit('sheet', tab);
}

export function refresh() { if (current && isOpen()) { const st = $('#sheetBody').scrollTop; show(current); $('#sheetBody').scrollTop = st; } }

export function closeSheet() {
  cleanup?.();
  cleanup = null;
  current = null;
  $('#sheetLayer').hidden = true;
  $('#sheetLayer').replaceChildren();
  bus.emit('sheet', null);
  $('#input')?.focus();
}
export const currentTab = () => current;
