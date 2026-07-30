'use strict';
/* ============================================================
   محوّل Netlify — يلفّ معالجات /api الحالية (بصيغة req,res على نمط
   Vercel/Node) داخل صيغة دوال Netlify (event → {statusCode,headers,body}).
   لا يغيّر أي منطق: نفس المعالجات، نفس قاعدة البيانات، نفس المصادقة
   والصلاحيات والحدود. يعيد فقط تشكيل الطلب/الاستجابة.
   ============================================================ */
module.exports = function adapt(handler) {
  return async function (event) {
    // ---- بناء كائن req مطابق لما تتوقّعه المعالجات ----
    const method = (event && event.httpMethod) || 'GET';
    const qs = (event && event.queryStringParameters) || {};
    const queryStr = Object.keys(qs)
      .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(qs[k]))
      .join('&');
    const path = (event && event.path) || '/';
    const url = path + (queryStr ? '?' + queryStr : '');

    // الترويسات (بمفاتيح صغيرة كما في Node)
    const headers = {};
    const src = (event && event.headers) || {};
    for (const k in src) headers[k.toLowerCase()] = src[k];

    // الجسم: Netlify يعطيه كنص (قد يكون Base64) → نحوّله لكائن مُحلَّل
    let body = {};
    if (event && event.body) {
      const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
      try { body = raw ? JSON.parse(raw) : {}; } catch (e) { body = {}; }
    }

    const req = { method, url, headers, body, on: function () {} };

    // ---- كائن res يلتقط الاستجابة ----
    const res = {
      statusCode: 200,
      _headers: {},
      _body: '',
      setHeader(k, v) { this._headers[k] = v; },
      end(d) { this._body = d == null ? '' : String(d); },
    };

    try {
      await handler(req, res);
    } catch (e) {
      return { statusCode: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify({ error: e.message || 'خطأ في الخادم' }) };
    }

    return { statusCode: res.statusCode || 200, headers: res._headers, body: res._body };
  };
};
