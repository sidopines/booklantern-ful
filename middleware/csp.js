const helmet = require('helmet');

module.exports = function csp() {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],

        // Allow inline script for the /login forwarder and small EJS snippets.
        "script-src": [
          "'self'",
          "'unsafe-inline'",
          "https://cdn.jsdelivr.net",
          "https://esm.sh",
          "https://www.youtube.com",
          "https://www.youtube-nocookie.com",
          "https://s.ytimg.com",
          "https://apis.google.com",
          "https://www.gstatic.com",
          "https://accounts.google.com"
        ],

        // Thumbnails and book covers can come from anywhere.
        "img-src": ["*", "data:", "blob:"],

        // YouTube + Google OAuth popups/iframes.
        "frame-src": [
          "'self'",
          "https://www.youtube.com",
          "https://www.youtube-nocookie.com",
          "https://accounts.google.com"
        ],

        // Supabase, Google APIs, YouTube, etc.
        "connect-src": [
          "'self'",
          "blob:",
          "https:",
          "https://*.supabase.co",
          "https://*.supabase.in",
          "https://esm.sh",
          "https://www.youtube.com",
          "https://s.ytimg.com",
          "https://www.googleapis.com"
        ],

        // Inline styles + blob: for epub.js stylesheets
        "style-src": ["'self'", "'unsafe-inline'", "blob:"],

        // Fonts: allow data:, blob:, and https: for EPUB embedded fonts
        "font-src": ["'self'", "data:", "blob:", "https:", "https://fonts.gstatic.com"],

        // Media (future: audio/video covers)
        "media-src": ["*", "data:", "blob:"],

        // Workers for epub.js
        "worker-src": ["'self'", "blob:"]
      }
    },
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" }
  });
};
