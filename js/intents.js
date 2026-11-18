// Instant commands: common requests handled locally without the AI model,
// so they are immediate and work even before any model is installed.
import { looksLikeMath } from './calc.js';
import { parseWhen, describeWhen } from './when.js';
import { summary as weatherSummary } from './weather.js';
import { summaryText as workoutSummaryText } from './workout.js';
import { knows as knowsUnit } from './converter.js';
import { APPS, normApp } from './messaging.js';
import { HANDLES } from './people.js';

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

  // Morning briefing: real weather, calendar, reminders and to-dos (before the old "brief" skill).
  if (/^(?:good morning|morning|morning brief(?:ing)?|brief me|my briefing|daily briefing|\/brief|what'?s my day(?: look)?(?: like)?(?: today)?|what(?:'s| is) (?:on )?(?:my day|today|my plate today|my schedule today)|what do i (?:have|need) to do today|what'?s happening today|plan my day|my day)(?:,? (?:jarvis|computer|sir|ma'?am|boss|buddy))?$/i.test(low)) return { tool: 'morning_briefing', args: {} };

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
  if (/^(link|sync|connect|pair) (my |the |all my |both )?(devices|phone|iphone|mac|computer|laptop)( and (my )?(phone|iphone|mac|computer|laptop))?( together)?$|^(sign in|log in|login|signin)$|^(make )?(everything|it) the same on (all )?(my )?(devices|phone and (mac|computer))$/i.test(low)) return { local: 'open', tab: 'sync', say: 'Here’s Link devices. Send from one device and receive on the other, and they’ll match. No account needed.' };
  if (/^(open |show )?(the )?(plugins?|plugin store|add (a )?plugins?)$/i.test(low)) return { local: 'open', tab: 'plugins', say: 'Here are your plugins and the plugin store.' };
  if (/^(share (jarvis|this app|the app|the link|your link|you|the url)|(send|give) (me )?(the|your) (link|url)|what'?s (the|your) (link|url)|copy (the|your) (link|url))$/i.test(low)) return { local: 'share' };

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

  // Home: "take me home", "walk me home", "bring me home by bus", "my home address is …"
  // An address has a number, a comma or several words; "my home is Toronto" alone is a city.
  if ((r = t.match(/^(?:my home(?: address)? is|my address is|set my home(?: address)?(?: to| as)?|save my home(?: address)?(?: as)?|home is|i live at) (?:at |in )?(.+)$/i)) && (/\d|,/.test(r[1]) || r[1].split(/\s+/).length >= 3)) return { tool: 'set_home_address', args: { address: r[1] } };
  if ((r = low.match(/^(?:take|bring|get|send|walk|drive|guide|navigate|lead) me (?:back )?home(?: (?:by|on) (car|bus|train|transit|foot|bike|walking|subway|metro))?$|^(?:directions|navigate|route|the way|show me the way) (?:to )?home(?: (?:by|on) (car|bus|train|transit|foot|bike|subway|metro))?$|^how do i get (?:back )?home$|^i (?:want|need) to go home$|^(?:let'?s )?go home$/))) {
    const by = r[1] || r[2] || (/^walk/.test(low) ? 'foot' : /^drive/.test(low) ? 'car' : '');
    const mode = { car: 'drive', bus: 'transit', train: 'transit', transit: 'transit', subway: 'transit', metro: 'transit', foot: 'walk', walking: 'walk', bike: 'cycle' }[by];
    return { tool: 'go_home', args: mode ? { mode } : {} };
  }

  // Your own number, so JARVIS can text and call you.
  if ((r = t.match(/^(?:my (?:phone |cell |mobile |iphone )?number is|my phone is|save my (?:phone )?number(?: as)?|set my (?:phone )?number(?: to)?|text me at|call me at)\s*(\+?\d[\d\s().-]{4,}|[^\s@]+@[^\s@]+\.[^\s@]+)$/i))) return { tool: 'set_my_number', args: { number: r[1].trim() } };
  // JARVIS calls you: "call me now", "call me in 10 minutes about the bank", "call me at 7am to wake me up", "wake me up at 7"
  const CALL = '(?:call me|give me a call|ring me|phone me)';
  const callRe1 = new RegExp(`^${CALL} ${TIME}(?: (?:to|about|and say|and tell me|and remind me(?: to)?) (.+))?$`, 'i');
  const callRe2 = new RegExp(`^${CALL} (?:to|about|and remind me(?: to)?) (.+?) ${TIME}$`, 'i');
  const wakeRe = new RegExp(`^wake me(?: up)? ${TIME}$`, 'i');
  if ((r = t.match(callRe1)) && parseWhen(r[1])) return { tool: 'set_reminder', args: { text: r[2] || 'your call from JARVIS', when: r[1], call_me: true } };
  if ((r = t.match(callRe2)) && parseWhen(r[2])) return { tool: 'set_reminder', args: { text: r[1], when: r[2], call_me: true } };
  if ((r = t.match(wakeRe)) && parseWhen(r[1])) return { tool: 'set_reminder', args: { text: 'Time to wake up', when: r[1], call_me: true } };
  if ((r = t.match(/^(?:call me|give me a call|ring me|phone me)(?: now| right now| back)?(?: (?:to|about|and say|and tell me) (.+))?$/i))) return { tool: 'call_me', args: { message: r[1] || '' } };

  // "call me Alex" means a name, not a phone call.
  if ((r = t.match(/^(?:call me|my name is|i'?m called) (?!(?:now|later|back|in|at|tomorrow|tonight|today|when|soon|please|up|about|to)\b)([\p{L}][\p{L}'’ -]{0,30})$/iu)) && r[1].split(/\s+/).length <= 3) return { local: 'callme', name: r[1].trim() };

  // Other apps: "call Sam on Discord", "video call Mom on WhatsApp", "whatsapp Sam saying hi", "text Jo on Telegram: hi"
  const APPW = '(discord|whats ?app|telegram|skype|(?:microsoft |ms )?teams|(?:facebook )?messenger|signal|face ?time|imessage|messages)';
  const SAY = '(?:\\s*:\\s*|\\s+saying\\s+|\\s+that says\\s+|\\s+that\\s+|\\s+to say\\s+)';
  const appOf = (w) => normApp(w.toLowerCase().replace(/^face ?time$/, 'facetime').replace(/^whats ?app$/, 'whatsapp').replace(/^(?:microsoft |ms )?teams$/, 'teams').replace(/^(?:facebook )?messenger$/, 'messenger'));
  if ((r = t.match(new RegExp(`^save (.+?)['’]s? ${APPW}(?: (?:link|username|user ?name|name|handle|id|number|email))?(?: as| is|:)? (\\S+)$`, 'i'))) || (r = t.match(new RegExp(`^(.+?)['’]s ${APPW}(?: (?:link|username|user ?name|name|handle|id|number|email))? is (\\S+)$`, 'i')))) {
    const app = appOf(r[2]);
    if (app && HANDLES.includes(app)) return { tool: 'save_contact', args: { name: r[1].replace(/^my /i, ''), app, handle: r[3] } };
  }
  if ((r = t.match(new RegExp(`^(video call|video chat|call|phone|ring|voice call) (.+?) (?:on|with|using|over|via) ${APPW}$`, 'i')))) {
    const app = appOf(r[3]);
    if (app && APPS[app].call) return { tool: 'make_call', args: { to: r[2].replace(/^my /i, ''), app, video: /video/i.test(r[1]) } };
  }
  if ((r = t.match(/^(?:video call|video chat|facetime video) (.+)$/i)) && r[1].split(/\s+/).length <= 4) return { tool: 'make_call', args: { to: r[1].replace(/^my /i, ''), app: 'facetime', video: true } };
  if ((r = t.match(new RegExp(`^(?:text|message|send (?:a )?(?:text|message) to|dm) (.+?) (?:on|with|using|over|via|in) ${APPW}${SAY}(.+)$`, 'i')))) {
    const app = appOf(r[2]);
    if (app && APPS[app].text) return { tool: 'send_text', args: { to: r[1].replace(/^my /i, ''), message: r[3], app } };
  }
  if ((r = t.match(new RegExp(`^(whats ?app|telegram|discord|signal|messenger|skype|teams|dm) (.+?)${SAY}(.+)$`, 'i')))) {
    const app = appOf(r[1]) || 'discord';
    if (APPS[app]?.text) return { tool: 'send_text', args: { to: r[2].replace(/^my /i, ''), message: r[3], app } };
  }

  // Texts: "text Mom saying I'm on my way", "message +1 555 0100: hi", "text me buy milk"
  if ((r = t.match(/^(?:text|message|imessage|send (?:a )?(?:text|message) to) (.+?)(?:\s*:\s*|\s+saying\s+|\s+that says\s+|\s+that\s+)(.+)$/i))) return { tool: 'send_text', args: { to: r[1].replace(/^my /i, ''), message: r[2] } };
  if ((r = t.match(/^text me (.+)$/i))) return { tool: 'send_text', args: { to: 'me', message: r[1] } };
  // Calls: "call Mom", "facetime +44 20 7946 0000"
  if ((r = t.match(/^(call|phone|ring|dial|facetime)(?: up)? (.+)$/i)) && !/^(me|it|that|this|off|back)\b/i.test(r[2]) && r[2].split(/\s+/).length <= 4) return { tool: 'make_call', args: { to: r[2].replace(/^my /i, ''), facetime: /facetime/i.test(r[1]) } };

  // Identify something on screen
  if (/^(what('?s| is) (this|that)( on (my |the )?screen)?|identify (this|that|something)( on (my |the )?screen)?|what am i (looking|pointing) at|look at (my |the )?screen|what('?s| is) on (my |the )?screen|explain (this|what i'?m pointing at)|circle to ask|circle (something|it|this)|ask about (a |this |my )?(photo|picture|screen))$/.test(low)) return { local: 'look', source: /screen/.test(low) ? 'screen' : null };
  if (/^(use (the |my )?camera|ask (with|using) (the |my )?camera|look (at this )?(with|through) (the |my )?camera|what('?s| is) (this|that) (in|on) (the |my )?camera|take a (photo|picture) and (tell me|ask)|scan (this|it))$/.test(low)) return { local: 'look', source: 'camera' };

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

  // Plugins: "what should I add?"
  if (/^(what should i (add|try|use|turn on)( next)?|(any )?(recommendations?|suggestions?)|recommend (me )?(something|plugins?|features?)|what (plugins|features) (should i|do you) (add|have|recommend)|(show|open) (my )?plugins|plugins|what else can you do)$/.test(low)) return { local: 'recommend' };

  // Workouts: "track my squats", "open the camera", "log 3 sets of 10 push-ups", "I ran 5 km in 30 minutes"
  const EX = { squat: 'squats', squats: 'squats', pushup: 'pushups', pushups: 'pushups', 'push-up': 'pushups', 'push-ups': 'pushups', 'push up': 'pushups', 'push ups': 'pushups', 'press ups': 'pushups', 'press-ups': 'pushups', 'jumping jack': 'jacks', 'jumping jacks': 'jacks', jacks: 'jacks', curl: 'curls', curls: 'curls', 'bicep curls': 'curls', 'bicep curl': 'curls', plank: 'plank', planks: 'plank',
    lunge: 'lunges', lunges: 'lunges', situp: 'situps', situps: 'situps', 'sit-up': 'situps', 'sit-ups': 'situps', 'sit up': 'situps', 'sit ups': 'situps', crunch: 'situps', crunches: 'situps',
    'shoulder press': 'press', 'shoulder presses': 'press', 'overhead press': 'press', press: 'press', 'lateral raise': 'raises', 'lateral raises': 'raises', 'side raises': 'raises', raises: 'raises',
    'high knees': 'knees', 'high knee': 'knees', 'glute bridge': 'bridges', 'glute bridges': 'bridges', bridges: 'bridges', bridge: 'bridges', 'hip thrusts': 'bridges',
    'wall sit': 'wallsit', 'wall sits': 'wallsit', burpee: 'burpees', burpees: 'burpees', pullup: 'pullups', pullups: 'pullups', 'pull-up': 'pullups', 'pull-ups': 'pullups', 'pull up': 'pullups', 'pull ups': 'pullups', 'chin ups': 'pullups', 'chin-ups': 'pullups' };
  if (/^(?:start|begin|open|let'?s do|do)(?: a| my| the)? (?:workout|exercise|training|workout coach)$|^(?:track|count|watch|coach) my (?:workout|exercise|reps|training)$|^open (?:the |my )?camera(?: (?:and|to) (?:track|count|watch) (?:my )?(?:workout|reps|exercise))?$|^workout(?: coach)?$|^(?:let'?s )?work ?out$/.test(low)) return { tool: 'start_workout', args: {} };
  if ((r = low.match(/^(?:track|count|watch|coach|start|let'?s do|do)(?: my| some)? (squats?|push-? ?ups?|press-? ?ups|jumping jacks?|jacks|(?:bicep )?curls?|planks?|lunges?|sit-? ?ups?|crunch(?:es)?|(?:shoulder |overhead )press(?:es)?|(?:lateral |side )raises?|high knees?|(?:glute )?bridges?|hip thrusts|wall sits?|burpees?|pull-? ?ups?|chin-? ?ups)(?: with (?:the )?camera)?$/))) return { tool: 'start_workout', args: { exercise: EX[r[1].replace(/\s+/g, ' ')] || EX[r[1].replace(/[- ]/g, '')] || 'squats' } };
  if ((r = low.match(/^(?:log|record|add|i did|i just did|did|just did)\s+(?:(\d+)\s*(?:sets?|x)\s*(?:of\s*)?)?(\d+)\s+([a-z][a-z -]{1,24}?)(?:\s+(?:at|with)\s+(\d+(?:\.\d+)?)\s*(kg|kgs|kilos?|lbs?|pounds?))?$/)) && !/\b(minutes?|mins?|hours?|reminders?|items?|things?)\b/.test(r[3])) return { tool: 'log_workout', args: { exercise: r[3], reps: +r[2], sets: r[1] ? +r[1] : undefined, weight: r[4] ? +r[4] : undefined, unit: r[5] ? (/^(lb|pound)/.test(r[5]) ? 'lb' : 'kg') : undefined } };
  if ((r = low.match(/^(?:i )?(?:just )?(ran|run|jogged|walked|cycled|biked|rode|swam)\s+(\d+(?:\.\d+)?)\s*(km|kms|kilometers?|kilometres?|miles?|mi)(?:\s+in\s+(\d+)\s*(?:min|mins|minutes))?$/))) return { tool: 'log_workout', args: { exercise: { ran: 'running', run: 'running', jogged: 'running', walked: 'walking', cycled: 'cycling', biked: 'cycling', rode: 'cycling', swam: 'swimming' }[r[1]], km: /^mi/.test(r[3]) ? Math.round(+r[2] * 1.609344 * 100) / 100 : +r[2], minutes: r[4] ? +r[4] : undefined } };
  if ((r = low.match(/^(?:i )?(?:just )?(?:did|worked out|exercised|trained|did yoga|ran|walked|cycled|swam|stretched)(?: for)? (\d+)\s*(?:min|mins|minutes)(?: of ([a-z ]{2,24}))?$/))) return { tool: 'log_workout', args: { exercise: r[2] || (/yoga/.test(low) ? 'yoga' : /ran/.test(low) ? 'running' : /walk/.test(low) ? 'walking' : /cycl/.test(low) ? 'cycling' : /swam/.test(low) ? 'swimming' : /stretch/.test(low) ? 'stretching' : 'workout'), minutes: +r[1] } };
  if (/^(how many workouts( have i done| did i do)?|my workouts|workout (summary|stats|history|report|log)|show (me )?my workouts|how(?:'?s| is| am i doing with) my (workouts?|training|fitness|exercise))( this (week|month))?$/.test(low)) return { tool: 'workout_summary', args: { days: /month/.test(low) ? 30 : 7 } };

  // Units: "convert 5 miles to km", "70 f in c", "how many grams in a pound"
  if ((r = low.match(/^(?:convert |what(?:'s| is) |how much is )?(-?\d+(?:\.\d+)?)\s*([a-z°/²0-9 .]+?)\s+(?:to|in|into|as)\s+([a-z°/²0-9 .]+?)$/)) && knowsUnit(r[2]) && knowsUnit(r[3])) return { tool: 'convert_units', args: { value: +r[1], from: r[2], to: r[3] } };
  if ((r = low.match(/^how many ([a-z°/² .]+?) (?:are )?(?:in|per) (?:a |an |one )?([a-z°/² .]+?)$/)) && knowsUnit(r[1]) && knowsUnit(r[2])) return { tool: 'convert_units', args: { value: 1, from: r[2], to: r[1] } };

  // Status
  if (/^(system (status|report|info|check)|status report|diagnostics|(phone|device) (status|report|check)|check my (phone|device)|how('?s| is) my (computer|mac|laptop|pc|phone|iphone|device) doing|(check )?(my )?battery( level| status)?|how much (battery|memory|ram|storage|disk space) (do i have|is left)( left)?)$/.test(low)) return { tool: 'system_status', args: {} };

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
  if (/^open (the |my )?camera$/.test(low)) return { tool: 'start_workout', args: {} };
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
    case 'call_me': return r.sent ? `Calling you now, check your iPhone. 📞` : `Messages opened with the call link ready. Press Send to ring your iPhone.`;
    case 'set_my_number': return `Got it. I’ll text and call you at **${r.number}**. It’s saved only on this device. Try “text me hello” or “call me in 1 minute”.`;
    case 'set_reminder': if (intent.args.call_me) return `I’ll call you ${r.when}: **${r.text}**.${r.callNote ? ' ' + r.callNote : ''}`;
      return `I’ll remind you ${r.when}${r.texts ? ' and text you' : ''}: **${r.text}**.${r.inSystemReminders ? ' It’s in your Reminders app too, so your phone will remind you as well.' : ''}`;
    case 'list_reminders': return r.count ? `You have ${r.count} upcoming reminder${r.count === 1 ? '' : 's'}:\n\n${r.reminders.map((x) => `- **${x.text}** — ${x.when}`).join('\n')}` : 'You have no upcoming reminders.';
    case 'cancel_reminder': return `Cancelled ${r.cancelled} reminder${r.cancelled === 1 ? '' : 's'}.`;
    case 'send_text': if (r.app) return r.how === 'prefills' ? `${r.app} is open with your message to ${r.to}. Press Send.` : `${r.app} is open on your chat with ${r.to}. Your message is copied, so paste it and press Send.`;
      return r.sent ? `Message sent to ${r.to}.` : `Your messages app is open with the text to ${r.to}. Press Send when you’re ready.`;
    case 'make_call': if (r.how === 'opens') return `${r.app} is open on your chat with ${r.to}. Tap the ${intent.args.video ? 'video' : 'call'} button there (${r.app} doesn’t let other apps start calls).`;
      return `Calling ${r.to}${r.app && r.app !== 'Phone' ? ` on ${r.app}` : ''}.`;
    case 'add_to_list': return r.added.length ? `Added ${listWords(r.added)} to your ${r.list} list. ${r.count} item${r.count === 1 ? '' : 's'} on it now.` : `That’s already on your ${r.list} list.`;
    case 'show_list': return r.items.length ? `Your ${r.list} list:\n\n${r.items.map((i) => '- ' + i).join('\n')}` : `Your ${r.list} list is empty.${r.lists?.length > 1 ? ` Your lists: ${r.lists.join(', ')}.` : ''}`;
    case 'remove_from_list': return r.removed.length ? `Ticked off ${listWords(r.removed)}. ${r.count} left on your ${r.list} list.` : `I couldn’t find that on your ${r.list} list.`;
    case 'clear_list': return `Your ${r.list} list is empty now.`;
    case 'save_contact': if (r.app && !r.number) return `Saved ${r.name}’s ${r.app}. Now say “call ${r.name} on ${r.app}” or “message ${r.name} on ${r.app}: …”.`;
      return `Saved ${r.name}: ${r.number}. You can now say “text ${r.name} …” or “call ${r.name}”.`;
    case 'get_weather': return weatherSummary(r);
    case 'start_workout': return `Opening the workout coach for ${r.exercise.toLowerCase()}. Prop your phone up so your whole body is in view, and I’ll count every rep.`;
    case 'log_workout': return `Logged **${r.logged}**. That’s ${r.week} workout${r.week === 1 ? '' : 's'} this week${r.streak > 1 ? `, and a ${r.streak}-day streak 🔥` : ''}.`;
    case 'workout_summary': return workoutSummaryText(r);
    case 'convert_units': return r.text + '.';
    case 'go_home': return `${r.app} is open with directions home (${r.mode}).${r.mode === 'driving' ? ' Drive safe!' : ''} 🏠`;
    case 'set_home_address': return `Saved your home address. It stays on this device. Say “take me home” any time.`;
    case 'morning_briefing': return r.md;
    case 'set_home_city': return `Got it — your home city is ${r.name}. Ask “what’s the weather?” any time.`;
    default: return 'Done.';
  }
}

function splitList(text) {
  return String(text || '').split(/\s*(?:,|;|\band\b|&)\s*/i).map((s) => s.trim().replace(/^(some|a|an|the|more)\s+/i, '').replace(/[.!?]+$/, '')).filter(Boolean);
}

export function statusText(r) {
  if (r.web) {
    const gb = (b) => (b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : Math.round((b || 0) / 1e6) + ' MB');
    const lines = [
      `**${r.device}${r.os ? ' · ' + r.os : ''}**${r.installed ? ' · on your Home Screen' : ' · in the browser'}`,
      `- Network: ${r.online ? 'online' : 'offline'}${r.network ? ` (${r.network})` : ''}`,
      r.storage ? `- Storage used by JARVIS: ${gb(r.storage.used)}${r.storage.quota ? ` of ${gb(r.storage.quota)} allowed` : ''}` : '',
      r.battery ? `- Battery: ${r.battery.level}%${r.battery.charging ? ' and charging' : ''}` : '',
      r.memoryGB ? `- Memory: about ${r.memoryGB} GB` : '',
      `- On-device AI: ${r.gpu ? 'supported' : 'not supported in this browser'}`,
      r.app ? `- JARVIS: ${r.app.upcomingReminders} reminder${r.app.upcomingReminders === 1 ? '' : 's'} coming up · ${r.app.listItems} list item${r.app.listItems === 1 ? '' : 's'} · ${r.app.workoutsThisWeek} workout${r.app.workoutsThisWeek === 1 ? '' : 's'} this week${r.app.streak > 1 ? ` (${r.app.streak}-day streak)` : ''} · ${r.app.people} saved ${r.app.people === 1 ? 'person' : 'people'}` : '',
    ];
    return `All systems nominal.\n\n${lines.filter(Boolean).join('\n')}`;
  }
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
