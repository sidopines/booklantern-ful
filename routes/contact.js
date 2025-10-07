// routes/contact.js
const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer');

// Your existing admin client. If your project uses a different path/name,
// change the require accordingly.
let supabaseAdmin = null;
try {
  supabaseAdmin = require('../supabaseAdmin');
} catch (_) {
  console.warn('[contact] ../supabaseAdmin not found; DB insert will be skipped.');
}

/* =========================
   Email (Mailjet via SMTP)
   ========================= */
const mailTransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'in-v3.mailjet.com',
  port: Number(process.env.SMTP_PORT || 587),
  secure: false, // STARTTLS on 587
  auth: {
    user: process.env.SMTP_USER, // Mailjet API Key
    pass: process.env.SMTP_PASS  // Mailjet Secret Key
  }
});

const MAIL_FROM = process.env.MAIL_FROM || 'BookLantern <info@booklantern.org>';
const MAIL_TO   = process.env.MAIL_TO   || 'info@booklantern.org';

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
   GET /contact  (renders page)
   ========================= */
router.get('/contact', (req, res) => {
  // Pass referrer if you want your back link partial to use it
  res.render('contact', { referrer: req.get('referer') || null });
});

/* =========================
   POST /contact  (save + email)
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
          user_agent: req.get('user-agent') || null
        });
      if (dbErr) console.error('[contact] supabase insert error:', dbErr);
    }

    // Notify you
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
      replyTo: safeEmail,
      subject: 'New Contact Message — BookLantern',
      html: adminHtml
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
      html: ackHtml
    });

    // Show success flash on the page
    return res.render('contact', { sent: true });

  } catch (err) {
    console.error('[contact] error:', err);
    return res.render('contact', {
      error: 'Something went wrong sending your message. Please try again.'
    });
  }
});

module.exports = router;
