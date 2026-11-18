// Natural time phrases → Date. "in 20 minutes", "at 5pm", "tomorrow at 9:30",
// "tonight at 8", "at noon", "friday at 3pm", "in an hour and a half", "2026-12-01 14:00".

const NUM_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, 'forty-five': 45, fifty: 50, sixty: 60, ninety: 90, half: 0.5, couple: 2, few: 3 };
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const num = (s) => (s == null ? NaN : /^\d+(\.\d+)?$/.test(s) ? parseFloat(s) : NUM_WORDS[s.toLowerCase()] ?? NaN);

/** Parse a phrase. Returns { date, phrase } or null. `now` is injectable for tests. */
export function parseWhen(text, now = new Date()) {
  const t = ' ' + String(text || '').toLowerCase().replace(/[,]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  let m;

  // ISO-ish: 2026-12-01 14:00 / 2026-12-01T14:00
  if ((m = t.match(/(\d{4})-(\d{2})-(\d{2})(?:[ t](\d{1,2}):(\d{2}))?/))) {
    const d = new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 9, m[5] ? +m[5] : 0);
    return isNaN(d) ? null : { date: d, phrase: m[0].trim() };
  }

  // Relative: in 10 minutes / in an hour and a half / in 2 hours 15 minutes / in half an hour
  if ((m = t.match(/ in (?:about |around )?(half an hour|an hour and a half)/)) || (m = t.match(/ in (?:about |around )?(\S+(?: and a half)?) (seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?)(?: and a half)?(?: (?:and )?(\S+) (minutes?|mins?))?/))) {
    if (!m[2] && !/half/.test(m[1])) return null;
    if (m[2] && / and a half/.test(m[0]) && !/ and a half/.test(m[1])) m[1] += ' and a half';
    let ms = 0;
    if (m[1] === 'half an hour') ms = 30 * 60000;
    else if (m[1] === 'an hour and a half') ms = 90 * 60000;
    else {
      let n = num(m[1].replace(' and a half', ''));
      if (/ and a half/.test(m[1])) n += 0.5;
      if (isNaN(n)) return null;
      const u = m[2][0] === 's' ? 1000 : m[2][0] === 'm' ? 60000 : m[2][0] === 'h' ? 3600000 : m[2][0] === 'd' ? 86400000 : 604800000;
      ms = n * u;
      if (m[3]) { const k = num(m[3]); if (!isNaN(k)) ms += k * 60000; }
    }
    return { date: new Date(now.getTime() + ms), phrase: m[0].trim() };
  }

  // Day part
  const d = new Date(now);
  let dayWord = '';
  let dayOffset = 0;
  if (/ day after tomorrow /.test(t)) { dayOffset = 2; dayWord = 'day after tomorrow'; }
  else if (/ (tomorrow|tmrw|tmr) /.test(t)) { dayOffset = 1; dayWord = 'tomorrow'; }
  else if ((m = t.match(/ (?:on |next |this )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday) /))) {
    const target = DAYS.indexOf(m[1]);
    dayOffset = (target - now.getDay() + 7) % 7 || 7;
    dayWord = m[1];
  }

  // Clock time
  let hh = null, mm = 0, cm = null, explicit = false;
  if ((cm = t.match(/ (?:at |by |around )?(\d{1,2})(?::(\d{2}))? ?(am|pm|a\.m\.|p\.m\.)/))) {
    hh = +cm[1] % 12 + (/p/.test(cm[3]) ? 12 : 0); mm = cm[2] ? +cm[2] : 0; explicit = true;
  } else if ((cm = t.match(/ (?:at )?(\d{1,2}):(\d{2}) /))) {
    hh = +cm[1]; mm = +cm[2]; explicit = hh > 12 || hh === 0;
  } else if ((cm = t.match(/ at (\d{1,2}) (?:o'?clock )?/))) {
    hh = +cm[1];
  } else if ((cm = t.match(/ (?:at )?(noon|midday) /))) { hh = 12; explicit = true; }
  else if ((cm = t.match(/ (?:at )?midnight /))) { hh = 0; explicit = true; if (!dayOffset) dayOffset = 1; }
  else if ((cm = t.match(/ tonight /))) { hh = 20; explicit = true; }
  else if ((cm = t.match(/ (?:this |in the )?morning /))) { hh = 9; explicit = true; }
  else if ((cm = t.match(/ (?:this |in the )?afternoon /))) { hh = 15; explicit = true; }
  else if ((cm = t.match(/ (?:this |in the )?evening /))) { hh = 19; explicit = true; }

  if (hh === null && !dayOffset) return null;
  if (hh === null) { hh = 9; explicit = true; }
  if (hh > 23 || mm > 59) return null;
  // "tonight at 8", "this evening at 7": afternoon/evening hours.
  if (/ (tonight|evening|afternoon) /.test(t) && hh < 12 && !/ am /.test(t)) { hh += 12; explicit = true; }
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hh, mm, 0, 0);
  if (!dayOffset && d <= now) {
    // "at 5" with no am/pm: use 5pm if 5am has passed today.
    if (!explicit && hh >= 1 && hh < 12 && new Date(d.getTime() + 12 * 3600000) > now) d.setHours(hh + 12);
    else d.setDate(d.getDate() + 1);
  }
  const phrase = [dayWord, cm ? cm[0].trim() : ''].filter(Boolean).join(' ');
  return { date: d, phrase };
}

export function describeWhen(date, now = new Date()) {
  const diff = date - now;
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (diff > 0 && diff < 60000) { const secs = Math.max(1, Math.round(diff / 1000)); return `in ${secs} second${secs === 1 ? '' : 's'}`; }
  if (diff < 60 * 60000 && diff > 0) {
    const mins = Math.max(1, Math.round(diff / 60000));
    return `in ${mins} minute${mins === 1 ? '' : 's'} (${time})`;
  }
  const sameDay = date.toDateString() === now.toDateString();
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  if (sameDay) return `today at ${time}`;
  if (date.toDateString() === tomorrow.toDateString()) return `tomorrow at ${time}`;
  return `${date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })} at ${time}`;
}
