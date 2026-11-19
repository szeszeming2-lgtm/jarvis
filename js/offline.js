// Use JARVIS offline (phones and browsers): check what is saved on this device and save
// whatever is missing, so JARVIS opens, chats, keeps lists and reminders, and even hears you
// with no internet.
// - JARVIS itself: its files, kept by the offline helper (sw.js).
// - The AI: the engine and the chosen model, downloaded once.
// - Voice typing: Whisper speech-to-text (80 MB) for phones, whose browsers otherwise need
//   the internet to understand speech. Spoken replies use the phone's own voices.
// - Keeping it: the browser is asked to keep JARVIS's data (persistent storage).
// On iPhone, Safari and the Home Screen app keep separate copies: get ready in the one you use.
import { settings } from './store.js';
import { isNative } from './host.js';

const swAsk = async (msg, ms = 60000) => {
  const reg = await navigator.serviceWorker?.getRegistration?.();
  const sw = navigator.serviceWorker?.controller || reg?.active;
  if (!sw) return null;
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    const t = setTimeout(() => resolve(null), ms);
    ch.port1.onmessage = (e) => { clearTimeout(t); resolve(e.data); };
    sw.postMessage(msg, [ch.port2]);
  });
};
export const whereNow = () => {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  const standalone = !!(matchMedia?.('(display-mode: standalone)').matches || navigator.standalone);
  return { ios, standalone, mobile: ios || /Android/i.test(navigator.userAgent) };
};

/** What is ready for offline use. Each part: { ok, detail, sizeMB?, fix? } */
export async function readiness() {
  const out = {};
  if (isNative) {
    const o = await import('./ollama.js');
    out.app = { ok: true, detail: 'The Mac app has everything built in.' };
    out.ai = { ok: o.engine.status === 'online' && !!settings.ai.model, detail: o.engine.status === 'online' ? (settings.ai.model ? `Ollama with ${settings.ai.model}, on this Mac.` : 'Ollama is running, but no model is installed.') : 'Ollama isn’t running.' };
    out.voiceIn = { ok: true, detail: 'macOS recognises speech on this Mac.' };
    out.voiceOut = { ok: true, detail: 'macOS voices work offline.' };
    return out;
  }
  // JARVIS's own files
  const core = await swAsk({ type: 'core' }, 5000);
  if (!core) out.app = { ok: false, detail: 'The offline helper isn’t running yet. Reload JARVIS once while online.', fix: 'app' };
  else {
    let missing = 0;
    for (const u of core.core) if (!(await caches.match(new URL(u, location.href).href, { ignoreSearch: true }))) missing++;
    out.app = missing ? { ok: false, detail: `${missing} of ${core.core.length} files aren’t saved yet.`, fix: 'app' } : { ok: true, detail: `All ${core.core.length} files are saved.` };
  }
  // Keeping the data
  let persisted = false, usage = 0, quota = 0;
  try { persisted = await navigator.storage?.persisted?.(); const e = await navigator.storage?.estimate?.(); usage = e?.usage || 0; quota = e?.quota || 0; } catch {}
  out.keep = persisted ? { ok: true, detail: `The browser keeps JARVIS’s data (${Math.round(usage / 1e6)} MB used).` } : { ok: false, detail: `The browser may clear JARVIS’s data when space runs low${whereNow().ios && !whereNow().standalone ? ' or after weeks without use (Safari)' : ''}.`, fix: 'keep' };
  // The AI on this device
  const o = await import('./ollama.js');
  if (o.isPhone()) {
    const W = await import('./webllm.js');
    await W.support();
    const key = settings.ai.model;
    let have = false, lib = true;
    try { have = !!key && (await W.isDownloaded(key)); } catch { have = (settings.ai.phoneSaved || []).includes(key); }
    if (W.state.mode !== 'wasm') { try { lib = !!(await (await caches.open('jarvis-lib-0.2.87')).match(W.LIB_URL)); } catch { lib = false; } }
    const pick = W.models().find((m) => m.pick);
    const info = W.info(key || pick?.key);
    out.ai = have && lib ? { ok: true, detail: `${info?.name || key} is saved on this device.` }
      : { ok: false, detail: key && have ? 'The AI engine isn’t saved yet.' : `No AI model is saved yet. Recommended: ${pick?.name} (${Math.round((pick?.size || 0.5) * 1000)} MB, once).`, fix: 'ai', sizeMB: have ? 7 : Math.round((info?.size || pick?.size || 0.5) * 1000), model: have ? key : key || pick?.key };
  } else {
    out.ai = { ok: false, detail: 'This computer uses Ollama for the AI. It works offline once Ollama and a model are installed (but this web page itself needs to be saved, see above).', info: true };
  }
  // Hearing you
  const media = await import('./media.js');
  const whisper = await media.whisperDownloaded();
  out.voiceIn = whisper ? { ok: true, detail: 'Offline voice typing (Whisper) is saved: tap the microphone and talk.' } : { ok: false, detail: 'Phone browsers need the internet to understand speech. Save offline voice typing (Whisper, 80 MB) to talk to JARVIS with no internet. Typing always works.', fix: 'voice', sizeMB: media.WHISPER_MB };
  // Speaking
  const voices = 'speechSynthesis' in window ? speechSynthesis.getVoices() : [];
  out.voiceOut = 'speechSynthesis' in window ? { ok: true, detail: voices.some((v) => v.localService) || !voices.length ? 'Spoken replies use this device’s own voices.' : 'Spoken replies may need the internet with these voices.' } : { ok: false, detail: 'This browser can’t speak.', info: true };
  return out;
}

/** Save what is missing. parts: which fixes to do ('app', 'keep', 'ai', 'voice'). */
export async function prepare(parts, onStep = () => {}) {
  const done = [];
  if (parts.includes('app')) {
    onStep({ text: 'Saving JARVIS’s files…' });
    const r = await swAsk({ type: 'precache' });
    if (!r?.ok) throw new Error(r?.error ? `Couldn’t save JARVIS’s files: ${r.error}` : 'The offline helper isn’t running. Reload JARVIS once while online, then try again.');
    done.push(`${r.count} files saved`);
  }
  if (parts.includes('keep')) {
    onStep({ text: 'Asking the browser to keep JARVIS’s data…' });
    let ok = false; try { ok = await navigator.storage?.persist?.(); } catch {}
    done.push(ok ? 'data kept' : 'the browser decides when to keep data (add JARVIS to your Home Screen to help)');
  }
  if (parts.includes('ai')) {
    const r = await readiness();
    const W = await import('./webllm.js');
    const key = r.ai?.model;
    if (key) {
      onStep({ text: 'Downloading the AI…', progress: 0 });
      await W.load(key, (p) => onStep({ text: p.text || 'Downloading the AI…', progress: p.progress }));
      const { set } = await import('./store.js');
      set('ai.model', key);
      done.push('AI saved');
    }
  }
  if (parts.includes('voice')) {
    onStep({ text: 'Downloading offline voice typing…', progress: 0 });
    const media = await import('./media.js');
    await media.loadWhisper((p) => onStep({ text: p.text, progress: p.progress }));
    done.push('voice typing saved');
  }
  return done;
}
