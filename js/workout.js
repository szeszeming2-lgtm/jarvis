// Workout log: what you did, when. Stored only on this device.
import { read, write, tombstone } from './store.js';
import { bus, uid } from './util.js';

let log = [];
export async function load() { log = await read('workouts', []); return log; }
const save = () => { write('workouts', log).catch(console.error); bus.emit('workouts', log); };
export const all = () => log;

const NAMES = {
  pushup: 'push-ups', pushups: 'push-ups', 'push ups': 'push-ups', 'push-up': 'push-ups', 'press ups': 'push-ups', 'press-ups': 'push-ups',
  squat: 'squats', 'jumping jack': 'jumping jacks', jacks: 'jumping jacks', curl: 'bicep curls', curls: 'bicep curls', 'bicep curl': 'bicep curls',
  situp: 'sit-ups', 'sit up': 'sit-ups', 'sit ups': 'sit-ups', 'sit-up': 'sit-ups', 'sit-ups & crunches': 'sit-ups', crunch: 'sit-ups', crunche: 'sit-ups', lunge: 'lunges', burpee: 'burpees', pullup: 'pull-ups', 'pull up': 'pull-ups', 'pull ups': 'pull-ups', 'pull-up': 'pull-ups', 'chin up': 'pull-ups',
  'shoulder pres': 'shoulder press', 'overhead pres': 'shoulder press', 'lateral raise': 'lateral raises', 'high knee': 'high knees', 'glute bridge': 'glute bridges', bridge: 'glute bridges', 'wall sit': 'wall sit',
  run: 'running', ran: 'running', jog: 'running', walk: 'walking', walked: 'walking', bike: 'cycling', cycle: 'cycling', swim: 'swimming', swam: 'swimming',
};
export function normExercise(n) {
  const k = String(n || '').toLowerCase().trim().replace(/s$/, '').replace(/\s+/g, ' ');
  return NAMES[k] || NAMES[k + 's'] || NAMES[String(n || '').toLowerCase().trim()] || String(n || 'workout').toLowerCase().trim();
}

/** entry: {exercise, reps, sets, weight, unit, seconds, distanceKm, source} */
export function add(entry) {
  const e = { id: uid('w'), ts: Date.now(), source: 'manual', ...entry, exercise: normExercise(entry.exercise) };
  for (const k of ['reps', 'sets', 'weight', 'seconds', 'distanceKm']) if (e[k] != null) { e[k] = Number(e[k]); if (!(e[k] > 0)) delete e[k]; }
  if (!e.reps && !e.seconds && !e.distanceKm) throw new Error('How many reps, or how long?');
  log.push(e);
  save();
  return e;
}

export function remove(id) { tombstone('workout:' + id); log = log.filter((e) => e.id !== id); save(); }

export function describe(e) {
  const parts = [];
  if (e.sets && e.reps) parts.push(`${e.sets} × ${e.reps} ${e.exercise}`);
  else if (e.reps) parts.push(`${e.reps} ${e.exercise}`);
  else parts.push(e.exercise);
  if (e.weight) parts.push(`at ${e.weight} ${e.unit || 'kg'}`);
  if (e.distanceKm) parts.push(`${e.distanceKm} km`);
  if (e.seconds) parts.push(e.seconds >= 60 ? `${Math.floor(e.seconds / 60)} min${e.seconds % 60 ? ` ${e.seconds % 60} s` : ''}` : `${e.seconds} s`);
  return parts.join(' · ');
}

const dayKey = (ts) => new Date(ts).toDateString();

/** Summary of the last `days` days. */
export function summary(days = 7) {
  const since = Date.now() - days * 86400000;
  const recent = log.filter((e) => e.ts >= since);
  const byExercise = {};
  for (const e of recent) {
    const b = (byExercise[e.exercise] ||= { reps: 0, seconds: 0, km: 0, times: 0 });
    b.reps += (e.reps || 0) * (e.sets || 1); b.seconds += e.seconds || 0; b.km += e.distanceKm || 0; b.times++;
  }
  const activeDays = new Set(recent.map((e) => dayKey(e.ts))).size;
  // Streak: consecutive days up to today (or yesterday) with any workout.
  const daysWith = new Set(log.map((e) => dayKey(e.ts)));
  let streak = 0;
  const d = new Date();
  if (!daysWith.has(d.toDateString())) d.setDate(d.getDate() - 1);
  while (daysWith.has(d.toDateString())) { streak++; d.setDate(d.getDate() - 1); }
  return { days, sessions: recent.length, activeDays, streak, byExercise, last: log[log.length - 1] || null, total: log.length };
}

export function summaryText(s) {
  if (!s.sessions) return s.total ? `No workouts in the last ${s.days} days. Your last one was ${describe(s.last)} on ${new Date(s.last.ts).toLocaleDateString()}. Want to start one now?` : 'No workouts logged yet. Say “track my squats” to count reps with the camera, or “log 20 push-ups”.';
  const lines = Object.entries(s.byExercise).map(([ex, b]) => `- **${ex}**: ${[b.reps ? `${b.reps} reps` : '', b.km ? `${Math.round(b.km * 10) / 10} km` : '', b.seconds ? `${Math.round(b.seconds / 60)} min` : ''].filter(Boolean).join(', ')} (${b.times}×)`);
  return `In the last ${s.days} days you worked out on **${s.activeDays} day${s.activeDays === 1 ? '' : 's'}** (${s.sessions} entr${s.sessions === 1 ? 'y' : 'ies'}).${s.streak > 1 ? ` You’re on a **${s.streak}-day streak**. 🔥` : ''}\n\n${lines.join('\n')}`;
}
