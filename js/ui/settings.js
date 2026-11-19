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
      row('Your phone number', 'Optional, for “text me” and reminders by text. Stays on this device. Use your iMessage email if you prefer.', text(settings.profile?.phone, (v) => set('profile.phone', v.trim()), { width: '200px', placeholder: '+1 555 123 4567', label: 'Your phone number' })),
      row('Home city (weather)', settings.weather?.place ? `Now: ${settings.weather.place}. Only the city is sent to the free Open-Meteo weather service.` : 'For “what’s the weather?”. Only the city is sent to the free Open-Meteo weather service.', h('div', { class: 'flex' }, (() => { const i = text(settings.weather?.place?.split(',')[0] || '', () => {}, { width: '150px', placeholder: 'e.g. Toronto', label: 'Home city' }); i.addEventListener('change', async () => { if (!i.value.trim()) return; try { const g = await (await import('../weather.js')).setHome(i.value.trim()); toast(`Home city: ${g.name}`); } catch (e) { toast(e.message, { bad: true }); } }); return i; })(), select(settings.weather?.units || 'auto', [['auto', 'Auto'], ['c', '°C'], ['f', '°F']], (v) => set('weather.units', v), 'Temperature units'))),
      row('Emergency contacts', 'Names of saved people to call or text in an emergency (say “emergency”), separated by commas.', text((settings.emergency?.contacts || []).join(', '), (v) => set('emergency.contacts', v.split(',').map((x) => x.trim()).filter(Boolean)), { width: '220px', placeholder: 'e.g. Mom, Sam', label: 'Emergency contacts' })),
      row('Emergency number', 'Leave empty to use your region’s usual number.', text(settings.emergency?.number || '', (v) => set('emergency.number', v.trim()), { width: '120px', placeholder: 'auto', label: 'Emergency number' })),
      row('Home address', 'For “take me home”. Stays on this device and only goes to your Maps app when you ask for directions.', h('div', { class: 'flex wrap' },
        text(settings.profile?.home, (v) => set('profile.home', v.trim()), { width: '220px', placeholder: '12 Main St, Toronto', label: 'Home address' }),
        select(settings.profile?.travel || 'd', [['d', 'Drive'], ['w', 'Walk'], ['r', 'Transit'], ['c', 'Cycle']], (v) => set('profile.travel', v), 'How you usually travel'),
        select(settings.profile?.maps || 'auto', [['auto', 'Best maps app'], ['apple', 'Apple Maps'], ['google', 'Google Maps']], (v) => set('profile.maps', v), 'Maps app'))),
      row('Reply language', 'Auto replies in the language you use.', select(settings.replyLanguage, ['auto', 'English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese', 'Chinese', 'Cantonese', 'Japanese', 'Korean', 'Hindi', 'Arabic', 'Russian', 'Dutch', 'Turkish', 'Vietnamese', 'Indonesian'].map((l) => [l, l === 'auto' ? 'Automatic' : l]), (v) => set('replyLanguage', v), 'Reply language')),
    )),
    section('Your devices', 'Use JARVIS on your phone and computer with the same lists, people, reminders, plugins and settings. No account or server: you link them with a locked file (AirDrop) and a code.', rows(
      row('Link devices', '', h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => import('./sheets.js').then((m) => m.show('sync')) }, iconNode('refresh'), 'Link devices')))),
    section('Custom instructions', 'Added to every conversation. Stored only on this device.', rows(
      row('About you', 'Your job, interests, location, anything that helps.', area(settings.aboutYou, (v) => set('aboutYou', v), { placeholder: 'e.g. I’m a nurse in Toronto. I like short answers and cooking.' }), { stack: true }),
      row('How should it respond?', '', area(settings.customInstructions, (v) => set('customInstructions', v), { placeholder: 'e.g. Use metric units. Explain technical things simply. Always end with one follow-up idea.' }), { stack: true }),
    )),
    section('Morning briefing', `Every morning: the weather and what you need to do (calendar${can('calendar') ? '' : ' in the Mac app'}, reminders, to-do list).${can('messages') ? ' It can be texted to your phone too.' : ' It shows the first time you open JARVIS after this time.'}`, rows(
      row('Morning briefing', '', toggle(settings.briefing?.on !== false, (v) => set('briefing.on', v), 'Morning briefing')),
      row('Time', 'Between now and 2 pm, once a day.', (() => { const i = h('input', { class: 'field', type: 'time', value: settings.briefing?.time || '07:30', 'aria-label': 'Briefing time', style: 'width:130px' }); i.addEventListener('change', () => { if (i.value) { set('briefing.time', i.value); if (i.value > new Date().toTimeString().slice(0, 5)) set('briefing.last', ''); } }); return i; })()),
      row('Read it out loud', '', toggle(settings.briefing?.speak !== false, (v) => set('briefing.speak', v), 'Speak the briefing')),
      row('Evening summary', 'What you got done today and what’s tomorrow.', h('div', { class: 'flex' }, toggle(settings.briefing?.evening !== false, (v) => set('briefing.evening', v), 'Evening summary'), (() => { const i = h('input', { class: 'field', type: 'time', value: settings.briefing?.eveningTime || '21:00', 'aria-label': 'Evening summary time', style: { width: '130px' } }); i.addEventListener('change', () => { if (i.value) { set('briefing.eveningTime', i.value); if (i.value > new Date().toTimeString().slice(0, 5)) set('briefing.lastEvening', ''); } }); return i; })())),
      can('messages') ? row('Text it to me', settings.profile?.phone ? `To ${settings.profile.phone}.` : 'Add your phone number above first.', toggle(settings.briefing?.text !== false, (v) => set('briefing.text', v), 'Text the briefing')) : null,
      row('Try it', '', h('button', { class: 'btn btn-sm', type: 'button', text: 'Show my briefing now', onclick: async () => { closeSheet(); const b = await import('../briefing.js'); const r = await b.build(); const { announce } = await import('../assistant.js'); announce(r.md, { speak: settings.briefing?.speak !== false }); if (await b.textIt(r.text)) toast('Briefing texted to you.'); } })),
    )),
    section('Behaviour', '', rows(
      row('Quiet hours', 'Only urgent things (reminders, calls) alert you during these hours; the rest waits in the bell.', h('div', { class: 'flex' }, toggle(!!settings.notify?.quiet, (v) => set('notify.quiet', v), 'Quiet hours'),
        (() => { const i = h('input', { class: 'field', type: 'time', value: settings.notify?.quietStart || '22:00', 'aria-label': 'Quiet from', style: { width: '120px' } }); i.addEventListener('change', () => set('notify.quietStart', i.value)); return i; })(),
        (() => { const i = h('input', { class: 'field', type: 'time', value: settings.notify?.quietEnd || '07:00', 'aria-label': 'Quiet until', style: { width: '120px' } }); i.addEventListener('change', () => set('notify.quietEnd', i.value)); return i; })())),
      ...(can('macControl') ? [row('New app alerts', 'Tell me when an app runs on this Mac for the first time (a simple way to spot something you didn’t install).', toggle(!!settings.notify?.newApps, (v) => set('notify.newApps', v), 'New app alerts'))] : []),
      row('Instant commands', 'Handle simple requests (open apps, timers, maths, volume) right away without the AI. Faster and works offline with no model.', toggle(settings.instantCommands, (v) => set('instantCommands', v), 'Instant commands')),
      row('Smart conversation titles', 'Ask the AI to name each conversation. Uses a little extra processing.', toggle(settings.smartTitles, (v) => set('smartTitles', v), 'Smart titles')),
      can('phoneAlert') ? row('Make my iPhone ring for calls and texts', 'Texts you send yourself often arrive silently, so JARVIS also adds a quick iCloud reminder that alerts your iPhone (even when it’s locked). It removes it again after 15 minutes.', toggle(settings.profile?.phoneAlerts !== false, (v) => set('profile.phoneAlerts', v), 'Ring my iPhone')) : null,
      can('messages') ? row('Text me when a reminder is due', settings.profile?.phone ? 'A text to your number from your Messages app, so your phone buzzes even away from your Mac.' : 'Add your phone number above first.', toggle(settings.reminders?.textMe !== false, (v) => set('reminders.textMe', v), 'Text me reminders')) : null,
      can('reminders') ? row('Add reminders to the Reminders app', 'So your iPhone and other devices remind you too, even when JARVIS is closed.', toggle(settings.reminders?.system !== false, (v) => set('reminders.system', v), 'System reminders')) : null,
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
        row('Microphone check', 'See which microphone JARVIS hears and how loud you are.', micCheck()),
        row('Speech recognition', perm.onDevice ? 'On-device recognition is available for this language.' : 'On-device recognition is not ready for this language. On a Mac, turn on Dictation once in System Settings → Keyboard to download it.', h('div', { class: 'flex' }, st(perm.speech), perm.onDevice ? h('span', { class: 'pill ok', text: 'Offline' }) : h('span', { class: 'pill warn', text: 'Needs download' }))),
        row('Language', 'The language you speak to JARVIS in.', select(settings.voice.locale, LOCALES, (v) => { set('voice.locale', v); refresh(); }, 'Speech language')),
        row('Offline only', 'Never use online speech recognition, even if on-device is unavailable.', toggle(settings.voice.offlineOnly, (v) => set('voice.offlineOnly', v), 'Offline only')),
        row('Pause before sending', 'How long to wait after you stop talking.', range(settings.voice.silenceMs, 700, 3000, 100, (v) => set('voice.silenceMs', v), (v) => (v / 1000).toFixed(1) + ' s', 'Silence timeout')),
        row('Keep the conversation going', 'After JARVIS answers out loud, it listens again automatically.', toggle(settings.voice.continuous, (v) => set('voice.continuous', v), 'Continuous conversation')),
        row('Microphone sensitivity', 'Lower it in a noisy room so background sound is ignored.', seg(settings.voice.sensitivity || 'normal', [['low', 'Low'], ['normal', 'Normal'], ['high', 'High']], (v) => set('voice.sensitivity', v))),
        row('Push to talk', 'Hold the microphone button (or the Space bar when you’re not typing) while you speak; let go to send.', toggle(settings.voice.pushToTalk !== false, (v) => set('voice.pushToTalk', v), 'Push to talk')),
      )),
      section('Wake word', can('wake') ? 'Optional. While JARVIS is open, say the wake word to start talking. Your microphone stays on (macOS shows an orange dot) but audio never leaves this device.' : 'Needs the JARVIS desktop app.', rows(
        row('Listen for the wake word', '', toggle(settings.voice.wake, (v) => { set('voice.wake', v); bus.emit('wake.changed'); }, 'Wake word')),
        row('Wake word', 'One or two easy words. Default is the assistant’s name; “Hey JARVIS” works too.', text(settings.voice.wakeWord, (v) => { set('voice.wakeWord', v.trim().toLowerCase() || settings.assistantName.toLowerCase()); }, { width: '180px', label: 'Wake word' })),
        row('Answer when called', 'What JARVIS says when you call its name, before listening. Leave empty for just a chime.', text(settings.voice.wakeReply ?? 'Yes?', (v) => set('voice.wakeReply', v.trim()), { width: '180px', placeholder: 'Yes?', label: 'Wake reply' })),
        row('Interrupt by voice (experimental)', 'Say “stop” while JARVIS is talking. Works best with headphones.', toggle(settings.voice.bargeIn, (v) => set('voice.bargeIn', v), 'Interrupt by voice')),
      )),
    );
    bus.emit('sheet.ready');
  })();
});

