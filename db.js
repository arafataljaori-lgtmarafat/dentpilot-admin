'use strict';
/* ============================================================
   طبقة الوصول للبيانات (Data Access Layer)
   --------------------------------------------------------------
   واجهة موحّدة لها تنفيذان:
     1) Supabase عبر REST (PostgREST) — للإنتاج. يُفعَّل تلقائياً
        عند وجود SUPABASE_URL و SUPABASE_SERVICE_KEY.
     2) ملف JSON محلي (.data/db.json) — للتطوير والاختبار بدون
        أي إعداد. يُفعَّل تلقائياً عند غياب متغيّرات Supabase.

   الجداول: users, codes  (انظر db/schema.sql)
   ============================================================ */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const USE_SUPABASE = !!(SUPABASE_URL && SUPABASE_KEY);

// بيئة Serverless (Vercel/AWS): نظام الملفات للقراءة فقط ومؤقّت وغير مشترك بين
// الاستدعاءات، لذا لا يصلح تخزيناً دائماً. في هذه الحالة يجب استخدام Supabase.
const IS_SERVERLESS = !!(process.env.VERCEL || process.env.AWS_REGION || process.env.NOW_REGION || process.env.LAMBDA_TASK_ROOT);

// حدود إعادة ضبط العدّاد اليومي (بالدقائق). الافتراضي +03:00 (توقيت الخليج).
const DAY_OFFSET_MIN = parseInt(process.env.DAY_RESET_OFFSET_MINUTES || '180', 10);

function newId() { return crypto.randomUUID(); }

/** بداية "اليوم" الحالي بتوقيت العدّاد، كسلسلة ISO (UTC). */
function startOfTodayISO() {
  const now = Date.now();
  const shifted = now + DAY_OFFSET_MIN * 60000;
  const d = new Date(shifted);
  const dayStartShifted = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return new Date(dayStartShifted - DAY_OFFSET_MIN * 60000).toISOString();
}

/* ================= Supabase (REST) ================= */
async function sb(pathAndQuery, opts = {}) {
  const url = SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/' + pathAndQuery;
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
    'Content-Type': 'application/json',
  };
  if (opts.prefer) headers['Prefer'] = opts.prefer;
  const res = await fetch(url, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
  if (!res.ok) {
    const msg = (json && (json.message || json.error || json.hint)) || text || ('HTTP ' + res.status);
    const err = new Error('Supabase: ' + msg); err.status = res.status; throw err;
  }
  return json;
}

