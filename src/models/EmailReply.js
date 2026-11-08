const mongoose = require('mongoose');

const emailReplySchema = new mongoose.Schema(
  {
    emailId: { type: mongoose.Schema.Types.ObjectId, ref: 'Email', required: true, index: true },
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact', required: true, index: true },
    gmailMessageId: { type: String, required: true, unique: true, index: true },
    gmailThreadId: { type: String, required: true, index: true },
    from: { type: String, required: true },
    to: { type: String, required: true },
    subject: { type: String, default: '' },
    snippet: { type: String, default: '' },
    body: { type: String, default: '' },
    inReplyTo: { type: String, default: '' },
    references: [{ type: String }],
    receivedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('EmailReply', emailReplySchema);

