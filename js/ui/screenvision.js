// Screen Vision: share a screen or window with JARVIS, draw on it, and ask about it.
// - You choose what to share in the browser's (or the Mac's) own permission prompt.
// - JARVIS shows it live inside its window with a floating toolbar. Drawings (pen, circle,
//   arrow, rectangle, highlighter) live on a separate layer: the real screen and the
//   recording are never changed. Undo, eraser and clear work on that layer only.
// - Ask about the selected area (or the whole view) by typing or by voice: the current frame
//   is captured and sent to the picture AI. JARVIS only describes what was captured and
//   analysed; without a picture model it says so.
// - Optional recording (with an optional microphone track): pause, resume, stop, and save
//   it if you want. Saved recordings are encrypted when the app lock is on.
import { h, iconNode, bus, uid } from '../util.js';
import { toast, dialog } from './common.js';
import { call, can, isNative } from '../host.js';
import { read, write } from '../store.js';
import * as voice from '../voice.js';

const COLORS = ['#ff3b3b', '#ffd23f', '#2ad4ff', '#34f5b0', '#ffffff'];
let active = null;
export const isActive = () => !!active;

// ---------------------------------------------------------------- recordings history
export async function recordings() { return (await read('screen-recordings', [])) || []; }
async function saveRecording(blob, meta) {
  const media = await import('../media.js');
  const id = uid('sr');
  await media.putBlob(id, blob);
  const list = await recordings();
  list.unshift({ id, title: `Screen recording ${new Date().toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`, created: Date.now(), size: blob.size, type: blob.type, ...meta });
  await write('screen-recordings', list.slice(0, 200));
  bus.emit('screen-recordings', list);
  return id;
}
export async function removeRecording(id) {
  const media = await import('../media.js');
  await media.delBlob(id).catch(() => {});
  const list = (await recordings()).filter((r) => r.id !== id);
  await write('screen-recordings', list);
  bus.emit('screen-recordings', list);
}
export async function recordingBlob(id) { return (await import('../media.js')).getBlob(id); }

/** Can this device share its screen with JARVIS? */
export function supported() {
  if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) && !isNative) return { ok: false, why: 'Phones and tablets don’t let browsers share the screen. Take a screenshot and use Circle to Ask instead.' };
  if (navigator.mediaDevices?.getDisplayMedia || can('screenCapture')) return { ok: true };
  return { ok: false, why: 'This browser can’t share the screen. Try Chrome, Edge or Safari on a computer, or the JARVIS Mac app.' };
}

// ---------------------------------------------------------------- shapes (in picture coordinates)
export function bboxOf(s) {
  const pts = s.pts || [[s.x0, s.y0], [s.x1, s.y1]];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
/** The shape under a point (for the eraser), newest first. */
export function hit(shapes, x, y, tol) {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i], b = bboxOf(s);
    if (s.pts) { if (s.pts.some(([px, py]) => Math.hypot(px - x, py - y) <= tol + (s.width || 0))) return i; }
    else if (x >= b.x - tol && x <= b.x + b.w + tol && y >= b.y - tol && y <= b.y + b.h + tol) return i;
  }
  return -1;
}
function drawShape(g, s, k = 1, ox = 0, oy = 0) {
  const X = (x) => ox + x * k, Y = (y) => oy + y * k;
  g.save();
  g.lineJoin = 'round'; g.lineCap = 'round';
  g.strokeStyle = s.color; g.lineWidth = Math.max(1.5, (s.width || 4) * k);
  if (s.type === 'hl') { g.globalAlpha = 0.35; g.lineWidth = Math.max(8, 22 * k); }
  if (s.pts) { g.beginPath(); s.pts.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)))); g.stroke(); }
  else {
    const x0 = X(Math.min(s.x0, s.x1)), y0 = Y(Math.min(s.y0, s.y1)), w = Math.abs(s.x1 - s.x0) * k, hh = Math.abs(s.y1 - s.y0) * k;
    if (s.type === 'rect' || s.type === 'area') {
      if (s.type === 'area') { g.setLineDash([8, 6]); g.strokeStyle = '#2ad4ff'; g.lineWidth = 2; g.fillStyle = 'rgba(42,212,255,.08)'; g.fillRect(x0, y0, w, hh); }
      g.strokeRect(x0, y0, w, hh);
    }
    if (s.type === 'circle') { g.beginPath(); g.ellipse(x0 + w / 2, y0 + hh / 2, Math.max(1, w / 2), Math.max(1, hh / 2), 0, 0, Math.PI * 2); g.stroke(); }
    if (s.type === 'arrow') {
      const ax = X(s.x0), ay = Y(s.y0), bx = X(s.x1), by = Y(s.y1), a = Math.atan2(by - ay, bx - ax), L = Math.max(12, 18 * k + g.lineWidth * 2);
      g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
      g.beginPath(); g.moveTo(bx, by); g.lineTo(bx - L * Math.cos(a - 0.45), by - L * Math.sin(a - 0.45)); g.moveTo(bx, by); g.lineTo(bx - L * Math.cos(a + 0.45), by - L * Math.sin(a + 0.45)); g.stroke();
    }
  }
  g.restore();
}

