// Read documents into plain text, on this device: PDF (pdf.js), Word .docx and
// Excel .xlsx (they're zip files of XML, read with a tiny built-in unzipper),
// plus text, Markdown, CSV, JSON and HTML. The Mac app reads PDF and Word natively.
import { call, isNative } from './host.js';

const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
export const MAX = 200000;

const ext = (name) => (String(name || '').match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/** f: what file.open returned ({name, text} / {name, file} / {name, path, base64}). → text */
export async function readAnyFile(f) {
  const e = ext(f.name);
  if (isNative && f.path && ['pdf', 'docx', 'doc', 'rtf', 'odt', 'html', 'htm', 'txt', 'md'].includes(e)) {
    try { const r = await call('tool.read_document', { path: f.path }); if (r?.text) return r.text.slice(0, MAX); } catch {}
  }
  const bytes = f.file ? new Uint8Array(await f.file.arrayBuffer()) : f.base64 ? b64ToBytes(f.base64) : null;
  if (bytes && e === 'pdf') return readPdf(bytes);
  if (bytes && e === 'docx') return readDocx(bytes);
  if (bytes && (e === 'xlsx' || e === 'xlsm')) return readXlsx(bytes);
  if (f.text != null && !/^%PDF|^PK\u0003\u0004/.test(f.text)) return htmlOrText(f.text, e);
  if (bytes) return htmlOrText(new TextDecoder().decode(bytes), e);
  throw new Error('That file couldn’t be read.');
}

function htmlOrText(t, e) {
  if (e === 'html' || e === 'htm') { const d = new DOMParser().parseFromString(t, 'text/html'); d.querySelectorAll('script,style').forEach((n) => n.remove()); return (d.body?.innerText || d.body?.textContent || '').slice(0, MAX); }
  return String(t).slice(0, MAX);
}

// ---------------------------------------------------------------- PDF
export async function readPdf(bytes) {
  const pdfjs = await import(/* @vite-ignore */ PDFJS);
  // A cross-site worker isn't allowed, so pdf.js falls back to reading on the page itself.
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, useWorkerFetch: false }).promise;
  const out = [];
  let total = 0;
  for (let i = 1; i <= doc.numPages && total < MAX; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    let line = '', lastY = null;
    const rows = [];
    for (const it of tc.items) {
      const y = it.transform?.[5];
      if (lastY != null && Math.abs(y - lastY) > 2) { rows.push(line); line = ''; }
      line += it.str + (it.hasEOL ? '\n' : '');
      lastY = y;
    }
    rows.push(line);
    const text = rows.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    out.push(text);
    total += text.length;
  }
  if (!out.join('').trim()) throw new Error('That PDF has no text layer (it’s probably a scan). Take a photo of a page and use Circle to Ask instead.');
  return out.join('\n\n').slice(0, MAX);
}

// ---------------------------------------------------------------- zip (docx/xlsx)
/** Tiny zip reader: {path: Uint8Array} for the entries you ask for. */
export async function unzip(bytes, want = () => true) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('That file isn’t a valid Office document.');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = {};
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), local = dv.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (!want(name)) continue;
    const lnlen = dv.getUint16(local + 26, true), lxlen = dv.getUint16(local + 28, true);
    const data = bytes.subarray(local + 30 + lnlen + lxlen, local + 30 + lnlen + lxlen + csize);
    if (method === 0) out[name] = data;
    else if (method === 8) out[name] = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
  }
  return out;
}

const xml = (u8) => new DOMParser().parseFromString(new TextDecoder().decode(u8), 'application/xml');

export async function readDocx(bytes) {
  const z = await unzip(bytes, (n) => n === 'word/document.xml');
  if (!z['word/document.xml']) throw new Error('That Word file has no text.');
  const doc = xml(z['word/document.xml']);
  const paras = [];
  for (const p of doc.getElementsByTagName('w:p')) {
    let t = '';
    for (const n of p.getElementsByTagName('*')) {
      if (n.tagName === 'w:t') t += n.textContent;
      else if (n.tagName === 'w:tab') t += '\t';
      else if (n.tagName === 'w:br') t += '\n';
    }
    const style = p.getElementsByTagName('w:pStyle')[0]?.getAttribute('w:val') || '';
    const heading = style.match(/^Heading(\d)/i);
    paras.push(heading && t ? '#'.repeat(Math.min(3, +heading[1])) + ' ' + t : t);
  }
  return paras.join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX);
}

/** Every sheet as rows of tab-separated cells. */
export async function readXlsx(bytes) {
  const z = await unzip(bytes, (n) => n === 'xl/sharedStrings.xml' || n === 'xl/workbook.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const strings = z['xl/sharedStrings.xml'] ? [...xml(z['xl/sharedStrings.xml']).getElementsByTagName('si')].map((si) => [...si.getElementsByTagName('t')].map((t) => t.textContent).join('')) : [];
  const names = z['xl/workbook.xml'] ? [...xml(z['xl/workbook.xml']).getElementsByTagName('sheet')].map((s) => s.getAttribute('name')) : [];
  const sheets = Object.keys(z).filter((n) => /sheet\d+\.xml$/.test(n)).sort((a, b) => +a.match(/(\d+)\.xml/)[1] - +b.match(/(\d+)\.xml/)[1]);
  const col = (ref) => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  const out = [];
  sheets.forEach((s, i) => {
    const rows = [];
    for (const row of xml(z[s]).getElementsByTagName('row')) {
      const cells = [];
      for (const c of row.getElementsByTagName('c')) {
        const v = c.getElementsByTagName('v')[0]?.textContent ?? c.getElementsByTagName('t')[0]?.textContent ?? '';
        const val = c.getAttribute('t') === 's' ? strings[+v] ?? '' : v;
        cells[col(c.getAttribute('r') || 'A1')] = val;
      }
      if (cells.some((x) => x !== undefined && x !== '')) rows.push(Array.from(cells, (x) => x ?? '').join('\t'));
    }
    out.push(`## ${names[i] || 'Sheet ' + (i + 1)}\n${rows.join('\n')}`);
  });
  return out.join('\n\n').slice(0, MAX);
}