/** "Test microphone": the device in use and a live level meter for 6 seconds. */
function micCheck() {
  const out = h('span', { class: 'muted small' });
  const bar = h('div', { class: 'progress', style: { width: '120px', display: 'none' } }, h('i'));
  const btn = h('button', { class: 'btn btn-sm', type: 'button' }, iconNode('mic'), 'Test');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    let stream = null, ctx = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const track = stream.getAudioTracks()[0];
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
      ctx = new AudioContext();
      const an = ctx.createAnalyser(); an.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Float32Array(an.fftSize);
      bar.style.display = '';
      let peak = 0;
      const end = Date.now() + 6000;
      await new Promise((res) => {
        const tick = () => {
          an.getFloatTimeDomainData(buf);
          let sum = 0; for (const v of buf) sum += v * v;
          const lvl = Math.min(1, Math.sqrt(sum / buf.length) * 8);
          peak = Math.max(peak, lvl);
          bar.firstChild.style.width = Math.round(lvl * 100) + '%';
          out.textContent = `Hearing: ${track.label || 'your microphone'}${devices.length > 1 ? ` (${devices.length} microphones found)` : ''}. Say something…`;
          if (Date.now() < end) requestAnimationFrame(tick); else res();
        };
        tick();
      });
      out.textContent = peak > 0.08 ? `✓ ${track.label || 'Your microphone'} works.` : `I heard almost nothing from ${track.label || 'the microphone'}. Check it isn’t muted, or pick another input in your computer’s sound settings.`;
    } catch (e) {
      out.textContent = /NotAllowed|denied|Permission/i.test(e.name + e.message) ? 'Microphone access is blocked. Allow it and try again.' : /NotFound/i.test(e.name) ? 'No microphone found. Plug one in or check your sound settings.' : 'Couldn’t test the microphone: ' + e.message;
    } finally {
      stream?.getTracks().forEach((t) => t.stop()); ctx?.close().catch(() => {});
      bar.style.display = 'none'; btn.disabled = false;
    }
  });
  return h('div', { class: 'flex', style: { flexWrap: 'wrap', justifyContent: 'flex-end' } }, btn, bar, out);
}

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
      row('Background', 'The pattern behind everything.', seg(settings.appearance.background || 'grid', [['grid', 'Grid'], ['circuit', 'Circuit'], ['stars', 'Stars'], ['aurora', 'Aurora'], ['plain', 'Plain']], (v) => { set('appearance.background', v); applyAppearance(); })),
      row('Compact mode', 'Smaller sidebar, no side panel, tighter spacing: more room for the conversation. Good on small screens.', toggle(!!settings.appearance.compact, (v) => { set('appearance.compact', v); applyAppearance(); }, 'Compact mode')),
      row('Visualizer style', 'The animated core in the middle of the screen.', seg(settings.appearance.visualizer, [['reactor', 'Reactor'], ['orb', 'Orb'], ['wave', 'Wave']], (v) => set('appearance.visualizer', v))),
      row('Animation', 'Reduce for older computers or to save battery.', seg(settings.appearance.motion, [['full', 'Full'], ['reduced', 'Reduced'], ['off', 'Minimal']], (v) => { set('appearance.motion', v); applyAppearance(); })),
      row('Glass effect', 'Blurred glass panels. Lower is faster on older computers.', seg(settings.appearance.glass, [['full', 'Full'], ['low', 'Light'], ['off', 'Solid']], (v) => { set('appearance.glass', v); applyAppearance(); })),
      row('Text size', '', range(settings.appearance.fontScale, 0.85, 1.6, 0.05, (v) => { set('appearance.fontScale', v); applyAppearance(); }, (v) => Math.round(v * 100) + '%', 'Text size')),
      row('High contrast', 'Brighter text and stronger outlines. Easier to read.', toggle(!!settings.appearance.highContrast, (v) => { set('appearance.highContrast', v); applyAppearance(); }, 'High contrast')),
      can('orb') ? row('Floating JARVIS orb', 'A small glowing orb that stays above every window. Click it to talk; drag it anywhere.', toggle(!!settings.appearance.orb, (v) => { set('appearance.orb', v); call('app.setWindowOptions', { orb: v }).catch(() => {}); }, 'Floating orb')) : null,
      can('orb') ? row('Always on top', 'Keep the JARVIS window above other windows.', toggle(!!settings.appearance.onTop, (v) => { set('appearance.onTop', v); call('app.setWindowOptions', { onTop: v }).catch(() => {}); }, 'Always on top')) : null,
      row('Lightweight mode', 'For older or slower devices: no animations, no glass blur, a simpler core. Saves battery.', toggle(settings.appearance.motion === 'off' && settings.appearance.glass === 'off', (v) => { set('appearance.motion', v ? 'off' : 'full'); set('appearance.glass', v ? 'off' : 'full'); set('appearance.visualizer', v ? 'orb' : 'reactor'); applyAppearance(); refresh(); }, 'Lightweight mode')),
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
    section('Status panel cards', '', rows(hudToggle('clock', 'Clock'), hudToggle('reminders', 'Reminders'), hudToggle('system', 'System'), hudToggle('ai', 'AI core'), hudToggle('voice', 'Voice'), hudToggle('quick', 'Quick actions'))),
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
  look: ['What’s this? (identify on screen)', ''],
  globalSummon: ['Summon JARVIS from anywhere', 'Works even when another app is in front. Brings JARVIS forward and starts listening.'],
  globalLook: ['“What’s this?” from anywhere', 'Then click anything on your screen and JARVIS identifies it.'],
};
registerTab('shortcuts', (body) => {
  let recording = null;
  const r = rows(...Object.entries(SHORTCUT_LABELS).map(([key, [label, desc]]) => {
    if ((key === 'globalSummon' || key === 'globalLook') && !can('hotkey')) return null;
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
    if (key.startsWith('global') && !/Mod|Alt|Ctrl/.test(combo)) { toast('A global shortcut needs ⌘, ⌥ or ⌃.', { bad: true }); return; }
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
    callout('<b>Private by design.</b> No accounts, no ads, no tracking, no analytics. Conversations, memories and settings are stored only on this device. The AI runs on your own device. JARVIS only uses the internet for things you ask for (weather, news, research, model downloads, sync), and local-only mode switches all of those off.', { icon: 'lock' }),
    lockSection(),
    section('Local-only mode', 'No internet at all: weather, news, research, page reading, sync and downloads are switched off. Everything else keeps working offline.', rows(
      row('Local-only mode', settings.privacy?.localOnly ? 'On: JARVIS doesn’t use the internet.' : 'Off', toggle(!!settings.privacy?.localOnly, async (v) => { set('privacy.localOnly', v); const ls = await import('../livesync.js'); ls.connect().catch(() => {}); /* pauses sync when on, reconnects when off */ toast(v ? 'Local-only mode on' : 'Local-only mode off'); }, 'Local-only mode')),
      row('Private chats', 'Chats that are never saved or remembered. Say “private chat”, or use the button under New conversation.', h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { closeSheet(); import('../assistant.js').then((a) => a.send('private chat')); } }, iconNode('lock'), 'Start a private chat')))),
    section('Your data', '', rows(
      row('Stored in', 'Plain JSON files you can back up or delete.', h('div', { class: 'flex' }, where, isNative ? h('button', { class: 'btn btn-sm', type: 'button', text: 'Show in Finder', onclick: () => call('store.reveal') }) : null)),
      row('What is stored', '', countText),
      row('Back up everything', 'One file with all your chats, memories, plugins, lists, people, reminders, workouts, projects, planner and settings. Keep it somewhere safe.', h('button', { class: 'btn btn-sm', type: 'button', onclick: exportAll }, iconNode('download'), 'Back up')),
      row('Restore a backup', 'Adds everything from a backup file. Nothing on this device is deleted.', h('button', { class: 'btn btn-sm', type: 'button', onclick: importAll }, iconNode('upload'), 'Restore')),
    )),
    section('Delete', 'These cannot be undone.', rows(
      row('Delete all conversations', '', h('button', { class: 'btn btn-sm btn-danger', type: 'button', text: 'Delete conversations', onclick: async () => { if (await dialog({ title: 'Delete all conversations?', text: 'Every conversation on this device will be permanently deleted.', okLabel: 'Delete', danger: true })) { await sessions.removeAll(); toast('Conversations deleted'); refresh(); } } })),
      row('Delete all memories', '', h('button', { class: 'btn btn-sm btn-danger', type: 'button', text: 'Delete memories', onclick: async () => { if (await dialog({ title: 'Delete all memories?', text: 'JARVIS will forget everything it remembers about you.', okLabel: 'Delete', danger: true })) { await memory.clear(); toast('Memories deleted'); refresh(); } } })),
      row('Reset everything', 'Deletes all data and settings and restarts setup.', h('button', { class: 'btn btn-sm btn-danger', type: 'button', text: 'Reset JARVIS', onclick: resetAll })),
    )),
  );
});

