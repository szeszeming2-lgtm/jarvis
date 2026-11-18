// Settings tabs: General, Voice, Appearance, Home Screen, Shortcuts, Permissions, Privacy, About.
import { h, iconNode, bus, fmtBytes, timeAgo } from '../util.js';
import { settings, set, DEFAULTS, getActivity, clearActivity, write, saveSettingsNow } from '../store.js';
import { registerTab, refresh, closeSheet } from './sheets.js';
import { row, rows, toggle, select, seg, range, text, area, section, callout, toast, dialog, prettyKey, comboFromEvent, isMac } from './common.js';
import { call, info, can, isNative } from '../host.js';
import * as voice from '../voice.js';
import * as sessions from '../sessions.js';
import * as memory from '../memory.js';
import * as skills from '../skills.js';
import { CATEGORIES } from '../tools.js';
import { applyAppearance, THEMES } from './theme.js';

// ------------------------------------------------------------------ General
registerTab('general', (body) => {
  body.append(
    section('Identity', 'Give your assistant a name and tell it what to call you.', rows(
      row('Assistant name', 'Shown everywhere and used as the default wake word.', text(settings.assistantName, (v) => { set('assistantName', v.trim() || 'JARVIS'); bus.emit('identity'); }, { width: '200px', label: 'Assistant name' })),
      row('Your name', 'Optional. Used in greetings.', text(settings.userName, (v) => { set('userName', v.trim()); bus.emit('identity'); }, { width: '200px', placeholder: 'Your name', label: 'Your name' })),
      row('How it addresses you', '', select(settings.honorific, [['sir', 'Sir'], ['ma\'am', 'Ma\'am'], ['boss', 'Boss'], ['name', 'By my name'], ['none', 'Nothing special']], (v) => set('honorific', v), 'Honorific')),
      row('Personality', 'The overall tone of replies.', select(settings.personality, [['classic', 'Classic butler (calm, witty)'], ['friendly', 'Friendly and casual'], ['concise', 'Brief and to the point'], ['custom', 'Only my instructions']], (v) => set('personality', v), 'Personality')),
      row('Reply language', 'Auto replies in the language you use.', select(settings.replyLanguage, ['auto', 'English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese', 'Chinese', 'Cantonese', 'Japanese', 'Korean', 'Hindi', 'Arabic', 'Russian', 'Dutch', 'Turkish', 'Vietnamese', 'Indonesian'].map((l) => [l, l === 'auto' ? 'Automatic' : l]), (v) => set('replyLanguage', v), 'Reply language')),
    )),
    section('Custom instructions', 'Added to every conversation. Stored only on this device.', rows(
      row('About you', 'Your job, interests, location, anything that helps.', area(settings.aboutYou, (v) => set('aboutYou', v), { placeholder: 'e.g. I’m a nurse in Toronto. I like short answers and cooking.' }), { stack: true }),
      row('How should it respond?', '', area(settings.customInstructions, (v) => set('customInstructions', v), { placeholder: 'e.g. Use metric units. Explain technical things simply. Always end with one follow-up idea.' }), { stack: true }),
    )),
    section('Behaviour', '', rows(
      row('Instant commands', 'Handle simple requests (open apps, timers, maths, volume) right away without the AI. Faster and works offline with no model.', toggle(settings.instantCommands, (v) => set('instantCommands', v), 'Instant commands')),
      row('Smart conversation titles', 'Ask the AI to name each conversation. Uses a little extra processing.', toggle(settings.smartTitles, (v) => set('smartTitles', v), 'Smart titles')),
      can('loginItem') ? row('Open at login', 'Start JARVIS when you log in to your computer.', toggle(settings.launchAtLogin, async (v) => { try { await call('app.setLaunchAtLogin', { on: v }); set('launchAtLogin', v); } catch (e) { toast(e.message, { bad: true }); } }, 'Open at login')) : null,
      row('Setup wizard', 'Run the first-time setup again.', h('button', { class: 'btn btn-sm', type: 'button', text: 'Run setup', onclick: () => { closeSheet(); bus.emit('wizard.open'); } })),
    )),
  );
});

