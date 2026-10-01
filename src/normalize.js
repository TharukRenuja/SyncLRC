// Fold names for lookup while preserving non-Latin scripts and removing combining marks.
function fold(value) {
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
