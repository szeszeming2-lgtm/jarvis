// "Make a picture": a phone-friendly page for creating images. Two honest, free ways:
// - On this Mac: the free FLUX.2 Klein model in Ollama (private; needs ~6 GB of memory).
// - On your Mac, from your phone: the phone asks the JARVIS Mac app over the encrypted
//   link and gets the picture back (private; the Mac must be on with the model).
// Phones can't make pictures by themselves (image models need ~6 GB of memory), and the free
// online picture services now need payment or an anti-robot check, so none is used.
import { h, iconNode, uid } from '../util.js';
import { registerTab } from './sheets.js';
import { section, toast, dialog, callout } from './common.js';
import { settings, set, read, write } from '../store.js';
import { can, call, isNative } from '../host.js';

const STYLES = [['', 'No style'], ['photo, realistic, natural light', 'Photo'], ['digital illustration, clean lines', 'Illustration'], ['anime style', 'Anime'], ['3D render, soft lighting', '3D'], ['watercolor painting', 'Watercolor'], ['pixel art', 'Pixel art'], ['pencil sketch', 'Sketch'], ['flat vector logo, simple, white background', 'Logo']];
const SHAPES = [['square', 'Square', 768, 768], ['portrait', 'Portrait', 640, 960], ['landscape', 'Landscape', 960, 640]];

// ---------------------------------------------------------------- the ways to make one
export async function engines() {
  const out = [];
  if (can('imageGen')) out.push({ id: 'here', name: 'This Mac', note: 'Private. Uses Ollama’s free FLUX.2 Klein model.' });
  try {
    const C = await import('../companion.js');
    if ((await C.me()).kind === 'phone' && [...C.state.devices.values()].some((d) => d.kind === 'computer')) out.push({ id: 'mac', name: 'My Mac', note: 'Private. Your Mac makes it and sends it back over the encrypted link.' });
  } catch {}
  return out;
}

/** Make one picture. → { blob, engine }. */
export async function makePicture({ prompt, style = '', shape = 'square', engine, seed = Math.floor(Math.random() * 1e9) }) {
  const [, , w, hgt] = SHAPES.find((s) => s[0] === shape) || SHAPES[0];
  const full = [prompt.trim(), style].filter(Boolean).join(', ');
  if (!prompt.trim()) throw new Error('Describe the picture first.');
  if (engine === 'here') {
    const tools = await import('../tools.js');
    const r = await tools.execute('generate_image', { prompt: full }, { source: 'instant' });
    if (!r.ok) throw new Error(r.error || 'The picture couldn’t be made.');
    return { blob: await (await fetch(r.picture)).blob(), engine };
  }
  if (engine === 'mac') {
    const C = await import('../companion.js');
    const dataUrl = await C.requestImage(full, { width: w, height: hgt });
    return { blob: await (await fetch(dataUrl)).blob(), engine };
  }
  throw new Error('Choose how to make the picture.');
}

// ---------------------------------------------------------------- gallery (this profile)
async function gallery() { return (await read('pictures', [])) || []; }
async function keep(blob, meta) {
  const media = await import('../media.js');
  const id = uid('pic');
  await media.putBlob(id, blob);
  const list = await gallery();
  list.unshift({ id, created: Date.now(), type: blob.type, ...meta });
  await write('pictures', list.slice(0, 300));
  return id;
}
async function drop(id) { const media = await import('../media.js'); await media.delBlob(id).catch(() => {}); await write('pictures', (await gallery()).filter((p) => p.id !== id)); }
async function savePicture(blob, prompt) {
  const ext = /png/.test(blob.type) ? 'png' : 'jpg';
  const name = `${String(prompt).replace(/[^\w ]+/g, '').trim().slice(0, 40) || 'JARVIS picture'}.${ext}`;
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare?.({ files: [file] }) && /iPhone|iPad|Android/i.test(navigator.userAgent)) { try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  if (isNative) { let s = ''; const u8 = new Uint8Array(await blob.arrayBuffer()); for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); const r = await call('file.save', { name, base64: btoa(s) }); if (r?.ok) toast('Picture saved.'); return; }
  const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove(); toast('Picture downloaded.');
}

