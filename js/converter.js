// Unit converter (offline): length, weight, volume, speed, time, data and temperature.
const DIMS = {
  length: { m: 1, meter: 1, metre: 1, km: 1000, kilometer: 1000, kilometre: 1000, cm: 0.01, centimeter: 0.01, centimetre: 0.01, mm: 0.001, millimeter: 0.001, mi: 1609.344, mile: 1609.344, yd: 0.9144, yard: 0.9144, ft: 0.3048, foot: 0.3048, feet: 0.3048, in: 0.0254, inch: 0.0254, inches: 0.0254, nmi: 1852, 'nautical mile': 1852 },
  mass: { kg: 1, kilo: 1, kilogram: 1, g: 0.001, gram: 0.001, mg: 1e-6, milligram: 1e-6, lb: 0.45359237, lbs: 0.45359237, pound: 0.45359237, oz: 0.028349523125, ounce: 0.028349523125, st: 6.35029318, stone: 6.35029318, t: 1000, tonne: 1000, ton: 907.18474 },
  volume: { l: 1, liter: 1, litre: 1, ml: 0.001, milliliter: 0.001, millilitre: 0.001, cl: 0.01, dl: 0.1, cup: 0.2365882365, tbsp: 0.01478676478125, tablespoon: 0.01478676478125, tsp: 0.00492892159375, teaspoon: 0.00492892159375, gal: 3.785411784, gallon: 3.785411784, 'fl oz': 0.0295735295625, 'fluid ounce': 0.0295735295625, pint: 0.473176473, pt: 0.473176473, quart: 0.946352946, qt: 0.946352946 },
  speed: { 'km/h': 1, kph: 1, kmh: 1, 'kilometers per hour': 1, mph: 1.609344, 'miles per hour': 1.609344, 'm/s': 3.6, 'meters per second': 3.6, knot: 1.852, kn: 1.852 },
  time: { s: 1, sec: 1, second: 1, ms: 0.001, millisecond: 0.001, min: 60, minute: 60, h: 3600, hr: 3600, hour: 3600, day: 86400, d: 86400, week: 604800, wk: 604800, month: 2629800, year: 31557600, yr: 31557600 },
  data: { b: 1, byte: 1, kb: 1e3, kilobyte: 1e3, mb: 1e6, megabyte: 1e6, gb: 1e9, gigabyte: 1e9, tb: 1e12, terabyte: 1e12, kib: 1024, mib: 1048576, gib: 1073741824 },
  area: { 'm2': 1, 'sq m': 1, 'square meter': 1, 'square metre': 1, 'km2': 1e6, 'sq km': 1e6, 'square kilometer': 1e6, 'ft2': 0.09290304, 'sq ft': 0.09290304, 'square foot': 0.09290304, 'square feet': 0.09290304, acre: 4046.8564224, hectare: 10000, ha: 10000, 'sq mi': 2589988.110336, 'square mile': 2589988.110336 },
};
const TEMPS = { c: 'C', celsius: 'C', '°c': 'C', centigrade: 'C', f: 'F', fahrenheit: 'F', '°f': 'F', k: 'K', kelvin: 'K' };

function find(raw) {
  let u = String(raw || '').toLowerCase().trim().replace(/^(a|an|one|the)\s+/, '').replace(/\.$/, '').replace(/^degrees?\s+/, '').replace(/\s+degrees?$/, '');
  u = u.replace(/²/g, '2').replace(/^square (meters|metres)$/, 'square meter');
  if (TEMPS[u]) return { dim: 'temp', key: TEMPS[u] };
  for (const [dim, units] of Object.entries(DIMS)) {
    if (units[u] != null) return { dim, key: u, f: units[u] };
    const single = u.replace(/(es|s)$/, '');
    if (units[single] != null) return { dim, key: single, f: units[single] };
    if (u.endsWith('s') && units[u.slice(0, -1)] != null) return { dim, key: u.slice(0, -1), f: units[u.slice(0, -1)] };
  }
  return null;
}

export const knows = (u) => !!find(u);

function toK(v, s) { return s === 'C' ? v + 273.15 : s === 'F' ? (v - 32) * 5 / 9 + 273.15 : v; }
function fromK(v, s) { return s === 'C' ? v - 273.15 : s === 'F' ? (v - 273.15) * 9 / 5 + 32 : v; }

const fmt = (n) => (Math.abs(n) >= 1e6 || (Math.abs(n) < 0.001 && n !== 0) ? n.toExponential(3) : (Math.round(n * 1000) / 1000).toLocaleString('en-US', { maximumFractionDigits: 3 }));

export function convert(value, from, to) {
  const a = find(from), b = find(to);
  if (!a) throw new Error(`I don’t know the unit “${from}”.`);
  if (!b) throw new Error(`I don’t know the unit “${to}”.`);
  if (a.dim !== b.dim) throw new Error(`I can’t turn ${from} into ${to}: they measure different things.`);
  const v = Number(value);
  if (!isFinite(v)) throw new Error('That isn’t a number.');
  const result = a.dim === 'temp' ? fromK(toK(v, a.key), b.key) : (v * a.f) / b.f;
  const clean = (raw, u) => (a.dim === 'temp' ? `°${u.key}` : String(raw).trim().replace(/^(a|an|one|the)\s+/i, ''));
  const fromL = clean(from, a), toL = clean(to, b);
  return { value: v, from: fromL, to: toL, result, text: `${fmt(v)} ${fromL} = **${fmt(result)} ${toL}**` };
}
