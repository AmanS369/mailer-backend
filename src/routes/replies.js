const express = require('express');
const router = express.Router();
const EmailReply = require('../models/EmailReply');

// GET /api/replies
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const total = await EmailReply.countDocuments();
    const replies = await EmailReply.find()
      .populate('contactId')
      .populate('emailId')
      .sort({ receivedAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit, 10));

    res.json({
      replies,
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

// GET /api/replies/:id
router.get('/:id', async (req, res) => {
  try {
    const reply = await EmailReply.findById(req.params.id)
      .populate('contactId')
      .populate('emailId');

    if (!reply) {
      return res.status(404).json({ error: 'Reply not found' });
    }

    res.json(reply);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

