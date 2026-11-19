// Reminders: saved on this device, announced (spoken + notification) when due.
// The desktop app also adds them to the system's Reminders app so your phone
// reminds you even when JARVIS is closed. The web version can export a calendar
// file (.ics) for the same reason.
import { read, write, settings, tombstone } from './store.js';
import { bus, uid } from './util.js';
import { call, can, isNative } from './host.js';
import { parseWhen, describeWhen } from './when.js';

let items = [];
const timers = new Map();

export async function load() {
  items = await read('reminders', []);
  const now = Date.now();
  // Anything that came due while JARVIS was closed is announced once, shortly after start.
  const missed = items.filter((r) => !r.done && r.due <= now);
  for (const r of items) if (!r.done && r.due > now) schedule(r);
  if (missed.length) setTimeout(() => missed.forEach((r) => fire(r, true)), 2500);
  return items;
}

const save = () => { write('reminders', items).catch(console.error); bus.emit('reminders', items); };
export const upcoming = () => items.filter((r) => !r.done).sort((a, b) => a.due - b.due);
export const all = () => items;

function schedule(r) {
  clearTimeout(timers.get(r.id));
  const wait = r.due - Date.now();
  // setTimeout can't wait more than ~24 days; re-check daily for far-off reminders.
  timers.set(r.id, setTimeout(() => (r.due - Date.now() > 1000 ? schedule(r) : fire(r)), Math.min(Math.max(0, wait), 86400000)));
}

/** The next time a repeating reminder is due after `from`. */
export function nextDue(due, repeat, from = Date.now()) {
  const d = new Date(due);
  const step = () => {
    if (repeat === 'daily') d.setDate(d.getDate() + 1);
    else if (repeat === 'weekdays') { do d.setDate(d.getDate() + 1); while (d.getDay() === 0 || d.getDay() === 6); }
    else if (repeat === 'weekly') d.setDate(d.getDate() + 7);
    else if (repeat === 'monthly') d.setMonth(d.getMonth() + 1);
    else if (repeat === 'yearly') d.setFullYear(d.getFullYear() + 1);
  };
  do step(); while (d.getTime() <= from);
  return d.getTime();
}

function fire(r, missed = false) {
  if (r.done) return;
  r.firedAt = Date.now();
  if (r.repeat) { r.due = nextDue(r.due, r.repeat); schedule(r); } // repeating: set up the next one
  else r.done = true;
  save();
  bus.emit('reminder.due', { ...r, missed });
  const title = `${settings.assistantName} reminder`;
  call('app.notify', { title, body: r.text, sound: true }).catch(() => browserNotify(title, r.text));
  // Text you (Mac app, once your number is saved): asked for this one, or on for all reminders.
  // A reminder that came due hours ago while JARVIS was closed isn't texted late.
  const late = missed && Date.now() - r.due > 2 * 3600000;
  const textMe = r.textMe || (!r.callMe && settings.reminders?.textMe !== false && !!settings.profile?.phone);
  if (textMe && !late && can('messages')) call('messages.send', { to: 'me', text: `⏰ Reminder from ${settings.assistantName || 'JARVIS'}: ${r.text}` }).catch(() => {});
  if (r.callMe && !late && can('messages')) import('./tools.js').then(({ callText }) => call('messages.send', { to: 'me', text: callText(r.text) })).catch(() => {});
}

function browserNotify(title, body) {
  try { if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body, icon: 'assets/icon-192.png' }); } catch {}
}

/** Create a reminder. when = phrase ("in 10 minutes", "at 5pm") or a Date/ms. */
export async function add(text, when, { textMe = false, callMe = false, repeat = '' } = {}) {
  text = String(text || '').trim().replace(/^(to|that)\s+/i, '');
  if (!text) throw new Error('What should I remind you about?');
  let due;
  if (when instanceof Date) due = when.getTime();
  else if (typeof when === 'number') due = when;
  else {
    const p = parseWhen(when);
    if (!p) throw new Error(`I couldn’t understand the time “${when}”. Try “in 20 minutes” or “at 5:30 pm”.`);
    due = p.date.getTime();
  }
  if (due < Date.now() - 60000) throw new Error('That time has already passed.');
  if (repeat === 'weekdays') { const d = new Date(due); while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1); due = d.getTime(); }
  const r = { id: uid('r'), text, due, created: Date.now(), done: false, textMe: !!textMe, callMe: !!callMe, repeat: ['daily', 'weekdays', 'weekly', 'monthly', 'yearly'].includes(repeat) ? repeat : '' };
  // Desktop app: also put it in the system Reminders app (syncs to your phone).
  if (can('reminders') && settings.reminders?.system !== false) {
    try { const s = await call('reminders.add', { text, due, repeat: r.repeat }); r.systemId = s?.id; } catch (e) { r.systemError = e.message; }
  }
  items.push(r);
  schedule(r);
  save();
  if (!isNative && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  const REP = { daily: 'every day', weekdays: 'every weekday', weekly: `every ${new Date(due).toLocaleDateString(undefined, { weekday: 'long' })}`, monthly: 'every month', yearly: `every year on ${new Date(due).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}` };
  return { ...r, human: r.repeat ? `${REP[r.repeat]} at ${new Date(due).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}, starting ${describeWhen(new Date(due))}` : describeWhen(new Date(due)) };
}

export async function cancel(id) {
  const r = items.find((x) => x.id === id);
  if (!r) return false;
  clearTimeout(timers.get(id));
  items = items.filter((x) => x.id !== id);
  tombstone('reminder:' + id);
  if (r.systemId && can('reminders')) call('reminders.remove', { id: r.systemId }).catch(() => {});
  save();
  return true;
}

export function match(about) {
  const q = String(about || '').toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  return upcoming().filter((r) => !q.length || q.some((w) => r.text.toLowerCase().includes(w)));
}

export async function clearDone() { tombstone(...items.filter((r) => r.done).map((r) => 'reminder:' + r.id)); items = items.filter((r) => !r.done); save(); }
/** Reload after a sync without announcing old reminders again. */
export async function reload() { for (const t of timers.values()) clearTimeout(t); timers.clear(); items = await read('reminders', []); const now = Date.now(); for (const r of items) if (!r.done && r.due > now) schedule(r); bus.emit('reminders', items); return items; }

/** A calendar file with an alarm, so a phone or computer calendar can remind you even when JARVIS is closed. */
export function toICS(r) {
  const z = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (s) => String(s).replace(/[\\;,]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//JARVIS//Reminders//EN', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT', `UID:${r.id}@jarvis.local`, `DTSTAMP:${z(Date.now())}`, `DTSTART:${z(r.due)}`, `DTEND:${z(r.due + 15 * 60000)}`,
    `SUMMARY:${esc(r.text)}`, 'DESCRIPTION:Reminder from JARVIS',
    ...(r.repeat ? [`RRULE:${{ daily: 'FREQ=DAILY', weekdays: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', weekly: 'FREQ=WEEKLY', monthly: 'FREQ=MONTHLY', yearly: 'FREQ=YEARLY' }[r.repeat]}`] : []),
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(r.text)}`, 'TRIGGER:PT0S', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
}

export async function exportICS(id) {
  const r = items.find((x) => x.id === id);
  if (!r) throw new Error('That reminder is gone.');
  const name = r.text.replace(/[^\w\- ]+/g, '').slice(0, 40).trim() || 'Reminder';
  return call('file.save', { name: `${name}.ics`, content: toICS(r), type: 'text/calendar' });
}
