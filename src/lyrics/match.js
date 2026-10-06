// Relevance scoring, used to reject an upstream result for a different track before it is
// stored or served. The title is the strict gate (all query tokens must be present); the
// artist is deliberately loose, because a collab legitimately credits more or fewer artists
// than the caller named.

function normText(text) {
  if (!text) return '';
  let out = String(text).replace(/\(.*?\)|\[.*?\]/g, ' ');
  out = out.replace(/\b(feat|ft|featuring|with)\b.*$/i, '');
  // Lowercase before filtering: the allowed range starts at lowercase a-z.
  out = out.toLowerCase().replace(/[^0-9a-zÀ-￿]+/g, ' ');
  return out.replace(/\s+/g, ' ').trim();
}

function cjkRatio(text) {
  if (!text) return 0;
  let han = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0);
    if (c >= 0x4e00 && c <= 0x9fff) han++;
  }
  return han / text.length;
}

// Per-character overlap, so Traditional/Simplified pairs still match.
function cjkScore(query, cand) {
  const q = new Set(), c = new Set();
  for (const ch of query) {
    const p = ch.codePointAt(0);
    if (p >= 0x4e00 && p <= 0x9fff) q.add(ch);
  }
  for (const ch of cand) {
    const p = ch.codePointAt(0);
    if (p >= 0x4e00 && p <= 0x9fff) c.add(ch);
  }
  if (!q.size || !c.size) return 0;
  let shared = 0;
  for (const ch of q) if (c.has(ch)) shared++;
  return Math.floor(100 * shared / q.size);
}

const leadingArticle = /^(?:the|a|an)\s+/;

function stripArticle(text) {
  return text.replace(leadingArticle, '');
}

// Reverse coverage: every query token must appear, and a candidate padded with
// unrelated words scores low rather than matching as a raw substring.
function fieldScore(query, cand) {
  const q = stripArticle(normText(query));
  const c = stripArticle(normText(cand));
  if (!q || !c) return 0;
  if (q === c) return 100;

  const qTokens = new Set(q.split(' ').filter(t => t.length > 1));
  const cTokens = new Set(c.split(' ').filter(t => t.length > 1));
  if (qTokens.size === 0) for (const t of q.split(' ')) qTokens.add(t);
  if (cTokens.size === 0) for (const t of c.split(' ')) cTokens.add(t);

  if (qTokens.size && cTokens.size) {
    let matched = 0;
    let all = true;
    for (const t of qTokens) {
      if (cTokens.has(t)) matched++;
      else all = false;
    }
    if (all) return Math.floor(100 * matched / cTokens.size);
  }

  if (cjkRatio(q) > 0.5 && cjkRatio(c) > 0.5) return cjkScore(q, c);
  return 0;
}

const artistSeparators = /\s*(?:,|&|\+|\/|·|、|×)\s*/g;
const artistFeature = /\s*\b(?:feat|ft|featuring|with)\b\.?\s*/gi;
const artistParenFeature = /\((?:feat|ft|featuring|with)\b([^)]*)\)/gi;
// "Tyler, The Creator" is one name, so a separator followed by an article is
// protected before splitting and restored afterwards.
const artistArticleSep = /[,/]\s+(?=(?:the|a|an)\s)/gi;
const SENTINEL = '\ue000';

// Accepts an array (one entry per `artist` param) or a single joined string.
export function splitArtists(value) {
  const parts = Array.isArray(value) ? value : [value];
  const names = [];
  for (const part of parts) {
    let text = String(part).replace(artistParenFeature, ', $1');
    text = text.replace(artistArticleSep, SENTINEL);
    for (const chunk of text.split(artistSeparators)) {
      for (const name of chunk.split(artistFeature)) {
        const clean = name.replace(/[ .,]+$/, '').replace(/^[ .,]+/, '');
        if (clean) names.push(clean.replaceAll(SENTINEL, ', ').replace(/^[ ,]+|[ ,]+$/g, ''));
      }
    }
  }
  return names;
}

