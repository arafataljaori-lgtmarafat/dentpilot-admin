/* ============================================================
   DentPilot Agent Portal — بوابة الوكيل (واجهة فقط)
   --------------------------------------------------------------
   الدخول عبر رابط دعوة دائم من المالك: /agent?key=AGT_xxxxx
   (لا شاشة تسجيل دخول ولا اسم مستخدم/كلمة مرور — الرمز في الرابط
   يُعرِّف الوكيل تلقائياً). يبقى نظام الوكلاء نفسه بلا حذف: الخادم
   لا يزال يتحقّق من وجود الرمز، وأن الوكيل نشِط، وأن حدّه اليومي محترَم.

   تعيد استخدام نفس عميل الـ API (api.js) ونفس نقاط الخادم:
     /api/session (تحديد الوكيل من الرمز + حدّه اليومي)
     /api/codes   (فحص الجهاز + توليد الكود + سجلّ أكواده)
   لا قاعدة بيانات جديدة ولا منطق توليد جديد — التوليد يتم على الخادم،
   ويُحفظ الكود في نفس جدول الأكواد بمعرّف الوكيل، فيظهر في لوحة الإدارة.
   البوابة للوكلاء فقط ولا تعرض أي بيانات أو إعدادات إدارية.
   ============================================================ */