async function exportAll() {
  // Everything: chats, memories, plugins, lists, people, reminders, workouts, projects, planner and settings.
  const { collect } = await import('../sync.js');
  const data = { app: 'JARVIS', version: 2, exported: new Date().toISOString(), bundle: await collect({ chats: 100000 }) };
  const name = `JARVIS-backup-${new Date().toISOString().slice(0, 10)}.json`;
  try { const r = await call('file.save', { name, content: JSON.stringify(data, null, 2) }); if (r?.ok) toast('Backup saved'); } catch (e) { toast(e.message, { bad: true }); }
}

async function importAll() {
  try {
    const f = await call('file.open', { accept: '.json', types: ['json'] });
    if (!f) return;
    const data = JSON.parse(f.text);
    if (data.app !== 'JARVIS') throw new Error('That is not a JARVIS backup file.');
    if (data.version === 2 && data.bundle) {
      const sync = await import('../sync.js');
      if (!(await dialog({ title: 'Restore this backup?', text: `From ${new Date(data.exported).toLocaleString()}. It adds everything that isn’t on this device yet and updates your settings. Nothing here is deleted.`, okLabel: 'Restore' }))) return;
      const counts = await sync.apply(data.bundle);
      toast(sync.describe(counts), { ms: 6000 });
      setTimeout(() => location.reload(), 1500);
      return;
    }
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

/** App lock: PIN (+ optional spoken passphrase), encryption at rest, auto-lock. */
function lockSection() {
  const box = h('div');
  const draw = async () => {
    const L = await import('../lock.js');
    const c = await L.config();
    if (!c.on) {
      box.replaceChildren(rows(row('App lock', 'Off. Turn it on to protect JARVIS with a PIN and encrypt your chats, memories, lists, people, projects and notes on this device.', h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: async () => {
        const pin = await dialog({ title: 'Choose a PIN', text: '4 to 12 digits. If you forget it, your encrypted data can’t be recovered (keep a backup).', input: '', okLabel: 'Next' });
        if (!pin) return;
        const again = await dialog({ title: 'Type the PIN again', input: '', okLabel: 'Next' });
        if (again !== pin) return toast('The PINs didn’t match.', { bad: true });
        const phrase = await dialog({ title: 'Spoken passphrase (optional)', text: 'A short secret sentence you can say instead of typing the PIN, like “blue rocket over the lake”. It’s a password you say, not a voiceprint, so say it where nobody can hear. Leave empty to skip.', input: '', okLabel: 'Turn on the lock' });
        try { toast('Encrypting your data…', { ms: 2500 }); await L.enable(pin, { phrase: phrase || '', minutes: 10 }); toast('App lock is on. Your data is encrypted.'); draw(); } catch (e) { toast(e.message, { bad: true }); }
      } }, iconNode('lock'), 'Turn on'))));
      return;
    }
    box.replaceChildren(rows(
      row('App lock', `On. Data encrypted on this device.${c.voiceWrap ? ' Spoken passphrase set.' : ''}`, h('div', { class: 'flex' },
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { closeSheet(); L.lockNow(); } }, iconNode('lock'), 'Lock now'),
        h('button', { class: 'btn btn-sm btn-ghost danger', type: 'button', text: 'Turn off', onclick: async () => { if (!(await dialog({ title: 'Turn off the app lock?', text: 'Your data is saved without encryption again.', okLabel: 'Turn off', danger: true }))) return; try { await L.disable(); toast('App lock is off'); draw(); } catch (e) { toast(e.message, { bad: true }); } } }))),
      row('Lock after', 'Minutes without using JARVIS (0 = only when you lock it).', select(String(c.minutes ?? 10), [['0', 'Never'], ['2', '2 minutes'], ['5', '5 minutes'], ['10', '10 minutes'], ['30', '30 minutes'], ['60', '1 hour']], async (v) => { await L.setMinutes(v); toast('Saved'); }, 'Lock after'))));
  };
  draw();
  return section('App lock', 'Protect JARVIS on a shared device. Reminders still go off while it’s locked.', box);
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
    section('Share JARVIS', 'Free for anyone. Each person’s chats, lists and reminders stay on their own device.', rows(
      row('Link', '', h('div', { class: 'flex' }, h('span', { class: 'mono selectable', text: 'szeszeming2-lgtm.github.io/jarvis' }),
        h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => import('./share.js').then((m) => m.shareApp()) }, iconNode('share'), 'Share'))))),
    section('This copy', '', sys),
    featureList(),
    section('Help', '', rows(
      row('Something not working?', 'Most problems are fixed by making sure Ollama is running (look for the llama icon in your menu bar) and that a model is installed.', h('button', { class: 'btn btn-sm', type: 'button', text: 'AI Models', onclick: () => import('./sheets.js').then((m) => m.show('models')) })),
      row('Things to try', '“open Notes” · “set a timer for 5 minutes” · “find my PDFs about taxes” · “organize my Downloads” · “remember that I prefer metric units” · “/translate Spanish: good morning”', null, { stack: true }),
      row('Credits', 'Built on Ollama and the open models from the Ollama library (each has its own licence, shown on ollama.com). Voices and speech recognition are provided by your operating system.', null, { stack: true }),
    )),
  );
});

