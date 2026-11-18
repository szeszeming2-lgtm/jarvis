// Planner tab: habits, goals, budget, stopwatch, voice notes, and transcribing or
// summarizing audio and video files.
import { h, iconNode, bus, timeAgo } from '../util.js';
import { registerTab, closeSheet } from './sheets.js';
import { section, toast, dialog, callout } from './common.js';
import { call, can } from '../host.js';
import { settings, set } from '../store.js';
import * as P from '../planner.js';
import * as media from '../media.js';
import * as auto from '../automations.js';

let swRaf = 0;

registerTab('planner', (body) => {
  const draw = () => {
    cancelAnimationFrame(swRaf);
    body.replaceChildren(...[automationsSection(), habitsSection(), goalsSection(), budgetSection(), stopwatchSection(), voiceSection(), mediaSection(), clipboardSection()].filter(Boolean));
  };
  const offs = [bus.on('planner', () => { if (!body.contains(document.activeElement) || document.activeElement === document.body) draw(); }), bus.on('voicenotes', draw), bus.on('automations', draw)];
  media.loadNotes().then(draw);
  draw();
  return () => { cancelAnimationFrame(swRaf); offs.forEach((f) => f()); };
});

// ---------------------------------------------------------------- automations
function automationsSection() {
  const list = h('div', { class: 'list' }, ...auto.all().map((a) => {
    const last = a.history[0];
    return h('div', { class: 'item' + (a.enabled ? ' on' : ''), style: { alignItems: 'flex-start' } },
      h('span', { class: 'item-ic' }, iconNode('clock')),
      h('div', { class: 'item-main' },
        h('div', { class: 'item-title', text: a.name }),
        h('div', { class: 'item-sub', text: `${auto.describe(a.schedule)} · runs “${a.action.text}”` }),
        h('div', { class: 'item-sub', text: a.enabled ? `Next: ${new Date(a.next).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}${last ? ` · last: ${last.ok ? 'ran' : 'didn’t run'} ${timeAgo(last.at)}${last.note ? ` (${last.note})` : ''}` : ''}` : 'Paused' }),
        a.history.length > 1 ? h('details', { class: 'reasoning', style: { marginTop: '6px' } }, h('summary', { text: `History (${a.history.length})` }), h('div', {}, ...a.history.map((x) => h('div', { text: `${new Date(x.at).toLocaleString()} · ${x.ok ? 'ran' : 'didn’t run'}${x.note ? ' · ' + x.note : ''}` })))) : null),
      h('div', { class: 'item-actions' },
        h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Run now', onclick: async () => { closeSheet(); const a2 = await import('../assistant.js'); a2.send(a.action.text); } }),
        h('input', { type: 'checkbox', checked: a.enabled, 'aria-label': `Turn ${a.name} on or off`, onchange: (e) => auto.toggle(a.id, e.target.checked) }),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Delete ${a.name}`, onclick: async () => { if (await dialog({ title: `Delete “${a.name}”?`, okLabel: 'Delete', danger: true })) auto.remove(a.id); } }, iconNode('trash'))));
  }));
  if (!auto.all().length) list.append(h('div', { class: 'empty', text: 'Nothing scheduled. Say “every weekday at 9am start my workday” or “open Spotify every morning at 8”.' }));
  return section('Automations', 'Things JARVIS does on a schedule while it’s open. Actions still follow your Permissions.', list,
    h('button', { class: 'btn btn-sm', type: 'button', style: { marginTop: '8px' }, onclick: async () => {
      const what = await dialog({ title: 'New automation', text: 'Type it the way you’d say it, e.g. “every weekday at 9am open Mail” or “every Friday at 5pm show my goals”.', input: '', okLabel: 'Create' });
      if (!what?.trim()) return;
      const req = auto.parseRequest(what);
      if (!req) return toast('Start with “every day / weekday / Monday… at <time>” and then what to do.', { bad: true, ms: 6000 });
      const r = auto.fromWords(req);
      toast(`Set: ${r.when}`);
    } }, iconNode('plus'), 'New automation'));
}

// ---------------------------------------------------------------- habits
function habitsSection() {
  const list = h('div', { class: 'list' }, ...P.all().habits.map((hb) => {
    const done = !!hb.days[P.dayKey()];
    const st = P.streak(hb);
    return h('div', { class: 'item' + (done ? ' on' : '') },
      h('button', { class: 'habit-check' + (done ? ' done' : ''), type: 'button', 'aria-label': `${done ? 'Untick' : 'Tick'} ${hb.name} for today`, onclick: () => P.checkHabit(hb, !done) }, iconNode('check')),
      h('div', { class: 'item-main' }, h('div', { class: 'item-title', text: hb.name }),
        h('div', { class: 'habit-week' }, ...P.last7(hb).map((d) => h('span', { class: d.done ? 'on' : '', title: d.day, text: d.label })), h('small', { text: st ? ` ${st}-day streak${st >= 3 ? ' 🔥' : ''}` : '' }))),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Delete ${hb.name}`, onclick: async () => { if (await dialog({ title: `Delete the habit “${hb.name}”?`, okLabel: 'Delete', danger: true })) P.removeHabit(hb.id); } }, iconNode('trash')));
  }));
  if (!P.all().habits.length) list.append(h('div', { class: 'empty', text: 'Track something every day: drink water, read, walk. Say “add habit read 20 minutes” or “I did my reading”.' }));
  return section('Habits', 'Tick them off each day and keep your streak going.', list,
    h('button', { class: 'btn btn-sm', type: 'button', style: { marginTop: '8px' }, onclick: async () => { const n = await dialog({ title: 'New habit', text: 'Something you want to do every day', input: '', okLabel: 'Add' }); if (n?.trim()) P.addHabit(n); } }, iconNode('plus'), 'Add a habit'));
}

