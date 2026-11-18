// Rep counting from body landmarks (MediaPipe Pose: 33 points, x/y in 0..1).
// Pure logic, no camera needed, so it can be unit-tested with made-up poses.

export const EXERCISES = {
  squats: { label: 'Squats', icon: 'zap', how: 'Stand side-on or facing the camera, whole body in view.' },
  pushups: { label: 'Push-ups', icon: 'zap', how: 'Put the phone on the floor to your side so your whole body is in view.' },
  jacks: { label: 'Jumping jacks', icon: 'zap', how: 'Face the camera, whole body in view.' },
  curls: { label: 'Bicep curls', icon: 'zap', how: 'Face the camera or stand side-on, arms in view.' },
  lunges: { label: 'Lunges', icon: 'zap', how: 'Stand side-on to the camera, whole body in view. Step forward and lower your back knee.' },
  situps: { label: 'Sit-ups & crunches', icon: 'zap', how: 'Lie on your back side-on to the camera, knees bent.' },
  press: { label: 'Shoulder press', icon: 'zap', how: 'Face the camera, arms and head in view. With or without weights.' },
  raises: { label: 'Lateral raises', icon: 'zap', how: 'Face the camera, arms in view. Raise your arms out to the side.' },
  knees: { label: 'High knees', icon: 'zap', how: 'Face the camera, whole body in view. Every knee lift counts.' },
  bridges: { label: 'Glute bridges', icon: 'zap', how: 'Lie on your back side-on to the camera, knees bent, then lift your hips.' },
  burpees: { label: 'Burpees', icon: 'zap', how: 'Put the phone further away so your whole body is in view, standing and on the floor.' },
  pullups: { label: 'Pull-ups', icon: 'zap', how: 'Camera in front of or behind you, arms and head in view while you hang.' },
  plank: { label: 'Plank', icon: 'clock', hold: true, how: 'Side-on to the camera, whole body in view. The timer runs while your body is straight.' },
  wallsit: { label: 'Wall sit', icon: 'clock', hold: true, how: 'Side-on to the camera, back against a wall. The timer runs while your thighs are level.' },
};

const P = { nose: 0, ls: 11, rs: 12, le: 13, re: 14, lw: 15, rw: 16, lh: 23, rh: 24, lk: 25, rk: 26, la: 27, ra: 28 };

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

/** Smallest angle of the two sides (lunges: whichever knee bends more). */
function bothAngle(lm, aspect, [a1, b1, c1], [a2, b2, c2]) {
  const ok1 = vis(lm[a1]) + vis(lm[b1]) + vis(lm[c1]) > 1.6, ok2 = vis(lm[a2]) + vis(lm[b2]) + vis(lm[c2]) > 1.6;
  if (!ok1 && !ok2) return null;
  const v = [ok1 ? angle(lm[a1], lm[b1], lm[c1], aspect) : 999, ok2 ? angle(lm[a2], lm[b2], lm[c2], aspect) : 999];
  return Math.min(...v);
}
const lying = (lm) => Math.abs((lm[P.ls].y + lm[P.rs].y) / 2 - (lm[P.lh].y + lm[P.rh].y) / 2) < 0.18;
const wristsAboveShoulders = (lm) => (lm[P.lw].y + lm[P.rw].y) / 2 < (lm[P.ls].y + lm[P.rs].y) / 2;

