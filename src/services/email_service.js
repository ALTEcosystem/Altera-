const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Verify connection configuration
transporter.verify(function (error, success) {
  if (error) {
    console.error('[EmailService] SMTP Connection Error:', error);
  } else {
    console.log('[EmailService] SMTP Server is ready to take our messages');
  }
});

async function sendOTP(email, otp) {
  console.log(`[EmailService] Attempting to send OTP to: ${email}`);
  const mailOptions = {
    from: process.env.SMTP_FROM || `"ALTERA Support" <${process.env.SMTP_USER}>`,
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

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('[EmailService] OTP sent successfully:', info.messageId);
    return info;
  } catch (err) {
    console.error('[EmailService] Failed to send OTP:', err);
    throw err;
  }
}

async function sendPasswordResetOTP(email, otp) {
  console.log(`[EmailService] Attempting to send Password Reset OTP to: ${email}`);
  const mailOptions = {
    from: process.env.SMTP_FROM || `"ALTERA Support" <${process.env.SMTP_USER}>`,
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

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('[EmailService] Password Reset OTP sent successfully:', info.messageId);
    return info;
  } catch (err) {
    console.error('[EmailService] Failed to send Password Reset OTP:', err);
    throw err;
  }
}

module.exports = { sendOTP, sendPasswordResetOTP };
