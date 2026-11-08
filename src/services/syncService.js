const { google } = require('googleapis');
const gmailService = require('./gmailService');
const Email = require('../models/Email');
const Contact = require('../models/Contact');
const EmailReply = require('../models/EmailReply');
const Suppression = require('../models/Suppression');
const ActivityLog = require('../models/ActivityLog');
const queueService = require('./queueService');
const { acquireLock, releaseLock } = require('../config/redis');

/**
 * Check if a message is a hard bounce notification
 */
function isBounceMessage(from = '', subject = '', snippet = '') {
  const fromLower = from.toLowerCase();
  const subLower = subject.toLowerCase();
  const snipLower = snippet.toLowerCase();

  return (
    fromLower.includes('mailer-daemon') ||
    fromLower.includes('postmaster') ||
    subLower.includes('delivery status notification (failure)') ||
    subLower.includes('undeliverable') ||
    subLower.includes('mail delivery failed') ||
    snipLower.includes('address not found') ||
    snipLower.includes('message not delivered')
  );
}

/**
 * Extract clean email address from "Name <email@example.com>" string
 */
function extractEmailAddress(raw = '') {
  const match = raw.match(/<([^>]+)>/);
  if (match) return match[1].toLowerCase().trim();
  return raw.replace(/["']/g, '').toLowerCase().trim();
}

/**
 * Check an individual email for replies directly via Gmail thread
 * Returns { hasReplied: boolean, reply: object|null }
 */
async function checkEmailForReplies(emailDoc) {
  if (!emailDoc.gmailThreadId) {
    return { hasReplied: false, reply: null };
  }

  try {
    const threadData = await gmailService.getThreadDetails(emailDoc.gmailThreadId);
    const messages = threadData.messages || [];

    // Filter messages that arrived AFTER our initial email was sent
    const ourSentTimestamp = emailDoc.sentAt ? new Date(emailDoc.sentAt).getTime() : 0;
    const recipientEmail = emailDoc.recipientEmail.toLowerCase().trim();

    for (const msg of messages) {
      const msgTime = parseInt(msg.internalDate, 10);
      if (msgTime <= ourSentTimestamp) {
        continue;
      }

      const headers = msg.payload?.headers || [];
      const fromHeader = headers.find((h) => h.name.toLowerCase() === 'from')?.value || '';
      const toHeader = headers.find((h) => h.name.toLowerCase() === 'to')?.value || '';
      const subjectHeader = headers.find((h) => h.name.toLowerCase() === 'subject')?.value || '';
      const inReplyToHeader = headers.find((h) => h.name.toLowerCase() === 'in-reply-to')?.value || '';
      const referencesHeader = headers.find((h) => h.name.toLowerCase() === 'references')?.value || '';

      const senderEmail = extractEmailAddress(fromHeader);

      // Check for hard bounce
      if (isBounceMessage(fromHeader, subjectHeader, msg.snippet || '')) {
        await handleBounce(emailDoc, msg.id, subjectHeader);
        return { hasReplied: false, isBounced: true, reply: null };
      }

      // Check if message is a genuine reply from the recipient:
      // 1. Thread ID matches
      // 2. Sender matches recipientEmail
      // 3. Or In-Reply-To / References matches our original message
      const matchesSender = senderEmail === recipientEmail;
      const matchesReferences =
        emailDoc.gmailMessageId &&
        (inReplyToHeader.includes(emailDoc.gmailMessageId) || referencesHeader.includes(emailDoc.gmailMessageId));

      if (matchesSender || matchesReferences) {
        // Genuine reply found!
        const savedReply = await handleGenuineReply(emailDoc, msg, {
          from: fromHeader,
          to: toHeader,
          subject: subjectHeader,
          inReplyTo: inReplyToHeader,
          references: referencesHeader ? referencesHeader.split(/\s+/) : [],
          snippet: msg.snippet || '',
          receivedAt: new Date(msgTime),
        });

        return { hasReplied: true, reply: savedReply };
      }
    }

    return { hasReplied: false, reply: null };
  } catch (err) {
    console.error(`[Sync] Error checking thread ${emailDoc.gmailThreadId}:`, err.message);
    return { hasReplied: false, reply: null };
  }
}

/**
 * Handle detected genuine reply
 */
async function handleGenuineReply(emailDoc, gmailMsg, metadata) {
  // Check if reply already recorded
  let reply = await EmailReply.findOne({ gmailMessageId: gmailMsg.id });
  if (!reply) {
    reply = await EmailReply.create({
      emailId: emailDoc._id,
      contactId: emailDoc.contactId,
      gmailMessageId: gmailMsg.id,
      gmailThreadId: emailDoc.gmailThreadId,
      from: metadata.from,
      to: metadata.to,
      subject: metadata.subject,
      snippet: metadata.snippet,
      inReplyTo: metadata.inReplyTo,
      references: metadata.references,
      receivedAt: metadata.receivedAt,
    });
  }

  // Update Email record
  emailDoc.status = 'REPLIED';
  emailDoc.replyReceivedAt = metadata.receivedAt;
  emailDoc.followUpStatus = 'CANCELLED';
  await emailDoc.save();

  // Cancel any pending BullMQ follow-up job
  await queueService.cancelEmailJob(emailDoc._id.toString(), 'FOLLOW_UP');

  // Update Contact status
  await Contact.findByIdAndUpdate(emailDoc.contactId, { status: 'REPLIED' });

  // Log activity
  await ActivityLog.create({
    contactId: emailDoc.contactId,
    emailId: emailDoc._id,
    type: 'REPLY_RECEIVED',
    description: `Reply received from ${emailDoc.recipientEmail}: "${metadata.subject}"`,
    metadata: {
      replyId: reply._id,
      gmailMessageId: gmailMsg.id,
      snippet: metadata.snippet,
    },
  });

  return reply;
}

/**
 * Handle hard bounce detection
 */
async function handleBounce(emailDoc, bounceMsgId, subject) {
  emailDoc.status = 'BOUNCED';
  emailDoc.followUpStatus = 'CANCELLED';
  await emailDoc.save();

  // Cancel follow-up job
  await queueService.cancelEmailJob(emailDoc._id.toString(), 'FOLLOW_UP');

  // Update Contact
  await Contact.findByIdAndUpdate(emailDoc.contactId, { status: 'BOUNCED' });

  // Add to suppression list
  await Suppression.findOneAndUpdate(
    { email: emailDoc.recipientEmail },
    {
      email: emailDoc.recipientEmail,
      reason: 'HARD_BOUNCE',
      notes: `Hard bounce detected via Gmail message ${bounceMsgId}: ${subject}`,
    },
    { upsert: true }
  );

  await ActivityLog.create({
    contactId: emailDoc.contactId,
    emailId: emailDoc._id,
    type: 'BOUNCE_DETECTED',
    description: `Hard bounce detected for ${emailDoc.recipientEmail}`,
    metadata: { bounceMsgId, subject },
  });
}

/**
 * Synchronize replies across all active pending outreach emails
 * Protected by single-instance distributed lock
 */
async function syncAllPendingReplies() {
  const lockAcquired = await acquireLock('reply_sync', 120000); // 2 minute lock
  if (!lockAcquired) {
    // Another instance or run is in progress
    return;
  }

  try {
    // Find all emails that are SENT or FOLLOW_UP_PENDING and have gmailThreadId
    const pendingEmails = await Email.find({
      status: { $in: ['SENT', 'FOLLOW_UP_PENDING'] },
      gmailThreadId: { $exists: true, $ne: null },
    });

    for (const email of pendingEmails) {
      await checkEmailForReplies(email);
    }
  } catch (err) {
    console.error('[Sync] Error syncing all pending replies:', err.message);
  } finally {
    await releaseLock('reply_sync');
  }
}

module.exports = {
  checkEmailForReplies,
  syncAllPendingReplies,
  handleGenuineReply,
  handleBounce,
};

