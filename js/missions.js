// Mission Control: give JARVIS several big objectives. For each one a Planner agent
// writes a task list; you approve it (checkpoint 1); specialist agents then work through
// the tasks; anything that would change your device (a document, a reminder, a list…)
// waits for your OK (checkpoint 2); an Editor writes the final report of what got done
// and what didn't. Everything runs on your own AI, one task at a time (your computer
// runs one AI model at once), and survives closing JARVIS (it resumes where it stopped).
import { read, write } from './store.js';
import { bus, uid } from './util.js';

export const AGENTS = {
  Planner: { icon: 'list', job: 'breaks objectives into tasks' },
  Researcher: { icon: 'search', job: 'finds facts with sources' },
  Writer: { icon: 'edit', job: 'writes clear text' },
  Analyst: { icon: 'calculator', job: 'compares, calculates and recommends' },
  Coder: { icon: 'code', job: 'writes working code' },
  Organizer: { icon: 'folder', job: 'creates documents, lists, reminders and project tasks (with your OK)' },
  Editor: { icon: 'check', job: 'checks the work and writes the final report' },
};
// What agents may propose doing on the device (always needs your approval first).
export const ACTIONS = ['create_document', 'add_to_list', 'set_reminder', 'create_project', 'add_project_task', 'save_link', 'add_goal', 'add_habit'];

let missions = [];
let running = false, stopNow = false, current = null;
export async function load() {
  missions = await read('missions', []);
  // A task that was running when JARVIS closed starts again (checkpoint).
  for (const m of missions) { for (const t of m.tasks || []) if (t.status === 'running') t.status = 'todo'; if (m.status === 'running') m.status = 'paused'; }
  return missions;
}
const save = () => { write('missions', missions).catch(console.error); bus.emit('missions', missions); };
export const all = () => missions;
const log = (m, text) => { m.log.unshift({ at: Date.now(), text }); m.log = m.log.slice(0, 60); };

export function progress(m) {
  const tasks = m.tasks || [];
  const done = tasks.filter((t) => t.status === 'done' || t.status === 'skipped').length;
  return { done, total: tasks.length, pct: tasks.length ? Math.round((done / tasks.length) * 100) : 0 };
}

/** Add 1–10 objectives (one per line). Planning starts right away. */
export function add(text) {
  const goals = String(text || '').split(/\n|;/).map((s) => s.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '').trim()).filter((s) => s.length > 3).slice(0, 10);
  if (!goals.length) throw new Error('Write at least one objective, like “Plan a 3-day trip to Rome”.');
  const made = goals.map((goal) => ({ id: uid('ms'), goal, status: 'planning', created: Date.now(), tasks: [], log: [], report: '' }));
  missions.unshift(...made);
  save();
  kick();
  return made;
}

/** Turn the Planner's answer into tasks. "Researcher: find …" lines; unknown agents become Writer. */
export function parsePlan(text) {
  const out = [];
  const known = (w) => Object.keys(AGENTS).find((a) => a.toLowerCase() === String(w || '').toLowerCase());
  for (const raw of String(text || '').split('\n')) {
    // Models write the same thing many ways: "1. Researcher: …", "Agent: Researcher: …", "Task 2 (Writer): …", "[Coder] …".
    let line = raw.replace(/\*\*/g, '').replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '').trim();
    for (let i = 0; i < 3; i++) line = line.replace(/^(?:agent|task|step)\s*\d*\s*[:.)\-–—]\s*/i, '').trim();
    let m = line.match(/^\[?([A-Za-z]+)\]?\s*[:—–-]\s*(.{4,240})$/) || line.match(/^\[([A-Za-z]+)\]\s*(.{4,240})$/);
    const paren = !m && line.match(/^(?:task\s*\d*\s*)?\(([A-Za-z]+)\)\s*[:—–-]?\s*(.{4,240})$/i);
    if (paren) m = paren;
    if (!m) continue;
    if (!known(m[1]) && /^[A-Za-z]+\s*:/.test(m[2])) { const inner = m[2].match(/^([A-Za-z]+)\s*:\s*(.{4,240})$/); if (inner && known(inner[1])) m = inner; }
    const agent = known(m[1]) || 'Writer';
    if (agent === 'Planner' || agent === 'Editor') continue;
    out.push({ id: uid('tk'), agent, title: m[2].trim(), status: 'todo', output: '' });
  }
  return out.slice(0, 8);
}

