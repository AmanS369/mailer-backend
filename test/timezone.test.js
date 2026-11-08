const test = require('node:test');
const assert = require('node:assert');
const { formatInKolkata, isDateAllowed, getNextEligibleDate } = require('../src/utils/timezone');

test('Timezone: Format date in Asia/Kolkata', () => {
  const utcDate = new Date('2026-11-08T10:00:00Z');
  const formatted = formatInKolkata(utcDate, 'yyyy-MM-dd HH:mm');
  // UTC 10:00 is 15:30 IST (+5:30)
  assert.strictEqual(formatted, '2026-11-08 15:30');
});

test('Timezone: Allowed days check and next eligible date', () => {
  // 2026-11-08 is a Sunday (day 0)
  const sunday = new Date('2026-11-08T10:00:00Z');

  // If business days only (1..5: Mon-Fri)
  const businessDays = [1, 2, 3, 4, 5];
  assert.strictEqual(isDateAllowed(sunday, businessDays), false);

  const nextEligible = getNextEligibleDate(sunday, businessDays);
  // Next day is Monday 2026-11-09
  assert.strictEqual(isDateAllowed(nextEligible, businessDays), true);
});

