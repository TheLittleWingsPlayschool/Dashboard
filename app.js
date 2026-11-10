/*!
 * The Little Wings Play School — Admin & Classes Dashboard
 * Plain static app: no build step, no server, no external dependencies.
 * All data is stored in this browser's localStorage (keys prefixed "lw_").
 */
(function () {
  'use strict';

  var APP_VERSION = '1.0.0';
  var TZ = 'Asia/Kolkata';

  var CLASSES = [
    { id: 'toddlers', name: 'Toddlers', ages: '1.5–3 yrs', color: '#ffc93c', emoji: '🐣' },
    { id: 'nursery', name: 'Nursery', ages: '3–4 yrs', color: '#38a8e0', emoji: '🌱' },
    { id: 'lkg', name: 'LKG', ages: '4–5 yrs', color: '#ff7a6b', emoji: '🎨' },
    { id: 'ukg', name: 'UKG', ages: '5–6 yrs', color: '#6cc48a', emoji: '🚀' }
  ];
  var CLASS_BY_ID = {};
  CLASSES.forEach(function (c) { CLASS_BY_ID[c.id] = c; });

  var ATT = {
    P: { label: 'Present', cls: 'p' },
    A: { label: 'Absent', cls: 'a' },
    L: { label: 'Leave', cls: 'l' },
    H: { label: 'Half-day', cls: 'h' }
  };
  var ATT_KEYS = ['P', 'A', 'L', 'H'];
  var PAY_MODES = ['Cash', 'UPI', 'Bank'];
  var ENQ_SOURCES = ['Website', 'WhatsApp', 'Walk-in', 'Instagram', 'Referral', 'Google'];
  var ENQ_STATUS = ['New', 'Visited', 'Admitted', 'Not interested'];
  var ENQ_COLORS = { 'New': '#38a8e0', 'Visited': '#ffc93c', 'Admitted': '#6cc48a', 'Not interested': '#c9ced6' };
  var STAFF_ROLES = ['Teacher', 'Assistant teacher', 'Ayah / Helper', 'Admin / Office', 'Driver', 'Other'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var DEFAULT_SETTINGS = {
    schoolName: 'The Little Wings Play School',
    address: '1st Floor, DBR Kota complex, AG & SG College Rd, Vuyyuru, Andhra Pradesh 521165',
    phone: '+91 79955 54105',
    email: '',
    owner: 'Hidayatulla',
    receiptPrefix: 'LW',
    receiptSeq: 1,
    feesStartMonth: '',
    classTeachers: {}
  };

  /* =====================================================================
   * DATA LAYER — the only place that touches storage.
   * To add cloud sync later, replace load/save (or use subscribe()) here.
   * ===================================================================== */
  var Store = (function () {
    var PREFIX = 'lw_';
    var TABLES = ['settings', 'auth', 'users', 'students', 'attendance', 'payments', 'enquiries', 'staff'];
    var listeners = [];
    function clone(v) { return v === undefined ? v : JSON.parse(JSON.stringify(v)); }
    function load(name, fallback) {
      try {
        var raw = localStorage.getItem(PREFIX + name);
        return raw == null ? clone(fallback) : JSON.parse(raw);
      } catch (e) {
        console.warn('Could not read ' + name, e);
        return clone(fallback);
      }
    }
    function save(name, value) {
      try {
        localStorage.setItem(PREFIX + name, JSON.stringify(value));
        listeners.forEach(function (fn) { try { fn(name, value); } catch (e) { console.warn(e); } });
        return true;
      } catch (e) {
        toast('Could not save on this device (storage full or blocked). Please take a backup.', 'err');
        return false;
      }
    }
    function exportAll() {
      var data = {};
      TABLES.forEach(function (t) {
        var raw = localStorage.getItem(PREFIX + t);
        if (raw != null) { try { data[t] = JSON.parse(raw); } catch (e) { /* skip corrupt */ } }
      });
      return { app: 'littlewings-dashboard', version: 1, appVersion: APP_VERSION, exportedAt: new Date().toISOString(), data: data };
    }
    function validateBackup(obj) {
      if (!obj || typeof obj !== 'object' || obj.app !== 'littlewings-dashboard' || !obj.data || typeof obj.data !== 'object') {
        throw new Error('This file is not a Little Wings dashboard backup.');
      }
      var d = obj.data;
      ['users', 'students', 'payments', 'enquiries', 'staff'].forEach(function (t) {
        if (d[t] != null && !Array.isArray(d[t])) throw new Error('Backup is damaged (' + t + ').');
      });
      if (d.attendance != null && (typeof d.attendance !== 'object' || Array.isArray(d.attendance))) throw new Error('Backup is damaged (attendance).');
      if (!d.auth || !d.auth.hash || !d.auth.salt) throw new Error('Backup has no admin PIN — cannot restore.');
      return true;
    }
    function importAll(obj) {
      validateBackup(obj);
      TABLES.forEach(function (t) { localStorage.removeItem(PREFIX + t); });
      TABLES.forEach(function (t) {
        if (obj.data[t] !== undefined) localStorage.setItem(PREFIX + t, JSON.stringify(obj.data[t]));
      });
    }
    function clearAll() {
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(PREFIX) === 0) keys.push(k);
      }
      keys.forEach(function (k) { localStorage.removeItem(k); });
    }
    function usageBytes() {
      var n = 0;
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(PREFIX) === 0) n += (k.length + (localStorage.getItem(k) || '').length) * 2;
      }
      return n;
    }
    function rawGet(key) { try { return localStorage.getItem(PREFIX + key); } catch (e) { return null; } }
    function rawSet(key, v) { try { localStorage.setItem(PREFIX + key, v); } catch (e) { /* ignore */ } }
    function rawDel(key) { try { localStorage.removeItem(PREFIX + key); } catch (e) { /* ignore */ } }
    function subscribe(fn) { listeners.push(fn); }
    return { load: load, save: save, exportAll: exportAll, importAll: importAll, validateBackup: validateBackup, clearAll: clearAll, usageBytes: usageBytes, rawGet: rawGet, rawSet: rawSet, rawDel: rawDel, subscribe: subscribe, TABLES: TABLES };
  })();

  // In-memory state (mirrors storage)
  var S = {};
  function asArray(v) { return Array.isArray(v) ? v : []; }
  function asObject(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
  function loadAll() {
    S.settings = Object.assign({}, DEFAULT_SETTINGS, asObject(Store.load('settings', {})));
    S.settings.classTeachers = asObject(S.settings.classTeachers);
    S.auth = Store.load('auth', null);
    S.users = asArray(Store.load('users', []));
    S.students = asArray(Store.load('students', []));
    S.attendance = asObject(Store.load('attendance', {}));
    S.payments = asArray(Store.load('payments', []));
    S.enquiries = asArray(Store.load('enquiries', []));
    S.staff = asArray(Store.load('staff', []));
  }
  function persist() {
    for (var i = 0; i < arguments.length; i++) Store.save(arguments[i], S[arguments[i]]);
  }

  /* =====================================================================
   * HELPERS
   * ===================================================================== */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  var dateParts = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  function todayISO() {
    var p = {};
    dateParts.formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
    return p.year + '-' + p.month + '-' + p.day;
  }
  function thisMonth() { return todayISO().slice(0, 7); }
  function isISODate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s || ''); }
  function isMonth(s) { return /^\d{4}-\d{2}$/.test(s || ''); }
  function fmtDate(iso) {
    if (!iso) return '—';
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    return m ? m[3] + '-' + m[2] + '-' + m[1] : String(iso);
  }
  function fmtMonth(ym) {
    if (!isMonth(ym)) return '—';
    var y = +ym.slice(0, 4), m = +ym.slice(5, 7);
    return MONTHS[m - 1] + ' ' + y;
  }
  function addMonths(ym, n) {
    var y = +ym.slice(0, 4), m = +ym.slice(5, 7) + n;
    y += Math.floor((m - 1) / 12);
    m = (((m - 1) % 12) + 12) % 12 + 1;
    return y + '-' + String(m).padStart(2, '0');
  }
  function monthRange(a, b) {
    var out = [], c = a, guard = 0;
    while (c <= b && guard++ < 600) { out.push(c); c = addMonths(c, 1); }
    return out;
  }
  function daysInMonth(ym) { return new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0).getDate(); }
  function weekday(iso) { return new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)).getDay(); }
  function ageParts(dob, ref) {
    if (!isISODate(dob)) return null;
    ref = ref || todayISO();
    var y1 = +dob.slice(0, 4), m1 = +dob.slice(5, 7), d1 = +dob.slice(8, 10);
    var y2 = +ref.slice(0, 4), m2 = +ref.slice(5, 7), d2 = +ref.slice(8, 10);
    var months = (y2 - y1) * 12 + (m2 - m1);
    if (d2 < d1) months--;
    if (months < 0) return null;
    return { y: Math.floor(months / 12), m: months % 12, years: months / 12 };
  }
  function ageText(dob) {
    var a = ageParts(dob);
    if (!a) return '—';
    return a.y + ' y' + (a.m ? ' ' + a.m + ' m' : '');
  }
  var inrFmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 2 });
  function inr(n) { return inrFmt.format(Number(n) || 0); }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }

  function normPhone(p) {
    var d = String(p || '').replace(/\D/g, '');
    if (d.length === 12 && d.indexOf('91') === 0) d = d.slice(2);
    else if (d.length === 11 && d.charAt(0) === '0') d = d.slice(1);
    return d;
  }
  function validPhone(p) { return /^[6-9]\d{9}$/.test(normPhone(p)); }
  function telHref(p) { var d = normPhone(p); return 'tel:' + (d.length === 10 ? '+91' + d : d); }
  function waHref(p, text) {
    var d = normPhone(p);
    var n = d.length === 10 ? '91' + d : d;
    return 'https://wa.me/' + n + (text ? '?text=' + encodeURIComponent(text) : '');
  }
  function phoneLinks(p, waNumber, waText) {
    if (!p) return '<span class="muted">—</span>';
    return '<span class="phone-cell"><span class="phone">' + esc(p) + '</span>' +
      '<a class="icon-btn call" href="' + esc(telHref(p)) + '" title="Call" aria-label="Call ' + esc(p) + '">📞</a>' +
      '<a class="icon-btn wa" href="' + esc(waHref(waNumber || p, waText)) + '" target="_blank" rel="noopener" title="WhatsApp" aria-label="WhatsApp">' + WA_SVG + '</a></span>';
  }
  var WA_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1-.7-.3-1.4-.7-2-1.3-.6-.5-1-1.1-1.4-1.8-.1-.2 0-.4.1-.5l.4-.5.3-.4v-.5l-.8-1.9c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3-.6.6-.9 1.4-.9 2.2.1 1 .5 1.9 1.1 2.7 1.1 1.6 2.5 2.9 4.2 3.7.5.2 1 .4 1.4.5.6.2 1.1.2 1.7.1.6-.1 1.6-.7 1.8-1.3.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3z"/></svg>';

  function inWords(amount) {
    var n = Math.round(Number(amount) || 0);
    if (n === 0) return 'Zero';
    var a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    var b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    function two(x) { return x < 20 ? a[x] : b[Math.floor(x / 10)] + (x % 10 ? ' ' + a[x % 10] : ''); }
    function three(x) { return x >= 100 ? a[Math.floor(x / 100)] + ' Hundred' + (x % 100 ? ' ' + two(x % 100) : '') : two(x); }
    var out = [];
    var crore = Math.floor(n / 1e7); n %= 1e7;
    var lakh = Math.floor(n / 1e5); n %= 1e5;
    var th = Math.floor(n / 1000); n %= 1000;
    if (crore) out.push((crore > 999 ? String(crore) : three(crore)) + ' Crore');
    if (lakh) out.push(two(lakh) + ' Lakh');
    if (th) out.push(two(th) + ' Thousand');
    if (n) out.push(three(n));
    return out.join(' ');
  }

  function className(id) { return CLASS_BY_ID[id] ? CLASS_BY_ID[id].name : '—'; }
  function byName(a, b) { return String(a.name || '').localeCompare(String(b.name || ''), 'en', { sensitivity: 'base' }); }
  function activeStudents(classId) {
    return S.students.filter(function (s) { return s.status !== 'Left' && (!classId || s.classId === classId); }).sort(byName);
  }
  function studentById(id) { for (var i = 0; i < S.students.length; i++) if (S.students[i].id === id) return S.students[i]; return null; }
  function staffById(id) { for (var i = 0; i < S.staff.length; i++) if (S.staff[i].id === id) return S.staff[i]; return null; }
  function classTeacher(classId) {
    var st = staffById(S.settings.classTeachers[classId]);
    if (!st) st = S.staff.filter(function (x) { return x.classId === classId && /teacher/i.test(x.role || '') && !/assistant/i.test(x.role || ''); })[0];
    if (st) return st.name;
    var acct = S.users.filter(function (u) { return u.classId === classId; })[0];
    return acct ? acct.name : '';
  }
  function suggestClass(years) {
    if (years == null || isNaN(years)) return '';
    if (years < 3) return 'toddlers';
    if (years < 4) return 'nursery';
    if (years < 5) return 'lkg';
    return 'ukg';
  }
  function attFor(date) { return asObject(S.attendance[date]); }
  function attStats(classId, date, rec) {
    rec = rec || attFor(date);
    var list = activeStudents(classId);
    var c = { P: 0, A: 0, L: 0, H: 0, marked: 0, total: list.length, pct: null };
    list.forEach(function (s) { var v = rec[s.id]; if (v && ATT[v]) { c[v]++; c.marked++; } });
    if (c.marked) c.pct = Math.round((c.P + 0.5 * c.H) / c.marked * 100);
    return c;
  }
  function paidFor(studentId, ym) {
    return S.payments.reduce(function (a, p) { return a + (p.studentId === studentId && p.month === ym ? num(p.amount) : 0); }, 0);
  }
  function admMonth(s) { return isISODate(s.admissionDate) ? s.admissionDate.slice(0, 7) : thisMonth(); }
  function feeApplies(s, ym) { return s.status !== 'Left' && ym >= admMonth(s) && num(s.monthlyFee) > 0; }
  function dueFor(s, ym) { return feeApplies(s, ym) ? Math.max(0, num(s.monthlyFee) - paidFor(s.id, ym)) : 0; }
  function outstanding(s) {
    var start = admMonth(s);
    var fs = S.settings.feesStartMonth;
    if (isMonth(fs) && fs > start) start = fs;
    var end = thisMonth();
    if (start > end) return 0;
    return monthRange(start, end).reduce(function (a, m) { return a + dueFor(s, m); }, 0);
  }

  /* ----- SHA-256 (WebCrypto, with a tiny pure-JS fallback) ----- */
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
  function sha256js(ascii) {
    function rr(v, a) { return (v >>> a) | (v << (32 - a)); }
    var mp = Math.pow, maxWord = mp(2, 32), result = '', words = [], bitLen = ascii.length * 8;
    var hash = [], k = [], primeCounter = 0, isComposite = {}, i, j;
    for (var cand = 2; primeCounter < 64; cand++) {
      if (!isComposite[cand]) {
        for (i = 0; i < 313; i += cand) isComposite[i] = cand;
        hash[primeCounter] = (mp(cand, 0.5) * maxWord) | 0;
        k[primeCounter++] = (mp(cand, 1 / 3) * maxWord) | 0;
      }
    }
    hash = hash.slice(0, 8);
    ascii += '\x80';
    while (ascii.length % 64 - 56) ascii += '\x00';
    for (i = 0; i < ascii.length; i++) { j = ascii.charCodeAt(i); words[i >> 2] |= j << ((3 - i) % 4) * 8; }
    words[words.length] = (bitLen / maxWord) | 0;
    words[words.length] = bitLen;
    for (j = 0; j < words.length;) {
      var w = words.slice(j, j += 16), oldHash = hash;
      hash = hash.slice(0, 8);
      for (i = 0; i < 64; i++) {
        var w15 = w[i - 15], w2 = w[i - 2], a = hash[0], e = hash[4];
        var t1 = hash[7] + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & hash[5]) ^ ((~e) & hash[6])) + k[i] +
          (w[i] = (i < 16) ? w[i] : (w[i - 16] + (rr(w15, 7) ^ rr(w15, 18) ^ (w15 >>> 3)) + w[i - 7] + (rr(w2, 17) ^ rr(w2, 19) ^ (w2 >>> 10))) | 0);
        var t2 = (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(t1 + t2) | 0].concat(hash);
        hash[4] = (hash[4] + t1) | 0;
      }
      for (i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
    }
    for (i = 0; i < 8; i++) for (j = 3; j + 1; j--) { var bb = (hash[i] >> (j * 8)) & 255; result += (bb < 16 ? '0' : '') + bb.toString(16); }
    return result;
  }
  function sha256hex(str) {
    if (window.crypto && window.crypto.subtle && window.TextEncoder) {
      return window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)).then(hex);
    }
    return Promise.resolve(sha256js(str));
  }
  function makeSalt() {
    var a = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(a);
    else for (var i = 0; i < 16; i++) a[i] = Math.floor(Math.random() * 256);
    return hex(a.buffer);
  }
  function hashPin(pin, salt) {
    // A few hundred rounds of salted SHA-256 (slows down casual guessing a little).
    var h = salt + ':' + pin, i = 0;
    function step(x) { h = x; i++; return i >= 300 ? h : sha256hex(h + ':' + salt).then(step); }
    return sha256hex(h).then(step);
  }
  function validPinFormat(pin) { return /^\d{4,6}$/.test(pin || ''); }
  function makePinRecord(pin) { var salt = makeSalt(); return hashPin(pin, salt).then(function (hash) { return { salt: salt, hash: hash, algo: 'sha256x300' }; }); }
  function checkPin(rec, pin) { if (!rec || !rec.salt) return Promise.resolve(false); return hashPin(pin, rec.salt).then(function (h) { return h === rec.hash; }); }

  // expose for tests
  window.__lw = { sha256js: sha256js, inWords: inWords, ageParts: ageParts, suggestClass: suggestClass, normPhone: normPhone, validPhone: validPhone, fmtDate: fmtDate, addMonths: addMonths, Store: Store, version: APP_VERSION };

  /* =====================================================================
   * UI PRIMITIVES
   * ===================================================================== */
  function toast(msg, type) {
    var root = $('#toast-root');
    if (!root) return;
    var el = document.createElement('div');
    el.className = 'toast ' + (type || 'ok');
    el.textContent = msg;
    root.appendChild(el);
    while (root.children.length > 3) root.removeChild(root.firstChild);
    setTimeout(function () { el.classList.add('out'); }, 2800);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 3300);
  }
  var modalSubmit = null;
  function openModal(opts) {
    var root = $('#modal-root');
    root.innerHTML = '<div class="modal-backdrop" data-act="modal-bg"><div class="modal ' + (opts.size || '') + '" role="dialog" aria-modal="true" aria-label="' + esc(opts.title) + '">' +
      '<div class="modal-head"><h2>' + esc(opts.title) + '</h2><button type="button" class="icon-btn close" data-act="modal-close" aria-label="Close">✕</button></div>' +
      '<div class="modal-body">' + opts.body + '</div></div></div>';
    document.body.classList.add('modal-open');
    modalSubmit = opts.onSubmit || null;
    var form = $('form', root);
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        if (!modalSubmit) return;
        clearErrors(form);
        var btn = $('button.primary', form);
        if (btn) btn.disabled = true;
        Promise.resolve().then(function () { return modalSubmit(form, new FormData(form)); }).then(function (res) {
          if (btn) btn.disabled = false;
          if (res !== false) closeModal();
        }).catch(function (err) {
          if (btn) btn.disabled = false;
          console.error(err);
          toast('Something went wrong: ' + err.message, 'err');
        });
      });
    }
    if (opts.mount) opts.mount(root);
    var first = $('input:not([type=hidden]):not([disabled]), select, textarea', root);
    if (first && window.matchMedia('(min-width: 700px)').matches) first.focus();
  }
  function closeModal() {
    $('#modal-root').innerHTML = '';
    modalSubmit = null;
    document.body.classList.remove('modal-open');
  }
  function confirmBox(message, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var root = $('#confirm-root');
      root.innerHTML = '<div class="modal-backdrop confirm"><div class="modal small" role="alertdialog" aria-modal="true"><div class="modal-body">' +
        '<h3>' + esc(opts.title || 'Are you sure?') + '</h3><p>' + esc(message) + '</p>' +
        '<div class="form-actions"><button type="button" class="btn ghost" data-c="0">Cancel</button>' +
        '<button type="button" class="btn ' + (opts.danger === false ? 'primary' : 'danger') + '" data-c="1">' + esc(opts.ok || 'Delete') + '</button></div></div></div></div>';
      $$('[data-c]', root).forEach(function (b) {
        b.addEventListener('click', function () { root.innerHTML = ''; resolve(b.getAttribute('data-c') === '1'); });
      });
      var okBtn = $('[data-c="1"]', root); if (okBtn) okBtn.focus();
    });
  }
  function clearErrors(form) {
    $$('.err', form).forEach(function (e) { e.parentNode.removeChild(e); });
    $$('.invalid', form).forEach(function (e) { e.classList.remove('invalid'); });
  }
  function fieldError(form, name, msg) {
    var input = form.querySelector('[name="' + name + '"]');
    var wrap = input ? (input.closest('.field') || input.parentNode) : form;
    wrap.classList.add('invalid');
    var s = document.createElement('small');
    s.className = 'err';
    s.textContent = msg;
    wrap.appendChild(s);
    var firstBad = form.querySelector('.invalid input, .invalid select, .invalid textarea');
    if (firstBad) firstBad.focus();
  }
  function field(label, control, extra, cls) {
    return '<label class="field ' + (cls || '') + '"><span class="lbl">' + label + '</span>' + control + (extra || '') + '</label>';
  }
  function options(list, selected, placeholder) {
    return (placeholder != null ? '<option value="">' + esc(placeholder) + '</option>' : '') + list.map(function (o) {
      var v = typeof o === 'object' ? o.value : o, l = typeof o === 'object' ? o.label : o;
      return '<option value="' + esc(v) + '"' + (String(v) === String(selected == null ? '' : selected) ? ' selected' : '') + '>' + esc(l) + '</option>';
    }).join('');
  }
  function classOptions() { return CLASSES.map(function (c) { return { value: c.id, label: c.name + ' (' + c.ages + ')' }; }); }
  function emptyState(icon, title, text, actionHTML) {
    return '<div class="empty"><div class="empty-icon">' + icon + '</div><h3>' + esc(title) + '</h3><p>' + esc(text) + '</p>' + (actionHTML || '') + '</div>';
  }
  function badge(text, color) { return '<span class="badge" style="--b:' + esc(color || '#38a8e0') + '">' + esc(text) + '</span>'; }
  function downloadFile(name, content, type) {
    var blob = new Blob([content], { type: type || 'application/octet-stream' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.parentNode.removeChild(a); }, 500);
  }
  function csv(rows) {
    return '\ufeff' + rows.map(function (r) {
      return r.map(function (v) {
        var s = String(v == null ? '' : v);
        if (/^[=+\-@]/.test(s)) s = "'" + s; // avoid spreadsheet formula injection
        return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    }).join('\r\n');
  }

  /* =====================================================================
   * SESSION & AUTH SCREENS
   * ===================================================================== */
  var ME = null;
  var SESSION_HOURS = 12;
  function getSession() {
    try {
      var s = JSON.parse(Store.rawGet('session') || 'null');
      if (!s || !s.exp || s.exp < Date.now()) return null;
      if (s.role === 'admin') return { role: 'admin', name: S.settings.owner || 'Admin' };
      if (s.role === 'teacher') {
        var u = S.users.filter(function (x) { return x.id === s.userId; })[0];
        if (!u) return null;
        return { role: 'teacher', userId: u.id, name: u.name, classId: u.classId };
      }
    } catch (e) { /* ignore */ }
    return null;
  }
  function setSession(role, user) {
    Store.rawSet('session', JSON.stringify({ role: role, userId: user ? user.id : null, exp: Date.now() + SESSION_HOURS * 3600e3 }));
  }
  function logout() {
    Store.rawDel('session');
    ME = null;
    closeModal();
    location.hash = '';
    boot();
  }
  function isAdmin() { return ME && ME.role === 'admin'; }

  function authCard(inner) {
    return '<div class="auth-wrap"><div class="auth-card">' +
      '<img class="auth-logo" src="assets/logo.jpeg" alt="The Little Wings Play School logo" width="96" height="96">' +
      '<h1>' + esc(S.settings.schoolName) + '</h1>' + inner + '</div>' +
      '<p class="auth-foot">Data is stored only on this device · v' + APP_VERSION + '</p></div>';
  }
  function pinInput(name, label, auto) {
    return field(label, '<input name="' + name + '" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="' + (auto || 'off') + '" class="pin" required>');
  }
  function showAuth(html) {
    $('#shell').hidden = true;
    var a = $('#auth-screen');
    a.hidden = false;
    a.innerHTML = html;
    var f = $('input:not([type=hidden])', a); if (f) f.focus();
  }
  function showSetup() {
    showAuth(authCard('<p class="sub">Welcome! Let’s set up your dashboard. 🎉</p>' +
      '<form id="setup-form" class="form" novalidate>' +
      field('Admin name', '<input name="owner" maxlength="60" value="' + esc(S.settings.owner) + '" required>') +
      pinInput('pin', 'Create admin PIN (4–6 digits)', 'new-password') +
      pinInput('pin2', 'Confirm PIN', 'new-password') +
      '<p class="note">The PIN locks this dashboard on this device. Keep it safe — it can’t be recovered (only replaced by restoring a backup).</p>' +
      '<button class="btn primary big block">Create PIN &amp; start</button></form>'));
    $('#setup-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target, fd = new FormData(f);
      clearErrors(f);
      var pin = String(fd.get('pin') || ''), pin2 = String(fd.get('pin2') || ''), owner = String(fd.get('owner') || '').trim();
      if (!owner) return fieldError(f, 'owner', 'Please enter a name');
      if (!validPinFormat(pin)) return fieldError(f, 'pin', 'PIN must be 4 to 6 digits');
      if (pin !== pin2) return fieldError(f, 'pin2', 'PINs do not match');
      $('button', f).disabled = true;
      makePinRecord(pin).then(function (rec) {
        rec.createdAt = new Date().toISOString();
        S.auth = rec;
        S.settings.owner = owner;
        if (!S.settings.feesStartMonth) S.settings.feesStartMonth = thisMonth();
        persist('auth', 'settings');
        setSession('admin');
        toast('PIN created. Welcome, ' + owner + '!');
        boot();
      });
    });
  }
  function lockState() { try { return JSON.parse(Store.rawGet('lock') || 'null') || { fails: 0, until: 0 }; } catch (e) { return { fails: 0, until: 0 }; } }
  function showLogin() {
    var who = [{ value: 'admin', label: 'Admin · ' + (S.settings.owner || 'Owner') }].concat(S.users.slice().sort(byName).map(function (u) {
      return { value: u.id, label: 'Teacher · ' + u.name + ' (' + className(u.classId) + ')' };
    }));
    var last = Store.rawGet('lastUser') || 'admin';
    showAuth(authCard('<p class="sub">Enter your PIN to open the dashboard</p>' +
      '<form id="login-form" class="form" novalidate>' +
      field('Who are you?', '<select name="who">' + options(who, last) + '</select>') +
      pinInput('pin', 'PIN', 'current-password') +
      '<p id="lock-msg" class="note warn" hidden></p>' +
      '<button class="btn primary big block">Unlock 🔓</button>' +
      '<details class="forgot"><summary>Forgot PIN?</summary><p>Teachers: ask the admin to reset your PIN in Settings. Admin: the PIN can’t be recovered. You can restore a backup file (which contains its own PIN) or clear this site’s browser data to start fresh (this erases everything on this device).</p></details>' +
      '</form>'));
    var f = $('#login-form');
    $('[name=pin]', f).focus();
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      clearErrors(f);
      var fd = new FormData(f), whoV = String(fd.get('who')), pin = String(fd.get('pin') || '');
      var ls = lockState();
      if (ls.until > Date.now()) {
        var secs = Math.ceil((ls.until - Date.now()) / 1000);
        var lm = $('#lock-msg'); lm.hidden = false; lm.textContent = 'Too many wrong tries. Please wait ' + secs + ' seconds.';
        return;
      }
      if (!validPinFormat(pin)) return fieldError(f, 'pin', 'Enter your 4–6 digit PIN');
      var user = whoV === 'admin' ? null : S.users.filter(function (u) { return u.id === whoV; })[0];
      var rec = whoV === 'admin' ? S.auth : user;
      $('button.primary', f).disabled = true;
      checkPin(rec, pin).then(function (ok) {
        $('button.primary', f).disabled = false;
        if (!ok) {
          ls.fails = (ls.fails || 0) + 1;
          if (ls.fails >= 5) ls.until = Date.now() + Math.min(600, 30 * Math.pow(2, ls.fails - 5)) * 1000;
          Store.rawSet('lock', JSON.stringify(ls));
          $('[name=pin]', f).value = '';
          return fieldError(f, 'pin', 'Wrong PIN. Please try again.' + (ls.fails >= 3 ? ' (' + ls.fails + ' wrong tries)' : ''));
        }
        Store.rawDel('lock');
        Store.rawSet('lastUser', whoV);
        setSession(whoV === 'admin' ? 'admin' : 'teacher', user);
        if (history.replaceState) history.replaceState(null, '', '#/dashboard');
        boot();
      });
    });
  }

  /* =====================================================================
   * SHELL & ROUTING
   * ===================================================================== */
  var UI = {
    classTab: null, search: '', classStatus: 'Active',
    attClass: null, attDate: null, attTab: 'mark', attMonth: null, drafts: {},
    feeMonth: null, feeTab: 'pending',
    enqFilter: 'All', enqSearch: '', staffSearch: '', lastRoute: ''
  };
  var ROUTES = {
    dashboard: { title: 'Dashboard', tTitle: 'My Class', icon: '🏠', roles: ['admin', 'teacher'], render: viewDashboard },
    classes: { title: 'Classes', tTitle: 'Students', icon: '🧒', roles: ['admin', 'teacher'], render: viewClasses },
    attendance: { title: 'Attendance', icon: '✅', roles: ['admin', 'teacher'], render: viewAttendance },
    fees: { title: 'Fees', icon: '💰', roles: ['admin'], render: viewFees },
    enquiries: { title: 'Enquiries', icon: '📝', roles: ['admin'], render: viewEnquiries },
    staff: { title: 'Staff', icon: '👩‍🏫', roles: ['admin'], render: viewStaff },
    settings: { title: 'Settings', tTitle: 'Account', icon: '⚙️', roles: ['admin', 'teacher'], render: viewSettings }
  };
  var ROUTE_ORDER = ['dashboard', 'classes', 'attendance', 'fees', 'enquiries', 'staff', 'settings'];
  function routeTitle(key) { var r = ROUTES[key]; return (ME && ME.role === 'teacher' && r.tTitle) ? r.tTitle : r.title; }
  function parseHash() {
    var h = (location.hash || '').replace(/^#\/?/, '').split('/');
    return { name: h[0] || 'dashboard', arg: h[1] ? decodeURIComponent(h[1]) : '' };
  }
  function showShell() {
    $('#auth-screen').hidden = true;
    $('#auth-screen').innerHTML = '';
    $('#shell').hidden = false;
    $('#brand-name').textContent = S.settings.schoolName;
    $('#user-chip').innerHTML = isAdmin() ? '<b>Admin</b> · ' + esc(ME.name) : '<b>' + esc(className(ME.classId)) + '</b> · ' + esc(ME.name);
    var links = ROUTE_ORDER.filter(function (k) { return ROUTES[k].roles.indexOf(ME.role) >= 0; }).map(function (k) {
      return '<a href="#/' + k + '" data-route="' + k + '"><span class="ni">' + ROUTES[k].icon + '</span><span class="nl">' + esc(routeTitle(k)) + '</span></a>';
    }).join('');
    $('#sidenav').innerHTML = links;
    $('#bottomnav').innerHTML = links;
    render();
  }
  function render() {
    if (!ME) return;
    var p = parseHash();
    var key = p.name;
    if (!ROUTES[key] || ROUTES[key].roles.indexOf(ME.role) < 0) {
      key = 'dashboard'; p.arg = '';
      if (history.replaceState) history.replaceState(null, '', '#/dashboard');
    }
    $$('[data-route]').forEach(function (a) { a.classList.toggle('active', a.getAttribute('data-route') === key); });
    $('#page-title').textContent = routeTitle(key);
    document.title = routeTitle(key) + ' · The Little Wings';
    var view = $('#view');
    try {
      view.innerHTML = ROUTES[key].render(p.arg);
    } catch (e) {
      console.error(e);
      view.innerHTML = emptyState('😕', 'Something went wrong', 'Please reload the page. If it keeps happening, take a backup from Settings. (' + e.message + ')');
    }
    var routeId = key + '/' + p.arg;
    if (routeId !== UI.lastRoute) { window.scrollTo(0, 0); UI.lastRoute = routeId; }
  }
  function boot() {
    loadAll();
    if (!S.auth || !S.auth.hash) { ME = null; return showSetup(); }
    ME = getSession();
    if (!ME) return showLogin();
    showShell();
  }

  /* =====================================================================
   * CHARTS (inline SVG / CSS)
   * ===================================================================== */
  function columnSVG(items, label) {
    var W = 320, H = 180, pad = 16, base = H - 30;
    var max = Math.max.apply(null, [1].concat(items.map(function (i) { return i.value; })));
    var bw = (W - pad * 2) / items.length;
    var out = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(label) + '">';
    out += '<line x1="' + pad + '" y1="' + base + '" x2="' + (W - pad) + '" y2="' + base + '" stroke="#e3e8ef" stroke-width="2"/>';
    items.forEach(function (it, k) {
      var h = Math.max(it.value ? 4 : 0, (it.value / max) * (base - 34));
      var x = pad + k * bw + bw * 0.2, w = bw * 0.6, y = base - h, cx = x + w / 2;
      out += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="9" fill="' + it.color + '"/>';
      out += '<text x="' + cx.toFixed(1) + '" y="' + (y - 8).toFixed(1) + '" text-anchor="middle" class="cv">' + esc(it.display != null ? it.display : it.value) + '</text>';
      out += '<text x="' + cx.toFixed(1) + '" y="' + (H - 9) + '" text-anchor="middle" class="cl">' + esc(it.label) + '</text>';
    });
    return out + '</svg>';
  }
  function donutSVG(parts, center, sub, label) {
    var total = parts.reduce(function (a, p) { return a + p.value; }, 0);
    var out = '<svg class="donut" viewBox="0 0 42 42" role="img" aria-label="' + esc(label) + '"><circle cx="21" cy="21" r="15.915" fill="none" stroke="#eef1f5" stroke-width="6"/>';
    if (total > 0) {
      var off = 25;
      parts.forEach(function (p) {
        var pct = p.value / total * 100;
        if (pct <= 0) return;
        out += '<circle cx="21" cy="21" r="15.915" fill="none" stroke="' + p.color + '" stroke-width="6" stroke-dasharray="' + pct.toFixed(3) + ' ' + (100 - pct).toFixed(3) + '" stroke-dashoffset="' + off.toFixed(3) + '"/>';
        off -= pct;
      });
    }
    out += '<text x="21" y="21" text-anchor="middle" class="dc">' + esc(center) + '</text><text x="21" y="26.5" text-anchor="middle" class="ds">' + esc(sub) + '</text></svg>';
    return out;
  }
  function barsHTML(items, fmt) {
    fmt = fmt || function (v) { return v; };
    var max = Math.max.apply(null, [1].concat(items.map(function (i) { return i.value; })));
    return '<div class="bars">' + items.map(function (i) {
      return '<div class="bar-row"><span class="bar-label">' + esc(i.label) + '</span><span class="bar-track"><span class="bar-fill" style="width:' + (i.value / max * 100).toFixed(1) + '%;background:' + i.color + '"></span></span><span class="bar-val">' + esc(fmt(i.value)) + '</span></div>';
    }).join('') + '</div>';
  }
  function legend(parts, fmt) {
    return '<ul class="legend">' + parts.map(function (p) { return '<li><i style="background:' + p.color + '"></i>' + esc(p.label) + ' <b>' + esc(fmt ? fmt(p.value) : p.value) + '</b></li>'; }).join('') + '</ul>';
  }
  function stat(icon, label, value, sub, tone, href) {
    var tag = href ? 'a href="' + href + '"' : 'div';
    return '<' + tag + ' class="stat ' + (tone || '') + '"><span class="stat-icon">' + icon + '</span><span class="stat-body"><small>' + esc(label) + '</small><b>' + esc(value) + '</b>' + (sub ? '<em>' + esc(sub) + '</em>' : '') + '</span></' + (href ? 'a' : 'div') + '>';
  }
  function pctText(p) { return p == null ? 'Not marked' : p + '%'; }

  /* =====================================================================
   * DASHBOARD
   * ===================================================================== */
  function birthdaysThisMonth(classId) {
    var m = thisMonth().slice(5, 7);
    return activeStudents(classId).filter(function (s) { return isISODate(s.dob) && s.dob.slice(5, 7) === m; })
      .sort(function (a, b) { return a.dob.slice(8) < b.dob.slice(8) ? -1 : 1; });
  }
  function viewDashboard() {
    if (!isAdmin()) return viewTeacherDash();
    var today = todayISO(), ym = thisMonth();
    var studs = activeStudents();
    var greeting = '<div class="hello"><div><h1>Hello, ' + esc(S.settings.owner || 'Admin') + ' 👋</h1><p>' + esc(new Intl.DateTimeFormat('en-IN', { timeZone: TZ, weekday: 'long' }).format(new Date())) + ', ' + fmtDate(today) + '</p></div></div>';

    if (!S.students.length && !S.staff.length && !S.enquiries.length) {
      return greeting + '<section class="card welcome"><h2>Let’s get started 🌈</h2><p>Your dashboard is empty and ready. A few quick steps:</p><ol class="steps">' +
        '<li><a href="#/settings">Check school details</a> (name, address, phone on receipts)</li>' +
        '<li><a href="#/staff">Add your staff</a> and pick class teachers</li>' +
        '<li><a href="#/classes">Add students</a> to Toddlers, Nursery, LKG and UKG</li>' +
        '<li><a href="#/settings">Create teacher logins</a> so teachers can mark attendance on their phones</li>' +
        '<li><a href="#/settings">Download a backup</a> regularly — data lives only on this device</li></ol>' +
        '<div class="row gap"><button class="btn primary" data-act="student-add">➕ Add first student</button><button class="btn ghost" data-act="enq-add">📝 Add an enquiry</button></div></section>';
    }

    var per = CLASSES.map(function (c) { return { c: c, n: activeStudents(c.id).length, att: attStats(c.id, today), teacher: classTeacher(c.id) }; });
    var tot = per.reduce(function (a, x) { a.P += x.att.P; a.H += x.att.H; a.m += x.att.marked; return a; }, { P: 0, H: 0, m: 0 });
    var overallPct = tot.m ? Math.round((tot.P + 0.5 * tot.H) / tot.m * 100) : null;
    var collectedMonth = S.payments.reduce(function (a, p) { return a + ((p.paidOn || '').slice(0, 7) === ym ? num(p.amount) : 0); }, 0);
    var pendingMonth = studs.reduce(function (a, s) { return a + dueFor(s, ym); }, 0);
    var outstandingList = studs.map(function (s) { return { s: s, due: outstanding(s) }; }).filter(function (x) { return x.due > 0; });
    var outstandingTotal = outstandingList.reduce(function (a, x) { return a + x.due; }, 0);
    var enqMonth = S.enquiries.filter(function (e) { return (e.date || '').slice(0, 7) === ym; });
    var enqConv = enqMonth.filter(function (e) { return e.status === 'Admitted'; }).length;
    var dueFollow = S.enquiries.filter(function (e) { return e.followUp && e.followUp <= today && (e.status === 'New' || e.status === 'Visited'); });

    var html = greeting + '<div class="stats">' +
      stat('🧒', 'Students', String(studs.length), CLASSES.map(function (c, i) { return c.name + ' ' + per[i].n; }).join(' · '), 'sky', '#/classes') +
      stat('✅', 'Attendance today', pctText(overallPct), tot.m + ' of ' + studs.length + ' marked', 'green', '#/attendance') +
      stat('💰', 'Collected this month', inr(collectedMonth), 'Payments received in ' + fmtMonth(ym), 'yellow', '#/fees') +
      stat('⏳', 'Total pending', inr(outstandingTotal), outstandingList.length + ' student' + (outstandingList.length === 1 ? '' : 's') + ' with dues', 'coral', '#/fees') +
      stat('📝', 'Enquiries this month', String(enqMonth.length), enqConv + ' converted to admission', 'purple', '#/enquiries') +
      '</div>';

    html += '<section class="class-cards">' + per.map(function (x) {
      return '<a class="class-card" href="#/classes/' + x.c.id + '" style="--c:' + x.c.color + '"><span class="cc-emoji">' + x.c.emoji + '</span><span class="cc-name">' + esc(x.c.name) + '<small>' + esc(x.c.ages) + '</small></span>' +
        '<span class="cc-count"><b>' + x.n + '</b> students</span><span class="cc-att">Today: <b>' + pctText(x.att.pct) + '</b>' + (x.att.marked ? ' <small>(' + x.att.P + 'P ' + x.att.A + 'A ' + x.att.L + 'L ' + x.att.H + 'H)</small>' : '') + '</span>' +
        '<span class="cc-teacher">👩‍🏫 ' + (x.teacher ? esc(x.teacher) : '<i>No class teacher</i>') + '</span></a>';
    }).join('') + '</section>';

    var enqParts = ENQ_STATUS.map(function (s) { return { label: s, value: S.enquiries.filter(function (e) { return e.status === s; }).length, color: ENQ_COLORS[s] }; });
    var feeParts = [{ label: 'Collected (' + fmtMonth(ym) + ' fees)', value: studs.reduce(function (a, s) { return a + (feeApplies(s, ym) ? Math.min(num(s.monthlyFee), paidFor(s.id, ym)) : 0); }, 0), color: '#6cc48a' },
      { label: 'Pending', value: pendingMonth, color: '#ff7a6b' }];
    var feeTotal = feeParts[0].value + feeParts[1].value;
    html += '<div class="grid-charts">' +
      '<section class="card"><h3>Students per class</h3>' + columnSVG(per.map(function (x) { return { label: x.c.name, value: x.n, color: x.c.color }; }), 'Students per class') + '</section>' +
      '<section class="card"><h3>' + esc(fmtMonth(ym)) + ' fees: collected vs pending</h3><div class="donut-wrap">' + donutSVG(feeParts, feeTotal ? Math.round(feeParts[0].value / feeTotal * 100) + '%' : '—', 'collected', 'Fees collected vs pending') + legend(feeParts, inr) + '</div></section>' +
      '<section class="card"><h3>Enquiries by status</h3>' + (S.enquiries.length ? barsHTML(enqParts) : '<p class="muted">No enquiries yet.</p>') + '</section>' +
      '<section class="card"><h3>Attendance today by class</h3>' + barsHTML(per.map(function (x) { return { label: x.c.name, value: x.att.pct || 0, color: x.c.color }; }), function (v) { return v + '%'; }) + '<p class="muted small">Present + half of half-day, out of students marked.</p></section>' +
      '</div>';

    // Lists
    html += '<div class="grid-2">';
    html += '<section class="card"><h3>📞 Follow-ups due' + (dueFollow.length ? ' <span class="pill coral">' + dueFollow.length + '</span>' : '') + '</h3>' +
      (dueFollow.length ? '<ul class="mini-list">' + dueFollow.slice(0, 6).map(function (e) {
        return '<li><span><b>' + esc(e.childName) + '</b> · ' + esc(e.parentName) + '<small>' + (e.followUp < today ? 'Overdue since ' : 'Due ') + fmtDate(e.followUp) + '</small></span>' + phoneLinks(e.phone) + '</li>';
      }).join('') + '</ul><a class="more" href="#/enquiries">All enquiries →</a>' : '<p class="muted">No follow-ups due today. 🎈</p>') + '</section>';
    var bdays = birthdaysThisMonth();
    html += '<section class="card"><h3>🎂 Birthdays in ' + esc(fmtMonth(ym)) + '</h3>' + (bdays.length ? '<ul class="mini-list">' + bdays.map(function (s) {
      return '<li><span><b>' + esc(s.name) + '</b> · ' + esc(className(s.classId)) + '<small>' + fmtDate(s.dob).slice(0, 5) + ' · turns ' + ((ageParts(s.dob, ym + '-28') || { y: 0 }).y) + '</small></span></li>';
    }).join('') + '</ul>' : '<p class="muted">No birthdays this month.</p>') + '</section>';
    var recent = S.payments.slice().sort(function (a, b) { return (b.createdAt || '') < (a.createdAt || '') ? -1 : 1; }).slice(0, 5);
    html += '<section class="card"><h3>🧾 Recent payments</h3>' + (recent.length ? '<ul class="mini-list">' + recent.map(function (p) {
      return '<li><span><b>' + esc(p.studentName) + '</b> · ' + esc(fmtMonth(p.month)) + '<small>' + esc(p.receiptNo) + ' · ' + fmtDate(p.paidOn) + ' · ' + esc(p.mode) + '</small></span><b>' + inr(p.amount) + '</b></li>';
    }).join('') + '</ul>' : '<p class="muted">No payments recorded yet.</p>') + '</section>';
    html += '<section class="card"><h3>⏳ Top pending fees</h3>' + (outstandingList.length ? '<ul class="mini-list">' + outstandingList.sort(function (a, b) { return b.due - a.due; }).slice(0, 6).map(function (x) {
      return '<li><span><b>' + esc(x.s.name) + '</b> · ' + esc(className(x.s.classId)) + '<small>' + esc(x.s.parentName || '') + '</small></span><b class="coral-t">' + inr(x.due) + '</b></li>';
    }).join('') + '</ul><a class="more" href="#/fees">Go to fees →</a>' : '<p class="muted">No pending fees. 🎉</p>') + '</section>';
    html += '</div>';
    return html;
  }

  function viewTeacherDash() {
    var c = CLASS_BY_ID[ME.classId];
    if (!c) return emptyState('🧭', 'No class assigned', 'Please ask the admin to assign a class to your account.');
    var today = todayISO();
    var list = activeStudents(c.id);
    var st = attStats(c.id, today);
    var rec = attFor(today);
    var away = list.filter(function (s) { return rec[s.id] === 'A' || rec[s.id] === 'L'; });
    var bd = birthdaysThisMonth(c.id);
    var html = '<div class="hello"><div><h1>Hello, ' + esc(ME.name) + ' 👋</h1><p>' + esc(c.emoji + ' ' + c.name + ' (' + c.ages + ')') + ' · ' + fmtDate(today) + '</p></div></div>';
    html += '<div class="stats">' +
      stat('🧒', 'Students', String(list.length), c.name, 'sky', '#/classes') +
      stat('✅', 'Attendance today', pctText(st.pct), st.marked ? st.P + ' present · ' + st.A + ' absent · ' + st.L + ' leave · ' + st.H + ' half-day' : 'Tap to mark now', st.marked ? 'green' : 'coral', '#/attendance') +
      stat('🎂', 'Birthdays this month', String(bd.length), bd.map(function (s) { return s.name.split(' ')[0] + ' ' + fmtDate(s.dob).slice(0, 5); }).join(', '), 'yellow') +
      '</div>';
    html += '<div class="row gap wrap"><a class="btn primary big" href="#/attendance">✅ ' + (st.marked ? 'Update' : 'Mark') + ' today’s attendance</a><a class="btn ghost big" href="#/classes">🧒 View students</a></div>';
    html += '<section class="card"><h3>Absent / on leave today</h3>' + (!st.marked ? '<p class="muted">Attendance not marked yet for today.</p>' : away.length ? '<ul class="mini-list">' + away.map(function (s) {
      return '<li><span><b>' + esc(s.name) + '</b> ' + badge(ATT[rec[s.id]].label, rec[s.id] === 'A' ? '#ff7a6b' : '#ffc93c') + '<small>' + esc(s.parentName || '') + '</small></span>' + phoneLinks(s.phone, s.whatsapp) + '</li>';
    }).join('') + '</ul>' : '<p class="muted">Everyone is here today! 🎉</p>') + '</section>';
    if (!list.length) html += emptyState('🌱', 'No students in ' + c.name + ' yet', 'Students added by the admin (or by you) will appear here.', '<button class="btn primary" data-act="student-add">➕ Add student</button>');
    return html;
  }

  /* =====================================================================
   * CLASSES & STUDENTS
   * ===================================================================== */
  function allowedClasses() { return isAdmin() ? CLASSES.map(function (c) { return c.id; }) : (CLASS_BY_ID[ME.classId] ? [ME.classId] : []); }
  function viewClasses(arg) {
    var allowed = allowedClasses();
    if (!allowed.length) return emptyState('🧭', 'No class assigned', 'Please ask the admin to assign a class to your account.');
    var cid = allowed.indexOf(arg) >= 0 ? arg : (allowed.indexOf(UI.classTab) >= 0 ? UI.classTab : allowed[0]);
    UI.classTab = cid;
    var c = CLASS_BY_ID[cid];
    var html = '';
    if (allowed.length > 1) {
      html += '<div class="tabs" role="tablist">' + CLASSES.map(function (x) {
        return '<a role="tab" class="tab' + (x.id === cid ? ' active' : '') + '" href="#/classes/' + x.id + '" style="--c:' + x.color + '">' + x.emoji + ' ' + esc(x.name) + ' <span class="count">' + activeStudents(x.id).length + '</span></a>';
      }).join('') + '</div>';
    }
    var teacher = classTeacher(cid);
    html += '<section class="class-head" style="--c:' + c.color + '"><div><h1>' + c.emoji + ' ' + esc(c.name) + ' <small>' + esc(c.ages) + '</small></h1>' +
      '<p>👩‍🏫 Class teacher: <b>' + (teacher ? esc(teacher) : 'Not assigned') + '</b>' + (isAdmin() && !teacher ? ' · <a href="#/settings">Assign</a>' : '') + ' · ' + activeStudents(cid).length + ' active students</p></div>' +
      '<button class="btn primary" data-act="student-add" data-class="' + cid + '">➕ Add student</button></section>';
    html += '<div class="toolbar"><input type="search" class="search" placeholder="🔍 Search name, parent or phone" value="' + esc(UI.search) + '" data-input="student-search" aria-label="Search students">' +
      '<select data-change="student-status" aria-label="Filter by status">' + options([{ value: 'Active', label: 'Active students' }, { value: 'Left', label: 'Left / withdrawn' }, { value: 'All', label: 'All' }], UI.classStatus) + '</select></div>';
    html += '<div id="student-list">' + studentListHTML(cid) + '</div>';
    return html;
  }
  function studentListHTML(cid) {
    var q = UI.search.trim().toLowerCase();
    var all = S.students.filter(function (s) { return s.classId === cid; });
    var list = all.filter(function (s) {
      if (UI.classStatus === 'Active' && s.status === 'Left') return false;
      if (UI.classStatus === 'Left' && s.status !== 'Left') return false;
      if (!q) return true;
      return [s.name, s.parentName, s.phone, s.whatsapp].join(' ').toLowerCase().indexOf(q) >= 0;
    }).sort(byName);
    if (!all.length) return emptyState(CLASS_BY_ID[cid].emoji, 'No students in ' + className(cid) + ' yet', 'Add the first child to this class — it only takes a minute.', '<button class="btn primary" data-act="student-add" data-class="' + cid + '">➕ Add student</button>');
    if (!list.length) return emptyState('🔍', 'No matches', 'No students match your search or filter.');
    var admin = isAdmin();
    return '<div class="table-wrap"><table class="table responsive"><thead><tr><th>Name</th><th>Age</th><th>Parent / Guardian</th><th>Phone</th>' + (admin ? '<th class="num">Fee / month</th>' : '') + '<th class="act-col"><span class="sr">Actions</span></th></tr></thead><tbody>' +
      list.map(function (s) {
        return '<tr' + (s.status === 'Left' ? ' class="left"' : '') + '><td data-label="Name"><button type="button" class="link strong" data-act="student-view" data-id="' + esc(s.id) + '">' + esc(s.name) + '</button>' +
          (s.medical ? ' <span title="Has medical notes" class="tag med">⚕️ Medical</span>' : '') + (s.status === 'Left' ? ' <span class="tag">Left</span>' : '') + '</td>' +
          '<td data-label="Age">' + esc(ageText(s.dob)) + '</td>' +
          '<td data-label="Parent">' + esc(s.parentName || '—') + '</td>' +
          '<td data-label="Phone">' + phoneLinks(s.phone, s.whatsapp) + '</td>' +
          (admin ? '<td data-label="Fee" class="num">' + (num(s.monthlyFee) ? inr(s.monthlyFee) : '<span class="muted">—</span>') + '</td>' : '') +
          '<td class="actions"><button type="button" class="icon-btn" data-act="student-edit" data-id="' + esc(s.id) + '" title="Edit" aria-label="Edit ' + esc(s.name) + '">✏️</button>' +
          (admin ? '<button type="button" class="icon-btn" data-act="student-del" data-id="' + esc(s.id) + '" title="Delete" aria-label="Delete ' + esc(s.name) + '">🗑️</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function studentFormHTML(s, pre) {
    var v = Object.assign({ status: 'Active', admissionDate: todayISO() }, pre || {}, s || {});
    var teacher = !isAdmin();
    var classCtl = teacher ? '<input type="hidden" name="classId" value="' + esc(ME.classId) + '"><input disabled value="' + esc(className(ME.classId)) + '">'
      : '<select name="classId" required>' + options(classOptions(), v.classId, 'Select class') + '</select>';
    return '<form class="form" novalidate><div class="grid2">' +
      field('Child’s full name *', '<input name="name" maxlength="80" autocomplete="off" value="' + esc(v.name) + '" required>') +
      field('Date of birth *', '<input type="date" name="dob" max="' + todayISO() + '" value="' + esc(v.dob) + '" required>', '<small class="hint" id="age-hint"></small>') +
      field('Class *', classCtl) +
      field('Admission date *', '<input type="date" name="admissionDate" value="' + esc(v.admissionDate) + '" required>') +
      field('Parent / Guardian name *', '<input name="parentName" maxlength="80" value="' + esc(v.parentName) + '" required>') +
      field('Phone *', '<input type="tel" name="phone" inputmode="tel" maxlength="16" placeholder="10-digit mobile" value="' + esc(v.phone) + '" required>') +
      field('WhatsApp number', '<input type="tel" name="whatsapp" inputmode="tel" maxlength="16" placeholder="Blank = same as phone" value="' + esc(v.whatsapp) + '">') +
      (teacher ? '' : field('Monthly fee (₹)', '<input type="number" name="monthlyFee" min="0" max="1000000" step="1" inputmode="numeric" placeholder="e.g. 2500" value="' + esc(v.monthlyFee == null ? '' : v.monthlyFee) + '">')) +
      field('Emergency contact', '<input name="emergency" maxlength="120" placeholder="Name & phone" value="' + esc(v.emergency) + '">') +
      field('Authorised pickup', '<input name="pickup" maxlength="160" placeholder="Who may collect the child" value="' + esc(v.pickup) + '">') +
      field('Status', '<select name="status">' + options(['Active', 'Left'], v.status) + '</select>') +
      '</div>' +
      field('Medical notes / allergies', '<textarea name="medical" rows="2" maxlength="600">' + esc(v.medical) + '</textarea>') +
      field('Notes', '<textarea name="notes" rows="2" maxlength="1500">' + esc(v.notes) + '</textarea>') +
      '<div class="form-actions"><button type="button" class="btn ghost" data-act="modal-close">Cancel</button><button class="btn primary">' + (s ? 'Save changes' : 'Add student') + '</button></div></form>';
  }
  function openStudentForm(s, pre, onSaved) {
    openModal({
      title: s ? 'Edit student' : 'Add student', size: 'wide', body: studentFormHTML(s, pre),
      mount: function (root) {
        var dob = $('[name=dob]', root), sel = $('select[name=classId]', root), hint = $('#age-hint', root);
        var touched = !!(s || (pre && pre.classId));
        if (sel) sel.addEventListener('change', function () { touched = true; });
        function upd() {
          var a = ageParts(dob.value);
          if (!a) { hint.textContent = ''; return; }
          var sug = suggestClass(a.years);
          hint.textContent = 'Age today: ' + a.y + ' y ' + a.m + ' m · suggested: ' + className(sug);
          if (sel && !touched && sug) sel.value = sug;
        }
        dob.addEventListener('input', upd); dob.addEventListener('change', upd); upd();
      },
      onSubmit: function (form, fd) {
        var g = function (k) { return String(fd.get(k) == null ? '' : fd.get(k)).trim(); };
        var ok = true, today = todayISO();
        var d = { name: g('name').replace(/\s+/g, ' '), dob: g('dob'), classId: g('classId'), admissionDate: g('admissionDate'), parentName: g('parentName'), phone: g('phone'), whatsapp: g('whatsapp'),
          emergency: g('emergency'), pickup: g('pickup'), status: g('status') === 'Left' ? 'Left' : 'Active', medical: g('medical'), notes: g('notes') };
        if (d.name.length < 2) { fieldError(form, 'name', 'Please enter the child’s name'); ok = false; }
        if (!isISODate(d.dob)) { fieldError(form, 'dob', 'Please choose the date of birth'); ok = false; }
        else if (d.dob > today) { fieldError(form, 'dob', 'Date of birth can’t be in the future'); ok = false; }
        else if ((ageParts(d.dob) || { years: 0 }).years > 10) { fieldError(form, 'dob', 'Child would be over 10 years old — please check'); ok = false; }
        if (!CLASS_BY_ID[d.classId]) { fieldError(form, 'classId', 'Please choose a class'); ok = false; }
        if (!isISODate(d.admissionDate)) { fieldError(form, 'admissionDate', 'Please choose the admission date'); ok = false; }
        else if (isISODate(d.dob) && d.admissionDate < d.dob) { fieldError(form, 'admissionDate', 'Admission date is before date of birth'); ok = false; }
        if (d.parentName.length < 2) { fieldError(form, 'parentName', 'Please enter the parent or guardian name'); ok = false; }
        if (!validPhone(d.phone)) { fieldError(form, 'phone', 'Enter a valid 10-digit Indian mobile number'); ok = false; }
        if (d.whatsapp && !validPhone(d.whatsapp)) { fieldError(form, 'whatsapp', 'Enter a valid 10-digit number or leave blank'); ok = false; }
        if (isAdmin()) {
          var fee = g('monthlyFee');
          if (fee !== '' && (!isFinite(+fee) || +fee < 0)) { fieldError(form, 'monthlyFee', 'Fee must be 0 or more'); ok = false; }
          d.monthlyFee = fee === '' ? 0 : Math.round(+fee * 100) / 100;
        }
        if (!ok) return false;
        var dup = S.students.filter(function (x) { return x !== s && x.name.toLowerCase() === d.name.toLowerCase() && x.dob === d.dob; })[0];
        return (dup ? confirmBox('A student named “' + d.name + '” with the same date of birth already exists. Add anyway?', { ok: 'Yes, save', danger: false, title: 'Possible duplicate' }) : Promise.resolve(true)).then(function (go) {
          if (!go) return false;
          var rec;
          if (s) { rec = s; Object.assign(s, d, { updatedAt: new Date().toISOString() }); }
          else { rec = Object.assign({ id: uid(), monthlyFee: 0, createdAt: new Date().toISOString() }, d); S.students.push(rec); }
          persist('students');
          toast(s ? 'Student updated' : d.name + ' added to ' + className(d.classId) + ' 🎉');
          if (!s) UI.classTab = d.classId;
          if (onSaved) onSaved(rec);
          render();
          return true;
        });
      }
    });
  }
  function canSeeStudent(s) { return s && (isAdmin() || s.classId === ME.classId); }
  function viewStudent(id) {
    var s = studentById(id);
    if (!canSeeStudent(s)) return;
    var ym = thisMonth(), n = daysInMonth(ym), c = { P: 0, A: 0, L: 0, H: 0 };
    for (var d = 1; d <= n; d++) { var v = attFor(ym + '-' + String(d).padStart(2, '0'))[s.id]; if (c[v] != null) c[v]++; }
    var row = function (k, v) { return '<div class="kv"><span>' + k + '</span><b>' + v + '</b></div>'; };
    var body = '<div class="profile" style="--c:' + CLASS_BY_ID[s.classId].color + '"><div class="avatar">' + esc((s.name || '?').charAt(0).toUpperCase()) + '</div><div><h3>' + esc(s.name) + '</h3><p>' + esc(className(s.classId)) + ' · ' + esc(ageText(s.dob)) + (s.status === 'Left' ? ' · <span class="tag">Left</span>' : '') + '</p></div></div>' +
      '<div class="kvs">' + row('Date of birth', fmtDate(s.dob)) + row('Admission date', fmtDate(s.admissionDate)) + row('Parent / Guardian', esc(s.parentName || '—')) +
      row('Phone', phoneLinks(s.phone, s.whatsapp)) + (s.whatsapp ? row('WhatsApp', esc(s.whatsapp)) : '') +
      (isAdmin() ? row('Monthly fee', num(s.monthlyFee) ? inr(s.monthlyFee) : '—') : '') +
      row('Emergency contact', esc(s.emergency || '—')) + row('Authorised pickup', esc(s.pickup || '—')) + '</div>' +
      (s.medical ? '<div class="callout med"><b>⚕️ Medical notes</b><p>' + esc(s.medical) + '</p></div>' : '') +
      (s.notes ? '<div class="callout"><b>📝 Notes</b><p>' + esc(s.notes) + '</p></div>' : '') +
      '<h4>Attendance in ' + esc(fmtMonth(ym)) + '</h4><div class="att-sum">' + ATT_KEYS.map(function (k) { return '<span class="att-chip ' + ATT[k].cls + '">' + ATT[k].label + ' <b>' + c[k] + '</b></span>'; }).join('') + '</div>';
    if (isAdmin()) {
      var pays = S.payments.filter(function (p) { return p.studentId === s.id; }).sort(function (a, b) { return a.month < b.month ? 1 : -1; });
      body += '<h4>Fees</h4><p>Pending (all months): <b class="coral-t">' + inr(outstanding(s)) + '</b></p>' +
        (pays.length ? '<ul class="mini-list">' + pays.slice(0, 12).map(function (p) { return '<li><span><b>' + esc(fmtMonth(p.month)) + '</b><small>' + esc(p.receiptNo) + ' · ' + fmtDate(p.paidOn) + ' · ' + esc(p.mode) + '</small></span><span><b>' + inr(p.amount) + '</b> <button class="icon-btn" data-act="receipt-view" data-id="' + esc(p.id) + '" title="Receipt">🧾</button></span></li>'; }).join('') + '</ul>' : '<p class="muted">No payments yet.</p>');
    }
    body += '<div class="form-actions">' + (isAdmin() ? '<button class="btn ghost" data-act="pay-add" data-student="' + esc(s.id) + '">💰 Record payment</button>' : '') + '<button class="btn primary" data-act="student-edit" data-id="' + esc(s.id) + '">✏️ Edit</button></div>';
    openModal({ title: 'Student details', size: 'wide', body: body });
  }

  /* =====================================================================
   * ATTENDANCE
   * ===================================================================== */
  function draftKey(cid, date) { return cid + '|' + date; }
  function getDraft(cid, date) {
    var k = draftKey(cid, date);
    if (!UI.drafts[k]) {
      var saved = attFor(date), d = {};
      activeStudents(cid).forEach(function (s) { if (saved[s.id]) d[s.id] = saved[s.id]; });
      UI.drafts[k] = { data: d, dirty: false };
    }
    return UI.drafts[k];
  }
  function anyDirty() { return Object.keys(UI.drafts).some(function (k) { return UI.drafts[k].dirty; }); }
  function viewAttendance() {
    var allowed = allowedClasses();
    if (!allowed.length) return emptyState('🧭', 'No class assigned', 'Please ask the admin to assign a class to your account.');
    if (allowed.indexOf(UI.attClass) < 0) UI.attClass = allowed[0];
    if (!isISODate(UI.attDate) || UI.attDate > todayISO()) UI.attDate = todayISO();
    if (!isMonth(UI.attMonth)) UI.attMonth = thisMonth();
    var tabs = [['mark', '✍️ Mark'], ['month', '📅 Monthly'], ['absent', '🚫 Absent list']];
    var html = '<div class="seg-tabs">' + tabs.map(function (t) { return '<button type="button" class="' + (UI.attTab === t[0] ? 'active' : '') + '" data-act="att-tab" data-tab="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>';
    var classSel = allowed.length > 1 ? field('Class', '<select data-change="att-class">' + options(CLASSES.map(function (c) { return { value: c.id, label: c.emoji + ' ' + c.name }; }), UI.attClass) + '</select>')
      : field('Class', '<input disabled value="' + esc(className(UI.attClass)) + '">');
    if (UI.attTab === 'month') {
      html += '<div class="toolbar">' + classSel + field('Month', '<input type="month" max="' + thisMonth() + '" value="' + UI.attMonth + '" data-change="att-month">') + '</div>';
      return html + monthGridHTML(UI.attClass, UI.attMonth);
    }
    if (UI.attTab === 'absent') {
      var cls = allowed.length > 1 ? field('Class', '<select data-change="att-class-any">' + options([{ value: 'all', label: 'All classes' }].concat(CLASSES.map(function (c) { return { value: c.id, label: c.emoji + ' ' + c.name }; })), UI.absClass || 'all') + '</select>') : classSel;
      html += '<div class="toolbar">' + cls + field('Date', '<input type="date" max="' + todayISO() + '" value="' + UI.attDate + '" data-change="att-date">') + '</div>';
      return html + absentListHTML(allowed.length > 1 ? (UI.absClass || 'all') : UI.attClass, UI.attDate);
    }
    html += '<div class="toolbar">' + classSel + field('Date', '<input type="date" max="' + todayISO() + '" value="' + UI.attDate + '" data-change="att-date">') + '</div>';
    var list = activeStudents(UI.attClass);
    if (!list.length) return html + emptyState('🌱', 'No students in ' + className(UI.attClass), 'Add students to this class first, then mark attendance here.', '<a class="btn primary" href="#/classes/' + UI.attClass + '">Go to class</a>');
    var dr = getDraft(UI.attClass, UI.attDate);
    var saved = Object.keys(attFor(UI.attDate)).some(function (id) { return list.some(function (s) { return s.id === id; }); });
    html += '<div class="att-head"><div><b>' + fmtDate(UI.attDate) + '</b> · ' + esc(new Intl.DateTimeFormat('en-IN', { weekday: 'long' }).format(new Date(UI.attDate + 'T12:00:00'))) +
      (weekday(UI.attDate) === 0 ? ' <span class="tag">Sunday</span>' : '') + '<br><small id="att-status" class="' + (dr.dirty ? 'warn-t' : 'muted') + '">' + (dr.dirty ? '● Unsaved changes' : saved ? '✓ Saved' : 'Not marked yet') + '</small></div>' +
      '<button type="button" class="btn ghost" data-act="att-all">✔ Mark all present</button></div>';
    html += '<div id="att-counts" class="att-sum">' + attCountsHTML(UI.attClass, dr.data) + '</div>';
    html += '<div class="roster">' + list.map(function (s) {
      var cur = dr.data[s.id];
      return '<div class="roster-row" data-sid="' + esc(s.id) + '"><div class="who"><b>' + esc(s.name) + '</b><small>' + esc(ageText(s.dob)) + (s.medical ? ' · ⚕️' : '') + '</small></div><div class="seg" role="group" aria-label="Attendance for ' + esc(s.name) + '">' +
        ATT_KEYS.map(function (k) { return '<button type="button" class="seg-btn ' + ATT[k].cls + (cur === k ? ' on' : '') + '" data-act="att-set" data-sid="' + esc(s.id) + '" data-v="' + k + '" aria-pressed="' + (cur === k) + '" title="' + ATT[k].label + '"><b>' + k + '</b><span>' + ATT[k].label + '</span></button>'; }).join('') +
        '</div></div>';
    }).join('') + '</div>';
    html += '<div class="sticky-save"><button type="button" class="btn primary big block" data-act="att-save">💾 Save attendance</button></div>';
    return html;
  }
  function attCountsHTML(cid, data) {
    var c = attStats(cid, null, data), un = c.total - c.marked;
    return ATT_KEYS.map(function (k) { return '<span class="att-chip ' + ATT[k].cls + '">' + ATT[k].label + ' <b>' + c[k] + '</b></span>'; }).join('') + (un ? '<span class="att-chip">Unmarked <b>' + un + '</b></span>' : '');
  }
  function refreshAttUI() {
    var dr = getDraft(UI.attClass, UI.attDate);
    var counts = $('#att-counts'); if (counts) counts.innerHTML = attCountsHTML(UI.attClass, dr.data);
    var st = $('#att-status'); if (st) { st.textContent = dr.dirty ? '● Unsaved changes' : '✓ Saved'; st.className = dr.dirty ? 'warn-t' : 'muted'; }
    $$('.roster-row').forEach(function (row) {
      var cur = dr.data[row.getAttribute('data-sid')];
      $$('.seg-btn', row).forEach(function (b) { var on = b.getAttribute('data-v') === cur; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    });
  }
  function saveAttendance() {
    var cid = UI.attClass, date = UI.attDate, dr = getDraft(cid, date);
    if (date > todayISO()) { toast('Can’t mark attendance for a future date', 'err'); return; }
    var list = activeStudents(cid);
    var marked = list.filter(function (s) { return dr.data[s.id]; }).length;
    var go = marked < list.length ? confirmBox((list.length - marked) + ' student(s) are not marked yet. Save anyway?', { ok: 'Save', danger: false, title: 'Some students unmarked' }) : Promise.resolve(true);
    go.then(function (ok) {
      if (!ok) return;
      var rec = Object.assign({}, attFor(date));
      list.forEach(function (s) { if (dr.data[s.id]) rec[s.id] = dr.data[s.id]; else delete rec[s.id]; });
      if (Object.keys(rec).length) S.attendance[date] = rec; else delete S.attendance[date];
      persist('attendance');
      dr.dirty = false;
      toast('Attendance saved for ' + className(cid) + ' · ' + fmtDate(date) + ' ✅');
      render();
    });
  }
  function monthGridHTML(cid, ym) {
    var list = activeStudents(cid);
    if (!list.length) return emptyState('📅', 'No students', 'Add students to ' + className(cid) + ' to see the monthly register.');
    var n = daysInMonth(ym), today = todayISO(), days = [];
    for (var d = 1; d <= n; d++) days.push(ym + '-' + String(d).padStart(2, '0'));
    var wd = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    var head = '<tr><th class="sticky-col">Student</th>' + days.map(function (iso) { var w = weekday(iso); return '<th class="' + (w === 0 ? 'sun' : '') + '">' + (+iso.slice(8)) + '<small>' + wd[w] + '</small></th>'; }).join('') + '<th>P</th><th>A</th><th>L</th><th>H</th><th>%</th></tr>';
    var body = list.map(function (s) {
      var c = { P: 0, A: 0, L: 0, H: 0 }, m = 0;
      var cells = days.map(function (iso) {
        if (iso > today) return '<td class="fut"></td>';
        var v = attFor(iso)[s.id];
        if (v && c[v] != null) { c[v]++; m++; }
        return '<td class="' + (v ? 'mc ' + ATT[v].cls : (weekday(iso) === 0 ? 'sun' : '')) + '">' + (v || '') + '</td>';
      }).join('');
      var pct = m ? Math.round((c.P + 0.5 * c.H) / m * 100) + '%' : '—';
      return '<tr><th class="sticky-col">' + esc(s.name) + '</th>' + cells + '<td class="tot">' + c.P + '</td><td class="tot">' + c.A + '</td><td class="tot">' + c.L + '</td><td class="tot">' + c.H + '</td><td class="tot"><b>' + pct + '</b></td></tr>';
    }).join('');
    return '<p class="muted small">P = Present · A = Absent · L = Leave · H = Half-day. Scroll sideways to see all days.</p><div class="table-wrap scroll-x"><table class="month-grid"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>';
  }
  function absentListHTML(which, date) {
    var cids = which === 'all' ? CLASSES.map(function (c) { return c.id; }) : [which];
    var rec = attFor(date), any = false;
    var html = cids.map(function (cid) {
      var list = activeStudents(cid);
      if (!list.length) return '';
      var st = attStats(cid, date);
      var away = list.filter(function (s) { return rec[s.id] && rec[s.id] !== 'P'; });
      any = true;
      return '<section class="card"><h3>' + CLASS_BY_ID[cid].emoji + ' ' + esc(className(cid)) + ' <small class="muted">' + (st.marked ? st.P + ' present of ' + st.total : 'not marked') + '</small></h3>' +
        (!st.marked ? '<p class="muted">Attendance not marked for this date.</p>' : away.length ? '<ul class="mini-list">' + away.map(function (s) {
          var v = rec[s.id];
          var msg = 'Dear ' + (s.parentName || 'Parent') + ', this is ' + S.settings.schoolName + '. ' + s.name + ' was marked ' + ATT[v].label.toLowerCase() + ' on ' + fmtDate(date) + '. Hope all is well! 🙏';
          return '<li><span><b>' + esc(s.name) + '</b> ' + badge(ATT[v].label, v === 'A' ? '#ff7a6b' : v === 'L' ? '#ffc93c' : '#38a8e0') + '<small>' + esc(s.parentName || '') + '</small></span>' + phoneLinks(s.phone, s.whatsapp, msg) + '</li>';
        }).join('') + '</ul>' : '<p class="muted">Everyone was present 🎉</p>') + '</section>';
    }).join('');
    return any ? html : emptyState('🌱', 'No students yet', 'Add students to see absences here.');
  }

  /* =====================================================================
   * FEES
   * ===================================================================== */
  function viewFees() {
    if (!isMonth(UI.feeMonth)) UI.feeMonth = thisMonth();
    var ym = UI.feeMonth;
    var studs = activeStudents();
    var billable = studs.filter(function (s) { return feeApplies(s, ym); });
    var expected = billable.reduce(function (a, s) { return a + num(s.monthlyFee); }, 0);
    var paysM = S.payments.filter(function (p) { return p.month === ym; });
    var received = paysM.reduce(function (a, p) { return a + num(p.amount); }, 0);
    var pendingList = billable.map(function (s) { return { s: s, paid: paidFor(s.id, ym), due: dueFor(s, ym) }; }).filter(function (x) { return x.due > 0; });
    var pending = pendingList.reduce(function (a, x) { return a + x.due; }, 0);
    var html = '<div class="toolbar">' + field('Fee month', '<input type="month" value="' + ym + '" data-change="fee-month">') +
      '<button class="btn primary" data-act="pay-add">➕ Record payment</button></div>';
    html += '<div class="stats">' + stat('📋', 'Expected for ' + fmtMonth(ym), inr(expected), billable.length + ' students with a monthly fee', 'sky') +
      stat('💰', 'Received towards ' + fmtMonth(ym), inr(received), paysM.length + ' receipt' + (paysM.length === 1 ? '' : 's'), 'green') +
      stat('⏳', 'Pending for ' + fmtMonth(ym), inr(pending), pendingList.length + ' student' + (pendingList.length === 1 ? '' : 's'), 'coral') + '</div>';
    var noFee = studs.filter(function (s) { return !num(s.monthlyFee); }).length;
    if (noFee) html += '<p class="note">ℹ️ ' + noFee + ' active student' + (noFee === 1 ? ' has' : 's have') + ' no monthly fee set, so they are not counted. Set it in the student’s profile.</p>';
    html += '<div class="seg-tabs"><button type="button" class="' + (UI.feeTab === 'pending' ? 'active' : '') + '" data-act="fee-tab" data-tab="pending">⏳ Pending (' + pendingList.length + ')</button><button type="button" class="' + (UI.feeTab === 'payments' ? 'active' : '') + '" data-act="fee-tab" data-tab="payments">🧾 Payments (' + paysM.length + ')</button></div>';
    if (UI.feeTab === 'payments') {
      if (!paysM.length) return html + emptyState('🧾', 'No payments for ' + fmtMonth(ym), 'Recorded payments for this fee month will appear here.', '<button class="btn primary" data-act="pay-add">➕ Record payment</button>');
      return html + '<div class="table-wrap"><table class="table responsive"><thead><tr><th>Receipt</th><th>Paid on</th><th>Student</th><th>Mode</th><th class="num">Amount</th><th class="act-col"><span class="sr">Actions</span></th></tr></thead><tbody>' +
        paysM.sort(function (a, b) { return (a.seq || 0) < (b.seq || 0) ? 1 : -1; }).map(function (p) {
          return '<tr><td data-label="Receipt"><b>' + esc(p.receiptNo) + '</b></td><td data-label="Paid on">' + fmtDate(p.paidOn) + '</td><td data-label="Student">' + esc(p.studentName) + ' <small class="muted">' + esc(className(p.classId)) + '</small></td><td data-label="Mode">' + esc(p.mode) + '</td><td data-label="Amount" class="num"><b>' + inr(p.amount) + '</b></td>' +
            '<td class="actions"><button class="icon-btn" data-act="receipt-view" data-id="' + esc(p.id) + '" title="View / print receipt" aria-label="Receipt">🧾</button><button class="icon-btn" data-act="pay-del" data-id="' + esc(p.id) + '" title="Delete payment" aria-label="Delete payment">🗑️</button></td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    if (!studs.length) return html + emptyState('🧒', 'No students yet', 'Add students with a monthly fee to track fees here.', '<a class="btn primary" href="#/classes">Go to classes</a>');
    if (!pendingList.length) return html + emptyState('🎉', 'All fees collected for ' + fmtMonth(ym), 'Nobody has pending fees for this month.');
    return html + '<div class="table-wrap"><table class="table responsive"><thead><tr><th>Student</th><th>Class</th><th class="num">Fee</th><th class="num">Paid</th><th class="num">Due</th><th>Parent</th><th class="act-col"><span class="sr">Actions</span></th></tr></thead><tbody>' +
      pendingList.sort(function (a, b) { return byName(a.s, b.s); }).map(function (x) {
        var msg = 'Dear ' + (x.s.parentName || 'Parent') + ', a gentle reminder from ' + S.settings.schoolName + ': ' + x.s.name + '’s fee for ' + fmtMonth(ym) + ' of ' + inr(x.due) + ' is pending. Please ignore if already paid. Thank you! 🙏';
        return '<tr><td data-label="Student"><b>' + esc(x.s.name) + '</b></td><td data-label="Class">' + esc(className(x.s.classId)) + '</td><td data-label="Fee" class="num">' + inr(x.s.monthlyFee) + '</td><td data-label="Paid" class="num">' + inr(x.paid) + '</td><td data-label="Due" class="num"><b class="coral-t">' + inr(x.due) + '</b></td>' +
          '<td data-label="Parent">' + esc(x.s.parentName || '') + ' ' + phoneLinks(x.s.phone, x.s.whatsapp, msg) + '</td><td class="actions"><button class="btn small primary" data-act="pay-add" data-student="' + esc(x.s.id) + '" data-month="' + ym + '">Collect</button></td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  function nextReceiptNo() {
    var seq = Math.max(1, parseInt(S.settings.receiptSeq, 10) || 1);
    return { seq: seq, no: (S.settings.receiptPrefix || 'LW').trim() + '-' + String(seq).padStart(4, '0') };
  }
  function openPaymentForm(studentId, month) {
    var studs = activeStudents();
    if (!studs.length) { toast('Add a student first', 'err'); return; }
    var groups = CLASSES.map(function (c) {
      var l = studs.filter(function (s) { return s.classId === c.id; });
      return l.length ? '<optgroup label="' + esc(c.name) + '">' + l.map(function (s) { return '<option value="' + esc(s.id) + '"' + (s.id === studentId ? ' selected' : '') + '>' + esc(s.name) + ' — ' + esc(s.parentName || '') + '</option>'; }).join('') + '</optgroup>' : '';
    }).join('');
    var r = nextReceiptNo();
    var body = '<form class="form" novalidate><div class="grid2">' +
      field('Student *', '<select name="studentId" required><option value="">Select student</option>' + groups + '</select>', '', 'span2') +
      field('Fee for month *', '<input type="month" name="month" value="' + esc(month || UI.feeMonth || thisMonth()) + '" required>') +
      field('Amount (₹) *', '<input type="number" name="amount" min="1" max="1000000" step="1" inputmode="numeric" required>') +
      field('Payment mode *', '<select name="mode">' + options(PAY_MODES, 'Cash') + '</select>') +
      field('Paid on *', '<input type="date" name="paidOn" max="' + todayISO() + '" value="' + todayISO() + '" required>') +
      field('Reference (UPI / bank ref, optional)', '<input name="ref" maxlength="60">') +
      field('Receipt no.', '<input value="' + esc(r.no) + '" disabled>', '<small class="hint">Auto-numbered</small>') +
      '</div><p id="due-hint" class="callout" hidden></p>' + field('Note', '<input name="note" maxlength="200" placeholder="e.g. Admission fee, books">') +
      '<div class="form-actions"><button type="button" class="btn ghost" data-act="modal-close">Cancel</button><button class="btn primary">Save &amp; get receipt</button></div></form>';
    openModal({
      title: 'Record fee payment', size: 'wide', body: body,
      mount: function (root) {
        var sel = $('[name=studentId]', root), mon = $('[name=month]', root), amt = $('[name=amount]', root), hint = $('#due-hint', root), amtTouched = false;
        amt.addEventListener('input', function () { amtTouched = true; });
        function upd() {
          var s = studentById(sel.value);
          if (!s || !isMonth(mon.value)) { hint.hidden = true; return; }
          var fee = num(s.monthlyFee), paid = paidFor(s.id, mon.value), due = Math.max(0, fee - paid);
          hint.hidden = false;
          hint.innerHTML = '<b>' + esc(s.name) + '</b> · ' + esc(fmtMonth(mon.value)) + ': fee ' + inr(fee) + ' · paid ' + inr(paid) + ' · <b>due ' + inr(due) + '</b>' + (mon.value < admMonth(s) ? '<br><small class="warn-t">This month is before the admission date (' + fmtDate(s.admissionDate) + ').</small>' : '');
          if (!amtTouched) amt.value = due > 0 ? due : '';
        }
        sel.addEventListener('change', upd); mon.addEventListener('change', upd); upd();
      },
      onSubmit: function (form, fd) {
        var g = function (k) { return String(fd.get(k) == null ? '' : fd.get(k)).trim(); };
        var ok = true, s = studentById(g('studentId')), amount = +g('amount');
        if (!s) { fieldError(form, 'studentId', 'Please choose a student'); ok = false; }
        if (!isMonth(g('month'))) { fieldError(form, 'month', 'Please choose the fee month'); ok = false; }
        if (!(amount > 0) || amount > 1000000) { fieldError(form, 'amount', 'Enter an amount greater than ₹0'); ok = false; }
        if (PAY_MODES.indexOf(g('mode')) < 0) { fieldError(form, 'mode', 'Choose a payment mode'); ok = false; }
        if (!isISODate(g('paidOn')) || g('paidOn') > todayISO()) { fieldError(form, 'paidOn', 'Choose a valid date (not in the future)'); ok = false; }
        if (!ok) return false;
        var due = Math.max(0, num(s.monthlyFee) - paidFor(s.id, g('month')));
        return (num(s.monthlyFee) && amount > due ? confirmBox('This is more than the amount due for ' + fmtMonth(g('month')) + ' (' + inr(due) + '). Save anyway?', { ok: 'Save', danger: false, title: 'Amount more than due' }) : Promise.resolve(true)).then(function (go) {
          if (!go) return false;
          var r = nextReceiptNo();
          var p = { id: uid(), seq: r.seq, receiptNo: r.no, studentId: s.id, studentName: s.name, parentName: s.parentName || '', classId: s.classId, month: g('month'),
            amount: Math.round(amount * 100) / 100, mode: g('mode'), ref: g('ref'), paidOn: g('paidOn'), note: g('note'), createdAt: new Date().toISOString() };
          S.payments.push(p);
          S.settings.receiptSeq = r.seq + 1;
          persist('payments', 'settings');
          toast('Payment saved · ' + p.receiptNo);
          render();
          setTimeout(function () { openReceipt(p.id); }, 0);
          return true;
        });
      }
    });
  }
  function receiptHTML(p) {
    var st = S.settings, s = studentById(p.studentId);
    var balance = s ? dueFor(s, p.month) : null;
    var r = function (k, v) { return '<tr><th>' + k + '</th><td>' + v + '</td></tr>'; };
    return '<div class="receipt"><div class="r-head"><img src="assets/logo.jpeg" alt="" width="64" height="64"><div><h2>' + esc(st.schoolName) + '</h2><p>' + esc(st.address) + '</p><p>📞 ' + esc(st.phone) + (st.email ? ' · ✉️ ' + esc(st.email) : '') + '</p></div></div>' +
      '<div class="r-title">FEE RECEIPT</div><div class="r-meta"><span>Receipt No: <b>' + esc(p.receiptNo) + '</b></span><span>Date: <b>' + fmtDate(p.paidOn) + '</b></span></div>' +
      '<table class="r-table">' + r('Student', '<b>' + esc(p.studentName) + '</b>') + r('Class', esc(className(p.classId))) + r('Parent / Guardian', esc(p.parentName || (s && s.parentName) || '—')) +
      r('Fee for month', esc(fmtMonth(p.month))) + r('Payment mode', esc(p.mode) + (p.ref ? ' · Ref ' + esc(p.ref) : '')) + (p.note ? r('Note', esc(p.note)) : '') +
      r('Amount received', '<b class="r-amt">' + inr(p.amount) + '</b>') + r('In words', 'Rupees ' + esc(inWords(p.amount)) + ' Only') +
      (balance != null && s && num(s.monthlyFee) ? r('Balance for ' + esc(fmtMonth(p.month)), balance > 0 ? inr(balance) : 'Nil — fully paid ✓') : '') + '</table>' +
      '<div class="r-foot"><span>Thank you! 🌈</span><span class="sign">Authorised signature</span></div><p class="r-small">This is a computer-generated receipt.</p></div>';
  }
  function receiptText(p) {
    return S.settings.schoolName + '\nFee Receipt ' + p.receiptNo + '\n\nStudent: ' + p.studentName + ' (' + className(p.classId) + ')\nFee month: ' + fmtMonth(p.month) +
      '\nAmount: ' + inr(p.amount) + ' (' + p.mode + ')\nPaid on: ' + fmtDate(p.paidOn) + '\n\nThank you! 🙏\n' + S.settings.phone;
  }
  function findPayment(id) { return S.payments.filter(function (p) { return p.id === id; })[0]; }
  function openReceipt(id) {
    var p = findPayment(id);
    if (!p) return;
    var s = studentById(p.studentId);
    var wa = s ? (s.whatsapp || s.phone) : '';
    var waLink = wa ? waHref(wa, receiptText(p)) : 'https://wa.me/?text=' + encodeURIComponent(receiptText(p));
    openModal({
      title: 'Receipt ' + p.receiptNo, size: 'wide',
      body: '<div class="receipt-preview">' + receiptHTML(p) + '</div><div class="form-actions"><a class="btn wa-btn" href="' + esc(waLink) + '" target="_blank" rel="noopener">' + WA_SVG + ' Share on WhatsApp</a><button type="button" class="btn primary" data-act="receipt-print" data-id="' + esc(p.id) + '">🖨️ Print</button></div>'
    });
  }
  function printReceipt(id) {
    var p = findPayment(id);
    if (!p) return;
    var pr = $('#print-root');
    pr.innerHTML = receiptHTML(p) + '<div class="r-cut">✂ - - - - - - - - - - - - - - - - - - - office copy - - - - - - - - - - - - - - - - - - -</div>' + receiptHTML(p);
    var imgs = $$('img', pr).filter(function (i) { return !i.complete; });
    var go = function () { setTimeout(function () { window.print(); }, 50); };
    if (!imgs.length) go();
    else { var left = imgs.length; imgs.forEach(function (i) { var done = function () { if (--left === 0) go(); }; i.onload = done; i.onerror = done; }); }
  }

  /* =====================================================================
   * ENQUIRIES
   * ===================================================================== */
  function viewEnquiries() {
    var today = todayISO(), ym = thisMonth();
    var isDue = function (e) { return e.followUp && e.followUp <= today && (e.status === 'New' || e.status === 'Visited'); };
    var month = S.enquiries.filter(function (e) { return (e.date || '').slice(0, 7) === ym; });
    var dueN = S.enquiries.filter(isDue).length;
    var html = '<div class="stats">' + stat('📝', 'Enquiries this month', String(month.length), fmtMonth(ym), 'sky') +
      stat('🎓', 'Converted this month', String(month.filter(function (e) { return e.status === 'Admitted'; }).length), 'Status “Admitted”', 'green') +
      stat('📞', 'Follow-ups due', String(dueN), 'Today or overdue', dueN ? 'coral' : 'yellow') + '</div>';
    html += '<div class="toolbar"><input type="search" class="search" placeholder="🔍 Search child, parent or phone" value="' + esc(UI.enqSearch) + '" data-input="enq-search" aria-label="Search enquiries">' +
      '<button class="btn primary" data-act="enq-add">➕ New enquiry</button></div>';
    html += '<div class="chips">' + ['All', 'Due'].concat(ENQ_STATUS).map(function (f) {
      var n = f === 'All' ? S.enquiries.length : f === 'Due' ? dueN : S.enquiries.filter(function (e) { return e.status === f; }).length;
      return '<button type="button" class="chip' + (UI.enqFilter === f ? ' active' : '') + '" data-act="enq-filter" data-f="' + esc(f) + '">' + esc(f === 'Due' ? '📞 Due' : f) + ' <span>' + n + '</span></button>';
    }).join('') + '</div>';
    html += '<div id="enq-list">' + enqListHTML() + '</div>';
    return html;
  }
  function enqListHTML() {
    var today = todayISO(), q = UI.enqSearch.trim().toLowerCase();
    var isDue = function (e) { return e.followUp && e.followUp <= today && (e.status === 'New' || e.status === 'Visited'); };
    if (!S.enquiries.length) return emptyState('📝', 'No enquiries yet', 'When a parent calls, messages or walks in, note it here so no follow-up is missed.', '<button class="btn primary" data-act="enq-add">➕ Add first enquiry</button>');
    var list = S.enquiries.filter(function (e) {
      if (UI.enqFilter === 'Due' && !isDue(e)) return false;
      if (UI.enqFilter !== 'All' && UI.enqFilter !== 'Due' && e.status !== UI.enqFilter) return false;
      return !q || [e.childName, e.parentName, e.phone].join(' ').toLowerCase().indexOf(q) >= 0;
    }).sort(function (a, b) {
      var da = isDue(a) ? 0 : 1, db = isDue(b) ? 0 : 1;
      if (da !== db) return da - db;
      return (b.date || '') < (a.date || '') ? -1 : (b.date || '') > (a.date || '') ? 1 : 0;
    });
    if (!list.length) return emptyState('🔍', 'Nothing here', 'No enquiries match this filter.');
    return '<div class="enq-grid">' + list.map(function (e) {
      var due = isDue(e), overdue = due && e.followUp < today;
      var age = e.childAge !== '' && e.childAge != null ? e.childAge + ' yrs' : '';
      return '<article class="enq' + (due ? (overdue ? ' overdue' : ' due') : '') + '">' +
        (due ? '<div class="enq-flag">' + (overdue ? '⚠️ Follow-up overdue (' + fmtDate(e.followUp) + ')' : '📞 Follow up today') + '</div>' : '') +
        '<div class="enq-top"><div><h3>' + esc(e.childName) + (age ? ' <small>' + esc(age) + '</small>' : '') + '</h3><p>' + esc(e.parentName) + '</p></div>' +
        '<select class="status-sel" data-change="enq-status" data-id="' + esc(e.id) + '" aria-label="Status" style="--b:' + ENQ_COLORS[e.status] + '">' + options(ENQ_STATUS, e.status) + '</select></div>' +
        '<div class="enq-meta">' + phoneLinks(e.phone) + '</div>' +
        '<div class="enq-meta"><span>📅 ' + fmtDate(e.date) + '</span><span>📣 ' + esc(e.source || '—') + '</span>' + (e.followUp && !due ? '<span>🔔 ' + fmtDate(e.followUp) + '</span>' : '') + (suggestClass(num(e.childAge)) && e.childAge ? '<span>🏫 ' + esc(className(suggestClass(num(e.childAge)))) + '</span>' : '') + '</div>' +
        (e.notes ? '<p class="enq-notes">' + esc(e.notes) + '</p>' : '') +
        '<div class="enq-actions">' + (e.status === 'Admitted' && e.studentId && studentById(e.studentId) ? '<span class="tag ok">🎓 Admitted</span>' : '<button class="btn small primary" data-act="enq-convert" data-id="' + esc(e.id) + '">🎓 Convert to student</button>') +
        '<button class="icon-btn" data-act="enq-edit" data-id="' + esc(e.id) + '" title="Edit" aria-label="Edit">✏️</button><button class="icon-btn" data-act="enq-del" data-id="' + esc(e.id) + '" title="Delete" aria-label="Delete">🗑️</button></div></article>';
    }).join('') + '</div>';
  }
  function findEnq(id) { return S.enquiries.filter(function (e) { return e.id === id; })[0]; }
  function openEnquiryForm(e) {
    var v = Object.assign({ date: todayISO(), status: 'New', source: 'Walk-in' }, e || {});
    var body = '<form class="form" novalidate><div class="grid2">' +
      field('Enquiry date *', '<input type="date" name="date" max="' + todayISO() + '" value="' + esc(v.date) + '" required>') +
      field('Source', '<select name="source">' + options(ENQ_SOURCES, v.source) + '</select>') +
      field('Parent name *', '<input name="parentName" maxlength="80" value="' + esc(v.parentName) + '" required>') +
      field('Phone *', '<input type="tel" name="phone" inputmode="tel" maxlength="16" placeholder="10-digit mobile" value="' + esc(v.phone) + '" required>') +
      field('Child name *', '<input name="childName" maxlength="80" value="' + esc(v.childName) + '" required>') +
      field('Child age (years)', '<input type="number" name="childAge" min="1" max="8" step="0.5" inputmode="decimal" placeholder="e.g. 3.5" value="' + esc(v.childAge == null ? '' : v.childAge) + '">', '<small class="hint" id="enq-hint"></small>') +
      field('Status', '<select name="status">' + options(ENQ_STATUS, v.status) + '</select>') +
      field('Follow-up date', '<input type="date" name="followUp" value="' + esc(v.followUp) + '">') +
      '</div>' + field('Notes', '<textarea name="notes" rows="3" maxlength="1500" placeholder="Timings asked, fee discussed, visit planned…">' + esc(v.notes) + '</textarea>') +
      '<div class="form-actions"><button type="button" class="btn ghost" data-act="modal-close">Cancel</button><button class="btn primary">' + (e ? 'Save changes' : 'Add enquiry') + '</button></div></form>';
    openModal({
      title: e ? 'Edit enquiry' : 'New enquiry', size: 'wide', body: body,
      mount: function (root) {
        var a = $('[name=childAge]', root), h = $('#enq-hint', root);
        var u = function () { var y = parseFloat(a.value); h.textContent = isFinite(y) && y > 0 ? 'Suggested class: ' + className(suggestClass(y)) : ''; };
        a.addEventListener('input', u); u();
      },
      onSubmit: function (form, fd) {
        var g = function (k) { return String(fd.get(k) == null ? '' : fd.get(k)).trim(); };
        var ok = true;
        var d = { date: g('date'), source: g('source'), parentName: g('parentName'), phone: g('phone'), childName: g('childName'), childAge: g('childAge'), status: g('status'), followUp: g('followUp'), notes: g('notes') };
        if (!isISODate(d.date) || d.date > todayISO()) { fieldError(form, 'date', 'Choose a valid date (not in the future)'); ok = false; }
        if (d.parentName.length < 2) { fieldError(form, 'parentName', 'Please enter the parent’s name'); ok = false; }
        if (!validPhone(d.phone)) { fieldError(form, 'phone', 'Enter a valid 10-digit Indian mobile number'); ok = false; }
        if (d.childName.length < 1) { fieldError(form, 'childName', 'Please enter the child’s name'); ok = false; }
        if (d.childAge !== '' && !(+d.childAge >= 1 && +d.childAge <= 8)) { fieldError(form, 'childAge', 'Age should be between 1 and 8 years'); ok = false; }
        if (d.followUp && !isISODate(d.followUp)) { fieldError(form, 'followUp', 'Invalid date'); ok = false; }
        if (ENQ_STATUS.indexOf(d.status) < 0) d.status = 'New';
        if (ENQ_SOURCES.indexOf(d.source) < 0) d.source = 'Walk-in';
        if (!ok) return false;
        d.childAge = d.childAge === '' ? '' : +d.childAge;
        if (e) Object.assign(e, d, { updatedAt: new Date().toISOString() });
        else S.enquiries.push(Object.assign({ id: uid(), createdAt: new Date().toISOString() }, d));
        persist('enquiries');
        toast(e ? 'Enquiry updated' : 'Enquiry added');
        render();
        return true;
      }
    });
  }
  function convertEnquiry(id) {
    var e = findEnq(id);
    if (!e) return;
    var pre = { name: e.childName, parentName: e.parentName, phone: e.phone, classId: suggestClass(e.childAge === '' ? NaN : num(e.childAge)) || '', admissionDate: todayISO(),
      notes: 'Converted from enquiry dated ' + fmtDate(e.date) + ' (source: ' + (e.source || '—') + ').' + (e.notes ? ' ' + e.notes : '') };
    openStudentForm(null, pre, function (s) {
      e.status = 'Admitted'; e.studentId = s.id; e.updatedAt = new Date().toISOString();
      persist('enquiries');
    });
  }

  /* =====================================================================
   * STAFF
   * ===================================================================== */
  function viewStaff() {
    var total = S.staff.reduce(function (a, s) { return a + (s.status === 'Left' ? 0 : num(s.salary)); }, 0);
    var active = S.staff.filter(function (s) { return s.status !== 'Left'; });
    var html = '<div class="stats">' + stat('👩‍🏫', 'Staff members', String(active.length), active.filter(function (s) { return /teacher/i.test(s.role || ''); }).length + ' teaching', 'sky') +
      stat('💸', 'Monthly salaries', inr(total), 'Active staff only', 'yellow') + '</div>';
    html += '<div class="toolbar"><input type="search" class="search" placeholder="🔍 Search staff" value="' + esc(UI.staffSearch) + '" data-input="staff-search" aria-label="Search staff"><button class="btn primary" data-act="staff-add">➕ Add staff</button></div>';
    html += '<div id="staff-list">' + staffListHTML() + '</div>';
    return html;
  }
  function staffListHTML() {
    if (!S.staff.length) return emptyState('👩‍🏫', 'No staff added yet', 'Add teachers, helpers and office staff. You can then pick class teachers in Settings.', '<button class="btn primary" data-act="staff-add">➕ Add staff</button>');
    var q = UI.staffSearch.trim().toLowerCase();
    var list = S.staff.filter(function (s) { return !q || [s.name, s.role, s.phone].join(' ').toLowerCase().indexOf(q) >= 0; }).sort(byName);
    if (!list.length) return emptyState('🔍', 'No matches', 'No staff match your search.');
    return '<div class="table-wrap"><table class="table responsive"><thead><tr><th>Name</th><th>Role</th><th>Phone</th><th>Class</th><th class="num">Salary / month</th><th>Joined</th><th class="act-col"><span class="sr">Actions</span></th></tr></thead><tbody>' +
      list.map(function (s) {
        return '<tr' + (s.status === 'Left' ? ' class="left"' : '') + '><td data-label="Name"><b>' + esc(s.name) + '</b>' + (s.status === 'Left' ? ' <span class="tag">Left</span>' : '') + '</td><td data-label="Role">' + esc(s.role || '—') + '</td><td data-label="Phone">' + phoneLinks(s.phone) + '</td>' +
          '<td data-label="Class">' + (s.classId ? esc(className(s.classId)) : '<span class="muted">—</span>') + '</td><td data-label="Salary" class="num">' + (num(s.salary) ? inr(s.salary) : '—') + '</td><td data-label="Joined">' + fmtDate(s.joined) + '</td>' +
          '<td class="actions"><button class="icon-btn" data-act="staff-edit" data-id="' + esc(s.id) + '" title="Edit" aria-label="Edit">✏️</button><button class="icon-btn" data-act="staff-del" data-id="' + esc(s.id) + '" title="Delete" aria-label="Delete">🗑️</button></td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  function openStaffForm(st) {
    var v = Object.assign({ role: 'Teacher', status: 'Active' }, st || {});
    var body = '<form class="form" novalidate><div class="grid2">' +
      field('Full name *', '<input name="name" maxlength="80" value="' + esc(v.name) + '" required>') +
      field('Role *', '<select name="role">' + options(STAFF_ROLES, v.role) + '</select>') +
      field('Phone *', '<input type="tel" name="phone" inputmode="tel" maxlength="16" value="' + esc(v.phone) + '" required>') +
      field('Class assigned', '<select name="classId">' + options(classOptions(), v.classId, 'None') + '</select>') +
      field('Monthly salary (₹)', '<input type="number" name="salary" min="0" max="10000000" step="1" inputmode="numeric" value="' + esc(v.salary == null ? '' : v.salary) + '">') +
      field('Joining date', '<input type="date" name="joined" value="' + esc(v.joined) + '">') +
      field('Status', '<select name="status">' + options(['Active', 'Left'], v.status) + '</select>') +
      '</div>' + field('Notes', '<textarea name="notes" rows="2" maxlength="800">' + esc(v.notes) + '</textarea>') +
      '<div class="form-actions"><button type="button" class="btn ghost" data-act="modal-close">Cancel</button><button class="btn primary">' + (st ? 'Save changes' : 'Add staff') + '</button></div></form>';
    openModal({
      title: st ? 'Edit staff' : 'Add staff', size: 'wide', body: body,
      onSubmit: function (form, fd) {
        var g = function (k) { return String(fd.get(k) == null ? '' : fd.get(k)).trim(); };
        var ok = true;
        var d = { name: g('name').replace(/\s+/g, ' '), role: g('role'), phone: g('phone'), classId: CLASS_BY_ID[g('classId')] ? g('classId') : '', joined: g('joined'), status: g('status') === 'Left' ? 'Left' : 'Active', notes: g('notes') };
        if (d.name.length < 2) { fieldError(form, 'name', 'Please enter a name'); ok = false; }
        if (!validPhone(d.phone)) { fieldError(form, 'phone', 'Enter a valid 10-digit Indian mobile number'); ok = false; }
        var sal = g('salary');
        if (sal !== '' && !(+sal >= 0)) { fieldError(form, 'salary', 'Salary must be 0 or more'); ok = false; }
        if (d.joined && !isISODate(d.joined)) { fieldError(form, 'joined', 'Invalid date'); ok = false; }
        if (!ok) return false;
        d.salary = sal === '' ? 0 : Math.round(+sal);
        if (st) Object.assign(st, d, { updatedAt: new Date().toISOString() });
        else S.staff.push(Object.assign({ id: uid(), createdAt: new Date().toISOString() }, d));
        persist('staff');
        toast(st ? 'Staff updated' : d.name + ' added');
        render();
        return true;
      }
    });
  }

  /* =====================================================================
   * SETTINGS (admin) / ACCOUNT (teacher)
   * ===================================================================== */
  function viewSettings() {
    var lockNote = '<div class="callout warn"><b>🔐 About the PIN lock</b><p>The PIN is a convenience lock to keep casual eyes out. It is stored as a salted SHA-256 hash, but because all data lives inside this browser, anyone with access to this device and some technical skill could read it. Don’t share the device unlocked, and keep backups somewhere safe.</p></div>';
    if (!isAdmin()) {
      return '<section class="card"><h2>👤 My account</h2><p>' + esc(ME.name) + ' · Teacher, ' + esc(className(ME.classId)) + '</p></section>' +
        '<section class="card"><h3>Change my PIN</h3><form class="form narrow" data-form="my-pin" novalidate>' + pinInput('cur', 'Current PIN', 'current-password') + pinInput('pin', 'New PIN (4–6 digits)', 'new-password') + pinInput('pin2', 'Confirm new PIN', 'new-password') +
        '<button class="btn primary">Update PIN</button></form></section>' + lockNote +
        '<div class="callout"><b>📱 Data on this device</b><p>Attendance you mark here is saved only in this phone’s browser. The admin sees it only on this same device unless a backup is shared. Ask the admin how your school shares data.</p></div>';
    }
    var st = S.settings;
    var html = '<section class="card"><h2>🏫 School details</h2><form class="form" data-form="school" novalidate><div class="grid2">' +
      field('School name *', '<input name="schoolName" maxlength="80" value="' + esc(st.schoolName) + '" required>') +
      field('Owner / Admin name', '<input name="owner" maxlength="60" value="' + esc(st.owner) + '">') +
      field('Phone (on receipts)', '<input name="phone" maxlength="30" value="' + esc(st.phone) + '">') +
      field('Email (optional)', '<input type="email" name="email" maxlength="80" value="' + esc(st.email) + '">') +
      field('Address (on receipts)', '<textarea name="address" rows="2" maxlength="250">' + esc(st.address) + '</textarea>', '', 'span2') +
      field('Receipt prefix', '<input name="receiptPrefix" maxlength="8" value="' + esc(st.receiptPrefix) + '" pattern="[A-Za-z0-9-]+">', '<small class="hint">Next receipt: ' + esc(nextReceiptNo().no) + '</small>') +
      field('Track pending fees from', '<input type="month" name="feesStartMonth" value="' + esc(st.feesStartMonth) + '">', '<small class="hint">Months before this are not counted as pending</small>') +
      '</div><button class="btn primary">Save school details</button></form></section>';

    html += '<section class="card"><h2>👩‍🏫 Class teachers</h2>' + (S.staff.length ? '<form class="form" data-form="class-teachers"><div class="grid2">' + CLASSES.map(function (c) {
      return field(c.emoji + ' ' + c.name, '<select name="' + c.id + '">' + options(S.staff.filter(function (s) { return s.status !== 'Left'; }).sort(byName).map(function (s) { return { value: s.id, label: s.name + ' (' + s.role + ')' }; }), st.classTeachers[c.id], 'Not assigned') + '</select>');
    }).join('') + '</div><button class="btn primary">Save class teachers</button></form>' : '<p class="muted">Add staff first on the <a href="#/staff">Staff</a> page, then pick a class teacher for each class here.</p>') + '</section>';

    html += '<section class="card"><h2>📱 Teacher logins</h2><p class="muted">Teachers can see only their class’s students and attendance — no fees, staff or settings.</p>' +
      (S.users.length ? '<ul class="mini-list">' + S.users.slice().sort(byName).map(function (u) {
        return '<li><span><b>' + esc(u.name) + '</b><small>' + esc(className(u.classId)) + '</small></span><span><button class="btn small ghost" data-act="user-reset" data-id="' + esc(u.id) + '">Reset PIN</button> <button class="icon-btn" data-act="user-del" data-id="' + esc(u.id) + '" title="Remove login" aria-label="Remove">🗑️</button></span></li>';
      }).join('') + '</ul>' : '<p class="muted">No teacher logins yet.</p>') +
      '<details class="add-box"' + (S.users.length ? '' : ' open') + '><summary>➕ Add teacher login</summary><form class="form" data-form="add-user" novalidate><div class="grid2">' +
      field('Teacher name *', '<input name="name" maxlength="60" list="staff-names" required>') + '<datalist id="staff-names">' + S.staff.map(function (s) { return '<option value="' + esc(s.name) + '">'; }).join('') + '</datalist>' +
      field('Class *', '<select name="classId" required>' + options(classOptions(), '', 'Select class') + '</select>') +
      pinInput('pin', 'PIN (4–6 digits) *', 'new-password') + pinInput('pin2', 'Confirm PIN *', 'new-password') +
      '</div><button class="btn primary">Create login</button></form></details></section>';

    html += '<section class="card"><h2>🔐 Admin PIN</h2><form class="form narrow" data-form="admin-pin" novalidate>' + pinInput('cur', 'Current PIN', 'current-password') + pinInput('pin', 'New PIN (4–6 digits)', 'new-password') + pinInput('pin2', 'Confirm new PIN', 'new-password') +
      '<button class="btn primary">Change PIN</button></form>' + lockNote + '</section>';

    var kb = (Store.usageBytes() / 1024).toFixed(1);
    html += '<section class="card"><h2>💾 Backup &amp; data</h2><div class="callout warn"><b>⚠️ Your data lives only on this device</b><p>Everything is saved in this browser (localStorage) on this device only. It is <b>not</b> uploaded anywhere. Clearing browser data, using private/incognito mode, or losing the phone will lose it. Other devices will not see it. <b>Download a backup regularly</b> (e.g. every Friday) and keep it in Google Drive or email. Restore it here or on another device.</p></div>' +
      '<p class="muted small">Using about ' + kb + ' KB on this device · ' + S.students.length + ' students · ' + S.payments.length + ' payments · ' + Object.keys(S.attendance).length + ' attendance days.' + (st.lastBackup ? ' Last backup: ' + fmtDate(st.lastBackup.slice(0, 10)) + '.' : ' No backup taken yet.') + '</p>' +
      '<div class="row gap wrap"><button class="btn primary" data-act="backup">⬇️ Download backup (JSON)</button><label class="btn ghost file-btn">⬆️ Restore from backup<input type="file" accept=".json,application/json" data-change="restore" hidden></label></div>' +
      '<h3>Export to Excel (CSV)</h3><div class="row gap wrap">' + ['students', 'attendance', 'payments', 'enquiries', 'staff'].map(function (t) { return '<button class="btn small ghost" data-act="csv" data-t="' + t + '">📄 ' + cap(t) + '</button>'; }).join('') + '</div>' +
      '<details class="danger-zone"><summary>Danger zone</summary><p>Erase all dashboard data from this device (students, attendance, fees, enquiries, staff, logins and PINs). Download a backup first.</p><button class="btn danger" data-act="erase">Erase everything on this device</button></details></section>';
    html += '<p class="muted small center">The Little Wings Dashboard v' + APP_VERSION + ' · Works offline · Times in India Standard Time</p>';
    return html;
  }

  var FORMS = {
    school: function (f, fd) {
      var g = function (k) { return String(fd.get(k) == null ? '' : fd.get(k)).trim(); };
      if (!g('schoolName')) return fieldError(f, 'schoolName', 'School name is required');
      if (g('email') && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(g('email'))) return fieldError(f, 'email', 'Enter a valid email or leave blank');
      if (g('receiptPrefix') && !/^[A-Za-z0-9-]+$/.test(g('receiptPrefix'))) return fieldError(f, 'receiptPrefix', 'Use letters, numbers or - only');
      ['schoolName', 'owner', 'phone', 'email', 'address'].forEach(function (k) { S.settings[k] = g(k); });
      S.settings.receiptPrefix = g('receiptPrefix') || 'LW';
      S.settings.feesStartMonth = isMonth(g('feesStartMonth')) ? g('feesStartMonth') : '';
      persist('settings');
      if (ME.role === 'admin') ME.name = S.settings.owner || 'Admin';
      toast('School details saved');
      showShell();
    },
    'class-teachers': function (f, fd) {
      CLASSES.forEach(function (c) { var v = String(fd.get(c.id) || ''); if (staffById(v)) S.settings.classTeachers[c.id] = v; else delete S.settings.classTeachers[c.id]; });
      persist('settings');
      toast('Class teachers saved');
      render();
    },
    'add-user': function (f, fd) {
      var name = String(fd.get('name') || '').trim(), cid = String(fd.get('classId') || ''), pin = String(fd.get('pin') || ''), pin2 = String(fd.get('pin2') || '');
      if (name.length < 2) return fieldError(f, 'name', 'Enter the teacher’s name');
      if (S.users.some(function (u) { return u.name.toLowerCase() === name.toLowerCase(); })) return fieldError(f, 'name', 'A login with this name already exists');
      if (!CLASS_BY_ID[cid]) return fieldError(f, 'classId', 'Choose a class');
      if (!validPinFormat(pin)) return fieldError(f, 'pin', 'PIN must be 4 to 6 digits');
      if (pin !== pin2) return fieldError(f, 'pin2', 'PINs do not match');
      return makePinRecord(pin).then(function (rec) {
        S.users.push(Object.assign({ id: uid(), name: name, classId: cid, createdAt: new Date().toISOString() }, rec));
        persist('users');
        toast('Login created for ' + name + ' (' + className(cid) + ')');
        render();
      });
    },
    'admin-pin': function (f, fd) {
      var cur = String(fd.get('cur') || ''), pin = String(fd.get('pin') || ''), pin2 = String(fd.get('pin2') || '');
      if (!validPinFormat(pin)) return fieldError(f, 'pin', 'PIN must be 4 to 6 digits');
      if (pin !== pin2) return fieldError(f, 'pin2', 'PINs do not match');
      return checkPin(S.auth, cur).then(function (ok) {
        if (!ok) return fieldError(f, 'cur', 'Current PIN is wrong');
        return makePinRecord(pin).then(function (rec) { rec.createdAt = new Date().toISOString(); S.auth = rec; persist('auth'); f.reset(); toast('Admin PIN changed 🔐'); });
      });
    },
    'my-pin': function (f, fd) {
      var u = S.users.filter(function (x) { return x.id === ME.userId; })[0];
      var cur = String(fd.get('cur') || ''), pin = String(fd.get('pin') || ''), pin2 = String(fd.get('pin2') || '');
      if (!u) return;
      if (!validPinFormat(pin)) return fieldError(f, 'pin', 'PIN must be 4 to 6 digits');
      if (pin !== pin2) return fieldError(f, 'pin2', 'PINs do not match');
      return checkPin(u, cur).then(function (ok) {
        if (!ok) return fieldError(f, 'cur', 'Current PIN is wrong');
        return makePinRecord(pin).then(function (rec) { Object.assign(u, rec); persist('users'); f.reset(); toast('Your PIN was changed 🔐'); });
      });
    }
  };

  function exportCSV(t) {
    var rows, date = todayISO();
    if (t === 'students') {
      rows = [['Name', 'Class', 'Date of birth', 'Age', 'Parent / Guardian', 'Phone', 'WhatsApp', 'Admission date', 'Monthly fee (INR)', 'Status', 'Emergency contact', 'Authorised pickup', 'Medical notes', 'Notes']].concat(
        S.students.slice().sort(byName).map(function (s) { return [s.name, className(s.classId), fmtDate(s.dob), ageText(s.dob), s.parentName, s.phone, s.whatsapp, fmtDate(s.admissionDate), num(s.monthlyFee), s.status || 'Active', s.emergency, s.pickup, s.medical, s.notes]; }));
    } else if (t === 'attendance') {
      rows = [['Date', 'Class', 'Student', 'Status']];
      Object.keys(S.attendance).sort().forEach(function (d) {
        var rec = attFor(d);
        Object.keys(rec).forEach(function (id) { var s = studentById(id); rows.push([fmtDate(d), s ? className(s.classId) : '', s ? s.name : '(deleted student)', ATT[rec[id]] ? ATT[rec[id]].label : rec[id]]); });
      });
    } else if (t === 'payments') {
      rows = [['Receipt no', 'Paid on', 'Student', 'Class', 'Parent', 'Fee month', 'Amount (INR)', 'Mode', 'Reference', 'Note']].concat(
        S.payments.slice().sort(function (a, b) { return (a.seq || 0) - (b.seq || 0); }).map(function (p) { return [p.receiptNo, fmtDate(p.paidOn), p.studentName, className(p.classId), p.parentName, fmtMonth(p.month), num(p.amount), p.mode, p.ref, p.note]; }));
    } else if (t === 'enquiries') {
      rows = [['Date', 'Parent', 'Child', 'Age (yrs)', 'Phone', 'Source', 'Status', 'Follow-up', 'Notes']].concat(
        S.enquiries.slice().sort(function (a, b) { return (a.date || '') < (b.date || '') ? -1 : 1; }).map(function (e) { return [fmtDate(e.date), e.parentName, e.childName, e.childAge, e.phone, e.source, e.status, fmtDate(e.followUp), e.notes]; }));
    } else if (t === 'staff') {
      rows = [['Name', 'Role', 'Phone', 'Class', 'Monthly salary (INR)', 'Joined', 'Status', 'Notes']].concat(
        S.staff.slice().sort(byName).map(function (s) { return [s.name, s.role, s.phone, s.classId ? className(s.classId) : '', num(s.salary), fmtDate(s.joined), s.status || 'Active', s.notes]; }));
    } else return;
    if (rows.length < 2) { toast('No ' + t + ' to export yet', 'err'); return; }
    rows = rows.map(function (r) { return r.map(function (v) { return v === '—' ? '' : v; }); });
    downloadFile('littlewings-' + t + '-' + date + '.csv', csv(rows), 'text/csv;charset=utf-8');
    toast(cap(t) + ' exported (' + (rows.length - 1) + ' rows)');
  }
  function doBackup() {
    S.settings.lastBackup = new Date().toISOString();
    persist('settings');
    var data = JSON.stringify(Store.exportAll(), null, 1);
    downloadFile('littlewings-backup-' + todayISO() + '.json', data, 'application/json');
    toast('Backup downloaded — keep it somewhere safe');
    render();
  }
  function doRestore(input) {
    var file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) { toast('That file is too large to be a backup', 'err'); return; }
    var reader = new FileReader();
    reader.onload = function () {
      var obj;
      try { obj = JSON.parse(String(reader.result)); Store.validateBackup(obj); }
      catch (e) { toast(e instanceof SyntaxError ? 'This file is not valid JSON' : e.message, 'err'); return; }
      var d = obj.data, n = function (x) { return Array.isArray(x) ? x.length : 0; };
      confirmBox('Replace ALL data on this device with the backup from ' + fmtDate((obj.exportedAt || '').slice(0, 10)) + '? It has ' + n(d.students) + ' students, ' + n(d.payments) + ' payments, ' + n(d.enquiries) + ' enquiries and ' + n(d.staff) + ' staff. The backup’s PINs will apply, and you will need to log in again.', { ok: 'Replace & restore', title: 'Restore backup?' }).then(function (ok) {
        if (!ok) return;
        try { Store.importAll(obj); } catch (e) { toast(e.message, 'err'); return; }
        Store.rawDel('session');
        UI.drafts = {};
        toast('Backup restored. Please log in.');
        boot();
      });
    };
    reader.onerror = function () { toast('Could not read the file', 'err'); };
    reader.readAsText(file);
  }
  function doErase() {
    openModal({
      title: 'Erase all data?', body: '<form class="form" novalidate><p>This permanently deletes <b>everything</b> on this device, including PINs. It cannot be undone. Type <b>ERASE</b> to confirm.</p>' + field('Type ERASE', '<input name="word" autocomplete="off">') +
        '<div class="form-actions"><button type="button" class="btn ghost" data-act="modal-close">Cancel</button><button class="btn primary danger">Erase everything</button></div></form>',
      onSubmit: function (form, fd) {
        if (String(fd.get('word') || '').trim() !== 'ERASE') { fieldError(form, 'word', 'Type ERASE in capital letters'); return false; }
        Store.clearAll();
        UI.drafts = {};
        closeModal();
        location.hash = '';
        boot();
        return true;
      }
    });
  }

  /* =====================================================================
   * EVENTS
   * ===================================================================== */
  function attr(el, k) { return el.getAttribute('data-' + k); }
  var ACTIONS = {
    'logout': function () {
      var go = anyDirty() ? confirmBox('You have unsaved attendance. Lock anyway and lose it?', { ok: 'Lock', title: 'Unsaved attendance' }) : Promise.resolve(true);
      go.then(function (ok) { if (ok) { UI.drafts = {}; logout(); } });
    },
    'modal-close': closeModal,
    'modal-bg': function (el, e) { if (e.target === el) closeModal(); },
    'student-add': function (el) {
      var cid = attr(el, 'class') || (location.hash.indexOf('#/classes') === 0 ? UI.classTab : '');
      openStudentForm(null, cid ? { classId: cid } : null);
    },
    'student-edit': function (el) { var s = studentById(attr(el, 'id')); if (canSeeStudent(s)) openStudentForm(s); },
    'student-view': function (el) { viewStudent(attr(el, 'id')); },
    'student-del': function (el) {
      if (!isAdmin()) return;
      var s = studentById(attr(el, 'id'));
      if (!s) return;
      var np = S.payments.filter(function (p) { return p.studentId === s.id; }).length;
      confirmBox('Delete ' + s.name + ' (' + className(s.classId) + ')? Their attendance records will also be removed.' + (np ? ' Their ' + np + ' payment receipt(s) will be kept for your accounts.' : '') + ' Tip: set status to “Left” instead to keep history.', { ok: 'Delete student' }).then(function (ok) {
        if (!ok) return;
        S.students = S.students.filter(function (x) { return x.id !== s.id; });
        Object.keys(S.attendance).forEach(function (d) { if (S.attendance[d][s.id]) { delete S.attendance[d][s.id]; if (!Object.keys(S.attendance[d]).length) delete S.attendance[d]; } });
        S.enquiries.forEach(function (e) { if (e.studentId === s.id) e.studentId = ''; });
        persist('students', 'attendance', 'enquiries');
        UI.drafts = {};
        toast(s.name + ' deleted');
        render();
      });
    },
    'att-tab': function (el) { UI.attTab = attr(el, 'tab'); render(); },
    'att-set': function (el) {
      var dr = getDraft(UI.attClass, UI.attDate), sid = attr(el, 'sid'), v = attr(el, 'v');
      if (dr.data[sid] === v) delete dr.data[sid]; else dr.data[sid] = v;
      dr.dirty = true;
      refreshAttUI();
    },
    'att-all': function () {
      var dr = getDraft(UI.attClass, UI.attDate);
      activeStudents(UI.attClass).forEach(function (s) { dr.data[s.id] = 'P'; });
      dr.dirty = true;
      refreshAttUI();
      toast('Everyone marked present — tap Save');
    },
    'att-save': saveAttendance,
    'fee-tab': function (el) { UI.feeTab = attr(el, 'tab'); render(); },
    'pay-add': function (el) { if (isAdmin()) openPaymentForm(attr(el, 'student'), attr(el, 'month')); },
    'pay-del': function (el) {
      var p = findPayment(attr(el, 'id'));
      if (!p) return;
      confirmBox('Delete receipt ' + p.receiptNo + ' (' + p.studentName + ', ' + inr(p.amount) + ')? The receipt number will not be reused.', { ok: 'Delete payment' }).then(function (ok) {
        if (!ok) return;
        S.payments = S.payments.filter(function (x) { return x.id !== p.id; });
        persist('payments');
        toast('Payment deleted');
        render();
      });
    },
    'receipt-view': function (el) { if (isAdmin()) openReceipt(attr(el, 'id')); },
    'receipt-print': function (el) { printReceipt(attr(el, 'id')); },
    'enq-add': function () { openEnquiryForm(null); },
    'enq-edit': function (el) { var e = findEnq(attr(el, 'id')); if (e) openEnquiryForm(e); },
    'enq-del': function (el) {
      var e = findEnq(attr(el, 'id'));
      if (!e) return;
      confirmBox('Delete the enquiry for ' + e.childName + ' (' + e.parentName + ')?', { ok: 'Delete enquiry' }).then(function (ok) {
        if (!ok) return;
        S.enquiries = S.enquiries.filter(function (x) { return x.id !== e.id; });
        persist('enquiries'); toast('Enquiry deleted'); render();
      });
    },
    'enq-convert': function (el) { convertEnquiry(attr(el, 'id')); },
    'enq-filter': function (el) { UI.enqFilter = attr(el, 'f'); render(); },
    'staff-add': function () { openStaffForm(null); },
    'staff-edit': function (el) { var s = staffById(attr(el, 'id')); if (s) openStaffForm(s); },
    'staff-del': function (el) {
      var s = staffById(attr(el, 'id'));
      if (!s) return;
      confirmBox('Delete ' + s.name + ' from staff? Tip: set status to “Left” to keep the record.', { ok: 'Delete staff' }).then(function (ok) {
        if (!ok) return;
        S.staff = S.staff.filter(function (x) { return x.id !== s.id; });
        Object.keys(S.settings.classTeachers).forEach(function (c) { if (S.settings.classTeachers[c] === s.id) delete S.settings.classTeachers[c]; });
        persist('staff', 'settings'); toast(s.name + ' removed'); render();
      });
    },
    'user-del': function (el) {
      var u = S.users.filter(function (x) { return x.id === attr(el, 'id'); })[0];
      if (!u) return;
      confirmBox('Remove the login for ' + u.name + '? They will no longer be able to open the dashboard on this device.', { ok: 'Remove login' }).then(function (ok) {
        if (!ok) return;
        S.users = S.users.filter(function (x) { return x.id !== u.id; });
        persist('users'); toast('Login removed'); render();
      });
    },
    'user-reset': function (el) {
      var u = S.users.filter(function (x) { return x.id === attr(el, 'id'); })[0];
      if (!u) return;
      openModal({
        title: 'Reset PIN · ' + u.name, body: '<form class="form" novalidate>' + pinInput('pin', 'New PIN (4–6 digits)', 'new-password') + pinInput('pin2', 'Confirm PIN', 'new-password') + '<div class="form-actions"><button type="button" class="btn ghost" data-act="modal-close">Cancel</button><button class="btn primary">Set new PIN</button></div></form>',
        onSubmit: function (form, fd) {
          var pin = String(fd.get('pin') || ''), pin2 = String(fd.get('pin2') || '');
          if (!validPinFormat(pin)) { fieldError(form, 'pin', 'PIN must be 4 to 6 digits'); return false; }
          if (pin !== pin2) { fieldError(form, 'pin2', 'PINs do not match'); return false; }
          return makePinRecord(pin).then(function (rec) { Object.assign(u, rec); persist('users'); toast('PIN reset for ' + u.name); return true; });
        }
      });
    },
    'backup': doBackup,
    'csv': function (el) { exportCSV(attr(el, 't')); },
    'erase': doErase
  };
  var CHANGES = {
    'student-status': function (el) { UI.classStatus = el.value; var l = $('#student-list'); if (l) l.innerHTML = studentListHTML(UI.classTab); },
    'att-class': function (el) { UI.attClass = el.value; render(); },
    'att-class-any': function (el) { UI.absClass = el.value; render(); },
    'att-date': function (el) {
      var v = el.value;
      if (!isISODate(v)) return;
      if (v > todayISO()) { toast('Can’t pick a future date', 'err'); v = todayISO(); }
      UI.attDate = v; render();
    },
    'att-month': function (el) { if (isMonth(el.value)) { UI.attMonth = el.value; render(); } },
    'fee-month': function (el) { if (isMonth(el.value)) { UI.feeMonth = el.value; render(); } },
    'enq-status': function (el) {
      var e = findEnq(attr(el, 'id'));
      if (!e || ENQ_STATUS.indexOf(el.value) < 0) return;
      e.status = el.value; e.updatedAt = new Date().toISOString();
      persist('enquiries'); toast('Status: ' + e.status); render();
    },
    'restore': function (el) { doRestore(el); }
  };
  var INPUTS = {
    'student-search': function (el) { UI.search = el.value; var l = $('#student-list'); if (l) l.innerHTML = studentListHTML(UI.classTab); },
    'enq-search': function (el) { UI.enqSearch = el.value; var l = $('#enq-list'); if (l) l.innerHTML = enqListHTML(); },
    'staff-search': function (el) { UI.staffSearch = el.value; var l = $('#staff-list'); if (l) l.innerHTML = staffListHTML(); }
  };

  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el) return;
    var fn = ACTIONS[attr(el, 'act')];
    if (!fn) return;
    if (el.tagName === 'A' && !el.getAttribute('href')) e.preventDefault();
    try { fn(el, e); } catch (err) { console.error(err); toast('Something went wrong: ' + err.message, 'err'); }
  });
  document.addEventListener('change', function (e) {
    var el = e.target, k = el.getAttribute && el.getAttribute('data-change');
    if (k && CHANGES[k]) CHANGES[k](el, e);
  });
  document.addEventListener('input', function (e) {
    var el = e.target, k = el.getAttribute && el.getAttribute('data-input');
    if (k && INPUTS[k]) INPUTS[k](el, e);
  });
  document.addEventListener('submit', function (e) {
    var f = e.target, k = f.getAttribute('data-form');
    if (!k || !FORMS[k]) return;
    e.preventDefault();
    clearErrors(f);
    var btn = $('button.primary', f);
    if (btn) btn.disabled = true;
    Promise.resolve().then(function () { return FORMS[k](f, new FormData(f)); })
      .catch(function (err) { console.error(err); toast('Something went wrong: ' + err.message, 'err'); })
      .then(function () { if (btn && btn.isConnected) btn.disabled = false; });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if ($('#confirm-root').innerHTML) { var c = $('#confirm-root [data-c="0"]'); if (c) c.click(); }
      else if ($('#modal-root').innerHTML) closeModal();
    }
  });
  window.addEventListener('hashchange', function () { closeModal(); render(); });
  window.addEventListener('beforeunload', function (e) { if (anyDirty()) { e.preventDefault(); e.returnValue = ''; } });
  window.addEventListener('afterprint', function () { $('#print-root').innerHTML = ''; });
  window.addEventListener('storage', function (e) {
    // Another tab changed data: reload state so tabs don't overwrite each other.
    if (e.key && e.key.indexOf('lw_') === 0 && e.key !== 'lw_lock' && e.key !== 'lw_lastUser') { loadAll(); if (ME) { ME = getSession(); if (!ME) boot(); else render(); } }
  });
  // Re-check the session periodically (auto-lock after it expires)
  setInterval(function () { if (ME && !getSession()) { toast('Session expired — please unlock again'); ME = null; boot(); } }, 60000);

  boot();
})();
