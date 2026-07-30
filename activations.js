'use strict';
/* GET /api/activations  (Super Admin) — التفعيلات مشتقّة من الأكواد.
   يُجمّع الأكواد حسب (الجهاز + التطبيق) لعرض الأجهزة المُفعّلة.
   ملاحظة: التطبيقات تعمل دون إنترنت، لذا لا يمكن للوحة معرفة ما إذا
   استُخدم الكود فعلياً على الجهاز؛ نعتبر كل كود مُنشأ منحةَ تفعيل لجهاز. */
const { ok, bad, handleOptions } = require('./_lib/util');
const { requireAdmin } = require('./_lib/guard');
const { APPS } = require('./_lib/license');
const db = require('./_lib/db');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') return bad(res, 'طريقة غير مدعومة', 405);
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const codes = await db.listCodes({});
    const map = new Map();
    for (const c of codes) {
      const key = (c.device_id_norm || c.device_id || '') + '|' + c.app;
      if (!map.has(key)) {
        map.set(key, {
          device_id: c.device_id, app: c.app,
          app_label: (APPS[c.app] && APPS[c.app].label) || c.app,
          activated_at: c.created_at, latest_at: c.created_at,
          latest_status: c.status || 'active', codes_count: 1,
          agent_name: c.agent_name || null,
        });
      } else {
        const e = map.get(key);
        e.codes_count += 1;
        if (String(c.created_at) < String(e.activated_at)) e.activated_at = c.created_at;
        if (String(c.created_at) > String(e.latest_at)) { e.latest_at = c.created_at; e.latest_status = c.status || 'active'; e.agent_name = c.agent_name || e.agent_name; }
      }
    }
    const activations = Array.from(map.values()).sort((a, b) => String(b.latest_at).localeCompare(String(a.latest_at)));
    return ok(res, { activations });
  } catch (e) {
    return bad(res, e.message || 'خطأ في الخادم', e.status || 500);
  }
};