// ---------------------------------------------------------------- start
export async function start() {
  if (active) return;
  const sup = supported();
  if (!sup.ok) { toast(sup.why, { bad: true, ms: 8000 }); return; }
  // Permission first, in plain words.
  const opts = await askOptions();
  if (!opts) return;
  let display = null, mode = 'live';
  try {
    if (navigator.mediaDevices?.getDisplayMedia) display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false });
  } catch (e) {
    if (/NotAllowed|Abort/i.test(e.name) && !can('screenCapture')) { toast('Screen sharing was cancelled.', { bad: true }); return; }
  }
  if (!display) {
    if (!can('screenCapture')) { toast('Screen sharing isn’t available here.', { bad: true }); return; }
    mode = 'snapshots';   // Mac app without live sharing: a fresh picture of the screen every 1.5 s
  }
  let mic = null;
  if (opts.record && opts.mic) {
    try { mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch { toast('The microphone wasn’t allowed, so the recording has no sound.', { bad: true }); }
  }
  active = build({ display, mic, mode, record: opts.record });
}

function askOptions() {
  return new Promise((resolve) => {
    const rec = h('input', { type: 'checkbox' });
    const mic = h('input', { type: 'checkbox', disabled: true });
    rec.addEventListener('change', () => { mic.disabled = !rec.checked; if (!rec.checked) mic.checked = false; });
    const layer = h('div', { class: 'sheet-layer', style: { zIndex: 85 } });
    const close = (v) => { layer.remove(); resolve(v); };
    layer.append(h('div', { class: 'wizard glass', role: 'dialog', 'aria-modal': 'true', style: { width: 'min(460px, 100%)', textAlign: 'left', padding: '22px 24px' } },
      h('h3', { style: { margin: '0 0 8px', fontWeight: 600, fontSize: '17px' }, text: 'Start Screen Vision?' }),
      h('p', { class: 'muted', style: { margin: '0 0 10px', fontSize: '13.5px', lineHeight: 1.55 }, text: isNative ? 'JARVIS shows your screen inside its window so you can draw on it and ask about it. macOS asks for Screen Recording permission the first time.' : 'Your browser will ask which screen, window or tab to share. JARVIS shows it inside this page so you can draw on it and ask about it. Your browser shows that it is sharing.' }),
      h('p', { class: 'muted small', style: { margin: '0 0 10px' }, text: 'Nothing is uploaded: questions go to the AI on your own device. Drawings never change your real screen.' }),
      h('label', { class: 'flex small' }, rec, h('span', { text: 'Also record a video (you choose whether to keep it when you stop)' })),
      h('label', { class: 'flex small', style: { marginTop: '6px' } }, mic, h('span', { text: 'Include my microphone in the recording' })),
      h('div', { class: 'flex', style: { justifyContent: 'flex-end', marginTop: '16px' } },
        h('button', { class: 'btn btn-ghost', type: 'button', text: 'Cancel', onclick: () => close(null) }),
        h('button', { class: 'btn btn-primary', type: 'button', text: 'Choose what to share', onclick: () => close({ record: rec.checked, mic: mic.checked }) }))));
    document.body.append(layer);
  });
}

