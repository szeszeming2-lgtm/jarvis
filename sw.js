// Offline support for the web version: the interface is cached so JARVIS opens
// without internet. Requests to Ollama (another origin) are never touched.
const VERSION = 'jarvis-1701e9e989';
const CORE = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/main.js', 'js/util.js', 'js/icons.js', 'js/host.js', 'js/store.js', 'js/ollama.js', 'js/markdown.js', 'js/calc.js',
  'js/tools.js', 'js/memory.js', 'js/sessions.js', 'js/intents.js', 'js/skills.js', 'js/assistant.js', 'js/voice.js', 'js/visualizer.js',
  'js/ui/common.js', 'js/ui/chat.js', 'js/ui/sheets.js', 'js/ui/settings.js', 'js/ui/theme.js', 'js/ui/models.js', 'js/ui/memory-skills.js',
  'js/ui/panels.js', 'js/ui/wizard.js', 'js/ui/connect.js', 'js/ui/look.js', 'js/when.js', 'js/reminders.js',
  'js/webllm.js', 'js/lists.js', 'js/people.js', 'js/weather.js', 'js/ui/phone.js', 'js/ui/lists.js', 'js/ui/share.js',
  'assets/icon-192.png', 'assets/icon-512.png', 'assets/icon-maskable-512.png', 'assets/apple-touch-icon.png', 'assets/favicon-32.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  // Only remove old copies of JARVIS itself. Never touch the AI engine's caches ("webllm/…", "jarvis-lib-…"):
  // they hold the downloaded model, which would otherwise have to be downloaded again.
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('jarvis-') && !k.startsWith('jarvis-lib-') && k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Network first (so updates arrive right away), cache when offline.
const LIB = 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.87/lib/index.js';
self.addEventListener('fetch', (e) => {
  const req = e.request;
  // The on-device AI engine library (pinned version): keep a copy so it works offline.
  if (req.method === 'GET' && req.url === LIB) {
    e.respondWith(caches.open('jarvis-lib-0.2.87').then(async (c) => (await c.match(LIB)) || fetch(req).then((res) => { if (res.ok) c.put(LIB, res.clone()); return res; })));
    return;
  }
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))));
});