// ---------------------------------------------------------------- goals
function goalsSection() {
  const list = h('div', { class: 'list' }, ...P.all().goals.map((g) => {
    const pct = P.goalPct(g);
    return h('div', { class: 'item' + (pct >= 100 ? ' on' : ''), style: { alignItems: 'flex-start' } },
      h('span', { class: 'item-ic' }, iconNode(pct >= 100 ? 'check' : 'target')),
      h('div', { class: 'item-main' },
        h('div', { class: 'item-title', text: g.title }),
        h('div', { class: 'item-sub', text: g.target ? `${g.progress} of ${g.target}${g.unit ? ' ' + g.unit : ''} · ${pct}%` : `${pct}%` }),
        h('div', { class: 'progress' }, h('i', { style: { width: pct + '%' } }))),
      h('div', { class: 'item-actions' },
        h('button', { class: 'btn btn-sm', type: 'button', text: g.target ? `+1${g.unit ? ' ' + g.unit : ''}` : '+10%', onclick: () => P.updateGoal(g, g.target ? 1 : 10) }),
        h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Set', onclick: async () => { const v = await dialog({ title: `Progress on “${g.title}”`, text: g.target ? `How many ${g.unit || ''} so far (of ${g.target})?` : 'Percent done (0–100)', input: String(g.progress), okLabel: 'Save' }); if (v != null && v !== '') P.updateGoal(g, Number(v), { set: true }); } }),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Delete ${g.title}`, onclick: () => P.removeGoal(g.id) }, iconNode('trash'))));
  }));
  if (!P.all().goals.length) list.append(h('div', { class: 'empty', text: 'Set a goal: “read 12 books”, “save 500 dollars”, “run 100 km”. Say “new goal read 12 books”.' }));
  return section('Goals', '', list, h('button', { class: 'btn btn-sm', type: 'button', style: { marginTop: '8px' }, onclick: async () => {
    const title = await dialog({ title: 'New goal', text: 'What do you want to achieve? Add a number to track it, e.g. “Read 12 books”.', input: '', okLabel: 'Add' });
    if (!title?.trim()) return;
    const m = title.match(/(\d+(?:\.\d+)?)\s*([\p{L}%$€£]+)?/u);
    P.addGoal({ title, target: m ? +m[1] : 0, unit: m?.[2] || '' });
  } }, iconNode('plus'), 'Add a goal'));
}

// ---------------------------------------------------------------- budget
function budgetSection() {
  const s = P.monthSummary();
  const top = Math.max(1, ...s.byCategory.map(([, v]) => v));
  const recent = [...P.all().money].sort((a, b) => b.date - a.date).slice(0, 8);
  const add = async (kind) => {
    const v = await dialog({ title: kind === 'income' ? 'Money in' : 'Money spent', text: 'Amount and what it was, e.g. “12.50 lunch”', input: '', okLabel: 'Add' });
    if (!v?.trim()) return;
    const m = v.match(/(\d+(?:[.,]\d+)?)/);
    if (!m) return toast('Include an amount, like 12.50.', { bad: true });
    try { P.logMoney({ amount: m[1], note: v.replace(m[0], '').replace(/^\s*(?:on|for)\s+/i, '').trim(), kind }); } catch (e) { toast(e.message, { bad: true }); }
  };
  return section('Budget', `This month: ${s.count} entr${s.count === 1 ? 'y' : 'ies'}. Say “I spent 12 on lunch”.`,
    h('div', { class: 'stat-row money' },
      h('div', { class: 'stat' }, h('small', { text: 'Spent' }), h('b', { text: P.money(s.spent) })),
      h('div', { class: 'stat' }, h('small', { text: 'Money in' }), h('b', { text: P.money(s.income) })),
      h('div', { class: 'stat' + (s.over ? ' bad' : '') }, h('small', { text: s.budget ? 'Left of budget' : 'Monthly budget' }), h('b', { text: s.budget ? P.money(s.left) : 'Not set' }))),
    s.byCategory.length ? h('div', { class: 'cat-bars' }, ...s.byCategory.map(([k, v]) => h('div', { class: 'cat-bar' }, h('span', { text: k }), h('div', { class: 'progress' }, h('i', { style: { width: Math.round((v / top) * 100) + '%' } })), h('b', { text: P.money(v) })))) : null,
    recent.length ? h('div', { class: 'list', style: { marginTop: '8px' } }, ...recent.map((e) => h('div', { class: 'item' },
      h('span', { class: 'item-ic' }, iconNode(e.kind === 'income' ? 'download' : 'upload')),
      h('div', { class: 'item-main' }, h('div', { class: 'item-title', text: `${e.kind === 'income' ? '+' : '−'}${P.money(e.amount)} ${e.note}` }), h('div', { class: 'item-sub', text: `${e.category} · ${timeAgo(e.date)}` })),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Delete entry', onclick: () => P.removeMoney(e.id) }, iconNode('x'))))) : null,
    h('div', { class: 'flex', style: { marginTop: '8px' } },
      h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => add('expense') }, iconNode('plus'), 'Money spent'),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => add('income') }, iconNode('plus'), 'Money in'),
      h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: async () => { const v = await dialog({ title: 'Monthly budget', text: 'How much can you spend each month? (0 = no budget)', input: String(P.all().budget.monthly || ''), okLabel: 'Save' }); if (v != null) P.setMonthlyBudget(v); } }, 'Set budget')));
}

