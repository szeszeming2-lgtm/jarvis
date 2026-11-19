// Morning briefing: the weather and what you need to do today, put together from
// your own data on this device (weather from the free Open-Meteo service).
// It shows in the chat, is spoken, and (in the Mac app) is texted to you.
import { settings, set } from './store.js';
import { call, can } from './host.js';
import * as reminders from './reminders.js';
import * as lists from './lists.js';
import * as workout from './workout.js';
import * as weather from './weather.js';

const pad = (n) => String(n).padStart(2, '0');
export const todayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeOf = (ts) => new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/** "07:30" → minutes after midnight. */
export function minutesOf(hhmm) {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
  return m ? Math.min(23, +m[1]) * 60 + Math.min(59, +m[2]) : 7 * 60 + 30;
}

/** Collect today's data. Every part is optional; a missing part is just left out. */
export async function gather(now = new Date()) {
  const end = new Date(now); end.setHours(23, 59, 59, 999);
  const out = { date: now, weather: null, events: [], reminders: [], todo: [], shopping: 0, streak: 0 };
  if (settings.weather?.lat != null) { try { out.weather = await weather.forecast(); } catch {} }
  if (can('calendar')) { try { out.events = (await call('calendar.today', {}))?.events || []; } catch {} }
  out.reminders = reminders.upcoming().filter((r) => r.due <= end.getTime()).map((r) => ({ text: r.text, at: r.due }));
  out.todo = lists.open('to-do').map((i) => i.text);
  out.shopping = lists.open('shopping').length;
  try { out.streak = workout.summary(7).streak; } catch {}
  return out;
}

/** Turn the data into {md, text}: markdown for the chat, plain text for a text message and speech. */
export function compose(d, { name = settings.userName?.trim() } = {}) {
  const hour = d.date.getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const day = d.date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const md = [`**${hello}${name ? ', ' + name : ''}.** It’s ${day}.`];
  const txt = [`${hello}${name ? ' ' + name : ''}. It’s ${day}.`];
  if (d.weather) {
    const w = d.weather, t = w.days[0];
    const rain = t.rain != null && t.rain >= 40 ? ` ${t.rain}% chance of rain, so take an umbrella.` : '';
    const line = `${w.now.icon} ${w.now.temp}${w.units} and ${w.now.sky} in ${w.place.split(',')[0]}. Today ${t.low}–${t.high}${w.units}.${rain}`;
    md.push(line); txt.push(line);
  } else {
    md.push('_Weather: tell me your city once (“my city is Toronto”) and I’ll include it._');
  }
  const todo = [];
  for (const e of d.events) todo.push({ at: e.allDay ? null : e.start, text: e.title + (e.location ? ` (${e.location})` : ''), kind: 'event' });
  for (const r of d.reminders) todo.push({ at: r.at, text: r.text, kind: 'reminder' });
  todo.sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  if (todo.length) {
    md.push(`**Today:**\n${todo.map((x) => `- ${x.at ? timeOf(x.at) + ' · ' : ''}${x.text}`).join('\n')}`);
    txt.push(`Today: ${todo.map((x) => `${x.at ? timeOf(x.at) + ' ' : ''}${x.text}`).join('; ')}.`);
  }
  if (d.todo.length) {
    const top = d.todo.slice(0, 5);
    md.push(`**To do:**\n${top.map((t) => '- ' + t).join('\n')}${d.todo.length > 5 ? `\n- …and ${d.todo.length - 5} more` : ''}`);
    txt.push(`To do: ${top.join(', ')}${d.todo.length > 5 ? ` and ${d.todo.length - 5} more` : ''}.`);
  }
  if (!todo.length && !d.todo.length) { md.push('Nothing on your plate yet. Say “add call the bank to my to-do list” or “remind me at 3pm to …”.'); txt.push('Nothing planned yet.'); }
  if (d.shopping) { md.push(`🛒 ${d.shopping} thing${d.shopping === 1 ? '' : 's'} on your shopping list.`); txt.push(`${d.shopping} on your shopping list.`); }
  if (d.streak > 1) { md.push(`🔥 ${d.streak}-day workout streak. Keep it going!`); txt.push(`${d.streak}-day workout streak.`); }
  return { md: md.join('\n\n'), text: txt.join(' ') };
}

export async function build() { return compose(await gather()); }

/** Is a briefing due right now? (on, after the set time, before 2 pm, not yet today) */
export function isDue(now = new Date(), b = settings.briefing || {}) {
  if (b.on === false) return false;
  const mins = now.getHours() * 60 + now.getMinutes();
  return b.last !== todayKey(now) && mins >= minutesOf(b.time) && mins < 14 * 60;
}

/** Text the briefing to the user (Mac app with their number). Returns true when sent. */
export async function textIt(text) {
  if (settings.briefing?.text === false || !can('messages') || !settings.profile?.phone) return false;
  try { const r = await call('messages.send', { to: 'me', text }); return !!r?.sent; } catch { return false; }
}

/** Run every minute: deliver once a day. deliver(briefing) shows/speaks it. */
export function startSchedule(deliver) {
  const tick = async () => {
    if (!isDue()) return;
    set('briefing.last', todayKey());
    try { const b = await build(); await deliver(b); textIt(b.text); } catch (e) { console.error(e); }
  };
  setTimeout(tick, 4000);
  return setInterval(tick, 60000);
}

