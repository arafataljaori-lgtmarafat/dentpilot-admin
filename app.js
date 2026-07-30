/* ============================================================
   DentPilot Admin — واجهة التطبيق (Vanilla JS, RTL, PWA)
   موجّه بالهاش + شاشات المصادقة + لوحتا المالك والوكيل.
   ============================================================ */
(function () {
  'use strict';

  const APP_LABELS = { student: 'DentPilot Student', clinic: 'DentPilot Clinic' };
  const DURATIONS = [{ key: 'lifetime', label: 'دائم (مدى الحياة)' }];

  const state = { user: null, usage: null, backend: null };
  const DEMO = !!(window.DP_CONFIG && window.DP_CONFIG.DEMO_MODE);
  const root = () => document.getElementById('app');

  /* ---------------- أدوات مساعدة ---------------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (m) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]
    ));
  }
  function initials(name) {
    const p = String(name || '؟').trim().split(/\s+/);
    return ((p[0] || '')[0] || '') + ((p[1] || '')[0] || '');
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso); if (isNaN(d)) return '—';
    const p = (n) => String(n).padStart(2, '0');
    return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear() + ' · ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function relDay(iso) {
    if (!iso) return '—';
    const d = new Date(iso); if (isNaN(d)) return '—';
    const days = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (days <= 0) return 'اليوم'; if (days === 1) return 'أمس'; if (days < 30) return 'قبل ' + days + ' يوماً';
    return fmtDate(iso).split(' · ')[0];
  }
  let toastTimer;
  function toast(msg, kind) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.className = 'toast show ' + (kind || '');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = 'toast ' + (kind || ''); }, 2600);
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (e) {
      try { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); return true; } catch (x) { return false; }
    }
  }
  function qs(sel, ctx) { return (ctx || document).querySelector(sel); }
  function qsa(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  function on(el, ev, fn) { if (el) el.addEventListener(ev, fn); }
  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }

  /* ---------------- المودال ---------------- */
  function openModal(title, bodyHtml, footHtml) {
    closeModal();
    const back = document.createElement('div');
    back.className = 'modal-back'; back.id = 'modalBack';
    back.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true">' +
      '<div class="modal-head"><h3>' + esc(title) + '</h3><button class="x" id="modalX" aria-label="إغلاق">✕</button></div>' +
      '<div class="modal-body">' + bodyHtml + '</div>' +
      (footHtml ? '<div class="modal-foot">' + footHtml + '</div>' : '') +
      '</div>';
    document.body.appendChild(back);
    on(qs('#modalX'), 'click', closeModal);
    on(back, 'click', (e) => { if (e.target === back) closeModal(); });
    return back;
  }
  function closeModal() { const b = document.getElementById('modalBack'); if (b) b.remove(); }

  /* ============================================================
     الإقلاع + التوجيه
     ============================================================ */
  async function boot() {
    Api.init();
    if (Api.token) {
      try {
        const s = await Api.session();
        state.user = s.user; state.usage = s.usage; state.backend = s.backend;
      } catch (e) { Api.setToken(null); state.user = null; }
    }
    window.addEventListener('hashchange', route);
    route();
  }

  async function route() {
    const hash = location.hash || '';
    // غير مسجّل الدخول
    if (!state.user) {
      if (hash === '#/setup') return viewSetup();
      if (hash === '#/login') return viewLogin();
      // قرّر بين الإعداد والدخول حسب حالة النظام
      try {
        const st = await Api.bootstrapStatus();
        state.backend = st.backend;
        return st.needsSetup ? viewSetup() : viewLogin();
      } catch (e) {
        // لا نُخفي الخطأ الحقيقي (مثل تهيئة قاعدة بيانات ناقصة على الإنتاج)
        return viewLogin(e.message);
      }
    }
    // مسجّل الدخول
    if (state.user.role === 'agent') return viewAgent();          // الوكيل: لوحة واحدة
    // المالك
    const map = {
      '#/dashboard': secDashboard, '#/agents': secAgents, '#/codes': secCodes,
      '#/activations': secActivations, '#/generate': secGenerate,
      '#/support': secSupport, '#/plans': secPlans,
    };
    const sec = map[hash] || secDashboard;
    return renderAdminShell(hash in map ? hash : '#/dashboard', sec);
  }

  /* ============================================================
     شاشة إنشاء المالك (مرّة واحدة)
     ============================================================ */
  function viewSetup() {
    root().className = '';
    root().innerHTML =
      '<div class="auth-wrap"><div class="auth-card">' +
      '<div class="auth-head"><img class="logo" src="/icons/icon-192.png" alt="" />' +
      '<h1>DentPilot Admin</h1><p>الإعداد الأولي — إنشاء حساب المالك</p>' +
      '<span class="badge-setup">يظهر هذا مرّة واحدة فقط</span></div>' +
      '<div class="auth-body">' +
      '<div id="formErr"></div>' +
      '<div class="field"><label>اسم المالك</label><input id="f_name" class="input" placeholder="مثال: د. أحمد" autocomplete="name" /></div>' +
      '<div class="field"><label>اسم المستخدم (للدخول)</label><input id="f_username" class="input" placeholder="admin" autocomplete="username" />' +
      '<div class="hint">أحرف لاتينية وأرقام و(_ .) — من 3 إلى 32.</div></div>' +
      '<div class="field"><label>رقم الجوال (اختياري)</label><input id="f_phone" class="input" placeholder="+9665xxxxxxxx" autocomplete="tel" /></div>' +
      '<div class="field"><label>كلمة المرور</label><input id="f_password" class="input" type="password" placeholder="8 أحرف فأكثر" autocomplete="new-password" /></div>' +
      '<button class="btn btn-primary btn-block" id="submitBtn">إنشاء الحساب والدخول</button>' +
      '<p class="auth-note">قاعدة البيانات: <b>' + esc(backendLabel()) + '</b></p>' +
      '</div></div></div>';

    const submit = async () => {
      const payload = {
        name: qs('#f_name').value, username: qs('#f_username').value,
        phone: qs('#f_phone').value, password: qs('#f_password').value,
      };
      const btn = qs('#submitBtn'); btn.disabled = true; const old = btn.textContent; btn.innerHTML = '<span class="spin-inline"></span>';
      try {
        const r = await Api.createSuperAdmin(payload);
        Api.setToken(r.token); state.user = r.user; state.usage = null;
        toast('تم إنشاء حساب المالك', 'ok'); go('#/dashboard');
      } catch (e) { showFormErr(e.message); btn.disabled = false; btn.textContent = old; }
    };
    on(qs('#submitBtn'), 'click', submit);
    on(qs('#f_password'), 'keydown', (e) => { if (e.key === 'Enter') submit(); });
  }

  /* ============================================================
     شاشة تسجيل الدخول
     ============================================================ */
  function viewLogin(errMsg) {
    root().className = '';
    root().innerHTML =
      '<div class="auth-wrap"><div class="auth-card">' +
      '<div class="auth-head"><img class="logo" src="/icons/icon-192.png" alt="" />' +
      '<h1>DentPilot Admin</h1><p>تسجيل الدخول إلى لوحة التحكم</p></div>' +
      '<div class="auth-body">' +
      '<div id="formErr"></div>' +
      '<div class="field"><label>اسم المستخدم</label><input id="f_username" class="input" placeholder="اسم المستخدم" autocomplete="username" /></div>' +
      '<div class="field"><label>كلمة المرور</label><input id="f_password" class="input" type="password" placeholder="••••••••" autocomplete="current-password" /></div>' +
      '<button class="btn btn-primary btn-block" id="loginBtn">دخول</button>' +
      '</div></div></div>';

    const submit = async () => {
      const btn = qs('#loginBtn'); btn.disabled = true; const old = btn.textContent; btn.innerHTML = '<span class="spin-inline"></span>';
      try {
        const r = await Api.login({ username: qs('#f_username').value, password: qs('#f_password').value });
        Api.setToken(r.token); state.user = r.user;
        const s = await Api.session(); state.usage = s.usage; state.backend = s.backend;
        toast('مرحباً ' + r.user.name, 'ok');
        go(r.user.role === 'agent' ? '#/agent' : '#/dashboard');
      } catch (e) { showFormErr(e.message); btn.disabled = false; btn.textContent = old; }
    };
    on(qs('#loginBtn'), 'click', submit);
    on(qs('#f_password'), 'keydown', (e) => { if (e.key === 'Enter') submit(); });
    if (errMsg) showFormErr(errMsg);
  }

  function showFormErr(msg) {
    const box = qs('#formErr'); if (!box) return;
    box.innerHTML = '<div class="form-error">' + esc(msg) + '</div>';
  }
  function backendLabel() { return state.backend === 'supabase' ? 'Supabase' : 'ملف محلي (تطوير)'; }

  function logout() {
    if (DEMO) { toast('وضع التجربة: تسجيل الدخول معطّل حالياً'); return; }
    Api.setToken(null); state.user = null; state.usage = null; toast('تم تسجيل الخروج'); go('#/login');
  }

  /* ============================================================
     هيكل المالك (Super Admin Shell)
     ============================================================ */
  const NAV = [
    { h: '#/dashboard', ic: '▦', t: 'لوحة المعلومات' },
    { h: '#/support', ic: '🛟', t: 'الدعم والتفعيل' },
    { h: '#/agents', ic: '👥', t: 'الوكلاء' },
    { h: '#/codes', ic: '🔑', t: 'الأكواد' },
    { h: '#/activations', ic: '📲', t: 'التفعيلات' },
    { h: '#/plans', ic: '🗂️', t: 'الخطط' },
    { h: '#/generate', ic: '✨', t: 'توليد كود' },
  ];

  function renderAdminShell(activeHash, sectionFn) {
    root().className = '';
    const navHtml = NAV.map((n) =>
      '<a href="' + n.h + '" class="' + (n.h === activeHash ? 'active' : '') + '"><span class="ic">' + n.ic + '</span>' + esc(n.t) + '</a>'
    ).join('');
    root().innerHTML =
      '<div class="shell" id="shell">' +
      '<div class="scrim" id="scrim"></div>' +
      '<aside class="sidebar">' +
      '<div class="brand"><img src="/icons/icon-192.png" alt="" /><div class="t"><b>DentPilot</b><span>Admin Console</span></div>' +
      '<button class="side-close" id="sideClose" aria-label="إغلاق القائمة">✕</button></div>' +
      '<nav class="nav">' + navHtml + '</nav>' +
      '<div class="foot">' +
      '<div class="who"><div class="av">' + esc(initials(state.user.name)) + '</div>' +
      '<div class="m"><b>' + esc(state.user.name) + '</b><span>' + (DEMO ? 'المالك · وضع تجربة' : 'المالك') + '</span></div></div>' +
      '<button class="btn btn-ghost btn-block btn-sm" id="logoutBtn">' + (DEMO ? 'وضع تجربة (بلا دخول)' : 'تسجيل الخروج') + '</button>' +
      '</div></aside>' +
      '<div class="main">' +
      '<div class="topbar"><button class="burger" id="burger" aria-label="القائمة">☰</button>' +
      '<div><h2 id="secTitle"></h2><div class="sub" id="secSub"></div></div><div class="spacer"></div></div>' +
      '<div class="content" id="secContent"></div>' +
      '</div></div>';

    // إغلاق القائمة عند التنقّل على الجوال
    qsa('.nav a').forEach((a) => on(a, 'click', () => qs('#shell').classList.remove('nav-open')));
    on(qs('#burger'), 'click', () => qs('#shell').classList.toggle('nav-open'));
    on(qs('#scrim'), 'click', () => qs('#shell').classList.remove('nav-open'));
    on(qs('#sideClose'), 'click', () => qs('#shell').classList.remove('nav-open'));
    on(qs('#logoutBtn'), 'click', logout);
    sectionFn();
  }
  function setTitle(t, sub) { const a = qs('#secTitle'), b = qs('#secSub'); if (a) a.textContent = t; if (b) b.textContent = sub || ''; }
  function contentEl() { return qs('#secContent'); }
  function loading() { return '<div class="empty"><div class="spin-inline" style="border-color:rgba(11,59,111,.2);border-top-color:var(--navy)"></div><p>جارٍ التحميل…</p></div>'; }

  /* ---------------- لوحة المعلومات ---------------- */
  async function secDashboard() {
    setTitle('لوحة المعلومات', 'نظرة عامة على النظام');
    contentEl().innerHTML = loading();
    try {
      const d = await Api.stats();
      const c = d.cards;
      const cards =
        card('accent', 'الوكلاء', c.agents, c.active_agents + ' نشِط') +
        card('', 'إجمالي الأكواد', c.codes, 'Student ' + c.by_app.student + ' · Clinic ' + c.by_app.clinic) +
        card('warn', 'أكواد اليوم', c.codes_today, 'خلال اليوم الحالي') +
        card('good', 'التفعيلات', c.activations, 'أجهزة مميّزة');
      const recent = d.recent.length ? tableRecent(d.recent) :
        '<div class="empty"><div class="ic">🗒️</div><p>لا توجد عمليات بعد.</p></div>';
      contentEl().innerHTML =
        '<div class="cards">' + cards + '</div>' +
        '<div class="panel"><div class="panel-head"><h3>آخر العمليات</h3><div class="spacer"></div>' +
        '<a class="btn btn-ghost btn-sm" href="#/codes">عرض الكل</a></div>' +
        '<div class="panel-body flush">' + recent + '</div></div>';
    } catch (e) { contentEl().innerHTML = errBox(e.message); }
  }
  function card(cls, lab, val, meta) {
    return '<div class="stat ' + cls + '"><div class="lab">' + esc(lab) + '</div>' +
      '<div class="val">' + esc(val) + '</div><div class="meta">' + esc(meta || '') + '</div></div>';
  }
  function tableRecent(rows) {
    return '<div class="table-wrap"><table><thead><tr>' +
      '<th>الكود</th><th>الجهاز</th><th>التطبيق</th><th>الوكيل</th><th>الحالة</th><th>التاريخ</th>' +
      '</tr></thead><tbody>' +
      rows.map((r) =>
        '<tr><td class="mono-cell t-strong">' + esc(r.code) + '</td>' +
        '<td class="mono-cell t-muted">' + esc(r.device_id) + '</td>' +
        '<td>' + appBadge(r.app) + '</td>' +
        '<td>' + esc(r.agent_name || '—') + '</td>' +
        '<td>' + statusBadge(r.status) + '</td>' +
        '<td class="t-muted">' + esc(relDay(r.created_at)) + '</td></tr>'
      ).join('') + '</tbody></table></div>';
  }
  function appBadge(app) {
    return '<span class="badge app-' + esc(app) + '">' + esc(APP_LABELS[app] || app) + '</span>';
  }
  function statusBadge(s) {
    if (s === 'revoked') return '<span class="badge rev dot">ملغى</span>';
    return '<span class="badge on dot">نشِط</span>';
  }
  function errBox(msg) { return '<div class="panel"><div class="panel-body"><div class="form-error">' + esc(msg || 'حدث خطأ') + '</div></div></div>'; }

  /* ---------------- الوكلاء ---------------- */
  async function secAgents() {
    setTitle('الوكلاء', 'إدارة حسابات الوكلاء وحدودهم');
    contentEl().innerHTML = loading();
    try {
      const d = await Api.listAgents();
      contentEl().innerHTML =
        '<div class="panel" id="pubPanel"><div class="panel-head"><h3>🎫 صفحة مولّد أكواد الوكيل (عامة)</h3></div>' +
        '<div class="panel-body" id="pubBody">' + loading() + '</div></div>' +
        '<div class="panel"><div class="panel-head"><h3>قائمة الوكلاء (' + d.agents.length + ')</h3>' +
        '<div class="spacer"></div><button class="btn btn-primary btn-sm" id="addAgent">+ إضافة وكيل</button></div>' +
        '<div class="panel-body flush">' + agentsTable(d.agents) + '</div></div>';
      on(qs('#addAgent'), 'click', () => agentModal(null));
      bindAgentActions();
      renderPublicPagePanel();
    } catch (e) { contentEl().innerHTML = errBox(e.message); }
  }
  // لوحة الصفحة العامة: الرابط المباشر (بلا مفتاح) + نسخ + حالة الخدمة والحد اليومي
  async function renderPublicPagePanel() {
    const body = qs('#pubBody'); if (!body) return;
    const url = location.origin + '/agent-generator.html';
    let status = null;
    try { status = await Api.agentPageStatus(); } catch (e) { /* تُعرض الحالة كغير متاحة */ }
    const on_ = status ? status.enabled : true;
    const limit = status ? status.daily_limit : 0;
    const used = status ? status.used_today : 0;
    const statusRow = status
      ? ('<div class="agent-meta" style="margin-top:12px">' +
          '<div class="m"><div class="l">الحالة</div><div class="v">' + (on_ ? '<span class="badge on dot">مفعّلة</span>' : '<span class="badge off dot">موقوفة</span>') + '</div></div>' +
          '<div class="m"><div class="l">الحد اليومي</div><div class="v">' + (limit ? esc(limit) : '∞') + '</div></div>' +
          '<div class="m"><div class="l">المُستخدم اليوم</div><div class="v">' + esc(used) + '</div></div>' +
          '</div>')
      : '<div class="hint" style="margin-top:10px">تعذّر جلب حالة الخدمة الآن.</div>';
    body.innerHTML =
      '<div class="field"><label>الرابط العام (يفتح مباشرة بلا اسم مستخدم أو كلمة مرور)</label>' +
      '<input id="pub_url" class="input mono" readonly value="' + esc(url) + '" /></div>' +
      '<div class="cell-actions">' +
      '<button class="btn btn-primary btn-sm" id="pub_copy">نسخ الرابط</button>' +
      '<a class="btn btn-ghost btn-sm" href="' + esc(url) + '" target="_blank" rel="noopener">فتح الصفحة</a>' +
      '</div>' + statusRow +
      '<div class="hint" style="margin-top:10px">الأكواد المولّدة من هذه الصفحة تُحفظ في نفس جدول الأكواد وتظهر في اللوحة تلقائياً.<br/>' +
      'للتحكّم: عيّن على Netlify متغيّري البيئة <b class="mono-cell">AGENT_PAGE_ENABLED</b> (false للإيقاف) و<b class="mono-cell">AGENT_PAGE_DAILY_LIMIT</b> (الحد اليومي، 0 = بلا حد). ليست تعديلاً على قاعدة البيانات.</div>';
    on(qs('#pub_copy'), 'click', async () => { if (await copyText(url)) toast('تم نسخ الرابط', 'ok'); });
  }
  function agentsTable(agents) {
    if (!agents.length) return '<div class="empty"><div class="ic">👥</div><p>لا يوجد وكلاء. ابدأ بإضافة وكيل.</p></div>';
    return '<div class="table-wrap"><table><thead><tr>' +
      '<th>الاسم</th><th>اسم المستخدم</th><th>الجوال</th><th>الحالة</th><th>الحد اليومي</th><th>اليوم</th><th>آخر نشاط</th><th>إجراءات</th>' +
      '</tr></thead><tbody>' +
      agents.map((a) =>
        '<tr>' +
        '<td class="t-strong">' + esc(a.name) + '</td>' +
        '<td class="mono-cell t-muted">' + esc(a.username) + '</td>' +
        '<td class="t-muted">' + esc(a.phone || '—') + '</td>' +
        '<td>' + (a.active ? '<span class="badge on dot">نشِط</span>' : '<span class="badge off dot">موقوف</span>') + '</td>' +
        '<td>' + esc(a.daily_limit == null ? 'بلا حد' : a.daily_limit) + '</td>' +
        '<td>' + esc(a.used_today == null ? '—' : (a.used_today + (a.daily_limit != null ? ' / ' + a.daily_limit : ''))) + '</td>' +
        '<td class="t-muted">' + esc(relDay(a.last_active_at)) + '</td>' +
        '<td><div class="cell-actions">' +
        '<button class="btn btn-ghost btn-sm" data-edit="' + esc(a.id) + '">تعديل</button>' +
        '<button class="btn btn-ghost btn-sm" data-link="' + esc(a.agent_token || '') + '" data-link-id="' + esc(a.id) + '">' + (a.agent_token ? 'نسخ رابط الدخول' : 'توليد رابط') + '</button>' +
        '<button class="btn btn-ghost btn-sm" data-toggle="' + esc(a.id) + '" data-active="' + (a.active ? '1' : '0') + '">' + (a.active ? 'إيقاف' : 'تفعيل') + '</button>' +
        '<button class="btn btn-danger btn-sm" data-del="' + esc(a.id) + '" data-name="' + esc(a.name) + '">حذف</button>' +
        '</div></td></tr>'
      ).join('') + '</tbody></table></div>';
  }
  let AGENTS_CACHE = [];
  // يبني رابط الدعوة فقط عند وجود رمز حقيقي؛ يعيد null بدل "key=undefined"
  function inviteUrl(token) {
    if (!token || typeof token !== 'string' || token.indexOf('AGT_') !== 0) return null;
    return location.origin + '/agent?key=' + token;
  }
  function bindAgentActions() {
    // خزّن نسخة للوصول السريع عند التعديل
    Api.listAgents().then((d) => { AGENTS_CACHE = d.agents; }).catch(() => {});
    qsa('[data-edit]').forEach((b) => on(b, 'click', () => {
      const id = b.getAttribute('data-edit');
      const a = AGENTS_CACHE.find((x) => x.id === id);
      agentModal(a || { id });
    }));
    qsa('[data-link]').forEach((b) => on(b, 'click', async () => {
      const token = b.getAttribute('data-link');
      const id = b.getAttribute('data-link-id');
      const url = inviteUrl(token);
      if (url) {
        if (await copyText(url)) toast('تم نسخ رابط دخول الوكيل', 'ok');
        return;
      }
      // لا يملك الوكيل رابطاً بعد (حساب قديم) → أصدر له أول رابط
      try {
        const r = await Api.updateAgent({ id, regenerate_token: true });
        const newUrl = inviteUrl(r && r.agent && r.agent.agent_token);
        if (!newUrl) { toast('تعذّر توليد الرمز — تأكّد من تشغيل ترقية قاعدة البيانات (db/schema.sql)', 'err'); return; }
        await copyText(newUrl);
        toast('تم إنشاء رابط الوكيل ونسخه', 'ok');
        secAgents();
      } catch (e) { toast(e.message, 'err'); }
    }));
    qsa('[data-toggle]').forEach((b) => on(b, 'click', async () => {
      const id = b.getAttribute('data-toggle'); const active = b.getAttribute('data-active') === '1';
      try { await Api.updateAgent({ id, active: !active }); toast(active ? 'تم إيقاف الوكيل' : 'تم تفعيل الوكيل', 'ok'); secAgents(); }
      catch (e) { toast(e.message, 'err'); }
    }));
    qsa('[data-del]').forEach((b) => on(b, 'click', () => {
      const id = b.getAttribute('data-del'); const name = b.getAttribute('data-name');
      confirmModal('حذف الوكيل', 'سيتم حذف الوكيل «' + esc(name) + '» نهائياً. الأكواد التي أنشأها تبقى محفوظة. متابعة؟', 'حذف', async () => {
        try { await Api.deleteAgent(id); toast('تم حذف الوكيل', 'ok'); closeModal(); secAgents(); }
        catch (e) { toast(e.message, 'err'); }
      });
    }));
  }
  function agentModal(agent) {
    const editing = agent && agent.name !== undefined;
    const a = agent || {};
    const portalUrl = inviteUrl(a.agent_token) || '';
    const linkField = editing ?
      '<div class="field"><label>رابط دخول الوكيل (دائم)</label>' +
      '<input id="a_link" class="input mono" value="' + esc(portalUrl || 'لا يوجد رابط بعد — اضغط توليد') + '" readonly />' +
      '<div class="cell-actions" style="margin-top:8px">' +
      '<button type="button" class="btn btn-ghost btn-sm" id="a_copyLink"' + (portalUrl ? '' : ' disabled') + '>نسخ الرابط</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" id="a_regenLink">' + (portalUrl ? 'توليد رابط جديد (يُلغي القديم)' : 'توليد أول رابط') + '</button>' +
      '</div>' +
      '<div class="hint">هذا الرابط يفتح بوابة الوكيل مباشرة بلا اسم مستخدم أو كلمة مرور. أرسله للوكيل عبر قناة آمنة.</div></div>' : '';
    const body =
      '<div id="mErr"></div>' +
      '<div class="field"><label>اسم الوكيل</label><input id="a_name" class="input" value="' + esc(a.name || '') + '" placeholder="اسم الوكيل" /></div>' +
      linkField +
      '<div class="row-2">' +
      '<div class="field"><label>اسم المستخدم</label><input id="a_username" class="input mono" value="' + esc(a.username || '') + '" placeholder="agent1" /></div>' +
      '<div class="field"><label>الجوال</label><input id="a_phone" class="input" value="' + esc(a.phone || '') + '" placeholder="+9665…" /></div>' +
      '</div>' +
      '<div class="row-2">' +
      '<div class="field"><label>الحد اليومي</label><input id="a_limit" class="input" type="number" min="0" value="' + esc(a.daily_limit == null ? 10 : a.daily_limit) + '" /></div>' +
      '<div class="field"><label>' + (editing ? 'كلمة مرور جديدة (اختياري)' : 'كلمة المرور') + '</label><input id="a_password" class="input" type="password" placeholder="' + (editing ? 'اتركها فارغة لعدم التغيير' : '6 أحرف فأكثر') + '" /></div>' +
      '</div>' +
      (editing ? '' : '<div class="hint" style="margin-bottom:6px">سيُنشأ رابط دخول دائم للوكيل تلقائياً بعد الإضافة — يظهر في القائمة.</div>');
    const foot = '<button class="btn btn-ghost" id="mCancel">إلغاء</button><button class="btn btn-primary" id="mSave">' + (editing ? 'حفظ التعديلات' : 'إضافة الوكيل') + '</button>';
    openModal(editing ? 'تعديل الوكيل' : 'إضافة وكيل', body, foot);
    on(qs('#mCancel'), 'click', closeModal);
    on(qs('#a_copyLink'), 'click', async () => { if (portalUrl && await copyText(portalUrl)) toast('تم نسخ الرابط', 'ok'); });
    on(qs('#a_regenLink'), 'click', async () => {
      const btn = qs('#a_regenLink'); btn.disabled = true;
      try {
        const r = await Api.updateAgent({ id: a.id, regenerate_token: true });
        const tok = r && r.agent && r.agent.agent_token;
        if (!inviteUrl(tok)) { toast('تعذّر توليد الرمز — تأكّد من تشغيل ترقية قاعدة البيانات (db/schema.sql)', 'err'); btn.disabled = false; return; }
        toast('تم توليد رابط جديد', 'ok');
        closeModal(); agentModal(Object.assign({}, a, r.agent)); // إعادة فتح النافذة بالرابط المحدَّث
      } catch (e) { toast(e.message, 'err'); btn.disabled = false; }
    });
    on(qs('#mSave'), 'click', async () => {
      const payload = {
        name: qs('#a_name').value, username: qs('#a_username').value,
        phone: qs('#a_phone').value, daily_limit: qs('#a_limit').value, password: qs('#a_password').value,
      };
      const btn = qs('#mSave'); btn.disabled = true; const old = btn.textContent; btn.innerHTML = '<span class="spin-inline"></span>';
      try {
        if (editing) { payload.id = a.id; if (!payload.password) delete payload.password; await Api.updateAgent(payload); toast('تم حفظ التعديلات', 'ok'); closeModal(); secAgents(); }
        else {
          const r = await Api.createAgent(payload);
          const url = inviteUrl(r && r.agent && r.agent.agent_token);
          closeModal(); secAgents();
          if (url) inviteLinkModal(r.agent.name, url);
          else toast('تمت إضافة الوكيل (لم يظهر رمز — تأكّد من ترقية قاعدة البيانات)', 'err');
        }
      } catch (e) { qs('#mErr').innerHTML = '<div class="form-error">' + esc(e.message) + '</div>'; btn.disabled = false; btn.textContent = old; }
    });
  }
  // نافذة تعرض رابط دعوة الوكيل الجديد جاهزاً للنسخ
  function inviteLinkModal(name, url) {
    openModal('رابط دخول الوكيل',
      '<p style="margin:0 0 12px;line-height:1.8;color:var(--ink)">تم إنشاء الوكيل «' + esc(name) + '». أرسل له هذا الرابط الدائم للدخول (بلا اسم مستخدم أو كلمة مرور):</p>' +
      '<input id="inv_url" class="input mono" value="' + esc(url) + '" readonly />',
      '<button class="btn btn-ghost" id="inv_close">إغلاق</button><button class="btn btn-primary" id="inv_copy">نسخ الرابط</button>');
    on(qs('#inv_close'), 'click', closeModal);
    on(qs('#inv_copy'), 'click', async () => { if (await copyText(url)) toast('تم نسخ الرابط', 'ok'); });
    const inp = qs('#inv_url'); if (inp) { inp.focus(); inp.select(); }
  }
  function confirmModal(title, html, confirmLabel, onConfirm) {
    openModal(title, '<p style="margin:0;line-height:1.8;color:var(--ink)">' + html + '</p>',
      '<button class="btn btn-ghost" id="cCancel">إلغاء</button><button class="btn btn-danger" id="cOk">' + esc(confirmLabel) + '</button>');
    on(qs('#cCancel'), 'click', closeModal);
    on(qs('#cOk'), 'click', onConfirm);
  }

  /* ---------------- الأكواد ---------------- */
  async function secCodes() {
    setTitle('الأكواد', 'سجلّ أكواد التفعيل المُنشأة');
    contentEl().innerHTML = loading();
    try {
      const d = await Api.listCodes();
      window.__CODES = d.codes;
      contentEl().innerHTML =
        '<div class="panel"><div class="panel-head"><h3>الأكواد (' + d.codes.length + ')</h3><div class="spacer"></div>' +
        '<div class="filters"><input id="codeSearch" class="input" placeholder="بحث بالكود أو الجهاز أو الوكيل…" />' +
        '<select id="codeApp" class="input"><option value="">كل التطبيقات</option><option value="student">Student</option><option value="clinic">Clinic</option></select>' +
        '</div></div><div class="panel-body flush" id="codesBody">' + codesTable(d.codes) + '</div></div>';
      const rerender = () => {
        const q = qs('#codeSearch').value.trim().toLowerCase(); const app = qs('#codeApp').value;
        const rows = window.__CODES.filter((c) =>
          (!app || c.app === app) &&
          (!q || (c.code + ' ' + c.device_id + ' ' + (c.agent_name || '')).toLowerCase().includes(q))
        );
        qs('#codesBody').innerHTML = codesTable(rows); bindCodeActions();
      };
      on(qs('#codeSearch'), 'input', rerender); on(qs('#codeApp'), 'change', rerender);
      bindCodeActions();
    } catch (e) { contentEl().innerHTML = errBox(e.message); }
  }
  function codesTable(codes) {
    if (!codes.length) return '<div class="empty"><div class="ic">🔑</div><p>لا توجد أكواد مطابقة.</p></div>';
    return '<div class="table-wrap"><table><thead><tr>' +
      '<th>كود التفعيل</th><th>رمز الجهاز</th><th>التطبيق</th><th>المدة</th><th>الوكيل</th><th>التاريخ</th><th>الحالة</th><th></th>' +
      '</tr></thead><tbody>' +
      codes.map((c) =>
        '<tr>' +
        '<td class="mono-cell t-strong">' + esc(c.code) + '</td>' +
        '<td class="mono-cell t-muted">' + esc(c.device_id) + '</td>' +
        '<td>' + appBadge(c.app) + '</td>' +
        '<td class="t-muted">' + esc(c.duration_label || 'دائم') + '</td>' +
        '<td>' + esc(c.agent_name || '—') + '</td>' +
        '<td class="t-muted">' + esc(fmtDate(c.created_at)) + '</td>' +
        '<td>' + statusBadge(c.status) + '</td>' +
        '<td><div class="cell-actions">' +
        '<button class="btn btn-ghost btn-sm" data-copy="' + esc(c.code) + '">نسخ</button>' +
        (c.status === 'revoked'
          ? '<button class="btn btn-ghost btn-sm" data-status="active" data-id="' + esc(c.id) + '">استعادة</button>'
          : '<button class="btn btn-danger btn-sm" data-status="revoked" data-id="' + esc(c.id) + '">إلغاء</button>') +
        '</div></td></tr>'
      ).join('') + '</tbody></table></div>';
  }
  function bindCodeActions() {
    qsa('[data-copy]').forEach((b) => on(b, 'click', async () => {
      if (await copyText(b.getAttribute('data-copy'))) toast('تم نسخ الكود', 'ok');
    }));
    qsa('[data-status]').forEach((b) => on(b, 'click', async () => {
      const id = b.getAttribute('data-id'); const status = b.getAttribute('data-status');
      try {
        await Api.setCodeStatus(id, status);
        toast(status === 'revoked' ? 'تم إلغاء الكود' : 'تمت استعادة الكود', 'ok');
        const c = (window.__CODES || []).find((x) => x.id === id); if (c) c.status = status;
        // أعد رسم الصف الحالي
        const app = qs('#codeApp') ? qs('#codeApp').value : ''; const q = qs('#codeSearch') ? qs('#codeSearch').value.trim().toLowerCase() : '';
        const rows = (window.__CODES || []).filter((x) => (!app || x.app === app) && (!q || (x.code + ' ' + x.device_id + ' ' + (x.agent_name || '')).toLowerCase().includes(q)));
        qs('#codesBody').innerHTML = codesTable(rows); bindCodeActions();
      } catch (e) { toast(e.message, 'err'); }
    }));
  }

  /* ---------------- التفعيلات ---------------- */
  async function secActivations() {
    setTitle('التفعيلات', 'الأجهزة التي صدر لها كود تفعيل');
    contentEl().innerHTML = loading();
    try {
      const d = await Api.listActivations();
      const hint = '<div class="section-hint">التطبيقات تعمل دون إنترنت وتتحقّق من الكود محلياً، لذا تعرض هذه القائمة الأجهزة التي <b>صدر لها</b> كود تفعيل (مشتقّة من سجلّ الأكواد)، لا حالة التفعيل الفعلية على الجهاز.</div>';
      contentEl().innerHTML = hint +
        '<div class="panel"><div class="panel-head"><h3>الأجهزة المُفعّلة (' + d.activations.length + ')</h3></div>' +
        '<div class="panel-body flush">' + activationsTable(d.activations) + '</div></div>';
    } catch (e) { contentEl().innerHTML = errBox(e.message); }
  }
  function activationsTable(rows) {
    if (!rows.length) return '<div class="empty"><div class="ic">📲</div><p>لا توجد تفعيلات بعد.</p></div>';
    return '<div class="table-wrap"><table><thead><tr>' +
      '<th>رمز الجهاز</th><th>التطبيق</th><th>أول تفعيل</th><th>عدد الأكواد</th><th>آخر وكيل</th><th>حالة الترخيص</th>' +
      '</tr></thead><tbody>' +
      rows.map((r) =>
        '<tr>' +
        '<td class="mono-cell t-strong">' + esc(r.device_id) + '</td>' +
        '<td>' + appBadge(r.app) + '</td>' +
        '<td class="t-muted">' + esc(fmtDate(r.activated_at)) + '</td>' +
        '<td>' + esc(r.codes_count) + '</td>' +
        '<td>' + esc(r.agent_name || '—') + '</td>' +
        '<td>' + statusBadge(r.latest_status) + '</td></tr>'
      ).join('') + '</tbody></table></div>';
  }

  /* ---------------- توليد كود (للمالك) ---------------- */
  function secGenerate() {
    setTitle('توليد كود', 'إنشاء كود تفعيل لجهاز عميل');
    contentEl().innerHTML =
      '<div class="panel" style="max-width:560px"><div class="panel-head"><h3>مولّد كود التفعيل</h3></div>' +
      '<div class="panel-body">' + generatorHtml() + '</div></div>';
    bindGenerator(contentEl(), null);
  }

  /* ============================================================
     الدعم والتفعيل (Support & Activation)
     ============================================================ */
  const STATUS_LABELS = { active: 'مفعّل', trial: 'تجربة مجانية', expired: 'منتهٍ', suspended: 'موقوف', none: 'غير مفعّل' };
  function actStatusBadge(s) {
    const cls = s === 'active' ? 'on' : (s === 'suspended' || s === 'expired' ? 'off' : 'rev');
    return '<span class="badge ' + cls + ' dot">' + esc(STATUS_LABELS[s] || s) + '</span>';
  }
  function fmtDay(iso) { if (!iso) return '—'; const d = new Date(iso); if (isNaN(d)) return '—'; const p = (n) => String(n).padStart(2, '0'); return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear(); }

  function secSupport() {
    setTitle('الدعم والتفعيل', 'إدارة تفعيل المستخدمين مباشرةً');
    contentEl().innerHTML =
      // تفعيل مباشر
      '<div class="panel"><div class="panel-head"><h3>تفعيل مباشر</h3></div><div class="panel-body">' +
      '<div class="field"><label>رمز الجهاز (Device ID)</label>' +
      '<input id="s_device" class="input mono" placeholder="DS-XXXX-XXXX-XXXX أو DP-XXXX-XXXX-XXXX" autocomplete="off" spellcheck="false" />' +
      '<div class="verify-line idle" id="s_verify">أدخل رمز الجهاز.</div></div>' +
      '<div class="row-2">' +
      '<div class="field"><label>التطبيق</label><select id="s_app" class="input"><option value="">— يُكتشف —</option><option value="student">DentPilot Student</option><option value="clinic">DentPilot Clinic</option></select></div>' +
      '<div class="field"><label>الخطة</label><select id="s_plan" class="input"><option value="">جارٍ التحميل…</option></select></div>' +
      '</div>' +
      '<button class="btn btn-primary btn-block" id="s_activate" disabled>تفعيل الجهاز</button>' +
      '<div id="s_actout"></div>' +
      '<div class="section-hint" style="margin-top:14px">التفعيل المباشر يُنشئ سجلاً حقيقياً ويُصدر الكود المربوط بالجهاز (متوافق مع التطبيق الحالي). عمل التطبيق «بلا إدخال كود» يتطلّب تحديثاً بسيطاً للتطبيق لاحقاً.</div>' +
      '</div></div>' +
      // بحث
      '<div class="panel"><div class="panel-head"><h3>بحث عن مستخدم</h3></div><div class="panel-body">' +
      '<div class="filters"><input id="s_q" class="input" placeholder="ابحث بالـ Device ID أو كود التفعيل…" /><button class="btn btn-navy btn-sm" id="s_search">بحث</button></div>' +
      '<div id="s_results" style="margin-top:14px"></div>' +
      '</div></div>' +
      // سجل العمليات
      '<div class="panel"><div class="panel-head"><h3>سجل عمليات الإدارة</h3><div class="spacer"></div><button class="btn btn-ghost btn-sm" id="s_reflog">تحديث</button></div>' +
      '<div class="panel-body flush" id="s_log">' + loading() + '</div></div>';

    // تحميل الخطط
    fillPlanSelect(qs('#s_plan'));
    // فحص الجهاز للتفعيل المباشر
    const dev = qs('#s_device'), ver = qs('#s_verify'), appSel = qs('#s_app'), btn = qs('#s_activate');
    let timer, valid = null;
    const setVer = (c, t) => { ver.className = 'verify-line ' + c; ver.textContent = t; };
    async function verify() {
      const v = dev.value.trim(); valid = null;
      if (!v) { setVer('idle', 'أدخل رمز الجهاز.'); btn.disabled = true; return; }
      try {
        const r = await Api.verifyDevice(v);
        if (r.valid) { valid = r; dev.classList.remove('invalid'); setVer('ok', '✓ صالح — ' + (r.app_label || r.app)); appSel.value = r.app; btn.disabled = false; }
        else { dev.classList.add('invalid'); setVer('err', '✕ ' + (r.reason || 'غير صالح')); btn.disabled = true; }
      } catch (e) { setVer('err', '✕ ' + e.message); btn.disabled = true; }
    }
    on(dev, 'input', () => { dev.classList.remove('invalid'); clearTimeout(timer); timer = setTimeout(verify, 320); });
    on(dev, 'blur', verify);
    on(btn, 'click', async () => {
      const device = dev.value.trim(); const app = appSel.value || (valid && valid.app); const plan_id = qs('#s_plan').value;
      if (!app) { toast('اختر التطبيق', 'err'); return; }
      if (!plan_id) { toast('اختر الخطة', 'err'); return; }
      btn.disabled = true; const old = btn.textContent; btn.innerHTML = '<span class="spin-inline"></span>';
      try {
        const r = await Api.supportAction({ action: 'activate', device_id: device, app, plan_id });
        qs('#s_actout').innerHTML =
          '<div class="code-result"><div class="code-chip"><span class="seal">🔒 مُفعّل</span>' + esc(r.code) + '</div>' +
          '<button class="btn btn-navy btn-block" id="s_copy" style="margin-top:12px">نسخ الكود</button>' +
          '<div class="code-meta"><span>الحالة: <b>' + esc(STATUS_LABELS[r.activation.effective_status]) + '</b></span>' +
          '<span>الخطة: <b>' + esc(r.activation.plan_name) + '</b></span>' +
          '<span>الانتهاء: <b>' + (r.activation.end_at ? esc(fmtDay(r.activation.end_at)) : 'مدى الحياة') + '</b></span></div></div>';
        on(qs('#s_copy'), 'click', async () => { if (await copyText(r.code)) toast('تم نسخ الكود', 'ok'); });
        toast('تم التفعيل المباشر', 'ok'); loadLog();
        if (qs('#s_q').value.trim()) runSearch();
        btn.textContent = old; btn.disabled = false;
      } catch (e) { btn.textContent = old; btn.disabled = false; qs('#s_actout').innerHTML = '<div class="form-error" style="margin-top:14px">' + esc(e.message) + '</div>'; }
    });

    // بحث
    async function runSearch() {
      const q = qs('#s_q').value.trim(); const box = qs('#s_results');
      if (!q) { box.innerHTML = ''; return; }
      box.innerHTML = loading();
      try {
        const d = await Api.supportSearch(q);
        box.innerHTML = d.results.length ? d.results.map(resultCard).join('') : '<div class="empty"><div class="ic">🔍</div><p>لا نتائج مطابقة.</p></div>';
        bindResultActions();
      } catch (e) { box.innerHTML = errBox(e.message); }
    }
    on(qs('#s_search'), 'click', runSearch);
    on(qs('#s_q'), 'keydown', (e) => { if (e.key === 'Enter') runSearch(); });

    // سجل
    async function loadLog() {
      const box = qs('#s_log'); if (!box) return; box.innerHTML = loading();
      try { const d = await Api.adminLog(30); box.innerHTML = logTable(d.logs); }
      catch (e) { box.innerHTML = errBox(e.message); }
    }
    on(qs('#s_reflog'), 'click', loadLog);
    loadLog();

    // إتاحة الدوال للأزرار داخل النتائج
    window.__supportRefresh = runSearch;
  }
  function resultCard(a) {
    const manageable = !!a.id; // سجلّات التفعيل المباشر فقط قابلة للإدارة
    const actions = manageable ?
      '<div class="cell-actions" style="margin-top:10px">' +
      '<button class="btn btn-ghost btn-sm" data-ext="' + esc(a.device_id) + '" data-app="' + esc(a.app) + '">تمديد</button>' +
      '<button class="btn btn-ghost btn-sm" data-chg="' + esc(a.device_id) + '" data-app="' + esc(a.app) + '">تغيير الخطة</button>' +
      (a.effective_status === 'suspended'
        ? '<button class="btn btn-ghost btn-sm" data-react="' + esc(a.device_id) + '" data-app="' + esc(a.app) + '">إعادة التفعيل</button>'
        : '<button class="btn btn-danger btn-sm" data-susp="' + esc(a.device_id) + '" data-app="' + esc(a.app) + '">إيقاف</button>') +
      '</div>'
      : '<div class="hint" style="margin-top:8px">هذا سجلّ صادر عبر كود. للإدارة الكاملة (تمديد/إيقاف) اضغط «تفعيل مباشر» لنفس الجهاز.</div>';
    return '<div class="panel" style="margin-bottom:12px"><div class="panel-body">' +
      '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
      appBadge(a.app) + actStatusBadge(a.effective_status) +
      '<span class="mono-cell t-strong">' + esc(a.device_id) + '</span></div>' +
      '<div class="code-meta" style="margin-top:10px">' +
      '<span>الخطة: <b>' + esc(a.plan_name || '—') + '</b></span>' +
      '<span>البداية: <b>' + esc(fmtDay(a.start_at)) + '</b></span>' +
      '<span>الانتهاء: <b>' + (a.end_at ? esc(fmtDay(a.end_at)) : 'مدى الحياة') + '</b></span>' +
      (a.code ? '<span>الكود: <b class="mono-cell">' + esc(a.code) + '</b></span>' : '') +
      '</div>' + actions + '</div></div>';
  }
  function bindResultActions() {
    const act = async (device, app, action, extra) => {
      try { await Api.supportAction(Object.assign({ action, device_id: device, app }, extra || {})); toast('تم', 'ok'); if (window.__supportRefresh) window.__supportRefresh(); }
      catch (e) { toast(e.message, 'err'); }
    };
    qsa('[data-susp]').forEach((b) => on(b, 'click', () => act(b.getAttribute('data-susp'), b.getAttribute('data-app'), 'suspend')));
    qsa('[data-react]').forEach((b) => on(b, 'click', () => act(b.getAttribute('data-react'), b.getAttribute('data-app'), 'reactivate')));
    qsa('[data-ext]').forEach((b) => on(b, 'click', () => {
      const device = b.getAttribute('data-ext'), app = b.getAttribute('data-app');
      openModal('تمديد الاشتراك', '<div class="field"><label>عدد الأيام</label><input id="ext_days" class="input" type="number" min="1" value="30" /></div>',
        '<button class="btn btn-ghost" id="ext_c">إلغاء</button><button class="btn btn-primary" id="ext_ok">تمديد</button>');
      on(qs('#ext_c'), 'click', closeModal);
      on(qs('#ext_ok'), 'click', async () => { const days = parseInt(qs('#ext_days').value, 10); closeModal(); await act(device, app, 'extend', { days }); });
    }));
    qsa('[data-chg]').forEach((b) => on(b, 'click', async () => {
      const device = b.getAttribute('data-chg'), app = b.getAttribute('data-app');
      openModal('تغيير الخطة', '<div class="field"><label>الخطة الجديدة</label><select id="chg_plan" class="input"><option>جارٍ التحميل…</option></select></div>',
        '<button class="btn btn-ghost" id="chg_c">إلغاء</button><button class="btn btn-primary" id="chg_ok">تغيير</button>');
      await fillPlanSelect(qs('#chg_plan'));
      on(qs('#chg_c'), 'click', closeModal);
      on(qs('#chg_ok'), 'click', async () => { const plan_id = qs('#chg_plan').value; closeModal(); await act(device, app, 'change_plan', { plan_id }); });
    }));
  }
  function logTable(logs) {
    if (!logs || !logs.length) return '<div class="empty"><div class="ic">🗒️</div><p>لا عمليات بعد.</p></div>';
    const A = { activate: 'تفعيل', extend: 'تمديد', change_plan: 'تغيير خطة', suspend: 'إيقاف', reactivate: 'إعادة تفعيل', plan_create: 'إنشاء خطة', plan_update: 'تعديل خطة', plan_delete: 'حذف خطة' };
    return '<div class="table-wrap"><table><thead><tr><th>العملية</th><th>الجهاز</th><th>التفاصيل</th><th>بواسطة</th><th>التاريخ</th></tr></thead><tbody>' +
      logs.map((l) => '<tr><td class="t-strong">' + esc(A[l.action] || l.action) + '</td>' +
        '<td class="mono-cell t-muted">' + esc(l.device_id || '—') + '</td>' +
        '<td class="t-muted">' + esc(l.details || '—') + '</td>' +
        '<td>' + esc(l.actor_name || '—') + '</td>' +
        '<td class="t-muted">' + esc(fmtDate(l.created_at)) + '</td></tr>').join('') +
      '</tbody></table></div>';
  }

  /* ============================================================
     الخطط (Plans)
     ============================================================ */
  async function secPlans() {
    setTitle('الخطط', 'خطط الاشتراك الديناميكية');
    contentEl().innerHTML = loading();
    try {
      const d = await Api.listPlans(true); // كل الخطط للمالك
      contentEl().innerHTML =
        '<div class="section-hint">الخطط تظهر تلقائياً في مولّد الأكواد والتفعيل المباشر. «عدد الأيام» فارغ = مدى الحياة. المدة تُسجَّل كبيانات؛ فرضها داخل التطبيق يتطلّب تحديث التطبيق.</div>' +
        '<div class="panel"><div class="panel-head"><h3>الخطط (' + d.plans.length + ')</h3><div class="spacer"></div>' +
        '<button class="btn btn-primary btn-sm" id="p_add">+ إضافة خطة</button></div>' +
        '<div class="panel-body flush">' + plansTable(d.plans) + '</div></div>';
      on(qs('#p_add'), 'click', () => planModal(null));
      bindPlanActions();
    } catch (e) { contentEl().innerHTML = errBox(e.message); }
  }
  function plansTable(plans) {
    if (!plans.length) return '<div class="empty"><div class="ic">🗂️</div><p>لا خطط.</p></div>';
    return '<div class="table-wrap"><table><thead><tr><th>الاسم</th><th>المدة</th><th>الحالة</th><th>الترتيب</th><th>إجراءات</th></tr></thead><tbody>' +
      plans.map((p) => '<tr><td class="t-strong">' + esc(p.name) + '</td>' +
        '<td>' + (p.days == null ? 'مدى الحياة' : esc(p.days) + ' يوم') + '</td>' +
        '<td>' + (p.active ? '<span class="badge on dot">فعّالة</span>' : '<span class="badge off dot">موقوفة</span>') + '</td>' +
        '<td class="t-muted">' + esc(p.sort) + '</td>' +
        '<td><div class="cell-actions">' +
        '<button class="btn btn-ghost btn-sm" data-pedit="' + esc(p.id) + '">تعديل</button>' +
        '<button class="btn btn-ghost btn-sm" data-ptoggle="' + esc(p.id) + '" data-active="' + (p.active ? '1' : '0') + '">' + (p.active ? 'إيقاف' : 'تفعيل') + '</button>' +
        '<button class="btn btn-danger btn-sm" data-pdel="' + esc(p.id) + '" data-name="' + esc(p.name) + '">حذف</button>' +
        '</div></td></tr>').join('') + '</tbody></table></div>';
  }
  let PLANS_CACHE = [];
  function bindPlanActions() {
    Api.listPlans(true).then((d) => { PLANS_CACHE = d.plans; }).catch(() => {});
    qsa('[data-pedit]').forEach((b) => on(b, 'click', () => { const p = PLANS_CACHE.find((x) => x.id === b.getAttribute('data-pedit')); planModal(p || null); }));
    qsa('[data-ptoggle]').forEach((b) => on(b, 'click', async () => {
      try { await Api.updatePlan({ id: b.getAttribute('data-ptoggle'), active: b.getAttribute('data-active') !== '1' }); toast('تم', 'ok'); secPlans(); } catch (e) { toast(e.message, 'err'); }
    }));
    qsa('[data-pdel]').forEach((b) => on(b, 'click', () => {
      confirmModal('حذف الخطة', 'حذف الخطة «' + esc(b.getAttribute('data-name')) + '»؟ لن يؤثر على الأكواد المُصدرة سابقاً.', 'حذف', async () => {
        try { await Api.deletePlan(b.getAttribute('data-pdel')); toast('تم الحذف', 'ok'); closeModal(); secPlans(); } catch (e) { toast(e.message, 'err'); }
      });
    }));
  }
  function planModal(plan) {
    const editing = !!plan; const p = plan || {};
    const body = '<div id="pErr"></div>' +
      '<div class="field"><label>اسم الخطة</label><input id="p_name" class="input" value="' + esc(p.name || '') + '" placeholder="مثال: سنوي" /></div>' +
      '<div class="row-2">' +
      '<div class="field"><label>عدد الأيام</label><input id="p_days" class="input" type="number" min="0" value="' + esc(p.days == null ? '' : p.days) + '" placeholder="فارغ = مدى الحياة" /></div>' +
      '<div class="field"><label>الترتيب</label><input id="p_sort" class="input" type="number" value="' + esc(p.sort == null ? 99 : p.sort) + '" /></div>' +
      '</div>';
    openModal(editing ? 'تعديل خطة' : 'إضافة خطة', body,
      '<button class="btn btn-ghost" id="p_cancel">إلغاء</button><button class="btn btn-primary" id="p_save">' + (editing ? 'حفظ' : 'إضافة') + '</button>');
    on(qs('#p_cancel'), 'click', closeModal);
    on(qs('#p_save'), 'click', async () => {
      const daysVal = qs('#p_days').value.trim();
      const payload = { name: qs('#p_name').value, days: daysVal === '' ? null : parseInt(daysVal, 10), sort: parseInt(qs('#p_sort').value, 10) };
      try {
        if (editing) { payload.id = p.id; await Api.updatePlan(payload); } else await Api.createPlan(payload);
        toast('تم الحفظ', 'ok'); closeModal(); secPlans();
      } catch (e) { qs('#pErr').innerHTML = '<div class="form-error">' + esc(e.message) + '</div>'; }
    });
  }

  /* ============================================================
     لوحة الوكيل (Agent)
     ============================================================ */
  async function viewAgent() {
    root().className = '';
    // حدّث بيانات الجلسة (الحد/الاستهلاك)
    try { const s = await Api.session(); state.user = s.user; state.usage = s.usage; state.backend = s.backend; } catch (e) {}
    const u = state.user, usage = state.usage || {};
    root().innerHTML =
      '<div class="shell agent"><div class="main">' +
      '<div class="topbar"><img src="/icons/icon-192.png" width="30" height="30" style="border-radius:8px" alt="" />' +
      '<div><h2>DentPilot Admin</h2><div class="sub">لوحة الوكيل</div></div>' +
      '<div class="spacer"></div><button class="btn btn-ghost btn-sm" id="agentLogout">خروج</button></div>' +
      '<div class="content">' +
      agentInfoCard(u, usage) +
      '<div class="panel" id="genPanel"><div class="panel-head"><h3>توليد كود التفعيل</h3></div>' +
      '<div class="panel-body">' + generatorHtml(usage) + '</div></div>' +
      '<div class="panel"><div class="panel-head"><h3>آخر أكوادي</h3><div class="spacer"></div>' +
      '<button class="btn btn-ghost btn-sm" id="refreshMine">تحديث</button></div>' +
      '<div class="panel-body flush" id="mineBody">' + loading() + '</div></div>' +
      '</div></div></div>';
    on(qs('#agentLogout'), 'click', logout);
    on(qs('#refreshMine'), 'click', loadMine);
    bindGenerator(qs('#genPanel'), () => { refreshAgentUsage(); loadMine(); });
    loadMine();
  }
  function agentInfoCard(u, usage) {
    const limit = usage.limit; const used = usage.used || 0; const rem = usage.remaining;
    const pct = (limit == null || limit === 0) ? 0 : Math.min(100, Math.round((used / limit) * 100));
    return '<div class="panel"><div class="panel-head"><h3>مرحباً، ' + esc(u.name) + '</h3>' +
      '<div class="spacer"></div>' + (u.active ? '<span class="badge on dot">نشِط</span>' : '') + '</div>' +
      '<div class="panel-body"><div class="agent-meta">' +
      metaBox('الحد اليومي', limit == null ? '∞' : limit) +
      metaBox('المُستخدم اليوم', used) +
      metaBox('المتبقّي', rem == null ? '∞' : rem, 'rem') +
      '</div>' + (limit == null ? '' : '<div class="limit-bar"><span style="width:' + pct + '%"></span></div>') + '</div></div>';
  }
  function metaBox(l, v, cls) { return '<div class="m ' + (cls || '') + '"><div class="l">' + esc(l) + '</div><div class="v">' + esc(v) + '</div></div>'; }

  async function refreshAgentUsage() {
    try {
      const s = await Api.session(); state.usage = s.usage; state.user = s.user;
      const host = qs('.content'); if (!host) return;
      // أعد رسم بطاقة المعلومات وحدّث حالة زر التوليد
      const first = host.querySelector('.panel'); if (first) first.outerHTML = agentInfoCard(state.user, state.usage);
      updateGenLimitUI(state.usage);
    } catch (e) {}
  }
  async function loadMine() {
    const body = qs('#mineBody'); if (!body) return; body.innerHTML = loading();
    try {
      const d = await Api.listCodes(20);
      body.innerHTML = d.codes.length ? myCodesTable(d.codes) :
        '<div class="empty"><div class="ic">🔑</div><p>لم تُنشئ أي كود بعد.</p></div>';
      qsa('[data-copy]', body).forEach((b) => on(b, 'click', async () => { if (await copyText(b.getAttribute('data-copy'))) toast('تم نسخ الكود', 'ok'); }));
    } catch (e) { body.innerHTML = errBox(e.message); }
  }
  function myCodesTable(codes) {
    return '<div class="table-wrap"><table><thead><tr>' +
      '<th>الكود</th><th>الجهاز</th><th>التطبيق</th><th>التاريخ</th><th></th>' +
      '</tr></thead><tbody>' +
      codes.map((c) =>
        '<tr><td class="mono-cell t-strong">' + esc(c.code) + '</td>' +
        '<td class="mono-cell t-muted">' + esc(c.device_id) + '</td>' +
        '<td>' + appBadge(c.app) + '</td>' +
        '<td class="t-muted">' + esc(relDay(c.created_at)) + '</td>' +
        '<td><button class="btn btn-ghost btn-sm" data-copy="' + esc(c.code) + '">نسخ</button></td></tr>'
      ).join('') + '</tbody></table></div>';
  }

  /* ============================================================
     المولّد المشترك (Device → Verify → App → Generate)
     ============================================================ */
  function generatorHtml(usage) {
    const limited = usage && usage.limit != null && usage.remaining <= 0;
    return '<div class="gen">' +
      '<div class="field"><label>رمز تطبيق العميل (Device ID)</label>' +
      '<input id="g_device" class="input mono" placeholder="DS-XXXX-XXXX-XXXX أو DP-XXXX-XXXX-XXXX" autocomplete="off" spellcheck="false" />' +
      '<div class="verify-line idle" id="g_verify">أدخل رمز الجهاز الظاهر داخل تطبيق العميل.</div></div>' +
      '<div class="row-2">' +
      '<div class="field"><label>التطبيق</label><select id="g_app" class="input">' +
      '<option value="">— يُكتشف تلقائياً —</option>' +
      '<option value="student">DentPilot Student</option>' +
      '<option value="clinic">DentPilot Clinic</option></select></div>' +
      '<div class="field"><label>مدة الاشتراك (الخطة)</label><select id="g_dur" class="input"><option value="lifetime">دائم (مدى الحياة)</option></select>' +
      '<div class="hint">الخطط من قاعدة البيانات. المدة تُسجَّل كبيانات؛ التطبيق الحالي لا يفرض انتهاءً إلا بعد تحديثه.</div></div>' +
      '</div>' +
      '<button class="btn btn-primary btn-block" id="g_btn" disabled>إنشاء كود التفعيل</button>' +
      '<div id="g_limit"></div>' +
      '<div id="g_out"></div>' +
      '</div>';
  }
  // يملأ قائمة الخطط من قاعدة البيانات (قيمة الخيار = معرّف الخطة)
  async function fillPlanSelect(sel) {
    if (!sel) return;
    try {
      const d = await Api.listPlans();
      if (d.plans && d.plans.length) {
        sel.innerHTML = d.plans.map((p) => '<option value="' + esc(p.id) + '">' + esc(p.name) + (p.days == null ? '' : ' (' + p.days + ' يوم)') + '</option>').join('');
      }
    } catch (e) { /* يبقى الخيار الافتراضي lifetime */ }
  }
  function updateGenLimitUI(usage) {
    const box = document.getElementById('g_limit'); const btn = document.getElementById('g_btn');
    if (!box) return;
    if (usage && usage.limit != null && usage.remaining <= 0) {
      box.innerHTML = '<div class="limit-alert"><span>⚠️</span><span>تم الوصول إلى الحد المسموح لإنشاء الأكواد. يرجى التواصل مع الإدارة.</span></div>';
      if (btn) { btn.disabled = true; btn.dataset.limited = '1'; }
    } else {
      box.innerHTML = ''; if (btn) delete btn.dataset.limited;
    }
  }

  function bindGenerator(scope, onGenerated) {
    const dev = qs('#g_device', scope), verify = qs('#g_verify', scope), appSel = qs('#g_app', scope),
      btn = qs('#g_btn', scope), out = qs('#g_out', scope);
    let lastValid = null; let timer;

    // حالة الحد للوكيل
    updateGenLimitUI(state.usage);
    fillPlanSelect(qs('#g_dur', scope)); // خطط ديناميكية من قاعدة البيانات

    function setVerify(cls, text) { verify.className = 'verify-line ' + cls; verify.textContent = text; }

    async function doVerify() {
      const v = dev.value.trim();
      lastValid = null;
      if (!v) { setVerify('idle', 'أدخل رمز الجهاز الظاهر داخل تطبيق العميل.'); btn.disabled = true; return; }
      try {
        const r = await Api.verifyDevice(v);
        if (r.valid) {
          lastValid = r; dev.classList.remove('invalid');
          setVerify('ok', '✓ معرّف صالح — التطبيق: ' + (r.app_label || APP_LABELS[r.app]));
          appSel.value = r.app;
          btn.disabled = btn.dataset.limited === '1';
        } else {
          dev.classList.add('invalid');
          setVerify('err', '✕ ' + (r.reason || 'معرّف غير صالح'));
          btn.disabled = true;
        }
      } catch (e) { setVerify('err', '✕ ' + e.message); btn.disabled = true; }
    }
    on(dev, 'input', () => { dev.classList.remove('invalid'); clearTimeout(timer); timer = setTimeout(doVerify, 320); });
    on(dev, 'blur', doVerify);

    on(btn, 'click', async () => {
      if (btn.dataset.limited === '1') return;
      const device = dev.value.trim();
      let app = appSel.value || (lastValid && lastValid.app);
      if (!app) { toast('اختر التطبيق أو أدخل معرّفاً صالحاً', 'err'); return; }
      btn.disabled = true; const old = btn.textContent; btn.innerHTML = '<span class="spin-inline"></span>';
      try {
        const durVal = qs('#g_dur', scope).value;
        const payload = { device_id: device, app };
        if (durVal && durVal !== 'lifetime') payload.plan_id = durVal; else payload.duration = 'lifetime';
        const r = await Api.generateCode(payload);
        out.innerHTML = codeResult(r.code);
        on(qs('#g_copy', scope), 'click', async () => { if (await copyText(r.code.code)) toast('تم نسخ الكود', 'ok'); });
        toast('تم إنشاء الكود', 'ok');
        if (r.usage) { state.usage = r.usage; updateGenLimitUI(r.usage); }
        if (typeof onGenerated === 'function') onGenerated();
        btn.textContent = old; btn.disabled = btn.dataset.limited === '1' ? true : false;
      } catch (e) {
        btn.textContent = old; btn.disabled = false;
        if (e.status === 403 && /الحد/.test(e.message)) { updateGenLimitUI({ limit: 0, remaining: 0, used: 0 }); }
        out.innerHTML = '<div class="form-error" style="margin-top:14px">' + esc(e.message) + '</div>';
      }
    });
  }
  function codeResult(c) {
    return '<div class="code-result">' +
      '<div class="code-chip"><span class="seal">🔒 مربوط بالجهاز</span>' + esc(c.code) + '</div>' +
      '<button class="btn btn-navy btn-block" id="g_copy" style="margin-top:12px">نسخ الكود</button>' +
      '<div class="code-meta">' +
      '<span>التطبيق: <b>' + esc(c.app_label) + '</b></span>' +
      '<span>الجهاز: <b class="mono-cell">' + esc(c.device_id) + '</b></span>' +
      '<span>المدة: <b>' + esc(c.duration_label) + '</b></span>' +
      '<span>التاريخ: <b>' + esc(fmtDate(c.created_at)) + '</b></span>' +
      '</div>' +
      '<div class="hint" style="margin-top:10px">أرسل هذا الكود للعميل ليُدخله في شاشة التفعيل داخل التطبيق. يعمل على هذا الجهاز فقط ودون إنترنت.</div>' +
      '</div>';
  }

  /* ---------------- بدء ---------------- */
  boot();
})();
