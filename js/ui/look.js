// "What's this?" — circle to ask (see circle.js), plus the Mac app's quick
// "click one thing on screen" picker, which also reads the item's accessibility
// name, so many things are identified without any AI.
import { h, $, iconNode, bus } from '../util.js';
import { call, can } from '../host.js';
import * as assistant from '../assistant.js';
import * as ollama from '../ollama.js';
import { toast } from './common.js';
import { settings } from '../store.js';

const PROMPT = 'The picture is a close-up of my screen around the spot I clicked; a red circle marks the exact spot. Tell me what is at the red circle (an app, button, icon, link, text, photo or object) and briefly what it is for or what it means, in 1 to 3 sentences.';

/** Circle to ask: pick a picture (camera, photos, screen), circle the thing, ask. */
export async function start({ question = '', viaVoice = false, source = null } = {}) {
  if (settings.permissions.screen === 'off' && source === 'screen') { toast('“Look at your screen” is off in Settings → Permissions.', { bad: true }); return; }
  try {
    const q = question && !/^(what('?s| is) (this|that)|identify|look|what am i)/i.test(question) ? question : '';
    const { openAsk } = await import('./circle.js');
    const r = await openAsk({ question: q, source });
    if (!r) return;
    if (r.pick) return pickOnScreen(q, viaVoice);
    await assistant.send(r.question, { images: r.images, context: r.context, viaVoice });
  } catch (e) {
    if (/Permission denied|NotAllowed|cancel/i.test(e.message || e.name)) return;
    toast(e.message, { bad: true, ms: 6000 });
  }
}

/** Mac app: click one thing on the real screen (also reads its accessibility name). */
async function pickOnScreen(question, viaVoice) {
  bus.emit('state', 'waiting');
  toast('Click anything on your screen to identify it (Esc to cancel).', { icon: 'pointer', ms: 4000 });
  const r = await call('screen.pick', {});
  if (r) await identify(r, question, viaVoice);
}

async function identify({ image, thumb, element }, question, viaVoice) {
  const q = question && !/^(what('?s| is) (this|that)|identify|look|what am i)/i.test(question) ? question : 'What is this?';
  const el = element && (element.title || element.description || element.value) ? element : null;
  const elText = el ? `${el.title || el.description || el.value}${el.role ? ` (${el.role})` : ''}${el.app ? ` in ${el.app}` : ''}` : '';
  // No vision model? The accessibility name is often enough on its own.
  if (!ollama.visionModel()) {
    if (el) { assistant.say(q, `That’s **${elText}**.${el.help ? ` ${el.help}` : ''}\n\nFor a fuller description of pictures and anything without a name, add a free vision model in AI Models.`, { viaVoice, images: thumb ? [thumb] : [] }); return; }
  }
  const context = PROMPT + (el ? `\n\nThe computer says the item at that spot is: ${elText}${el.help ? ` — ${el.help}` : ''}.` : '');
  await assistant.send(q, { images: [{ data: image, thumb }], context, viaVoice });
}

/** Crop a region around (x, y), mark the spot with a red ring, return base64 JPEG + thumbnail. */
export function cropAround(source, x, y) {
  const sw = source.videoWidth || source.naturalWidth || source.width, sh = source.videoHeight || source.naturalHeight || source.height;
  const w = Math.min(sw, Math.round(Math.max(480, sw * 0.32))), hh = Math.min(sh, Math.round(w * 0.66));
  const sx = Math.max(0, Math.min(sw - w, x - w / 2)), sy = Math.max(0, Math.min(sh - hh, y - hh / 2));
  const out = Math.min(1, 960 / w);
  const c = document.createElement('canvas');
  c.width = Math.round(w * out); c.height = Math.round(hh * out);
  const g = c.getContext('2d');
  g.drawImage(source, sx, sy, w, hh, 0, 0, c.width, c.height);
  const px = (x - sx) * out, py = (y - sy) * out, rad = Math.max(14, c.width * 0.035);
  g.lineWidth = Math.max(3, c.width * 0.006);
  g.strokeStyle = 'rgba(255,40,40,.95)';
  g.beginPath(); g.arc(px, py, rad, 0, Math.PI * 2); g.stroke();
  const data = c.toDataURL('image/jpeg', 0.86).split(',')[1];
  return { image: data, thumb: thumbOf(c) };
}

export function thumbOf(canvas, max = 220) {
  const k = Math.min(1, max / Math.max(canvas.width, canvas.height));
  const t = document.createElement('canvas');
  t.width = Math.round(canvas.width * k); t.height = Math.round(canvas.height * k);
  t.getContext('2d').drawImage(canvas, 0, 0, t.width, t.height);
  return t.toDataURL('image/jpeg', 0.8);
}

/** Any image (File/Blob/data URL) → {data: base64 JPEG ≤1280px, thumb}. */
export async function prepareImage(src) {
  const url = typeof src === 'string' ? src : URL.createObjectURL(src);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('That image couldn’t be opened.')); i.src = url; });
    const k = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    return { data: c.toDataURL('image/jpeg', 0.86).split(',')[1], thumb: thumbOf(c) };
  } finally { if (typeof src !== 'string') URL.revokeObjectURL(url); }
}
