const db = require('../db/client');
const AppError = require('../utils/AppError');
const { hashPassword, verifyPassword, validatePasswordStrength } = require('../utils/password');
const { signAccessToken, generateRefreshToken, hashToken } = require('../utils/tokens');
const userRepository = require('../repositories/user.repository');
const workspaceRepository = require('../repositories/workspace.repository');
const refreshTokenRepository = require('../repositories/refreshToken.repository');

async function register({ email, password, name }) {
  const passwordError = validatePasswordStrength(password);
  if (passwordError) {
    throw AppError.badRequest(passwordError, 'WEAK_PASSWORD');
  }

  const existing = await userRepository.findByEmail(email);
  if (existing) {
    throw AppError.conflict('An account with this email already exists', 'EMAIL_TAKEN');
  }

  const passwordHash = await hashPassword(password);

  const user = await db.transaction(async (trx) => {
    const [created] = await trx('users')
      .insert({ email, password_hash: passwordHash, name })
      .returning(['id', 'email', 'name', 'plan']);
    await workspaceRepository.createPersonalWorkspace(trx, {
      ownerId: created.id,
      name: name ? `${name}'s workspace` : 'Personal workspace',
    });
    return created;
  });

  return issueSession(user);
}

async function login({ email, password }) {
  const user = await userRepository.findByEmail(email);
  if (!user) {
    throw AppError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    throw AppError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
  }

  return issueSession(user);
}

async function issueSession(user) {
  const accessToken = signAccessToken(user);
  const { raw, hash, expiresAt } = generateRefreshToken();
  await refreshTokenRepository.create({ userId: user.id, tokenHash: hash, expiresAt });

  return {
    user: { id: user.id, email: user.email, name: user.name, plan: user.plan },
    accessToken,
    refreshToken: raw,
  };
}

async function refresh(rawRefreshToken) {
  if (!rawRefreshToken) {
    throw AppError.unauthorized('Missing refresh token', 'INVALID_REFRESH_TOKEN');
  }

  const hash = hashToken(rawRefreshToken);
  const existing = await refreshTokenRepository.findValidByHash(hash);
  if (!existing) {
    throw AppError.unauthorized('Invalid or expired refresh token', 'INVALID_REFRESH_TOKEN');
  }

  const user = await userRepository.findById(existing.user_id);
  if (!user) {
    throw AppError.unauthorized('Invalid refresh token', 'INVALID_REFRESH_TOKEN');
  }

  // Rotate: issue a new refresh token, revoke the old one, link them.
  const accessToken = signAccessToken(user);
  const next = generateRefreshToken();
  const created = await refreshTokenRepository.create({
    userId: user.id,
    tokenHash: next.hash,
    expiresAt: next.expiresAt,
  });
  await refreshTokenRepository.revoke(existing.id, created.id);

  return { accessToken, refreshToken: next.raw };
}

async function logout(rawRefreshToken) {
  if (!rawRefreshToken) return;
  const hash = hashToken(rawRefreshToken);
  const existing = await refreshTokenRepository.findValidByHash(hash);
  if (existing) {
    await refreshTokenRepository.revoke(existing.id);
  }
}

module.exports = { register, login, refresh, logout };
