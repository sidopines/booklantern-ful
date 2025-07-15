const nodemailer = require('nodemailer');

module.exports = async function sendVerification(email, token) {
  const transport = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER, // your Gmail address
      pass: process.env.EMAIL_PASS  // your Gmail app password
    }
  });

  const url = `${process.env.BASE_URL}/verify?token=${token}`;

  await transport.sendMail({
    from: '"BookLantern" <no-reply@booklantern.org>',
    to: email,
    subject: 'Verify your BookLantern Email',
    html: `<p>Click below to verify your account:</p><a href="${url}">${url}</a>`
  });
};
