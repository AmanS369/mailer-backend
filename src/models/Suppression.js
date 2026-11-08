const mongoose = require('mongoose');

const suppressionSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    reason: {
      type: String,
      enum: ['OPT_OUT', 'HARD_BOUNCE', 'MANUAL_SUPPRESSION'],
      default: 'MANUAL_SUPPRESSION',
    },
    notes: { type: String, default: '' },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Suppression', suppressionSchema);

