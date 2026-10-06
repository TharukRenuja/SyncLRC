import { renderDocument, featureStatus } from './document.js';
const FEATURES = ['agents', 'background'];
const xmlEscape = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function lyricOptions(url) {
  const explicitFormat = url.searchParams.has('format');
  const hasInclude = url.searchParams.has('include');
  if (!explicitFormat && !hasInclude) return null;
  const format = (url.searchParams.get('format') || 'lrc').trim().toLowerCase();
  const requested = [...new Set((url.searchParams.get('include') || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean))];
  if (!['lrc', 'ttml'].includes(format)) throw new Error('Valid formats: lrc, ttml.');
  if (hasInclude && (!requested.length || requested.some(value => !FEATURES.includes(value)))) {
    throw new Error('Valid include features: agents, background.');
  }
  const type = url.searchParams.get('type');
  if (hasInclude && type && type !== 'karaoke') throw new Error('Vocal features require type=karaoke or an omitted type.');
  return { format, requested, hasInclude };
}

export function lrcToTtml(lyrics) {
  const seconds = value => {
    const parts = value.replace(/^(\d+:\d{2}):(\d+)$/, '$1.$2').split(':');
    return parts.reduce((total, part) => total * 60 + Number(part), 0);
  };
  const clock = value => {
    const ms = Math.round(value * 1000);
    return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
  };
  const lines = lyrics.split('\n').filter(line => line.trim()).map(line => {
    const match = line.match(/^\[(\d+:\d{2}(?:[.:]\d+)?)\](.*)$/);
    if (!match) return { text: line, words: [] };
    const words = [...match[2].matchAll(/<(\d+:\d{2}(?:[.:]\d+)?)>([^<]*)/g)]
      .map(([,time,text]) => ({ start: seconds(time), text }));
    return { start: seconds(match[1]), text: match[2], words };
  });
  const wordTiming = lines.some(line => line.words.some(word => word.text.trim()));
  const paragraphs = lines.map((line, index) => {
    if (line.start === undefined) return `<p itunes:key="L${index + 1}">${xmlEscape(line.text)}</p>`;
    const last = line.words.at(-1)?.start ?? line.start;
    // start-only LRC ends are estimates; native TTML keeps its original intervals.
    const end = Math.max(lines[index + 1]?.start ?? last + 3, last + 0.001);
    const text = line.words.length ? line.words.map((word, i) => {
      if (!word.text.trim()) return '';
      const wordEnd = line.words.slice(i + 1).find(next => next.start > word.start)?.start ?? end;
      return `<span begin="${clock(word.start)}" end="${clock(wordEnd)}">${xmlEscape(word.text)}</span>`;
    }).join('') : xmlEscape(line.text);
    return `<p itunes:key="L${index + 1}" begin="${clock(line.start)}" end="${clock(end)}">${text}</p>`;
  });
  return `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" itunes:timing="${wordTiming ? 'Word' : 'Line'}"><body><div>${paragraphs.join('')}</div></body></tt>`;
}

export function renderOptions(combined, body, options) {
  let lyrics = body.lyrics || body.karaoke || body.synced || body.plain || null;
  let type = body.type || (body.karaoke ? 'karaoke' : body.synced ? 'synced' : 'plain');
  const requested = options.hasInclude ? options.requested : [];
  if (combined.rich?.ttml && (!body.type || body.type === 'karaoke')) {
    lyrics = renderDocument(combined.rich, options.format, requested);
    type = 'karaoke';
  } else if (lyrics && options.format === 'ttml') lyrics = lrcToTtml(lyrics);
  const result = { lyrics, type, format: options.format };
  if (options.hasInclude) result.features = featureStatus(combined, requested, body.instrumental);
  return result;
}