// ---------------------------------------------------------------- the screen
function build({ display, mic, mode, record }) {
  const shapes = [], undone = [];
  let tool = 'pen', color = COLORS[0], drawingShape = null, selection = null, paused = false, raf = 0, snapTimer = 0;
  let frozen = null;           // the frame kept while paused
  const frameCanvas = document.createElement('canvas');   // snapshot mode: the latest screen picture
  const video = h('video', { muted: true, playsinline: true, autoplay: true });
  if (display) { video.srcObject = display; video.play().catch(() => {}); }
  const view = h('canvas', { class: 'sv-view', 'aria-label': 'Live view of the shared screen. Draw on it, or select an area to ask about.' });
  const g = view.getContext('2d');
  const answers = h('div', { class: 'sv-answers', 'aria-live': 'polite' });
  const q = h('input', { class: 'field sv-q', placeholder: 'Ask about the selected area or the whole screen…', 'aria-label': 'Question about the screen', enterkeyhint: 'send' });
  const recDot = h('span', { class: 'sv-dot' });
  const recText = h('span', { text: record ? 'REC 0:00' : 'LIVE' });
  const indicator = h('div', { class: 'sv-indicator' + (record ? ' rec' : ''), role: 'status' }, recDot, recText, h('small', { text: mode === 'snapshots' ? ' · updates every 1.5 s' : '' }));
  const srcW = () => (frozen ? frozen.width : mode === 'snapshots' ? frameCanvas.width : video.videoWidth) || 0;
  const srcH = () => (frozen ? frozen.height : mode === 'snapshots' ? frameCanvas.height : video.videoHeight) || 0;
  const source = () => (frozen || (mode === 'snapshots' ? frameCanvas : video));

  // Recording
  let recorder = null, chunks = [], recStart = 0, pausedFor = 0, pausedAt = 0, recTimer = 0;
  if (record) {
    const tracks = [];
    if (display) tracks.push(...display.getVideoTracks());
    else { const cs = frameCanvas.captureStream?.(2); if (cs) tracks.push(...cs.getVideoTracks()); }
    if (mic) tracks.push(...mic.getAudioTracks());
    try {
      const type = ['video/mp4', 'video/webm;codecs=vp9', 'video/webm', ''].find((t) => !t || MediaRecorder.isTypeSupported(t));
      recorder = new MediaRecorder(new MediaStream(tracks), type ? { mimeType: type } : undefined);
      recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      recorder.start(1000); recStart = Date.now();
      recTimer = setInterval(() => { const s = Math.round((Date.now() - recStart - pausedFor - (paused ? Date.now() - pausedAt : 0)) / 1000); recText.textContent = `${paused ? 'PAUSED' : 'REC'} ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }, 500);
    } catch (e) { recorder = null; toast('Recording isn’t possible here: ' + e.message, { bad: true }); recText.textContent = 'LIVE'; indicator.classList.remove('rec'); }
  }

  // Snapshot mode (Mac app without live sharing)
  const snap = async () => {
    if (paused) return;
    try {
      const r = await call('screen.capture', {});
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/jpeg;base64,' + r.image; });
      frameCanvas.width = img.width; frameCanvas.height = img.height;
      frameCanvas.getContext('2d').drawImage(img, 0, 0);
    } catch (e) { toast(/permission|denied|not allowed/i.test(e.message) ? 'Allow JARVIS under System Settings → Privacy & Security → Screen Recording, then try again.' : e.message, { bad: true }); stop(false); }
  };
  if (mode === 'snapshots') { snap(); snapTimer = setInterval(snap, 1500); }

  // Fit the picture in the view; shapes are kept in picture coordinates.
  const fit = () => {
    const r = view.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    if (view.width !== Math.round(r.width * dpr) || view.height !== Math.round(r.height * dpr)) { view.width = Math.round(r.width * dpr); view.height = Math.round(r.height * dpr); }
    const W = srcW(), H = srcH();
    if (!W || !H) return null;
    const k = Math.min(view.width / W, view.height / H);
    return { k, ox: (view.width - W * k) / 2, oy: (view.height - H * k) / 2, dpr };
  };
  const toPic = (e) => { const f = fit(); if (!f) return null; const r = view.getBoundingClientRect(); return [((e.clientX - r.left) * f.dpr - f.ox) / f.k, ((e.clientY - r.top) * f.dpr - f.oy) / f.k]; };
  const paint = () => {
    raf = requestAnimationFrame(paint);
    const f = fit();
    g.clearRect(0, 0, view.width, view.height);
    if (!f) { g.fillStyle = 'rgba(255,255,255,.6)'; g.font = `${14 * (devicePixelRatio || 1)}px system-ui`; g.fillText('Waiting for the screen…', 20, 40); return; }
    g.drawImage(source(), f.ox, f.oy, srcW() * f.k, srcH() * f.k);
    for (const s of shapes) drawShape(g, s, f.k, f.ox, f.oy);
    if (drawingShape) drawShape(g, drawingShape, f.k, f.ox, f.oy);
    if (selection) drawShape(g, selection, f.k, f.ox, f.oy);
  };
  paint();

  // Drawing
  view.addEventListener('pointerdown', (e) => {
    const p = toPic(e); if (!p) return;
    e.preventDefault(); view.setPointerCapture(e.pointerId);
    const W = srcW();
    if (tool === 'eraser') { const i = hit(shapes, p[0], p[1], W / 80); if (i >= 0) { undone.push({ erased: shapes.splice(i, 1)[0], at: i }); } return; }
    if (tool === 'pen' || tool === 'hl') drawingShape = { type: tool, pts: [p], color: tool === 'hl' ? '#ffd23f' : color, width: Math.max(3, W / 400) };
    else if (tool === 'area') { selection = null; drawingShape = { type: 'area', x0: p[0], y0: p[1], x1: p[0], y1: p[1] }; }
    else drawingShape = { type: tool, x0: p[0], y0: p[1], x1: p[0], y1: p[1], color, width: Math.max(3, W / 400) };
  });
  view.addEventListener('pointermove', (e) => {
    if (!drawingShape) return;
    const p = toPic(e); if (!p) return;
    if (drawingShape.pts) drawingShape.pts.push(p); else { drawingShape.x1 = p[0]; drawingShape.y1 = p[1]; }
  });
  const end = () => {
    if (!drawingShape) return;
    const s = drawingShape; drawingShape = null;
    const b = bboxOf(s);
    if (s.type === 'area') { if (b.w > 8 && b.h > 8) { selection = s; hint('Area selected. Ask a question about it.'); q.focus(); } return; }
    if (b.w < 3 && b.h < 3 && !s.pts) return;
    shapes.push(s); undone.length = 0;
  };
  view.addEventListener('pointerup', end); view.addEventListener('pointercancel', end);

  // Toolbar
  const tools = [['pen', 'pen', 'Pen'], ['hl', 'highlighter', 'Highlighter'], ['circle', 'shape-circle', 'Circle'], ['arrow', 'arrow-draw', 'Arrow'], ['rect', 'shape-rect', 'Rectangle'], ['area', 'select', 'Select an area to ask about'], ['eraser', 'eraser', 'Eraser']];
  const toolBtns = tools.map(([id, ic, label]) => h('button', { class: 'sv-tool' + (id === tool ? ' on' : ''), type: 'button', title: label, 'aria-label': label, 'aria-pressed': String(id === tool), onclick: () => { tool = id; toolBtns.forEach((b, i) => { b.classList.toggle('on', tools[i][0] === id); b.setAttribute('aria-pressed', String(tools[i][0] === id)); }); } }, iconNode(ic)));
  const colorBtns = COLORS.map((c) => h('button', { class: 'sv-color' + (c === color ? ' on' : ''), type: 'button', 'aria-label': `Colour ${c}`, style: { background: c }, onclick: (ev) => { color = c; colorBtns.forEach((b) => b.classList.toggle('on', b === ev.currentTarget)); } }));
  const undo = () => { const last = undone.length && undone[undone.length - 1].erased ? undone.pop() : null; if (last) { shapes.splice(last.at, 0, last.erased); return; } if (shapes.length) shapes.pop(); };
  const pauseBtn = h('button', { class: 'sv-tool', type: 'button', title: 'Pause', 'aria-label': 'Pause' }, iconNode('pause'));
  pauseBtn.onclick = () => {
    paused = !paused;
    if (paused) {
      const c = document.createElement('canvas'); c.width = srcW(); c.height = srcH(); c.getContext('2d').drawImage(source(), 0, 0); frozen = c; pausedAt = Date.now();
      if (recorder?.state === 'recording') recorder.pause();
    } else { frozen = null; pausedFor += Date.now() - pausedAt; if (recorder?.state === 'paused') recorder.resume(); }
    pauseBtn.replaceChildren(iconNode(paused ? 'play' : 'pause')); pauseBtn.title = paused ? 'Resume' : 'Pause'; pauseBtn.setAttribute('aria-label', pauseBtn.title);
    indicator.classList.toggle('paused', paused);
    if (!recorder) recText.textContent = paused ? 'PAUSED' : 'LIVE';
  };
  const bar = h('div', { class: 'sv-toolbar glass', role: 'toolbar', 'aria-label': 'Screen Vision tools' },
    h('span', { class: 'sv-grip', title: 'Drag to move', 'aria-hidden': 'true' }, '⋮⋮'),
    ...toolBtns, h('span', { class: 'sv-sep' }), ...colorBtns, h('span', { class: 'sv-sep' }),
    h('button', { class: 'sv-tool', type: 'button', title: 'Undo', 'aria-label': 'Undo', onclick: undo }, iconNode('undo')),
    h('button', { class: 'sv-tool', type: 'button', title: 'Clear drawings', 'aria-label': 'Clear drawings', onclick: () => { shapes.length = 0; selection = null; undone.length = 0; } }, iconNode('trash')),
    h('button', { class: 'sv-tool', type: 'button', title: 'Save an annotated screenshot', 'aria-label': 'Save an annotated screenshot', onclick: () => screenshot() }, iconNode('camera')),
    h('span', { class: 'sv-sep' }), pauseBtn,
    h('button', { class: 'sv-tool sv-stop', type: 'button', title: 'Stop', 'aria-label': 'Stop Screen Vision', onclick: () => stop(true) }, iconNode('stop')));
  // Drag the toolbar anywhere.
  bar.querySelector('.sv-grip').addEventListener('pointerdown', (e) => {
    e.preventDefault(); const r = bar.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
    const mv = (ev) => { bar.style.left = Math.max(4, Math.min(innerWidth - r.width - 4, ev.clientX - dx)) + 'px'; bar.style.top = Math.max(4, Math.min(innerHeight - r.height - 4, ev.clientY - dy)) + 'px'; bar.style.transform = 'none'; };
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  });

  // Asking
  const hintEl = h('div', { class: 'sv-hint', text: 'Draw on the view, or use ⬚ to select an area, then ask.' });
  const hint = (t) => { hintEl.textContent = t; };
  const quick = ['Explain this error', 'What does this button do?', 'Explain this menu', 'What’s important here?', 'Summarize what’s on screen'];
  async function ask(question, { viaVoice = false } = {}) {
    const text = String(question || '').trim() || 'What is this?';
    const W = srcW(), H = srcH();
    if (!W || !H) { hint('The screen isn’t showing yet.'); return; }
    // Capture this exact moment, then crop to the selection (or the last drawing, or everything).
    const full = document.createElement('canvas'); full.width = W; full.height = H; full.getContext('2d').drawImage(source(), 0, 0);
    const sel = selection ? bboxOf(selection) : shapes.length ? bboxOf(shapes[shapes.length - 1]) : null;
    const { cropCircled } = await import('./circle.js');
    const shot = cropCircled(full, sel ? [[sel.x, sel.y], [sel.x + sel.w, sel.y], [sel.x + sel.w, sel.y + sel.h], [sel.x, sel.y + sel.h]] : null);
    const item = h('div', { class: 'sv-answer' }, h('b', { text: text }), h('div', { class: 'muted small', text: 'Looking at the captured screen…' }));
    answers.prepend(item);
    const A = await import('../assistant.js');
    const S = await import('../sessions.js');
    const s = S.state.current || S.create();
    const before = s.messages.length;
    await A.send(text, { images: [shot], viaVoice, context: `This picture was captured from my screen just now${sel ? '; the part I selected is marked with a red box' : ''}. Answer only from what you can see in it. If text is too small or unclear, say so instead of guessing. For an error message: say what it means and how to fix it. For buttons or menus: say what they do. Be brief (2 to 5 sentences) unless I ask for more.` });
    const reply = s.messages.slice(before).filter((m) => m.role === 'assistant').pop();
    item.lastChild.replaceWith(h('div', { class: 'sv-reply', text: reply ? reply.error || reply.content || '(no answer)' : '(no answer)' }));
  }
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const t = q.value; q.value = ''; ask(t); } });
  const micBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Ask out loud', title: 'Ask out loud' }, iconNode('mic'));
  micBtn.onclick = async () => {
    if (voice.voice.listening) { voice.voice.capture = null; voice.stopListening(); micBtn.classList.remove('live'); return; }
    try { voice.voice.capture = (t) => { micBtn.classList.remove('live'); ask(t, { viaVoice: true }); }; await voice.listen('command'); micBtn.classList.add('live'); hint('Listening… ask your question.'); }
    catch (e) { voice.voice.capture = null; toast(e.message, { bad: true }); }
  };

  async function screenshot() {
    const W = srcW(), H = srcH(); if (!W) return;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const cg = c.getContext('2d'); cg.drawImage(source(), 0, 0);
    for (const s of shapes) drawShape(cg, s, 1, 0, 0);   // drawings go into the exported copy only
    const name = `Screen ${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
    const dataUrl = c.toDataURL('image/png');
    try {
      if (isNative) { const r = await call('file.save', { name, base64: dataUrl.split(',')[1] }); if (!r?.ok) throw new Error('Not saved.'); toast('Annotated screenshot saved.'); }
      else { const a = h('a', { href: dataUrl, download: name }); document.body.append(a); a.click(); a.remove(); toast('Annotated screenshot downloaded.'); }
    } catch (e) { toast(e.message, { bad: true }); }
  }

  async function stop(askToSave) {
    if (!active && !layer.isConnected) return;
    cancelAnimationFrame(raf); clearInterval(snapTimer); clearInterval(recTimer);
    let blob = null;
    if (recorder && recorder.state !== 'inactive') blob = await new Promise((res) => { recorder.onstop = () => res(new Blob(chunks, { type: recorder.mimeType || 'video/webm' })); recorder.stop(); });
    display?.getTracks().forEach((t) => t.stop()); mic?.getTracks().forEach((t) => t.stop());
    if (voice.voice.capture) { voice.voice.capture = null; if (voice.voice.listening) voice.stopListening(); }
    layer.remove(); document.removeEventListener('keydown', onKey, true);
    active = null;
    if (blob && blob.size && askToSave) {
      const secs = Math.round((Date.now() - recStart - pausedFor) / 1000);
      if (await dialog({ title: 'Keep this recording?', text: `${Math.floor(secs / 60)} min ${secs % 60} s, ${(blob.size / 1e6).toFixed(1)} MB. It’s saved in JARVIS on this device (encrypted if the app lock is on). You can watch, download or delete it under Screen recordings.`, okLabel: 'Save', cancelLabel: 'Discard' })) {
        await saveRecording(blob, { seconds: secs, sound: !!mic });
        toast('Recording saved. Find it in Settings → Screen recordings.');
      } else toast('Recording discarded.');
    }
  }
  const onKey = (e) => { if (e.key === 'Escape' && !e.target.closest?.('input')) { e.preventDefault(); stop(true); } if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); undo(); } };
  document.addEventListener('keydown', onKey, true);
  // Sharing ended from the browser's own "Stop sharing" button.
  display?.getVideoTracks()[0]?.addEventListener('ended', () => stop(true));

  const layer = h('div', { class: 'sv-layer', role: 'dialog', 'aria-label': 'Screen Vision' },
    h('div', { class: 'sv-top' }, indicator, h('div', { class: 'sv-title', text: 'Screen Vision' }), h('div', { class: 'muted small sv-note', text: 'Drawings stay on JARVIS’s view: your real screen isn’t changed.' })),
    h('div', { class: 'sv-main' }, h('div', { class: 'sv-stage' }, view), h('aside', { class: 'sv-side glass' },
      hintEl,
      h('div', { class: 'flex' }, q, micBtn, h('button', { class: 'btn btn-primary btn-sm', type: 'button', text: 'Ask', onclick: () => { const t = q.value; q.value = ''; ask(t); } })),
      h('div', { class: 'sv-quick' }, ...quick.map((t) => h('button', { class: 'suggestion next-chip', type: 'button', text: t, onclick: () => ask(t) }))),
      answers)),
    bar);
  document.body.append(layer);
  return { stop, ask, shapes, layer, state: () => ({ tool, paused, recording: !!recorder, mode, shapes: shapes.length, selection: !!selection }) };
}

/** For tests: the open Screen Vision session. */
export const current = () => active;
