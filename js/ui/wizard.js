// First-time setup wizard: name, AI engine, model, voice, look, privacy.
import { h, $, iconNode, bus, fmtBytes } from '../util.js';
import { settings, set, saveSettingsNow } from '../store.js';
import * as ollama from '../ollama.js';
import * as voice from '../voice.js';
import { call, info, can, isNative } from '../host.js';
import { Visualizer } from '../visualizer.js';
import { toast, select, seg, toggle } from './common.js';
import { THEMES, applyAppearance } from './theme.js';
import { download, downloads, installEngine } from './models.js';
import { connectPanel } from './connect.js';

let viz = null;

export function openWizard() {
  const layer = $('#wizardLayer');
  layer.hidden = false;
  let step = 0;
  const steps = [welcome, engine, model, voiceStep, look, finish];
  const box = h('div', { class: 'wizard glass', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Set up JARVIS' });
  layer.replaceChildren(box);
  const offs = [];
  const go = (n) => {
    offs.splice(0).forEach((f) => f());
    step = Math.max(0, Math.min(steps.length - 1, n));
    viz?.destroy();
    const canvas = h('canvas');
    box.replaceChildren(
      h('div', { class: 'wiz-steps' }, ...steps.map((_, i) => h('i', { class: i <= step ? 'on' : '' }))),
      h('div', { class: 'wiz-orb' }, canvas));
    viz = new Visualizer(canvas, { small: true });
    viz.setState(step === 1 ? 'thinking' : 'idle');
    steps[step](box, { next: () => go(step + 1), back: () => go(step - 1), offs, viz });
    box.scrollTop = 0;
    box.querySelector('input, .btn-primary')?.focus();
  };
  go(0);
}

function closeWizard() {
  viz?.destroy();
  viz = null;
  $('#wizardLayer').hidden = true;
  $('#wizardLayer').replaceChildren();
  bus.emit('wizard.closed');
}

const foot = (back, nextBtn, skip) => h('div', { class: 'wiz-foot' },
  back ? h('button', { class: 'btn btn-ghost', type: 'button', text: 'Back', onclick: back }) : h('span'),
  h('div', { class: 'flex' }, skip || null, nextBtn));

function welcome(box, { next }) {
  const name = h('input', { class: 'field', placeholder: 'Your first name (optional)', value: settings.userName, style: { width: '100%' }, 'aria-label': 'Your name' });
  const aname = h('input', { class: 'field', value: settings.assistantName, style: { width: '100%' }, 'aria-label': 'Assistant name' });
  const done = () => { set('userName', name.value.trim()); set('assistantName', aname.value.trim() || 'JARVIS'); set('voice.wakeWord', (aname.value.trim() || 'jarvis').toLowerCase()); bus.emit('identity'); next(); };
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); done(); } });
  box.append(
    h('h2', {}, 'Hello. I am ', h('b', { text: settings.assistantName }), '.'),
    h('p', { class: 'lead', text: 'Your free, private AI assistant. I run entirely on this computer: no account, no subscription, no API keys, no ads. Let’s get you set up — it takes about two minutes.' }),
    h('div', { class: 'wiz-body' },
      h('div', { class: 'rows' },
        h('div', { class: 'row' }, h('div', { class: 'row-text' }, h('div', { class: 'row-label', text: 'What should I call you?' })), h('div', { class: 'row-control', style: { flex: 1, maxWidth: '260px' } }, name)),
        h('div', { class: 'row' }, h('div', { class: 'row-text' }, h('div', { class: 'row-label', text: 'Address you as' })), h('div', { class: 'row-control' }, seg(settings.honorific, [['sir', 'Sir'], ['ma\'am', 'Ma\'am'], ['name', 'My name'], ['none', 'Nothing']], (v) => set('honorific', v)))),
        h('div', { class: 'row' }, h('div', { class: 'row-text' }, h('div', { class: 'row-label', text: 'My name' }), h('div', { class: 'row-desc', text: 'Also my wake word. You can change it later.' })), h('div', { class: 'row-control', style: { flex: 1, maxWidth: '260px' } }, aname)))),
    foot(null, h('button', { class: 'btn btn-primary', type: 'button', onclick: done }, 'Continue', iconNode('chevron-right'))));
}

