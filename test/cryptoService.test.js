const test = require('node:test');
const assert = require('node:assert');
const cryptoService = require('../src/services/cryptoService');

test('CryptoService: Encrypt and decrypt refresh token successfully', () => {
  const secretToken = '1//0gM5k8e29aBCdEfGhIjKlMnOpQrStUvWxYz_RealTokenExample_123456';
  const encrypted = cryptoService.encrypt(secretToken);

  assert.notStrictEqual(encrypted, secretToken);
  assert.strictEqual(encrypted.includes(':'), true);

  const decrypted = cryptoService.decrypt(encrypted);
  assert.strictEqual(decrypted, secretToken);
});

test('CryptoService: Throws error on tampered or invalid encrypted text', () => {
  assert.throws(() => {
    cryptoService.decrypt('invalid:tampered');
  }, /Invalid encrypted format/);
});

