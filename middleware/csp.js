// middleware/csp.js (CommonJS)
const helmet = require('helmet');
const { URL } = require('url');

function supabaseHost() {
  try {
    const u = new URL(
      process.env.SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      process.env.PUBLIC_SUPABASE_URL ||
      ''
    );
    return u.hostname; // e.g. xyzcompany.supabase.co
  } catch { return null; }
}

module.exports = function csp() {
  const sbHost = supabaseHost();

  return helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        // Default sandbox
        "default-src": ["'self'"],

        // JS we actually use (keep YouTube bootstrap; avoid random CDNs)
        "script-src": ["'self'", "https://www.youtube.com", "https://s.ytimg.com"],

        // Our player iframe origins
        "frame-src": [
          "'self'",
          "https://www.youtube-nocookie.com",
          "https://www.youtube.com"
        ],

        // Thumbnails & book covers from our trusted libraries
        "img-src": [
          "'self'",
          "data:",
          // YouTube thumbs
          "https://i.ytimg.com",
          "https://img.youtube.com",
          // Open Library covers
          "https://covers.openlibrary.org",
          // Archive / IA derivatives
          "https://archive.org",
          "https://www.archive.org",
          "https://iiif.archivelab.org",
          // Gutenberg covers
          "https://www.gutenberg.org",
          "https://gutenberg.org",
          // Library of Congress images
          "https://tile.loc.gov",
          "https://cdn.loc.gov"
        ],

        // XHR/fetch destinations (Supabase + Mailjet if called client-side)
        "connect-src": [
          "'self'",
          "https://www.youtube.com",
          "https://s.ytimg.com"
        ].concat(
          sbHost ? [`https://${sbHost}`] : []
        ).concat(
          process.env.MJ_APIURL ? [process.env.MJ_APIURL] : []
        ),

        // Allow inline styles used by EJS/Tailwind
        "style-src": ["'self'", "'unsafe-inline'"],

        // If we ever serve audio/video files directly
        "media-src": ["'self'"],

        // Form submits back to us
        "form-action": ["'self'"],

        // Prevent being framed elsewhere
        "frame-ancestors": ["'self'"],

        // Good hygiene
        "base-uri": ["'self'"]
      }
    },
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" }
  });
};
