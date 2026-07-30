'use strict';
/* POST /api/login  { username, password } -> { token, user } */
const { ok, bad, unauthorized, readJson, handleOptions } = require('./_lib/util');
const { verifyPassword, signToken } = require('./_lib/auth');
const db = require('./_lib/db');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return bad(res, 'طريقة غير مدعومة', 405);
  try {
    const body = await readJson(req);
    const username = String(body.username || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!username || !password) return bad(res, 'أدخل اسم المستخدم وكلمة المرور');

    const user = await db.getUserByUsername(username);
    if (!user) return unauthorized(res, 'بيانات الدخول غير صحيحة');
    if (user.active === false) return bad(res, 'تم إيقاف هذا الحساب. تواصل مع الإدارة.', 403);
    if (!verifyPassword(password, user.password_salt, user.password_hash)) {
      return unauthorized(res, 'بيانات الدخول غير صحيحة');
    }

    await db.updateUser(user.id, { last_active_at: new Date().toISOString() });
    const token = signToken({ uid: user.id, role: user.role, name: user.name });
    return ok(res, {
      token,
      user: { id: user.id, role: user.role, name: user.name, username: user.username, phone: user.phone, daily_limit: user.daily_limit, active: user.active },
    });
  } catch (e) {
    return bad(res, e.message || 'خطأ في الخادم', e.status || 500);
  }
};