// Moves counted from one joint angle: start straight (up), bend below downAt, straighten past upAt = 1 rep.
const ANGLES = {
  squats: { joints: [[P.lh, P.lk, P.la], [P.rh, P.rk, P.ra]], downAt: 100, upAt: 160, tipLow: 'Try to go a little lower.' },
  lunges: { joints: [[P.lh, P.lk, P.la], [P.rh, P.rk, P.ra]], both: true, downAt: 108, upAt: 155, tipLow: 'Lower your back knee closer to the floor.' },
  pushups: { joints: [[P.ls, P.le, P.lw], [P.rs, P.re, P.rw]], downAt: 95, upAt: 155, tipLow: 'Lower your chest a bit more.' },
  curls: { joints: [[P.ls, P.le, P.lw], [P.rs, P.re, P.rw]], downAt: 55, upAt: 150, tipLow: 'Curl all the way up.' },
  // Press: bent at the shoulders (down) → arms straight overhead (counts at the top).
  press: { joints: [[P.ls, P.le, P.lw], [P.rs, P.re, P.rw]], downAt: 100, upAt: 155, ready: (lm) => (seen(lm, P.ls, P.rs, P.lw, P.rw) ? '' : 'Face the camera with your arms in view.'), okUp: (lm) => (wristsAboveShoulders(lm) ? '' : 'Press your hands up over your head.'), tipLow: 'Press all the way up.' },
  // Raises: angle hip–shoulder–wrist is how far the arm is out; flipped so arms down = straight.
  raises: { joints: [[P.lh, P.ls, P.lw], [P.rh, P.rs, P.rw]], flip: true, downAt: 110, upAt: 150, tipLow: 'Raise your arms to shoulder height.' },
  // Sit-ups: lying, shoulder–hip–knee closes as you curl up.
  situps: { joints: [[P.ls, P.lh, P.lk], [P.rs, P.rh, P.rk]], downAt: 85, upAt: 118, tipLow: 'Curl up a little higher.' },
  // Bridges: lying with hips down (bent), lift until shoulder–hip–knee is straight (counts at the top).
  bridges: { joints: [[P.ls, P.lh, P.lk], [P.rs, P.rh, P.rk]], downAt: 150, upAt: 166, ready: (lm) => (Math.abs(lm[P.ls].y - lm[P.lk].y) < 0.3 || Math.abs(lm[P.rs].y - lm[P.rk].y) < 0.3 ? '' : 'Lie on your back, side-on to the camera.') },
  // Pull-ups: hanging (wrists above shoulders); elbows bend; chin must reach the hands.
  pullups: { joints: [[P.ls, P.le, P.lw], [P.rs, P.re, P.rw]], downAt: 95, upAt: 150, ready: (lm) => (seen(lm, P.ls, P.rs, P.lw, P.rw) && wristsAboveShoulders(lm) ? '' : 'Hang from the bar with your arms and head in view.'), okDown: (lm) => (lm[P.nose].y < (lm[P.lw].y + lm[P.rw].y) / 2 + 0.04 ? '' : 'Pull until your chin is over the bar.'), tipLow: 'Pull until your chin is over the bar.' },
};

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

    if (ex === 'knees') return this.highKnees(lm, counted);
    if (ex === 'burpees') return this.burpee(lm, aspect, counted);
    if (ex === 'wallsit') {
      const k = sideAngle(lm, aspect, [P.lh, P.lk, P.la], [P.rh, P.rk, P.ra]);
      if (k == null) return this.out(false, null, 'Turn side-on so your legs are in view.', counted);
      const level = k > 70 && k < 125;
      if (level) this.holdMs += dt;
      return this.out(true, k, level ? '' : k >= 125 ? 'Slide down until your thighs are level.' : 'Come up a little, knees over ankles.', counted);
    }

    let a = null, downAt, upAt, tipLow = '';
    const cfg = ANGLES[ex];
    if (cfg) {
      const ready = cfg.ready?.(lm);
      if (ready) return this.out(false, null, ready, counted);
      a = cfg.both ? bothAngle(lm, aspect, ...cfg.joints) : sideAngle(lm, aspect, ...cfg.joints);
      if (a != null && cfg.flip) a = 180 - a;
      ({ downAt, upAt, tipLow = '' } = cfg);
      if (a != null && cfg.okDown && this.phase === 'up' && a < downAt) {
        const t = cfg.okDown(lm);
        if (t) { this.tip = t; a = Math.max(a, downAt + 1); } // not deep enough yet: don't start the rep
      }
    }
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
      const notYet = s > upAt && cfg?.okUp?.(lm);
      if (notYet) this.tip = notYet;
      else if (s > upAt) { this.phase = 'up'; this.reps++; counted = true; this.minInRep = 999; }
    }
    // A shallow rep: went part way down and came back up without reaching the bottom.
    if (this.phase === 'up' && s > upAt && this.minInRep < upAt - 25 && this.minInRep >= downAt) { this.tip = tipLow; this.minInRep = 999; }
    return this.out(true, s, this.tip, counted);
  }

  /** High knees: each knee lifted to about hip height counts once. */
  highKnees(lm, counted) {
    if (!seen(lm, P.lh, P.rh, P.lk, P.rk)) return this.out(false, null, 'Face the camera with your whole body in view.', counted);
    this.legs ||= { l: { up: false, thigh: 0 }, r: { up: false, thigh: 0 } };
    for (const [side, hip, knee] of [['l', P.lh, P.lk], ['r', P.rh, P.rk]]) {
      const leg = this.legs[side];
      const drop = lm[knee].y - lm[hip].y;           // how far the knee is below the hip
      leg.thigh = Math.max(leg.thigh * 0.995, drop);  // standing thigh length, slowly adapting
      if (leg.thigh < 0.05) continue;
      if (!leg.up && drop < leg.thigh * 0.45) { leg.up = true; this.reps++; counted = true; }
      else if (leg.up && drop > leg.thigh * 0.8) leg.up = false;
    }
    return this.out(true, null, '', counted);
  }

  /** Burpees: standing → down on the floor → standing again = 1. */
  burpee(lm, aspect, counted) {
    if (!seen(lm, P.ls, P.rs, P.lh, P.rh) || !(vis(lm[P.la]) > 0.4 || vis(lm[P.ra]) > 0.4)) return this.out(false, null, 'Move the phone back so your whole body is in view.', counted);
    const sh = (lm[P.ls].y + lm[P.rs].y) / 2;
    const ankle = vis(lm[P.la]) >= vis(lm[P.ra]) ? lm[P.la].y : lm[P.ra].y;
    const tall = ankle - sh;                          // body height on screen (standing is large)
    this.tallMax = Math.max((this.tallMax || 0) * 0.998, tall);
    if (this.phase === 'up' && tall < this.tallMax * 0.45) this.phase = 'down';
    else if (this.phase === 'down' && tall > this.tallMax * 0.8) { this.phase = 'up'; this.reps++; counted = true; }
    return this.out(true, null, '', counted);
  }

  out(visible, a, tip, counted) {
    return { reps: this.reps, visible, angle: a == null ? null : Math.round(a), tip, holdSec: Math.floor(this.holdMs / 1000), counted, phase: this.phase };
  }
}
