const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const Email = require('../models/Email');
const Contact = require('../models/Contact');
const Resume = require('../models/Resume');
const ScheduledJob = require('../models/ScheduledJob');
const ActivityLog = require('../models/ActivityLog');
const Setting = require('../models/Setting');
const emailService = require('../services/emailService');
const queueService = require('../services/queueService');
const { renderTemplate, findUnresolvedPlaceholders } = require('../utils/placeholders');
const { isDateAllowed, getNextEligibleDate, formatInKolkata } = require('../utils/timezone');

// POST /api/emails/preview
router.post('/preview', async (req, res) => {
  try {
    const { contactIds, subjectTemplate, bodyTemplate, attachmentId } = req.body;

    if (!contactIds || !contactIds.length) {
      return res.status(400).json({ error: 'At least one contact must be selected.' });
    }

    const contacts = await Contact.find({ _id: { $in: contactIds } });
    const candidateName = await emailService.getCandidateName();

    let resumeDoc = null;
    if (attachmentId) {
      resumeDoc = await Resume.findById(attachmentId);
    }

    const previews = contacts.map((contact) => {
      const renderedSubject = renderTemplate(subjectTemplate, contact, candidateName);
      const renderedBody = renderTemplate(bodyTemplate, contact, candidateName);
      const subjectUnresolved = findUnresolvedPlaceholders(renderedSubject);
      const bodyUnresolved = findUnresolvedPlaceholders(renderedBody);
      const unresolved = Array.from(new Set([...subjectUnresolved, ...bodyUnresolved]));

      return {
        contactId: contact._id,
        contactName: contact.name,
        recipientEmail: contact.email,
        company: contact.company,
        designation: contact.designation,
        subject: renderedSubject,
        body: renderedBody,
        unresolvedPlaceholders: unresolved,
        hasUnresolved: unresolved.length > 0,
        attachment: resumeDoc
          ? { id: resumeDoc._id, name: resumeDoc.originalName, size: resumeDoc.size }
          : null,
      };
    });

    res.json({ previews });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/emails/send (Send Now immediately)
router.post('/send', async (req, res) => {
  try {
    const { contactIds, subjectTemplate, bodyTemplate, attachmentId } = req.body;

    if (!contactIds || !contactIds.length) {
      return res.status(400).json({ error: 'Please select at least one recipient.' });
    }

    const candidateName = await emailService.getCandidateName();
    const contacts = await Contact.find({ _id: { $in: contactIds } });

    const results = [];
    const errors = [];

    for (const contact of contacts) {
      // Check suppression / opt-out
      if (await emailService.isSuppressed(contact.email)) {
        errors.push({ email: contact.email, error: 'Recipient is suppressed or opted out.' });
        continue;
      }

      const renderedSubject = renderTemplate(subjectTemplate, contact, candidateName);
      const renderedBody = renderTemplate(bodyTemplate, contact, candidateName);

      // Create email record with DRAFT status initially
      const idempotencyKey = crypto.randomUUID();
      const email = await Email.create({
        contactId: contact._id,
        recipientEmail: contact.email,
        subject: renderedSubject,
        body: renderedBody,
        attachmentId: attachmentId || null,
        status: 'DRAFT',
        idempotencyKey,
      });

      try {
        const sentEmail = await emailService.executeSendInitial(email._id);
        results.push(sentEmail);
      } catch (sendErr) {
        errors.push({ email: contact.email, error: sendErr.message });
      }
    }

    res.json({
      message: `Processed ${results.length} emails sent, ${errors.length} failed.`,
      sentCount: results.length,
      failedCount: errors.length,
      sent: results,
      errors,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/emails/schedule
router.post('/schedule', async (req, res) => {
  try {
    const { contactIds, subjectTemplate, bodyTemplate, attachmentId, scheduledAt } = req.body;

    if (!contactIds || !contactIds.length) {
      return res.status(400).json({ error: 'Please select at least one recipient.' });
    }

    if (!scheduledAt) {
      return res.status(400).json({ error: 'Scheduled date and time are required.' });
    }

    const scheduledDate = new Date(scheduledAt);
    if (isNaN(scheduledDate.getTime()) || scheduledDate.getTime() <= Date.now()) {
      return res.status(400).json({ error: 'Scheduled date must be in the future.' });
    }

    // Check allowed days
    const allowedDays = await emailService.getAllowedDays();
    if (!isDateAllowed(scheduledDate, allowedDays)) {
      const nextDate = getNextEligibleDate(scheduledDate, allowedDays);
      return res.status(400).json({
        error: `Selected date (${formatInKolkata(scheduledDate)}) is not an allowed sending day. Next eligible date is ${formatInKolkata(nextDate)}.`,
        nextEligibleDate: nextDate,
      });
    }

    const candidateName = await emailService.getCandidateName();
    const contacts = await Contact.find({ _id: { $in: contactIds } });

    const scheduledList = [];

    for (const contact of contacts) {
      if (await emailService.isSuppressed(contact.email)) {
        continue;
      }

      const renderedSubject = renderTemplate(subjectTemplate, contact, candidateName);
      const renderedBody = renderTemplate(bodyTemplate, contact, candidateName);

      const email = await Email.create({
        contactId: contact._id,
        recipientEmail: contact.email,
        subject: renderedSubject,
        body: renderedBody,
        attachmentId: attachmentId || null,
        status: 'SCHEDULED',
        scheduledAt: scheduledDate,
      });

      // Enqueue delayed job in BullMQ
      await queueService.scheduleEmailJob(email._id.toString(), 'FIRST_TOUCH', scheduledDate);

      await ScheduledJob.create({
        emailId: email._id,
        type: 'FIRST_TOUCH',
        bullJobId: `first_touch-${email._id}`,
        scheduledFor: scheduledDate,
        status: 'WAITING',
      });

      await ActivityLog.create({
        contactId: contact._id,
        emailId: email._id,
        type: 'EMAIL_SCHEDULED',
        description: `Outreach email scheduled for ${contact.email} at ${formatInKolkata(scheduledDate)}`,
      });

      scheduledList.push(email);
    }

    res.json({
      message: `Scheduled ${scheduledList.length} emails for ${formatInKolkata(scheduledDate)}.`,
      scheduledCount: scheduledList.length,
      scheduled: scheduledList,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/emails/draft
router.post('/draft', async (req, res) => {
  try {
    const { contactId, subject, body, attachmentId } = req.body;

    const email = await Email.create({
      contactId,
      recipientEmail: req.body.recipientEmail || '',
      subject: subject || 'Draft Email',
      body: body || '',
      attachmentId: attachmentId || null,
      status: 'DRAFT',
    });

    res.status(201).json(email);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/emails
router.get('/', async (req, res) => {
  try {
    const { status, recipientEmail, search, page = 1, limit = 50 } = req.query;
    const query = {};

    if (status) {
      if (status.includes(',')) {
        query.status = { $in: status.split(',') };
      } else {
        query.status = status;
      }
    }

    if (recipientEmail) {
      query.recipientEmail = recipientEmail.toLowerCase().trim();
    }

    if (search) {
      const regex = new RegExp(search.trim(), 'i');
      query.$or = [{ recipientEmail: regex }, { subject: regex }];
    }

    const total = await Email.countDocuments(query);
    const emails = await Email.find(query)
      .populate('contactId')
      .populate('attachmentId')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit, 10));

    res.json({
      emails,
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

// GET /api/emails/:id
router.get('/:id', async (req, res) => {
  try {
    const email = await Email.findById(req.params.id)
      .populate('contactId')
      .populate('attachmentId');

    if (!email) {
      return res.status(404).json({ error: 'Email not found' });
    }

    res.json(email);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/emails/:id/cancel
router.post('/:id/cancel', async (req, res) => {
  try {
    const email = await Email.findById(req.params.id);
    if (!email) {
      return res.status(404).json({ error: 'Email not found' });
    }

    // Cancel First touch if scheduled
    if (email.status === 'SCHEDULED') {
      await queueService.cancelEmailJob(email._id.toString(), 'FIRST_TOUCH');
      email.status = 'CANCELLED';
      await ScheduledJob.findOneAndUpdate(
        { emailId: email._id, type: 'FIRST_TOUCH' },
        { status: 'CANCELLED' }
      );
    }

    // Cancel Follow-up if pending
    if (email.followUpStatus === 'PENDING') {
      await queueService.cancelEmailJob(email._id.toString(), 'FOLLOW_UP');
      email.followUpStatus = 'CANCELLED';
      await ScheduledJob.findOneAndUpdate(
        { emailId: email._id, type: 'FOLLOW_UP' },
        { status: 'CANCELLED' }
      );
    }

    await email.save();

    await ActivityLog.create({
      contactId: email.contactId,
      emailId: email._id,
      type: 'FOLLOW_UP_CANCELLED',
      description: `Pending outreach/follow-up cancelled for ${email.recipientEmail}`,
    });

    res.json({ message: 'Email / follow-up cancelled successfully', email });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

