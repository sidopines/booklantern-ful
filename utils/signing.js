// utils/signing.js
const crypto = require('crypto');

/**
 * sign - Creates a signed token with HMAC
 * @param {Object} payloadObject - Data to sign
 * @param {number} ttlSeconds - Time-to-live in seconds
 * @returns {string} base64url encoded token
 */
function sign(payloadObject, ttlSeconds) {
  const secret = process.env.APP_SIGNING_SECRET;
  if (!secret) {
    throw new Error('APP_SIGNING_SECRET not configured');
  }

  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const data = { ...payloadObject, exp };
  const payload = JSON.stringify(data);
  
  const hmac = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('base64url');

  const token = Buffer.from(
    JSON.stringify({ hmac, exp, data })
  ).toString('base64url');

  return token;
}

/**
 * verify - Verifies and decodes a signed token
 * @param {string} token - The token to verify
 * @returns {Object} The decoded payload
 * @throws {Error} If token is invalid or expired
 */
function verify(token) {
  const secret = process.env.APP_SIGNING_SECRET;
  if (!secret) {
    throw new Error('APP_SIGNING_SECRET not configured');
  }

  let parsed;
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf-8');
    parsed = JSON.parse(decoded);
  } catch (e) {
    throw new Error('Invalid token format');
  }

  const { hmac, exp, data } = parsed;
  
  if (!hmac || !exp || !data) {
    throw new Error('Malformed token');
  }

  // Check expiration
  const now = Math.floor(Date.now() / 1000);
  if (now > exp) {
    throw new Error('Token expired');
  }

  // Verify HMAC
  const payload = JSON.stringify(data);
  const expectedHmac = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('base64url');

  if (hmac !== expectedHmac) {
    throw new Error('Invalid token signature');
  }

  return data;
}

module.exports = { sign, verify };
