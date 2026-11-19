// Host bridge. The same core UI runs inside a native shell (macOS today; Windows,
// Linux, iOS and Android later) or in a plain browser. Every platform implements
// the methods in docs/BRIDGE.md; the browser fallbacks below keep the core usable
// (and testable) without a native shell.
import { Emitter, uid } from './util.js';

const native = window.webkit?.messageHandlers?.jarvis || null;
export const events = new Emitter();
export const isNative = !!native || !!window.__JARVIS_TEST_HOST__;

// Native shells push events with window.JarvisHost.emit(name, data).
window.JarvisHost = { emit: (name, data) => events.emit(name, data) };

export async function call(method, params = {}) {
  if (window.__JARVIS_TEST_HOST__) return window.__JARVIS_TEST_HOST__(method, params);
  if (native) {
    const raw = await native.postMessage({ method, params });
    const res = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (res && res.error) throw new Error(res.error);
    return res ? res.result : null;
  }
  const fn = browser[method];
  if (!fn) throw new Error('This feature needs the JARVIS desktop app.');
  return fn(params);
}

let cachedInfo = null;
/** Offline voice typing: record until you stop talking, then Whisper turns it into text on this device. */
async function whisperListen({ locale, mode }) {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('This browser can’t record audio.');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const type = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', ''].find((t) => !t || MediaRecorder.isTypeSupported(t));
  const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const an = ctx.createAnalyser(); an.fftSize = 1024; ctx.createMediaStreamSource(stream).connect(an);
  const buf = new Float32Array(an.fftSize);
  const started = Date.now();
  let spoke = false, quietSince = 0, done = false, send = true;
  const finish = (keep = true) => { if (done) return; done = true; send = keep; clearInterval(tick); try { rec.stop(); } catch {} };
  rec.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop()); ctx.close().catch(() => {});
    voiceState.rec = null;
    if (!send || !spoke || !chunks.length) { events.emit('listen.final', { text: '' }); events.emit('listen.end', {}); return; }
    events.emit('listen.partial', { text: 'Turning your words into text…' });
    try {
      const media = await import('./media.js');
      const r = await media.transcribe(new Blob(chunks, { type: rec.mimeType || 'audio/mp4' }), { language: String(locale || 'en').split('-')[0] });
      events.emit('listen.final', { text: (r.text || '').replace(/^\s*\[[^\]]*\]\s*$/, '').trim() });   // "[BLANK_AUDIO]" means nothing was said
    } catch (e) { events.emit('listen.error', { message: 'Voice typing failed: ' + e.message }); events.emit('listen.final', { text: '' }); }
    events.emit('listen.end', {});
  };
  const tick = setInterval(() => {
    an.getFloatTimeDomainData(buf);
    let s = 0; for (const v of buf) s += v * v;
    const level = Math.min(1, Math.sqrt(s / buf.length) * 8);
    events.emit('listen.level', { level });
    const now = Date.now();
    if (level > 0.06) { spoke = true; quietSince = 0; } else if (spoke) { quietSince ||= now; if (now - quietSince > 1300) finish(true); }
    if (now - started > 20000) finish(true);                 // at most 20 seconds
    if (!spoke && now - started > 8000) finish(false);       // nothing said
  }, 100);
  rec.start(250);
  voiceState.rec = { stop: () => finish(true) };            // tapping the mic again (or letting go) sends what was said
  events.emit('listen.started', { mode, engine: 'whisper' });
  return true;
}

export async function info() {
  if (cachedInfo) return cachedInfo;
  try { cachedInfo = await call('app.info'); } catch { cachedInfo = await browser['app.info'](); }
  return cachedInfo;
}

export const can = (cap) => !!cachedInfo?.capabilities?.[cap];

// ---------------------------------------------------------------- browser mode
const LS = 'jarvis:';
const voiceState = { rec: null, utter: null };

