// Abilities JARVIS can use, with transparent permission levels.
// allow = runs right away, ask = shows a confirmation card first, off = never runs.
import { call, can, isNative } from './host.js';
import { settings, set, logActivity } from './store.js';
import { calculate } from './calc.js';
import * as memory from './memory.js';
import * as reminders from './reminders.js';
import * as lists from './lists.js';
import * as people from './people.js';
import * as weather from './weather.js';
import * as workout from './workout.js';
import { convert } from './converter.js';
import { EXERCISES } from './reps.js';
import { describeWhen } from './when.js';
import { APPS, normApp, link as appLink, explain as explainApp } from './messaging.js';
import { bus, truncate } from './util.js';

export const CATEGORIES = {
  apps: { label: 'Open apps and folders', icon: 'app', desc: 'Launch apps, open folders and System Settings pages.', levels: ['allow', 'ask', 'off'] },
  quitApps: { label: 'Quit apps', icon: 'power', desc: 'Ask an app to quit (it will still offer to save your work).', levels: ['allow', 'ask', 'off'] },
  web: { label: 'Open websites', icon: 'globe', desc: 'Open web pages and web searches in your browser.', levels: ['allow', 'ask', 'off'] },
  findFiles: { label: 'Find files', icon: 'search', desc: 'Search file names in your home folder with Spotlight.', levels: ['allow', 'ask', 'off'] },
  readFiles: { label: 'Read documents', icon: 'file', desc: 'Read text from documents so the AI can summarise or answer questions.', levels: ['allow', 'ask', 'off'] },
  writeFiles: { label: 'Create documents', icon: 'edit', desc: 'Write new files (never overwrites an existing file).', levels: ['allow', 'ask', 'off'] },
  organize: { label: 'Organize folders', icon: 'broom', desc: 'Move files into tidy sub-folders. You see the full plan first and can undo.', levels: ['allow', 'ask', 'off'] },
  system: { label: 'System settings', icon: 'sliders', desc: 'Volume, dark mode, Wi-Fi, display sleep.', levels: ['allow', 'ask', 'off'] },
  shortcuts: { label: 'Apple Shortcuts', icon: 'shortcut', desc: 'Run Shortcuts you made in the Shortcuts app.', levels: ['allow', 'ask', 'off'] },
  commands: { label: 'Terminal commands', icon: 'terminal', desc: 'Run shell commands. Always shows the exact command and asks every time.', levels: ['ask', 'off'] },
  reminders: { label: 'Reminders', icon: 'bell', desc: 'Create and cancel reminders. The desktop app also adds them to your Reminders app so your phone alerts you.', levels: ['allow', 'ask', 'off'] },
  messages: { label: 'Send texts', icon: 'message', desc: 'Text someone (or you). Always shows who it goes to and the exact message first.', levels: ['ask', 'off'] },
  calls: { label: 'Phone calls', icon: 'phone', desc: 'Start a call through your phone or FaceTime. Always asks first.', levels: ['ask', 'off'] },
  screen: { label: 'Look at your screen', icon: 'eye', desc: 'Identify what you point at. Only a small area around your click is looked at, by the AI on your computer.', levels: ['allow', 'ask', 'off'] },
};

const s = (description, props = {}, required = []) => ({ description, props, required });

