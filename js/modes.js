// AI modes: change how JARVIS thinks and answers (study, developer, research…).
// A mode is just extra instructions for the AI, so it works with every model, offline.
import { settings, set } from './store.js';
import { bus } from './util.js';

export const MODES = {
  assistant: { label: 'Personal assistant', icon: 'sparkles', desc: 'Everyday help (the default).', prompt: '', brief: '' },
  study: { label: 'Study', icon: 'grad', desc: 'A patient tutor that checks you understood.',
    prompt: 'STUDY MODE: act as a patient tutor. Explain step by step in simple words, use one concrete example, end with one short question that checks understanding, and suggest a memory trick when useful.',
    brief: 'Explain simply, like a patient tutor.' },
  developer: { label: 'Developer', icon: 'code', desc: 'Complete, working code with short explanations.',
    prompt: 'DEVELOPER MODE: act as a senior programmer. Give complete, working code in fenced blocks with the language named, explain briefly, point out edge cases, and say how to run or test it.',
    brief: 'Answer as an expert programmer with working code.' },
  research: { label: 'Research', icon: 'search', desc: 'Careful answers that separate facts from guesses.',
    prompt: 'RESEARCH MODE: be thorough and careful. Separate established facts from guesses, say how sure you are, list what would need checking, and mention that "research <topic>" runs deep research with sources.',
    brief: 'Be careful and say how sure you are.' },
  creative: { label: 'Creative', icon: 'wand', desc: 'Original ideas, stories and wordplay.',
    prompt: 'CREATIVE MODE: be imaginative and playful. Offer several original ideas, vivid language and surprising angles. For writing tasks, give a polished draft.',
    brief: 'Be imaginative and original.' },
  professional: { label: 'Professional', icon: 'mail', desc: 'Formal, clear, well-structured.',
    prompt: 'PROFESSIONAL MODE: use a formal, concise business tone with clear structure (short headings or bullets). No slang or emoji.',
    brief: 'Use a formal, concise business tone.' },
  teacher: { label: 'Teacher', icon: 'book', desc: 'Teaches a topic from the ground up, with exercises.',
    prompt: 'TEACHER MODE: teach like a great teacher. Start from what the user already knows, build up in small steps with examples and analogies, then give one short exercise and its answer hidden at the end under "Answer:".',
    brief: 'Teach step by step with an example.' },
  funny: { label: 'Funny', icon: 'sparkles', desc: 'Helpful answers with jokes and light humour.',
    prompt: 'FUNNY MODE: be genuinely helpful AND funny. Keep every fact correct, then add light jokes, playful comparisons or a pun. Never joke about serious things (health, grief, danger, money trouble): there, just be kind and clear.',
    brief: 'Be helpful and add a light joke.' },
  sarcastic: { label: 'Sarcastic', icon: 'wand', desc: 'Dry, teasing wit (still helpful, never mean).',
    prompt: 'SARCASTIC MODE: answer with dry, teasing wit, like a sarcastic but loyal butler. The help itself must stay correct and complete. Tease situations, never insult the user. Drop the sarcasm completely for anything serious (health, safety, grief, emergencies).',
    brief: 'Answer helpfully with dry, friendly sarcasm.' },
  factcheck: { label: 'Fact-check', icon: 'check', desc: 'Checks claims and says how sure it is.',
    prompt: 'FACT-CHECK MODE: for every claim the user makes or asks about, start with a verdict on its own line: ✅ True, ❌ False, ⚠️ Partly true, or ❓ Can’t tell. Then explain why in 2–4 sentences, saying what is well established and what is uncertain. You have no live internet in normal chat, so say when something may have changed recently and suggest “fact check <claim>” to check it against sources. Never invent sources.',
    brief: 'Start with a verdict (True / False / Partly true / Can’t tell), then why.' },
  translator: { label: 'Translator', icon: 'language', desc: 'Translates everything you say.',
    prompt: '', brief: '' },
  troubleshoot: { label: 'Troubleshooting', icon: 'sliders', desc: 'Finds and fixes problems step by step.',
    prompt: 'TROUBLESHOOTING MODE: diagnose methodically. If key details are missing ask one clarifying question. List the most likely causes first, then numbered fixes from easiest to hardest, and say how to tell whether each one worked.',
    brief: 'Find the likely cause, then give numbered fixes.' },
  planning: { label: 'Planning', icon: 'list', desc: 'Turns goals into clear plans and next steps.',
    prompt: 'PLANNING MODE: turn the user\'s goals into a clear plan: numbered steps in order, rough time for each, and the very first action to take today. Offer to add the tasks to their to-do list or a project.',
    brief: 'Turn goals into numbered steps with the first action today.' },
};

export const current = () => (MODES[settings.mode] ? settings.mode : 'assistant');

function translatorPrompt(brief) {
  const to = settings.modeLang || 'English';
  return brief
    ? `Translate every message into ${to}. Reply with only the translation.`
    : `TRANSLATOR MODE: translate every message the user sends into ${to} (if it is already in ${to}, translate it into English). Reply with only the translation, then, if useful, one short line with a pronunciation hint. Do not answer questions in the text; translate them.`;
}

/** Instructions added to the AI's system prompt for the current mode. */
export function prompt() { const k = current(); return k === 'translator' ? translatorPrompt(false) : MODES[k].prompt; }
export function brief() { const k = current(); return k === 'translator' ? translatorPrompt(true) : MODES[k].brief; }

export function setMode(key, lang) {
  if (!MODES[key]) throw new Error('I don’t know that mode.');
  set('mode', key);
  if (lang) set('modeLang', lang.charAt(0).toUpperCase() + lang.slice(1).toLowerCase());
  bus.emit('mode', key);
  return { mode: key, label: MODES[key].label, lang: key === 'translator' ? settings.modeLang || 'English' : '' };
}

/** "study" / "dev" / "translate" … → mode key. */
export function find(word) {
  const w = String(word || '').toLowerCase().trim().replace(/\s+mode$/, '');
  const ALIASES = { normal: 'assistant', default: 'assistant', regular: 'assistant', personal: 'assistant', 'personal assistant': 'assistant', assistant: 'assistant',
    studying: 'study', homework: 'study', coding: 'developer', code: 'developer', dev: 'developer', programmer: 'developer', programming: 'developer',
    researcher: 'research', creative: 'creative', writing: 'creative', work: 'professional', business: 'professional', formal: 'professional',
    teaching: 'teacher', humor: 'funny', humour: 'funny', joke: 'funny', jokes: 'funny', fun: 'funny', sarcasm: 'sarcastic', 'fact check': 'factcheck', 'fact-check': 'factcheck', 'fact checking': 'factcheck', 'fact checker': 'factcheck', tutor: 'teacher', translate: 'translator', translation: 'translator', troubleshooting: 'troubleshoot', fix: 'troubleshoot', 'fix it': 'troubleshoot', repair: 'troubleshoot', plan: 'planning', planner: 'planning' };
  return MODES[w] ? w : ALIASES[w] || null;
}
