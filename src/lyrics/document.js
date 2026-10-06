import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

export const vocalFeatures = ['agents', 'background'];
export const featureRefreshMs = 24 * 60 * 60 * 1000;
export const featureRetryMs = 5 * 60 * 1000;
const META = 'http://www.w3.org/ns/ttml#metadata';
const ROLES = { 'x-bg': 'background', 'x-translation': 'translation', 'x-roman': 'romanization', 'x-transliteration': 'romanization' };
const elements = node => Array.from(node.getElementsByTagName('*'));
const roles = node => (node.getAttributeNS(META, 'role') || '').split(/\s+/).map(value => ROLES[value]).filter(Boolean);
const role = node => roles(node)[0];

function parse(xml) {
  if (typeof xml !== 'string' || /<!DOCTYPE/i.test(xml)) throw new Error('Invalid TTML');
  const doc = new DOMParser({ onError: (_level, message) => { throw new Error(message); } }).parseFromString(xml, 'application/xml');
  if (doc.documentElement?.localName !== 'tt' || doc.documentElement.namespaceURI !== 'http://www.w3.org/ns/ttml') throw new Error('Invalid TTML root');
  return doc;
}

function filtered(xml, requested) {
  const doc = parse(xml);
  for (const node of elements(doc)) {
    if (roles(node).some(feature => !requested.includes(feature))) node.parentNode?.removeChild(node);
    if (!requested.includes('agents')) {
      node.removeAttributeNS(META, 'agent');
      if (node.localName === 'agent' && node.namespaceURI === META) node.parentNode?.removeChild(node);
    }
  }
  return doc;
}

function clock(value) {
  if (!value) return null;
  let seconds;
  const offset = value.match(/^(\d+(?:\.\d+)?)(ms|s|m|h)?$/);
  if (offset) seconds = Number(offset[1]) * ({ ms: .001, s: 1, m: 60, h: 3600 }[offset[2]] || 1);
  else if (/^\d+:\d{2}(?::\d{2})?(?:\.\d+)?$/.test(value)) {
    const parts = value.split(':');
    if (Number(parts.at(-1)) >= 60 || (parts.length === 3 && Number(parts[1]) >= 60)) return null;
    seconds = parts.reduce((total, part) => total * 60 + Number(part), 0);
  }
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const centis = Math.round(seconds * 100);
  return `${String(Math.floor(centis / 6000)).padStart(2, '0')}:${String(Math.floor(centis / 100) % 60).padStart(2, '0')}.${String(centis % 100).padStart(2, '0')}`;
}

function renderLrc(doc) {
  const lines = [];
  function add(node, stamp, agent, background = false) {
    const parts = [];
    function visit(element, inherited, root = false) {
      if (!root && role(element)) return;
      const voice = element.getAttributeNS(META, 'agent') || inherited;
      for (const child of Array.from(element.childNodes)) {
        if (child.nodeType === 1) visit(child, voice);
        else if ((child.nodeType === 3 || child.nodeType === 4) && child.data.trim()) {
          const time = element.localName === 'span' ? clock(element.getAttribute('begin')) : null;
          parts.push({ agent: voice, text: child.data.trim(), time });
        }
      }
    }
    visit(node, agent, true);
    if (!parts.length) return;
    if (background && parts[0].text.startsWith('(') && parts.at(-1).text.endsWith(')')) {
      parts[0].text = parts[0].text.slice(1);
      parts.at(-1).text = parts.at(-1).text.slice(0, -1);
    }
    let current = parts[0].agent;
    const prefix = current ? `{agent:${current}}` : '';
    const words = parts.map(part => {
      const marker = part.agent !== current ? `{agent:${part.agent || 'unknown'}}` : '';
      current = part.agent;
      return marker + (part.time ? `<${part.time}>` : '') + part.text;
    }).join(' ');
    lines.push(`[${stamp}]${prefix}${background ? '(' + words + ')' : words}`);
  }
  for (const para of elements(doc).filter(node => node.localName === 'p')) {
    const stamp = clock(para.getAttribute('begin'));
    if (!stamp) continue;
    const agent = para.getAttributeNS(META, 'agent') || null;
    if (!role(para)) add(para, stamp, agent);
    function background(node, inherited) {
      const voice = node.getAttributeNS(META, 'agent') || inherited;
      if (role(node) === 'background') add(node, clock(node.getAttribute('begin')) || stamp, voice, true);
      for (const child of Array.from(node.childNodes).filter(child => child.nodeType === 1)) background(child, voice);
    }
    background(para, agent);
  }
  return lines.join('\n');
}