// ---------------------------------------------------------------- evening summary / daily report
/** What got done today and what's next: to-dos, project tasks, habits, workouts, focus, missions, tomorrow. */
export async function gatherEvening(now = new Date()) {
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const t0 = start.getTime();
  const tomorrowEnd = new Date(start); tomorrowEnd.setDate(tomorrowEnd.getDate() + 2);
  const out = { date: now, doneTodos: [], openTodos: [], projectDone: [], habits: [], workouts: [], focusMin: 0, missions: [], tomorrow: [], weather: null };
  for (const [name, items] of Object.entries(lists.all())) for (const i of items) if (i.done && (i.updated || 0) >= t0) out.doneTodos.push(i.text);
  out.openTodos = lists.open('to-do').map((i) => i.text);
  try { const pj = await import('./projects.js'); for (const p of pj.all()) for (const t of p.tasks) if (t.done && (t.doneAt || 0) >= t0) out.projectDone.push(`${t.text} (${p.name})`); } catch {}
  try { const P = await import('./planner.js'); const day = P.dayKey(now); out.habits = P.all().habits.map((h) => ({ name: h.name, done: !!h.days[day], streak: P.streak(h, now) })); out.focusMin = Math.round((P.all().focus || []).filter((f) => f.start >= t0).reduce((s, f) => s + (f.minutes || 0), 0)); } catch {}
  out.workouts = workout.all().filter((e) => e.ts >= t0).map((e) => workout.describe(e));
  try { const M = await import('./missions.js'); out.missions = M.all().filter((m) => (m.finished || 0) >= t0).map((m) => m.goal); } catch {}
  const dayEnd = new Date(start); dayEnd.setDate(dayEnd.getDate() + 1);
  out.tomorrow = reminders.upcoming().filter((r) => r.due >= dayEnd.getTime() && r.due < tomorrowEnd.getTime()).map((r) => ({ at: r.due, text: r.text }));
  if (can('calendar')) { try { const ev = (await call('calendar.today', { days: 2 }))?.events || []; out.tomorrow.push(...ev.filter((e) => e.start >= dayEnd.getTime()).map((e) => ({ at: e.allDay ? null : e.start, text: e.title }))); } catch {} }
  out.tomorrow.sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  if (settings.weather?.lat != null) { try { out.weather = await weather.forecast(); } catch {} }
  return out;
}

export function composeEvening(d, { name = settings.userName?.trim() } = {}) {
  const md = [`**Good evening${name ? ', ' + name : ''}.** Here’s your day.`];
  const txt = [`Good evening${name ? ' ' + name : ''}.`];
  const done = [...d.doneTodos, ...d.projectDone];
  if (done.length) { md.push(`**Done today (${done.length}):**\n${done.slice(0, 10).map((t) => '- ✅ ' + t).join('\n')}`); txt.push(`You finished ${done.length} thing${done.length === 1 ? '' : 's'}.`); }
  else { md.push('Nothing ticked off today. That’s okay: tomorrow is a fresh start.'); txt.push('Nothing ticked off today.'); }
  if (d.habits.length) { const ok = d.habits.filter((h) => h.done); md.push(`**Habits:** ${ok.length} of ${d.habits.length} done${d.habits.filter((h) => !h.done).length ? ` (still time for: ${d.habits.filter((h) => !h.done).map((h) => h.name).join(', ')})` : ' 🎉'}.`); txt.push(`${ok.length} of ${d.habits.length} habits done.`); }
  if (d.workouts.length) { md.push(`**Workouts:** ${d.workouts.join(' · ')}`); txt.push(`Workouts: ${d.workouts.join(', ')}.`); }
  if (d.focusMin) { md.push(`**Focus:** ${d.focusMin} minutes.`); txt.push(`${d.focusMin} minutes of focus.`); }
  if (d.missions.length) { md.push(`**Missions finished:** ${d.missions.join(' · ')}`); txt.push(`Missions finished: ${d.missions.length}.`); }
  if (d.openTodos.length) { md.push(`**Still on your to-do list (${d.openTodos.length}):**\n${d.openTodos.slice(0, 5).map((t) => '- ' + t).join('\n')}`); txt.push(`${d.openTodos.length} to-dos left.`); }
  if (d.tomorrow.length) { md.push(`**Tomorrow:**\n${d.tomorrow.slice(0, 6).map((x) => `- ${x.at ? timeOf(x.at) + ' · ' : ''}${x.text}`).join('\n')}`); txt.push(`Tomorrow: ${d.tomorrow.slice(0, 4).map((x) => x.text).join('; ')}.`); }
  if (d.weather) { const t = d.weather.days[1]; md.push(`${t.icon} Tomorrow: ${t.sky}, ${t.low}–${t.high}${d.weather.units}${t.rain != null && t.rain >= 40 ? `, ${t.rain}% chance of rain` : ''}.`); txt.push(`Tomorrow ${t.sky}, ${t.low} to ${t.high}${d.weather.units}.`); }
  return { md: md.join('\n\n'), text: txt.join(' ') };
}

export async function buildEvening() { return composeEvening(await gatherEvening()); }

/** Evening summary due? (on, after its time, before 3 am, once a day) */
export function isEveningDue(now = new Date(), b = settings.briefing || {}) {
  if (b.evening === false) return false;
  const mins = now.getHours() * 60 + now.getMinutes();
  return b.lastEvening !== todayKey(now) && mins >= minutesOf(b.eveningTime || '21:00');
}

export function startEvening(deliver) {
  const tick = async () => {
    if (!isEveningDue()) return;
    set('briefing.lastEvening', todayKey());
    try { const b = await buildEvening(); await deliver(b); textIt(b.text); } catch (e) { console.error(e); }
  };
  setTimeout(tick, 6000);
  return setInterval(tick, 60000);
}
