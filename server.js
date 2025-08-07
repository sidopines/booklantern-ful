// server.js
require('dotenv').config(); // ↪︎ loads MONGODB_URI, JWT_SECRET, BASE_URL

const express    = require('express');
const mongoose   = require('mongoose');
const path       = require('path');
const session    = require('express-session');
const MongoStore = require('connect-mongo');

const authRoutes  = require('./routes/auth');
const bookRoutes  = require('./routes/bookRoutes');
const indexRoutes = require('./routes/index');

const Video   = require('./models/Video');
const Genre   = require('./models/Genre');
const Book    = require('./models/Book');
// (you can import Bookmark & Favorite here if you still use them)

const app = express();

// ─── MONGODB CONNECTION ────────────────────────────────────────────────────────
const mongoURI = process.env.MONGODB_URI;
mongoose
  .connect(mongoURI)
  .then(() => console.log('✅ Connected to MongoDB Atlas'))
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });

// ─── MIDDLEWARE & CONFIG ───────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
  session({
    secret: process.env.JWT_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: mongoURI }),
    cookie: { secure: false, maxAge: 1000 * 60 * 60 * 24 } // 1 day
  })
);

// Provide defaults for pageTitle / pageDescription
app.use((req, res, next) => {
  res.locals.pageTitle = 'BookLantern';
  res.locals.pageDescription = 'Free books & educational videos.';
  next();
});

// ─── ROUTES ────────────────────────────────────────────────────────────────────
app.use('/', indexRoutes);   // Home, About, Contact
app.use('/', authRoutes);    // Login, Register, Dashboard, Settings
app.use('/', bookRoutes);    // /read, /read/book, bookmarks, favorites

// ─── AUTH GUARD FOR ADMIN ──────────────────────────────────────────────────────
function isLoggedIn(req, res, next) {
  if (req.session && req.session.user) return next();
  console.log('❌ Blocked /admin – not logged in');
  return res.redirect('/login');
}

// ─── ADMIN PANEL ───────────────────────────────────────────────────────────────
app.get('/admin', isLoggedIn, async (req, res) => {
  console.log('🐛 GET /admin handler hit; session.user =', req.session.user);
  try {
    const genres = await Genre.find({});
    console.log(`✅ genres fetched: ${genres.length}`);

    const videos = await Video.find({})
      .populate('genre')
      .sort({ createdAt: -1 });
    console.log(`✅ videos fetched: ${videos.length}`);

    const books = await Book.find({})
      .sort({ createdAt: -1 })
      .limit(5);
    console.log(`✅ books fetched: ${books.length}`);

    return res.render('admin', {
      genres,
      videos,
      books,
      pageTitle: 'Admin Dashboard',
      pageDescription: 'Manage videos, books, and site content.'
    });
  } catch (err) {
    console.error('🔥 Admin page error:', err);
    return res.status(500).send('Internal Server Error');
  }
});

// ─── CUSTOM robots.txt (override Cloudflare if needed) ─────────────────────────
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.sendFile(path.join(__dirname, 'public/robots.txt'));
});

// ─── 404 & ERROR HANDLING ──────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).render('404', {
    pageTitle: 'Page Not Found',
    pageDescription: 'The page you’re looking for could not be found.'
  });
});

app.use((err, req, res, next) => {
  console.error('🔥 Unhandled error:', err);
  res.status(500).send('Internal Server Error');
});

// ─── START SERVER ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