// ---------------------------------------------------------------- the page
registerTab('imagine', (body) => {
  const urls = [];
  const url = (b) => { const u = URL.createObjectURL(b); urls.push(u); return u; };
  const st = settings.imagine || {};
  let style = st.style ?? '', shape = st.shape || 'square', engine = st.engine || '';
  const prompt = h('textarea', { class: 'field im-prompt', rows: 3, placeholder: 'Describe your picture… e.g. “a cosy cabin in a snowy forest at night, warm windows”', 'aria-label': 'Describe your picture' });
  prompt.value = st.lastPrompt || '';
  const chips = (list, cur, onPick, cls) => h('div', { class: 'im-chips' }, ...list.map(([v, label]) => h('button', { class: 'suggestion next-chip ' + cls + (v === cur ? ' on' : ''), type: 'button', text: label, 'aria-pressed': String(v === cur), onclick: (e) => { onPick(v); e.currentTarget.parentNode.querySelectorAll('button').forEach((b) => { const on = b === e.currentTarget; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }); } })));
  const engineBox = h('div', { class: 'im-engines' });
  const result = h('div', { class: 'im-result' });
  const grid = h('div', { class: 'im-grid' });
  const go = h('button', { class: 'btn btn-primary im-go', type: 'button' }, iconNode('wand'), 'Make the picture');

  const drawEngines = async () => {
    const list = await engines();
    if (!list.some((e) => e.id === engine)) engine = list.find((e) => e.id === 'here' || e.id === 'mac')?.id || '';
    engineBox.replaceChildren(...list.map((e) => h('button', { class: 'im-engine' + (e.id === engine ? ' on' : ''), type: 'button', 'aria-pressed': String(e.id === engine), onclick: async () => {
      engine = e.id; set('imagine.engine', engine); drawEngines();
    } }, h('b', { text: e.name }), h('small', { text: e.note }))));
    if (!list.length) engineBox.append(h('p', { class: 'muted small', text: 'Pictures are made by the JARVIS Mac app with Ollama’s free picture model (FLUX.2 Klein, 5.7 GB; download it on the Mac in AI Models). From a phone: link it to your Mac (iPhone & Mac page) and keep the Mac app open. Phones can’t make pictures on their own: picture models need about 6 GB of memory.' }));
  };
  const drawGallery = async () => {
    const media = await import('../media.js');
    const list = await gallery();
    grid.replaceChildren(...await Promise.all(list.slice(0, 60).map(async (p) => {
      const b = await media.getBlob(p.id).catch(() => null);
      if (!b) return h('span');
      return h('button', { class: 'im-thumb', type: 'button', 'aria-label': p.prompt, title: p.prompt, onclick: () => show(b, p) }, h('img', { src: url(b), alt: p.prompt, loading: 'lazy' }));
    })));
    if (!list.length) grid.append(h('div', { class: 'empty', text: 'Your pictures appear here. They stay on this device (encrypted when the app lock is on).' }));
  };
  function show(blob, p) {
    result.replaceChildren(h('img', { class: 'im-big', src: url(blob), alt: p.prompt }),
      h('div', { class: 'muted small', text: `${p.prompt} · ${{ here: 'made on this Mac', mac: 'made on your Mac' }[p.engine] || ''}` }),
      h('div', { class: 'flex', style: { flexWrap: 'wrap' } },
        h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => savePicture(blob, p.prompt) }, iconNode('download'), /iPhone|iPad|Android/i.test(navigator.userAgent) ? 'Save / share' : 'Save'),
        h('button', { class: 'btn btn-sm', type: 'button', text: 'Use this description', onclick: () => { prompt.value = p.prompt; prompt.focus(); } }),
        p.id ? h('button', { class: 'btn btn-sm btn-ghost danger', type: 'button', text: 'Delete', onclick: async () => { if (await dialog({ title: 'Delete this picture?', okLabel: 'Delete', danger: true })) { await drop(p.id); result.replaceChildren(); drawGallery(); } } }) : null));
    result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  go.onclick = async () => {
    if (!engine) { toast('Choose how to make the picture first.', { bad: true }); return; }
    const text = prompt.value.trim();
    if (!text) { prompt.focus(); return; }
    set('imagine.lastPrompt', text); set('imagine.style', style); set('imagine.shape', shape);
    go.disabled = true;
    const started = Date.now();
    const tick = setInterval(() => { go.lastChild.textContent = `Making it… ${Math.round((Date.now() - started) / 1000)} s`; }, 500);
    result.replaceChildren(h('div', { class: 'im-wait' }, h('div', { class: 'thinking-dots' }, h('i'), h('i'), h('i')), h('div', { class: 'muted small', text: 'On a Mac this takes a minute or two.' })));
    try {
      const { blob } = await makePicture({ prompt: text, style, shape, engine });
      const meta = { prompt: text, style, shape, engine };
      const id = await keep(blob, meta);
      show(blob, { ...meta, id });
      drawGallery();
    } catch (e) { result.replaceChildren(h('div', { class: 'card glass notice-card' }, h('span', { class: 'ic' }, iconNode('alert')), h('div', { text: e.message }))); }
    clearInterval(tick); go.disabled = false; go.lastChild.textContent = 'Make the picture';
  };
  drawEngines(); drawGallery();
  body.append(
    callout('<b>Make a picture.</b> Describe it, pick a style and shape, and JARVIS makes it, privately and free, on your Mac. On a phone, the phone sends the description to your linked Mac and gets the picture back.', { icon: 'image' }),
    section('Describe it', '', prompt,
      h('div', { class: 'muted small', style: { margin: '10px 0 4px' }, text: 'Style' }), chips(STYLES, style, (v) => { style = v; }, 'im-style'),
      h('div', { class: 'muted small', style: { margin: '10px 0 4px' }, text: 'Shape' }), chips(SHAPES.map(([v, l]) => [v, l]), shape, (v) => { shape = v; }, 'im-shape'),
      h('div', { class: 'muted small', style: { margin: '10px 0 4px' }, text: 'Made by' }), engineBox,
      go, result),
    section('Your pictures', '', grid));
  return () => urls.forEach((u) => URL.revokeObjectURL(u));
});

export { SHAPES, STYLES };
