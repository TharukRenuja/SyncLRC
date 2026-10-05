// Fold names for lookup while preserving non-Latin scripts and removing combining marks.
export function fold(value) {
  let text = String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '');
  text = text.toLowerCase();
  text = text.replace(/['\u2019\u2010-\u2015-]/g, '');
  text = text.replace(/[^\p{L}\p{N}]+/gu, ' ');
  return text.trim().replace(/\s+/g, ' ').normalize('NFC');
}

// Canonical lookup key used for dedupe and row ids.
export function normalizeKey(track, artist) {
  return `${fold(track)}:${fold(artist)}`;
}

export async function generateHash(track, artist) {
  const data = new TextEncoder().encode(normalizeKey(track, artist));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .slice(0, 16)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Shared identity helpers.

export function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function normalizeIsrc(value) {
  const isrc = String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/.test(isrc) ? isrc : null;
}

export function lookupKeys(track, artists) {
  const names = unique(artists.map(a => a.trim()).filter(Boolean));
  const keys = names.map(name => normalizeKey(track, name));
  if (names.length > 1) keys.push(normalizeKey(track, names.join(' ')));
  return unique(keys);
}

export function stripSearchArtistPrefix(trackName, artistName) {
  if (!artistName || !trackName) return trackName;
  const prefix = `${artistName} - `;
  if (!trackName.toLowerCase().startsWith(prefix.toLowerCase())) return trackName;
  return trackName.slice(prefix.length).trim() || trackName;
}

// Strip LRCLib's occasional "Artist - Title" prefix before hashing.

export async function searchAltId(trackName, artistName) {
  const stripped = stripSearchArtistPrefix(trackName, artistName);
  return stripped !== trackName ? generateHash(stripped, artistName) : null;
}
