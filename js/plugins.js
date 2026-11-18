// Plugins: features you can turn on or off, plus "what should I add?" recommendations.
import { settings, set, getActivity } from './store.js';
import { can, isNative } from './host.js';
import * as skills from './skills.js';
import * as lists from './lists.js';
import * as people from './people.js';
import * as reminders from './reminders.js';
import * as workout from './workout.js';
import * as ollama from './ollama.js';

const mobile = () => /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

export const PLUGINS = [
  { id: 'workout', name: 'Workout Coach', icon: 'zap', groups: ['fitness'], tryText: 'track my squats', open: 'workout', desc: 'The camera counts your squats, push-ups, jumping jacks, curls and plank time. Keeps a workout log and streak.' },
  { id: 'reminders', name: 'Reminders', icon: 'bell', groups: ['reminders'], tryText: 'remind me in 1 hour to drink water', desc: 'Reminders by voice or text, with Add to Calendar so your phone alerts you.' },
  { id: 'lists', name: 'Lists & Notes', icon: 'list', groups: ['lists'], tryText: "what's on my shopping list", open: 'lists', desc: 'Shopping, to-do, notes and any list you name.' },
  { id: 'weather', name: 'Weather', icon: 'sun', groups: ['weather'], tryText: "what's the weather", desc: 'Today and tomorrow for your city (free Open-Meteo service).' },
  { id: 'contact', name: 'Texts & Calls', icon: 'message', groups: ['contact'], tryText: '', open: 'lists', desc: 'Text or call people you save, and JARVIS can text and call you: “call me at 7am to wake me up”, “text me buy milk”.' },
  { id: 'apps', name: 'Open Apps', icon: 'app', groups: ['apps'], tryText: 'open Spotify', desc: 'Opens your apps: Spotify, WhatsApp, YouTube, Maps, Notes and more.', needs: () => isNative || mobile() },
  { id: 'converter', name: 'Unit Converter', icon: 'calculator', groups: ['convert'], tryText: 'convert 5 miles to km', desc: 'Lengths, weights, cooking, temperatures, speed, data.' },
  { id: 'timers', name: 'Timers & Maths', icon: 'clock', groups: ['basics'], tryText: 'set a timer for 5 minutes', desc: 'Countdowns, quick maths and tips: “what is 18% of 64”.' },
  { id: 'system', name: 'System Report', icon: 'cpu', groups: ['status'], tryText: 'system report', desc: 'Your device, storage, network, AI and JARVIS stats.' },
  { id: 'look', name: 'Circle to Ask', icon: 'lasso', groups: ['look'], tryText: 'what is this', desc: 'Take a photo, pick a picture or grab your screen, circle anything and ask about it. Runs on this device.' },
  { id: 'briefing', name: 'Morning Briefing', icon: 'coffee', groups: ['briefing'], tryText: 'good morning', desc: 'Every morning: the weather and what you need to do today (calendar, reminders, to-do list). Spoken, and texted to you from the Mac app.' },
  { id: 'home', name: 'Take Me Home', icon: 'home', groups: ['home'], tryText: 'take me home', open: 'general', desc: 'Directions home from wherever you are, in Apple or Google Maps. Your address stays on this device.' },
  { id: 'translate', name: 'Translator', icon: 'language', skill: 'translate', tryText: '/translate Spanish: good morning', desc: 'Translate anything into another language.' },
];

export const available = () => PLUGINS.filter((p) => !p.needs || p.needs());

export function isOn(p) {
  if (p.skill) { const sk = skills.find(p.skill); return !!sk && sk.enabled !== false; }
  const off = settings.skills?.disabledGroups || [];
  if (p.id === 'briefing' && settings.briefing?.on === false) return false;
  return p.groups.every((g) => !off.includes(g));
}

export function setOn(p, on) {
  if (p.skill) {
    const sk = skills.find(p.skill);
    if (sk) skills.toggle(sk.id, on); else if (on) skills.install(p.skill === 'brief' ? 'brief' : p.skill);
    return;
  }
  const off = new Set(settings.skills?.disabledGroups || []);
  if (p.id === 'briefing') set('briefing.on', on);
  for (const g of p.groups) on ? off.delete(g) : off.add(g);
  set('skills.disabledGroups', [...off]);
}

const TOOL_GROUP = {
  start_workout: 'workout', log_workout: 'workout', workout_summary: 'workout', set_reminder: 'reminders', add_to_list: 'lists', show_list: 'lists',
  get_weather: 'weather', send_text: 'contact', make_call: 'contact', save_contact: 'contact', open_app: 'apps', convert_units: 'converter', set_timer: 'timers', calculate: 'timers', system_status: 'system',
};

/** Up to `n` suggestions: {plugin, reason, action: 'try'|'enable'|'setup'}. */
export async function recommend(n = 3) {
  const used = new Set();
  for (const e of await getActivity()) if (TOOL_GROUP[e.tool] && e.result === 'ok') used.add(TOOL_GROUP[e.tool]);
  const out = [];
  const add = (id, reason, action = 'try', score = 1) => { const p = available().find((x) => x.id === id); if (p && !out.some((o) => o.plugin.id === id)) out.push({ plugin: p, reason, action: isOn(p) ? action : 'enable', score }); };
  if (ollama.isPhone() && !settings.ai.model) out.push({ plugin: { id: 'ai', name: 'The free AI', icon: 'sparkles', open: 'models' }, reason: 'Download the AI once (on Wi-Fi) so I can chat about anything, offline.', action: 'setup', score: 10 });
  if (!workout.all().length) add('workout', 'Prop your phone up and I’ll count your reps and track your progress.', 'try', mobile() ? 9 : 4);
  if (!settings.weather?.lat) add('weather', 'Tell me your city once and ask “what’s the weather?” any morning.', 'setup', 7);
  if (!reminders.all().length) add('reminders', 'Never forget a call or a bill: I can put reminders in your calendar.', 'try', 6);
  if (!lists.names().some((k) => lists.items(k).length)) add('lists', 'Keep your shopping and to-do lists by just saying them.', 'try', 5);
  if (!people.all().length) add('contact', 'Save the people you message most, then say “text Mom I’m on my way”.', 'setup', 4);
  if (!used.has('apps')) add('apps', 'Say “open Spotify” or “open Maps” to jump straight into your apps.', 'try', 3);
  if (!used.has('converter')) add('converter', 'Cooking or travelling? “How many grams in a pound?”', 'try', 2);
  if (settings.briefing?.on === false) add('briefing', 'Start each day with the weather and what you need to do.', 'enable', 2);
  if (!settings.profile?.home) add('home', 'Save your home address once, then just say “take me home”.', 'setup', 3);
  if (!used.has('system')) add('system', 'Check your storage, battery and AI at a glance.', 'try', 1);
  return out.sort((a, b) => b.score - a.score).slice(0, n);
}
