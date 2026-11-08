const { addHours, startOfDay, endOfDay } = require('date-fns');
const { toZonedTime, fromZonedTime } = require('date-fns-tz');
const Email = require('../models/Email');
const Contact = require('../models/Contact');
const Resume = require('../models/Resume');
const Suppression = require('../models/Suppression');
const Setting = require('../models/Setting');
const ActivityLog = require('../models/ActivityLog');
const ScheduledJob = require('../models/ScheduledJob');
const gmailService = require('./gmailService');
const syncService = require('./syncService');
const queueService = require('./queueService');
const { renderTemplate } = require('../utils/placeholders');
const { TIMEZONE, isDateAllowed, getNextEligibleDate, formatInKolkata } = require('../utils/timezone');
const config = require('../config/env');

/**
 * Get daily sending limit from settings or env
 */
async function getDailyLimit() {
  const setting = await Setting.findOne({ key: 'dailySendingLimit' });
  return setting ? parseInt(setting.value, 10) : config.DAILY_SENDING_LIMIT;
}

/**
 * Get candidate name from settings
 */
async function getCandidateName() {
  const setting = await Setting.findOne({ key: 'candidateName' });
  return setting?.value || '';
}

/**
 * Get allowed days of week from settings (default all 7 days: 0..6)
 */
async function getAllowedDays() {
  const setting = await Setting.findOne({ key: 'allowedDays' });
  return setting?.value || [0, 1, 2, 3, 4, 5, 6];
}

/**
 * Check if daily sending limit is reached for today (in Asia/Kolkata timezone)
 */
async function isDailyLimitReached() {
  const limit = await getDailyLimit();
  const now = new Date();
  const zonedNow = toZonedTime(now, TIMEZONE);
  const zonedStart = startOfDay(zonedNow);
  const zonedEnd = endOfDay(zonedNow);

  const startUtc = fromZonedTime(zonedStart, TIMEZONE);
  const endUtc = fromZonedTime(zonedEnd, TIMEZONE);

  // Count first touches and follow-ups sent today
  const firstTouchesCount = await Email.countDocuments({
    sentAt: { $gte: startUtc, $lte: endUtc },
  });

  const followUpsCount = await Email.countDocuments({
    followUpSentAt: { $gte: startUtc, $lte: endUtc },
  });

  return firstTouchesCount + followUpsCount >= limit;
}

/**
 * Check if an email address is suppressed, opted out, or bounced
 */
async function isSuppressed(email) {
  const cleanEmail = email.toLowerCase().trim();
  const suppression = await Suppression.findOne({ email: cleanEmail });
  if (suppression) return true;

  const contact = await Contact.findOne({ email: cleanEmail });
  if (contact && ['SUPPRESSED', 'OPTED_OUT', 'BOUNCED'].includes(contact.status)) {
    return true;
  }

  return false;
}

/**
 * Send the initial outreach email (Send Now or when triggered by BullMQ)
 */
