// routes/auth.js
const express = require('express');
const bcrypt  = require('bcryptjs');
const router  = express.Router();

const User     = require('../models/User');
const Favorite = require('../models/Favorite');
const Book     = require('../models/Book');

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────
function safeNext(url) {
  if (!url || typeof url !== 'string') return null;
  // allow only same-site relative paths, no protocol, no //
  if (url.startsWith('/') && !url.startsWith('//')) return url;
  return null;
}
function toSessionUser(u) {
  return { _id: u._id, name: u.name, email: u.email, isAdmin: !!u.isAdmin, isVerified: !!u.isVerified };
}
const REDIRECTS = {
  afterLogin(u, next) {
    const n = safeNext(next);
    if (n) return n;
    return u.isAdmin ? '/admin' : '/dashboard';
  },
  afterRegister(u, next) {
    const n = safeNext(next);
    if (n) return n;
    return u.isAdmin ? '/admin' : '/dashboard';
  }
};

// ────────────────────────────────────────────────────────────
// GET /register
// ────────────────────────────────────────────────────────────
router.get('/register', (req, res) => {
  if (req.session.user) {
    return res.redirect(req.session.user.isAdmin ? '/admin' : '/dashboard');
  }
  res.render('register', {
    pageTitle: 'Register | BookLantern',
    pageDescription: 'Create your free account',
  });
});

// ────────────────────────────────────────────────────────────
// POST /register
// ────────────────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { name = '', email = '', password = '', adminSetupSecret = '', next = '' } = req.body;

    const cleanName  = String(name).trim();
    const cleanEmail = String(email).trim().toLowerCase();
    const cleanPass  = String(password);

    if (!cleanName || !cleanEmail || !cleanPass) {
      return res.status(400).render('register', {
        pageTitle: 'Register | BookLantern',
        pageDescription: 'Create your free account',
        error: 'All fields are required.'
      });
    }

    const exists = await User.findOne({ email: cleanEmail });
    if (exists) {
      return res.status(400).render('register', {
        pageTitle: 'Register | BookLantern',
        pageDescription: 'Create your free account',
        error: 'That email is already registered. Try logging in.'
      });
    }

    const hash = await bcrypt.hash(cleanPass, 12);

    // Allow bootstrapping an admin via secret (optional)
    let isAdmin = false;
    if (process.env.ADMIN_SETUP_SECRET && adminSetupSecret) {
      if (adminSetupSecret === process.env.ADMIN_SETUP_SECRET) {
        isAdmin = true;
      }
    }

    // If you want email verification later, set isVerified:false and send an email.
    const user = await User.create({
      name: cleanName,
      email: cleanEmail,
      password: hash,
      isVerified: true,
      isAdmin
    });

    req.session.user = toSessionUser(user);
    return res.redirect(REDIRECTS.afterRegister(user, next));
  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).render('register', {
      pageTitle: 'Register | BookLantern',
      pageDescription: 'Create your free account',
      error: 'Something went wrong. Please try again.'
    });
  }
});

// ────────────────────────────────────────────────────────────
// GET /login
// ────────────────────────────────────────────────────────────
router.get('/login', (req, res) => {
  if (req.session.user) {
    return res.redirect(req.session.user.isAdmin ? '/admin' : '/dashboard');
  }
  res.render('login', {
    pageTitle: 'Login | BookLantern',
    pageDescription: 'Access your account',
    next: safeNext(req.query.next) || ''
  });
});

// ────────────────────────────────────────────────────────────
// POST /login
// ────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email = '', password = '', next = '' } = req.body;
    const cleanEmail = String(email).trim().toLowerCase();
    const cleanPass  = String(password);

    const user = await User.findOne({ email: cleanEmail });
    if (!user) {
      return res.status(400).render('login', {
        pageTitle: 'Login | BookLantern',
        pageDescription: 'Access your account',
        error: 'Invalid email or password.',
        next: safeNext(next) || ''
      });
    }

    const ok = await bcrypt.compare(cleanPass, user.password);
    if (!ok) {
      return res.status(400).render('login', {
        pageTitle: 'Login | BookLantern',
        pageDescription: 'Access your account',
        error: 'Invalid email or password.',
        next: safeNext(next) || ''
      });
    }

    req.session.user = toSessionUser(user);

    // If non-admins somehow try to land at /admin via ?next, ignore it
    const candidate = REDIRECTS.afterLogin(user, next);
    if (!user.isAdmin && candidate.startsWith('/admin')) {
      return res.redirect('/dashboard');
    }
    return res.redirect(candidate);
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).render('login', {
      pageTitle: 'Login | BookLantern',
      pageDescription: 'Access your account',
      error: 'Something went wrong. Please try again.',
      next: safeNext(req.body.next) || ''
    });
  }
});

