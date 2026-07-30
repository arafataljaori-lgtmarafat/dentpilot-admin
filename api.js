/* عميل الـ API — يغلّف fetch ويحفظ رمز الجلسة فقط (وليس أي بيانات) */
const TOKEN_KEY = 'dp_admin_token';

const Api = {
  token: null,
  init() { try { this.token = localStorage.getItem(TOKEN_KEY) || null; } catch (e) { this.token = null; } },
  setToken(t) { this.token = t; try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (e) {} },

  async req(path, { method = 'GET', body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = 'Bearer ' + this.token;
    let res;
    try {
      res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch (e) {
      throw new ApiError('تعذّر الاتصال بالخادم. تحقّق من الشبكة.', 0);
    }
    let data = null;
    const text = await res.text();
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
    if (!res.ok) {
      const msg = (data && data.error) || ('خطأ (' + res.status + ')');
      throw new ApiError(msg, res.status);
    }
    return data;
  },

  // نقاط النهاية
  health() { return this.req('/api/health'); },
  bootstrapStatus() { return this.req('/api/bootstrap'); },
  createSuperAdmin(payload) { return this.req('/api/bootstrap', { method: 'POST', body: payload }); },
  login(payload) { return this.req('/api/login', { method: 'POST', body: payload }); },
  session() { return this.req('/api/session'); },

  listAgents() { return this.req('/api/agents'); },
  createAgent(p) { return this.req('/api/agents', { method: 'POST', body: p }); },
  updateAgent(p) { return this.req('/api/agents', { method: 'PATCH', body: p }); },
  deleteAgent(id) { return this.req('/api/agents', { method: 'DELETE', body: { id } }); },

  verifyDevice(device) { return this.req('/api/codes?action=verify&device=' + encodeURIComponent(device)); },
  listCodes(limit) { return this.req('/api/codes' + (limit ? ('?limit=' + limit) : '')); },
  generateCode(p) { return this.req('/api/codes', { method: 'POST', body: p }); },
  setCodeStatus(id, status) { return this.req('/api/codes', { method: 'PATCH', body: { id, status } }); },

  listActivations() { return this.req('/api/activations'); },
  stats() { return this.req('/api/stats'); },

  // التوسعة: الخطط + الدعم والتفعيل + سجل الإدارة
  listPlans(all) { return this.req('/api/plans' + (all ? '?all=1' : '')); },
  createPlan(p) { return this.req('/api/plans', { method: 'POST', body: p }); },
  updatePlan(p) { return this.req('/api/plans', { method: 'PATCH', body: p }); },
  deletePlan(id) { return this.req('/api/plans', { method: 'DELETE', body: { id } }); },
  supportSearch(q) { return this.req('/api/support?q=' + encodeURIComponent(q)); },
  supportAction(p) { return this.req('/api/support', { method: 'POST', body: p }); },
  adminLog(limit) { return this.req('/api/adminlog' + (limit ? ('?limit=' + limit) : '')); },
  agentPageStatus() { return this.req('/api/agent-generate'); },
};

class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}
