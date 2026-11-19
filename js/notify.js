// Notification center: every alert JARVIS makes goes through here. It keeps a history
// (bell button), respects quiet hours, and during a focus session holds back anything
// that isn't urgent until the session ends. Reminders and calls are always "high".
import { read, write, settings } from './store.js';
import { bus, uid } from './util.js';

let items = [];
let held = [];
export async function load() { items = await read('notifications', []); return items; }
const save = () => { write('notifications', items.slice(0, 100)).catch(() => {}); bus.emit('notifications', items); };
export const all = () => items;
export const unread = () => items.filter((n) => !n.read).length;

const mins = (hhmm) => { const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/); return m ? +m[1] * 60 + +m[2] : null; };
/** Inside quiet hours? (start > end means overnight, e.g. 22:00–07:00) */
export function quietNow(now = new Date(), q = settings.notify || {}) {
  if (!q.quiet) return false;
  const s = mins(q.quietStart || '22:00'), e = mins(q.quietEnd || '07:00'), t = now.getHours() * 60 + now.getMinutes();
  if (s == null || e == null || s === e) return false;
  return s < e ? t >= s && t < e : t >= s || t < e;
}
let focusing = () => false;
export const setFocusCheck = (fn) => { focusing = fn; };

/**
 * Notify. priority: 'high' (always shown), 'normal', 'low'. show(n) displays it (toast etc).
 * Returns {shown, held}.
 */
export function notify(title, body = '', { priority = 'normal', kind = 'info', icon = 'bell', show } = {}) {
  const n = { id: uid('nt'), title: String(title).slice(0, 160), body: String(body).slice(0, 500), priority, kind, icon, at: Date.now(), read: false };
  items.unshift(n);
  save();
  const hold = priority !== 'high' && (quietNow() || focusing());
  if (hold) { held.push({ n, show }); return { shown: false, held: true }; }
  show?.(n);
  return { shown: true, held: false };
}

/** After focus or quiet hours: show what was held back, as one summary. */
export function releaseHeld(showSummary) {
  if (!held.length) return 0;
  const list = held; held = [];
  showSummary?.(list.map((x) => x.n));
  return list.length;
}
export function markAllRead() { for (const n of items) n.read = true; save(); }
export function clear() { items = []; save(); }
