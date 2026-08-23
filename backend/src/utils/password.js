const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 12;
const MIN_LENGTH = 10;

async function hashPassword(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

/**
 * Deliberately simple, explainable password policy rather than an opaque
 * "strength score": minimum length + at least one letter and one number.
 * Returns null if valid, or a user-facing reason string if not.
 */
function validatePasswordStrength(password) {
  if (typeof password !== 'string' || password.length < MIN_LENGTH) {
    return `Password must be at least ${MIN_LENGTH} characters long`;
  }
  if (!/[a-zA-Z]/.test(password)) {
    return 'Password must contain at least one letter';
  }
  if (!/[0-9]/.test(password)) {
    return 'Password must contain at least one number';
  }
  return null;
}

module.exports = { hashPassword, verifyPassword, validatePasswordStrength };
