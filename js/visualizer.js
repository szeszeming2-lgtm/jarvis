// Animated circular AI visualizer (canvas 2D). Reacts to states:
// idle, listening (mic level), thinking, speaking (word pulses), error, offline.
import { settings } from './store.js';

const TAU = Math.PI * 2;

export class Visualizer {
  constructor(canvas, { small = false } = {}) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.small = small;
    this.state = 'idle';
    this.level = 0; this.levelT = 0;
    this.energy = 0; this.energyT = 0.15;
    this.pulse = 0;
    this.spin = 0;
    this.t0 = performance.now();
    this.last = 0;
    this.particles = Array.from({ length: small ? 16 : 54 }, () => ({ r: 0.72 + Math.random() * 0.3, a: Math.random() * TAU, s: (Math.random() * 0.4 + 0.08) * (Math.random() < 0.5 ? -1 : 1), z: Math.random() }));
    this.bars = new Float32Array(small ? 48 : 96);
    this.readColors();
    this.running = true;
    this.frame = this.frame.bind(this);
    requestAnimationFrame(this.frame);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && this.running) requestAnimationFrame(this.frame); });
  }

  readColors() {
    const cs = getComputedStyle(document.documentElement);
    this.rgb = cs.getPropertyValue('--accent-rgb').trim() || '42,212,255';
    this.rgb2 = cs.getPropertyValue('--accent2-rgb').trim() || '47,116,255';
  }

  setState(s) {
    this.state = s;
    this.energyT = { idle: 0.15, listening: 0.45, thinking: 0.7, speaking: 0.6, error: 0.3, offline: 0.05 }[s] ?? 0.2;
  }
  setLevel(v) { this.levelT = Math.max(0, Math.min(1, v)); }
  kick(amount = 0.5) { this.pulse = Math.min(1.2, this.pulse + amount); }
  destroy() { this.running = false; }

  quality() {
    const m = settings.appearance?.motion || 'full';
    return m;
  }

  frame(now) {
    if (!this.running || document.hidden) return;
    const q = this.quality();
    const minGap = q === 'reduced' ? 1000 / 30 : q === 'off' ? 1000 / 4 : 0;
    if (now - this.last < minGap) { requestAnimationFrame(this.frame); return; }
    const dt = Math.min(0.05, (now - (this.last || now)) / 1000);
    this.last = now;
    this.update(dt, now);
    this.draw(now);
    requestAnimationFrame(this.frame);
  }

  update(dt, now) {
    this.level += (this.levelT - this.level) * Math.min(1, dt * 14);
    this.levelT *= Math.pow(0.08, dt);
    this.energy += (this.energyT - this.energy) * Math.min(1, dt * 3);
    this.pulse *= Math.pow(0.04, dt);
    const speed = this.state === 'thinking' ? 2.4 : this.state === 'listening' ? 0.9 : this.state === 'speaking' ? 1.2 : 0.35;
    this.spin += dt * speed;
    const t = (now - this.t0) / 1000;
    for (let i = 0; i < this.bars.length; i++) {
      const a = i / this.bars.length * TAU;
      let target;
      if (this.state === 'listening') target = this.level * (0.55 + 0.45 * Math.abs(Math.sin(a * 3 + t * 6))) + 0.03 * Math.sin(a * 7 + t * 2);
      else if (this.state === 'speaking') target = (0.18 + this.pulse * 0.6) * (0.5 + 0.5 * Math.sin(a * 5 - t * 7)) * (0.6 + 0.4 * Math.sin(a * 2 + t * 3));
      else if (this.state === 'thinking') target = 0.22 * Math.max(0, Math.sin(a * 2 - t * 5)) ** 3 + 0.05;
      else target = 0.035 + 0.025 * Math.sin(a * 4 + t * 1.3);
      this.bars[i] += (Math.max(0, target) - this.bars[i]) * Math.min(1, dt * 12);
    }
    for (const p of this.particles) p.a += p.s * dt * (0.6 + this.energy * 2);
  }

  draw(now) {
    const c = this.c, g = this.g;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = c.clientWidth, hgt = c.clientHeight;
    if (!w || !hgt) return;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(hgt * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(hgt * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, hgt);
    const cx = w / 2, cy = hgt / 2;
    const R = Math.min(w, hgt) / 2 * 0.92;
    const style = this.small ? 'reactor' : (settings.appearance?.visualizer || 'reactor');
    const A = this.state === 'error' ? '255,90,118' : this.rgb;
    const B = this.state === 'error' ? '255,150,90' : this.rgb2;
    const t = (now - this.t0) / 1000;
    const e = this.energy;
    const breathe = 1 + Math.sin(t * 1.6) * 0.012 + this.pulse * 0.035 + this.level * 0.05;
    const dim = this.state === 'offline' ? 0.45 : 1;
    g.globalCompositeOperation = 'lighter';

    // Ambient glow
    const glow = g.createRadialGradient(cx, cy, R * 0.05, cx, cy, R * 1.05);
    glow.addColorStop(0, `rgba(${A},${0.30 * dim + e * 0.15})`);
    glow.addColorStop(0.35, `rgba(${B},${0.10 * dim + e * 0.05})`);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = glow;
    g.beginPath(); g.arc(cx, cy, R * 1.05, 0, TAU); g.fill();

    if (style === 'orb') return this.drawOrb(g, cx, cy, R, A, B, t, breathe, dim);
    if (style === 'wave') return this.drawWave(g, cx, cy, R, A, B, t, breathe, dim);

    // Outer tick ring
    const ticks = this.small ? 60 : 120;
    g.save(); g.translate(cx, cy); g.rotate(this.spin * 0.08);
    for (let i = 0; i < ticks; i++) {
      const a = i / ticks * TAU;
      const long = i % 10 === 0, mid = i % 5 === 0;
      const r1 = R * 0.965, r0 = R * (long ? 0.905 : mid ? 0.93 : 0.945);
      g.strokeStyle = `rgba(${A},${(long ? 0.75 : 0.32) * dim})`;
      g.lineWidth = long ? 1.6 : 1;
      g.beginPath(); g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); g.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); g.stroke();
    }
    g.restore();

    // Segmented arcs (counter-rotating)
    const ring = (r, segs, gap, width, alpha, rot, color = A) => {
      g.strokeStyle = `rgba(${color},${alpha * dim})`;
      g.lineWidth = width;
      g.lineCap = 'round';
      for (let i = 0; i < segs; i++) {
        const a0 = rot + i / segs * TAU + gap, a1 = rot + (i + 1) / segs * TAU - gap;
        g.beginPath(); g.arc(cx, cy, r, a0, a1); g.stroke();
      }
    };
    ring(R * 0.84 * breathe, 3, 0.22, 2.2, 0.85, this.spin * 0.5);
    ring(R * 0.80 * breathe, 12, 0.06, 1, 0.35, -this.spin * 0.3, B);
    ring(R * 0.40 * breathe, 6, 0.12, 3, 0.55 + this.pulse * 0.3, -this.spin * 0.9);

    // Thinking comet
    if (this.state === 'thinking' || e > 0.6) {
      const head = this.spin * 2.2;
      for (let k = 0; k < 18; k++) {
        g.strokeStyle = `rgba(${A},${(1 - k / 18) * 0.7 * dim})`;
        g.lineWidth = 3.2 - k * 0.12;
        g.beginPath(); g.arc(cx, cy, R * 0.72, head - k * 0.06 - 0.06, head - k * 0.06); g.stroke();
      }
    }

    // Radial bars (voice)
    const n = this.bars.length;
    const rb = R * 0.50 * breathe;
    g.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU - Math.PI / 2;
      const len = R * (0.02 + this.bars[i] * 0.42);
      const al = 0.35 + Math.min(0.6, this.bars[i] * 2.2);
      g.strokeStyle = `rgba(${i % 2 ? B : A},${al * dim})`;
      g.lineWidth = this.small ? 1.6 : 2.2;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * rb, cy + Math.sin(a) * rb);
      g.lineTo(cx + Math.cos(a) * (rb + len), cy + Math.sin(a) * (rb + len));
      g.stroke();
    }

    // Inner hex frame
    g.strokeStyle = `rgba(${A},${0.5 * dim})`;
    g.lineWidth = 1.2;
    g.beginPath();
    for (let i = 0; i <= 6; i++) {
      const a = i / 6 * TAU + this.spin * 0.2;
      const r = R * 0.29 * breathe;
      i ? g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r) : g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    g.stroke();

    // Core
    const coreR = R * (0.18 + this.level * 0.05 + this.pulse * 0.04) * breathe;
    const core = g.createRadialGradient(cx, cy, 0, cx, cy, coreR * 1.8);
    core.addColorStop(0, `rgba(255,255,255,${0.95 * dim})`);
    core.addColorStop(0.18, `rgba(${A},${0.95 * dim})`);
    core.addColorStop(0.55, `rgba(${B},${0.35 * dim})`);
    core.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = core;
    g.beginPath(); g.arc(cx, cy, coreR * 1.8, 0, TAU); g.fill();
    g.strokeStyle = `rgba(${A},${0.9 * dim})`;
    g.lineWidth = 1.5;
    g.beginPath(); g.arc(cx, cy, coreR * 1.05, 0, TAU); g.stroke();

    // Orbiting particles
    if (this.quality() !== 'off') {
      for (const p of this.particles) {
        const r = R * p.r * (0.92 + e * 0.08);
        const x = cx + Math.cos(p.a) * r, y = cy + Math.sin(p.a) * r;
        g.fillStyle = `rgba(${p.z > 0.5 ? A : B},${(0.25 + p.z * 0.6) * dim})`;
        g.beginPath(); g.arc(x, y, 0.6 + p.z * (this.small ? 1 : 1.6), 0, TAU); g.fill();
      }
    }
    g.globalCompositeOperation = 'source-over';
  }

  drawOrb(g, cx, cy, R, A, B, t, breathe, dim) {
    const n = 140;
    for (let layer = 0; layer < 3; layer++) {
      g.beginPath();
      for (let i = 0; i <= n; i++) {
        const a = i / n * TAU;
        const bi = Math.floor(i / n * this.bars.length) % this.bars.length;
        const wob = Math.sin(a * (3 + layer) + t * (1.2 + layer * 0.5)) * 0.03 + this.bars[bi] * 0.35;
        const r = R * (0.5 + layer * 0.06 + wob) * breathe;
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.closePath();
      g.strokeStyle = `rgba(${layer % 2 ? B : A},${(0.7 - layer * 0.18) * dim})`;
      g.lineWidth = 2 - layer * 0.4;
      g.stroke();
    }
    const core = g.createRadialGradient(cx - R * 0.1, cy - R * 0.12, 0, cx, cy, R * 0.5 * breathe);
    core.addColorStop(0, `rgba(255,255,255,${0.55 * dim})`);
    core.addColorStop(0.3, `rgba(${A},${0.45 * dim})`);
    core.addColorStop(1, `rgba(${B},0.02)`);
    g.fillStyle = core;
    g.beginPath(); g.arc(cx, cy, R * 0.5 * breathe, 0, TAU); g.fill();
    g.globalCompositeOperation = 'source-over';
  }

  drawWave(g, cx, cy, R, A, B, t, breathe, dim) {
    g.strokeStyle = `rgba(${A},${0.3 * dim})`;
    g.lineWidth = 1;
    g.beginPath(); g.arc(cx, cy, R * 0.82, 0, TAU); g.stroke();
    const W = R * 1.5;
    for (let k = 0; k < 4; k++) {
      g.beginPath();
      for (let i = 0; i <= 120; i++) {
        const x = cx - W / 2 + (i / 120) * W;
        const env = Math.sin((i / 120) * Math.PI);
        const bi = Math.floor(i / 120 * (this.bars.length - 1));
        const amp = R * (0.04 + this.bars[bi] * 0.9 + this.energy * 0.05) * env;
        const y = cy + Math.sin(i * 0.18 + t * (2 + k) + k) * amp * (1 - k * 0.2);
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.strokeStyle = `rgba(${k % 2 ? B : A},${(0.85 - k * 0.18) * dim})`;
      g.lineWidth = 2.2 - k * 0.4;
      g.stroke();
    }
    g.globalCompositeOperation = 'source-over';
  }
}
