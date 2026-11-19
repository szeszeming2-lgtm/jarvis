// "Try saying": after every reply, up to 3 things you could say next. They are picked on
// the device from what you just asked and what JARVIS did (no AI call, so it is instant and
// works offline), plus one tip for something you haven't tried yet.
// Each suggestion: { text, fill? } — fill means "put it in the box so you can finish it".

const TIPS = [
  // [what to say, where it works: all | mac | web, the tool it uses (to skip ones you already use)]
  ['What’s the weather?', 'all', 'get_weather'],
  ['Start a 25 minute focus session', 'all', 'focus_session'],
  ['Remind me in 10 minutes to stretch', 'all', 'set_reminder'],
  ['What’s on my shopping list?', 'all', 'show_list'],
  ['Good morning', 'all', 'morning_briefing'],
  ['Evening summary', 'all', 'evening_summary'],
  ['News', 'all', 'get_news'],
  ['Make slides about the solar system', 'all', 'create'],
  ['Translate between English and Spanish', 'all', 'translate'],
  ['Fact check: the Great Wall of China is visible from space', 'all', 'research'],
  ['Make flashcards about the planets', 'all', 'cards'],
  ['Convert 5 miles to km', 'all', 'convert_units'],
  ['Set a timer for 5 minutes', 'all', 'set_timer'],
  ['Command center', 'all', 'command'],
  ['Study mode', 'all', 'set_mode'],
  ['Open Spotify', 'all', 'open_app'],
  ['System report', 'all', 'system_status'],
  ['What’s using my storage?', 'mac', 'storage_report'],
  ['Find duplicate files in Downloads', 'mac', 'find_duplicates'],
  ['Put Safari on the left', 'mac', 'window_control'],
];

const short = (s, n = 52) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).trim() + '…' : t; };
/** A short topic from what the user asked ("tell me about black holes" → "black holes"). */
export function topicOf(text) {
  const t = String(text || '').trim().replace(/[?.!]+$/, '')
    .replace(/,?\s+(?:in (?:a |one |two |three |\d+ |a few |simple |plain )?(?:sentences?|words?|paragraphs?|points?|steps?|lines?|detail|english)|briefly|simply|please|quickly|for (?:me|kids|a kid|a beginner|beginners))$/i, '');
  const m = t.match(/^(?:(?:can you |could you |please )?(?:tell me|explain|teach me|what (?:is|are)|who (?:is|was)|how (?:do|does|did)|why (?:is|do|does)|describe|research|deep research)(?: about| on)? )(.{2,60})$/i);
  const topic = (m ? m[1] : t).replace(/^(?:a |an |the )/i, '');
  return topic.split(/\s+/).length <= 6 && topic.length >= 3 ? topic : '';
}

/**
 * messages: the conversation (newest last). Returns [{text, fill?}] (at most 3).
 * where: 'mac' | 'web'. used: Set of tools/features already used (to pick fresh tips). seed: varies the tip.
 */
export function nextSuggestions(messages, { where = 'web', used = new Set(), seed = 0, mode = 'assistant' } = {}) {
  const list = messages || [];
  const lastA = [...list].reverse().find((m) => m.role === 'assistant' && !m.hidden);
  if (!lastA || lastA.pending) return [];
  const iA = list.lastIndexOf(lastA);
  const lastU = [...list.slice(0, iA)].reverse().find((m) => m.role === 'user');
  const tools = list.slice(list.lastIndexOf(lastU) + 1, iA + 1).filter((m) => m.role === 'tool' && m.tool_name);
  const tool = tools[tools.length - 1];
  const args = tool?.args || {};
  const content = String(lastA.content || '');
  const out = [];
  const add = (text, fill = false) => { if (text && out.length < 3 && !out.some((x) => x.text.toLowerCase() === text.toLowerCase()) && text.toLowerCase() !== String(lastU?.content || '').toLowerCase()) out.push({ text, fill }); };

  if (lastA.error) {
    if (lastA.errorKind === 'nomodel' || /model/i.test(lastA.error)) add('Open AI models');
    add('What’s on my to-do list?');
  } else if (tool) {
    const list2 = args.list || '';
    switch (tool.tool_name) {
      case 'get_weather': add('What’s the weather tomorrow?'); add('Remind me tomorrow at 8am to take an umbrella'); break;
      case 'set_reminder': add('What are my reminders?'); add('Remind me in 1 hour to take a break'); break;
      case 'list_reminders': add('Remind me in 30 minutes to call back'); break;
      case 'add_to_list': if (list2) { add(`What’s on my ${list2} list?`); add(`Add eggs to my ${list2} list`); } break;
      case 'show_list': if (list2) { add(`Add milk to my ${list2} list`); add(`Clear my ${list2} list`); } break;
      case 'focus_session': if (args.action === 'start') { add('Focus status'); add('note: ', true); add('Stop focus'); } else add('Start a 25 minute focus session'); break;
      case 'set_timer': add('Set a timer for 10 minutes'); add('Start the stopwatch'); break;
      case 'get_news': add('News about technology'); add('News about science'); break;
      case 'evening_summary': case 'morning_briefing': add('What are my reminders?'); add('What’s on my to-do list?'); break;
      case 'save_link': add('Show my saved links'); break;
      case 'send_text': case 'make_call': add('Remind me in 1 hour to call back'); break;
      case 'set_mode': add(args.mode === 'assistant' ? 'Study mode' : 'Normal mode'); break;
      case 'calculate': case 'convert_units': add('What is 18% of 64?'); add('Convert 30 celsius to fahrenheit'); break;
      case 'system_status': case 'running_apps': case 'storage_report': if (where === 'mac') { add('Check my Mac'); add('Find duplicate files in Downloads'); } break;
      case 'create_document': add('Open my Documents folder'); break;
      default: break;
    }
  }
  if (!lastA.error && out.length < 2) {
    const topic = topicOf(lastU?.content);
    if (/```/.test(content)) { add('Explain this code step by step'); add('How do I run it?'); }
    else if (/\?\s*$/.test(content.trim()) && content.length < 400) { add('Yes'); add('No, thanks'); }
    else if (lastA.steps?.length || /^#{1,3} /m.test(content) || content.length > 900) { add('Summarize that in 3 points'); if (topic) add(`Make slides about ${topic}`); }
    else if (content.length > 120) {
      if (mode === 'study' || mode === 'teacher') { add('Quiz me on this'); if (topic) add(`Make flashcards about ${topic}`); }
      add('Explain it more simply'); add('Give me an example');
      if (topic && !out.some((x) => /slides|flashcards/.test(x.text))) add(`Tell me more about ${topic}`);
    }
  }
  // One tip for something new (skip things you already use, and things this device can't do).
  const tips = TIPS.filter(([, w, key]) => (w === 'all' || w === where) && !used.has(key) && !out.some((x) => x.text === key));
  if (tips.length && out.length < 3) add(tips[Math.abs(seed) % tips.length][0]);
  return out.map((x) => ({ ...x, text: x.text, label: short(x.text) }));
}
