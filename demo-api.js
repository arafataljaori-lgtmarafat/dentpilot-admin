/* ============================================================
   DentPilot Admin — طبقة وضع التجربة (بلا خادم / بلا قاعدة بيانات)
   --------------------------------------------------------------
   عند DEMO_MODE = true، تستبدل هذه الطبقة دوال عميل الـ API بنسخة
   تعمل بالكامل داخل المتصفّح (تخزين محلي)، بنفس أشكال الردود التي
   يعيدها الخادم، فتعمل كل شاشات اللوحة دون أي تعديل عليها.
   لا تُفعّل شيئاً عندما DEMO_MODE = false (يبقى الاتصال بالخادم كما هو).
   ============================================================ */
(function () {
  'use strict';
  var CFG = window.DP_CONFIG || {};
  if (!CFG.DEMO_MODE) return;               // الوضع الكامل: لا نغيّر شيئاً
  if (typeof Api === 'undefined') return;

  var KEY = 'dp_demo_db';
  var DAY_OFFSET_MIN = 180;                  // نفس منطق الخادم (UTC+3)
  var DURATIONS = [{ key: 'lifetime', label: 'دائم (مدى الحياة)' }];
  var L = window.DemoLicense;

  function uid() { try { return crypto.randomUUID(); } catch (e) { return 'id-' + Math.random().toString(36).slice(2) + Date.now(); } }
  function nowISO() { return new Date().toISOString(); }
  function load() {
    var db;
    try { var raw = localStorage.getItem(KEY); if (raw) db = JSON.parse(raw); } catch (e) {}
    if (!db) db = seed();
    // ضمان وجود الجداول الجديدة (توافق مع مخزون قديم)
    if (!db.plans) { db.plans = defaultPlans(); }
    if (!db.device_activations) db.device_activations = [];
    if (!db.admin_log) db.admin_log = [];
    return db;
  }
  function defaultPlans() {
    return [
      { id: uid(), name: 'شهري', days: 30, active: true, sort: 1 },
      { id: uid(), name: '3 أشهر', days: 90, active: true, sort: 2 },
      { id: uid(), name: '6 أشهر', days: 180, active: true, sort: 3 },
      { id: uid(), name: 'سنوي', days: 365, active: true, sort: 4 },
      { id: uid(), name: 'مدى الحياة', days: null, active: true, sort: 5 },
    ];
  }
  function save(db) { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {} return db; }
  function seed() {
    var adminId = uid(), agentId = uid();
    var db = {
      users: [
        { id: adminId, role: 'super_admin', name: 'مدير النظام', username: 'demo', phone: '', daily_limit: null, active: true, last_active_at: nowISO(), created_at: nowISO() },
        { id: agentId, role: 'agent', name: 'وكيل تجريبي', username: 'agentdemo', phone: '+9665xxxxxxxx', daily_limit: 10, active: true, last_active_at: nowISO(), created_at: nowISO() },
      ],
      codes: [],
      plans: defaultPlans(),
      device_activations: [],
      admin_log: [],
      _me: adminId,
    };
    // كود عيّنة حتى لا تكون اللوحة فارغة
    try {
      var dev = 'DS-DEMO-0001-TEST';
      var code = L.generateCode('student', dev);
      db.codes.push({ id: uid(), code: code, device_id: dev.toUpperCase(), device_id_norm: L._nrm(dev), app: 'student', duration: 'lifetime', agent_id: agentId, agent_name: 'وكيل تجريبي', status: 'active', created_at: nowISO() });
    } catch (e) {}
    return save(db);
  }
  function me() { var db = load(); return db.users.find(function (u) { return u.id === db._me; }) || db.users[0]; }
  function startOfTodayISO() {
    var shifted = Date.now() + DAY_OFFSET_MIN * 60000; var d = new Date(shifted);
    var s = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    return new Date(s - DAY_OFFSET_MIN * 60000).toISOString();
  }
  function countToday(db, agentId) { var since = startOfTodayISO(); return db.codes.filter(function (c) { return c.agent_id === agentId && String(c.created_at) >= since; }).length; }
  function durationLabel(k) { var d = DURATIONS.find(function (x) { return x.key === k; }); return d ? d.label : 'دائم (مدى الحياة)'; }
  function appLabel(a) { return (L.APPS[a] && L.APPS[a].label) || a; }

  function pubUser(u) { return { id: u.id, role: u.role, name: u.name, username: u.username, phone: u.phone, daily_limit: u.daily_limit, active: u.active !== false }; }
  function pubAgent(u, used) {
    var limit = u.daily_limit == null ? null : Number(u.daily_limit);
    return { id: u.id, name: u.name, username: u.username, phone: u.phone, daily_limit: limit, active: u.active !== false,
      last_active_at: u.last_active_at || null, created_at: u.created_at || null,
      used_today: used == null ? undefined : used, remaining_today: (limit == null || used == null) ? null : Math.max(0, limit - used) };
  }
  function pubCode(c) {
    return { id: c.id, code: c.code, device_id: c.device_id, app: c.app, app_label: appLabel(c.app),
      duration: c.duration, duration_label: c.plan_name || durationLabel(c.duration), plan_id: c.plan_id || null, plan_name: c.plan_name || null, end_at: c.end_at || null, agent_id: c.agent_id, agent_name: c.agent_name,
      status: c.status || 'active', created_at: c.created_at };
  }
  function delay(v) { return new Promise(function (r) { setTimeout(function () { r(v); }, 60); }); }
  function fail(msg, status) { var e = new Error(msg); e.status = status || 400; return Promise.reject(e); }

  // ---------- استبدال دوال العميل ----------
  Api.init = function () { this.token = 'demo'; };
  Api.setToken = function () { this.token = 'demo'; };
  Api.demo = true;

  Api.health = function () { return delay({ status: 'ok', db: 'demo', backend: 'demo' }); };
  Api.bootstrapStatus = function () { return delay({ needsSetup: false, backend: 'demo' }); };

  Api.session = function () {
    var u = me();
    return delay({ user: pubUser(u), usage: null, backend: 'demo' });
  };

  Api.listAgents = function () {
    var db = load();
    var agents = db.users.filter(function (u) { return u.role === 'agent'; })
      .map(function (a) { return pubAgent(a, countToday(db, a.id)); });
    return delay({ agents: agents });
  };
  Api.createAgent = function (p) {
    var db = load();
    var name = String(p.name || '').trim(), username = String(p.username || '').trim().toLowerCase();
    if (!name) return fail('اسم الوكيل مطلوب');
    if (!/^[a-z0-9_.]{3,32}$/.test(username)) return fail('اسم المستخدم: 3–32 حرفاً لاتينياً/أرقاماً/(_ .)');
    if (String(p.password || '').length < 6) return fail('كلمة المرور يجب ألا تقل عن 6 أحرف');
    if (db.users.some(function (u) { return String(u.username).toLowerCase() === username; })) return fail('اسم المستخدم مستخدم بالفعل', 409);
    var d = parseInt(p.daily_limit, 10); if (!isFinite(d) || d < 0) d = 10;
    var u = { id: uid(), role: 'agent', name: name, username: username, phone: String(p.phone || '').trim(), daily_limit: d, active: true, last_active_at: null, created_at: nowISO() };
    db.users.push(u); save(db);
    return delay({ agent: pubAgent(u, 0) });
  };
  Api.updateAgent = function (p) {
    var db = load(); var u = db.users.find(function (x) { return x.id === p.id && x.role === 'agent'; });
    if (!u) return fail('الوكيل غير موجود', 404);
    if (typeof p.name === 'string' && p.name.trim()) u.name = p.name.trim();
    if (typeof p.phone === 'string') u.phone = p.phone.trim();
    if (p.daily_limit !== undefined) { var d = parseInt(p.daily_limit, 10); if (isFinite(d) && d >= 0) u.daily_limit = d; }
    if (p.active !== undefined) u.active = !!p.active;
    if (typeof p.username === 'string' && p.username.trim()) {
      var un = p.username.trim().toLowerCase();
      if (!/^[a-z0-9_.]{3,32}$/.test(un)) return fail('اسم مستخدم غير صالح');
      if (db.users.some(function (x) { return x.id !== u.id && String(x.username).toLowerCase() === un; })) return fail('اسم المستخدم مستخدم بالفعل', 409);
      u.username = un;
    }
    save(db);
    return delay({ agent: pubAgent(u, countToday(db, u.id)) });
  };
  Api.deleteAgent = function (id) {
    var db = load(); db.users = db.users.filter(function (u) { return u.id !== id; }); save(db);
    return delay({ deleted: id });
  };

  Api.verifyDevice = function (device) {
    var info = L.inspectDevice(device);
    if (info.app) info.app_label = appLabel(info.app);
    return delay(info);
  };
  Api.listCodes = function (limit) {
    var db = load();
    var arr = db.codes.slice().sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
    if (limit) arr = arr.slice(0, parseInt(limit, 10));
    return delay({ codes: arr.map(pubCode) });
  };
  Api.generateCode = function (p) {
    var db = load();
    var app = String(p.app || ''), device = String(p.device_id || '').trim(), duration = String(p.duration || 'lifetime');
    if (!L.APPS[app]) return fail('اختر تطبيقاً صحيحاً');
    var planName = null, planId = null, endAt = null;
    if (p.plan_id) {
      var plan = db.plans.find(function (x) { return x.id === p.plan_id; });
      if (!plan || plan.active === false) return fail('خطة غير صالحة');
      planName = plan.name; planId = plan.id; duration = 'plan';
      endAt = plan.days == null ? null : new Date(Date.now() + plan.days * 86400000).toISOString();
    } else if (!DURATIONS.find(function (d) { return d.key === duration; })) { return fail('مدة اشتراك غير مدعومة'); }
    var info = L.inspectDevice(device);
    if (!info.valid) return fail(info.reason || 'معرّف جهاز غير صالح');
    if (info.app !== app) return fail('التطبيق المختار لا يطابق نوع الجهاز. هذا المعرّف يخص ' + appLabel(info.app) + '.');
    var u = me();
    var code = L.generateCode(app, device);
    var rec = { id: uid(), code: code, device_id: device.toUpperCase(), device_id_norm: L._nrm(device), app: app, duration: duration, plan_id: planId, plan_name: planName, end_at: endAt, agent_id: u.id, agent_name: u.name, status: 'active', created_at: nowISO() };
    db.codes.push(rec); save(db);
    return delay({ code: pubCode(rec), usage: null });
  };
  Api.setCodeStatus = function (id, status) {
    var db = load(); var c = db.codes.find(function (x) { return x.id === id; });
    if (!c) return fail('الكود غير موجود', 404);
    if (['active', 'revoked'].indexOf(status) < 0) return fail('حالة غير صالحة');
    c.status = status; save(db);
    return delay({ code: pubCode(c) });
  };

  Api.listActivations = function () {
    var db = load(); var map = {};
    db.codes.forEach(function (c) {
      var key = (c.device_id_norm || c.device_id || '') + '|' + c.app;
      if (!map[key]) map[key] = { device_id: c.device_id, app: c.app, app_label: appLabel(c.app), activated_at: c.created_at, latest_at: c.created_at, latest_status: c.status || 'active', codes_count: 1, agent_name: c.agent_name || null };
      else { var e = map[key]; e.codes_count++; if (String(c.created_at) < String(e.activated_at)) e.activated_at = c.created_at; if (String(c.created_at) > String(e.latest_at)) { e.latest_at = c.created_at; e.latest_status = c.status || 'active'; e.agent_name = c.agent_name || e.agent_name; } }
    });
    var arr = Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) { return String(b.latest_at).localeCompare(String(a.latest_at)); });
    return delay({ activations: arr });
  };

  Api.stats = function () {
    var db = load(); var since = startOfTodayISO();
    var agents = db.users.filter(function (u) { return u.role === 'agent'; });
    var usedToday = db.codes.filter(function (c) { return String(c.created_at) >= since; }).length;
    var devices = {}, student = 0, clinic = 0;
    db.codes.forEach(function (c) { devices[(c.device_id_norm || c.device_id) + '|' + c.app] = 1; if (c.app === 'student') student++; else if (c.app === 'clinic') clinic++; });
    var recent = db.codes.slice().sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); }).slice(0, 8)
      .map(function (c) { return { code: c.code, device_id: c.device_id, app: c.app, app_label: appLabel(c.app), agent_name: c.agent_name, status: c.status || 'active', created_at: c.created_at }; });
    return delay({
      cards: { agents: agents.length, active_agents: agents.filter(function (a) { return a.active !== false; }).length,
        codes: db.codes.length, codes_today: usedToday, activations: Object.keys(devices).length, by_app: { student: student, clinic: clinic } },
      recent: recent,
    });
  };

  // أداة اختيارية: تصفير بيانات التجربة
  window.DemoReset = function () { try { localStorage.removeItem(KEY); } catch (e) {} location.reload(); };

  // ---------- التوسعة في وضع التجربة: الخطط + الدعم + السجل ----------
  function planLabel(p) { return p.name + (p.days == null ? '' : ' (' + p.days + ' يوم)'); }
  function pubPlan(p) { return { id: p.id, name: p.name, days: p.days == null ? null : Number(p.days), active: p.active !== false, sort: Number(p.sort) || 0 }; }
  function logDemo(db, action, a, details, planName) {
    db.admin_log.unshift({ id: uid(), action: action, device_id: a && a.device_id, app: a && a.app, plan_name: (a && a.plan_name) || planName || null, details: details || null, actor_id: me().id, actor_name: me().name, created_at: nowISO() });
  }
  function effStatus(a) { if (a.status === 'suspended') return 'suspended'; if (a.status === 'trial') return 'trial'; if (a.end_at && new Date(a.end_at).getTime() < Date.now()) return 'expired'; return 'active'; }
  function pubAct(a) { return { id: a.id, device_id: a.device_id, device_id_norm: a.device_id_norm, app: a.app, app_label: appLabel(a.app), plan_id: a.plan_id || null, plan_name: a.plan_name || null, status: a.status, effective_status: effStatus(a), start_at: a.start_at || null, end_at: a.end_at || null, source: a.source || 'direct', code: a.code || null, actor_name: a.actor_name || null, created_at: a.created_at, updated_at: a.updated_at || a.created_at }; }

  Api.listPlans = function (all) {
    var db = load(); var plans = db.plans.slice().sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); });
    if (!all) plans = plans.filter(function (p) { return p.active !== false; });
    return delay({ plans: plans.map(pubPlan) });
  };
  Api.createPlan = function (p) {
    var db = load(); if (!String(p.name || '').trim()) return fail('اسم الخطة مطلوب');
    var row = { id: uid(), name: String(p.name).trim(), days: (p.days === null || p.days === '' || p.days === undefined) ? null : parseInt(p.days, 10), active: p.active !== false, sort: parseInt(p.sort, 10) || 99 };
    db.plans.push(row); logDemo(db, 'plan_create', null, 'إنشاء خطة: ' + row.name, row.name); save(db);
    return delay({ plan: pubPlan(row) });
  };
  Api.updatePlan = function (p) {
    var db = load(); var pl = db.plans.find(function (x) { return x.id === p.id; }); if (!pl) return fail('الخطة غير موجودة', 404);
    if (typeof p.name === 'string' && p.name.trim()) pl.name = p.name.trim();
    if (p.days !== undefined) pl.days = (p.days === null || p.days === '') ? null : parseInt(p.days, 10);
    if (p.active !== undefined) pl.active = !!p.active;
    if (p.sort !== undefined) pl.sort = parseInt(p.sort, 10) || 0;
    logDemo(db, 'plan_update', null, 'تعديل خطة: ' + pl.name, pl.name); save(db);
    return delay({ plan: pubPlan(pl) });
  };
  Api.deletePlan = function (id) { var db = load(); var pl = db.plans.find(function (x) { return x.id === id; }); db.plans = db.plans.filter(function (x) { return x.id !== id; }); logDemo(db, 'plan_delete', null, 'حذف خطة', pl && pl.name); save(db); return delay({ deleted: id }); };

  function findAct(db, norm, app) { return db.device_activations.find(function (a) { return a.device_id_norm === norm && a.app === app; }); }
  Api.supportSearch = function (q) {
    var db = load(); var norm = L._nrm(q || ''); var out = []; var seen = {};
    if (!norm) return delay({ results: [] });
    db.device_activations.forEach(function (a) { if ((a.device_id_norm || '').indexOf(norm) >= 0 || (a.code && L._nrm(a.code) === norm)) { var k = a.device_id_norm + '|' + a.app; if (seen[k]) return; seen[k] = 1; out.push(pubAct(a)); } });
    db.codes.forEach(function (c) { if ((c.device_id_norm || '').indexOf(norm) >= 0 || L._nrm(c.code) === norm) { var k = (c.device_id_norm || '') + '|' + c.app; if (seen[k]) return; seen[k] = 1; out.push({ id: null, device_id: c.device_id, device_id_norm: c.device_id_norm, app: c.app, app_label: appLabel(c.app), plan_id: null, plan_name: c.plan_name || c.duration_label || 'دائم (مدى الحياة)', status: 'active', effective_status: 'active', start_at: c.created_at, end_at: null, source: 'code', code: c.code, actor_name: c.agent_name || null, created_at: c.created_at, updated_at: c.created_at }); } });
    return delay({ results: out });
  };
  Api.supportAction = function (b) {
    var db = load(); var action = b.action, app = b.app, deviceRaw = String(b.device_id || '').trim(), norm = L._nrm(deviceRaw);
    if (!L.APPS[app]) return fail('اختر تطبيقاً صحيحاً');
    if (!norm) return fail('أدخل معرّف الجهاز');
    if (action === 'activate') {
      var info = L.inspectDevice(deviceRaw); if (!info.valid) return fail(info.reason || 'معرّف غير صالح'); if (info.app !== app) return fail('التطبيق لا يطابق الجهاز');
      var plan = db.plans.find(function (p) { return p.id === b.plan_id; }); if (!plan) return fail('اختر خطة صحيحة');
      var now = nowISO(); var end = plan.days == null ? null : new Date(Date.now() + plan.days * 86400000).toISOString();
      var code = L.generateCode(app, deviceRaw);
      var ex = findAct(db, norm, app);
      var row = ex || { id: uid(), created_at: now }; row.device_id = deviceRaw.toUpperCase(); row.device_id_norm = norm; row.app = app; row.plan_id = plan.id; row.plan_name = plan.name; row.status = 'active'; row.start_at = now; row.end_at = end; row.source = 'direct'; row.code = code; row.actor_name = me().name; row.updated_at = now;
      if (!ex) db.device_activations.push(row);
      logDemo(db, 'activate', row, 'تفعيل مباشر — الخطة: ' + plan.name); save(db);
      return delay({ activation: pubAct(row), code: code });
    }
    var a = findAct(db, norm, app); if (!a) return fail('لا يوجد سجل تفعيل. استخدم «تفعيل مباشر» أولاً.', 404);
    if (action === 'extend') { var days = parseInt(b.days, 10); if (!(days > 0)) return fail('أيام غير صالحة'); if (a.end_at == null) return fail('مدى الحياة — لا حاجة للتمديد'); a.end_at = new Date(Math.max(Date.now(), new Date(a.end_at).getTime()) + days * 86400000).toISOString(); a.status = 'active'; logDemo(db, 'extend', a, 'تمديد ' + days + ' يوم'); }
    else if (action === 'change_plan') { var pl = db.plans.find(function (p) { return p.id === b.plan_id; }); if (!pl) return fail('اختر خطة صحيحة'); a.plan_id = pl.id; a.plan_name = pl.name; a.end_at = pl.days == null ? null : new Date(new Date(a.start_at || nowISO()).getTime() + pl.days * 86400000).toISOString(); a.status = 'active'; logDemo(db, 'change_plan', a, 'تغيير الخطة إلى: ' + pl.name); }
    else if (action === 'suspend') { a.status = 'suspended'; logDemo(db, 'suspend', a, 'إيقاف التفعيل'); }
    else if (action === 'reactivate') { a.status = 'active'; logDemo(db, 'reactivate', a, 'إعادة التفعيل'); }
    else return fail('إجراء غير معروف');
    a.updated_at = nowISO(); save(db);
    return delay({ activation: pubAct(a) });
  };
  Api.adminLog = function (limit) { var db = load(); return delay({ logs: db.admin_log.slice(0, limit || 50).map(function (l) { return { id: l.id, action: l.action, device_id: l.device_id || null, app: l.app || null, app_label: l.app ? appLabel(l.app) : null, plan_name: l.plan_name || null, details: l.details || null, actor_name: l.actor_name || null, created_at: l.created_at }; }) }); };
  Api.agentPageStatus = function () { var db = load(); var since = new Date(); since.setHours(0, 0, 0, 0); var used = (db.codes || []).filter(function (c) { return (c.agent_id == null) && new Date(c.created_at) >= since; }).length; return delay({ enabled: true, daily_limit: 0, used_today: used, remaining: null }); };
})();
