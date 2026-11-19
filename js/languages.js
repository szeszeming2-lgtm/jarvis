// Languages the live translator offers (speech recognition + voices exist for these on most devices).
export const LANGS = [
  ['en-US', 'English'], ['es-ES', 'Spanish'], ['fr-FR', 'French'], ['de-DE', 'German'], ['it-IT', 'Italian'], ['pt-BR', 'Portuguese'],
  ['zh-CN', 'Chinese (Mandarin)'], ['zh-HK', 'Cantonese'], ['ja-JP', 'Japanese'], ['ko-KR', 'Korean'], ['hi-IN', 'Hindi'], ['ar-SA', 'Arabic'],
  ['ru-RU', 'Russian'], ['uk-UA', 'Ukrainian'], ['nl-NL', 'Dutch'], ['pl-PL', 'Polish'], ['tr-TR', 'Turkish'], ['el-GR', 'Greek'], ['he-IL', 'Hebrew'],
  ['sv-SE', 'Swedish'], ['vi-VN', 'Vietnamese'], ['th-TH', 'Thai'], ['id-ID', 'Indonesian'], ['ms-MY', 'Malay'], ['fil-PH', 'Filipino'],
];
export const nameOf = (code) => LANGS.find((l) => l[0] === code)?.[1] || code;
/** "spanish" → 'es-ES' */
export function findLang(word) {
  const w = String(word || '').toLowerCase().trim();
  if (!w) return '';
  const alias = { mandarin: 'zh-CN', chinese: 'zh-CN', cantonese: 'zh-HK', tagalog: 'fil-PH', farsi: '', persian: '', brazilian: 'pt-BR' };
  if (w in alias) return alias[w];
  return LANGS.find(([c, n]) => n.toLowerCase().startsWith(w) || c.toLowerCase() === w)?.[0] || '';
}
