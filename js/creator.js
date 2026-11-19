// Creator tools: the AI drafts, this module turns the draft into a real file.
// - Slides → a PowerPoint (.pptx) file, made on this device by pptx.js (no libraries).
// - Spreadsheets → a CSV file (opens in Excel, Numbers, Google Sheets) + a table in chat.
// - Websites / small apps → one self-contained HTML file you can open in any browser.
import { call, isNative } from './host.js';
import { complete } from './research.js';


// ---------------------------------------------------------------- saving
async function saveFile(name, { text, base64, type }) {
  if (isNative) {
    const r = await call('file.save', { name, ...(base64 ? { base64 } : { content: text }) });
    if (!r?.ok) throw new Error('Not saved.');
    return { name, path: r.path || name };
  }
  const blob = base64 ? new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], { type }) : new Blob([text], { type });
  const file = new File([blob], name, { type });
  if (/iPhone|iPad|Android/i.test(navigator.userAgent) && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return { name, shared: true }; } catch (e) { if (e.name === 'AbortError') throw new Error('Not saved.'); }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return { name, downloaded: true };
}
const safeName = (s, ext) => `${String(s || 'JARVIS').replace(/[^\w\- ]+/g, '').trim().slice(0, 50) || 'JARVIS'}.${ext}`;

// ---------------------------------------------------------------- slides
/** "# Deck title / ## Slide / - bullet / Notes: …" → {title, slides:[{title, bullets, notes}]} */
export function parseDeck(md) {
  const deck = { title: '', slides: [] };
  let cur = null;
  for (const raw of String(md || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    let m;
    if ((m = line.match(/^#\s+(.+)/)) && !deck.title) deck.title = m[1].replace(/\*\*/g, '');
    else if ((m = line.match(/^##+\s*(?:slide\s*\d+\s*[:.-]\s*)?(.+)/i))) { cur = { title: m[1].replace(/\*\*/g, ''), bullets: [], notes: '' }; deck.slides.push(cur); }
    else if ((m = line.match(/^(?:speaker )?notes?\s*:\s*(.+)/i)) && cur) cur.notes += (cur.notes ? ' ' : '') + m[1];
    else if ((m = line.match(/^(?:[-*•]|\d+[.)])\s+(.+)/)) && cur) cur.bullets.push(m[1].replace(/\*\*/g, ''));
    else if (cur && !/^```/.test(line)) cur.bullets.push(line.replace(/\*\*/g, ''));
  }
  deck.slides = deck.slides.filter((s) => s.title).slice(0, 20);
  return deck;
}

export async function makeSlides(topic, { onStep = () => {} } = {}) {
  onStep('Writing the slides');
  const md = await complete('You write presentation slide decks. Reply in this exact format and nothing else:\n# Deck title\n## Slide title\n- short bullet\n- short bullet\nNotes: what to say on this slide\n(repeat ## for each slide). 6 to 10 slides: a title slide, the main points, and a closing slide. At most 5 short bullets per slide.', `Topic: ${topic}`);
  const deck = parseDeck(md);
  if (deck.slides.length < 2) throw new Error('The AI didn’t write usable slides. Try again, or use a bigger model.');
  onStep('Building the PowerPoint file');
  const { buildPptx } = await import('./pptx.js');
  const firstIsTitle = !deck.slides[0]?.bullets.length;
  const u8 = buildPptx({ title: deck.title || topic, subtitle: firstIsTitle ? deck.slides[0].title : new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }), slides: deck.slides.slice(firstIsTitle ? 1 : 0) });
  onStep('Saving');
  let bin = ''; for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  const base64 = btoa(bin);
  const saved = await saveFile(safeName(deck.title || topic, 'pptx'), { base64, type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
  return { ...saved, title: deck.title || topic, slides: deck.slides.length, outline: deck.slides.map((x) => x.title), notes: deck.slides.filter((x) => x.notes).map((x) => `**${x.title}:** ${x.notes}`) };
}

// ---------------------------------------------------------------- spreadsheets
/** Simple CSV reader (quotes, commas inside quotes). */
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  const t = String(text || '').replace(/\r/g, '');
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"' && t[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell.trim()); cell = ''; }
    else if (ch === '\n') { row.push(cell.trim()); if (row.some((c) => c !== '')) rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  row.push(cell.trim()); if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}
export const toCsv = (rows) => rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(',')).join('\n');

export async function makeSpreadsheet(what, { onStep = () => {} } = {}) {
  onStep('Building the table');
  const out = await complete('You make spreadsheets. Reply with ONLY CSV (a header row, then data rows), inside a ```csv code block. Use numbers without currency signs in number columns. Where a total helps, add a final row that sums it.', `Make a spreadsheet: ${what}`);
  const body = (out.match(/```(?:csv)?\s*\n([\s\S]*?)```/) || [, out])[1];
  const rows = parseCsv(body).filter((r) => r.length > 1);
  if (rows.length < 2) throw new Error('The AI didn’t make a usable table. Try describing the columns you want.');
  const width = Math.max(...rows.map((r) => r.length));
  const norm = rows.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ''));
  onStep('Saving');
  const saved = await saveFile(safeName(what.split(/\s+/).slice(0, 6).join(' '), 'csv'), { text: toCsv(norm), type: 'text/csv' });
  const md = [`| ${norm[0].join(' | ')} |`, `| ${norm[0].map(() => '---').join(' | ')} |`, ...norm.slice(1, 25).map((r) => `| ${r.map((c) => c.replace(/\|/g, '\\|')).join(' | ')} |`)].join('\n');
  return { ...saved, rows: norm.length - 1, cols: width, table: md };
}

// ---------------------------------------------------------------- websites and small apps
export function extractHtml(text) {
  const m = String(text || '').match(/```html\s*\n([\s\S]*?)```/i) || String(text || '').match(/(<!doctype html[\s\S]*<\/html>)/i);
  return m ? m[1].trim() : '';
}

export async function buildPage(description, { app = false, onStep = () => {} } = {}) {
  onStep(app ? 'Writing the app' : 'Designing the website');
  const out = await complete(`You are an expert web developer. Build ${app ? 'a small working web app' : 'a good-looking one-page website'} as ONE complete HTML file with all CSS${app ? ' and JavaScript' : ''} inline (no external files, no frameworks, no images from the internet). Modern, responsive, accessible. Reply with only the file inside a \`\`\`html code block.`, `Build: ${description}`);
  const html = extractHtml(out);
  if (!html || html.length < 200) throw new Error('The AI didn’t write a complete page. Try again with a bit more detail.');
  onStep('Saving');
  const title = (html.match(/<title>([^<]{1,60})<\/title>/i)?.[1] || description).trim();
  const saved = await saveFile(safeName(title, 'html'), { text: html, type: 'text/html' });
  if (isNative && saved.path) call('tool.open_path', { path: saved.path }).catch(() => {});   // open it in the browser
  return { ...saved, title, size: html.length, html };
}
