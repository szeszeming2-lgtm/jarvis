// Shared UI pieces: toasts, popover menus, small dialogs, settings rows.
import { h, $, iconNode, bus } from '../util.js';

export function toast(text, { bad = false, ms = 3200, icon = bad ? 'alert' : 'check' } = {}) {
  const box = $('#toasts');
  const t = h('div', { class: 'toast' + (bad ? ' bad' : ''), role: 'status' }, iconNode(icon), h('span', { text }));
  box.append(t);
  setTimeout(() => { t.style.transition = 'opacity .3s, transform .3s'; t.style.opacity = '0'; t.style.transform = 'translateY(6px)'; }, ms);
  setTimeout(() => t.remove(), ms + 350);
}
bus.on('toast', (d) => toast(d.text, d));

let popCleanup = null;
/** Show a menu near an anchor element. items: [{label, icon, on, danger, sub, action} | 'sep' | {header}] */
export function menu(anchor, items, { align = 'left' } = {}) {
  const pop = $('#popover');
  closeMenu();
  pop.replaceChildren(...items.map((it) => {
    if (it === 'sep') return h('div', { class: 'pop-sep' });
    if (it.header) return h('div', { class: 'pop-label', text: it.header });
    return h('button', { class: 'pop-item' + (it.on ? ' on' : '') + (it.danger ? ' danger' : ''), type: 'button', onclick: () => { closeMenu(); it.action?.(); } },
      it.icon ? iconNode(it.icon) : null, h('span', { text: it.label }), it.sub ? h('small', { text: it.sub }) : null);
  }));
  pop.hidden = false;
  const r = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  let x = align === 'right' ? r.right - pw : r.left;
  let y = r.bottom + 6;
  if (y + ph > innerHeight - 8) y = Math.max(8, r.top - ph - 6);
  x = Math.max(8, Math.min(innerWidth - pw - 8, x));
  pop.style.left = x + 'px';
  pop.style.top = y + 'px';
  const away = (e) => { if (!pop.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) closeMenu(); };
  const esc = (e) => { if (e.key === 'Escape') closeMenu(); };
  setTimeout(() => { document.addEventListener('mousedown', away); document.addEventListener('keydown', esc); });
  popCleanup = () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  pop.querySelector('.pop-item')?.focus();
}
export function closeMenu() { $('#popover').hidden = true; popCleanup?.(); popCleanup = null; }

/** Simple modal: returns a Promise with the chosen value. */
export function dialog({ title, text = '', input = null, okLabel = 'OK', cancelLabel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    const layer = h('div', { class: 'sheet-layer', style: { zIndex: 80 } });
    let field = null;
    if (input !== null) field = h('input', { class: 'field', value: input, style: { width: '100%', marginTop: '12px' } });
    const close = (v) => { layer.remove(); resolve(v); };
    const box = h('div', { class: 'wizard glass', style: { width: 'min(440px, 100%)', textAlign: 'left', padding: '22px 24px' }, role: 'dialog', 'aria-modal': 'true' },
      h('h3', { style: { margin: '0 0 8px', fontWeight: 600, fontSize: '17px' }, text: title }),
      text ? h('p', { class: 'muted', style: { margin: 0, lineHeight: 1.55, fontSize: '13.5px' }, text }) : null,
      field,
      h('div', { class: 'flex', style: { justifyContent: 'flex-end', marginTop: '18px' } },
        cancelLabel ? h('button', { class: 'btn btn-ghost', type: 'button', text: cancelLabel, onclick: () => close(null) }) : null,
        h('button', { class: 'btn ' + (danger ? 'btn-danger' : 'btn-primary'), type: 'button', text: okLabel, onclick: () => close(field ? field.value : true) })));
    layer.append(box);
    layer.addEventListener('mousedown', (e) => { if (e.target === layer) close(null); });
    layer.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(null); }
      if (e.key === 'Enter' && field) close(field.value);
    });
    document.body.append(layer);
    (field || box.querySelector('.btn-primary, .btn-danger')).focus();
    field?.select();
  });
}

// ---------------------------------------------------------------- form rows
export function row(label, desc, control, { stack = false } = {}) {
  return h('div', { class: 'row' + (stack ? ' stack' : '') },
    h('div', { class: 'row-text' }, h('div', { class: 'row-label', text: label }), desc ? h('div', { class: 'row-desc', text: desc }) : null),
    h('div', { class: 'row-control' }, control));
}

