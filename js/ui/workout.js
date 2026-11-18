// Workout Coach: the camera watches your body (on this device only) and counts reps.
// Uses Google's free MediaPipe Pose (Apache-2.0); falls back to a tap counter.
import { h, $, iconNode, bus } from '../util.js';
import { settings } from '../store.js';
import { registerTab, openSheet, closeSheet } from './sheets.js';
import { section, toast, dialog, callout } from './common.js';
import * as workout from '../workout.js';
import { RepCounter, EXERCISES } from '../reps.js';
import * as voice from '../voice.js';

const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.0';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
let landmarker = null, loading = null;

async function getLandmarker(onStatus) {
  if (landmarker) return landmarker;
  if (loading) return loading;
  loading = (async () => {
    onStatus?.('Loading body tracking (first time only, about 20 MB)…');
    const vision = await import(/* @vite-ignore */ `${MP}/vision_bundle.mjs`);
    const files = await vision.FilesetResolver.forVisionTasks(`${MP}/wasm`);
    const make = (delegate) => vision.PoseLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'VIDEO', numPoses: 1 });
    try { landmarker = await make('GPU'); } catch { landmarker = await make('CPU'); }
    return landmarker;
  })();
  try { return await loading; } finally { loading = null; }
}

const LINKS = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]];

