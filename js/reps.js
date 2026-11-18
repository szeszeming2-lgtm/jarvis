// Rep counting from body landmarks (MediaPipe Pose: 33 points, x/y in 0..1).
// Pure logic, no camera needed, so it can be unit-tested with made-up poses.

export const EXERCISES = {
  squats: { label: 'Squats', icon: 'zap', how: 'Stand side-on or facing the camera, whole body in view.' },
  pushups: { label: 'Push-ups', icon: 'zap', how: 'Put the phone on the floor to your side so your whole body is in view.' },
  jacks: { label: 'Jumping jacks', icon: 'zap', how: 'Face the camera, whole body in view.' },
  curls: { label: 'Bicep curls', icon: 'zap', how: 'Face the camera or stand side-on, arms in view.' },
  plank: { label: 'Plank', icon: 'clock', how: 'Side-on to the camera, whole body in view. The timer runs while your body is straight.' },
};

const P = { ls: 11, rs: 12, le: 13, re: 14, lw: 15, rw: 16, lh: 23, rh: 24, lk: 25, rk: 26, la: 27, ra: 28 };

/** Angle at b (degrees) between a-b-c. aspect = video width / height. */
export function angle(a, b, c, aspect = 1) {
  const v1 = { x: (a.x - b.x) * aspect, y: a.y - b.y }, v2 = { x: (c.x - b.x) * aspect, y: c.y - b.y };
  const dot = v1.x * v2.x + v1.y * v2.y;
  const m = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
  return m ? (Math.acos(Math.max(-1, Math.min(1, dot / m))) * 180) / Math.PI : 180;
}

const vis = (p) => (p ? p.visibility ?? 1 : 0);
const seen = (lm, ...ids) => ids.every((i) => vis(lm[i]) > 0.5);

/** Pick the better-visible side for a joint chain. */
function sideAngle(lm, aspect, [a1, b1, c1], [a2, b2, c2]) {
  const s1 = vis(lm[a1]) + vis(lm[b1]) + vis(lm[c1]);
  const s2 = vis(lm[a2]) + vis(lm[b2]) + vis(lm[c2]);
  if (Math.max(s1, s2) < 1.6) return null;
  return s1 >= s2 ? angle(lm[a1], lm[b1], lm[c1], aspect) : angle(lm[a2], lm[b2], lm[c2], aspect);
}

export class RepCounter {
  constructor(exercise) {
    this.exercise = exercise;
    this.reps = 0;
    this.phase = 'up';       // up (start) / down (bottom of the rep)
    this.smooth = null;
    this.minInRep = 999;
    this.tip = '';
    this.holdMs = 0;
    this.lastT = null;
  }

  reset() { Object.assign(this, new RepCounter(this.exercise)); }

  /** Feed one frame. Returns {reps, visible, angle, tip, holdSec, counted}. */
  update(lm, aspect = 1, t = 0) {
    const dt = this.lastT == null ? 0 : Math.min(500, t - this.lastT);
    this.lastT = t;
    let counted = false;
    if (!lm || lm.length < 29) return this.out(false, null, 'Step back so your whole body is in view.', counted);
    const ex = this.exercise;

    if (ex === 'jacks') {
      if (!seen(lm, P.ls, P.rs, P.lw, P.rw, P.la, P.ra)) return this.out(false, null, 'Face the camera with your whole body in view.', counted);
      const shoulderW = Math.abs(lm[P.ls].x - lm[P.rs].x) * aspect || 0.01;
      const feet = Math.abs(lm[P.la].x - lm[P.ra].x) * aspect / shoulderW;
      const handsUp = lm[P.lw].y < lm[P.ls].y && lm[P.rw].y < lm[P.rs].y;
      const handsDown = lm[P.lw].y > lm[P.ls].y + 0.05 && lm[P.rw].y > lm[P.rs].y + 0.05;
      if (this.phase === 'up' && handsUp && feet > 1.3) this.phase = 'down';       // "open" position
      else if (this.phase === 'down' && handsDown && feet < 1.15) { this.phase = 'up'; this.reps++; counted = true; }
      return this.out(true, null, '', counted);
    }

    let a = null, downAt, upAt, tipLow;
    if (ex === 'squats') { a = sideAngle(lm, aspect, [P.lh, P.lk, P.la], [P.rh, P.rk, P.ra]); downAt = 100; upAt = 160; tipLow = 'Try to go a little lower.'; }
    else if (ex === 'pushups') { a = sideAngle(lm, aspect, [P.ls, P.le, P.lw], [P.rs, P.re, P.rw]); downAt = 95; upAt = 155; tipLow = 'Lower your chest a bit more.'; }
    else if (ex === 'curls') { a = sideAngle(lm, aspect, [P.ls, P.le, P.lw], [P.rs, P.re, P.rw]); downAt = 55; upAt = 150; tipLow = 'Curl all the way up.'; }
    else if (ex === 'plank') {
      a = sideAngle(lm, aspect, [P.ls, P.lh, P.la], [P.rs, P.rh, P.ra]);
      if (a == null) return this.out(false, null, 'Turn side-on so your whole body is in view.', counted);
      const flat = Math.abs(lm[P.ls].y - lm[P.la].y) < 0.35;
      const straight = a > 155;
      if (flat && straight) this.holdMs += dt;
      return this.out(true, a, !flat ? 'Get into a plank position.' : !straight ? (a < 155 ? 'Keep your hips in line with your body.' : '') : '', counted);
    }
    if (a == null) return this.out(false, null, 'Step back so your whole body is in view.', counted);
    this.smooth = this.smooth == null ? a : this.smooth * 0.5 + a * 0.5;
    const s = this.smooth;
    if (this.phase === 'up') {
      if (s < downAt) { this.phase = 'down'; this.minInRep = s; this.tip = ''; }
      else if (s < upAt - 20) this.minInRep = Math.min(this.minInRep, s);
    } else {
      this.minInRep = Math.min(this.minInRep, s);
      if (s > upAt) { this.phase = 'up'; this.reps++; counted = true; this.minInRep = 999; }
    }
    // A shallow rep: went part way down and came back up without reaching the bottom.
    if (this.phase === 'up' && s > upAt && this.minInRep < upAt - 25 && this.minInRep >= downAt) { this.tip = tipLow; this.minInRep = 999; }
    return this.out(true, s, this.tip, counted);
  }

  out(visible, a, tip, counted) {
    return { reps: this.reps, visible, angle: a == null ? null : Math.round(a), tip, holdSec: Math.floor(this.holdMs / 1000), counted, phase: this.phase };
  }
}
