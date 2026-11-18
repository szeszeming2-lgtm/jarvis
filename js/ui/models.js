// AI Model Manager: engine status, installed models, free downloads, performance options.
import { h, iconNode, bus, fmtBytes } from '../util.js';
import { settings, set } from '../store.js';
import { registerTab, refresh } from './sheets.js';
import { row, rows, toggle, select, seg, range, text, section, callout, toast, dialog } from './common.js';
import * as ollama from '../ollama.js';
import { call, info, isNative } from '../host.js';
import { connectPanel } from './connect.js';
import { phonePanel, providerChoice } from './phone.js';

export const downloads = new Map(); // name -> {pct, status, cancel}

registerTab('models', (body) => {
  const offs = [bus.on('engine', () => draw()), bus.on('downloads', () => drawDownloads())];
  const where = h('div'), top = h('div'), installed = h('div'), dl = h('div'), cat = h('div'), adv = h('div');
  body.append(where, top, installed, dl, cat, adv);
  let phoneBox = null;
  let ram = window.__deviceRam || 8;
  let hosted = false, panel = null;
  info().then((i) => { ram = i.ramGB || ram; hosted = !!i.hosted; draw(); });

  function draw() {
    const e = ollama.engine;
    if (!isNative) where.replaceChildren(section('Where the AI runs', 'Both are free and private. You can switch any time.', providerChoice(() => draw())));
    if (!isNative && ollama.isPhone()) {
      if (!phoneBox) phoneBox = phonePanel();
      top.replaceChildren(section('AI on this device', '', phoneBox));
      installed.replaceChildren(); dl.replaceChildren(); cat.replaceChildren();
      adv.replaceChildren(section('Behaviour', '', rows(
        row('Creativity', 'Lower = more focused and predictable. Higher = more creative.', range(settings.ai.temperature, 0, 1.2, 0.05, (v) => set('ai.temperature', v), (v) => v.toFixed(2), 'Temperature')))));
      return;
    }
    phoneBox?.dispose?.(); phoneBox = null;
    // Engine status
    if (!isNative && e.status !== 'online' && e.status !== 'checking' && e.status !== 'unknown' && (hosted || e.status === 'blocked')) {
      if (panel) panel.redraw(); else panel = connectPanel();
      top.replaceChildren(section('Connect to Ollama', '', panel));
    } else { panel = null; drawEngine(e); }
    drawRest(e);
  }

  function drawEngine(e) {
    const statusPill = { online: ['ok', `Running · Ollama ${e.version}`], offline: ['warn', 'Not running'], 'not-installed': ['bad', 'Not installed'], checking: ['', 'Checking…'], unknown: ['', 'Unknown'], blocked: ['warn', 'Running, but blocking this site'] }[e.status] || ['', e.status];
    const actions = h('div', { class: 'flex' });
    if (e.status === 'not-installed') actions.append(
      isNative ? h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: installEngine }, iconNode('download'), 'Install Ollama for me') : null,
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => call('app.openExternal', { url: 'https://ollama.com/download' }) }, iconNode('external'), 'Download page'));
    if (e.status === 'offline') actions.append(h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: startEngine }, iconNode('power'), 'Start Ollama'));
    actions.append(h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: async () => { await ollama.detect(); toast(ollama.engine.status === 'online' ? 'AI engine is running' : 'AI engine not reachable', { bad: ollama.engine.status !== 'online' }); } }, iconNode('refresh'), 'Check again'));
    top.replaceChildren(
      callout(`<b>Free, private AI on your computer.</b> JARVIS uses <b>Ollama</b>, a free open-source engine, to run AI models locally. No account or API key needed. Speed depends on your device: this one has about <b>${ram} GB</b> of memory, so models up to roughly <b>${maxSize(ram)}</b> will run comfortably.`, { icon: 'cpu' }),
      section('AI engine', '', rows(
        row('Ollama', e.status === 'not-installed' ? 'Ollama is a small free app (about 200 MB). After it is installed, JARVIS finds it automatically.' : e.status === 'offline' ? 'Installed but not running. Start it, or open the Ollama app.' : 'Connected.', h('div', { class: 'flex' }, h('span', { class: 'pill ' + statusPill[0], text: statusPill[1] }))),
        row('', '', actions),
      )));
  }

  function drawRest(e) {

    // Installed models
    const list = h('div', { class: 'list' });
    for (const m of e.models) {
      const active = settings.ai.model === m.name;
      const loaded = e.running.some((r) => r.name === m.name);
      const caps = m.capabilities || [];
      list.append(h('div', { class: 'item' + (active ? ' on' : '') },
        h('span', { class: 'item-ic' }, iconNode('layers')),
        h('div', { class: 'item-main' },
          h('div', { class: 'item-title' }, m.name,
            active ? h('span', { class: 'pill accent', text: 'In use' }) : null,
            loaded ? h('span', { class: 'pill ok', text: 'Loaded in memory' }) : null,
            caps.includes('tools') ? h('span', { class: 'pill', text: 'Abilities' }) : null,
            caps.includes('thinking') ? h('span', { class: 'pill', text: 'Reasoning' }) : null,
            caps.includes('vision') ? h('span', { class: 'pill', text: 'Sees images' }) : null),
          h('div', { class: 'item-sub', text: [fmtBytes(m.size), m.details?.parameter_size, m.details?.quantization_level, m.details?.family].filter(Boolean).join(' · ') + (m.size > ram * 1e9 * 0.6 ? ' · may be slow on this device' : '') })),
        h('div', { class: 'item-actions' },
          active ? null : h('button', { class: 'btn btn-sm btn-primary', type: 'button', text: 'Use', onclick: () => { set('ai.model', m.name); bus.emit('engine', ollama.engine); toast(`Now using ${m.name}`); ollama.warm(m.name); } }),
          loaded ? h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Unload', title: 'Free the memory this model is using', onclick: async () => { await ollama.unload(m.name); toast('Model unloaded'); } }) : null,
          h('button', { class: 'icon-btn', type: 'button', title: 'Delete model', 'aria-label': `Delete ${m.name}`, onclick: async () => {
            if (!(await dialog({ title: `Delete ${m.name}?`, text: `Frees ${fmtBytes(m.size)} of disk space. You can download it again later.`, okLabel: 'Delete', danger: true }))) return;
            try { await ollama.remove(m.name); toast('Model deleted'); } catch (err) { toast(err.message, { bad: true }); }
          } }, iconNode('trash')))));
    }
    if (!e.models.length) list.append(h('div', { class: 'empty', text: e.status === 'online' ? 'No models yet. Download a free one below — a “Light” model is a great start.' : 'Start the AI engine to see your models.' }));
    installed.replaceChildren(section('Installed models', 'Pick the model JARVIS uses. Abilities = can open apps, find files and more.', list));

    // Catalog
    const grid = h('div', { class: 'list' });
    const pick = ollama.bestCatalogPick(ram);
    for (const tier of ['Tiny', 'Light', 'Balanced', 'Power']) {
      const items = ollama.catalogFor(ram).filter((m) => m.tier === tier);
      grid.append(h('div', { class: 'session-group', style: { margin: '10px 2px 2px' }, text: `${tier} · ${{ Tiny: '4 GB+ memory', Light: '8 GB+', Balanced: '16 GB+', Power: '24–32 GB+' }[tier]}` }));
      for (const m of items) {
        const d = downloads.get(m.name);
        grid.append(h('div', { class: 'item' + (m.name === pick?.name ? ' on' : ''), style: { opacity: m.fits ? 1 : 0.55 } },
          h('span', { class: 'item-ic' }, iconNode(m.tools ? 'zap' : 'sparkles')),
          h('div', { class: 'item-main' },
            h('div', { class: 'item-title' }, m.label, h('span', { class: 'mono muted', text: m.name }), m.name === pick?.name ? h('span', { class: 'pill accent', text: 'Recommended for you' }) : null, m.tools ? h('span', { class: 'pill', text: 'Abilities' }) : null, m.vision ? h('span', { class: 'pill', text: 'Sees images' }) : null, !m.fits ? h('span', { class: 'pill warn', text: 'Needs more memory' }) : null),
            h('div', { class: 'item-sub', text: `${m.note} About ${m.size} GB download.` }),
            d ? h('div', { class: 'progress' }, h('i', { style: { width: (d.pct || 0) + '%' } })) : null,
            d ? h('div', { class: 'item-sub mono', text: d.status }) : null),
          h('div', { class: 'item-actions' },
            m.installed ? h('span', { class: 'pill ok', text: 'Installed' })
              : d ? h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Cancel', onclick: () => { d.cancel?.(); downloads.delete(m.name); bus.emit('downloads'); } })
                : h('button', { class: 'btn btn-sm', type: 'button', disabled: e.status !== 'online', onclick: () => download(m.name, m.size) }, iconNode('download'), 'Download'))));
      }
    }
    cat.replaceChildren(section('Free models', 'Open models from the Ollama library. Downloads happen once; after that everything works offline.', grid,
      h('div', { class: 'flex', style: { marginTop: '12px' } },
        h('span', { class: 'muted', style: { fontSize: '12.5px' }, text: 'Another model from ollama.com/library:' }),
        (() => { const i = text('', () => {}, { placeholder: 'e.g. mistral:7b', width: '200px', label: 'Model name' }); i.id = 'customModel'; return i; })(),
        h('button', { class: 'btn btn-sm', type: 'button', disabled: e.status !== 'online', text: 'Download', onclick: () => { const v = document.getElementById('customModel').value.trim(); if (/^[\w.\-/:]+$/.test(v)) download(v); else toast('Type a model name like mistral:7b', { bad: true }); } }))));

    // Advanced
    adv.replaceChildren(section('Performance and behaviour', 'Lower values use less memory, which helps older computers.', rows(
      row('Let the AI use abilities', 'Opening apps, finding files, timers… Needs a model with “Abilities”.', toggle(settings.ai.tools, (v) => set('ai.tools', v), 'Abilities')),
      row('Model for pictures', 'Used for “What’s this?” and pictures you send. Auto picks one that can see.', select(settings.ai.visionModel, [['', `Auto (${ollama.visionModel() || 'none installed'})`], ...e.models.filter((m) => (m.capabilities || []).includes('vision')).map((m) => [m.name, m.name])], (v) => set('ai.visionModel', v), 'Vision model')),
      row('Show reasoning', 'For “Reasoning” models: think step by step and show it. Slower, sometimes smarter.', toggle(settings.ai.thinking, (v) => set('ai.thinking', v), 'Reasoning')),
      row('Context length', 'How much conversation the model reads each time. Auto picks a safe size for your memory.', select(settings.ai.contextLength, [['auto', `Auto (${ollama.contextLength(ram)})`], ['2048', '2,048 (lightest)'], ['4096', '4,096'], ['8192', '8,192'], ['16384', '16,384'], ['32768', '32,768 (heavy)']], (v) => set('ai.contextLength', v), 'Context length')),
      row('Keep model loaded', 'Keeping it in memory makes the next answer instant.', select(String(settings.ai.keepAlive), [['0', 'Unload right away (saves memory)'], ['5m', '5 minutes'], ['30m', '30 minutes'], ['-1', 'Always']], (v) => set('ai.keepAlive', v), 'Keep alive')),
      row('Creativity', 'Lower = more focused and predictable. Higher = more creative.', range(settings.ai.temperature, 0, 1.2, 0.05, (v) => set('ai.temperature', v), (v) => v.toFixed(2), 'Temperature')),
      row('Engine address', 'Advanced: use Ollama on another computer in your home (for example a phone using your desktop).', text(settings.ai.url, (v) => set('ai.url', v.trim() || 'http://127.0.0.1:11434'), { width: '230px', label: 'Ollama address' })),
    )));
    drawDownloads();
  }

  function drawDownloads() {
    const active = [...downloads.entries()].filter(([n]) => !ollama.CATALOG.some((c) => c.name === n));
    dl.replaceChildren(...(active.length ? [section('Downloading', '', h('div', { class: 'list' }, ...active.map(([n, d]) => h('div', { class: 'item' },
      h('span', { class: 'item-ic' }, iconNode('download')),
      h('div', { class: 'item-main' }, h('div', { class: 'item-title', text: n }), h('div', { class: 'progress' }, h('i', { style: { width: (d.pct || 0) + '%' } })), h('div', { class: 'item-sub mono', text: d.status })),
      h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Cancel', onclick: () => { d.cancel?.(); downloads.delete(n); bus.emit('downloads'); } })))))] : []));
    // Update catalog progress bars without a full redraw
    for (const [n, d] of downloads) {
      const item = [...cat.querySelectorAll('.item')].find((x) => x.querySelector('.mono')?.textContent === n);
      const bar = item?.querySelector('.progress i');
      if (bar) { bar.style.width = (d.pct || 0) + '%'; const s = item.querySelectorAll('.item-sub.mono'); if (s.length) s[s.length - 1].textContent = d.status; }
      else if (item) draw();
    }
  }

  draw();
  return () => { offs.forEach((f) => f()); phoneBox?.dispose?.(); };
});

const maxSize = (ram) => (ram >= 32 ? '20 GB (27B models)' : ram >= 24 ? '10 GB (14B models)' : ram >= 16 ? '6–8 GB (8B models)' : ram >= 8 ? '3 GB (1–4B models)' : '1 GB (tiny models)');

export async function download(name, approxGB) {
  if (downloads.has(name)) return;
  const d = { pct: 0, status: 'Starting…' };
  downloads.set(name, d);
  bus.emit('downloads');
  const s = ollama.pull(name, (c) => {
    if (c.total && c.completed) { d.pct = Math.round((c.completed / c.total) * 100); d.status = `${c.status} · ${fmtBytes(c.completed)} of ${fmtBytes(c.total)} · ${d.pct}%`; }
    else d.status = c.status || d.status;
    bus.emit('downloads');
  });
  d.cancel = s.cancel;
  try {
    await s.promise;
    if (!downloads.has(name)) return;
    downloads.delete(name);
    await ollama.refreshModels();
    toast(`${name} is ready`);
    if (!settings.ai.model) set('ai.model', name);
  } catch (e) {
    downloads.delete(name);
    toast(`Download failed: ${e.message}`, { bad: true });
  }
  bus.emit('downloads');
  bus.emit('engine', ollama.engine);
}

async function startEngine() {
  try { await ollama.startEngine(); toast('Starting Ollama…'); } catch (e) { toast(e.message, { bad: true }); return; }
  for (let i = 0; i < 12; i++) { await new Promise((r) => setTimeout(r, 1000)); await ollama.detect(); if (ollama.engine.status === 'online') { toast('AI engine is running'); return; } }
  toast('Ollama did not start. Try opening the Ollama app yourself.', { bad: true });
}

export async function installEngine() {
  const ok = await dialog({ title: 'Install Ollama?', text: 'JARVIS will download the free Ollama app (about 200 MB) from ollama.com, put it in your Applications folder and start it. Ollama is open source (MIT licence).', okLabel: 'Download and install' });
  if (!ok) return;
  toast('Downloading Ollama… this can take a few minutes.', { icon: 'download', ms: 6000 });
  try {
    await call('ollama.install');
    toast('Ollama installed. Starting it…');
    await startEngine();
  } catch (e) {
    toast(e.message + ' — you can also use the download page.', { bad: true, ms: 7000 });
  }
  refresh();
}
