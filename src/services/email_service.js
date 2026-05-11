const nodemailer = require('nodemailer');

const resendApiKey = process.env.RESEND_API_KEY || '';
const resendFromEmail =
  process.env.RESEND_FROM_EMAIL ||
  process.env.SMTP_FROM ||
  'ALTERA <onboarding@resend.dev>';

function usesPlaceholderSender(value) {
  const normalized = `${value || ''}`.toLowerCase();
  return (
    normalized.includes('yourdomain.com') ||
    normalized.includes('example.com')
  );
}

function hasResendConfig() {
  return resendApiKey.trim().length > 0;
}

function hasSmtpConfig() {
  return Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_PORT &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS,
  );
}

function createSmtpTransporter() {
  if (!hasSmtpConfig()) {
    return null;
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function sendViaResend({ to, subject, text, html }) {
  if (usesPlaceholderSender(resendFromEmail)) {
    throw new Error(
      'RESEND_FROM_EMAIL is using a placeholder domain. Set it to an address on your verified sending domain.',
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  let response;
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: resendFromEmail,
        to: [to],
        subject,
        text,
        html,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Resend request timed out after 15 seconds');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error?.message || 'Resend email send failed');
  }

  return payload;
}

async function sendViaSmtp({ to, subject, text, html }) {
  const transporter = createSmtpTransporter();
  if (!transporter) {
    throw new Error('SMTP is not configured');
  }

  return transporter.sendMail({
    from: process.env.SMTP_FROM || `"ALTERA Support" <${process.env.SMTP_USER}>`,
    to,
    subject,
    text,
    html,
  });
}

async function sendEmail({ to, subject, text, html }) {
  const errors = [];

  console.log(
    `[EmailService] Provider check: resend=${hasResendConfig()} smtp=${hasSmtpConfig()} from="${resendFromEmail}"`,
  );

  if (hasResendConfig()) {
    try {
      const result = await sendViaResend({ to, subject, text, html });
      console.log('[EmailService] Email sent via Resend:', result?.id || 'ok');
      return result;
    } catch (error) {
      errors.push(`Resend: ${error.message}`);
      console.error('[EmailService] Resend send failed:', error.message);
    }
  }

  if (hasSmtpConfig()) {
    try {
      const result = await sendViaSmtp({ to, subject, text, html });
      console.log('[EmailService] Email sent via SMTP:', result?.messageId || 'ok');
      return result;
    } catch (error) {
      errors.push(`SMTP: ${error.message}`);
      console.error('[EmailService] SMTP send failed:', error.message);
    }
  }

  throw new Error(
    errors.length > 0
      ? `All email providers failed. ${errors.join(' | ')}`
      : 'No email provider is configured',
  );
}

async function sendOTP(email, otp) {
  console.log(`[EmailService] Attempting to send OTP to: ${email}`);
  return sendEmail({
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
  });
}

async function sendPasswordResetOTP(email, otp) {
  console.log(`[EmailService] Attempting to send Password Reset OTP to: ${email}`);
  return sendEmail({
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
  });
}

module.exports = { sendOTP, sendPasswordResetOTP };