const browser = {
  'app.info': async () => {
    const ua = navigator.userAgent;
    const platform = /Mac/.test(ua) ? 'macos' : /Win/.test(ua) ? 'windows' : /Android/.test(ua) ? 'android' : /iPhone|iPad/.test(ua) ? 'ios' : /Linux/.test(ua) ? 'linux' : 'web';
    return {
      shell: 'browser', platform, appVersion: '1.0.0', osVersion: '', chip: '',
      ramGB: navigator.deviceMemory || null, cpuCores: navigator.hardwareConcurrency || null,
      dataDir: 'This browser (local storage)',
      hosted: !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname),
      origin: location.origin,
      capabilities: {
        voiceOut: 'speechSynthesis' in window,
        voiceIn: !!(window.SpeechRecognition || window.webkitSpeechRecognition) || (!!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined'),   // MediaRecorder: offline voice typing (Whisper)
        voiceInOffline: false, wake: false, apps: /iPhone|iPad|iPod|Android/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1), files: false, system: false,
        commands: false, hotkey: false, status: false, ollamaControl: false, documents: false, shortcuts: false,
      },
    };
  },
  'store.read': async ({ key }) => localStorage.getItem(LS + key),
  'store.write': async ({ key, value }) => { localStorage.setItem(LS + key, value); return true; },
  'store.remove': async ({ key }) => { localStorage.removeItem(LS + key); return true; },
  'store.list': async ({ prefix = '' }) => Object.keys(localStorage).filter((k) => k.startsWith(LS + prefix)).map((k) => k.slice(LS.length)),
  'store.reveal': async () => false,
  'ollama.detect': async ({ url }) => {
    try {
      const r = await fetch(url + '/api/version', { signal: AbortSignal.timeout(3000) });
      const j = await r.json();
      return { installed: true, running: true, version: j.version };
    } catch {
      // Ollama refuses websites it doesn't know (CORS). A "no-cors" request still
      // succeeds when Ollama is running, which tells "blocked" apart from "not running".
      const lna = await localNetworkPermission();
      if (lna === 'denied') return { installed: null, running: false, lnaDenied: true };
      try {
        await fetch(url + '/api/version', { mode: 'no-cors', signal: AbortSignal.timeout(3000) });
        return { installed: true, running: true, blocked: true };
      } catch { return { installed: null, running: false }; }
    }
  },
  'ollama.request': async ({ url, path, method = 'GET', body }) => {
    const r = await fetch(url + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    if (!r.ok) throw new Error(parseErr(text) || `Ollama error ${r.status}`);
    return text ? JSON.parse(text) : {};
  },
  'speech.voices': async () => {
    const list = await new Promise((res) => {
      const v = speechSynthesis.getVoices();
      if (v.length) return res(v);
      speechSynthesis.onvoiceschanged = () => res(speechSynthesis.getVoices());
      setTimeout(() => res(speechSynthesis.getVoices()), 1200);
    });
    return list.map((v) => ({ id: v.voiceURI, name: v.name, lang: v.lang, quality: v.localService ? 'default' : 'online' }));
  },
  'speech.speak': async ({ id, text, voice, lang = '', rate = 1, pitch = 1, volume = 1 }) => {
    const u = new SpeechSynthesisUtterance(text);
    const all = speechSynthesis.getVoices();
    // A language asked for (the translator): a voice that speaks it, best local one first.
    const v = lang ? all.filter((x) => x.lang.replace('_', '-').toLowerCase().startsWith(lang.toLowerCase().split('-')[0])).sort((a, b) => (b.lang.toLowerCase() === lang.toLowerCase()) - (a.lang.toLowerCase() === lang.toLowerCase()) || b.localService - a.localService)[0] : all.find((x) => x.voiceURI === voice);
    if (lang) u.lang = lang;
    if (v) u.voice = v;
    u.rate = Math.max(0.2, rate * 2); u.pitch = pitch; u.volume = volume; // rate uses the 0..1 scale (0.5 = normal)
    u.onstart = () => events.emit('speech.start', { id });
    u.onboundary = (e) => events.emit('speech.word', { id, index: e.charIndex });
    u.onend = () => events.emit('speech.end', { id });
    u.onerror = () => events.emit('speech.end', { id, cancelled: true });
    speechSynthesis.speak(u);
    return true;
  },
  'speech.stop': async () => { speechSynthesis.cancel(); return true; },
  'listen.permission': async ({ locale = 'en-US' } = {}) => {
    let mic = 'prompt';
    try { mic = (await navigator.permissions.query({ name: 'microphone' })).state; } catch {}
    return { mic: mic === 'granted' ? 'granted' : mic === 'denied' ? 'denied' : 'prompt', speech: 'n/a', onDevice: (await onDeviceSpeech(locale, false)) === 'available' };
  },
  'listen.request': async () => {
    try { const st = await navigator.mediaDevices.getUserMedia({ audio: true }); st.getTracks().forEach((t) => t.stop()); return { mic: 'granted', speech: 'n/a' }; }
    catch { return { mic: 'denied', speech: 'n/a' }; }
  },
  'listen.start': async ({ locale = 'en-US', mode = 'command', offlineOnly = true }) => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (mode === 'wake') throw new Error('The wake word needs the JARVIS desktop app.');
    // Prefer on-device recognition (newer Chrome/Edge). Never fall back to the browser's
    // online speech service unless the user turned "Offline only" off (and it's online).
    const local = SR ? (await onDeviceSpeech(locale, true)) === 'available' : false;
    if (!local && (!SR || offlineOnly || navigator.onLine === false)) {
      // Offline voice typing: Whisper on this device, if it has been saved (Settings → Use offline).
      const media = await import('./media.js');
      if (await media.whisperDownloaded()) return whisperListen({ locale, mode });
      if (!SR) throw new Error('Voice input isn’t available in this browser. Save offline voice typing in Settings → Use offline (80 MB), or type instead.');
      throw new Error(navigator.onLine === false
        ? 'With no internet this browser can’t understand speech. Save offline voice typing in Settings → Use offline (80 MB, once), or type instead.'
        : 'This browser can’t recognise speech offline. Save offline voice typing in Settings → Use offline (80 MB, once), or turn off “Offline only” in Settings → Voice to use the browser’s online speech service.');
    }
    const rec = new SR();
    voiceState.rec = rec;
    if (local) { try { rec.processLocally = true; } catch {} try { if ('mode' in rec) rec.mode = 'ondevice-only'; } catch {} }
    rec.lang = locale; rec.interimResults = true; rec.continuous = false;
    rec.onresult = (e) => {
      let txt = '';
      for (const r of e.results) txt += r[0].transcript;
      const final = e.results[e.results.length - 1].isFinal;
      events.emit(final ? 'listen.final' : 'listen.partial', { text: txt });
    };
    rec.onerror = (e) => events.emit('listen.error', { message: e.error });
    rec.onend = () => events.emit('listen.end', {});
    rec.start();
    events.emit('listen.started', { mode });
    return true;
  },
  'listen.stop': async () => { voiceState.rec?.stop(); return true; },
  'listen.finish': async () => { voiceState.rec?.stop(); return true; },
  'tool.open_url': async ({ url }) => {
    const w = window.open(url, '_blank');
    if (!w) throw new Error(`Your browser blocked the new tab. Open it here: ${url}`);
    try { w.opener = null; } catch {}
    return { ok: true, url };
  },
  'app.openExternal': async ({ url }) => { window.open(url, '_blank', 'noopener'); return true; },
  'app.setHotkeys': async () => false,
  // Open an app link (Discord, WhatsApp, FaceTime, Maps…). Web links open in a new tab.
  'app.openLink': async ({ url }) => {
    if (/^https?:/i.test(url)) { const w = window.open(url, '_blank'); if (!w) location.href = url; else try { w.opener = null; } catch {} }
    else location.href = url;
    return true;
  },
  'app.copy': async ({ text }) => { await navigator.clipboard.writeText(text); return true; },
  'clipboard.read': async () => ({ text: await navigator.clipboard.readText() }),
  'clipboard.write': async ({ text }) => { await navigator.clipboard.writeText(text); return true; },
  // Phones: open apps through their links (Safari may ask "Open in …?").
  'tool.open_app': async ({ name }) => {
    const key = String(name || '').toLowerCase().trim().replace(/^the\s+/, '').replace(/\s+app$/, '');
    const scheme = APP_LINKS[key] || APP_LINKS[key.replace(/\s+/g, '')];
    if (!scheme) return { ok: false, error: `I can’t open “${name}” from here. Try “Hey Siri, open ${name}”, or ask me to search for it.` };
    location.href = scheme;
    return { name: name.replace(/\b\w/g, (c) => c.toUpperCase()), note: 'If nothing happened, the app may not be installed.' };
  },
  'system.status': async () => {
    const ua = navigator.userAgent;
    const ios = ua.match(/OS (\d+)[_.](\d+)/), android = ua.match(/Android (\d+(?:\.\d+)?)/);
    const device = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua)) ? 'iPad' : /Android/.test(ua) ? 'Android device' : /Mac/.test(ua) ? 'Mac' : /Win/.test(ua) ? 'Windows PC' : /Linux/.test(ua) ? 'Linux computer' : 'computer';
    let storage = null, battery = null;
    try { const e = await navigator.storage.estimate(); storage = { used: e.usage, quota: e.quota }; } catch {}
    try { if (navigator.getBattery) { const b = await navigator.getBattery(); battery = { level: Math.round(b.level * 100), charging: b.charging }; } } catch {}
    const c = navigator.connection;
    return {
      web: true, device, os: ios && /iPhone|iPad|iPod/.test(ua) ? `iOS ${ios[1]}.${ios[2]}` : android ? `Android ${android[1]}` : '',
      installed: matchMedia('(display-mode: standalone)').matches || !!navigator.standalone, online: navigator.onLine, network: c?.effectiveType || '',
      screen: `${screen.width}×${screen.height}`, cores: navigator.hardwareConcurrency || null, memoryGB: navigator.deviceMemory || null,
      storage, battery, gpu: 'gpu' in navigator,
    };
  },
  'app.notify': async ({ title, body }) => {
    chime();
    if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
      try { new Notification(title, { body, icon: 'assets/icon-192.png' }); } catch {}
    }
    return true;
  },
  'app.chime': async () => { chime(); return true; },
  // Web: texts and calls open your own messages / phone app with everything filled in.
  'messages.send': async ({ to, text }) => {
    const apple = /Mac|iPhone|iPad/.test(navigator.userAgent);
    location.href = `sms:${encodeURIComponent(to)}${apple ? '&' : '?'}body=${encodeURIComponent(text)}`;
    return { drafted: true };
  },
  'phone.call': async ({ to, facetime }) => {
    location.href = facetime && /Mac|iPhone|iPad/.test(navigator.userAgent) ? `facetime:${encodeURIComponent(to)}` : `tel:${encodeURIComponent(to)}`;
    return { started: true };
  },
  'app.setLaunchAtLogin': async () => false,
  'file.save': async ({ name, content, type }) => {
    // iPhone/iPad: opening a calendar file shows "Add to Calendar" right away.
    if (type === 'text/calendar' && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)))) {
      const url = URL.createObjectURL(new Blob([content], { type: 'text/calendar' }));
      if (!window.open(url, '_blank')) location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      return { ok: true };
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type: type || 'text/plain' }));
    a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    return { ok: true };
  },
  'file.open': async ({ accept = '' } = {}) => new Promise((res) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept;
    inp.onchange = async () => {
      const f = inp.files[0];
      if (!f) return res(null);
      if (f.type.startsWith('image/')) {
        const dataUrl = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); });
        return res({ name: f.name, path: f.name, imageDataUrl: dataUrl });
      }
      // Office files and PDFs are binary: hand over the file itself (documents.js reads it).
      if (/\.(pdf|docx|xlsx|xlsm|zip)$/i.test(f.name)) return res({ name: f.name, path: f.name, file: f });
      res({ name: f.name, path: f.name, text: await f.text(), file: f });
    };
    inp.click();
  }),
};

