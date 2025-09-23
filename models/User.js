// models/User.js
const mongoose = require('mongoose');

const emailRegex =
  // basic, safe email check (lets most valid addresses through)
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const UserSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
      required: [true, 'Name is required'],
      minlength: 2,
      maxlength: 120,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      unique: true,
      index: true,
      required: [true, 'Email is required'],
      validate: {
        validator: (v) => emailRegex.test(v),
        message: 'Please provide a valid email address',
      },
    },
    // Store a bcrypt **hash** here (not the raw password)
    password: {
      type: String,
      required: [true, 'Password hash is required'],
      minlength: 20, // bcrypt hashes are long; this guards against raw passwords by mistake
    },
    isAdmin: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform: (_doc, ret) => {
        delete ret.password; // never leak hash
        return ret;
      },
    },
    toObject: {
      transform: (_doc, ret) => {
        delete ret.password;
        return ret;
      },
    },
  }
);

// Helpful virtual for display name fallback (optional)
UserSchema.virtual('displayName').get(function () {
  return this.name || this.email?.split('@')[0] || 'User';
});

// Defensive unique index (in case the collection existed before)
UserSchema.index({ email: 1 }, { unique: true });

// NOTE: We are hashing passwords in server.js on register.
// If you ever move hashing into the model, add a pre('save')
// hook here and ensure you don't double-hash.

module.exports = mongoose.model('User', UserSchema);
