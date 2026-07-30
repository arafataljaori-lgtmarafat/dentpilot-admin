'use strict';
/* اختبار نظام رابط دعوة الوكيل الدائم (يستبدل اسم المستخدم/كلمة المرور في البوابة فقط).
   يتحقّق من: التوليد عند الإنشاء، تحديد الهوية عبر الرمز بلا /api/login، فرض النشاط
   والحد اليومي، ظهور الأكواد في الإدارة، رفض الوصول الإداري، وإبطال الرابط عند التوليد
   من جديد. backend ملفّي معزول محلياً — لا شبكة، لا Supabase. */
const os = require('os'), path = require('path'), fs = require('fs');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-agent-token-'));
process.chdir(TMP);
process.env.AUTH_SECRET = 'token-test';
delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_KEY;

const ROOT = path.resolve(__dirname, '..');
const bootstrap = require(path.join(ROOT, 'api/bootstrap.js'));
const login = require(path.join(ROOT, 'api/login.js'));
const session = require(path.join(ROOT, 'api/session.js'));
const agents = require(path.join(ROOT, 'api/agents.js'));
const codes = require(path.join(ROOT, 'api/codes.js'));
const stats = require(path.join(ROOT, 'api/stats.js'));
const lic = require(path.join(ROOT, 'api/_lib/license.js'));
const db = require(path.join(ROOT, 'api/_lib/db.js'));
const { AGENT_TOKEN_PREFIX } = require(path.join(ROOT, 'api/_lib/auth.js'));

let PASS = 0, FAIL = 0;
const ok = (n, c, x) => { c ? (PASS++, console.log('  \u2713 ' + n)) : (FAIL++, console.log('  \u2717 ' + n + (x ? ' \u2192 ' + x : ''))); };
function res() { return { statusCode: 200, headers: {}, _d: '', setHeader(k, v) { this.headers[k] = v; }, end(d) { this._d = d || ''; }, json() { try { return JSON.parse(this._d); } catch (e) { return null; } } }; }
async function call(h, { method = 'GET', url = '/', body, token } = {}) { const req = { method, url, headers: token ? { authorization: 'Bearer ' + token } : {}, body }; const r = res(); await h(req, r); return { status: r.statusCode, body: r.json() }; }

