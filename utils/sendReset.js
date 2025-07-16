// utils/sendReset.js
const nodemailer = require('nodemailer');

async function sendResetEmail(to, token, baseUrl) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER, // Your email
      pass: process.env.EMAIL_PASS, // Your app password
    },
  });

  const resetLink = `${baseUrl}/reset-password?token=${token}`;
  const message = {
    from: process.env.EMAIL_USER,
    to,
    subject: 'Reset Your Password - BookLantern',
    html: `<p>Click the link below to reset your password:</p><a href="${resetLink}">${resetLink}</a>`,
  };

  await transporter.sendMail(message);
}

module.exports = sendResetEmail;
