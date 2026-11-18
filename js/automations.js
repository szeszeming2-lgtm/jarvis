// Automations: "every weekday at 9am, start my workday". A schedule plus something to
// do: a command (anything you could type to JARVIS) or a plugin. They run while JARVIS
// is open (the Mac app keeps running in the background). Every run is kept in a history,
// and actions still follow your Permissions, so anything set to "ask" waits for you.
import { read, write, logActivity } from './store.js';
import { bus, uid } from './util.js';

let items = [];
let timer = 0;
export async function load() { items = await read('automations', []); return items; }
const save = () => { write('automations', items).catch(console.error); bus.emit('automations', items); };
export const all = () => items;

const pad = (n) => String(n).padStart(2, '0');
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** "8am" / "8:30 pm" / "20:15" / "noon" → "HH:MM" (or '' if not a time). */
export function parseTime(s) {
  const t = String(s || '').trim().toLowerCase();
  if (t === 'noon' || t === 'midday') return '12:00';
  if (t === 'midnight') return '00:00';
  const m = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/);
  if (!m) return '';
  let h = +m[1]; const min = +(m[2] || 0);
  if (m[3]?.startsWith('p') && h < 12) h += 12;
  if (m[3]?.startsWith('a') && h === 12) h = 0;
  if (h > 23 || min > 59) return '';
  return `${pad(h)}:${pad(min)}`;
}

/** When is it next due after `from`? schedule: {repeat: daily|weekdays|weekly|monthly|hourly, time:'HH:MM', day} */
export function nextRun(schedule, from = new Date()) {
  const [hh, mm] = (schedule.time || '09:00').split(':').map(Number);
  const d = new Date(from); d.setSeconds(0, 0);
  if (schedule.repeat === 'hourly') { d.setMinutes(mm || 0); if (d <= from) d.setHours(d.getHours() + 1); return d.getTime(); }
  d.setHours(hh, mm);
  const ok = (x) => schedule.repeat === 'weekdays' ? x.getDay() > 0 && x.getDay() < 6
    : schedule.repeat === 'weekly' ? x.getDay() === (schedule.day ?? 1)
      : schedule.repeat === 'monthly' ? x.getDate() === Math.min(schedule.date || 1, 28) : true;
  for (let i = 0; i < 400; i++) { if (d > from && ok(d)) return d.getTime(); d.setDate(d.getDate() + 1); d.setHours(hh, mm); }
  return d.getTime();
}

export function describe(s) {
  const t = new Date(2000, 0, 1, ...(s.time || '09:00').split(':').map(Number)).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return s.repeat === 'hourly' ? `every hour at :${(s.time || '00:00').split(':')[1]}` : s.repeat === 'weekdays' ? `every weekday at ${t}` : s.repeat === 'weekly' ? `every ${DAYS[s.day ?? 1].replace(/^./, (c) => c.toUpperCase())} at ${t}` : s.repeat === 'monthly' ? `on day ${s.date || 1} of every month at ${t}` : `every day at ${t}`;
}

const EVERY = '(day|morning|evening|night|weekday|week|month|hour|sunday|monday|tuesday|wednesday|thursday|friday|saturday)';
const AT = '(\\d{1,2}(?::\\d{2})?\\s*(?:am|pm|a\\.m\\.|p\\.m\\.)?|noon|midnight)';
/** "every weekday at 9am open Mail" / "open Mail every weekday at 9am" → {every, at, command} or null. */
export function parseRequest(text) {
  const t = String(text || '').trim().replace(/[.!]+$/, '');
  let m = t.match(new RegExp(`^(?:every|each) ${EVERY}(?: at ${AT})?,? (.{3,200})$`, 'i'));
  if (m) return { every: m[1], at: m[2] || '', command: m[3] };
  m = t.match(new RegExp(`^(.{3,200}?),? (?:every|each) ${EVERY}(?: at ${AT})?$`, 'i'));
  if (m) return { every: m[2], at: m[3] || '', command: m[1] };
  m = t.match(new RegExp(`^at ${AT} every ${EVERY},? (.{3,200})$`, 'i'));
  if (m) return { every: m[2], at: m[1], command: m[3] };
  return null;
}

/** Make one from words: every="day|weekday|monday|week|month|hour|morning|evening", at="8am", command="open Spotify". */
export function fromWords({ every, at = '', command, name = '' }) {
  const e = String(every || 'day').toLowerCase();
  const repeat = ['day', 'morning', 'evening', 'night', 'daily'].includes(e) ? 'daily' : e === 'weekday' || e === 'weekdays' ? 'weekdays' : e === 'month' ? 'monthly' : e === 'hour' ? 'hourly' : 'weekly';
  const time = parseTime(at) || { morning: '08:00', evening: '18:00', night: '21:00' }[e] || (repeat === 'hourly' ? '00:00' : '09:00');
  const day = DAYS.indexOf(e) >= 0 ? DAYS.indexOf(e) : new Date().getDay();
  return add({ name: name || command, schedule: { repeat, time, day, date: new Date().getDate() }, action: { kind: 'command', text: command } });
}

export function add({ name, schedule, action }) {
  if (!action?.text?.trim()) throw new Error('What should happen?');
  const a = { id: uid('au'), name: String(name || action.text).slice(0, 80), schedule, action, enabled: true, created: Date.now(), next: nextRun(schedule), history: [] };
  items.push(a); save();
  return { ...a, when: describe(schedule) };
}
export function toggle(id, on) { const a = items.find((x) => x.id === id); if (a) { a.enabled = on; a.next = nextRun(a.schedule); save(); } }
export function remove(id) { items = items.filter((x) => x.id !== id); save(); }
export function update(id, patch) { const a = items.find((x) => x.id === id); if (a) { Object.assign(a, patch); a.next = nextRun(a.schedule); save(); } }

/** Check every 30 s; run what's due. run(action) does the work and returns {ok, note}. */
export function start(run) {
  const tick = async () => {
    const now = Date.now();
    for (const a of items) {
      if (!a.enabled || !a.next || a.next > now) continue;
      // Missed while closed for more than an hour? Skip to the next time instead of running late.
      const late = now - a.next > 3600000;
      a.next = nextRun(a.schedule, new Date(now));
      if (late) { a.history.unshift({ at: now, ok: false, note: 'Skipped (JARVIS was closed at that time)' }); save(); continue; }
      let res = { ok: false, note: '' };
      try { res = await run(a.action, a); } catch (e) { res = { ok: false, note: e.message }; }
      a.history.unshift({ at: now, ok: !!res.ok, note: res.note || '' });
      a.history = a.history.slice(0, 20);
      logActivity({ tool: 'automation', summary: `${a.name}: ${res.ok ? 'ran' : 'failed'}${res.note ? ' · ' + res.note : ''}`, result: res.ok ? 'ok' : 'error' }).catch(() => {});
      save();
    }
  };
  clearInterval(timer);
  timer = setInterval(tick, 30000);
  setTimeout(tick, 5000);
}