const APP_LINKS = {
  spotify: 'spotify://', whatsapp: 'whatsapp://', youtube: 'youtube://', 'youtube music': 'youtubemusic://', instagram: 'instagram://', tiktok: 'snssdk1233://',
  snapchat: 'snapchat://', facebook: 'fb://', messenger: 'fb-messenger://', twitter: 'twitter://', x: 'twitter://', threads: 'barcelona://', telegram: 'tg://',
  discord: 'discord://', netflix: 'nflx://', 'disney+': 'disneyplus://', 'disney plus': 'disneyplus://', 'prime video': 'aiv://', roblox: 'roblox://', minecraft: 'minecraft://',
  gmail: 'googlegmail://', 'google maps': 'comgooglemaps://', chrome: 'googlechrome://', google: 'google://', uber: 'uber://', waze: 'waze://', zoom: 'zoomus://',
  teams: 'msteams://', outlook: 'ms-outlook://', duolingo: 'duolingo://', pinterest: 'pinterest://', reddit: 'reddit://', twitch: 'twitch://', notion: 'notion://',
  slack: 'slack://', amazon: 'com.amazon.mobile.shopping://', 'google photos': 'googlephotos://', 'google drive': 'googledrive://', shazam: 'shazam://',
  maps: 'maps://', 'apple maps': 'maps://', music: 'music://', 'apple music': 'music://', messages: 'sms:', imessage: 'sms:', phone: 'tel:', facetime: 'facetime://',
  mail: 'message://', email: 'message://', calendar: 'calshow://', photos: 'photos-redirect://', notes: 'mobilenotes://', reminders: 'x-apple-reminderkit://',
  'app store': 'itms-apps://', appstore: 'itms-apps://', podcasts: 'podcasts://', 'apple tv': 'videos://', tv: 'videos://', books: 'ibooks://', shortcuts: 'shortcuts://',
  weather: 'weather://', clock: 'clock-alarm://', alarm: 'clock-alarm://', news: 'applenews://', wallet: 'shoebox://', health: 'x-apple-health://', files: 'shareddocuments://',
  fitness: 'fitnessapp://', 'find my': 'findmy://', safari: 'x-web-search://', settings: 'App-prefs:', home: 'com.apple.home://', translate: 'translate://', voice: 'voicememos://', 'voice memos': 'voicememos://',
};

