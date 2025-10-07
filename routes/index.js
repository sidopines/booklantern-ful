// routes/index.js (final)
const express = require("express");
const router = express.Router();

// Optional Supabase server client (may be null if not configured)
let supabaseAdmin = null;
try {
  supabaseAdmin = require("../supabaseAdmin"); // exports a client or null
} catch (_) {
  // keep running even if file/module isn't present
  supabaseAdmin = null;
}

// Optional Mailjet (only used if env keys are present)
let Mailjet = null;
try {
  Mailjet = require("node-mailjet");
} catch (_) {
  Mailjet = null;
}

/* ----------------------------------
   Homepage shelves (safe fallbacks)
----------------------------------- */
const FALLBACK = {
  trending: [
    { id: "ol-origin-darwin", provider: "openlibrary", title: "On the Origin of Species", author: "Charles Darwin",
      cover: "https://covers.openlibrary.org/b/olid/OL25442902M-L.jpg",
      href: "/read?provider=openlibrary&id=OL25442902M", subjects: ["Science", "Biology"] },
    { id: "pg-relativity", provider: "gutenberg", title: "Relativity: The Special and General Theory", author: "Albert Einstein",
      cover: "https://www.gutenberg.org/cache/epub/30155/pg30155.cover.medium.jpg",
      href: "/read?provider=gutenberg&id=30155", subjects: ["Science", "Physics"] },
    { id: "ol-benfranklin-autobio", provider: "openlibrary", title: "The Autobiography of Benjamin Franklin", author: "Benjamin Franklin",
      cover: "https://covers.openlibrary.org/b/olid/OL24374150M-L.jpg",
      href: "/read?provider=openlibrary&id=OL24374150M", subjects: ["Biography", "History"] },
    { id: "pg-plato-republic", provider: "gutenberg", title: "The Republic", author: "Plato",
      cover: "https://www.gutenberg.org/cache/epub/1497/pg1497.cover.medium.jpg",
      href: "/read?provider=gutenberg&id=1497", subjects: ["Philosophy"] },
    { id: "ol-opticks-newton", provider: "openlibrary", title: "Opticks", author: "Isaac Newton",
      cover: "https://covers.openlibrary.org/b/olid/OL24263840M-L.jpg",
      href: "/read?provider=openlibrary&id=OL24263840M", subjects: ["Science", "Physics"] },
    { id: "pg-gulliver", provider: "gutenberg", title: "Gulliver’s Travels", author: "Jonathan Swift",
      cover: "https://www.gutenberg.org/cache/epub/829/pg829.cover.medium.jpg",
      href: "/read?provider=gutenberg&id=829", subjects: ["Fiction", "Satire"] },
    { id: "ol-prince-machiavelli", provider: "openlibrary", title: "The Prince", author: "Niccolò Machiavelli",
      cover: "https://covers.openlibrary.org/b/olid/OL27665455M-L.jpg",
      href: "/read?provider=openlibrary&id=OL27665455M", subjects: ["Politics", "History"] },
    { id: "pg-art-of-war", provider: "gutenberg", title: "The Art of War", author: "Sun Tzu",
      cover: "https://www.gutenberg.org/cache/epub/132/pg132.cover.medium.jpg",
      href: "/read?provider=gutenberg&id=132", subjects: ["Strategy", "History"] },
  ],
  philosophy: [
    { id: "pg-ethics", provider: "gutenberg", title: "Ethics", author: "Benedict de Spinoza",
      cover: "https://www.gutenberg.org/cache/epub/3800/pg3800.cover.medium.jpg",
      href: "/read?provider=gutenberg&id=3800", subjects: ["Philosophy"] },
    { id: "pg-zarathustra", provider: "gutenberg", title: "Thus Spoke Zarathustra", author: "Friedrich Nietzsche",
      cover: "https://www.gutenberg.org/cache/epub/1998/pg1998.cover.medium.jpg",
      href: "/read?provider=gutenberg&id=1998", subjects: ["Philosophy"] },
    { id: "pg-utilitarianism", provider: "gutenberg", title: "Utilitarianism", author: "John Stuart Mill",
      cover: "https://www.gutenberg.org/cache/epub/11224/pg11224.cover.medium.jpg",
      href: "/read?provider=gutenberg&id=11224", subjects: ["Philosophy"] },
    { id: "pg-meditations", provider: "gutenberg", title: "Meditations", author: "Marcus Aurelius",
      cover: "https://www.gutenberg.org/cache/epub/2680/pg2680.cover.medium.jpg",
      href: "/read?provider=gutenberg&id=2680", subjects: ["Philosophy","Stoicism"] },
    { id: "pg-republic", provider: "gutenberg", title: "The Republic", author: "Plato",
      cover: "https://www.gutenberg.org/cache/epub/1497/pg1497.cover.medium.jpg",
      href: "/read?provider=gutenberg&id=1497", subjects: ["Philosophy"] },
  ],
  history: [
    { id: "pg-history-herodotus", provider: "gutenberg", title: "The Histories", author: "Herodotus",
      cover: "https://www.gutenberg.org/cache/epub/2707/pg2707.cover.medium.jpg",
      href: "/read?provider=gutenberg&id=2707", subjects: ["History"] },
    { id: "ol-souls-black-folk", provider: "openlibrary", title: "The Souls of Black Folk", author: "W. E. B. Du Bois",
      cover: "https://covers.openlibrary.org/b/olid/OL24378309M-L.jpg",
      href: "/read?provider=openlibrary&id=OL24378309M", subjects: ["History","Sociology"] },
    { id: "pg-decline-fall", provider: "gutenberg", title: "The History of the Decline and Fall of the Roman Empire (Vol. 1)", author: "Edward Gibbon",
      cover: "https://www.gutenberg.org/cache/epub/731/pg731.cover.medium.jpg",
      href: "/read?provider=gutenberg&id=731", subjects: ["History"] },
    { id: "ol-pride-prejudice", provider: "openlibrary", title: "Pride and Prejudice", author: "Jane Austen",
      cover: "https://covers.openlibrary.org/b/olid/OL25428444M-L.jpg",
      href: "/read?provider=openlibrary&id=OL25428444M", subjects: ["Fiction","History"] },
  ],
  science: [
    { id: "pg-relativity", provider: "gutenberg", title: "Relativity: The Special and General Theory", author: "Albert Einstein",
      cover: "https://www.gutenberg.org/cache/epub/30155/pg30155.cover.medium.jpg",
      href: "/read?provider=gutenberg&id=30155", subjects: ["Science","Physics"] },
    { id: "ol-origin-darwin", provider: "openlibrary", title: "On the Origin of Species", author: "Charles Darwin",
      cover: "https://covers.openlibrary.org/b/olid/OL25442902M-L.jpg",
      href: "/read?provider=openlibrary&id=OL25442902M", subjects: ["Science","Biology"] },
    { id: "ol-opticks-newton", provider: "openlibrary", title: "Opticks", author: "Isaac Newton",
      cover: "https://covers.openlibrary.org/b/olid/OL24263840M-L.jpg",
      href: "/read?provider=openlibrary&id=OL24263840M", subjects: ["Science","Physics"] },
    { id: "pg-micrographia", provider: "gutenberg", title: "Micrographia", author: "Robert Hooke",
      cover: "https://www.gutenberg.org/cache/epub/15491/pg15491.cover.medium.jpg",
      href: "/read?provider=gutenberg&id=15491", subjects: ["Science"] },
  ],
};

