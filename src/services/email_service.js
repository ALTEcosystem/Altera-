const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: process.env.SMTP_PORT || 587,
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendOTP(email, otp) {
  const mailOptions = {
    from: `"ALTERA Support" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
    to: email,
    subject: 'Your ALTERA Verification Code',
    text: `Your OTP for ALTERA is: ${otp}. It will expire in 10 minutes.`,
    html: `
      <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
        <h2 style="color: #6366f1;">Welcome to ALTERA</h2>
        <p>Use the following code to verify your email address:</p>
        <div style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #1e1b4b; padding: 10px 0;">
          ${otp}
        </div>
        <p style="color: #666;">This code will expire in 10 minutes. If you didn't request this, please ignore this email.</p>
      </div>
    `,
  };

  return transporter.sendMail(mailOptions);
}

async function sendPasswordResetOTP(email, otp) {
  const mailOptions = {
    from: `"ALTERA Support" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
    to: email,
    subject: 'ALTERA Password Reset Request',
    text: `Your code to reset your password is: ${otp}. It will expire in 10 minutes.`,
    html: `
      <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
        <h2 style="color: #6366f1;">Reset Your Password</h2>
        <p>You requested to reset your password. Use the following code:</p>
        <div style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #1e1b4b; padding: 10px 0;">
          ${otp}
        </div>
        <p style="color: #666;">This code will expire in 10 minutes. If you didn't request a password reset, please change your password immediately.</p>
      </div>
    `,
  };

  return transporter.sendMail(mailOptions);
}

module.exports = { sendOTP, sendPasswordResetOTP };
