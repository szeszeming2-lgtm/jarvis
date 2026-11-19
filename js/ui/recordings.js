// Screen recordings tab: what Screen Vision saved (only when you chose to keep it).
import { h, iconNode, bus, timeAgo, fmtBytes } from '../util.js';
import { registerTab } from './sheets.js';
import { section, toast, dialog, callout } from './common.js';
import { call, isNative } from '../host.js';
import * as SV from './screenvision.js';

registerTab('recordings', (body) => {
  const list = h('div', { class: 'list' });
  const urls = [];
  const draw = async () => {
    const items = await SV.recordings();
    list.replaceChildren(...items.map((r) => {
      const video = h('video', { controls: true, preload: 'none', playsinline: true, style: { width: '100%', maxHeight: '260px', marginTop: '6px', borderRadius: '10px', background: '#000' } });
      const load = async () => { if (video.src) return; try { const b = await SV.recordingBlob(r.id); if (!b) throw new Error('This recording is missing.'); const u = URL.createObjectURL(b); urls.push(u); video.src = u; } catch (e) { toast(e.message, { bad: true }); } };
      video.addEventListener('play', load, { once: true });
      video.addEventListener('pointerdown', load, { once: true });
      return h('div', { class: 'item', style: { alignItems: 'flex-start' } },
        h('span', { class: 'item-ic' }, iconNode('display')),
        h('div', { class: 'item-main' }, h('div', { class: 'item-title', text: r.title }), h('div', { class: 'item-sub', text: `${Math.floor((r.seconds || 0) / 60)} min ${(r.seconds || 0) % 60} s · ${fmtBytes(r.size || 0)}${r.sound ? ' · with sound' : ''} · ${timeAgo(r.created)}` }), video,
          h('div', { class: 'flex', style: { marginTop: '6px' } },
            h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => {
              const b = await SV.recordingBlob(r.id); if (!b) return;
              const ext = /mp4/.test(b.type) ? 'mp4' : 'webm', name = `${r.title.replace(/[^\w .-]+/g, '')}.${ext}`;
              try {
                if (isNative) { const bin = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < bin.length; i += 0x8000) s += String.fromCharCode(...bin.subarray(i, i + 0x8000)); const res = await call('file.save', { name, base64: btoa(s) }); if (!res?.ok) throw new Error('Not saved.'); toast('Recording saved.'); }
                else { const a = h('a', { href: URL.createObjectURL(b), download: name }); document.body.append(a); a.click(); a.remove(); }
              } catch (e) { toast(e.message, { bad: true }); }
            } }, iconNode('download'), 'Download'))),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Delete ${r.title}`, onclick: async () => { if (await dialog({ title: 'Delete this recording?', text: 'It can’t be undone.', okLabel: 'Delete', danger: true })) { await SV.removeRecording(r.id); toast('Deleted.'); } } }, iconNode('trash')));
    }));
    if (!items.length) list.append(h('div', { class: 'empty', text: 'No recordings yet. Say “screen vision” (or use Circle to Ask → Live screen) and tick “Also record a video”.' }));
  };
  const off = bus.on('screen-recordings', draw);
  draw();
  const sup = SV.supported();
  body.append(
    callout('<b>Screen Vision.</b> Share a screen or window, draw on it, select an area and ask JARVIS about it by typing or talking. Recording is optional and you decide whether to keep each one.', { icon: 'display' }),
    section('Start', sup.ok ? '' : sup.why, h('button', { class: 'btn btn-primary btn-sm', type: 'button', disabled: !sup.ok, onclick: () => SV.start() }, iconNode('rec'), 'Start Screen Vision')),
    section('Saved recordings', 'Kept on this device only (encrypted when the app lock is on).', list));
  return () => { off(); urls.forEach((u) => URL.revokeObjectURL(u)); };
});
