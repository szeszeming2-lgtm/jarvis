// Memory manager and Skills manager tabs.
import { h, iconNode, bus, timeAgo } from '../util.js';
import { settings, set } from '../store.js';
import { registerTab, refresh } from './sheets.js';
import { row, rows, toggle, section, callout, toast, dialog, seg, text, area } from './common.js';
import * as memory from '../memory.js';
import * as skills from '../skills.js';
import { GROUPS, TOOLS, byName } from '../tools.js';
import { call } from '../host.js';
import { iconNames } from '../icons.js';

// ------------------------------------------------------------------ Memory
registerTab('memory', (body) => {
  let q = '';
  const list = h('div', { class: 'list' });
  const draw = () => {
    const items = memory.all().filter((m) => !q || m.text.toLowerCase().includes(q.toLowerCase()));
    list.replaceChildren(...items.map((m) => {
      const textEl = h('div', { class: 'item-title selectable', text: m.text });
      return h('div', { class: 'item' + (m.pinned ? ' on' : ''), style: { opacity: m.enabled === false ? 0.5 : 1 } },
        h('span', { class: 'item-ic' }, iconNode(m.pinned ? 'pin' : 'brain')),
        h('div', { class: 'item-main' }, textEl, h('div', { class: 'item-sub', text: `${m.source === 'jarvis' ? `Saved by ${settings.assistantName}` : 'Added by you'} · ${timeAgo(m.created)}${m.enabled === false ? ' · paused' : ''}` })),
        h('div', { class: 'item-actions' },
          h('button', { class: 'icon-btn' + (m.pinned ? ' on' : ''), type: 'button', title: m.pinned ? 'Unpin' : 'Pin (always included)', 'aria-label': 'Pin', onclick: () => memory.update(m.id, { pinned: !m.pinned }) }, iconNode('pin')),
          h('button', { class: 'icon-btn', type: 'button', title: m.enabled === false ? 'Use this memory' : 'Pause this memory', 'aria-label': 'Pause', onclick: () => memory.update(m.id, { enabled: m.enabled === false }) }, iconNode(m.enabled === false ? 'play' : 'stop')),
          h('button', { class: 'icon-btn', type: 'button', title: 'Edit', 'aria-label': 'Edit', onclick: async () => { const v = await dialog({ title: 'Edit memory', input: m.text, okLabel: 'Save' }); if (v?.trim()) memory.update(m.id, { text: v.trim() }); } }, iconNode('edit')),
          h('button', { class: 'icon-btn', type: 'button', title: 'Delete', 'aria-label': 'Delete', onclick: () => memory.remove(m.id) }, iconNode('trash'))));
    }));
    if (!items.length) list.append(h('div', { class: 'empty', text: q ? 'No memories match.' : `Nothing yet. Tell ${settings.assistantName} “remember that …” or add one here.` }));
  };
  const off = bus.on('memory', draw);
  const add = h('input', { class: 'field grow', placeholder: 'Add something to remember, e.g. “My daughter is called Mia”', 'aria-label': 'New memory' });
  const addIt = async () => { if (add.value.trim()) { await memory.add(add.value, 'you'); add.value = ''; } };
  add.addEventListener('keydown', (e) => { if (e.key === 'Enter') addIt(); });
  const search = h('input', { class: 'field', placeholder: 'Search memories', style: { width: '200px' }, 'aria-label': 'Search memories' });
  search.addEventListener('input', () => { q = search.value; draw(); });
  body.append(
    callout(`<b>You decide what ${escapeText(settings.assistantName)} remembers.</b> Memories are short notes stored only on this device and given to the AI so it knows you better. Pin the important ones; pause or delete any of them at any time.`, { icon: 'brain' }),
    section('Settings', '', rows(
      row('Use memories in conversations', '', toggle(settings.memory.enabled, (v) => set('memory.enabled', v), 'Use memories')),
      row(`Let ${settings.assistantName} save memories`, 'When you ask it to remember something.', toggle(settings.memory.allowSave, (v) => set('memory.allowSave', v), 'Allow saving')),
    )),
    section('Memories', '', h('div', { class: 'flex', style: { marginBottom: '10px' } }, add, h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: addIt }, iconNode('plus'), 'Add'), search), list),
  );
  draw();
  return off;
});

