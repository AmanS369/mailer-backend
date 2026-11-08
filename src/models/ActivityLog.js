const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema(
  {
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact', index: true },
    emailId: { type: mongoose.Schema.Types.ObjectId, ref: 'Email', index: true },
    type: {
      type: String,
      enum: [
        'EMAIL_SENT',
        'EMAIL_SCHEDULED',
        'EMAIL_FAILED',
        'REPLY_RECEIVED',
        'FOLLOW_UP_SENT',
        'FOLLOW_UP_CANCELLED',
        'BOUNCE_DETECTED',
        'SUPPRESSED',
      ],
      required: true,
      index: true,
    },
    description: { type: String, required: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
  }
);

activityLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('ActivityLog', activityLogSchema);

