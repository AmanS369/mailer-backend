const mongoose = require('mongoose');

const scheduledJobSchema = new mongoose.Schema(
  {
    emailId: { type: mongoose.Schema.Types.ObjectId, ref: 'Email', required: true, index: true },
    type: { type: String, enum: ['FIRST_TOUCH', 'FOLLOW_UP'], required: true },
    bullJobId: { type: String, index: true },
    scheduledFor: { type: Date, required: true, index: true },
    status: {
      type: String,
      enum: ['WAITING', 'ACTIVE', 'COMPLETED', 'FAILED', 'CANCELLED'],
      default: 'WAITING',
      index: true,
    },
    error: { type: String },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('ScheduledJob', scheduledJobSchema);

