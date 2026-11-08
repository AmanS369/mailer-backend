const test = require('node:test');
const assert = require('node:assert');
const nodemailer = require('nodemailer');
const config = require('../src/config/env');
const { buildSenderAddress } = require('../src/services/gmailService');

test('Email Service & Sender: Follow-up and initial outreach both use GMAIL_SENDER_NAME', async () => {
  const configuredName = config.GMAIL_SENDER_NAME || 'Aman Singh';
  const authenticatedEmail = 'authenticated.user@gmail.com';

  const senderObj = buildSenderAddress(configuredName, authenticatedEmail);

  // 1. Initial outreach MIME check
  const transporter = nodemailer.createTransport({ streamTransport: true, buffer: true });
  const initialMsg = await transporter.sendMail({
    from: senderObj,
    to: 'lead@company.com',
    subject: 'Application for Engineering Opportunities',
    text: 'Hi John,\n\nI am reaching out regarding engineering opportunities.',
  });

  const initialRaw = initialMsg.message.toString();
  const initialFrom = initialRaw.split('\r\n').find((l) => l.toLowerCase().startsWith('from:'));
  assert.ok(initialFrom.includes(configuredName), `Initial email must contain sender display name: ${initialFrom}`);
  assert.ok(initialFrom.includes(authenticatedEmail), `Initial email must preserve authenticated email: ${initialFrom}`);

  // 2. Automated Follow-up MIME check (with in-reply-to & references headers)
  const followUpMsg = await transporter.sendMail({
    from: senderObj,
    to: 'lead@company.com',
    subject: 'Following up on my previous email',
    text: 'Hi John,\n\nI wanted to follow up on my previous email.',
    inReplyTo: '<initial-message-id@gmail.com>',
    references: '<initial-message-id@gmail.com>',
  });

  const followUpRaw = followUpMsg.message.toString();
  const followUpFrom = followUpRaw.split('\r\n').find((l) => l.toLowerCase().startsWith('from:'));
  assert.ok(followUpFrom.includes(configuredName), `Follow-up email must contain sender display name: ${followUpFrom}`);
  assert.ok(followUpFrom.includes(authenticatedEmail), `Follow-up email must preserve authenticated email: ${followUpFrom}`);
  assert.ok(followUpRaw.includes('In-Reply-To: <initial-message-id@gmail.com>'), 'Follow-up must maintain in-reply-to thread header');
});

