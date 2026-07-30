'use strict';
/* أدوات HTTP مشتركة تعمل على Vercel (req,res) وعلى خادم التطوير المحلي. */

function setCommonHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function sendJson(res, status, obj) {
  setCommonHeaders(res);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}

function ok(res, obj) { sendJson(res, 200, obj || { ok: true }); }
function bad(res, message, status) { sendJson(res, status || 400, { error: message || 'طلب غير صالح' }); }
function unauthorized(res, message) { sendJson(res, 401, { error: message || 'غير مصرّح' }); }
function forbidden(res, message) { sendJson(res, 403, { error: message || 'ليس لديك صلاحية' }); }
function notFound(res, message) { sendJson(res, 404, { error: message || 'غير موجود' }); }

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return await new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

function handleOptions(req, res) {
  if (req.method === 'OPTIONS') { setCommonHeaders(res); res.statusCode = 204; res.end(); return true; }
  return false;
}

function getQuery(req) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const q = {};
    url.searchParams.forEach((v, k) => { q[k] = v; });
    return q;
  } catch (e) { return {}; }
}

module.exports = { sendJson, ok, bad, unauthorized, forbidden, notFound, readJson, handleOptions, getQuery, setCommonHeaders };
