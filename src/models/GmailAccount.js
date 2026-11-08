const mongoose = require('mongoose');

const gmailAccountSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    googleId: { type: String },
    encryptedRefreshToken: { type: String, required: true },
    accessToken: { type: String },
    tokenExpiry: { type: Date },
    historyId: { type: String },
    scope: { type: String },
    connectedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('GmailAccount', gmailAccountSchema);

