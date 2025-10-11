// mailer.js
const nodemailer = require('nodemailer');

const host = process.env.MJ_HOST || 'in-v3.mailjet.com';
const port = Number(process.env.MJ_PORT || 587);
const user = process.env.MJ_USER || process.env.MAILJET_API_KEY;
const pass = process.env.MJ_PASS || process.env.MAILJET_SECRET;
const from = process.env.MAIL_FROM || 'info@booklantern.org';

let transporter = null;
if (user && pass) {
  transporter = nodemailer.createTransport({
    host, port, secure: false,
    auth: { user, pass },
  });
}

function escapeHtml(s = '') {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function send({ to, subject, text, html }) {
  if (!transporter) throw new Error('Mailer not configured (missing Mailjet creds).');
  const info = await transporter.sendMail({ from, to, subject, text, html });
  console.log('[mailer] sent:', info.messageId);
  return info;
}

module.exports = { send, escapeHtml };
