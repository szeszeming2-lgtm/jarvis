// Study tools: flashcards made by the AI (from a topic or a document) and comparing
// two documents side by side.
import { complete } from './research.js';

/** "Q: … / A: …" lines (what we ask the model for) → [{q, a}]. Also accepts "1. question — answer". */
export function parseCards(text) {
  const cards = [];
  let q = null;
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim().replace(/^\*\*|\*\*$/g, '');
    let m;
    if ((m = line.match(/^(?:\d+[.)]\s*)?(?:q(?:uestion)?|front)\s*[:.-]\s*(.+)$/i))) q = m[1].trim();
    else if ((m = line.match(/^(?:a(?:nswer)?|back)\s*[:.-]\s*(.+)$/i)) && q) { cards.push({ q, a: m[1].trim() }); q = null; }
    else if ((m = line.match(/^\d+[.)]\s*(.+?)\s+[—–-]{1,2}\s+(.+)$/))) cards.push({ q: m[1].trim(), a: m[2].trim() });
  }
  return cards.filter((c) => c.q.length > 2 && c.a.length > 0).slice(0, 30);
}

export async function makeCards({ topic = '', text = '', count = 10 }) {
  const src = text ? `Use only this material:\n\n${String(text).slice(0, 12000)}` : `Topic: ${topic}`;
  const out = await complete(`You make study flashcards. Write exactly ${count} cards, each as two lines:\nQ: a short question\nA: a short, correct answer\nNo other text.`, src);
  const cards = parseCards(out);
  if (!cards.length) throw new Error('The AI didn’t make usable flashcards. Try a clearer topic, or a bigger model.');
  return cards;
}

export async function compare(a, b, focus = '') {
  return complete('You compare two documents for the user. Reply in Markdown with: a one-paragraph summary of how they differ; a table of the main points (point | first document | second document); what is only in the first; what is only in the second; anything that contradicts. Quote short phrases when useful. Be accurate: use only what is in the documents.',
    `${focus ? `What the user cares about: ${focus}\n\n` : ''}FIRST DOCUMENT: ${a.name}\n${a.text.slice(0, 9000)}\n\nSECOND DOCUMENT: ${b.name}\n${b.text.slice(0, 9000)}`);
}