export function renderDocument(rich, format, requested = []) {
  const doc = filtered(rich.ttml, requested);
  return format === 'ttml' ? new XMLSerializer().serializeToString(doc.documentElement, { requireWellFormed: true }) : renderLrc(doc);
}

export function decodeDocument(data) {
  const checkedAt = Date.now();
  if (data?.format !== 'ttml') {
    const lyrics = data?.lyrics ?? data?.karaoke;
    if (typeof lyrics !== 'string' || !/<\d+:\d{2}[.:]\d+>/.test(lyrics)) throw new Error('Invalid lyric response');
    return { lyrics, rich: { ttml: null, checkedAt, included: [], unavailable: [], unknown: vocalFeatures } };
  }
  const doc = parse(data.lyrics);
  if (!elements(doc).some(node => node.localName === 'span' && clock(node.getAttribute('begin')))) throw new Error('TTML is not word-timed');
  const included = vocalFeatures.filter(feature => elements(doc).some(node => feature === 'agents' ? node.hasAttributeNS(META, 'agent') : role(node) === feature));
  const unavailable = vocalFeatures.filter(feature => !included.includes(feature) && data.features?.unavailable?.includes(feature));
  const rich = { ttml: data.lyrics, provider: data.provider || null, checkedAt, included, unavailable,
    unknown: vocalFeatures.filter(feature => !included.includes(feature) && !unavailable.includes(feature)) };
  const lyrics = renderDocument(rich, 'lrc');
  if (!/<\d+:\d{2}[.:]\d+>/.test(lyrics)) throw new Error('TTML lacks usable lead lyrics');
  return { lyrics, rich };
}

export function mergeRich(previous, next) {
  if (!next) return previous;
  if (!previous?.ttml || previous.included.every(feature => next.included.includes(feature))) return next;
  // Keep a richer document rather than combining mismatched providers' timing.
  const missing = vocalFeatures.filter(feature => !previous.included.includes(feature));
  return { ...previous, checkedAt: next.checkedAt,
    unavailable: missing.filter(feature => next.unavailable.includes(feature)),
    unknown: missing.filter(feature => !next.unavailable.includes(feature)) };
}

export function applyDocument(combined, rich) {
  const merged = mergeRich(combined.rich, rich);
  if (!merged) return combined;
  return { ...combined, rich: merged, karaoke: merged.ttml ? renderDocument(merged, 'lrc') : combined.karaoke };
}

export function featureDue(combined, requested = vocalFeatures, now = Date.now()) {
  if (!combined.rich) return true;
  const missing = requested.filter(feature => !combined.rich.included.includes(feature));
  if (!missing.length) return false;
  const interval = missing.some(feature => combined.rich.unknown.includes(feature)) ? featureRetryMs : featureRefreshMs;
  return now >= combined.rich.checkedAt + interval;
}

export function featureStatus(combined, requested, instrumental = false) {
  const nodes = combined.rich?.ttml ? elements(filtered(combined.rich.ttml, requested)) : [];
  const included = requested.filter(feature => nodes.some(node => feature === 'agents' ? !!node.getAttributeNS(META, 'agent') : role(node) === feature));
  const unavailable = requested.filter(feature => !included.includes(feature) && (instrumental || combined.rich?.unavailable?.includes(feature) || combined.rich?.included?.includes(feature)));
  return { requested, included, unavailable, unknown: requested.filter(feature => !included.includes(feature) && !unavailable.includes(feature)) };
}

export function nextFeatureCheck(rich) {
  if (rich.included.length === vocalFeatures.length) return Date.now() + 100 * 365 * featureRefreshMs;
  return rich.checkedAt + (rich.unknown.length ? featureRetryMs : featureRefreshMs);
}
