// server.js
require('dotenv').config();

const express    = require('express');
const mongoose   = require('mongoose');
const path       = require('path');
const session    = require('express-session');
const MongoStore = require('connect-mongo');

const authRoutes  = require('./routes/auth');
const bookRoutes  = require('./routes/bookRoutes'); // if present
const indexRoutes = require('./routes/index');

/* Models */
const Video    = require('./models/Video');
const Genre    = require('./models/Genre');
const Book     = require('./models/Book');
const Bookmark = require('./models/Bookmark');
const Favorite = require('./models/Favorite');

const app = express();

/* ------------ DB ------------ */
const mongoURI = process.env.MONGODB_URI;
mongoose
  .connect(mongoURI)
  .then(() => console.log('✅ Connected to MongoDB Atlas'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

/* ------------ Express / sessions ------------ */
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));
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

/* Meta defaults so head.ejs never crashes */
app.use((req, res, next) => {
  res.locals.pageTitle = 'BookLantern';
  res.locals.pageDescription = 'Free books & educational videos.';
  next();
});

/* Simple guard */
function isLoggedIn(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.redirect('/login');
}

/* ------------ Routers ------------ */
app.use('/', indexRoutes);
app.use('/', authRoutes);
app.use('/', bookRoutes); // safe even if some routes duplicate; ours below run first if defined here

/* ------------ ADMIN ------------ */
app.get('/admin', isLoggedIn, async (req, res) => {
  try {
    const genres = await Genre.find({});
    const videos = await Video.find({}).populate('genre').sort({ createdAt: -1 });
    const books  = await Book.find({}).sort({ createdAt: -1 }).limit(5);

    res.render('admin', {
      genres,
      videos,
      books,
      pageTitle: 'Admin',
      pageDescription: 'Manage books and videos'
    });
  } catch (err) {
    console.error('Admin error:', err);
    res.status(500).send('Internal Server Error');
  }
});

/* ------------ WATCH ------------ */
app.get('/watch', async (req, res) => {
  try {
    const genreFilter = req.query.genre || '';
    const genres = await Genre.find({});
    const query  = genreFilter ? { genre: genreFilter } : {};
    const videos = await Video.find(query).populate('genre').sort({ createdAt: -1 });

    res.render('watch', {
      genres,
      videos,
      genreFilter,
      pageTitle: 'Watch Educational Videos',
      pageDescription: 'Stream free educational videos.'
    });
  } catch (err) {
    console.error('Error loading watch page:', err);
    res.status(500).send('Internal Server Error');
  }
});

/* ------------ PLAYER ------------ */
app.get('/player/:id', async (req, res) => {
  try {
    const video = await Video.findById(req.params.id).populate('genre');
    if (!video) return res.status(404).send('Video not found');
    res.render('player', {
      video,
      pageTitle: video.title,
      pageDescription: video.description || 'Watch on BookLantern'
    });
  } catch (err) {
    console.error('Error loading video:', err);
    res.status(500).send('Internal Server Error');
  }
});

/* ------------ READ LIST ------------ */
app.get('/read', async (req, res) => {
  try {
    const books = await Book.find({}).sort({ createdAt: -1 });
    res.render('read', {
      books,
      pageTitle: 'Read Books Online',
      pageDescription: 'Browse free books from Archive.org.'
    });
  } catch (err) {
    console.error('Error loading books:', err);
    res.status(500).send('Internal Server Error');
  }
});

/* ------------ BOOK VIEWER (accept _id or identifier) ------------ */
app.get('/read/book/:id', async (req, res) => {
  try {
    const { id } = req.params;
    let book = null;

    // Try Mongo ObjectId
    if (mongoose.isValidObjectId(id)) {
      book = await Book.findById(id);
    }
    // Try identifier
    if (!book) {
      book = await Book.findOne({ identifier: id });
    }

    if (!book) {
      // Render lightweight if not stored
      return res.render('book-viewer', {
        book: { _id: id, title: id, archiveId: id },
        isFavorite: false,
        user: req.session.user || null
      });
    }

    const isFavorite = req.session.user
      ? await Favorite.exists({ user: req.session.user._id, book: book._id })
      : false;

    res.render('book-viewer', {
      book,
      isFavorite,
      user: req.session.user || null
    });
  } catch (err) {
    console.error('Error loading book:', err);
    res.status(500).send('Internal Server Error');
  }
});

/* ------------ BOOKMARKS ------------ */
app.post('/read/book/:id/bookmark', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Login required');
  const { page } = req.body;
  try {
    let bm = await Bookmark.findOne({ user: req.session.user._id, book: req.params.id });
    if (bm) {
      bm.currentPage = page;
      await bm.save();
    } else {
      await Bookmark.create({
        user: req.session.user._id,
        book: req.params.id,
        currentPage: page
      });
    }
    res.send('✅ Bookmark saved!');
  } catch (err) {
    console.error('Bookmark error:', err);
    res.status(500).send('Server error');
  }
});

app.get('/read/book/:id/bookmark', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Login required');
  try {
    const bm = await Bookmark.findOne({ user: req.session.user._id, book: req.params.id });
    res.json({ page: bm?.currentPage || 1 });
  } catch (err) {
    console.error('Error loading bookmark:', err);
    res.status(500).send('Error loading bookmark');
  }
});

/* ------------ FAVORITES ------------ */
app.post('/read/book/:id/favorite', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Login required');
  try {
    const existing = await Favorite.findOne({
      user: req.session.user._id,
      book: req.params.id
    });

    if (existing) {
      await existing.deleteOne();
      res.send('❌ Removed from favorites');
    } else {
      await Favorite.create({
        user: req.session.user._id,
        book: req.params.id
      });
      res.send('❤️ Added to favorites');
    }
  } catch (err) {
    console.error('Favorite error:', err);
    res.status(500).send('Failed to toggle favorite');
  }
});

app.get('/favorites', isLoggedIn, async (req, res) => {
  try {
    const favorites = await Favorite.find({ user: req.session.user._id }).populate('book');
    res.render('favorites', {
      favorites,
      pageTitle: 'My Favorites',
      pageDescription: 'Books you saved.'
    });
  } catch (err) {
    console.error('Error loading favorites:', err);
    res.status(500).send('Internal Server Error');
  }
});

/* ------------ SETTINGS PAGE ------------ */
app.get('/settings', isLoggedIn, (req, res) => {
  res.render('settings', {
    pageTitle: 'Account Settings',
    pageDescription: 'Manage your BookLantern account.'
  });
});

/* ------------ robots.txt override ------------ */
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.sendFile(path.join(__dirname, 'public', 'robots.txt'));
});

/* ------------ Global error handler ------------ */
app.use((err, req, res, next) => {
  console.error('🔥 Unhandled error:', err);
  res.status(500).send('Internal Server Error');
});

/* ------------ 404 ------------ */
app.use((req, res) => {
  res.status(404).render('404', {
    pageTitle: 'Page Not Found',
    pageDescription: 'The page you’re looking for could not be found.'
  });
});

/* ------------ Start ------------ */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