/** "ACTION: {"tool":"add_to_list","args":{…}}" at the end of an agent's answer → {tool, args} or null. */
export function parseAction(text) {
  // Accepts ACTION: {"tool":…,"args":{…}}  ·  ACTION: create_document {…}  ·  ACTION: create_document({…})
  const m = String(text || '').match(/ACTION:\s*`*\s*([a-z_]+)?\s*\(?\s*(\{[\s\S]*\})\s*\)?\s*`*\s*$/i);
  if (!m) return null;
  try {
    const j = JSON.parse(m[2]);
    const a = m[1] ? { tool: m[1].toLowerCase(), args: j.args && typeof j.args === 'object' && !j.title && !j.list ? j.args : j } : j;
    return ACTIONS.includes(a.tool) && a.args && typeof a.args === 'object' ? { tool: a.tool, args: a.args } : null;
  } catch { return null; }
}
export const ACTION_RE = /ACTION:\s*`*\s*([a-z_]+)?\s*\(?\s*\{[\s\S]*\}\s*\)?\s*`*\s*$/i;

export function approvePlan(id) { const m = missions.find((x) => x.id === id); if (m && m.status === 'awaiting-approval') { m.status = 'queued'; log(m, 'You approved the plan.'); save(); kick(); } }
export function editTask(id, taskId, title) { const m = missions.find((x) => x.id === id); const t = m?.tasks.find((x) => x.id === taskId); if (t && t.status === 'todo') { t.title = String(title).slice(0, 240); save(); } }
export function removeTask(id, taskId) { const m = missions.find((x) => x.id === id); if (m) { m.tasks = m.tasks.filter((t) => t.id !== taskId || t.status === 'done'); save(); } }
export function addTask(id, agent, title) { const m = missions.find((x) => x.id === id); if (m) { m.tasks.push({ id: uid('tk'), agent: AGENTS[agent] ? agent : 'Writer', title, status: 'todo', output: '' }); if (m.status === 'done') m.status = 'queued'; save(); kick(); } }
export function pause(id) { const m = missions.find((x) => x.id === id); if (m && ['queued', 'running'].includes(m.status)) { m.status = 'paused'; log(m, 'Paused.'); if (current?.mission === m) stopNow = true; save(); } }
export function resume(id) { const m = missions.find((x) => x.id === id); if (m && ['paused', 'failed', 'stopped'].includes(m.status)) { m.status = m.tasks.length ? 'queued' : 'planning'; for (const t of m.tasks) if (t.status === 'failed') t.status = 'todo'; log(m, 'Resumed.'); save(); kick(); } }
export function stop(id) { const m = missions.find((x) => x.id === id); if (m) { m.status = 'stopped'; log(m, 'Stopped by you.'); if (current?.mission === m) stopNow = true; save(); } }
export function remove(id) { stop(id); missions = missions.filter((x) => x.id !== id); save(); }
export function pauseAll() { for (const m of missions) pause(m.id); }