function engine(box, { next, back, offs, viz }) {
  const list = h('div', { class: 'check-list' });
  const actions = h('div', { class: 'flex', style: { marginTop: '12px', justifyContent: 'center' } });
  let ram = 8, hosted = false, panel = null;
  const check = (state, title, sub) => h('div', { class: 'check ' + state }, h('span', { class: 'st' }, state === 'ok' ? iconNode('check') : state === 'bad' ? iconNode('x') : null), h('div', { class: 'grow' }, title, sub ? h('small', { text: sub }) : null));
  const draw = () => {
    const e = ollama.engine;
    viz.setState(e.status === 'online' ? 'idle' : e.status === 'checking' ? 'thinking' : 'error');
    if (!isNative && e.status !== 'online' && e.status !== 'checking' && e.status !== 'unknown' && (hosted || e.status === 'blocked')) {
      if (panel) panel.redraw(); else panel = connectPanel({ compact: false });
      if (list.firstChild !== panel) list.replaceChildren(panel);
      actions.replaceChildren();
      return;
    }
    panel = null;
    list.replaceChildren(
      check(e.status === 'checking' ? 'wait' : e.status === 'not-installed' ? 'bad' : e.installed === null && e.status !== 'online' ? 'wait' : 'ok', 'Ollama, the free AI engine', e.status === 'not-installed' ? 'Not installed yet.' : e.status === 'online' ? `Version ${e.version}` : 'Installed.'),
      check(e.status === 'online' ? 'ok' : e.status === 'checking' ? 'wait' : 'bad', 'Engine running', e.status === 'online' ? 'Connected on this computer.' : 'Not running yet.'),
      check(e.models.length ? 'ok' : e.status === 'online' ? 'bad' : 'wait', 'AI model', e.models.length ? `${e.models.length} installed: ${e.models.map((m) => m.name).join(', ')}` : 'None yet — the next step helps you get a free one.'),
      check('ok', 'Your computer', `${ram} GB memory. ${ram >= 16 ? 'Great for 8B models.' : ram >= 8 ? 'Good for light 1–4B models.' : 'Best with tiny models.'}`),
    );
    actions.replaceChildren();
    if (e.status === 'not-installed') {
      if (isNative) actions.append(h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => { await installEngine(); draw(); } }, iconNode('download'), 'Install Ollama for me'));
      actions.append(h('button', { class: 'btn', type: 'button', onclick: () => call('app.openExternal', { url: 'https://ollama.com/download' }) }, iconNode('external'), 'Get it from ollama.com'));
    } else if (e.status === 'offline') {
      actions.append(h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => { try { await ollama.startEngine(); } catch (err) { toast(err.message, { bad: true }); } setTimeout(() => ollama.detect(), 2000); setTimeout(() => ollama.detect(), 5000); } }, iconNode('power'), 'Start Ollama'));
    }
    if (e.status !== 'online') actions.append(h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => ollama.detect() }, iconNode('refresh'), 'Check again'));
  };
  offs.push(bus.on('engine', draw));
  info().then((i) => { ram = i.ramGB || 8; hosted = !!i.hosted; draw(); });
  ollama.detect();
  // Keep checking while this step is open, so installing Ollama elsewhere is picked up.
  const t = setInterval(() => { if (ollama.engine.status !== 'online') ollama.detect(); }, 4000);
  offs.push(() => clearInterval(t));
  box.append(
    h('h2', {}, 'Checking the ', h('b', { text: 'AI engine' })),
    h('p', { class: 'lead', text: 'JARVIS thinks with Ollama, a free open-source app that runs AI models on your own computer. Nothing you type leaves this device.' }),
    h('div', { class: 'wiz-body' }, list, actions),
    foot(back, h('button', { class: 'btn btn-primary', type: 'button', onclick: next }, 'Continue', iconNode('chevron-right'))));
  draw();
}