// ────────────────────────────────────────────────────────────
// GET /logout
// ────────────────────────────────────────────────────────────
router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.redirect('/');
  });
});

// ────────────────────────────────────────────────────────────
// GET /dashboard  (regular users)
// ────────────────────────────────────────────────────────────
router.get('/dashboard', async (req, res) => {
  try {
    if (!req.session.user) return res.redirect('/login?next=/dashboard');
    if (req.session.user.isAdmin) return res.redirect('/admin');

    // Show simple list of favorites (if the Favorite model exists)
    let favorites = [];
    try {
      favorites = await Favorite.find({ user: req.session.user._id })
        .populate('book') // if local book linked
        .sort({ createdAt: -1 })
        .limit(50)
        .lean();
    } catch (_) {
      favorites = [];
    }

    res.render('dashboard', {
      pageTitle: 'Dashboard',
      pageDescription: 'Your account overview',
      user: req.session.user,
      favorites
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).send('Internal Server Error');
  }
});

// ────────────────────────────────────────────────────────────
// GET /settings  (change password for current user)
// POST /settings
// ────────────────────────────────────────────────────────────
router.get('/settings', async (req, res) => {
  try {
    if (!req.session.user) return res.redirect('/login?next=/settings');

    // Load favorites to mirror previous UI (optional)
    let favorites = [];
    try {
      favorites = await Favorite.find({ user: req.session.user._id })
        .populate('book')
        .sort({ createdAt: -1 })
        .limit(50)
        .lean();
    } catch (_) {}

    res.render('settings', {
      pageTitle: 'Account Settings',
      pageDescription: 'Manage your BookLantern account.',
      user: req.session.user,
      favorites
    });
  } catch (err) {
    console.error('Settings (GET) error:', err);
    res.status(500).send('Internal Server Error');
  }
});

router.post('/settings', async (req, res) => {
  try {
    if (!req.session.user) return res.redirect('/login?next=/settings');

    const { oldPassword = '', newPassword = '' } = req.body;
    const user = await User.findById(req.session.user._id);
    if (!user) return res.redirect('/login');

    const ok = await bcrypt.compare(String(oldPassword), user.password);
    if (!ok) {
      return res.status(400).render('settings', {
        pageTitle: 'Account Settings',
        pageDescription: 'Manage your BookLantern account.',
        user: req.session.user,
        error: 'Current password is incorrect.'
      });
    }

    if (!newPassword || String(newPassword).length < 6) {
      return res.status(400).render('settings', {
        pageTitle: 'Account Settings',
        pageDescription: 'Manage your BookLantern account.',
        user: req.session.user,
        error: 'New password must be at least 6 characters.'
      });
    }

    user.password = await bcrypt.hash(String(newPassword), 12);
    await user.save();
    return res.render('settings', {
      pageTitle: 'Account Settings',
      pageDescription: 'Manage your BookLantern account.',
      user: req.session.user,
      success: 'Password updated.'
    });
  } catch (err) {
    console.error('Settings (POST) error:', err);
    res.status(500).send('Internal Server Error');
  }
});

// ────────────────────────────────────────────────────────────
// Optional: bootstrap the first admin (if needed)
// GET /admin-setup?secret=...  → promotes the current logged-in user to admin
// ────────────────────────────────────────────────────────────
router.get('/admin-setup', async (req, res) => {
  try {
    if (!process.env.ADMIN_SETUP_SECRET) return res.status(404).send('Not enabled.');
    if (!req.session.user) return res.redirect('/login?next=/admin-setup');

    const { secret = '' } = req.query;
    if (secret !== process.env.ADMIN_SETUP_SECRET) return res.status(403).send('Invalid secret');

    const user = await User.findById(req.session.user._id);
    if (!user) return res.redirect('/login');

    user.isAdmin = true;
    await user.save();
    req.session.user = toSessionUser(user);
    return res.redirect('/admin');
  } catch (err) {
    console.error('admin-setup error:', err);
    res.status(500).send('Internal Server Error');
  }
});

module.exports = router;
