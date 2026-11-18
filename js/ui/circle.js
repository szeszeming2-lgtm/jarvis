// Circle to ask: take a photo, pick a picture, or grab your screen, then draw a
// circle around the thing you mean and ask about it. Only the circled part is sent
// to the AI on this device.
import { h, iconNode } from '../util.js';
import { call, can, isNative } from '../host.js';
import { toast } from './common.js';
import { thumbOf } from './look.js';

const mobile = () => /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const QUICK = ['What is this?', 'Explain this', 'Read the text', 'Translate this', 'How do I use this?', 'Solve this'];
let open = null;

/**
 * Open the screen. source: 'camera' | 'photo' | 'screen' | {dataUrl} | Blob.
 * Resolves with {question, images:[{data, thumb, tight}], context, circled} or null if cancelled.
 */
export function openAsk({ question = '', source = null } = {}) {
  if (open) open.close(null);
  return new Promise((resolve) => {
    const ui = build(question, resolve);
    open = ui;
    document.body.append(ui.layer);
    if (source) ui.useSource(source); else ui.showPicker();
  });
}

function build(question, resolve) {
  let stream = null, base = null, stroke = [], drawing = false, facing = 'environment', ro = null;
  const stopCam = () => { stream?.getTracks().forEach((t) => t.stop()); stream = null; };
  const close = (v) => { stopCam(); ro?.disconnect(); layer.remove(); document.removeEventListener('keydown', onKey, true); document.removeEventListener('paste', onPaste); if (open?.layer === layer) open = null; resolve(v); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); } };
  const onPaste = (e) => { const f = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'))?.getAsFile(); if (f) { e.preventDefault(); useSource(f); } };

  const title = h('div', { class: 'ask-title', text: 'Circle to ask' });
  const hint = h('div', { class: 'ask-hint' });
  const stage = h('div', { class: 'ask-stage' });
  const canvas = h('canvas', { class: 'ask-canvas', 'aria-label': 'Your picture. Draw a circle around what you want to ask about.' });
  const qInput = h('input', { class: 'field ask-input', type: 'text', value: question, placeholder: 'Ask about what you circled…', enterkeyhint: 'send', 'aria-label': 'Your question' });
  const askBtn = h('button', { class: 'btn btn-primary ask-go', type: 'button', 'aria-label': 'Ask' }, iconNode('send'), h('span', { text: 'Ask' }));
  const chips = h('div', { class: 'ask-chips' }, ...QUICK.map((q) => h('button', { class: 'suggestion', type: 'button', text: q, onclick: () => { qInput.value = q; submit(); } })));
  const tools = h('div', { class: 'ask-tools' });
  const bottom = h('div', { class: 'ask-bottom' }, tools, chips, h('div', { class: 'ask-row' }, qInput, askBtn));
  const layer = h('div', { class: 'ask-layer', role: 'dialog', 'aria-label': 'Circle to ask' },
    h('div', { class: 'ask-top' }, title, h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: () => close(null) }, iconNode('x'))),
    hint, stage, bottom);
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('paste', onPaste);
  qInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submit(); } });
  askBtn.addEventListener('click', () => submit());

  // ---------------------------------------------------------------- sources
  const fileInput = (capture) => {
    const i = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
    if (capture) i.setAttribute('capture', 'environment');
    i.addEventListener('change', () => { const f = i.files?.[0]; i.remove(); if (f) useSource(f); });
    document.body.append(i);
    i.click();
  };
  const canScreen = can('screenCapture') || (!mobile() && !!navigator.mediaDevices?.getDisplayMedia);
  const hasCam = !!navigator.mediaDevices?.getUserMedia;

  function showPicker() {
    stopCam(); base = null; stroke = [];
    hint.textContent = 'What do you want to ask about?';
    bottom.hidden = true;
    const big = (icon, label, sub, fn) => h('button', { class: 'ask-source', type: 'button', onclick: fn }, iconNode(icon), h('b', { text: label }), h('small', { text: sub }));
    stage.replaceChildren(h('div', { class: 'ask-sources' },
      hasCam ? big('camera', 'Camera', 'Point at something', () => useSource('camera')) : null,
      big('image', mobile() ? 'Photos' : 'A picture', mobile() ? 'Pick from your photos' : 'Choose a file, or paste one (⌘V)', () => fileInput(false)),
      canScreen ? big('display', 'My screen', isNative ? 'Circle anything on your screen' : 'Share your screen, then circle', () => useSource('screen')) : null,
      can('screenPick') ? big('pointer', 'Click on screen', 'Quick: click one thing', () => { close({ pick: true }); }) : null));
  }

  async function useSource(src) {
    try {
      if (src === 'camera') return startCamera();
      if (src === 'photo') return fileInput(mobile());
      if (src === 'screen') return grabScreen();
      const url = src instanceof Blob ? URL.createObjectURL(src) : src.dataUrl || src;
      try { await setImage(await loadImage(url)); } finally { if (src instanceof Blob) URL.revokeObjectURL(url); }
    } catch (e) {
      if (/NotAllowed|Permission|denied|AbortError/i.test(e.name + e.message)) { toast(src === 'camera' ? 'Camera access was blocked. Allow the camera for JARVIS, then try again.' : 'Screen sharing was cancelled.', { bad: true }); showPicker(); return; }
      toast(e.message, { bad: true }); showPicker();
    }
  }

  async function startCamera() {
    stopCam();
    hint.textContent = 'Point the camera at it, then take the photo.';
    bottom.hidden = true;
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    const video = h('video', { class: 'ask-video', autoplay: true, muted: true, playsinline: true });
    video.setAttribute('playsinline', '');
    video.srcObject = stream;
    await video.play().catch(() => {});
    const shutter = h('button', { class: 'ask-shutter', type: 'button', 'aria-label': 'Take photo', onclick: async () => {
      if (!video.videoWidth) return;
      const c = document.createElement('canvas');
      const k = Math.min(1, 2048 / Math.max(video.videoWidth, video.videoHeight));
      c.width = Math.round(video.videoWidth * k); c.height = Math.round(video.videoHeight * k);
      c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
      stopCam();
      await setImage(c);
    } });
    const flip = h('button', { class: 'icon-btn ask-flip', type: 'button', 'aria-label': 'Switch camera', onclick: () => { facing = facing === 'environment' ? 'user' : 'environment'; startCamera().catch((e) => toast(e.message, { bad: true })); } }, iconNode('refresh'));
    stage.replaceChildren(h('div', { class: 'ask-cam' }, video, h('div', { class: 'ask-cam-bar' }, h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Back', onclick: showPicker }), shutter, flip)));
  }

  async function grabScreen() {
    if (can('screenCapture')) {
      hint.textContent = 'Taking a picture of your screen…';
      const r = await call('screen.capture', {});
      return setImage(await loadImage('data:image/jpeg;base64,' + r.image));
    }
    const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false });
    try {
      const video = h('video', { muted: true, playsinline: true });
      video.srcObject = s;
      await video.play();
      await new Promise((r) => (video.videoWidth ? r() : video.addEventListener('loadeddata', r, { once: true })));
      await new Promise((r) => setTimeout(r, 250));
      const c = document.createElement('canvas');
      const k = Math.min(1, 2048 / Math.max(video.videoWidth, video.videoHeight));
      c.width = Math.round(video.videoWidth * k); c.height = Math.round(video.videoHeight * k);
      c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
      await setImage(c);
    } finally { s.getTracks().forEach((t) => t.stop()); }
  }

  // ---------------------------------------------------------------- editor
  async function setImage(img) {
    const w = img.naturalWidth || img.videoWidth || img.width, hgt = img.naturalHeight || img.videoHeight || img.height;
    const k = Math.min(1, 2048 / Math.max(w, hgt));
    base = document.createElement('canvas');
    base.width = Math.max(1, Math.round(w * k)); base.height = Math.max(1, Math.round(hgt * k));
    const g = base.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, base.width, base.height);
    g.drawImage(img, 0, 0, base.width, base.height);
    stroke = [];
    hint.textContent = mobile() ? 'Draw a circle around it with your finger.' : 'Draw a circle around it with your mouse.';
    stage.replaceChildren(canvas);
    tools.replaceChildren(
      h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => { stroke = []; paint(); hint.textContent = 'Draw a circle around it.'; } }, iconNode('refresh'), 'Clear circle'),
      h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: showPicker }, iconNode('image'), 'New picture'));
    bottom.hidden = false;
    fit();
    if (!mobile()) setTimeout(() => qInput.focus(), 50);
  }

  let view = { x: 0, y: 0, k: 1 };
  function fit() {
    if (!base) return;
    const r = stage.getBoundingClientRect();
    const dpr = Math.min(2, devicePixelRatio || 1);
    const k = Math.min(r.width / base.width, r.height / base.height);
    const cw = Math.max(1, Math.floor(base.width * k)), ch = Math.max(1, Math.floor(base.height * k));
    canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px';
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    view = { k: (k * dpr), dpr };
    paint();
  }
  ro = new ResizeObserver(() => fit());
  ro.observe(stage);

  function paint() {
    if (!base) return;
    const g = canvas.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.drawImage(base, 0, 0, canvas.width, canvas.height);
    if (stroke.length < 2) return;
    const k = view.k;
    const path = new Path2D();
    stroke.forEach(([x, y], i) => (i ? path.lineTo(x * k, y * k) : path.moveTo(x * k, y * k)));
    if (!drawing && stroke.length > 8) {
      // Dim everything outside the circle.
      const outside = new Path2D();
      outside.rect(0, 0, canvas.width, canvas.height);
      const closed = new Path2D(path); closed.closePath();
      outside.addPath(closed);
      g.fillStyle = 'rgba(0,0,0,.5)';
      g.fill(outside, 'evenodd');
    }
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.shadowColor = 'rgba(0,220,255,.9)'; g.shadowBlur = 12 * view.dpr;
    g.strokeStyle = '#3ee6ff'; g.lineWidth = 4 * view.dpr;
    g.stroke(path);
    g.shadowBlur = 0;
    g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 1.5 * view.dpr;
    g.stroke(path);
  }

  const toImage = (e) => { const r = canvas.getBoundingClientRect(); return [Math.max(0, Math.min(base.width, (e.clientX - r.left) / r.width * base.width)), Math.max(0, Math.min(base.height, (e.clientY - r.top) / r.height * base.height))]; };
  canvas.addEventListener('pointerdown', (e) => { if (!base) return; e.preventDefault(); canvas.setPointerCapture(e.pointerId); drawing = true; stroke = [toImage(e)]; paint(); });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const p = toImage(e), last = stroke[stroke.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) > base.width / 400) { stroke.push(p); paint(); }
  });
  const end = () => {
    if (!drawing) return;
    drawing = false;
    const b = bbox(stroke);
    if (!b || b.w < base.width * 0.02 && b.h < base.height * 0.02) {
      // A tap, not a circle: circle a small area around the tap instead.
      const [x, y] = stroke[0] || [base.width / 2, base.height / 2];
      const r = Math.max(base.width, base.height) * 0.08;
      stroke = Array.from({ length: 33 }, (_, i) => [x + r * Math.cos(i / 32 * Math.PI * 2), y + r * Math.sin(i / 32 * Math.PI * 2)]);
    }
    paint();
    hint.textContent = 'Got it. Now ask your question (or draw again).';
    if (!mobile()) qInput.focus();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  function submit() {
    if (!base) return;
    const q = qInput.value.trim() || 'What is this?';
    const circled = stroke.length > 8;
    const shot = cropCircled(base, circled ? stroke : null);
    close({ question: q, images: [shot], circled, context: circled
      ? 'The picture shows the part I circled (my circle is drawn in red). Answer about what is inside the red circle. Be specific and brief (1 to 4 sentences) unless I ask for more.'
      : 'Answer about this picture. Be specific and brief (1 to 4 sentences) unless I ask for more.' });
  }

  return { layer, close, showPicker, useSource };
}

