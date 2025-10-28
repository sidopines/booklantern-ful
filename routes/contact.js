// routes/contact.js
const express = require('express');
const router = express.Router();

// Supabase admin (best-effort save to DB)
let supabaseAdmin = null;
try {
  supabaseAdmin = require('../supabaseAdmin');
} catch (_) {
  console.warn('[contact] ../supabaseAdmin not found; DB insert will be skipped.');
}

/* =========================
   Mail via Mailjet SDK
   ========================= */
let Mailjet = null;
try {
  Mailjet = require('node-mailjet');
} catch (_) {
  console.error('[contact] node-mailjet not installed — email sending will fail.');
}

const env = process.env;
// Keys (support both naming styles you showed)
const MJ_PUBLIC  = env.MJ_APIKEY_PUBLIC  || env.MAILJET_API_KEY || '';
const MJ_PRIVATE = env.MJ_APIKEY_PRIVATE || env.MAILJET_SECRET_KEY || '';
// Sender/recipient
const FROM_EMAIL = env.MAILJET_FROM       || env.MAILJET_FROM_EMAIL || env.CONTACT_FROM_EMAIL || 'info@booklantern.org';
const FROM_NAME  = env.MAILJET_FROM_NAME  || 'BookLantern';
const TO_EMAIL   = env.MAILJET_TO         || env.CONTACT_NOTIFY_TO  || 'info@booklantern.org';

function mailConfigured() {
  const ok = Boolean(Mailjet && MJ_PUBLIC && MJ_PRIVATE && FROM_EMAIL && TO_EMAIL);
  if (!ok) {
    console.error('[contact] Mailjet not configured (missing SDK or env vars).');
  }
  return ok;
}

/* =========================
   Helpers
   ========================= */
const clean = (s) => String(s || '').trim();
const firstName = (full) => String(full || '').split(' ')[0] || '';
const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* =========================
   GET /contact (render)
   ========================= */
router.get('/contact', (req, res) => {
  res.render('contact', { referrer: req.get('referer') || null });
});

/* =========================
   POST /contact (save + email)
   ========================= */
router.post('/contact', async (req, res) => {
  try {
    const { name = '', email = '', message = '', website = '' } = req.body || {};

    // Honeypot (bots only)
    if (website && website.trim() !== '') {
      return res.render('contact', { sent: true });
    }

    const safeName  = clean(name).slice(0, 120);
    const safeEmail = clean(email).slice(0, 160).toLowerCase();
    const safeMsg   = clean(message).slice(0, 5000);

    if (!safeName || !safeEmail || !isValidEmail(safeEmail) || !safeMsg) {
      return res.render('contact', { error: 'Please fill all fields correctly.' });
    }

    // Save to Supabase (best-effort)
    if (supabaseAdmin) {
      const { error: dbErr } = await supabaseAdmin
        .from('contact_messages')
        .insert({
          name: safeName,
          email: safeEmail,
          message: safeMsg,
          ip: req.ip,
          user_agent: req.get('user-agent') || null
        });
      if (dbErr) console.error('[contact] supabase insert error:', dbErr);
    }

    // Send via Mailjet
    if (!mailConfigured()) {
      return res.render('contact', {
        error: 'Email temporarily unavailable. Your message was saved; please try again shortly.'
      });
    }

    const client = Mailjet.apiConnect(MJ_PUBLIC, MJ_PRIVATE);

    const subject = `New Contact Message — ${safeName || 'Unknown'}`;
    const text = [
      `You received a new contact message on BookLantern.`,
      '',
      `Name:  ${safeName}`,
      `Email: ${safeEmail}`,
      `IP:    ${req.ip || ''}`,
      `Agent: ${req.get('user-agent') || ''}`,
      '',
      'Message:',
      safeMsg
    ].join('\n');

    const html = `
      <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; line-height:1.6;">
        <h2 style="margin:0 0 10px;">New contact message</h2>
        <table style="border-collapse:collapse; font-size:14px">
          <tr><td style="padding:2px 8px 2px 0; color:#555;">Name:</td><td>${escapeHtml(safeName)}</td></tr>
          <tr><td style="padding:2px 8px 2px 0; color:#555;">Email:</td><td>${escapeHtml(safeEmail)}</td></tr>
          <tr><td style="padding:2px 8px 2px 0; color:#555;">IP:</td><td>${escapeHtml(req.ip || '')}</td></tr>
          <tr><td style="padding:2px 8px 2px 0; color:#555;">Agent:</td><td>${escapeHtml(req.get('user-agent') || '')}</td></tr>
        </table>
        <hr style="border:none;border-top:1px solid #eee; margin:12px 0;">
        <pre style="white-space:pre-wrap; font-size:14px; margin:0">${escapeHtml(safeMsg)}</pre>
      </div>
    `;

    const payload = {
      Messages: [
        {
          From:   { Email: FROM_EMAIL, Name: FROM_NAME },
          To:     [{ Email: TO_EMAIL,  Name: 'BookLantern Inbox' }],
          Subject: subject,
          TextPart: text,
          HTMLPart: html,
          ReplyTo: { Email: safeEmail, Name: safeName }
        }
      ]
    };

    const mjRes = await client.post('send', { version: 'v3.1' }).request(payload);
    const ok = Array.isArray(mjRes?.body?.Messages) &&
               mjRes.body.Messages[0]?.Status === 'success';

    if (!ok) {
      console.error('[contact] Mailjet unexpected response:', mjRes?.body);
      return res.render('contact', {
        error: 'We couldn’t send the email just now. Your message was saved; please try again soon.'
      });
    }

    // All good
    return res.render('contact', { sent: true });

  } catch (err) {
    console.error('[contact] error:', err);
    return res.render('contact', {
      error: 'Something went wrong sending your message. Please try again.'
    });
  }
});

module.exports = router;
