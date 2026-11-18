// Web version only: Ollama answers apps on this computer, but refuses websites
// unless they are on its allowed list (OLLAMA_ORIGINS). This panel explains it in
// plain words and gives one copy-and-paste command per operating system.
import { h, iconNode } from '../util.js';
import { call } from '../host.js';
import * as ollama from '../ollama.js';
import { toast, seg } from './common.js';

export const ORIGIN = location.origin;
const LABEL = 'local.jarvis.ollama-origins';

export function commands(origin = ORIGIN) {
  const mac = `O='${origin}'; E=$(launchctl getenv OLLAMA_ORIGINS); case ",$E," in *",$O,"*) O=$E;; ,,) ;; *) O="$E,$O";; esac; P=~/Library/LaunchAgents/${LABEL}.plist; mkdir -p ~/Library/LaunchAgents; printf '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>Label</key><string>${LABEL}</string><key>ProgramArguments</key><array><string>/bin/launchctl</string><string>setenv</string><string>OLLAMA_ORIGINS</string><string>%s</string></array><key>RunAtLoad</key><true/></dict></plist>' "$O" > "$P"; launchctl unload "$P" 2>/dev/null; launchctl load "$P"; launchctl setenv OLLAMA_ORIGINS "$O"; osascript -e 'quit app "Ollama"'; sleep 3; open -a Ollama; echo "Done - go back to JARVIS and press Check again."`;
  const macUndo = `launchctl unload ~/Library/LaunchAgents/${LABEL}.plist; rm -f ~/Library/LaunchAgents/${LABEL}.plist; launchctl unsetenv OLLAMA_ORIGINS; osascript -e 'quit app "Ollama"'; sleep 3; open -a Ollama`;
  const win = `setx OLLAMA_ORIGINS "${origin}"`;
  const winUndo = `reg delete HKCU\\Environment /F /V OLLAMA_ORIGINS`;
  const linux = `sudo mkdir -p /etc/systemd/system/ollama.service.d && printf '[Service]\\nEnvironment="OLLAMA_ORIGINS=${origin}"\\n' | sudo tee /etc/systemd/system/ollama.service.d/jarvis.conf >/dev/null && sudo systemctl daemon-reload && sudo systemctl restart ollama`;
  const linuxUndo = `sudo rm /etc/systemd/system/ollama.service.d/jarvis.conf && sudo systemctl daemon-reload && sudo systemctl restart ollama`;
  return { mac, macUndo, win, winUndo, linux, linuxUndo };
}

const guessOS = () => (/Win/.test(navigator.userAgent) ? 'win' : /Linux|X11|CrOS/.test(navigator.userAgent) && !/Android/.test(navigator.userAgent) ? 'linux' : 'mac');

function copyBox(text) {
  const pre = h('pre', { class: 'mono selectable', text, style: { margin: '0', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: '120px', overflow: 'auto', background: 'rgba(0,0,0,.4)', border: '1px solid var(--line)', borderRadius: '8px', padding: '9px 10px', fontSize: '11.5px' } });
  const btn = h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: async () => {
    try { await navigator.clipboard.writeText(text); } catch {
      const r = document.createRange(); r.selectNodeContents(pre); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); document.execCommand('copy');
    }
    btn.replaceChildren(iconNode('check'), 'Copied');
    setTimeout(() => btn.replaceChildren(iconNode('copy'), 'Copy command'), 2000);
  } }, iconNode('copy'), 'Copy command');
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-start', width: '100%' } }, pre, btn);
}

const step = (n, ...content) => h('div', { class: 'check', style: { alignItems: 'flex-start' } },
  h('span', { class: 'st', style: { fontSize: '11px', fontWeight: 700, color: 'var(--accent)' }, text: String(n) }), h('div', { class: 'grow', style: { lineHeight: 1.55 } }, ...content));

