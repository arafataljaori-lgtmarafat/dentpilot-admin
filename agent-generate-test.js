'use strict';
/* اختبار /api/agent-generate — صفحة عامة بلا مفتاح/توكن، مع تحكّم عبر متغيّرات بيئة.
   يتحقّق: التوليد بلا مفتاح، نفس الخوارزمية ونفس جدول codes، الظهور في اللوحة،
   الإيقاف عبر AGENT_PAGE_ENABLED، والحد اليومي عبر AGENT_PAGE_DAILY_LIMIT. backend ملفّي. */
const os = require('os'), path = require('path'), fs = require('fs');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-pub-'));
process.chdir(TMP);
process.env.AUTH_SECRET = 'pub-test';
['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'VERCEL', 'AWS_REGION', 'NOW_REGION', 'LAMBDA_TASK_ROOT', 'AGENT_PAGE_ENABLED', 'AGENT_PAGE_DAILY_LIMIT'].forEach((k) => delete process.env[k]);

const ROOT = path.resolve(__dirname, '..');
const gen = require(path.join(ROOT, 'api/agent-generate.js'));
const bootstrap = require(path.join(ROOT, 'api/bootstrap.js'));
const login = require(path.join(ROOT, 'api/login.js'));
const codes = require(path.join(ROOT, 'api/codes.js'));
const stats = require(path.join(ROOT, 'api/stats.js'));
const lic = require(path.join(ROOT, 'api/_lib/license.js'));

let PASS = 0, FAIL = 0;
const ok = (n, c, x) => { c ? (PASS++, console.log('  \u2713 ' + n)) : (FAIL++, console.log('  \u2717 ' + n + (x ? ' \u2192 ' + x : ''))); };
function res() { return { statusCode: 200, headers: {}, _d: '', setHeader(k, v) { this.headers[k] = v; }, end(d) { this._d = d || ''; }, json() { try { return JSON.parse(this._d); } catch (e) { return null; } } }; }
async function call(h, { method = 'GET', url = '/', body, token } = {}) { const req = { method, url, headers: token ? { authorization: 'Bearer ' + token } : {}, body }; const r = res(); await h(req, r); return { status: r.statusCode, body: r.json() }; }

(async function () {
  console.log('\n== اختبار الصفحة العامة (بلا مفتاح/توكن، تحكّم بالبيئة) ==\n');

  const d1 = 'DS-PBX1-0001-ABCD';

  // 1) توليد عام بلا أي مفتاح
  let r = await call(gen, { method: 'POST', body: { device_id: d1, app: 'student' } });
  ok('توليد بلا مفتاح ينجح مباشرة', r.status === 200 && !!r.body.code);
  ok('الكود مطابق للخوارزمية الحالية', r.body.code === lic.licenseForStudent(d1), r.body.code);

  // 2) مُسجّل في نفس جدول codes ويظهر في اللوحة
  await call(bootstrap, { method: 'POST', body: { name: 'O', username: 'owner', password: 'ownerpass123' } });
  r = await call(login, { method: 'POST', body: { username: 'owner', password: 'ownerpass123' } });
  const admin = r.body.token;
  r = await call(codes, { method: 'GET', token: admin });
  const found = (r.body.codes || []).find((c) => c.code === lic.licenseForStudent(d1));
  ok('الكود يظهر في لوحة الإدارة (نفس الجدول)', !!found && found.agent_id == null);
  r = await call(stats, { method: 'GET', token: admin });
  ok('محسوب في الإحصاءات', r.body.cards.codes >= 1);

  // 3) حالة GET
  r = await call(gen, { method: 'GET' });
  ok('GET يعيد حالة الخدمة', r.status === 200 && r.body.enabled === true && r.body.used_today >= 1);

  // 4) الإيقاف عبر AGENT_PAGE_ENABLED=false
  process.env.AGENT_PAGE_ENABLED = 'false';
  r = await call(gen, { method: 'POST', body: { device_id: 'DS-PBX2-0002-ABCD', app: 'student' } });
  ok('الإيقاف عبر البيئة يمنع التوليد (503)', r.status === 503);
  r = await call(gen, { method: 'GET' });
  ok('GET يعكس الإيقاف', r.body.enabled === false);
  delete process.env.AGENT_PAGE_ENABLED;

  // 5) الحد اليومي عبر AGENT_PAGE_DAILY_LIMIT
  // حتى الآن أُنشئ كود عام واحد (d1). نضبط الحد = 2 → واحد ينجح ثم يُرفض.
  process.env.AGENT_PAGE_DAILY_LIMIT = '2';
  r = await call(gen, { method: 'POST', body: { device_id: 'DS-PBX3-0003-ABCD', app: 'student' } });
  ok('ضمن الحد اليومي ينجح (الثاني)', r.status === 200);
  r = await call(gen, { method: 'POST', body: { device_id: 'DS-PBX4-0004-ABCD', app: 'student' } });
  ok('تجاوز الحد اليومي يُرفض (429)', r.status === 429 && /الحد اليومي/.test(r.body.error || ''));
  delete process.env.AGENT_PAGE_DAILY_LIMIT;

  // 6) رفض جهاز غير صالح / تطبيق غير مطابق
  r = await call(gen, { method: 'POST', body: { device_id: 'ZZZ', app: 'student' } });
  ok('جهاز غير صالح يُرفض', r.status === 400);
  r = await call(gen, { method: 'POST', body: { device_id: 'DP-PBX1-0001-ABCD', app: 'student' } });
  ok('جهاز عيادة على صفحة الطالب يُرفض', r.status === 400);

  console.log('\n----------------------------------------');
  console.log('نتيجة اختبار الصفحة العامة: ' + PASS + ' ناجح، ' + FAIL + ' فاشل');
  console.log('----------------------------------------\n');
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
  process.exit(FAIL ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
