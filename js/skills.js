// Skills: reusable prompts and routines. Users create their own or install free
// ones from the built-in gallery (bundled with the app, so it works offline).
import { read, write } from './store.js';
import { bus, uid } from './util.js';
import { registerCustom, clearCustom } from './tools.js';

let custom = [];

export async function load() {
  custom = await read('skills', null);
  if (!custom) { custom = GALLERY.filter((g) => g.starter).map(fromGallery); await write('skills', custom); }
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
    if (!s || !s.name || !['prompt', 'routine'].includes(s.kind)) continue;
    custom.push({ ...sanitize(s), id: uid('k'), enabled: true });
  }
  save();
}

function sanitize(s) {
  return {
    name: String(s.name).slice(0, 60), command: slug(s.command || s.name), description: String(s.description || '').slice(0, 200),
    icon: s.icon || 'puzzle', kind: s.kind, triggers: (s.triggers || []).map(String).slice(0, 6),
    prompt: String(s.prompt || '').slice(0, 4000),
    steps: (s.steps || []).filter((st) => st && typeof st.tool === 'string').map((st) => ({ tool: st.tool, args: st.args || {} })).slice(0, 12),
    trusted: false,
  };
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
  { id: 'brief', starter: true, name: 'Morning briefing', command: 'brief', icon: 'coffee', kind: 'prompt', triggers: ['good morning', 'morning briefing'], description: 'A short start-of-day briefing.',
    prompt: 'Give {name} a short, upbeat morning briefing for {date}: one line greeting, the day and date, then three practical focus suggestions based on what you know about them, and one short motivating line. Keep it under 120 words.' },
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
];
