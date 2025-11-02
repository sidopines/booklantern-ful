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
          "https://*.supabase.co",
          "https://*.supabase.in",
          "https://www.youtube.com",
          "https://s.ytimg.com",
          "https://www.googleapis.com"
        ],

        // Inline styles used by EJS/Tailwind.
        "style-src": ["'self'", "'unsafe-inline'"],

        // Fonts (if any)
        "font-src": ["'self'", "data:", "https://fonts.gstatic.com"],

        // Media (future: audio/video covers)
        "media-src": ["*", "data:", "blob:"],

        // Optional: allow data URLs for favicons if needed
        // "worker-src": ["'self'", "blob:"]
      }
    },
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" }
  });
};
