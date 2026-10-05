import { renderDocument, featureStatus } from './document.js';
const FEATURES = ['agents', 'background'];
const XML_ESCAPE = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

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
  return { format, requested, hasInclude, artists: url.searchParams.getAll('artist').map(value => value.trim()).filter(Boolean) };
}

export function lrcToTtml(lyrics) {
  const paragraphs = lyrics.split('\n').filter(line => line.trim()).map(line => {
    const match = line.match(/^\[(\d+:\d{2}(?:[.:]\d+)?)\](.*)$/);
    if (!match) return `<p>${XML_ESCAPE(line)}</p>`;
    const clock = value => {
      const normalized = value.replace(/^(\d+:\d{2}):(\d+)$/, '$1.$2');
      const [minutes, seconds] = normalized.split(':');
      return `${String(Math.floor(Number(minutes) / 60)).padStart(2, '0')}:${String(Number(minutes) % 60).padStart(2, '0')}:${seconds}`;
    };
    const words = [...match[2].matchAll(/<(\d+:\d{2}(?:[.:]\d+)?)>([^<]*)/g)];
    const text = words.length ? words.map(([,time,text]) => `<span begin="${clock(time)}">${XML_ESCAPE(text)}</span>`).join('') : XML_ESCAPE(match[2]);
    return `<p begin="${clock(match[1])}">${text}</p>`;
  });
  return `<tt xmlns="http://www.w3.org/ns/ttml"><body><div>${paragraphs.join('')}</div></body></tt>`;
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
