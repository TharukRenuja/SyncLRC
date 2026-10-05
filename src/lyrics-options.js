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
    const clock = value => value.replace(/^(\d+:\d{2}):(\d+)$/, '$1.$2');
    const words = [...match[2].matchAll(/<(\d+:\d{2}(?:[.:]\d+)?)>([^<]*)/g)];
    const text = words.length ? words.map(([,time,text]) => `<span begin="${clock(time)}">${XML_ESCAPE(text)}</span>`).join('') : XML_ESCAPE(match[2]);
    return `<p begin="${clock(match[1])}">${text}</p>`;
  });
  // Start-only cached LRC cannot supply exact word ends or native vocal roles.
  return `<tt xmlns="http://www.w3.org/ns/ttml"><body><div>${paragraphs.join('')}</div></body></tt>`;
}

export async function withLyricOptions(response, options, env, timeoutMs) {
  const body = await response.json();
  if (!response.ok) {
    if (options.hasInclude) {
      body.features = { requested: options.requested, included: [],
        unavailable: response.status === 404 ? options.requested : [],
        unknown: response.status === 404 ? [] : options.requested };
    }
    return new Response(JSON.stringify(body), { status: response.status, headers: response.headers });
  }
  let lyrics = body.lyrics || body.karaoke || body.synced || body.plain || null;
  let type = body.type || (body.karaoke ? 'karaoke' : body.synced ? 'synced' : 'plain');
  let features;
  let native = false;
  if (options.hasInclude) {
    features = { requested: options.requested, included: [], unavailable: [], unknown: options.requested };
    if (body.instrumental) {
      features.unavailable = options.requested;
      features.unknown = [];
    } else {
      const params = new URLSearchParams({ track: body.track,
        format: options.format, include: options.requested.join(',') });
      for (const artist of new Set([...(options.artists || []), body.artist].filter(Boolean))) params.append('artist', artist);
      try {
        const upstream = await fetch(`${env.UPSTREAM_URL}/lyrics?${params}`, {
          headers: { 'X-SyncLRC-Secret': env.UPSTREAM_SECRET }, signal: AbortSignal.timeout(timeoutMs)
        });
        if (upstream.status === 404) {
          features.unavailable = options.requested;
          features.unknown = [];
        } else if (upstream.ok) {
          const data = await upstream.json();
          const metadata = data.features;
          const validMetadata = metadata && ['included', 'unavailable', 'unknown'].every(key =>
            Array.isArray(metadata[key]) && metadata[key].every(feature => options.requested.includes(feature)));
          const categorized = validMetadata ? [...metadata.included, ...metadata.unavailable, ...metadata.unknown] : [];
          if (data.success === true && typeof data.lyrics === 'string' && data.lyrics.trim() &&
              data.format === options.format && validMetadata && categorized.length === options.requested.length &&
              new Set(categorized).size === options.requested.length) {
            lyrics = data.lyrics;
            type = data.type || 'karaoke';
            features = { requested: options.requested, included: metadata.included,
              unavailable: metadata.unavailable, unknown: metadata.unknown };
            native = true;
            if (data.provider) body.provider = data.provider;
          }
        }
      } catch { }
    }
  }
  delete body.karaoke;
  delete body.synced;
  delete body.plain;
  body.lyrics = lyrics && options.format === 'ttml' && !native ? lrcToTtml(lyrics) : lyrics;
  body.type = type;
  body.format = options.format;
  if (features) body.features = features;
  return new Response(JSON.stringify(body), { status: response.status, headers: response.headers });
}
