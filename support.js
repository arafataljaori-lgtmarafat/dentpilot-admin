'use strict';
/* /api/support  (Super Admin فقط) — مركز الدعم والتفعيل
   GET  ?q=...                                  -> بحث بالجهاز/الكود ويعرض حالة التفعيل
   POST {action:'activate', device_id, app, plan_id}   -> تفعيل مباشر (يُنشئ سجلاً + يُصدر الكود المربوط بالجهاز)
   POST {action:'extend', device_id, app, days}        -> تمديد الاشتراك
   POST {action:'change_plan', device_id, app, plan_id} -> تغيير الخطة
   POST {action:'suspend'|'reactivate', device_id, app} -> إيقاف/إعادة تفعيل
   لا يمسّ نظام الأكواد الحالي: التفعيل المباشر يُصدر نفس الكود المربوط بالجهاز (متوافق). */
const { ok, bad, readJson, handleOptions, getQuery } = require('./_lib/util');
const { requireAdmin } = require('./_lib/guard');
const { APPS, generateCode, inspectDevice, _nrm } = require('./_lib/license');
const { getPlan, pubPlan } = require('./_lib/plans');
const db = require('./_lib/db');

function appLabel(a) { return (APPS[a] && APPS[a].label) || a; }
function effectiveStatus(a) {
  if (!a) return null;
  if (a.status === 'suspended') return 'suspended';
  if (a.status === 'trial') return 'trial';
  if (a.end_at && new Date(a.end_at).getTime() < Date.now()) return 'expired';
  return 'active';
}
function pub(a) {
  return {
    id: a.id, device_id: a.device_id, device_id_norm: a.device_id_norm,
    app: a.app, app_label: appLabel(a.app),
    plan_id: a.plan_id || null, plan_name: a.plan_name || null,
    status: a.status, effective_status: effectiveStatus(a),
    start_at: a.start_at || null, end_at: a.end_at || null,
    source: a.source || 'direct', code: a.code || null,
    actor_name: a.actor_name || null, created_at: a.created_at, updated_at: a.updated_at || a.created_at,
  };
}
async function log(actor, action, a, details) {
  try {
    await db.tInsert('admin_log', {
      action, device_id: a && a.device_id, app: a && a.app, plan_name: a && a.plan_name,
      details: details || null, actor_id: actor.id, actor_name: actor.name, created_at: new Date().toISOString(),
    });
  } catch (e) {}
}
function findActivation(norm, app) {
  return db.tFindOne('device_activations', [{ col: 'device_id_norm', op: 'eq', val: norm }, { col: 'app', op: 'eq', val: app }]);
}

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  try {
    const admin = await requireAdmin(req, res); if (!admin) return;

    /* ---------------- بحث ---------------- */
    if (req.method === 'GET') {
      const q = String((getQuery(req).q || '')).trim();
      if (!q) return ok(res, { results: [] });
      const norm = _nrm(q);
      const results = [];
      const seen = new Set();

      // 1) في جدول التفعيلات المباشرة
      const acts = await db.tList('device_activations', {});
      for (const a of acts) {
        if ((a.device_id_norm || '').includes(norm) || (a.code && _nrm(a.code) === norm)) {
          const key = a.device_id_norm + '|' + a.app; if (seen.has(key)) continue; seen.add(key);
          results.push(pub(a));
        }
      }
      // 2) في جدول الأكواد الحالي (تفعيلات صادرة عبر الكود) — تُعرض للقراءة إن لم تكن مسجّلة بالأعلى
      const codes = await db.listCodes({});
      for (const c of codes) {
        if ((c.device_id_norm || '').includes(norm) || _nrm(c.code) === norm) {
          const key = (c.device_id_norm || '') + '|' + c.app; if (seen.has(key)) continue; seen.add(key);
          results.push({
            id: null, device_id: c.device_id, device_id_norm: c.device_id_norm, app: c.app, app_label: appLabel(c.app),
            plan_id: null, plan_name: c.duration_label || 'دائم (مدى الحياة)',
            status: c.status === 'revoked' ? 'suspended' : 'active', effective_status: c.status === 'revoked' ? 'suspended' : 'active',
            start_at: c.created_at, end_at: null, source: 'code', code: c.code,
            actor_name: c.agent_name || null, created_at: c.created_at, updated_at: c.created_at,
          });
        }
      }
      return ok(res, { results });
    }

    /* ---------------- إجراءات ---------------- */
    const b = await readJson(req);
    const action = String(b.action || '');
    const deviceRaw = String(b.device_id || '').trim();
    const app = String(b.app || '').trim();
    if (!APPS[app]) return bad(res, 'اختر تطبيقاً صحيحاً');
    const norm = _nrm(deviceRaw);
    if (!norm) return bad(res, 'أدخل معرّف الجهاز');

    if (action === 'activate') {
      const info = inspectDevice(deviceRaw);
      if (!info.valid) return bad(res, info.reason || 'معرّف جهاز غير صالح');
      if (info.app !== app) return bad(res, 'التطبيق المختار لا يطابق نوع الجهاز. هذا المعرّف يخص ' + appLabel(info.app) + '.');
      const plan = await getPlan(b.plan_id);
      if (!plan) return bad(res, 'اختر خطة صحيحة');
      const now = new Date().toISOString();
      const days = plan.days == null ? null : Number(plan.days);
      const end = days == null ? null : new Date(Date.now() + days * 86400000).toISOString();
      const code = generateCode(app, deviceRaw); // نفس الكود المربوط بالجهاز (متوافق مع التطبيق الحالي)

      const existing = await findActivation(norm, app);
      const row = {
        device_id: deviceRaw.toUpperCase(), device_id_norm: norm, app,
        plan_id: plan.id, plan_name: plan.name, status: 'active',
        start_at: now, end_at: end, source: 'direct', code,
        actor_id: admin.id, actor_name: admin.name, updated_at: now,
      };
      let saved;
      if (existing) saved = await db.tUpdate('device_activations', existing.id, row);
      else saved = await db.tInsert('device_activations', row);
      await log(admin, 'activate', saved, 'تفعيل مباشر — الخطة: ' + plan.name);
      return ok(res, { activation: pub(saved), code });
    }

    // بقية الإجراءات تتطلّب سجلاً قائماً
    const existing = await findActivation(norm, app);
    if (!existing) return bad(res, 'لا يوجد سجل تفعيل لهذا الجهاز. استخدم «تفعيل مباشر» أولاً.', 404);

    if (action === 'extend') {
      const days = parseInt(b.days, 10);
      if (!Number.isFinite(days) || days <= 0) return bad(res, 'عدد أيام غير صالح');
      if (existing.end_at == null) return bad(res, 'الاشتراك مدى الحياة (بلا انتهاء) — لا حاجة للتمديد.');
      const base = Math.max(Date.now(), new Date(existing.end_at).getTime());
      const end = new Date(base + days * 86400000).toISOString();
      const saved = await db.tUpdate('device_activations', existing.id, { end_at: end, status: 'active', updated_at: new Date().toISOString() });
      await log(admin, 'extend', saved, 'تمديد ' + days + ' يوم');
      return ok(res, { activation: pub(saved) });
    }

    if (action === 'change_plan') {
      const plan = await getPlan(b.plan_id);
      if (!plan) return bad(res, 'اختر خطة صحيحة');
      const start = existing.start_at || new Date().toISOString();
      const days = plan.days == null ? null : Number(plan.days);
      const end = days == null ? null : new Date(new Date(start).getTime() + days * 86400000).toISOString();
      const saved = await db.tUpdate('device_activations', existing.id, { plan_id: plan.id, plan_name: plan.name, end_at: end, status: 'active', updated_at: new Date().toISOString() });
      await log(admin, 'change_plan', saved, 'تغيير الخطة إلى: ' + plan.name);
      return ok(res, { activation: pub(saved) });
    }

    if (action === 'suspend') {
      const saved = await db.tUpdate('device_activations', existing.id, { status: 'suspended', updated_at: new Date().toISOString() });
      await log(admin, 'suspend', saved, 'إيقاف التفعيل');
      return ok(res, { activation: pub(saved) });
    }

    if (action === 'reactivate') {
      const saved = await db.tUpdate('device_activations', existing.id, { status: 'active', updated_at: new Date().toISOString() });
      await log(admin, 'reactivate', saved, 'إعادة التفعيل');
      return ok(res, { activation: pub(saved) });
    }

    return bad(res, 'إجراء غير معروف');
  } catch (e) {
    return bad(res, e.message || 'خطأ في الخادم', e.status || 500);
  }
};
