// utils/bookHelpers.js
// Shared helpers for canonical book identity and URL building

/**
 * Produce a canonical book key.
 * Archive-backed items always get `bl-book-<archive_id>`.
 * Other providers get `<provider>-<provider_id>`.
 * Prevents duplicates from mixed prefixes (archive-, bl-book-, etc).
 *
 * @param {object} meta - { archive_id, provider, provider_id, bookKey }
 * @returns {string} canonical key
 */
function canonicalBookKey(meta) {
  // 1. Derive the raw archive id (strip every known prefix)
  const rawArchiveId = extractArchiveId(meta);
  if (rawArchiveId) return 'bl-book-' + rawArchiveId;

  // 2. Known non-archive provider
  const provider = (meta.provider || meta.source || 'unknown').toLowerCase();
  const id = meta.provider_id || meta.bookKey || meta.book_key || '';
  if (provider && provider !== 'unknown' && id) {
    return provider + '-' + id;
  }

  // 3. Fallback: hash title+author
  const str = (meta.title || '') + (meta.author || '');
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return 'book-' + Math.abs(hash);
}

/**
 * Extract the bare archive.org identifier from any combination of fields.
 * Strips bl-book-, archive- prefixes and parses archive.org URLs.
 *
 * @param {object} meta
 * @returns {string|null}
 */