export const TOOLS = [
  { name: 'open_app', category: 'apps', icon: 'app', needs: 'apps', group: 'apps',
    ...s('Open (launch) an application on this computer by its name, for example Safari, Notes, Calendar, Spotify.', { name: { type: 'string', description: 'Application name' } }, ['name']),
    ask: (a) => ({ title: `Open ${a.name}`, detail: 'Launches the app.' }),
    run: (a) => call('tool.open_app', a), done: (r) => `Opened ${r.name}` },
  { name: 'quit_app', category: 'quitApps', icon: 'power', needs: 'apps', group: 'apps',
    ...s('Quit a running application by name.', { name: { type: 'string', description: 'Application name' } }, ['name']),
    ask: (a) => ({ title: `Quit ${a.name}`, detail: 'The app will close. Apps with unsaved work will ask you to save.' }),
    run: (a) => call('tool.quit_app', a), done: (r) => `Quit ${r.name}` },
  { name: 'open_folder', category: 'apps', icon: 'folder', needs: 'files', group: 'apps',
    ...s('Open a folder in Finder. Accepts names like Downloads, Documents, Desktop, Pictures, Music, Movies, Home, Applications or a path.', { folder: { type: 'string' } }, ['folder']),
    ask: (a) => ({ title: `Open the ${a.folder} folder`, detail: 'Shows it in Finder.' }),
    run: (a) => call('tool.open_folder', a), done: (r) => `Opened ${r.name}` },
  { name: 'open_system_settings', category: 'apps', icon: 'gear', needs: 'system', group: 'system',
    ...s('Open System Settings, optionally at a page: general, wifi, bluetooth, sound, display, battery, privacy, notifications, keyboard, accessibility, desktop, appearance, network, users, storage, focus.', { page: { type: 'string' } }),
    ask: (a) => ({ title: `Open System Settings${a.page ? ` → ${a.page}` : ''}` }),
    run: (a) => call('tool.open_settings', a), done: (r) => `Opened ${r.name || 'System Settings'}` },
  { name: 'open_website', category: 'web', icon: 'globe', group: 'web',
    ...s('Open a website in the default web browser.', { url: { type: 'string', description: 'Full URL or domain, e.g. youtube.com' } }, ['url']),
    ask: (a) => ({ title: 'Open a website', detail: normalizeUrl(a.url) }),
    run: async (a) => { const url = normalizeUrl(a.url); await call('tool.open_url', { url }); return { url }; },
    done: (r) => `Opened ${hostOf(r.url)}` },
  { name: 'web_search', category: 'web', icon: 'search', group: 'web',
    ...s('Search the web in the user\'s browser (opens a search results page). Use when the user asks to search or look something up online.', { query: { type: 'string' } }, ['query']),
    ask: (a) => ({ title: 'Search the web', detail: a.query }),
    run: async (a) => { const url = 'https://duckduckgo.com/?q=' + encodeURIComponent(a.query); await call('tool.open_url', { url }); return { url, query: a.query, note: 'Results opened in the browser; you cannot see them.' }; },
    done: (r) => `Searched for “${truncate(r.query, 40)}”` },
  { name: 'find_files', category: 'findFiles', icon: 'search', needs: 'files', group: 'files',
    ...s('Find files on this computer by name (Spotlight). Returns paths you can pass to read_document.', {
      query: { type: 'string', description: 'Words in the file name' },
      kind: { type: 'string', enum: ['any', 'document', 'pdf', 'image', 'video', 'audio', 'folder', 'presentation', 'spreadsheet', 'code'], description: 'Optional file type' },
      folder: { type: 'string', description: 'Optional folder to search, e.g. Downloads' },
    }, ['query']),
    ask: (a) => ({ title: `Search files for “${a.query}”` }),
    run: (a) => call('tool.find_files', a), done: (r) => `Found ${r.count} file${r.count === 1 ? '' : 's'}` },
  { name: 'read_document', category: 'readFiles', icon: 'file', needs: 'documents', group: 'files',
    ...s('Read the text of a document (txt, md, pdf, docx, rtf, html, csv, json, code). Use a path from find_files.', { path: { type: 'string' } }, ['path']),
    ask: (a) => ({ title: 'Read a document', detail: a.path }),
    run: (a) => call('tool.read_document', a), done: (r) => `Read ${r.name}`,
    forModel: (r) => ({ name: r.name, chars: r.chars, truncated: r.truncated, text: `<<document>>\n${r.text}\n<<end of document>>` }) },
  { name: 'create_document', category: 'writeFiles', icon: 'edit', needs: 'documents', group: 'files',
    ...s('Create a new document file with the given content. Formats: md, txt, rtf, docx (Word), html. Default folder is Documents.', {
      title: { type: 'string', description: 'File name without extension' },
      content: { type: 'string', description: 'Full document text (Markdown is fine)' },
      format: { type: 'string', enum: ['md', 'txt', 'rtf', 'docx', 'html'] },
      folder: { type: 'string', description: 'Optional: Documents, Desktop, Downloads or a path' },
    }, ['title', 'content']),
    ask: (a) => ({ title: `Create “${a.title}.${a.format || 'md'}”`, detail: `In ${a.folder || 'Documents'}`, preview: truncate(a.content, 900) }),
    run: (a) => call('tool.create_document', a), done: (r) => `Created ${r.name}`, reveal: (r) => r.path },
  { name: 'organize_folder', category: 'organize', icon: 'broom', needs: 'files', group: 'files',
    ...s('Tidy a folder by moving its loose files into sub-folders by type (Images, Documents, ...) or by month. The user sees the plan first.', {
      folder: { type: 'string', description: 'Downloads, Desktop, Documents or a path' },
      by: { type: 'string', enum: ['type', 'date'] },
    }, ['folder']),
    prepare: (a) => call('tool.organize_preview', a),
    ask: (a, plan) => ({ title: `Organize ${plan?.name || a.folder}`, detail: plan?.moves?.length ? `${plan.moves.length} files will move into ${plan.groups.length} folders:` : 'Nothing to move. The folder is already tidy.', preview: plan?.moves?.length ? plan.groups.map((g) => `${g.folder}/  ← ${g.count} file${g.count > 1 ? 's' : ''}  (${g.sample.join(', ')}${g.count > g.sample.length ? ', …' : ''})`).join('\n') : '' }),
    skipIf: (a, plan) => (plan && !plan.moves?.length ? { ok: true, moved: 0, summary: 'Folder already tidy' } : null),
    run: (a, plan) => call('tool.organize_apply', { planId: plan.planId }),
    done: (r) => (r.moved ? `Moved ${r.moved} files` : 'Already tidy'), undo: (r) => (r.undoId ? () => call('tool.organize_undo', { undoId: r.undoId }) : null) },
  { name: 'calculate', icon: 'calculator', group: 'basics',
    ...s('Calculate a math expression exactly. Use for any arithmetic.', { expression: { type: 'string' } }, ['expression']),
    run: async (a) => { const r = calculate(a.expression); return { expression: a.expression, result: r.text }; },
    done: (r) => `${truncate(r.expression, 30)} = ${r.result}` },
  { name: 'get_datetime', icon: 'clock', group: 'basics',
    ...s('Get the current local date and time.'),
    run: async () => { const d = new Date(); return { date: d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }), time: d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }; },
    done: (r) => `${r.time}` },
  { name: 'set_timer', icon: 'clock', group: 'basics',
    ...s('Start a countdown timer. JARVIS announces it when time is up.', { minutes: { type: 'number' }, label: { type: 'string' } }, ['minutes']),
    run: async (a) => startTimer(Number(a.minutes), a.label), done: (r) => `Timer: ${r.human}` },
  { name: 'system_status', icon: 'cpu', group: 'status',
    ...s('Get this computer\'s status: CPU load, memory, battery, storage, uptime.'),
    run: async () => { const r = await call('system.status'); if (r.web) Object.assign(r, appStats()); return r; }, done: () => 'Checked system status' },
  { name: 'convert_units', icon: 'calculator', group: 'convert',
    ...s('Convert between units (length, weight, cooking volumes, temperature, speed, time, data, area).', { value: { type: 'number' }, from: { type: 'string' }, to: { type: 'string' } }, ['value', 'from', 'to']),
    run: async (a) => convert(a.value, a.from, a.to), done: (r) => r.text.replace(/\*/g, '') },
  { name: 'start_workout', icon: 'zap', group: 'fitness',
    ...s('Open the workout coach: the camera counts reps. Exercises: squats, pushups, jacks (jumping jacks), curls, lunges, situps (sit-ups/crunches), press (shoulder press), raises (lateral raises), knees (high knees), bridges (glute bridges), burpees, pullups, plank and wallsit (timed holds).', { exercise: { type: 'string', enum: Object.keys(EXERCISES) } }),
    run: async (a) => { bus.emit('workout.open', { exercise: a.exercise || 'squats' }); return { exercise: EXERCISES[a.exercise]?.label || 'Squats' }; }, done: (r) => `Coach: ${r.exercise}` },
  { name: 'log_workout', icon: 'zap', group: 'fitness',
    ...s('Log a workout the user did (reps, sets, weight, minutes or distance).', { exercise: { type: 'string' }, reps: { type: 'number' }, sets: { type: 'number' }, weight: { type: 'number' }, unit: { type: 'string', enum: ['kg', 'lb'] }, minutes: { type: 'number' }, km: { type: 'number' } }, ['exercise']),
    run: async (a) => { const e = workout.add({ exercise: a.exercise, reps: a.reps, sets: a.sets, weight: a.weight, unit: a.unit, seconds: a.minutes ? Math.round(a.minutes * 60) : undefined, distanceKm: a.km }); const sum = workout.summary(7); return { logged: workout.describe(e), week: sum.sessions, streak: sum.streak }; },
    done: (r) => `Logged ${r.logged}` },
  { name: 'workout_summary', icon: 'zap', group: 'fitness',
    ...s('Summarise the user\'s recent workouts.', { days: { type: 'number' } }),
    run: async (a) => workout.summary(a.days || 7), done: (r) => `${r.sessions} workouts in ${r.days} days` },
  { name: 'set_volume', category: 'system', icon: 'volume', needs: 'system', group: 'system',
    ...s('Set the output volume (0-100), or mute/unmute.', { level: { type: 'number', description: '0 to 100' }, mute: { type: 'boolean' } }),
    ask: (a) => ({ title: a.delta ? `Turn the volume ${a.delta > 0 ? 'up' : 'down'}` : a.mute === true ? 'Mute sound' : a.mute === false && a.level == null ? 'Unmute sound' : `Set volume to ${Math.round(a.level)}%` }),
    run: (a) => call('tool.set_volume', a), done: (r) => (r.muted ? 'Muted' : `Volume ${r.level}%`) },
  { name: 'set_dark_mode', category: 'system', icon: 'moon', needs: 'system', group: 'system',
    ...s('Switch the computer between dark mode and light mode.', { mode: { type: 'string', enum: ['dark', 'light', 'toggle'] } }, ['mode']),
    ask: (a) => ({ title: a.mode === 'toggle' ? 'Switch dark / light mode' : `Turn on ${a.mode} mode`, detail: 'macOS may ask once to let JARVIS control System Events.' }),
    run: (a) => call('tool.set_dark_mode', a), done: (r) => (r.dark ? 'Dark mode on' : 'Light mode on') },
  { name: 'set_wifi', category: 'system', icon: 'wifi', needs: 'system', group: 'system',
    ...s('Turn Wi-Fi on or off.', { on: { type: 'boolean' } }, ['on']),
    ask: (a) => ({ title: `Turn Wi-Fi ${a.on ? 'on' : 'off'}`, detail: a.on ? '' : 'You will lose internet over Wi-Fi until it is turned back on.', danger: !a.on }),
    run: (a) => call('tool.set_wifi', a), done: (r) => `Wi-Fi ${r.on ? 'on' : 'off'}` },
  { name: 'sleep_display', category: 'system', icon: 'display', needs: 'system', group: 'system',
    ...s('Put the display to sleep now.'),
    ask: () => ({ title: 'Put the display to sleep' }),
    run: () => call('tool.sleep_display'), done: () => 'Display asleep' },
  { name: 'run_shortcut', category: 'shortcuts', icon: 'shortcut', needs: 'shortcuts', group: 'system',
    ...s('Run one of the user\'s Apple Shortcuts by its exact name (for Focus modes, smart home, and more).', { name: { type: 'string' }, input: { type: 'string' } }, ['name']),
    ask: (a) => ({ title: `Run the Shortcut “${a.name}”`, detail: a.input ? `Input: ${a.input}` : 'Shortcuts can do anything you built them to do.' }),
    run: (a) => call('tool.run_shortcut', a), done: (r) => `Ran ${r.name}` },
  { name: 'list_shortcuts', category: 'shortcuts', icon: 'shortcut', needs: 'shortcuts', group: 'system',
    ...s('List the names of the user\'s Apple Shortcuts.'),
    ask: () => ({ title: 'List your Shortcuts' }),
    run: () => call('tool.list_shortcuts'), done: (r) => `${r.names.length} Shortcuts` },
  { name: 'run_command', category: 'commands', icon: 'terminal', needs: 'commands', group: 'commands', alwaysAsk: true,
    ...s('Run a shell command on this computer and return its output. Only when the user clearly asks. Prefer safe, read-only commands.', { command: { type: 'string' }, reason: { type: 'string', description: 'One short sentence on why' } }, ['command']),
    ask: (a) => ({ title: 'Run a terminal command', detail: a.reason || 'This runs with your user account\'s permissions.', preview: a.command, danger: true, mono: true }),
    run: (a) => call('tool.run_command', a), done: (r) => `Command finished (exit ${r.exitCode})`,
    forModel: (r) => ({ exitCode: r.exitCode, output: `<<output>>\n${r.output}\n<<end of output>>` }) },
  { name: 'set_reminder', category: 'reminders', icon: 'bell', group: 'reminders',
    ...s('Remind the user about something at a time. Use for "remind me…" requests.', {
      text: { type: 'string', description: 'What to remind them about, e.g. "call the dentist"' },
      when: { type: 'string', description: 'When, in plain words exactly as the user said it: "in 20 minutes", "at 5:30 pm", "tomorrow at 9am", "friday at 3pm"' },
      text_me: { type: 'boolean', description: 'Also send the user a text message when it is due (only if they ask to be texted)' },
      call_me: { type: 'boolean', description: 'Call the user when it is due (only if they ask to be called or woken up)' },
      repeat: { type: 'string', enum: ['daily', 'weekdays', 'weekly', 'monthly', 'yearly'], description: 'Only if the user says it should repeat (every day, every Monday…)' },
    }, ['text', 'when']),
    ask: (a) => ({ title: `Remind you: “${a.text}”`, detail: a.when }),
    run: async (a) => {
      if (a.call_me && !settings.profile?.phone?.trim()) throw new Error('Tell me your number first, so I know where to call: say “my number is +1 555 123 4567”.');
      const r = await reminders.add(a.text, a.when, { textMe: !!a.text_me, callMe: !!a.call_me, repeat: a.repeat || '' });
      const callNote = a.call_me && !can('messages') ? 'Calls come from the JARVIS Mac app, so keep it running on your Mac. The reminder is here as well.' : '';
      const texts = can('messages') && !a.call_me && !!(a.text_me || (settings.reminders?.textMe !== false && settings.profile?.phone));
      return { id: r.id, text: r.text, when: r.human, due: new Date(r.due).toISOString(), inSystemReminders: !!r.systemId, callNote, texts, repeat: r.repeat || '' };
    },
    done: (r) => `Reminder ${r.when}` },
  { name: 'list_reminders', icon: 'bell', group: 'reminders',
    ...s('List the user\'s upcoming reminders.'),
    run: async () => { const list = reminders.upcoming(); return { count: list.length, reminders: list.slice(0, 20).map((r) => ({ text: r.text, when: describeWhen(new Date(r.due)) })) }; },
    done: (r) => `${r.count} reminder${r.count === 1 ? '' : 's'}` },
  { name: 'cancel_reminder', category: 'reminders', icon: 'bell', group: 'reminders',
    ...s('Cancel upcoming reminders that match some words.', { about: { type: 'string' } }, ['about']),
    prepare: async (a) => ({ matches: reminders.match(a.about) }),
    skipIf: (a, p) => (!p.matches.length ? { ok: false, error: `No upcoming reminder matches “${a.about}”.` } : null),
    ask: (a, p) => ({ title: `Cancel ${p.matches.length} reminder${p.matches.length === 1 ? '' : 's'}`, preview: p.matches.map((r) => `• ${r.text} — ${describeWhen(new Date(r.due))}`).join('\n') }),
    run: async (a, p) => { for (const r of p.matches) await reminders.cancel(r.id); return { cancelled: p.matches.length }; },
    done: (r) => `Cancelled ${r.cancelled}` },
  { name: 'call_me', icon: 'phone', group: 'contact',
    ...s('Call the user now: their iPhone gets a "JARVIS is calling" message, and tapping it opens a call where you speak to them. Only when they ask you to call them.', { message: { type: 'string', description: 'What to say when they answer' } }),
    run: async (a) => {
      const to = settings.profile?.phone?.trim();
      if (!to) throw new Error('Tell me your number first: say “my number is +1 555 123 4567”. It stays on this device.');
      if (!can('messages')) throw new Error('Calls to you come from the JARVIS Mac app (it uses Messages on your Mac). Ask it on your Mac, or keep it running in the menu bar.');
      const r = await call('messages.send', { to, text: callText(a.message || '') });
      const alert = await ringPhone(`📞 ${settings.assistantName || 'JARVIS'} is calling you${a.message ? `: ${a.message}` : ''}`, 'Open the message from yourself to answer the call.');
      return { sent: !!r?.sent, drafted: !!r?.drafted, alert };
    },
    done: (r) => (r.sent ? 'Calling you' : 'Call link ready to send') },
  { name: 'set_my_number', icon: 'user', group: 'contact',
    ...s('Save the user\'s own phone number (or iMessage email) so you can text and call them.', { number: { type: 'string' } }, ['number']),
    run: async (a) => {
      const n = String(a.number || '').trim();
      if (!/^\+?[\d\s().-]{5,20}$/.test(n) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(n)) throw new Error('That number doesn’t look right. Include the country code, like +1 555 123 4567.');
      set('profile.phone', n);
      return { number: n };
    },
    done: (r) => `Your number: ${r.number}` },
  { name: 'send_text', category: 'messages', icon: 'message', group: 'contact', alwaysAsk: true, selfOk: (a) => /^(me|myself)$/i.test(String(a.to || '').trim()),
    ...s('Send a message. "to" is a phone number, an email for iMessage, a saved person or contact name, or "me" for the user themself. "app" picks the app (default Messages).', {
      to: { type: 'string' }, message: { type: 'string' },
      app: { type: 'string', enum: ['messages', 'whatsapp', 'telegram', 'discord', 'signal', 'messenger', 'teams', 'skype'] },
    }, ['to', 'message']),
    prepare: async (a) => {
      const app = normApp(a.app) || 'messages';
      if (app === 'messages') return { app, ...(await resolveRecipient(a.to)) };
      return { app, ...(await resolveForApp(a.to, app, 'text', a.message)) };
    },
    ask: (a, who) => who.app === 'messages'
      ? { title: `${can('messages') ? 'Send' : 'Prepare'} a text to ${who.label}`, detail: can('messages') ? `Sent from your Messages app to ${who.address}.` : 'Your messages app opens with the text ready; you press Send.', preview: a.message }
      : { title: `Message ${who.label} on ${APPS[who.app].label}`, detail: explainApp(who.app, who.how, 'text'), preview: a.message },
    run: async (a, who) => {
      if (who.app !== 'messages') {
        if (who.how !== 'prefills') await copyText(a.message);
        await call('app.openLink', { url: who.url });
        return { to: who.label, app: APPS[who.app].label, how: who.how };
      }
      const r = await call('messages.send', { to: who.address, text: a.message });
      // A text to yourself often arrives without a sound: also make the phone ring with an alert.
      const alert = /^(me|myself)$/i.test(String(a.to || '').trim()) ? await ringPhone(`💬 ${settings.assistantName || 'JARVIS'}: ${a.message}`, a.message) : false;
      return { to: who.label, sent: !!r?.sent, drafted: !!r?.drafted, alert };
    },
    done: (r) => (r.app ? `${r.app}: ${r.to}` : r.sent ? `Texted ${r.to}` : `Text ready for ${r.to}`) },
  { name: 'make_call', category: 'calls', icon: 'phone', group: 'contact', alwaysAsk: true,
    ...s('Call someone. "to" is a phone number, email, saved person or contact name. "app": phone (default), facetime, whatsapp, discord, telegram, skype, teams, messenger or signal. "video" for a video call.', {
      to: { type: 'string' }, app: { type: 'string', enum: Object.keys(APPS).filter((k) => APPS[k].call) }, video: { type: 'boolean' }, facetime: { type: 'boolean' },
    }, ['to']),
    prepare: async (a) => {
      const app = normApp(a.app) || (a.facetime ? 'facetime' : 'phone');
      return { app, ...(await resolveForApp(a.to, app, a.video ? 'video' : 'call')) };
    },
    ask: (a, who) => ({ title: `${a.video ? 'Video call' : 'Call'} ${who.label}${who.app !== 'phone' ? ` on ${APPS[who.app].label}` : ''}`, detail: explainApp(who.app, who.how, a.video ? 'video' : 'call') }),
    run: async (a, who) => { await call('app.openLink', { url: who.url }); return { to: who.label, app: APPS[who.app].label, how: who.how }; },
    done: (r) => `${r.how === 'starts' ? 'Calling' : 'Opened chat with'} ${r.to}${r.app !== 'Phone' ? ` (${r.app})` : ''}` },
  { name: 'look_at_screen', category: 'screen', icon: 'eye', group: 'look',
    ...s('Let the user point at something on their screen so you can identify it. Use when they ask "what is this?" about something on screen.', { question: { type: 'string' } }),
    ask: () => ({ title: 'Look at what you point to on your screen', detail: 'You choose the spot. Only that area is looked at, on this computer.' }),
    run: async (a) => { bus.emit('look.start', { question: a.question || '', fromAI: true }); return { note: 'The user is now choosing a spot. Their answer will arrive as a new message; do not guess what it is.' }; },
    done: () => 'Look mode started' },
  { name: 'add_to_list', icon: 'list', group: 'lists',
    ...s('Add items to one of the user\'s lists (shopping, to-do, notes, or any list name).', { list: { type: 'string' }, items: { type: 'array', items: { type: 'string' } } }, ['list', 'items']),
    run: async (a) => lists.add(a.list, Array.isArray(a.items) ? a.items : lists.splitItems(a.items)),
    done: (r) => (r.added.length ? `Added ${r.added.length} to ${r.list}` : `Already on ${r.list}`) },
  { name: 'show_list', icon: 'list', group: 'lists',
    ...s('Show what is on one of the user\'s lists.', { list: { type: 'string' } }, ['list']),
    run: async (a) => { const key = lists.normName(a.list); return { list: key, items: lists.open(key).map((i) => i.text), lists: lists.names() }; },
    done: (r) => `${lists.title(r.list)}: ${r.items.length} item${r.items.length === 1 ? '' : 's'}` },
  { name: 'remove_from_list', icon: 'check', group: 'lists',
    ...s('Tick items off a list (when bought or done).', { list: { type: 'string' }, items: { type: 'array', items: { type: 'string' } } }, ['list', 'items']),
    run: async (a) => lists.remove(a.list, Array.isArray(a.items) ? a.items : lists.splitItems(a.items)),
    done: (r) => `Ticked off ${r.removed.length}` },
  { name: 'clear_list', icon: 'trash', group: 'lists', alwaysAsk: true,
    ...s('Empty a list completely.', { list: { type: 'string' } }, ['list']),
    ask: (a) => ({ title: `Empty your ${lists.normName(a.list)} list`, preview: lists.open(a.list).map((i) => '• ' + i.text).join('\n') || 'It’s already empty.' }),
    run: async (a) => lists.clear(a.list), done: (r) => `Emptied ${r.list}` },
  { name: 'save_contact', icon: 'user', group: 'contact',
    ...s('Save a person\'s phone number, or their username in an app (discord DM link, telegram, skype, teams email, messenger, whatsapp number).', { name: { type: 'string' }, number: { type: 'string' }, app: { type: 'string', enum: ['discord', 'telegram', 'skype', 'teams', 'messenger', 'whatsapp'] }, handle: { type: 'string' } }, ['name']),
    run: async (a) => {
      const app = normApp(a.app);
      const p = people.upsert({ name: a.name, phone: a.number || '', ...(app && a.handle ? { [app]: a.handle } : {}) });
      return { name: p.name, number: a.number ? p.phone : '', app: app ? APPS[app].label : '', handle: app ? p[app] : '' };
    },
    done: (r) => `Saved ${r.name}` },
  { name: 'get_weather', net: true, category: 'web', icon: 'sun', group: 'weather',
    ...s('Get the current weather and the forecast for today and tomorrow. Leave place empty for the user\'s home city.', { place: { type: 'string' } }),
    run: async (a) => weather.forecast(a.place), done: (r) => `${r.now.icon} ${r.now.temp}${r.units} in ${r.place.split(',')[0]}` },
  { name: 'set_home_city', net: true, icon: 'home', group: 'weather',
    ...s('Remember the user\'s home city for weather.', { place: { type: 'string' } }, ['place']),
    run: async (a) => weather.setHome(a.place), done: (r) => `Home city: ${r.name}` },
  { name: 'create_project', icon: 'folder', group: 'projects',
    ...s('Create a project (a folder for notes, tasks, documents and chats). Optional goal.', { name: { type: 'string' }, goal: { type: 'string' } }, ['name']),
    run: async (a) => { const pj = await import('./projects.js'); const p = pj.create(a.name, { goal: a.goal || '' }); return { id: p.id, name: p.name }; },
    done: (r) => `Project: ${r.name}` },
  { name: 'add_project_task', icon: 'list', group: 'projects',
    ...s('Add one or more tasks to a project (separate several with ";").', { project: { type: 'string' }, task: { type: 'string' } }, ['project', 'task']),
    run: async (a) => { const pj = await import('./projects.js'); let p = pj.find(a.project); if (!p) p = pj.create(a.project); const added = pj.addTask(p.id, a.task); const pr = pj.progress(p); return { project: p.name, added: added.map((t) => t.text), done: pr.done, total: pr.total }; },
    done: (r) => `${r.added.length} task${r.added.length === 1 ? '' : 's'} → ${r.project}` },
  { name: 'complete_project_task', icon: 'check', group: 'projects',
    ...s('Tick off a task in a project when the user says it is done.', { project: { type: 'string' }, task: { type: 'string' } }, ['project', 'task']),
    run: async (a) => { const pj = await import('./projects.js'); const p = pj.find(a.project); if (!p) throw new Error(`There’s no project called ${a.project}.`); const t = pj.completeTask(p.id, a.task); if (!t) throw new Error(`I couldn’t find “${a.task}” in ${p.name}.`); const pr = pj.progress(p); return { project: p.name, task: t.text, pct: pr.pct, done: pr.done, total: pr.total }; },
    done: (r) => `Done: ${r.task}` },
  { name: 'project_status', icon: 'folder', group: 'projects',
    ...s('How a project is going (progress and open tasks), or a list of all projects when no name is given.', { project: { type: 'string' } }),
    run: async (a) => {
      const pj = await import('./projects.js');
      if (!a.project) return { projects: pj.all().map((p) => ({ name: p.name, ...pj.progress(p) })) };
      const p = pj.find(a.project); if (!p) throw new Error(`There’s no project called ${a.project}.`);
      return { project: p.name, goal: p.goal, ...pj.progress(p), open: p.tasks.filter((t) => !t.done).map((t) => t.text) };
    },
    done: (r) => (r.projects ? `${r.projects.length} projects` : `${r.project}: ${r.pct}%`) },
  { name: 'generate_image', icon: 'image', group: 'look', needs: 'imageGen',
    ...s('Make a picture from a description (Mac app, using Ollama\'s free FLUX.2 Klein picture model). Takes a minute or two.', { prompt: { type: 'string' } }, ['prompt']),
    run: async (a) => {
      const o = await import('./ollama.js');
      if (o.engine.status === 'online' && !o.engine.models.some((m) => /^x\/(flux2-klein|z-image-turbo)/.test(m.name))) throw new Error('To make pictures I need Ollama’s free picture model, FLUX.2 Klein (5.7 GB, downloaded once). Say “download the picture model”.');
      const r = await call('image.generate', { prompt: a.prompt, model: o.engine.models.some((m) => /^x\/z-image-turbo/.test(m.name)) && !o.engine.models.some((m) => /^x\/flux2-klein/.test(m.name)) ? 'x/z-image-turbo' : 'x/flux2-klein' });
      return { prompt: a.prompt, picture: `data:${r.type};base64,${r.image}` };
    },
    done: () => 'Picture made' },
  // ---- Mac computer control (windows, brightness, Trash, apps, storage, duplicates, health check)
  { name: 'window_control', icon: 'display', group: 'apps', needs: 'macControl', category: 'apps',
    ...s('Move or resize the window of the app the user was just using (or a named app): minimize, maximize, fullscreen, exit_fullscreen, left (left half), right (right half), center, close.', { action: { type: 'string', enum: ['minimize', 'maximize', 'fullscreen', 'exit_fullscreen', 'left', 'right', 'center', 'close'] }, app: { type: 'string' } }, ['action']),
    run: async (a) => call('mac.window', { action: a.action, app: a.app || '' }), done: (r) => `${r.app}: ${r.action}` },
  { name: 'set_brightness', icon: 'sun', group: 'system', needs: 'macControl', category: 'system',
    ...s('Make the screen brighter or dimmer (like pressing the brightness keys). steps 1–16.', { direction: { type: 'string', enum: ['up', 'down'] }, steps: { type: 'number' } }, ['direction']),
    run: async (a) => call('mac.brightness', { direction: a.direction, steps: a.steps || 3 }), done: (r) => `Brightness ${r.direction}` },
  { name: 'empty_trash', icon: 'trash', group: 'files', needs: 'macControl', category: 'writeFiles', alwaysAsk: true,
    ...s('Empty the Trash (permanently deletes what is in it). Always confirm.', {}),
    prepare: async () => call('mac.trashInfo', {}),
    ask: (a, p) => ({ title: `Empty the Trash (${p.count} item${p.count === 1 ? '' : 's'})`, detail: 'These are deleted for good and can’t be brought back.' }),
    run: async () => call('mac.emptyTrash', {}), done: (r) => `Emptied ${r.emptied}` },
  { name: 'running_apps', icon: 'app', group: 'status', needs: 'macControl',
    ...s('Which apps are open, with how much memory and CPU each uses.', {}),
    run: async () => call('mac.runningApps', {}), done: (r) => `${r.apps.length} apps open` },
  { name: 'storage_report', icon: 'database', group: 'status', needs: 'macControl',
    ...s('What is using disk space: folder sizes in the home folder and the biggest files.', {}),
    run: async () => call('mac.storage', {}), done: () => 'Storage checked' },
  { name: 'find_duplicates', icon: 'copy', group: 'files', needs: 'macControl', category: 'findFiles',
    ...s('Find duplicate files (same content) in a folder (default Downloads).', { folder: { type: 'string' } }),
    run: async (a) => { const r = await call('mac.duplicates', { folder: a.folder || '' }); lastDupes = r; return r; }, done: (r) => `${r.groups.length} duplicate sets` },
  { name: 'trash_duplicates', icon: 'trash', group: 'files', needs: 'macControl', category: 'organize', alwaysAsk: true,
    ...s('Move the extra copies from the last duplicate search to the Trash (keeps one of each). Recoverable from the Trash.', {}),
    prepare: async () => { if (!lastDupes?.groups?.length) throw new Error('Find duplicates first: say “find duplicate files in Downloads”.'); return { paths: lastDupes.groups.flatMap((g) => g.paths.slice(1)) }; },
    ask: (a, p) => ({ title: `Move ${p.paths.length} extra cop${p.paths.length === 1 ? 'y' : 'ies'} to the Trash`, detail: 'One copy of each file is kept. You can get them back from the Trash.', preview: p.paths.slice(0, 12).map((x) => '• ' + x.split('/').pop()).join('\n') }),
    run: async (a, p) => { const r = await call('mac.trashFiles', { paths: p.paths }); lastDupes = null; return r; }, done: (r) => `Moved ${r.moved} to Trash` },
  { name: 'diagnose_computer', icon: 'cpu', group: 'status', needs: 'status',
    ...s('Check the computer for common problems (low storage, memory pressure, heavy apps, battery, long uptime, AI engine) and explain them.', {}),
    run: async () => diagnose(), done: (r) => `${r.findings.length} findings` },
  { name: 'save_link', icon: 'globe', group: 'basics',
    ...s('Save a web link for the user to read later (their Saved links).', { url: { type: 'string' }, note: { type: 'string' } }, ['url']),
    run: async (a) => { const L = await import('./links.js'); const l = L.add(a.url, { note: a.note || '' }); return { url: l.url, title: l.title, existed: !!l.existed, count: L.all().length }; },
    done: (r) => `Saved ${r.title}` },
  { name: 'show_links', icon: 'globe', group: 'basics',
    ...s('List the user\'s saved links (optionally matching some words).', { query: { type: 'string' } }),
    run: async (a) => { const L = await import('./links.js'); const items = (a.query ? L.search(a.query) : L.all().filter((l) => !l.read)).slice(0, 12); return { links: items.map((l) => ({ title: l.title, url: l.url })), total: L.all().length }; },
    done: (r) => `${r.links.length} links` },
  { name: 'summarize_page', net: true, icon: 'globe', group: 'web', needs: 'webFetch', category: 'web',
    ...s('Read a web page and return its text so you can summarize or answer questions about it (Mac app).', { url: { type: 'string' } }, ['url']),
    run: async (a) => { const L = await import('./links.js'); const p = await L.pageText(L.findUrl(a.url) || a.url); return { title: p.title, text: p.text.slice(0, 12000) }; },
    done: (r) => `Read ${r.title || 'the page'}` },
  { name: 'take_screenshot', icon: 'display', group: 'files', needs: 'screenshot', category: 'screen',
    ...s('Take a screenshot of the screen and save it to the Desktop.', {}),
    run: async () => call('screenshot.save', {}), reveal: (r) => r.path, done: (r) => `Saved ${r.name}` },
  { name: 'create_folder', icon: 'folder', group: 'files', needs: 'files', category: 'writeFiles',
    ...s('Make a new folder. "in": Desktop, Documents, Downloads or a path inside the home folder (default Desktop).', { name: { type: 'string' }, in: { type: 'string' } }, ['name']),
    ask: (a) => ({ title: `Make a folder “${a.name}”`, detail: `In ${a.in || 'Desktop'}` }),
    run: async (a) => call('tool.create_folder', { name: a.name, in: a.in || '' }), reveal: (r) => r.path, done: (r) => `Folder ${r.name}` },
  { name: 'rename_file', icon: 'edit', group: 'files', needs: 'files', category: 'writeFiles', alwaysAsk: true,
    ...s('Rename a file or folder. "file" is its full path, or its name (found with Spotlight).', { file: { type: 'string' }, new_name: { type: 'string' } }, ['file', 'new_name']),
    prepare: async (a) => {
      if (/^[~/]/.test(a.file)) return { path: a.file };
      const f = await call('tool.find_files', { query: a.file, limit: 5 });
      const exact = (f.files || []).find((x) => x.name.toLowerCase() === String(a.file).toLowerCase()) || (f.files || [])[0];
      if (!exact) throw new Error(`I couldn’t find “${a.file}”.`);
      return { path: exact.path };
    },
    ask: (a, p) => ({ title: `Rename to “${a.new_name}”`, detail: p.path }),
    run: async (a, p) => call('tool.rename', { path: p.path, name: a.new_name }), reveal: (r) => r.path, done: (r) => `${r.from} → ${r.name}` },
  { name: 'read_clipboard', icon: 'copy', group: 'basics', needs: 'clipboard', category: 'screen',
    ...s('Read the text the user copied (their clipboard), e.g. to summarize, translate or explain it.', {}),
    run: async () => { const r = await call('clipboard.read', {}); if (!r?.text?.trim()) throw new Error('Your clipboard has no text right now.'); return { text: r.text.slice(0, 12000), chars: r.text.length }; },
    done: (r) => `Read ${r.chars} characters` },
  { name: 'copy_to_clipboard', icon: 'copy', group: 'basics',
    ...s('Put text on the clipboard so the user can paste it.', { text: { type: 'string' } }, ['text']),
    run: async (a) => { await call('clipboard.write', { text: a.text }); return { chars: a.text.length }; }, done: () => 'Copied' },
  { name: 'focus_session', icon: 'target', group: 'focus',
    ...s('Start or stop a focus session (Pomodoro). While focusing, non-urgent alerts wait until it ends.', { action: { type: 'string', enum: ['start', 'stop', 'status'] }, minutes: { type: 'number' }, task: { type: 'string' } }, ['action']),
    run: async (a) => { const P = await import('./planner.js'); if (a.action === 'stop') { const r = P.stopFocus(false); if (!r) throw new Error('There’s no focus session running.'); return { stopped: true, ...r }; } if (a.action === 'status') return { ...P.focusState(), stats: P.focusStats(1) }; return P.startFocus(a.minutes || 25, a.task || ''); },
    done: (r) => (r.stopped ? `Focus: ${r.minutes} min` : r.running ? `Focus ${r.left}` : 'No focus session') },
  { name: 'note_distraction', icon: 'note', group: 'focus',
    ...s('During a focus session, save a stray thought for later without breaking focus.', { text: { type: 'string' } }, ['text']),
    run: async (a) => { const P = await import('./planner.js'); const n = P.addDistraction(a.text); if (!n) { const l = await import('./lists.js'); l.add('to-do', [a.text]); return { saved: 'to-do' }; } return { saved: 'focus', count: n }; },
    done: () => 'Saved for later' },
  { name: 'create_automation', icon: 'clock', group: 'planner',
    ...s('Schedule something to run again and again. "every": day, weekday, week, month, hour, morning, evening or a weekday name; "at": a time like 8am; "command": what to do, in the user\'s words (e.g. "open Spotify", "/workday", "tell me the weather").', { every: { type: 'string' }, at: { type: 'string' }, command: { type: 'string' } }, ['every', 'command']),
    run: async (a) => { const A = await import('./automations.js'); const r = A.fromWords(a); return { id: r.id, when: r.when, command: a.command }; },
    done: (r) => `Automation: ${r.when}` },
  { name: 'add_habit', icon: 'target', group: 'planner',
    ...s('Start tracking a daily habit.', { habit: { type: 'string' } }, ['habit']),
    run: async (a) => { const P = await import('./planner.js'); const hb = P.addHabit(a.habit); return { habit: hb.name }; }, done: (r) => `Habit: ${r.habit}` },
  { name: 'check_habit', icon: 'check', group: 'planner',
    ...s('Tick off a habit for today when the user says they did it.', { habit: { type: 'string' } }, ['habit']),
    run: async (a) => { const P = await import('./planner.js'); const hb = P.checkHabit(a.habit, true); return { habit: hb.name, streak: hb.streak }; }, done: (r) => `${r.habit} ✓` },
  { name: 'habits_summary', icon: 'target', group: 'planner',
    ...s('The user\'s habits: which are done today and their streaks.', {}),
    run: async () => { const P = await import('./planner.js'); const t = P.dayKey(); return { habits: P.all().habits.map((hb) => ({ name: hb.name, today: !!hb.days[t], streak: P.streak(hb) })) }; }, done: (r) => `${r.habits.length} habits` },
  { name: 'add_goal', icon: 'target', group: 'planner',
    ...s('Set a goal. "target" and "unit" when it is countable (12 books, 500 dollars).', { goal: { type: 'string' }, target: { type: 'number' }, unit: { type: 'string' } }, ['goal']),
    run: async (a) => { const P = await import('./planner.js'); const m = !a.target && String(a.goal).match(/(\d+(?:\.\d+)?)\s*([\p{L}%$€£]+)?/u); const g = P.addGoal({ title: a.goal, target: a.target || (m ? +m[1] : 0), unit: a.unit || m?.[2] || '' }); return { goal: g.title, target: g.target, unit: g.unit }; }, done: (r) => `Goal: ${r.goal}` },
  { name: 'update_goal', icon: 'target', group: 'planner',
    ...s('Add progress to a goal (amount), or set it (set=true).', { goal: { type: 'string' }, amount: { type: 'number' }, set: { type: 'boolean' } }, ['goal', 'amount']),
    run: async (a) => { const P = await import('./planner.js'); const g = P.updateGoal(a.goal, a.amount, { set: !!a.set }); return { goal: g.title, progress: g.progress, target: g.target, unit: g.unit, pct: g.pct }; }, done: (r) => `${r.goal}: ${r.pct}%` },
  { name: 'goals_summary', icon: 'target', group: 'planner',
    ...s('The user\'s goals and how far along each one is.', {}),
    run: async () => { const P = await import('./planner.js'); return { goals: P.all().goals.map((g) => ({ goal: g.title, progress: g.progress, target: g.target, unit: g.unit, pct: P.goalPct(g) })) }; }, done: (r) => `${r.goals.length} goals` },
  { name: 'log_money', icon: 'calculator', group: 'planner',
    ...s('Record money spent (expense) or received (income) in the budget.', { amount: { type: 'number' }, note: { type: 'string' }, kind: { type: 'string', enum: ['expense', 'income'] } }, ['amount']),
    run: async (a) => { const P = await import('./planner.js'); const e = P.logMoney({ amount: a.amount, note: a.note || '', kind: a.kind || 'expense' }); return { amount: P.money(e.amount), note: e.note, kind: e.kind, category: e.category, spent: P.money(e.month.spent), left: e.month.left != null ? P.money(e.month.left) : null, over: e.month.over }; },
    done: (r) => `${r.kind === 'income' ? '+' : '−'}${r.amount} ${r.note}` },
  { name: 'budget_summary', icon: 'calculator', group: 'planner',
    ...s('This month\'s spending, income and budget.', {}),
    run: async () => { const P = await import('./planner.js'); const m = P.monthSummary(); return { spent: P.money(m.spent), income: P.money(m.income), left: m.left != null ? P.money(m.left) : null, budget: m.budget ? P.money(m.budget) : null, over: m.over, top: m.byCategory.slice(0, 4).map(([k, v]) => `${k} ${P.money(v)}`) }; }, done: (r) => `Spent ${r.spent}` },
  { name: 'set_budget', icon: 'calculator', group: 'planner',
    ...s('Set the monthly spending budget.', { amount: { type: 'number' } }, ['amount']),
    run: async (a) => { const P = await import('./planner.js'); P.setMonthlyBudget(a.amount); return { budget: P.money(a.amount) }; }, done: (r) => `Budget ${r.budget}` },
  { name: 'stopwatch', icon: 'clock', group: 'planner',
    ...s('Control the stopwatch: start, stop, lap, reset or check.', { action: { type: 'string', enum: ['start', 'stop', 'lap', 'reset', 'check'] } }, ['action']),
    run: async (a) => { const P = await import('./planner.js'); const st = { start: P.startStopwatch, stop: P.stopStopwatch, lap: P.lap, reset: P.resetStopwatch, check: P.stopwatch }[a.action || 'check'](); return { action: a.action, running: st.running, time: P.fmtMs(st.ms), spoken: P.spokenTime(st.ms), laps: st.laps.length }; },
    done: (r) => `Stopwatch ${r.time}` },
  { name: 'set_mode', icon: 'sparkles', group: 'basics',
    ...s('Switch the AI mode: assistant (normal), study, developer, research, creative, professional, teacher, translator, troubleshoot or planning. For translator, "language" is the target language.', { mode: { type: 'string', enum: ['assistant', 'study', 'developer', 'research', 'creative', 'professional', 'teacher', 'translator', 'troubleshoot', 'planning'] }, language: { type: 'string' } }, ['mode']),
    run: async (a) => { const m = await import('./modes.js'); return m.setMode(m.find(a.mode) || a.mode, a.language); },
    done: (r) => `${r.label} mode` },
  { name: 'go_home', icon: 'home', group: 'home',
    ...s('Directions home from where the user is now (opens Maps). "mode": drive, walk, transit or cycle.', { mode: { type: 'string', enum: ['drive', 'walk', 'transit', 'cycle'] } }),
    run: async (a) => {
      const home = String(settings.profile?.home || '').trim();
      if (!home) throw new Error('Where is home? Say “my home address is 12 Main Street, Toronto” once. It stays on this device.');
      const l = homeLink(home, a.mode);
      await call('app.openLink', { url: l.url });
      return { mode: l.mode, app: l.app };
    },
    done: (r) => `Directions home (${r.mode})` },
  { name: 'set_home_address', icon: 'home', group: 'home',
    ...s('Save the user\'s home address for "take me home". Only stored on this device.', { address: { type: 'string' } }, ['address']),
    run: async (a) => {
      const addr = String(a.address || '').trim().replace(/[.]+$/, '');
      if (addr.length < 4) throw new Error('That address looks too short.');
      set('profile.home', addr);
      return { address: addr };
    },
    done: () => 'Home address saved' },
  { name: 'add_event', category: 'reminders', icon: 'clock', group: 'reminders',
    ...s('Add an event to the user\'s calendar. "when" in the user\'s words ("tomorrow at 3pm", "March 3 at 10am"); minutes = length.', { title: { type: 'string' }, when: { type: 'string' }, minutes: { type: 'number' }, location: { type: 'string' } }, ['title', 'when']),
    ask: (a) => ({ title: `Add “${a.title}” to your calendar`, detail: a.when }),
    run: async (a) => {
      const { parseWhen } = await import('./when.js');
      const p = parseWhen(a.when);
      if (!p) throw new Error(`I couldn’t understand the time “${a.when}”. Try “tomorrow at 3pm” or “March 3 at 10am”.`);
      const start = p.date.getTime(), end = start + (Number(a.minutes) || 60) * 60000;
      const human = describeWhen(p.date);
      if (can('calendar')) { await call('calendar.add', { title: a.title, start, end, location: a.location || '' }); return { title: a.title, when: human, where: 'calendar' }; }
      // Browser/phone: a calendar file that opens “Add to Calendar”.
      const z = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
      const esc = (x) => String(x).replace(/[\\;,]/g, (c) => '\\' + c);
      const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//JARVIS//Events//EN', 'BEGIN:VEVENT', `UID:${Date.now()}@jarvis.local`, `DTSTAMP:${z(Date.now())}`, `DTSTART:${z(start)}`, `DTEND:${z(end)}`, `SUMMARY:${esc(a.title)}`, a.location ? `LOCATION:${esc(a.location)}` : '', 'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(a.title)}`, 'TRIGGER:-PT15M', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR', ''].filter(Boolean).join('\r\n');
      await call('file.save', { name: `${a.title.replace(/[^\w\- ]+/g, '').slice(0, 40) || 'Event'}.ics`, content: ics, type: 'text/calendar' });
      return { title: a.title, when: human, where: 'file' };
    },
    done: (r) => `Event: ${r.title}` },
  { name: 'save_birthday', icon: 'heart', group: 'reminders',
    ...s('Remember someone\'s birthday and remind the user every year on the day. date like "March 3" or "3/14".', { name: { type: 'string' }, date: { type: 'string' } }, ['name', 'date']),
    run: async (a) => {
      const { monthDay } = await import('./when.js');
      const d = monthDay(a.date);
      if (!d) throw new Error(`I couldn’t read the date “${a.date}”. Try “March 3”.`);
      const who = String(a.name).replace(/^my /i, '').trim();
      const p = people.upsert({ name: who, allowEmpty: true, birthday: `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` });
      d.setHours(9, 0, 0, 0);
      if (d.getTime() < Date.now()) d.setFullYear(d.getFullYear() + 1);
      const r = await reminders.add(`🎂 It’s ${p.name}’s birthday today`, d, { repeat: 'yearly' });
      return { name: p.name, date: d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' }), next: r.human };
    },
    done: (r) => `${r.name}: ${r.date}` },
  { name: 'get_news', net: true, category: 'web', icon: 'globe', group: 'news',
    ...s('Today\'s news headlines (Wikipedia current events; BBC too in the Mac app), optionally about a topic.', { topic: { type: 'string' } }),
    run: async (a) => (await import('./news.js')).headlines({ topic: a.topic || '' }),
    done: (r) => `${r.items.length} headlines` },
  { name: 'evening_summary', icon: 'moon', group: 'briefing',
    ...s('The user\'s daily report / evening summary: what they got done today (to-dos, project tasks, habits, workouts, focus, missions) and what is coming tomorrow.', {}),
    run: async () => { const b = await import('./briefing.js'); if (new Date().getHours() >= 17) set('briefing.lastEvening', b.todayKey()); return b.buildEvening(); },
    done: () => 'Daily report ready' },
  { name: 'morning_briefing', icon: 'coffee', group: 'briefing',
    ...s('The user\'s briefing for today: weather, calendar, reminders and to-do list. Use for "good morning", "what\'s my day", "what do I need to do today".', {}),
    run: async () => { const b = await import('./briefing.js'); if (new Date().getHours() < 14) set('briefing.last', b.todayKey()); return b.build(); },
    done: () => 'Briefing ready' },
  { name: 'remember', category: 'memory', icon: 'brain', group: 'memory',
    ...s('Save a short fact about the user to long-term memory, only when they ask you to remember something or share a lasting preference.', { fact: { type: 'string' } }, ['fact']),
    run: async (a) => { const m = await memory.add(a.fact, 'jarvis'); return { saved: m.text }; }, done: (r) => `Remembered: ${truncate(r.saved, 46)}` },
  { name: 'forget', category: 'memory', icon: 'trash', group: 'memory',
    ...s('Delete memories that match some words, when the user asks you to forget something.', { about: { type: 'string' } }, ['about']),
    prepare: async (a) => ({ matches: memory.search(a.about) }),
    ask: (a, p) => ({ title: `Forget ${p.matches.length} memor${p.matches.length === 1 ? 'y' : 'ies'}`, preview: p.matches.map((m) => '• ' + m.text).join('\n') || 'Nothing matches.' }),
    run: async (a, p) => { for (const m of p.matches) await memory.remove(m.id); return { removed: p.matches.length }; }, done: (r) => `Forgot ${r.removed}` },
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));
export const byName = (n) => BY_NAME.get(n) || customTools.get(n);

