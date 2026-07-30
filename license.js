/* ============================================================
   DentPilot Admin — محرّك التراخيص
   --------------------------------------------------------------
   هذا الملف منسوخ حرفياً من نظام التفعيل الأصلي داخل تطبيقات
   DentPilot (activation.js) ومن ملفّي مولّد الأكواد الحاليين،
   بدون أي تعديل في الخوارزمية.

   الفرق الوحيد بين التطبيقين:
     - Student  : يُدرج PRODUCT_ID = "DENTPILOT_STUDENT" داخل الهاش.
     - Clinic   : لا يُدرج أي PRODUCT_ID (كما في license-generator-1.html).

   الكود ناتج حتمي (deterministic) من معرّف الجهاز فقط:
     - لا يحتوي على مدة اشتراك ولا تاريخ انتهاء.
     - التفعيل دائم ومربوط بالجهاز (device-locked).
   لذلك أي كود يُولَّد هنا يعمل مباشرة داخل التطبيقات الحالية
   دون أي تعديل عليها.
   ============================================================ */
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

// السرّ المضمَّن (مطابق تماماً للموجود داخل التطبيقات ومولّدات الأكواد الحالية)
function _sx() {
  var p = [30, 10, 36, 99, 34, 105, 11, 49, 123, 55, 0, 5, 40, 110, 14, 121, 22, 51, 57, 4, 25, 53, 40, 63, 126, 104, 106, 104, 108, 124, 59, 11], m = 0x5A, s = '';
  for (var i = 0; i < p.length; i++) s += String.fromCharCode(p[i] ^ m);
  return s;
}

function _nrm(id) { return String(id || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }

// -------- خوارزمية Student (مع PRODUCT_ID) --------
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

// -------- خوارزمية Clinic (بدون PRODUCT_ID) --------
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

const APPS = {
  student: { key: 'student', label: 'DentPilot Student', prefix: 'DS', licenseFor: licenseForStudent },
  clinic:  { key: 'clinic',  label: 'DentPilot Clinic',  prefix: 'DP', licenseFor: licenseForClinic  },
};

// المدد المدعومة فعلياً داخل التطبيقات: التفعيل دائم فقط (لا مدة داخل الكود).
const DURATIONS = [
  { key: 'lifetime', label: 'دائم (مدى الحياة)' },
];

/**
 * توليد كود التفعيل لتطبيق مُحدَّد بناءً على معرّف الجهاز.
 * يستخدم نفس الخوارزمية الأصلية بحيث يعمل الكود داخل التطبيق مباشرة.
 */
function generateCode(app, deviceId) {
  const a = APPS[app];
  if (!a) throw new Error('تطبيق غير معروف');
  return a.licenseFor(deviceId);
}

/**
 * التحقق من صحة معرّف الجهاز واكتشاف التطبيق المناسب من البادئة.
 * يعيد: { valid, app, prefix, normalized, reason }
 */
function inspectDevice(deviceId) {
  const norm = _nrm(deviceId);
  if (!norm) return { valid: false, reason: 'أدخل معرّف الجهاز.' };
  let detected = null;
  for (const key of Object.keys(APPS)) {
    if (norm.startsWith(APPS[key].prefix)) { detected = key; break; }
  }
  if (!detected) {
    return { valid: false, normalized: norm, reason: 'البادئة غير معروفة. يجب أن يبدأ المعرّف بـ DS (طالب) أو DP (عيادة).' };
  }
  const body = norm.slice(2);
  // 12 حرفاً من أبجدية base32 (بدون I,L,O,U) بعد البادئة
  const okLen = body.length === 12;
  const okChars = /^[0-9A-HJ-NP-TV-Z]+$/.test(body);
  if (!okLen || !okChars) {
    return { valid: false, app: detected, prefix: APPS[detected].prefix, normalized: norm,
      reason: 'صيغة المعرّف غير مكتملة. المتوقع: ' + APPS[detected].prefix + '-XXXX-XXXX-XXXX' };
  }
  return { valid: true, app: detected, prefix: APPS[detected].prefix, normalized: norm };
}

module.exports = {
  sha256, _sx, _nrm,
  licenseForStudent, licenseForClinic,
  APPS, DURATIONS,
  generateCode, inspectDevice,
};