function model(box, { next, back, offs }) {
  const body = h('div', { class: 'wiz-body' });
  let ram = 8;
  const draw = () => {
    const e = ollama.engine;
    body.replaceChildren();
    if (e.status !== 'online') {
      body.append(h('div', { class: 'callout warn' }, iconNode('alert'), h('div', { text: 'The AI engine isn’t running, so models can’t be listed or downloaded yet. You can finish setup now and come back in Settings → AI Models. Instant commands (open apps, timers, maths) already work.' })));
      return;
    }
    if (e.models.length) {
      body.append(h('div', { class: 'row-label', style: { marginBottom: '8px' }, text: 'Choose the model I should use:' }));
      const grid = h('div', { class: 'model-pick' });
      for (const m of e.models) {
        const b = h('button', { class: 'model-opt' + (settings.ai.model === m.name ? ' on' : ''), type: 'button', onclick: () => { set('ai.model', m.name); draw(); } },
          h('b', { text: m.name }), `${fmtBytes(m.size)} · ${m.details?.parameter_size || ''}`, h('br'), (m.capabilities || []).includes('tools') ? 'Can use abilities' : 'Chat only');
        grid.append(b);
      }
      body.append(grid);
    }
    const pick = ollama.bestCatalogPick(ram);
    const have = e.models.some((m) => m.name === pick.name);
    const d = downloads.get(pick.name);
    if (!have) {
      body.append(h('div', { class: 'callout', style: { marginTop: '14px' } }, iconNode('download'),
        h('div', { class: 'grow' },
          h('b', { text: `${e.models.length ? 'Optional: ' : ''}Recommended for your ${ram} GB computer: ${pick.label}` }), h('br'),
          `${pick.note} Free download of about ${pick.size} GB.`,
          d ? h('div', { class: 'progress' }, h('i', { style: { width: d.pct + '%' } })) : null,
          d ? h('div', { class: 'mono', style: { fontSize: '11.5px', marginTop: '4px' }, text: d.status }) : null,
          !d ? h('div', { style: { marginTop: '10px' } }, h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => download(pick.name, pick.size) }, iconNode('download'), `Download ${pick.label}`)) : null)));
    }
    body.append(h('p', { class: 'muted', style: { fontSize: '12.5px', lineHeight: 1.55, marginTop: '14px' }, text: 'Speed depends on your device. Smaller models answer faster; bigger ones are smarter. You can download others (all free) any time in Settings → AI Models.' }));
  };
  offs.push(bus.on('engine', draw), bus.on('downloads', draw));
  info().then((i) => { ram = i.ramGB || 8; draw(); });
  box.append(h('h2', {}, 'Pick a ', h('b', { text: 'brain' })), h('p', { class: 'lead', text: 'Models are the “brains” JARVIS can use. They are free and open, and once downloaded they work offline.' }), body,
    foot(back, h('button', { class: 'btn btn-primary', type: 'button', onclick: next }, 'Continue', iconNode('chevron-right'))));
  draw();
}

function voiceStep(box, { next, back }) {
  const body = h('div', { class: 'wiz-body' });
  box.append(h('h2', {}, 'Your ', h('b', { text: 'voice' })), h('p', { class: 'lead', text: 'Talk to JARVIS and hear it answer. Speech recognition and voices run on this device — nothing is recorded or uploaded.' }), body,
    foot(back, h('button', { class: 'btn btn-primary', type: 'button', onclick: next }, 'Continue', iconNode('chevron-right'))));
  (async () => {
    const list = await voice.voices();
    if (!settings.voice.voice) set('voice.voice', voice.defaultVoice(list));
    const en = list.filter((v) => /^en/i.test(v.lang));
    const pick = select(settings.voice.voice, (en.length ? en : list).map((v) => [v.id, `${v.name} (${v.lang})${v.quality && v.quality !== 'default' ? ' · ' + v.quality : ''}`]), (v) => set('voice.voice', v), 'Voice');
    const micState = h('span', { class: 'pill', text: '…' });
    const refreshMic = async () => { try { const p = await call('listen.permission', { locale: settings.voice.locale }); micState.textContent = p.mic === 'granted' ? 'Microphone allowed' : p.mic === 'denied' ? 'Microphone blocked' : 'Not asked yet'; micState.className = 'pill ' + (p.mic === 'granted' ? 'ok' : p.mic === 'denied' ? 'bad' : 'warn'); } catch { micState.textContent = 'Unavailable'; } };
    refreshMic();
    body.append(h('div', { class: 'rows' },
      h('div', { class: 'row' }, h('div', { class: 'row-text' }, h('div', { class: 'row-label', text: 'Voice' }), h('div', { class: 'row-desc', text: `${list.length} voices on this computer.` })), h('div', { class: 'row-control flex' }, pick, h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { voice.stopSpeaking(); voice.speak(`Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}${settings.userName ? ', ' + settings.userName : ''}. All systems are online.`); } }, iconNode('play'), 'Test'))),
      h('div', { class: 'row' }, h('div', { class: 'row-text' }, h('div', { class: 'row-label', text: 'Speak replies' })), h('div', { class: 'row-control' }, seg(settings.voice.speak, [['voice', 'When I talk'], ['always', 'Always'], ['never', 'Never']], (v) => set('voice.speak', v)))),
      can('voiceIn') ? h('div', { class: 'row' }, h('div', { class: 'row-text' }, h('div', { class: 'row-label', text: 'Microphone' }), h('div', { class: 'row-desc', text: 'Your computer will ask once. You can change it in System Settings → Privacy & Security.' })), h('div', { class: 'row-control flex' }, micState, h('button', { class: 'btn btn-sm', type: 'button', text: 'Allow microphone', onclick: async () => { try { await call('listen.request'); } catch (e) { toast(e.message, { bad: true }); } refreshMic(); } }))) : null,
      can('wake') ? h('div', { class: 'row' }, h('div', { class: 'row-text' }, h('div', { class: 'row-label', text: `Wake word “${settings.voice.wakeWord}”` }), h('div', { class: 'row-desc', text: 'Optional. Say it to start talking while JARVIS is open. Off by default.' })), h('div', { class: 'row-control' }, toggle(settings.voice.wake, (v) => set('voice.wake', v), 'Wake word'))) : null));
  })();
}

