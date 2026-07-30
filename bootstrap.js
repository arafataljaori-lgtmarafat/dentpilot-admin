'use strict';
/* GET  /api/bootstrap  -> { needsSetup: bool, backend }
   POST /api/bootstrap  -> إنشاء حساب Super Admin (مرّة واحدة فقط) */
const { ok, bad, readJson, handleOptions } = require('./_lib/util');
const { hashPassword, signToken } = require('./_lib/auth');
const db = require('./_lib/db');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  try {
    const admins = await db.listUsers({ role: 'super_admin' });
    const needsSetup = admins.length === 0;

    if (req.method === 'GET') {
      return ok(res, { needsSetup, backend: db.backendKind });
    }
    if (req.method === 'POST') {
      if (!needsSetup) return bad(res, 'تم إنشاء حساب المالك مسبقاً. سجّل الدخول.', 409);
      const body = await readJson(req);
      const name = String(body.name || '').trim();
      const username = String(body.username || '').trim().toLowerCase();
      const password = String(body.password || '');
      const phone = String(body.phone || '').trim();
      if (!name) return bad(res, 'الاسم مطلوب');
      if (!/^[a-z0-9_.]{3,32}$/.test(username)) return bad(res, 'اسم المستخدم: 3–32 حرفاً لاتينياً/أرقاماً/(_ .)');
      if (password.length < 8) return bad(res, 'كلمة المرور يجب ألا تقل عن 8 أحرف');

      const { salt, hash } = hashPassword(password);
      const user = await db.insertUser({
        role: 'super_admin', name, username, phone,
        password_salt: salt, password_hash: hash,
        daily_limit: null, active: true, last_active_at: new Date().toISOString(),
      });
      const token = signToken({ uid: user.id, role: user.role, name: user.name });
      return ok(res, { token, user: publicUser(user) });
    }
    return bad(res, 'طريقة غير مدعومة', 405);
  } catch (e) {
    return bad(res, e.message || 'خطأ في الخادم', e.status || 500);
  }
};

function publicUser(u) {
  return { id: u.id, role: u.role, name: u.name, username: u.username, phone: u.phone,
    daily_limit: u.daily_limit, active: u.active };
}
