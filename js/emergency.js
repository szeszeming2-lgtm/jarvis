// Emergency helpers: the local emergency number and a "where I am" text.
import { settings } from './store.js';

const BY_REGION = { US: '911', CA: '911', MX: '911', GB: '999', IE: '112', AU: '000', NZ: '111', IN: '112', JP: '119', CN: '120', HK: '999', SG: '995', MY: '999', PH: '911', KR: '119', TW: '119', ZA: '10111', BR: '192' };
/** The emergency number: your setting, or the usual one for your region (112 works in much of the world). */
export function emergencyNumber() {
  if (settings.emergency?.number?.trim()) return settings.emergency.number.trim();
  const region = (navigator.language || 'en-US').split('-')[1]?.toUpperCase();
  return BY_REGION[region] || '112';
}

/** "I need help. I'm here: <map link>" using this device's location (asks permission). */
export function locationText() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('This device can’t share its location.')); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => { const { latitude: la, longitude: lo, accuracy } = p.coords; resolve(`I need help. This is where I am (within about ${Math.round(accuracy)} m): https://maps.apple.com/?ll=${la.toFixed(5)},${lo.toFixed(5)}&q=Here — Google: https://maps.google.com/?q=${la.toFixed(5)},${lo.toFixed(5)}`); },
      (e) => reject(new Error(e.code === 1 ? 'Location is blocked. Allow location for JARVIS and try again.' : 'I couldn’t get your location right now.')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  });
}
