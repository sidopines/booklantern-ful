// server.js
require('dotenv').config(); // loads MONGODB_URI, JWT_SECRET, BASE_URL

const express    = require('express');
const mongoose   = require('mongoose');
const path       = require('path');
const session    = require('express-session');
const MongoStore = require('connect-mongo');

const authRoutes  = require('./routes/auth');
const bookRoutes  = require('./routes/bookRoutes');
const indexRoutes = require('./routes/index');
const homeRoutes  = require('./routes/homeRoutes'); // /api/featured-books, /api/shelves
const adminRoutes = require('./routes/admin');      // Admin console
const pdfRoutes   = require('./routes/pdf');        // <-- NEW: /read/pdf
const metaRoutes  = require('./routes/metaRoutes'); // <-- NEW: /sitemap.xml, /robots.txt

// Models used on server routes
const Video = require('./models/Video');
const Genre = require('./models/Genre');

const app = express();
const isProd = process.env.NODE_ENV === 'production';

// Build ID for cache-busting (stable, production-ready)
const buildId =
  process.env.RENDER_GIT_COMMIT ||
  process.env.SOURCE_VERSION ||
  process.env.BUILD_ID ||
  (process.env.NODE_ENV === 'production' ? Date.now().toString(36) : 'dev');

// Expose buildId to all templates
app.use((req, res, next) => {
  res.locals.buildId = buildId;
  next();
});

// (Optional) keep startup quiet/fast in production
if (isProd) {
  mongoose.set('autoIndex', false);
}

// ─── 1) CONNECT TO MONGODB ────────────────────────────────────────────────────
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Connected to MongoDB Atlas'))
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });

// ─── 2) CORE EXPRESS + TRUST PROXY (Render/Cloud) ─────────────────────────────
app.disable('x-powered-by');
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Trust reverse proxy (Render) so secure cookies work correctly in production
app.set('trust proxy', 1);

// Static files - serve public directory at root
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  maxAge: '7d',
  setHeaders: (res, p) => {
    if (p.endsWith('.json')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
  }
}));

// Body parsers (needed for login, forms, and bookmark POST JSON)
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ─── 3) SESSION (Mongo-backed) ────────────────────────────────────────────────
app.use(session({
  secret: process.env.JWT_SECRET || 'change-me',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI }),
  cookie: {
    secure: isProd,          // true on HTTPS (Render)
    httpOnly: true,
    sameSite: 'lax',         // keeps login on same-site nav while avoiding CSRF pitfalls
    maxAge: 1000 * 60 * 60 * 24 // 1 day
  }
}));

// ─── 4) GLOBAL VIEW LOCALS ────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.locals.loggedIn = !!(req.session.user);
  res.locals.user = req.session.user || null;
  res.locals.pageTitle = 'BookLantern';
  res.locals.pageDescription = 'Free books & educational videos.';
  res.locals.buildId = buildId;
  next();
});

// ─── 5) HELMET CSP (allow Open Library covers) ─────────────────────────────────
const helmet = require('helmet');
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "img-src": ["'self'", "data:", "https://covers.openlibrary.org"],
    }
  }
}));

// ─── 6) ROUTES ────────────────────────────────────────────────────────────────
// Order matters: mount admin after sessions/locals are set
app.use('/', homeRoutes);        // /api/featured-books, /api/shelves
app.use('/', indexRoutes);       // home / about / contact
app.use('/', authRoutes);        // login / register / dashboard / settings
app.use('/admin', adminRoutes);  // Admin console (protected by middleware)
app.use('/', pdfRoutes);         // <-- NEW: /read/pdf inline viewer
app.use('/', bookRoutes);        // /read, /read/book/:identifier, Gutenberg reader, etc.
app.use('/', metaRoutes);        // <-- NEW: /sitemap.xml, /robots.txt

// Public watch + player
const fallbackVideos = require('./data/fallbackVideos.json');
app.get('/watch', async (req, res) => {
  try {
    // Priority 1: upstream-provided
    let videos = res.locals.videos || req.videos || null;

    // Priority 2: DB if available
    if (!videos && global.Video && typeof Video.find === 'function') {
      try {
        videos = await Video.find({ published: { $ne: false } })
          .sort({ createdAt: -1 })
          .limit(24)
          .lean();
        videos = (videos || []).map(v => ({
          title: v.title || 'Untitled',
          thumbnail: v.thumbnail || v.thumb || null,
          href: v.url || v.href || (v._id ? `/player/${v._id}` : '#')
        }));
      } catch (_) {
        videos = null;
      }
    }

    // Priority 3: fallback JSON
    if (!videos || videos.length === 0) {
      videos = fallbackVideos;
    }

    return res.render('watch', { videos });
  } catch (e) {
    console.error('watch route error', e);
    return res.render('watch', { videos: fallbackVideos });
  }
});

app.get('/player/:id', async (req, res) => {
  try {
    const video = await Video.findById(req.params.id).populate('genre');
    if (!video) return res.status(404).render('404', {
      pageTitle: 'Not Found',
      pageDescription: 'The requested video could not be found.'
    });
    res.render('player', {
      video,
      pageTitle: `${video.title} | Watch`,
      pageDescription: video.description || `Watch ${video.title} on BookLantern`
    });
  } catch (err) {
    console.error('Error loading player:', err);
    res.status(500).send('Internal Server Error');
  }
});

// Simple healthcheck (useful for Render)
app.get('/healthz', (req, res) => res.type('text/plain').send('ok'));

// Scene observability endpoint
app.get('/__scene', (req, res) => {
  const userAgent = req.headers['user-agent'] || '';
  const isBot = userAgent.includes('bot') || userAgent.includes('crawler') || userAgent.includes('spider');
  const acceptsWebGL = !isBot;
  
  // Extract route from referrer or default
  const referrer = req.headers.referer || req.headers.referrer || '';
  let page = 'unknown';
  
  if (referrer.includes('/read')) page = 'read';
  else if (referrer.includes('/watch')) page = 'watch';
  else if (referrer.includes('/about')) page = 'about';
  else if (referrer.includes('/dashboard')) page = 'dashboard';
  else if (referrer.includes('/login') || referrer.includes('/register')) page = 'auth';
  else if (referrer.includes('/contact')) page = 'contact';
  else if (referrer === '' || referrer.endsWith('/')) page = 'gate';
  
  const sceneData = {
    mode: acceptsWebGL ? 'webgl' : 'fallback',
    page: page,
    timestamp: new Date().toISOString(),
    userAgent: userAgent.substring(0, 100), // Truncate for privacy
    buildId: buildId,
    serverDetected: true
  };
  
  // Add reason for fallback mode
  if (!acceptsWebGL) {
    sceneData.reason = 'bot-detected';
  }
  
  res.json(sceneData);
});

// ─── 7) STATIC / 404 / ERROR ─────────────────────────────────────────────────

app.use((req, res) => {
  res.status(404).render('404', {
    pageTitle: 'Page Not Found',
    pageDescription: 'The page you’re looking for doesn’t exist.'
  });
});

app.use((err, req, res, next) => {
  console.error('🔥 Unhandled error:', err);
  res.status(500).send('Internal Server Error');
});

// ─── 8) START ────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