const escapeText = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ------------------------------------------------------------------ Skills
registerTab('skills', (body) => {
  const mine = h('div', { class: 'list' });
  const gallery = h('div', { class: 'list' });
  const builtIn = h('div', { class: 'rows' });
  const draw = () => {
    const disabled = settings.skills.disabledGroups || [];
    builtIn.replaceChildren(...Object.entries(GROUPS).map(([g, info]) => {
      const n = TOOLS.filter((t) => t.group === g).length;
      return row(info.label, `${n} abilit${n === 1 ? 'y' : 'ies'} · ${TOOLS.filter((t) => t.group === g).map((t) => t.name.replace(/_/g, ' ')).join(', ')}`,
        toggle(!disabled.includes(g), (on) => { const d = new Set(settings.skills.disabledGroups || []); on ? d.delete(g) : d.add(g); set('skills.disabledGroups', [...d]); }, info.label));
    }));
    mine.replaceChildren(...skills.all().map((sk) => h('div', { class: 'item' + (sk.enabled !== false ? ' on' : '') },
      h('span', { class: 'item-ic' }, iconNode(sk.icon || 'puzzle')),
      h('div', { class: 'item-main' },
        h('div', { class: 'item-title' }, sk.name, h('span', { class: 'mono muted', text: '/' + sk.command }), h('span', { class: 'pill', text: sk.kind === 'routine' ? `Actions · ${sk.steps?.length || 0} steps` : sk.kind === 'link' ? 'Website' : 'Instructions' }), sk.trusted ? h('span', { class: 'pill warn', text: 'Runs without asking' }) : null),
        h('div', { class: 'item-sub', text: (sk.description || '') + (sk.triggers?.length ? ` · Say: “${sk.triggers.join('”, “')}”` : '') })),
      h('div', { class: 'item-actions' },
        toggle(sk.enabled !== false, (v) => skills.toggle(sk.id, v), `Enable ${sk.name}`),
        h('button', { class: 'icon-btn', type: 'button', title: 'Edit', 'aria-label': 'Edit', onclick: () => editSkill(sk) }, iconNode('edit')),
        h('button', { class: 'icon-btn', type: 'button', title: 'Delete', 'aria-label': 'Delete', onclick: async () => { if (await dialog({ title: `Delete “${sk.name}”?`, okLabel: 'Delete', danger: true })) skills.remove(sk.id); } }, iconNode('trash'))))));
    if (!skills.all().length) mine.append(h('div', { class: 'empty', text: 'No skills yet. Install one from the gallery or create your own.' }));
    gallery.replaceChildren(...skills.GALLERY.map((g) => h('div', { class: 'item' },
      h('span', { class: 'item-ic' }, iconNode(g.icon)),
      h('div', { class: 'item-main' }, h('div', { class: 'item-title' }, g.name, h('span', { class: 'mono muted', text: '/' + g.command }), h('span', { class: 'pill', text: g.kind === 'routine' ? 'Actions' : g.kind === 'link' ? 'Website' : 'Instructions' })), h('div', { class: 'item-sub', text: g.description })),
      h('div', { class: 'item-actions' }, skills.installed(g.id) ? h('span', { class: 'pill ok', text: 'Added' }) : h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { skills.install(g.id); toast(`Added ${g.name}`); } }, iconNode('plus'), 'Add')))));
  };
  const offs = [bus.on('skills', draw), bus.on('settings', (d) => { if (d.path.startsWith('skills')) draw(); })];
  body.append(
    callout('<b>Skills</b> are shortcuts you can trigger by typing <span class="mono">/name</span>, saying a phrase, or just asking. <b>Prompt skills</b> give JARVIS reusable instructions. <b>Routines</b> run several actions in a row (each still follows your Permissions). Everything here is free and works offline.', { icon: 'puzzle' }),
    section('Your skills', '', mine, h('div', { class: 'flex', style: { marginTop: '10px' } },
      h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => editSkill(null) }, iconNode('plus'), 'Create a skill'),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: importSkillFile }, iconNode('upload'), 'Import'),
      h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: exportSkills }, iconNode('download'), 'Export'))),
    section('Skill gallery', 'Free skills that come with JARVIS. Add any of them with one click, then edit them to suit you.', gallery),
    section('Built-in abilities', 'Turn whole groups of abilities on or off for the AI. Permissions (allow / ask / off) are in Settings → Permissions.', builtIn),
  );
  draw();
  return () => offs.forEach((f) => f());
});

