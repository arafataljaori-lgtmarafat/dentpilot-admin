'use strict';
/* المصادقة: تجزئة كلمات المرور (scrypt) + رموز جلسة موقّعة (HMAC).
   بدون أي مكتبات خارجية — تعتمد فقط على وحدة crypto المدمجة في Node. */
const crypto = require('crypto');

const AUTH_SECRET = process.env.AUTH_SECRET || 'dev-insecure-secret-change-me';
const TOKEN_TTL_SECONDS = 60 * 60 * 12; // 12 ساعة

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlJson(obj) { return b64url(JSON.stringify(obj)); }
function fromB64urlJson(str) {
  try { return JSON.parse(Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); }
  catch (e) { return null; }
}

// ---------- كلمات المرور ----------
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 32);
  return { salt: salt.toString('hex'), hash: hash.toString('hex') };
}
function verifyPassword(password, saltHex, hashHex) {
  try {
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(String(password), salt, expected.length);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch (e) { return false; }
}

// ---------- رموز الجلسة ----------
function sign(data) {
  return b64url(crypto.createHmac('sha256', AUTH_SECRET).update(data).digest());
}
function signToken(payload) {
  const body = { ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS };
  const p = b64urlJson(body);
  return p + '.' + sign(p);
}
function verifyToken(token) {
  if (!token || typeof token !== 'string' || token.indexOf('.') < 0) return null;
  const [p, sig] = token.split('.');
  if (!p || !sig) return null;
  const expected = sign(p);
  // مقارنة ثابتة الزمن
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const payload = fromB64urlJson(p);
  if (!payload || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

// ---------- رمز دخول الوكيل الدائم (رابط الدعوة) ----------
// نوع اعتماد مختلف عن رمز الجلسة المؤقّت (JWT): سرّ عشوائي دائم يُخزَّن
// في حساب الوكيل مباشرة، لا ينتهي تلقائياً، ويُستخدم كرابط دعوة مباشر.
const AGENT_TOKEN_PREFIX = 'AGT_';
function generateAgentToken() {
  return AGENT_TOKEN_PREFIX + crypto.randomBytes(24).toString('hex'); // 192-بت عشوائية
}
function isAgentToken(raw) { return typeof raw === 'string' && raw.indexOf(AGENT_TOKEN_PREFIX) === 0; }

// يستخرج المستخدم من ترويسة Authorization: Bearer <token>
function getAuth(req) {
  const h = req.headers['authorization'] || req.headers['Authorization'] || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (!m) return null;
  return verifyToken(m[1]);
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken, getAuth, TOKEN_TTL_SECONDS, generateAgentToken, isAgentToken, AGENT_TOKEN_PREFIX };
