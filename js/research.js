// Deep research and a team of AI agents, using the same local AI.
//
// Research: plan sub-questions → find sources → read each one → write a report with
// numbered sources → a reviewer checks it against the notes → final version.
// Sources: the Mac app searches the whole web (DuckDuckGo) and reads the pages itself;
// the web version (and phones) can only read Wikipedia, because browsers block other
// sites from being read by a website. That's said in the report.
//
// Team: several "agents" (the same model given different jobs) work on one task in turn:
// planner → expert → critic → editor.
import { call, can, isNative } from './host.js';
import * as ollama from './ollama.js';
import { settings } from './store.js';

/** One full AI answer (no streaming unless onDelta), with an optional system role. */
export async function complete(system, user, { onDelta, maxChars = 0 } = {}) {
  let out = '';
  const req = ollama.chat({ model: settings.ai.model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], think: false }, { onContent: (d) => { out += d; onDelta?.(d); } });
  complete.cancel = req.cancel;
  await req.promise;
  out = out.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  return maxChars ? out.slice(0, maxChars) : out;
}

const STOP = new Set('the a an and or of to in on for with how what why when where who which is are was were be been does do did about into from that this those these it its as at by tell me explain history'.split(' '));
export const keywords = (t) => [...new Set(String(t || '').toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)))].slice(0, 6);
const lines = (t, max) => String(t || '').split('\n').map((s) => s.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').replace(/^["']|["']$/g, '').trim()).filter((s) => s.length > 3 && s.length < 160).slice(0, max);

/** Readable text from an HTML page (scripts, menus and footers removed). */
export function htmlToText(html, max = 4000) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  doc.querySelectorAll('script,style,noscript,nav,header,footer,aside,form,svg,iframe,button').forEach((n) => n.remove());
  const main = doc.querySelector('article, main, [role=main]') || doc.body;
  const text = (main?.innerText || main?.textContent || '').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
  return { title: doc.title?.trim() || '', text: text.slice(0, max) };
}

/** DuckDuckGo results page → [{title, url, snippet}] (Mac app only: needs a fetch without CORS). */
export function parseDuckDuckGo(html, max = 6) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  const out = [];
  for (const r of doc.querySelectorAll('.result')) {
    const a = r.querySelector('a.result__a');
    if (!a) continue;
    let href = a.getAttribute('href') || '';
    const m = href.match(/[?&]uddg=([^&]+)/);
    if (m) href = decodeURIComponent(m[1]);
    if (!/^https?:\/\//.test(href) || /duckduckgo\.com\/y\.js|ad_domain/.test(href)) continue;
    out.push({ title: a.textContent.trim(), url: href, snippet: r.querySelector('.result__snippet')?.textContent.trim() || '' });
    if (out.length >= max) break;
  }
  return out;
}

async function webSources(q, n) {
  const r = await call('web.get', { url: 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q) });
  return parseDuckDuckGo(r.text, n);
}

async function wikiSources(q, n) {
  const s = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=${n}&format=json&origin=*`).then((r) => r.json());
  return (s.query?.search || []).map((x) => ({ title: x.title, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(x.title.replace(/ /g, '_'))}`, snippet: x.snippet.replace(/<[^>]+>/g, ''), wiki: true }));
}

/** The paragraphs that match the topic best (the start of the page always counts), up to max characters. */
export function bestParts(text, keys, max = 4000) {
  const paras = String(text || '').split(/\n{1,}/).map((p) => p.trim()).filter((p) => p.length > 40);
  if (paras.join('\n').length <= max || !keys.length) return paras.join('\n').slice(0, max);
  const scored = paras.map((p, i) => { const low = p.toLowerCase(); return { i, p, s: keys.reduce((n, k) => n + (low.split(k).length - 1), 0) + (i === 0 ? 3 : 0) }; });
  const pick = [];
  let used = 0;
  for (const x of [...scored].sort((a, b) => b.s - a.s)) { if (!x.s || used + x.p.length > max) continue; pick.push(x); used += x.p.length + 1; } // paragraphs with no topic words are left out
  return pick.sort((a, b) => a.i - b.i).map((x) => x.p).join('\n');
}

