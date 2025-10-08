// mail/sendContact.js
// Mailjet wrapper for the Contact form.
// - Safe no-op if Mailjet isn’t configured
// - From: always your domain (DMARC aligned)
// - Reply-To: visitor’s email (so you can reply from your inbox)

let Mailjet = null;
try {
  Mailjet = require('node-mailjet');
} catch {
  // If the dep isn't installed, we silently no-op.
}

const FROM_EMAIL = process.env.CONTACT_FROM_EMAIL || 'info@booklantern.org';
const TO_EMAIL   = process.env.CONTACT_NOTIFY_TO || 'info@booklantern.org';

function isConfigured() {
  return Boolean(
    Mailjet &&
    process.env.MAILJET_API_KEY &&
    process.env.MAILJET_SECRET_KEY &&
    TO_EMAIL
  );
}

const EMAIL_RE =
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

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

  const safeName  = (name || '').toString().trim() || 'Unknown';
  const safeEmail = (email || '').toString().trim();
  const useReplyTo = EMAIL_RE.test(safeEmail);

  const subject = `New contact message — ${safeName}`;
  const text = [
    `You received a new contact message on BookLantern.`,
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
    <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; line-height:1.6;">
      <h2 style="margin:0 0 10px;">New contact message</h2>
      <table style="border-collapse:collapse; font-size:14px">
        <tr><td style="padding:2px 8px 2px 0; color:#555;">Name:</td><td>${escapeHtml(safeName)}</td></tr>
        <tr><td style="padding:2px 8px 2px 0; color:#555;">Email:</td><td>${escapeHtml(safeEmail)}</td></tr>
        <tr><td style="padding:2px 8px 2px 0; color:#555;">IP:</td><td>${escapeHtml(ip || '')}</td></tr>
        <tr><td style="padding:2px 8px 2px 0; color:#555;">Agent:</td><td>${escapeHtml(userAgent || '')}</td></tr>
      </table>
      <hr style="border:none;border-top:1px solid #eee; margin:12px 0;">
      <pre style="white-space:pre-wrap; font-size:14px; margin:0">${escapeHtml(message || '')}</pre>
    </div>
  `;

  const msg = {
    From: { Email: FROM_EMAIL, Name: 'BookLantern' }, // DMARC-aligned
    To:   [{ Email: TO_EMAIL,  Name: 'BookLantern Inbox' }],
    Subject: subject,
    TextPart: text,
    HTMLPart: html,
    CustomID: 'contact_form_notification'
  };

  // Set Reply-To to the visitor so you can reply directly from your mailbox.
  if (useReplyTo) {
    msg.ReplyTo = { Email: safeEmail, Name: safeName };
  }

  try {
    const res = await client
      .post('send', { version: 'v3.1' })
      .request({ Messages: [msg] });

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
