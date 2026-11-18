// Skills (shown to people as "plugins"): reusable prompts, routines of actions, and
// website shortcuts. Users make their own, paste or import someone else's, or add
// free ones from the store (bundled with the app, so it works offline).
// A plugin is plain data, never code, so it can only do what JARVIS's own abilities
// allow, and every action still follows the user's Permissions.
import { read, write } from './store.js';
import { bus, uid } from './util.js';
import { registerCustom, clearCustom, byName, GROUPS } from './tools.js';

export const KINDS = ['prompt', 'routine', 'link'];

let custom = [];

export async function load() {
  custom = await read('skills', null);
  if (!custom) { custom = GALLERY.filter((g) => g.starter).map(fromGallery); await write('skills', custom); }
  // The old AI-only "Morning briefing" is replaced by the real one (weather, calendar, reminders).
  if (custom.some((s) => s.galleryId === 'brief')) { custom = custom.filter((s) => s.galleryId !== 'brief'); await write('skills', custom); }
  sync();
  return custom;
}

export const all = () => custom;
const save = () => { write('skills', custom).catch(console.error); sync(); bus.emit('skills', custom); };

function sync() {
  clearCustom();
  const runnable = custom.filter((s) => s.enabled !== false);
  if (!runnable.length) return;
  registerCustom({
    name: 'run_skill', group: 'skills', icon: 'puzzle',
    description: 'Run one of the user\'s saved skills by name. Available: ' + runnable.map((s) => `"${s.command}" (${s.description || s.name})`).join('; '),
    props: { name: { type: 'string', description: 'Skill command name' }, input: { type: 'string', description: 'Optional text for the skill' } },
    required: ['name'],
    run: async () => { throw new Error('handled by assistant'); },
  });
}

export function find(nameOrCommand) {
  const q = String(nameOrCommand || '').toLowerCase().replace(/^\//, '');
  return custom.find((s) => s.command.toLowerCase() === q || s.name.toLowerCase() === q);
}

export function upsert(skill) {
  skill.command = slug(skill.command || skill.name);
  const i = custom.findIndex((s) => s.id === skill.id);
  if (i >= 0) custom[i] = skill; else custom.push({ id: uid('k'), enabled: true, ...skill });
  save();
}

export function remove(id) { custom = custom.filter((s) => s.id !== id); save(); }
export function toggle(id, on) { const s = custom.find((x) => x.id === id); if (s) { s.enabled = on; save(); } }
export function installed(galleryId) { return custom.some((s) => s.galleryId === galleryId); }
export function install(galleryId) { const g = GALLERY.find((x) => x.id === galleryId); if (g && !installed(galleryId)) { custom.push(fromGallery(g)); save(); } }
export function importSkills(list) {
  for (const s of list) {
    if (!s || !s.name || !KINDS.includes(s.kind) || (s.kind === 'link' && !safeLink(s.url))) continue;
    custom.push({ ...sanitize(s), id: uid('k'), enabled: true });
  }
  save();
}

function sanitize(s) {
  return {
    name: String(s.name).slice(0, 60), command: slug(s.command || s.name), description: String(s.description || '').slice(0, 200),
    icon: s.icon || 'puzzle', kind: s.kind, triggers: (s.triggers || []).map(String).slice(0, 6),
    prompt: String(s.prompt || '').slice(0, 4000),
    url: s.kind === 'link' ? safeLink(s.url) || '' : '',
    steps: (s.steps || []).filter((st) => st && typeof st.tool === 'string').map((st) => ({ tool: st.tool, args: st.args || {} })).slice(0, 12),
    trusted: false,
  };
}

/** Website shortcuts may only open normal https web pages. */
export function safeLink(u) {
  const s = String(u || '').trim().slice(0, 500);
  try { const x = new URL(s.replace(/\{input\}/g, 'x')); return x.protocol === 'https:' && !x.username && !x.password ? s : ''; } catch { return ''; }
}

/** The page a website shortcut opens for some text. */
export function linkFor(sk, input) {
  const url = safeLink(sk.url);
  if (!url) throw new Error('That plugin’s link isn’t a safe https web address.');
  return url.replace(/\{input\}/g, encodeURIComponent(String(input || '').trim()));
}

/** Plain-words list of what a plugin can do, shown before adding it. */
export function permissions(sk) {
  if (sk.kind === 'link') { let host = ''; try { host = new URL(safeLink(sk.url).replace(/\{input\}/g, 'x')).hostname.replace(/^www\./, ''); } catch {} return [{ icon: 'globe', text: `Opens ${host || 'a website'} in your browser`, level: 'low' }]; }
  if (sk.kind === 'prompt') {
    const out = [{ icon: 'sparkles', text: 'Gives the AI instructions (runs on this device)', level: 'low' }];
    if (/create_document|save .*(file|document)/i.test(sk.prompt || '')) out.push({ icon: 'file', text: 'May ask to save a document', level: 'mid' });
    return out;
  }
  const seen = new Map();
  for (const st of sk.steps || []) {
    const t = byName(st.tool);
    const g = t ? GROUPS[t.group]?.label || t.group : st.tool;
    if (!seen.has(g)) seen.set(g, { icon: t?.icon || 'bolt', text: g, level: t?.category === 'commands' ? 'high' : t?.category ? 'mid' : 'low' });
  }
  const out = [...seen.values()];
  out.push(sk.trusted ? { icon: 'alert', text: 'Runs its steps without asking', level: 'high' } : { icon: 'shield', text: 'Each step follows your Permissions (asks first when set to ask)', level: 'low' });
  return out;
}

/** Share one plugin as text someone else can paste into their JARVIS. */
export function toCode(sk) {
  const { id, galleryId, enabled, trusted, ...rest } = sk;
  return JSON.stringify({ jarvisPlugin: 1, ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== '' && !(Array.isArray(v) && !v.length))) });
}

