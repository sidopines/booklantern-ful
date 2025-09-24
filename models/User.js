// models/User.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Reuse existing model if it was already compiled (Render restarts etc.)
if (mongoose.models.User) {
  module.exports = mongoose.models.User;
  return;
}

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, default: 'Reader' },

    // One unique index for email — no duplicate index definitions
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      unique: true,
    },

    // We store a bcrypt hash here. If an old record is still plaintext,
    // the method below can auto-upgrade it after a successful match.
    password: { type: String, required: true },

    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user',
      index: true,
    },
  },
  { timestamps: true }
);

// Helper to check if a string looks like a bcrypt hash
function looksHashed(str) {
  return typeof str === 'string' && /^\$2[aby]\$/.test(str);
}

// Pre-save: hash when needed (only if not already a bcrypt hash)
UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  if (looksHashed(this.password)) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

// Instance method used by the login route
UserSchema.methods.comparePassword = async function (candidate) {
  // If already hashed, normal compare
  if (looksHashed(this.password)) {
    return bcrypt.compare(candidate, this.password);
  }

  // Legacy/plaintext record: allow login if equal, then Upgrade-In-Place
  if (candidate === this.password) {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(candidate, salt);
    await this.save(); // transparently upgrade to bcrypt
    return true;
  }

  return false;
};

UserSchema.index({ email: 1 }, { unique: true });

const User = mongoose.model('User', UserSchema);
module.exports = User;
