'use strict';
/* GET /api/stats  (Super Admin) — بطاقات لوحة المعلومات وآخر العمليات */
const { ok, bad, handleOptions } = require('./_lib/util');
const { requireAdmin } = require('./_lib/guard');
const { APPS } = require('./_lib/license');
const db = require('./_lib/db');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') return bad(res, 'طريقة غير مدعومة', 405);
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const agents = await db.listUsers({ role: 'agent' });
    const codes = await db.listCodes({});
    const since = db.startOfTodayISO();

    const usedToday = codes.filter(c => String(c.created_at) >= since).length;
    const activeAgents = agents.filter(a => a.active !== false).length;

    // أجهزة مميّزة = تفعيلات
    const devices = new Set();
    let student = 0, clinic = 0;
    for (const c of codes) {
      devices.add((c.device_id_norm || c.device_id || '') + '|' + c.app);
      if (c.app === 'student') student++; else if (c.app === 'clinic') clinic++;
    }

    const recent = codes.slice(0, 8).map(c => ({
      code: c.code, device_id: c.device_id, app: c.app,
      app_label: (APPS[c.app] && APPS[c.app].label) || c.app,
      agent_name: c.agent_name, status: c.status || 'active', created_at: c.created_at,
    }));

    return ok(res, {
      cards: {
        agents: agents.length, active_agents: activeAgents,
        codes: codes.length, codes_today: usedToday,
        activations: devices.size,
        by_app: { student, clinic },
      },
      recent,
    });
  } catch (e) {
    return bad(res, e.message || 'خطأ في الخادم', e.status || 500);
  }
};