// ---------------------------------------------------------------- stopwatch
function stopwatchSection() {
  const time = h('div', { class: 'sw-time', 'aria-live': 'off' });
  const laps = h('ol', { class: 'sw-laps' });
  const tick = () => {
    const s = P.stopwatch();
    time.textContent = P.fmtMs(s.ms);
    if (s.running) swRaf = requestAnimationFrame(tick);
  };
  const drawLaps = () => { const L = P.stopwatch().laps; laps.replaceChildren(...L.map((ms, i) => h('li', {}, `Lap ${i + 1}`, h('b', { text: P.fmtMs(ms - (L[i - 1] || 0)) }), h('small', { text: P.fmtMs(ms) })))); };
  const s = P.stopwatch();
  const startStop = h('button', { class: 'btn btn-primary', type: 'button', text: s.running ? 'Stop' : 'Start', onclick: () => { const r = P.stopwatch().running ? P.stopStopwatch() : P.startStopwatch(); startStop.textContent = r.running ? 'Stop' : 'Start'; cancelAnimationFrame(swRaf); tick(); } });
  tick(); drawLaps();
  return section('Stopwatch', 'Keeps running even if you close JARVIS. Say “start the stopwatch”.', time,
    h('div', { class: 'flex' }, startStop, h('button', { class: 'btn', type: 'button', text: 'Lap', onclick: () => { P.lap(); drawLaps(); } }), h('button', { class: 'btn btn-ghost', type: 'button', text: 'Reset', onclick: () => { P.resetStopwatch(); startStop.textContent = 'Start'; tick(); drawLaps(); } })), laps);
}

// ---------------------------------------------------------------- voice notes
async function askWhisper() {
  if ((await import('../host.js')).isNative) return true; // the Mac app uses macOS's own speech recognition
  if (media.whisperReady() || (await media.whisperDownloaded())) return true;
  return dialog({ title: 'Download speech-to-text?', text: `To turn speech into text on this device, JARVIS needs Whisper (free, about ${media.WHISPER_MB} MB, downloaded once). It understands about 100 languages and works offline afterwards.`, okLabel: 'Download' });
}

