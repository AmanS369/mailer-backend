const express = require('express');
const router = express.Router();
const Contact = require('../models/Contact');
const Email = require('../models/Email');
const EmailReply = require('../models/EmailReply');
const ActivityLog = require('../models/ActivityLog');

// GET /api/dashboard/stats
router.get('/stats', async (req, res) => {
  try {
    const [
      totalContacts,
      emailsSent,
      scheduledEmails,
      repliesReceived,
      followUpsPending,
      followUpsSent,
      failedEmails,
    ] = await Promise.all([
      Contact.countDocuments(),
      Email.countDocuments({ status: { $in: ['SENT', 'FOLLOW_UP_PENDING', 'FOLLOW_UP_SENT', 'REPLIED'] } }),
      Email.countDocuments({ status: 'SCHEDULED' }),
      EmailReply.countDocuments(),
      Email.countDocuments({ followUpStatus: 'PENDING' }),
      Email.countDocuments({ followUpStatus: 'SENT' }),
      Email.countDocuments({ status: 'FAILED' }),
    ]);

    res.json({
      totalContacts,
      emailsSent,
      scheduledEmails,
      repliesReceived,
      followUpsPending,
      followUpsSent,
      failedEmails,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