let audioCtx = null;
/** A short two-tone chime made with Web Audio (no sound files needed). */
function chime() {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const t = audioCtx.currentTime;
    for (const [i, f] of [[0, 880], [1, 1320]]) {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + i * 0.16);
      g.gain.exponentialRampToValueAtTime(0.18, t + i * 0.16 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.16 + 0.45);
      o.connect(g).connect(audioCtx.destination);
      o.start(t + i * 0.16); o.stop(t + i * 0.16 + 0.5);
    }
  } catch {}
}

async function localNetworkPermission() {
  for (const name of ['local-network-access', 'loopback-network', 'local-network']) {
    try { return (await navigator.permissions.query({ name })).state; } catch {}
  }
  return null;
}

/** On-device speech recognition in the browser: 'available' | 'downloadable' | 'unavailable'. */
async function onDeviceSpeech(locale, install) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return 'unavailable';
  try {
    if (SR.available) {
      let st = await SR.available({ langs: [locale], processLocally: true });
      if ((st === 'downloadable' || st === 'downloading') && install && SR.install) st = (await SR.install({ langs: [locale], processLocally: true })) ? 'available' : st;
      return st;
    }
    if (SR.availableOnDevice) {
      let st = await SR.availableOnDevice(locale);
      if ((st === 'downloadable' || st === 'downloading') && install && SR.installOnDevice) st = (await SR.installOnDevice(locale)) ? 'available' : st;
      return st;
    }
  } catch {}
  return 'unavailable';
}

