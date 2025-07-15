// utils/sendVerification.js
const nodemailer = require('nodemailer');

const sendVerificationEmail = async (email, token, baseUrl) => {
  const transporter = nodemailer.createTransport({
    service: 'Gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });

  const verificationLink = `${baseUrl}/verify-email?token=${token}`;

  const mailOptions = {
    from: `"BookLantern" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: 'Verify your email for BookLantern 📚',
    html: `
      <h2>Welcome to BookLantern!</h2>
      <p>Click the link below to verify your email address and activate your account:</p>
      <a href="${verificationLink}">${verificationLink}</a>
      <br><br>
      <p>If you did not register, you can safely ignore this email.</p>
    `
  };

  await transporter.sendMail(mailOptions);
};

module.exports = sendVerificationEmail;
