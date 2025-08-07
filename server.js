// server.js
require('dotenv').config(); // loads MONGODB_URI, JWT_SECRET, BASE_URL

const express      = require('express');
const mongoose     = require('mongoose');
const path         = require('path');
const session      = require('express-session');
const MongoStore   = require('connect-mongo');

const authRoutes   = require('./routes/auth');
const bookRoutes   = require('./routes/bookRoutes');
const indexRoutes  = require('./routes/index');

const Video        = require('./models/Video');
const Genre        = require('./models/Genre');

const app = express();

// ─── 1) CONNECT TO MONGODB ────────────────────────────────────────────────────
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Connected to MongoDB Atlas'))
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });

// ─── 2) EXPRESS & SESSION MIDDLEWARE ──────────────────────────────────────────
app.set('view engine','ejs');
app.set('views', path.join(__dirname,'views'));

app.use(express.static(path.join(__dirname,'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
  secret: process.env.JWT_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI }),
  cookie: { secure: false, maxAge: 1000 * 60 * 60 * 24 }
}));

// ─── 3) MAKE `user` & DEFAULT META AVAILABLE IN *ALL* VIEWS ───────────────────
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.pageTitle = res.locals.pageTitle || 'BookLantern';
  res.locals.pageDescription = res.locals.pageDescription || 'Free books & educational videos.';
  next();
});

// ─── 4) MOUNT YOUR ROUTERS ───────────────────────────────────────────────────
app.use('/', indexRoutes);   // home / about / contact
app.use('/', authRoutes);    // login / register / dashboard / settings / admin-setup
app.use('/', bookRoutes);    // /read, /read/book, /read/book/:id/bookmark, favorites

// ─── 5) WATCH + PLAYER (for subscribers) ──────────────────────────────────────
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
    if (!video) return res.status(404).render('404');
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

// ─── 6) ADMIN PANEL (protected) ───────────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (req.session.user?.role === 'admin') return next();
  return res.redirect('/login');
}
app.get('/admin', requireAdmin, async (req, res) => {
  try {
    const genres = await Genre.find({});
    const videos = await Video.find({}).populate('genre').sort({ createdAt: -1 });
    // if you also want books here, fetch them too…
    res.render('admin', {
      genres,
      videos,
      pageTitle: 'Admin',
      pageDescription: 'Manage all content'
    });
  } catch (err) {
    console.error('Admin load error:', err);
    res.status(500).send('Internal Server Error');
  }
});

// ─── 7) STATIC / 404 / ERROR ─────────────────────────────────────────────────
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.sendFile(path.join(__dirname,'public','robots.txt'));
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
