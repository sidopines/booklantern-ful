// mail/sendContact.js
// Mailjet wrapper used by the Contact form.
// Sends an email to your inbox and returns true/false.
// Uses ReplyTo (dedicated field) — no generic Headers, to avoid Mailjet 400.

let Mailjet = null;
try {
  Mailjet = require('node-mailjet');
} catch {
  // dependency not installed — noop
}

const FROM_EMAIL =
  process.env.CONTACT_FROM_EMAIL ||
  process.env.MAILJET_SENDER ||
  'info@booklantern.org';

const TO_EMAIL =
  process.env.CONTACT_NOTIFY_TO ||
  process.env.MAILJET_TO ||
  'info@booklantern.org';

function isConfigured() {
  return Boolean(
    Mailjet &&
      process.env.MAILJET_API_KEY &&
      process.env.MAILJET_SECRET_KEY &&
      FROM_EMAIL &&
      TO_EMAIL
  );
}

/**
 * sendContact({ name, email, message, ip, userAgent })
 * Returns true on success, false on no-op or failure.
 */
async function sendContact({ name, email, message, ip, userAgent }) {
  if (!isConfigured()) {
    console.warn('[mail] Mailjet not configured — skipping email send.');
    return false;
  }

  const client = Mailjet.apiConnect(
    process.env.MAILJET_API_KEY,
    process.env.MAILJET_SECRET_KEY
  );

  const safeName = (name || '').toString().trim();
  const safeEmail = (email || '').toString().trim();
  const subject = `New contact message — ${safeName || 'Unknown'}`;

  const text = [
    'You received a new contact message on BookLantern.',
    '',
    `Name:    ${safeName}`,
    `Email:   ${safeEmail}`,
    `IP:      ${ip || ''}`,
    `Agent:   ${userAgent || ''}`,
    '',
    'Message:',
    message || ''
  ].join('\n');

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.6;">
      <h2 style="margin:0 0 10px;">New contact message</h2>
      <table style="border-collapse:collapse;font-size:14px">
        <tr><td style="padding:2px 8px 2px 0;color:#555;">Name:</td><td>${escapeHtml(safeName)}</td></tr>
        <tr><td style="padding:2px 8px 2px 0;color:#555;">Email:</td><td>${escapeHtml(safeEmail)}</td></tr>
        <tr><td style="padding:2px 8px 2px 0;color:#555;">IP:</td><td>${escapeHtml(ip || '')}</td></tr>
        <tr><td style="padding:2px 8px 2px 0;color:#555;">Agent:</td><td>${escapeHtml(userAgent || '')}</td></tr>
      </table>
      <hr style="border:none;border-top:1px solid #eee;margin:12px 0;">
      <pre style="white-space:pre-wrap;font-size:14px;margin:0">${escapeHtml(message || '')}</pre>
    </div>
  `;

  // Build the message payload WITHOUT a generic Headers block.
  const msg = {
    From: { Email: FROM_EMAIL, Name: 'BookLantern' },
    To: [{ Email: TO_EMAIL, Name: 'BookLantern Inbox' }],
    Subject: subject,
    TextPart: text,
    HTMLPart: html,
    // Use the dedicated ReplyTo field (this is what Mailjet expects)
    ...(safeEmail
      ? { ReplyTo: { Email: safeEmail, Name: safeName || safeEmail } }
      : {})
    // Do NOT include "Headers" here — Mailjet will reject with 400.
  };

  try {
    const res = await client.post('send', { version: 'v3.1' }).request({
      Messages: [msg]
    });

    const ok =
      Array.isArray(res?.body?.Messages) &&
      res.body.Messages[0]?.Status === 'success';

    if (!ok) {
      console.warn('[mail] Mailjet send returned unexpected response:', res?.body);
    }
    return ok;
  } catch (err) {
    console.error('[mail] Mailjet send failed:', err?.message || err);
    return false;
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = sendContact;
