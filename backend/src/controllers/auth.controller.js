const authService = require('../services/auth.service');
const asyncHandler = require('../utils/asyncHandler');
const userRepository = require('../repositories/user.repository');

const REFRESH_COOKIE = 'refreshToken';
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/api/v1/auth',
};

function setRefreshCookie(res, token, maxAgeDays) {
  res.cookie(REFRESH_COOKIE, token, { ...COOKIE_OPTIONS, maxAge: maxAgeDays * 24 * 60 * 60 * 1000 });
}

const register = asyncHandler(async (req, res) => {
  const { user, accessToken, refreshToken } = await authService.register(req.body);
  setRefreshCookie(res, refreshToken, 30);
  res.status(201).json({ user, accessToken });
});

const login = asyncHandler(async (req, res) => {
  const { user, accessToken, refreshToken } = await authService.login(req.body);
  setRefreshCookie(res, refreshToken, 30);
  res.status(200).json({ user, accessToken });
});

const refresh = asyncHandler(async (req, res) => {
  const { accessToken, refreshToken } = await authService.refresh(req.cookies?.[REFRESH_COOKIE]);
  setRefreshCookie(res, refreshToken, 30);
  res.status(200).json({ accessToken });
});

const logout = asyncHandler(async (req, res) => {
  await authService.logout(req.cookies?.[REFRESH_COOKIE]);
  res.clearCookie(REFRESH_COOKIE, COOKIE_OPTIONS);
  res.status(204).send();
});

const me = asyncHandler(async (req, res) => {
  const user = await userRepository.findById(req.user.id);
  res.status(200).json({ user: { id: user.id, email: user.email, name: user.name, plan: user.plan } });
});

module.exports = { register, login, refresh, logout, me };