const clamp = (arr, n) => (Array.isArray(arr) ? arr.slice(0, n) : []);
const norm = (b = {}) => ({
  id: String(b.id || b.key || ""),
  provider: String(b.provider || "openlibrary"),
  title: String(b.title || "Untitled"),
  author: String(b.author || b.authors || "").toString(),
  cover: String(b.cover || ""),
  href: b.href || `/read?provider=${encodeURIComponent(b.provider || "openlibrary")}&id=${encodeURIComponent(b.id || "")}`,
  subjects: Array.isArray(b.subjects) ? b.subjects : [],
});
function ensureShelf(name, maybe, min = 8) {
  const src = Array.isArray(maybe) ? maybe : [];
  const out = clamp(src, 24).map(norm).filter((x) => x.cover);
  if (out.length >= min) return out;
  return clamp((FALLBACK[name] || []).map(norm), 24);
}

/* ----------------------------------
   Routes
----------------------------------- */

// Home
router.get("/", (req, res) => {
  const provided = (req.app && req.app.locals && req.app.locals.shelves) || {};
  const shelves = {
    trending:  ensureShelf("trending",  provided.trending),
    philosophy:ensureShelf("philosophy",provided.philosophy),
    history:   ensureShelf("history",   provided.history),
    science:   ensureShelf("science",   provided.science),
  };
  res.render("index", { shelves });
});

