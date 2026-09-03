const crypto = require('crypto');
const auth = require('../config/dashboard-auth.json');

const COOKIE_NAME = 'perda_receita_session';
const SESSION_SECONDS = 12 * 60 * 60;

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sign(value) {
  return crypto
    .createHmac('sha256', auth.sessionSecret)
    .update(value)
    .digest('base64url');
}

function createSession(username) {
  const payload = Buffer.from(JSON.stringify({
    sub: username,
    exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
  })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => {
    const index = part.indexOf('=');
    if (index < 0) return ['', ''];
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter(([key]) => key));
}

function verifySession(req) {
  try {
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    if (!token) return false;
    const [payload, signature] = token.split('.');
    if (!payload || !signature || !safeEqual(signature, sign(payload))) return false;
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return session.sub === auth.user && session.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function sessionCookie(token) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`;
}

function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

module.exports = {
  clearSessionCookie,
  createSession,
  safeEqual,
  sessionCookie,
  verifySession,
};
