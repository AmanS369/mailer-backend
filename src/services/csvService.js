const csv = require('csv-parser');
const { Readable } = require('stream');
const { isValidEmail, normalizeEmail } = require('../utils/emailValidator');
const Contact = require('../models/Contact');
const Suppression = require('../models/Suppression');

/**
 * Parse raw CSV buffer/string and extract headers and rows
 */
async function parseCsvBuffer(buffer) {
  return new Promise((resolve, reject) => {
    const results = [];
    let headers = [];

    const stream = Readable.from(buffer.toString('utf-8'));
    stream
      .pipe(csv())
      .on('headers', (hdrs) => {
        headers = hdrs.map((h) => h.trim());
      })
      .on('data', (data) => results.push(data))
      .on('end', () => resolve({ headers, rows: results }))
      .on('error', (err) => reject(err));
  });
}

/**
 * Auto-detect column mapping based on common header names
 */
function autoDetectMapping(headers) {
  const mapping = {
    name: '',
    email: '',
    company: '',
    designation: '',
    linkedinUrl: '',
  };

  for (const h of headers) {
    const lower = h.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!mapping.email && (lower === 'email' || lower === 'emailaddress' || lower === 'mail')) {
      mapping.email = h;
    } else if (!mapping.name && (lower === 'name' || lower === 'fullname' || lower === 'contactname')) {
      mapping.name = h;
    } else if (!mapping.company && (lower === 'company' || lower === 'companyname' || lower === 'organization' || lower === 'org')) {
      mapping.company = h;
    } else if (!mapping.designation && (lower === 'designation' || lower === 'title' || lower === 'jobtitle' || lower === 'role' || lower === 'position')) {
      mapping.designation = h;
    } else if (!mapping.linkedinUrl && (lower === 'linkedin' || lower === 'linkedinurl' || lower === 'profile')) {
      mapping.linkedinUrl = h;
    }
  }

  return mapping;
}

/**
 * Validate and preview CSV rows given a column mapping
 */
async function previewAndValidate(rows, mapping) {
  const existingContacts = await Contact.find({}, 'email').lean();
  const existingEmails = new Set(existingContacts.map((c) => c.email.toLowerCase().trim()));

  const suppressions = await Suppression.find({}, 'email').lean();
  const suppressedEmails = new Set(suppressions.map((s) => s.email.toLowerCase().trim()));

  const seenInBatch = new Set();
  const parsedRows = [];

  for (let index = 0; index < rows.length; index++) {
    const raw = rows[index];
    const name = (raw[mapping.name] || '').trim();
    const rawEmail = (raw[mapping.email] || '').trim();
    const normalizedEmail = normalizeEmail(rawEmail);
    const company = (raw[mapping.company] || '').trim();
    const designation = (raw[mapping.designation] || '').trim();
    const linkedinUrl = mapping.linkedinUrl ? (raw[mapping.linkedinUrl] || '').trim() : '';

    const errors = [];
    if (!name) errors.push('Name is required');
    if (!rawEmail) errors.push('Email is required');
    else if (!isValidEmail(rawEmail)) errors.push('Invalid email syntax');
    if (!company) errors.push('Company is required');
    if (!designation) errors.push('Designation is required');

    let isDuplicate = false;
    let duplicateType = null;

    if (normalizedEmail) {
      if (seenInBatch.has(normalizedEmail)) {
        isDuplicate = true;
        duplicateType = 'DUPLICATE_IN_FILE';
      } else if (existingEmails.has(normalizedEmail)) {
        isDuplicate = true;
        duplicateType = 'ALREADY_EXISTS_IN_DB';
      }
      seenInBatch.add(normalizedEmail);
    }

    const isSuppressed = normalizedEmail && suppressedEmails.has(normalizedEmail);

    parsedRows.push({
      rowIndex: index,
      data: {
        name,
        email: normalizedEmail,
        company,
        designation,
        linkedinUrl,
      },
      isValid: errors.length === 0,
      errors,
      isDuplicate,
      duplicateType,
      isSuppressed,
      excluded: !errors.length === 0 || isDuplicate || isSuppressed, // Pre-exclude invalid or duplicates
    });
  }

  return {
    totalRows: rows.length,
    validRowsCount: parsedRows.filter((r) => r.isValid && !r.isDuplicate && !r.isSuppressed).length,
    duplicateCount: parsedRows.filter((r) => r.isDuplicate).length,
    suppressedCount: parsedRows.filter((r) => r.isSuppressed).length,
    invalidCount: parsedRows.filter((r) => !r.isValid).length,
    rows: parsedRows,
  };
}

module.exports = {
  parseCsvBuffer,
  autoDetectMapping,
  previewAndValidate,
};

