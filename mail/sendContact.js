// mail/sendContact.js
// Mailjet wrapper for Contact form notifications with robust env detection + safe logging.

let Mailjet = null;
try {
  Mailjet = require('node-mailjet');
} catch {
  // Dependency missing — we'll no-op below.
}

const env = process.env;

// Accept both naming schemes.
const MJ_PUBLIC  = env.MJ_APIKEY_PUBLIC  || env.MAILJET_API_KEY || '';
const MJ_PRIVATE = env.MJ_APIKEY_PRIVATE || env.MAILJET_SECRET_KEY || '';

// Sender/recipient
const FROM_EMAIL = env.MAILJET_FROM_EMAIL || env.CONTACT_FROM_EMAIL || 'info@booklantern.org';
const FROM_NAME  = env.MAILJET_FROM_NAME  || 'BookLantern';
const TO_EMAIL   = env.MAILJET_TO || env.CONTACT_NOTIFY_TO || 'info@booklantern.org';

// One-time boot log so we can see if email is wired in Render logs
let bootLogged = false;
function bootLog(msg) {
  if (!bootLogged) {
    console.log(`[mail] ${msg}`);
    bootLogged = true;
  }
}

function isConfigured() {
  const ok = Boolean(Mailjet && MJ_PUBLIC && MJ_PRIVATE && TO_EMAIL && FROM_EMAIL);
  bootLog(ok
    ? `Mailjet ready (from=${FROM_EMAIL} → to=${TO_EMAIL}; key=${MJ_PUBLIC.slice(0,4)}…);`
    : `Mailjet not configured — skipping sends (missing API keys or emails).`
  );
  return ok;
}

/**
 * sendContact({ name, email, message, ip, userAgent })
 * Returns true on success, false on no-op/failure.
 */
async function sendContact({ name, email, message, ip, userAgent }) {
  if (!isConfigured()) return false;

  const client = Mailjet.apiConnect(MJ_PUBLIC, MJ_PRIVATE);

  const subject = `New contact message — ${name || 'Unknown'}`;

  const text = [
    `You received a new contact message on BookLantern.`,
    '',
    `Name:    ${name || ''}`,
    `Email:   ${email || ''}`,
    `IP:      ${ip || ''}`,
    `Agent:   ${userAgent || ''}`,
    '',
    'Message:',
    message || ''
  ].join('\n');

  const html = `
    <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; line-height:1.6;">
      <h2 style="margin:0 0 10px;">New contact message</h2>
      <table style="border-collapse:collapse; font-size:14px">
        <tr><td style="padding:2px 8px 2px 0; color:#555;">Name:</td><td>${escapeHtml(name || '')}</td></tr>
        <tr><td style="padding:2px 8px 2px 0; color:#555;">Email:</td><td>${escapeHtml(email || '')}</td></tr>
        <tr><td style="padding:2px 8px 2px 0; color:#555;">IP:</td><td>${escapeHtml(ip || '')}</td></tr>
        <tr><td style="padding:2px 8px 2px 0; color:#555;">Agent:</td><td>${escapeHtml(userAgent || '')}</td></tr>
      </table>
      <hr style="border:none;border-top:1px solid #eee; margin:12px 0;">
      <pre style="white-space:pre-wrap; font-size:14px; margin:0">${escapeHtml(message || '')}</pre>
    </div>
  `;

  // Use dedicated ReplyTo field (do NOT pass generic "Headers")
  const mail = {
    Messages: [
      {
        From:   { Email: FROM_EMAIL, Name: FROM_NAME },
        To:     [{ Email: TO_EMAIL,  Name: 'BookLantern Inbox' }],
        Subject: subject,
        TextPart: text,
        HTMLPart: html,
        ...(email ? { ReplyTo: { Email: email, Name: name || email } } : {})
      }
    ]
  };

  try {
    const res = await client.post('send', { version: 'v3.1' }).request(mail);
    const ok = Array.isArray(res?.body?.Messages) &&
               res.body.Messages[0]?.Status === 'success';
    if (!ok) console.warn('[mail] Mailjet send unexpected response:', res?.body);
    return ok;
  } catch (err) {
    // Surface the exact Mailjet error text to logs
    const msg = err?.ErrorMessage || err?.message || String(err);
    console.error('[mail] Mailjet send failed:', msg);
    return false;
  }
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

module.exports = sendContact;