// ------------------------------------------------------------------ Voice
registerTab('voice', (body) => {
  const wrap = h('div');
  body.append(wrap);
  (async () => {
    const list = await voice.voices();
    const hi = await info();
    let perm = { mic: 'unknown', speech: 'unknown', onDevice: false };
    try { perm = await call('listen.permission', { locale: settings.voice.locale }); } catch {}
    const byLang = list.filter((v) => /^en|^zh|^es|^fr|^de|^it|^ja|^ko|^pt|^hi|^ar|^ru|^nl/i.test(v.lang)).sort((a, b) => (a.lang.localeCompare(b.lang)) || qualityRank(b) - qualityRank(a) || a.name.localeCompare(b.name));
    const voiceSel = select(settings.voice.voice || voice.defaultVoice(list), byLang.map((v) => [v.id, `${v.name} — ${v.lang}${v.quality && v.quality !== 'default' ? ` (${v.quality})` : ''}`]), (v) => set('voice.voice', v), 'Voice');
    const st = (s) => h('span', { class: 'pill ' + (s === 'granted' ? 'ok' : s === 'denied' ? 'bad' : 'warn'), text: s === 'granted' ? 'Allowed' : s === 'denied' ? 'Blocked' : s === 'n/a' ? 'Not needed' : 'Not asked yet' });
    wrap.append(
      section('Spoken replies', 'Uses the voices built into your computer. Works offline.', rows(
        row('Speak replies', '', seg(settings.voice.speak, [['voice', 'When I talk'], ['always', 'Always'], ['never', 'Never']], (v) => { set('voice.speak', v); bus.emit('speak.mode'); })),
        row('Voice', byLang.length ? `${byLang.length} voices on this device.` : 'No voices found.', h('div', { class: 'flex' }, voiceSel, h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { voice.stopSpeaking(); voice.speak(`Hello${settings.userName ? ' ' + settings.userName : ''}. I am ${settings.assistantName}, at your service.`); } }, iconNode('play'), 'Test'))),
        row('Speed', '', range(settings.voice.rate, 0.3, 0.7, 0.01, (v) => set('voice.rate', v), (v) => (v / 0.5).toFixed(2) + '×', 'Speech speed')),
        row('Pitch', '', range(settings.voice.pitch, 0.6, 1.5, 0.05, (v) => set('voice.pitch', v), (v) => v.toFixed(2), 'Pitch')),
        row('Volume', '', range(settings.voice.volume, 0.1, 1, 0.05, (v) => set('voice.volume', v), (v) => Math.round(v * 100) + '%', 'Voice volume')),
      )),
      hi.platform === 'macos' ? callout('<b>Want a more natural voice?</b> macOS includes free high-quality voices. Open System Settings → Accessibility → Spoken Content → System voice → Manage Voices, and download a “Premium” or “Enhanced” voice (for example a British English one). Then pick it here.') : null,
      section('Listening', 'Speech recognition runs on this device. Nothing you say is sent anywhere.', rows(
        row('Microphone', 'Needed to talk to JARVIS.', h('div', { class: 'flex' }, st(perm.mic), perm.mic !== 'granted' ? h('button', { class: 'btn btn-sm', type: 'button', text: perm.mic === 'denied' ? 'Open Privacy Settings' : 'Allow', onclick: async () => { if (perm.mic === 'denied') call('tool.open_settings', { page: 'microphone' }); else { try { await call('listen.request'); } catch {} refresh(); } } }) : null)),
        row('Speech recognition', perm.onDevice ? 'On-device recognition is available for this language.' : 'On-device recognition is not ready for this language. On a Mac, turn on Dictation once in System Settings → Keyboard to download it.', h('div', { class: 'flex' }, st(perm.speech), perm.onDevice ? h('span', { class: 'pill ok', text: 'Offline' }) : h('span', { class: 'pill warn', text: 'Needs download' }))),
        row('Language', 'The language you speak to JARVIS in.', select(settings.voice.locale, LOCALES, (v) => { set('voice.locale', v); refresh(); }, 'Speech language')),
        row('Offline only', 'Never use online speech recognition, even if on-device is unavailable.', toggle(settings.voice.offlineOnly, (v) => set('voice.offlineOnly', v), 'Offline only')),
        row('Pause before sending', 'How long to wait after you stop talking.', range(settings.voice.silenceMs, 700, 3000, 100, (v) => set('voice.silenceMs', v), (v) => (v / 1000).toFixed(1) + ' s', 'Silence timeout')),
        row('Keep the conversation going', 'After JARVIS answers out loud, it listens again automatically.', toggle(settings.voice.continuous, (v) => set('voice.continuous', v), 'Continuous conversation')),
      )),
      section('Wake word', can('wake') ? 'Optional. While JARVIS is open, say the wake word to start talking. Your microphone stays on (macOS shows an orange dot) but audio never leaves this device.' : 'Needs the JARVIS desktop app.', rows(
        row('Listen for the wake word', '', toggle(settings.voice.wake, (v) => { set('voice.wake', v); bus.emit('wake.changed'); }, 'Wake word')),
        row('Wake word', 'One or two easy words. Default is the assistant’s name.', text(settings.voice.wakeWord, (v) => { set('voice.wakeWord', v.trim().toLowerCase() || settings.assistantName.toLowerCase()); }, { width: '180px', label: 'Wake word' })),
        row('Interrupt by voice (experimental)', 'Say “stop” while JARVIS is talking. Works best with headphones.', toggle(settings.voice.bargeIn, (v) => set('voice.bargeIn', v), 'Interrupt by voice')),
      )),
    );
    bus.emit('sheet.ready');
  })();
});

