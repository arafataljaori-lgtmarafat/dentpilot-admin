'use strict';
/* ============================================================
   خادم تطوير محلّي — لتشغيل واختبار المشروع بدون Vercel/Supabase.
   يشغّل نفس دوال /api المستخدمة على Vercel، ويقدّم الملفات الثابتة.
   التشغيل:  node server.js   ثم افتح http://localhost:3000
   يستخدم قاعدة بيانات ملفّية محلية (.data/db.json) تلقائياً.
   ============================================================ */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.map': 'application/json',
};

// خريطة المسارات -> ملفات الدوال في /api
const ROUTES = {
  '/api/health': './api/health.js',
  '/api/bootstrap': './api/bootstrap.js',
  '/api/login': './api/login.js',
  '/api/session': './api/session.js',
  '/api/agents': './api/agents.js',
  '/api/codes': './api/codes.js',
  '/api/activations': './api/activations.js',
  '/api/stats': './api/stats.js',
  '/api/plans': './api/plans.js',
  '/api/support': './api/support.js',
  '/api/adminlog': './api/adminlog.js',
  '/api/device-status': './api/device-status.js',
  '/api/agent-generate': './api/agent-generate.js',
};

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  if (urlPath === '/agent' || urlPath === '/agent/') urlPath = '/agent.html';
  if (urlPath === '/agent-generator' || urlPath === '/agent-generator/') urlPath = '/agent-generator.html';
  const filePath = path.join(ROOT, urlPath.replace(/^\/+/, ''));
  if (!filePath.startsWith(ROOT)) { res.statusCode = 403; res.end('forbidden'); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // احتياطي: أعد index.html للمسارات غير الموجودة (تنقّل داخلي)
      fs.readFile(path.join(ROOT, 'index.html'), (e2, html) => {
        if (e2) { res.statusCode = 404; res.end('not found'); return; }
        res.setHeader('Content-Type', MIME['.html']); res.end(html);
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const pathname = req.url.split('?')[0];
  const routeFile = ROUTES[pathname];
  if (routeFile) {
    try {
      const handler = require(routeFile);
      await handler(req, res);
    } catch (e) {
      res.statusCode = 500; res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: e.message || 'server error' }));
    }
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  const db = require('./api/_lib/db');
  console.log('DentPilot Admin — خادم محلي يعمل على  http://localhost:' + PORT);
  console.log('قاعدة البيانات: ' + (db.usingSupabase ? 'Supabase (REST)' : 'ملف محلي (.data/db.json)'));
});