(async function () {
  console.log('\n== اختبار رابط دعوة الوكيل الدائم ==\n');

  // تجهيز: مالك يدخل بكلمة المرور كالمعتاد (لم يتغيّر شيء في دخول المالك)
  await call(bootstrap, { method: 'POST', body: { name: 'المالك', username: 'owner', password: 'ownerpass123' } });
  let r = await call(login, { method: 'POST', body: { username: 'owner', password: 'ownerpass123' } });
  ok('دخول المالك بكلمة المرور لا يزال يعمل (لم يُمس)', r.status === 200 && r.body.user.role === 'super_admin');
  const adminToken = r.body.token;

  // 1) إنشاء وكيل بحدّ يومي 2 → يجب أن يُنشأ له رابط دعوة تلقائياً
  r = await call(agents, { method: 'POST', token: adminToken, body: { name: 'وكيل الرابط', username: 'linkagent', password: 'agentpass', daily_limit: 2 } });
  ok('1) إنشاء الوكيل ينجح ويولّد رمز رابط تلقائياً', r.status === 200 && typeof r.body.agent.agent_token === 'string');
  const agentId = r.body.agent.id;
  const agentToken = r.body.agent.agent_token;
  ok('   الرمز يبدأ بالبادئة المتوقّعة (' + AGENT_TOKEN_PREFIX + ')', agentToken.indexOf(AGENT_TOKEN_PREFIX) === 0);
  ok('   الرمز طويل بما يكفي (عشوائية قوية)', agentToken.length >= 40, 'length=' + agentToken.length);
  ok('   يعيد مسار البوابة الجاهز', r.body.agent.portal_path === '/agent?key=' + agentToken);

  // 2) تحديد الوكيل من الرمز مباشرة عبر /api/session — بلا أي استدعاء لـ /api/login
  r = await call(session, { method: 'GET', token: agentToken });
  ok('2) الرمز يُعرِّف الوكيل تلقائياً عبر /api/session (بلا تسجيل دخول)', r.status === 200 && r.body.user.role === 'agent' && r.body.user.name === 'وكيل الرابط');
  ok('   يعرض حدّه اليومي الخاص فقط', r.body.usage && r.body.usage.limit === 2 && r.body.usage.used === 0);

  // رمز غير موجود/مزوَّر يُرفض
  r = await call(session, { method: 'GET', token: AGENT_TOKEN_PREFIX + 'ffffffffffffffffffffffffffffffffffffffffffffff' });
  ok('   رمز غير موجود يُرفض (401)', r.status === 401);
  r = await call(session, { method: 'GET', token: 'garbage-not-a-token' });
  ok('   رمز عشوائي غير مطابق يُرفض (401)', r.status === 401);

  // الرمز لا يفتح أي وظيفة إدارية
  r = await call(agents, { method: 'GET', token: agentToken });
  ok('3) رمز الوكيل لا يصل لصفحة الوكلاء الإدارية (403)', r.status === 403);
  r = await call(stats, { method: 'GET', token: agentToken });
  ok('   ولا لإحصاءات النظام (403)', r.status === 403);

  // 4) توليد كود عبر الرمز مباشرة (فحص الجهاز + التوليد)
  const device = 'DS-AGTX-0001-ABCD';
  r = await call(codes, { method: 'GET', url: '/api/codes?action=verify&device=' + encodeURIComponent(device), token: agentToken });
  ok('4) فحص الجهاز يعمل عبر رمز الرابط', r.body && r.body.valid && r.body.app === 'student');
  r = await call(codes, { method: 'POST', token: agentToken, body: { device_id: device, app: 'student', duration: 'lifetime' } });
  ok('   توليد الكود عبر رمز الرابط ينجح', r.status === 200 && !!r.body.code);
  const code = r.body.code.code;
  ok('   الكود مطابق لخوارزمية التطبيق (نفس منطق التوليد، بلا تغيير)', code === lic.licenseForStudent(device));
  ok('   الكود مسجَّل بمعرّف الوكيل الصحيح', r.body.code.agent_id === agentId);

  // 5) يظهر في لوحة الإدارة
  r = await call(codes, { method: 'GET', token: adminToken });
  ok('5) الكود يظهر في قائمة أكواد الإدارة', (r.body.codes || []).some((c) => c.code === code && c.agent_name === 'وكيل الرابط'));
  r = await call(stats, { method: 'GET', token: adminToken });
  ok('   ويُحتسب ضمن إحصاءات الإدارة', r.body.cards.codes >= 1);

  // الحدود اليومية ما زالت تُفرض عبر رمز الرابط
  r = await call(codes, { method: 'POST', token: agentToken, body: { device_id: 'DS-AGTX-0002-ABCD', app: 'student', duration: 'lifetime' } });
  ok('6) الكود الثاني ضمن الحد ينجح', r.status === 200);
  r = await call(codes, { method: 'POST', token: agentToken, body: { device_id: 'DS-AGTX-0003-ABCD', app: 'student', duration: 'lifetime' } });
  ok('   الثالث يتجاوز الحد فيُرفض (403 برسالة الإدارة)', r.status === 403 && /الحد/.test(r.body.error || ''));

  // 7) إيقاف الوكيل من الإدارة → رمزه الدائم يُرفض فوراً (حتى لو كان صحيحاً)
  await call(agents, { method: 'PATCH', token: adminToken, body: { id: agentId, active: false } });
  r = await call(session, { method: 'GET', token: agentToken });
  ok('7) إيقاف الوكيل من الإدارة يمنع دخوله عبر رابطه (403)', r.status === 403);
  await call(agents, { method: 'PATCH', token: adminToken, body: { id: agentId, active: true } }); // إعادة التفعيل لبقية الاختبار

  // 8) توليد رابط جديد يُبطل القديم فوراً
  r = await call(agents, { method: 'PATCH', token: adminToken, body: { id: agentId, regenerate_token: true } });
  ok('8) توليد رابط جديد ينجح ويعيد رمزاً مختلفاً', r.status === 200 && r.body.agent.agent_token !== agentToken);
  const newToken = r.body.agent.agent_token;
  r = await call(session, { method: 'GET', token: agentToken });
  ok('   الرابط القديم يُرفض فوراً بعد التوليد الجديد (401)', r.status === 401);
  r = await call(session, { method: 'GET', token: newToken });
  ok('   الرابط الجديد يعمل مباشرة', r.status === 200 && r.body.user.role === 'agent');

  // 9) مسار القائمة (GET) يُرجع agent_token — هذا ما تبني منه اللوحة الرابط
  r = await call(agents, { method: 'GET', token: adminToken });
  const listed = (r.body.agents || []).find((x) => x.id === agentId);
  ok('9) GET /api/agents يُرجع agent_token حقيقياً (لا undefined)', !!listed && typeof listed.agent_token === 'string' && listed.agent_token.indexOf(AGENT_TOKEN_PREFIX) === 0, listed && String(listed.agent_token));
  ok('   portal_path حقيقي في القائمة', !!listed && listed.portal_path === '/agent?key=' + listed.agent_token);
  ok('   الرابط المبني لا يحتوي على "undefined"', !!listed && ('/agent?key=' + listed.agent_token).indexOf('undefined') < 0);

  // 10) إصلاح ذاتي لوكيل قديم بلا رمز (أُنشئ قبل إضافة الميزة)
  const legacy = await db.insertUser({ role: 'agent', name: 'وكيل قديم', username: 'legacyagent', phone: '',
    password_salt: 'x', password_hash: 'x', daily_limit: 5, active: true, last_active_at: null }); // بلا agent_token
  ok('10) وكيل قديم أُدرج بلا رمز', !legacy.agent_token);
  r = await call(agents, { method: 'GET', token: adminToken });
  const healed = (r.body.agents || []).find((x) => x.id === legacy.id);
  ok('    GET /api/agents يُولّد له رمزاً تلقائياً (إصلاح ذاتي)', !!healed && typeof healed.agent_token === 'string' && healed.agent_token.indexOf(AGENT_TOKEN_PREFIX) === 0);
  ok('    الرمز المُصلَح مُخزَّن ويعمل للدخول', !!healed);
  r = await call(session, { method: 'GET', token: healed.agent_token });
  ok('    الوكيل القديم يدخل الآن عبر رابطه المُصلَح', r.status === 200 && r.body.user.role === 'agent');

  console.log('\n----------------------------------------');
  console.log('نتيجة اختبار رابط دعوة الوكيل: ' + PASS + ' ناجح، ' + FAIL + ' فاشل');
  console.log('----------------------------------------\n');
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
  process.exit(FAIL ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