/** Checkpoint 2: an agent wants to change something on the device. */
export async function decideAction(id, taskId, approve) {
  const m = missions.find((x) => x.id === id), t = m?.tasks.find((x) => x.id === taskId);
  if (!t?.action || t.status !== 'needs-approval') return;
  if (approve) {
    const tools = await import('./tools.js');
    const res = await tools.execute(t.action.tool, cleanArgs(t.action.tool, t.action.args), { confirm: async () => 'once', source: 'mission' });
    t.actionResult = res.ok ? tools.summary(t.action.tool, res, t.action.args) : `Didn’t work: ${res.error}`;
    log(m, `${t.agent}: ${t.actionResult}`);
  } else { t.actionResult = 'You said no, so nothing was changed.'; log(m, `${t.agent}: action declined.`); }
  t.status = 'done'; t.doneAt = Date.now();
  if (m.status === 'waiting') m.status = 'queued';
  save(); kick();
}

// ---------------------------------------------------------------- the worker
/** Pick the next piece of work across all missions (round-robin by age). */
function nextWork() {
  for (const m of [...missions].reverse()) {
    if (m.status === 'planning') return { mission: m, kind: 'plan' };
    if (m.status !== 'queued') continue;
    const t = m.tasks.find((x) => x.status === 'todo');
    if (t) return { mission: m, kind: 'task', task: t };
    if (m.tasks.some((x) => x.status === 'needs-approval')) { m.status = 'waiting'; save(); continue; }
    return { mission: m, kind: 'report' };
  }
  return null;
}

export function kick() { if (!running) run().catch(console.error); }

async function run() {
  running = true;
  try {
    const { complete } = await import('./research.js');
    const ollama = await import('./ollama.js');
    for (let w = nextWork(); w; w = nextWork()) {
      if (ollama.engine.status !== 'online') await ollama.detect();
      const m = w.mission;
      if (ollama.engine.status !== 'online' || !(await import('./store.js')).settings.ai.model) { m.status = 'paused'; log(m, 'Paused: the AI isn’t ready. Get a model in AI Models, then press Resume.'); save(); continue; }
      current = w; stopNow = false;
      try {
        if (w.kind === 'plan') {
          log(m, 'Planner is breaking the objective into tasks…'); save();
          const text = await complete(`You are the PLANNER in Mission Control. Break the user's objective into 3 to 7 concrete tasks that together achieve it. One task per line, written as "Agent: task". Agents: Researcher (finds facts), Writer (writes text), Analyst (compares, calculates, recommends), Coder (writes code), Organizer (creates documents, lists, reminders or project tasks on the user's device). Put an Organizer task last only if saving something would help. No other text.`, `Objective: ${m.goal}`);
          if (stopNow) continue;
          m.tasks = parsePlan(text);
          if (!m.tasks.length) m.tasks = [{ id: uid('tk'), agent: 'Writer', title: m.goal, status: 'todo', output: '' }];
          m.status = 'awaiting-approval';
          log(m, `Plan ready: ${m.tasks.length} tasks. Waiting for your approval.`);
          save();
        } else if (w.kind === 'task') {
          const t = w.task;
          t.status = 'running'; t.startedAt = Date.now(); m.status = 'running';
          log(m, `${t.agent} started: ${t.title}`); save();
          const before = m.tasks.filter((x) => x.status === 'done' && x.output).map((x) => `[${x.agent}] ${x.title}\n${x.output.slice(0, 1500)}`).join('\n\n');
          let out;
          if (t.agent === 'Researcher') {
            const R = await import('./research.js');
            try { out = (await R.research(t.title, { onStep: (s) => { t.step = s.text; bus.emit('missions', missions); } })).report; }
            catch { out = await complete(agentSystem(t.agent, m.goal), `Task: ${t.title}${before ? `\n\nWork done so far:\n${before}` : ''}\n\n(Web sources weren’t reachable: answer from what you know and say it may need checking.)`); }
          } else {
            out = await complete(agentSystem(t.agent, m.goal), `Task: ${t.title}${before ? `\n\nWork done so far by the team:\n${before}` : ''}`);
          }
          if (stopNow) { t.status = 'todo'; continue; }
          t.action = parseAction(out);
          t.output = unfence(out.replace(ACTION_RE, '').trim());
          t.step = '';
          if (t.action) { t.status = 'needs-approval'; log(m, `${t.agent} wants to ${t.action.tool.replace(/_/g, ' ')}: waiting for your OK.`); }
          else { t.status = 'done'; t.doneAt = Date.now(); log(m, `${t.agent} finished: ${t.title}`); }
          if (m.status === 'running') m.status = 'queued';
          save();
        } else {
          m.status = 'running';
          log(m, 'Editor is writing the final report…'); save();
          const work = m.tasks.map((x) => `[${x.agent}] ${x.title} — ${x.status}${x.actionResult ? ` [device result: ${x.actionResult}]` : ' [nothing was saved on the device]'}\n${(x.output || '').slice(0, 2500)}`).join('\n\n');
          const report = unfence(await complete('You are the EDITOR in Mission Control. Write the final report for the user in Markdown (not inside a code block): a short summary of the result; the key results or deliverable (complete, using the team’s work); then "Done" and "Not done or needs checking" lists. Only say something was saved or created on the device if the work list shows a result for it in brackets; agents saying they "will save" does not count. Be honest about anything uncertain or unfinished.', `Objective: ${m.goal}\n\nTeam's work:\n${work}`));
          if (stopNow) continue;
          m.report = report; m.status = 'done'; m.finished = Date.now();
          log(m, 'Mission complete.');
          save();
          bus.emit('mission.done', m);
        }
      } catch (e) {
        // Lost connection to the AI (JARVIS closed or reloaded, Ollama restarted): just pause and resume later.
        const interrupted = /network|abort|load failed|fetch|connection|cancel/i.test(e.message || '');
        if (w.task) { w.task.status = interrupted ? 'todo' : 'failed'; w.task.error = interrupted ? '' : e.message; }
        m.status = interrupted ? 'paused' : 'failed';
        log(m, interrupted ? 'Paused: the AI was interrupted. Press Resume to carry on.' : `Stopped by an error: ${e.message}. Press Resume to try again.`);
        save();
      }
    }
  } finally { running = false; current = null; }
}

