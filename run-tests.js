'use strict';
/* ============================================================
   اختبارات شاملة (بدون شبكة) — تشغّل دوال /api الحقيقية على
   قاعدة بيانات ملفّية معزولة، وتتحقّق من مطابقة الأكواد لخوارزمية
   التطبيقات الأصلية. التشغيل:  node test/run-tests.js
   ============================================================ */
const os = require('os');
const path = require('path');
const fs = require('fs');

// عزل قاعدة البيانات في مجلّد مؤقّت + سرّ ثابت للاختبار
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-admin-test-'));
process.chdir(TMP);
process.env.AUTH_SECRET = 'test-secret-fixed';
delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_KEY;

const ROOT = path.resolve(__dirname, '..');
const bootstrap = require(path.join(ROOT, 'api/bootstrap.js'));
const login = require(path.join(ROOT, 'api/login.js'));
const session = require(path.join(ROOT, 'api/session.js'));
const agents = require(path.join(ROOT, 'api/agents.js'));
const codes = require(path.join(ROOT, 'api/codes.js'));
const stats = require(path.join(ROOT, 'api/stats.js'));
const lic = require(path.join(ROOT, 'api/_lib/license.js'));

let PASS = 0, FAIL = 0;
function ok(name, cond, extra) {
  if (cond) { PASS++; console.log('  ✓ ' + name); }
  else { FAIL++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}
function mockRes() {
  return { statusCode: 200, headers: {}, _data: '',
    setHeader(k, v) { this.headers[k] = v; }, end(d) { this._data = d || ''; },
    json() { try { return JSON.parse(this._data); } catch (e) { return null; } } };
}
async function call(handler, { method = 'GET', url = '/', body, token } = {}) {
  const req = { method, url, headers: token ? { authorization: 'Bearer ' + token } : {}, body };
  const res = mockRes();
  await handler(req, res);
  return { status: res.statusCode, body: res.json() };
}

(async function run() {
  console.log('\n== DentPilot Admin — اختبارات شاملة ==');
  console.log('قاعدة بيانات الاختبار: ' + path.join(TMP, '.data/db.json') + '\n');

  // 1) حالة الإعداد قبل الإنشاء
  let r = await call(bootstrap, { method: 'GET' });
  ok('1. النظام يحتاج إعداداً في البداية', r.body && r.body.needsSetup === true);

  // 2) إنشاء المالك
  r = await call(bootstrap, { method: 'POST', body: { name: 'المالك', username: 'owner', password: 'ownerpass123', phone: '+966500000000' } });
  ok('2. إنشاء Super Admin ينجح ويعيد رمزاً', r.status === 200 && !!(r.body && r.body.token));
  const adminToken = r.body.token;

  // 3) لا يمكن إنشاء مالك ثانٍ
  r = await call(bootstrap, { method: 'GET' });
  ok('3. بعد الإنشاء لا يظهر الإعداد ثانية', r.body && r.body.needsSetup === false);
  r = await call(bootstrap, { method: 'POST', body: { name: 'x', username: 'y', password: 'zzzzzzzz' } });
  ok('   منع إنشاء مالك ثانٍ', r.status === 409);

  // 4) دخول المالك
  r = await call(login, { method: 'POST', body: { username: 'owner', password: 'ownerpass123' } });
  ok('4. تسجيل دخول المالك ينجح', r.status === 200 && r.body.user.role === 'super_admin');
  r = await call(login, { method: 'POST', body: { username: 'owner', password: 'wrong' } });
  ok('   رفض كلمة مرور خاطئة', r.status === 401);

  // 5) إنشاء وكيل (حد يومي 2 لاختبار الحد لاحقاً)
  r = await call(agents, { method: 'POST', token: adminToken, body: { name: 'وكيل الرياض', username: 'agent1', password: 'agentpass', daily_limit: 2 } });
  ok('5. إنشاء وكيل ينجح', r.status === 200 && r.body.agent.username === 'agent1');
  const agentId = r.body.agent.id;

  // 6) دخول الوكيل
  r = await call(login, { method: 'POST', body: { username: 'agent1', password: 'agentpass' } });
  ok('6. دخول الوكيل ينجح', r.status === 200 && r.body.user.role === 'agent');
  const agentToken = r.body.token;

  // 7) منع الوكيل من لوحة المالك
  r = await call(agents, { method: 'GET', token: agentToken });
  ok('7. منع الوكيل من صفحة الوكلاء (403)', r.status === 403);
  r = await call(stats, { method: 'GET', token: agentToken });
  ok('   منع الوكيل من الإحصاءات (403)', r.status === 403);

  // 8) فحص معرّف جهاز صحيح
  const studentDevice = 'DS-ABCD-1234-WXYZ';
  r = await call(codes, { method: 'GET', url: '/api/codes?action=verify&device=' + encodeURIComponent(studentDevice), token: agentToken });
  ok('8. فحص معرّف Student صحيح واكتشاف التطبيق', r.body && r.body.valid === true && r.body.app === 'student');

  // 9) توليد كود Student ومطابقته لخوارزمية التطبيق
  r = await call(codes, { method: 'POST', token: agentToken, body: { device_id: studentDevice, app: 'student', duration: 'lifetime' } });
  ok('9. توليد كود Student ينجح', r.status === 200 && !!r.body.code);
  const studentCode = r.body.code.code;
  ok('   الكود مطابق لخوارزمية التطبيق (licenseForStudent)', studentCode === lic.licenseForStudent(studentDevice), studentCode);

  // 10) محاكاة تحقّق التطبيق: licenseValid = تطبيع الكود يساوي الناتج
  const appWouldAccept = lic._nrm(studentCode) === lic._nrm(lic.licenseForStudent(studentDevice));
  ok('10. الكود يُقبَل داخل تطبيق Student', appWouldAccept);

  // 11) توليد كود Clinic ومطابقته
  const clinicDevice = 'DP-9F2K-77QT-MMNN';
  r = await call(codes, { method: 'POST', token: agentToken, body: { device_id: clinicDevice, app: 'clinic', duration: 'lifetime' } });
  ok('11. توليد كود Clinic ينجح', r.status === 200 && !!r.body.code);
  const clinicCode = r.body.code && r.body.code.code;
  ok('    الكود مطابق لخوارزمية Clinic (licenseForClinic)', clinicCode === lic.licenseForClinic(clinicDevice), clinicCode);
  ok('    خوارزميتا Student و Clinic تُنتجان أكواداً مختلفة', lic.licenseForStudent(clinicDevice) !== lic.licenseForClinic(clinicDevice));

  // 12) عدم تطابق التطبيق مع الجهاز
  r = await call(codes, { method: 'POST', token: agentToken, body: { device_id: studentDevice, app: 'clinic', duration: 'lifetime' } });
  ok('12. رفض توليد كود لتطبيق لا يطابق نوع الجهاز', r.status === 400);

  // 13) فرض الحد اليومي (الحد=2؛ استُهلك 2 بنجاح، الثالث يُرفض)
  //   ملاحظة: العمليتان الناجحتان أعلاه (Student + Clinic) استهلكتا الحد.
  r = await call(codes, { method: 'POST', token: agentToken, body: { device_id: 'DS-2345-6789-ABCD', app: 'student', duration: 'lifetime' } });
  ok('13. تجاوز الحد اليومي يُرفض (403)', r.status === 403 && /الحد/.test(r.body.error || ''));

  // 14) الجلسة تعكس الاستهلاك
  r = await call(session, { method: 'GET', token: agentToken });
  ok('14. جلسة الوكيل تعرض الحد والاستهلاك', r.body.usage && r.body.usage.limit === 2 && r.body.usage.used === 2 && r.body.usage.remaining === 0);

  // 15) رفع الحد يسمح بالتوليد من جديد
  r = await call(agents, { method: 'PATCH', token: adminToken, body: { id: agentId, daily_limit: 5 } });
  ok('15. المالك يرفع الحد اليومي', r.status === 200 && r.body.agent.daily_limit === 5);
  r = await call(codes, { method: 'POST', token: agentToken, body: { device_id: 'DS-2345-6789-ABCD', app: 'student', duration: 'lifetime' } });
  ok('    التوليد ينجح بعد رفع الحد', r.status === 200);

  // 16) إيقاف الوكيل يمنع دخوله
  r = await call(agents, { method: 'PATCH', token: adminToken, body: { id: agentId, active: false } });
  ok('16. المالك يوقف الوكيل', r.status === 200 && r.body.agent.active === false);
  r = await call(login, { method: 'POST', body: { username: 'agent1', password: 'agentpass' } });
  ok('    الوكيل الموقوف لا يستطيع الدخول', r.status === 403);

  // 17) ثبات البيانات بعد إعادة القراءة من الملف
  const dbFile = path.join(TMP, '.data', 'db.json');
  const persisted = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  ok('17. البيانات محفوظة على القرص (تبقى بعد إعادة الفتح)',
    persisted.users.length === 2 && persisted.codes.length >= 3);

  // 18) الإحصاءات للمالك
  r = await call(stats, { method: 'GET', token: adminToken });
  ok('18. لوحة المعلومات تعرض إحصاءات صحيحة',
    r.body.cards && r.body.cards.agents === 1 && r.body.cards.codes >= 3 && r.body.cards.activations >= 1);

  // 19) التفعيلات مشتقّة من الأكواد
  const acts = require(path.join(ROOT, 'api/activations.js'));
  r = await call(acts, { method: 'GET', token: adminToken });
  ok('19. قائمة التفعيلات تُبنى من الأجهزة المميّزة', r.status === 200 && Array.isArray(r.body.activations) && r.body.activations.length >= 1);

  // 20) رمز غير صالح يُرفض
  r = await call(session, { method: 'GET', token: 'not.a.valid.token' });
  ok('20. رمز جلسة غير صالح يُرفض (401)', r.status === 401);

  console.log('\n----------------------------------------');
  console.log('النتيجة: ' + PASS + ' ناجح، ' + FAIL + ' فاشل');
  console.log('----------------------------------------\n');
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
  process.exit(FAIL ? 1 : 0);
})().catch((e) => { console.error('خطأ غير متوقّع:', e); process.exit(1); });
