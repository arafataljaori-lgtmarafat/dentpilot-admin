'use strict';
/* /api/codes
   GET  ?action=verify&device=DS-....   -> فحص معرّف الجهاز واكتشاف التطبيق (لأي مستخدم مسجّل)
   GET                                  -> قائمة الأكواد (المالك: الكل | الوكيل: أكواده فقط)
   POST { device_id, app, duration }    -> توليد كود (مع فرض الحد اليومي)
   PATCH { id, status }                 -> تغيير حالة الكود active|revoked (المالك فقط) */
const { ok, bad, forbidden, readJson, handleOptions, getQuery } = require('./_lib/util');
const { requireUser } = require('./_lib/guard');
const { APPS, DURATIONS, generateCode, inspectDevice, _nrm } = require('./_lib/license');
const { getPlan, endDateFrom } = require('./_lib/plans');
const db = require('./_lib/db');

function pubCode(c) {
  return {
    id: c.id, code: c.code, device_id: c.device_id, app: c.app,
    app_label: (APPS[c.app] && APPS[c.app].label) || c.app,
    duration: c.duration, duration_label: c.plan_name || durationLabel(c.duration),
    plan_id: c.plan_id || null, plan_name: c.plan_name || null, end_at: c.end_at || null,
    agent_id: c.agent_id, agent_name: c.agent_name, status: c.status || 'active',
    created_at: c.created_at,
  };
}
function durationLabel(k) { const d = DURATIONS.find(x => x.key === k); return d ? d.label : (k || 'دائم (مدى الحياة)'); }

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const q = getQuery(req);

    // ---- فحص معرّف الجهاز ----
    if (req.method === 'GET' && q.action === 'verify') {
      const info = inspectDevice(q.device || '');
      if (info.app) info.app_label = APPS[info.app].label;
      return ok(res, info);
    }

    // ---- قائمة الأكواد ----
    if (req.method === 'GET') {
      const filter = user.role === 'agent' ? { agentId: user.id } : {};
      if (q.limit) filter.limit = q.limit;
      const codes = await db.listCodes(filter);
      return ok(res, { codes: codes.map(pubCode) });
    }

    // ---- توليد كود ----
    if (req.method === 'POST') {
      const b = await readJson(req);
      const deviceRaw = String(b.device_id || '').trim();
      const app = String(b.app || '').trim();
      let duration = String(b.duration || 'lifetime').trim();

      if (!APPS[app]) return bad(res, 'اختر تطبيقاً صحيحاً');

      // خطة ديناميكية (اختيارية) — إن مُرِّرت تُحدِّد الاسم والانتهاء؛ وإلا نُبقي السلوك القديم (lifetime).
      let plan = null, planName = null, endAt = null;
      if (b.plan_id) {
        plan = await getPlan(b.plan_id);
        if (!plan || plan.active === false) return bad(res, 'خطة غير صالحة');
        planName = plan.name; duration = 'plan';
        endAt = endDateFrom(new Date().toISOString(), plan.days);
      } else if (!DURATIONS.find(d => d.key === duration)) {
        return bad(res, 'مدة اشتراك غير مدعومة');
      }

      const info = inspectDevice(deviceRaw);
      if (!info.valid) return bad(res, info.reason || 'معرّف جهاز غير صالح');
      if (info.app !== app) {
        return bad(res, 'التطبيق المختار لا يطابق نوع الجهاز. هذا المعرّف يخص ' + APPS[info.app].label + '.');
      }

      // فرض الحد اليومي للوكلاء (من جهة الخادم)
      if (user.role === 'agent') {
        const limit = user.daily_limit == null ? null : Number(user.daily_limit);
        if (limit != null) {
          const used = await db.countCodesToday(user.id);
          if (used >= limit) {
            return forbidden(res, 'تم الوصول إلى الحد المسموح لإنشاء الأكواد. يرجى التواصل مع الإدارة.');
          }
        }
      }

      const code = generateCode(app, deviceRaw);
      if (!code) return bad(res, 'تعذّر توليد الكود');

      const record = await db.insertCode({
        code, device_id: deviceRaw.toUpperCase(), device_id_norm: _nrm(deviceRaw),
        app, duration, plan_id: plan ? plan.id : null, plan_name: planName, end_at: endAt,
        agent_id: user.id, agent_name: user.name, status: 'active',
      });
      await db.updateUser(user.id, { last_active_at: new Date().toISOString() });

      let usage = null;
      if (user.role === 'agent' && user.daily_limit != null) {
        const used = await db.countCodesToday(user.id);
        const limit = Number(user.daily_limit);
        usage = { limit, used, remaining: Math.max(0, limit - used) };
      }
      return ok(res, { code: pubCode(record), usage });
    }

    // ---- تغيير حالة الكود ----
    if (req.method === 'PATCH') {
      if (user.role !== 'super_admin') return forbidden(res, 'هذا الإجراء للمالك فقط');
      const b = await readJson(req);
      const id = String(b.id || '');
      const status = String(b.status || '');
      if (!id) return bad(res, 'المعرّف مطلوب');
      if (!['active', 'revoked'].includes(status)) return bad(res, 'حالة غير صالحة');
      const updated = await db.updateCode(id, { status });
      if (!updated) return bad(res, 'الكود غير موجود', 404);
      return ok(res, { code: pubCode(updated) });
    }

    return bad(res, 'طريقة غير مدعومة', 405);
  } catch (e) {
    return bad(res, e.message || 'خطأ في الخادم', e.status || 500);
  }
};
