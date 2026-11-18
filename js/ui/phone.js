// "AI on this device" panel: pick a phone-sized model, download it once, use it offline.
import { h, iconNode, bus } from '../util.js';
import { settings, set } from '../store.js';
import * as ollama from '../ollama.js';
import * as phone from '../webllm.js';
import { toast, dialog } from './common.js';

export const isMobile = () => /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent) && innerWidth < 1100);
export const isIOS = () => /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));

let busyKey = '';
let progress = { progress: 0, text: '' };
let wakeLock = null;

async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => (wakeLock = null)); }
    if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch {}
}

export async function downloadModel(key) {
  if (busyKey) return;
  busyKey = key;
  progress = { progress: 0, text: 'Starting…' };
  bus.emit('phoneai.ui');
  await keepAwake(true);
  try {
    if (!ollama.isPhone()) await ollama.switchProvider('phone');
    await phone.load(key, (p) => { progress = p; bus.emit('phoneai.ui'); });
    set('ai.model', key);
    await ollama.detect();
    toast(`${phone.info(key)?.name} is ready on this device`);
  } catch (e) {
    toast(e.message, { bad: true, ms: 8000 });
  } finally {
    busyKey = '';
    await keepAwake(false);
    bus.emit('phoneai.ui');
  }
}

/** The panel. Call .redraw() after outside changes; it also listens for progress. */
export function phonePanel({ compact = false } = {}) {
  const box = h('div', { class: 'phone-panel' });
  let sup = null, have = [];
  const draw = () => {
    box.replaceChildren();
    if (!compact) box.append(h('div', { class: 'callout' }, iconNode('cpu'), h('div', {},
      h('b', { text: 'AI on this device. ' }),
      'A small AI model downloads once (over Wi-Fi is best), then runs right here: free, private and offline. Small models are quick but simpler than big ones on a computer.')));
    if (!sup) { box.append(h('div', { class: 'muted', style: { fontSize: '13px' }, text: 'Checking this device…' })); return; }
    if (!sup.ok) { box.append(h('div', { class: 'callout warn' }, iconNode('alert'), h('div', { text: sup.reason }))); return; }
    const list = h('div', { class: 'list' });
    for (const m of phone.PHONE_MODELS) {
      const downloaded = have.includes(m.key);
      const active = ollama.isPhone() && settings.ai.model === m.key && downloaded;
      const busy = busyKey === m.key;
      list.append(h('div', { class: 'item' + (active ? ' on' : '') + (m.pick && !downloaded ? ' on' : '') },
        h('span', { class: 'item-ic' }, iconNode(m.pick ? 'sparkles' : 'layers')),
        h('div', { class: 'item-main' },
          h('div', { class: 'item-title' }, `${m.label} · ${m.name}`, active ? h('span', { class: 'pill accent', text: 'In use' }) : downloaded ? h('span', { class: 'pill ok', text: 'Downloaded' }) : null),
          h('div', { class: 'item-sub', text: `${m.note} About ${m.size >= 1 ? m.size + ' GB' : Math.round(m.size * 1000) + ' MB'}.` }),
          busy ? h('div', { class: 'progress' }, h('i', { style: { width: Math.round((progress.progress || 0) * 100) + '%' } })) : null,
          busy ? h('div', { class: 'item-sub mono', text: `${progress.text || 'Working…'} ${Math.round((progress.progress || 0) * 100)}%` }) : null),
        h('div', { class: 'item-actions' },
          busy ? null
            : downloaded ? (active ? h('button', { class: 'icon-btn', type: 'button', title: 'Delete from this device', 'aria-label': `Delete ${m.name}`, onclick: async () => {
              if (!(await dialog({ title: `Delete ${m.name}?`, text: 'Frees its storage. You can download it again later.', okLabel: 'Delete', danger: true }))) return;
              try { await ollama.remove(m.key); have = have.filter((k) => k !== m.key); draw(); } catch (e) { toast(e.message, { bad: true }); }
            } }, iconNode('trash')) : h('button', { class: 'btn btn-sm btn-primary', type: 'button', text: 'Use', onclick: async () => { if (!ollama.isPhone()) await ollama.switchProvider('phone'); set('ai.model', m.key); await ollama.detect(); draw(); toast(`Now using ${m.name}`); } }))
              : h('button', { class: 'btn btn-sm' + (m.pick ? ' btn-primary' : ''), type: 'button', disabled: !!busyKey, onclick: () => downloadModel(m.key) }, iconNode('download'), 'Download'))));
    }
    box.append(list);
    box.append(h('p', { class: 'muted', style: { fontSize: '12px', lineHeight: 1.5, marginTop: '10px' }, text: `Keep this screen open while it downloads. ${isIOS() ? 'Add JARVIS to your Home Screen first so iOS keeps the model (Share → Add to Home Screen). ' : ''}The model is saved only on this device.` }));
  };
  const refresh = async () => { sup = await phone.support(); if (sup.ok) { try { have = await phone.downloadedKeys(); } catch { have = []; } } draw(); };
  const off = bus.on('phoneai.ui', () => { if (!busyKey) refresh(); else draw(); });
  box.redraw = refresh;
  box.dispose = off;
  draw();
  refresh();
  return box;
}

/** Choice between AI on this device and Ollama on a computer (web version only). */
export function providerChoice(onChange) {
  const mobile = isMobile();
  const card = (p, ic, title, text, disabled = false) => h('button', { class: 'model-opt' + ((settings.ai.provider || 'ollama') === p ? ' on' : ''), type: 'button', disabled, style: disabled ? { opacity: 0.5 } : null, onclick: async () => { await ollama.switchProvider(p); onChange?.(p); } },
    h('b', {}, iconNode(ic), ' ', title), text);
  return h('div', { class: 'model-pick', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', marginBottom: '14px' } },
    card('phone', 'cpu', 'On this device', 'A small AI runs right here. Works offline after one download. Best for phones.'),
    mobile ? card('ollama', 'layers', 'On a computer (Ollama)', 'Only on computers: a phone can’t reach Ollama from this website. Use the JARVIS Mac app or this website on your computer for bigger models.', true)
      : card('ollama', 'layers', 'On my computer (Ollama)', 'Bigger, smarter models on a Mac or PC with Ollama. Needs that computer on.'));
}