function look(box, { next, back }) {
  const grid = h('div', { class: 'theme-grid' });
  const draw = () => {
    grid.replaceChildren(...THEMES.map((t) => {
      const c = h('button', { class: 'theme-card' + (settings.appearance.theme === t.id ? ' on' : ''), type: 'button', onclick: () => { set('appearance.theme', t.id); set('appearance.accent', ''); applyAppearance(); viz?.readColors(); draw(); } },
        h('div', { class: 'theme-swatch', style: { background: `radial-gradient(circle at 50% 50%, ${t.b}44, ${t.bg} 70%)` } }), h('div', { style: { fontWeight: 600, color: 'var(--text)' }, text: t.name }));
      c.querySelector('.theme-swatch').style.setProperty('--sw-a', t.a);
      return c;
    }));
  };
  draw();
  box.append(h('h2', {}, 'Choose a ', h('b', { text: 'look' })), h('p', { class: 'lead', text: 'You can fine-tune colors, animation and the visualizer later in Settings → Appearance.' }), h('div', { class: 'wiz-body' }, grid,
    h('div', { class: 'rows', style: { marginTop: '12px' } }, h('div', { class: 'row' }, h('div', { class: 'row-text' }, h('div', { class: 'row-label', text: 'Animation' }), h('div', { class: 'row-desc', text: 'Choose Reduced on older computers.' })), h('div', { class: 'row-control' }, seg(settings.appearance.motion, [['full', 'Full'], ['reduced', 'Reduced'], ['off', 'Minimal']], (v) => { set('appearance.motion', v); applyAppearance(); }))))),
    foot(back, h('button', { class: 'btn btn-primary', type: 'button', onclick: next }, 'Continue', iconNode('chevron-right'))));
}

function finish(box, { back }) {
  const li = (ic, t, d) => h('div', { class: 'check ok' }, h('span', { class: 'st' }, iconNode(ic)), h('div', { class: 'grow' }, t, h('small', { text: d })));
  box.append(h('h2', {}, 'You’re ', h('b', { text: 'all set' })),
    h('p', { class: 'lead', text: 'A few promises before we start:' }),
    h('div', { class: 'wiz-body check-list' },
      li('lock', 'Private', 'Conversations, memories and settings stay on this device. No tracking, no ads, no account.'),
      li('shield', 'You approve sensitive actions', 'Creating files, organizing folders, system changes and commands always show you exactly what will happen first.'),
      li('heart', 'Free forever', 'No subscriptions, no paid features, no API keys.'),
      li('keyboard', 'Try it', '“open Notes” · “set a timer for 10 minutes” · “what is 15% of 240” · “remember my favourite colour is blue”')),
    foot(back, h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => { set('setupDone', true); await saveSettingsNow(); closeWizard(); toast(`${settings.assistantName} is ready`); } }, iconNode('check'), `Start using ${settings.assistantName}`)));
}
