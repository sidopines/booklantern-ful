// routes/index.js
const express = require("express");
const { supabaseAdmin } = require("../supabaseAdmin");
const router = express.Router();

// Parse urlencoded bodies (contact form)
router.use(express.urlencoded({ extended: false }));

/**
 * Home data (unchanged: curated fallbacks)
 */
const FALLBACK = {
  trending: [
    { id: "ol-origin-darwin", provider: "openlibrary", title: "On the Origin of Species", author: "Charles Darwin", cover: "https://covers.openlibrary.org/b/olid/OL25442902M-L.jpg", href: "/read?provider=openlibrary&id=OL25442902M", subjects: ["Science","Biology"] },
    { id: "pg-relativity", provider: "gutenberg", title: "Relativity: The Special and General Theory", author: "Albert Einstein", cover: "https://www.gutenberg.org/cache/epub/30155/pg30155.cover.medium.jpg", href: "/read?provider=gutenberg&id=30155", subjects: ["Science","Physics"] },
    { id: "ol-benfranklin-autobio", provider: "openlibrary", title: "The Autobiography of Benjamin Franklin", author: "Benjamin Franklin", cover: "https://covers.openlibrary.org/b/olid/OL24374150M-L.jpg", href: "/read?provider=openlibrary&id=OL24374150M", subjects: ["Biography","History"] },
    { id: "pg-plato-republic", provider: "gutenberg", title: "The Republic", author: "Plato", cover: "https://www.gutenberg.org/cache/epub/1497/pg1497.cover.medium.jpg", href: "/read?provider=gutenberg&id=1497", subjects: ["Philosophy"] },
    { id: "ol-opticks-newton", provider: "openlibrary", title: "Opticks", author: "Isaac Newton", cover: "https://covers.openlibrary.org/b/olid/OL24263840M-L.jpg", href: "/read?provider=openlibrary&id=OL24263840M", subjects: ["Science","Physics"] },
    { id: "pg-gulliver", provider: "gutenberg", title: "Gulliver’s Travels", author: "Jonathan Swift", cover: "https://www.gutenberg.org/cache/epub/829/pg829.cover.medium.jpg", href: "/read?provider=gutenberg&id=829", subjects: ["Fiction","Satire"] },
    { id: "ol-prince-machiavelli", provider: "openlibrary", title: "The Prince", author: "Niccolò Machiavelli", cover: "https://covers.openlibrary.org/b/olid/OL27665455M-L.jpg", href: "/read?provider=openlibrary&id=OL27665455M", subjects: ["Politics","History"] },
    { id: "pg-art-of-war", provider: "gutenberg", title: "The Art of War", author: "Sun Tzu", cover: "https://www.gutenberg.org/cache/epub/132/pg132.cover.medium.jpg", href: "/read?provider=gutenberg&id=132", subjects: ["Strategy","History"] },
  ],
  philosophy: [
    { id: "pg-ethics", provider: "gutenberg", title: "Ethics", author: "Benedict de Spinoza", cover: "https://www.gutenberg.org/cache/epub/3800/pg3800.cover.medium.jpg", href: "/read?provider=gutenberg&id=3800", subjects: ["Philosophy"] },
    { id: "pg-zarathustra", provider: "gutenberg", title: "Thus Spoke Zarathustra", author: "Friedrich Nietzsche", cover: "https://www.gutenberg.org/cache/epub/1998/pg1998.cover.medium.jpg", href: "/read?provider=gutenberg&id=1998", subjects: ["Philosophy"] },
    { id: "pg-utilitarianism", provider: "gutenberg", title: "Utilitarianism", author: "John Stuart Mill", cover: "https://www.gutenberg.org/cache/epub/11224/pg11224.cover.medium.jpg", href: "/read?provider=gutenberg&id=11224", subjects: ["Philosophy"] },
    { id: "pg-meditations", provider: "gutenberg", title: "Meditations", author: "Marcus Aurelius", cover: "https://www.gutenberg.org/cache/epub/2680/pg2680.cover.medium.jpg", href: "/read?provider=gutenberg&id=2680", subjects: ["Philosophy","Stoicism"] },
    { id: "pg-republic", provider: "gutenberg", title: "The Republic", author: "Plato", cover: "https://www.gutenberg.org/cache/epub/1497/pg1497.cover.medium.jpg", href: "/read?provider=gutenberg&id=1497", subjects: ["Philosophy"] },
  ],
  history: [
    { id: "pg-history-herodotus", provider: "gutenberg", title: "The Histories", author: "Herodotus", cover: "https://www.gutenberg.org/cache/epub/2707/pg2707.cover.medium.jpg", href: "/read?provider=gutenberg&id=2707", subjects: ["History"] },
    { id: "ol-souls-black-folk", provider: "openlibrary", title: "The Souls of Black Folk", author: "W. E. B. Du Bois", cover: "https://covers.openlibrary.org/b/olid/OL24378309M-L.jpg", href: "/read?provider=openlibrary&id=OL24378309M", subjects: ["History","Sociology"] },
    { id: "pg-decline-fall", provider: "gutenberg", title: "The History of the Decline and Fall of the Roman Empire (Vol. 1)", author: "Edward Gibbon", cover: "https://www.gutenberg.org/cache/epub/731/pg731.cover.medium.jpg", href: "/read?provider=gutenberg&id=731", subjects: ["History"] },
    { id: "ol-pride-prejudice", provider: "openlibrary", title: "Pride and Prejudice", author: "Jane Austen", cover: "https://covers.openlibrary.org/b/olid/OL25428444M-L.jpg", href: "/read?provider=openlibrary&id=OL25428444M", subjects: ["Fiction","History"] },
  ],
  science: [
    { id: "pg-relativity", provider: "gutenberg", title: "Relativity: The Special and General Theory", author: "Albert Einstein", cover: "https://www.gutenberg.org/cache/epub/30155/pg30155.cover.medium.jpg", href: "/read?provider=gutenberg&id=30155", subjects: ["Science","Physics"] },
    { id: "ol-origin-darwin", provider: "openlibrary", title: "On the Origin of Species", author: "Charles Darwin", cover: "https://covers.openlibrary.org/b/olid/OL25442902M-L.jpg", href: "/read?provider=openlibrary&id=OL25442902M", subjects: ["Science","Biology"] },
    { id: "ol-opticks-newton", provider: "openlibrary", title: "Opticks", author: "Isaac Newton", cover: "https://covers.openlibrary.org/b/olid/OL24263840M-L.jpg", href: "/read?provider=openlibrary&id=OL24263840M", subjects: ["Science","Physics"] },
    { id: "pg-micrographia", provider: "gutenberg", title: "Micrographia", author: "Robert Hooke", cover: "https://www.gutenberg.org/cache/epub/15491/pg15491.cover.medium.jpg", href: "/read?provider=gutenberg&id=15491", subjects: ["Science"] },
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

// Home
router.get("/", (req, res) => {
  const provided = (req.app && req.app.locals && req.app.locals.shelves) || {};
  const shelves = {
    trending: ensureShelf("trending", provided.trending),
    philosophy: ensureShelf("philosophy", provided.philosophy),
    history: ensureShelf("history", provided.history),
    science: ensureShelf("science", provided.science),
  };
  res.render("index", { shelves });
});

// Static pages
router.get("/about", (req, res) => res.render("about"));
router.get("/watch", (req, res) => res.render("watch", { videos: [] }));
router.get("/login", (req, res) => res.render("login", { csrfToken: "" }));
router.get("/register", (req, res) => res.render("register", { csrfToken: "" }));

// Reader
router.get("/read", (req, res) => {
  const provider = req.query.provider || "";
  const id = req.query.id || "";
  res.render("read", { provider, id });
});

// Terms & Privacy
router.get("/terms", (req, res) => {
  const canonicalUrl = `${req.protocol}://${req.get("host")}/terms`;
  res.render("terms", { canonicalUrl, buildId: res.locals.buildId || Date.now(), referrer: req.get("Referrer") || null });
});
router.get("/privacy", (req, res) => {
  const canonicalUrl = `${req.protocol}://${req.get("host")}/privacy`;
  res.render("privacy", { canonicalUrl, buildId: res.locals.buildId || Date.now(), referrer: req.get("Referrer") || null });
});

// Contact (Supabase service-role write)
router.get("/contact", (req, res) => {
  const sent = req.query.sent === "1";
  res.render("contact", { sent, error: null, old: { name: "", email: "", message: "" } });
});
router.post("/contact", async (req, res) => {
  if ((req.body.website || "").trim()) return res.redirect("/contact"); // honeypot

  const name = (req.body.name || "").trim();
  const email = (req.body.email || "").trim();
  const message = (req.body.message || "").trim();

  const errors = [];
  if (!name) errors.push("Please enter your name.");
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.push("Please enter a valid email.");
  if (!message || message.length < 10) errors.push("Message should be at least 10 characters.");

  if (errors.length) {
    return res.status(400).render("contact", { sent: false, error: errors.join(" "), old: { name, email, message } });
  }

  await supabaseAdmin.from("contact_messages").insert({
    name, email, message,
    ip: req.headers["x-forwarded-for"] || req.socket.remoteAddress || null
  });

  return res.redirect("/contact?sent=1");
});

// Auth callback (password recovery / OAuth landing — client handles)
router.get("/auth/callback", (req, res) => res.render("auth-callback"));

/**
 * Admin: delete user
 * - Send header: X-Admin-Token: <ADMIN_API_TOKEN>
 * - Provide ?user_id=<uuid> (required)
 */
router.post("/admin/delete-user", async (req, res) => {
  try {
    if (req.headers["x-admin-token"] !== process.env.ADMIN_API_TOKEN) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const userId = (req.body.user_id || "").trim();
    if (!userId) return res.status(400).json({ error: "user_id required" });

    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) return res.status(400).json({ error: error.message });

    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
