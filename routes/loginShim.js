// routes/loginShim.js
const express = require('express');
const router = express.Router();

/**
 * Fallback shim for POST /login
 * If your app already has POST /auth/login, this shim forwards to it.
 * Otherwise, it returns 501 to avoid "Cannot POST /login" and make the failure explicit.
 */
router.post('/login', (req, res, next) => {
  try {
    // If your app has a mounted /auth/login POST handler, rewrite and forward:
    if (req.app && req.app._router && req.app._router.stack.some(
      l => l.route && l.route.path === '/auth/login' && l.route.methods && l.route.methods.post
    )) {
      req.url = '/auth/login';
      return req.app.handle(req, res, next);
    }

    // No handler? Fail gracefully:
    console.error('POST /login has no backing handler. Either change login.ejs form action to your real endpoint, or mount an auth route.');
    return res.status(501).send('Login handler not configured.');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
