'use strict';
/* دالة Netlify: تعيد استخدام معالج api/device-status.js دون تغيير في المنطق. */
const adapt = require('../lib/adapter');
exports.handler = adapt(require('../../api/device-status.js'));
