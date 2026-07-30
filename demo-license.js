/* ============================================================
   DentPilot Admin — محرّك التراخيص (نسخة المتصفّح لوضع التجربة)
   --------------------------------------------------------------
   نفس خوارزمية api/_lib/license.js حرفياً، لتعمل الأكواد المولّدة في
   وضع التجربة داخل التطبيقات الحالية دون تعديل. تُستخدم فقط عندما
   DEMO_MODE = true (توليد من جهة المتصفّح بلا خادم).
   ============================================================ */
(function () {
  'use strict';
  function sha256(ascii) {
    function rr(v, a) { return (v >>> a) | (v << (32 - a)); }
    var maxWord = Math.pow(2, 32), result = '';
    var words = [], asciiBitLength = ascii.length * 8;
    var hash = sha256.h = sha256.h || [], k = sha256.k = sha256.k || [], primeCounter = k.length;
    var isComposite = {};
    for (var candidate = 2; primeCounter < 64; candidate++) {
      if (!isComposite[candidate]) {
        for (var i = 0; i < 313; i += candidate) { isComposite[i] = candidate; }
        hash[primeCounter] = (Math.pow(candidate, .5) * maxWord) | 0;
        k[primeCounter++] = (Math.pow(candidate, 1 / 3) * maxWord) | 0;
      }
    }
    ascii += '\x80';
    while (ascii.length % 64 - 56) ascii += '\x00';
    for (i = 0; i < ascii.length; i++) {
      var j = ascii.charCodeAt(i);
      if (j >> 8) return;
      words[i >> 2] |= j << ((3 - i) % 4) * 8;
    }
    words[words.length] = ((asciiBitLength / maxWord) | 0);
    words[words.length] = (asciiBitLength);
    for (j = 0; j < words.length;) {
      var w = words.slice(j, j += 16), oldHash = hash;
      hash = hash.slice(0, 8);
      for (i = 0; i < 64; i++) {
        var w15 = w[i - 15], w2 = w[i - 2];
        var a = hash[0], e = hash[4];
        var temp1 = hash[7] + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & hash[5]) ^ ((~e) & hash[6])) + k[i]
          + (w[i] = (i < 16) ? w[i] : (w[i - 16] + (rr(w15, 7) ^ rr(w15, 18) ^ (w15 >>> 3)) + w[i - 7] + (rr(w2, 17) ^ rr(w2, 19) ^ (w2 >>> 10))) | 0);
        var temp2 = (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(temp1 + temp2) | 0].concat(hash); hash[4] = (hash[4] + temp1) | 0;
      }
      for (i = 0; i < 8; i++) { hash[i] = (hash[i] + oldHash[i]) | 0; }
    }
    for (i = 0; i < 8; i++) { for (j = 3; j + 1; j--) { var b = (hash[i] >> (j * 8)) & 255; result += ((b < 16) ? 0 : '') + b.toString(16); } }
    return result;
  }
  function _sx() {
    var p = [30, 10, 36, 99, 34, 105, 11, 49, 123, 55, 0, 5, 40, 110, 14, 121, 22, 51, 57, 4, 25, 53, 40, 63, 126, 104, 106, 104, 108, 124, 59, 11], m = 0x5A, s = '';
    for (var i = 0; i < p.length; i++) s += String.fromCharCode(p[i] ^ m);
    return s;
  }
  function _nrm(id) { return String(id || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }

  function licenseForStudent(id) {
    var PRODUCT_ID = 'DENTPILOT_STUDENT';
    var s = _sx(), n = _nrm(id);
    if (!n) return '';
    var h = sha256(s + '::' + PRODUCT_ID + '::' + n + '::' + s);
    for (var i = 0; i < 512; i++) { h = sha256(h + n + s + PRODUCT_ID + i); }
    var A = '0123456789ABCDEFGHJKMNPQRSTVWXYZ', out = '';
    for (i = 0; i < 15; i++) { var v = parseInt(h.substr(i * 2, 2), 16); out += A.charAt(v & 31); }
    var sum = 0; for (i = 0; i < out.length; i++) sum = (sum * 33 + out.charCodeAt(i)) >>> 0;
    out += A.charAt(sum % 32);
    return out.replace(/(....)(....)(....)(....)/, '$1-$2-$3-$4');
  }
  function licenseForClinic(id) {
    var s = _sx(), n = _nrm(id);
    if (!n) return '';
    var h = sha256(s + '::' + n + '::' + s);
    for (var i = 0; i < 512; i++) { h = sha256(h + n + s + i); }
    var A = '0123456789ABCDEFGHJKMNPQRSTVWXYZ', out = '';
    for (i = 0; i < 15; i++) { var v = parseInt(h.substr(i * 2, 2), 16); out += A.charAt(v & 31); }
    var sum = 0; for (i = 0; i < out.length; i++) sum = (sum * 33 + out.charCodeAt(i)) >>> 0;
    out += A.charAt(sum % 32);
    return out.replace(/(....)(....)(....)(....)/, '$1-$2-$3-$4');
  }

  var APPS = {
    student: { key: 'student', label: 'DentPilot Student', prefix: 'DS', licenseFor: licenseForStudent },
    clinic:  { key: 'clinic',  label: 'DentPilot Clinic',  prefix: 'DP', licenseFor: licenseForClinic  },
  };

  function generateCode(app, deviceId) {
    var a = APPS[app]; if (!a) throw new Error('تطبيق غير معروف');
    return a.licenseFor(deviceId);
  }
  function inspectDevice(deviceId) {
    var norm = _nrm(deviceId);
    if (!norm) return { valid: false, reason: 'أدخل معرّف الجهاز.' };
    var detected = null;
    for (var key in APPS) { if (norm.indexOf(APPS[key].prefix) === 0) { detected = key; break; } }
    if (!detected) return { valid: false, normalized: norm, reason: 'البادئة غير معروفة. يجب أن يبدأ المعرّف بـ DS (طالب) أو DP (عيادة).' };
    var body = norm.slice(2);
    if (body.length !== 12 || !/^[0-9A-HJ-NP-TV-Z]+$/.test(body)) {
      return { valid: false, app: detected, prefix: APPS[detected].prefix, normalized: norm,
        reason: 'صيغة المعرّف غير مكتملة. المتوقع: ' + APPS[detected].prefix + '-XXXX-XXXX-XXXX' };
    }
    return { valid: true, app: detected, prefix: APPS[detected].prefix, normalized: norm };
  }

  window.DemoLicense = { _nrm: _nrm, APPS: APPS, generateCode: generateCode, inspectDevice: inspectDevice };
})();
