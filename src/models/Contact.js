const mongoose = require('mongoose');

const contactSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    company: { type: String, required: true, trim: true },
    designation: { type: String, required: true, trim: true },
    linkedinUrl: { type: String, trim: true, default: '' },
    status: {
      type: String,
      enum: ['ACTIVE', 'SUPPRESSED', 'OPTED_OUT', 'REPLIED', 'BOUNCED'],
      default: 'ACTIVE',
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Contact', contactSchema);