function parseErr(text) { try { return JSON.parse(text).error; } catch { return text; } }

// ---------------------------------------------------------------- streaming
/**
 * Stream an Ollama endpoint (NDJSON). Calls onChunk(obj) per line.
 * Returns { promise, cancel }.
 */
export function stream(url, path, body, onChunk) {
  if (isNative) {
    const id = uid('s');
    let done, fail;
    const promise = new Promise((res, rej) => { done = res; fail = rej; });
    const offs = [
      events.on('ollama.chunk', (d) => { if (d.id === id) onChunk(d.data); }),
      events.on('ollama.done', (d) => { if (d.id === id) { offs.forEach((f) => f()); done(); } }),
      events.on('ollama.error', (d) => { if (d.id === id) { offs.forEach((f) => f()); fail(new Error(d.message || 'Stream failed')); } }),
    ];
    call('ollama.stream', { id, url, path, body }).catch((e) => { offs.forEach((f) => f()); fail(e); });
    return { promise, cancel: () => call('ollama.cancel', { id }).catch(() => {}) };
  }
  const ctl = new AbortController();
  const promise = (async () => {
    const r = await fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
    if (!r.ok) throw new Error(parseErr(await r.text()) || `Ollama error ${r.status}`);
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) onChunk(JSON.parse(line));
      }
    }
    if (buf.trim()) onChunk(JSON.parse(buf));
  })().catch((e) => { if (e.name === 'AbortError') return; throw e; });
  return { promise, cancel: () => ctl.abort() };
}