const supabaseBackend = {
  kind: 'supabase',
  async listUsers(filter = {}) {
    let q = 'users?select=*&order=created_at.asc';
    if (filter.role) q += '&role=eq.' + encodeURIComponent(filter.role);
    return (await sb(q)) || [];
  },
  async getUserById(id) {
    const r = await sb('users?select=*&id=eq.' + encodeURIComponent(id) + '&limit=1');
    return (r && r[0]) || null;
  },
  async getUserByUsername(username) {
    const r = await sb('users?select=*&username=eq.' + encodeURIComponent(username) + '&limit=1');
    return (r && r[0]) || null;
  },
  async getUserByAgentToken(token) {
    if (!token) return null;
    const r = await sb('users?select=*&agent_token=eq.' + encodeURIComponent(token) + '&limit=1');
    return (r && r[0]) || null;
  },
  async insertUser(u) {
    const row = { id: u.id || newId(), created_at: new Date().toISOString(), ...u };
    const r = await sb('users', { method: 'POST', body: row, prefer: 'return=representation' });
    return (r && r[0]) || row;
  },
  async updateUser(id, patch) {
    const r = await sb('users?id=eq.' + encodeURIComponent(id), { method: 'PATCH', body: patch, prefer: 'return=representation' });
    return (r && r[0]) || null;
  },
  async deleteUser(id) {
    await sb('users?id=eq.' + encodeURIComponent(id), { method: 'DELETE', prefer: 'return=minimal' });
    return true;
  },
  async listCodes(filter = {}) {
    let q = 'codes?select=*&order=created_at.desc';
    if (filter.agentId) q += '&agent_id=eq.' + encodeURIComponent(filter.agentId);
    if (filter.limit) q += '&limit=' + parseInt(filter.limit, 10);
    return (await sb(q)) || [];
  },
  async insertCode(c) {
    const row = { id: c.id || newId(), created_at: new Date().toISOString(), status: 'active', ...c };
    const r = await sb('codes', { method: 'POST', body: row, prefer: 'return=representation' });
    return (r && r[0]) || row;
  },
  async updateCode(id, patch) {
    const r = await sb('codes?id=eq.' + encodeURIComponent(id), { method: 'PATCH', body: patch, prefer: 'return=representation' });
    return (r && r[0]) || null;
  },
  async countCodesToday(agentId) {
    const since = startOfTodayISO();
    const r = await sb('codes?select=id&agent_id=eq.' + encodeURIComponent(agentId) + '&created_at=gte.' + encodeURIComponent(since));
    return (r || []).length;
  },
  async countPublicCodesToday() {
    const since = startOfTodayISO();
    const r = await sb('codes?select=id&agent_id=is.null&created_at=gte.' + encodeURIComponent(since));
    return (r || []).length;
  },
  // فحص اتصال حيّ يتأكّد من الوصول للجداول بمفتاح service_role
  async ping() {
    await sb('users?select=id&limit=1');
    await sb('codes?select=id&limit=1');
    return { ok: true };
  },
  // فحص كتابة: يكشف حالة استخدام مفتاح anon (RLS يسمح بالقراءة الفارغة لكن يمنع الكتابة)
  async probeWrite() {
    const id = newId();
    const row = { id, code: 'HEALTHCHECK', device_id: 'DS-HEALTH-0000-0000', device_id_norm: 'DSHEALTH00000000',
      app: 'student', duration: 'lifetime', agent_id: null, agent_name: '__healthcheck__', status: 'active',
      created_at: new Date().toISOString() };
    await sb('codes', { method: 'POST', body: row, prefer: 'return=minimal' });
    try { await sb('codes?id=eq.' + encodeURIComponent(id), { method: 'DELETE', prefer: 'return=minimal' }); } catch (e) {}
    return { ok: true };
  },
};

/* ================= File backend (محلي) ================= */
const DATA_DIR = path.join(process.cwd(), '.data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

function fileLoad() {
  try {
    if (!fs.existsSync(DB_FILE)) return { users: [], codes: [] };
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) { return { users: [], codes: [] }; }
}
function fileSave(db) {
  try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }
  catch (e) { /* ignore */ }
}

