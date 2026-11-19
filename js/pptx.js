// A small PowerPoint (.pptx) writer: a .pptx is a zip of XML files. No libraries and no
// eval, so it works under JARVIS's strict security rules, offline, on every device.
// Makes widescreen slides with a title and bullet points on a dark or light background.

// ---------------------------------------------------------------- zip (stored, with CRC-32)
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

export function zip(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  let off = 0;
  for (const [name, data] of files) {
    const n = enc.encode(name), d = typeof data === 'string' ? enc.encode(data) : data, crc = crc32(d);
    const lh = new Uint8Array(30 + n.length), v = new DataView(lh.buffer);
    v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(8, 0, true); v.setUint32(14, crc, true); v.setUint32(18, d.length, true); v.setUint32(22, d.length, true); v.setUint16(26, n.length, true); lh.set(n, 30);
    const ch = new Uint8Array(46 + n.length), c = new DataView(ch.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint32(16, crc, true); c.setUint32(20, d.length, true); c.setUint32(24, d.length, true); c.setUint16(28, n.length, true); c.setUint32(42, off, true); ch.set(n, 46);
    parts.push(lh, d); central.push(ch); off += lh.length + d.length;
  }
  const cdLen = central.reduce((s, x) => s + x.length, 0), end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, central.length, true); e.setUint16(10, central.length, true); e.setUint32(12, cdLen, true); e.setUint32(16, off, true);
  const all = [...parts, ...central, end], out = new Uint8Array(all.reduce((s, x) => s + x.length, 0));
  let p = 0; for (const x of all) { out.set(x, p); p += x.length; }
  return out;
}

// ---------------------------------------------------------------- PresentationML
const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const EMU = 914400; // per inch
const W = 13.333 * EMU, H = 7.5 * EMU;
const rels = (list) => `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map(([id, type, target]) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`).join('')}</Relationships>`;
const grp = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

function textBox(id, name, x, y, w, h, paras) {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${Math.round(x)}" y="${Math.round(y)}"/><a:ext cx="${Math.round(w)}" cy="${Math.round(h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="0" rIns="0"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paras}</p:txBody></p:sp>`;
}
const run = (t, { sz, color, bold }) => `<a:r><a:rPr lang="en-US" sz="${sz}"${bold ? ' b="1"' : ''} dirty="0"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="Helvetica Neue"/><a:cs typeface="Helvetica Neue"/></a:rPr><a:t>${esc(t)}</a:t></a:r>`;
const bar = (id, x, y, w, h, color) => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Accent"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${Math.round(x)}" y="${Math.round(y)}"/><a:ext cx="${Math.round(w)}" cy="${Math.round(h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>`;

