const test = require('node:test');
const assert = require('node:assert');
const { extractFirstName, renderTemplate, findUnresolvedPlaceholders } = require('../src/utils/placeholders');

test('Placeholders: Extract first name properly', () => {
  assert.strictEqual(extractFirstName('Aman Sharma'), 'Aman');
  assert.strictEqual(extractFirstName('Sundar Pichai'), 'Sundar');
  assert.strictEqual(extractFirstName(''), '');
});

test('Placeholders: Render placeholders in templates accurately', () => {
  const contact = {
    name: 'Jane Doe',
    company: 'Acme Corp',
    designation: 'VP of Engineering',
  };
  const template = 'Hi {{firstName}}, I saw you are {{designation}} at {{companyName}}. Regards, {{candidateName}}';
  const rendered = renderTemplate(template, contact, 'Alex Candidate');

  assert.strictEqual(
    rendered,
    'Hi Jane, I saw you are VP of Engineering at Acme Corp. Regards, Alex Candidate'
  );
});

test('Placeholders: Detect unresolved placeholders', () => {
  const text = 'Hello {{firstName}}, please review {{unresolvedField}} at {{nonExistent}}';
  const unresolved = findUnresolvedPlaceholders(text);

  assert.deepStrictEqual(unresolved.sort(), ['{{firstName}}', '{{nonExistent}}', '{{unresolvedField}}']);
});

