/* utils/buildReaderToken.js */
const crypto = require('crypto');

const APP_SIGNING_SECRET = process.env.APP_SIGNING_SECRET || 'dev-secret';

/**
 * Very small HMAC-signed token for unified-reader.
 * payload: {provider, provider_id, format, direct_url, title, author, cover_url, back, exp}
 */
function buildReaderToken(payload) {
  const data = { ...payload };
  // 2h default expiry
  if (!data.exp) data.exp = Math.floor(Date.now() / 1000) + 2 * 60 * 60;

  const json = JSON.stringify(data);
  const b64 = Buffer.from(json).toString('base64url');
  const sig = crypto.createHmac('sha256', APP_SIGNING_SECRET).update(b64).digest('base64url');
  return `${b64}.${sig}`;
}

function verifyReaderToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [b64, sig] = token.split('.');
  const good = crypto.createHmac('sha256', APP_SIGNING_SECRET).update(b64).digest('base64url');
  if (sig !== good) return null;
  const obj = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
  if (!obj.exp || obj.exp < Math.floor(Date.now() / 1000)) return null;
  return obj;
}

module.exports = { buildReaderToken, verifyReaderToken };