/** Small models write arguments loosely ({text: …} items, numbers as text…): tidy them for the tool. */
export function cleanArgs(tool, a = {}) {
  const txt = (x) => (typeof x === 'string' ? x : x?.text || x?.item || x?.name || x?.title || x?.task || JSON.stringify(x));
  const out = { ...a };
  if (Array.isArray(out.items)) out.items = out.items.map(txt).map((x) => String(x).trim()).filter(Boolean);
  else if (typeof out.items === 'string') out.items = out.items.split(/\n|,|;/).map((x) => x.replace(/^[-*•\d.)\s]+/, '').trim()).filter(Boolean);
  if (tool === 'create_document' && typeof out.content !== 'string') out.content = Array.isArray(out.content) ? out.content.map(txt).join('\n') : JSON.stringify(out.content, null, 2);
  if (tool === 'add_project_task' && Array.isArray(out.task)) out.task = out.task.map(txt).join('; ');
  return out;
}

/** Models sometimes wrap a whole answer in ```markdown … ```: unwrap it so it shows as text. */
export const unfence = (t) => String(t || '').trim().replace(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/i, '$1').trim();

function agentSystem(agent, goal) {
  const base = `You are the ${agent.toUpperCase()} on a Mission Control team (${AGENTS[agent].job}). The mission: "${goal}". Do your task completely and concretely; build on the team's earlier work. Be accurate and say when something is uncertain.`;
  if (agent === 'Organizer' || agent === 'Writer') return `${base} If saving the result on the user's device would help, end with exactly one line: ACTION: {"tool": "<tool>", "args": {…}} using one of: create_document {"title","content","format":"md"}, add_to_list {"list","items":[…]}, set_reminder {"text","when"}, create_project {"name","goal"}, add_project_task {"project","task"}. The user approves it first. Otherwise don't write an ACTION line.`;
  if (agent === 'Coder') return `${base} Give complete, working code in fenced blocks and say how to run it.`;
  return base;
}
