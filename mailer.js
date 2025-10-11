// mailer.js — minimal SMTP helper for Mailjet via Nodemailer

const nodemailer = require('nodemailer');

const {
  MAILJET_API_KEY,
  MAILJET_SECRET,
  MAIL_FROM = 'BookLantern <info@booklantern.org>',
  MAIL_HOST = 'in-v3.mailjet.com',
  MAIL_PORT = '587', // string ok; Nodemailer coerces to number
} = process.env;

// Create a single reusable transporter (warn if env missing)
let transporter = null;
function buildTransport() {
  if (!MAILJET_API_KEY || !MAILJET_SECRET) {
    console.warn('[mailer] Missing MAILJET_API_KEY or MAILJET_SECRET — email disabled.');
    return null;
  }
  try {
    return nodemailer.createTransport({
      host: MAIL_HOST,
      port: Number(MAIL_PORT) || 587,
      secure: false, // STARTTLS on 587
      auth: { user: MAILJET_API_KEY, pass: MAILJET_SECRET },
    });
  } catch (e) {
    console.error('[mailer] Failed to create transport:', e);
    return null;
  }
}
transporter = buildTransport();

// Small HTML escaper for safe interpolation
function escapeHtml(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Send an email.
 * @param {Object} opts
 * @param {string|string[]} opts.to - recipient(s)
 * @param {string} opts.subject
 * @param {string} [opts.text]
 * @param {string} [opts.html]
 * @param {string|string[]} [opts.cc]
 * @param {string|string[]} [opts.bcc]
 * @param {string} [opts.replyTo]
 */
async function send(opts = {}) {
  if (!transporter) {
    // Try once more in case envs were injected after boot
    transporter = buildTransport();
    if (!transporter) {
      throw new Error('Mailer not configured (missing MAILJET keys).');
    }
  }

  const { to, subject, text = '', html = '', cc, bcc, replyTo } = opts;

  if (!to) throw new Error('mailer.send: "to" is required');
  if (!subject) throw new Error('mailer.send: "subject" is required');

  const mail = {
    from: MAIL_FROM, // e.g. "BookLantern <info@booklantern.org>"
    to,
    subject,
    text,
    html: html || `<pre style="white-space:pre-wrap;font:inherit">${escapeHtml(text)}</pre>`,
    cc,
    bcc,
    replyTo,
  };

  return transporter.sendMail(mail);
}

module.exports = { send, escapeHtml };