// Custom skills register extra tools here (see skills.js).
const customTools = new Map();
export function registerCustom(tool) { customTools.set(tool.name, tool); }
export function clearCustom() { customTools.clear(); }

export const GROUPS = {
  basics: { label: 'Calculator, time, timers, status', icon: 'calculator' },
  apps: { label: 'Apps and folders', icon: 'app' },
  web: { label: 'Websites and web search', icon: 'globe' },
  files: { label: 'Files and documents', icon: 'folder' },
  system: { label: 'System controls and Shortcuts', icon: 'sliders' },
  commands: { label: 'Terminal commands', icon: 'terminal' },
  memory: { label: 'Memory', icon: 'brain' },
  reminders: { label: 'Reminders', icon: 'bell' },
  lists: { label: 'Lists (shopping, to-do, notes)', icon: 'list' },
  contact: { label: 'Texts and calls', icon: 'message' },
  look: { label: 'What’s this? (screen and pictures)', icon: 'eye' },
  weather: { label: 'Weather', icon: 'sun' },
  fitness: { label: 'Workout coach and log', icon: 'zap' },
  convert: { label: 'Unit converter', icon: 'calculator' },
  status: { label: 'System report', icon: 'cpu' },
  home: { label: 'Take me home (directions)', icon: 'home' },
  projects: { label: 'Projects (notes, tasks, documents)', icon: 'folder' },
  planner: { label: 'Planner (habits, goals, budget)', icon: 'target' },
  briefing: { label: 'Morning briefing', icon: 'coffee' },
  news: { label: 'News headlines', icon: 'globe' },
  focus: { label: 'Focus sessions', icon: 'target' },
  creator: { label: 'Creator (slides, spreadsheets, websites)', icon: 'wand' },
  translator: { label: 'Live translator', icon: 'language' },
  missions: { label: 'Mission Control', icon: 'zap' },
  research: { label: 'Deep research and fact check', icon: 'search' },
};

