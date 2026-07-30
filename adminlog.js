'use strict';
/* GET /api/adminlog  (Super Admin) — سجل عمليات الإدارة (أحدثها أولاً) */
const { ok, bad, handleOptions, getQuery } = require('./_lib/util');
const { requireAdmin } = require('./_lib/guard');
const { APPS } = require('./_lib/license');
const db = require('./_lib/db');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') return bad(res, 'طريقة غير مدعومة', 405);
  try {
    const admin = await requireAdmin(req, res); if (!admin) return;
    const limit = parseInt(getQuery(req).limit, 10) || 50;
    const rows = await db.tList('admin_log', { order: 'created_at.desc', limit });
    const logs = rows.map((r) => ({
      id: r.id, action: r.action, device_id: r.device_id || null,
      app: r.app || null, app_label: r.app ? ((APPS[r.app] && APPS[r.app].label) || r.app) : null,
      plan_name: r.plan_name || null, details: r.details || null,
      actor_name: r.actor_name || null, created_at: r.created_at,
    }));
    return ok(res, { logs });
  } catch (e) {
    return bad(res, e.message || 'خطأ في الخادم', e.status || 500);
  }
};
