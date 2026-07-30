'use strict';
/* اختبار التوسعة: الخطط + الدعم/التفعيل المباشر + سجل الإدارة + device-status + codes بالخطة.
   backend ملفّي معزول (لا شبكة، لا Supabase). أجهزة بصيغة base32 صحيحة (بلا I/O/U/L). */
const os = require('os'), path = require('path'), fs = require('fs');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-support-'));
process.chdir(TMP);
process.env.AUTH_SECRET = 'support-test';
['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'VERCEL', 'AWS_REGION', 'NOW_REGION', 'LAMBDA_TASK_ROOT'].forEach((k) => delete process.env[k]);

const ROOT = path.resolve(__dirname, '..');
const bootstrap = require(path.join(ROOT, 'api/bootstrap.js'));
const login = require(path.join(ROOT, 'api/login.js'));
const agents = require(path.join(ROOT, 'api/agents.js'));
const codes = require(path.join(ROOT, 'api/codes.js'));
const plans = require(path.join(ROOT, 'api/plans.js'));
const support = require(path.join(ROOT, 'api/support.js'));
const adminlog = require(path.join(ROOT, 'api/adminlog.js'));
const deviceStatus = require(path.join(ROOT, 'api/device-status.js'));
const lic = require(path.join(ROOT, 'api/_lib/license.js'));

let PASS = 0, FAIL = 0;
const ok = (n, c, x) => { c ? (PASS++, console.log('  \u2713 ' + n)) : (FAIL++, console.log('  \u2717 ' + n + (x ? ' \u2192 ' + x : ''))); };
function res() { return { statusCode: 200, headers: {}, _d: '', setHeader(k, v) { this.headers[k] = v; }, end(d) { this._d = d || ''; }, json() { try { return JSON.parse(this._d); } catch (e) { return null; } } }; }
async function call(h, { method = 'GET', url = '/', body, token } = {}) { const req = { method, url, headers: token ? { authorization: 'Bearer ' + token } : {}, body }; const r = res(); await h(req, r); return { status: r.statusCode, body: r.json() }; }

(async function () {
  console.log('\n== اختبار التوسعة: الخطط + الدعم والتفعيل + السجل ==\n');

  await call(bootstrap, { method: 'POST', body: { name: 'المالك', username: 'owner', password: 'ownerpass123' } });
  let r = await call(login, { method: 'POST', body: { username: 'owner', password: 'ownerpass123' } });
  const adminToken = r.body.token;
  r = await call(agents, { method: 'POST', token: adminToken, body: { name: 'وكيل', username: 'ag1', password: 'agentpass', daily_limit: 50 } });
  const agentToken = r.body.agent.agent_token;

  // ---- الخطط ----
  r = await call(plans, { method: 'GET', token: adminToken });
  ok('الخطط الافتراضية تُزرع تلقائياً', r.status === 200 && r.body.plans.length >= 5, r.body.plans && r.body.plans.length);
  const yearly = r.body.plans.find((p) => p.days === 365);
  const lifetime = r.body.plans.find((p) => p.days === null);
  ok('توجد خطة سنوية (365) وخطة مدى الحياة (null)', !!yearly && !!lifetime);
  r = await call(plans, { method: 'GET', token: agentToken });
  ok('الوكيل يرى الخطط الفعّالة (للمولّد)', r.status === 200 && r.body.plans.length >= 5);

  r = await call(plans, { method: 'POST', token: adminToken, body: { name: 'أسبوعي', days: 7, sort: 0 } });
  ok('المالك ينشئ خطة جديدة', r.status === 200 && r.body.plan.days === 7);
  const weeklyId = r.body.plan.id;
  r = await call(plans, { method: 'POST', token: agentToken, body: { name: 'x', days: 1 } });
  ok('الوكيل لا يستطيع إنشاء خطة (403)', r.status === 403);
  r = await call(plans, { method: 'PATCH', token: adminToken, body: { id: weeklyId, active: false } });
  ok('تعطيل خطة يعمل', r.status === 200 && r.body.plan.active === false);
  r = await call(plans, { method: 'GET', token: agentToken });
  ok('الخطة المعطّلة تختفي من قائمة الوكيل', !r.body.plans.find((p) => p.id === weeklyId));

  // ---- مولّد الأكواد بالخطة (feature 4) ----
  const dev1 = 'DS-PLAN-0001-ABCD';
  r = await call(codes, { method: 'POST', token: agentToken, body: { device_id: dev1, app: 'student', plan_id: yearly.id } });
  ok('توليد كود بخطة سنوية ينجح', r.status === 200 && !!r.body.code);
  ok('الكود مطابق للخوارزمية (بلا تغيير في التوليد)', r.body.code.code === lic.licenseForStudent(dev1));
  ok('الكود يحمل اسم الخطة وتاريخ انتهاء', r.body.code.plan_name === yearly.name && !!r.body.code.end_at);
  r = await call(codes, { method: 'POST', token: agentToken, body: { device_id: 'DS-LEGA-0001-ABCD', app: 'student', duration: 'lifetime' } });
  ok('التوليد القديم (lifetime) ما زال يعمل (توافق خلفي)', r.status === 200 && !!r.body.code);

  // ---- تفعيل مباشر (feature 2) ----
  const dev2 = 'DS-ACTV-0002-ABCD';
  r = await call(support, { method: 'POST', token: adminToken, body: { action: 'activate', device_id: dev2, app: 'student', plan_id: yearly.id } });
  ok('التفعيل المباشر ينجح ويُنشئ سجلاً', r.status === 200 && r.body.activation.effective_status === 'active');
  ok('التفعيل المباشر يُصدر الكود المربوط بالجهاز (متوافق)', r.body.code === lic.licenseForStudent(dev2));
  ok('السجل يحمل الخطة وتاريخ الانتهاء', r.body.activation.plan_name === yearly.name && !!r.body.activation.end_at);
  r = await call(support, { method: 'POST', token: agentToken, body: { action: 'activate', device_id: dev2, app: 'student', plan_id: yearly.id } });
  ok('الوكيل لا يصل لقسم الدعم (403)', r.status === 403);

  // ---- بحث ----
  r = await call(support, { method: 'GET', url: '/api/support?q=' + encodeURIComponent(dev2), token: adminToken });
  ok('البحث بالـ Device ID يجد التفعيل المباشر', r.status === 200 && r.body.results.some((x) => x.device_id_norm === lic._nrm(dev2) && x.source === 'direct'));
  r = await call(support, { method: 'GET', url: '/api/support?q=' + encodeURIComponent(lic.licenseForStudent(dev2)), token: adminToken });
  ok('البحث بالكود يجد السجل', r.status === 200 && r.body.results.length >= 1);
  r = await call(support, { method: 'GET', url: '/api/support?q=' + encodeURIComponent(dev1), token: adminToken });
  ok('البحث يعرض أكواد النظام الحالي أيضاً (source=code)', r.body.results.some((x) => x.source === 'code'));

  // ---- تمديد / تغيير خطة / إيقاف / إعادة تفعيل ----
  r = await call(support, { method: 'POST', token: adminToken, body: { action: 'extend', device_id: dev2, app: 'student', days: 30 } });
  ok('التمديد 30 يوم يعمل', r.status === 200);
  const endAfterExtend = r.body.activation.end_at;
  r = await call(support, { method: 'POST', token: adminToken, body: { action: 'change_plan', device_id: dev2, app: 'student', plan_id: lifetime.id } });
  ok('تغيير الخطة إلى مدى الحياة يزيل الانتهاء', r.status === 200 && r.body.activation.end_at === null);
  r = await call(support, { method: 'POST', token: adminToken, body: { action: 'suspend', device_id: dev2, app: 'student' } });
  ok('الإيقاف يعمل', r.status === 200 && r.body.activation.effective_status === 'suspended');
  r = await call(support, { method: 'POST', token: adminToken, body: { action: 'reactivate', device_id: dev2, app: 'student' } });
  ok('إعادة التفعيل تعمل', r.status === 200 && r.body.activation.effective_status === 'active');

  // ---- device-status (عام) ----
  r = await call(deviceStatus, { method: 'GET', url: '/api/device-status?device=' + encodeURIComponent(dev2) + '&app=student' });
  ok('device-status عام يُرجع مفعّل + الكود', r.status === 200 && r.body.activated === true && r.body.code === lic.licenseForStudent(dev2));
  r = await call(deviceStatus, { method: 'GET', url: '/api/device-status?device=DS-NONE-0009-ABCD&app=student' });
  ok('device-status لجهاز غير مفعّل يُرجع activated=false', r.status === 200 && r.body.activated === false);

  // ---- سجل الإدارة ----
  r = await call(adminlog, { method: 'GET', token: adminToken });
  ok('سجل الإدارة يسجّل العمليات (تفعيل/تمديد/تغيير/إيقاف)', r.status === 200 && r.body.logs.length >= 4);
  ok('عناصر السجل تحمل اسم المنفّذ', r.body.logs.every((l) => !!l.actor_name));
  r = await call(adminlog, { method: 'GET', token: agentToken });
  ok('الوكيل لا يصل لسجل الإدارة (403)', r.status === 403);

  console.log('\n----------------------------------------');
  console.log('نتيجة اختبار التوسعة: ' + PASS + ' ناجح، ' + FAIL + ' فاشل');
  console.log('----------------------------------------\n');
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
  process.exit(FAIL ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