const fileBackend = {
  kind: 'file',
  async listUsers(filter = {}) {
    const db = fileLoad();
    let arr = db.users.slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    if (filter.role) arr = arr.filter(u => u.role === filter.role);
    return arr;
  },
  async getUserById(id) { return fileLoad().users.find(u => u.id === id) || null; },
  async getUserByUsername(username) {
    const un = String(username || '').toLowerCase();
    return fileLoad().users.find(u => String(u.username).toLowerCase() === un) || null;
  },
  async getUserByAgentToken(token) {
    if (!token) return null;
    return fileLoad().users.find(u => u.agent_token === token) || null;
  },
  async insertUser(u) {
    const db = fileLoad();
    const row = { id: u.id || newId(), created_at: new Date().toISOString(), ...u };
    db.users.push(row); fileSave(db); return row;
  },
  async updateUser(id, patch) {
    const db = fileLoad(); const i = db.users.findIndex(u => u.id === id);
    if (i < 0) return null; db.users[i] = { ...db.users[i], ...patch }; fileSave(db); return db.users[i];
  },
  async deleteUser(id) {
    const db = fileLoad(); db.users = db.users.filter(u => u.id !== id); fileSave(db); return true;
  },
  async listCodes(filter = {}) {
    const db = fileLoad();
    let arr = db.codes.slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    if (filter.agentId) arr = arr.filter(c => c.agent_id === filter.agentId);
    if (filter.limit) arr = arr.slice(0, parseInt(filter.limit, 10));
    return arr;
  },
  async insertCode(c) {
    const db = fileLoad();
    const row = { id: c.id || newId(), created_at: new Date().toISOString(), status: 'active', ...c };
    db.codes.push(row); fileSave(db); return row;
  },
  async updateCode(id, patch) {
    const db = fileLoad(); const i = db.codes.findIndex(c => c.id === id);
    if (i < 0) return null; db.codes[i] = { ...db.codes[i], ...patch }; fileSave(db); return db.codes[i];
  },
  async countCodesToday(agentId) {
    const since = startOfTodayISO();
    return fileLoad().codes.filter(c => c.agent_id === agentId && String(c.created_at) >= since).length;
  },
  async countPublicCodesToday() {
    const since = startOfTodayISO();
    return fileLoad().codes.filter(c => (c.agent_id == null) && String(c.created_at) >= since).length;
  },
  async ping() {
    // تأكّد أن الكتابة على القرص متاحة فعلاً (تفشل على أنظمة الملفات للقراءة فقط)
    const db = fileLoad(); fileSave(db);
    if (!fs.existsSync(DB_FILE)) throw new Error('تعذّرت الكتابة على القرص (نظام ملفات للقراءة فقط).');
    return { ok: true };
  },
};

/* ================= Backend مُعطّل (تهيئة ناقصة على الإنتاج) =================
   يُستخدم فقط عندما نكون في بيئة Serverless بلا Supabase — حيث لا يوجد تخزين
   دائم متاح. يرمي كل استدعاء رسالة واضحة بدل الفشل الصامت. */
const CONFIG_MSG = 'قاعدة البيانات غير مُهيّأة للإنتاج. أضِف SUPABASE_URL و SUPABASE_SERVICE_KEY في متغيّرات البيئة على Vercel ثم أعِد النشر. (نظام ملفات Vercel للقراءة فقط، لذا لا يصلح للتخزين الدائم.)';
function configErr() { const e = new Error(CONFIG_MSG); e.status = 503; e.code = 'DB_NOT_CONFIGURED'; return e; }
const misconfiguredBackend = {
  kind: 'unconfigured',
  async listUsers() { throw configErr(); },
  async getUserById() { throw configErr(); },
  async getUserByUsername() { throw configErr(); },
  async getUserByAgentToken() { throw configErr(); },
  async insertUser() { throw configErr(); },
  async updateUser() { throw configErr(); },
  async deleteUser() { throw configErr(); },
  async listCodes() { throw configErr(); },
  async insertCode() { throw configErr(); },
  async updateCode() { throw configErr(); },
  async countCodesToday() { throw configErr(); },
  async countPublicCodesToday() { throw configErr(); },
  async ping() { throw configErr(); },
};

/* ===== مساعدات جداول عامة للجداول الجديدة فقط: plans, device_activations, admin_log =====
   لا تمسّ الجداول أو الدوال الحالية (users, codes). */
