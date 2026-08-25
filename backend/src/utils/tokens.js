const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('../config');

function signAccessToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, config.auth.accessSecret, {
    expiresIn: config.auth.accessExpiresIn,
    algorithm: 'HS256',
  });
}

function verifyAccessToken(token) {
  // Explicitly restrict accepted algorithms rather than relying on the
  // library default — prevents an algorithm-confusion attack where a
  // token crafted with a different algorithm (e.g. "none") is presented.
  return jwt.verify(token, config.auth.accessSecret, { algorithms: ['HS256'] });
}

/**
 * Refresh tokens are opaque random strings (not JWTs) — the server holds
 * the source of truth (hash + expiry + revocation) in `refresh_tokens`,
 * which is what makes them revocable, unlike a self-contained JWT.
 */
function generateRefreshToken() {
  const raw = crypto.randomBytes(48).toString('hex');
  const hash = hashToken(raw);
  const expiresAt = new Date(Date.now() + config.auth.refreshExpiresInDays * 24 * 60 * 60 * 1000);
  return { raw, hash, expiresAt };
}

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

module.exports = { signAccessToken, verifyAccessToken, generateRefreshToken, hashToken };
