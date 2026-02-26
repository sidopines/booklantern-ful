/* utils/buildReaderToken.js */
const crypto = require('crypto');

/**
 * Resolve the token signing secret.
 * Cascades through several common env-var names so it works on any host
 * (Render, Railway, Fly, local dev) without requiring a specific name.
 * Returns the secret string or null (with a loud log) if none is found.
 */
function getReaderTokenSecret() {
  const s = process.env.APP_SIGNING_SECRET
         || process.env.READER_TOKEN_SECRET
         || process.env.JWT_SECRET
         || process.env.SESSION_SECRET;
  if (!s) {
    console.error('[token] CRITICAL: No signing secret found. Set APP_SIGNING_SECRET (or READER_TOKEN_SECRET / JWT_SECRET / SESSION_SECRET).');
    return null;
  }
  return s;
}

// Startup check — log once so missing secret is obvious in deploy logs
(function _checkSecret() {
  const s = getReaderTokenSecret();
  if (s) {
    console.log(`[token] Signing secret resolved (length=${s.length})`);
  }
})();

/**
 * Very small HMAC-signed token for unified-reader.
 * payload: {provider, provider_id, format, direct_url, title, author, cover_url, back, exp}
 *
 * P0: NEVER mint a token with empty direct_url for epub/pdf — the reader will
 *     crash with "No valid URL provided" or ePub.js indexOf errors.
 */
function buildReaderToken(payload) {
  const secret = getReaderTokenSecret();
  if (!secret) throw new Error('Cannot sign reader token: no secret configured');

  const data = { ...payload };

  // --- P0 strict validation: require a usable direct_url (or archive_id) ---
  const fmt = (data.format || 'epub').toLowerCase();
  const hasDirectUrl = data.direct_url && typeof data.direct_url === 'string' && data.direct_url.trim().length > 0;
  const hasArchiveId = data.archive_id && typeof data.archive_id === 'string' && data.archive_id.trim().length > 0;

  if (!hasDirectUrl && !hasArchiveId) {
    // Attempt lightweight derivation before rejecting
    const prov = (data.provider || '').toLowerCase();
    const pid  = data.provider_id || '';
    if (prov === 'gutenberg' && /^\d+$/.test(pid)) {
      data.direct_url = `https://www.gutenberg.org/ebooks/${pid}.epub3.images`;
    } else if (prov === 'archive' && pid && !/^\d+$/.test(pid)) {
      data.direct_url = `https://archive.org/download/${encodeURIComponent(pid)}/${encodeURIComponent(pid)}.epub`;
      if (!data.archive_id) data.archive_id = pid;
    }
    // Re-check after derivation
    const nowHasUrl = data.direct_url && typeof data.direct_url === 'string' && data.direct_url.trim().length > 0;
    const nowHasAid = data.archive_id && typeof data.archive_id === 'string' && data.archive_id.trim().length > 0;
    if (!nowHasUrl && !nowHasAid) {
      throw new Error(`Cannot sign reader token: direct_url is required (provider=${prov}, id=${pid})`);
    }
  }

  const now = Math.floor(Date.now() / 1000);
  if (!data.iat) data.iat = now;
  // 7-day default expiry (favorites regenerate tokens via /open anyway)
  if (!data.exp) data.exp = now + 7 * 24 * 60 * 60;

  const json = JSON.stringify(data);
  const b64 = Buffer.from(json).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(b64).digest('base64url');
  return `${b64}.${sig}`;
}

/**
 * Verify an HMAC-signed reader token.
 * Returns the parsed payload object, or null with a `reason` property.
 */
function verifyReaderToken(token) {
  const fail = (reason, extra) => {
    const snippet = (typeof token === 'string' && token.length > 20)
      ? token.slice(0, 12) + '...' + token.slice(-8)
      : String(token).slice(0, 20);
    console.warn('[token] verify failed:', reason, { snippet, ...extra });
    const out = null;
    return out; // caller checks for null
  };

  try {
    if (!token || typeof token !== 'string') return fail('missing_or_non_string');
    token = token.trim();
    if (!token.includes('.')) return fail('malformed_no_dot');

    const secret = getReaderTokenSecret();
    if (!secret) return fail('missing_secret');

    const dotIdx = token.indexOf('.');
    const b64 = token.slice(0, dotIdx);
    const sig = token.slice(dotIdx + 1);

    const good = crypto.createHmac('sha256', secret).update(b64).digest('base64url');
    if (sig !== good) return fail('invalid_signature');

    const obj = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
    const now = Math.floor(Date.now() / 1000);
    if (!obj.exp || obj.exp < now) return fail('expired', { exp: obj.exp, now });

    return obj;
  } catch (err) {
    return fail('parse_error', { error: err.message });
  }
}

module.exports = { buildReaderToken, verifyReaderToken, getReaderTokenSecret };