function slideXml(s, theme, isTitle) {
  const { bg, accent, text, dim } = theme;
  let shapes;
  if (isTitle) {
    shapes = textBox(2, 'Title', 0.8 * EMU, 2.4 * EMU, 11.7 * EMU, 1.6 * EMU, `<a:p>${run(s.title, { sz: 4400, color: text, bold: true })}</a:p>`)
      + bar(3, 0.8 * EMU, 4.15 * EMU, 2.2 * EMU, 0.08 * EMU, accent)
      + (s.subtitle ? textBox(4, 'Subtitle', 0.8 * EMU, 4.45 * EMU, 11.7 * EMU, 0.8 * EMU, `<a:p>${run(s.subtitle, { sz: 2000, color: dim })}</a:p>`) : '');
  } else {
    const bullets = (s.bullets || []).slice(0, 7).map((b) => `<a:p><a:pPr marL="342900" indent="-342900"><a:spcAft><a:spcPts val="1200"/></a:spcAft><a:buClr><a:srgbClr val="${accent}"/></a:buClr><a:buFont typeface="Arial"/><a:buChar char="•"/></a:pPr>${run(b, { sz: 2400, color: text })}</a:p>`).join('');
    shapes = textBox(2, 'Title', 0.8 * EMU, 0.5 * EMU, 11.7 * EMU, 1.0 * EMU, `<a:p>${run(s.title, { sz: 3200, color: accent, bold: true })}</a:p>`)
      + bar(3, 0.8 * EMU, 1.5 * EMU, 1.2 * EMU, 0.05 * EMU, accent)
      + (bullets ? textBox(4, 'Body', 0.9 * EMU, 1.85 * EMU, 11.6 * EMU, 5.2 * EMU, bullets) : '');
  }
  return `${HEAD}<p:sld ${NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="${bg}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${grp}${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

const THEME = `${HEAD}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="JARVIS"><a:themeElements><a:clrScheme name="JARVIS"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="061226"/></a:dk2><a:lt2><a:srgbClr val="E4F3FF"/></a:lt2><a:accent1><a:srgbClr val="2AD4FF"/></a:accent1><a:accent2><a:srgbClr val="2F74FF"/></a:accent2><a:accent3><a:srgbClr val="3CF0A5"/></a:accent3><a:accent4><a:srgbClr val="FFB547"/></a:accent4><a:accent5><a:srgbClr val="B78BFF"/></a:accent5><a:accent6><a:srgbClr val="FF5A76"/></a:accent6><a:hlink><a:srgbClr val="2AD4FF"/></a:hlink><a:folHlink><a:srgbClr val="93B3CC"/></a:folHlink></a:clrScheme><a:fontScheme name="JARVIS"><a:majorFont><a:latin typeface="Helvetica Neue"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Helvetica Neue"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="JARVIS"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;
const MASTER = `${HEAD}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${grp}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="4400"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="2400"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`;
const LAYOUT = `${HEAD}<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${grp}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

export const THEMES = {
  dark: { bg: '061226', accent: '2AD4FF', text: 'E4F3FF', dim: '93B3CC' },
  light: { bg: 'FFFFFF', accent: '0877B8', text: '0B1A2B', dim: '3B5370' },
};

/** deck: {title, subtitle, slides:[{title, bullets}]} → Uint8Array (.pptx) */
export function buildPptx(deck, { theme = 'dark' } = {}) {
  const t = THEMES[theme] || THEMES.dark;
  const slides = [{ title: deck.title || 'Presentation', subtitle: deck.subtitle || '', title_: true }, ...(deck.slides || [])];
  const files = [];
  files.push(['[Content_Types].xml', `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>${slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}</Types>`]);
  files.push(['_rels/.rels', rels([['rId1', 'officeDocument', 'ppt/presentation.xml'], ['rId2', 'metadata/core-properties', 'docProps/core.xml'], ['rId3', 'extended-properties', 'docProps/app.xml']]).replace('relationships/metadata/core-properties', 'relationships/metadata/core-properties').replace('http://schemas.openxmlformats.org/officeDocument/2006/relationships/metadata/core-properties', 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties')]);
  files.push(['docProps/core.xml', `${HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(deck.title)}</dc:title><dc:creator>JARVIS</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created></cp:coreProperties>`]);
  files.push(['docProps/app.xml', `${HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>JARVIS</Application><Slides>${slides.length}</Slides></Properties>`]);
  files.push(['ppt/presentation.xml', `${HEAD}<p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 3}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${Math.round(W)}" cy="${Math.round(H)}"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:defaultTextStyle></p:presentation>`]);
  files.push(['ppt/_rels/presentation.xml.rels', rels([['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'], ['rId2', 'theme', 'theme/theme1.xml'], ...slides.map((_, i) => [`rId${i + 3}`, 'slide', `slides/slide${i + 1}.xml`])])]);
  files.push(['ppt/slideMasters/slideMaster1.xml', MASTER]);
  files.push(['ppt/slideMasters/_rels/slideMaster1.xml.rels', rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'theme', '../theme/theme1.xml']])]);
  files.push(['ppt/slideLayouts/slideLayout1.xml', LAYOUT]);
  files.push(['ppt/slideLayouts/_rels/slideLayout1.xml.rels', rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']])]);
  files.push(['ppt/theme/theme1.xml', THEME]);
  slides.forEach((s, i) => {
    files.push([`ppt/slides/slide${i + 1}.xml`, slideXml(s, t, i === 0)]);
    files.push([`ppt/slides/_rels/slide${i + 1}.xml.rels`, rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml']])]);
  });
  return zip(files);
}
