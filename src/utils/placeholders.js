/**
 * Utility for template placeholder rendering and validation
 */

function extractFirstName(fullName = '') {
  if (!fullName) return '';
  const parts = fullName.trim().split(/\s+/);
  return parts[0] || '';
}

/**
 * Render placeholders in text for a specific contact and sender
 * Placeholders supported:
 * - {{firstName}}
 * - {{fullName}}
 * - {{companyName}}
 * - {{designation}}
 * - {{candidateName}}
 */
function renderTemplate(template = '', contact = {}, candidateName = '') {
  if (!template) return '';
  
  const firstName = extractFirstName(contact.name);
  const fullName = contact.name || '';
  const companyName = contact.company || '';
  const designation = contact.designation || '';
  
  let result = template
    .replace(/\{\{\s*firstName\s*\}\}/g, firstName)
    .replace(/\{\{\s*fullName\s*\}\}/g, fullName)
    .replace(/\{\{\s*companyName\s*\}\}/g, companyName)
    .replace(/\{\{\s*designation\s*\}\}/g, designation)
    .replace(/\{\{\s*candidateName\s*\}\}/g, candidateName);

  return result;
}

/**
 * Find unresolved placeholders like {{something}}
 */
function findUnresolvedPlaceholders(text = '') {
  if (!text) return [];
  const matches = text.match(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/g);
  if (!matches) return [];
  return Array.from(new Set(matches.map((m) => m.trim())));
}

module.exports = {
  extractFirstName,
  renderTemplate,
  findUnresolvedPlaceholders,
};