// Character-set similarity, so a long unrelated name that merely shares letters
// scores below a genuine stylised spelling.
function jaccard(query, cand) {
  const q = new Set(), c = new Set();
  for (const ch of query) if (!/\s/.test(ch)) q.add(ch);
  for (const ch of cand) if (!/\s/.test(ch)) c.add(ch);
  if (!q.size || !c.size) return 0;
  let shared = 0;
  for (const ch of q) if (c.has(ch)) shared++;
  return Math.floor(100 * shared / (q.size + c.size - shared));
}

const stylisedMin = 70;

function matchOneArtist(name, candArtist) {
  const q = stripArticle(normText(name));
  const c = stripArticle(normText(candArtist));
  if (!q || !c) return 0;
  if (q === c) return 100;

  const qTokens = new Set(q.split(' ').filter(t => t.length > 1));
  const cTokens = new Set(c.split(' ').filter(t => t.length > 1));
  if (qTokens.size === 0) for (const t of q.split(' ')) qTokens.add(t);
  if (cTokens.size === 0) for (const t of c.split(' ')) cTokens.add(t);

  // Forward coverage: extra credited collaborators still match.
  if (qTokens.size) {
    let subset = true;
    for (const t of qTokens) if (!cTokens.has(t)) { subset = false; break; }
    if (subset) return 100;
  }

  if (cjkRatio(q) > 0.5 && cjkRatio(c) > 0.5) return cjkScore(q, c);

  let best = 0;
  for (const candName of splitArtists(candArtist)) {
    const candNorm = stripArticle(normText(candName));
    if (!candNorm) continue;
    const score = jaccard(q, candNorm);
    if (score >= stylisedMin && score > best) best = score;
  }
  return best;
}

// Any one requested artist may satisfy the match.
function artistScore(artist, candArtist, candTitle) {
  const names = splitArtists(artist);
  let best = 0;
  for (const name of names) {
    const score = matchOneArtist(name, candArtist);
    if (score > best) best = score;
  }
  // Some providers credit the artist inside the title instead of the singer field.
  const fromTitle = fieldScore(Array.isArray(artist) ? artist.join(' ') : artist, candTitle);
  return fromTitle > best ? fromTitle : best;
}

export function matchScore(track, artist, candTitle, candArtist) {
  return fieldScore(track, candTitle) + artistScore(artist, candArtist, candTitle);
}

export function isRelevant(track, artist, candTitle, candArtist) {
  if (!normText(track) || !normText(artist)) return true;
  if (!normText(candTitle)) return false;
  if (fieldScore(track, candTitle) < 50) return false;
  const score = artistScore(artist, candArtist, candTitle);
  if (!normText(candArtist) && !score) return true;
  return score >= 40;
}

// Line count vs word count, so a track with only line timings is not treated as karaoke.
export function isWordLevelKaraoke(text) {
  if (!text) return false;
  const content = text.replace(/\[\d+:\d{2}(?:[.:]\d+)?\]|<\d+:\d{2}(?:[.:]\d+)?>/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
  if (['纯音乐请欣赏', '純音樂請欣賞', '纯音乐', '純音樂', 'instrumental',
    'instrumentalmusicpleaseenjoy'].includes(content)) return false;
  const lineTags = (text.match(/\[\d+:\d{2}(?:[.:]\d+)?\]/g) || []).length;
  const wordTags = (text.match(/<\d+:\d{2}(?:[.:]\d+)?>/g) || []).length;
  if (lineTags === 0 || wordTags < 2) return false;
  return wordTags >= lineTags * 1.5;
}

export function lyricsAgree(reference, candidate) {
  if (!reference) return true;
  const normalize = text => String(text || '').normalize('NFKC').toLowerCase()
    .replace(/\[[^\]]*\]|<[^>]*>|\{agent:[^}]*\}/g, '')
    .replace(/\([^\n)]*\)/g, '')
    .replace(/[^\p{L}\p{N}\p{M}]/gu, '');
  const left = normalize(reference), right = normalize(candidate);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length < 40 || right.length < 40) return false;
  const grams = text => new Set(Array.from({ length: text.length - 4 }, (_, i) => text.slice(i, i + 5)));
  const a = grams(left), b = grams(right);
  let shared = 0;
  for (const part of a) if (b.has(part)) shared++;
  return shared / a.size >= 0.75 && shared / b.size >= 0.75;
}
