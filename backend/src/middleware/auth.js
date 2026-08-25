const AppError = require('../utils/AppError');
const { verifyAccessToken } = require('../utils/tokens');
const userRepository = require('../repositories/user.repository');

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');

    if (scheme !== 'Bearer' || !token) {
      throw AppError.unauthorized('Missing or invalid authorization header');
    }

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch {
      throw AppError.unauthorized('Invalid or expired access token', 'INVALID_TOKEN');
    }

    const user = await userRepository.findById(payload.sub);
    if (!user) {
      throw AppError.unauthorized('User no longer exists', 'INVALID_TOKEN');
    }

    req.user = { id: user.id, email: user.email, plan: user.plan };
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = requireAuth;
