// routes/contact.js
const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer');

// Optional Supabase admin client for logging to DB
let supabaseAdmin = null;
try {
  supabaseAdmin = require('../supabaseAdmin');
} catch (_) {
  console.warn('[contact] ../supabaseAdmin not found; DB insert will be skipped.');
}

/* =========================
   Email (Mailjet via SMTP)
   ========================= */
// Accept both SMTP_* and MAILJET_* env styles
const SMTP_HOST = process.env.SMTP_HOST || 'in-v3.mailjet.com';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || process.env.MAILJET_API_KEY || process.env.MJ_APIKEY_PUBLIC;
const SMTP_PASS = process.env.SMTP_PASS || process.env.MAILJET_SECRET_KEY || process.env.MJ_APIKEY_PRIVATE;

// From / To fallbacks (align with your Render screen)
const MAIL_FROM =
  process.env.MAIL_FROM ||
  (process.env.MAILJET_FROM_EMAIL
    ? `${process.env.MAILJET_FROM_NAME || 'BookLantern'} <${process.env.MAILJET_FROM_EMAIL}>`
    : 'BookLantern <info@booklantern.org>');

const MAIL_TO =
  process.env.MAIL_TO ||
  process.env.MAILJET_TO ||
  process.env.CONTACT_NOTIFY_TO ||
  'info@booklantern.org';

const mailTransporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: false, // STARTTLS on 587
  auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
});

/* =========================
   Helpers
   ========================= */
const clean = (s) => String(s || '').trim();
const firstName = (full) => String(full || '').split(' ')[0] || '';
const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/* =========================
   GET /contact (renders page)
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

    // Honeypot: bots fill this, humans don't
    if (website && website.trim() !== '') {
      return res.render('contact', { sent: true });
    }

    const safeName = clean(name).slice(0, 120);
    const safeEmail = clean(email).slice(0, 160).toLowerCase();
    const safeMsg = clean(message).slice(0, 5000);

    if (!safeName || !safeEmail || !isValidEmail(safeEmail) || !safeMsg) {
      return res.render('contact', { error: 'Please fill all fields correctly.' });
    }

    // Save in Supabase (best effort)
    if (supabaseAdmin) {
      const { error: dbErr } = await supabaseAdmin
        .from('contact_messages')
        .insert({
          name: safeName,
          email: safeEmail,
          message: safeMsg,
          ip: req.ip,
          user_agent: req.get('user-agent') || null,
        });
      if (dbErr) console.error('[contact] supabase insert error:', dbErr);
    }

    // Admin notification
    const adminHtml = `
      <p><strong>New contact message</strong></p>
      <p><strong>Name:</strong> ${escapeHtml(safeName)}<br>
         <strong>Email:</strong> ${escapeHtml(safeEmail)}</p>
      <p style="white-space:pre-wrap">${escapeHtml(safeMsg)}</p>
      <hr>
      <p style="color:#666;font-size:12px">
        IP: ${escapeHtml(req.ip || '')}<br>
        UA: ${escapeHtml(req.get('user-agent') || '')}
      </p>
    `;

    await mailTransporter.sendMail({
      from: MAIL_FROM,
      to: MAIL_TO,
      replyTo: safeEmail ? { name: safeName || safeEmail, address: safeEmail } : undefined,
      subject: 'New Contact Message — BookLantern',
      html: adminHtml,
    });

    // Auto-acknowledge sender
    const ackHtml = `
      <p>Hi ${escapeHtml(firstName(safeName)) || 'there'},</p>
      <p>Thanks for reaching out to <strong>BookLantern</strong>! We received your message and will get back to you soon.</p>
      <p style="margin-top:18px;color:#666;font-size:12px">If you didn't send this, you can ignore this email.</p>
      <p style="margin-top:24px;color:#98a2b3;font-size:12px">© 2025 BookLantern</p>
    `;

    await mailTransporter.sendMail({
      from: MAIL_FROM,
      to: safeEmail,
      subject: 'We received your message — BookLantern',
      html: ackHtml,
    });

    return res.render('contact', { sent: true });
  } catch (err) {
    console.error('[contact] error:', err);
    return res.render('contact', {
      error: 'Something went wrong sending your message. Please try again.',
    });
  }
});

module.exports = router;
