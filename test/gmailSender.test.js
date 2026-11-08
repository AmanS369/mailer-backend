const test = require('node:test');
const assert = require('node:assert');
const nodemailer = require('nodemailer');
const { buildSenderAddress } = require('../src/services/gmailService');

test('buildSenderAddress: Combines display name and authenticated email correctly', () => {
  const result = buildSenderAddress('Aman Singh', 'user@gmail.com');
  assert.deepStrictEqual(result, {
    name: 'Aman Singh',
    address: 'user@gmail.com',
  });
});

test('buildSenderAddress: Trims whitespace from display name', () => {
  const result = buildSenderAddress('   Aman Singh   ', 'user@gmail.com');
  assert.deepStrictEqual(result, {
    name: 'Aman Singh',
    address: 'user@gmail.com',
  });
});

test('buildSenderAddress: Falls back to plain address when name is empty or whitespace', () => {
  assert.strictEqual(buildSenderAddress('', 'user@gmail.com'), 'user@gmail.com');
  assert.strictEqual(buildSenderAddress('   ', 'user@gmail.com'), 'user@gmail.com');
  assert.strictEqual(buildSenderAddress(null, 'user@gmail.com'), 'user@gmail.com');
});

test('buildSenderAddress: Throws error if authenticated address is missing', () => {
  assert.throws(() => {
    buildSenderAddress('Aman Singh', '');
  }, /Authenticated email address is required/);
});

test('MIME From header: Generates standard RFC 5322 From header for ASCII name', async () => {
  const sender = buildSenderAddress('Aman Singh', 'aman@gmail.com');
  const transporter = nodemailer.createTransport({ streamTransport: true, buffer: true });
  const message = await transporter.sendMail({
    from: sender,
    to: 'recipient@example.com',
    subject: 'Test Subject',
    text: 'Test Body',
  });

  const rawMime = message.message.toString();
  const fromLine = rawMime.split('\r\n').find((line) => line.toLowerCase().startsWith('from:'));
  
  assert.ok(fromLine, 'From header must be present in MIME message');
  assert.ok(fromLine.includes('Aman Singh'), `From header should contain display name. Got: ${fromLine}`);
  assert.ok(fromLine.includes('<aman@gmail.com>'), `From header must preserve authenticated address. Got: ${fromLine}`);
});

test('MIME From header: Encodes non-ASCII characters using RFC 2047', async () => {
  const sender = buildSenderAddress('René Müller', 'aman@gmail.com');
  const transporter = nodemailer.createTransport({ streamTransport: true, buffer: true });
  const message = await transporter.sendMail({
    from: sender,
    to: 'recipient@example.com',
    subject: 'Test Non-ASCII',
    text: 'Test Body',
  });

  const rawMime = message.message.toString();
  const fromLine = rawMime.split('\r\n').find((line) => line.toLowerCase().startsWith('from:'));
  
  // RFC 2047 Q-encoding format: =?UTF-8?Q?...?=
  assert.ok(fromLine.includes('=?UTF-8?Q?'), `From header must be RFC 2047 encoded. Got: ${fromLine}`);
  assert.ok(fromLine.includes('<aman@gmail.com>'), `From header must preserve authenticated address. Got: ${fromLine}`);
});

test('MIME From header: Handles special characters (commas, quotes) safely', async () => {
  const sender = buildSenderAddress('Singh, Aman', 'aman@gmail.com');
  const transporter = nodemailer.createTransport({ streamTransport: true, buffer: true });
  const message = await transporter.sendMail({
    from: sender,
    to: 'recipient@example.com',
    subject: 'Test Special Chars',
    text: 'Test Body',
  });

  const rawMime = message.message.toString();
  const fromLine = rawMime.split('\r\n').find((line) => line.toLowerCase().startsWith('from:'));
  
  assert.strictEqual(fromLine, 'From: "Singh, Aman" <aman@gmail.com>');
});

