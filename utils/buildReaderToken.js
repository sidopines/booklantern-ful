/* utils/buildReaderToken.js */
const crypto = require('crypto');

const APP_SIGNING_SECRET = process.env.APP_SIGNING_SECRET || 'dev-secret';

/**
 * Very small HMAC-signed token for unified-reader.
 * payload: {provider, provider_id, format, direct_url, title, author, cover_url, back, exp}
 */
function buildReaderToken(payload) {
  const data = { ...payload };
  // 30-day default expiry (favorites regenerate tokens via /open anyway)
  if (!data.exp) data.exp = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;

  const json = JSON.stringify(data);
  const b64 = Buffer.from(json).toString('base64url');
  const sig = crypto.createHmac('sha256', APP_SIGNING_SECRET).update(b64).digest('base64url');
  return `${b64}.${sig}`;
}

function verifyReaderToken(token) {
  try {
    if (!token || typeof token !== 'string' || !token.includes('.')) {
      console.warn('[token] verify: malformed token (missing dot)');
      return null;
    }
    const [b64, sig] = token.split('.');
    const good = crypto.createHmac('sha256', APP_SIGNING_SECRET).update(b64).digest('base64url');
    if (sig !== good) {
      console.warn('[token] verify failed: invalid signature');
      return null;
    }
    const obj = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
    if (!obj.exp || obj.exp < Math.floor(Date.now() / 1000)) {
      console.warn('[token] verify failed: expired', { exp: obj.exp, now: Math.floor(Date.now() / 1000) });
      return null;
    }
    return obj;
  } catch (err) {
    console.error('[token] verify failed:', err.name, err.message);
    return null;
  }
}

module.exports = { buildReaderToken, verifyReaderToken };
