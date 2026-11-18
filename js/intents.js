// Instant commands: common requests handled locally without the AI model,
// so they are immediate and work even before any model is installed.
import { looksLikeMath } from './calc.js';

const WEBSITES = {
  youtube: 'youtube.com', gmail: 'mail.google.com', google: 'google.com', netflix: 'netflix.com', reddit: 'reddit.com',
  wikipedia: 'wikipedia.org', twitter: 'x.com', facebook: 'facebook.com', instagram: 'instagram.com', linkedin: 'linkedin.com',
  amazon: 'amazon.com', github: 'github.com', 'google maps': 'maps.google.com', 'google docs': 'docs.google.com',
  'google drive': 'drive.google.com', outlook: 'outlook.live.com', twitch: 'twitch.tv', ebay: 'ebay.com', duckduckgo: 'duckduckgo.com',
  'hacker news': 'news.ycombinator.com', bbc: 'bbc.com', 'the weather': 'weather.com', weather: 'weather.com',
};
const FOLDERS = ['downloads', 'documents', 'desktop', 'pictures', 'photos folder', 'music', 'movies', 'home', 'home folder', 'applications', 'trash'];
const SETTINGS_PAGES = ['wifi', 'wi-fi', 'bluetooth', 'sound', 'display', 'displays', 'battery', 'privacy', 'notifications', 'keyboard', 'accessibility', 'appearance', 'network', 'storage', 'focus', 'general', 'wallpaper', 'desktop'];

const clean = (t) => t.trim().replace(/^(hey |ok |okay )?(jarvis|computer)[,!. ]+/i, '').replace(/^(please|can you|could you|would you|will you|kindly)\s+/i, '').replace(/[.!?]+$/g, '').replace(/\s+please$/i, '').trim();

