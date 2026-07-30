'use strict';
/* /api/plans
   GET            -> الخطط الفعّالة (لأي مستخدم مسجّل: يحتاجها المولّد). ?all=1 للمالك: كل الخطط.
   POST  {..}     -> إنشاء خطة (المالك)
   PATCH {id,..}  -> تعديل خطة (المالك)
   DELETE {id}    -> حذف خطة (المالك)
   إضافة الخطة تظهر تلقائياً في مولّد الأكواد والتفعيل المباشر. */
const { ok, bad, forbidden, readJson, handleOptions, getQuery } = require('./_lib/util');
const { requireUser, requireAdmin } = require('./_lib/guard');
const { listPlans, pubPlan } = require('./_lib/plans');
const db = require('./_lib/db');

async function logAction(actor, action, details, planName) {
  try { await db.tInsert('admin_log', { action, details: details || null, plan_name: planName || null, actor_id: actor.id, actor_name: actor.name, created_at: new Date().toISOString() }); } catch (e) {}
}

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  try {
    const q = getQuery(req);

    if (req.method === 'GET') {
      const user = await requireUser(req, res); if (!user) return;
      const all = q.all === '1' && user.role === 'super_admin';
      const plans = await listPlans({ activeOnly: !all });
      return ok(res, { plans: plans.map(pubPlan) });
    }

    // الكتابة للمالك فقط
    const admin = await requireAdmin(req, res); if (!admin) return;

    if (req.method === 'POST') {
      const b = await readJson(req);
      const name = String(b.name || '').trim();
      if (!name) return bad(res, 'اسم الخطة مطلوب');
      let days = (b.days === null || b.days === '' || b.days === undefined) ? null : parseInt(b.days, 10);
      if (days != null && (!Number.isFinite(days) || days < 0)) return bad(res, 'عدد الأيام غير صالح');
      const sort = Number.isFinite(parseInt(b.sort, 10)) ? parseInt(b.sort, 10) : 99;
      const plan = await db.tInsert('plans', { name, days, active: b.active !== false, sort });
      await logAction(admin, 'plan_create', 'إنشاء خطة: ' + name, name);
      return ok(res, { plan: pubPlan(plan) });
    }

    if (req.method === 'PATCH') {
      const b = await readJson(req);
      const id = String(b.id || ''); if (!id) return bad(res, 'المعرّف مطلوب');
      const patch = {};
      if (typeof b.name === 'string' && b.name.trim()) patch.name = b.name.trim();
      if (b.days !== undefined) { patch.days = (b.days === null || b.days === '') ? null : parseInt(b.days, 10); if (patch.days != null && (!Number.isFinite(patch.days) || patch.days < 0)) return bad(res, 'عدد الأيام غير صالح'); }
      if (b.active !== undefined) patch.active = !!b.active;
      if (b.sort !== undefined && Number.isFinite(parseInt(b.sort, 10))) patch.sort = parseInt(b.sort, 10);
      const plan = await db.tUpdate('plans', id, patch);
      if (!plan) return bad(res, 'الخطة غير موجودة', 404);
      await logAction(admin, 'plan_update', 'تعديل خطة: ' + plan.name, plan.name);
      return ok(res, { plan: pubPlan(plan) });
    }

    if (req.method === 'DELETE') {
      const b = await readJson(req);
      const id = String(b.id || ''); if (!id) return bad(res, 'المعرّف مطلوب');
      const plan = await db.tGet('plans', id);
      await db.tDelete('plans', id);
      await logAction(admin, 'plan_delete', 'حذف خطة: ' + (plan ? plan.name : id), plan && plan.name);
      return ok(res, { deleted: id });
    }

    return bad(res, 'طريقة غير مدعومة', 405);
  } catch (e) {
    return bad(res, e.message || 'خطأ في الخادم', e.status || 500);
  }
};