/** Local-only mode: nothing that uses the internet. */
export const localOnly = () => !!settings.privacy?.localOnly;
const privateChat = () => !!sessionsMod?.state?.current?.private;
let sessionsMod = null;
import('./sessions.js').then((m) => { sessionsMod = m; });

export function available(tool) {
  if (tool.needs && !can(tool.needs)) return false;
  if (tool.net && localOnly()) return false;
  if (tool.category === 'memory' && privateChat()) return false;
  if ((settings.skills?.disabledGroups || []).includes(tool.group)) return false;
  if (tool.category === 'memory' && !settings.memory.allowSave) return false;
  if (tool.category && tool.category !== 'memory' && settings.permissions[tool.category] === 'off') return false;
  return true;
}

/** Tool schemas for the model (only abilities that are on and available here). */
export function schemas() {
  const list = [...TOOLS, ...customTools.values()].filter(available);
  return list.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: { type: 'object', properties: t.props || {}, required: t.required || [] } },
  }));
}

function levelFor(tool) {
  if (!tool.category || tool.category === 'memory') return 'allow';
  return settings.permissions[tool.category] || 'ask';
}

/**
 * Run an ability with permission checks.
 * ctx.confirm({tool, args, info}) => Promise<'allow'|'always'|'deny'>
 */
