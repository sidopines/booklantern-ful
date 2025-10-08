// mail/sendContact.js
// Final version — optimized for verified Mailjet domain and full DMARC alignment.

let Mailjet = null;
try {
  Mailjet = require('node-mailjet');
} catch {
  console.warn('[mail] Mailjet dependency not installed — skipping email send.');
}

const FROM_EMAIL = process.env.CONTACT_FROM_EMAIL || 'info@booklantern.org';
const FROM_NAME  = 'BookLantern';
const TO_EMAIL   = process.env.CONTACT_NOTIFY_TO || 'info@booklantern.org';

function isConfigured() {
  return Boolean(
    Mailjet &&
    process.env.MAILJET_API_KEY &&
    process.env.MAILJET_SECRET_KEY &&
    TO_EMAIL
  );
}

/**
 * sendContact({ name, email, message, ip, userAgent })
 * Sends form submissions from the website to your verified BookLantern inbox.
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

  const subject = `📩 New contact message from ${name || 'Visitor'}`;
  const text = [
    `You received a new contact form message from BookLantern.org`,
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

  try {
    const res = await client
      .post('send', { version: 'v3.1' })
      .request({
        Messages: [
          {
            From: { Email: FROM_EMAIL, Name: FROM_NAME },
            To: [{ Email: TO_EMAIL, Name: 'BookLantern Inbox' }],
            ReplyTo: { Email: email || FROM_EMAIL, Name: name || 'Visitor' },
            Subject: subject,
            TextPart: text,
            HTMLPart: html,
            Headers: {
              'X-Mailer': 'BookLantern Contact Form',
              'X-Source': 'contact-form',
            }
          }
        ]
      });

    const ok = Array.isArray(res?.body?.Messages) && res.body.Messages[0]?.Status === 'success';
    if (!ok) console.warn('[mail] Unexpected Mailjet response:', res?.body);
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
    .replace(/"/g, '&quot;');
}

module.exports = sendContact;
