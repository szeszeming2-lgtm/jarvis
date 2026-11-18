// Share JARVIS: the phone's share sheet (Messages, WhatsApp, AirDrop, Copy…),
// or copy the link where there is no share sheet.
import { isNative } from '../host.js';
import { toast, dialog } from './common.js';

export const PUBLIC_URL = 'https://szeszeming2-lgtm.github.io/jarvis/';

/** The address people should open: this site when hosted, otherwise the public link. */
export function appUrl() {
  const hosted = /^https?:$/.test(location.protocol) && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  return !isNative && hosted ? location.origin + location.pathname.replace(/index\.html$/, '') : PUBLIC_URL;
}

export async function shareApp() {
  const url = appUrl();
  const data = { title: 'JARVIS', text: 'JARVIS: a free, private AI assistant that runs on your own phone or computer.', url };
  if (navigator.share && (!navigator.canShare || navigator.canShare(data))) {
    try { await navigator.share(data); return 'shared'; } catch (e) { if (e?.name === 'AbortError') return 'cancelled'; }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied. Paste it into a message to share JARVIS.', { icon: 'copy' });
    return 'copied';
  } catch {
    await dialog({ title: 'Share JARVIS', text: 'Copy this link and send it to anyone:', input: url, okLabel: 'Done', cancelLabel: '' });
    return 'shown';
  }
}
