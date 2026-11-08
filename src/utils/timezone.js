const { toZonedTime, fromZonedTime, format } = require('date-fns-tz');
const { addDays, setHours, setMinutes, setSeconds, getDay, isAfter } = require('date-fns');
const config = require('../config/env');

const TIMEZONE = config.TIMEZONE || 'Asia/Kolkata';

/**
 * Format a Date object to Asia/Kolkata readable string
 * @param {Date|string|number} date
 * @param {string} formatStr
 * @returns {string}
 */
function formatInKolkata(date, formatStr = 'yyyy-MM-dd HH:mm:ss (zzz)') {
  if (!date) return '';
  const d = new Date(date);
  const zoned = toZonedTime(d, TIMEZONE);
  return format(zoned, formatStr, { timeZone: TIMEZONE });
}

/**
 * Check if a date falls on an allowed sending day
 * @param {Date} date
 * @param {number[]} allowedDays Array of days (0=Sunday, 1=Monday, ... 6=Saturday). Default all days [0,1,2,3,4,5,6]
 * @returns {boolean}
 */
function isDateAllowed(date, allowedDays = [0, 1, 2, 3, 4, 5, 6]) {
  const d = new Date(date);
  const zoned = toZonedTime(d, TIMEZONE);
  const day = getDay(zoned);
  return allowedDays.includes(day);
}

/**
 * Find the next eligible date/time if current date is not in allowedDays
 * @param {Date} date
 * @param {number[]} allowedDays
 * @returns {Date}
 */
function getNextEligibleDate(date, allowedDays = [0, 1, 2, 3, 4, 5, 6]) {
  let current = new Date(date);
  for (let i = 0; i < 14; i++) {
    if (isDateAllowed(current, allowedDays)) {
      return current;
    }
    current = addDays(current, 1);
  }
  return current;
}

module.exports = {
  TIMEZONE,
  formatInKolkata,
  isDateAllowed,
  getNextEligibleDate,
};

