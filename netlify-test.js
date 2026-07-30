'use strict';
/* اختبار دوال Netlify — يبني أحداث Netlify (event) ويشغّل نفس التدفّق عبر
   المحوّل والمعالجات الحالية، للتأكّد أن التوجيه بنمط Netlify يعمل بلا تغيير
   في المنطق (backend ملفّي معزول محلياً). */
const os = require('os'), path = require('path'), fs = require('fs');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-netlify-'));
process.chdir(TMP);
process.env.AUTH_SECRET = 'netlify-test';
// تأكيد استخدام backend الملفّي محلياً (ليست بيئة serverless في هذا الاختبار)
['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'VERCEL', 'AWS_REGION', 'NOW_REGION', 'LAMBDA_TASK_ROOT'].forEach((k) => delete process.env[k]);

const F = path.resolve(__dirname, '..', 'netlify', 'functions');
const fn = {
  bootstrap: require(path.join(F, 'bootstrap.js')),
  login: require(path.join(F, 'login.js')),
  session: require(path.join(F, 'session.js')),
  agents: require(path.join(F, 'agents.js')),
  codes: require(path.join(F, 'codes.js')),
  stats: require(path.join(F, 'stats.js')),
};
const lic = require(path.resolve(__dirname, '..', 'api', '_lib', 'license.js'));

let PASS = 0, FAIL = 0;
const ok = (n, c, x) => { c ? (PASS++, console.log('  \u2713 ' + n)) : (FAIL++, console.log('  \u2717 ' + n + (x ? ' \u2192 ' + x : ''))); };

async function invoke(f, { method = 'GET', pathName = '/', query, body, token } = {}) {
  const event = {
    httpMethod: method,
    path: pathName,
    queryStringParameters: query || {},
    headers: token ? { authorization: 'Bearer ' + token } : {},
    body: body ? JSON.stringify(body) : null,
    isBase64Encoded: false,
  };
  const r = await f.handler(event);
  let json = null; try { json = r.body ? JSON.parse(r.body) : null; } catch (e) {}
  return { status: r.statusCode, json, headers: r.headers };
}

(async function () {
  console.log('\n== اختبار توجيه Netlify Functions ==\n');

  // شكل الاستجابة صحيح (statusCode + headers + body)
  let r = await invoke(fn.bootstrap, { method: 'GET', pathName: '/api/bootstrap' });
  ok('الدالة تُعيد statusCode و JSON صحيحين', r.status === 200 && r.json && typeof r.json.needsSetup === 'boolean');
  ok('ترويسة Content-Type مضبوطة', /application\/json/.test((r.headers && (r.headers['Content-Type'] || r.headers['content-type'])) || ''));

  // إنشاء المالك + دخوله
  r = await invoke(fn.bootstrap, { method: 'POST', pathName: '/api/bootstrap', body: { name: 'المالك', username: 'owner', password: 'ownerpass123' } });
  ok('إنشاء Super Admin عبر دالة Netlify', r.status === 200 && !!r.json.token);
  r = await invoke(fn.login, { method: 'POST', pathName: '/api/login', body: { username: 'owner', password: 'ownerpass123' } });
  ok('تسجيل دخول المالك', r.status === 200 && r.json.user.role === 'super_admin');
  const adminToken = r.json.token;

  // إنشاء وكيل بحدّ 2
  r = await invoke(fn.agents, { method: 'POST', pathName: '/api/agents', token: adminToken, body: { name: 'وكيل نتليفاي', username: 'netagent', password: 'agentpass', daily_limit: 2 } });
  ok('إنشاء وكيل (حد 2)', r.status === 200 && r.json.agent.daily_limit === 2);
  const agentId = r.json.agent.id;

  // (1) دخول الوكيل يعمل
  r = await invoke(fn.login, { method: 'POST', pathName: '/api/login', body: { username: 'netagent', password: 'agentpass' } });
  ok('1) دخول الوكيل يعمل', r.status === 200 && r.json.user.role === 'agent');
  const agentToken = r.json.token;

  // فحص الجهاز (query عبر Netlify)
  const device = 'DS-NETL-0001-ABCD';
  r = await invoke(fn.codes, { method: 'GET', pathName: '/api/codes', query: { action: 'verify', device }, token: agentToken });
  ok('فحص الجهاز عبر queryStringParameters', r.json && r.json.valid && r.json.app === 'student');

  // (2) الوكيل ينشئ كود تفعيل
  r = await invoke(fn.codes, { method: 'POST', pathName: '/api/codes', token: agentToken, body: { device_id: device, app: 'student', duration: 'lifetime' } });
  ok('2) الوكيل ينشئ كود تفعيل', r.status === 200 && !!r.json.code);
  const code = r.json.code.code;
  ok('   الكود مطابق لخوارزمية التطبيق (نفس المنطق)', code === lic.licenseForStudent(device));
  ok('   الكود مسجّل بمعرّف الوكيل', r.json.code.agent_id === agentId);

  // (3) الكود يظهر في لوحة الإدارة
  r = await invoke(fn.codes, { method: 'GET', pathName: '/api/codes', token: adminToken });
  ok('3) الكود يظهر في أكواد الإدارة', (r.json.codes || []).some((c) => c.code === code));
  r = await invoke(fn.stats, { method: 'GET', pathName: '/api/stats', token: adminToken });
  ok('   الكود ضمن إحصاءات الإدارة', r.status === 200 && r.json.cards.codes >= 1);

  // منع الوكيل من صفحات الإدارة
  r = await invoke(fn.agents, { method: 'GET', pathName: '/api/agents', token: agentToken });
  ok('   الوكيل لا يرى بيانات الإدارة (403)', r.status === 403);

  // (4) الحدود اليومية ما زالت تعمل
  r = await invoke(fn.codes, { method: 'POST', pathName: '/api/codes', token: agentToken, body: { device_id: 'DS-NETL-0002-ABCD', app: 'student', duration: 'lifetime' } });
  ok('4) الكود الثاني ضمن الحد ينجح', r.status === 200);
  r = await invoke(fn.codes, { method: 'POST', pathName: '/api/codes', token: agentToken, body: { device_id: 'DS-NETL-0003-ABCD', app: 'student', duration: 'lifetime' } });
  ok('   تجاوز الحد يُرفض (403 برسالة الإدارة)', r.status === 403 && /الحد/.test((r.json && r.json.error) || ''));

  // إيقاف الوكيل يمنع دخوله
  await invoke(fn.agents, { method: 'PATCH', pathName: '/api/agents', token: adminToken, body: { id: agentId, active: false } });
  r = await invoke(fn.login, { method: 'POST', pathName: '/api/login', body: { username: 'netagent', password: 'agentpass' } });
  ok('   إيقاف الوكيل من الإدارة يمنع دخوله (403)', r.status === 403);
  await invoke(fn.agents, { method: 'PATCH', pathName: '/api/agents', token: adminToken, body: { id: agentId, active: true } });

  // --- رابط دعوة الوكيل الدائم عبر دوال Netlify (نفس الميزة الجديدة، على نفس التوجيه) ---
  r = await invoke(fn.agents, { method: 'POST', pathName: '/api/agents', token: adminToken, body: { name: 'وكيل رابط Netlify', username: 'netlinkagent', password: 'agentpass', daily_limit: 1 } });
  ok('رمز رابط الوكيل يُولَّد تلقائياً عبر دالة Netlify', r.status === 200 && /^AGT_/.test(r.json.agent.agent_token || ''));
  const linkAgentId = r.json.agent.id, linkAgentToken = r.json.agent.agent_token;

  r = await invoke(fn.session, { method: 'GET', pathName: '/api/session', token: linkAgentToken });
  ok('رمز الرابط يُعرِّف الوكيل عبر session بلا /api/login (نمط Netlify)', r.status === 200 && r.json.user.role === 'agent');

  const linkDevice = 'DS-NLNK-0001-ABCD';
  r = await invoke(fn.codes, { method: 'POST', pathName: '/api/codes', token: linkAgentToken, body: { device_id: linkDevice, app: 'student', duration: 'lifetime' } });
  ok('توليد كود عبر رمز الرابط يعمل على Netlify', r.status === 200 && r.json.code.code === lic.licenseForStudent(linkDevice));

  r = await invoke(fn.codes, { method: 'GET', pathName: '/api/codes', token: adminToken });
  ok('الكود المولَّد بالرابط يظهر في إدارة Netlify', (r.json.codes || []).some((c) => c.agent_id === linkAgentId));

  r = await invoke(fn.agents, { method: 'PATCH', pathName: '/api/agents', token: adminToken, body: { id: linkAgentId, regenerate_token: true } });
  const rotated = r.json.agent.agent_token;
  ok('توليد رابط جديد عبر Netlify يبطل القديم فوراً', rotated !== linkAgentToken);
  r = await invoke(fn.session, { method: 'GET', pathName: '/api/session', token: linkAgentToken });
  ok('   الرابط القديم مرفوض بعد التوليد الجديد (401)', r.status === 401);

  console.log('\n----------------------------------------');
  console.log('نتيجة اختبار Netlify: ' + PASS + ' ناجح، ' + FAIL + ' فاشل');
  console.log('----------------------------------------\n');
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
  process.exit(FAIL ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