(function () {
  'use strict';
  // رمز مستقل عن لوحة الإدارة (حتى لا يتداخلا على نفس المتصفّح).
  // هنا "الرمز" هو رابط الدعوة الدائم AGT_... وليس رمز جلسة مؤقّتاً.
  Api.init = function () { try { this.token = localStorage.getItem('dp_agent_token') || null; } catch (e) { this.token = null; } };
  Api.setToken = function (t) { this.token = t; try { t ? localStorage.setItem('dp_agent_token', t) : localStorage.removeItem('dp_agent_token'); } catch (e) {} };

  var APP_LABELS = { student: 'DentPilot Student', clinic: 'DentPilot Clinic' };
  var state = { user: null, usage: null };
  var root = function () { return document.getElementById('portal'); };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; }); }
  function fmtDate(iso) { if (!iso) return '—'; var d = new Date(iso); if (isNaN(d)) return '—'; var p = function (n) { return String(n).padStart(2, '0'); }; return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear() + ' · ' + p(d.getHours()) + ':' + p(d.getMinutes()); }
  function relDay(iso) { if (!iso) return '—'; var d = new Date(iso); if (isNaN(d)) return '—'; var days = Math.floor((Date.now() - d.getTime()) / 86400000); if (days <= 0) return 'اليوم'; if (days === 1) return 'أمس'; if (days < 30) return 'قبل ' + days + ' يوماً'; return fmtDate(iso).split(' · ')[0]; }
  function qs(s, c) { return (c || document).querySelector(s); }
  function qsa(s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); }
  function on(el, ev, fn) { if (el) el.addEventListener(ev, fn); }
  var toastTimer;
  function toast(msg, kind) { var t = document.getElementById('toast'); t.textContent = msg; t.className = 'toast show ' + (kind || ''); clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.className = 'toast ' + (kind || ''); }, 2600); }
  async function copyText(text) { try { await navigator.clipboard.writeText(text); return true; } catch (e) { try { var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); return true; } catch (x) { return false; } } }

  /* ---------------- إقلاع ---------------- */
  async function boot() {
    Api.init();
    // 1) رابط دعوة جديد في العنوان: /agent?key=AGT_xxxxx → يُعتمد فوراً ويحلّ محلّ أي رمز سابق
    var fromUrl = null;
    try {
      var params = new URLSearchParams(location.search);
      fromUrl = params.get('key');
    } catch (e) {}
    if (fromUrl) {
      Api.setToken(fromUrl);
      // إزالة الرمز من عنوان المتصفّح الظاهر (لا يزال محفوظاً في هذا الجهاز) لتقليل تسرّبه عبر النسخ/السجلّ
      try { window.history.replaceState({}, '', location.pathname); } catch (e) {}
    }

    if (!Api.token) return viewInvalidLink();

    try {
      var s = await Api.session();
      if (s.user && s.user.role === 'agent') { state.user = s.user; state.usage = s.usage; return viewPortal(); }
      // رمز صالح شكلياً لكنه ليس لوكيل (لا يُفترض حدوثه) → لا يُسمح بالبوابة
      Api.setToken(null); return viewInvalidLink();
    } catch (e) {
      Api.setToken(null);
      if (e.status === 403) return viewInvalidLink('تم إيقاف حسابك من الإدارة. تواصل معها للحصول على رابط جديد.');
      return viewInvalidLink();
    }
  }

  /* ---------------- رابط غير صالح / مفقود ---------------- */
  function viewInvalidLink(msg) {
    root().className = '';
    root().innerHTML =
      '<div class="auth-wrap"><div class="auth-card">' +
      '<div class="auth-head"><img class="logo" src="./icons/icon-192.png" alt="" />' +
      '<h1>بوابة الوكيل</h1><p>الدخول عبر رابط دعوة خاص من الإدارة</p></div>' +
      '<div class="auth-body">' +
      '<div class="form-error">' + esc(msg || 'الرابط مفقود أو غير صالح. لا يمكن فتح البوابة بدون رابط دعوة صحيح.') + '</div>' +
      '<p class="auth-note">لم يعد الدخول باسم مستخدم وكلمة مرور متاحاً هنا. اطلب رابطك الخاص من الإدارة،<br />وسيكون على الشكل: <span class="mono-cell">/agent?key=AGT_xxxxxxxx</span></p>' +
      '</div></div></div>';
  }
  function logout() {
    Api.setToken(null); state.user = null; state.usage = null;
    toast('تم مسح الجلسة من هذا الجهاز');
    viewInvalidLink('تم مسح الجلسة من هذا الجهاز. استخدم رابطك الخاص للدخول مرة أخرى.');
  }

  /* ---------------- واجهة الوكيل ---------------- */
  function viewPortal() {
    root().className = '';
    var u = state.user, usage = state.usage || {};
    root().innerHTML =
      '<div class="portal-top"><img src="./icons/icon-192.png" alt="" />' +
      '<div class="t"><b>بوابة الوكيل</b><span>' + esc(u.name) + '</span></div>' +
      '<div class="spacer"></div><button class="btn btn-ghost btn-sm" id="out">خروج</button></div>' +
      '<div class="portal-wrap">' +
      infoCard(usage) +
      '<div class="panel" id="genPanel"><div class="panel-head"><h3>إنشاء كود تفعيل</h3></div>' +
      '<div class="panel-body">' + generatorHtml(usage) + '</div></div>' +
      '<div class="panel"><div class="panel-head"><h3>آخر أكوادي</h3><div class="spacer"></div>' +
      '<button class="btn btn-ghost btn-sm" id="refresh">تحديث</button></div>' +
      '<div class="panel-body flush" id="mine"></div></div>' +
      '</div>';
    on(qs('#out'), 'click', logout);
    on(qs('#refresh'), 'click', loadMine);
    bindGenerator();
    loadMine();
  }
  function infoCard(usage) {
    var limit = usage.limit, used = usage.used || 0, rem = usage.remaining;
    var pct = (limit == null || limit === 0) ? 0 : Math.min(100, Math.round((used / limit) * 100));
    return '<div class="panel"><div class="panel-body"><div class="agent-meta">' +
      box('الحد اليومي', limit == null ? '∞' : limit) +
      box('المُستخدم اليوم', used) +
      box('المتبقّي', rem == null ? '∞' : rem, 'rem') +
      '</div>' + (limit == null ? '' : '<div class="limit-bar"><span style="width:' + pct + '%"></span></div>') + '</div></div>';
  }
  function box(l, v, cls) { return '<div class="m ' + (cls || '') + '"><div class="l">' + esc(l) + '</div><div class="v">' + esc(v) + '</div></div>'; }

  function generatorHtml(usage) {
    return '<div class="field"><label>رمز تطبيق العميل (Device ID)</label>' +
      '<input id="dev" class="input mono" placeholder="DS-XXXX-XXXX-XXXX أو DP-XXXX-XXXX-XXXX" autocomplete="off" spellcheck="false" />' +
      '<div class="verify-line idle" id="ver">أدخل رمز الجهاز الظاهر داخل تطبيق العميل.</div></div>' +
      '<div class="row-2">' +
      '<div class="field"><label>التطبيق</label><select id="app" class="input">' +
      '<option value="">— يُكتشف تلقائياً —</option>' +
      '<option value="student">DentPilot Student</option>' +
      '<option value="clinic">DentPilot Clinic</option></select></div>' +
      '<div class="field"><label>مدة الاشتراك (الخطة)</label><select id="dur" class="input"><option value="lifetime">دائم (مدى الحياة)</option></select>' +
      '<div class="hint">الخطط من قاعدة البيانات.</div></div>' +
      '</div>' +
      '<button class="btn btn-primary btn-block" id="gen" disabled>إنشاء الكود</button>' +
      '<div id="lim"></div><div id="out"></div>';
  }
  function updateLimitUI(usage) {
    var box = qs('#lim'), btn = qs('#gen'); if (!box) return;
    if (usage && usage.limit != null && usage.remaining <= 0) {
      box.innerHTML = '<div class="limit-alert"><span>⚠️</span><span>تم الوصول إلى الحد المسموح لإنشاء الأكواد. يرجى التواصل مع الإدارة.</span></div>';
      if (btn) { btn.disabled = true; btn.dataset.limited = '1'; }
    } else { box.innerHTML = ''; if (btn) delete btn.dataset.limited; }
  }
  function bindGenerator() {
    var dev = qs('#dev'), ver = qs('#ver'), app = qs('#app'), btn = qs('#gen'), out = qs('#out');
    var lastValid = null, timer;
    updateLimitUI(state.usage);
    // خطط ديناميكية من قاعدة البيانات
    (async function () { try { var d = await Api.listPlans(); if (d.plans && d.plans.length) { qs('#dur').innerHTML = d.plans.map(function (p) { return '<option value="' + p.id + '">' + p.name + (p.days == null ? '' : ' (' + p.days + ' يوم)') + '</option>'; }).join(''); } } catch (e) {} })();
    function setVer(cls, text) { ver.className = 'verify-line ' + cls; ver.textContent = text; }
    async function doVerify() {
      var v = dev.value.trim(); lastValid = null;
      if (!v) { setVer('idle', 'أدخل رمز الجهاز الظاهر داخل تطبيق العميل.'); btn.disabled = true; return; }
      try {
        var r = await Api.verifyDevice(v);
        if (r.valid) { lastValid = r; dev.classList.remove('invalid'); setVer('ok', '✓ معرّف صالح — التطبيق: ' + (r.app_label || APP_LABELS[r.app])); app.value = r.app; btn.disabled = btn.dataset.limited === '1'; }
        else { dev.classList.add('invalid'); setVer('err', '✕ ' + (r.reason || 'معرّف غير صالح')); btn.disabled = true; }
      } catch (e) { setVer('err', '✕ ' + e.message); btn.disabled = true; }
    }
    on(dev, 'input', function () { dev.classList.remove('invalid'); clearTimeout(timer); timer = setTimeout(doVerify, 320); });
    on(dev, 'blur', doVerify);
    on(btn, 'click', async function () {
      if (btn.dataset.limited === '1') return;
      var device = dev.value.trim(); var a = app.value || (lastValid && lastValid.app);
      if (!a) { toast('اختر التطبيق أو أدخل معرّفاً صالحاً', 'err'); return; }
      btn.disabled = true; var old = btn.textContent; btn.innerHTML = '<span class="spin-inline"></span>';
      try {
        var r = await Api.generateCode({ device_id: device, app: a, duration: qs('#dur').value });
        out.innerHTML = codeResult(r.code);
        on(qs('#copy'), 'click', async function () { if (await copyText(r.code.code)) toast('تم نسخ الكود', 'ok'); });
        toast('تم إنشاء الكود', 'ok');
        if (r.usage) { state.usage = r.usage; refreshInfo(); updateLimitUI(r.usage); }
        loadMine();
        btn.textContent = old; btn.disabled = btn.dataset.limited === '1';
      } catch (e) {
        btn.textContent = old; btn.disabled = false;
        if (e.status === 403 && /الحد/.test(e.message)) { state.usage = { limit: 0, used: 0, remaining: 0 }; updateLimitUI(state.usage); refreshInfo(); }
        out.innerHTML = '<div class="form-error" style="margin-top:14px">' + esc(e.message) + '</div>';
      }
    });
  }
  function refreshInfo() {
    var host = qs('.portal-wrap'); if (!host) return;
    var first = host.querySelector('.panel'); if (first) first.outerHTML = infoCard(state.usage);
  }
  function codeResult(c) {
    return '<div class="code-result">' +
      '<div class="code-chip"><span class="seal">🔒 مربوط بالجهاز</span>' + esc(c.code) + '</div>' +
      '<button class="btn btn-navy btn-block" id="copy" style="margin-top:12px">نسخ الكود</button>' +
      '<div class="code-meta">' +
      '<span>التطبيق: <b>' + esc(c.app_label) + '</b></span>' +
      '<span>الجهاز: <b class="mono-cell">' + esc(c.device_id) + '</b></span>' +
      '<span>التاريخ: <b>' + esc(fmtDate(c.created_at)) + '</b></span></div>' +
      '<div class="hint" style="margin-top:10px">أرسل هذا الكود للعميل ليُدخله في شاشة التفعيل داخل التطبيق.</div></div>';
  }

  async function loadMine() {
    var body = qs('#mine'); if (!body) return;
    body.innerHTML = '<div class="empty"><div class="spin-inline" style="border-color:rgba(11,59,111,.2);border-top-color:var(--navy)"></div><p>جارٍ التحميل…</p></div>';
    try {
      var d = await Api.listCodes(20);
      body.innerHTML = d.codes.length ? mineTable(d.codes) : '<div class="empty"><div class="ic">🔑</div><p>لم تُنشئ أي كود بعد.</p></div>';
      qsa('[data-copy]', body).forEach(function (b) { on(b, 'click', async function () { if (await copyText(b.getAttribute('data-copy'))) toast('تم نسخ الكود', 'ok'); }); });
    } catch (e) { body.innerHTML = '<div class="panel-body"><div class="form-error">' + esc(e.message) + '</div></div>'; }
  }
  function mineTable(codes) {
    return '<div class="table-wrap"><table><thead><tr>' +
      '<th>الكود</th><th>الجهاز</th><th>التطبيق</th><th>التاريخ</th><th></th></tr></thead><tbody>' +
      codes.map(function (c) {
        return '<tr><td class="mono-cell t-strong">' + esc(c.code) + '</td>' +
          '<td class="mono-cell t-muted">' + esc(c.device_id) + '</td>' +
          '<td><span class="badge app-' + esc(c.app) + '">' + esc(c.app_label || APP_LABELS[c.app] || c.app) + '</span></td>' +
          '<td class="t-muted">' + esc(relDay(c.created_at)) + '</td>' +
          '<td><button class="btn btn-ghost btn-sm" data-copy="' + esc(c.code) + '">نسخ</button></td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  boot();
})();
