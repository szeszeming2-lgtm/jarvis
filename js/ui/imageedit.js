// Picture editor: crop, rotate, flip, brightness / contrast / colour, filters, draw,
// add text, then save or ask JARVIS about it. Runs on this device (canvas), no upload.
import { h, iconNode } from '../util.js';
import { call, isNative } from '../host.js';
import { toast, dialog } from './common.js';

const FILTERS = { none: 'Original', bw: 'Black & white', sepia: 'Sepia', vivid: 'Vivid', cool: 'Cool', warm: 'Warm' };

/** Pixel adjustments (works in every browser, unlike canvas filters). Exported for tests. */
export function adjust(data, { brightness = 0, contrast = 0, saturation = 0, filter = 'none' } = {}) {
  const b = brightness * 2.55, c = (259 * (contrast * 2.55 + 255)) / (255 * (259 - contrast * 2.55)), s = 1 + saturation / 100;
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i], g = data[i + 1], bl = data[i + 2];
    r = c * (r - 128) + 128 + b; g = c * (g - 128) + 128 + b; bl = c * (bl - 128) + 128 + b;
    const gray = 0.299 * r + 0.587 * g + 0.114 * bl;
    r = gray + (r - gray) * s; g = gray + (g - gray) * s; bl = gray + (bl - gray) * s;
    if (filter === 'bw') r = g = bl = 0.299 * r + 0.587 * g + 0.114 * bl;
    else if (filter === 'sepia') { const R = r, G = g, B = bl; r = 0.393 * R + 0.769 * G + 0.189 * B; g = 0.349 * R + 0.686 * G + 0.168 * B; bl = 0.272 * R + 0.534 * G + 0.131 * B; }
    else if (filter === 'vivid') { const gy = 0.299 * r + 0.587 * g + 0.114 * bl; r = gy + (r - gy) * 1.45; g = gy + (g - gy) * 1.45; bl = gy + (bl - gy) * 1.45; }
    else if (filter === 'cool') { r *= 0.92; bl = bl * 1.08 + 8; }
    else if (filter === 'warm') { r = r * 1.08 + 8; bl *= 0.9; }
    data[i] = r < 0 ? 0 : r > 255 ? 255 : r; data[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g; data[i + 2] = bl < 0 ? 0 : bl > 255 ? 255 : bl;
  }
  return data;
}