/** The full help panel. onDone is called when Ollama answers this site. */
export function connectPanel({ compact = false } = {}) {
  const c = commands();
  const box = h('div', { class: 'connect-panel' });
  let os = guessOS();
  const status = h('div', { style: { marginTop: '12px' } });
  const draw = () => {
    const e = ollama.engine;
    const running = e.status === 'blocked';
    const body = h('div', { class: 'check-list' });
    if (e.lnaDenied) {
      body.append(h('div', { class: 'callout warn' }, iconNode('alert'), h('div', {}, h('b', { text: 'Your browser is blocking local access. ' }), 'Click the icon at the left of the address bar, allow “Local network access” (or “Apps on this device”) for this site, then press Check again.')));
    }
    if (!running) {
      body.append(step(1, h('b', { text: 'Install Ollama (free) and open it. ' }), 'Skip this if you already have it — look for the llama icon in your menu bar or system tray. ',
        h('div', { style: { marginTop: '8px' } }, h('button', { class: 'btn btn-sm', type: 'button', onclick: () => call('app.openExternal', { url: 'https://ollama.com/download' }) }, iconNode('external'), 'ollama.com/download'))));
    }
    if (os === 'mac') {
      body.append(
        step(running ? 1 : 2, h('b', { text: 'Open Terminal: ' }), 'press ⌘ Space, type ', h('b', { text: 'Terminal' }), ', press Return.'),
        step(running ? 2 : 3, h('b', { text: 'Copy this command, paste it in Terminal (⌘ V) and press Return.' }), ' It lets this website talk to Ollama and restarts Ollama. It only has to be done once.', h('div', { style: { marginTop: '8px' } }, copyBox(c.mac))),
      );
    } else if (os === 'win') {
      body.append(
        step(running ? 1 : 2, h('b', { text: 'Open PowerShell: ' }), 'press the Windows key, type ', h('b', { text: 'PowerShell' }), ', press Enter.'),
        step(running ? 2 : 3, h('b', { text: 'Copy this command, paste it (right-click) and press Enter.' }), h('div', { style: { marginTop: '8px' } }, copyBox(c.win))),
        step(running ? 3 : 4, h('b', { text: 'Restart Ollama: ' }), 'right-click the llama icon by the clock, choose Quit, then open Ollama again from the Start menu.'),
      );
    } else {
      body.append(
        step(running ? 1 : 2, h('b', { text: 'Open a terminal, paste this command and press Enter' }), ' (it asks for your password because Ollama runs as a system service):', h('div', { style: { marginTop: '8px' } }, copyBox(c.linux))),
      );
    }
    body.append(step('✓', h('b', { text: 'Come back here and press Check again.' })));
    status.replaceChildren(h('div', { class: 'flex' },
      h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
        await ollama.detect();
        if (ollama.engine.status === 'online') toast('Connected to Ollama');
        else toast(ollama.engine.status === 'blocked' ? 'Ollama is running but still blocking this site. Did the command finish? Ollama must restart.' : 'Can’t reach Ollama yet. Is it open?', { bad: true, ms: 6000 });
      } }, iconNode('refresh'), 'Check again'),
      h('span', { class: 'pill ' + (running ? 'warn' : 'bad'), text: running ? 'Ollama is running, but blocking this site' : 'Ollama not found' })));
    box.replaceChildren(
      compact ? null : h('div', { class: 'callout' }, iconNode('info'), h('div', {},
        h('b', { text: 'One-time setup for the web version. ' }),
        `Ollama only talks to apps on your computer unless you allow a website. These steps allow ${ORIGIN} (where JARVIS is hosted) and nothing else. Your conversations still stay on your computer.`)),
      h('div', { class: 'flex', style: { marginBottom: '10px' } }, h('span', { class: 'muted', style: { fontSize: '12.5px' }, text: 'Your computer:' }), seg(os, [['mac', 'Mac'], ['win', 'Windows'], ['linux', 'Linux']], (v) => { os = v; draw(); })),
      body,
      status,
      h('details', { style: { marginTop: '12px', fontSize: '12px' }, class: 'muted' }, h('summary', { text: 'How to undo this later', style: { cursor: 'pointer' } }),
        h('div', { style: { marginTop: '8px' } }, copyBox(os === 'mac' ? c.macUndo : os === 'win' ? c.winUndo : c.linuxUndo))),
      h('p', { class: 'muted', style: { fontSize: '12px', lineHeight: 1.5, marginTop: '10px' }, text: 'Using Safari? If it still can’t connect after this, try Chrome, Edge or Firefox — Safari can block websites from reaching apps on your own computer.' }),
    );
  };
  draw();
  box.redraw = draw;
  return box;
}