/** Open the coach. exercise: a key of EXERCISES (squats, pushups, lunges, plank, …). */
export async function openCoach(exercise = 'squats') {
  if (!EXERCISES[exercise]) exercise = 'squats';
  closeSheet();
  document.activeElement?.blur?.(); // close the phone keyboard
  let counter = new RepCounter(exercise);
  let stream = null, running = true, manual = false, facing = 'user', lastSpoken = 0, raf = 0, started = Date.now();
  const video = h('video', { autoplay: true, muted: true, playsinline: true, class: 'coach-video' });
  video.setAttribute('playsinline', '');
  const canvas = h('canvas', { class: 'coach-canvas' });
  const count = h('div', { class: 'coach-count', text: '0' });
  const label = h('div', { class: 'coach-label', text: EXERCISES[exercise].label });
  const status = h('div', { class: 'coach-status', text: 'Starting the camera…' });
  const chips = h('div', { class: 'coach-chips' });
  const voiceOn = { on: settings.voice.speak !== 'never' };
  const drawChips = () => chips.replaceChildren(...Object.entries(EXERCISES).map(([k, v]) => h('button', { class: 'suggestion' + (k === exercise ? ' on' : ''), type: 'button', text: v.label, onclick: () => { exercise = k; counter = new RepCounter(k); started = Date.now(); label.textContent = v.label; count.textContent = EXERCISES[k].hold ? '0:00' : '0'; drawChips(); status.textContent = v.how; } })));
  drawChips();
  const finish = async (saveIt) => {
    running = false;
    cancelAnimationFrame(raf);
    stream?.getTracks().forEach((t) => t.stop());
    layer.remove();
    document.removeEventListener('keydown', onKey, true);
    if (!saveIt) return;
    const r = counter.reps, sec = counter.holdMs ? Math.round(counter.holdMs / 1000) : 0;
    if (!r && !sec) { toast('Nothing to save yet.'); return; }
    const e = workout.add(EXERCISES[exercise].hold ? { exercise: EXERCISES[exercise].label.toLowerCase(), seconds: sec, source: manual ? 'manual' : 'camera' } : { exercise: EXERCISES[exercise].label, reps: r, seconds: Math.round((Date.now() - started) / 1000), source: manual ? 'manual' : 'camera' });
    const s = workout.summary(7);
    const { say } = await import('../assistant.js');
    say(`Track my ${EXERCISES[exercise].label.toLowerCase()}`, `Nice work! Saved **${workout.describe(e)}**.${s.streak > 1 ? ` That’s a ${s.streak}-day streak. 🔥` : ''} This week: ${s.sessions} workout${s.sessions === 1 ? '' : 's'}.`);
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); finish(false); } };
  const tap = h('button', { class: 'btn coach-tap', type: 'button', hidden: true, onclick: () => { counter.reps++; count.textContent = String(counter.reps); if (voiceOn.on) { voice.stopSpeaking(); voice.speak(String(counter.reps)); } } }, iconNode('plus'), 'Tap for each rep');
  const voiceBtn = h('button', { class: 'icon-btn on', type: 'button', title: 'Count out loud', 'aria-label': 'Count out loud', onclick: () => { voiceOn.on = !voiceOn.on; voiceBtn.classList.toggle('on', voiceOn.on); voiceBtn.replaceChildren(iconNode(voiceOn.on ? 'speaker' : 'speaker-off')); } }, iconNode(voiceOn.on ? 'speaker' : 'speaker-off'));
  const flipBtn = h('button', { class: 'icon-btn', type: 'button', title: 'Switch camera', 'aria-label': 'Switch camera', onclick: async () => { facing = facing === 'user' ? 'environment' : 'user'; await startCamera(); } }, iconNode('refresh'));
  const layer = h('div', { class: 'coach', role: 'dialog', 'aria-label': 'Workout coach' },
    h('div', { class: 'coach-top' },
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: () => finish(false) }, iconNode('x')),
      h('div', { class: 'grow', style: { textAlign: 'center', fontWeight: 600, letterSpacing: '.08em' }, text: 'WORKOUT COACH' }),
      flipBtn, voiceBtn),
    chips,
    h('div', { class: 'coach-stage' }, video, canvas, h('div', { class: 'coach-hud' }, count, label)),
    status,
    h('div', { class: 'coach-actions' },
      tap,
      h('button', { class: 'btn btn-ghost', type: 'button', text: 'Reset', onclick: () => { counter = new RepCounter(exercise); started = Date.now(); count.textContent = EXERCISES[exercise].hold ? '0:00' : '0'; } }),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => finish(true) }, iconNode('check'), 'Save workout')),
    h('div', { class: 'coach-note', text: 'The camera picture stays on this device. Nothing is recorded or uploaded.' }));
  document.body.append(layer);
  document.addEventListener('keydown', onKey, true);

  const useManual = (why) => {
    manual = true;
    tap.hidden = false;
    status.textContent = `${why} Tap the button for each rep instead.`;
  };

  async function startCamera() {
    stream?.getTracks().forEach((t) => t.stop());
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser can’t use the camera.');
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    video.srcObject = stream;
    video.classList.toggle('mirror', facing === 'user');
    canvas.classList.toggle('mirror', facing === 'user');
    await video.play().catch(() => {});
  }

  try { await startCamera(); }
  catch (e) {
    useManual(/denied|NotAllowed/i.test(e.name + e.message) ? 'Camera access was blocked (you can allow it in your browser settings).' : 'The camera isn’t available here.');
    return;
  }
  status.textContent = EXERCISES[exercise].how;
  let lm = null;
  try { lm = await getLandmarker((s) => (status.textContent = s)); }
  catch (e) { console.warn('pose', e); useManual('Body tracking couldn’t load (are you offline?).'); return; }
  if (!running) return;
  status.textContent = EXERCISES[exercise].how;

  const g = canvas.getContext('2d');
  let lastVideoTime = -1;
  const loop = () => {
    if (!running) return;
    raf = requestAnimationFrame(loop);
    if (video.readyState < 2 || video.currentTime === lastVideoTime) return;
    lastVideoTime = video.currentTime;
    const now = performance.now();
    let res;
    try { res = lm.detectForVideo(video, now); } catch { return; }
    const pts = res?.landmarks?.[0];
    const W = video.videoWidth, H = video.videoHeight;
    if (canvas.width !== W) { canvas.width = W; canvas.height = H; }
    g.clearRect(0, 0, W, H);
    if (pts) {
      g.lineWidth = Math.max(3, W / 160);
      g.strokeStyle = 'rgba(42, 212, 255, .9)';
      g.shadowColor = 'rgba(42, 212, 255, .8)'; g.shadowBlur = 8;
      for (const [a, b] of LINKS) {
        if ((pts[a].visibility ?? 1) < 0.5 || (pts[b].visibility ?? 1) < 0.5) continue;
        g.beginPath(); g.moveTo(pts[a].x * W, pts[a].y * H); g.lineTo(pts[b].x * W, pts[b].y * H); g.stroke();
      }
      g.fillStyle = '#fff';
      for (const i of [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) if ((pts[i].visibility ?? 1) > 0.5) { g.beginPath(); g.arc(pts[i].x * W, pts[i].y * H, Math.max(3, W / 140), 0, Math.PI * 2); g.fill(); }
      g.shadowBlur = 0;
    }
    const r = counter.update(pts, W / H, now);
    if (EXERCISES[exercise].hold) {
      count.textContent = `${Math.floor(r.holdSec / 60)}:${String(r.holdSec % 60).padStart(2, '0')}`;
      if (voiceOn.on && r.holdSec && r.holdSec % 10 === 0 && r.holdSec !== lastSpoken) { lastSpoken = r.holdSec; voice.speak(`${r.holdSec} seconds`); }
    } else {
      count.textContent = String(r.reps);
      if (r.counted) { count.classList.remove('pop'); void count.offsetWidth; count.classList.add('pop'); if (voiceOn.on) { voice.stopSpeaking(); voice.speak(String(r.reps)); } }
    }
    status.textContent = r.visible ? (r.tip || (EXERCISES[exercise].hold ? 'Hold it!' : r.reps ? 'Keep going!' : 'Go!')) : r.tip;
  };
  loop();
}

