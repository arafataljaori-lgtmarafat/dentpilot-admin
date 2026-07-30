'use strict';
/* /api/agent-generate  (عام تماماً — بلا مفتاح، بلا توكن، بلا حماية)
   يولّد كود تفعيل بنفس الخوارزمية الحالية ويسجّله في نفس جدول codes الحالي
   (agent_id = null)، فيظهر مباشرة في لوحة التحكم. لا قاعدة بيانات جديدة.

   التحكّم بالاستخدام عبر متغيّرات بيئة (Netlify) — ليست تعديلاً على قاعدة البيانات:
     AGENT_PAGE_ENABLED      = false/0  لإيقاف الخدمة (الافتراضي: مفعّلة)
     AGENT_PAGE_DAILY_LIMIT  = عدد      الحد اليومي الإجمالي (الافتراضي 0 = بلا حد)
   «المُستخدم اليوم» يُحسب من نفس جدول codes (agent_id = null) — قراءة فقط.

   GET  -> حالة الخدمة { enabled, daily_limit, used_today, remaining }
   POST -> { device_id, app? }  توليد كود */
const { ok, bad, readJson, handleOptions } = require('./_lib/util');
const { APPS, generateCode, inspectDevice, _nrm } = require('./_lib/license');
const db = require('./_lib/db');

function isEnabled() {
  const v = String(process.env.AGENT_PAGE_ENABLED == null ? 'true' : process.env.AGENT_PAGE_ENABLED).trim().toLowerCase();
  return !(v === 'false' || v === '0' || v === 'off' || v === 'no');
}
function dailyLimit() {
  const n = parseInt(process.env.AGENT_PAGE_DAILY_LIMIT || '0', 10);
  return Number.isFinite(n) && n > 0 ? n : 0; // 0 = بلا حد
}

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  try {
    const enabled = isEnabled();
    const limit = dailyLimit();

    if (req.method === 'GET') {
      let used = 0;
      try { used = await db.countPublicCodesToday(); } catch (e) { used = 0; }
      return ok(res, { enabled, daily_limit: limit, used_today: used, remaining: limit ? Math.max(0, limit - used) : null });
    }
    if (req.method !== 'POST') return bad(res, 'طريقة غير مدعومة', 405);

    if (!enabled) return bad(res, 'خدمة توليد الأكواد موقوفة حالياً. حاول لاحقاً أو تواصل مع الإدارة.', 503);

    const body = await readJson(req);
    const deviceRaw = String(body.device_id || '').trim();
    const app = String(body.app || 'student').trim();
    const label = (String(body.name || '').trim().slice(0, 60)) || 'صفحة عامة';

    if (!APPS[app]) return bad(res, 'تطبيق غير صحيح');
    const info = inspectDevice(deviceRaw);
    if (!info.valid) return bad(res, info.reason || 'معرّف جهاز غير صالح');
    if (info.app !== app) {
      return bad(res, 'هذا المعرّف يخص ' + (APPS[info.app] ? APPS[info.app].label : info.app) + '، والصفحة مخصّصة لـ ' + APPS[app].label + '.');
    }

    // الحد اليومي الإجمالي (يُحسب من نفس جدول codes)
    if (limit) {
      const used = await db.countPublicCodesToday();
      if (used >= limit) return bad(res, 'تم بلوغ الحد اليومي لتوليد الأكواد. يرجى المحاولة غداً أو التواصل مع الإدارة.', 429);
    }

    const code = generateCode(app, deviceRaw); // نفس الخوارزمية الحالية
    if (!code) return bad(res, 'تعذّر توليد الكود');

    const record = await db.insertCode({
      code, device_id: deviceRaw.toUpperCase(), device_id_norm: _nrm(deviceRaw),
      app, duration: 'lifetime', agent_id: null, agent_name: label, status: 'active',
    });

    return ok(res, { code, device_id: (record && record.device_id) || deviceRaw.toUpperCase(), app, app_label: APPS[app].label });
  } catch (e) {
    return bad(res, e.message || 'خطأ في الخادم', e.status || 500);
  }
};
