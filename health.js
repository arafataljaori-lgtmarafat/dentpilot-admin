'use strict';
/* GET /api/health — تشخيص التهيئة والاتصال بقاعدة البيانات في الإنتاج.
   لا يكشف أي قيم سرّية (بوليان فقط) وآمن للاستدعاء قبل إنشاء أي حساب.
   استخدمه للتأكّد أن قاعدة البيانات مربوطة وأن الجداول موجودة والمفتاح صحيح. */
const { ok, sendJson, handleOptions, getQuery } = require('./_lib/util');
const db = require('./_lib/db');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  const deep = getQuery(req).deep === '1';
  const info = {
    service: 'DentPilot Admin',
    backend: db.backendKind,                 // supabase | file | unconfigured
    serverless: db.isServerless,
    env: { SUPABASE_URL: db.hasSupabaseUrl, SUPABASE_SERVICE_KEY: db.hasSupabaseKey, AUTH_SECRET: !!process.env.AUTH_SECRET },
    config_error: db.configError || null,
  };

  // إذا كانت التهيئة ناقصة على الإنتاج، أبلغ بوضوح
  if (db.backendKind === 'unconfigured') {
    return sendJson(res, 503, Object.assign({ status: 'error', db: 'not_configured', message: db.configError }, info));
  }

  // فحص اتصال حيّ بقاعدة البيانات
  try {
    await db.ping();
    let write = 'skipped (استخدم ?deep=1 لفحص الكتابة)';
    if (deep && typeof db.probeWrite === 'function') {
      try { await db.probeWrite(); write = 'ok'; }
      catch (we) {
        return sendJson(res, 502, Object.assign({ status: 'error', db: 'read_only',
          message: 'القراءة تعمل لكن الكتابة مرفوضة — غالباً تستخدم مفتاح anon بدل service_role في SUPABASE_SERVICE_KEY.',
          raw: we.message }, info));
      }
    } else if (deep) { write = 'ok'; }
    return ok(res, Object.assign({ status: 'ok', db: 'reachable', write }, info));
  } catch (e) {
    let hint = e.message || 'تعذّر الاتصال بقاعدة البيانات';
    if (/relation .* does not exist|could not find the table|PGRST205|42P01/i.test(hint)) {
      hint = 'الجداول غير موجودة. شغّل db/schema.sql في Supabase (SQL Editor).';
    } else if (/JWT|apikey|permission|401|row-level|RLS/i.test(hint)) {
      hint = 'مشكلة صلاحية: تأكّد أنك تستخدم مفتاح service_role (وليس anon) في SUPABASE_SERVICE_KEY.';
    }
    return sendJson(res, 502, Object.assign({ status: 'error', db: 'unreachable', message: hint, raw: e.message }, info));
  }
};