/** Read pasted plugin code: one plugin, a list, or an exported skills file. */
export function parseCode(text) {
  const t = String(text || '').trim();
  if (!t) throw new Error('Paste the plugin code first.');
  let data;
  try { data = JSON.parse(t); } catch { throw new Error('That isn’t plugin code. It should start with { and end with }.'); }
  const list = Array.isArray(data) ? data : Array.isArray(data.skills) ? data.skills : Array.isArray(data.plugins) ? data.plugins : [data];
  const good = list.filter((s) => s && s.name && KINDS.includes(s.kind) && (s.kind !== 'link' || safeLink(s.url)) && (s.kind !== 'prompt' || s.prompt) && (s.kind !== 'routine' || s.steps?.length));
  if (!good.length) throw new Error('No working plugin found in that code.');
  return good.map(sanitize);
}

const fromGallery = (g) => ({ ...sanitize(g), id: uid('k'), galleryId: g.id, enabled: true });
export const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'skill';

/** Fill {input}, {date}, {name} placeholders in a prompt skill. */
export function fill(prompt, input, ctx = {}) {
  return prompt
    .replace(/\{input\}/g, input || ctx.fallbackInput || '')
    .replace(/\{date\}/g, new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))
    .replace(/\{name\}/g, ctx.userName || 'the user');
}

