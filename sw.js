// Offline support for the web version: the interface is cached so JARVIS opens
// without internet. Requests to Ollama (another origin) are never touched.
const VERSION = 'jarvis-c6c64a8a05';
const CORE = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/main.js', 'js/util.js', 'js/icons.js', 'js/host.js', 'js/store.js', 'js/ollama.js', 'js/markdown.js', 'js/calc.js',
  'js/tools.js', 'js/memory.js', 'js/sessions.js', 'js/intents.js', 'js/skills.js', 'js/assistant.js', 'js/voice.js', 'js/visualizer.js',
  'js/ui/common.js', 'js/ui/chat.js', 'js/ui/sheets.js', 'js/ui/settings.js', 'js/ui/theme.js', 'js/ui/models.js', 'js/ui/memory-skills.js',
  'js/ui/panels.js', 'js/ui/wizard.js', 'js/ui/connect.js', 'js/ui/look.js', 'js/when.js', 'js/reminders.js',
  'js/webllm.js', 'js/lists.js', 'js/people.js', 'js/weather.js', 'js/ui/phone.js', 'js/ui/lists.js', 'js/ui/share.js',
  'js/reps.js', 'js/workout.js', 'js/converter.js', 'js/plugins.js', 'js/ui/workout.js', 'js/ui/plugins.js', 'js/ui/call.js',
  'js/messaging.js', 'js/briefing.js', 'js/vision.js', 'js/sync.js', 'js/ui/circle.js', 'js/ui/sync.js',
  'js/missions.js', 'js/ui/missions.js',
  'js/links.js', 'js/livesync.js', 'js/ui/links.js',
  'js/news.js', 'js/lock.js', 'js/notify.js', 'js/creator.js', 'js/pptx.js', 'js/emergency.js', 'js/semantic.js', 'js/languages.js', 'js/ui/command.js', 'js/ui/translate.js', 'js/ui/voicefull.js', 'js/suggest.js',
  'js/automations.js', 'js/documents.js', 'js/features.js', 'js/graph.js', 'js/media.js', 'js/modes.js', 'js/planner.js', 'js/projects.js', 'js/research.js', 'js/search.js', 'js/study.js', 'js/ui/imageedit.js', 'js/ui/planner.js', 'js/ui/projects.js', 'js/ui/search.js',
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
const savedPages = new Set();   // pages opened from the saved copy (offline): all their files come from it too
const LIB = 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.87/lib/index.js';
self.addEventListener('fetch', (e) => {
  const req = e.request;
  // The on-device AI engine library (pinned version): keep a copy so it works offline.
  if (req.method === 'GET' && req.url === LIB) {
    e.respondWith(caches.open('jarvis-lib-0.2.87').then(async (c) => (await c.match(LIB)) || fetch(req).then((res) => { if (res.ok) c.put(LIB, res.clone()); return res; })));
    return;
  }
  // Workout Coach body tracking (pinned engine + model): keep a copy for offline workouts.
  if (req.method === 'GET' && (req.url.startsWith('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.0/') || req.url.startsWith('https://storage.googleapis.com/mediapipe-models/pose_landmarker/'))) {
    e.respondWith(caches.open('jarvis-lib-mediapipe-1.2.0').then(async (c) => (await c.match(req.url)) || fetch(req).then((res) => { if (res.ok) c.put(req.url, res.clone()); return res; })));
    return;
  }
  // Picture AI engine (pinned transformers.js + its WASM runtime): keep a copy for offline use.
  // The model files themselves are kept by transformers.js in its own "transformers-cache".
  if (req.method === 'GET' && (req.url.startsWith('https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/') || req.url.startsWith('https://cdn.jsdelivr.net/npm/onnxruntime-web@') || req.url.startsWith('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/') || req.url.startsWith('https://cdn.jsdelivr.net/npm/peerjs@1.5.5/'))) {
    e.respondWith(caches.open('jarvis-lib-transformers-4.3.2').then(async (c) => (await c.match(req.url)) || fetch(req).then((res) => { if (res.ok) c.put(req.url, res.clone()); return res; })));
    return;
  }
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // Ask the server whether a file changed (GitHub caches files for 10 minutes otherwise).
  // Opening the app: if the network doesn't answer within 3 seconds (no signal, weak signal),
  // open the saved copy instead, and then load every file of that page from the saved copy too,
  // so old and new files are never mixed.
  const saved = async () => (await caches.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? (await caches.match('index.html')) || (await caches.match('./')) : null);
  const fromNet = () => fetch(req, { cache: 'no-cache' }).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
    return res;
  });
  if (req.mode === 'navigate') {
    e.respondWith(new Promise((resolve) => {
      let done = false;
      const finish = (r, offline) => { if (done || !r) return false; done = true; if (offline && e.resultingClientId) savedPages.add(e.resultingClientId); resolve(r); return true; };
      const timer = setTimeout(async () => finish(await saved(), true), 3000);
      fromNet().then((res) => { clearTimeout(timer); finish(res, false); })
        .catch(async () => { clearTimeout(timer); if (!finish(await saved(), true)) finish(Response.error(), false); });
    }));
    return;
  }
  if (savedPages.has(e.clientId)) { e.respondWith(saved().then((r) => r || fromNet())); return; }
  e.respondWith(fromNet().catch(async () => (await saved()) || Response.error()));
});