export async function execute(name, args = {}, ctx = {}) {
  const tool = byName(name);
  if (!tool) return { ok: false, error: `There is no ability called ${name}.` };
  if (tool.needs && !can(tool.needs)) return { ok: false, error: isNative ? 'This ability is not supported on this device yet.' : 'This ability needs the JARVIS desktop app.' };
  if ((settings.skills?.disabledGroups || []).includes(tool.group)) return { ok: false, declined: true, error: 'That plugin is turned off. Turn it on in Settings → Plugins.' };
  if (tool.net && localOnly()) return { ok: false, declined: true, error: 'Local-only mode is on, so I don’t use the internet. Turn it off in Settings → Privacy & Data to use this.' };
  if (tool.category === 'memory' && privateChat()) return { ok: false, declined: true, error: 'This is a private chat, so nothing is remembered.' };
  const level = ctx.preApproved && tool.category !== 'commands' ? 'allow' : levelFor(tool);
  const label = CATEGORIES[tool.category]?.label || tool.name;
  if (level === 'off') return { ok: false, declined: true, error: `The user switched off "${label}" in Settings → Permissions.` };

  let prepared = null;
  try { if (tool.prepare) prepared = await tool.prepare(args); } catch (e) { return { ok: false, error: e.message }; }
  const skip = tool.skipIf?.(args, prepared);
  if (skip) return skip;

  // Texts and calls to yourself don't need a confirmation card: you asked for them.
  if ((level === 'ask' || tool.alwaysAsk) && !tool.selfOk?.(args)) {
    const info = tool.ask ? tool.ask(args, prepared) : { title: tool.name };
    const answer = ctx.confirm ? await ctx.confirm({ tool, args, info }) : 'deny';
    if (answer === 'deny') {
      logActivity({ tool: name, args: brief(args), result: 'declined' });
      return { ok: false, declined: true, error: 'The user declined this action. Do not try again unless they ask.' };
    }
    if (answer === 'always' && tool.category && tool.category !== 'commands') set(`permissions.${tool.category}`, 'allow');
  }
  try {
    bus.emit('tool.start', { name, args });
    const result = await tool.run(args, prepared, ctx);
    logActivity({ tool: name, args: brief(args), result: 'ok' });
    return { ok: true, ...result };
  } catch (e) {
    logActivity({ tool: name, args: brief(args), result: 'error: ' + e.message });
    return { ok: false, error: e.message };
  } finally { bus.emit('tool.end', { name }); }
}

