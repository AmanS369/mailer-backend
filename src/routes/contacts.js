const express = require('express');
const multer = require('multer');
const router = express.Router();
const Contact = require('../models/Contact');
const Suppression = require('../models/Suppression');
const { isValidEmail, normalizeEmail } = require('../utils/emailValidator');
const csvService = require('../services/csvService');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// GET /api/contacts
router.get('/', async (req, res) => {
  try {
    const { search, status, page = 1, limit = 50 } = req.query;
    const query = {};

    if (status) {
      query.status = status;
    }

    if (search) {
      const regex = new RegExp(search.trim(), 'i');
      query.$or = [{ name: regex }, { email: regex }, { company: regex }, { designation: regex }];
    }

    const total = await Contact.countDocuments(query);
    const contacts = await Contact.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit, 10));

    res.json({
      contacts,
      pagination: {
        total,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/contacts/:id
router.get('/:id', async (req, res) => {
  try {
    const contact = await Contact.findById(req.params.id);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });
    res.json(contact);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/contacts (Manual entry)
router.post('/', async (req, res) => {
  try {
    const { name, email, company, designation, linkedinUrl } = req.body;

    if (!name || !email || !company || !designation) {
      return res.status(400).json({ error: 'Name, email, company, and designation are required.' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Invalid email syntax.' });
    }

    const cleanEmail = normalizeEmail(email);

    // Check for duplicate in DB
    const existing = await Contact.findOne({ email: cleanEmail });
    if (existing) {
      return res.status(409).json({ error: `A contact with email ${cleanEmail} already exists.` });
    }

    // Check if suppressed
    const isSuppressed = await Suppression.findOne({ email: cleanEmail });

    const contact = await Contact.create({
      name: name.trim(),
      email: cleanEmail,
      company: company.trim(),
      designation: designation.trim(),
      linkedinUrl: linkedinUrl ? linkedinUrl.trim() : '',
      status: isSuppressed ? 'SUPPRESSED' : 'ACTIVE',
    });

    res.status(201).json(contact);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/contacts/:id
router.patch('/:id', async (req, res) => {
  try {
    const { name, email, company, designation, linkedinUrl, status } = req.body;
    const updates = {};

    if (name !== undefined) updates.name = name.trim();
    if (company !== undefined) updates.company = company.trim();
    if (designation !== undefined) updates.designation = designation.trim();
    if (linkedinUrl !== undefined) updates.linkedinUrl = linkedinUrl.trim();
    if (status !== undefined) updates.status = status;

    if (email !== undefined) {
      if (!isValidEmail(email)) {
        return res.status(400).json({ error: 'Invalid email syntax.' });
      }
      const cleanEmail = normalizeEmail(email);
      const existing = await Contact.findOne({ email: cleanEmail, _id: { $ne: req.params.id } });
      if (existing) {
        return res.status(409).json({ error: `A contact with email ${cleanEmail} already exists.` });
      }
      updates.email = cleanEmail;
    }

    const contact = await Contact.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    res.json(contact);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/contacts/:id
router.delete('/:id', async (req, res) => {
  try {
    const contact = await Contact.findByIdAndDelete(req.params.id);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });
    res.json({ message: 'Contact deleted successfully', id: req.params.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/contacts/:id/suppress (Opt-out/suppression action)
router.post('/:id/suppress', async (req, res) => {
  try {
    const { reason = 'OPT_OUT', notes = '' } = req.body;
    const contact = await Contact.findById(req.params.id);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    contact.status = reason === 'OPT_OUT' ? 'OPTED_OUT' : 'SUPPRESSED';
    await contact.save();

    await Suppression.findOneAndUpdate(
      { email: contact.email },
      { email: contact.email, reason, notes },
      { upsert: true }
    );

    res.json({ message: `Contact ${contact.email} suppressed successfully.`, contact });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/contacts/csv-parse (Parse uploaded CSV and return headers & detected mapping)
router.post('/csv-parse', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No CSV file uploaded.' });
    }

    const { headers, rows } = await csvService.parseCsvBuffer(req.file.buffer);
    const suggestedMapping = csvService.autoDetectMapping(headers);

    res.json({
      headers,
      suggestedMapping,
      totalRows: rows.length,
      sampleRows: rows.slice(0, 5),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/contacts/csv-preview (Preview validation & deduplication with chosen mapping)
router.post('/csv-preview', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No CSV file uploaded.' });
    }

    const mapping = JSON.parse(req.body.mapping || '{}');
    if (!mapping.name || !mapping.email || !mapping.company || !mapping.designation) {
      return res.status(400).json({ error: 'Mapping for name, email, company, and designation are required.' });
    }

    const { rows } = await csvService.parseCsvBuffer(req.file.buffer);
    const previewResult = await csvService.previewAndValidate(rows, mapping);

    res.json(previewResult);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/contacts/import (Confirm import and save rows to MongoDB)
router.post('/import', async (req, res) => {
  try {
    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'No rows provided for import.' });
    }

    const imported = [];
    const skipped = [];

    for (const item of rows) {
      if (item.excluded) {
        skipped.push({ email: item.data?.email, reason: 'EXCLUDED_BY_USER' });
        continue;
      }

      const { name, email, company, designation, linkedinUrl } = item.data || {};
      if (!name || !email || !isValidEmail(email) || !company || !designation) {
        skipped.push({ email, reason: 'INVALID_FIELDS' });
        continue;
      }

      const cleanEmail = normalizeEmail(email);

      // Check if already exists in DB
      const existing = await Contact.findOne({ email: cleanEmail });
      if (existing) {
        skipped.push({ email: cleanEmail, reason: 'ALREADY_EXISTS_IN_DB' });
        continue;
      }

      // Check suppression
      const isSuppressed = await Suppression.findOne({ email: cleanEmail });

      const newContact = await Contact.create({
        name: name.trim(),
        email: cleanEmail,
        company: company.trim(),
        designation: designation.trim(),
        linkedinUrl: linkedinUrl ? linkedinUrl.trim() : '',
        status: isSuppressed ? 'SUPPRESSED' : 'ACTIVE',
      });

      imported.push(newContact);
    }

    res.json({
      message: `Imported ${imported.length} contacts successfully.`,
      importedCount: imported.length,
      skippedCount: skipped.length,
      imported,
      skipped,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

