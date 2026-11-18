// Instant commands: common requests handled locally without the AI model,
// so they are immediate and work even before any model is installed.
import { looksLikeMath } from './calc.js';
import { parseWhen, describeWhen } from './when.js';
import { summary as weatherSummary } from './weather.js';

const listWords = (a) => (a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);

const WEBSITES = {
  youtube: 'youtube.com', gmail: 'mail.google.com', google: 'google.com', netflix: 'netflix.com', reddit: 'reddit.com',
  wikipedia: 'wikipedia.org', twitter: 'x.com', facebook: 'facebook.com', instagram: 'instagram.com', linkedin: 'linkedin.com',
  amazon: 'amazon.com', github: 'github.com', 'google maps': 'maps.google.com', 'google docs': 'docs.google.com',
  'google drive': 'drive.google.com', outlook: 'outlook.live.com', twitch: 'twitch.tv', ebay: 'ebay.com', duckduckgo: 'duckduckgo.com',
  'hacker news': 'news.ycombinator.com', bbc: 'bbc.com', 'the weather': 'weather.com', weather: 'weather.com',
};
const FOLDERS = ['downloads', 'documents', 'desktop', 'pictures', 'photos folder', 'music', 'movies', 'home', 'home folder', 'applications', 'trash'];
const SETTINGS_PAGES = ['wifi', 'wi-fi', 'bluetooth', 'sound', 'display', 'displays', 'battery', 'privacy', 'notifications', 'keyboard', 'accessibility', 'appearance', 'network', 'storage', 'focus', 'general', 'wallpaper', 'desktop'];