export function toggle(checked, onchange, label = '') {
  const input = h('input', { type: 'checkbox', 'aria-label': label });
  input.checked = !!checked;
  input.addEventListener('change', () => onchange(input.checked));
  return h('label', { class: 'switch' }, input, h('span'));
}

export function select(value, options, onchange, label = '') {
  const sel = h('select', { class: 'field', 'aria-label': label });
  for (const o of options) {
    const [v, t] = Array.isArray(o) ? o : [o.value, o.label];
    const opt = h('option', { value: v, text: t });
    if (String(v) === String(value)) opt.selected = true;
    sel.append(opt);
  }
  sel.addEventListener('change', () => onchange(sel.value));
  return sel;
}

export function seg(value, options, onchange) {
  const box = h('div', { class: 'seg', role: 'radiogroup' });
  for (const [v, t] of options) {
    const b = h('button', { type: 'button', class: String(v) === String(value) ? 'on' : '', text: t, role: 'radio', 'aria-checked': String(String(v) === String(value)) });
    b.addEventListener('click', () => { for (const x of box.children) { x.classList.remove('on'); x.setAttribute('aria-checked', 'false'); } b.classList.add('on'); b.setAttribute('aria-checked', 'true'); onchange(v); });
    box.append(b);
  }
  return box;
}

export function range(value, min, max, step, onchange, fmt = (v) => v, label = '') {
  const out = h('span', { class: 'mono', style: { minWidth: '40px', textAlign: 'right' }, text: fmt(value) });
  const r = h('input', { type: 'range', min, max, step, 'aria-label': label });
  r.value = value;
  r.addEventListener('input', () => { out.textContent = fmt(+r.value); onchange(+r.value); });
  return h('div', { class: 'flex' }, r, out);
}

export function text(value, onchange, { placeholder = '', width = '220px', label = '' } = {}) {
  const i = h('input', { class: 'field', value: value || '', placeholder, style: { width }, 'aria-label': label || placeholder });
  i.addEventListener('input', () => onchange(i.value));
  return i;
}

export function area(value, onchange, { placeholder = '', rows = 4 } = {}) {
  const t = h('textarea', { class: 'field', placeholder, rows });
  t.value = value || '';
  t.addEventListener('input', () => onchange(t.value));
  return t;
}

export function section(title, note, ...children) {
  return h('div', { class: 'section' }, h('h4', { text: title }), note ? h('p', { class: 'note', text: note }) : null, ...children);
}

export const rows = (...r) => h('div', { class: 'rows' }, ...r);

export function callout(textOrNode, { warn = false, icon = warn ? 'alert' : 'info' } = {}) {
  const body = h('div');
  if (typeof textOrNode === 'string') body.innerHTML = textOrNode; // static strings written in this codebase only
  else body.append(textOrNode);
  return h('div', { class: 'callout' + (warn ? ' warn' : '') }, iconNode(icon), body);
}

// ---------------------------------------------------------------- keys
export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export function prettyKey(combo) {
  if (!combo) return '—';
  return combo.split('+').map((k) => ({ Mod: isMac ? '⌘' : 'Ctrl', Alt: isMac ? '⌥' : 'Alt', Shift: isMac ? '⇧' : 'Shift', Ctrl: isMac ? '⌃' : 'Ctrl', Escape: 'Esc', ' ': 'Space', Space: 'Space', ArrowUp: '↑', ArrowDown: '↓' }[k] || (k.length === 1 ? k.toUpperCase() : k))).join(isMac ? '' : '+');
}
export function comboFromEvent(e) {
  const parts = [];
  if (isMac ? e.metaKey : e.ctrlKey) parts.push('Mod');
  if (isMac && e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  let k = e.key;
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(k)) return null;
  if (e.code?.startsWith('Key')) k = e.code.slice(3);
  else if (e.code?.startsWith('Digit')) k = e.code.slice(5);
  else if (e.code === 'Space') k = 'Space';
  else if (e.code === 'Comma') k = ',';
  else if (e.code === 'Backslash') k = '\\';
  else if (e.code === 'Period') k = '.';
  else if (e.code === 'Slash') k = '/';
  parts.push(k.length === 1 ? k.toUpperCase() : k);
  return parts.join('+');
}
export function matches(e, combo) {
  if (!combo) return false;
  const c = comboFromEvent(e);
  return c && c.toLowerCase() === combo.toLowerCase();
}
