import { sanitizeLyrics } from './sanitize.js';

export function detectType(lyrics) {
  if (!lyrics) return 'plain';
  const wordPattern = /<\d+:\d{2}[.:]\d+>/;
  const linePattern = /\[\d+:\d{2}[.:]\d+\]/;
  if (wordPattern.test(lyrics)) return 'karaoke';
  if (linePattern.test(lyrics)) return 'synced';
  return 'plain';
}

export function convertLyrics(lyrics, currentType, targetType) {
  if (!targetType || currentType === targetType) return [lyrics, currentType];
  if (targetType === 'karaoke') return [lyrics, currentType];

  if (targetType === 'synced') {
    if (currentType === 'karaoke') {
      const clean = lyrics.replace(/<\d+:\d{2}[.:]\d+>/g, '');
      const lines = clean.split('\n').map(l => l.replace(/ +/g, ' ').trim());
      return [lines.join('\n'), 'synced'];
    }
    return [lyrics, currentType];
  }

  if (targetType === 'plain') {
    let text = lyrics.replace(/\[\d+:\d{2}[.:]\d+\]/g, '');
    text = text.replace(/<\d+:\d{2}[.:]\d+>/g, '');
    const lines = text.split('\n')
      .map(l => l.replace(/ +/g, ' ').trim())
      .filter(l => l);
    return [lines.join('\n'), 'plain'];
  }

  return [lyrics, currentType];
}

// Tries each requested artist in turn; a collab may be indexed under any one of them.

export function pickType(combined) {
  return combined.karaoke ? 'karaoke' : combined.synced ? 'synced' : 'plain';
}

export function buildCombined(lrclibData, karaokeLyrics) {
  const combined = { karaoke: null, synced: null, plain: null };

  if (karaokeLyrics) {
    combined.karaoke = sanitizeLyrics(karaokeLyrics);
  }

  if (combined.karaoke) {
    const [synced] = convertLyrics(combined.karaoke, 'karaoke', 'synced');
    combined.synced = sanitizeLyrics(synced) || null;
    const [plain] = convertLyrics(combined.karaoke, 'karaoke', 'plain');
    combined.plain = sanitizeLyrics(plain) || null;
  } else if (lrclibData) {
    combined.synced = lrclibData.syncedLyrics || null;
    combined.plain = lrclibData.plainLyrics || null;
    if (combined.synced) combined.synced = sanitizeLyrics(combined.synced);
    if (combined.plain) combined.plain = sanitizeLyrics(combined.plain);
  }

  return combined;
}
