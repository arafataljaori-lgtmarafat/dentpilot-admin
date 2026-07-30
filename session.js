'use strict';
/* GET /api/session -> { user, usage } — بيانات المستخدم الحالي واستهلاكه اليومي */
const { ok, bad, handleOptions } = require('./_lib/util');
const { requireUser } = require('./_lib/guard');
const db = require('./_lib/db');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') return bad(res, 'طريقة غير مدعومة', 405);
  try {
    const user = await requireUser(req, res);
    if (!user) return;

    let usage = null;
    if (user.role === 'agent') {
      const usedToday = await db.countCodesToday(user.id);
      const limit = Number.isFinite(user.daily_limit) ? user.daily_limit : (user.daily_limit == null ? null : Number(user.daily_limit));
      usage = { limit: limit, used: usedToday, remaining: limit == null ? null : Math.max(0, limit - usedToday) };
    }
    return ok(res, {
      user: { id: user.id, role: user.role, name: user.name, username: user.username, phone: user.phone, daily_limit: user.daily_limit, active: user.active },
      usage,
      backend: db.backendKind,
    });
  } catch (e) {
    return bad(res, e.message || 'خطأ في الخادم', e.status || 500);
  }
};
