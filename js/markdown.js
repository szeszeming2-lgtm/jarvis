// Minimal, safe Markdown renderer. All text is HTML-escaped before any markup is
// added, and links are limited to http(s) and mailto, so model output can never
// inject buttons, scripts or styles into the interface.

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Small models love LaTeX; turn simple $...$ maths into readable text. */
export function plainMath(s) {
  return s.replace(/\$\$?([^$\n]{1,200}?)\$\$?/g, (all, m) => {
    // Only real maths: LaTeX commands/superscripts, or pure numbers with operators (not prices like "$5 and $10").
    if (!/\\[a-zA-Z]|\^|_\{/.test(m) && !/^[\d\s.,+\-*/=()]+$/.test(m)) return all;
    if (!/\\[a-zA-Z]|\^|_\{/.test(m) && !/\d\s*[+\-*/=]\s*\d/.test(m)) return all;
    let t = m;
    for (let i = 0; i < 3; i++) t = t.replace(/\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}/g, '($1)/($2)').replace(/\\sqrt\{([^{}]*)\}/g, '√($1)').replace(/\\(?:text|mathrm|mathbf|operatorname)\{([^{}]*)\}/g, '$1');
    const map = { times: '×', cdot: '·', div: '÷', pi: 'π', approx: '≈', leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', pm: '±', infty: '∞', degree: '°', circ: '°', theta: 'θ', alpha: 'α', beta: 'β', Delta: 'Δ', sum: 'Σ', left: '', right: '', quad: ' ', ',': ' ', '%': '%' };
    t = t.replace(/\\([a-zA-Z]+|[,%])/g, (x, k) => (k in map ? map[k] : x));
    t = t.replace(/\^\{([^{}]*)\}/g, '^$1').replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
    return t;
  });
}

function inline(s) {
  // s is raw text; escape, then apply inline rules on placeholders.
  const codes = [];
  s = s.replace(/`([^`\n]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = plainMath(s);
  s = esc(s);
  const links = [];
  const keep = (html) => { links.push(html); return `\u0001${links.length - 1}\u0001`; };
  s = s.replace(/\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g, (_, t, u) => keep(`<a data-href="${u}" title="${u}">${t}</a>`));
  s = s.replace(/(^|[\s(])((?:https?:\/\/)[^\s<)]+[^\s<).,;:!?'"])/g, (_, p, u) => p + keep(`<a data-href="${u}" title="${u}">${u}</a>`));
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>').replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  s = s.replace(/\u0001(\d+)\u0001/g, (_, i) => links[+i]);
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[+i])}</code>`);
  return s;
}

export function render(md) {
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  let para = [];
  const flush = () => { if (para.length) { out.push(`<p>${inline(para.join('\n')).replace(/\n/g, '<br>')}</p>`); para = []; } };

  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^\s*```\s*([\w+-]*)\s*$/);
    if (fence) {
      flush();
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><button class="copy-code" type="button">Copy</button><code data-lang="${esc(fence[1] || '')}">${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }
    const hd = line.match(/^(#{1,4})\s+(.+)$/);
    if (hd) { flush(); out.push(`<h${hd[1].length}>${inline(hd[2])}</h${hd[1].length}>`); i++; continue; }
    if (/^\s*([-*_])\s*\1\s*\1[\s\1]*$/.test(line)) { flush(); out.push('<hr>'); i++; continue; }
    if (/^\s*>/.test(line)) {
      flush();
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${render(buf.join('\n'))}</blockquote>`);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      flush();
      const row = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = row(line);
      i += 2;
      const body = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) body.push(row(lines[i++]));
      out.push(`<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    const li = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (li) {
      flush();
      const ordered = /\d/.test(li[2]);
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
        if (m) { items.push({ indent: m[1].length, text: m[3] }); i++; continue; }
        if (/^\s{2,}\S/.test(lines[i]) && items.length) { items[items.length - 1].text += '\n' + lines[i].trim(); i++; continue; }
        break;
      }
      const base = items[0].indent;
      const html = items.map((it) => {
        const nested = it.indent > base + 1;
        const t = it.text.replace(/^\[( |x)\]\s+/i, (_, c) => (c.trim() ? '☑ ' : '☐ '));
        return `<li${nested ? ' style="margin-left:1.2em"' : ''}>${inline(t).replace(/\n/g, '<br>')}</li>`;
      }).join('');
      out.push(ordered ? `<ol>${html}</ol>` : `<ul>${html}</ul>`);
      continue;
    }
    if (!line.trim()) { flush(); i++; continue; }
    para.push(line);
    i++;
  }
  flush();
  return out.join('');
}

/** Plain text suitable for speaking aloud. */
export function toSpeech(md) {
  return plainMath(String(md || ''))
    .replace(/×/g, ' times ').replace(/÷/g, ' divided by ').replace(/≈/g, ' about ')
    .replace(/```[\s\S]*?(```|$)/g, ' I have put the code on screen. ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'the link on screen')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\|.*\|\s*$/gm, '')
    .replace(/[*_~>#|]/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}
