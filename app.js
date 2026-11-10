/*!
 * The Little Wings Play School — Admin & Classes Dashboard
 * Plain static app: no build step. Data is stored in the school's private
 * Supabase database (Auth + Postgres with Row Level Security) and an offline
 * copy is kept in this browser's localStorage. See README.md.
 */
(function () {
  'use strict';

  var APP_VERSION = '2.3.0';
  var PARENT_DOMAIN = 'parents.littlewings.app';
  var PARENTS_APP_URL = 'https://thelittlewingsplayschool.github.io/Dashboard/parents/';
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
   * Data lives in the school's private Supabase database. This module keeps
   * an offline copy per signed-in user in localStorage ("lwc_<userId>"),
   * writes changes through to Supabase (queued while offline, last write
   * wins), and pulls remote changes (Realtime + polling + on tab focus).
   * The UI keeps calling Store.load(name) / Store.save(name, value) exactly
   * like v1; Store diffs each collection into per-record rows.
   * ===================================================================== */
  var CFG = window.LW_CONFIG || {};
  var RECOVERY = /(^|[#&])type=recovery(&|$)/.test(location.hash || '');
  var SB = (window.supabase && CFG.supabaseUrl && CFG.supabaseKey) ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'lw-auth' }
  }) : null;

  var Store = (function () {
    var LEGACY = 'lw_', CACHE = 'lwc_';
    var TABLES = ['settings', 'users', 'students', 'attendance', 'payments', 'enquiries', 'staff'];
    var DB = ['settings', 'students', 'student_fees', 'attendance', 'payments', 'enquiries', 'staff'];
    var ADMIN_ONLY = { student_fees: 1, payments: 1, enquiries: 1, staff: 1 };
    var ADMIN_WRITE = { settings: 1, student_fees: 1, payments: 1, enquiries: 1, staff: 1 };
    var PK = { settings: 'id', students: 'id', student_fees: 'student_id', attendance: 'day,class_id', payments: 'id', enquiries: 'id', staff: 'id' };
    var COLS = {
      settings: 'id,data,deleted,updated_at', students: 'id,class_id,data,deleted,updated_at',
      student_fees: 'student_id,monthly_fee,deleted,updated_at', attendance: 'day,class_id,data,deleted,updated_at',
      payments: 'id,data,deleted,updated_at', enquiries: 'id,data,deleted,updated_at', staff: 'id,data,deleted,updated_at'
    };
    var listeners = [], statusListeners = [];
    var U = null;            // { id, role }
    var st = emptyState();
    var status = { state: 'idle', pending: 0, message: '', lastSync: null, realtime: '' };
    var chain = Promise.resolve();
    var flushTimer = null, pullTimer = null, retryTimer = null, pollTimer = null, channel = null, rt = '', lastPull = 0, cacheWarned = false;
    var onNoAccess = null;

    function emptyState() { var r = {}; DB.forEach(function (t) { r[t] = {}; }); return { rows: r, profiles: [], profile: null, queue: {}, since: {}, lastSync: null, firstSyncDone: false }; }
    function clone(v) { return v === undefined ? v : JSON.parse(JSON.stringify(v)); }
    function stable(v) {
      if (v === null || v === undefined || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
      if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
      return '{' + Object.keys(v).filter(function (k) { return v[k] !== undefined; }).sort().map(function (k) { return JSON.stringify(k) + ':' + stable(v[k]); }).join(',') + '}';
    }
    function keyOf(t, r) { return t === 'attendance' ? r.day + '|' + r.class_id : t === 'student_fees' ? String(r.student_id) : String(r.id); }
    function canon(t, r) {
      var d = !!r.deleted;
      if (t === 'student_fees') return { student_id: String(r.student_id), monthly_fee: Number(r.monthly_fee) || 0, deleted: d };
      if (t === 'attendance') return { day: String(r.day).slice(0, 10), class_id: r.class_id, data: asObject(r.data), deleted: d };
      if (t === 'students') return { id: String(r.id), class_id: r.class_id, data: asObject(r.data), deleted: d };
      if (t === 'settings') return { id: 1, data: asObject(r.data), deleted: d };
      return { id: String(r.id), data: asObject(r.data), deleted: d };
    }
    function isAdminRole() { return !!(U && U.role === 'admin'); }
    function readable(t) { return isAdminRole() || !ADMIN_ONLY[t]; }
    function writable(t) { return isAdminRole() || !ADMIN_WRITE[t]; }
    function live(t) { var o = st.rows[t], out = []; Object.keys(o).forEach(function (k) { if (!o[k].deleted) out.push(o[k]); }); return out; }
    function strip(rec, keys) { var o = {}; Object.keys(rec || {}).forEach(function (k) { if (keys.indexOf(k) < 0 && rec[k] !== undefined) o[k] = rec[k]; }); return clone(o); }
    function notify(kind, name) { listeners.forEach(function (fn) { try { fn(name || '*', kind); } catch (e) { console.warn(e); } }); }
    function pendingCount() { return Object.keys(st.queue).length; }
    function setStatus(state, msg) {
      if (state) status.state = state;
      if (msg !== undefined) status.message = msg;
      status.pending = pendingCount(); status.lastSync = st.lastSync; status.realtime = rt;
      statusListeners.forEach(function (fn) { try { fn(status); } catch (e) { console.warn(e); } });
    }

    /* ---------- collections <-> rows ---------- */
    function collection(name) {
      if (name === 'settings') { var s = st.rows.settings['1']; return s && !s.deleted ? clone(s.data) : {}; }
      if (name === 'students') {
        var fees = st.rows.student_fees;
        return live('students').map(function (r) {
          var o = clone(r.data); o.id = r.id; o.classId = r.class_id;
          if (isAdminRole()) { var f = fees[r.id]; o.monthlyFee = f && !f.deleted ? f.monthly_fee : 0; }
          return o;
        });
      }
      if (name === 'attendance') { var a = {}; live('attendance').forEach(function (r) { a[r.day] = Object.assign(a[r.day] || {}, clone(r.data)); }); return a; }
      if (name === 'users') return st.profiles.filter(function (p) { return p.role === 'teacher'; }).map(function (p) { return { id: p.id, name: p.name || p.email || 'Teacher', classId: p.class_id || '', email: p.email || '' }; });
      if (name === 'parents') return st.profiles.filter(function (p) { return p.role === 'parent'; }).map(function (p) { var e = p.email || ''; return { id: p.id, name: p.name || 'Parent', phone: e.split('@')[1] === PARENT_DOMAIN ? e.split('@')[0] : '', email: e }; });
      if (name === 'payments' || name === 'enquiries' || name === 'staff') return live(name).map(function (r) { var o = clone(r.data); o.id = r.id; return o; });
      return undefined;
    }
    function load(name, fallback) { if (!U) return clone(fallback); var v = collection(name); return v === undefined ? clone(fallback) : v; }
    function toRows(name, value) {
      var out = {};
      if (name === 'settings') out.settings = { '1': { id: 1, data: strip(asObject(value), []), deleted: false } };
      else if (name === 'students') {
        out.students = {}; if (isAdminRole()) out.student_fees = {};
        asArray(value).forEach(function (s) {
          if (!s || !s.id || !CLASS_BY_ID[s.classId]) return;
          var id = String(s.id);
          out.students[id] = { id: id, class_id: s.classId, data: strip(s, ['id', 'classId', 'monthlyFee']), deleted: false };
          if (out.student_fees) out.student_fees[id] = { student_id: id, monthly_fee: num(s.monthlyFee), deleted: false };
        });
      } else if (name === 'attendance') {
        out.attendance = {};
        var cls = {}; live('students').forEach(function (r) { cls[r.id] = r.class_id; });
        var val = asObject(value);
        Object.keys(val).forEach(function (day) {
          if (!isISODate(day)) return;
          var rec = asObject(val[day]);
          Object.keys(rec).forEach(function (sid) {
            var c = cls[sid]; if (!c || !ATT[rec[sid]]) return;
            var k = day + '|' + c;
            (out.attendance[k] = out.attendance[k] || { day: day, class_id: c, data: {}, deleted: false }).data[sid] = rec[sid];
          });
        });
      } else if (name === 'payments' || name === 'enquiries' || name === 'staff') {
        out[name] = {};
        asArray(value).forEach(function (r) { if (r && r.id) out[name][String(r.id)] = { id: String(r.id), data: strip(r, ['id']), deleted: false }; });
      }
      return out;
    }
    function enqueue(t, k) { var q = t + '|' + k, old = st.queue[q]; st.queue[q] = { t: t, k: k, v: (old ? old.v : 0) + 1 }; }
    function diff(t, map) {
      var cur = st.rows[t], n = 0;
      Object.keys(map).forEach(function (k) { if (!cur[k] || stable(cur[k]) !== stable(map[k])) { cur[k] = map[k]; enqueue(t, k); n++; } });
      Object.keys(cur).forEach(function (k) {
        if (!map[k] && !cur[k].deleted) {
          var tomb = clone(cur[k]); tomb.deleted = true;
          if ('data' in tomb) tomb.data = {};
          if (t === 'student_fees') tomb.monthly_fee = 0;
          cur[k] = tomb; enqueue(t, k); n++;
        }
      });
      return n;
    }
    function save(name, value) {
      if (!U) return false;
      var maps = toRows(name, value), n = 0;
      Object.keys(maps).forEach(function (t) { if (writable(t)) n += diff(t, maps[t]); });
      if (n) { saveCache(); setStatus(); scheduleFlush(250); }
      notify('local', name);
      return true;
    }

    /* ---------- offline copy ---------- */
    function cacheKey(id) { return CACHE + (id || (U && U.id)); }
    function saveCache() {
      if (!U) return;
      try { localStorage.setItem(cacheKey(), JSON.stringify({ v: 2, rows: st.rows, profiles: st.profiles, profile: st.profile, queue: st.queue, since: st.since, lastSync: st.lastSync, firstSyncDone: st.firstSyncDone })); }
      catch (e) { if (!cacheWarned) { cacheWarned = true; toast('This device’s offline copy is full. Online saving still works.', 'err'); } }
    }
    function init(userId) {
      stop();
      U = { id: userId, role: null };
      st = emptyState();
      try {
        var c = JSON.parse(localStorage.getItem(cacheKey()) || 'null');
        if (c && c.v === 2) {
          DB.forEach(function (t) { st.rows[t] = asObject(c.rows && c.rows[t]); });
          st.profiles = asArray(c.profiles); st.profile = c.profile || null; st.queue = asObject(c.queue);
          st.since = asObject(c.since); st.lastSync = c.lastSync || null; st.firstSyncDone = !!c.firstSyncDone;
        }
      } catch (e) { console.warn('Offline copy unreadable, starting fresh', e); }
      if (st.profile) U.role = st.profile.role;
      setStatus(navigator.onLine === false ? 'offline' : 'idle', '');
    }
    function setProfile(p) { st.profile = p; if (U) U.role = p ? p.role : null; saveCache(); }
    function reset() { stop(); U = null; st = emptyState(); }
    function clearCache(id) { try { localStorage.removeItem(cacheKey(id)); } catch (e) { /* ignore */ } }

    /* ---------- network ---------- */
    function isNetwork(res) { return !res.status || /Failed to fetch|NetworkError|Load failed|network/i.test((res.error && res.error.message) || ''); }
    function netErr() { var e = new Error('offline'); e.network = true; return e; }
    function friendly(err) {
      var m = (err && err.message) || 'unknown error';
      if (/row-level security|permission denied/i.test(m)) return 'not allowed for your account';
      return m;
    }
    function run(task) { var p = chain.then(task, task); chain = p.catch(function () {}); return p; }
    async function flushNow() {
      var byT = {}, repull = false;
      Object.keys(st.queue).forEach(function (q) { var it = st.queue[q]; (byT[it.t] = byT[it.t] || []).push(it); });
      for (var i = 0; i < DB.length; i++) {
        var t = DB[i], list = byT[t];
        if (!list) continue;
        if (!writable(t)) { list.forEach(function (it) { delete st.queue[it.t + '|' + it.k]; }); continue; }
        for (var j = 0; j < list.length; j += 200) {
          var chunk = list.slice(j, j + 200);
          var payload = chunk.map(function (it) { return st.rows[t][it.k]; }).filter(Boolean);
          var res = await SB.from(t).upsert(payload, { onConflict: PK[t] });
          if (res.error) {
            if (isNetwork(res)) throw netErr();
            if (res.status === 401) { try { await SB.auth.refreshSession(); } catch (e) { /* ignore */ } throw netErr(); }
            console.warn('Rejected by server', t, res.error);
            chunk.forEach(function (it) { delete st.queue[it.t + '|' + it.k]; });
            st.since[t] = null; repull = true;
            toast('Some changes were not saved (' + friendly(res.error) + ').', 'err');
            continue;
          }
          chunk.forEach(function (it) { var q = st.queue[it.t + '|' + it.k]; if (q && q.v === it.v) delete st.queue[it.t + '|' + it.k]; });
          saveCache(); setStatus();
        }
      }
      return repull;
    }
    async function fetchAll(t, since) {
      var out = [], from = 0, page = 1000;
      for (;;) {
        var q = SB.from(t).select(COLS[t]);
        if (since) q = q.gt('updated_at', new Date(Date.parse(since) - 5000).toISOString());
        q = q.order('updated_at', { ascending: true });
        PK[t].split(',').forEach(function (c) { q = q.order(c, { ascending: true }); });
        var res = await q.range(from, from + page - 1);
        if (res.error) { if (isNetwork(res)) throw netErr(); throw new Error(res.error.message); }
        out = out.concat(res.data || []);
        if (!res.data || res.data.length < page) break;
        from += page;
      }
      return out;
    }
    async function pullNow(full) {
      var changed = false;
      var pr = await SB.from('profiles').select('id,role,name,email,class_id').order('id');
      if (pr.error) { if (isNetwork(pr)) throw netErr(); throw new Error(pr.error.message); }
      var profs = (pr.data || []).map(function (p) { return { id: p.id, role: p.role, name: p.name, email: p.email, class_id: p.class_id }; });
      if (stable(profs) !== stable(st.profiles)) { st.profiles = profs; changed = true; }
      var own = profs.filter(function (p) { return p.id === U.id; })[0];
      if (!own) { var e = new Error('no-access'); e.noAccess = true; throw e; }
      if (stable(own) !== stable(st.profile)) { st.profile = own; U.role = own.role; changed = true; full = true; }
      for (var i = 0; i < DB.length; i++) {
        var t = DB[i];
        if (!readable(t)) { if (Object.keys(st.rows[t]).length) { st.rows[t] = {}; changed = true; } continue; }
        var isFull = full || !st.since[t];
        var rows = await fetchAll(t, isFull ? null : st.since[t]);
        var seen = {}, maxU = isFull ? null : st.since[t];
        rows.forEach(function (r) {
          var c = canon(t, r), k = keyOf(t, c);
          seen[k] = 1;
          if (!maxU || r.updated_at > maxU) maxU = r.updated_at;
          if (st.queue[t + '|' + k]) return;
          if (!st.rows[t][k] || stable(st.rows[t][k]) !== stable(c)) { st.rows[t][k] = c; changed = true; }
        });
        if (isFull) Object.keys(st.rows[t]).forEach(function (k) { if (!seen[k] && !st.queue[t + '|' + k]) { delete st.rows[t][k]; changed = true; } });
        st.since[t] = maxU || st.since[t] || null;
      }
      return changed;
    }
    function handleErr(e) {
      if (e && e.noAccess) { setStatus('error', 'Your account has no access.'); if (onNoAccess) onNoAccess(); return; }
      if (e && e.network) setStatus('offline', '');
      else { console.warn(e); setStatus('error', (e && e.message) || 'Sync problem'); }
      clearTimeout(retryTimer);
      retryTimer = setTimeout(function () { sync(false); }, 20000);
    }
    function sync(full) {
      if (!U || !SB) return Promise.resolve(false);
      return run(async function () {
        if (!U) return false;
        if (navigator.onLine === false) { setStatus('offline'); return false; }
        setStatus('syncing');
        try {
          var repull = await flushNow();
          var changed = await pullNow(full || repull || !st.lastSync);
          if (pendingCount()) await flushNow();
          var firstTime = !st.firstSyncDone;
          st.firstSyncDone = true; st.lastSync = new Date().toISOString(); lastPull = Date.now();
          saveCache();
          setStatus('online', '');
          if (changed || firstTime) notify('remote');
          return changed;
        } catch (e) { handleErr(e); return false; }
      });
    }
    function flush() {
      if (!U || !SB) return Promise.resolve();
      return run(async function () {
        if (!U || !pendingCount()) { setStatus(); return; }
        if (navigator.onLine === false) { setStatus('offline'); return; }
        setStatus('syncing');
        try { var repull = await flushNow(); setStatus('online', ''); if (repull) schedulePull(0); }
        catch (e) { handleErr(e); }
      });
    }
    function scheduleFlush(ms) { clearTimeout(flushTimer); flushTimer = setTimeout(flush, ms || 0); }
    function schedulePull(ms) { clearTimeout(pullTimer); pullTimer = setTimeout(function () { sync(false); }, ms || 0); }
    function start() {
      stop();
      if (!U || !SB) return;
      try {
        channel = SB.channel('lw-sync-' + U.id)
          .on('postgres_changes', { event: '*', schema: 'public' }, function () { schedulePull(700); })
          .subscribe(function (s) { rt = s; setStatus(); });
      } catch (e) { console.warn('Realtime unavailable, polling instead', e); }
      pollTimer = setInterval(function () {
        if (!U || document.visibilityState === 'hidden') return;
        if (rt !== 'SUBSCRIBED' || Date.now() - lastPull > 5 * 60000 || pendingCount()) sync(false);
      }, 30000);
      sync(true);
    }
    function stop() {
      clearTimeout(flushTimer); clearTimeout(pullTimer); clearTimeout(retryTimer); clearInterval(pollTimer);
      if (channel && SB) { try { SB.removeChannel(channel); } catch (e) { /* ignore */ } }
      channel = null; rt = '';
    }

    /* ---------- backup / legacy (v1) data ---------- */
    function exportAll() {
      var data = {};
      ['settings', 'students', 'attendance', 'payments', 'enquiries', 'staff'].forEach(function (t) { data[t] = collection(t); });
      return { app: 'littlewings-dashboard', version: 2, appVersion: APP_VERSION, exportedAt: new Date().toISOString(), data: data };
    }
    function validateBackup(obj) {
      if (!obj || typeof obj !== 'object' || obj.app !== 'littlewings-dashboard' || !obj.data || typeof obj.data !== 'object') {
        throw new Error('This file is not a Little Wings dashboard backup.');
      }
      var d = obj.data;
      ['students', 'payments', 'enquiries', 'staff'].forEach(function (t) {
        if (d[t] != null && !Array.isArray(d[t])) throw new Error('Backup is damaged (' + t + ').');
      });
      if (d.attendance != null && (typeof d.attendance !== 'object' || Array.isArray(d.attendance))) throw new Error('Backup is damaged (attendance).');
      return true;
    }
    function legacyData() {
      var d = {}, any = false;
      ['settings', 'students', 'attendance', 'payments', 'enquiries', 'staff'].forEach(function (t) {
        var raw = null;
        try { raw = localStorage.getItem(LEGACY + t); } catch (e) { /* ignore */ }
        if (raw != null) { try { d[t] = JSON.parse(raw); any = true; } catch (e) { /* skip corrupt */ } }
      });
      return any ? { app: 'littlewings-dashboard', version: 1, exportedAt: new Date().toISOString(), data: d } : null;
    }
    function hasLegacy() {
      var o = legacyData(); if (!o) return false;
      var d = o.data;
      return !!(asArray(d.students).length || asArray(d.payments).length || asArray(d.enquiries).length || asArray(d.staff).length || Object.keys(asObject(d.attendance)).length);
    }
    function usageBytes() { try { return ((localStorage.getItem(cacheKey()) || '').length) * 2; } catch (e) { return 0; } }
    function rawGet(key) { try { return localStorage.getItem(LEGACY + key); } catch (e) { return null; } }
    function rawSet(key, v) { try { localStorage.setItem(LEGACY + key, v); } catch (e) { /* ignore */ } }
    function rawDel(key) { try { localStorage.removeItem(LEGACY + key); } catch (e) { /* ignore */ } }
    function subscribe(fn) { listeners.push(fn); }
    function onStatus(fn) { statusListeners.push(fn); }
    function hasSettingsRow() { return !!st.rows.settings['1']; }
    return {
      load: load, save: save, exportAll: exportAll, validateBackup: validateBackup, legacyData: legacyData, hasLegacy: hasLegacy,
      usageBytes: usageBytes, rawGet: rawGet, rawSet: rawSet, rawDel: rawDel, subscribe: subscribe, onStatus: onStatus,
      init: init, setProfile: setProfile, profile: function () { return st.profile; }, reset: reset, clearCache: clearCache,
      start: start, stop: stop, sync: sync, flush: flush, pendingCount: pendingCount, status: function () { return status; },
      firstSyncDone: function () { return st.firstSyncDone; }, hasSettingsRow: hasSettingsRow,
      setNoAccessHandler: function (fn) { onNoAccess = fn; }, TABLES: TABLES
    };
  })();

  // In-memory state (mirrors the Store)
  var S = {};
  function asArray(v) { return Array.isArray(v) ? v : []; }
  function asObject(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
  function loadAll() {
    S.settings = Object.assign({}, DEFAULT_SETTINGS, asObject(Store.load('settings', {})));
    S.settings.classTeachers = asObject(S.settings.classTeachers);
    S.users = asArray(Store.load('users', []));
    S.parents = asArray(Store.load('parents', []));
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
    if (window.LWReceipt) return window.LWReceipt.inWords(amount);
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
  // v2.3: a payment can cover several months. p.months lists them and p.alloc
  // says how much of the amount went to each month; old payments have only p.month.
  function payMonths(p) { var l = asArray(p.months).filter(isMonth); return l.length ? l : (isMonth(p.month) ? [p.month] : []); }
  function payAlloc(p) {
    var a = asObject(p.alloc), keys = Object.keys(a).filter(isMonth);
    if (keys.length) { var o = {}; keys.forEach(function (k) { o[k] = num(a[k]); }); return o; }
    var r = {}; if (isMonth(p.month)) r[p.month] = num(p.amount); return r;
  }
  function payTowards(p, ym) { return payAlloc(p)[ym] || 0; }
  function coversMonth(p, ym) { return payMonths(p).indexOf(ym) >= 0 || payAlloc(p)[ym] != null; }
  function periodText(p) { return window.LWReceipt ? window.LWReceipt.period(payMonths(p)) : fmtMonth(p.month); }
  function paidFor(studentId, ym) {
    return S.payments.reduce(function (a, p) { return a + (p.studentId === studentId ? payTowards(p, ym) : 0); }, 0);
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

  // expose for tests
  window.__lw = { inWords: inWords, outstanding: function (id) { var s = studentById(id); return s ? outstanding(s) : null; }, paidFor: paidFor, ageParts: ageParts, suggestClass: suggestClass, normPhone: normPhone, validPhone: validPhone, fmtDate: fmtDate, addMonths: addMonths, Store: Store, version: APP_VERSION };

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
   * SESSION & AUTH SCREENS (Supabase Auth: email + password)
   * ===================================================================== */
  var ME = null;
  var FORMS_EXTRA = {};
  function isAdmin() { return ME && ME.role === 'admin'; }
  function fnCall(action, payload) {
    // Calls the lw-admin Edge Function (service key stays on the server).
    var body = Object.assign({ action: action }, payload || {});
    var tokenP = SB ? SB.auth.getSession().then(function (r) { return r.data.session ? r.data.session.access_token : null; }) : Promise.resolve(null);
    return tokenP.then(function (token) {
      return fetch(CFG.supabaseUrl + '/functions/v1/lw-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: CFG.supabaseKey, Authorization: 'Bearer ' + (token || CFG.supabaseKey) },
        body: JSON.stringify(body)
      });
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (j) {
        if (!res.ok) throw new Error(j.error || ('Server error ' + res.status));
        return j;
      });
    }, function (err) {
      if (err && /fetch|network|load failed/i.test(err.message || '')) throw new Error('No internet connection. Please try again when online.');
      throw err;
    });
  }
  function authErrorText(err) {
    var m = (err && err.message) || String(err || '');
    if (/invalid login credentials/i.test(m)) return 'Wrong email or password.';
    if (/email not confirmed/i.test(m)) return 'This email is not confirmed yet. Ask the admin to check the login.';
    if (/fetch|network|load failed/i.test(m)) return 'No internet connection. Please try again when online.';
    if (/rate limit|too many/i.test(m)) return 'Too many attempts. Please wait a few minutes and try again.';
    if (/should be different/i.test(m)) return 'The new password must be different from the old one.';
    if (/password/i.test(m) && /least|weak|short/i.test(m)) return 'Password is too weak. Use at least 8 characters.';
    return m;
  }

  function authCard(inner) {
    return '<div class="auth-wrap"><div class="auth-card">' +
      '<img class="auth-logo" src="assets/logo.jpeg" alt="The Little Wings Play School logo" width="96" height="96">' +
      '<h1>' + esc(S.settings.schoolName || DEFAULT_SETTINGS.schoolName) + '</h1>' + inner + '</div>' +
      '<p class="auth-foot">🔐 Secure sign-in · data saved in the school’s private online database · v' + APP_VERSION + '</p></div>';
  }
  function pwInput(name, label, auto, extra) {
    return field(label, '<span class="pw-wrap"><input name="' + name + '" type="password" autocomplete="' + (auto || 'current-password') + '" maxlength="72" required>' +
      '<button type="button" class="pw-toggle" data-act="pw-toggle" aria-label="Show password" title="Show / hide password">👁️</button></span>', extra);
  }
  function emailInput(name, label, value) {
    return field(label, '<input name="' + name + '" type="email" inputmode="email" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="120" value="' + esc(value || '') + '" required>');
  }
  function validEmail(e) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e || ''); }
  function showAuth(html) {
    $('#shell').hidden = true;
    var a = $('#auth-screen');
    a.hidden = false;
    a.innerHTML = html;
    var f = $('input:not([type=hidden]):not([value])', a) || $('input:not([type=hidden])', a);
    if (f && window.matchMedia('(min-width: 700px)').matches) f.focus();
  }
  function showLoading(msg) { showAuth(authCard('<p class="sub">' + esc(msg || 'Loading…') + '</p><div class="spinner" aria-hidden="true"></div>')); }
  function showConfigError() {
    showAuth(authCard('<p class="sub">The dashboard could not start.</p><p class="note warn">The online database settings (config.js) or the Supabase library did not load. Check your internet connection and reload the page.</p><button class="btn primary block" onclick="location.reload()">Reload</button>'));
  }

  function showSetup() {
    showAuth(authCard('<p class="sub">Welcome! Create the <b>admin account</b> for your school. 🎉</p>' +
      '<form id="setup-form" class="form" novalidate>' +
      field('Your name', '<input name="owner" maxlength="60" autocomplete="name" value="' + esc(DEFAULT_SETTINGS.owner) + '" required>') +
      emailInput('email', 'Email (you will sign in with this)') +
      pwInput('password', 'Create a password (at least 8 characters)', 'new-password') +
      pwInput('password2', 'Confirm password', 'new-password') +
      '<p class="note">This first account becomes the admin. After that, sign-ups are closed: teachers get their logins from you in <b>Settings → Teacher logins</b>.</p>' +
      '<button class="btn primary big block">Create admin account</button>' +
      '<p class="center small"><button type="button" class="link" data-act="auth-login">I already have an account</button></p></form>'));
    $('#setup-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target, fd = new FormData(f);
      clearErrors(f);
      var owner = String(fd.get('owner') || '').trim(), email = String(fd.get('email') || '').trim().toLowerCase();
      var pw = String(fd.get('password') || ''), pw2 = String(fd.get('password2') || '');
      if (owner.length < 2) return fieldError(f, 'owner', 'Please enter your name');
      if (!validEmail(email)) return fieldError(f, 'email', 'Please enter a valid email');
      if (pw.length < 8) return fieldError(f, 'password', 'Use at least 8 characters');
      if (pw !== pw2) return fieldError(f, 'password2', 'Passwords do not match');
      var btn = $('button.primary', f); btn.disabled = true; btn.textContent = 'Creating…';
      fnCall('bootstrap', { name: owner, email: email, password: pw }).then(function () {
        return SB.auth.signInWithPassword({ email: email, password: pw });
      }).then(function (r) {
        if (r.error) throw r.error;
        Store.rawSet('lastEmail', email);
        toast('Admin account created. Welcome, ' + owner + '!');
        if (history.replaceState) history.replaceState(null, '', '#/dashboard');
        boot();
      }).catch(function (err) {
        btn.disabled = false; btn.textContent = 'Create admin account';
        if (/already exists/i.test(err.message) && /admin/i.test(err.message)) { toast('An admin account already exists. Please sign in.', 'err'); showLogin(); return; }
        fieldError(f, 'email', authErrorText(err));
      });
    });
  }

  function showLogin(opts) {
    opts = opts || {};
    showAuth(authCard('<p class="sub">Sign in to open the dashboard</p>' +
      '<form id="login-form" class="form" novalidate>' +
      emailInput('email', 'Email', Store.rawGet('lastEmail') || '') +
      pwInput('password', 'Password', 'current-password') +
      (opts.message ? '<p class="note">' + esc(opts.message) + '</p>' : '') +
      '<button class="btn primary big block">Sign in 🔓</button>' +
      '<p class="center small"><button type="button" class="link" data-act="auth-forgot">Forgot password?</button></p>' +
      '<p class="center small muted">Parent? Open the <a href="parents/">Little Wings Parents app</a>.</p>' +
      '<p id="setup-hint" class="note center" hidden>No admin account exists yet. <button type="button" class="link strong" data-act="auth-setup">Create the admin account</button></p>' +
      '</form>' + installHintHTML(true)));
    var f = $('#login-form');
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      clearErrors(f);
      var fd = new FormData(f), email = String(fd.get('email') || '').trim().toLowerCase(), pw = String(fd.get('password') || '');
      if (!validEmail(email)) return fieldError(f, 'email', 'Please enter your email');
      if (!pw) return fieldError(f, 'password', 'Please enter your password');
      var btn = $('button.primary', f); btn.disabled = true; btn.textContent = 'Signing in…';
      SB.auth.signInWithPassword({ email: email, password: pw }).then(function (r) {
        btn.disabled = false; btn.textContent = 'Sign in 🔓';
        if (r.error) { $('[name=password]', f).value = ''; return fieldError(f, 'password', authErrorText(r.error)); }
        Store.rawSet('lastEmail', email);
        if (history.replaceState) history.replaceState(null, '', '#/dashboard');
        boot();
      }).catch(function (err) { btn.disabled = false; btn.textContent = 'Sign in 🔓'; fieldError(f, 'password', authErrorText(err)); });
    });
    if (!opts.skipStatus) {
      fnCall('status').then(function (r) {
        if (r && r.adminExists === false && $('#login-form')) { showSetup(); }
      }).catch(function () { /* offline: keep the login form */ });
    }
  }
  function showForgot() {
    showAuth(authCard('<p class="sub">Reset your password</p><form id="forgot-form" class="form" novalidate>' +
      emailInput('email', 'Your email', Store.rawGet('lastEmail') || '') +
      '<p class="note">We will email you a link to set a new password. Teachers can also ask the admin to set a new password from Settings.</p>' +
      '<button class="btn primary big block">Send reset link</button>' +
      '<p class="center small"><button type="button" class="link" data-act="auth-login">Back to sign in</button></p></form>'));
    var f = $('#forgot-form');
    f.addEventListener('submit', function (e) {
      e.preventDefault(); clearErrors(f);
      var email = String(new FormData(f).get('email') || '').trim().toLowerCase();
      if (!validEmail(email)) return fieldError(f, 'email', 'Please enter a valid email');
      var btn = $('button.primary', f); btn.disabled = true;
      SB.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }).then(function (r) {
        btn.disabled = false;
        if (r.error) return fieldError(f, 'email', authErrorText(r.error));
        showLogin({ skipStatus: true, message: 'If this email has an account, a reset link is on its way. Check your inbox and spam folder, then open the link on this device.' });
      }).catch(function (err) { btn.disabled = false; fieldError(f, 'email', authErrorText(err)); });
    });
  }
  function showSetNewPassword() {
    showAuth(authCard('<p class="sub">Set a new password</p><form id="newpw-form" class="form" novalidate>' +
      pwInput('password', 'New password (at least 8 characters)', 'new-password') + pwInput('password2', 'Confirm new password', 'new-password') +
      '<button class="btn primary big block">Save new password</button></form>'));
    var f = $('#newpw-form');
    f.addEventListener('submit', function (e) {
      e.preventDefault(); clearErrors(f);
      var fd = new FormData(f), pw = String(fd.get('password') || ''), pw2 = String(fd.get('password2') || '');
      if (pw.length < 8) return fieldError(f, 'password', 'Use at least 8 characters');
      if (pw !== pw2) return fieldError(f, 'password2', 'Passwords do not match');
      var btn = $('button.primary', f); btn.disabled = true;
      SB.auth.updateUser({ password: pw }).then(function (r) {
        btn.disabled = false;
        if (r.error) return fieldError(f, 'password', authErrorText(r.error));
        RECOVERY = false;
        toast('Password updated 🔐');
        if (history.replaceState) history.replaceState(null, '', '#/dashboard');
        boot();
      });
    });
  }
  function noAccess() {
    var p = SB ? SB.auth.signOut({ scope: 'local' }) : Promise.resolve();
    Store.reset(); ME = null;
    p.catch(function () {}).then(function () { showLogin({ skipStatus: true, message: 'This login has no access to the dashboard (it may have been removed). Please contact the admin.' }); });
  }
  function logout() {
    var uid = ME && ME.userId;
    ME = null;
    closeModal();
    Store.stop();
    if (uid) Store.clearCache(uid); // don't leave school data on a shared phone
    Store.reset();
    UI.drafts = {};
    PX.reset();
    location.hash = '';
    var p = SB ? SB.auth.signOut({ scope: 'local' }) : Promise.resolve();
    p.catch(function () {}).then(function () { boot(); });
  }
  function applyProfile(p) {
    loadAll();
    if (!p) { ME = null; return; }
    ME = p.role === 'admin'
      ? { role: 'admin', userId: p.id, name: S.settings.owner || p.name || 'Admin', email: p.email }
      : { role: 'teacher', userId: p.id, name: p.name || p.email || 'Teacher', classId: p.class_id || '', email: p.email };
  }
  function parentInDashboard() {
    var uid = Store.profile() && Store.profile().id;
    Store.stop(); if (uid) Store.clearCache(uid); Store.reset(); ME = null;
    var p = SB ? SB.auth.signOut({ scope: 'local' }) : Promise.resolve();
    p.catch(function () {}).then(function () { showLogin({ skipStatus: true, message: 'This is a parent login. Parents use the Little Wings Parents app: ' + PARENTS_APP_URL }); });
  }
  function startSession(user) {
    Store.init(user.id);
    var cached = Store.profile();
    if (cached && cached.role === 'parent') { cached = null; }
    if (cached) { applyProfile(cached); showShell(); }
    else showLoading('Loading your dashboard…');
    SB.from('profiles').select('id,role,name,email,class_id').eq('id', user.id).maybeSingle().then(function (res) {
      if (res.error) {
        if (!cached) showAuth(authCard('<p class="sub">Could not reach the online database.</p><p class="note warn">' + esc(authErrorText(res.error)) + '</p><button class="btn primary block" data-act="auth-retry">Try again</button><p class="center small"><button type="button" class="link" data-act="logout">Sign out</button></p>'));
        else Store.start();
        return;
      }
      if (!res.data) return noAccess();
      if (res.data.role === 'parent') return parentInDashboard();
      var wasShown = !!ME;
      Store.setProfile(res.data);
      applyProfile(res.data);
      if (!wasShown) showShell(); else { showShell(); }
      Store.start();
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
    notices: { title: 'Notices', icon: '📢', roles: ['admin', 'teacher'], render: viewNotices },
    fees: { title: 'Fees', icon: '💰', roles: ['admin'], render: viewFees },
    enquiries: { title: 'Enquiries', icon: '📝', roles: ['admin'], render: viewEnquiries },
    staff: { title: 'Staff', icon: '👩‍🏫', roles: ['admin'], render: viewStaff },
    settings: { title: 'Settings', tTitle: 'Account', icon: '⚙️', roles: ['admin', 'teacher'], render: viewSettings }
  };
  var ROUTE_ORDER = ['dashboard', 'classes', 'attendance', 'notices', 'fees', 'enquiries', 'staff', 'settings'];
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
    if (!SB) { loadAll(); return showConfigError(); }
    if (RECOVERY) { loadAll(); return showSetNewPassword(); }
    SB.auth.getSession().then(function (r) {
      var sess = r && r.data && r.data.session;
      if (RECOVERY) { loadAll(); return showSetNewPassword(); }
      if (!sess) { Store.reset(); ME = null; loadAll(); return showLogin(); }
      startSession(sess.user);
    }).catch(function () {
      if (ME) return;
      Store.reset(); ME = null; loadAll();
      showLogin({ skipStatus: true, message: 'You appear to be offline. Open the app again when you have internet, or sign in if this phone already has a saved session.' });
    });
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
        (Store.hasLegacy() ? '<li><a href="#/settings">Import old data</a> saved on this device by the old version</li>' : '') +
        '<li><a href="#/settings">Download a backup</a> now and then — data is saved online and shared across devices</li></ol>' +
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
      return '<li><span><b>' + esc(p.studentName) + '</b> · ' + esc(periodText(p)) + '<small>' + esc(p.receiptNo) + ' · ' + fmtDate(p.paidOn) + ' · ' + esc(p.mode) + '</small></span><b>' + inr(p.amount) + '</b></li>';
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
      body += '<div class="row between"><h4>Fees</h4>' + (pays.length ? '<button class="btn small ghost" data-act="student-receipts" data-id="' + esc(s.id) + '">🧾 All receipts (' + pays.length + ')</button>' : '') + '</div><p>Pending (all months): <b class="coral-t">' + inr(outstanding(s)) + '</b></p>' +
        (pays.length ? '<ul class="mini-list">' + pays.slice(0, 6).map(function (p) { return '<li><span><b>' + esc(periodText(p)) + '</b><small>' + esc(p.receiptNo) + ' · ' + fmtDate(p.paidOn) + ' · ' + esc(p.mode) + '</small></span><span><b>' + inr(p.amount) + '</b> <button class="icon-btn" data-act="receipt-view" data-id="' + esc(p.id) + '" title="Receipt">🧾</button></span></li>'; }).join('') + '</ul>' : '<p class="muted">No payments yet.</p>');
    }
    if (isAdmin()) body += '<div id="student-parent-box">' + studentParentHTML(s) + '</div>';
    body += '<div class="form-actions">' + (isAdmin() ? '<button class="btn ghost" data-act="pay-add" data-student="' + esc(s.id) + '">💰 Record payment</button>' : '') + '<button class="btn primary" data-act="student-edit" data-id="' + esc(s.id) + '">✏️ Edit</button></div>';
    openModal({ title: 'Student details', size: 'wide', body: body });
    if (isAdmin()) PX.loadLinks().then(function () { var b = document.getElementById('student-parent-box'); if (b) b.innerHTML = studentParentHTML(s); });
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
      html += '<div class="toolbar pair">' + classSel + field('Month', '<input type="month" max="' + thisMonth() + '" value="' + UI.attMonth + '" data-change="att-month">') + '</div>';
      return html + monthGridHTML(UI.attClass, UI.attMonth);
    }
    if (UI.attTab === 'absent') {
      var cls = allowed.length > 1 ? field('Class', '<select data-change="att-class-any">' + options([{ value: 'all', label: 'All classes' }].concat(CLASSES.map(function (c) { return { value: c.id, label: c.emoji + ' ' + c.name }; })), UI.absClass || 'all') + '</select>') : classSel;
      html += '<div class="toolbar pair">' + cls + field('Date', '<input type="date" max="' + todayISO() + '" value="' + UI.attDate + '" data-change="att-date">') + '</div>';
      return html + absentListHTML(allowed.length > 1 ? (UI.absClass || 'all') : UI.attClass, UI.attDate);
    }
    html += '<div class="toolbar pair">' + classSel + field('Date', '<input type="date" max="' + todayISO() + '" value="' + UI.attDate + '" data-change="att-date">') + '</div>';
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
    var paysM = S.payments.filter(function (p) { return coversMonth(p, ym); });
    var received = paysM.reduce(function (a, p) { return a + payTowards(p, ym); }, 0);
    var pendingList = billable.map(function (s) { return { s: s, paid: paidFor(s.id, ym), due: dueFor(s, ym) }; }).filter(function (x) { return x.due > 0; });
    var pending = pendingList.reduce(function (a, x) { return a + x.due; }, 0);
    var html = '<div class="toolbar">' + field('Fee month', '<input type="month" value="' + ym + '" data-change="fee-month">') +
      '<button class="btn primary" data-act="pay-add">➕ Record payment</button></div>';
    html += '<div class="stats">' + stat('📋', 'Expected for ' + fmtMonth(ym), inr(expected), billable.length + ' students with a monthly fee', 'sky') +
      stat('💰', 'Received towards ' + fmtMonth(ym), inr(received), paysM.length + ' receipt' + (paysM.length === 1 ? '' : 's'), 'green') +
      stat('⏳', 'Pending for ' + fmtMonth(ym), inr(pending), pendingList.length + ' student' + (pendingList.length === 1 ? '' : 's'), 'coral') + '</div>';
    html += dupReceiptsHTML();
    var noFee = studs.filter(function (s) { return !num(s.monthlyFee); }).length;
    if (noFee) html += '<p class="note">ℹ️ ' + noFee + ' active student' + (noFee === 1 ? ' has' : 's have') + ' no monthly fee set, so they are not counted. Set it in the student’s profile.</p>';
    html += '<div class="seg-tabs"><button type="button" class="' + (UI.feeTab === 'pending' ? 'active' : '') + '" data-act="fee-tab" data-tab="pending">⏳ Pending (' + pendingList.length + ')</button><button type="button" class="' + (UI.feeTab === 'payments' ? 'active' : '') + '" data-act="fee-tab" data-tab="payments">🧾 Payments (' + paysM.length + ')</button></div>';
    if (UI.feeTab === 'payments') {
      if (!paysM.length) return html + emptyState('🧾', 'No payments for ' + fmtMonth(ym), 'Recorded payments for this fee month will appear here.', '<button class="btn primary" data-act="pay-add">➕ Record payment</button>');
      return html + '<div class="table-wrap"><table class="table responsive"><thead><tr><th>Receipt</th><th>Paid on</th><th>Student</th><th>Fee for</th><th>Mode</th><th class="num">Amount</th><th class="act-col"><span class="sr">Actions</span></th></tr></thead><tbody>' +
        paysM.sort(function (a, b) { return (a.seq || 0) < (b.seq || 0) ? 1 : -1; }).map(function (p) {
          return '<tr><td data-label="Receipt"><b>' + esc(p.receiptNo) + '</b></td><td data-label="Paid on">' + fmtDate(p.paidOn) + '</td><td data-label="Student"><button type="button" class="link" data-act="student-receipts" data-id="' + esc(p.studentId) + '" title="All receipts of this student">' + esc(p.studentName) + '</button> <small class="muted">' + esc(className(p.classId)) + '</small></td><td data-label="Fee for">' + esc(periodText(p)) + '</td><td data-label="Mode">' + esc(p.mode) + '</td><td data-label="Amount" class="num"><b>' + inr(p.amount) + '</b></td>' +
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
    // Never reuse a number, even if two devices recorded payments while offline.
    var maxUsed = S.payments.reduce(function (m, p) { return Math.max(m, parseInt(p.seq, 10) || 0); }, 0);
    var seq = Math.max(1, parseInt(S.settings.receiptSeq, 10) || 1, maxUsed + 1);
    var used = {}; S.payments.forEach(function (p) { if (p.receiptNo) used[String(p.receiptNo).toUpperCase()] = 1; });
    var pre = (S.settings.receiptPrefix || 'LW').trim(), no = pre + '-' + String(seq).padStart(4, '0'), guard = 0;
    while (used[no.toUpperCase()] && guard++ < 10000) { seq++; no = pre + '-' + String(seq).padStart(4, '0'); }
    return { seq: seq, no: no };
  }
  // Two phones recording payments while BOTH offline can pick the same number.
  // After syncing, such duplicates are listed on the Fees page with a one-tap fix
  // that gives the newer payment the next free number (the older keeps its number).
  function duplicateReceipts() {
    var by = {};
    S.payments.forEach(function (p) { var k = String(p.receiptNo || '').toUpperCase(); if (k) (by[k] = by[k] || []).push(p); });
    return Object.keys(by).filter(function (k) { return by[k].length > 1; }).map(function (k) {
      return by[k].slice().sort(function (a, b) { return String(a.createdAt || '') < String(b.createdAt || '') ? -1 : 1; });
    });
  }
  function dupReceiptsHTML() {
    var d = duplicateReceipts();
    if (!d.length) return '';
    return '<div class="callout warn dup-warn"><b>⚠️ Same receipt number used twice</b><p>This happens when two phones record payments while both are offline. Keep the first one and give the newer payment a new number:</p><ul>' +
      d.map(function (g) { return g.slice(1).map(function (p) { return '<li><b>' + esc(p.receiptNo) + '</b> · ' + esc(p.studentName) + ' · ' + inr(p.amount) + ' · ' + fmtDate(p.paidOn) + ' <button class="btn small primary" data-act="receipt-renum" data-id="' + esc(p.id) + '">Give new number</button></li>'; }).join(''); }).join('') + '</ul></div>';
  }
  function allocate(s, months, amount) {
    // Fill each month's due in order; anything left over goes to the last month.
    var left = amount, alloc = {}, fee = num(s.monthlyFee);
    months.forEach(function (m, i) {
      var due = fee > 0 ? Math.max(0, fee - paidFor(s.id, m)) : 0;
      var put = i === months.length - 1 ? left : Math.min(left, due);
      put = Math.round(put * 100) / 100;
      if (put > 0) alloc[m] = put;
      left = Math.round((left - put) * 100) / 100;
    });
    return alloc;
  }
  function monthsFrom(ym, n) { var out = []; for (var i = 0; i < n; i++) out.push(addMonths(ym, i)); return out; }
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
      field('Months covered', '<select name="count">' + options([1, 2, 3, 4, 5, 6, 9, 12].map(function (n) { return { value: String(n), label: n === 1 ? '1 month' : n + ' months' }; }), '1') + '</select>', '<small class="hint">For a term / advance payment</small>') +
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
        var sel = $('[name=studentId]', root), mon = $('[name=month]', root), cnt = $('[name=count]', root), amt = $('[name=amount]', root), hint = $('#due-hint', root), amtTouched = false;
        amt.addEventListener('input', function () { amtTouched = true; });
        function upd() {
          var s = studentById(sel.value);
          if (!s || !isMonth(mon.value)) { hint.hidden = true; return; }
          var ms = monthsFrom(mon.value, parseInt(cnt.value, 10) || 1);
          var fee = num(s.monthlyFee), paid = ms.reduce(function (a, m) { return a + paidFor(s.id, m); }, 0), due = ms.reduce(function (a, m) { return a + Math.max(0, fee - paidFor(s.id, m)); }, 0);
          hint.hidden = false;
          hint.innerHTML = '<b>' + esc(s.name) + '</b> · ' + esc(window.LWReceipt ? window.LWReceipt.period(ms) : fmtMonth(mon.value)) + ': fee ' + inr(fee * ms.length) + ' · paid ' + inr(paid) + ' · <b>due ' + inr(due) + '</b>' + (mon.value < admMonth(s) ? '<br><small class="warn-t">This month is before the admission date (' + fmtDate(s.admissionDate) + ').</small>' : '');
          if (!amtTouched) amt.value = due > 0 ? due : '';
        }
        sel.addEventListener('change', upd); mon.addEventListener('change', upd); cnt.addEventListener('change', upd); upd();
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
        var n = parseInt(g('count'), 10); if (!(n >= 1 && n <= 12)) n = 1;
        var ms = monthsFrom(g('month'), n);
        var due = ms.reduce(function (a, m) { return a + Math.max(0, num(s.monthlyFee) - paidFor(s.id, m)); }, 0);
        return (num(s.monthlyFee) && amount > due ? confirmBox('This is more than the amount due for ' + periodText({ months: ms }) + ' (' + inr(due) + '). Save anyway?', { ok: 'Save', danger: false, title: 'Amount more than due' }) : Promise.resolve(true)).then(function (go) {
          if (!go) return false;
          var r = nextReceiptNo();
          var amt2 = Math.round(amount * 100) / 100;
          var p = { id: uid(), seq: r.seq, receiptNo: r.no, studentId: s.id, studentName: s.name, parentName: s.parentName || '', classId: s.classId, month: ms[0],
            amount: amt2, mode: g('mode'), ref: g('ref'), paidOn: g('paidOn'), note: g('note'), receivedBy: (ME && ME.name) || S.settings.owner || '', monthlyFee: num(s.monthlyFee), createdAt: new Date().toISOString() };
          if (ms.length > 1) { p.months = ms; p.alloc = allocate(s, ms, amt2); }
          S.payments.push(p);
          p.balanceAfter = outstanding(s);
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
  function receiptData(p, copy) {
    var st = S.settings, s = studentById(p.studentId);
    var hasSnap = p.balanceAfter != null && isFinite(Number(p.balanceAfter));
    var bal = hasSnap ? num(p.balanceAfter) : (s && num(s.monthlyFee) ? outstanding(s) : null);
    return {
      school: { name: st.schoolName, address: st.address, phone: st.phone, email: st.email }, logo: 'assets/logo.jpeg',
      receiptNo: p.receiptNo, date: p.paidOn, studentName: p.studentName, className: className(p.classId), parentName: p.parentName || (s && s.parentName) || '',
      months: payMonths(p), monthlyFee: p.monthlyFee != null ? p.monthlyFee : (s ? s.monthlyFee : 0), amount: p.amount, mode: p.mode, ref: p.ref,
      balance: bal, balanceLabel: hasSnap ? 'Balance due after this payment' : 'Balance due (as on ' + fmtDate(todayISO()) + ')',
      receivedBy: p.receivedBy || '', copy: copy || ''
    };
  }
  function receiptText(p) { return window.LWReceipt.text(receiptData(p)); }
  function findPayment(id) { return S.payments.filter(function (p) { return p.id === id; })[0]; }
  function receiptWaLink(p) {
    var s = studentById(p.studentId), wa = s ? (s.whatsapp || s.phone) : '';
    return wa && validPhone(wa) ? waHref(wa, receiptText(p)) : 'https://wa.me/?text=' + encodeURIComponent(receiptText(p));
  }
  function receiptFileName(p) { return 'Receipt ' + p.receiptNo + ' - ' + p.studentName; }
  function openReceipt(id) {
    var p = findPayment(id);
    if (!p || !window.LWReceipt) return;
    var s = studentById(p.studentId), wa = s ? (s.whatsapp || s.phone) : '';
    openModal({
      title: 'Receipt ' + p.receiptNo, size: 'wide',
      body: '<div class="receipt-preview">' + window.LWReceipt.html(receiptData(p)) + '</div>' +
        '<div class="receipt-actions"><a class="btn wa-btn" href="' + esc(receiptWaLink(p)) + '" target="_blank" rel="noopener">' + WA_SVG + ' Share on WhatsApp' + (wa && validPhone(wa) ? '' : ' (choose chat)') + '</a>' +
        '<button type="button" class="btn ghost" data-act="receipt-img" data-id="' + esc(p.id) + '">🖼️ Save image</button>' +
        '<button type="button" class="btn ghost" data-act="receipt-pdf" data-id="' + esc(p.id) + '">📄 Save as PDF</button>' +
        '<button type="button" class="btn primary" data-act="receipt-print" data-id="' + esc(p.id) + '">🖨️ Print (2 copies)</button></div>' +
        '<p class="muted small">Save as PDF: in the print window choose <b>Save as PDF</b> (Android: <b>Save as PDF</b> printer; iPhone: Share → Save to Files). Print puts a parent copy and an office copy on one A4 page.</p>'
    });
  }
  function printReceipt(id, single) {
    var p = findPayment(id);
    if (!p || !window.LWReceipt) return;
    window.LWReceipt.print(single ? [receiptData(p)] : [receiptData(p, 'Parent copy'), receiptData(p, 'Office copy')], receiptFileName(p));
  }
  function saveReceiptImage(id) {
    var p = findPayment(id);
    if (!p || !window.LWReceipt) return;
    window.LWReceipt.saveImage(receiptData(p), receiptFileName(p)).then(function (r) { if (r === 'downloaded') toast('Receipt image saved'); }).catch(function (e) { toast('Could not make the image: ' + (e && e.message || e), 'err'); });
  }
  function renumberReceipt(id) {
    var p = findPayment(id);
    if (!p) return;
    var r = nextReceiptNo(), old = p.receiptNo;
    confirmBox('Give this payment (' + p.studentName + ', ' + inr(p.amount) + ') the new receipt number ' + r.no + ' instead of ' + old + '? If you already gave the parent a receipt with ' + old + ', send them the new one.', { ok: 'Use ' + r.no, danger: false, title: 'New receipt number' }).then(function (ok) {
      if (!ok) return;
      p.renumberedFrom = old; p.receiptNo = r.no; p.seq = r.seq;
      S.settings.receiptSeq = r.seq + 1;
      persist('payments', 'settings');
      toast('Receipt is now ' + r.no);
      render();
    });
  }
  function openStudentReceipts(sid) {
    var s = studentById(sid);
    var pays = S.payments.filter(function (p) { return p.studentId === sid; }).sort(function (a, b) { return (b.paidOn || '') + String(b.seq || 0).padStart(9, '0') < (a.paidOn || '') + String(a.seq || 0).padStart(9, '0') ? -1 : 1; });
    var name = s ? s.name : (pays[0] ? pays[0].studentName : 'Student');
    var total = pays.reduce(function (a, p) { return a + num(p.amount); }, 0);
    var body = '<div class="rcpt-total"><span>Receipts: <b>' + pays.length + '</b></span><span>Total paid: <b>' + inr(total) + '</b></span>' + (s && num(s.monthlyFee) ? '<span>Monthly fee: <b>' + inr(s.monthlyFee) + '</b></span><span>Pending now: <b class="coral-t">' + inr(outstanding(s)) + '</b></span>' : '') + '</div>' +
      (pays.length ? '<div class="table-wrap"><table class="table responsive"><thead><tr><th>Receipt</th><th>Paid on</th><th>Fee for</th><th>Mode</th><th class="num">Amount</th><th class="act-col"><span class="sr">Actions</span></th></tr></thead><tbody>' +
        pays.map(function (p) {
          return '<tr><td data-label="Receipt"><b>' + esc(p.receiptNo) + '</b></td><td data-label="Paid on">' + fmtDate(p.paidOn) + '</td><td data-label="Fee for">' + esc(periodText(p)) + '</td><td data-label="Mode">' + esc(p.mode) + '</td><td data-label="Amount" class="num"><b>' + inr(p.amount) + '</b></td>' +
            '<td class="actions"><button class="icon-btn" data-act="receipt-view" data-id="' + esc(p.id) + '" title="View / print receipt" aria-label="Receipt ' + esc(p.receiptNo) + '">🧾</button></td></tr>';
        }).join('') + '</tbody></table></div>' : '<p class="muted">No payments yet.</p>') +
      (s && s.status !== 'Left' ? '<div class="form-actions"><button class="btn primary" data-act="pay-add" data-student="' + esc(sid) + '">💰 Record payment</button></div>' : '');
    openModal({ title: '🧾 Receipts · ' + name, size: 'wide', body: body });
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
    var secNote = '<div class="callout"><b>🔐 Security</b><p>Everyone signs in with their own email and password. Data is kept in the school’s private Supabase database (Mumbai). Database rules (Row Level Security) are enforced on the server: teachers can read only their own class’s students and attendance, and cannot read fees, payments, enquiries or staff salaries at all. This device keeps an offline copy of what you are allowed to see; signing out removes it. Use a strong password and don’t share logins.</p></div>';
    var pwForm = '<form class="form narrow" data-form="my-password" novalidate>' + pwInput('password', 'New password (at least 8 characters)', 'new-password') + pwInput('password2', 'Confirm new password', 'new-password') +
      '<button class="btn primary">Change password</button></form>';
    if (!isAdmin()) {
      return '<section class="card"><h2>👤 My account</h2><p><b>' + esc(ME.name) + '</b> · Teacher, ' + esc(className(ME.classId)) + '<br><small class="muted">' + esc(ME.email || '') + '</small></p></section>' +
        '<section class="card"><h3>🔐 Change my password</h3>' + pwForm + '</section>' + secNote +
        '<div class="callout"><b>☁️ Saved online</b><p>Attendance and student details you save here go to the school’s online database, so the admin sees them on their phone too. If you are offline, changes wait on this phone and upload automatically when the internet is back (watch the badge at the top).</p></div>' + syncInfoHTML() +
        installHintHTML() +
        '<p class="muted small center">The Little Wings Dashboard v' + APP_VERSION + ' · Times in India Standard Time</p>';
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

    html += '<section class="card"><h2>📱 Teacher logins</h2><p class="muted">Each teacher signs in with their own email and password on any phone. Teachers see only their class’s students and attendance — no fees, enquiries, staff or settings.</p>' +
      (S.users.length ? '<ul class="mini-list">' + S.users.slice().sort(byName).map(function (u) {
        return '<li><span><b>' + esc(u.name) + '</b><small>' + esc(className(u.classId)) + ' · ' + esc(u.email) + '</small></span><span class="row gap"><button class="btn small ghost" data-act="user-edit" data-id="' + esc(u.id) + '">Edit</button><button class="btn small ghost" data-act="user-reset" data-id="' + esc(u.id) + '">New password</button><button class="icon-btn" data-act="user-del" data-id="' + esc(u.id) + '" title="Remove login" aria-label="Remove login for ' + esc(u.name) + '">🗑️</button></span></li>';
      }).join('') + '</ul>' : '<p class="muted">No teacher logins yet.</p>') +
      '<details class="add-box"' + (S.users.length ? '' : ' open') + '><summary>➕ Add teacher login</summary><form class="form" data-form="add-user" novalidate><div class="grid2">' +
      field('Teacher name *', '<input name="name" maxlength="60" list="staff-names" autocomplete="off" required>') + '<datalist id="staff-names">' + S.staff.map(function (s) { return '<option value="' + esc(s.name) + '">'; }).join('') + '</datalist>' +
      field('Class *', '<select name="classId" required>' + options(classOptions(), '', 'Select class') + '</select>') +
      field('Teacher’s email *', '<input name="email" type="email" inputmode="email" autocapitalize="none" spellcheck="false" maxlength="120" autocomplete="off" required>') +
      field('Temporary password *', '<span class="pw-wrap"><input name="password" type="password" autocomplete="new-password" minlength="8" maxlength="72" required><button type="button" class="pw-toggle" data-act="pw-toggle" aria-label="Show password">👁️</button></span>', '<small class="hint">At least 8 characters. <button type="button" class="link" data-act="pw-generate">Suggest one</button></small>') +
      '</div><p class="note">Share the email and temporary password with the teacher (for example on WhatsApp). They can change it in Settings → My account.</p><button class="btn primary">Create login</button></form></details></section>';

    html += '<section class="card"><h2>💰 Fees in the Parents app</h2><label class="switch-row"><input type="checkbox" data-change="fees-to-parents"' + (S.settings.showFeesToParents === true ? ' checked' : '') + '><span><b>Show fees to parents</b><br><small class="muted">When on, each parent sees only their own child’s monthly fee, pending amount and receipts in the Parents app (no notes, no other children). When off, parents see “Fee details are not shown yet”. The database checks this switch, so it cannot be bypassed.</small></span></label></section>';
    html += parentLoginsCardHTML();
    html += '<section class="card"><h2>🔐 My password</h2><p class="muted small">Signed in as ' + esc(ME.email || '') + '</p>' + pwForm + '</section>' + secNote;

    var kb = (Store.usageBytes() / 1024).toFixed(1);
    html += '<section class="card"><h2>💾 Backup &amp; data</h2><div class="callout"><b>☁️ Your data is saved online</b><p>Everything is saved in the school’s private online database and shows on every phone where you or your teachers sign in. This phone also keeps an offline copy (about ' + kb + ' KB), so you can keep working without internet; changes upload when you are back online. It is still wise to <b>download a backup</b> every month and keep it in Google Drive or email.</p></div>' +
      '<p class="muted small">' + S.students.length + ' students · ' + S.payments.length + ' payments · ' + Object.keys(S.attendance).length + ' attendance days · ' + S.enquiries.length + ' enquiries · ' + S.staff.length + ' staff.' + (st.lastBackup ? ' Last backup: ' + fmtDate(st.lastBackup.slice(0, 10)) + '.' : ' No backup taken yet.') + '</p>' +
      syncInfoHTML() +
      '<div class="row gap wrap"><button class="btn primary" data-act="backup">⬇️ Download backup (JSON)</button><label class="btn ghost file-btn">⬆️ Restore from backup<input type="file" accept=".json,application/json" data-change="restore" hidden></label></div>' +
      '<p class="muted small">Restoring adds the backup’s records to the online database and updates records with the same ID. It does not delete anything.</p>';
    if (Store.hasLegacy()) {
      var lg = Store.legacyData().data, imp = Store.rawGet('legacyImportedAt');
      html += '<div class="callout warn"><b>📥 Old data on this device</b><p>This browser still has data from the old version of the dashboard (saved only on this device): ' +
        asArray(lg.students).length + ' students, ' + asArray(lg.payments).length + ' payments, ' + Object.keys(asObject(lg.attendance)).length + ' attendance days, ' + asArray(lg.enquiries).length + ' enquiries, ' + asArray(lg.staff).length + ' staff.' +
        (imp ? ' <b>Already imported on ' + esc(fmtDate(imp.slice(0, 10))) + '.</b>' : '') + '</p><button class="btn primary" data-act="import-legacy">' + (imp ? 'Import again' : 'Import this device’s old local data into the cloud') + '</button></div>';
    }
    html += '<h3>Export to Excel (CSV)</h3><div class="row gap wrap">' + ['students', 'attendance', 'payments', 'enquiries', 'staff'].map(function (t) { return '<button class="btn small ghost" data-act="csv" data-t="' + t + '">📄 ' + cap(t) + '</button>'; }).join('') + '</div>' +
      '<details class="danger-zone"><summary>This device</summary><p>Remove this phone’s offline copy and sign out. Online data is not affected. Unsynced changes on this phone would be lost.</p><button class="btn danger" data-act="erase">Clear this device &amp; sign out</button></details></section>';
    html += installHintHTML();
    html += '<p class="muted small center">The Little Wings Dashboard v' + APP_VERSION + ' · Times in India Standard Time</p>';
    return html;
  }
  /* =====================================================================
   * PARENT LOGINS + NOTICES (v2.2)
   * Parent logins are managed by the lw-admin Edge Function. Links and
   * notices are read straight from the database (RLS decides what each
   * person may see); they are not part of the offline Store.
   * ===================================================================== */
  var PX = (function () {
    var links = [], linksAt = 0, linksP = null, notices = [], noticesAt = 0, noticesP = null, noticesErr = '', pollT = null;
    function reset() { links = []; linksAt = 0; notices = []; noticesAt = 0; noticesErr = ''; clearInterval(pollT); pollT = null; }
    function loadLinks(force) {
      if (!SB || !isAdmin()) return Promise.resolve(links);
      if (!force && linksP) return linksP;
      if (!force && Date.now() - linksAt < 15000) return Promise.resolve(links);
      linksP = SB.from('parent_students').select('user_id,student_id').then(function (r) {
        linksP = null;
        if (!r.error) { links = r.data || []; linksAt = Date.now(); }
        return links;
      }, function () { linksP = null; return links; });
      return linksP;
    }
    function loadNotices(force) {
      if (!SB || !ME) return Promise.resolve(notices);
      if (!force && noticesP) return noticesP;
      noticesP = SB.from('notices').select('id,title,body,audience,pinned,expires_on,created_by,author_name,author_role,created_at')
        .order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(200).then(function (r) {
          noticesP = null;
          if (r.error) { noticesErr = navigator.onLine === false ? 'You are offline. Notices will load when the internet is back.' : 'Could not load notices (' + r.error.message + ').'; }
          else { notices = r.data || []; noticesAt = Date.now(); noticesErr = ''; }
          return notices;
        }, function () { noticesP = null; noticesErr = 'You are offline. Notices will load when the internet is back.'; return notices; });
      return noticesP;
    }
    function startPoll() {
      if (pollT) return;
      pollT = setInterval(function () {
        if (!ME || parseHash().name !== 'notices') { clearInterval(pollT); pollT = null; return; }
        if (document.visibilityState === 'hidden' || userIsTyping()) return;
        loadNotices(true).then(function () { if (parseHash().name === 'notices' && !userIsTyping() && !$('#modal-root').innerHTML) refreshNoticeList(); });
      }, 30000);
    }
    return {
      reset: reset, loadLinks: loadLinks, loadNotices: loadNotices, startPoll: startPoll,
      links: function () { return links; }, linksLoaded: function () { return linksAt > 0; },
      notices: function () { return notices; }, noticesLoaded: function () { return noticesAt > 0; }, noticesAt: function () { return noticesAt; }, noticesErr: function () { return noticesErr; }
    };
  })();

  function parentById(id) { return S.parents.filter(function (p) { return p.id === id; })[0] || null; }
  function childrenOf(parentId) { return PX.links().filter(function (l) { return l.user_id === parentId; }).map(function (l) { return studentById(l.student_id); }).filter(Boolean); }
  function parentsOf(studentId) { return PX.links().filter(function (l) { return l.student_id === studentId; }).map(function (l) { return parentById(l.user_id); }).filter(Boolean); }
  function fmtMobile(d) { return d && d.length === 10 ? d.slice(0, 5) + ' ' + d.slice(5) : (d || '—'); }

  function parentLoginsCardHTML() {
    if (!isAdmin()) return '';
    if (!PX.linksLoaded()) PX.loadLinks().then(function () { if (parseHash().name === 'settings' && !userIsTyping()) render(); });
    var list = S.parents.slice().sort(byName);
    return '<section class="card" id="parent-logins"><h2>👨‍👩‍👧 Parent logins</h2><p class="muted">Parents sign in to the <b>Little Wings Parents</b> app with their <b>mobile number</b> and a password you set. They see only their own child’s attendance and the notices for the school and their child’s class — no fees, no other children.</p>' +
      (list.length ? '<ul class="mini-list">' + list.map(function (p) {
        var kids = childrenOf(p.id);
        return '<li><span><b>' + esc(p.name) + '</b><small>📱 ' + esc(fmtMobile(p.phone)) + ' · ' + (kids.length ? kids.map(function (k) { return esc(k.name) + ' (' + esc(className(k.classId)) + ')'; }).join(', ') : (PX.linksLoaded() ? '<span class="coral-t">no child linked</span>' : '…')) + '</small></span>' +
          '<span class="row gap"><button class="btn small ghost" data-act="parent-edit" data-id="' + esc(p.id) + '">Edit</button><button class="btn small ghost" data-act="user-reset" data-id="' + esc(p.id) + '">New password</button><button class="icon-btn" data-act="parent-del" data-id="' + esc(p.id) + '" title="Remove login" aria-label="Remove login for ' + esc(p.name) + '">🗑️</button></span></li>';
      }).join('') + '</ul>' : '<p class="muted">No parent logins yet.</p>') +
      '<div class="row gap wrap"><button class="btn primary" data-act="parent-add">➕ Add parent login</button><a class="btn ghost" href="' + esc(PARENTS_APP_URL) + '" target="_blank" rel="noopener">Open Parents app ↗</a></div>' +
      '<p class="muted small">Tip: you can also create a parent login from a student’s details (Classes → tap the child).</p></section>';
  }
  function studentParentHTML(s) {
    var ps = parentsOf(s.id);
    return '<h4>📲 Parents app</h4>' + (ps.length ? '<ul class="mini-list">' + ps.map(function (p) {
      return '<li><span><b>' + esc(p.name) + '</b><small>Login: ' + esc(fmtMobile(p.phone)) + '</small></span><span class="row gap"><button class="btn small ghost" data-act="parent-edit" data-id="' + esc(p.id) + '">Edit</button></span></li>';
    }).join('') + '</ul>' : (PX.linksLoaded() ? '<p class="muted">No parent login for this child yet.</p>' : '<p class="muted">Checking…</p>')) +
      '<p><button class="btn small ghost" data-act="parent-add" data-student="' + esc(s.id) + '">➕ Create parent login</button></p>';
  }
  function childPickerHTML(selected) {
    var sel = {}; selected.forEach(function (id) { sel[id] = 1; });
    var kids = activeStudents().slice().sort(function (a, b) { return a.classId === b.classId ? byName(a, b) : CLASSES.map(function (c) { return c.id; }).indexOf(a.classId) - CLASSES.map(function (c) { return c.id; }).indexOf(b.classId); });
    if (!kids.length) return '<p class="note warn">Add the child on the Classes page first.</p>';
    return '<input type="search" class="kid-filter" placeholder="🔍 Search child" data-input="kid-filter" aria-label="Search child">' +
      '<div class="kid-picker">' + kids.map(function (k) {
        return '<label class="kid-opt" data-name="' + esc((k.name + ' ' + (k.parentName || '') + ' ' + (k.phone || '')).toLowerCase()) + '"><input type="checkbox" name="kids" value="' + esc(k.id) + '"' + (sel[k.id] ? ' checked' : '') + '><span><b>' + esc(k.name) + '</b><small>' + esc(className(k.classId)) + (k.parentName ? ' · ' + esc(k.parentName) : '') + '</small></span></label>';
      }).join('') + '</div>';
  }
  function openParentForm(p, studentId) {
    var preset = studentId ? studentById(studentId) : null;
    var selected = p ? childrenOf(p.id).map(function (k) { return k.id; }) : [];
    var name = p ? p.name : (preset ? preset.parentName || '' : '');
    var phone = p ? p.phone : (preset ? normPhone(preset.phone || preset.whatsapp || '') : '');
    if (preset && !p) {
      selected = [preset.id];
      var ph = normPhone(preset.phone);
      if (validPhone(ph)) activeStudents().forEach(function (k) { if (k.id !== preset.id && normPhone(k.phone) === ph) selected.push(k.id); }); // siblings
    }
    openModal({
      title: p ? 'Edit parent login' : 'Create parent login',
      body: '<form class="form" novalidate>' +
        field('Parent name *', '<input name="name" maxlength="60" autocomplete="off" value="' + esc(name) + '" required>') +
        field('Mobile number (login ID) *', '<span class="tel-wrap"><span class="cc">+91</span><input name="phone" type="tel" inputmode="numeric" maxlength="14" autocomplete="off" value="' + esc(phone) + '" placeholder="98765 43210" required></span>') +
        (p ? '' : field('Temporary password *', '<span class="pw-wrap"><input name="password" type="password" autocomplete="new-password" minlength="8" maxlength="72" required><button type="button" class="pw-toggle" data-act="pw-toggle" aria-label="Show password">👁️</button></span>', '<small class="hint">At least 8 characters. <button type="button" class="link" data-act="pw-generate">Suggest one</button></small>')) +
        '<div class="field" data-field="kids"><span class="lbl">Child / children *</span>' + childPickerHTML(selected) + '<small class="hint">Tick brothers and sisters too, so one login shows all of them.</small></div>' +
        (p ? '<p class="muted small">To change the password, use <b>New password</b> in the list.</p>' : '') +
        '<div class="form-actions"><button type="button" class="btn ghost" data-act="modal-close">Cancel</button><button class="btn primary">' + (p ? 'Save' : 'Create login') + '</button></div></form>',
      onSubmit: function (form, fd) {
        var nm = String(fd.get('name') || '').trim(), mob = normPhone(fd.get('phone')), pw = String(fd.get('password') || ''), kids = fd.getAll('kids').map(String);
        if (nm.length < 2) { fieldError(form, 'name', 'Enter the parent’s name'); return false; }
        if (!validPhone(mob)) { fieldError(form, 'phone', 'Enter a valid 10-digit mobile number'); return false; }
        var dup = S.parents.filter(function (x) { return x.phone === mob && (!p || x.id !== p.id); })[0];
        if (dup) { fieldError(form, 'phone', 'A parent login with this number already exists (' + dup.name + '). Edit that one to add this child.'); return false; }
        if (!p && pw.length < 8) { fieldError(form, 'password', 'Use at least 8 characters'); return false; }
        if (!kids.length) { var kf = form.querySelector('[data-field=kids]'); kf.classList.add('invalid'); var e = document.createElement('small'); e.className = 'err'; e.textContent = 'Choose at least one child'; kf.appendChild(e); return false; }
        var call = p ? fnCall('update_parent', { id: p.id, name: nm, phone: mob, studentIds: kids }) : fnCall('create_parent', { name: nm, phone: mob, password: pw, studentIds: kids });
        return call.then(function () {
          return Promise.all([Store.sync(false), PX.loadLinks(true)]);
        }).then(function () {
          loadAll(); render();
          if (!p) setTimeout(function () { showParentShare(nm, mob, pw, kids); }, 0);
          else toast('Parent login updated');
          return true;
        }).catch(function (err) { fieldError(form, 'phone', err.message); return false; });
      }
    });
  }
  function showParentShare(name, mob, pw, kids) {
    var names = kids.map(function (id) { var k = studentById(id); return k ? k.name : ''; }).filter(Boolean).join(', ');
    var msg = 'Hello ' + name + '! 🙏 Your login for the Little Wings Parents app (' + names + '):\n' + PARENTS_APP_URL + '\nMobile number: ' + mob + '\nPassword: ' + pw + '\nOpen the link, sign in, then add it to your Home Screen. — ' + S.settings.schoolName;
    openModal({
      title: 'Parent login created ✅',
      body: '<p>Share these details with <b>' + esc(name) + '</b>:</p><div class="callout"><p>🔗 ' + esc(PARENTS_APP_URL) + '<br>📱 Mobile: <b>' + esc(fmtMobile(mob)) + '</b><br>🔑 Password: <b>' + esc(pw) + '</b><br>🧒 ' + esc(names) + '</p></div>' +
        '<div class="form-actions"><button type="button" class="btn ghost" data-act="modal-close">Done</button><a class="btn primary" href="' + esc(waHref(mob, msg)) + '" target="_blank" rel="noopener">Send on WhatsApp</a></div>'
    });
  }

  /* ----- Notices page ----- */
  function noticeAudiences() {
    return isAdmin() ? [{ value: 'all', label: '🏫 Whole school' }].concat(CLASSES.map(function (c) { return { value: c.id, label: c.emoji + ' ' + c.name + ' only' }; })) : (CLASS_BY_ID[ME.classId] ? [{ value: ME.classId, label: CLASS_BY_ID[ME.classId].emoji + ' ' + CLASS_BY_ID[ME.classId].name + ' only' }] : []);
  }
  function canEditNotice(n) { return isAdmin() || (n.created_by === ME.userId && n.audience === ME.classId); }
  function audienceTag(a) { return a === 'all' ? '<span class="tag n-all">🏫 School</span>' : '<span class="tag n-class" style="--c:' + esc((CLASS_BY_ID[a] || {}).color || '#38a8e0') + '">' + esc((CLASS_BY_ID[a] || {}).emoji || '') + ' ' + esc(className(a)) + '</span>'; }
  function noticeDate(iso) { try { return new Intl.DateTimeFormat('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)); } catch (e) { return ''; } }
  function noticeListHTML() {
    var list = PX.notices();
    if (!PX.noticesLoaded()) return PX.noticesErr() ? '<p class="note warn">' + esc(PX.noticesErr()) + '</p>' : '<div class="spinner" aria-hidden="true"></div>';
    var today = todayISO();
    var out = PX.noticesErr() ? '<p class="note warn">' + esc(PX.noticesErr()) + '</p>' : '';
    if (!list.length) return out + emptyState('📢', 'No notices yet', 'Post a notice above. Parents see it in the Little Wings Parents app.');
    return out + '<div class="notice-list">' + list.map(function (n) {
      var expired = n.expires_on && n.expires_on < today;
      return '<article class="notice' + (n.pinned ? ' pinned' : '') + (expired ? ' expired' : '') + '"><div class="notice-top">' + audienceTag(n.audience) + (n.pinned ? '<span class="tag n-pin">📌 Pinned</span>' : '') + (expired ? '<span class="tag">Expired</span>' : '') + '</div>' +
        '<h3>' + esc(n.title) + '</h3>' + (n.body ? '<p class="notice-body">' + esc(n.body) + '</p>' : '') +
        '<p class="muted small">' + esc(n.author_name || (n.author_role === 'admin' ? 'School office' : 'Teacher')) + ' · ' + esc(noticeDate(n.created_at)) + (n.expires_on ? ' · shown until ' + esc(fmtDate(n.expires_on)) : '') + '</p>' +
        (canEditNotice(n) ? '<div class="row gap"><button class="btn small ghost" data-act="notice-pin" data-id="' + esc(n.id) + '">' + (n.pinned ? 'Unpin' : '📌 Pin') + '</button><button class="btn small ghost danger-t" data-act="notice-del" data-id="' + esc(n.id) + '">🗑️ Delete</button></div>' : '') + '</article>';
    }).join('') + '</div>';
  }
  function refreshNoticeList() { var l = document.getElementById('notice-list'); if (l) l.innerHTML = noticeListHTML(); }
  function viewNotices() {
    var auds = noticeAudiences();
    if (Date.now() - PX.noticesAt() > 10000) PX.loadNotices(true).then(function () { if (parseHash().name === 'notices') refreshNoticeList(); });
    PX.startPoll();
    var form = auds.length ? '<section class="card"><h2>📢 Post a notice</h2><form class="form" data-form="notice-add" novalidate>' +
      field('Title *', '<input name="title" maxlength="120" required placeholder="e.g. Holiday on Friday">') +
      field('Message', '<textarea name="body" rows="3" maxlength="2000" placeholder="Details for parents"></textarea>') +
      '<div class="grid2">' + field('Who should see it', auds.length > 1 ? '<select name="audience">' + options(auds, 'all') + '</select>' : '<input type="hidden" name="audience" value="' + esc(auds[0].value) + '"><span class="ro">' + esc(auds[0].label) + '</span>') +
      field('Show until (optional)', '<input type="date" name="expires_on" min="' + esc(todayISO()) + '">') + '</div>' +
      '<label class="check"><input type="checkbox" name="pinned" value="1"> 📌 Pin to the top</label>' +
      '<button class="btn primary">Post notice</button></form>' +
      '<p class="muted small">' + (isAdmin() ? 'Parents see whole-school notices and notices for their child’s class in the Little Wings Parents app.' : 'You can post to your class only. Parents of your class see it in the Little Wings Parents app.') + '</p></section>'
      : '<p class="note warn">Your login has no class yet, so you can read school notices but not post. Ask the admin.</p>';
    return form + '<section class="card"><div class="row between"><h2>🗂️ Notices</h2><button class="btn small ghost" data-act="notices-refresh">🔄 Refresh</button></div><div id="notice-list">' + noticeListHTML() + '</div></section>';
  }
  FORMS_EXTRA['notice-add'] = function (f, fd) {
    var title = String(fd.get('title') || '').trim(), body = String(fd.get('body') || '').trim(), aud = String(fd.get('audience') || ''), exp = String(fd.get('expires_on') || '');
    if (!title) return fieldError(f, 'title', 'Please write a title');
    if (noticeAudiences().map(function (a) { return a.value; }).indexOf(aud) < 0) return fieldError(f, 'audience', 'Choose who should see it');
    if (exp && (!isISODate(exp) || exp < todayISO())) return fieldError(f, 'expires_on', 'Pick today or a later date');
    if (navigator.onLine === false) { toast('You are offline. Post the notice when the internet is back.', 'err'); return; }
    return SB.from('notices').insert({ title: title, body: body, audience: aud, pinned: fd.get('pinned') === '1', expires_on: exp || null }).then(function (r) {
      if (r.error) { toast('Could not post: ' + (/row-level|permission/i.test(r.error.message) ? 'not allowed for your account' : r.error.message), 'err'); return; }
      f.reset(); toast('Notice posted 📢');
      return PX.loadNotices(true).then(refreshNoticeList);
    });
  };
  function syncInfoHTML() {
    var s = Store.status();
    return '<p class="muted small">☁️ ' + (s.lastSync ? 'Last synced ' + esc(new Intl.DateTimeFormat('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(s.lastSync))) + ' IST' : 'Not synced yet') +
      (s.pending ? ' · <b>' + s.pending + ' change' + (s.pending === 1 ? '' : 's') + ' waiting to upload</b>' : ' · all changes uploaded') + ' · <button type="button" class="link" data-act="sync-retry">Sync now</button></p>';
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
      var name = String(fd.get('name') || '').trim(), cid = String(fd.get('classId') || ''), email = String(fd.get('email') || '').trim().toLowerCase(), pw = String(fd.get('password') || '');
      if (name.length < 2) return fieldError(f, 'name', 'Enter the teacher’s name');
      if (!CLASS_BY_ID[cid]) return fieldError(f, 'classId', 'Choose a class');
      if (!validEmail(email)) return fieldError(f, 'email', 'Enter a valid email');
      if (S.users.some(function (u) { return (u.email || '').toLowerCase() === email; })) return fieldError(f, 'email', 'A login with this email already exists');
      if (pw.length < 8) return fieldError(f, 'password', 'Use at least 8 characters');
      return fnCall('create_teacher', { name: name, email: email, password: pw, classId: cid }).then(function () {
        toast('Login created for ' + name + ' (' + className(cid) + ')');
        return Store.sync(false);
      }).then(function () { loadAll(); render(); }).catch(function (err) { fieldError(f, 'email', err.message); });
    },
    'my-password': function (f, fd) {
      var pw = String(fd.get('password') || ''), pw2 = String(fd.get('password2') || '');
      if (pw.length < 8) return fieldError(f, 'password', 'Use at least 8 characters');
      if (pw !== pw2) return fieldError(f, 'password2', 'Passwords do not match');
      return SB.auth.updateUser({ password: pw }).then(function (r) {
        if (r.error) return fieldError(f, 'password', authErrorText(r.error));
        f.reset(); toast('Your password was changed 🔐');
      });
    }
  };

  Object.keys(FORMS_EXTRA).forEach(function (k) { FORMS[k] = FORMS_EXTRA[k]; });

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
      rows = [['Receipt no', 'Paid on', 'Student', 'Class', 'Parent', 'Fee for', 'Amount (INR)', 'Mode', 'Reference', 'Received by', 'Note']].concat(
        S.payments.slice().sort(function (a, b) { return (a.seq || 0) - (b.seq || 0); }).map(function (p) { return [p.receiptNo, fmtDate(p.paidOn), p.studentName, className(p.classId), p.parentName, periodText(p), num(p.amount), p.mode, p.ref, p.receivedBy || '', p.note]; }));
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
  function cleanId(v) { v = String(v == null ? '' : v); return v && v.length <= 64 ? v : ''; }
  function mergeData(d) {
    var c = { students: 0, payments: 0, enquiries: 0, staff: 0, days: 0 };
    ['students', 'payments', 'enquiries', 'staff'].forEach(function (t) {
      asArray(d[t]).forEach(function (r) {
        if (!r || typeof r !== 'object' || !cleanId(r.id)) return;
        if (t === 'students' && !CLASS_BY_ID[r.classId]) return;
        var rec = JSON.parse(JSON.stringify(r)); rec.id = String(r.id);
        var idx = -1;
        for (var i = 0; i < S[t].length; i++) if (S[t][i].id === rec.id) { idx = i; break; }
        if (idx >= 0) S[t][idx] = Object.assign({}, S[t][idx], rec); else S[t].push(rec);
        c[t]++;
      });
    });
    var att = asObject(d.attendance);
    Object.keys(att).forEach(function (day) {
      if (!isISODate(day)) return;
      var rec = {};
      Object.keys(asObject(att[day])).forEach(function (sid) { if (ATT[att[day][sid]]) rec[sid] = att[day][sid]; });
      if (!Object.keys(rec).length) return;
      S.attendance[day] = Object.assign({}, S.attendance[day], rec); c.days++;
    });
    if (d.settings && typeof d.settings === 'object') {
      var seq = Math.max(parseInt(S.settings.receiptSeq, 10) || 1, parseInt(d.settings.receiptSeq, 10) || 1);
      var ct = Object.assign({}, S.settings.classTeachers, asObject(d.settings.classTeachers));
      S.settings = Object.assign({}, S.settings, d.settings, { receiptSeq: seq, classTeachers: ct });
    }
    persist('settings', 'students', 'attendance', 'payments', 'enquiries', 'staff');
    return c;
  }
  function confirmMerge(obj, title, intro) {
    var d = obj.data, n = function (x) { return Array.isArray(x) ? x.length : 0; };
    return confirmBox(intro + ' It has ' + n(d.students) + ' students, ' + n(d.payments) + ' payments, ' + Object.keys(asObject(d.attendance)).length + ' attendance days, ' + n(d.enquiries) + ' enquiries and ' + n(d.staff) + ' staff. Records are added to the online database (records with the same ID are updated; nothing is deleted).', { ok: 'Upload to cloud', danger: false, title: title }).then(function (ok) {
      if (!ok) return false;
      var c = mergeData(d);
      UI.drafts = {};
      toast('Uploading ' + c.students + ' students, ' + c.payments + ' payments, ' + c.days + ' attendance days…');
      return Store.flush().then(function () {
        var p = Store.pendingCount();
        toast(p ? 'Saved on this phone; ' + p + ' changes will upload when online.' : 'Uploaded to the cloud ✅');
        render();
        return true;
      });
    });
  }
  function doRestore(input) {
    var file = input.files && input.files[0];
    input.value = '';
    if (!file || !isAdmin()) return;
    if (file.size > 25 * 1024 * 1024) { toast('That file is too large to be a backup', 'err'); return; }
    var reader = new FileReader();
    reader.onload = function () {
      var obj;
      try { obj = JSON.parse(String(reader.result)); Store.validateBackup(obj); }
      catch (e) { toast(e instanceof SyntaxError ? 'This file is not valid JSON' : e.message, 'err'); return; }
      confirmMerge(obj, 'Restore backup?', 'Restore the backup from ' + fmtDate((obj.exportedAt || '').slice(0, 10)) + '?');
    };
    reader.onerror = function () { toast('Could not read the file', 'err'); };
    reader.readAsText(file);
  }
  function importLegacy() {
    if (!isAdmin()) return;
    var obj = Store.legacyData();
    if (!obj) { toast('No old data found on this device', 'err'); return; }
    confirmMerge(obj, 'Import old data?', 'Import the data saved on this device by the old version of the dashboard?').then(function (ok) {
      if (ok) { Store.rawSet('legacyImportedAt', new Date().toISOString()); render(); }
    });
  }
  function doErase() {
    var p = Store.pendingCount();
    confirmBox((p ? p + ' change(s) on this phone have not uploaded yet and will be lost. ' : '') + 'Remove this phone’s offline copy and sign out? Online data is not affected.', { ok: 'Clear & sign out', title: 'Clear this device?' }).then(function (ok) {
      if (ok) logout();
    });
  }

  /* =====================================================================
   * EVENTS
   * ===================================================================== */
  function attr(el, k) { return el.getAttribute('data-' + k); }
  var ACTIONS = {
    'logout': function () {
      var p = Store.pendingCount();
      var msg = anyDirty() ? 'You have unsaved attendance. ' : '';
      if (p) msg += p + ' change(s) have not uploaded yet (no internet?) and will be lost. ';
      var go = msg ? confirmBox(msg + 'Sign out anyway?', { ok: 'Sign out', title: 'Unsaved changes' }) : Promise.resolve(true);
      go.then(function (ok) { if (ok) { UI.drafts = {}; logout(); } });
    },
    'auth-login': function () { showLogin({ skipStatus: true }); },
    'auth-forgot': function () { showForgot(); },
    'auth-setup': function () { showSetup(); },
    'auth-retry': function () { boot(); },
    'install-app': function () { promptInstallApp(); },
    'pw-toggle': function (el, e) {
      if (e) e.preventDefault();
      var inp = el.parentNode.querySelector('input');
      if (!inp) return;
      var show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      el.textContent = show ? '🙈' : '👁️';
      el.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    },
    'pw-generate': function (el) {
      var form = el.closest('form'), inp = form && form.querySelector('[name=password]');
      if (!inp) return;
      var chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789', a = new Uint32Array(10), out = '';
      window.crypto.getRandomValues(a);
      for (var i = 0; i < a.length; i++) out += chars.charAt(a[i] % chars.length);
      inp.value = out; inp.type = 'text';
      var t = form.querySelector('[data-act=pw-toggle]'); if (t) t.textContent = '🙈';
    },
    'sync-retry': function () { Store.sync(false).then(function () { if (location.hash.indexOf('settings') >= 0) render(); }); },
    'import-legacy': function () { importLegacy(); },
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
    'receipt-pdf': function (el) { printReceipt(attr(el, 'id'), true); },
    'receipt-img': function (el) { saveReceiptImage(attr(el, 'id')); },
    'receipt-renum': function (el) { if (isAdmin()) renumberReceipt(attr(el, 'id')); },
    'student-receipts': function (el) { if (isAdmin()) openStudentReceipts(attr(el, 'id')); },
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
    'user-edit': function (el) {
      var u = S.users.filter(function (x) { return x.id === attr(el, 'id'); })[0];
      if (!u) return;
      openModal({
        title: 'Edit login · ' + u.name, body: '<form class="form" novalidate>' + field('Teacher name', '<input name="name" maxlength="60" value="' + esc(u.name) + '" required>') +
          field('Class', '<select name="classId">' + options(classOptions(), u.classId) + '</select>') + '<p class="muted small">Email: ' + esc(u.email) + '</p>' +
          '<div class="form-actions"><button type="button" class="btn ghost" data-act="modal-close">Cancel</button><button class="btn primary">Save</button></div></form>',
        onSubmit: function (form, fd) {
          var name = String(fd.get('name') || '').trim(), cid = String(fd.get('classId') || '');
          if (name.length < 2) { fieldError(form, 'name', 'Enter the teacher’s name'); return false; }
          if (!CLASS_BY_ID[cid]) { fieldError(form, 'classId', 'Choose a class'); return false; }
          return fnCall('update_teacher', { id: u.id, name: name, classId: cid }).then(function () {
            toast('Login updated'); return Store.sync(false);
          }).then(function () { loadAll(); render(); return true; }).catch(function (err) { fieldError(form, 'name', err.message); return false; });
        }
      });
    },
    'user-del': function (el) {
      var u = S.users.filter(function (x) { return x.id === attr(el, 'id'); })[0];
      if (!u) return;
      confirmBox('Remove the login for ' + u.name + ' (' + u.email + ')? They will no longer be able to sign in on any device.', { ok: 'Remove login' }).then(function (ok) {
        if (!ok) return;
        fnCall('delete_teacher', { id: u.id }).then(function () { toast('Login removed'); return Store.sync(false); })
          .then(function () { loadAll(); render(); }).catch(function (err) { toast(err.message, 'err'); });
      });
    },
    'user-reset': function (el) {
      var u = S.users.filter(function (x) { return x.id === attr(el, 'id'); })[0];
      var par = !u && parentById(attr(el, 'id'));
      if (par) u = { id: par.id, name: par.name, email: 'mobile ' + fmtMobile(par.phone) };
      if (!u) return;
      openModal({
        title: 'New password · ' + u.name, body: '<form class="form" novalidate>' + pwInput('password', 'New password (at least 8 characters)', 'new-password', '<small class="hint"><button type="button" class="link" data-act="pw-generate">Suggest one</button></small>') +
          '<p class="muted small">Tell ' + esc(u.name) + ' the new password. ' + (par ? 'Their login ID stays the ' + esc(u.email) + '.' : 'Their email stays ' + esc(u.email) + '.') + '</p><div class="form-actions"><button type="button" class="btn ghost" data-act="modal-close">Cancel</button><button class="btn primary">Set new password</button></div></form>',
        onSubmit: function (form, fd) {
          var pw = String(fd.get('password') || '');
          if (pw.length < 8) { fieldError(form, 'password', 'Use at least 8 characters'); return false; }
          return fnCall('reset_password', { id: u.id, password: pw }).then(function () { toast('New password set for ' + u.name); return true; })
            .catch(function (err) { fieldError(form, 'password', err.message); return false; });
        }
      });
    },
    'parent-add': function (el) { if (!isAdmin()) return; var sid = attr(el, 'student'); PX.loadLinks().then(function () { openParentForm(null, sid); }); },
    'parent-edit': function (el) { var p = parentById(attr(el, 'id')); if (p && isAdmin()) PX.loadLinks().then(function () { openParentForm(p); }); },
    'parent-del': function (el) {
      var p = parentById(attr(el, 'id'));
      if (!p) return;
      confirmBox('Remove the parent login for ' + p.name + ' (' + fmtMobile(p.phone) + ')? They will no longer be able to open the Parents app.', { ok: 'Remove login' }).then(function (ok) {
        if (!ok) return;
        fnCall('delete_parent', { id: p.id }).then(function () { toast('Parent login removed'); return Promise.all([Store.sync(false), PX.loadLinks(true)]); })
          .then(function () { loadAll(); render(); }).catch(function (err) { toast(err.message, 'err'); });
      });
    },
    'notices-refresh': function () { PX.loadNotices(true).then(refreshNoticeList); },
    'notice-pin': function (el) {
      var n = PX.notices().filter(function (x) { return x.id === attr(el, 'id'); })[0];
      if (!n) return;
      SB.from('notices').update({ pinned: !n.pinned }).eq('id', n.id).select('id').then(function (r) {
        if (r.error || !r.data || !r.data.length) { toast('Could not change the notice' + (r.error ? ': ' + r.error.message : ' (not allowed)'), 'err'); return; }
        toast(n.pinned ? 'Unpinned' : 'Pinned to the top 📌');
        return PX.loadNotices(true).then(refreshNoticeList);
      });
    },
    'notice-del': function (el) {
      var n = PX.notices().filter(function (x) { return x.id === attr(el, 'id'); })[0];
      if (!n) return;
      confirmBox('Delete the notice “' + n.title + '”? Parents will no longer see it.', { ok: 'Delete notice' }).then(function (ok) {
        if (!ok) return;
        SB.from('notices').delete().eq('id', n.id).select('id').then(function (r) {
          if (r.error || !r.data || !r.data.length) { toast('Could not delete' + (r.error ? ': ' + r.error.message : ' (not allowed)'), 'err'); return; }
          toast('Notice deleted');
          return PX.loadNotices(true).then(refreshNoticeList);
        });
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
    'restore': function (el) { doRestore(el); },
    'fees-to-parents': function (el) {
      if (!isAdmin()) return;
      S.settings.showFeesToParents = !!el.checked;
      persist('settings');
      toast(el.checked ? 'Parents can now see their child’s fees and receipts' : 'Fees are hidden in the Parents app');
    }
  };
  var INPUTS = {
    'student-search': function (el) { UI.search = el.value; var l = $('#student-list'); if (l) l.innerHTML = studentListHTML(UI.classTab); },
    'enq-search': function (el) { UI.enqSearch = el.value; var l = $('#enq-list'); if (l) l.innerHTML = enqListHTML(); },
    'staff-search': function (el) { UI.staffSearch = el.value; var l = $('#staff-list'); if (l) l.innerHTML = staffListHTML(); },
    'kid-filter': function (el) {
      var q = el.value.trim().toLowerCase(), box = el.parentNode.querySelector('.kid-picker');
      if (box) $$('.kid-opt', box).forEach(function (o) { o.hidden = !!q && o.getAttribute('data-name').indexOf(q) < 0; });
    }
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
  /* ----- cloud sync wiring ----- */
  var pendingRender = false;
  function userIsTyping() {
    var a = document.activeElement;
    return a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && $('#view') && $('#view').contains(a) && a.type !== 'button';
  }
  function refreshFromStore() {
    if (!ME) return;
    var prof = Store.profile();
    applyProfile(prof);
    if (!ME) return;
    Object.keys(UI.drafts).forEach(function (k) { if (!UI.drafts[k].dirty) delete UI.drafts[k]; });
    if (userIsTyping() || $('#confirm-root').innerHTML) { pendingRender = true; return; }
    pendingRender = false;
    showShell();
  }
  document.addEventListener('focusout', function () { setTimeout(function () { if (pendingRender && !userIsTyping() && !$('#confirm-root').innerHTML) refreshFromStore(); }, 50); });
  Store.subscribe(function (name, kind) {
    if (kind !== 'remote' || !ME) return;
    // First sync for a brand-new school: create the settings row from defaults.
    if (isAdmin() && Store.firstSyncDone() && !Store.hasSettingsRow()) {
      loadAll();
      var p = Store.profile() || {};
      if (!S.settings.owner || S.settings.owner === DEFAULT_SETTINGS.owner) S.settings.owner = p.name || S.settings.owner;
      if (!S.settings.feesStartMonth) S.settings.feesStartMonth = thisMonth();
      persist('settings');
    }
    refreshFromStore();
  });
  Store.setNoAccessHandler(function () { if (ME) { toast('Your login no longer has access', 'err'); noAccess(); } });
  function renderBadge(s) {
    var b = $('#sync-badge');
    if (!b) return;
    var state = s.state, txt, cls, title;
    if (state === 'syncing') { txt = 'Syncing…'; cls = 'syncing'; title = 'Saving to the online database'; }
    else if (state === 'offline') { txt = 'Offline' + (s.pending ? ' · ' + s.pending : ''); cls = 'offline'; title = s.pending ? s.pending + ' change(s) saved on this phone, waiting for internet. Tap to retry.' : 'No internet. Tap to retry.'; }
    else if (state === 'error') { txt = 'Sync problem'; cls = 'error'; title = (s.message || 'Could not sync') + ' — tap to retry'; }
    else if (state === 'online') { txt = s.pending ? 'Saving · ' + s.pending : 'Online'; cls = 'online'; title = 'All changes saved online' + (s.realtime === 'SUBSCRIBED' ? ' · live updates on' : ''); }
    else { txt = 'Connecting…'; cls = 'syncing'; title = 'Connecting to the online database'; }
    b.className = 'sync-badge ' + cls;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.innerHTML = '<i></i><span>' + esc(txt) + '</span>' + ((state === 'offline' || state === 'error') ? '<u>Retry</u>' : '');
  }
  Store.onStatus(renderBadge);
  window.addEventListener('online', function () { if (ME) Store.sync(false); });
  window.addEventListener('offline', function () { if (ME) renderBadge(Object.assign({}, Store.status(), { state: 'offline' })); });
  document.addEventListener('visibilitychange', function () { if (ME && document.visibilityState === 'visible') Store.sync(false); });
  if (SB) {
    SB.auth.onAuthStateChange(function (event) {
      if (event === 'PASSWORD_RECOVERY') { RECOVERY = true; setTimeout(function () { loadAll(); showSetNewPassword(); }, 0); }
      else if (event === 'SIGNED_OUT' && ME) { setTimeout(function () { ME = null; Store.reset(); boot(); }, 0); }
    });
  }

  /* ----- Progressive Web App (install + service worker) ----- */
  var deferredInstall = null, swReload = false;
  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  }
  function installHintHTML(compact) {
    if (isStandalone()) {
      return compact ? '' : '<section class="card" id="install-card"><h2>📲 App</h2><p class="muted">This dashboard is installed on this device.</p></section>';
    }
    var btn = '<p id="install-btn-wrap"' + (deferredInstall ? '' : ' hidden') + '><button type="button" class="btn primary" data-act="install-app" id="install-btn">📲 Install app</button></p>';
    var steps = '<ol class="install-steps">' +
      '<li><b>iPhone (Safari):</b> tap Share (the square with the arrow) → <b>Add to Home Screen</b>.</li>' +
      '<li><b>Android (Chrome):</b> tap ⋮ (the menu) → <b>Install app</b> or <b>Add to Home screen</b>.</li>' +
      '</ol>';
    if (compact) {
      return '<div class="install-hint" id="install-card">' + btn +
        '<details><summary>Install this app on your phone</summary>' + steps +
        '<p class="muted small">On a computer, look for the install icon in the address bar, or use the browser menu.</p></details></div>';
    }
    return '<section class="card" id="install-card"><h2>📲 Install app</h2>' +
      '<p class="muted">Add the dashboard to your Home Screen so it opens like an app. The sign-in page still works without internet; school data uses the same offline copy as before, and signing out still removes it from this phone.</p>' +
      btn + steps +
      '<p class="muted small">On a computer (Chrome or Edge), look for the install icon in the address bar.</p></section>';
  }
  function showInstallButton() {
    var w = document.getElementById('install-btn-wrap');
    if (w) w.hidden = !deferredInstall;
  }
  function promptInstallApp() {
    if (!deferredInstall || !deferredInstall.prompt) return;
    var ev = deferredInstall;
    deferredInstall = null;
    ev.prompt();
    ev.userChoice.then(function () { showInstallButton(); }).catch(function () { showInstallButton(); });
  }
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredInstall = e;
    showInstallButton();
  });
  window.addEventListener('appinstalled', function () {
    deferredInstall = null;
    showInstallButton();
    toast('App installed. You can open it from your Home Screen.');
  });
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('./sw.js').then(function (reg) {
      function onWaiting(worker) {
        if (!worker) return;
        if (!navigator.serviceWorker.controller) {
          // First install: activate now so this visit can be used offline.
          worker.postMessage({ type: 'SKIP_WAITING' });
          return;
        }
        var bar = document.getElementById('sw-update');
        if (!bar) return;
        bar.hidden = false;
        bar.onclick = function () {
          swReload = true;
          bar.disabled = true;
          worker.postMessage({ type: 'SKIP_WAITING' });
        };
      }
      if (reg.waiting) onWaiting(reg.waiting);
      reg.addEventListener('updatefound', function () {
        var w = reg.installing;
        if (!w) return;
        w.addEventListener('statechange', function () {
          if (w.state === 'installed' && reg.waiting) onWaiting(reg.waiting);
        });
      });
    }).catch(function () { /* ignore: app still works without a service worker */ });
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (swReload) location.reload();
    });
  }

  registerServiceWorker();
  boot();
})();
