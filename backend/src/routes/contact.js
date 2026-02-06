/**
 * Contact Form Route
 * Handles contact form submissions from the landing page
 */

const express = require('express');
const router = express.Router();
const { sendEmail } = require('../services/email');

const CONTACT_EMAIL = 'torin@launchpadsolutions.ca';

router.post('/', async (req, res) => {
    try {
        const { organizationName, name, title, phone, email, message } = req.body;

        // Validate required fields
        if (!name || !email || !message) {
            return res.status(400).json({ error: 'Name, email, and message are required.' });
        }

        // Basic email format check
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ error: 'Please provide a valid email address.' });
        }

        const subject = `Lightspeed Contact: ${organizationName || 'New Inquiry'} — ${name}`;

        const text = [
            `New contact form submission from the Lightspeed website:`,
            ``,
            `Name: ${name}`,
            title ? `Title: ${title}` : null,
            organizationName ? `Organization: ${organizationName}` : null,
            `Email: ${email}`,
            phone ? `Phone: ${phone}` : null,
            ``,
            `Message:`,
            message
        ].filter(Boolean).join('\n');

        const html = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
    <h2 style="color: #7c3aed;">New Contact Form Submission</h2>
    <table style="width: 100%; border-collapse: collapse;">
        <tr><td style="padding: 8px 0; font-weight: bold; color: #555;">Name</td><td style="padding: 8px 0;">${name}</td></tr>
        ${title ? `<tr><td style="padding: 8px 0; font-weight: bold; color: #555;">Title</td><td style="padding: 8px 0;">${title}</td></tr>` : ''}
        ${organizationName ? `<tr><td style="padding: 8px 0; font-weight: bold; color: #555;">Organization</td><td style="padding: 8px 0;">${organizationName}</td></tr>` : ''}
        <tr><td style="padding: 8px 0; font-weight: bold; color: #555;">Email</td><td style="padding: 8px 0;"><a href="mailto:${email}">${email}</a></td></tr>
        ${phone ? `<tr><td style="padding: 8px 0; font-weight: bold; color: #555;">Phone</td><td style="padding: 8px 0;">${phone}</td></tr>` : ''}
    </table>
    <div style="margin-top: 20px; padding: 16px; background: #f9fafb; border-radius: 8px;">
        <p style="font-weight: bold; color: #555; margin: 0 0 8px;">Message:</p>
        <p style="margin: 0; white-space: pre-wrap;">${message}</p>
    </div>
</div>`.trim();

        const result = await sendEmail({ to: CONTACT_EMAIL, subject, text, html });

        if (result.success) {
            res.json({ success: true, message: 'Your message has been sent. We\'ll be in touch soon!' });
        } else {
            // Email service not configured - log and still acknowledge
            console.log('Contact form submission (email not configured):', { organizationName, name, title, phone, email, message });
            res.json({ success: true, message: 'Your message has been received. We\'ll be in touch soon!' });
        }

    } catch (error) {
        console.error('Contact form error:', error);
        res.status(500).json({ error: 'Something went wrong. Please try again or email us directly at torin@launchpadsolutions.ca' });
    }
});

module.exports = router;
