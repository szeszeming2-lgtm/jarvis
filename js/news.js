// News summaries from free sources, no account or key:
// - Wikipedia's "Current events" pages (today and yesterday): works on every device.
// - The Mac app also reads BBC News headlines (browsers can't read other sites).
import { call, can } from './host.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pageFor = (d) => `Portal:Current_events/${d.getUTCFullYear()}_${MONTHS[d.getUTCMonth()]}_${d.getUTCDate()}`;

/** Wikipedia current-events HTML → [{text, category}] (leaf items, with their topic in front). */
export function parseCurrentEvents(html) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  const root = doc.querySelector('.current-events-content') || doc.body;
  const out = [];
  let category = '';
  const clean = (s) => s.replace(/\s*\((?:[A-Z][\w.&' -]{1,40}(?:,\s*)?)+\)\s*$/g, '').replace(/\[\d+\]/g, '').replace(/\s+/g, ' ').trim();
  for (const node of root.children) {
    if (node.tagName === 'P' || /^H\d$/.test(node.tagName) || node.getAttribute?.('role') === 'heading') { const c = node.textContent.trim(); if (c && c.length < 80) category = c; continue; }
    if (node.tagName !== 'UL') continue;
    const walk = (ul, topic) => {
      for (const li of ul.children) {
        if (li.tagName !== 'LI') continue;
        const sub = li.querySelector(':scope > ul');
        const own = clean([...li.childNodes].filter((n) => n.nodeName !== 'UL').map((n) => n.textContent).join(''));
        if (sub) walk(sub, own || topic);
        else if (own.length > 25) out.push({ text: topic && !own.startsWith(topic) ? `${topic}: ${own}` : own, category });
      }
    };
    walk(node, '');
  }
  return out;
}

/** RSS → [{text}] */
export function parseRss(xml) {
  const doc = new DOMParser().parseFromString(String(xml || ''), 'application/xml');
  return [...doc.querySelectorAll('item')].map((i) => ({ text: `${i.querySelector('title')?.textContent?.trim() || ''}${i.querySelector('description')?.textContent ? ` — ${i.querySelector('description').textContent.trim()}` : ''}`, link: i.querySelector('link')?.textContent?.trim() || '', category: 'BBC News' })).filter((x) => x.text.length > 10);
}

export async function headlines({ topic = '', max = 10 } = {}) {
  if ((await import('./store.js')).settings.privacy?.localOnly) throw new Error('Local-only mode is on, so I don’t use the internet. Turn it off in Settings → Privacy & Data.');
  const items = [];
  const now = new Date();
  for (const d of [now, new Date(now.getTime() - 86400000)]) {
    try {
      const j = await fetch(`https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(pageFor(d))}&prop=text&format=json&formatversion=2&origin=*`).then((r) => r.json());
      if (j.parse?.text) items.push(...parseCurrentEvents(j.parse.text).map((x) => ({ ...x, source: 'Wikipedia current events', day: d.toDateString() === now.toDateString() ? 'today' : 'yesterday' })));
    } catch {}
  }
  if (can('webFetch')) {
    try { items.push(...parseRss((await call('web.get', { url: 'https://feeds.bbci.co.uk/news/world/rss.xml' })).text).slice(0, 15).map((x) => ({ ...x, source: 'BBC News', day: 'today' }))); } catch {}
  }
  if (!items.length) throw new Error('I couldn’t reach the news sources. Are you online?');
  const words = String(topic || '').toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const picked = words.length ? items.filter((x) => words.some((w) => x.text.toLowerCase().includes(w))) : items;
  // Mix sources so one doesn't crowd out the other.
  const bySource = {};
  for (const x of picked) (bySource[x.source] ||= []).push(x);
  const mixed = [];
  for (let i = 0; mixed.length < max && Object.values(bySource).some((l) => l[i]); i++) for (const l of Object.values(bySource)) if (l[i] && mixed.length < max) mixed.push(l[i]);
  return { topic, items: mixed, total: picked.length };
}
