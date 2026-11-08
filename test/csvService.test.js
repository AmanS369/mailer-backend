const test = require('node:test');
const assert = require('node:assert');
const { parseCsvBuffer, autoDetectMapping } = require('../src/services/csvService');

test('CsvService: Parse CSV buffer and auto-detect columns', async () => {
  const csvContent = `Full Name,Email Address,Company,Job Title,LinkedIn
Aman Sharma,aman@example.com,Google,Staff Engineer,https://linkedin.com/in/amansharma
Jane Doe,jane@domain.org,Acme,CTO,`;

  const { headers, rows } = await parseCsvBuffer(Buffer.from(csvContent));
  assert.strictEqual(headers.length, 5);
  assert.strictEqual(rows.length, 2);

  const mapping = autoDetectMapping(headers);
  assert.strictEqual(mapping.name, 'Full Name');
  assert.strictEqual(mapping.email, 'Email Address');
  assert.strictEqual(mapping.company, 'Company');
  assert.strictEqual(mapping.designation, 'Job Title');
  assert.strictEqual(mapping.linkedinUrl, 'LinkedIn');
});