/** What the model sees from a result: compact JSON, outside text clearly fenced as data. */
export function resultForModel(name, res) {
  const tool = byName(name);
  let payload = res;
  if (res.ok && tool?.forModel) payload = { ok: true, ...tool.forModel(res) };
  let text = JSON.stringify(payload);
  if (text.length > 12000) text = text.slice(0, 12000) + '…(truncated)';
  return text;
}

export function summary(name, res, args) {
  const tool = byName(name);
  if (!res.ok) return res.declined ? `Declined: ${tool?.ask?.(args, {})?.title || name}` : `Couldn’t ${humanName(name)}: ${truncate(res.error, 80)}`;
  try { return tool?.done ? tool.done(res, args) : humanName(name); } catch { return humanName(name); }
}

const humanName = (n) => n.replace(/_/g, ' ');
const brief = (a) => truncate(JSON.stringify(a), 160);

export function normalizeUrl(u) {
  u = String(u || '').trim();
  if (!/^[a-z][\w+.-]*:/i.test(u)) u = 'https://' + u.replace(/^\/+/, '');
  if (!/^(https?|mailto):/i.test(u)) throw new Error('Only web links can be opened.');
  return u;
}
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

// ---------------------------------------------------------------- timers
export const timers = new Map();
function startTimer(minutes, label = '') {
  if (!(minutes > 0) || minutes > 24 * 60) throw new Error('Pick between a few seconds and 24 hours.');
  const id = 't' + Date.now();
  const ms = Math.round(minutes * 60000);
  const human = minutes < 1 ? `${Math.round(minutes * 60)} seconds` : minutes % 1 === 0 ? `${minutes} minute${minutes === 1 ? '' : 's'}` : `${Math.floor(minutes)} min ${Math.round((minutes % 1) * 60)} s`;
  const handle = setTimeout(() => {
    timers.delete(id);
    bus.emit('timer.done', { id, label, human });
    call('app.notify', { title: `${settings.assistantName}: timer done`, body: label || `${human} timer finished` }).catch(() => {});
  }, ms);
  timers.set(id, { id, label, ends: Date.now() + ms, handle, human });
  bus.emit('timer.start', timers.get(id));
  return { id, human: label ? `${human} (${label})` : human, endsAt: new Date(Date.now() + ms).toLocaleTimeString() };
}