async function executeSendInitial(emailId) {
  const email = await Email.findById(emailId).populate('contactId').populate('attachmentId');
  if (!email) {
    throw new Error(`Email ${emailId} not found`);
  }

  // Idempotency: if already sent, ignore
  if (email.status === 'SENT' || email.status === 'FOLLOW_UP_PENDING' || email.status === 'FOLLOW_UP_SENT') {
    console.log(`[EmailService] Email ${emailId} already sent. Skipping.`);
    return email;
  }

  // Pre-send checks
  if (await isSuppressed(email.recipientEmail)) {
    email.status = 'OPTED_OUT';
    await email.save();
    await ActivityLog.create({
      contactId: email.contactId?._id,
      emailId: email._id,
      type: 'SUPPRESSED',
      description: `Sending cancelled: ${email.recipientEmail} is in suppression list or opted out.`,
    });
    return email;
  }

  if (await isDailyLimitReached()) {
    throw new Error('Daily sending limit reached. Email will be retried automatically tomorrow.');
  }

  // Check attachment if specified
  let attachmentPath = null;
  let attachmentName = null;
  if (email.attachmentId) {
    attachmentPath = email.attachmentId.filepath;
    attachmentName = email.attachmentId.originalName;
  }

  const candidateName = await getCandidateName();
  const senderDisplayName = config.GMAIL_SENDER_NAME || candidateName;

  // Send via Gmail API
  try {
    const sendResult = await gmailService.sendGmailEmail({
      to: email.recipientEmail,
      subject: email.subject,
      body: email.body,
      attachmentPath,
      attachmentName,
      senderName: senderDisplayName,
    });

    const sentAt = new Date();
    email.gmailMessageId = sendResult.gmailMessageId;
    email.gmailThreadId = sendResult.gmailThreadId;
    email.sentAt = sentAt;
    email.status = 'SENT';

    // Calculate 48-hour follow-up due time
    let dueAt = addHours(sentAt, 48);

    // Check allowed days
    const allowedDays = await getAllowedDays();
    if (!isDateAllowed(dueAt, allowedDays)) {
      const nextEligible = getNextEligibleDate(dueAt, allowedDays);
      await ActivityLog.create({
        contactId: email.contactId?._id,
        emailId: email._id,
        type: 'EMAIL_SCHEDULED',
        description: `Follow-up due date adjusted from ${formatInKolkata(dueAt)} to next eligible day ${formatInKolkata(nextEligible)}`,
      });
      dueAt = nextEligible;
    }

    email.followUpDueAt = dueAt;
    email.followUpStatus = 'PENDING';
    email.status = 'FOLLOW_UP_PENDING';
    await email.save();

    // Schedule BullMQ job for 48-hour follow-up
    await queueService.scheduleEmailJob(email._id.toString(), 'FOLLOW_UP', dueAt);

    await ScheduledJob.findOneAndUpdate(
      { emailId: email._id, type: 'FOLLOW_UP' },
      {
        emailId: email._id,
        type: 'FOLLOW_UP',
        bullJobId: `follow_up-${email._id}`,
        scheduledFor: dueAt,
        status: 'WAITING',
      },
      { upsert: true }
    );

    await ActivityLog.create({
      contactId: email.contactId?._id,
      emailId: email._id,
      type: 'EMAIL_SENT',
      description: `Outreach email sent to ${email.recipientEmail}. Follow-up scheduled for ${formatInKolkata(dueAt)}.`,
      metadata: {
        gmailMessageId: sendResult.gmailMessageId,
        gmailThreadId: sendResult.gmailThreadId,
      },
    });

    return email;
  } catch (error) {
    email.status = 'FAILED';
    email.lastError = error.message;
    await email.save();

    await ActivityLog.create({
      contactId: email.contactId?._id,
      emailId: email._id,
      type: 'EMAIL_FAILED',
      description: `Failed to send outreach email to ${email.recipientEmail}: ${error.message}`,
    });

    throw error;
  }
}

/**
 * Execute the 48-hour follow-up
 */
