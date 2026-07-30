'use strict';
const { verifyToken, isAgentToken } = require('./auth');
const { unauthorized, forbidden } = require('./util');
const db = require('./db');

function bearerToken(req) {
  const h = req.headers['authorization'] || req.headers['Authorization'] || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : null;
}

/**
 * يعيد المستخدم الحالي، أو يرسل 401 ويعيد null.
 * يقبل نوعين من الاعتماد في ترويسة Authorization: Bearer <token>:
 *   1) رمز جلسة موقّت (JWT) — تسجيل الدخول القياسي (المالك، ولاحقاً أي دخول بكلمة مرور).
 *   2) رمز وكيل دائم (AGT_...) — رابط دعوة الوكيل الثابت، بلا تسجيل دخول.
 * لا تغيير على منطق توليد الأكواد أو الحدود؛ فقط طريقة تحديد هوية الطالب.
 */
async function requireUser(req, res) {
  const raw = bearerToken(req);
  if (!raw) { unauthorized(res); return null; }

  let user = null;
  if (isAgentToken(raw)) {
    user = await db.getUserByAgentToken(raw);
    if (!user || user.role !== 'agent') { unauthorized(res, 'رابط الوكيل غير صالح أو منتهي.'); return null; }
  } else {
    const payload = verifyToken(raw);
    if (!payload || !payload.uid) { unauthorized(res); return null; }
    user = await db.getUserById(payload.uid);
    if (!user) { unauthorized(res, 'الجلسة غير صالحة'); return null; }
  }

  if (user.active === false) { forbidden(res, 'تم إيقاف هذا الحساب'); return null; }
  return user;
}

/** كسابقه لكن يشترط صلاحية super_admin. رمز وكيل (AGT_) لا يصل لهذه الدالة أبداً
    لأن role يكون 'agent' دائماً، فتُرفض تلقائياً — لا كشف لأي وظيفة إدارية. */
async function requireAdmin(req, res) {
  const user = await requireUser(req, res);
  if (!user) return null;
  if (user.role !== 'super_admin') { forbidden(res, 'هذه الصفحة مخصّصة للمالك فقط'); return null; }
  return user;
}

module.exports = { requireUser, requireAdmin };