// ------------------------------------------------------------------ Workouts tab
registerTab('workout', (body) => {
  const hist = h('div', { class: 'list' });
  const sum = h('div');
  const draw = () => {
    const s = workout.summary(7);
    sum.replaceChildren(h('div', { class: 'stat-row' },
      stat(s.sessions, 'this week'), stat(s.activeDays, 'active days'), stat(s.streak, 'day streak'), stat(workout.all().length, 'all time')));
    const items = [...workout.all()].reverse().slice(0, 60);
    hist.replaceChildren(...items.map((e) => h('div', { class: 'item', style: { padding: '9px 12px' } },
      h('span', { class: 'item-ic' }, iconNode(e.source === 'camera' ? 'eye' : 'zap')),
      h('div', { class: 'item-main' }, h('div', { class: 'item-title', text: workout.describe(e) }), h('div', { class: 'item-sub', text: `${new Date(e.ts).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}${e.source === 'camera' ? ' · counted by camera' : ''}` })),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Delete', onclick: async () => { if (await dialog({ title: 'Delete this workout?', okLabel: 'Delete', danger: true })) workout.remove(e.id); } }, iconNode('trash')))));
    if (!items.length) hist.append(h('div', { class: 'empty', text: 'No workouts yet. Start one above, or say “log 3 sets of 10 push-ups”.' }));
  };
  const off = bus.on('workouts', draw);
  body.append(
    callout('<b>Workout Coach.</b> Your camera watches your body and counts your reps. It runs on this device only: nothing is recorded or uploaded. Prop your phone up so your whole body is in view.', { icon: 'zap' }),
    section('Start', '', h('div', { class: 'suggestions', style: { justifyContent: 'flex-start' } },
      ...Object.entries(EXERCISES).map(([k, v]) => h('button', { class: 'suggestion', type: 'button', onclick: () => openCoach(k) }, iconNode(v.icon || 'zap'), v.label)))),
    section('This week', '', sum),
    section('History', '', hist),
  );
  draw();
  return off;
});

const stat = (n, label) => h('div', { class: 'stat' }, h('b', { text: String(n) }), h('span', { text: label }));

bus.on('workout.open', (d) => openCoach(d?.exercise));
export { openSheet };
