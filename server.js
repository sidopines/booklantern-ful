// server.js
require('dotenv').config(); // loads MONGODB_URI, JWT_SECRET, BASE_URL

const express    = require('express');
const mongoose   = require('mongoose');
const path       = require('path');
const session    = require('express-session');
const MongoStore = require('connect-mongo');

// Routes
const authRoutes   = require('./routes/auth');
const bookRoutes   = require('./routes/bookRoutes');
const indexRoutes  = require('./routes/index');
const homeRoutes   = require('./routes/homeRoutes'); // <-- NEW

// Models used on server routes
const Video = require('./models/Video');
const Genre = require('./models/Genre');

const app = express();

// ─── 1) CONNECT TO MONGODB ────────────────────────────────────────────────────
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Connected to MongoDB Atlas'))
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });

// ─── 2) CORE EXPRESS + TRUST PROXY (Render/Cloud) ─────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Trust reverse proxy (Render) so secure cookies work correctly in production
app.set('trust proxy', 1);

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Body parsers (needed for login, forms, and bookmark POST JSON)
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ─── 3) SESSION (Mongo-backed) ────────────────────────────────────────────────
const isProd = process.env.NODE_ENV === 'production';
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
  res.locals.user = req.session.user || null;
  res.locals.pageTitle = 'BookLantern';
  res.locals.pageDescription = 'Free books & educational videos.';
  next();
});

// ─── 5) ROUTES ────────────────────────────────────────────────────────────────
app.use('/', homeRoutes);  // <-- NEW: provides /api/featured-books, /api/shelves
app.use('/', indexRoutes); // home / about / contact
app.use('/', authRoutes);  // login / register / dashboard / settings / admin-setup
app.use('/', bookRoutes);  // /read, /read/book/:identifier, bookmarks, favorites

// ─── 6) WATCH + PLAYER (subscribers) ─────────────────────────────────────────
app.get('/watch', async (req, res) => {
  try {
    const genreFilter = req.query.genre || '';
    const genres = await Genre.find({});
    const videos = genreFilter
      ? await Video.find({ genre: genreFilter }).populate('genre').sort({ createdAt: -1 })
      : await Video.find({}).populate('genre').sort({ createdAt: -1 });

    res.render('watch', {
      genres,
      videos,
      genreFilter,
      pageTitle: 'Watch Educational Videos',
      pageDescription: 'Stream free educational videos.'
    });
  } catch (err) {
    console.error('Error loading watch:', err);
    res.status(500).send('Internal Server Error');
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

// ─── 7) STATIC / 404 / ERROR ─────────────────────────────────────────────────
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.sendFile(path.join(__dirname, 'public', 'robots.txt'));
});

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
