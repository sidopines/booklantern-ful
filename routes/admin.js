// routes/admin.js
const express = require('express');
const router = express.Router();
const { ensureAuthenticated, ensureAdmin } = require('../middleware/auth');

// Models
const User  = require('../models/User');
const Book  = require('../models/Book');
const Video = require('../models/Video');
const Genre = require('../models/Genre');

// Import homeRoutes to get the cache buster (safe even if already mounted)
let bustHomeCaches = () => {};
try {
  const homeRoutes = require('./homeRoutes');
  if (homeRoutes && typeof homeRoutes.bustHomeCaches === 'function') {
    bustHomeCaches = homeRoutes.bustHomeCaches;
  }
} catch (_) {}

// Async wrapper
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Small helpers
function ok(res, path) { return res.redirect(`${path}${path.includes('?') ? '&' : '?'}ok=1`); }
function err(res, path, msg='error') { return res.redirect(`${path}${path.includes('?') ? '&' : '?'}err=${encodeURIComponent(msg)}`); }

// Guard all admin routes
router.use(ensureAuthenticated, ensureAdmin);

/* Dashboard */
router.get('/', ah(async (req, res) => {
  const [users, books, videos, genres] = await Promise.all([
    User.countDocuments({}),
    Book.countDocuments({}),
    Video.countDocuments({}),
    Genre.countDocuments({})
  ]);
  res.render('admin/index', {
    pageTitle: 'Admin • Dashboard',
    pageDescription: 'Admin overview and shortcuts',
    stats: { users, books, videos, genres },
    ok: req.query.ok === '1',
    err: req.query.err || ''
  });
}));

/* Users */
router.get('/users', ah(async (req, res) => {
  const q = (req.query.q || '').trim();
  const find = q ? { $or: [{ email: new RegExp(q,'i') }, { name: new RegExp(q,'i') }] } : {};
  const users = await User.find(find).sort({ createdAt: -1 }).limit(100).lean();
  res.render('admin/users', { pageTitle: 'Admin • Users', pageDescription: 'Manage users', users, q, ok: req.query.ok==='1', err: req.query.err||'' });
}));

router.post('/users/:id/admin', ah(async (req, res) => {
  const id = req.params.id;
  if (String(id) === String(req.session.user?._id)) return err(res, '/admin/users', 'You cannot change your own admin flag.');
  const user = await User.findById(id);
  if (!user) return err(res, '/admin/users', 'User not found');
  user.isAdmin = !user.isAdmin;
  await user.save();
  return ok(res, '/admin/users');
}));

router.post('/users/:id/delete', ah(async (req, res) => {
  const id = req.params.id;
  if (String(id) === String(req.session.user?._id)) return err(res, '/admin/users', 'You cannot delete your own account.');
  await User.findByIdAndDelete(id);
  return ok(res, '/admin/users');
}));

/* Genres */
router.get('/genres', ah(async (req, res) => {
  const genres = await Genre.find({}).sort({ name: 1 }).lean();
  res.render('admin/genres', { pageTitle:'Admin • Genres', pageDescription:'Manage video genres', genres, ok: req.query.ok==='1', err: req.query.err||'' });
}));

router.post('/genres', ah(async (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return err(res, '/admin/genres', 'Name required');
  await Genre.create({ name });
  return ok(res, '/admin/genres');
}));

router.post('/genres/:id/delete', ah(async (req, res) => {
  await Genre.findByIdAndDelete(req.params.id);
  return ok(res, '/admin/genres');
}));

/* Videos */
router.get('/videos', ah(async (req, res) => {
  const [videos, genres] = await Promise.all([
    Video.find({}).populate('genre').sort({ createdAt: -1 }).lean(),
    Genre.find({}).sort({ name: 1 }).lean()
  ]);
  res.render('admin/videos', {
    pageTitle: 'Admin • Videos',
    pageDescription: 'Manage educational videos',
    videos, genres,
    ok: req.query.ok==='1', err: req.query.err||''
  });
}));

router.post('/videos', ah(async (req, res) => {
  const { title='', youtubeUrl='', thumbnail='', genre='', description='' } = req.body;
  if (!title || !youtubeUrl) return err(res, '/admin/videos', 'Title and YouTube URL are required');
  await Video.create({
    title: title.trim(),
    youtubeUrl: youtubeUrl.trim(),
    thumbnail: thumbnail.trim(),
    description: description.trim(),
    genre: genre || null
  });
  return ok(res, '/admin/videos');
}));

router.post('/videos/:id/delete', ah(async (req, res) => {
  await Video.findByIdAndDelete(req.params.id);
  return ok(res, '/admin/videos');
}));

/* Books */
router.get('/books', ah(async (req, res) => {
  const books = await Book.find({}).sort({ createdAt: -1 }).lean();
  res.render('admin/books', {
    pageTitle: 'Admin • Books',
    pageDescription: 'Manage local/admin-curated books',
    books,
    ok: req.query.ok==='1', err: req.query.err||''
  });
}));

router.post('/books', ah(async (req, res) => {
  const { title='', author='', sourceUrl='', coverImage='', description='' } = req.body;
  if (!title || !sourceUrl) return err(res, '/admin/books', 'Title and Source URL are required');
  await Book.create({
    title: title.trim(),
    author: author.trim(),
    sourceUrl: sourceUrl.trim(),
    coverImage: coverImage.trim(),
    description: description.trim()
  });
  bustHomeCaches();   // ← ensure homepage picks up new books immediately
  return ok(res, '/admin/books');
}));

router.post('/books/:id/delete', ah(async (req, res) => {
  await Book.findByIdAndDelete(req.params.id);
  bustHomeCaches();   // ← ensure homepage removes deleted books
  return ok(res, '/admin/books');
}));

module.exports = router;
