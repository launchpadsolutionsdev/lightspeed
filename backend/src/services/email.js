/**
 * Email Service
 * Email sending functionality via Gmail SMTP (App Password required)
 */

const nodemailer = require('nodemailer');

// Create transporter — defaults to Gmail SMTP
let transporter;
if (process.env.SMTP_HOST || process.env.SMTP_USER) {
    transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: false,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });
}

// For Gmail, FROM_EMAIL must match SMTP_USER or Gmail will reject/rewrite it
const FROM_EMAIL = process.env.FROM_EMAIL || process.env.SMTP_USER || 'noreply@lightspeedutility.ca';
const FROM_NAME = process.env.FROM_NAME || 'Lightspeed';

// Verify SMTP connection on startup
if (transporter) {
    transporter.verify()
        .then(() => console.log('[EMAIL] SMTP connection verified — emails will send.'))
        .catch(err => console.error('[EMAIL] SMTP connection FAILED:', err.message));
}

/**
 * Send an email
 * @param {Object} options
 * @param {string} options.to - Recipient email
 * @param {string} options.subject - Email subject
 * @param {string} options.text - Plain text body
 * @param {string} options.html - HTML body
 */
async function sendEmail({ to, subject, text, html }) {
    // Check if email is configured
    if (!transporter) {
        console.warn('[EMAIL] SMTP not configured — set SMTP_USER and SMTP_PASS env vars.');
        console.warn('[EMAIL] Would have sent to:', to, '| Subject:', subject);
        return { success: false, reason: 'Email not configured' };
    }

    try {
        const result = await transporter.sendMail({
            from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
            to,
            subject,
            text,
            html
        });

        console.log('Email sent:', result.messageId);
        return { success: true, messageId: result.messageId };

    } catch (error) {
        console.error('Email send error:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Send organization invitation email
 */
async function sendInvitationEmail({ to, inviterName, organizationName, inviteLink }) {
    const subject = `You've been invited to join ${organizationName} on Lightspeed`;

    const text = `
Hi there,

${inviterName} has invited you to join ${organizationName} on Lightspeed.

Click the link below to accept the invitation:
${inviteLink}

This invitation will expire in 7 days.

If you didn't expect this invitation, you can safely ignore this email.

Best,
The Lightspeed Team
    `.trim();

    const html = `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .button { display: inline-block; padding: 12px 24px; background-color: #4F46E5; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0; }
        .footer { margin-top: 30px; font-size: 12px; color: #666; }
    </style>
</head>
<body>
    <div class="container">
        <h2>You've been invited!</h2>
        <p>${inviterName} has invited you to join <strong>${organizationName}</strong> on Lightspeed.</p>
        <a href="${inviteLink}" class="button">Accept Invitation</a>
        <p>This invitation will expire in 7 days.</p>
        <div class="footer">
            <p>If you didn't expect this invitation, you can safely ignore this email.</p>
            <p>Best,<br>The Lightspeed Team</p>
        </div>
    </div>
</body>
</html>
    `.trim();

    return sendEmail({ to, subject, text, html });
}

/**
 * Send welcome email to new user
 */
async function sendWelcomeEmail({ to, firstName, organizationName }) {
    const subject = `Welcome to Lightspeed!`;

    const text = `
Hi ${firstName},

Welcome to Lightspeed! Your account has been created successfully.

${organizationName ? `You're now part of ${organizationName}.` : ''}

Get started by exploring our AI-powered tools:
- Response Assistant: Generate customer responses
- Insights Engine: Analyze your data
- List Normalizer: Clean up messy lists
- Draft Assistant: Create content drafts

If you have any questions, we're here to help.

Best,
The Lightspeed Team
    `.trim();

    return sendEmail({ to, subject, text });
}

/**
 * Send password reset email
 */
async function sendPasswordResetEmail({ to, resetLink }) {
    const subject = `Reset your Lightspeed password`;

    const text = `
Hi there,

You requested to reset your password. Click the link below to set a new password:
${resetLink}

This link will expire in 1 hour.

If you didn't request this, you can safely ignore this email.

Best,
The Lightspeed Team
    `.trim();

    return sendEmail({ to, subject, text });
}

module.exports = {
    sendEmail,
    sendInvitationEmail,
    sendWelcomeEmail,
    sendPasswordResetEmail
};