/** Returns {tool, args} or {local:'stop'|'newchat'} or null. */
export function match(raw, { customSkills = [] } = {}) {
  const t = clean(raw);
  const low = t.toLowerCase();
  if (!low) return null;

  // Custom skill triggers ("/name text" or a trigger phrase).
  for (const sk of customSkills) {
    const cmd = '/' + sk.command;
    if (low === cmd || low.startsWith(cmd + ' ')) return { skill: sk, input: t.slice(cmd.length).trim() };
    for (const trig of sk.triggers || []) {
      const tl = trig.toLowerCase().trim();
      if (tl && (low === tl || low.startsWith(tl + ' '))) return { skill: sk, input: t.slice(tl.length).trim() };
    }
  }

  if (/^(stop|cancel|be quiet|quiet|shush|shut up|enough|never ?mind|that'?s enough)$/i.test(low)) return { local: 'stop' };
  if (/^(new (chat|conversation)|start over|clear (the )?chat)$/i.test(low)) return { local: 'newchat' };

  // Time and date
  if (/^(what('?s| is) the )?time( is it)?( now)?$|^what time is it( now)?$|^tell me the time$/.test(low)) return { tool: 'get_datetime', args: {}, say: 'time' };
  if (/^(what('?s| is) )?(the |today'?s )?date( today)?$|^what day is (it|today)$|^what('?s| is) today$/.test(low)) return { tool: 'get_datetime', args: {}, say: 'date' };

  // Math
  if (looksLikeMath(low)) return { tool: 'calculate', args: { expression: t } };

  // Volume
  let m;
  if ((m = low.match(/^(?:set |change |turn )?(?:the )?(?:volume|sound)(?: level)? (?:to |at )?(\d{1,3})(?: ?%| percent)?$/))) return { tool: 'set_volume', args: { level: Math.min(100, +m[1]) } };
  if (/^(mute|mute (the )?(sound|volume|audio)|turn (the )?(sound|volume) off)$/.test(low)) return { tool: 'set_volume', args: { mute: true } };
  if (/^(unmute|unmute (the )?(sound|volume|audio)|turn (the )?(sound|volume) (back )?on)$/.test(low)) return { tool: 'set_volume', args: { mute: false } };
  if (/^(turn (it|the volume|the sound) up|volume up|louder)$/.test(low)) return { tool: 'set_volume', args: { delta: 15 } };
  if (/^(turn (it|the volume|the sound) down|volume down|quieter|softer)$/.test(low)) return { tool: 'set_volume', args: { delta: -15 } };

  // Dark mode
  if (/^(turn on|enable|switch to|activate|go) dark mode$|^dark mode( on)?$|^(turn|switch) dark mode on$/.test(low)) return { tool: 'set_dark_mode', args: { mode: 'dark' } };
  if (/^(turn off|disable) dark mode$|^(turn on|enable|switch to|go) light mode$|^light mode( on)?$|^dark mode off$/.test(low)) return { tool: 'set_dark_mode', args: { mode: 'light' } };
  if (/^toggle dark mode$/.test(low)) return { tool: 'set_dark_mode', args: { mode: 'toggle' } };

  // Wi-Fi, display
  if ((m = low.match(/^turn (on|off) (the )?wi-?fi$|^turn (the )?wi-?fi (on|off)$|^wi-?fi (on|off)$/))) return { tool: 'set_wifi', args: { on: (m[1] || m[4] || m[5]) === 'on' } };
  if (/^(sleep|turn off) (the )?(display|screen|monitor)$|^put (the )?(display|screen) to sleep$/.test(low)) return { tool: 'sleep_display', args: {} };

  // Status
  if (/^(system (status|report|info|check)|status report|diagnostics|how('?s| is) my (computer|mac|laptop|pc) doing|(check )?(my )?battery( level| status)?|how much (battery|memory|ram|storage|disk space) (do i have|is left)( left)?)$/.test(low)) return { tool: 'system_status', args: {} };

  // Timers
  if ((m = low.match(/^(?:set |start )?(?:a )?timer (?:for )?(\d+(?:\.\d+)?) ?(seconds?|secs?|minutes?|mins?|hours?|hrs?)(?: (?:for|called|named) (.+))?$/) || low.match(/^(?:set |start )?(?:a |an )?(\d+(?:\.\d+)?)[- ]?(seconds?|secs?|minutes?|mins?|hours?|hrs?) timer(?: (?:for|called|named) (.+))?$/))) {
    const n = +m[1];
    const unit = m[2][0];
    return { tool: 'set_timer', args: { minutes: unit === 's' ? n / 60 : unit === 'h' ? n * 60 : n, label: m[3] || '' } };
  }

  // Memory
  if ((m = t.match(/^remember (?:that )?(.{3,})$/i)) && !/^remember (when|what|how|who|where|why|if)\b/i.test(t)) return { tool: 'remember', args: { fact: m[1] } };

  // Files
  if ((m = t.match(/^(?:find|search for|look for|locate|where(?:'s| is| are))(?: my| the| all)? ((?:pdf|image|photo|picture|video|document|presentation|spreadsheet)s? )?(files? |documents? )?(?:named |called |about |with |for |that mention )?(.+?)(?: (?:in|on) (?:my |the )?(downloads|documents|desktop))?$/i)) && (m[1] || m[2])) {
    const kindMap = { pdf: 'pdf', image: 'image', photo: 'image', picture: 'image', video: 'video', document: 'document', presentation: 'presentation', spreadsheet: 'spreadsheet' };
    const kind = (m[1] || '').trim().toLowerCase().replace(/s$/, '');
    return { tool: 'find_files', args: { query: m[3].replace(/^["']|["']$/g, ''), kind: kindMap[kind] || 'any', folder: m[4] || '' } };
  }
  if ((m = low.match(/^(?:organi[sz]e|tidy( up)?|clean up|sort)(?: up)? (?:my |the )?(downloads|desktop|documents)(?: folder)?(?: by (type|date|month|kind))?$/))) return { tool: 'organize_folder', args: { folder: m[2], by: /date|month/.test(m[3] || '') ? 'date' : 'type' } };

  // Search the web
  if ((m = t.match(/^(?:search|google|look up|search the web|search online|web search)(?: for| up)? (.{2,})$/i)) && !/\b(files?|documents?|folders?|my computer|on my mac)\b/i.test(t)) return { tool: 'web_search', args: { query: m[1] } };

  if ((m = t.match(/^run (?:the |my )?shortcut (?:called |named )?["“]?(.+?)["”]?$/i))) return { tool: 'run_shortcut', args: { name: m[1] } };
  // Open things
  if ((m = t.match(/^(?:open|launch|start|bring up|fire up|go to)(?: up)? (?:the |my )?(.+?)(?: app| application| website| site| page)?$/i))) {
    const target = m[1].trim();
    const tl = target.toLowerCase();
    if (tl.split(/\s+/).length > 4) return null;
    if (/^(system )?(settings|preferences)$/.test(tl)) return { tool: 'open_system_settings', args: {} };
    if ((m = tl.match(/^(.+?) settings$/)) && SETTINGS_PAGES.includes(m[1])) return { tool: 'open_system_settings', args: { page: m[1] } };
    if (FOLDERS.includes(tl.replace(/ folder$/, '')) || / folder$/.test(tl)) return { tool: 'open_folder', args: { folder: target.replace(/ folder$/i, '') } };
    if (/^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(target)) return { tool: 'open_website', args: { url: target } };
    if (WEBSITES[tl]) return { tool: 'open_website', args: { url: WEBSITES[tl] } };
    if (/^(a |an |some |new )/.test(tl)) return null;
    return { tool: 'open_app', args: { name: target } };
  }
  if ((m = low.match(/^(?:quit|close|exit|kill) (?:the )?(.+?)(?: app)?$/)) && m[1].split(' ').length <= 3 && !/^(this|it|that|window|tab|chat|conversation)$/.test(m[1])) return { tool: 'quit_app', args: { name: m[1] } };

  return null;
}

/** Natural reply for an instant command result. */
export function reply(intent, res, name = 'JARVIS') {
  const r = res;
  if (!r.ok) {
    if (r.declined) return 'Understood. I’ll leave that alone.';
    return `I couldn’t do that: ${r.error}`;
  }
  switch (intent.tool) {
    case 'get_datetime': return intent.say === 'date' ? `Today is ${r.date}.` : `It’s ${r.time}.`;
    case 'calculate': return `That comes to **${r.result}**.`;
    case 'open_app': return pick([`${r.name} is open.`, `Opening ${r.name}.`, `Right away. ${r.name} is up.`]);
    case 'quit_app': return `${r.name} has been asked to quit.`;
    case 'open_folder': return `Here’s your ${r.name} folder.`;
    case 'open_website': return `Opening ${r.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}.`;
    case 'open_system_settings': return `System Settings${r.name && r.name !== 'System Settings' ? ` → ${r.name}` : ''} is open.`;
    case 'web_search': return `I’ve opened a web search for “${r.query}”.`;
    case 'set_volume': return r.muted ? 'Sound muted.' : `Volume set to ${r.level}%.`;
    case 'set_dark_mode': return r.dark ? 'Dark mode is on.' : 'Light mode is on.';
    case 'set_wifi': return `Wi-Fi is ${r.on ? 'on' : 'off'}.`;
    case 'sleep_display': return 'Putting the display to sleep.';
    case 'set_timer': return `Timer set for ${r.human}. I’ll let you know at ${r.endsAt}.`;
    case 'remember': return `Noted. I’ll remember that ${r.saved.replace(/^i /i, 'you ').replace(/^my /i, 'your ')}.`;
    case 'run_shortcut': return `Ran your Shortcut “${r.name}”.`;
    case 'organize_folder': return r.moved ? `Done. I moved ${r.moved} files into ${r.folders} folders. You can undo it from the note above.` : 'That folder is already tidy.';
    case 'find_files': {
      if (!r.count) return `I couldn’t find any files matching “${intent.args.query}”.`;
      const list = r.files.slice(0, 8).map((f) => `- **${f.name}** — ${f.folder}${f.modified ? ` · ${new Date(f.modified).toLocaleDateString()}` : ''}`).join('\n');
      return `I found ${r.count} file${r.count === 1 ? '' : 's'}${r.count > 8 ? ' (showing 8)' : ''}:\n\n${list}`;
    }
    case 'system_status': return statusText(r);
    default: return 'Done.';
  }
}

export function statusText(r) {
  const parts = [];
  if (r.cpu != null) parts.push(`CPU load is **${Math.round(r.cpu)}%**`);
  if (r.memTotal) parts.push(`memory is **${Math.round((r.memUsed / r.memTotal) * 100)}%** used (${(r.memUsed / 1e9).toFixed(1)} of ${(r.memTotal / 1e9).toFixed(0)} GB)`);
  if (r.battery?.level != null) parts.push(`battery is at **${Math.round(r.battery.level)}%**${r.battery.charging ? ' and charging' : r.battery.plugged ? ' on power' : ''}`);
  if (r.diskFree) parts.push(`**${(r.diskFree / 1e9).toFixed(0)} GB** of storage free`);
  if (!parts.length) return 'All systems nominal.';
  return `All systems nominal. ${cap(parts.join(', '))}.`;
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
