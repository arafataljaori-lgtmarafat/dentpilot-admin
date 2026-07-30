'use strict';
/* اختبار بوابة الوكيل — يتحقّق أنها تستخدم نفس الخادم/الجدول/الحدود، وأن
   أكواد الوكيل تُسجَّل بمعرّفه وتظهر في لوحة الإدارة. (backend ملفّي معزول) */
const os = require('os'), path = require('path'), fs = require('fs');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-agent-portal-'));
process.chdir(TMP);
process.env.AUTH_SECRET = 'portal-test';
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
const ok = (n, c, x) => { c ? (PASS++, console.log('  \u2713 ' + n)) : (FAIL++, console.log('  \u2717 ' + n + (x ? ' \u2192 ' + x : ''))); };
function res() { return { statusCode: 200, headers: {}, _d: '', setHeader(k, v) { this.headers[k] = v; }, end(d) { this._d = d || ''; }, json() { try { return JSON.parse(this._d); } catch (e) { return null; } } }; }
async function call(h, { method = 'GET', url = '/', body, token } = {}) { const req = { method, url, headers: token ? { authorization: 'Bearer ' + token } : {}, body }; const r = res(); await h(req, r); return { status: r.statusCode, body: r.json() }; }

(async function () {
  console.log('\n== اختبار بوابة الوكيل (نفس قاعدة البيانات ونظام الأكواد) ==\n');

  // تجهيز: مالك + وكيل بحدّ يومي 2
  await call(bootstrap, { method: 'POST', body: { name: 'المالك', username: 'owner', password: 'ownerpass123' } });
  let r = await call(login, { method: 'POST', body: { username: 'owner', password: 'ownerpass123' } });
  const adminToken = r.body.token;
  r = await call(agents, { method: 'POST', token: adminToken, body: { name: 'وكيل البوابة', username: 'portalagent', password: 'agentpass', daily_limit: 2 } });
  const agentId = r.body.agent.id;
  ok('المالك أنشأ الوكيل وحدّد حدّه اليومي (2)', r.status === 200 && r.body.agent.daily_limit === 2);

  // البوابة: دخول الوكيل عبر نفس /api/login
  r = await call(login, { method: 'POST', body: { username: 'portalagent', password: 'agentpass' } });
  ok('دخول الوكيل من البوابة ينجح', r.status === 200 && r.body.user.role === 'agent');
  const agentToken = r.body.token;

  // البوابة لا تعرض بيانات إدارية: نفس الرمز لا يصل لصفحات الإدارة
  r = await call(agents, { method: 'GET', token: agentToken });
  ok('الوكيل لا يصل لبيانات الإدارة (403)', r.status === 403);
  r = await call(stats, { method: 'GET', token: agentToken });
  ok('الوكيل لا يصل لإحصاءات النظام (403)', r.status === 403);

  // فحص جهاز + توليد كود من البوابة (نفس /api/codes)
  const device = 'DS-PRTL-0001-ABCD';
  r = await call(codes, { method: 'GET', url: '/api/codes?action=verify&device=' + encodeURIComponent(device), token: agentToken });
  ok('فحص الجهاز يعمل من البوابة', r.body && r.body.valid && r.body.app === 'student');
  r = await call(codes, { method: 'POST', token: agentToken, body: { device_id: device, app: 'student', duration: 'lifetime' } });
  ok('توليد الكود من البوابة ينجح', r.status === 200 && !!r.body.code);
  const code = r.body.code.code;
  ok('الكود مطابق لخوارزمية التطبيق (توليد الخادم، بلا تكرار منطق)', code === lic.licenseForStudent(device), code);
  ok('الكود مسجّل بمعرّف الوكيل الذي أنشأه', r.body.code.agent_id === agentId);

  // يظهر مباشرة في لوحة الإدارة
  r = await call(codes, { method: 'GET', token: adminToken });
  const inAdmin = (r.body.codes || []).find(c => c.code === code);
  ok('الكود يظهر في قائمة أكواد الإدارة', !!inAdmin && inAdmin.agent_name === 'وكيل البوابة');
  r = await call(stats, { method: 'GET', token: adminToken });
  ok('الكود محسوب ضمن إحصاءات الإدارة', r.body.cards.codes >= 1);

  // الوكيل يرى أكواده فقط عبر البوابة (سجلّ مُنطاق)
  r = await call(codes, { method: 'GET', token: agentToken });
  ok('الوكيل يرى أكواده فقط', r.body.codes.every(c => c.agent_id === agentId));

  // نفس الحدود: الحد 2 — الثاني ينجح، الثالث يُرفض
  r = await call(codes, { method: 'POST', token: agentToken, body: { device_id: 'DS-PRTL-0002-ABCD', app: 'student', duration: 'lifetime' } });
  ok('الكود الثاني ضمن الحد ينجح', r.status === 200);
  r = await call(codes, { method: 'POST', token: agentToken, body: { device_id: 'DS-PRTL-0003-ABCD', app: 'student', duration: 'lifetime' } });
  ok('الثالث يتجاوز الحد فيُرفض برسالة الإدارة (403)', r.status === 403 && /الحد/.test(r.body.error || ''));

  // إيقاف الوكيل من الإدارة يمنع دخوله من البوابة
  await call(agents, { method: 'PATCH', token: adminToken, body: { id: agentId, active: false } });
  r = await call(login, { method: 'POST', body: { username: 'portalagent', password: 'agentpass' } });
  ok('إيقاف الوكيل من الإدارة يمنع دخوله من البوابة (403)', r.status === 403);

  console.log('\n----------------------------------------');
  console.log('نتيجة اختبار البوابة: ' + PASS + ' ناجح، ' + FAIL + ' فاشل');
  console.log('----------------------------------------\n');
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