export async function openEditor(source = null) {
  let img = source;
  if (!img) {
    const f = await new Promise((res) => { const i = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } }); i.onchange = () => { res(i.files?.[0] || null); i.remove(); }; document.body.append(i); i.click(); });
    if (!f) return;
    img = await loadImage(URL.createObjectURL(f));
  }
  // Working copy: the "base" (after crop/rotate/flip/draw/text) plus live adjustments on top.
  let base = toCanvas(img, 2400);
  const undo = [];
  const adj = { brightness: 0, contrast: 0, saturation: 0, filter: 'none' };
  let mode = 'none'; // none | crop | draw | text
  let penColor = '#ff3b3b';
  const view = h('canvas', { class: 'ie-canvas', 'aria-label': 'Picture being edited' });
  const stage = h('div', { class: 'ask-stage' }, view);
  const hint = h('div', { class: 'ask-hint', text: 'Pick a tool below.' });
  const snapshot = () => { const c = document.createElement('canvas'); c.width = base.width; c.height = base.height; c.getContext('2d').drawImage(base, 0, 0); undo.push(c); if (undo.length > 15) undo.shift(); };

  const render = (preview = true) => {
    const max = preview ? 1200 : 99999;
    const k = Math.min(1, max / Math.max(base.width, base.height));
    const c = preview ? view : document.createElement('canvas');
    c.width = Math.round(base.width * k); c.height = Math.round(base.height * k);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(base, 0, 0, c.width, c.height);
    if (adj.brightness || adj.contrast || adj.saturation || adj.filter !== 'none') {
      const d = g.getImageData(0, 0, c.width, c.height);
      adjust(d.data, adj);
      g.putImageData(d, 0, 0);
    }
    if (preview && cropRect) { g.fillStyle = 'rgba(0,0,0,.5)'; const { x, y, w, h: hh } = cropRect; const s = c.width / base.width; g.beginPath(); g.rect(0, 0, c.width, c.height); g.rect(x * s, y * s, w * s, hh * s); g.fill('evenodd'); g.strokeStyle = '#3ee6ff'; g.lineWidth = 2; g.strokeRect(x * s, y * s, w * s, hh * s); }
    return c;
  };
  const fit = () => { const r = stage.getBoundingClientRect(); const k = Math.min(r.width / view.width, r.height / view.height, 1.5); view.style.width = Math.floor(view.width * k) + 'px'; view.style.height = Math.floor(view.height * k) + 'px'; };
  const redraw = () => { render(true); fit(); };

  // Pointer tools: crop rectangle, freehand pen, place text.
  let cropRect = null, drag = null;
  const toBase = (e) => { const r = view.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * base.width, (e.clientY - r.top) / r.height * base.height]; };
  view.addEventListener('pointerdown', async (e) => {
    if (mode === 'none') return;
    e.preventDefault(); view.setPointerCapture(e.pointerId);
    const [x, y] = toBase(e);
    if (mode === 'text') {
      const words = await dialog({ title: 'Add text', input: '', okLabel: 'Add' });
      if (!words) return;
      snapshot();
      const g = base.getContext('2d'); const size = Math.round(base.width / 18);
      g.font = `700 ${size}px -apple-system, Segoe UI, sans-serif`; g.lineWidth = Math.max(2, size / 8); g.strokeStyle = 'rgba(0,0,0,.75)'; g.fillStyle = penColor; g.textBaseline = 'middle';
      g.strokeText(words, x, y); g.fillText(words, x, y);
      redraw(); return;
    }
    if (mode === 'draw') { snapshot(); const g = base.getContext('2d'); g.strokeStyle = penColor; g.lineWidth = Math.max(3, base.width / 200); g.lineCap = g.lineJoin = 'round'; g.beginPath(); g.moveTo(x, y); }
    drag = { x, y };
  });
  view.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const [x, y] = toBase(e);
    if (mode === 'draw') { const g = base.getContext('2d'); g.lineTo(x, y); g.stroke(); redraw(); }
    if (mode === 'crop') { cropRect = { x: Math.min(drag.x, x), y: Math.min(drag.y, y), w: Math.abs(x - drag.x), h: Math.abs(y - drag.y) }; redraw(); }
  });
  view.addEventListener('pointerup', () => { drag = null; if (mode === 'crop' && cropRect?.w > 10) hint.textContent = 'Press “Apply crop”, or drag again.'; });

  const btn = (icon, label, fn, cls = 'btn btn-sm') => h('button', { class: cls, type: 'button', onclick: fn }, icon ? iconNode(icon) : null, label);
  const tool = (m, label) => btn(null, label, () => { mode = mode === m ? 'none' : m; cropRect = null; hint.textContent = { crop: 'Drag over the part to keep.', draw: 'Draw with your finger or mouse.', text: 'Tap where the text should go.', none: 'Pick a tool below.' }[mode]; drawTools(); redraw(); }, 'btn btn-sm' + (mode === m ? ' btn-primary' : ''));
  const transform = (fn) => { snapshot(); base = fn(base); cropRect = null; redraw(); };
  const rotate = (dir) => transform((c) => { const o = document.createElement('canvas'); o.width = c.height; o.height = c.width; const g = o.getContext('2d'); g.translate(o.width / 2, o.height / 2); g.rotate((dir * Math.PI) / 2); g.drawImage(c, -c.width / 2, -c.height / 2); return o; });
  const flip = () => transform((c) => { const o = document.createElement('canvas'); o.width = c.width; o.height = c.height; const g = o.getContext('2d'); g.translate(c.width, 0); g.scale(-1, 1); g.drawImage(c, 0, 0); return o; });
  const applyCrop = () => { if (!cropRect || cropRect.w < 10) return toast('Drag over the part to keep first.'); const r = cropRect; transform((c) => { const o = document.createElement('canvas'); o.width = Math.round(r.w); o.height = Math.round(r.h); o.getContext('2d').drawImage(c, r.x, r.y, r.w, r.h, 0, 0, o.width, o.height); return o; }); mode = 'none'; drawTools(); };
  const slider = (key, label) => { const i = h('input', { type: 'range', min: -100, max: 100, value: adj[key], 'aria-label': label }); let t = 0; i.addEventListener('input', () => { adj[key] = +i.value; clearTimeout(t); t = setTimeout(redraw, 30); }); return h('label', { class: 'ie-slider' }, h('span', { text: label }), i); };
  const colors = ['#ff3b3b', '#ffd60a', '#34c759', '#0a84ff', '#ffffff', '#000000'];

  const tools = h('div', { class: 'ask-tools ie-tools' });
  const drawTools = () => tools.replaceChildren(...[
    btn('refresh', 'Rotate', () => rotate(1)), btn(null, '↔ Flip', flip), tool('crop', 'Crop'), mode === 'crop' ? btn('check', 'Apply crop', applyCrop, 'btn btn-sm btn-primary') : null,
    tool('draw', 'Draw'), tool('text', 'Text'),
    mode === 'draw' || mode === 'text' ? h('span', { class: 'ie-colors' }, ...colors.map((c) => h('button', { class: 'ie-color' + (c === penColor ? ' on' : ''), type: 'button', style: { background: c }, 'aria-label': `Colour ${c}`, onclick: () => { penColor = c; drawTools(); } }))) : null,
    btn(null, 'Undo', () => { const u = undo.pop(); if (u) { base = u; redraw(); } }, 'btn btn-sm btn-ghost')].filter(Boolean));
  const filterSel = h('select', { class: 'field', 'aria-label': 'Filter' }, ...Object.entries(FILTERS).map(([k, v]) => h('option', { value: k, text: v })));
  filterSel.addEventListener('change', () => { adj.filter = filterSel.value; redraw(); });
  const sliders = h('div', { class: 'ie-sliders' }, slider('brightness', 'Brightness'), slider('contrast', 'Contrast'), slider('saturation', 'Colour'), h('label', { class: 'ie-slider' }, h('span', { text: 'Filter' }), filterSel));

  const finalCanvas = () => render(false);
  const save = async () => {
    const c = finalCanvas();
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
    const name = `JARVIS-edit-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.jpg`;
    try {
      const file = new File([blob], name, { type: 'image/jpeg' });
      if (!isNative && navigator.canShare?.({ files: [file] }) && /iPhone|iPad|Android/i.test(navigator.userAgent + (navigator.maxTouchPoints > 1 ? ' iPad' : ''))) { await navigator.share({ files: [file] }); return; }
      if (isNative) { const b64 = c.toDataURL('image/jpeg', 0.92).split(',')[1]; const r = await call('file.save', { name, base64: b64 }); if (r?.ok) toast('Picture saved'); return; }
      const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove(); toast('Picture saved to your downloads');
    } catch (e) { if (e.name !== 'AbortError') toast(e.message, { bad: true }); }
  };
  const ask = async () => { const c = finalCanvas(); close(); const look = await import('./look.js'); look.start({ source: { dataUrl: c.toDataURL('image/jpeg', 0.9) } }); };

  const layer = h('div', { class: 'ask-layer', role: 'dialog', 'aria-label': 'Picture editor' },
    h('div', { class: 'ask-top' }, h('div', { class: 'ask-title', text: 'Edit picture' }), h('div', { class: 'flex' }, btn('download', 'Save', save, 'btn btn-sm btn-primary'), btn('lasso', 'Ask about it', ask, 'btn btn-sm'), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: () => close() }, iconNode('x')))),
    hint, stage, h('div', { class: 'ask-bottom' }, tools, sliders));
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  const ro = new ResizeObserver(fit);
  const close = () => { ro.disconnect(); layer.remove(); document.removeEventListener('keydown', onKey, true); };
  document.addEventListener('keydown', onKey, true);
  document.body.append(layer);
  ro.observe(stage);
  view.style.touchAction = 'none';
  drawTools(); redraw();
  return { layer, close, adjust: (o) => { Object.assign(adj, o); redraw(); }, size: () => [base.width, base.height], rotate, flip };
}

function loadImage(url) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('That picture couldn’t be opened.')); i.src = url; }); }
function toCanvas(img, max) {
  const w = img.naturalWidth || img.width, hh = img.naturalHeight || img.height, k = Math.min(1, max / Math.max(w, hh));
  const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(hh * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}
