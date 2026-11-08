const express = require('express');
const router = express.Router();
const Email = require('../models/Email');
const ActivityLog = require('../models/ActivityLog');

// GET /api/activity (Combines comprehensive outreach status per contact/email and audit events)
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;

    const total = await Email.countDocuments();
    const emails = await Email.find()
      .populate('contactId')
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit, 10));

    // Map each email into user-friendly activity row
    const activityRows = emails.map((e) => ({
      emailId: e._id,
      contact: {
        id: e.contactId?._id,
        name: e.contactId?.name || 'Unknown',
        email: e.recipientEmail,
        company: e.contactId?.company || 'N/A',
        designation: e.contactId?.designation || 'N/A',
      },
      subject: e.subject,
      initialEmailStatus: e.status,
      sentAt: e.sentAt,
      scheduledAt: e.scheduledAt,
      replyStatus: e.status === 'REPLIED' ? 'REPLIED' : e.replyReceivedAt ? 'REPLIED' : 'NO_REPLY',
      replyReceivedAt: e.replyReceivedAt,
      followUpStatus: e.followUpStatus,
      followUpDueAt: e.followUpDueAt,
      followUpSentAt: e.followUpSentAt,
      lastActivityAt: e.updatedAt,
    }));

    // Fetch recent audit logs as well
    const recentLogs = await ActivityLog.find()
      .populate('contactId')
      .sort({ createdAt: -1 })
      .limit(20);

    res.json({
      activity: activityRows,
      recentLogs,
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

module.exports = router;

