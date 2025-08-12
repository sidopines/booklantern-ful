// routes/admin.js
const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middleware/auth');

const User  = require('../models/User');
const Book  = require('../models/Book');
const Video = require('../models/Video');
const Genre = require('../models/Genre');

// All admin pages/APIs require admin login
router.use(requireAdmin);

/* =========================
   DASHBOARD
   ========================= */
router.get('/', async (req, res) => {
  try {
    const [users, books, videos, genres] = await Promise.all([
      User.countDocuments({}),
      Book.countDocuments({}),
      Video.countDocuments({}),
      Genre.countDocuments({}),
    ]);

    res.render('admin/dashboard', {
      pageTitle: 'Admin · Dashboard',
      pageDescription: 'Overview',
      counts: { users, books, videos, genres },
    });
  } catch (e) {
    console.error('admin dashboard error:', e);
    res.status(500).send('Admin dashboard error');
  }
});

/* =========================
   BOOKS
   ========================= */
router.get('/books', async (req, res) => {
  try {
    const books = await Book.find({}).sort({ createdAt: -1 }).lean();
    res.render('admin/books', {
      pageTitle: 'Admin · Books',
      pageDescription: 'Manage local/curated books',
      books,
    });
  } catch (e) {
    console.error('admin books list error:', e);
    res.status(500).send('Admin books error');
  }
});

router.post('/books', async (req, res) => {
  try {
    const { title, author, sourceUrl, coverImage, genre, description } = req.body;
    await Book.create({
      title,
      author,
      sourceUrl,
      coverImage,
      genre,        // optional free-text in your schema
      description,
    });
    res.redirect('/admin/books');
  } catch (e) {
    console.error('admin create book error:', e);
    res.status(500).send('Failed to add book');
  }
});

router.post('/books/:id/delete', async (req, res) => {
  try {
    await Book.findByIdAndDelete(req.params.id);
    res.redirect('/admin/books');
  } catch (e) {
    console.error('admin delete book error:', e);
    res.status(500).send('Failed to delete book');
  }
});

/* =========================
   VIDEOS
   ========================= */
router.get('/videos', async (req, res) => {
  try {
    const [videos, genres] = await Promise.all([
      Video.find({}).populate('genre').sort({ createdAt: -1 }).lean(),
      Genre.find({}).sort({ name: 1 }).lean(),
    ]);
    res.render('admin/videos', {
      pageTitle: 'Admin · Videos',
      pageDescription: 'Manage videos',
      videos,
      genres,
    });
  } catch (e) {
    console.error('admin videos list error:', e);
    res.status(500).send('Admin videos error');
  }
});

router.post('/videos', async (req, res) => {
  try {
    const { title, youtubeUrl, thumbnail, genre, description } = req.body;
    await Video.create({ title, youtubeUrl, thumbnail, genre, description });
    res.redirect('/admin/videos');
  } catch (e) {
    console.error('admin create video error:', e);
    res.status(500).send('Failed to add video');
  }
});

router.post('/videos/:id/delete', async (req, res) => {
  try {
    await Video.findByIdAndDelete(req.params.id);
    res.redirect('/admin/videos');
  } catch (e) {
    console.error('admin delete video error:', e);
    res.status(500).send('Failed to delete video');
  }
});

/* =========================
   GENRES
   ========================= */
router.get('/genres', async (req, res) => {
  try {
    const genres = await Genre.find({}).sort({ name: 1 }).lean();
    res.render('admin/genres', {
      pageTitle: 'Admin · Genres',
      pageDescription: 'Manage video genres',
      genres,
    });
  } catch (e) {
    console.error('admin genres list error:', e);
    res.status(500).send('Admin genres error');
  }
});

router.post('/genres', async (req, res) => {
  try {
    const { name } = req.body;
    if (name && name.trim()) {
      await Genre.create({ name: name.trim() });
    }
    res.redirect('/admin/genres');
  } catch (e) {
    console.error('admin create genre error:', e);
    res.status(500).send('Failed to add genre');
  }
});

router.post('/genres/:id/delete', async (req, res) => {
  try {
    await Genre.findByIdAndDelete(req.params.id);
    res.redirect('/admin/genres');
  } catch (e) {
    console.error('admin delete genre error:', e);
    res.status(500).send('Failed to delete genre');
  }
});

/* =========================
   USERS
   ========================= */
router.get('/users', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = 20;
    const q = (req.query.q || '').trim();

    const filter = q
      ? {
          $or: [
            { email: new RegExp(q, 'i') },
            { name: new RegExp(q, 'i') },
          ],
        }
      : {};

    const [items, total] = await Promise.all([
      User.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      User.countDocuments(filter),
    ]);

    res.render('admin/users', {
      pageTitle: 'Admin · Users',
      pageDescription: 'Manage users',
      users: items,
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
      q,
      meId: String(req.session.user._id),
    });
  } catch (e) {
    console.error('admin users list error:', e);
    res.status(500).send('Admin users error');
  }
});

router.post('/users/:id/toggle-admin', async (req, res) => {
  try {
    const id = req.params.id;
    const meId = String(req.session.user._id);
    if (id === meId) {
      return res.status(400).send("You can't change your own admin status.");
    }
    const user = await User.findById(id);
    if (!user) return res.status(404).send('User not found');

    user.isAdmin = !user.isAdmin;
    await user.save();
    res.redirect('/admin/users');
  } catch (e) {
    console.error('toggle admin error:', e);
    res.status(500).send('Failed to toggle admin');
  }
});

router.post('/users/:id/toggle-verify', async (req, res) => {
  try {
    const id = req.params.id;
    const user = await User.findById(id);
    if (!user) return res.status(404).send('User not found');

    user.isVerified = !user.isVerified;
    await user.save();
    res.redirect('/admin/users');
  } catch (e) {
    console.error('toggle verify error:', e);
    res.status(500).send('Failed to toggle verify');
  }
});

router.post('/users/:id/delete', async (req, res) => {
  try {
    const id = req.params.id;
    const meId = String(req.session.user._id);
    if (id === meId) {
      return res.status(400).send("You can't delete your own account here.");
    }

    // Prevent deleting the last remaining admin
    const target = await User.findById(id);
    if (!target) return res.status(404).send('User not found');

    if (target.isAdmin) {
      const adminCount = await User.countDocuments({ isAdmin: true });
      if (adminCount <= 1) {
        return res.status(400).send('Cannot delete the last admin.');
      }
    }

    await User.findByIdAndDelete(id);
    res.redirect('/admin/users');
  } catch (e) {
    console.error('delete user error:', e);
    res.status(500).send('Failed to delete user');
  }
});

module.exports = router;
