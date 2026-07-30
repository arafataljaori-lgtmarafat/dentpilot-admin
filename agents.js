'use strict';
/* /api/agents  (Super Admin فقط)
   GET               -> قائمة الوكلاء + استهلاك اليوم لكل وكيل (تتضمّن رابط الدخول الدائم)
   POST   {..}       -> إنشاء وكيل (يُولَّد له رمز دخول دائم AGT_... تلقائياً)
   PATCH  {id,..}    -> تعديل وكيل (إيقاف/تفعيل، تغيير الحد، وإصدار رابط جديد عبر regenerate_token)
   DELETE {id}       -> حذف وكيل
   ملاحظة: نظام اسم المستخدم/كلمة المرور للوكيل باقٍ في القاعدة كما هو (لم يُحذف)،
   لكن بوابة الوكيل لم تعد تستخدمه — الدخول أصبح عبر رابط الدعوة الدائم فقط. */
const { ok, bad, readJson, handleOptions } = require('./_lib/util');
const { requireAdmin } = require('./_lib/guard');
const { hashPassword, generateAgentToken } = require('./_lib/auth');
const db = require('./_lib/db');

function pub(u, usedToday) {
  const limit = u.daily_limit == null ? null : Number(u.daily_limit);
  return {
    id: u.id, name: u.name, username: u.username, phone: u.phone,
    daily_limit: limit, active: u.active !== false,
    last_active_at: u.last_active_at || null, created_at: u.created_at || null,
    used_today: usedToday == null ? undefined : usedToday,
    remaining_today: (limit == null || usedToday == null) ? null : Math.max(0, limit - usedToday),
    agent_token: u.agent_token || null,
    portal_path: u.agent_token ? ('/agent?key=' + u.agent_token) : null,
  };
}

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    if (req.method === 'GET') {
      const agents = await db.listUsers({ role: 'agent' });
      const out = [];
      for (const a of agents) {
        // إصلاح ذاتي: وكيل قديم بلا رمز رابط (أُنشئ قبل إضافة الميزة) → ولّد له رمزاً واحفظه.
        if (!a.agent_token) {
          try {
            const updated = await db.updateUser(a.id, { agent_token: generateAgentToken() });
            if (updated && updated.agent_token) a.agent_token = updated.agent_token;
          } catch (e) { /* في حال عمود agent_token غير موجود بعد: نتجاهل ونُبلغ لاحقاً */ }
        }
        const used = await db.countCodesToday(a.id);
        out.push(pub(a, used));
      }
      return ok(res, { agents: out });
    }

    if (req.method === 'POST') {
      const b = await readJson(req);
      const name = String(b.name || '').trim();
      const username = String(b.username || '').trim().toLowerCase();
      const password = String(b.password || '');
      const phone = String(b.phone || '').trim();
      let daily = parseInt(b.daily_limit, 10); if (!Number.isFinite(daily) || daily < 0) daily = 10;
      if (!name) return bad(res, 'اسم الوكيل مطلوب');
      if (!/^[a-z0-9_.]{3,32}$/.test(username)) return bad(res, 'اسم المستخدم: 3–32 حرفاً لاتينياً/أرقاماً/(_ .)');
      if (password.length < 6) return bad(res, 'كلمة المرور يجب ألا تقل عن 6 أحرف');
      const exists = await db.getUserByUsername(username);
      if (exists) return bad(res, 'اسم المستخدم مستخدم بالفعل', 409);

      const { salt, hash } = hashPassword(password);
      const user = await db.insertUser({
        role: 'agent', name, username, phone,
        password_salt: salt, password_hash: hash,
        daily_limit: daily, active: true, last_active_at: null,
        agent_token: generateAgentToken(),
      });
      return ok(res, { agent: pub(user, 0) });
    }

    if (req.method === 'PATCH') {
      const b = await readJson(req);
      const id = String(b.id || '');
      if (!id) return bad(res, 'المعرّف مطلوب');
      const target = await db.getUserById(id);
      if (!target || target.role !== 'agent') return bad(res, 'الوكيل غير موجود', 404);

      const patch = {};
      if (typeof b.name === 'string' && b.name.trim()) patch.name = b.name.trim();
      if (typeof b.phone === 'string') patch.phone = b.phone.trim();
      if (b.daily_limit !== undefined) { const d = parseInt(b.daily_limit, 10); if (Number.isFinite(d) && d >= 0) patch.daily_limit = d; }
      if (b.active !== undefined) patch.active = !!b.active;
      if (typeof b.username === 'string' && b.username.trim()) {
        const un = b.username.trim().toLowerCase();
        if (!/^[a-z0-9_.]{3,32}$/.test(un)) return bad(res, 'اسم مستخدم غير صالح');
        const other = await db.getUserByUsername(un);
        if (other && other.id !== id) return bad(res, 'اسم المستخدم مستخدم بالفعل', 409);
        patch.username = un;
      }
      if (typeof b.password === 'string' && b.password) {
        if (b.password.length < 6) return bad(res, 'كلمة المرور يجب ألا تقل عن 6 أحرف');
        const { salt, hash } = hashPassword(b.password);
        patch.password_salt = salt; patch.password_hash = hash;
      }
      if (b.regenerate_token === true) {
        // إصدار رابط دعوة جديد وإبطال الرابط القديم فوراً (مفيد إن تسرّب الرابط)
        patch.agent_token = generateAgentToken();
      }
      const updated = await db.updateUser(id, patch);
      const used = await db.countCodesToday(id);
      return ok(res, { agent: pub(updated, used) });
    }

    if (req.method === 'DELETE') {
      const b = await readJson(req);
      const id = String(b.id || '');
      if (!id) return bad(res, 'المعرّف مطلوب');
      const target = await db.getUserById(id);
      if (!target || target.role !== 'agent') return bad(res, 'الوكيل غير موجود', 404);
      await db.deleteUser(id);
      return ok(res, { deleted: id });
    }

    return bad(res, 'طريقة غير مدعومة', 405);
  } catch (e) {
    return bad(res, e.message || 'خطأ في الخادم', e.status || 500);
  }
};
