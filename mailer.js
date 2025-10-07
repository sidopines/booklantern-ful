// mailer.js — sends transactional emails via Mailjet
const axios = require('axios');

const MJ_API_KEY = process.env.MAILJET_API_KEY || '';
const MJ_SECRET  = process.env.MAILJET_SECRET_KEY || '';

const FROM_EMAIL = process.env.BL_CONTACT_FROM || 'info@booklantern.org';
const FROM_NAME  = process.env.BL_CONTACT_FROM_NAME || 'BookLantern';
const TO_EMAIL   = process.env.BL_CONTACT_TO || FROM_EMAIL;

/**
 * Send a simple contact notification to your inbox
 */
async function sendContactNotification({ name, email, message, ip, userAgent }) {
  if (!MJ_API_KEY || !MJ_SECRET) {
    console.warn('[mailer] MAILJET_API_KEY/MAILJET_SECRET_KEY missing; skipping email send.');
    return;
  }

  const subject = `New contact message from ${name || 'Unknown'}`;
  const TextPart =
`New message on BookLantern:

Name: ${name}
Email: ${email}
IP: ${ip || '-'}
UA: ${userAgent || '-'}

Message:
${message}
`;

  const HTMLPart =
`<div style="font-family:Arial,Helvetica,sans-serif;line-height:1.5;">
  <h2 style="margin:0 0 10px;">New message on BookLantern</h2>
  <p><b>Name:</b> ${escapeHtml(name||'')}<br>
     <b>Email:</b> ${escapeHtml(email||'')}<br>
     <b>IP:</b> ${escapeHtml(ip||'')}<br>
     <b>UA:</b> ${escapeHtml(userAgent||'')}</p>
  <pre style="white-space:pre-wrap;border:1px solid #eee;padding:10px;border-radius:8px;">${escapeHtml(message||'')}</pre>
</div>`;

  const payload = {
    Messages: [{
      From: { Email: FROM_EMAIL, Name: FROM_NAME },
      To:   [{ Email: TO_EMAIL }],
      Subject: subject,
      TextPart,
      HTMLPart
    }]
  };

  await axios.post('https://api.mailjet.com/v3.1/send', payload, {
    auth: { username: MJ_API_KEY, password: MJ_SECRET },
    timeout: 10000
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[c]);
}

module.exports = { sendContactNotification };