function extractArchiveId(meta) {
  if (!meta) return null;

  // Explicit archive_id field
  if (meta.archive_id) return stripPrefixes(meta.archive_id);

  // source_url containing archive.org/details/<id>
  const src = meta.source_url || meta.sourceUrl || '';
  if (src.includes('archive.org/details/')) {
    const m = src.match(/archive\.org\/details\/([^/?#]+)/);
    if (m) return m[1];
  }

  // provider_id that is an archive URL
  const pid = meta.provider_id || meta.bookKey || meta.book_key || '';
  if (pid.includes('archive.org')) {
    const m = pid.match(/archive\.org\/details\/([^/?#]+)/);
    if (m) return m[1];
  }

  // provider_id with bl-book- or archive- prefix
  const stripped = stripPrefixes(pid);
  if (stripped && stripped !== pid) return stripped;

  // provider is archive → provider_id is the id
  const prov = (meta.provider || meta.source || '').toLowerCase();
  if (prov === 'archive' && pid) return stripPrefixes(pid);

  // cover URL containing archive.org/services/img/<id>
  const cover = meta.cover || meta.cover_url || '';
  if (cover.includes('archive.org/services/img/')) {
    const m = cover.match(/archive\.org\/services\/img\/([^/?#]+)/);
    if (m) return m[1];
  }

  return null;
}

/**
 * Strip bl-book- and archive- prefixes to obtain a bare archive id.
 */
function stripPrefixes(key) {
  if (!key || typeof key !== 'string') return null;
  let id = key;
  while (id.startsWith('bl-book-')) id = id.slice(8);
  if (id.startsWith('archive-')) id = id.slice(8);
  return id || null;
}

/**
 * Normalize book metadata by extracting information from JWT tokens,
 * archive.org URLs, and other embedded data.
 * Fixes provider=unknown and numeric provider_id issues.
 *
 * @param {object} meta - raw book metadata
 * @returns {object} normalized copy
 */
function normalizeMeta(meta) {
  if (!meta) return meta;
  const result = { ...meta };

  // --- Step 1: Decode JWT payload from source_url containing a token ---
  const sourceUrl = result.source_url || result.sourceUrl || '';
  if (sourceUrl.includes('/unified-reader?token=') || sourceUrl.includes('token=')) {
    try {
      const tokenMatch = sourceUrl.match(/[?&]token=([^&]+)/);
      if (tokenMatch) {
        const token = decodeURIComponent(tokenMatch[1]);
        const dotIdx = token.indexOf('.');
        const b64 = dotIdx > 0 ? token.slice(0, dotIdx) : token;
        const payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
        // Unwrap nested { data: { ... } } format from helpers/buildReaderToken
        const fields = payload.data || payload;

        if (fields.provider && (!result.provider || result.provider === 'unknown')) {
          result.provider = fields.provider;
        }
        if (fields.provider_id && (!result.provider_id || /^\d+$/.test(result.provider_id) || result.provider_id.startsWith('book-'))) {
          result.provider_id = fields.provider_id;
        }
        if (fields.archive_id && !result.archive_id) {
          result.archive_id = fields.archive_id;
        }
        if (fields.direct_url && !result.direct_url) {
          result.direct_url = fields.direct_url;
        }
        // Store the real source_url from the token separately
        if (fields.source_url && fields.source_url.includes('archive.org')) {
          result._token_source_url = fields.source_url;
        }
        if (fields.title && !result.title) result.title = fields.title;
        if (fields.author && !result.author) result.author = fields.author;
        if ((fields.cover_url || fields.cover) && !result.cover && !result.cover_url) {
          result.cover_url = fields.cover_url || fields.cover;
        }
        if (fields.format && !result.format) result.format = fields.format;
      }
    } catch (_e) { /* token decode failed — continue */ }
  }

  // --- Step 2: Extract archive ID from direct_url ---
  const directUrl = result.direct_url || '';
  if (directUrl.includes('archive.org/download/')) {
    const m = directUrl.match(/archive\.org\/download\/([^/?#]+)/);
    if (m) {
      if (!result.archive_id) result.archive_id = m[1];
      if (!result.provider || result.provider === 'unknown') result.provider = 'archive';
    }
  }

  // --- Step 3: Extract archive ID from source_url (details page) ---
  const realSrc = result._token_source_url || sourceUrl;
  if (realSrc.includes('archive.org/details/')) {
    const m = realSrc.match(/archive\.org\/details\/([^/?#]+)/);
    if (m) {
      if (!result.archive_id) result.archive_id = m[1];
      if (!result.provider || result.provider === 'unknown') result.provider = 'archive';
    }
  }

  // --- Step 4: Fix provider_id for archive books ---
  if (result.provider === 'archive' && result.archive_id) {
    if (!result.provider_id || /^\d+$/.test(result.provider_id) || result.provider_id.startsWith('book-')) {
      result.provider_id = result.archive_id;
    }
  }

  // Clean up temp field
  delete result._token_source_url;

  return result;
}

/**
 * Build a /open?... URL for a book.
 * Always includes enough metadata so /open can resolve without a search fallback.
 * Runs normalizeMeta first to ensure provider/provider_id are correct.
 *
 * @param {object} meta - { provider, provider_id, archive_id, title, author, cover,
 *                          format, direct_url, source_url }
 * @param {string} [ref] - back-link (default '/read')
 * @returns {string} e.g. "/open?provider=archive&provider_id=someid&title=..."
 */
function buildOpenUrl(meta, ref) {
  const n = normalizeMeta(meta) || meta;
  const archiveId = extractArchiveId(n);
  const params = new URLSearchParams();

  if (archiveId) {
    params.set('provider', 'archive');
    params.set('provider_id', archiveId);
    params.set('archive_id', archiveId);
  } else {
    const prov = n.provider || n.source || 'unknown';
    const pid = n.provider_id || n.bookKey || n.book_key || '';
    if (prov === 'unknown' && !pid) return null; // unresolvable
    params.set('provider', prov);
    params.set('provider_id', pid);
  }

  if (n.title)      params.set('title', n.title);
  if (n.author)     params.set('author', n.author);
  if (n.cover || n.cover_url) params.set('cover', n.cover || n.cover_url);
  if (n.format)     params.set('format', n.format);
  if (n.direct_url) params.set('direct_url', n.direct_url);
  if (n.source_url || n.sourceUrl) params.set('source_url', n.source_url || n.sourceUrl);
  if (ref)          params.set('ref', ref);

  return '/open?' + params.toString();
}

module.exports = { canonicalBookKey, extractArchiveId, stripPrefixes, buildOpenUrl, normalizeMeta };