// Phones type curly quotes (what’s); make them plain so every phrase still matches.
const plainQuotes = (t) => String(t).replace(/[\u2018\u2019\u02BC\u2032]/g, "'").replace(/[\u201C\u201D]/g, '"');
const clean = (t) => plainQuotes(t).trim().replace(/^(hey |ok |okay )?(jarvis|computer)[,!. ]+/i, '').replace(/^(please|can you|could you|would you|will you|kindly)\s+/i, '').replace(/[.!?]+$/g, '').replace(/\s+please$/i, '').trim();

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

  // Reminders: "remind me to X in 10 minutes", "remind me at 5pm to X", "text me tomorrow at 9 to X"
  const TIME = '(in .+?|at .+?|by .+?|tomorrow(?: (?:at|morning|afternoon|evening|night) ?.*?)?|tonight(?: at .+?)?|this (?:morning|afternoon|evening)(?: at .+?)?|(?:on |next |this )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?: at .+?)?|at noon|at midnight)';
  let r;
  const remindRe1 = new RegExp(`^(remind|text|message) me (?:a reminder )?${TIME} (?:to|about|that) (.+)$`, 'i');
  const remindRe2 = new RegExp(`^(remind|text|message) me (?:to|about|that) (.+?) ${TIME}$`, 'i');
  const remindRe4 = new RegExp(`^(?:don'?t let me forget|make sure i (?:don'?t forget|remember)|help me remember|i need to remember|i have to remember|ping me) (?:to |about |that )?(.+?) ${TIME}$`, 'i');
  const remindRe5 = new RegExp(`^(?:don'?t let me forget|make sure i (?:don'?t forget|remember)|ping me) ${TIME} (?:to |about |that )?(.+)$`, 'i');
  const remindRe3 = new RegExp(`^(?:set|add|create) (?:a )?reminder (?:for )?${TIME} (?:to|about|that|:) ?(.+)$`, 'i');
  if ((r = t.match(remindRe1)) && parseWhen(r[2])) return { tool: 'set_reminder', args: { text: r[3], when: r[2], text_me: r[1].toLowerCase() !== 'remind' } };
  if ((r = t.match(remindRe2)) && parseWhen(r[3])) return { tool: 'set_reminder', args: { text: r[2], when: r[3], text_me: r[1].toLowerCase() !== 'remind' } };
  if ((r = t.match(remindRe3)) && parseWhen(r[1])) return { tool: 'set_reminder', args: { text: r[2], when: r[1], text_me: false } };
  if ((r = t.match(remindRe4)) && parseWhen(r[2])) return { tool: 'set_reminder', args: { text: r[1], when: r[2], text_me: false } };
  if ((r = t.match(remindRe5)) && parseWhen(r[1])) return { tool: 'set_reminder', args: { text: r[2], when: r[1], text_me: false } };
  if (/^(what are|show|list|read) (me )?(my )?(upcoming )?reminders$|^(do i have )?any reminders$|^my reminders$/.test(low)) return { tool: 'list_reminders', args: {} };
  if ((r = low.match(/^(?:cancel|delete|remove|clear) (?:my |the )?reminders? (?:about |to |for )?(.+)$/))) return { tool: 'cancel_reminder', args: { about: r[1] } };

  // Lists: "add eggs and milk to my shopping list", "I need to buy bread", "what's on my to-do list"
  if ((r = t.match(/^(?:add|put) (.+?) (?:to|on|onto) (?:my |the |our )?(.+?) list$/i))) return { tool: 'add_to_list', args: { list: r[2], items: splitList(r[1]) } };
  if ((r = t.match(/^(?:i need to buy|i have to buy|we need to buy|buy|we need|we'?re out of|we are out of|i'?m out of) (.+?)(?: (?:from|at) the (?:store|shop|supermarket))?$/i)) && !/^(a |an )?(ticket|flight|house|car|time)\b/i.test(r[1])) return { tool: 'add_to_list', args: { list: 'shopping', items: splitList(r[1]) } };
  if ((r = t.match(/^(?:add|put) (.+?) (?:to|on) (?:my |the )?(?:shopping|grocery|groceries)(?: list)?$/i))) return { tool: 'add_to_list', args: { list: 'shopping', items: splitList(r[1]) } };
  if ((r = t.match(/^(?:what'?s|what is|show(?: me)?|read(?: me)?|open|check)(?: on)? (?:my |the |our )?(.+?) list$/i))) return { tool: 'show_list', args: { list: r[1] } };
  if ((r = t.match(/^(?:what do i need to buy|what do we need|what'?s on the shopping list)$/i))) return { tool: 'show_list', args: { list: 'shopping' } };
  if ((r = t.match(/^(?:what do i (?:have|need) to do(?: today)?|my to-?do'?s?)$/i))) return { tool: 'show_list', args: { list: 'to-do' } };
  if ((r = t.match(/^(?:remove|delete|cross off|tick off|check off|i bought|i got|got|bought) (.+?) (?:from|off) (?:my |the |our )?(.+?) list$/i))) return { tool: 'remove_from_list', args: { list: r[2], items: splitList(r[1]) } };
  if ((r = t.match(/^(?:clear|empty|delete) (?:my |the |our )?(.+?) list$/i))) return { tool: 'clear_list', args: { list: r[1] } };
  if ((r = t.match(/^(?:add )?(?:to-?do|task):? (.+)$/i))) return { tool: 'add_to_list', args: { list: 'to-do', items: [r[1]] } };
  if ((r = t.match(/^(?:note|take a note|make a note|jot down|write down)(?: that|:)? (.+)$/i))) return { tool: 'add_to_list', args: { list: 'notes', items: [r[1]] } };

  // People: "save Mom's number as +1 555 0100", "Sam's number is 07700 900123"
  if ((r = t.match(/^(?:save|remember|add|store) (.+?)['’]s? (?:number|phone|cell|mobile)(?: number)?(?: as| is|:)? (\+?[\d][\d\s().-]{4,})$/i)) || (r = t.match(/^(.+?)['’]s (?:number|phone|cell|mobile)(?: number)? is (\+?[\d][\d\s().-]{4,})$/i))) return { tool: 'save_contact', args: { name: r[1].replace(/^my /i, ''), number: r[2].trim() } };

  // Weather
  if ((r = t.match(/^(?:my (?:home )?(?:city|town) is|i live in|set my (?:home )?city to) (.+)$/i))) return { tool: 'set_home_city', args: { place: r[1] } };
  if ((r = low.match(/^(?:what(?:'s| is) the |how(?:'s| is) the |show me the |get the )?(?:weather|forecast|temperature)(?: like)?(?: (?:today|now|outside|tomorrow|this week))?(?: (?:in|for|at) (.+?))?(?: (?:today|now|tomorrow))?$|^(?:is it|will it) (?:going to )?(?:rain|snow|be (?:hot|cold|sunny|windy))(?: today| tomorrow)?(?: in (.+?))?$|^do i need an umbrella(?: today| tomorrow)?(?: in (.+?))?$|^how (?:hot|cold|warm) is it(?: outside)?(?: in (.+?))?$/))) return { tool: 'get_weather', args: { place: (r[1] || r[2] || r[3] || r[4] || '').trim() } };

  // "call me Alex" means a name, not a phone call.
  if ((r = t.match(/^(?:call me|my name is|i'?m called) ([\p{L}][\p{L}'’ -]{0,30})$/iu)) && r[1].split(/\s+/).length <= 3) return { local: 'callme', name: r[1].trim() };

  // Texts: "text Mom saying I'm on my way", "message +1 555 0100: hi", "text me buy milk"
  if ((r = t.match(/^(?:text|message|imessage|send (?:a )?(?:text|message) to) (.+?)(?:\s*:\s*|\s+saying\s+|\s+that says\s+|\s+that\s+)(.+)$/i))) return { tool: 'send_text', args: { to: r[1].replace(/^my /i, ''), message: r[2] } };
  if ((r = t.match(/^text me (.+)$/i))) return { tool: 'send_text', args: { to: 'me', message: r[1] } };
  // Calls: "call Mom", "facetime +44 20 7946 0000"
  if ((r = t.match(/^(call|phone|ring|dial|facetime)(?: up)? (.+)$/i)) && !/^(me|it|that|this|off|back)\b/i.test(r[2]) && r[2].split(/\s+/).length <= 4) return { tool: 'make_call', args: { to: r[2].replace(/^my /i, ''), facetime: /facetime/i.test(r[1]) } };

  // Identify something on screen
  if (/^(what('?s| is) (this|that)( on (my |the )?screen)?|identify (this|that|something)( on (my |the )?screen)?|what am i (looking|pointing) at|look at (my |the )?screen|what('?s| is) on (my |the )?screen|explain (this|what i'?m pointing at))$/.test(low)) return { local: 'look' };

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
    case 'set_reminder': return `I’ll remind you ${r.when}${intent.args.text_me ? ' and send you a text' : ''}: **${r.text}**.${r.inSystemReminders ? ' It’s in your Reminders app too, so your phone will remind you as well.' : ''}`;
    case 'list_reminders': return r.count ? `You have ${r.count} upcoming reminder${r.count === 1 ? '' : 's'}:\n\n${r.reminders.map((x) => `- **${x.text}** — ${x.when}`).join('\n')}` : 'You have no upcoming reminders.';
    case 'cancel_reminder': return `Cancelled ${r.cancelled} reminder${r.cancelled === 1 ? '' : 's'}.`;
    case 'send_text': return r.sent ? `Message sent to ${r.to}.` : `Your messages app is open with the text to ${r.to}. Press Send when you’re ready.`;
    case 'make_call': return `Calling ${r.to}.`;
    case 'add_to_list': return r.added.length ? `Added ${listWords(r.added)} to your ${r.list} list. ${r.count} item${r.count === 1 ? '' : 's'} on it now.` : `That’s already on your ${r.list} list.`;
    case 'show_list': return r.items.length ? `Your ${r.list} list:\n\n${r.items.map((i) => '- ' + i).join('\n')}` : `Your ${r.list} list is empty.${r.lists?.length > 1 ? ` Your lists: ${r.lists.join(', ')}.` : ''}`;
    case 'remove_from_list': return r.removed.length ? `Ticked off ${listWords(r.removed)}. ${r.count} left on your ${r.list} list.` : `I couldn’t find that on your ${r.list} list.`;
    case 'clear_list': return `Your ${r.list} list is empty now.`;
    case 'save_contact': return `Saved ${r.name}: ${r.number}. You can now say “text ${r.name} …” or “call ${r.name}”.`;
    case 'get_weather': return weatherSummary(r);
    case 'set_home_city': return `Got it — your home city is ${r.name}. Ask “what’s the weather?” any time.`;
    default: return 'Done.';
  }
}

function splitList(text) {
  return String(text || '').split(/\s*(?:,|;|\band\b|&)\s*/i).map((s) => s.trim().replace(/^(some|a|an|the|more)\s+/i, '').replace(/[.!?]+$/, '')).filter(Boolean);
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
