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

// Carry next through session so templates don’t need a hidden field
function stashNext(req) {
  const qn = safeNext(req.query.next);
  if (qn) req.session.authNext = qn;
}
function pullNext(req) {
  const bodyNext = safeNext(req.body?.next);
  const queryNext = safeNext(req.query?.next);
  const sessionNext = safeNext(req.session?.authNext);
  const n = bodyNext || queryNext || sessionNext || null;
  if (req.session) req.session.authNext = null; // clear once used
  return n;
}

// ────────────────────────────────────────────────────────────
// GET /register
// ────────────────────────────────────────────────────────────
router.get('/register', (req, res) => {
  if (req.session.user) {
    return res.redirect(req.session.user.isAdmin ? '/admin' : '/dashboard');
  }
  stashNext(req); // remember ?next for after registration
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
    const { name = '', email = '', password = '' } = req.body;

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

    // If you implement email verification later, set isVerified:false and send an email.
    const user = await User.create({
      name: cleanName,
      email: cleanEmail,
      password: hash,
      isVerified: true,
      isAdmin: false
    });

    req.session.user = toSessionUser(user);
    const nextDest = pullNext(req);
    return res.redirect(REDIRECTS.afterRegister(user, nextDest || ''));
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
  stashNext(req); // remember ?next for after login
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
    const { email = '', password = '' } = req.body;
    const cleanEmail = String(email).trim().toLowerCase();
    const cleanPass  = String(password);

    const user = await User.findOne({ email: cleanEmail });
    if (!user) {
      return res.status(400).render('login', {
        pageTitle: 'Login | BookLantern',
        pageDescription: 'Access your account',
        error: 'Invalid email or password.',
        next: safeNext(req.body.next) || ''
      });
    }

    const ok = await bcrypt.compare(cleanPass, user.password);
    if (!ok) {
      return res.status(400).render('login', {
        pageTitle: 'Login | BookLantern',
        pageDescription: 'Access your account',
        error: 'Invalid email or password.',
        next: safeNext(req.body.next) || ''
      });
    }

    req.session.user = toSessionUser(user);

    // Prefer ?next saved in session (so clicks from homepage go through correctly)
    const nextParam = pullNext(req);
    const candidate = REDIRECTS.afterLogin(user, nextParam || '');

    // Non-admins cannot land on /admin even if next tried to force it
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

module.exports = router;
