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
 * Build a /open?... URL for a book.
 * Always includes enough metadata so /open can resolve without a search fallback.
 *
 * @param {object} meta - { provider, provider_id, archive_id, title, author, cover,
 *                          format, direct_url, source_url }
 * @param {string} [ref] - back-link (default '/read')
 * @returns {string} e.g. "/open?provider=archive&provider_id=someid&title=..."
 */
function buildOpenUrl(meta, ref) {
  const archiveId = extractArchiveId(meta);
  const params = new URLSearchParams();

  if (archiveId) {
    params.set('provider', 'archive');
    params.set('provider_id', archiveId);
    params.set('archive_id', archiveId);
  } else {
    params.set('provider', meta.provider || meta.source || 'unknown');
    params.set('provider_id', meta.provider_id || meta.bookKey || meta.book_key || '');
  }

  if (meta.title)      params.set('title', meta.title);
  if (meta.author)     params.set('author', meta.author);
  if (meta.cover || meta.cover_url) params.set('cover', meta.cover || meta.cover_url);
  if (meta.format)     params.set('format', meta.format);
  if (meta.direct_url) params.set('direct_url', meta.direct_url);
  if (meta.source_url || meta.sourceUrl) params.set('source_url', meta.source_url || meta.sourceUrl);
  if (ref)             params.set('ref', ref);

  return '/open?' + params.toString();
}

module.exports = { canonicalBookKey, extractArchiveId, stripPrefixes, buildOpenUrl };