/** Honest feature list: what works here, and what each feature needs. */
function featureList() {
  const box = h('div');
  import('../features.js').then(({ FEATURES, NOT_YET }) => {
    const here = isNative ? 'mac' : 'web';
    box.append(...FEATURES.map(([group, items]) => h('div', { class: 'feat-group' }, h('div', { class: 'pop-label', text: group }),
      h('ul', { class: 'feat-list' }, ...items.map(([name, where, needs]) => h('li', { class: where === 'all' || where === here ? '' : 'other' },
        iconNode(where === 'all' || where === here ? 'check' : 'info'), h('span', {}, name, needs ? h('small', { text: ` — needs ${needs}` }) : null, where !== 'all' && where !== here ? h('small', { text: where === 'mac' ? ' — in the Mac app' : ' — on phones and in browsers' }) : null)))))),
    h('div', { class: 'feat-group' }, h('div', { class: 'pop-label', text: 'Not built yet (honest list)' }), h('ul', { class: 'feat-list' }, ...NOT_YET.map((t) => h('li', { class: 'other' }, iconNode('info'), h('span', { text: t }))))));
  });
  return section('What JARVIS can do', 'Everything ticked works on this device today, for free. Some things need the internet, a one-time download or the Mac app, as noted.', box);
}

export { fmtBytes, timeAgo };
