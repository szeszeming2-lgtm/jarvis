// Calls and messages in other apps: FaceTime, WhatsApp, Discord, Telegram, Skype,
// Teams, Messenger, Signal. Each app decides how far a link can go: some start the
// call straight away, others open the chat and you tap the call or send button.

export const APPS = {
  phone: { label: 'Phone', handle: 'phone', call: 'starts', text: 'sms' },
  messages: { label: 'Messages', handle: 'phone', text: 'sms' },
  facetime: { label: 'FaceTime', handle: 'phone', call: 'starts' },
  whatsapp: { label: 'WhatsApp', handle: 'whatsapp', call: 'opens', text: 'prefills' },
  discord: { label: 'Discord', handle: 'discord', call: 'opens', text: 'opens' },
  telegram: { label: 'Telegram', handle: 'telegram', call: 'opens', text: 'opens' },
  skype: { label: 'Skype', handle: 'skype', call: 'starts', text: 'opens' },
  teams: { label: 'Microsoft Teams', handle: 'teams', call: 'starts', text: 'opens' },
  messenger: { label: 'Messenger', handle: 'messenger', call: 'opens', text: 'opens' },
  signal: { label: 'Signal', handle: 'phone', call: 'opens', text: 'opens' },
};

const ALIASES = { 'face time': 'facetime', ft: 'facetime', wa: 'whatsapp', 'whats app': 'whatsapp', tg: 'telegram', 'ms teams': 'teams', 'microsoft teams': 'teams', 'facebook messenger': 'messenger', fb: 'messenger', imessage: 'messages', sms: 'messages', text: 'messages', 'phone call': 'phone', cell: 'phone' };
export const normApp = (a) => { const k = String(a || '').toLowerCase().trim(); return APPS[k] ? k : ALIASES[k] || null; };

const digits = (n) => String(n || '').replace(/[^\d+]/g, '');
const intl = (n) => digits(n).replace(/^\+/, '');

/** Discord: accept a DM/channel link or a numeric channel id. */
function discordPath(h) {
  const s = String(h || '').trim();
  const m = s.match(/channels\/(@me|\d+)\/(\d+)/);
  if (m) return `channels/${m[1]}/${m[2]}`;
  if (/^\d{15,22}$/.test(s)) return `channels/@me/${s}`;
  return null;
}

/**
 * Build the link for an app. person: {name, phone, discord, telegram, skype, teams, messenger}.
 * kind: 'call' | 'video' | 'text'. Returns {url, how, needs} or throws with a plain explanation.
 */
export function link(app, person, kind = 'call', message = '') {
  const a = APPS[app];
  if (!a) throw new Error('I don’t know that app.');
  const name = person?.name || 'them';
  const missing = (what, example) => new Error(`I need ${name}’s ${what} for ${a.label}. Say “save ${name}’s ${app} as ${example}”, or add it under Lists & People.`);
  const phone = person?.phone;
  const enc = encodeURIComponent(message || '');
  switch (app) {
    case 'phone': if (!phone) throw missing('number', '+1 555 123 4567'); return { url: `tel:${digits(phone)}`, how: 'starts' };
    case 'messages': if (!phone) throw missing('number', '+1 555 123 4567'); return { url: `sms:${digits(phone)}${message ? `&body=${enc}` : ''}`, how: 'prefills' };
    case 'facetime': if (!phone) throw missing('number or Apple ID email', '+1 555 123 4567'); return { url: `${kind === 'video' ? 'facetime' : 'facetime-audio'}:${encodeURIComponent(phone.includes('@') ? phone : digits(phone))}`, how: 'starts' };
    case 'whatsapp': {
      const n = person?.whatsapp || phone;
      if (!n) throw missing('WhatsApp number', '+1 555 123 4567');
      return { url: `https://wa.me/${intl(n)}${message ? `?text=${enc}` : ''}`, how: kind === 'text' ? 'prefills' : 'opens' };
    }
    case 'discord': {
      const p = discordPath(person?.discord);
      if (!p) throw missing('Discord DM link (in Discord, right-click your chat with them → Copy Link)', 'https://discord.com/channels/@me/123…');
      return { url: `https://discord.com/${p}`, how: 'opens' };
    }
    case 'telegram': {
      const u = String(person?.telegram || '').replace(/^@/, '').replace(/^https?:\/\/t\.me\//, '');
      if (u) return { url: `https://t.me/${encodeURIComponent(u)}`, how: 'opens' };
      if (phone) return { url: `https://t.me/+${intl(phone)}`, how: 'opens' };
      throw missing('Telegram username', '@username');
    }
    case 'skype': {
      const u = String(person?.skype || '').trim();
      if (!u) throw missing('Skype name', 'live:yourfriend');
      return { url: `skype:${encodeURIComponent(u)}?${kind === 'text' ? 'chat' : 'call'}${kind === 'video' ? '&video=true' : ''}`, how: kind === 'text' ? 'opens' : 'starts' };
    }
    case 'teams': {
      const e = String(person?.teams || (phone?.includes('@') ? phone : '')).trim();
      if (!e) throw missing('Teams email', 'name@company.com');
      return kind === 'text'
        ? { url: `https://teams.microsoft.com/l/chat/0/0?users=${encodeURIComponent(e)}${message ? `&message=${enc}` : ''}`, how: 'prefills' }
        : { url: `https://teams.microsoft.com/l/call/0/0?users=${encodeURIComponent(e)}${kind === 'video' ? '&withVideo=true' : ''}`, how: 'starts' };
    }
    case 'messenger': {
      const u = String(person?.messenger || '').trim().replace(/^https?:\/\/m\.me\//, '');
      if (!u) throw missing('Messenger username', 'their.username');
      return { url: `https://m.me/${encodeURIComponent(u)}`, how: 'opens' };
    }
    case 'signal': if (!phone) throw missing('number', '+1 555 123 4567'); return { url: `https://signal.me/#p/+${intl(phone)}`, how: 'opens' };
    default: throw new Error('I don’t know that app.');
  }
}

/** Plain words for what will happen. */
export function explain(app, how, kind) {
  const a = APPS[app]?.label || app;
  if (how === 'starts') return `${a} starts the ${kind === 'text' ? 'chat' : 'call'}.`;
  if (how === 'prefills') return `${a} opens with your message filled in. Press Send.`;
  return kind === 'text' ? `${a} opens your chat. Your message is copied, so paste it and press Send.` : `${a} opens your chat with them. Tap the ${kind === 'video' ? 'video' : 'call'} button there (${a} doesn’t let other apps start calls).`;
}
