const mongoose = require('mongoose');

const emailSchema = new mongoose.Schema(
  {
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact', required: true, index: true },
    recipientEmail: { type: String, required: true, lowercase: true, trim: true, index: true },
    subject: { type: String, required: true },
    body: { type: String, required: true },
    attachmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Resume', default: null },
    
    // Gmail API identifiers
    gmailMessageId: { type: String, index: true },
    gmailThreadId: { type: String, index: true },
    
    status: {
      type: String,
      enum: [
        'DRAFT',
        'SCHEDULED',
        'SENT',
        'REPLIED',
        'FOLLOW_UP_PENDING',
        'FOLLOW_UP_SENT',
        'BOUNCED',
        'FAILED',
        'CANCELLED',
        'OPTED_OUT',
      ],
      default: 'DRAFT',
      index: true,
    },
    
    scheduledAt: { type: Date },
    sentAt: { type: Date },
    replyReceivedAt: { type: Date },
    
    // Follow-up tracking
    followUpDueAt: { type: Date, index: true },
    followUpStatus: {
      type: String,
      enum: ['NONE', 'PENDING', 'SENT', 'CANCELLED'],
      default: 'NONE',
    },
    followUpSentAt: { type: Date },
    followUpMessageId: { type: String },
    followUpCount: { type: Number, default: 0 },
    
    idempotencyKey: { type: String, unique: true, sparse: true, index: true },
    lastError: { type: String },
  },
  {
    timestamps: true,
  }
);

emailSchema.index({ recipientEmail: 1, status: 1 });
emailSchema.index({ followUpDueAt: 1, followUpStatus: 1 });

module.exports = mongoose.model('Email', emailSchema);