function voiceSection() {
  const status = h('div', { class: 'muted', style: { fontSize: '12.5px' } });
  let rec = null, timer = 0;
  const btn = h('button', { class: 'btn btn-primary', type: 'button' }, iconNode('mic'), 'Record a voice note');
  const meter = h('div', { class: 'progress', style: { width: '160px', display: 'none' } }, h('i'));
  btn.addEventListener('click', async () => {
    if (rec) {
      clearInterval(timer);
      const n = await rec.stop(); rec = null;
      btn.replaceChildren(iconNode('mic'), 'Record a voice note'); meter.style.display = 'none';
      status.textContent = `Saved (${n.seconds} s).`;
      return;
    }
    try {
      rec = await media.record();
      btn.replaceChildren(iconNode('stop'), 'Stop and save'); meter.style.display = '';
      timer = setInterval(() => { meter.firstChild.style.width = Math.round(rec.level() * 100) + '%'; status.textContent = `Recording… ${Math.round((Date.now() - rec.started) / 1000)} s`; if (Date.now() - rec.started > 10 * 60000) btn.click(); }, 120);
    } catch (e) { toast(/NotAllowed|denied/i.test(e.name + e.message) ? 'Microphone access is blocked. Allow it for JARVIS and try again.' : e.message, { bad: true }); }
  });
  const list = h('div', { class: 'list' }, ...media.allNotes().map((n) => {
    const audio = h('audio', { controls: true, preload: 'none', style: { width: '100%', height: '34px', marginTop: '6px' } });
    media.getBlob(n.id).then((b) => { if (b) audio.src = URL.createObjectURL(b); }).catch(() => {});
    const text = h('div', { class: 'item-sub selectable', style: { whiteSpace: 'pre-wrap' }, text: n.text || '' });
    const tr = async () => {
      if (!(await askWhisper())) return;
      try {
        text.textContent = 'Transcribing…';
        const b = await media.getBlob(n.id);
        const r = await media.transcribe(b, { onProgress: (p) => { text.textContent = `${p.text} ${Math.round(p.progress * 100)}%`; } });
        media.setNoteText(n.id, r.text || '(no speech found)');
      } catch (e) { text.textContent = ''; toast(e.message, { bad: true }); }
    };
    return h('div', { class: 'item', style: { alignItems: 'flex-start' } },
      h('span', { class: 'item-ic' }, iconNode('mic')),
      h('div', { class: 'item-main' }, h('div', { class: 'item-title', text: n.title }), h('div', { class: 'item-sub', text: `${n.seconds} s · ${timeAgo(n.created)}` }), audio, text,
        h('div', { class: 'flex', style: { marginTop: '6px' } },
          n.text ? null : h('button', { class: 'btn btn-sm', type: 'button', onclick: tr }, iconNode('note'), 'Turn into text'),
          n.text ? h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Save to my notes', onclick: async () => { const l = await import('../lists.js'); l.add('notes', [n.text.slice(0, 500)]); toast('Added to your notes list'); } }) : null,
          n.text ? h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Ask about it', onclick: async () => { closeSheet(); const a = await import('../assistant.js'); a.send('Summarize this voice note and list any to-dos in it.', { attachment: { name: n.title, path: n.title, text: n.text } }); } }) : null)),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Delete ${n.title}`, onclick: async () => { if (await dialog({ title: 'Delete this voice note?', okLabel: 'Delete', danger: true })) media.removeNote(n.id); } }, iconNode('trash')));
  }));
  if (!media.allNotes().length) list.append(h('div', { class: 'empty', text: 'No voice notes yet. Recordings stay on this device.' }));
  return section('Voice notes', 'Record a thought, then turn it into text (on this device, in about 100 languages).', h('div', { class: 'flex' }, btn, meter), status, list);
}

// ---------------------------------------------------------------- audio & video files
function mediaSection() {
  const out = h('div', { class: 'muted', style: { fontSize: '12.5px', marginTop: '6px' } });
  const pick = (accept) => new Promise((res) => { const i = h('input', { type: 'file', accept, style: { display: 'none' } }); i.onchange = () => { res(i.files?.[0] || null); i.remove(); }; document.body.append(i); i.click(); });
  const transcribeFile = async (translate) => {
    const f = await pick('audio/*,video/*');
    if (!f || !(await askWhisper())) return;
    try {
      out.textContent = 'Working…';
      const r = await media.transcribe(f, { translate, onProgress: (p) => { out.textContent = `${p.text} ${Math.round(p.progress * 100)}%`; } });
      out.textContent = '';
      closeSheet();
      const a = await import('../assistant.js');
      a.say(`${translate ? 'Translate' : 'Transcribe'} ${f.name}`, `**${translate ? 'English translation' : 'Transcript'} of ${f.name}** (${Math.round(r.seconds / 60)} min ${r.seconds % 60} s):\n\n${r.text || '(no speech found)'}`);
    } catch (e) { out.textContent = ''; toast(e.message, { bad: true }); }
  };
  const summarizeVideo = async () => {
    const f = await pick('video/*');
    if (!f) return;
    try {
      out.textContent = 'Looking at the video…';
      const { frames, duration } = await media.videoFrames(f, 4);
      let transcript = '';
      if (await askWhisper()) {
        try { transcript = (await media.transcribe(f, { onProgress: (p) => { out.textContent = `${p.text} ${Math.round(p.progress * 100)}%`; } })).text; } catch { transcript = ''; }
      }
      out.textContent = 'Describing key moments…';
      const descs = [];
      const ollama = await import('../ollama.js');
      const vision = await import('../vision.js');
      const ollamaSees = !ollama.isPhone() && ollama.engine.status === 'online' && ollama.visionModel();
      if (ollamaSees || vision.ready() || vision.downloaded()) {
        for (const fr of frames) {
          try {
            descs.push(`[${Math.floor(fr.t / 60)}:${String(fr.t % 60).padStart(2, '0')}] ${ollamaSees ? await describeWithOllama(ollama, fr.data) : await vision.ask(fr.data, 'Describe this video frame in one sentence.')}`);
            out.textContent = `Describing key moments… ${descs.length}/${frames.length}`;
          } catch {}
        }
      }
      out.textContent = '';
      if (!transcript && !descs.length) throw new Error('I couldn’t get any sound or pictures from that video. Download speech-to-text or the picture AI and try again.');
      closeSheet();
      const a = await import('../assistant.js');
      a.send(`Summarize the video “${f.name}” (${Math.round(duration / 60)} min): what happens, the main points, and anything to remember.`, { attachment: { name: f.name, path: f.name, text: `${descs.length ? `What the video shows at moments:\n${descs.join('\n')}\n\n` : ''}${transcript ? `What is said (transcript):\n${transcript}` : '(No speech in the video.)'}`.slice(0, 24000) } });
    } catch (e) { out.textContent = ''; toast(e.message, { bad: true }); }
  };
  return section('Audio and video files', 'Turn recordings into text, translate them into English, or get a summary of a video. Runs on this device.',
    h('div', { class: 'flex' },
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => transcribeFile(false) }, iconNode('note'), 'Transcribe a file'),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => transcribeFile(true) }, iconNode('language'), 'Translate speech to English'),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: summarizeVideo }, iconNode('display'), 'Summarize a video')),
    out);
}