async function readSource(src, keys = []) {
  if (src.wiki) {
    const j = await fetch(`https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&exsectionformat=plain&titles=${encodeURIComponent(src.title)}&format=json&origin=*`).then((r) => r.json());
    const page = Object.values(j.query?.pages || {})[0];
    return bestParts(page?.extract || '', keys, 4500);
  }
  const r = await call('web.get', { url: src.url });
  return bestParts(htmlToText(r.text, 60000).text, keys, 4500);
}

export const canReadWeb = () => can('webFetch');

/**
 * Deep research. onStep({step, text}) reports progress; onDelta streams the final report.
 * Returns {report (markdown), sources}.
 */
export async function research(topic, { onStep = () => {}, onDelta, maxSources = 5, factCheck = false } = {}) {
  if ((await import('./store.js')).settings.privacy?.localOnly) throw new Error('Local-only mode is on, so I don’t use the internet. Turn it off in Settings → Privacy & Data.');
  const web = canReadWeb();
  onStep({ step: 'plan', text: 'Planning the research' });
  const plan = await complete(web
    ? 'You are a research planner. Reply with 3 short web search queries (one per line, no numbering, no extra words) that together answer the topic well.'
    : 'You are a research planner. Reply with the titles of the 3 English Wikipedia articles most likely to answer the topic (one per line, no numbering, no extra words).', `Topic: ${topic}`);
  const queries = [topic, ...lines(plan, 3)].slice(0, 4);
  const keys = keywords(topic);
  // Skip results that have nothing to do with the topic (search engines pad results).
  // Score: a topic word in the title counts 2, in the snippet 1; need most of the topic covered.
  const relevant = (f) => { if (keys.length < 2) return true; const t = f.title.toLowerCase(), sn = f.snippet.toLowerCase(); const score = keys.reduce((n, k) => n + (t.includes(k) ? 2 : sn.includes(k) ? 1 : 0), 0); return score >= Math.min(keys.length + 1, 4); };
  onStep({ step: 'search', text: `Searching ${web ? 'the web' : 'Wikipedia'}: ${queries.slice(1).join(' · ') || topic}` });
  const seen = new Set(), sources = [];
  for (const q of queries) {
    let found = [];
    try { found = web ? await webSources(q, 4) : await wikiSources(q, 3); } catch {}
    // The web search site can be down or blocked: Wikipedia still answers.
    if (web && !found.length) { try { found = await wikiSources(q, 3); } catch {} }
    for (const f of found) { const k = f.url.replace(/[#?].*$/, ''); if (!seen.has(k) && relevant(f)) { seen.add(k); sources.push(f); } }
    if (sources.length >= maxSources * 2) break;
  }
  if (!sources.length) throw new Error(web ? 'I couldn’t reach any web pages. Are you online?' : 'I couldn’t reach Wikipedia. Are you online?');
  const notes = [];
  for (const src of sources) {
    if (notes.length >= maxSources) break;
    onStep({ step: 'read', text: `Reading ${notes.length + 1} of ${Math.min(maxSources, sources.length)}: ${src.title.slice(0, 70)}` });
    let text = '';
    try { text = await readSource(src, keys); } catch { continue; }
    if (text.length < 200) continue;
    const n = await complete('You are a careful research assistant. From the source text, write 3 to 6 short bullet points of facts that help answer the topic. Only use facts stated in the source. If nothing is relevant, reply "nothing relevant".', `Topic: ${topic}\n\nSource: ${src.title}\n\n${text}`, { maxChars: 1400 });
    if (/^nothing relevant/i.test(n)) continue;
    notes.push({ ...src, n: notes.length + 1, notes: n });
  }
  if (!notes.length) throw new Error('I found pages, but none had useful facts on this topic. Try wording it differently.');
  const noteBlock = notes.map((s) => `[${s.n}] ${s.title}\n${s.notes}`).join('\n\n');
  onStep({ step: 'write', text: 'Writing the report' });
  const draft = await complete(factCheck
    ? 'You are a careful fact-checker. The topic is a claim. First line: the verdict, exactly one of “✅ True”, “❌ False”, “⚠️ Partly true” or “❓ Not enough evidence”, then a dash and one sentence. Then explain in short paragraphs using only the numbered notes, cite them like [1], and say what is uncertain or may have changed recently. If the notes do not settle it, the verdict is “❓ Not enough evidence”. No sources list at the end (it is added for you).'
    : 'You are a research writer. Write a clear report in Markdown: a 2-3 sentence summary first, then short sections with headings. Use only the numbered notes, cite them like [1] after the facts they support, and say plainly where the notes disagree or something is unknown. Leave out notes that are not about the topic, and never write about what you left out. No sources list at the end (it is added for you).', `Topic: ${topic}\n\nNotes:\n${noteBlock}`);
  onStep({ step: 'review', text: 'A reviewer is checking the facts' });
  const review = await complete('You are a strict fact-checking reviewer. Compare the report with the notes. List at most 4 problems: claims not supported by the notes, wrong citations, or important missing points. If it is all fine, reply exactly "OK".', `Notes:\n${noteBlock}\n\nReport:\n${draft}`, { maxChars: 1200 });
  let report = draft;
  if (!/^\W*ok\W*$/i.test(review.trim())) {
    onStep({ step: 'revise', text: 'Fixing what the reviewer found' });
    report = await complete('You are a research writer. Rewrite the report fixing every problem the reviewer found. Keep the same Markdown style and [n] citations, using only the notes.', `Notes:\n${noteBlock}\n\nReport:\n${draft}\n\nReviewer's problems:\n${review}`, { onDelta });
  } else if (onDelta) onDelta(draft);
  const cited = notes.filter((s) => report.includes(`[${s.n}]`));
  const list = (cited.length ? cited : notes).map((s) => `${s.n}. [${s.title}](${s.url})`).join('\n');
  const note = web ? '' : '\n\n_Sources are from Wikipedia: in a browser, websites can’t read other sites. The JARVIS Mac app researches the whole web._';
  return { report: `${report.trim()}\n\n**Sources**\n${list}${note}`, sources: notes, reviewed: !/^\W*ok\W*$/i.test(review.trim()) };
}

export const ROLES = [
  { id: 'planner', name: 'Planner', icon: 'list', system: 'You are the PLANNER on a small team. Break the task into 3 to 6 clear steps and say what a great result looks like. Be brief.' },
  { id: 'expert', name: 'Expert', icon: 'sparkles', system: 'You are the EXPERT on a small team. Do the task fully, following the planner\'s steps. Give the complete result.' },
  { id: 'critic', name: 'Critic', icon: 'shield', system: 'You are the CRITIC on a small team. Find mistakes, gaps and weak spots in the expert\'s result. List at most 5 concrete fixes. If it is excellent, reply exactly "OK".' },
  { id: 'editor', name: 'Editor', icon: 'edit', system: 'You are the EDITOR on a small team. Produce the final answer for the user: the expert\'s result with every one of the critic\'s fixes applied. Reply with only the final answer, in Markdown.' },
];

/** Team of agents. onStep({role, text}) for progress; onDelta streams the final answer. Returns {answer, notes}. */
export async function team(task, { onStep = () => {}, onDelta } = {}) {
  const notes = {};
  onStep({ role: 'planner', text: 'Planner is breaking the task into steps' });
  notes.planner = await complete(ROLES[0].system, `Task: ${task}`, { maxChars: 1500 });
  onStep({ role: 'expert', text: 'Expert is doing the work' });
  notes.expert = await complete(ROLES[1].system, `Task: ${task}\n\nPlanner's steps:\n${notes.planner}`);
  onStep({ role: 'critic', text: 'Critic is checking it' });
  notes.critic = await complete(ROLES[2].system, `Task: ${task}\n\nExpert's result:\n${notes.expert}`, { maxChars: 1500 });
  if (/^\W*ok\W*$/i.test(notes.critic.trim())) { onDelta?.(notes.expert); return { answer: notes.expert, notes }; }
  onStep({ role: 'editor', text: 'Editor is applying the fixes' });
  const answer = await complete(ROLES[3].system, `Task: ${task}\n\nExpert's result:\n${notes.expert}\n\nCritic's fixes:\n${notes.critic}`, { onDelta });
  return { answer, notes };
}

export const isNativeWeb = () => isNative;