const qualityRank = (v) => (/premium/i.test(v.quality) ? 3 : /enhanced/i.test(v.quality) ? 2 : 1);
const LOCALES = [['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['en-CA', 'English (Canada)'], ['en-AU', 'English (Australia)'], ['en-IN', 'English (India)'], ['es-ES', 'Español (España)'], ['es-MX', 'Español (México)'], ['fr-FR', 'Français'], ['fr-CA', 'Français (Canada)'], ['de-DE', 'Deutsch'], ['it-IT', 'Italiano'], ['pt-BR', 'Português (Brasil)'], ['nl-NL', 'Nederlands'], ['zh-CN', '中文 (普通话)'], ['zh-HK', '粵語 (香港)'], ['zh-TW', '中文 (台灣)'], ['ja-JP', '日本語'], ['ko-KR', '한국어'], ['hi-IN', 'हिन्दी'], ['ar-SA', 'العربية'], ['ru-RU', 'Русский'], ['tr-TR', 'Türkçe']];

// ------------------------------------------------------------------ Appearance
registerTab('appearance', (body) => {
  const grid = h('div', { class: 'theme-grid' });
  for (const t of THEMES) {
    const card = h('button', { class: 'theme-card' + (settings.appearance.theme === t.id ? ' on' : ''), type: 'button', onclick: () => { set('appearance.theme', t.id); set('appearance.accent', ''); applyAppearance(); refresh(); } },
      h('div', { class: 'theme-swatch', style: { background: `radial-gradient(circle at 50% 50%, ${t.b}44, ${t.bg} 70%)`, '--sw-a': t.a } }),
      h('div', { style: { fontWeight: 600, color: 'var(--text)' }, text: t.name }), h('div', { text: t.desc }));
    card.querySelector('.theme-swatch').style.setProperty('--sw-a', t.a);
    grid.append(card);
  }
  const color = h('input', { type: 'color', value: settings.appearance.accent || THEMES.find((t) => t.id === settings.appearance.theme)?.a || '#2ad4ff', 'aria-label': 'Accent color' });
  color.addEventListener('input', () => { set('appearance.accent', color.value); applyAppearance(); });
  body.append(
    section('Theme', '', grid),
    section('Details', '', rows(
      row('Accent color', 'Override the theme’s main color.', h('div', { class: 'flex' }, color, h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Reset', onclick: () => { set('appearance.accent', ''); applyAppearance(); refresh(); } }))),
      row('Visualizer style', 'The animated core in the middle of the screen.', seg(settings.appearance.visualizer, [['reactor', 'Reactor'], ['orb', 'Orb'], ['wave', 'Wave']], (v) => set('appearance.visualizer', v))),
      row('Animation', 'Reduce for older computers or to save battery.', seg(settings.appearance.motion, [['full', 'Full'], ['reduced', 'Reduced'], ['off', 'Minimal']], (v) => { set('appearance.motion', v); applyAppearance(); })),
      row('Glass effect', 'Blurred glass panels. Lower is faster on older computers.', seg(settings.appearance.glass, [['full', 'Full'], ['low', 'Light'], ['off', 'Solid']], (v) => { set('appearance.glass', v); applyAppearance(); })),
      row('Text size', '', range(settings.appearance.fontScale, 0.85, 1.3, 0.05, (v) => { set('appearance.fontScale', v); applyAppearance(); }, (v) => Math.round(v * 100) + '%', 'Text size')),
    )),
  );
});

// ------------------------------------------------------------------ Home screen
registerTab('home', (body) => {
  const cards = settings.home.hudCards;
  const qList = h('div', { class: 'list' });
  const drawQuick = () => {
    qList.replaceChildren(...settings.home.quick.map((q, i) => h('div', { class: 'item' },
      h('span', { class: 'item-ic' }, iconNode(q.icon || 'bolt')),
      h('div', { class: 'item-main' }, h('div', { class: 'item-title', text: q.label }), h('div', { class: 'item-sub', text: q.text })),
      h('div', { class: 'item-actions' },
        h('button', { class: 'icon-btn', type: 'button', title: 'Edit', 'aria-label': 'Edit', onclick: () => editQuick(i) }, iconNode('edit')),
        h('button', { class: 'icon-btn', type: 'button', title: 'Remove', 'aria-label': 'Remove', onclick: () => { settings.home.quick.splice(i, 1); set('home.quick', settings.home.quick); drawQuick(); bus.emit('home'); } }, iconNode('trash'))))));
    if (!settings.home.quick.length) qList.append(h('div', { class: 'empty', text: 'No quick actions.' }));
  };
  const editQuick = async (i) => {
    const q = i >= 0 ? settings.home.quick[i] : { label: '', icon: 'bolt', text: '' };
    const label = await dialog({ title: i >= 0 ? 'Edit quick action' : 'New quick action', text: 'Button label', input: q.label, okLabel: 'Next' });
    if (label == null) return;
    const textV = await dialog({ title: 'What should it ask JARVIS?', text: 'Exactly as you would type it, e.g. “open Calendar” or “/brief”.', input: q.text, okLabel: 'Save' });
    if (textV == null) return;
    const item = { label: label.trim() || textV.trim().slice(0, 18), icon: q.icon || 'bolt', text: textV.trim() };
    if (i >= 0) settings.home.quick[i] = item; else settings.home.quick.push(item);
    set('home.quick', settings.home.quick);
    drawQuick();
    bus.emit('home');
  };
  drawQuick();
  const hudToggle = (key, label) => row(label, '', toggle(cards[key], (v) => { set(`home.hudCards.${key}`, v); bus.emit('home'); }, label));
  body.append(
    section('Layout', '', rows(
      row('Conversation list', 'The panel on the left.', toggle(settings.home.sidebar, (v) => { set('home.sidebar', v); bus.emit('home'); }, 'Conversation list')),
      row('Status panel', 'The panel on the right (hidden on narrow windows).', toggle(settings.home.hud, (v) => { set('home.hud', v); bus.emit('home'); }, 'Status panel')),
      row('Suggestions on the welcome screen', '', toggle(settings.home.suggestions, (v) => { set('home.suggestions', v); bus.emit('home'); }, 'Suggestions')),
    )),
    section('Status panel cards', '', rows(hudToggle('clock', 'Clock'), hudToggle('system', 'System'), hudToggle('ai', 'AI core'), hudToggle('voice', 'Voice'), hudToggle('quick', 'Quick actions'))),
    section('Quick actions', 'Buttons in the status panel. Each one sends a message to JARVIS.', qList,
      h('div', { class: 'flex', style: { marginTop: '10px' } },
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => editQuick(-1) }, iconNode('plus'), 'Add quick action'),
        h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Reset to defaults', onclick: () => { set('home.quick', structuredClone(DEFAULTS.home.quick)); drawQuick(); bus.emit('home'); } }))),
  );
});

// ------------------------------------------------------------------ Shortcuts
const SHORTCUT_LABELS = {
  newChat: ['New conversation', ''], search: ['Search conversations', ''], settings: ['Open settings', ''], focusInput: ['Focus the message box', ''],
  listen: ['Start / stop listening', ''], stop: ['Stop talking or generating', ''], toggleSidebar: ['Show / hide conversations', ''], toggleHud: ['Show / hide status panel', ''],
  globalSummon: ['Summon JARVIS from anywhere', 'Works even when another app is in front. Brings JARVIS forward and starts listening.'],
};
registerTab('shortcuts', (body) => {
  let recording = null;
  const r = rows(...Object.entries(SHORTCUT_LABELS).map(([key, [label, desc]]) => {
    if (key === 'globalSummon' && !can('hotkey')) return null;
    const k = h('button', { class: 'kbd', type: 'button', text: prettyKey(settings.shortcuts[key]), title: 'Click, then press the new keys', onclick: () => {
      if (recording) recording.classList.remove('rec');
      recording = k;
      k.classList.add('rec');
      k.textContent = 'Press keys…';
    } });
    k.dataset.key = key;
    return row(label, desc, h('div', { class: 'flex' }, k, h('button', { class: 'icon-btn', type: 'button', title: 'Clear', 'aria-label': `Clear ${label}`, onclick: () => { set(`shortcuts.${key}`, ''); k.textContent = '—'; bus.emit('shortcuts'); } }, iconNode('x'))));
  }));
  const onKey = (e) => {
    if (!recording) return;
    e.preventDefault(); e.stopPropagation();
    if (e.key === 'Escape' && !e.metaKey && !e.ctrlKey && !e.altKey) { recording.classList.remove('rec'); recording.textContent = prettyKey(settings.shortcuts[recording.dataset.key]); recording = null; return; }
    const combo = comboFromEvent(e);
    if (!combo) return;
    const key = recording.dataset.key;
    if (key === 'globalSummon' && !/Mod|Alt|Ctrl/.test(combo)) { toast('A global shortcut needs ⌘, ⌥ or ⌃.', { bad: true }); return; }
    set(`shortcuts.${key}`, combo);
    recording.textContent = prettyKey(combo);
    recording.classList.remove('rec');
    recording = null;
    bus.emit('shortcuts');
  };
  document.addEventListener('keydown', onKey, true);
  body.append(
    section('Shortcuts', `Click a shortcut, then press the keys you want. ${isMac ? '⌘ = Command, ⌥ = Option, ⇧ = Shift.' : ''}`, r),
    h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Reset all to defaults', onclick: () => { set('shortcuts', structuredClone(DEFAULTS.shortcuts)); bus.emit('shortcuts'); refresh(); } }),
  );
  return () => document.removeEventListener('keydown', onKey, true);
});

// ------------------------------------------------------------------ Permissions
registerTab('permissions', (body) => {
  const logBox = h('div', { class: 'log-list', text: 'Loading…' });
  getActivity().then((list) => {
    logBox.replaceChildren(...(list.length ? list.slice(0, 120).map((e) => h('div', { text: `${new Date(e.ts).toLocaleString()} · ${e.tool} · ${e.result}${e.args ? ' · ' + e.args : ''}` })) : [h('div', { text: 'Nothing yet.' })]));
  });
  body.append(
    callout('<b>You are always in control.</b> “Allow” runs right away, “Ask” shows a card with exactly what will happen so you can approve it, and “Off” means JARVIS can’t do it at all. Some actions also need your computer’s own permission the first time (macOS will ask).'),
    section('What JARVIS may do', isNative ? '' : 'In the browser only websites work; the desktop app adds the rest.', rows(
      ...Object.entries(CATEGORIES).map(([key, c]) => row(c.label, c.desc, seg(settings.permissions[key], c.levels.map((l) => [l, { allow: 'Allow', ask: 'Ask', off: 'Off' }[l]]), (v) => set(`permissions.${key}`, v)))),
    )),
    section('Activity log', 'Every action JARVIS takes is recorded here, on this device only.', logBox,
      h('div', { class: 'flex', style: { marginTop: '8px' } }, h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Clear log', onclick: async () => { await clearActivity(); refresh(); } }))),
  );
});

// ------------------------------------------------------------------ Privacy
registerTab('privacy', (body) => {
  const where = h('span', { class: 'mono', text: '…' });
  info().then((i) => { where.textContent = i.dataDir; });
  const countText = h('span', { text: `${sessions.state.index.length} conversations · ${memory.all().length} memories · ${skills.all().length} skills` });
  body.append(
    callout('<b>Private by design.</b> No accounts, no ads, no tracking, no analytics. Conversations, memories and settings are stored only on this device. The AI runs on your own computer through Ollama. JARVIS only uses the internet when you download a model, open a website, or check for updates on the Ollama site.', { icon: 'lock' }),
    section('Your data', '', rows(
      row('Stored in', 'Plain JSON files you can back up or delete.', h('div', { class: 'flex' }, where, isNative ? h('button', { class: 'btn btn-sm', type: 'button', text: 'Show in Finder', onclick: () => call('store.reveal') }) : null)),
      row('What is stored', '', countText),
      row('Export everything', 'Save conversations, memories, skills and settings to one file.', h('button', { class: 'btn btn-sm', type: 'button', onclick: exportAll }, iconNode('download'), 'Export')),
      row('Import a backup', 'Adds conversations, memories and skills from an export file.', h('button', { class: 'btn btn-sm', type: 'button', onclick: importAll }, iconNode('upload'), 'Import')),
    )),
    section('Delete', 'These cannot be undone.', rows(
      row('Delete all conversations', '', h('button', { class: 'btn btn-sm btn-danger', type: 'button', text: 'Delete conversations', onclick: async () => { if (await dialog({ title: 'Delete all conversations?', text: 'Every conversation on this device will be permanently deleted.', okLabel: 'Delete', danger: true })) { await sessions.removeAll(); toast('Conversations deleted'); refresh(); } } })),
      row('Delete all memories', '', h('button', { class: 'btn btn-sm btn-danger', type: 'button', text: 'Delete memories', onclick: async () => { if (await dialog({ title: 'Delete all memories?', text: 'JARVIS will forget everything it remembers about you.', okLabel: 'Delete', danger: true })) { await memory.clear(); toast('Memories deleted'); refresh(); } } })),
      row('Reset everything', 'Deletes all data and settings and restarts setup.', h('button', { class: 'btn btn-sm btn-danger', type: 'button', text: 'Reset JARVIS', onclick: resetAll })),
    )),
  );
});

async function exportAll() {
  const data = { app: 'JARVIS', version: 1, exported: new Date().toISOString(), settings, memory: memory.all(), skills: skills.all(), conversations: await sessions.exportAll() };
  const name = `JARVIS-backup-${new Date().toISOString().slice(0, 10)}.json`;
  try { const r = await call('file.save', { name, content: JSON.stringify(data, null, 2) }); if (r?.ok) toast('Backup saved'); } catch (e) { toast(e.message, { bad: true }); }
}

async function importAll() {
  try {
    const f = await call('file.open', { accept: '.json', types: ['json'] });
    if (!f) return;
    const data = JSON.parse(f.text);
    if (data.app !== 'JARVIS') throw new Error('That is not a JARVIS backup file.');
    let n = 0;
    for (const c of data.conversations || []) {
      if (!c?.id || !Array.isArray(c.messages)) continue;
      if (sessions.state.index.some((e) => e.id === c.id)) continue;
      await write('session-' + c.id, c);
      sessions.touch(c);
      n++;
    }
    for (const m of data.memory || []) if (m?.text) await memory.add(m.text, m.source || 'you');
    if (data.skills?.length) skills.importSkills(data.skills.filter((s) => !skills.all().some((x) => x.command === s.command)));
    toast(`Imported ${n} conversations`);
    refresh();
  } catch (e) { toast(e.message, { bad: true }); }
}

async function resetAll() {
  if (!(await dialog({ title: 'Reset JARVIS?', text: 'All conversations, memories, skills and settings on this device will be deleted. Your AI models are kept.', okLabel: 'Reset everything', danger: true }))) return;
  await sessions.removeAll();
  await memory.clear();
  await write('skills', null);
  await write('activity', []);
  Object.assign(settings, structuredClone(DEFAULTS));
  await saveSettingsNow();
  location.reload();
}

// ------------------------------------------------------------------ About
registerTab('about', (body) => {
  const sys = h('div', { class: 'rows' });
  info().then((i) => {
    sys.append(
      row('Version', '', h('span', { class: 'mono', text: `JARVIS ${i.appVersion} (${i.shell})` })),
      row('Device', '', h('span', { class: 'mono', text: [i.chip, i.ramGB ? `${i.ramGB} GB memory` : '', i.osVersion].filter(Boolean).join(' · ') || 'Unknown' })),
    );
  });
  body.append(
    callout('<b>Free forever.</b> No subscriptions, no paid tiers, no API keys, no ads. JARVIS is open source (MIT licence) and runs AI models with Ollama (MIT) on your own hardware.', { icon: 'heart' }),
    callout('<b>About speed.</b> The AI runs on your computer, so its speed and smarts depend on your device. Small models (1–4B) answer quickly on almost anything; bigger models (8B+) are smarter but need 16 GB of memory or more. You can switch models any time in AI Models.', { icon: 'cpu' }),
    section('This copy', '', sys),
    section('Help', '', rows(
      row('Something not working?', 'Most problems are fixed by making sure Ollama is running (look for the llama icon in your menu bar) and that a model is installed.', h('button', { class: 'btn btn-sm', type: 'button', text: 'AI Models', onclick: () => import('./sheets.js').then((m) => m.show('models')) })),
      row('Things to try', '“open Notes” · “set a timer for 5 minutes” · “find my PDFs about taxes” · “organize my Downloads” · “remember that I prefer metric units” · “/translate Spanish: good morning”', null, { stack: true }),
      row('Credits', 'Built on Ollama and the open models from the Ollama library (each has its own licence, shown on ollama.com). Voices and speech recognition are provided by your operating system.', null, { stack: true }),
    )),
  );
});

export { fmtBytes, timeAgo };