function loadImage(url) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('That picture couldn’t be opened.')); i.src = url; });
}

export function bbox(pts) {
  if (!pts?.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Region to crop: the circle's box with padding, at least `min` pixels, inside the picture. */
export function region(W, H, b, pad, min) {
  if (!b) return { x: 0, y: 0, w: W, h: H };
  let w = Math.max(min, b.w * (1 + pad * 2)), hh = Math.max(min, b.h * (1 + pad * 2));
  w = Math.min(W, w); hh = Math.min(H, hh);
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const x = Math.max(0, Math.min(W - w, cx - w / 2)), y = Math.max(0, Math.min(H - hh, cy - hh / 2));
  return { x, y, w, h: hh };
}

/**
 * Crops for the AI: `data` has some surroundings and the circle drawn in red (for
 * bigger models); `tight` is just the circled part, unmarked (for the small on-device model).
 */
export function cropCircled(base, stroke) {
  const b = stroke ? bbox(stroke) : null;
  const make = (r, max, mark) => {
    const k = Math.min(1, max / Math.max(r.w, r.h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(r.w * k)); c.height = Math.max(1, Math.round(r.h * k));
    const g = c.getContext('2d');
    g.drawImage(base, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
    if (mark && stroke) {
      g.lineJoin = 'round'; g.lineCap = 'round';
      g.strokeStyle = 'rgba(255,40,40,.95)'; g.lineWidth = Math.max(3, c.width * 0.007);
      g.beginPath();
      stroke.forEach(([x, y], i) => { const px = (x - r.x) * k, py = (y - r.y) * k; i ? g.lineTo(px, py) : g.moveTo(px, py); });
      g.closePath(); g.stroke();
    }
    return c;
  };
  const wide = make(region(base.width, base.height, b, 0.3, Math.min(320, base.width, base.height)), 1024, true);
  const tight = make(region(base.width, base.height, b, 0.08, Math.min(160, base.width, base.height)), 768, false);
  return { data: wide.toDataURL('image/jpeg', 0.86).split(',')[1], tight: tight.toDataURL('image/jpeg', 0.88).split(',')[1], thumb: thumbOf(wide) };
}