// ---------------------------------------------------------------- clipboard history (Mac app)
function clipboardSection() {
  if (!can('clipboardHistory')) return null;
  const list = h('div', { class: 'list' });
  const load = async () => {
    if (!settings.clipboardHistory) { list.replaceChildren(h('div', { class: 'empty', text: 'Off. Turn it on to see the last 25 things you copied.' })); return; }
    const r = await call('clipboard.history', {}).catch(() => ({ items: [] }));
    list.replaceChildren(...(r.items || []).map((c) => h('div', { class: 'item' }, h('span', { class: 'item-ic' }, iconNode('copy')),
      h('div', { class: 'item-main' }, h('div', { class: 'item-title', style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, text: c.text.replace(/\s+/g, ' ').slice(0, 140) }), h('div', { class: 'item-sub', text: timeAgo(c.at) })),
      h('div', { class: 'item-actions' },
        h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Copy', onclick: () => call('clipboard.write', { text: c.text }).then(() => toast('Copied')) }),
        h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Ask', onclick: async () => { closeSheet(); (await import('../assistant.js')).send('Explain or summarize this text I copied.', { attachment: { name: 'Copied text', path: 'clipboard', text: c.text } }); } })))));
    if (!r.items?.length) list.append(h('div', { class: 'empty', text: 'Copy something and it shows up here.' }));
  };
  load();
  return section('Clipboard history', 'Kept in memory only (never saved to disk) and cleared when JARVIS quits. Passwords copied from password managers are skipped.',
    h('div', { class: 'flex', style: { marginBottom: '8px' } }, h('label', { class: 'flex' }, h('input', { type: 'checkbox', checked: !!settings.clipboardHistory, onchange: async (e) => { set('clipboardHistory', e.target.checked); await call('clipboard.setHistory', { on: e.target.checked }); load(); } }), 'Remember what I copy'),
      h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Refresh', onclick: load })), list);
}

async function describeWithOllama(ollama, data) {
  let out = '';
  const req = ollama.chat({ model: ollama.visionModel(), messages: [{ role: 'user', content: 'Describe this video frame in one sentence.', images: [data] }] }, { onContent: (d) => { out += d; } });
  await req.promise;
  return out.trim();
}
