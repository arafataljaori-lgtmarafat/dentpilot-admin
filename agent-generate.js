'use strict';
/* دالة Netlify: تعيد استخدام معالج api/agent-generate.js دون تغيير في المنطق. */
const adapt = require('../lib/adapter');
exports.handler = adapt(require('../../api/agent-generate.js'));
