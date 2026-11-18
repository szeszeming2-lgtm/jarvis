// Abilities JARVIS can use, with transparent permission levels.
// allow = runs right away, ask = shows a confirmation card first, off = never runs.
import { call, can, isNative } from './host.js';
import { settings, set, logActivity } from './store.js';
import { calculate } from './calc.js';
import * as memory from './memory.js';
import * as reminders from './reminders.js';
import { describeWhen } from './when.js';
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
  { name: 'system_status', icon: 'cpu', needs: 'status', group: 'basics',
    ...s('Get this computer\'s status: CPU load, memory, battery, storage, uptime.'),
    run: () => call('system.status'), done: () => 'Checked system status' },
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
    }, ['text', 'when']),
    ask: (a) => ({ title: `Remind you: “${a.text}”`, detail: a.when }),
    run: async (a) => { const r = await reminders.add(a.text, a.when, { textMe: !!a.text_me }); return { id: r.id, text: r.text, when: r.human, due: new Date(r.due).toISOString(), inSystemReminders: !!r.systemId }; },
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
  { name: 'send_text', category: 'messages', icon: 'message', group: 'contact', alwaysAsk: true,
    ...s('Send a text message. "to" is a phone number, an email for iMessage, a contact name (desktop app), or "me" for the user themself.', {
      to: { type: 'string' }, message: { type: 'string' },
    }, ['to', 'message']),
    prepare: async (a) => resolveRecipient(a.to),
    ask: (a, who) => ({ title: `${can('messages') ? 'Send' : 'Prepare'} a text to ${who.label}`, detail: can('messages') ? `Sent from your Messages app to ${who.address}.` : 'Your messages app opens with the text ready; you press Send.', preview: a.message }),
    run: async (a, who) => { const r = await call('messages.send', { to: who.address, text: a.message }); return { to: who.label, sent: !!r?.sent, drafted: !!r?.drafted }; },
    done: (r) => (r.sent ? `Texted ${r.to}` : `Text ready for ${r.to}`) },
  { name: 'make_call', category: 'calls', icon: 'phone', group: 'contact', alwaysAsk: true,
    ...s('Start a phone or FaceTime call. "to" is a phone number, email, or a contact name (desktop app).', { to: { type: 'string' }, facetime: { type: 'boolean' } }, ['to']),
    prepare: async (a) => resolveRecipient(a.to, { forCall: true }),
    ask: (a, who) => ({ title: `Call ${who.label}`, detail: `${a.facetime ? 'FaceTime' : 'Phone'} call to ${who.address}. Your ${a.facetime ? 'FaceTime app' : 'phone app'} opens and starts it.` }),
    run: async (a, who) => { await call('phone.call', { to: who.address, facetime: !!a.facetime }); return { to: who.label }; },
    done: (r) => `Calling ${r.to}` },
  { name: 'look_at_screen', category: 'screen', icon: 'eye', group: 'contact',
    ...s('Let the user point at something on their screen so you can identify it. Use when they ask "what is this?" about something on screen.', { question: { type: 'string' } }),
    ask: () => ({ title: 'Look at what you point to on your screen', detail: 'You choose the spot. Only that area is looked at, on this computer.' }),
    run: async (a) => { bus.emit('look.start', { question: a.question || '', fromAI: true }); return { note: 'The user is now choosing a spot. Their answer will arrive as a new message; do not guess what it is.' }; },
    done: () => 'Look mode started' },
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
  contact: { label: 'Texts, calls and screen', icon: 'message' },
};

export function available(tool) {
  if (tool.needs && !can(tool.needs)) return false;
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
  if ((settings.skills?.disabledGroups || []).includes(tool.group)) return { ok: false, declined: true, error: 'The user switched this ability off in Skills.' };
  const level = ctx.preApproved && tool.category !== 'commands' ? 'allow' : levelFor(tool);
  const label = CATEGORIES[tool.category]?.label || tool.name;
  if (level === 'off') return { ok: false, declined: true, error: `The user switched off "${label}" in Settings → Permissions.` };

  let prepared = null;
  try { if (tool.prepare) prepared = await tool.prepare(args); } catch (e) { return { ok: false, error: e.message }; }
  const skip = tool.skipIf?.(args, prepared);
  if (skip) return skip;

  if (level === 'ask' || tool.alwaysAsk) {
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
  if (/^(me|myself|my phone|self)$/i.test(raw)) {
    const mine = settings.profile?.phone?.trim();
    if (!mine) throw new Error('Add your phone number (or iMessage email) in Settings → General first, so I know where “me” is.');
    return { label: 'you', address: mine };
  }
  const digits = raw.replace(/[\s().-]/g, '');
  if (/^\+?\d{3,15}$/.test(digits)) return { label: raw, address: digits };
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return { label: raw, address: raw };
  if (!can('contacts')) throw new Error(`I can’t look up contacts in the web version. Give me ${forCall ? 'the number' : 'the number or iMessage email'} for ${raw}.`);
  const found = await call('contacts.find', { name: raw });
  const list = (found?.matches || []).filter((m) => (forCall ? m.phones?.length : m.phones?.length || m.emails?.length));
  if (!list.length) throw new Error(`I couldn’t find ${raw} in your contacts.`);
  const c = list[0];
  const address = c.phones?.[0] || c.emails?.[0];
  return { label: `${c.name}${list.length > 1 ? ` (best of ${list.length} matches)` : ''}`, address };
}