// ---------------------------------------------------------------- recipients
/** Turn "me", a number, an email or a contact name into {label, address}. */
async function resolveRecipient(to, { forCall = false } = {}) {
  const raw = String(to || '').trim();
  if (!raw) throw new Error('Who should it go to?');
  const saved = people.find(raw);
  if (saved && !/^(me|myself)$/i.test(raw)) return { label: saved.name, address: saved.phone };
  if (/^(me|myself|my phone|self)$/i.test(raw)) {
    const mine = settings.profile?.phone?.trim();
    if (!mine) throw new Error('Tell me your number first: say “my number is +1 555 123 4567” (or add it in Settings → General). It stays on this device.');
    return { label: 'you', address: mine };
  }
  const digits = raw.replace(/[\s().-]/g, '');
  if (/^\+?\d{3,15}$/.test(digits)) return { label: raw, address: digits };
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return { label: raw, address: raw };
  if (!can('contacts')) throw new Error(`I don’t have a number for ${raw} yet. Say “save ${raw.replace(/^my /i, '')}’s number as +1 555 123 4567” once, then try again.`);
  const found = await call('contacts.find', { name: raw });
  const list = (found?.matches || []).filter((m) => (forCall ? m.phones?.length : m.phones?.length || m.emails?.length));
  if (!list.length) throw new Error(`I couldn’t find ${raw} in your contacts.`);
  const c = list[0];
  const address = c.phones?.[0] || c.emails?.[0];
  return { label: `${c.name}${list.length > 1 ? ` (best of ${list.length} matches)` : ''}`, address };
}

