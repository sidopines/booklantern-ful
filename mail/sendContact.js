// mail/sendContact.js — send contact form notifications via Mailjet
const Mailjet = require('node-mailjet');

const key    = process.env.MAILJET_API_KEY || '';
const secret = process.env.MAILJET_SECRET_KEY || '';

let client = null;
if (key && secret) {
  client = new Mailjet({ apiKey: key, apiSecret: secret });
  console.log('[mailjet] ready');
} else {
  console.warn('[mailjet] missing api keys');
}

module.exports = async function sendContactEmail({ name, email, message }) {
  if (!client) return;

  const fromEmail = process.env.BL_CONTACT_FROM || 'info@booklantern.org';
  const fromName  = process.env.BL_CONTACT_FROM_NAME || 'BookLantern';
  const toEmail   = process.env.BL_CONTACT_TO || 'info@booklantern.org';

  try {
    await client
      .post('send', { version: 'v3.1' })
      .request({
        Messages: [{
          From: { Email: fromEmail, Name: fromName },
          To: [{ Email: toEmail }],
          Subject: `New contact message from ${name}`,
          TextPart: `From: ${name} <${email}>\n\n${message}`,
        }],
      });
    console.log('[mailjet] contact email sent');
  } catch (e) {
    console.error('[mailjet] send failed', e?.response?.text || e.message);
  }
};
