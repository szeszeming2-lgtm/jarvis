// Themes and appearance settings → CSS variables on <html>.
import { settings } from '../store.js';
import { bus } from '../util.js';

export const THEMES = [
  { id: 'reactor', name: 'Arc Blue', desc: 'Electric blue and cyan', a: '#2ad4ff', b: '#2f74ff', bg: '#040a17' },
  { id: 'mark3', name: 'Crimson Gold', desc: 'Hot red with gold', a: '#ff4d4d', b: '#ffc23d', bg: '#0d0507' },
  { id: 'vibranium', name: 'Vibranium', desc: 'Violet and indigo', a: '#b18cff', b: '#5b7bff', bg: '#07051a' },
  { id: 'emerald', name: 'Emerald', desc: 'Green and teal', a: '#34f5b0', b: '#1aa6c9', bg: '#020c0b' },
  { id: 'solar', name: 'Solar', desc: 'Amber and orange', a: '#ffb23f', b: '#ff6a2b', bg: '#0c0703' },
  { id: 'stealth', name: 'Stealth', desc: 'Silver on black', a: '#dfe8f2', b: '#8796a8', bg: '#07080a' },
  { id: 'daylight', name: 'Daylight', desc: 'Light mode: navy on white', a: '#0877b8', b: '#2f5bff', bg: '#eef3f9' },
];

const hexToRgb = (hex) => {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex || '');
  return m ? `${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}` : null;
};

export function applyAppearance() {
  const a = settings.appearance;
  const root = document.documentElement;
  root.dataset.theme = a.theme;
  const rgb = hexToRgb(a.accent);
  if (rgb) { root.style.setProperty('--accent', a.accent); root.style.setProperty('--accent-rgb', rgb); }
  else { root.style.removeProperty('--accent'); root.style.removeProperty('--accent-rgb'); }
  root.style.setProperty('--font-scale', a.fontScale || 1);
  root.classList.toggle('glass-low', a.glass === 'low');
  root.classList.toggle('glass-off', a.glass === 'off');
  root.classList.toggle('motion-off', a.motion === 'off');
  root.classList.toggle('contrast-high', !!a.highContrast);
  const reduce = a.motion !== 'full' || matchMedia('(prefers-reduced-motion: reduce)').matches;
  root.classList.toggle('motion-reduced', reduce);
  bus.emit('theme');
}