export const GALLERY = [
  { id: 'translate', starter: true, name: 'Translate', command: 'translate', icon: 'language', kind: 'prompt', triggers: [], description: 'Translate text. Example: /translate French: Where is the station?',
    prompt: 'Translate the following. If a target language is given before a colon, use it; otherwise translate to English. Reply with only the translation, then one line with a pronunciation tip if useful.\n\n{input}' },
  { id: 'email', starter: true, name: 'Write an email', command: 'email', icon: 'mail', kind: 'prompt', triggers: [], description: 'Draft a clear, polite email from a few notes.',
    prompt: 'Write a clear, friendly, professional email based on these notes. Include a subject line. Keep it concise.\n\nNotes: {input}' },
  { id: 'eli5', name: 'Explain simply', command: 'explain', icon: 'grad', kind: 'prompt', triggers: ['explain like i am five', 'explain like i\'m five'], description: 'Explain any topic in plain words with an example.',
    prompt: 'Explain this in plain, simple words a beginner would understand, with one everyday example and a one-sentence summary at the end:\n\n{input}' },
  { id: 'quiz', name: 'Quiz me', command: 'quiz', icon: 'target', kind: 'prompt', triggers: ['quiz me'], description: 'Practice questions on any topic, one at a time.',
    prompt: 'Quiz me on: {input}. Ask one multiple-choice question at a time (A-D), wait for my answer, tell me if I was right with a short explanation, then ask the next. Start now with question 1.' },
  { id: 'fix', name: 'Fix my writing', command: 'fix', icon: 'wand', kind: 'prompt', triggers: [], description: 'Correct grammar and make text read smoothly.',
    prompt: 'Correct the grammar, spelling and flow of this text while keeping my voice and meaning. Reply with the improved text only, then a short bullet list of the main changes.\n\n{input}' },
  { id: 'summarize', name: 'Summarize', command: 'summarize', icon: 'list', kind: 'prompt', triggers: [], description: 'Summarize pasted text into key points.',
    prompt: 'Summarize this into 3-6 key bullet points and one line saying what to do next, if anything:\n\n{input}' },
  { id: 'code', name: 'Code helper', command: 'code', icon: 'code', kind: 'prompt', triggers: [], description: 'Explain, write or debug code.',
    prompt: 'You are an expert, patient programmer. Help with this: explain your reasoning briefly, then give complete working code in a fenced block.\n\n{input}' },
  { id: 'workday', starter: true, name: 'Start my workday', command: 'workday', icon: 'bolt', kind: 'routine', triggers: ['start my workday', 'start my day'], description: 'Opens Mail, Calendar and Notes.',
    steps: [{ tool: 'open_app', args: { name: 'Mail' } }, { tool: 'open_app', args: { name: 'Calendar' } }, { tool: 'open_app', args: { name: 'Notes' } }] },
  { id: 'focus', name: 'Focus mode', command: 'focus', icon: 'target', kind: 'routine', triggers: ['focus mode'], description: 'Volume to 20%, opens Notes, starts a 25-minute timer.',
    steps: [{ tool: 'set_volume', args: { level: 20 } }, { tool: 'open_app', args: { name: 'Notes' } }, { tool: 'set_timer', args: { minutes: 25, label: 'Focus session' } }] },
  { id: 'tidy', name: 'Tidy Downloads', command: 'tidy', icon: 'broom', kind: 'routine', triggers: ['tidy my downloads', 'clean my downloads'], description: 'Sorts the Downloads folder by file type (shows the plan first).',
    steps: [{ tool: 'organize_folder', args: { folder: 'Downloads', by: 'type' } }] },
  { id: 'night', name: 'Wind down', command: 'night', icon: 'moon', kind: 'routine', triggers: ['good night', 'wind down'], description: 'Dark mode on, volume to 15%.',
    steps: [{ tool: 'set_dark_mode', args: { mode: 'dark' } }, { tool: 'set_volume', args: { level: 15 } }] },
  { id: 'notes', name: 'Meeting notes', command: 'meeting', icon: 'note', kind: 'prompt', triggers: [], description: 'Turn rough notes into tidy meeting notes, saved as a document.',
    prompt: 'Turn these rough notes into tidy meeting notes with sections: Summary, Decisions, Action items (owner, due date if mentioned). Then save them with the create_document ability as a Markdown file titled "Meeting notes {date}".\n\nNotes: {input}' },
  { id: 'recipe', name: 'Recipe from my fridge', command: 'recipe', icon: 'heart', kind: 'prompt', triggers: [], description: 'Suggest a simple recipe from ingredients you have.',
    prompt: 'Suggest one simple recipe I can make with mostly these ingredients: {input}. Give the name, time needed, ingredient list and short numbered steps.' },
  // ---- Website shortcuts (free, no sign-up)
  { id: 'youtube', name: 'YouTube search', command: 'youtube', icon: 'play', kind: 'link', triggers: ['search youtube for', 'youtube'], description: 'Search YouTube. Say “search YouTube for cat videos”.', url: 'https://www.youtube.com/results?search_query={input}' },
  { id: 'wiki', name: 'Wikipedia', command: 'wiki', icon: 'book', kind: 'link', triggers: ['look up on wikipedia', 'wikipedia'], description: 'Open the Wikipedia article for anything.', url: 'https://en.wikipedia.org/wiki/Special:Search?search={input}' },
  { id: 'define', name: 'Dictionary', command: 'define', icon: 'book', kind: 'link', triggers: ['define', 'dictionary'], description: 'What a word means. Say “define serendipity”.', url: 'https://www.merriam-webster.com/dictionary/{input}' },
  { id: 'nearby', name: 'Find nearby', command: 'nearby', icon: 'home', kind: 'link', triggers: ['find nearby', 'find near me', 'where is the nearest'], description: 'Find places near you on the map: “find nearby pizza”.', url: 'https://www.google.com/maps/search/{input}' },
  { id: 'spotify', name: 'Spotify search', command: 'spotify', icon: 'volume', kind: 'link', triggers: ['search spotify for', 'play on spotify'], description: 'Find a song, artist or podcast on Spotify.', url: 'https://open.spotify.com/search/{input}' },
  { id: 'gtranslate', name: 'Google Translate', command: 'gtranslate', icon: 'language', kind: 'link', triggers: [], description: 'Open Google Translate with your text.', url: 'https://translate.google.com/?sl=auto&tl=en&text={input}&op=translate' },
  { id: 'news', name: 'News search', command: 'news', icon: 'globe', kind: 'link', triggers: ['news about', 'latest news on'], description: 'Latest news on any topic.', url: 'https://news.google.com/search?q={input}' },
  { id: 'track', name: 'Track a package', command: 'track', icon: 'download', kind: 'link', triggers: ['track my package', 'track package'], description: 'Track a parcel from its tracking number (most carriers).', url: 'https://parcelsapp.com/en/tracking/{input}' },
  { id: 'flight', name: 'Flight status', command: 'flight', icon: 'globe', kind: 'link', triggers: ['flight status', 'track flight'], description: 'Where a flight is right now: “flight status AC123”.', url: 'https://www.flightradar24.com/data/flights/{input}' },
  { id: 'recipes', name: 'Recipe finder', command: 'recipes', icon: 'heart', kind: 'link', triggers: ['find a recipe for', 'recipes for'], description: 'Search thousands of recipes.', url: 'https://www.allrecipes.com/search?q={input}' },
  { id: 'imdb', name: 'Movies & TV', command: 'movie', icon: 'display', kind: 'link', triggers: ['look up the movie', 'who is in the movie'], description: 'Cast, ratings and info for any movie or show.', url: 'https://www.imdb.com/find/?q={input}' },
  { id: 'github', name: 'GitHub search', command: 'github', icon: 'code', kind: 'link', triggers: [], description: 'Search code and projects on GitHub.', url: 'https://github.com/search?q={input}' },
  // ---- More prompt plugins
  { id: 'reply', name: 'Help me reply', command: 'reply', icon: 'message', kind: 'prompt', triggers: ['help me reply to'], description: 'Three short replies to a message you got (friendly, neutral, firm).', prompt: 'Someone sent me this message. Write three short replies I could send: one friendly, one neutral, one firm. Number them.\n\nTheir message: {input}' },
  { id: 'gift', name: 'Gift ideas', command: 'gift', icon: 'heart', kind: 'prompt', triggers: ['gift ideas for'], description: 'Thoughtful gift ideas for anyone and any budget.', prompt: 'Suggest 6 thoughtful gift ideas for: {input}. Mix price ranges, one line each with why it fits.' },
  { id: 'plan', name: 'Plan my week', command: 'plan', icon: 'list', kind: 'prompt', triggers: ['plan my week'], description: 'Turn your goals into a simple day-by-day plan.', prompt: 'Make a simple, realistic day-by-day plan for this week (Monday to Sunday) from these goals and commitments. Keep each day to 1-3 items: {input}' },
  { id: 'workoutplan', name: 'Workout plan', command: 'workoutplan', icon: 'zap', kind: 'prompt', triggers: ['make me a workout plan'], description: 'A beginner-friendly bodyweight plan you can do with the Workout Coach.', prompt: 'Make me a beginner-friendly bodyweight workout plan for {input} (or 3 days a week if not said). Use only these moves so my camera coach can count them: squats, push-ups, jumping jacks, lunges, sit-ups, high knees, glute bridges, burpees, plank, wall sit. Give sets and reps per day.' },
  { id: 'study', name: 'Study helper', command: 'study', icon: 'grad', kind: 'prompt', triggers: ['help me study'], description: 'Key ideas, a memory trick and 3 practice questions on any topic.', prompt: 'Help me study {input}: give the 5 key ideas in simple words, one memory trick, then 3 practice questions (answers at the end).' },
  { id: 'packing', name: 'Packing list', command: 'packing', icon: 'list', kind: 'prompt', triggers: ['packing list for'], description: 'A packing list for a trip, saved to your lists.', prompt: 'Make a packing list for this trip: {input}. Then add the items to my "packing" list with the add_to_list ability.' },
  { id: 'joke', name: 'Tell me a joke', command: 'joke', icon: 'sparkles', kind: 'prompt', triggers: ['tell me a joke'], description: 'A clean, quick joke.', prompt: 'Tell me one short, clean, genuinely funny joke{input}.' },
  { id: 'story', name: 'Bedtime story', command: 'story', icon: 'moon', kind: 'prompt', triggers: ['tell me a bedtime story', 'bedtime story'], description: 'A calm 2-minute story, about anything you like.', prompt: 'Tell a calm, kind bedtime story (about 250 words) about: {input}. Gentle ending.' },
  // ---- More routines
  { id: 'movie', name: 'Movie night', command: 'movienight', icon: 'display', kind: 'routine', triggers: ['movie night'], description: 'Dark mode on, volume to 50%, opens the TV app.', steps: [{ tool: 'set_dark_mode', args: { mode: 'dark' } }, { tool: 'set_volume', args: { level: 50 } }, { tool: 'open_app', args: { name: 'TV' } }] },
  { id: 'exercise', name: 'Quick workout', command: 'exercise', icon: 'zap', kind: 'routine', triggers: ['quick workout', 'workout time'], description: 'Opens the camera coach for squats and starts a 10-minute timer.', steps: [{ tool: 'set_timer', args: { minutes: 10, label: 'Workout' } }, { tool: 'start_workout', args: { exercise: 'squats' } }] },
  { id: 'heading-home', name: 'Heading home', command: 'leaving', icon: 'home', kind: 'routine', triggers: ['i\'m heading home', 'i am heading home'], description: 'Opens directions home and checks the weather.', steps: [{ tool: 'get_weather', args: {} }, { tool: 'go_home', args: {} }] },
];
