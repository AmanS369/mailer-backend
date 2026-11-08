const express = require('express');
const router = express.Router();
const Setting = require('../models/Setting');
const config = require('../config/env');

const DEFAULT_SETTINGS = {
  dailySendingLimit: config.DAILY_SENDING_LIMIT || 50,
  candidateName: '',
  defaultFollowUpSubject: 'Following up on my previous email - {{companyName}}',
  defaultFollowUpBody:
    'Hi {{firstName}},\n\nI wanted to follow up on my previous email and check whether there might be any suitable opportunities.\n\nI would appreciate your consideration.\n\nRegards,\n{{candidateName}}',
  allowedDays: [0, 1, 2, 3, 4, 5, 6],
  timezone: config.TIMEZONE || 'Asia/Kolkata',
};

// GET /api/settings
router.get('/', async (req, res) => {
  try {
    const settingsDocs = await Setting.find();
    const result = { ...DEFAULT_SETTINGS };

    for (const doc of settingsDocs) {
      result[doc.key] = doc.value;
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/settings
router.patch('/', async (req, res) => {
  try {
    const updates = req.body;
    const allowedKeys = Object.keys(DEFAULT_SETTINGS);

    for (const [key, value] of Object.entries(updates)) {
      if (allowedKeys.includes(key)) {
        await Setting.findOneAndUpdate(
          { key },
          { key, value },
          { upsert: true, new: true }
        );
      }
    }

    const settingsDocs = await Setting.find();
    const result = { ...DEFAULT_SETTINGS };
    for (const doc of settingsDocs) {
      result[doc.key] = doc.value;
    }

    res.json({ message: 'Settings updated successfully.', settings: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

