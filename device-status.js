'use strict';
/* GET /api/device-status?device=DS-...&app=student   (عام، للقراءة فقط)
   يعيد حالة تفعيل الجهاز من الخادم. هذه هي النقطة التي يمكن للتطبيق (بعد تحديث
   بسيط لمرّة واحدة) أن يستعلم منها ليعمل بلا إدخال كود ويحترم الانتهاء/الإيقاف.

   ملاحظة: التطبيقات الحالية لا تستدعي هذه النقطة (تحقّقها محلّي بالكامل)، لذا لا
   يتغيّر سلوكها إطلاقاً حتى تُحدَّث. الرمز المُعاد مشتقّ من الجهاز أصلاً (غير سرّي). */
const { ok, bad, handleOptions, getQuery } = require('./_lib/util');
const { APPS, generateCode, inspectDevice, _nrm } = require('./_lib/license');
const db = require('./_lib/db');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') return bad(res, 'طريقة غير مدعومة', 405);
  try {
    const q = getQuery(req);
    const deviceRaw = String(q.device || '').trim();
    let app = String(q.app || '').trim();
    if (!deviceRaw) return bad(res, 'device مطلوب');

    const info = inspectDevice(deviceRaw);
    if (!app && info.app) app = info.app;             // اكتشاف التطبيق من البادئة إن لم يُمرّر
    if (!APPS[app]) return bad(res, 'app غير معروف (student/clinic)');

    const norm = _nrm(deviceRaw);
    const a = await db.tFindOne('device_activations', [{ col: 'device_id_norm', op: 'eq', val: norm }, { col: 'app', op: 'eq', val: app }]);

    if (!a) {
      return ok(res, { device_id: deviceRaw.toUpperCase(), app, activated: false, status: 'none' });
    }

    let status = a.status;
    if (status !== 'suspended' && a.end_at && new Date(a.end_at).getTime() < Date.now()) status = 'expired';
    const activated = status === 'active';

    return ok(res, {
      device_id: a.device_id, app, activated,
      status,                                    // active | expired | suspended
      plan: a.plan_name || null,
      start_at: a.start_at || null,
      end_at: a.end_at || null,                  // null = مدى الحياة
      // الكود المربوط بالجهاز (يتيح للتطبيق المُحدَّث التفعيل تلقائياً دون إدخال يدوي)
      code: activated ? (a.code || generateCode(app, deviceRaw)) : null,
    });
  } catch (e) {
    return bad(res, e.message || 'خطأ في الخادم', e.status || 500);
  }
};