// ---------------------------------------------------------------- system report extras (web)
function appStats() {
  const sum = workout.summary(7);
  return {
    app: {
      upcomingReminders: reminders.upcoming().length,
      listItems: lists.names().reduce((n, k) => n + lists.open(k).length, 0),
      workoutsThisWeek: sum.sessions, streak: sum.streak, people: people.all().length, memories: memory.all().length,
    },
  };
}

// ---------------------------------------------------------------- calls to you
const CALL_URL = 'https://szeszeming2-lgtm.github.io/jarvis/';
/** Maps link for directions home: Apple Maps on Apple devices, Google Maps elsewhere. */
export function homeLink(home, mode = settings.profile?.travel) {
  const m = { drive: 'd', driving: 'd', car: 'd', d: 'd', walk: 'w', walking: 'w', w: 'w', transit: 'r', bus: 'r', train: 'r', r: 'r', cycle: 'c', bike: 'c', cycling: 'c', c: 'c' }[String(mode || 'd').toLowerCase()] || 'd';
  const word = { d: 'driving', w: 'walking', r: 'transit', c: 'cycling' }[m];
  const pref = settings.profile?.maps || 'auto';
  const apple = pref === 'apple' || (pref === 'auto' && /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent));
  const enc = encodeURIComponent(home);
  if (apple && m !== 'c') return { app: 'Apple Maps', mode: word, url: `${isNative ? 'maps://' : 'https://maps.apple.com/'}?daddr=${enc}&dirflg=${m}` };
  return { app: 'Google Maps', mode: word, url: `https://www.google.com/maps/dir/?api=1&destination=${enc}&travelmode=${{ d: 'driving', w: 'walking', r: 'transit', c: 'bicycling' }[m]}` };
}

let lastDupes = null;

/** Rule-based health check (the AI explains it in plain words). */
async function diagnose() {
  const s = await call('system.status');
  const findings = [];
  const gb = (b) => (b / 1e9).toFixed(1) + ' GB';
  if (s.diskFree != null) { const pct = s.diskTotal ? (s.diskFree / s.diskTotal) * 100 : null; if (s.diskFree < 15e9 || (pct != null && pct < 10)) findings.push({ level: 'high', text: `Storage is nearly full (${gb(s.diskFree)} free). Macs slow down when space is low.`, fix: 'Say “storage report” to see what’s big, empty the Trash, or “find duplicate files”.' }); }
  const memPct = s.memTotal ? (s.memUsed / s.memTotal) * 100 : 0;
  if (memPct > 88) findings.push({ level: 'mid', text: `Memory is ${Math.round(memPct)}% used.`, fix: 'Quit apps you aren’t using (say “what apps are running”).' });
  if (s.cpu > 85) findings.push({ level: 'mid', text: `The processor is busy (${Math.round(s.cpu)}%).`, fix: 'Something is working hard; check running apps.' });
  if (s.battery?.level != null && s.battery.level < 15 && !s.battery.charging) findings.push({ level: 'mid', text: `Battery is low (${Math.round(s.battery.level)}%).`, fix: 'Plug in soon.' });
  if (s.uptime > 14 * 86400) findings.push({ level: 'low', text: `Your Mac hasn’t restarted in ${Math.round(s.uptime / 86400)} days.`, fix: 'A restart clears memory and finishes updates.' });
  let heavy = [];
  if (can('macControl')) { try { heavy = (await call('mac.runningApps', {})).apps.filter((a) => a.memoryMB > 1500 || a.cpu > 50).slice(0, 3); } catch {} }
  for (const a of heavy) findings.push({ level: 'low', text: `${a.name} is using ${a.memoryMB > 1000 ? (a.memoryMB / 1024).toFixed(1) + ' GB of memory' : a.memoryMB + ' MB'}${a.cpu > 50 ? ` and ${Math.round(a.cpu)}% CPU` : ''}.`, fix: `Quit ${a.name} if you’re not using it.` });
  const ol = await import('./ollama.js');
  if (!ol.isPhone() && ol.engine.status !== 'online') findings.push({ level: 'mid', text: 'The AI engine (Ollama) isn’t running.', fix: 'Open AI Models and press Start.' });
  if (!navigator.onLine) findings.push({ level: 'low', text: 'You’re offline.', fix: 'Weather, research and sync need the internet; everything else works.' });
  return { findings, cpu: Math.round(s.cpu), memPct: Math.round(memPct), diskFree: s.diskFree, battery: s.battery?.level ?? null };
}

/** Make the user's iPhone alert now (iCloud Reminders, Mac app). Removed again after 15 minutes. */
async function ringPhone(title, notes = '') {
  if (!can('phoneAlert') || settings.profile?.phoneAlerts === false) return false;
  try {
    const r = await call('phone.alert', { title, notes, inSeconds: 40 });
    setTimeout(() => call('reminders.remove', { id: r.id }).catch(() => {}), 15 * 60000);
    return true;
  } catch { return false; }
}

/** The text that rings your phone: tapping the link opens JARVIS's incoming-call screen. */
export function callText(message) {
  const name = settings.assistantName || 'JARVIS';
  const link = `${CALL_URL}#call=${encodeURIComponent(String(message || '').slice(0, 300))}&from=${encodeURIComponent(name)}`;
  return `📞 ${name} is calling you${message ? ` about: ${message}` : ''}. Tap to answer: ${link}`;
}

// ---------------------------------------------------------------- other apps
/** Who + how for a call or message in another app. */
async function resolveForApp(to, app, kind, message = '') {
  const raw = String(to || '').trim().replace(/^my /i, '');
  let person = null;
  if (/^(me|myself)$/i.test(raw)) {
    if (!settings.profile?.phone) throw new Error('Tell me your number first: say “my number is +1 555 123 4567”.');
    person = { name: 'you', phone: settings.profile.phone };
  } else if (/^\+?[\d\s().-]{5,20}$/.test(raw) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) person = { name: raw, phone: raw };
  else person = people.find(raw);
  if (!person && can('contacts')) {
    const found = await call('contacts.find', { name: raw });
    const c = found?.matches?.[0];
    if (c) person = { name: c.name, phone: c.phones?.[0] || c.emails?.[0] || '' };
  }
  if (!person) throw new Error(`I don’t have ${raw} saved yet. Say “save ${raw}’s number as +1 555 123 4567”${app !== 'phone' && app !== 'messages' ? ` or “save ${raw}’s ${app} as …”` : ''}, or add them under Lists & People.`);
  const l = appLink(app, person, kind, message);
  return { label: person.name, url: l.url, how: l.how };
}

async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return; } catch {}
  try { await call('app.copy', { text: t }); } catch {}
}
