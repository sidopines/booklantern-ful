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

const Video = require('./models/Video');
const Genre = require('./models/Genre');
const Book  = require('./models/Book');

const app = express();

// ─── MONGODB ────────────────────────────────────────────────────────
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Connected to MongoDB Atlas'))
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });

// ─── MIDDLEWARE & CONFIG ────────────────────────────────────────────
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
    store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI }),
    cookie: { secure: false, maxAge: 1000 * 60 * 60 * 24 }
  })
);

// provide defaults for head partial
app.use((req, res, next) => {
  res.locals.pageTitle = 'BookLantern';
  res.locals.pageDescription = 'Free books & educational videos.';
  next();
});

// ─── ROUTES ───────────────────────────────────────────────────────────
app.use('/', indexRoutes);
app.use('/', authRoutes);
app.use('/', bookRoutes);

// ─── ADMIN PANEL ───────────────────────────────────────────────────────
app.get('/admin', async (req, res) => {
  try {
    const genres = await Genre.find({});
    const videos = await Video.find({}).populate('genre').sort({ createdAt: -1 });
    const books  = await Book.find({}).sort({ createdAt: -1 }).limit(10);
    res.render('admin', { genres, videos, books, pageTitle: 'Admin', pageDescription: 'Manage content' });
  } catch (err) {
    console.error('Admin load error:', err);
    res.status(500).send('Internal Server Error');
  }
});

// Add new video
app.post('/admin/add-video', async (req, res) => {
  try {
    const { title, genre, youtubeUrl, thumbnail, description } = req.body;
    if (!title || !genre || !youtubeUrl) {
      return res.send('Title, Genre and YouTube URL are required.');
    }
    await Video.create({ title, genre, youtubeUrl, thumbnail, description });
    res.redirect('/admin');
  } catch (err) {
    console.error('❌ Error adding video:', err);
    res.status(500).send('Error adding video');
  }
});

// Delete video
app.post('/admin/delete-video/:id', async (req, res) => {
  try {
    await Video.findByIdAndDelete(req.params.id);
    res.redirect('/admin');
  } catch (err) {
    console.error('❌ Error deleting video:', err);
    res.status(500).send('Error deleting video');
  }
});

// Add new genre
app.post('/admin/add-genre', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.send('Genre name is required.');
    await Genre.create({ name });
    res.redirect('/admin');
  } catch (err) {
    console.error('❌ Error adding genre:', err);
    res.status(500).send('Error adding genre');
  }
});

// Add new book
app.post('/admin/add-book', async (req, res) => {
  try {
    const { title, author, description, sourceUrl, coverImage, genre } = req.body;
    if (!title || !sourceUrl) {
      return res.send('Title and Source URL are required.');
    }
    await Book.create({ title, author, description, sourceUrl, coverImage, genre });
    res.redirect('/admin');
  } catch (err) {
    console.error('❌ Error adding book:', err);
    res.status(500).send('Error adding book');
  }
});

// ─── robots.txt ─────────────────────────────────────────────────────────
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.sendFile(path.join(__dirname, 'public/robots.txt'));
});

// ─── 404 & ERROR HANDLING ───────────────────────────────────────────────
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

// ─── START ───────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