async function executeFollowUp(emailId) {
  const email = await Email.findById(emailId).populate('contactId');
  if (!email) {
    throw new Error(`Email ${emailId} not found for follow-up`);
  }

  // Safety checks:
  // 1. Never send more than one follow-up
  if (email.followUpCount > 0 || email.followUpStatus !== 'PENDING') {
    console.log(`[EmailService] Follow-up for ${emailId} already processed (status: ${email.followUpStatus}). Skipping.`);
    return;
  }

  // 2. Check if cancelled
  if (email.status === 'CANCELLED') {
    email.followUpStatus = 'CANCELLED';
    await email.save();
    return;
  }

  // 3. Suppression & bounce check
  if (await isSuppressed(email.recipientEmail)) {
    email.followUpStatus = 'CANCELLED';
    await email.save();
    await ActivityLog.create({
      contactId: email.contactId?._id,
      emailId: email._id,
      type: 'FOLLOW_UP_CANCELLED',
      description: `Follow-up cancelled: ${email.recipientEmail} is suppressed or opted out.`,
    });
    return;
  }

  // 4. Synchronize & check Gmail thread for reply immediately before sending
  const { hasReplied, isBounced } = await syncService.checkEmailForReplies(email);
  if (hasReplied || isBounced) {
    console.log(`[EmailService] Reply/Bounce detected right before follow-up for ${email.recipientEmail}. Cancelled.`);
    email.followUpStatus = 'CANCELLED';
    await email.save();
    return;
  }

  // 5. Daily limit check
  if (await isDailyLimitReached()) {
    throw new Error('Daily sending limit reached. Follow-up will be retried automatically.');
  }

  // 6. Build follow-up template
  const candidateName = await getCandidateName();
  const settingSubject = await Setting.findOne({ key: 'defaultFollowUpSubject' });
  const settingBody = await Setting.findOne({ key: 'defaultFollowUpBody' });

  const rawSubject = settingSubject?.value || 'Following up on my previous email - {{companyName}}';
  const rawBody =
    settingBody?.value ||
    'Hi {{firstName}},\n\nI wanted to follow up on my previous email and check whether there might be any suitable opportunities.\n\nI would appreciate your consideration.\n\nRegards,\n{{candidateName}}';

  const renderedSubject = renderTemplate(rawSubject, email.contactId, candidateName);
  const renderedBody = renderTemplate(rawBody, email.contactId, candidateName);

  const senderDisplayName = config.GMAIL_SENDER_NAME || candidateName;

  // Send follow-up in the same thread
  try {
    const sendResult = await gmailService.sendGmailEmail({
      to: email.recipientEmail,
      subject: renderedSubject,
      body: renderedBody,
      threadId: email.gmailThreadId,
      inReplyTo: email.gmailMessageId,
      references: email.gmailMessageId,
      senderName: senderDisplayName,
    });

    const now = new Date();
    email.followUpStatus = 'SENT';
    email.followUpSentAt = now;
    email.followUpMessageId = sendResult.gmailMessageId;
    email.followUpCount = 1;
    email.status = 'FOLLOW_UP_SENT';
    await email.save();

    await ScheduledJob.findOneAndUpdate(
      { emailId: email._id, type: 'FOLLOW_UP' },
      { status: 'COMPLETED' }
    );

    await ActivityLog.create({
      contactId: email.contactId?._id,
      emailId: email._id,
      type: 'FOLLOW_UP_SENT',
      description: `Follow-up email sent to ${email.recipientEmail} in thread ${email.gmailThreadId}`,
      metadata: {
        followUpMessageId: sendResult.gmailMessageId,
      },
    });

    return email;
  } catch (err) {
    console.error(`[EmailService] Failed to send follow-up to ${email.recipientEmail}:`, err.message);
    await ActivityLog.create({
      contactId: email.contactId?._id,
      emailId: email._id,
      type: 'EMAIL_FAILED',
      description: `Failed to send follow-up to ${email.recipientEmail}: ${err.message}`,
    });
    throw err;
  }
}

/**
 * Reconcile jobs after container/backend restart
 * Enqueue any SCHEDULED or FOLLOW_UP_PENDING emails missing in BullMQ
 */
async function reconcileJobsOnStartup() {
  try {
    console.log('[EmailService] Reconciling scheduled jobs after startup...');
    const now = new Date();

    // Reconcile scheduled first touches
    const scheduledEmails = await Email.find({ status: 'SCHEDULED', scheduledAt: { $exists: true } });
    for (const email of scheduledEmails) {
      await queueService.scheduleEmailJob(email._id.toString(), 'FIRST_TOUCH', email.scheduledAt);
    }

    // Reconcile pending follow-ups
    const pendingFollowUps = await Email.find({
      status: 'FOLLOW_UP_PENDING',
      followUpStatus: 'PENDING',
      followUpCount: 0,
      followUpDueAt: { $exists: true },
    });

    for (const email of pendingFollowUps) {
      await queueService.scheduleEmailJob(email._id.toString(), 'FOLLOW_UP', email.followUpDueAt);
    }

    console.log(`[EmailService] Reconciled ${scheduledEmails.length} scheduled emails and ${pendingFollowUps.length} follow-ups.`);
  } catch (err) {
    console.error('[EmailService] Job reconciliation failed:', err.message);
  }
}

module.exports = {
  getDailyLimit,
  getCandidateName,
  getAllowedDays,
  isDailyLimitReached,
  isSuppressed,
  executeSendInitial,
  executeFollowUp,
  reconcileJobsOnStartup,
};

