'use strict';
/* دالة Netlify: تعيد استخدام معالج api/plans.js دون تغيير في المنطق. */
const adapt = require('../lib/adapter');
exports.handler = adapt(require('../../api/plans.js'));
