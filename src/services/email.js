import { Resend } from 'resend';
import config from '../config/index.js';

const resend = config.resendApiKey ? new Resend(config.resendApiKey) : null;

/**
 * Send a password reset email
 * @param {string} to - Email address to send to
 * @param {string} resetUrl - Full URL for password reset
 */
export async function sendPasswordResetEmail(to, resetUrl) {
  if (!resend) {
    console.warn('RESEND_API_KEY not set — password reset email not sent');
    console.log(`Reset URL (dev): ${resetUrl}`);
    return;
  }

  await resend.emails.send({
    from: 'Quote Log <noreply@karlsmark.com>',
    to,
    subject: 'Password Reset — The Quote Log',
    html: `
      <h2>Password Reset</h2>
      <p>You requested a password reset for your Quote Log admin account.</p>
      <p>Click the link below to reset your password:</p>
      <p><a href="${resetUrl}">${resetUrl}</a></p>
      <p>This link will expire in 1 hour.</p>
      <p>If you did not request this reset, you can safely ignore this email.</p>
    `,
  });
}
