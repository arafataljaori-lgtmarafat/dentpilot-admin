'use strict';
/* دالة Netlify: تعيد استخدام معالج api/session.js الحالي دون أي تعديل في المنطق. */
const adapt = require('../lib/adapter');
exports.handler = adapt(require('../../api/session.js'));
