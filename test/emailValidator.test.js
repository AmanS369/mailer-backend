const test = require('node:test');
const assert = require('node:assert');
const { isValidEmail, normalizeEmail } = require('../src/utils/emailValidator');

test('EmailValidator: Validate valid and invalid email syntax', () => {
  assert.strictEqual(isValidEmail('test@example.com'), true);
  assert.strictEqual(isValidEmail('user.name+tag@domain.co.in'), true);
  assert.strictEqual(isValidEmail('invalid-email'), false);
  assert.strictEqual(isValidEmail('@missinguser.com'), false);
  assert.strictEqual(isValidEmail('missingdomain@'), false);
  assert.strictEqual(isValidEmail(''), false);
});

test('EmailValidator: Normalize emails properly', () => {
  assert.strictEqual(normalizeEmail('  User@Example.COM  '), 'user@example.com');
});