// Static pages
router.get("/about",   (_req, res) => res.render("about"));
router.get("/watch",   (_req, res) => res.render("watch", { videos: [] }));
router.get("/login",   (_req, res) => res.render("login", { csrfToken: "" }));
router.get("/register",(_req, res) => res.render("register", { csrfToken: "" }));

// Read page (expects provider & id via query in real use)
router.get("/read", (req, res) => {
  const provider = String(req.query.provider || "");
  const id       = String(req.query.id || "");
  res.render("read", { provider, id });
});

// Terms & Privacy
router.get("/terms", (req, res) => {
  const canonicalUrl = `${req.protocol}://${req.get("host")}/terms`;
  res.render("terms", {
    canonicalUrl,
    buildId: res.locals.buildId || Date.now(),
    referrer: req.get("Referrer") || null,
  });
});
router.get("/privacy", (req, res) => {
  const canonicalUrl = `${req.protocol}://${req.get("host")}/privacy`;
  res.render("privacy", {
    canonicalUrl,
    buildId: res.locals.buildId || Date.now(),
    referrer: req.get("Referrer") || null,
  });
});

// Contact (GET: show; POST: store to Supabase and optionally email via Mailjet)
router.get("/contact", (req, res) => {
  const sent  = req.query.sent === "1";
  const error = req.query.error || "";
  res.render("contact", { sent, error });
});

router.post("/contact", async (req, res) => {
  try {
    const name    = String(req.body.name || "").trim();
    const email   = String(req.body.email || "").trim();
    const message = String(req.body.message || "").trim();

    if (!name || !email || !message) {
      return res.status(400).render("contact", { sent: false, error: "Please fill all fields." });
    }

    // Insert into Supabase (server-side) if configured
    const ip         = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || null;
    const user_agent = req.get("User-Agent") || null;

    if (supabaseAdmin && typeof supabaseAdmin.from === "function") {
      const { error } = await supabaseAdmin
        .from("contact_messages")
        .insert({ name, email, message, ip, user_agent });

      if (error) {
        console.error("[contact] insert failed:", error.message);
        // Continue to success UX; we don't want to show an error page here
      }
    } else {
      console.warn("[contact] Supabase not configured; skipping DB insert.");
    }

    // Optional: email notification to you via Mailjet (only if env is present)
    await maybeSendMailjetEmail({ name, email, message });

    // Redirect to avoid resubmission on refresh
    return res.redirect(303, "/contact?sent=1");
  } catch (e) {
    console.error("[contact] unexpected error:", e);
    return res.redirect(303, "/contact?sent=1");
  }
});

/* ----------------------------------
   Helpers
----------------------------------- */

async function maybeSendMailjetEmail({ name, email, message }) {
  try {
    if (!Mailjet) return; // module not installed
    const apiKey    = process.env.MAILJET_API_KEY;
    const secretKey = process.env.MAILJET_SECRET_KEY;
    const fromEmail = process.env.MAILJET_SENDER || "info@booklantern.org";
    const toEmail   = process.env.MAILJET_TO || "info@booklantern.org";

    if (!apiKey || !secretKey) return; // not configured

    const mj = Mailjet.apiConnect(apiKey, secretKey);
    const html = `
      <div style="font-family:Helvetica,Arial,sans-serif;">
        <h2 style="margin:0 0 8px;">New contact message</h2>
        <p style="margin:0 0 6px;"><strong>Name:</strong> ${escapeHtml(name)}</p>
        <p style="margin:0 0 6px;"><strong>Email:</strong> ${escapeHtml(email)}</p>
        <p style="margin:10px 0 0;"><strong>Message:</strong><br>${escapeHtml(message).replace(/\n/g,'<br>')}</p>
      </div>
    `;

    await mj.post("send", { version: "v3.1" }).request({
      Messages: [
        {
          From: { Email: fromEmail, Name: "BookLantern" },
          To:   [{ Email: toEmail,   Name: "BookLantern" }],
          Subject: "New contact message",
          HTMLPart: html
        }
      ]
    });
  } catch (err) {
    console.error("[contact] Mailjet send failed:", err?.message || err);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]
  ));
}

module.exports = router;
