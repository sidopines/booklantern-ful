// routes/admin-users.js — Admin users management via Supabase
const express = require('express');
const router = express.Router();

const supabase = require('../supabaseAdmin');

function messagesFromQuery(q) {
  const msg = {};
  if (q.ok)  msg.success = 'Operation completed.';
  if (q.err) msg.error   = decodeURIComponent(q.err);
  return msg;
}

// GET /admin/users — list all users
router.get('/', async (req, res) => {
  if (!supabase) {
    return res.status(503).render('admin/users', {
      title: 'Users',
      messages: { error: 'Supabase is not configured.' },
      users: []
    });
  }

  try {
    // Fetch users from profiles table
    const { data: users, error } = await supabase
      .from('profiles')
      .select('id, email, display_name, is_admin, is_subscriber, created_at, email_verified')
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) {
      console.error('[admin/users] fetch failed:', error);
      return res.status(500).render('admin/users', {
        title: 'Users',
        messages: { error: 'Failed to load users: ' + error.message },
        users: []
      });
    }

    return res.render('admin/users', {
      title: 'Users',
      messages: messagesFromQuery(req.query),
      users: users || []
    });
  } catch (e) {
    console.error('[admin/users] error:', e);
    return res.status(500).render('admin/users', {
      title: 'Users',
      messages: { error: 'Unexpected error: ' + e.message },
      users: []
    });
  }
});

// POST /admin/users/:id/toggle-admin — toggle admin status
router.post('/:id/toggle-admin', async (req, res) => {
  if (!supabase) {
    return res.redirect(303, '/admin/users?err=' + encodeURIComponent('Supabase not configured'));
  }

  const userId = req.params.id;
  if (!userId) {
    return res.redirect(303, '/admin/users?err=' + encodeURIComponent('Missing user ID'));
  }

  try {
    // Get current status
    const { data: user, error: fetchErr } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', userId)
      .single();

    if (fetchErr || !user) {
      return res.redirect(303, '/admin/users?err=' + encodeURIComponent('User not found'));
    }

    // Toggle admin status
    const newStatus = !user.is_admin;
    const { error: updateErr } = await supabase
      .from('profiles')
      .update({ is_admin: newStatus })
      .eq('id', userId);

    if (updateErr) {
      console.error('[admin/users] toggle admin failed:', updateErr);
      return res.redirect(303, '/admin/users?err=' + encodeURIComponent(updateErr.message));
    }

    return res.redirect(303, '/admin/users?ok=1');
  } catch (e) {
    console.error('[admin/users] toggle admin error:', e);
    return res.redirect(303, '/admin/users?err=' + encodeURIComponent(e.message));
  }
});

// POST /admin/users/:id/delete — delete a user
router.post('/:id/delete', async (req, res) => {
  if (!supabase) {
    return res.redirect(303, '/admin/users?err=' + encodeURIComponent('Supabase not configured'));
  }

  const userId = req.params.id;
  if (!userId) {
    return res.redirect(303, '/admin/users?err=' + encodeURIComponent('Missing user ID'));
  }

  try {
    // Delete from profiles table
    const { error } = await supabase
      .from('profiles')
      .delete()
      .eq('id', userId);

    if (error) {
      console.error('[admin/users] delete failed:', error);
      return res.redirect(303, '/admin/users?err=' + encodeURIComponent(error.message));
    }

    // Optionally also delete from Supabase Auth (if using admin API)
    try {
      await supabase.auth.admin.deleteUser(userId);
    } catch (authErr) {
      console.warn('[admin/users] auth delete warning:', authErr.message);
      // Continue even if auth delete fails
    }

    return res.redirect(303, '/admin/users?ok=1');
  } catch (e) {
    console.error('[admin/users] delete error:', e);
    return res.redirect(303, '/admin/users?err=' + encodeURIComponent(e.message));
  }
});

module.exports = router;