function buildQ(table, filters, order, limit) {
  let q = table + '?select=*';
  (filters || []).forEach((f) => { q += '&' + encodeURIComponent(f.col) + '=' + f.op + '.' + encodeURIComponent(f.val); });
  if (order) q += '&order=' + order;
  if (limit) q += '&limit=' + parseInt(limit, 10);
  return q;
}
function matchFilters(row, filters) {
  return (filters || []).every((f) => {
    const cell = row[f.col];
    if (f.op === 'eq') return String(cell) === String(f.val);
    if (f.op === 'ilike') return String(cell == null ? '' : cell).toLowerCase().includes(String(f.val).replace(/%/g, '').toLowerCase());
    if (f.op === 'gte') return String(cell) >= String(f.val);
    if (f.op === 'lte') return String(cell) <= String(f.val);
    return true;
  });
}
const genericSupabase = {
  async tList(table, o = {}) { return (await sb(buildQ(table, o.filters, o.order, o.limit))) || []; },
  async tGet(table, id) { const r = await sb(table + '?select=*&id=eq.' + encodeURIComponent(id) + '&limit=1'); return (r && r[0]) || null; },
  async tFindOne(table, filters) { const r = await sb(buildQ(table, filters, null, 1)); return (r && r[0]) || null; },
  async tInsert(table, row) { const full = { id: row.id || newId(), created_at: new Date().toISOString(), ...row }; const r = await sb(table, { method: 'POST', body: full, prefer: 'return=representation' }); return (r && r[0]) || full; },
  async tUpdate(table, id, patch) { const r = await sb(table + '?id=eq.' + encodeURIComponent(id), { method: 'PATCH', body: patch, prefer: 'return=representation' }); return (r && r[0]) || null; },
  async tDelete(table, id) { await sb(table + '?id=eq.' + encodeURIComponent(id), { method: 'DELETE', prefer: 'return=minimal' }); return true; },
};
const genericFile = {
  async tList(table, o = {}) {
    const dbx = fileLoad(); let arr = (dbx[table] || []).filter((r) => matchFilters(r, o.filters));
    if (o.order) { const [col, dir] = o.order.split('.'); arr.sort((a, b) => String(a[col]).localeCompare(String(b[col])) * (dir === 'desc' ? -1 : 1)); }
    if (o.limit) arr = arr.slice(0, parseInt(o.limit, 10));
    return arr;
  },
  async tGet(table, id) { return (fileLoad()[table] || []).find((r) => r.id === id) || null; },
  async tFindOne(table, filters) { return (fileLoad()[table] || []).find((r) => matchFilters(r, filters)) || null; },
  async tInsert(table, row) { const dbx = fileLoad(); if (!dbx[table]) dbx[table] = []; const full = { id: row.id || newId(), created_at: new Date().toISOString(), ...row }; dbx[table].push(full); fileSave(dbx); return full; },
  async tUpdate(table, id, patch) { const dbx = fileLoad(); if (!dbx[table]) dbx[table] = []; const i = dbx[table].findIndex((r) => r.id === id); if (i < 0) return null; dbx[table][i] = { ...dbx[table][i], ...patch }; fileSave(dbx); return dbx[table][i]; },
  async tDelete(table, id) { const dbx = fileLoad(); if (dbx[table]) dbx[table] = dbx[table].filter((r) => r.id !== id); fileSave(dbx); return true; },
};
const genericMisconfigured = {
  async tList() { throw configErr(); }, async tGet() { throw configErr(); }, async tFindOne() { throw configErr(); },
  async tInsert() { throw configErr(); }, async tUpdate() { throw configErr(); }, async tDelete() { throw configErr(); },
};

let backend, generic;
if (USE_SUPABASE) { backend = supabaseBackend; generic = genericSupabase; }
else if (IS_SERVERLESS) { backend = misconfiguredBackend; generic = genericMisconfigured; }  // إنتاج بلا Supabase → خطأ واضح
else { backend = fileBackend; generic = genericFile; }                                        // تطوير محلّي → ملف

module.exports = Object.assign({}, backend, generic, {
  backendKind: backend.kind,
  usingSupabase: USE_SUPABASE,
  isServerless: IS_SERVERLESS,
  hasSupabaseUrl: !!SUPABASE_URL,
  hasSupabaseKey: !!SUPABASE_KEY,
  configError: (!USE_SUPABASE && IS_SERVERLESS) ? CONFIG_MSG : null,
  newId,
  startOfTodayISO,
  DAY_OFFSET_MIN,
});
