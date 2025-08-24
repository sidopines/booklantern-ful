// connectors/utils.js
// Shared helpers + a normalized "card" shape for all content sources.

const DEFAULT_UA = 'BookLantern/1.0 (+booklantern.org)';

/** Small fetch with timeout + default UA headers */
async function fetchWithTimeout(url, { timeout = 15000, headers = {}, ...opts } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      ...opts,
      headers: {
        'User-Agent': DEFAULT_UA,
        'Accept': 'application/json,text/plain,*/*',
        ...headers,
      },
      signal: ctrl.signal,
      redirect: 'follow'
    });
    return res;
  } finally {
    clearTimeout(t);
  }
}

/** JSON fetch helper that returns {} on failure (never throws) */
async function fetchJson(url, opts = {}) {
  try {
    const r = await fetchWithTimeout(url, { ...opts, headers: { Accept: 'application/json', ...(opts.headers || {}) } });
    if (!r.ok) return {};
    return await r.json();
  } catch {
    return {};
  }
}

/** Strip <script>, <style>, <noscript>, event handlers, and inline JS URLs. */
function sanitizeHtml(html = '') {
  if (!html || typeof html !== 'string') return '';
  let out = html;

  // remove scripts/styles/noscript
  out = out.replace(/<script[\s\S]*?<\/script>/gi, '');
  out = out.replace(/<style[\s\S]*?<\/style>/gi, '');
  out = out.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');

  // remove on* handlers (onclick, onload, etc.)
  out = out.replace(/\s+on[a-z]+\s*=\s*(['"]).*?\1/gi, '');

  // neutralize javascript: URLs
  out = out.replace(/(href|src)\s*=\s*(['"])\s*javascript:[^'"]*\2/gi, '$1="#"');

  return out;
}

/**
 * Normalized card shape used across sources.
 * - identifier: unique (e.g., 'gutenberg:1342', 'wikisource:en:Some_Page')
 * - title, creator, cover
 * - source: 'gutenberg' | 'wikisource' | 'archive' | 'openlibrary' | 'local' | etc.
 * - readerUrl: in-site route to actually read (if inline-readable)
 * - rights: 'pd' | 'cc' | 'linkout' | 'borrow'  (we only render inline when 'pd' or permitted 'cc')
 * - type: 'epub' | 'html' | 'pdf' | 'iiif' | 'external'
 * - meta: optional object for extras
 */
function mkCard({
  identifier,
  title,
  creator = '',
  cover = '',
  source = '',
  readerUrl = '',
  rights = 'pd',
  type = 'external',
  meta = {}
}) {
  return {
    identifier,
    title: title || '(Untitled)',
    creator,
    cover,
    source,
    readerUrl,
    rights,
    type,
    meta
  };
}

/** True if our site can render this inline without forcing users off-site. */
function isInlineReadable(card) {
  if (!card) return false;
  if (card.rights !== 'pd' && card.rights !== 'cc') return false;
  // Must have a type we know how to show + a readerUrl on our site
  const okType = new Set(['epub', 'html', 'pdf', 'iiif']);
  return okType.has(card.type) && typeof card.readerUrl === 'string' && card.readerUrl.startsWith('/');
}

/** Small utility: deduplicate by key (e.g., title|creator) */
function uniqBy(arr, keyFn) {
  const seen = new Set();
  const out = [];
  for (const it of arr || []) {
    const k = keyFn(it);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

/** Prefer best cover among candidates (first non-empty wins) */
function pickCover(...urls) {
  for (const u of urls) {
    if (u && typeof u === 'string' && u.trim()) return u;
  }
  return '';
}

/** Build a friendly brand label from a source key */
function brandForSource(src = '') {
  const s = String(src).toLowerCase();
  if (s === 'gutenberg') return 'Project Gutenberg';
  if (s === 'wikisource') return 'Wikisource';
  if (s === 'archive') return 'Archive.org';
  if (s === 'openlibrary') return 'Open Library';
  if (s === 'standardebooks') return 'Standard Ebooks';
  return 'Book';
}

module.exports = {
  fetchWithTimeout,
  fetchJson,
  sanitizeHtml,
  mkCard,
  isInlineReadable,
  uniqBy,
  pickCover,
  brandForSource,
};