async function exportSkills() {
  const data = JSON.stringify({ app: 'JARVIS', type: 'skills', skills: skills.all().map(({ id, galleryId, enabled, trusted, ...rest }) => rest) }, null, 2);
  try { const r = await call('file.save', { name: 'JARVIS-skills.json', content: data }); if (r?.ok) toast('Skills exported'); } catch (e) { toast(e.message, { bad: true }); }
}

async function importSkillFile() {
  try {
    const f = await call('file.open', { accept: '.json', types: ['json'] });
    if (!f) return;
    const data = JSON.parse(f.text);
    const list = Array.isArray(data) ? data : data.skills;
    if (!Array.isArray(list)) throw new Error('No skills found in that file.');
    skills.importSkills(list);
    toast(`Imported ${list.length} skill${list.length === 1 ? '' : 's'}. Imported skills always ask before acting.`);
  } catch (e) { toast(e.message, { bad: true }); }
}

/** Skill (plugin) editor in a modal sheet. */
export function editSkill(existing, { kind = 'prompt' } = {}) {
  const sk = existing ? structuredClone(existing) : { name: '', command: '', description: '', icon: kind === 'link' ? 'globe' : 'puzzle', kind, triggers: [], prompt: '', url: '', steps: [], trusted: false };
  const urlRow = row('Web address', 'The page to open. Put {input} where your words go, e.g. https://www.youtube.com/results?search_query={input}', text(sk.url || '', (v) => (sk.url = v.trim()), { width: '100%', placeholder: 'https://…{input}', label: 'Web address' }), { stack: true });
  const layer = h('div', { class: 'sheet-layer', style: { zIndex: 75 } });
  const stepsBox = h('div', { class: 'list' });
  const promptRow = row('Instructions', 'What should JARVIS do? Use {input} for the text after the command, {date} for today, {name} for your name.', area(sk.prompt, (v) => (sk.prompt = v), { rows: 6, placeholder: 'e.g. Turn {input} into a polite text message I can send.' }), { stack: true });
  const ROUTINE_TOOLS = TOOLS.filter((t) => !['remember', 'forget', 'get_datetime', 'list_shortcuts'].includes(t.name));
  const drawSteps = () => {
    stepsBox.replaceChildren(...sk.steps.map((st, i) => {
      const tool = byName(st.tool);
      const fields = Object.entries(tool?.props || {}).map(([k, p]) => {
        const inp = h('input', { class: 'field', placeholder: k, value: st.args?.[k] ?? '', style: { width: '150px' }, 'aria-label': k });
        inp.addEventListener('input', () => { st.args ||= {}; st.args[k] = p.type === 'number' ? Number(inp.value) : p.type === 'boolean' ? /^(true|on|yes|1)$/i.test(inp.value) : inp.value; });
        return inp;
      });
      const sel = h('select', { class: 'field', 'aria-label': 'Action' }, ...ROUTINE_TOOLS.map((t) => { const o = h('option', { value: t.name, text: t.name.replace(/_/g, ' ') }); if (t.name === st.tool) o.selected = true; return o; }));
      sel.addEventListener('change', () => { st.tool = sel.value; st.args = {}; drawSteps(); });
      return h('div', { class: 'item' }, h('span', { class: 'mono muted', text: `${i + 1}.` }), h('div', { class: 'item-main flex' }, sel, ...fields),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Remove step', onclick: () => { sk.steps.splice(i, 1); drawSteps(); } }, iconNode('x')));
    }));
    stepsBox.append(h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { sk.steps.push({ tool: 'open_app', args: {} }); drawSteps(); } }, iconNode('plus'), 'Add a step'));
  };
  const stepsRow = row('Steps', 'Run in order. Each step follows your Permissions unless you allow the routine to run without asking.', stepsBox, { stack: true });
  const trustedRow = row('Run without asking', 'Skip confirmation cards for this routine’s steps. Terminal commands always ask.', toggle(sk.trusted, (v) => (sk.trusted = v), 'Run without asking'));
  const showKind = () => { promptRow.hidden = sk.kind !== 'prompt'; stepsRow.hidden = trustedRow.hidden = sk.kind !== 'routine'; urlRow.hidden = sk.kind !== 'link'; };
  const iconSel = h('select', { class: 'field', 'aria-label': 'Icon' }, ...iconNames.map((n) => { const o = h('option', { value: n, text: n }); if (n === sk.icon) o.selected = true; return o; }));
  iconSel.addEventListener('change', () => (sk.icon = iconSel.value));
  const close = () => layer.remove();
  const save = () => {
    if (!sk.name.trim()) return toast('Give the skill a name.', { bad: true });
    if (sk.kind === 'prompt' && !sk.prompt.trim()) return toast('Write the instructions.', { bad: true });
    if (sk.kind === 'routine' && !sk.steps.length) return toast('Add at least one step.', { bad: true });
    if (sk.kind === 'link' && !skills.safeLink(sk.url)) return toast('The web address must start with https://', { bad: true });
    sk.triggers = (sk._triggers ?? sk.triggers.join(', ')).split(',').map((t) => t.trim()).filter(Boolean);
    delete sk._triggers;
    skills.upsert(sk);
    toast('Plugin saved');
    close();
  };
  layer.append(h('div', { class: 'wizard glass', style: { width: 'min(680px, 100%)', textAlign: 'left' }, role: 'dialog', 'aria-modal': 'true' },
    h('h2', { style: { fontSize: '22px', margin: '0 0 14px' }, text: existing ? 'Edit plugin' : 'Make a plugin' }),
    rows(
      row('Name', '', text(sk.name, (v) => (sk.name = v), { width: '240px', placeholder: 'e.g. Text message helper', label: 'Skill name' })),
      row('Command', 'Type /command to run it.', text(sk.command, (v) => (sk.command = skills.slug(v)), { width: '160px', placeholder: 'texthelp', label: 'Command' })),
      row('Spoken triggers', 'Optional phrases, separated by commas.', text(sk.triggers.join(', '), (v) => (sk._triggers = v), { width: '240px', placeholder: 'e.g. help me text', label: 'Triggers' })),
      row('Description', '', text(sk.description, (v) => (sk.description = v), { width: '240px', label: 'Description' })),
      row('Icon', '', iconSel),
      row('Type', 'Instructions for the AI, a row of actions, or a website shortcut.', seg(sk.kind, [['prompt', 'Instructions'], ['routine', 'Actions'], ['link', 'Website']], (v) => { sk.kind = v; showKind(); })),
      promptRow, stepsRow, trustedRow, urlRow),
    h('div', { class: 'flex', style: { justifyContent: 'flex-end', marginTop: '16px' } },
      h('button', { class: 'btn btn-ghost', type: 'button', text: 'Cancel', onclick: close }),
      h('button', { class: 'btn btn-primary', type: 'button', text: 'Save plugin', onclick: save }))));
  drawSteps();
  showKind();
  layer.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  document.body.append(layer);
  layer.querySelector('input')?.focus();
}
