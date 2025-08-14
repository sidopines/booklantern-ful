// routes/bookRoutes.js
const express = require('express');
const router = express.Router();
const { ensureAuthenticated } = require('../middleware/auth');

let Favorite = null;
try { Favorite = require('../models/Favorite'); } catch (_) { /* optional */ }

// Allowed Gutenberg hosts for safety
const ALLOWED_GUTENBERG_HOSTS = new Set(['www.gutenberg.org', 'gutenberg.org']);

function defaultGutenbergHtmlUrl(gid) {
  return `https://www.gutenberg.org/cache/epub/${gid}/pg${gid}-images.html`;
}
function isAllowedGutenbergUrl(u) {
  try {
    const url = new URL(u);
    return ALLOWED_GUTENBERG_HOSTS.has(url.hostname);
  } catch (_) { return false; }
}

/* ============================
 * READ landing (search page)
 * ============================*/
router.get('/read', async (req, res) => {
  const q = (req.query.query || '').trim();
  res.render('read', {
    pageTitle: 'Explore Free Books',
    pageDescription: 'Browse and read books fetched from multiple free sources.',
    query: q,
    books: [] // client may fetch "Staff picks" when no query
  });
});

/* ===================================================
 * GUTENBERG: Kindle-style reader (paginated) VIEW
 * ===================================================*/
router.get('/read/gutenberg/:gid/reader', ensureAuthenticated, async (req, res) => {
  const gid = String(req.params.gid).trim();
  const readerUrl = req.query.u && isAllowedGutenbergUrl(req.query.u)
    ? req.query.u
    : defaultGutenbergHtmlUrl(gid);

  const book = {
    identifier: `gutenberg:${gid}`,
    title: 'Project Gutenberg Book',
    author: '',
    creator: ''
  };

  return res.render('unified-reader', {
    pageTitle: 'Reader',
    pageDescription: 'Read in a clean, paginated reader.',
    gutenbergId: gid,
    readerUrl,
    book
  });
});

/* ===================================================
 * GUTENBERG HTML API (used by the reader.js)
 * ===================================================*/
router.get('/api/gutenberg/:gid/html', ensureAuthenticated, async (req, res) => {
  try {
    const gid = String(req.params.gid).trim();
    const rawUrl = req.query.u || defaultGutenbergHtmlUrl(gid);
    if (!isAllowedGutenbergUrl(rawUrl)) return res.status(400).json({ error: 'Bad URL host' });

    const r = await fetch(rawUrl, { redirect: 'follow' });
    if (!r.ok) return res.status(502).json({ error: 'Failed to fetch Gutenberg source' });

    const html = await r.text();
    const bodyHtml = extractBody(html);
    const cleaned = basicStrip(bodyHtml);
    const meta = { title: (html.match(/<title>([\s\S]*?)<\/title>/i) || [,''])[1].trim() };
    return res.json({ html: cleaned, ...meta });
  } catch (e) {
    console.error('gutenberg html api error:', e);
    return res.status(500).json({ error: 'Internal error' });
  }
});

function extractBody(html) {
  const m = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return m ? m[1] : html;
}
function basicStrip(s) {
  return String(s || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\son\w+='[^']*'/gi, '');
}

/* ===================================================
 * FAVORITES (Gutenberg) — store as archiveId: "gutenberg:ID"
 * ===================================================*/
router.get('/read/gutenberg/:gid/favorite', ensureAuthenticated, async (req, res) => {
  try {
    if (!Favorite) return res.json({ favorite: false });
    const key = `gutenberg:${String(req.params.gid).trim()}`;
    const exists = await Favorite.findOne({ user: req.session.user._id, archiveId: key });
    return res.json({ favorite: !!exists });
  } catch (e) {
    console.error('favorite status error:', e);
    return res.json({ favorite: false });
  }
});

router.post('/read/gutenberg/:gid/favorite', ensureAuthenticated, async (req, res) => {
  try {
    if (!Favorite) return res.status(501).json({ error: 'Favorites not enabled' });
    const key = `gutenberg:${String(req.params.gid).trim()}`;
    const existing = await Favorite.findOne({ user: req.session.user._id, archiveId: key });
    if (existing) {
      await existing.deleteOne();
      return res.json({ favorite: false, message: 'Removed' });
    } else {
      await Favorite.create({ user: req.session.user._id, archiveId: key });
      return res.json({ favorite: true, message: 'Added' });
    }
  } catch (e) {
    console.error('favorite toggle error:', e);
    return res.status(500).json({ error: 'Failed to toggle favorite' });
  }
});

/* ===================================================
 * AUDIO PHASE B (Server MP3) — ElevenLabs (optional)
 * GET /api/gutenberg/:gid/tts.mp3
 *  - Requires env: TTS_PROVIDER=elevenlabs, ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID
 *  - Streams MP3 if configured; otherwise 501.
 * ===================================================*/
router.get('/api/gutenberg/:gid/tts.mp3', ensureAuthenticated, async (req, res) => {
  try {
    const provider = (process.env.TTS_PROVIDER || '').toLowerCase();
    if (provider !== 'elevenlabs') {
      res.status(501).type('text/plain').send('Server TTS not configured');
      return;
    }
    const apiKey = process.env.ELEVENLABS_API_KEY;
    const voiceId = process.env.ELEVENLABS_VOICE_ID; // required
    if (!apiKey || !voiceId) {
      res.status(501).type('text/plain').send('Server TTS missing API key or voice id');
      return;
    }

    const gid = String(req.params.gid).trim();
    const rawUrl = req.query.u || defaultGutenbergHtmlUrl(gid);
    if (!isAllowedGutenbergUrl(rawUrl)) return res.status(400).type('text/plain').send('Bad URL host');

    const r = await fetch(rawUrl, { redirect: 'follow' });
    if (!r.ok) return res.status(502).type('text/plain').send('Failed to fetch source');

    const html = await r.text();
    const body = extractBody(html);
    const text = plainText(body).slice(0, 4800); // safe chunk (provider limits vary)

    // Synthesize via ElevenLabs
    const elUrl = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?optimize_streaming_latency=0&output_format=mp3_44100_128`;
    const resp = await fetch(elUrl, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'accept': 'audio/mpeg',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        text,
        voice_settings: { stability: 0.4, similarity_boost: 0.6 }
      })
    });

    if (!resp.ok || !resp.body) {
      console.error('elevenlabs error', resp.status, await safeText(resp));
      return res.status(502).type('text/plain').send('TTS provider failed');
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    // Stream directly:
    resp.body.pipe(res);
  } catch (e) {
    console.error('tts mp3 error:', e);
    res.status(500).type('text/plain').send('Internal error');
  }
});

function plainText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
async function safeText(r){
  try{ return await r.text(); } catch(_){ return ''; }
}

module.exports = router;
