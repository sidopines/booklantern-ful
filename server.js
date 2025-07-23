// server.js
require('dotenv').config();

const express    = require('express');
const mongoose   = require('mongoose');
const path       = require('path');
const session    = require('express-session');
const MongoStore = require('connect-mongo');

/* Routers */
const authRoutes  = require('./routes/auth');
const bookRoutes  = require('./routes/bookRoutes'); // handles /read, /read/book, bookmarks, favorites
const indexRoutes = require('./routes/index');

/* Models used here */
const Video = require('./models/Video');
const Genre = require('./models/Genre');
const Book  = require('./models/Book'); // only for admin list

const app = express();

/* ---------- MongoDB ---------- */
const mongoURI = process.env.MONGODB_URI;
mongoose
  .connect(mongoURI)
  .then(() => console.log('✅ Connected to MongoDB Atlas'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

/* ---------- Express setup ---------- */
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

/* Default meta to avoid EJS undefined errors */
app.use((req, res, next) => {
  res.locals.pageTitle = res.locals.pageTitle || 'BookLantern';
  res.locals.pageDescription = res.locals.pageDescription || 'Free books & educational videos.';
  next();
});

/* Simple auth guard for routes in this file */
function isLoggedIn(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.redirect('/login');
}

/* ---------- Mount routers ---------- */
app.use('/', indexRoutes); // home, about, contact
app.use('/', authRoutes);  // login, register, dashboard, settings, etc.
app.use('/', bookRoutes);  // /read, /read/book/:identifier, bookmarks, favorites

/* ---------- Admin panel ---------- */
app.get('/admin', isLoggedIn, async (req, res) => {
  try {
    const genres = await Genre.find({});
    const videos = await Video.find({})
      .populate('genre')
      .sort({ createdAt: -1 });
    const books  = await Book.find({})
      .sort({ createdAt: -1 })
      .limit(5);

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

/* ---------- Watch page ---------- */
app.get('/watch', async (req, res) => {
  try {
    const genreFilter = req.query.genre || '';
    const genres = await Genre.find({});
    const query = genreFilter ? { genre: genreFilter } : {};
    const videos = await Video.find(query)
      .populate('genre')
      .sort({ createdAt: -1 });

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

/* ---------- Video player ---------- */
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

/* ---------- robots.txt override ---------- */
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.sendFile(path.join(__dirname, 'public', 'robots.txt'));
});

/* ---------- Error handler ---------- */
app.use((err, req, res, next) => {
  console.error('🔥 Unhandled error:', err);
  res.status(500).send('Internal Server Error');
});

/* ---------- 404 ---------- */
app.use((req, res) => {
  res.status(404).render('404', {
    pageTitle: 'Page Not Found',
    pageDescription: 'The page you’re looking for could not be found.'
  });
});

/* ---------- Start ---------- */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
