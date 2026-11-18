// Weather from Open-Meteo: free, open data, no account or key. Only the place name
// (or its coordinates) is sent; results are cached so the last forecast shows offline.
import { settings, set, read, write } from './store.js';

const WMO = {
  0: 'clear sky', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'fog', 48: 'freezing fog',
  51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle', 56: 'freezing drizzle', 57: 'freezing drizzle',
  61: 'light rain', 63: 'rain', 65: 'heavy rain', 66: 'freezing rain', 67: 'freezing rain',
  71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains', 80: 'light showers', 81: 'showers', 82: 'heavy showers',
  85: 'snow showers', 86: 'heavy snow showers', 95: 'thunderstorms', 96: 'thunderstorms with hail', 99: 'severe thunderstorms',
};
const EMOJI = (c) => (c <= 1 ? '☀️' : c <= 3 ? '⛅' : c <= 48 ? '🌫️' : c <= 67 || (c >= 80 && c <= 82) ? '🌧️' : c <= 86 ? '🌨️' : '⛈️');

const imperial = () => (settings.weather?.units || 'auto') === 'auto' ? /^en-US|^en-LR|^my-/.test(navigator.language || '') : settings.weather.units === 'f';

export async function geocode(place) {
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=${encodeURIComponent(place)}`);
  if (!r.ok) throw new Error('The weather service didn’t answer. Check your internet connection.');
  const j = await r.json();
  const g = j.results?.[0];
  if (!g) throw new Error(`I couldn’t find a place called “${place}”.`);
  return { name: [g.name, g.admin1, g.country_code].filter(Boolean).join(', '), lat: g.latitude, lon: g.longitude, tz: g.timezone };
}

export async function setHome(place) {
  const g = await geocode(place);
  set('weather', { ...(settings.weather || {}), place: g.name, lat: g.lat, lon: g.lon, tz: g.tz });
  return g;
}

export async function forecast(place) {
  let loc;
  if (place && place.trim()) loc = await geocode(place);
  else if (settings.weather?.lat != null) loc = { name: settings.weather.place, lat: settings.weather.lat, lon: settings.weather.lon };
  else throw new Error('Which city? Say “my city is Toronto” once and I’ll remember it (only the city name is sent to the free Open-Meteo weather service).');
  const f = imperial();
  const q = new URLSearchParams({
    latitude: loc.lat, longitude: loc.lon, timezone: 'auto', forecast_days: '3',
    current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m,precipitation',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
    temperature_unit: f ? 'fahrenheit' : 'celsius', wind_speed_unit: f ? 'mph' : 'kmh',
  });
  let j;
  try {
    const r = await fetch('https://api.open-meteo.com/v1/forecast?' + q);
    if (!r.ok) throw new Error();
    j = await r.json();
    write('weather-cache-' + Math.round(loc.lat * 10) + '_' + Math.round(loc.lon * 10), { at: Date.now(), j }).catch(() => {});
  } catch {
    const c = await read('weather-cache-' + Math.round(loc.lat * 10) + '_' + Math.round(loc.lon * 10), null);
    if (!c) throw new Error('The weather service is unreachable (are you offline?).');
    j = c.j; j.stale = c.at;
  }
  const u = f ? '°F' : '°C', w = f ? 'mph' : 'km/h';
  const cur = j.current, d = j.daily;
  const day = (i) => ({ label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : new Date(d.time[i]).toLocaleDateString(undefined, { weekday: 'long' }), high: Math.round(d.temperature_2m_max[i]), low: Math.round(d.temperature_2m_min[i]), rain: d.precipitation_probability_max?.[i] ?? null, sky: WMO[d.weather_code[i]] || 'mixed', icon: EMOJI(d.weather_code[i]) });
  return {
    place: loc.name, units: u,
    now: { temp: Math.round(cur.temperature_2m), feels: Math.round(cur.apparent_temperature), sky: WMO[cur.weather_code] || 'mixed', icon: EMOJI(cur.weather_code), wind: Math.round(cur.wind_speed_10m) + ' ' + w, humidity: cur.relative_humidity_2m },
    days: [0, 1, 2].map(day),
    stale: j.stale ? new Date(j.stale).toLocaleString() : null,
  };
}

export function summary(r) {
  const t = r.days[0];
  const rain = t.rain != null && t.rain >= 40 ? ` There’s a ${t.rain}% chance of rain, so take an umbrella.` : '';
  return `${r.now.icon} In ${r.place} it’s **${r.now.temp}${r.units}** and ${r.now.sky} (feels like ${r.now.feels}${r.units}). Today: high ${t.high}${r.units}, low ${t.low}${r.units}.${rain} Tomorrow: ${r.days[1].sky}, ${r.days[1].low}–${r.days[1].high}${r.units}.${r.stale ? ` (Saved forecast from ${r.stale}; you’re offline.)` : ''}`;
}
