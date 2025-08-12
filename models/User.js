// models/User.js
const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  name:       { type: String, required: true, trim: true },
  email:      { type: String, required: true, lowercase: true, trim: true, unique: true },
  password:   { type: String, required: true }, // store a bcrypt hash
  isVerified: { type: Boolean, default: false },
  isAdmin:    { type: Boolean, default: false },
}, { timestamps: true });

// Extra safety: ensure unique index on email
UserSchema.index({ email: 1 }, { unique: true });

// Hide sensitive fields when converting to JSON/objects
function omitPrivate(doc, ret) {
  delete ret.password;
  delete ret.__v;
  return ret;
}
UserSchema.set('toJSON',   { transform: omitPrivate });
UserSchema.set('toObject', { transform: omitPrivate });

module.exports = mongoose.model('User', UserSchema);
