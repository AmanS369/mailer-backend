const mongoose = require('mongoose');

const resumeSchema = new mongoose.Schema(
  {
    originalName: { type: String, required: true },
    filename: { type: String, required: true, unique: true },
    filepath: { type: String, required: true },
    mimeType: { type: String, required: true, default: 'application/pdf' },
    size: { type: Number, required: true },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Resume', resumeSchema);

