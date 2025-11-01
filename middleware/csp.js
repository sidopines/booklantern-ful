// middleware/csp.js
const helmet = require('helmet');

module.exports = function csp() {
  return helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginOpenerPolicy:   { policy: 'same-origin-allow-popups' },
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'", "https://*.youtube.com", "https://*.ytimg.com"],
        "frame-src": ["'self'", "https://*.youtube.com", "https://www.youtube-nocookie.com"],
        "img-src": ["'self'", "data:", "https://*.ytimg.com", "https://img.youtube.com"],
        "connect-src": ["'self'", "https://*.youtube.com", "https://*.ytimg.com"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "media-src": ["'self'", "https://*.youtube.com"]
      }
    }
  });
};
