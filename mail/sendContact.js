// mail/sendContact.js (final)
// Sends a notification email for Contact Us via Mailjet if configured.
// If Mailjet module or credentials are missing, it logs and safely no-ops.

let Mailjet = null;
try {
  // Optional dependency; if not installed, we skip email.
  Mailjet = require('node-mailjet');
} catch (_) {
  Mailjet = null;
}

const API_KEY =
  process.env.MAILJET_API_KEY ||
  process.env.MJ_API_KEY ||
  '';
const SECRET_KEY =
  process.env.MAILJET_SECRET_KEY ||
  process.env.MJ_SECRET_KEY ||
  '';
const FROM_EMAIL =
  process.env.SMTP_FROM ||
  process.env.MJ_FROM ||
  process.env.SUPPORT_INBOX ||
  'info@booklantern.org';
const TO_EMAIL =
  process.env.SUPPORT_INBOX ||
  FROM_EMAIL;

// Basic HTML escape for user content
function esc(s = '') {
  return String(s).replace(/[&<>"]/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'
  })[c]);
}

/**
 * sendContact({ name, email, message }) -> { ok: boolean, skipped?: boolean }
 */
module.exports = async function sendContact({ name, email, message }) {
  // If not fully configured, don’t error; just log and skip.
  if (!Mailjet || !API_KEY || !SECRET_KEY) {
    console.warn('[mail] Mailjet not configured; skipping contact email.');
    return { ok: false, skipped: true };
  }

  const client = Mailjet.apiConnect(API_KEY, SECRET_KEY);

  const now = new Date().toISOString();
  const subject = 'New contact message — BookLantern';

  const TextPart = `From: ${name} <${email}>\n\n${message}\n\nSent: ${now}`;
  const HTMLPart = `
    <p><strong>From:</strong> ${esc(name)} &lt;${esc(email)}&gt;</p>
    <p>${esc(message).replace(/\n/g,'<br>')}</p>
    <p style="color:#999">Sent: ${esc(now)}</p>
  `;

  const payload = {
    Messages: [
      {
        From: { Email: FROM_EMAIL, Name: 'BookLantern' },
        To:   [{ Email: TO_EMAIL,  Name: 'BookLantern' }],
        ReplyTo: { Email: email, Name: name || email },
        Subject: subject,
        TextPart,
        HTMLPart
      }
    ]
  };

  const res = await client.post('send', { version: 'v3.1' }).request(payload);
  const ok = Array.isArray(res?.body?.Messages);

  if (!ok) {
    console.warn('[mail] Mailjet response unexpected:', res?.body);
    return { ok: false };
  }
  return { ok: true };
};
