'use strict';
/* دالة Netlify: تعيد استخدام معالج api/adminlog.js دون تغيير في المنطق. */
const adapt = require('../lib/adapter');
exports.handler = adapt(require('../../api/adminlog.js'));
