/*!
 * The Little Wings Play School — Admin & Classes Dashboard
 * Plain static app: no build step. Data is stored in the school's private
 * Supabase database (Auth + Postgres with Row Level Security) and an offline
 * copy is kept in this browser's localStorage. See README.md.
 */
(function () {
  'use strict';

  var APP_VERSION = '2.7.1';
  // Part B (language toggle + phone alerts): on since v2.7.0.
  var PART_B = true;
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
  var ENQ_FEEDBACK = ['Interested', 'Doubtful'];
  var ENQ_FB_COLORS = { Interested: '#6cc48a', Doubtful: '#ffc93c' };
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
    classTeachers: {},
    sections: 'A, B, C, D'
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
    // v2.5: holidays (admin writes, teachers read) + admin-only expenses, salaries,
    // staff_attendance and fee_reminders. All "generic" tables are id + data rows.
    // v2.6: vans, student_docs, promotions, feedback (admin only) + "classed"
    // tables that carry a class_id column (teacher: own class; admin: all).
    var GENERIC = ['payments', 'enquiries', 'staff', 'holidays', 'expenses', 'salaries', 'staff_attendance', 'fee_reminders', 'vans', 'student_docs', 'promotions', 'feedback'];
    var CLASSED = ['class_posts', 'timetables', 'exams', 'marks', 'albums'];
    var TABLES = ['settings', 'users', 'students', 'attendance'].concat(GENERIC, CLASSED);
    var DB = ['settings', 'students', 'student_fees', 'attendance'].concat(GENERIC, CLASSED);
    var ADMIN_ONLY = { student_fees: 1, payments: 1, enquiries: 1, staff: 1, expenses: 1, salaries: 1, staff_attendance: 1, fee_reminders: 1, vans: 1, student_docs: 1, promotions: 1, feedback: 1 };
    var ADMIN_WRITE = { settings: 1, student_fees: 1, payments: 1, enquiries: 1, staff: 1, holidays: 1, expenses: 1, salaries: 1, staff_attendance: 1, fee_reminders: 1, vans: 1, student_docs: 1, promotions: 1, feedback: 1, albums: 1 };
    var PK = { settings: 'id', students: 'id', student_fees: 'student_id', attendance: 'day,class_id' };
    var COLS = {
      settings: 'id,data,deleted,updated_at', students: 'id,class_id,data,deleted,updated_at',
      student_fees: 'student_id,monthly_fee,yearly_fee,van_fee,van_from,van_to,fee_hist,deleted,updated_at', attendance: 'day,class_id,data,deleted,updated_at'
    };
    GENERIC.forEach(function (t) { PK[t] = 'id'; COLS[t] = 'id,data,deleted,updated_at'; });
    CLASSED.forEach(function (t) { PK[t] = 'id'; COLS[t] = 'id,class_id,data,deleted,updated_at'; });
    function isGeneric(t) { return GENERIC.indexOf(t) >= 0; }
    function isClassed(t) { return CLASSED.indexOf(t) >= 0; }
    function feeRow(r) {
      var hist = asArray(r.fee_hist).filter(function (h) { return h && isMonth(h.until); }).map(function (h) { return { until: h.until, monthly: Number(h.monthly) || 0, yearly: Number(h.yearly) || 0, classId: CLASS_BY_ID[h.classId] ? h.classId : '' }; });
      return { student_id: String(r.student_id), monthly_fee: Number(r.monthly_fee) || 0, yearly_fee: Number(r.yearly_fee) || 0, van_fee: Number(r.van_fee) || 0,
        van_from: isMonth(r.van_from) ? r.van_from : null, van_to: isMonth(r.van_to) ? r.van_to : null, fee_hist: hist, deleted: !!r.deleted };
    }
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
      if (t === 'student_fees') return feeRow(r);
      if (isClassed(t)) return { id: String(r.id), class_id: r.class_id || null, data: asObject(r.data), deleted: d };
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
          if (isAdminRole()) {
            var f = fees[r.id], ok = f && !f.deleted;
            o.monthlyFee = ok ? f.monthly_fee : 0; o.yearlyFee = ok ? f.yearly_fee : 0; o.vanFee = ok ? f.van_fee || 0 : 0;
            o.vanFrom = ok && f.van_from ? f.van_from : ''; o.vanTo = ok && f.van_to ? f.van_to : ''; o.feeHist = ok ? clone(asArray(f.fee_hist)) : [];
          }
          return o;
        });
      }
      if (name === 'attendance') { var a = {}; live('attendance').forEach(function (r) { a[r.day] = Object.assign(a[r.day] || {}, clone(r.data)); }); return a; }
      if (name === 'users') return st.profiles.filter(function (p) { return p.role === 'teacher'; }).map(function (p) { return { id: p.id, name: p.name || p.email || 'Teacher', classId: p.class_id || '', email: p.email || '' }; });
      if (name === 'parents') return st.profiles.filter(function (p) { return p.role === 'parent'; }).map(function (p) { var e = p.email || ''; return { id: p.id, name: p.name || 'Parent', phone: e.split('@')[1] === PARENT_DOMAIN ? e.split('@')[0] : '', email: e }; });
      if (isGeneric(name)) return live(name).map(function (r) { var o = clone(r.data); o.id = r.id; return o; });
      if (isClassed(name)) return live(name).map(function (r) { var o = clone(r.data); o.id = r.id; o.classId = r.class_id || ''; return o; });
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
          out.students[id] = { id: id, class_id: s.classId, data: strip(s, ['id', 'classId', 'monthlyFee', 'yearlyFee', 'vanFee', 'vanFrom', 'vanTo', 'feeHist']), deleted: false };
          if (out.student_fees) out.student_fees[id] = feeRow({ student_id: id, monthly_fee: num(s.monthlyFee), yearly_fee: num(s.yearlyFee), van_fee: num(s.vanFee), van_from: s.vanFrom, van_to: s.vanTo, fee_hist: s.feeHist });
        });
      } else if (name === 'attendance') {
        out.attendance = {};
        var cls = {}; live('students').forEach(function (r) { cls[r.id] = r.class_id; });
        // v2.6: a day's mark stays in the class row it was saved in (so a
        // year-end promotion never moves or drops old attendance).
        var prev = {}; live('attendance').forEach(function (r) { Object.keys(asObject(r.data)).forEach(function (sid) { prev[r.day + '|' + sid] = r.class_id; }); });
        var val = asObject(value);
        Object.keys(val).forEach(function (day) {
          if (!isISODate(day)) return;
          var rec = asObject(val[day]);
          Object.keys(rec).forEach(function (sid) {
            var c = prev[day + '|' + sid] || cls[sid]; if (!c || !ATT[rec[sid]]) return;
            var k = day + '|' + c;
            (out.attendance[k] = out.attendance[k] || { day: day, class_id: c, data: {}, deleted: false }).data[sid] = rec[sid];
          });
        });
      } else if (isGeneric(name)) {
        out[name] = {};
        asArray(value).forEach(function (r) { if (r && r.id) out[name][String(r.id)] = { id: String(r.id), data: strip(r, ['id']), deleted: false }; });
      } else if (isClassed(name)) {
        out[name] = {};
        asArray(value).forEach(function (r) {
          if (!r || !r.id) return;
          var c = CLASS_BY_ID[r.classId] ? r.classId : null;
          if (!c && name !== 'albums') return;
          out[name][String(r.id)] = { id: String(r.id), class_id: c, data: strip(r, ['id', 'classId']), deleted: false };
        });
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
          if (t === 'student_fees') { tomb.monthly_fee = 0; tomb.yearly_fee = 0; tomb.van_fee = 0; tomb.van_from = null; tomb.van_to = null; tomb.fee_hist = []; }
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
      try { localStorage.setItem(cacheKey(), JSON.stringify({ v: 3, rows: st.rows, profiles: st.profiles, profile: st.profile, queue: st.queue, since: st.since, lastSync: st.lastSync, firstSyncDone: st.firstSyncDone })); }
      catch (e) { if (!cacheWarned) { cacheWarned = true; toast('This device’s offline copy is full. Online saving still works.', 'err'); } }
    }
    function init(userId) {
      stop();
      U = { id: userId, role: null };
      st = emptyState();
      try {
        var c = JSON.parse(localStorage.getItem(cacheKey()) || 'null');
        if (c && (c.v === 2 || c.v === 3)) {
          DB.forEach(function (t) { st.rows[t] = asObject(c.rows && c.rows[t]); });
          st.profiles = asArray(c.profiles); st.profile = c.profile || null; st.queue = asObject(c.queue);
          st.since = asObject(c.since); st.lastSync = c.lastSync || null; st.firstSyncDone = !!c.firstSyncDone;
          // v2 offline copies have no van/fee-history columns: re-read fees in full.
          if (c.v === 2) { st.since.student_fees = null; Object.keys(st.rows.student_fees).forEach(function (k) { st.rows.student_fees[k] = feeRow(st.rows.student_fees[k]); }); }
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
      ['settings', 'students', 'attendance'].concat(GENERIC, CLASSED).forEach(function (t) { if (readable(t)) data[t] = collection(t); });
      return { app: 'littlewings-dashboard', version: 2, appVersion: APP_VERSION, exportedAt: new Date().toISOString(), data: data };
    }
    function validateBackup(obj) {
      if (!obj || typeof obj !== 'object' || obj.app !== 'littlewings-dashboard' || !obj.data || typeof obj.data !== 'object') {
        throw new Error('This file is not a Little Wings dashboard backup.');
      }
      var d = obj.data;
      ['students'].concat(GENERIC, CLASSED).forEach(function (t) {
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
      setNoAccessHandler: function (fn) { onNoAccess = fn; }, TABLES: TABLES, readable: readable
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
    S.holidays = asArray(Store.load('holidays', []));
    S.expenses = asArray(Store.load('expenses', []));
    S.salaries = asArray(Store.load('salaries', []));
    S.staff_attendance = asArray(Store.load('staff_attendance', []));
    S.fee_reminders = asArray(Store.load('fee_reminders', []));
    ['vans', 'student_docs', 'promotions', 'feedback', 'class_posts', 'timetables', 'exams', 'marks', 'albums'].forEach(function (k) { S[k] = asArray(Store.load(k, [])); });
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
  function isInactive(s) { return !s || s.status === 'Left' || s.status === 'Inactive'; }
  function isConverted(e) { return !!(e && (e.status === 'Admitted' || e.studentId)); }
  function primaryName(s) {
    return (s && (s.parentName || s.guardianName || s.motherName || s.fatherName)) || '';
  }
  function primaryPhone(s) {
    return (s && (s.phone || s.guardianPhone || s.motherPhone || s.fatherPhone)) || '';
  }
  function sectionList() {
    var raw = String((S.settings && S.settings.sections) || 'A, B, C, D');
    var seen = {}, out = [];
    raw.split(/[,/|;]+/).forEach(function (x) {
      var t = String(x || '').replace(/\s+/g, ' ').trim();
      if (!t) return;
      var k = t.toUpperCase();
      if (seen[k]) return;
      seen[k] = 1;
      out.push(t.length <= 2 ? t.toUpperCase() : t);
    });
    return out.length ? out : ['A', 'B', 'C', 'D'];
  }
  function classLabel(s) {
    if (!s) return '—';
    return className(s.classId) + (s.section ? ' — Sec ' + s.section : '');
  }
  // Nursery: use the optional monthly fee when set. Otherwise (and for every
  // other class) show yearly/12 when a yearly fee is stored. Fall back to a
  // stored monthly fee so older records keep working. Never rewrite payments.
  function effectiveMonthly(s) {
    if (!s) return 0;
    if (s.classId === 'nursery' && num(s.monthlyFee) > 0) return num(s.monthlyFee);
    if (num(s.yearlyFee) > 0) return Math.round((num(s.yearlyFee) / 12) * 100) / 100;
    return num(s.monthlyFee) || 0;
  }
  function activeStudents(classId) {
    return S.students.filter(function (s) { return !isInactive(s) && (!classId || s.classId === classId); }).sort(byName);
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
  function feeStart(s) { var a = admMonth(s), fs = S.settings.feesStartMonth; return isMonth(fs) && fs > a ? fs : a; }
  function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
  function daysBetween(a, b) { return Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86400000); }
  /* v2.5 fee rules (Settings → Fee rules; both off by default). Mirrored in
   * supabase/batch1.sql (app.fee_net_monthly / app.fee_month_fine) so the
   * Parents app shows the same numbers. Stored payments are never rewritten. */
  function feeRules() {
    var st = S.settings || {};
    var dd = parseInt(st.feeDueDay, 10);
    return {
      sibOn: st.siblingOn === true, sibType: st.siblingType === 'flat' ? 'flat' : 'pct', sibVal: Math.max(0, num(st.siblingValue)),
      lateOn: st.lateFeeOn === true, lateType: st.lateFeeType === 'day' ? 'day' : 'flat', lateAmt: Math.max(0, num(st.lateFeeAmount)), lateMax: Math.max(0, num(st.lateFeeMax)),
      dueDay: dd >= 1 && dd <= 28 ? dd : 10, lateFrom: isMonth(st.lateFeeFrom) ? st.lateFeeFrom : ''
    };
  }
  function phonesOf(s) {
    var out = [];
    [s.phone, s.guardianPhone, s.motherPhone, s.fatherPhone].forEach(function (p) { var d = normPhone(p); if (/^[6-9]\d{9}$/.test(d) && out.indexOf(d) < 0) out.push(d); });
    return out;
  }
  function siblingKey(s) { return (isISODate(s.admissionDate) ? s.admissionDate : '9999-12-31') + '|' + s.id; }
  // 2nd+ child: shares a parent mobile with an active child admitted earlier.
  function olderSibling(s) {
    var ph = phonesOf(s);
    if (!ph.length) return null;
    var k = siblingKey(s);
    for (var i = 0; i < S.students.length; i++) {
      var o = S.students[i];
      if (o.id === s.id || isInactive(o) || !(siblingKey(o) < k)) continue;
      if (phonesOf(o).some(function (p) { return ph.indexOf(p) >= 0; })) return o;
    }
    return null;
  }
  function siblingDiscount(s, base) {
    var r = feeRules();
    if (base == null) base = effectiveMonthly(s);
    if (!s || !r.sibOn || r.sibVal <= 0 || base <= 0 || !olderSibling(s)) return 0;
    var net = r.sibType === 'flat' ? Math.max(0, round2(base - r.sibVal)) : Math.max(0, round2(base - base * Math.min(r.sibVal, 100) / 100));
    return round2(base - net);
  }
  function netMonthly(s) { return s ? round2(effectiveMonthly(s) - siblingDiscount(s)) : 0; }
  /* v2.6 (mirrors supabase/batch2.sql app.fee_base_month / fee_net_month /
   * fee_van_month): after a year-end promotion, feeHist keeps the old fee for
   * the months up to "until", so earlier months are never re-priced. The van
   * fee is a separate line, charged only in months that also have tuition. */
  function histFor(s, ym) {
    var best = null;
    asArray(s && s.feeHist).forEach(function (h) { if (h && isMonth(h.until) && ym <= h.until && (!best || h.until < best.until)) best = h; });
    return best;
  }
  function baseMonth(s, ym) {
    var h = isMonth(ym) ? histFor(s, ym) : null;
    if (!h) return effectiveMonthly(s);
    return effectiveMonthly({ classId: CLASS_BY_ID[h.classId] ? h.classId : s.classId, monthlyFee: h.monthly, yearlyFee: h.yearly });
  }
  function netMonth(s, ym) { if (!s) return 0; var b = baseMonth(s, ym); return b > 0 ? round2(b - siblingDiscount(s, b)) : 0; }
  function vanMonth(s, ym) {
    var v = num(s && s.vanFee);
    if (!(v > 0) || (isMonth(s.vanFrom) && ym < s.vanFrom) || (isMonth(s.vanTo) && ym > s.vanTo)) return 0;
    return round2(v);
  }
  function cmpPaid(a, b) {
    var x = isISODate(a.paidOn) ? a.paidOn : '~', y = isISODate(b.paidOn) ? b.paidOn : '~';
    if (x !== y) return x < y ? -1 : 1;
    return String(a.createdAt || '') < String(b.createdAt || '') ? -1 : String(a.createdAt || '') > String(b.createdAt || '') ? 1 : 0;
  }
  // Late fee for one month: after the due day until the month's fee was fully
  // paid (by payment date), or until today while it is still unpaid.
  function lateFine(s, ym, net) {
    var r = feeRules();
    if (net == null) net = netMonthly(s);
    if (!r.lateOn || r.lateAmt <= 0 || !(net > 0) || !isMonth(ym)) return 0;
    if (r.lateFrom && ym < r.lateFrom) return 0;
    var due = ym + '-' + String(r.dueDay).padStart(2, '0');
    var pays = S.payments.filter(function (p) { return p.studentId === s.id && payTowards(p, ym) > 0; }).sort(cmpPaid);
    var cum = 0, end = null;
    for (var i = 0; i < pays.length; i++) {
      cum += payTowards(pays[i], ym);
      if (cum >= net - 0.005) { end = isISODate(pays[i].paidOn) ? pays[i].paidOn : null; break; }
    }
    end = end || todayISO();
    if (end <= due) return 0;
    var f = r.lateType === 'day' ? r.lateAmt * daysBetween(due, end) : r.lateAmt;
    if (r.lateType === 'day' && r.lateMax > 0) f = Math.min(f, r.lateMax);
    return round2(f);
  }
  function feeApplies(s, ym) { return !isInactive(s) && ym >= feeStart(s) && netMonth(s, ym) > 0; }
  function monthBill(s, ym) { var n = netMonth(s, ym), v = n > 0 ? vanMonth(s, ym) : 0; return round2(n + v); }
  function chargeFor(s, ym) { if (!feeApplies(s, ym)) return 0; var b = monthBill(s, ym); return round2(b + lateFine(s, ym, b)); }
  function fineFor(s, ym) { return feeApplies(s, ym) ? lateFine(s, ym, monthBill(s, ym)) : 0; }
  function dueFor(s, ym) { return feeApplies(s, ym) ? Math.max(0, round2(chargeFor(s, ym) - paidFor(s.id, ym))) : 0; }
  function outstanding(s) {
    var start = feeStart(s);
    var end = thisMonth();
    if (start > end) return 0;
    return monthRange(start, end).reduce(function (a, m) { return a + dueFor(s, m); }, 0);
  }

  // expose for tests
  window.__lw = { inWords: inWords, outstanding: function (id) { var s = studentById(id); return s ? outstanding(s) : null; }, paidFor: paidFor, ageParts: ageParts, suggestClass: suggestClass, normPhone: normPhone, validPhone: validPhone, fmtDate: fmtDate, addMonths: addMonths, Store: Store, version: APP_VERSION, effectiveMonthly: effectiveMonthly, isInactive: isInactive, netMonthly: function (id) { return netMonthly(studentById(id)); }, lateFine: function (id, ym) { var s = studentById(id); return s ? fineFor(s, ym) : null; }, chargeFor: function (id, ym) { var s = studentById(id); return s ? chargeFor(s, ym) : null; }, netMonth: function (id, ym) { var s = studentById(id); return s ? netMonth(s, ym) : null; }, vanMonth: function (id, ym) { var s = studentById(id); return s ? vanMonth(s, ym) : null; }, dueFor: function (id, ym) { var s = studentById(id); return s ? dueFor(s, ym) : null; } };

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
  function initials(name) {
    var p = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!p.length) return '?';
    return ((p[0][0] || '') + (p.length > 1 ? (p[p.length - 1][0] || '') : '')).toUpperCase();
  }
  function photoPathOf(s) {
    var path = s && s.photoPath;
    return path && /^[A-Za-z0-9_-]{1,64}\/photo\.jpg$/.test(path) ? path : '';
  }
  var photoUrlCache = {};
  function studentPhotoURL(path) {
    if (!path || !SB) return Promise.resolve('');
    var c = photoUrlCache[path];
    if (c && c.exp > Date.now() + 30000) return Promise.resolve(c.url);
    return SB.storage.from('student-photos').createSignedUrl(path, 3600).then(function (r) {
      var url = r && r.data && r.data.signedUrl;
      if (!url) return '';
      photoUrlCache[path] = { url: url, exp: Date.now() + 50 * 60 * 1000 };
      return url;
    }).catch(function () { return ''; });
  }
  function avatarHTML(s, size) {
    var path = photoPathOf(s);
    var letter = esc(initials(s && s.name));
    return '<div class="avatar' + (size === 'sm' ? ' sm' : '') + '" style="--c:' + ((s && CLASS_BY_ID[s.classId]) ? CLASS_BY_ID[s.classId].color : '#38a8e0') + '"' +
      (path ? ' data-photo-path="' + esc(path) + '"' : '') + '>' + letter + '</div>';
  }
  function hydratePhotos(root) {
    if (!root) return;
    var els = root.querySelectorAll ? root.querySelectorAll('[data-photo-path]') : [];
    Array.prototype.forEach.call(els, function (el) {
      var path = el.getAttribute('data-photo-path');
      if (!path || el.getAttribute('data-photo-loaded')) return;
      el.setAttribute('data-photo-loaded', '1');
      studentPhotoURL(path).then(function (url) {
        if (!url || !el.parentNode) return;
        var img = document.createElement('img');
        img.alt = '';
        img.src = url;
        el.innerHTML = '';
        el.appendChild(img);
      });
    });
  }
  function compressPhoto(file) {
    return new Promise(function (resolve, reject) {
      if (!file) return resolve(null);
      if (!/^image\//.test(file.type || '')) return reject(new Error('Please choose a photo (JPEG or PNG)'));
      var img = new Image();
      var src = URL.createObjectURL(file);
      img.onload = function () {
        var max = 600, w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
        if (w > max || h > max) {
          if (w >= h) { h = Math.round(h * max / w) || 1; w = max; }
          else { w = Math.round(w * max / h) || 1; h = max; }
        }
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(src);
        canvas.toBlob(function (blob) {
          if (!blob) return reject(new Error('Could not process the photo'));
          resolve(blob);
        }, 'image/jpeg', 0.82);
      };
      img.onerror = function () { URL.revokeObjectURL(src); reject(new Error('Could not read the photo')); };
      img.src = src;
    });
  }
  function uploadStudentPhoto(studentId, blob) {
    if (!SB || !studentId || !blob) return Promise.reject(new Error('Photo could not be saved'));
    var path = studentId + '/photo.jpg';
    return SB.storage.from('student-photos').upload(path, blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '3600' }).then(function (r) {
      if (r.error) throw r.error;
      delete photoUrlCache[path];
      return path;
    });
  }
  function removeStudentPhoto(path) {
    if (!SB || !path) return Promise.resolve();
    return SB.storage.from('student-photos').remove([path]).then(function () { delete photoUrlCache[path]; }).catch(function () {});
  }
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
      '<h1>' + esc((S.settings && S.settings.schoolName) || DEFAULT_SETTINGS.schoolName) + '</h1>' + inner + '</div>' +
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
    var ml = user && user.user_metadata && user.user_metadata.lw_lang;
    if (PART_B && !langSaved() && ml && ml !== LANG && (ml === 'en' || I18N[ml])) { LANG = ml; try { localStorage.setItem('lw-lang', ml); } catch (e) { /* ignore */ } }
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
    enqFilter: 'All', enqSearch: '', staffSearch: '', lastRoute: '',
    pendClass: '', repTab: 'fees', repMonth: null, expMonth: null, staffTab: 'list', salMonth: null, sattDate: null, sattDraft: null, attForce: {}
  };
  var ROUTES = {
    dashboard: { title: 'Dashboard', tTitle: 'My Class', icon: '🏠', roles: ['admin', 'teacher'], render: viewDashboard },
    classes: { title: 'Classes', tTitle: 'Students', icon: '🧒', roles: ['admin', 'teacher'], render: viewClasses },
    attendance: { title: 'Attendance', icon: '✅', roles: ['admin', 'teacher'], render: viewAttendance },
    notices: { title: 'Notices', icon: '📢', roles: ['admin', 'teacher'], render: viewNotices },
    fees: { title: 'Fees', icon: '💰', roles: ['admin'], render: viewFees },
    enquiries: { title: 'Enquiries', icon: '📝', roles: ['admin'], render: viewEnquiries },
    pending: { title: 'Pending fees', icon: '⏳', roles: ['admin'], render: viewPending },
    reports: { title: 'Reports', icon: '📊', roles: ['admin'], render: viewReports },
    expenses: { title: 'Expenses', icon: '🧾', roles: ['admin'], render: viewExpenses },
    staff: { title: 'Staff', icon: '👩‍🏫', roles: ['admin'], render: viewStaff },
    holidays: { title: 'Holidays', icon: '🎉', roles: ['admin', 'teacher'], render: viewHolidays },
    backup: { title: 'Backup', icon: '💾', roles: ['admin'], render: viewBackup },
    settings: { title: 'Settings', tTitle: 'Account', icon: '⚙️', roles: ['admin', 'teacher'], render: viewSettings },
    more: { title: 'More', icon: '☰', roles: ['admin'], render: viewMore }
  };
  var ROUTE_ORDER = ['dashboard', 'classes', 'attendance', 'notices', 'fees', 'pending', 'enquiries', 'reports', 'expenses', 'staff', 'holidays', 'backup', 'settings'];
  // Phone bottom bar: admin gets 5 main pages + "More"; teachers see all of theirs.
  var BOTTOM_ADMIN = ['dashboard', 'classes', 'attendance', 'fees', 'enquiries', 'more'];
  function routeTitle(key) { var r = ROUTES[key]; return t((ME && ME.role === 'teacher' && r.tTitle) ? r.tTitle : r.title); }
  function bottomList() { return isAdmin() ? BOTTOM_ADMIN : BOTTOM_TEACHER; }
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
    var link = function (k) { return '<a href="#/' + k + '" data-route="' + k + '"><span class="ni">' + ROUTES[k].icon + '</span><span class="nl">' + esc(routeTitle(k)) + navBadge(k) + '</span></a>'; };
    var mine = ROUTE_ORDER.filter(function (k) { return ROUTES[k].roles.indexOf(ME.role) >= 0; });
    $('#sidenav').innerHTML = (typeof sideNavHTML === 'function') ? sideNavHTML(mine, link) : mine.map(link).join('');
    $('#bottomnav').innerHTML = bottomList().filter(function (k) { return ROUTES[k].roles.indexOf(ME.role) >= 0; }).map(link).join('');
    applyLangAttr();
    var so = $('[data-act=logout] .hide-xs'); if (so) so.textContent = t('Sign out');
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
    if (bottomList().indexOf(key) < 0) { var mb = $('#bottomnav [data-route="more"]'); if (mb) mb.classList.add('active'); }
    var sa = $('#sidenav a[data-route="' + key + '"]'), sec = sa && sa.closest('.nav-sec');
    if (sec && sec.classList.contains('closed')) { sec.classList.remove('closed'); var gh = $('.nav-gh', sec); if (gh) gh.setAttribute('aria-expanded', 'true'); }
    if (sa && sa.scrollIntoView && UI.lastRoute !== key + '/' + p.arg) { var sn = $('#sidenav'); if (sn && sn.scrollHeight > sn.clientHeight) { var r1 = sa.getBoundingClientRect(), r2 = sn.getBoundingClientRect(); if (r1.top < r2.top || r1.bottom > r2.bottom) sa.scrollIntoView({ block: 'nearest' }); } }
    $('#page-title').textContent = routeTitle(key);
    document.title = routeTitle(key) + ' · The Little Wings';
    var view = $('#view');
    try {
      view.innerHTML = ROUTES[key].render(p.arg);
    } catch (e) {
      console.error(e);
      view.innerHTML = emptyState('😕', 'Something went wrong', 'Please reload the page. If it keeps happening, take a backup from Settings. (' + e.message + ')');
    }
    hydratePhotos(view);
    hydrateMedia(view);
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

    var webNew = S.enquiries.filter(function (e) { return e.web && !e.seen; }).length;
    var offToday = offDay(today);
    var html = greeting + backupBannerHTML() + (webNew ? '<a class="callout web-new" href="#/enquiries"><b>🌐 ' + webNew + ' new enquir' + (webNew === 1 ? 'y' : 'ies') + ' from the website</b><p>Tap to see and call back.</p></a>' : '') + '<div class="stats">' +
      stat('🧒', 'Students', String(studs.length), CLASSES.map(function (c, i) { return c.name + ' ' + per[i].n; }).join(' · '), 'sky', '#/classes') +
      (offToday && !tot.m ? stat('🎉', 'Today', 'Holiday', offToday, 'green', '#/holidays') : stat('✅', 'Attendance today', pctText(overallPct), tot.m + ' of ' + studs.length + ' marked', 'green', '#/attendance')) +
      stat('💰', 'Collected this month', inr(collectedMonth), 'Payments received in ' + fmtMonth(ym), 'yellow', '#/fees') +
      stat('⏳', 'Total pending', inr(outstandingTotal), outstandingList.length + ' student' + (outstandingList.length === 1 ? '' : 's') + ' with dues · tap to remind', 'coral', '#/pending') +
      stat('📝', 'Enquiries this month', String(enqMonth.length), enqConv + ' converted to admission' + (webNew ? ' · ' + webNew + ' new from website' : ''), 'purple', '#/enquiries') +
      '</div>';

    html += '<section class="class-cards">' + per.map(function (x) {
      return '<a class="class-card" href="#/classes/' + x.c.id + '" style="--c:' + x.c.color + '"><span class="cc-emoji">' + x.c.emoji + '</span><span class="cc-name">' + esc(x.c.name) + '<small>' + esc(x.c.ages) + '</small></span>' +
        '<span class="cc-count"><b>' + x.n + '</b> students</span><span class="cc-att">Today: <b>' + pctText(x.att.pct) + '</b>' + (x.att.marked ? ' <small>(' + x.att.P + 'P ' + x.att.A + 'A ' + x.att.L + 'L ' + x.att.H + 'H)</small>' : '') + '</span>' +
        '<span class="cc-teacher">👩‍🏫 ' + (x.teacher ? esc(x.teacher) : '<i>No class teacher</i>') + '</span></a>';
    }).join('') + '</section>';

    var enqParts = ENQ_STATUS.map(function (s) { return { label: s, value: S.enquiries.filter(function (e) { return e.status === s; }).length, color: ENQ_COLORS[s] }; });
    var feeParts = [{ label: 'Collected (' + fmtMonth(ym) + ' fees)', value: studs.reduce(function (a, s) { return a + (feeApplies(s, ym) ? Math.min(chargeFor(s, ym), paidFor(s.id, ym)) : 0); }, 0), color: '#6cc48a' },
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
    html += birthdayCardHTML();
    var soon = S.holidays.filter(function (h) { return isISODate(h.from) && holTo(h) >= today; }).sort(function (a, b) { return a.from < b.from ? -1 : 1; }).slice(0, 4);
    html += '<section class="card"><h3>🗓️ Holidays &amp; events</h3>' + (soon.length ? '<ul class="mini-list">' + soon.map(function (h) {
      return '<li><span><b>' + esc(h.title || 'Holiday') + '</b><small>' + esc(holRange(h)) + ' · ' + (h.type === 'Event' ? 'Event' : 'Holiday') + '</small></span></li>';
    }).join('') + '</ul>' : '<p class="muted">No upcoming holidays added.</p>') + '<a class="more" href="#/holidays">Holiday calendar →</a></section>';
    var recent = S.payments.slice().sort(function (a, b) { return (b.createdAt || '') < (a.createdAt || '') ? -1 : 1; }).slice(0, 5);
    html += '<section class="card"><h3>🧾 Recent payments</h3>' + (recent.length ? '<ul class="mini-list">' + recent.map(function (p) {
      return '<li><span><b>' + esc(p.studentName) + '</b> · ' + esc(periodText(p)) + '<small>' + esc(p.receiptNo) + ' · ' + fmtDate(p.paidOn) + ' · ' + esc(p.mode) + '</small></span><b>' + inr(p.amount) + '</b></li>';
    }).join('') + '</ul>' : '<p class="muted">No payments recorded yet.</p>') + '</section>';
    html += '<section class="card"><h3>⏳ Top pending fees</h3>' + (outstandingList.length ? '<ul class="mini-list">' + outstandingList.sort(function (a, b) { return b.due - a.due; }).slice(0, 6).map(function (x) {
      return '<li><span><b>' + esc(x.s.name) + '</b> · ' + esc(className(x.s.classId)) + '<small>' + esc(primaryName(x.s) || '') + '</small></span><b class="coral-t">' + inr(x.due) + '</b></li>';
    }).join('') + '</ul><a class="more" href="#/pending">Pending fees &amp; reminders →</a>' : '<p class="muted">No pending fees. 🎉</p>') + '</section>';
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
    if (offDay(today)) html += '<p class="note">🎉 Today is a holiday: <b>' + esc(offDay(today)) + '</b>. No attendance needed.</p>';
    html += '<div class="row gap wrap"><a class="btn primary big" href="#/attendance">✅ ' + (st.marked ? 'Update' : 'Mark') + ' today’s attendance</a><a class="btn ghost big" href="#/classes">🧒 View students</a></div>';
    html += '<section class="card"><h3>Absent / on leave today</h3>' + (!st.marked ? '<p class="muted">Attendance not marked yet for today.</p>' : away.length ? '<ul class="mini-list">' + away.map(function (s) {
      return '<li><span><b>' + esc(s.name) + '</b> ' + badge(ATT[rec[s.id]].label, rec[s.id] === 'A' ? '#ff7a6b' : '#ffc93c') + '<small>' + esc(primaryName(s) || '') + '</small></span>' + phoneLinks(primaryPhone(s), s.whatsapp) + '</li>';
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
    html += '<div class="toolbar"><input type="search" class="search" placeholder="🔍 Search name, parent, phone or section" value="' + esc(UI.search) + '" data-input="student-search" aria-label="Search students">' +
      '<select data-change="student-status" aria-label="Filter by status">' + options([{ value: 'Active', label: 'Active students' }, { value: 'Inactive', label: 'Inactive' }, { value: 'All', label: 'All' }], UI.classStatus) + '</select></div>';
    html += '<div id="student-list">' + studentListHTML(cid) + '</div>';
    return html;
  }
  function studentListHTML(cid) {
    var q = UI.search.trim().toLowerCase();
    var all = S.students.filter(function (s) { return s.classId === cid; });
    var list = all.filter(function (s) {
      if (UI.classStatus === 'Active' && isInactive(s)) return false;
      if (UI.classStatus === 'Inactive' && !isInactive(s)) return false;
      if (!q) return true;
      return [s.name, primaryName(s), s.motherName, s.fatherName, s.guardianName, primaryPhone(s), s.motherPhone, s.fatherPhone, s.guardianPhone, s.whatsapp, s.address, s.section].join(' ').toLowerCase().indexOf(q) >= 0;
    }).sort(byName);
    if (!all.length) return emptyState(CLASS_BY_ID[cid].emoji, 'No students in ' + className(cid) + ' yet', 'Add the first child to this class — it only takes a minute.', '<button class="btn primary" data-act="student-add" data-class="' + cid + '">➕ Add student</button>');
    if (!list.length) return emptyState('🔍', 'No matches', 'No students match your search or filter.');
    var admin = isAdmin();
    return '<div class="table-wrap"><table class="table responsive"><thead><tr><th>Name</th><th>Age</th><th>Parent / Guardian</th><th>Phone</th>' + (admin ? '<th class="num">Fee / month</th>' : '') + '<th class="act-col"><span class="sr">Actions</span></th></tr></thead><tbody>' +
      list.map(function (s) {
        var stTag = s.status === 'Left' ? ' <span class="tag">Left</span>' : (s.status === 'Inactive' ? ' <span class="tag inactive">Inactive</span>' : '');
        return '<tr' + (isInactive(s) ? ' class="left"' : '') + '><td data-label="Name"><div class="stu-name">' + avatarHTML(s, 'sm') + '<span class="who"><button type="button" class="link strong" data-act="student-view" data-id="' + esc(s.id) + '">' + esc(s.name) + '</button>' +
          (s.section ? ' <span class="muted">Sec ' + esc(s.section) + '</span>' : '') +
          (s.medical ? ' <span title="Has medical notes" class="tag med">⚕️ Medical</span>' : '') + stTag + '</span></div></td>' +
          '<td data-label="Age">' + esc(ageText(s.dob)) + '</td>' +
          '<td data-label="Parent">' + esc(primaryName(s) || '—') + '</td>' +
          '<td data-label="Phone">' + phoneLinks(primaryPhone(s), s.whatsapp) + '</td>' +
          (admin ? '<td data-label="Fee" class="num">' + (effectiveMonthly(s) ? inr(effectiveMonthly(s)) : '<span class="muted">—</span>') + '</td>' : '') +
          '<td class="actions"><button type="button" class="icon-btn" data-act="student-edit" data-id="' + esc(s.id) + '" title="Edit" aria-label="Edit ' + esc(s.name) + '">✏️</button>' +
          (admin ? '<button type="button" class="icon-btn" data-act="student-del" data-id="' + esc(s.id) + '" title="Delete" aria-label="Delete ' + esc(s.name) + '">🗑️</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function studentFormHTML(s, pre) {
    var v = Object.assign({ status: 'Active', admissionDate: todayISO() }, pre || {}, s || {});
    var teacher = !isAdmin();
    var classCtl = teacher ? '<input type="hidden" name="classId" value="' + esc(ME.classId) + '"><input disabled value="' + esc(className(ME.classId)) + '">'
      : '<select name="classId" required>' + options(classOptions(), v.classId, 'Select class') + '</select>';
    var statusOpts = ['Active', 'Inactive'];
    if (v.status === 'Left') statusOpts = ['Active', 'Inactive', 'Left'];
    var secs = sectionList();
    if (v.section && secs.indexOf(v.section) < 0) secs = [v.section].concat(secs);
    var showMonthly = teacher ? false : (v.classId === 'nursery' || (!v.classId && false) || (s && num(s.monthlyFee) > 0 && v.classId !== 'nursery'));
    // Keep a legacy monthly field visible when a non-nursery student already has one.
    if (!teacher && s && num(s.monthlyFee) > 0 && v.classId !== 'nursery') showMonthly = true;
    var photo = '<div class="photo-pick"><div class="avatar" id="photo-preview" style="--c:' + ((CLASS_BY_ID[v.classId] && CLASS_BY_ID[v.classId].color) || '#38a8e0') + '"' + (photoPathOf(v) ? ' data-photo-path="' + esc(photoPathOf(v)) + '"' : '') + '>' + esc(initials(v.name)) + '</div>' +
      (teacher ? '<p class="muted small">The admin can add a photo.</p>' : '<div class="photo-acts"><label class="btn ghost small file-btn">📷 Take or choose photo<input type="file" name="photoFile" accept="image/*" hidden></label>' +
        '<button type="button" class="btn small ghost" data-act="photo-clear"' + (photoPathOf(v) || v.photoPath ? '' : ' hidden') + '>Remove</button>' +
        '<input type="hidden" name="photoPath" value="' + esc(v.photoPath || '') + '"><input type="hidden" name="photoRemoved" value="0">' +
        '<small class="hint">Photos are resized on this phone (about 600 px) and stored privately.</small></div>');
    photo += '</div>';
    return '<form class="form" novalidate id="student-form">' +
      '<div class="grid2">' +
      '<div class="form-sec"><h3>Child</h3></div>' +
      field('Child’s full name *', '<input name="name" maxlength="80" autocomplete="off" value="' + esc(v.name) + '" required>') +
      field('Date of birth *', '<input type="date" name="dob" max="' + todayISO() + '" value="' + esc(v.dob) + '" required>', '<small class="hint" id="age-hint"></small>') +
      field('Class *', classCtl) +
      field('Section', '<select name="section">' + options(secs.map(function (x) { return { value: x, label: 'Section ' + x }; }), v.section, 'Select section') + '</select>', '<small class="hint">Assigned after the class is chosen. Sections can be edited in Settings.</small>', 'span2') +
      field('Admission date *', '<input type="date" name="admissionDate" value="' + esc(v.admissionDate) + '" required>') +
      field('Status', '<select name="status">' + options(statusOpts, v.status === 'Left' ? 'Left' : (v.status === 'Inactive' ? 'Inactive' : 'Active')) + '</select>') +
      (teacher ? '' : '<div class="form-sec span2"><h3>Photo</h3>' + photo + '</div>') +
      (teacher ? '' : '') +
      '<div class="form-sec"><h3>Family</h3></div>' +
      field('Mother’s name', '<input name="motherName" maxlength="80" value="' + esc(v.motherName) + '">') +
      field('Mother’s mobile', '<input type="tel" name="motherPhone" inputmode="tel" maxlength="16" placeholder="10-digit mobile" value="' + esc(v.motherPhone) + '">') +
      field('Father’s name', '<input name="fatherName" maxlength="80" value="' + esc(v.fatherName) + '">') +
      field('Father’s mobile', '<input type="tel" name="fatherPhone" inputmode="tel" maxlength="16" placeholder="10-digit mobile" value="' + esc(v.fatherPhone) + '">') +
      field('Guardian’s name', '<input name="guardianName" maxlength="80" value="' + esc(v.guardianName || (!v.motherName && !v.fatherName ? v.parentName : '')) + '">') +
      field('Guardian’s mobile', '<input type="tel" name="guardianPhone" inputmode="tel" maxlength="16" placeholder="10-digit mobile" value="' + esc(v.guardianPhone || (!v.motherPhone && !v.fatherPhone ? v.phone : '')) + '">') +
      field('WhatsApp number', '<input type="tel" name="whatsapp" inputmode="tel" maxlength="16" placeholder="Blank = same as primary phone" value="' + esc(v.whatsapp) + '">') +
      field('Student address', '<textarea name="address" rows="2" maxlength="250" placeholder="House / street, area, town">' + esc(v.address) + '</textarea>', '', 'span2') +
      (teacher ? '' : '<div class="form-sec"><h3>Fees</h3></div>') +
      (teacher ? '' : field('Yearly fee (₹)', '<input type="number" name="yearlyFee" min="0" max="10000000" step="1" inputmode="numeric" placeholder="e.g. 18000" value="' + esc(v.yearlyFee == null || v.yearlyFee === 0 ? (v.yearlyFee === 0 ? '0' : '') : v.yearlyFee) + '">', '<small class="hint">For all classes. Receipts and pending dues use this (÷ 12) unless a nursery monthly fee is set.</small>')) +
      (teacher ? '' : field('Monthly fee (₹) — Nursery only, optional', '<input type="number" name="monthlyFee" min="0" max="1000000" step="1" inputmode="numeric" placeholder="Leave blank to use yearly ÷ 12" value="' + esc(v.monthlyFee == null || v.monthlyFee === 0 ? '' : v.monthlyFee) + '">', '<small class="hint fee-hint" id="monthly-hint"></small>', '') ) +
      field('Emergency contact', '<input name="emergency" maxlength="120" placeholder="Name & phone" value="' + esc(v.emergency) + '">') +
      field('Authorised pickup', '<input name="pickup" maxlength="160" placeholder="Who may collect the child" value="' + esc(v.pickup) + '">') +
      '</div>' +
      field('Medical notes / allergies', '<textarea name="medical" rows="2" maxlength="600">' + esc(v.medical) + '</textarea>') +
      field('Notes', '<textarea name="notes" rows="2" maxlength="1500">' + esc(v.notes) + '</textarea>') +
      '<div class="form-actions"><button type="button" class="btn ghost" data-act="modal-close">Cancel</button><button class="btn primary">' + (s ? 'Save changes' : 'Add student') + '</button></div></form>';
  }
  function bindPhotoPicker(root, s) {
    var form = $('form', root) || root;
    var file = $('[name=photoFile]', root), preview = $('#photo-preview', root), clearBtn = $('[data-act=photo-clear]', root);
    var pathInp = $('[name=photoPath]', root), remInp = $('[name=photoRemoved]', root);
    if (!file || !preview) return;
    form._photoBlob = null;
    function setPreview(src, letter) {
      if (src) { preview.innerHTML = ''; var img = document.createElement('img'); img.alt = ''; img.src = src; preview.appendChild(img); }
      else preview.textContent = letter || initials(($('[name=name]', root) || {}).value || (s && s.name) || '');
    }
    hydratePhotos(preview.parentNode);
    file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      if (!f) return;
      compressPhoto(f).then(function (blob) {
        form._photoBlob = blob;
        if (pathInp) pathInp.value = pathInp.value; // keep old until save
        if (remInp) remInp.value = '0';
        if (clearBtn) clearBtn.hidden = false;
        setPreview(URL.createObjectURL(blob));
      }).catch(function (err) { toast((err && err.message) || 'Could not read the photo', 'err'); file.value = ''; });
    });
    if (clearBtn) clearBtn.addEventListener('click', function () {
      form._photoBlob = null;
      if (file) file.value = '';
      if (pathInp) pathInp.value = '';
      if (remInp) remInp.value = '1';
      preview.removeAttribute('data-photo-path');
      setPreview('');
      clearBtn.hidden = true;
    });
    var nameInp = $('[name=name]', root);
    if (nameInp) nameInp.addEventListener('input', function () {
      if (!preview.querySelector('img')) preview.textContent = initials(nameInp.value);
    });
  }
  function syncFeeAndSectionFields(root, touchedSection) {
    var cls = ($('select[name=classId]', root) || $('[name=classId]', root) || {}).value;
    var monWrap = $('[name=monthlyFee]', root) && $('[name=monthlyFee]', root).closest('.field');
    var hint = $('#monthly-hint', root);
    var isNur = cls === 'nursery';
    var hasLegacy = monWrap && $('[name=monthlyFee]', root).value;
    if (monWrap) {
      // Show monthly for Nursery, or when a legacy monthly value is already stored.
      var show = isNur || (!!hasLegacy && cls !== 'nursery' && !root._hideLegacyMonthly);
      if (!isNur && root._forceHideMonthly) show = false;
      monWrap.hidden = !isNur && !(+$('[name=monthlyFee]', root).value > 0);
      if (isNur) monWrap.hidden = false;
    }
    if (hint) hint.textContent = isNur ? 'Optional for Nursery. If left blank, pending dues use yearly fee ÷ 12.' : (monWrap && !monWrap.hidden ? 'This child already has a monthly fee from earlier. Yearly fee ÷ 12 is used for dues once a yearly fee is entered. You can clear the monthly amount if you want.' : 'For this class, pending dues use yearly fee ÷ 12.');
  }
  function openStudentForm(s, pre, onSaved) {
    openModal({
      title: s ? 'Edit student' : 'Add student / admission', size: 'wide', body: studentFormHTML(s, pre),
      mount: function (root) {
        var dob = $('[name=dob]', root), sel = $('select[name=classId]', root), hint = $('#age-hint', root);
        var touched = !!(s || (pre && pre.classId));
        if (sel) sel.addEventListener('change', function () { touched = true; syncFeeAndSectionFields(root); });
        function upd() {
          var a = ageParts(dob.value);
          if (!a) { hint.textContent = ''; return; }
          var sug = suggestClass(a.years);
          hint.textContent = 'Age today: ' + a.y + ' y ' + a.m + ' m · suggested: ' + className(sug);
          if (sel && !touched && sug) { sel.value = sug; syncFeeAndSectionFields(root); }
        }
        if (dob) { dob.addEventListener('input', upd); dob.addEventListener('change', upd); upd(); }
        syncFeeAndSectionFields(root);
        bindPhotoPicker(root, s);
      },
      onSubmit: function (form, fd) {
        var g = function (k) { return String(fd.get(k) == null ? '' : fd.get(k)).trim(); };
        var ok = true, today = todayISO();
        var statusVal = g('status');
        if (statusVal !== 'Inactive' && statusVal !== 'Left') statusVal = 'Active';
        var d = { name: g('name').replace(/\s+/g, ' '), dob: g('dob'), classId: g('classId'), admissionDate: g('admissionDate'),
          motherName: g('motherName'), motherPhone: g('motherPhone'), fatherName: g('fatherName'), fatherPhone: g('fatherPhone'),
          guardianName: g('guardianName'), guardianPhone: g('guardianPhone'), whatsapp: g('whatsapp'), address: g('address'),
          section: g('section'), emergency: g('emergency'), pickup: g('pickup'), status: statusVal, medical: g('medical'), notes: g('notes') };
        if (d.name.length < 2) { fieldError(form, 'name', 'Please enter the child’s name'); ok = false; }
        if (!isISODate(d.dob)) { fieldError(form, 'dob', 'Please choose the date of birth'); ok = false; }
        else if (d.dob > today) { fieldError(form, 'dob', 'Date of birth can’t be in the future'); ok = false; }
        else if ((ageParts(d.dob) || { years: 0 }).years > 10) { fieldError(form, 'dob', 'Child would be over 10 years old — please check'); ok = false; }
        if (!CLASS_BY_ID[d.classId]) { fieldError(form, 'classId', 'Please choose a class'); ok = false; }
        if (!isISODate(d.admissionDate)) { fieldError(form, 'admissionDate', 'Please choose the admission date'); ok = false; }
        else if (isISODate(d.dob) && d.admissionDate < d.dob) { fieldError(form, 'admissionDate', 'Admission date is before date of birth'); ok = false; }
        function checkPhone(key, label) {
          if (g(key) && !validPhone(g(key))) { fieldError(form, key, 'Enter a valid 10-digit Indian mobile number or leave blank'); return false; }
          return true;
        }
        if (!checkPhone('motherPhone') || !checkPhone('fatherPhone') || !checkPhone('guardianPhone')) ok = false;
        if (d.whatsapp && !validPhone(d.whatsapp)) { fieldError(form, 'whatsapp', 'Enter a valid 10-digit number or leave blank'); ok = false; }
        // At least one parent/guardian name and one mobile (legacy parentName/phone still count).
        var names = [d.motherName, d.fatherName, d.guardianName, s && !d.motherName && !d.fatherName && !d.guardianName ? s.parentName : ''].filter(function (x) { return x && x.length >= 2; });
        var phones = [d.motherPhone, d.fatherPhone, d.guardianPhone].filter(function (x) { return validPhone(x); });
        if (!names.length && s && (s.parentName || '').length >= 2) names = [s.parentName];
        if (!phones.length && s && validPhone(s.phone)) phones = [s.phone];
        if (!names.length) { fieldError(form, 'motherName', 'Enter the mother’s, father’s or guardian’s name'); ok = false; }
        if (!phones.length) { fieldError(form, 'motherPhone', 'Enter at least one parent or guardian mobile number'); ok = false; }
        d.parentName = d.guardianName || d.motherName || d.fatherName || (s && s.parentName) || '';
        d.phone = d.guardianPhone || d.motherPhone || d.fatherPhone || (s && s.phone) || '';
        if (isAdmin()) {
          var yf = g('yearlyFee'), mfField = form.querySelector('[name=monthlyFee]'), mf = mfField ? g('monthlyFee') : '';
          if (yf !== '' && (!isFinite(+yf) || +yf < 0)) { fieldError(form, 'yearlyFee', 'Yearly fee must be 0 or more'); ok = false; }
          d.yearlyFee = yf === '' ? 0 : Math.round(+yf * 100) / 100;
          if (mfField && !mfField.closest('.field').hidden) {
            if (mf !== '' && (!isFinite(+mf) || +mf < 0)) { fieldError(form, 'monthlyFee', 'Fee must be 0 or more'); ok = false; }
            d.monthlyFee = mf === '' ? 0 : Math.round(+mf * 100) / 100;
          } else {
            d.monthlyFee = s ? num(s.monthlyFee) : 0;
          }
        }
        if (sectionList().indexOf(d.section) < 0 && !(s && s.section === d.section && d.section)) d.section = d.section || '';
        if (!ok) return false;
        var blob = form._photoBlob;
        var removePhoto = g('photoRemoved') === '1';
        var keepPath = g('photoPath') || (s && s.photoPath) || '';
        var dup = S.students.filter(function (x) { return x !== s && x.name.toLowerCase() === d.name.toLowerCase() && x.dob === d.dob; })[0];
        return (dup ? confirmBox('A student named “' + d.name + '” with the same date of birth already exists. Add anyway?', { ok: 'Yes, save', danger: false, title: 'Possible duplicate' }) : Promise.resolve(true)).then(function (go) {
          if (!go) return false;
          var rec;
          if (s) { rec = s; Object.assign(s, d, { updatedAt: new Date().toISOString() }); }
          else { rec = Object.assign({ id: uid(), monthlyFee: 0, yearlyFee: 0, createdAt: new Date().toISOString() }, d); S.students.push(rec); }
          function finish() {
            persist('students');
            toast(s ? 'Student updated' : d.name + ' added to ' + className(d.classId) + ' 🎉');
            if (!s) UI.classTab = d.classId;
            if (onSaved) onSaved(rec);
            render();
            return true;
          }
          if (isAdmin() && blob) {
            if (!navigator.onLine) { toast('Student saved. Add the photo when you are back online.', 'err'); rec.photoPath = rec.photoPath || ''; return finish(); }
            var btn = form.querySelector('button.primary'); if (btn) { btn.disabled = true; btn.textContent = 'Saving photo…'; }
            return uploadStudentPhoto(rec.id, blob).then(function (path) {
              rec.photoPath = path; rec.updatedAt = new Date().toISOString();
              return finish();
            }).catch(function (err) {
              if (btn) { btn.disabled = false; btn.textContent = s ? 'Save changes' : 'Add student'; }
              toast('Student saved, but the photo could not be uploaded: ' + ((err && err.message) || err), 'err');
              return finish();
            });
          }
          if (isAdmin() && removePhoto && keepPath) {
            rec.photoPath = '';
            removeStudentPhoto(keepPath);
          } else if (keepPath && !removePhoto && !blob) {
            rec.photoPath = keepPath;
          }
          return finish();
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
    var stTag = s.status === 'Left' ? ' · <span class="tag">Left</span>' : (s.status === 'Inactive' ? ' · <span class="tag inactive">Inactive</span>' : '');
    var body = '<div class="profile" style="--c:' + CLASS_BY_ID[s.classId].color + '">' + avatarHTML(s) + '<div><h3>' + esc(s.name) + '</h3><p>' + esc(classLabel(s)) + ' · ' + esc(ageText(s.dob)) + stTag + '</p></div></div>' +
      '<div class="kvs">' + row('Date of birth', fmtDate(s.dob)) + row('Admission date', fmtDate(s.admissionDate)) +
      (s.motherName || s.motherPhone ? row('Mother', esc(s.motherName || '—') + (s.motherPhone ? ' · ' : '')) + (s.motherPhone ? row('Mother’s mobile', phoneLinks(s.motherPhone)) : '') : '') +
      (s.fatherName || s.fatherPhone ? row('Father', esc(s.fatherName || '—') + (s.fatherPhone ? ' · ' : '')) + (s.fatherPhone ? row('Father’s mobile', phoneLinks(s.fatherPhone)) : '') : '') +
      (s.guardianName || s.guardianPhone ? row('Guardian', esc(s.guardianName || '—')) + (s.guardianPhone ? row('Guardian’s mobile', phoneLinks(s.guardianPhone)) : '') : '') +
      (!(s.motherName || s.fatherName || s.guardianName) ? row('Parent / Guardian', esc(primaryName(s) || '—')) : '') +
      (!(s.motherPhone || s.fatherPhone || s.guardianPhone) ? row('Phone', phoneLinks(primaryPhone(s), s.whatsapp)) : '') +
      (s.whatsapp ? row('WhatsApp', esc(s.whatsapp)) : '') +
      (s.address ? row('Address', esc(s.address)) : '') +
      (isAdmin() ? row('Yearly fee', num(s.yearlyFee) ? inr(s.yearlyFee) : '—') : '') +
      (isAdmin() ? row('Monthly fee', effectiveMonthly(s) ? inr(effectiveMonthly(s)) + (num(s.yearlyFee) && !(s.classId === 'nursery' && num(s.monthlyFee) > 0) ? ' <small class="muted">(yearly ÷ 12)</small>' : (s.classId === 'nursery' && num(s.monthlyFee) > 0 ? ' <small class="muted">(nursery)</small>' : '')) : '—') : '') +
      (isAdmin() && s.vanId && vanById(s.vanId) ? row('Van', esc(vanById(s.vanId).name) + (num(s.vanFee) ? ' · ' + inr(s.vanFee) + ' / month' + (isMonth(s.vanFrom) ? ' from ' + esc(fmtMonth(s.vanFrom)) : '') : '')) : '') +
      (isAdmin() && !s.vanId && num(s.vanFee) > 0 && isMonth(s.vanTo) ? row('Van', 'Ended ' + esc(fmtMonth(s.vanTo)) + ' · ' + inr(s.vanFee) + ' / month until then') : '') +
      (s.academicYear ? row(t('Academic year'), esc(s.academicYear)) : '') +
      (isAdmin() && siblingDiscount(s) ? row('Sibling discount', '−' + inr(siblingDiscount(s)) + ' / month <small class="muted">(pays ' + inr(netMonthly(s)) + ')</small>') : '') +
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
    if (isAdmin()) body += '<div id="student-docs-box">' + docsHTML(s) + '</div>';
    body += '<div class="form-actions">' + (isAdmin() && !isInactive(s) ? '<button class="btn ghost" data-act="pay-add" data-student="' + esc(s.id) + '">💰 Record payment</button>' : '') + '<button class="btn primary" data-act="student-edit" data-id="' + esc(s.id) + '">✏️ Edit</button></div>';
    openModal({ title: 'Student details', size: 'wide', body: body, mount: function (root) { hydratePhotos(root); } });
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
    var off = offDay(UI.attDate);
    if (off && !saved && !dr.dirty && !UI.attForce[UI.attDate]) {
      var evs = eventsOn(UI.attDate);
      return html + '<div class="holiday-box"><div class="hb-icon">🎉</div><h3>' + esc(off) + '</h3><p>' + fmtDate(UI.attDate) + ' is a school holiday, so no attendance is needed.</p>' +
        (evs.length ? '<p class="muted small">Event: ' + esc(evs.map(function (e) { return e.title; }).join(', ')) + '</p>' : '') +
        '<div class="row gap wrap center-row"><button type="button" class="btn ghost" data-act="att-prevday">← Last school day</button><button type="button" class="btn small ghost" data-act="att-force">Mark anyway</button></div></div>';
    }
    html += '<div class="att-head"><div><b>' + fmtDate(UI.attDate) + '</b> · ' + esc(new Intl.DateTimeFormat('en-IN', { weekday: 'long' }).format(new Date(UI.attDate + 'T12:00:00'))) +
      (off ? ' <span class="tag">' + esc(off) + '</span>' : '') + '<br><small id="att-status" class="' + (dr.dirty ? 'warn-t' : 'muted') + '">' + (dr.dirty ? '● Unsaved changes' : saved ? '✓ Saved' : 'Not marked yet') + '</small></div>' +
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
      if (date === todayISO() && list.some(function (s) { return rec[s.id] === 'A'; })) pushNotify('absent', { day: date, classId: cid });
    });
  }
  function monthGridHTML(cid, ym) {
    var list = activeStudents(cid);
    if (!list.length) return emptyState('📅', 'No students', 'Add students to ' + className(cid) + ' to see the monthly register.');
    var n = daysInMonth(ym), today = todayISO(), days = [];
    for (var d = 1; d <= n; d++) days.push(ym + '-' + String(d).padStart(2, '0'));
    var wd = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    var head = '<tr><th class="sticky-col">Student</th>' + days.map(function (iso) { var w = weekday(iso); return '<th class="' + (w === 0 ? 'sun' : holidayOn(iso) ? 'hol' : '') + '">' + (+iso.slice(8)) + '<small>' + wd[w] + '</small></th>'; }).join('') + '<th>P</th><th>A</th><th>L</th><th>H</th><th>%</th></tr>';
    var body = list.map(function (s) {
      var c = { P: 0, A: 0, L: 0, H: 0 }, m = 0;
      var cells = days.map(function (iso) {
        if (iso > today) return '<td class="fut"></td>';
        var v = attFor(iso)[s.id];
        if (v && c[v] != null) { c[v]++; m++; }
        var hol = !v && holidayOn(iso);
        return '<td class="' + (v ? 'mc ' + ATT[v].cls : (weekday(iso) === 0 ? 'sun' : hol ? 'hol' : '')) + '"' + (hol ? ' title="' + esc(hol.title || 'Holiday') + '"' : '') + '>' + (v || (hol ? '🎉' : '')) + '</td>';
      }).join('');
      var pct = m ? Math.round((c.P + 0.5 * c.H) / m * 100) + '%' : '—';
      return '<tr><th class="sticky-col">' + esc(s.name) + '</th>' + cells + '<td class="tot">' + c.P + '</td><td class="tot">' + c.A + '</td><td class="tot">' + c.L + '</td><td class="tot">' + c.H + '</td><td class="tot"><b>' + pct + '</b></td></tr>';
    }).join('');
    return '<p class="muted small">P = Present · A = Absent · L = Leave · H = Half-day · 🎉 = holiday. Working days: ' + workingDays(ym).length + '. Scroll sideways to see all days.</p><div class="table-wrap scroll-x"><table class="month-grid"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>';
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
          var msg = 'Dear ' + (primaryName(s) || 'Parent') + ', this is ' + S.settings.schoolName + '. ' + s.name + ' was marked ' + ATT[v].label.toLowerCase() + ' on ' + fmtDate(date) + '. Hope all is well! 🙏';
          return '<li><span><b>' + esc(s.name) + '</b> ' + badge(ATT[v].label, v === 'A' ? '#ff7a6b' : v === 'L' ? '#ffc93c' : '#38a8e0') + '<small>' + esc(primaryName(s) || '') + '</small></span>' + phoneLinks(primaryPhone(s), s.whatsapp, msg) + '</li>';
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
    var expected = billable.reduce(function (a, s) { return a + chargeFor(s, ym); }, 0);
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
    var noFee = studs.filter(function (s) { return !netMonthly(s); }).length;
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
        var msg = 'Dear ' + (primaryName(x.s) || 'Parent') + ', a gentle reminder from ' + S.settings.schoolName + ': ' + x.s.name + '’s fee for ' + fmtMonth(ym) + ' of ' + inr(x.due) + ' is pending. Please ignore if already paid. Thank you! 🙏';
        return '<tr><td data-label="Student"><b>' + esc(x.s.name) + '</b></td><td data-label="Class">' + esc(classLabel(x.s)) + '</td><td data-label="Fee" class="num">' + inr(chargeFor(x.s, ym)) + (vanMonth(x.s, ym) ? '<br><small class="muted">incl. van ' + inr(vanMonth(x.s, ym)) + '</small>' : '') + (fineFor(x.s, ym) ? '<br><small class="muted">incl. late fee ' + inr(fineFor(x.s, ym)) + '</small>' : '') + (siblingDiscount(x.s, baseMonth(x.s, ym)) ? '<br><small class="muted">sibling −' + inr(siblingDiscount(x.s, baseMonth(x.s, ym))) + '</small>' : '') + '</td><td data-label="Paid" class="num">' + inr(x.paid) + '</td><td data-label="Due" class="num"><b class="coral-t">' + inr(x.due) + '</b></td>' +
          '<td data-label="Parent">' + esc(primaryName(x.s) || '') + ' ' + phoneLinks(primaryPhone(x.s), x.s.whatsapp, msg) + '</td><td class="actions"><button class="btn small primary" data-act="pay-add" data-student="' + esc(x.s.id) + '" data-month="' + ym + '">Collect</button></td></tr>';
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
    var left = amount, alloc = {};
    months.forEach(function (m, i) {
      var due = dueFor(s, m);
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
      return l.length ? '<optgroup label="' + esc(c.name) + '">' + l.map(function (s) { return '<option value="' + esc(s.id) + '"' + (s.id === studentId ? ' selected' : '') + '>' + esc(s.name) + ' — ' + esc(primaryName(s) || '') + '</option>'; }).join('') + '</optgroup>' : '';
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
          var fee = ms.reduce(function (a, m) { return a + (feeApplies(s, m) ? netMonth(s, m) : 0); }, 0), paid = ms.reduce(function (a, m) { return a + paidFor(s.id, m); }, 0), due = ms.reduce(function (a, m) { return a + dueFor(s, m); }, 0);
          var van = ms.reduce(function (a, m) { return a + (feeApplies(s, m) ? vanMonth(s, m) : 0); }, 0);
          var fine = ms.reduce(function (a, m) { return a + fineFor(s, m); }, 0), disc = siblingDiscount(s);
          hint.hidden = false;
          hint.innerHTML = '<b>' + esc(s.name) + '</b> · ' + esc(window.LWReceipt ? window.LWReceipt.period(ms) : fmtMonth(mon.value)) + ': fee ' + inr(fee) + (disc ? ' <small>(sibling −' + inr(disc) + '/month)</small>' : '') + (van ? ' + van ' + inr(van) : '') + (fine ? ' + late fee ' + inr(fine) : '') + ' · paid ' + inr(paid) + ' · <b>due ' + inr(due) + '</b>' + (mon.value < admMonth(s) ? '<br><small class="warn-t">This month is before the admission date (' + fmtDate(s.admissionDate) + ').</small>' : '');
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
        var due = ms.reduce(function (a, m) { return a + dueFor(s, m); }, 0);
        var fineIn = ms.reduce(function (a, m) { return a + (dueFor(s, m) > 0 ? fineFor(s, m) : 0); }, 0);
        return (netMonthly(s) && amount > due ? confirmBox('This is more than the amount due for ' + periodText({ months: ms }) + ' (' + inr(due) + '). Save anyway?', { ok: 'Save', danger: false, title: 'Amount more than due' }) : Promise.resolve(true)).then(function (go) {
          if (!go) return false;
          var r = nextReceiptNo();
          var amt2 = Math.round(amount * 100) / 100;
          var p = { id: uid(), seq: r.seq, receiptNo: r.no, studentId: s.id, studentName: s.name, parentName: primaryName(s) || '', classId: s.classId, month: ms[0],
            amount: amt2, mode: g('mode'), ref: g('ref'), paidOn: g('paidOn'), note: g('note'), receivedBy: (ME && ME.name) || S.settings.owner || '', monthlyFee: netMonthly(s), yearlyFee: num(s.yearlyFee), createdAt: new Date().toISOString() };
          if (siblingDiscount(s)) p.discount = siblingDiscount(s);
          var vanIn = vanMonth(s, ms[0]); if (vanIn > 0) p.vanFee = vanIn;
          if (fineIn > 0) p.lateFee = round2(Math.min(fineIn, amt2));
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
    var bal = hasSnap ? num(p.balanceAfter) : (s && netMonthly(s) ? outstanding(s) : null);
    return {
      school: { name: st.schoolName, address: st.address, phone: st.phone, email: st.email }, logo: 'assets/logo.jpeg',
      receiptNo: p.receiptNo, date: p.paidOn, studentName: p.studentName, className: (s ? classLabel(s) : className(p.classId)), parentName: p.parentName || (s && primaryName(s)) || '',
      months: payMonths(p), monthlyFee: p.monthlyFee != null ? p.monthlyFee : (s ? effectiveMonthly(s) : 0), yearlyFee: (p.yearlyFee != null ? p.yearlyFee : (s ? s.yearlyFee : 0)), amount: p.amount, mode: p.mode, ref: p.ref,
      balance: bal, balanceLabel: hasSnap ? 'Balance due after this payment' : 'Balance due (as on ' + fmtDate(todayISO()) + ')',
      receivedBy: p.receivedBy || '', copy: copy || '', discount: num(p.discount), lateFee: num(p.lateFee), vanFee: num(p.vanFee)
    };
  }
  function receiptText(p) { return window.LWReceipt.text(receiptData(p)); }
  function findPayment(id) { return S.payments.filter(function (p) { return p.id === id; })[0]; }
  function receiptWaLink(p) {
    var s = studentById(p.studentId), wa = s ? (s.whatsapp || primaryPhone(s)) : '';
    return wa && validPhone(wa) ? waHref(wa, receiptText(p)) : 'https://wa.me/?text=' + encodeURIComponent(receiptText(p));
  }
  function receiptFileName(p) { return 'Receipt ' + p.receiptNo + ' - ' + p.studentName; }
  function openReceipt(id) {
    var p = findPayment(id);
    if (!p || !window.LWReceipt) return;
    var s = studentById(p.studentId), wa = s ? (s.whatsapp || primaryPhone(s)) : '';
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
    var body = '<div class="rcpt-total"><span>Receipts: <b>' + pays.length + '</b></span><span>Total paid: <b>' + inr(total) + '</b></span>' + (s && num(s.yearlyFee) ? '<span>Yearly fee: <b>' + inr(s.yearlyFee) + '</b></span>' : '') + (s && netMonthly(s) ? '<span>Monthly fee: <b>' + inr(netMonthly(s)) + '</b>' + (siblingDiscount(s) ? ' <small>(sibling −' + inr(siblingDiscount(s)) + ')</small>' : '') + '</span><span>Pending now: <b class="coral-t">' + inr(outstanding(s)) + '</b></span>' : '') + '</div>' +
      (pays.length ? '<div class="table-wrap"><table class="table responsive"><thead><tr><th>Receipt</th><th>Paid on</th><th>Fee for</th><th>Mode</th><th class="num">Amount</th><th class="act-col"><span class="sr">Actions</span></th></tr></thead><tbody>' +
        pays.map(function (p) {
          return '<tr><td data-label="Receipt"><b>' + esc(p.receiptNo) + '</b></td><td data-label="Paid on">' + fmtDate(p.paidOn) + '</td><td data-label="Fee for">' + esc(periodText(p)) + '</td><td data-label="Mode">' + esc(p.mode) + '</td><td data-label="Amount" class="num"><b>' + inr(p.amount) + '</b></td>' +
            '<td class="actions"><button class="icon-btn" data-act="receipt-view" data-id="' + esc(p.id) + '" title="View / print receipt" aria-label="Receipt ' + esc(p.receiptNo) + '">🧾</button></td></tr>';
        }).join('') + '</tbody></table></div>' : '<p class="muted">No payments yet.</p>') +
      (s && !isInactive(s) ? '<div class="form-actions"><button class="btn primary" data-act="pay-add" data-student="' + esc(sid) + '">💰 Record payment</button></div>' : '');
    openModal({ title: '🧾 Receipts · ' + name, size: 'wide', body: body });
  }

  /* =====================================================================
   * ENQUIRIES
   * ===================================================================== */
  function enqFeedback(e) {
    return (e && ENQ_FEEDBACK.indexOf(e.feedback) >= 0) ? e.feedback : '';
  }
  function viewEnquiries() {
    var today = todayISO(), ym = thisMonth();
    var isDue = function (e) { return e.followUp && e.followUp <= today && !isConverted(e) && e.status !== 'Not interested'; };
    var month = S.enquiries.filter(function (e) { return (e.date || '').slice(0, 7) === ym; });
    var dueN = S.enquiries.filter(isDue).length;
    var html = '<div class="stats">' + stat('📝', 'Enquiries this month', String(month.length), fmtMonth(ym), 'sky') +
      stat('🎓', 'Converted this month', String(month.filter(isConverted).length), 'Admitted from an enquiry', 'green') +
      stat('📞', 'Follow-ups due', String(dueN), 'Today or overdue', dueN ? 'coral' : 'yellow') + '</div>';
    html += '<div class="toolbar"><input type="search" class="search" placeholder="🔍 Search child, parent, phone or address" value="' + esc(UI.enqSearch) + '" data-input="enq-search" aria-label="Search enquiries">' +
      '<button class="btn primary" data-act="enq-add">➕ New enquiry</button></div>';
    var webNew = S.enquiries.filter(function (e) { return e.web && !e.seen; }).length;
    if (webNew) html += '<div class="callout web-new"><b>🌐 ' + webNew + ' new enquir' + (webNew === 1 ? 'y' : 'ies') + ' from the website</b><p>Marked <b>NEW</b> below. Call or WhatsApp the parent, then tap “Mark seen”. <button type="button" class="link" data-act="enq-seen-all">Mark all seen</button></p></div>';
    var chips = ['All', 'New', 'Interested', 'Doubtful', 'Converted', 'Due'];
    html += '<div class="chips">' + chips.map(function (f) {
      var n = f === 'All' ? S.enquiries.length
        : f === 'New' ? S.enquiries.filter(function (e) { return e.web && !e.seen; }).length
        : f === 'Due' ? dueN
        : f === 'Converted' ? S.enquiries.filter(isConverted).length
        : S.enquiries.filter(function (e) { return enqFeedback(e) === f; }).length;
      if (f === 'New' && !n && UI.enqFilter !== 'New') return '';
      return '<button type="button" class="chip' + (UI.enqFilter === f ? ' active' : '') + '" data-act="enq-filter" data-f="' + esc(f) + '">' + esc(f === 'Due' ? '📞 Due' : f === 'New' ? '🌐 New' : f) + ' <span>' + n + '</span></button>';
    }).join('') + '</div>';
    html += '<div id="enq-list">' + enqListHTML() + '</div>';
    return html;
  }
  function enqListHTML() {
    var today = todayISO(), q = UI.enqSearch.trim().toLowerCase();
    var isDue = function (e) { return e.followUp && e.followUp <= today && !isConverted(e) && e.status !== 'Not interested'; };
    if (!S.enquiries.length) return emptyState('📝', 'No enquiries yet', 'When a parent calls, messages or walks in, note it here so no follow-up is missed.', '<button class="btn primary" data-act="enq-add">➕ Add first enquiry</button>');
    var list = S.enquiries.filter(function (e) {
      if (UI.enqFilter === 'Due' && !isDue(e)) return false;
      if (UI.enqFilter === 'Converted' && !isConverted(e)) return false;
      if (UI.enqFilter === 'New' && !(e.web && !e.seen)) return false;
      if (UI.enqFilter === 'Interested' || UI.enqFilter === 'Doubtful') { if (enqFeedback(e) !== UI.enqFilter) return false; }
      var hay = [e.childName, e.fatherName, e.motherName, e.parentName, e.fatherPhone, e.motherPhone, e.phone, e.address].join(' ').toLowerCase();
      return !q || hay.indexOf(q) >= 0;
    }).sort(function (a, b) {
      var na = a.web && !a.seen ? 0 : 1, nb = b.web && !b.seen ? 0 : 1;
      if (na !== nb) return na - nb;
      var da = isDue(a) ? 0 : 1, db = isDue(b) ? 0 : 1;
      if (da !== db) return da - db;
      return (b.date || '') < (a.date || '') ? -1 : (b.date || '') > (a.date || '') ? 1 : 0;
    });
    if (!list.length) return emptyState('🔍', 'Nothing here', 'No enquiries match this filter.');
    return '<div class="enq-grid">' + list.map(function (e) {
      var due = isDue(e), overdue = due && e.followUp < today;
      var fb = enqFeedback(e);
      var age = '';
      if (isISODate(e.dob)) age = ageText(e.dob);
      else if (e.childAge !== '' && e.childAge != null) age = e.childAge + ' yrs';
      var guardianOnly = e.web && e.relation === 'Guardian';
      var father = guardianOnly ? '' : (e.fatherName || (!e.motherName ? e.parentName : ''));
      var mother = e.motherName || '';
      var isNew = e.web && !e.seen;
      return '<article class="enq' + (isNew ? ' is-new' : '') + (due ? (overdue ? ' overdue' : ' due') : '') + '">' +
        (isNew ? '<div class="enq-flag new">🆕 NEW · from the website · ' + esc(e.createdAt ? stampIST(e.createdAt) : fmtDate(e.date)) + '</div>' : '') +
        (due ? '<div class="enq-flag">' + (overdue ? '⚠️ Follow-up overdue (' + fmtDate(e.followUp) + ')' : '📞 Follow up today') + '</div>' : '') +
        '<div class="enq-top"><div><h3>' + esc(e.childName) + (age ? ' <small>' + esc(age) + '</small>' : '') + '</h3>' +
        '<p>' + (guardianOnly ? 'Parent: ' + esc(e.parentName) : '') + (father ? 'Father: ' + esc(father) : '') + (father && mother ? ' · ' : '') + (mother ? 'Mother: ' + esc(mother) : '') + (e.classWanted ? ' · Class: ' + esc(e.classWanted) : '') + '</p></div>' +
        (fb ? '<span class="tag ' + (fb === 'Interested' ? 'fb-in' : 'fb-db') + '">' + esc(fb) + '</span>' : '<span class="tag">No feedback</span>') +
        '</div>' +
        '<div class="enq-meta">' +
          (e.fatherPhone || (!e.motherPhone && e.phone) ? '<span>' + (guardianOnly ? 'Parent ' : 'Father ') + phoneLinks(e.fatherPhone || e.phone) + '</span>' : '') +
          (e.motherPhone ? '<span>Mother ' + phoneLinks(e.motherPhone) + '</span>' : '') +
        '</div>' +
        '<div class="enq-meta"><span>📅 ' + fmtDate(e.date) + '</span>' + (e.source ? '<span>📣 ' + esc(e.source) + '</span>' : '') +
          (e.followUp && !due ? '<span>🔔 ' + fmtDate(e.followUp) + '</span>' : '') +
          (e.address ? '<span>🏠 ' + esc(e.address) + '</span>' : '') + '</div>' +
        (e.notes ? '<p class="enq-notes">' + esc(e.notes) + '</p>' : '') +
        '<div class="enq-actions">' + (isNew ? '<button class="btn small ghost" data-act="enq-seen" data-id="' + esc(e.id) + '">✓ Mark seen</button>' : '') + (isConverted(e) && e.studentId && studentById(e.studentId) ? '<span class="tag ok">🎓 Admitted</span>' : '<button class="btn small primary" data-act="enq-convert" data-id="' + esc(e.id) + '">🎓 Convert to admission</button>') +
        '<button class="icon-btn" data-act="enq-edit" data-id="' + esc(e.id) + '" title="Edit" aria-label="Edit">✏️</button><button class="icon-btn" data-act="enq-del" data-id="' + esc(e.id) + '" title="Delete" aria-label="Delete">🗑️</button></div></article>';
    }).join('') + '</div>';
  }
  function findEnq(id) { return S.enquiries.filter(function (e) { return e.id === id; })[0]; }
  function openEnquiryForm(e) {
    var v = Object.assign({ date: todayISO(), feedback: 'Interested', source: 'Walk-in' }, e || {});
    if (!v.fatherName && v.parentName && !v.motherName) v.fatherName = v.parentName;
    if (v.web && !v.feedback) v.feedback = 'Interested';
    if (!v.fatherPhone && v.phone && !v.motherPhone) v.fatherPhone = v.phone;
    var body = '<form class="form" novalidate><div class="grid2">' +
      field('Enquiry date *', '<input type="date" name="date" max="' + todayISO() + '" value="' + esc(v.date) + '" required>') +
      field('Source', '<select name="source">' + options(ENQ_SOURCES, v.source) + '</select>') +
      field('Student name *', '<input name="childName" maxlength="80" value="' + esc(v.childName) + '" required>') +
      field('Date of birth', '<input type="date" name="dob" max="' + todayISO() + '" value="' + esc(v.dob) + '">', '<small class="hint" id="enq-hint"></small>') +
      field('Father’s name *', '<input name="fatherName" maxlength="80" value="' + esc(v.fatherName) + '" required>') +
      field('Father’s mobile *', '<input type="tel" name="fatherPhone" inputmode="tel" maxlength="16" placeholder="10-digit mobile" value="' + esc(v.fatherPhone) + '" required>') +
      field('Mother’s name *', '<input name="motherName" maxlength="80" value="' + esc(v.motherName) + '" required>') +
      field('Mother’s mobile *', '<input type="tel" name="motherPhone" inputmode="tel" maxlength="16" placeholder="10-digit mobile" value="' + esc(v.motherPhone) + '" required>') +
      field('Father’s qualification', '<input name="fatherQual" maxlength="80" placeholder="Optional" value="' + esc(v.fatherQual) + '">') +
      field('Mother’s qualification', '<input name="motherQual" maxlength="80" placeholder="Optional" value="' + esc(v.motherQual) + '">') +
      field('Address', '<textarea name="address" rows="2" maxlength="250" placeholder="House / street, area, town">' + esc(v.address) + '</textarea>', '', 'span2') +
      field('Feedback *', '<select name="feedback">' + options(ENQ_FEEDBACK, v.feedback) + '</select>') +
      field('Follow-up date', '<input type="date" name="followUp" value="' + esc(v.followUp) + '">') +
      '</div>' + field('Notes', '<textarea name="notes" rows="3" maxlength="1500" placeholder="Timings asked, fee discussed, visit planned…">' + esc(v.notes) + '</textarea>') +
      '<div class="form-actions"><button type="button" class="btn ghost" data-act="modal-close">Cancel</button><button class="btn primary">' + (e ? 'Save changes' : 'Add enquiry') + '</button></div></form>';
    openModal({
      title: e ? 'Edit enquiry' : 'New enquiry', size: 'wide', body: body,
      mount: function (root) {
        var dob = $('[name=dob]', root), h = $('#enq-hint', root);
        var u = function () {
          var a = ageParts(dob.value);
          h.textContent = a ? ('Age today: ' + a.y + ' y ' + a.m + ' m · suggested class: ' + className(suggestClass(a.years))) : '';
        };
        if (dob) { dob.addEventListener('input', u); dob.addEventListener('change', u); u(); }
      },
      onSubmit: function (form, fd) {
        var g = function (k) { return String(fd.get(k) == null ? '' : fd.get(k)).trim(); };
        var ok = true;
        var d = { date: g('date'), source: g('source'), childName: g('childName'), dob: g('dob'),
          fatherName: g('fatherName'), fatherPhone: g('fatherPhone'), motherName: g('motherName'), motherPhone: g('motherPhone'),
          fatherQual: g('fatherQual'), motherQual: g('motherQual'), address: g('address'), feedback: g('feedback'), followUp: g('followUp'), notes: g('notes') };
        if (!isISODate(d.date) || d.date > todayISO()) { fieldError(form, 'date', 'Choose a valid date (not in the future)'); ok = false; }
        if (d.childName.length < 1) { fieldError(form, 'childName', 'Please enter the student’s name'); ok = false; }
        if (d.dob && !isISODate(d.dob)) { fieldError(form, 'dob', 'Choose a valid date of birth'); ok = false; }
        else if (d.dob && d.dob > todayISO()) { fieldError(form, 'dob', 'Date of birth can’t be in the future'); ok = false; }
        var webE = e && e.web;
        // Website enquiries may have only one parent: ask for at least one name + mobile.
        if (webE) {
          if (d.fatherName.length < 2 && d.motherName.length < 2) { fieldError(form, 'fatherName', 'Enter the father’s or mother’s name'); ok = false; }
          if (d.fatherPhone && !validPhone(d.fatherPhone)) { fieldError(form, 'fatherPhone', 'Enter a valid 10-digit Indian mobile number'); ok = false; }
          if (d.motherPhone && !validPhone(d.motherPhone)) { fieldError(form, 'motherPhone', 'Enter a valid 10-digit Indian mobile number'); ok = false; }
          if (!validPhone(d.fatherPhone) && !validPhone(d.motherPhone)) { fieldError(form, 'fatherPhone', 'Enter at least one mobile number'); ok = false; }
        } else {
        if (d.fatherName.length < 2) { fieldError(form, 'fatherName', 'Please enter the father’s name'); ok = false; }
        if (!validPhone(d.fatherPhone)) { fieldError(form, 'fatherPhone', 'Enter a valid 10-digit Indian mobile number'); ok = false; }
        if (d.motherName.length < 2) { fieldError(form, 'motherName', 'Please enter the mother’s name'); ok = false; }
        if (!validPhone(d.motherPhone)) { fieldError(form, 'motherPhone', 'Enter a valid 10-digit Indian mobile number'); ok = false; }
        }
        if (ENQ_FEEDBACK.indexOf(d.feedback) < 0) { fieldError(form, 'feedback', 'Please choose Interested or Doubtful'); ok = false; }
        if (d.followUp && !isISODate(d.followUp)) { fieldError(form, 'followUp', 'Invalid date'); ok = false; }
        if (ENQ_SOURCES.indexOf(d.source) < 0) d.source = 'Walk-in';
        if (!ok) return false;
        // Keep legacy parentName/phone in sync so older lists and backups still work.
        if (webE) { d.parentName = d.fatherName || d.motherName || e.parentName; d.phone = d.fatherPhone || d.motherPhone || e.phone; d.relation = d.fatherName ? 'Father' : 'Mother'; d.seen = true; }
        else { d.parentName = d.fatherName; d.phone = d.fatherPhone; }
        if (isISODate(d.dob)) {
          var a = ageParts(d.dob);
          d.childAge = a ? Math.round((a.years + a.m / 12) * 10) / 10 : '';
        }
        if (e) Object.assign(e, d, { updatedAt: new Date().toISOString() });
        else S.enquiries.push(Object.assign({ id: uid(), status: 'New', createdAt: new Date().toISOString() }, d));
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
    var pre = {
      name: e.childName,
      dob: e.dob || '',
      parentName: e.fatherName || e.parentName || '',
      phone: e.fatherPhone || e.phone || '',
      fatherName: e.fatherName || e.parentName || '',
      fatherPhone: e.fatherPhone || e.phone || '',
      motherName: e.motherName || '',
      motherPhone: e.motherPhone || '',
      address: e.address || '',
      classId: isISODate(e.dob) ? (suggestClass((ageParts(e.dob) || {}).years) || '') : (suggestClass(e.childAge === '' ? NaN : num(e.childAge)) || ''),
      admissionDate: todayISO(),
      notes: 'Converted from enquiry dated ' + fmtDate(e.date) + (e.source ? ' (source: ' + e.source + ')' : '') + '.' + (e.notes ? ' ' + e.notes : '')
    };
    openStudentForm(null, pre, function (stu) {
      e.status = 'Admitted'; e.studentId = stu.id; e.convertedAt = new Date().toISOString(); e.updatedAt = e.convertedAt;
      persist('enquiries');
    });
  }

  /* =====================================================================
   * STAFF
   * ===================================================================== */
  function viewStaff() {
    if (UI.staffTab === 'salary') return staffTabs() + viewSalary();
    if (UI.staffTab === 'att') return staffTabs() + viewStaffAtt();
    var total = S.staff.reduce(function (a, s) { return a + (s.status === 'Left' ? 0 : num(s.salary)); }, 0);
    var active = S.staff.filter(function (s) { return s.status !== 'Left'; });
    var html = staffTabs() + '<div class="stats">' + stat('👩‍🏫', 'Staff members', String(active.length), active.filter(function (s) { return /teacher/i.test(s.role || ''); }).length + ' teaching', 'sky') +
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
   * v2.5 — HELPERS: templates, holidays, timestamps
   * ===================================================================== */
  var TPL_FEE = 'Dear {parent}, greetings from {school}. This is a gentle reminder that {child}’s fee of {amount} for {month} is pending. Kindly pay at your earliest convenience. Please ignore if already paid. Thank you! 🙏\n{school}, {phone}';
  var TPL_BDAY = 'Dear {parent}, warm wishes from all of us at {school}! 🎂🎉 Wishing {child} a very Happy Birthday and a wonderful year ahead. 🎈\n– Team {school}, {phone}';
  var EXP_CATS = ['Rent', 'Electricity', 'Stationery', 'Snacks', 'Water', 'Maintenance', 'Events', 'Transport', 'Other'];
  var EXP_COLORS = ['#38a8e0', '#ffc93c', '#ff7a6b', '#6cc48a', '#8fd3f4', '#b38df0', '#f7a8c4', '#9aa7b4', '#c9ced6'];
  var SATT = { P: { label: 'Present', cls: 'p' }, A: { label: 'Absent', cls: 'a' }, H: { label: 'Half-day', cls: 'h' } };
  function fillTpl(tpl, v) { return String(tpl || '').replace(/\{(\w+)\}/g, function (m, k) { return v[k] != null ? String(v[k]) : m; }); }
  function feeTpl() { return String(S.settings.tplFee || '').trim() || TPL_FEE; }
  function bdayTpl() { return String(S.settings.tplBirthday || '').trim() || TPL_BDAY; }
  function stampIST(iso) {
    try { return new Intl.DateTimeFormat('en-IN', { timeZone: TZ, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso)) + ' IST'; } catch (e) { return ''; }
  }
  function daysAgo(iso) {
    if (!iso) return null;
    var d = Date.parse(iso);
    return isFinite(d) ? Math.floor((Date.now() - d) / 86400000) : null;
  }
  function holTo(h) { return isISODate(h.to) && h.to >= h.from ? h.to : h.from; }
  function holidayOn(iso) {
    for (var i = 0; i < S.holidays.length; i++) {
      var h = S.holidays[i];
      if (h.type !== 'Event' && isISODate(h.from) && iso >= h.from && iso <= holTo(h)) return h;
    }
    return null;
  }
  function eventsOn(iso) { return S.holidays.filter(function (h) { return h.type === 'Event' && isISODate(h.from) && iso >= h.from && iso <= holTo(h); }); }
  function offDay(iso) { var h = holidayOn(iso); return h ? h.title || 'Holiday' : (weekday(iso) === 0 ? 'Sunday' : ''); }
  function workingDays(ym) {
    var n = daysInMonth(ym), today = todayISO(), out = [];
    for (var d = 1; d <= n; d++) { var iso = ym + '-' + String(d).padStart(2, '0'); if (iso <= today && !offDay(iso)) out.push(iso); }
    return out;
  }
  function holRange(h) { var t = holTo(h); return t !== h.from ? fmtDate(h.from) + ' – ' + fmtDate(t) : fmtDate(h.from) + ' · ' + new Intl.DateTimeFormat('en-IN', { weekday: 'short' }).format(new Date(h.from + 'T12:00:00')); }
  function sheetSafe(rows) { return rows.map(function (r) { return r.map(function (v) { return v === '—' || v == null ? '' : v; }); }); }
  function downloadXlsx(name, sheets) {
    if (!window.LWXlsx) { toast('Excel export is not available. Please reload the page.', 'err'); return false; }
    var blob = window.LWXlsx.build(sheets.map(function (s) { return { name: s.name, rows: sheetSafe(s.rows) }; }));
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.parentNode.removeChild(a); }, 1500);
    return true;
  }
  function printDoc(title, inner, fileTitle) {
    var root = $('#print-root');
    if (!root) return;
    var st = S.settings;
    root.className = 'pdoc-root';
    root.innerHTML = '<article class="pdoc"><header class="pdoc-head"><img src="assets/logo.jpeg" alt="" width="54" height="54"><div><h1>' + esc(st.schoolName) + '</h1><p>' + esc(st.address || '') + (st.phone ? ' · ' + esc(st.phone) : '') + '</p></div></header>' +
      '<h2 class="pdoc-title">' + esc(title) + '</h2>' + inner + '<footer class="pdoc-foot">Printed ' + esc(stampIST(new Date().toISOString())) + ' · The Little Wings Dashboard</footer></article>';
    var old = document.title;
    var restore = function () { document.title = old; root.innerHTML = ''; root.className = ''; window.removeEventListener('afterprint', restore); };
    var go = function () { document.title = fileTitle || title; window.addEventListener('afterprint', restore); setTimeout(function () { window.print(); }, 60); };
    var img = $('img', root);
    if (img && !img.complete) { img.onload = go; img.onerror = go; } else go();
  }

  /* =====================================================================
   * MORE (phone menu)
   * ===================================================================== */
  function viewMore() {
    var items = ROUTE_ORDER.filter(function (k) { return bottomList().indexOf(k) < 0 && k !== 'more' && ROUTES[k].roles.indexOf(ME.role) >= 0; });
    var tile = function (k) {
      var sub = k === 'settings' && !isAdmin() ? 'Password, language, app' : MORE_SUB[k];
      return '<a class="more-tile" href="#/' + k + '"><span class="mt-i">' + ROUTES[k].icon + '</span><span><b>' + esc(routeTitle(k)) + navBadge(k) + '</b><small>' + esc(sub ? t(sub) : '') + '</small></span></a>';
    };
    var closed = navClosed();
    var groups = navGroupsFor(items);
    var html = groups.length < 2 ? '<div class="more-grid">' + items.map(tile).join('') + '</div>' : groups.map(function (g) {
      var shut = closed.indexOf('m-' + g.id) >= 0;
      return '<section class="more-sec' + (shut ? ' closed' : '') + '"><button type="button" class="more-gh" data-act="more-group" data-id="' + g.id + '" aria-expanded="' + (!shut) + '">' +
        '<span>' + g.icon + ' ' + esc(t(g.title)) + ' <small>(' + g.items.length + ')</small></span><i aria-hidden="true">▾</i></button>' +
        '<div class="more-grid">' + g.items.map(tile).join('') + '</div></section>';
    }).join('');
    return html + (PART_B ? '<section class="card"><h3>🌐 ' + esc(t('Language')) + '</h3>' + langSelectHTML('lang-big') + '</section>' : '');
  }
  function navBadge(k) {
    var n = 0;
    if (k === 'enquiries' && isAdmin()) n = S.enquiries.filter(function (e) { return e.web && !e.seen; }).length;
    if (k === 'backup' && isAdmin()) n = backupDue() ? 1 : 0;
    if (k === 'feedback' && isAdmin()) n = S.feedback.filter(function (f) { return (f.status || 'New') === 'New'; }).length;
    if (k === 'more' && isAdmin()) n = (backupDue() ? 1 : 0) + S.feedback.filter(function (f) { return (f.status || 'New') === 'New'; }).length;
    if (!n) return '';
    return ' <span class="nbadge">' + (k === 'backup' || (k === 'more' && backupDue()) ? '!' : n) + '</span>';
  }

  /* =====================================================================
   * PENDING FEES + WHATSAPP REMINDERS
   * ===================================================================== */
  function reminderOf(sid) { return S.fee_reminders.filter(function (r) { return r.id === sid; })[0] || null; }
  function pendingRows(cls) {
    var cur = thisMonth();
    return activeStudents(cls || '').map(function (s) {
      var start = feeStart(s);
      var months = start <= cur ? monthRange(start, cur) : [];
      var dueMonths = [], total = 0, fine = 0;
      months.forEach(function (m) {
        var d = dueFor(s, m);
        if (d > 0) { dueMonths.push(m); total += d; fine += fineFor(s, m); }
      });
      var now = dueFor(s, cur);
      var phone = s.whatsapp && validPhone(s.whatsapp) ? s.whatsapp : primaryPhone(s);
      return { s: s, total: round2(total), now: now, over: round2(total - now), months: dueMonths, fine: round2(fine), phone: validPhone(phone) ? phone : '', rem: reminderOf(s.id) };
    }).filter(function (x) { return x.total > 0; }).sort(function (a, b) { return b.total - a.total || byName(a.s, b.s); });
  }
  function reminderText(x) {
    var st = S.settings;
    return fillTpl(feeTpl(), {
      parent: primaryName(x.s) || 'Parent', child: x.s.name, amount: inr(x.total), month: window.LWReceipt ? window.LWReceipt.period(x.months) : fmtMonth(x.months[0]),
      school: st.schoolName, phone: st.phone || '+91 79955 54105', class: className(x.s.classId), late: x.fine ? inr(x.fine) : ''
    });
  }
  function recordReminder(x) {
    var r = reminderOf(x.s.id);
    var rec = { id: x.s.id, at: new Date().toISOString(), amount: x.total, months: x.months, count: (r && r.count || 0) + 1, by: (ME && ME.name) || '' };
    S.fee_reminders = S.fee_reminders.filter(function (y) { return y.id !== x.s.id; }).concat([rec]);
    persist('fee_reminders');
    if (S.settings.showFeesToParents === true) pushNotify('fee', { ref: x.s.id });
  }
  function feeRulesNote() {
    var r = feeRules(), out = [];
    if (r.lateOn && r.lateAmt > 0) out.push('Late fee: ' + (r.lateType === 'day' ? inr(r.lateAmt) + ' per day' + (r.lateMax ? ' (max ' + inr(r.lateMax) + ' a month)' : '') : inr(r.lateAmt) + ' once') + ' after the ' + r.dueDay + ordinal(r.dueDay) + (r.lateFrom ? ', from ' + fmtMonth(r.lateFrom) : ''));
    if (r.sibOn && r.sibVal > 0) out.push('Sibling discount: ' + (r.sibType === 'flat' ? inr(r.sibVal) : r.sibVal + '%') + ' a month for the 2nd+ child');
    return out.length ? '<p class="note">⚙️ ' + esc(out.join(' · ')) + ' · <a href="#/settings">change</a></p>' : '';
  }
  function ordinal(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return s[(v - 20) % 10] || s[v] || s[0]; }
  function viewPending() {
    var cls = UI.pendClass || '';
    var rows = pendingRows(cls);
    var tot = rows.reduce(function (a, x) { a.t += x.total; a.n += x.now; a.o += x.over; return a; }, { t: 0, n: 0, o: 0 });
    var canRemind = rows.filter(function (x) { return x.phone; }).length;
    var html = '<div class="toolbar">' + field('Class', '<select data-change="pend-class">' + options([{ value: '', label: 'All classes' }].concat(CLASSES.map(function (c) { return { value: c.id, label: c.emoji + ' ' + c.name }; })), cls) + '</select>') +
      '<button class="btn wa-btn" data-act="remind-all"' + (canRemind ? '' : ' disabled') + '>' + WA_SVG + ' Remind all (' + canRemind + ')</button></div>';
    html += '<div class="stats">' + stat('👪', 'Students with dues', String(rows.length), cls ? className(cls) : 'All classes', 'sky') +
      stat('📅', fmtMonth(thisMonth()) + ' pending', inr(tot.n), 'This month', 'yellow') +
      stat('⚠️', 'Overdue', inr(tot.o), 'Earlier months', 'coral') +
      stat('⏳', 'Total pending', inr(tot.t), 'As on ' + fmtDate(todayISO()), 'purple') + '</div>';
    html += feeRulesNote();
    if (!rows.length) return html + emptyState('🎉', 'No pending fees', 'Every student is paid up to ' + fmtMonth(thisMonth()) + '.');
    html += '<div class="pf-list">' + rows.map(function (x) {
      var r = x.rem;
      return '<article class="pf-card' + (x.over > 0 ? ' over' : '') + '"><div class="pf-top"><div><b>' + esc(x.s.name) + '</b><small>' + esc(classLabel(x.s)) + ' · ' + esc(primaryName(x.s) || 'Parent') + (x.phone ? ' · ' + esc(x.phone) : '') + '</small></div><b class="pf-amt coral-t">' + inr(x.total) + '</b></div>' +
        '<div class="pf-meta"><span>This month <b>' + inr(x.now) + '</b></span>' + (x.over > 0 ? '<span class="warn-t">Earlier <b>' + inr(x.over) + '</b></span>' : '') + '<span>' + esc(window.LWReceipt ? window.LWReceipt.period(x.months) : '') + '</span>' + (x.fine ? '<span>incl. late fee ' + inr(x.fine) + '</span>' : '') + '</div>' +
        '<div class="pf-foot"><small class="muted">' + (r && r.at ? '🔔 Last reminded ' + esc(stampIST(r.at)) + (r.count > 1 ? ' · ' + r.count + ' times' : '') : 'Not reminded yet') + '</small><span class="row gap">' +
        (x.phone ? '<a class="btn small wa-btn" href="' + esc(waHref(x.phone, reminderText(x))) + '" target="_blank" rel="noopener" data-act="remind-one" data-id="' + esc(x.s.id) + '">' + WA_SVG + ' Remind</a>' : '<span class="muted small">No mobile</span>') +
        '<button class="btn small primary" data-act="pay-add" data-student="' + esc(x.s.id) + '" data-month="' + esc(x.months[0] || thisMonth()) + '">Collect</button></span></div></article>';
    }).join('') + '</div>';
    return html;
  }
  var remindQ = null;
  function openRemindAll() {
    var rows = pendingRows(UI.pendClass || '').filter(function (x) { return x.phone; });
    if (!rows.length) { toast('No parents with a mobile number to remind', 'err'); return; }
    remindQ = { list: rows, i: 0, sent: 0 };
    openModal({ title: 'Remind all on WhatsApp', size: 'wide', body: '<div id="remind-step"></div>' });
    remindStep();
  }
  function remindStep() {
    var box = $('#remind-step');
    if (!box || !remindQ) return;
    var q = remindQ;
    if (q.i >= q.list.length) {
      box.innerHTML = '<div class="empty"><div class="empty-icon">✅</div><h3>All done</h3><p>' + q.sent + ' reminder' + (q.sent === 1 ? '' : 's') + ' opened in WhatsApp out of ' + q.list.length + '.</p></div><div class="form-actions"><button type="button" class="btn primary" data-act="modal-close">Close</button></div>';
      remindQ = null; render();
      return;
    }
    var x = q.list[q.i], r = x.rem, msg = reminderText(x);
    box.innerHTML = '<p class="muted small">Reminder <b>' + (q.i + 1) + '</b> of ' + q.list.length + '. Tap <b>Send on WhatsApp</b>, press send in WhatsApp, then come back here for the next one.</p>' +
      '<div class="pf-card"><div class="pf-top"><div><b>' + esc(x.s.name) + '</b><small>' + esc(classLabel(x.s)) + ' · ' + esc(primaryName(x.s) || 'Parent') + ' · ' + esc(x.phone) + '</small></div><b class="pf-amt coral-t">' + inr(x.total) + '</b></div>' +
      '<div class="pf-foot"><small class="muted">' + (r && r.at ? '🔔 Last reminded ' + esc(stampIST(r.at)) : 'Not reminded yet') + '</small></div></div>' +
      '<pre class="msg-preview">' + esc(msg) + '</pre>' +
      '<div class="form-actions"><button type="button" class="btn ghost" data-act="remind-skip">Skip</button><a class="btn wa-btn" href="' + esc(waHref(x.phone, msg)) + '" target="_blank" rel="noopener" data-act="remind-send">' + WA_SVG + ' Send on WhatsApp</a></div>';
  }

  /* =====================================================================
   * BIRTHDAYS (today + next 7 days)
   * ===================================================================== */
  function upcomingBirthdays(days, classId) {
    var today = todayISO(), y = +today.slice(0, 4), out = [];
    activeStudents(classId).forEach(function (s) {
      if (!isISODate(s.dob)) return;
      var md = s.dob.slice(5);
      if (md === '02-29' && !((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0)) md = '02-28';
      var next = y + '-' + md;
      if (next < today) next = (y + 1) + '-' + md;
      var inDays = daysBetween(today, next);
      if (inDays <= days) out.push({ s: s, date: next, inDays: inDays, turns: +next.slice(0, 4) - +s.dob.slice(0, 4) });
    });
    return out.sort(function (a, b) { return a.inDays - b.inDays || byName(a.s, b.s); });
  }
  function birthdayCardHTML() {
    var list = upcomingBirthdays(7);
    return '<section class="card"><h3>🎂 Birthdays: today &amp; next 7 days' + (list.filter(function (b) { return !b.inDays; }).length ? ' <span class="pill coral">Today!</span>' : '') + '</h3>' + (list.length ? '<ul class="mini-list">' + list.map(function (b) {
      var ph = b.s.whatsapp && validPhone(b.s.whatsapp) ? b.s.whatsapp : primaryPhone(b.s);
      var msg = fillTpl(bdayTpl(), { parent: primaryName(b.s) || 'Parent', child: b.s.name, age: b.turns, school: S.settings.schoolName, phone: S.settings.phone || '', class: className(b.s.classId) });
      return '<li><span><b>' + esc(b.s.name) + '</b> · ' + esc(className(b.s.classId)) + '<small>' + (b.inDays === 0 ? '🎉 Today' : b.inDays === 1 ? 'Tomorrow' : fmtDate(b.date)) + ' · turns ' + b.turns + '</small></span>' +
        (validPhone(ph) ? '<a class="btn small wa-btn" href="' + esc(waHref(ph, msg)) + '" target="_blank" rel="noopener">' + WA_SVG + ' Wish</a>' : '<span class="muted small">No mobile</span>') + '</li>';
    }).join('') + '</ul>' : '<p class="muted">No birthdays in the next 7 days.</p>') + '</section>';
  }

  /* =====================================================================
   * BACKUP (Excel + JSON)
   * ===================================================================== */
  function backupDue() {
    if (!isAdmin()) return false;
    if (!S.students.length && !S.payments.length && !S.enquiries.length) return false;
    var d = daysAgo(S.settings.lastBackup);
    return d == null || d > 30;
  }
  function backupBannerHTML() {
    if (!backupDue()) return '';
    var d = daysAgo(S.settings.lastBackup);
    return '<a class="callout warn backup-banner" href="#/backup"><b>💾 ' + (d == null ? 'No backup downloaded yet' : 'Last backup was ' + d + ' days ago') + '</b><p>Tap here to download an Excel backup and keep it in Google Drive or email.</p></a>';
  }
  function viewBackup() {
    var st = S.settings, d = daysAgo(st.lastBackup);
    var html = backupBannerHTML();
    html += '<section class="card"><h2>💾 Download backup</h2><p class="muted">Your data is saved online in the school’s private database. A backup is an extra copy you keep yourself, for example in Google Drive or your email. Take one every month.</p>' +
      '<p class="backup-last">' + (st.lastBackup ? 'Last backup: <b>' + esc(fmtDate(st.lastBackup.slice(0, 10))) + '</b> (' + (d === 0 ? 'today' : d + ' day' + (d === 1 ? '' : 's') + ' ago') + ')' : 'No backup taken yet.') + '</p>' +
      '<div class="row gap wrap"><button class="btn primary big" data-act="backup-xlsx">⬇️ Download backup (Excel)</button><button class="btn ghost" data-act="backup">⬇️ Full backup (JSON)</button></div>' +
      '<p class="muted small">Excel has one sheet each for students, enquiries, payments, attendance, notices, expenses, salaries, staff, staff attendance and holidays. The JSON file is the complete copy that can be restored below.</p></section>';
    html += '<section class="card"><h3>📄 Single lists (CSV)</h3><div class="row gap wrap">' + ['students', 'attendance', 'payments', 'enquiries', 'staff'].map(function (t) { return '<button class="btn small ghost" data-act="csv" data-t="' + t + '">📄 ' + cap(t) + '</button>'; }).join('') + '</div></section>';
    html += '<section class="card"><h3>⬆️ Restore</h3><p class="muted small">Restoring adds the backup’s records to the online database and updates records with the same ID. It does not delete anything.</p><label class="btn ghost file-btn">⬆️ Restore from backup (JSON)<input type="file" accept=".json,application/json" data-change="restore" hidden></label></section>';
    html += '<p class="muted small">' + S.students.length + ' students · ' + S.payments.length + ' payments · ' + Object.keys(S.attendance).length + ' attendance days · ' + S.enquiries.length + ' enquiries · ' + S.expenses.length + ' expenses · ' + S.salaries.length + ' salary payments · ' + S.staff.length + ' staff.</p>' + syncInfoHTML();
    html += '<details class="danger-zone"><summary>This device</summary><p>Remove this phone’s offline copy and sign out. Online data is not affected. Unsynced changes on this phone would be lost.</p><button class="btn danger" data-act="erase">Clear this device &amp; sign out</button></details>';
    return html;
  }
  function backupSheets(notices) {
    var studs = S.students.slice().sort(function (a, b) { return a.classId === b.classId ? byName(a, b) : CLASSES.map(function (c) { return c.id; }).indexOf(a.classId) - CLASSES.map(function (c) { return c.id; }).indexOf(b.classId); });
    var sheets = [];
    sheets.push({ name: 'Students', rows: [['Name', 'Class', 'Section', 'Date of birth', 'Mother', 'Mother mobile', 'Father', 'Father mobile', 'Guardian', 'Guardian mobile', 'WhatsApp', 'Address', 'Admission date', 'Status', 'Yearly fee', 'Monthly fee', 'Sibling discount / month', 'Pending now', 'Emergency contact', 'Authorised pickup', 'Medical notes', 'Notes', 'ID']].concat(studs.map(function (s) {
      return [s.name, className(s.classId), s.section || '', s.dob || '', s.motherName || '', s.motherPhone || '', s.fatherName || '', s.fatherPhone || '', s.guardianName || '', s.guardianPhone || '', s.whatsapp || '', s.address || '', s.admissionDate || '', s.status || 'Active', num(s.yearlyFee), netMonthly(s), siblingDiscount(s), outstanding(s), s.emergency || '', s.pickup || '', s.medical || '', s.notes || '', s.id];
    })) });
    sheets.push({ name: 'Enquiries', rows: [['Date', 'Student', 'Date of birth', 'Father', 'Father mobile', 'Mother', 'Mother mobile', 'Parent (website)', 'Mobile', 'Address', 'Feedback', 'Source', 'Status', 'Follow-up', 'Notes', 'ID']].concat(S.enquiries.slice().sort(function (a, b) { return (a.date || '') < (b.date || '') ? -1 : 1; }).map(function (e) {
      return [e.date || '', e.childName || '', e.dob || '', e.fatherName || '', e.fatherPhone || '', e.motherName || '', e.motherPhone || '', e.parentName || '', e.phone || '', e.address || '', e.feedback || '', e.source || '', isConverted(e) ? 'Admitted' : (e.status || ''), e.followUp || '', e.notes || '', e.id];
    })) });
    sheets.push({ name: 'Payments', rows: [['Receipt no', 'Paid on', 'Student', 'Class', 'Parent', 'Fee for', 'Amount', 'Late fee incl.', 'Mode', 'Reference', 'Received by', 'Note', 'ID']].concat(S.payments.slice().sort(function (a, b) { return (a.seq || 0) - (b.seq || 0); }).map(function (p) {
      return [p.receiptNo || '', p.paidOn || '', p.studentName || '', className(p.classId), p.parentName || '', periodText(p), num(p.amount), num(p.lateFee) || '', p.mode || '', p.ref || '', p.receivedBy || '', p.note || '', p.id];
    })) });
    var att = [['Date', 'Class', 'Student', 'Status']];
    Object.keys(S.attendance).sort().forEach(function (d) { var rec = attFor(d); Object.keys(rec).forEach(function (id) { var s = studentById(id); att.push([d, s ? className(s.classId) : '', s ? s.name : '(deleted student)', ATT[rec[id]] ? ATT[rec[id]].label : rec[id]]); }); });
    sheets.push({ name: 'Attendance', rows: att });
    sheets.push({ name: 'Notices', rows: [['Date', 'Title', 'Message', 'For', 'Pinned', 'Show until', 'By']].concat((notices || []).map(function (n) {
      return [String(n.created_at || '').slice(0, 10), n.title || '', n.body || '', n.audience === 'all' ? 'Whole school' : className(n.audience), n.pinned ? 'Yes' : '', n.expires_on || '', n.author_name || ''];
    })) });
    sheets.push({ name: 'Expenses', rows: [['Date', 'Category', 'Amount', 'Mode', 'Note', 'ID']].concat(S.expenses.slice().sort(function (a, b) { return (a.date || '') < (b.date || '') ? -1 : 1; }).map(function (x) { return [x.date || '', x.category || '', num(x.amount), x.mode || '', x.note || '', x.id]; })) });
    sheets.push({ name: 'Salaries', rows: [['Month', 'Staff', 'Role', 'Monthly salary', 'Advance deducted', 'Other deduction', 'Bonus / extra', 'Paid', 'Paid on', 'Mode', 'Note', 'Slip no', 'ID']].concat(S.salaries.slice().sort(function (a, b) { return (a.month || '') + (a.staffName || '') < (b.month || '') + (b.staffName || '') ? -1 : 1; }).map(function (x) {
      return [x.month || '', x.staffName || '', x.role || '', num(x.base), num(x.advance), num(x.deduction), num(x.bonus), num(x.amount), x.paidOn || '', x.mode || '', x.note || '', x.slipNo || '', x.id];
    })) });
    sheets.push({ name: 'Staff', rows: [['Name', 'Role', 'Phone', 'Class', 'Monthly salary', 'Joined', 'Status', 'Notes', 'ID']].concat(S.staff.slice().sort(byName).map(function (s) { return [s.name, s.role || '', s.phone || '', s.classId ? className(s.classId) : '', num(s.salary), s.joined || '', s.status || 'Active', s.notes || '', s.id]; })) });
    var sa = [['Date', 'Staff', 'Status']];
    S.staff_attendance.slice().sort(function (a, b) { return a.id < b.id ? -1 : 1; }).forEach(function (r) { Object.keys(r).forEach(function (k) { if (k === 'id' || !SATT[r[k]]) return; var st = staffById(k); sa.push([r.id, st ? st.name : '(removed)', SATT[r[k]].label]); }); });
    sheets.push({ name: 'Staff attendance', rows: sa });
    sheets.push({ name: 'Holidays', rows: [['From', 'To', 'Title', 'Type']].concat(S.holidays.slice().sort(function (a, b) { return (a.from || '') < (b.from || '') ? -1 : 1; }).map(function (h) { return [h.from || '', holTo(h), h.title || '', h.type || 'Holiday']; })) });
    return sheets;
  }
  function fetchNoticesForBackup() {
    return PX.loadNotices(true).then(function () { return PX.notices(); }).catch(function () { return PX.notices() || []; });
  }
  function doBackupXlsx() {
    toast('Preparing Excel backup…');
    return fetchNoticesForBackup().then(function (notices) {
      if (!downloadXlsx('littlewings-backup-' + todayISO() + '.xlsx', backupSheets(notices))) return;
      S.settings.lastBackup = new Date().toISOString();
      persist('settings');
      toast('Excel backup downloaded — keep it somewhere safe');
      render();
    });
  }

  /* =====================================================================
   * HOLIDAYS & EVENTS
   * ===================================================================== */
  function viewHolidays() {
    var today = todayISO(), admin = isAdmin();
    var list = S.holidays.filter(function (h) { return isISODate(h.from); }).sort(function (a, b) { return a.from < b.from ? -1 : a.from > b.from ? 1 : 0; });
    var up = list.filter(function (h) { return holTo(h) >= today; }), past = list.filter(function (h) { return holTo(h) < today; }).reverse();
    var html = '<p class="note">🗓️ Sundays are always holidays. Days added here as <b>Holiday</b> are skipped on the Attendance page. <b>Events</b> are shown to parents but school is open.' + (admin ? ' Parents see this list in their app.' : '') + '</p>';
    if (admin) html += '<div class="toolbar"><button class="btn primary" data-act="hol-add">➕ Add holiday / event</button><button class="btn ghost" data-act="hol-presets">⭐ Add national holidays</button></div>';
    var item = function (h) {
      var off = h.type !== 'Event';
      return '<li class="hol-item ' + (off ? 'off' : 'ev') + '"><span class="hol-ic">' + (off ? '🎉' : '📌') + '</span><span class="hol-tx"><b>' + esc(h.title || 'Holiday') + '</b><small>' + esc(holRange(h)) + ' · ' + (off ? 'Holiday' : 'Event') + (h.note ? ' · ' + esc(h.note) : '') + '</small></span>' +
        (admin ? '<span class="row"><button class="icon-btn" data-act="hol-edit" data-id="' + esc(h.id) + '" title="Edit" aria-label="Edit">✏️</button><button class="icon-btn" data-act="hol-del" data-id="' + esc(h.id) + '" title="Delete" aria-label="Delete">🗑️</button></span>' : '') + '</li>';
    };
    html += '<section class="card"><h3>Coming up</h3>' + (up.length ? '<ul class="hol-list">' + up.map(item).join('') + '</ul>' : '<p class="muted">No upcoming holidays or events added.</p>') + '</section>';
    if (past.length) html += '<section class="card"><h3>Past</h3><ul class="hol-list">' + past.slice(0, 40).map(item).join('') + '</ul></section>';
    return html;
  }
  function openHolidayForm(h) {
    var v = Object.assign({ type: 'Holiday', from: todayISO() }, h || {});
    openModal({
      title: h ? 'Edit holiday / event' : 'Add holiday / event',
      body: '<form class="form" novalidate><div class="grid2">' +
        field('Title *', '<input name="title" maxlength="80" value="' + esc(v.title) + '" placeholder="e.g. Sankranti, Annual Day" required>', '', 'span2') +
        field('Type', '<select name="type">' + options([{ value: 'Holiday', label: '🎉 Holiday (school closed)' }, { value: 'Event', label: '📌 Event (school open)' }], v.type) + '</select>', '', 'span2') +
        field('From *', '<input type="date" name="from" value="' + esc(v.from) + '" required>') +
        field('To', '<input type="date" name="to" value="' + esc(v.to && v.to !== v.from ? v.to : '') + '">', '<small class="hint">Leave empty for one day</small>') +
        '</div>' + field('Note', '<input name="note" maxlength="120" value="' + esc(v.note) + '" placeholder="Optional">') +
        '<div class="form-actions"><button type="button" class="btn ghost" data-act="modal-close">Cancel</button><button class="btn primary">' + (h ? 'Save' : 'Add') + '</button></div></form>',
      onSubmit: function (form, fd) {
        var g = function (k) { return String(fd.get(k) == null ? '' : fd.get(k)).trim(); };
        var d = { title: g('title'), type: g('type') === 'Event' ? 'Event' : 'Holiday', from: g('from'), to: g('to'), note: g('note') };
        var ok = true;
        if (d.title.length < 2) { fieldError(form, 'title', 'Enter a title'); ok = false; }
        if (!isISODate(d.from)) { fieldError(form, 'from', 'Choose a date'); ok = false; }
        if (d.to && (!isISODate(d.to) || d.to < d.from)) { fieldError(form, 'to', 'End date must be on or after the start'); ok = false; }
        if (d.to && isISODate(d.from) && daysBetween(d.from, d.to) > 62) { fieldError(form, 'to', 'Keep it to 2 months at most'); ok = false; }
        if (!ok) return false;
        if (!d.to) d.to = d.from;
        if (h) Object.assign(h, d, { updatedAt: new Date().toISOString() });
        else S.holidays.push(Object.assign({ id: uid(), createdAt: new Date().toISOString() }, d));
        persist('holidays');
        toast(h ? 'Saved' : d.title + ' added');
        render();
        return true;
      }
    });
  }
  function addPresetHolidays() {
    var y = +todayISO().slice(0, 4), today = todayISO();
    var presets = [];
    [y, y + 1].forEach(function (yy) {
      presets.push({ title: 'Sankranti holidays', from: yy + '-01-13', to: yy + '-01-15' }, { title: 'Republic Day', from: yy + '-01-26', to: yy + '-01-26' },
        { title: 'Independence Day', from: yy + '-08-15', to: yy + '-08-15' }, { title: 'Gandhi Jayanti', from: yy + '-10-02', to: yy + '-10-02' }, { title: 'Christmas', from: yy + '-12-25', to: yy + '-12-25' });
    });
    var add = presets.filter(function (p) { return p.to >= today && p.from <= addMonths(today.slice(0, 7), 12) + '-31' && !S.holidays.some(function (h) { return h.from === p.from && (h.title || '').toLowerCase() === p.title.toLowerCase(); }); });
    if (!add.length) { toast('National holidays for the next 12 months are already added'); return; }
    confirmBox('Add ' + add.length + ' holidays: ' + add.map(function (p) { return p.title + ' (' + fmtDate(p.from) + ')'; }).join(', ') + '? Festival dates like Diwali and Ugadi change every year, so add those yourself.', { ok: 'Add holidays', danger: false, title: 'Add national holidays' }).then(function (ok) {
      if (!ok) return;
      add.forEach(function (p) { S.holidays.push(Object.assign({ id: uid(), type: 'Holiday', createdAt: new Date().toISOString() }, p)); });
      persist('holidays'); toast(add.length + ' holidays added'); render();
    });
  }

  /* =====================================================================
   * EXPENSES
   * ===================================================================== */
  function expensesIn(ym) { return S.expenses.filter(function (x) { return (x.date || '').slice(0, 7) === ym; }); }
  function sumAmt(list, k) { return round2(list.reduce(function (a, x) { return a + num(x[k || 'amount']); }, 0)); }
  function viewExpenses() {
    if (!isMonth(UI.expMonth)) UI.expMonth = thisMonth();
    var ym = UI.expMonth, list = expensesIn(ym).sort(function (a, b) { return (b.date || '') < (a.date || '') ? -1 : 1; });
    var total = sumAmt(list), prev = sumAmt(expensesIn(addMonths(ym, -1)));
    var cats = EXP_CATS.map(function (c, i) { return { label: c, value: sumAmt(list.filter(function (x) { return x.category === c; })), color: EXP_COLORS[i] }; }).filter(function (c) { return c.value > 0; });
    var html = '<div class="toolbar">' + field('Month', '<input type="month" value="' + ym + '" data-change="exp-month">') + '<button class="btn primary" data-act="exp-add">➕ Add expense</button></div>';
    html += '<div class="stats">' + stat('🧾', 'Expenses in ' + fmtMonth(ym), inr(total), list.length + ' entr' + (list.length === 1 ? 'y' : 'ies'), 'coral') +
      stat('📅', fmtMonth(addMonths(ym, -1)), inr(prev), 'Previous month', 'sky') +
      stat('💸', 'Salaries paid', inr(sumAmt(S.salaries.filter(function (x) { return x.month === ym; }))), 'Recorded on the Staff page', 'yellow') + '</div>';
    if (cats.length) html += '<section class="card"><h3>By category</h3>' + barsHTML(cats, inr) + '</section>';
    if (!list.length) return html + emptyState('🧾', 'No expenses in ' + fmtMonth(ym), 'Add rent, electricity, stationery, snacks and other spends to see monthly profit in Reports.', '<button class="btn primary" data-act="exp-add">➕ Add expense</button>');
    html += '<div class="table-wrap"><table class="table responsive"><thead><tr><th>Date</th><th>Category</th><th>Note</th><th>Mode</th><th class="num">Amount</th><th class="act-col"><span class="sr">Actions</span></th></tr></thead><tbody>' +
      list.map(function (x) {
        return '<tr><td data-label="Date">' + fmtDate(x.date) + '</td><td data-label="Category"><b>' + esc(x.category) + '</b></td><td data-label="Note">' + esc(x.note || '—') + '</td><td data-label="Mode">' + esc(x.mode || '—') + '</td><td data-label="Amount" class="num"><b>' + inr(x.amount) + '</b></td>' +
          '<td class="actions"><button class="icon-btn" data-act="exp-edit" data-id="' + esc(x.id) + '" title="Edit" aria-label="Edit">✏️</button><button class="icon-btn" data-act="exp-del" data-id="' + esc(x.id) + '" title="Delete" aria-label="Delete">🗑️</button></td></tr>';
      }).join('') + '</tbody></table></div>';
    return html;
  }
  function openExpenseForm(x) {
    var v = Object.assign({ date: todayISO(), category: 'Rent', mode: 'Cash' }, x || {});
    openModal({
      title: x ? 'Edit expense' : 'Add expense',
      body: '<form class="form" novalidate><div class="grid2">' +
        field('Date *', '<input type="date" name="date" max="' + todayISO() + '" value="' + esc(v.date) + '" required>') +
        field('Category *', '<select name="category">' + options(EXP_CATS, v.category) + '</select>') +
        field('Amount (₹) *', '<input type="number" name="amount" min="1" max="10000000" step="1" inputmode="numeric" value="' + esc(v.amount == null ? '' : v.amount) + '" required>') +
        field('Paid by', '<select name="mode">' + options(PAY_MODES, v.mode) + '</select>') +
        '</div>' + field('Note', '<input name="note" maxlength="160" value="' + esc(v.note) + '" placeholder="e.g. November rent, chart papers">') +
        '<div class="form-actions"><button type="button" class="btn ghost" data-act="modal-close">Cancel</button><button class="btn primary">' + (x ? 'Save' : 'Add expense') + '</button></div></form>',
      onSubmit: function (form, fd) {
        var g = function (k) { return String(fd.get(k) == null ? '' : fd.get(k)).trim(); };
        var d = { date: g('date'), category: EXP_CATS.indexOf(g('category')) >= 0 ? g('category') : 'Other', amount: round2(+g('amount')), mode: PAY_MODES.indexOf(g('mode')) >= 0 ? g('mode') : 'Cash', note: g('note') };
        var ok = true;
        if (!isISODate(d.date) || d.date > todayISO()) { fieldError(form, 'date', 'Choose a valid date (not in the future)'); ok = false; }
        if (!(d.amount > 0) || d.amount > 10000000) { fieldError(form, 'amount', 'Enter an amount greater than ₹0'); ok = false; }
        if (!ok) return false;
        if (x) Object.assign(x, d, { updatedAt: new Date().toISOString() });
        else S.expenses.push(Object.assign({ id: uid(), createdAt: new Date().toISOString() }, d));
        persist('expenses');
        UI.expMonth = d.date.slice(0, 7);
        toast(x ? 'Expense updated' : 'Expense added · ' + inr(d.amount));
        render();
        return true;
      }
    });
  }

  /* =====================================================================
   * STAFF: SALARY + STAFF ATTENDANCE
   * ===================================================================== */
  function activeStaff() { return S.staff.filter(function (s) { return s.status !== 'Left'; }).sort(byName); }
  function salaryPaid(staffId, ym) { return S.salaries.filter(function (x) { return x.staffId === staffId && x.month === ym; }); }
  function staffAttRec(date) { return S.staff_attendance.filter(function (r) { return r.id === date; })[0] || null; }
  function staffAttMonth(staffId, ym) {
    var c = { P: 0, A: 0, H: 0 };
    S.staff_attendance.forEach(function (r) { if (String(r.id).slice(0, 7) === ym && SATT[r[staffId]]) c[r[staffId]]++; });
    return c;
  }
  function staffTabs() {
    var tabs = [['list', '👩‍🏫 Staff'], ['salary', '💸 Salary'], ['att', '✅ Attendance']];
    return '<div class="seg-tabs">' + tabs.map(function (t) { return '<button type="button" class="' + ((UI.staffTab || 'list') === t[0] ? 'active' : '') + '" data-act="staff-tab" data-tab="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>';
  }
  function viewSalary() {
    if (!isMonth(UI.salMonth)) UI.salMonth = thisMonth();
    var ym = UI.salMonth, staff = activeStaff();
    var recs = S.salaries.filter(function (x) { return x.month === ym; });
    var due = staff.reduce(function (a, s) { return a + num(s.salary); }, 0), paid = sumAmt(recs);
    var html = '<div class="toolbar">' + field('Salary month', '<input type="month" value="' + ym + '" data-change="sal-month">') + '</div>';
    html += '<div class="stats">' + stat('💸', 'Paid for ' + fmtMonth(ym), inr(paid), recs.length + ' payment' + (recs.length === 1 ? '' : 's'), 'green') +
      stat('📋', 'Monthly salaries', inr(due), staff.length + ' active staff', 'sky') +
      stat('⏳', 'Not paid yet', String(staff.filter(function (s) { return num(s.salary) > 0 && !salaryPaid(s.id, ym).length; }).length), 'staff for ' + fmtMonth(ym), 'coral') + '</div>';
    if (!staff.length) return html + emptyState('👩‍🏫', 'No staff yet', 'Add staff first, with their monthly salary.', '<button class="btn primary" data-act="staff-add">➕ Add staff</button>');
    html += '<div class="pf-list">' + staff.map(function (s) {
      var list = salaryPaid(s.id, ym), got = sumAmt(list), a = staffAttMonth(s.id, ym);
      return '<article class="pf-card' + (list.length ? ' paid' : '') + '"><div class="pf-top"><div><b>' + esc(s.name) + '</b><small>' + esc(s.role || '') + ' · salary ' + (num(s.salary) ? inr(s.salary) : '—') + (a.P + a.A + a.H ? ' · present ' + (a.P + a.H / 2) + ' d, absent ' + a.A + ' d' : '') + '</small></div>' +
        (list.length ? '<b class="pf-amt green-t">' + inr(got) + '</b>' : '<span class="tag">Not paid</span>') + '</div>' +
        (list.length ? '<ul class="mini-list">' + list.map(function (x) {
          return '<li><span>' + inr(x.amount) + ' · ' + esc(x.mode || '') + '<small>' + fmtDate(x.paidOn) + (num(x.advance) ? ' · advance −' + inr(x.advance) : '') + (num(x.deduction) ? ' · deduction −' + inr(x.deduction) : '') + (num(x.bonus) ? ' · bonus +' + inr(x.bonus) : '') + (x.note ? ' · ' + esc(x.note) : '') + '</small></span><span class="row"><button class="icon-btn" data-act="sal-slip" data-id="' + esc(x.id) + '" title="Salary slip" aria-label="Salary slip">🧾</button><button class="icon-btn" data-act="sal-del" data-id="' + esc(x.id) + '" title="Delete" aria-label="Delete">🗑️</button></span></li>';
        }).join('') + '</ul>' : '') +
        '<div class="pf-foot"><span></span><button class="btn small ' + (list.length ? 'ghost' : 'primary') + '" data-act="sal-pay" data-id="' + esc(s.id) + '">' + (list.length ? '➕ Add payment' : '💸 Pay salary') + '</button></div></article>';
    }).join('') + '</div>';
    return html;
  }
  function openSalaryForm(staffId) {
    var s = staffById(staffId);
    if (!s) return;
    var ym = UI.salMonth || thisMonth(), already = sumAmt(salaryPaid(s.id, ym));
    var base = num(s.salary);
    openModal({
      title: 'Pay salary · ' + s.name, size: 'wide',
      body: '<form class="form" novalidate><div class="grid2">' +
        field('Salary month *', '<input type="month" name="month" value="' + esc(ym) + '" required>') +
        field('Monthly salary (₹)', '<input type="number" name="base" min="0" step="1" inputmode="numeric" value="' + esc(base || '') + '">') +
        field('Advance deducted (₹)', '<input type="number" name="advance" min="0" step="1" inputmode="numeric" value="">') +
        field('Other deduction (₹)', '<input type="number" name="deduction" min="0" step="1" inputmode="numeric" value="" placeholder="e.g. leave">') +
        field('Bonus / extra (₹)', '<input type="number" name="bonus" min="0" step="1" inputmode="numeric" value="">') +
        field('Amount paid (₹) *', '<input type="number" name="amount" min="1" step="1" inputmode="numeric" value="' + esc(Math.max(0, base - already) || '') + '" required>', '<small class="hint" id="sal-hint"></small>') +
        field('Paid on *', '<input type="date" name="paidOn" max="' + todayISO() + '" value="' + todayISO() + '" required>') +
        field('Mode', '<select name="mode">' + options(PAY_MODES, 'Cash') + '</select>') +
        '</div>' + field('Note (advance / deduction details)', '<input name="note" maxlength="160" placeholder="e.g. ₹1,000 advance taken on 5th">') +
        (already ? '<p class="note">Already paid for ' + esc(fmtMonth(ym)) + ': ' + inr(already) + '</p>' : '') +
        '<div class="form-actions"><button type="button" class="btn ghost" data-act="modal-close">Cancel</button><button class="btn primary">Save &amp; get slip</button></div></form>',
      mount: function (root) {
        var f = $('form', root), amt = $('[name=amount]', f), touched = false;
        amt.addEventListener('input', function () { touched = true; });
        function upd() {
          var n = function (k) { return num($('[name=' + k + ']', f).value); };
          var net = Math.max(0, n('base') - n('advance') - n('deduction') + n('bonus') - (already || 0));
          $('#sal-hint', f).textContent = 'Salary − advance − deduction + bonus' + (already ? ' − already paid' : '') + ' = ' + inr(net);
          if (!touched) amt.value = net || '';
        }
        ['base', 'advance', 'deduction', 'bonus'].forEach(function (k) { $('[name=' + k + ']', f).addEventListener('input', upd); });
        upd();
      },
      onSubmit: function (form, fd) {
        var g = function (k) { return String(fd.get(k) == null ? '' : fd.get(k)).trim(); };
        var d = { staffId: s.id, staffName: s.name, role: s.role || '', month: g('month'), base: round2(+g('base') || 0), advance: round2(+g('advance') || 0), deduction: round2(+g('deduction') || 0), bonus: round2(+g('bonus') || 0), amount: round2(+g('amount')), paidOn: g('paidOn'), mode: PAY_MODES.indexOf(g('mode')) >= 0 ? g('mode') : 'Cash', note: g('note') };
        var ok = true;
        if (!isMonth(d.month)) { fieldError(form, 'month', 'Choose the month'); ok = false; }
        if (!(d.amount > 0) || d.amount > 10000000) { fieldError(form, 'amount', 'Enter an amount greater than ₹0'); ok = false; }
        if (!isISODate(d.paidOn) || d.paidOn > todayISO()) { fieldError(form, 'paidOn', 'Choose a valid date (not in the future)'); ok = false; }
        if ([d.base, d.advance, d.deduction, d.bonus].some(function (v) { return v < 0; })) { fieldError(form, 'base', 'Amounts can’t be negative'); ok = false; }
        if (!ok) return false;
        var seq = S.salaries.reduce(function (m, x) { return Math.max(m, parseInt(x.seq, 10) || 0); }, 0) + 1;
        var rec = Object.assign({ id: uid(), seq: seq, slipNo: 'SAL-' + String(seq).padStart(4, '0'), createdAt: new Date().toISOString(), by: (ME && ME.name) || '' }, d);
        S.salaries.push(rec);
        persist('salaries');
        UI.salMonth = d.month;
        toast('Salary saved · ' + inr(d.amount));
        render();
        setTimeout(function () { openSalarySlip(rec.id); }, 0);
        return true;
      }
    });
  }
  function salarySlipHTML(x) {
    var a = staffAttMonth(x.staffId, x.month), wd = workingDays(x.month).length;
    var row = function (k, v) { return '<tr><th>' + esc(k) + '</th><td>' + v + '</td></tr>'; };
    return '<div class="slip"><div class="slip-meta"><span>Slip no. <b>' + esc(x.slipNo || '—') + '</b></span><span>Month <b>' + esc(fmtMonth(x.month)) + '</b></span><span>Paid on <b>' + esc(fmtDate(x.paidOn)) + '</b></span></div>' +
      '<table class="slip-tbl"><tbody>' + row('Name', '<b>' + esc(x.staffName) + '</b>') + row('Role', esc(x.role || '—')) +
      (a.P + a.A + a.H ? row('Attendance', 'Present ' + (a.P + a.H / 2) + ' day(s), absent ' + a.A + ' (working days so far: ' + wd + ')') : '') +
      row('Monthly salary', inr(x.base)) + (num(x.advance) ? row('Advance deducted', '− ' + inr(x.advance)) : '') + (num(x.deduction) ? row('Other deduction', '− ' + inr(x.deduction)) : '') + (num(x.bonus) ? row('Bonus / extra', '+ ' + inr(x.bonus)) : '') +
      row('Payment mode', esc(x.mode || '—')) + (x.note ? row('Note', esc(x.note)) : '') + '</tbody></table>' +
      '<div class="lwr-amount"><div class="lwr-amt"><small>Amount paid</small><b>' + inr(x.amount) + '</b></div><div class="lwr-words"><small>Amount in words</small><b>Rupees ' + esc(inWords(x.amount)) + ' Only</b></div></div>' +
      '<div class="slip-sign"><div>Employee signature</div><div>For ' + esc(S.settings.schoolName) + '</div></div></div>';
  }
  function openSalarySlip(id) {
    var x = S.salaries.filter(function (r) { return r.id === id; })[0];
    if (!x) return;
    openModal({ title: 'Salary slip · ' + x.staffName, size: 'wide', body: '<div class="slip-preview">' + salarySlipHTML(x) + '</div><div class="receipt-actions"><button type="button" class="btn primary" data-act="sal-print" data-id="' + esc(x.id) + '">🖨️ Print / Save as PDF</button></div>' });
  }
  function viewStaffAtt() {
    if (!isISODate(UI.sattDate) || UI.sattDate > todayISO()) UI.sattDate = todayISO();
    var date = UI.sattDate, staff = activeStaff(), rec = staffAttRec(date) || {};
    if (!UI.sattDraft || UI.sattDraft.date !== date) { UI.sattDraft = { date: date, data: {}, dirty: false }; staff.forEach(function (s) { if (SATT[rec[s.id]]) UI.sattDraft.data[s.id] = rec[s.id]; }); }
    var dr = UI.sattDraft, off = offDay(date);
    var html = '<div class="toolbar">' + field('Date', '<input type="date" max="' + todayISO() + '" value="' + date + '" data-change="satt-date">') + '<button type="button" class="btn ghost" data-act="satt-all">✔ All present</button></div>';
    if (off) html += '<p class="note">🎉 ' + esc(off) + ' — school holiday.</p>';
    if (!staff.length) return html + emptyState('👩‍🏫', 'No staff yet', 'Add staff to mark their attendance.');
    html += '<div class="roster">' + staff.map(function (s) {
      var cur = dr.data[s.id];
      return '<div class="roster-row"><div class="who"><b>' + esc(s.name) + '</b><small>' + esc(s.role || '') + '</small></div><div class="seg seg3" role="group">' +
        ['P', 'A', 'H'].map(function (k) { return '<button type="button" class="seg-btn ' + SATT[k].cls + (cur === k ? ' on' : '') + '" data-act="satt-set" data-sid="' + esc(s.id) + '" data-v="' + k + '" aria-pressed="' + (cur === k) + '"><b>' + k + '</b><span>' + SATT[k].label + '</span></button>'; }).join('') + '</div></div>';
    }).join('') + '</div>';
    html += '<div class="sticky-save"><button type="button" class="btn primary big block" data-act="satt-save">💾 Save staff attendance' + (dr.dirty ? ' •' : '') + '</button></div>';
    var ym = date.slice(0, 7);
    html += '<section class="card"><h3>' + esc(fmtMonth(ym)) + ' summary</h3><div class="table-wrap"><table class="table"><thead><tr><th>Staff</th><th class="num">Present</th><th class="num">Absent</th><th class="num">Half-day</th></tr></thead><tbody>' +
      staff.map(function (s) { var c = staffAttMonth(s.id, ym); return '<tr><td>' + esc(s.name) + '</td><td class="num">' + c.P + '</td><td class="num">' + c.A + '</td><td class="num">' + c.H + '</td></tr>'; }).join('') + '</tbody></table></div><p class="muted small">Working days in ' + esc(fmtMonth(ym)) + ' so far: ' + workingDays(ym).length + ' (Sundays and holidays left out).</p></section>';
    return html;
  }

  /* =====================================================================
   * REPORTS
   * ===================================================================== */
  function last12(ym) { var out = []; for (var i = 11; i >= 0; i--) out.push(addMonths(ym, -i)); return out; }
  function feeMonthStats(ym, classId) {
    var r = { expected: 0, collected: 0, pending: 0, students: 0 };
    S.students.forEach(function (s) {
      if (classId && s.classId !== classId) return;
      if (!feeApplies(s, ym)) return;
      var c = chargeFor(s, ym), p = paidFor(s.id, ym);
      r.students++; r.expected += c; r.collected += Math.min(c, p); r.pending += Math.max(0, c - p);
    });
    r.expected = round2(r.expected); r.collected = round2(r.collected); r.pending = round2(r.pending);
    return r;
  }
  function cashIn(ym) { return round2(S.payments.reduce(function (a, p) { return a + ((p.paidOn || '').slice(0, 7) === ym ? num(p.amount) : 0); }, 0)); }
  function salariesIn(ym) { return round2(S.salaries.reduce(function (a, x) { return a + ((x.paidOn || '').slice(0, 7) === ym ? num(x.amount) : 0); }, 0)); }
  function pctOf(a, b) { return b ? Math.round(a / b * 100) : null; }
  function reportFees(ym) {
    var months = last12(ym);
    var rows = months.map(function (m) { var f = feeMonthStats(m); return { m: m, f: f, cash: cashIn(m) }; });
    var byClass = CLASSES.map(function (c) { return { c: c, f: feeMonthStats(ym, c.id) }; });
    var cur = feeMonthStats(ym);
    var html = '<div class="stats">' + stat('📋', 'Expected for ' + fmtMonth(ym), inr(cur.expected), cur.students + ' students', 'sky') + stat('✅', 'Collected', inr(cur.collected), (pctOf(cur.collected, cur.expected) == null ? '—' : pctOf(cur.collected, cur.expected) + '%') + ' of expected', 'green') + stat('⏳', 'Pending', inr(cur.pending), fmtMonth(ym), 'coral') + '</div>';
    html += '<section class="card"><h3>Money received (by payment date)</h3>' + columnSVG(rows.slice(-6).map(function (r) { return { label: MONTHS[+r.m.slice(5) - 1], value: r.cash, display: r.cash >= 1000 ? Math.round(r.cash / 100) / 10 + 'k' : String(r.cash), color: '#6cc48a' }; }), 'Money received per month') + '</section>';
    html += '<section class="card"><h3>' + esc(fmtMonth(ym)) + ' by class</h3><div class="table-wrap scroll-x"><table class="table rep"><thead><tr><th>Class</th><th class="num">Students</th><th class="num">Expected</th><th class="num">Collected</th><th class="num">Pending</th></tr></thead><tbody>' +
      byClass.map(function (x) { return '<tr><td>' + x.c.emoji + ' ' + esc(x.c.name) + '</td><td class="num">' + x.f.students + '</td><td class="num">' + inr(x.f.expected) + '</td><td class="num">' + inr(x.f.collected) + '</td><td class="num coral-t">' + inr(x.f.pending) + '</td></tr>'; }).join('') +
      '<tr class="tot"><td>Total</td><td class="num">' + cur.students + '</td><td class="num">' + inr(cur.expected) + '</td><td class="num">' + inr(cur.collected) + '</td><td class="num">' + inr(cur.pending) + '</td></tr></tbody></table></div></section>';
    html += '<section class="card"><h3>Month by month</h3><div class="table-wrap scroll-x"><table class="table rep"><thead><tr><th>Month</th><th class="num">Expected</th><th class="num">Collected</th><th class="num">Pending</th><th class="num">Received</th></tr></thead><tbody>' +
      rows.slice().reverse().map(function (r) { return '<tr><td>' + esc(fmtMonth(r.m)) + '</td><td class="num">' + inr(r.f.expected) + '</td><td class="num">' + inr(r.f.collected) + '</td><td class="num coral-t">' + inr(r.f.pending) + '</td><td class="num">' + inr(r.cash) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
      '<p class="muted small">Expected, collected and pending are for that fee month. Received is money actually received in that month (by payment date), including advance payments.</p></section>';
    var sheet = [['Month', 'Expected', 'Collected', 'Pending', 'Received (by payment date)']].concat(rows.map(function (r) { return [fmtMonth(r.m), r.f.expected, r.f.collected, r.f.pending, r.cash]; }));
    sheet.push([]); sheet.push([fmtMonth(ym) + ' by class', 'Students', 'Expected', 'Collected', 'Pending']);
    byClass.forEach(function (x) { sheet.push([x.c.name, x.f.students, x.f.expected, x.f.collected, x.f.pending]); });
    return { title: 'Fee collection report · ' + fmtMonth(ym), html: html, sheets: [{ name: 'Fees', rows: sheet }] };
  }
  function attMonthStats(s, ym) {
    var c = { P: 0, A: 0, L: 0, H: 0, m: 0 };
    Object.keys(S.attendance).forEach(function (d) { if (d.slice(0, 7) === ym) { var v = attFor(d)[s.id]; if (v && c[v] != null) { c[v]++; c.m++; } } });
    c.pct = c.m ? Math.round((c.P + 0.5 * c.H) / c.m * 100) : null;
    return c;
  }
  function reportAttendance(ym) {
    var wd = workingDays(ym).length;
    var per = CLASSES.map(function (c) {
      var list = activeStudents(c.id), t = { P: 0, H: 0, m: 0 };
      var rows = list.map(function (s) { var a = attMonthStats(s, ym); t.P += a.P; t.H += a.H; t.m += a.m; return { s: s, a: a }; });
      return { c: c, rows: rows, pct: t.m ? Math.round((t.P + 0.5 * t.H) / t.m * 100) : null };
    });
    var html = '<p class="note">Working days in ' + esc(fmtMonth(ym)) + (ym === thisMonth() ? ' so far' : '') + ': <b>' + wd + '</b> (Sundays and holidays left out). % = present + half of half-days, out of days marked.</p>';
    html += '<section class="card"><h3>By class</h3>' + barsHTML(per.map(function (x) { return { label: x.c.name, value: x.pct || 0, color: x.c.color }; }), function (v) { return v + '%'; }) + '</section>';
    html += per.filter(function (x) { return x.rows.length; }).map(function (x) {
      return '<section class="card"><h3>' + x.c.emoji + ' ' + esc(x.c.name) + ' <small class="muted">' + (x.pct == null ? 'not marked' : x.pct + '%') + '</small></h3><div class="table-wrap scroll-x"><table class="table rep"><thead><tr><th>Student</th><th class="num">P</th><th class="num">A</th><th class="num">L</th><th class="num">H</th><th class="num">%</th></tr></thead><tbody>' +
        x.rows.map(function (r) { return '<tr><td>' + esc(r.s.name) + '</td><td class="num">' + r.a.P + '</td><td class="num">' + r.a.A + '</td><td class="num">' + r.a.L + '</td><td class="num">' + r.a.H + '</td><td class="num"><b' + (r.a.pct != null && r.a.pct < 75 ? ' class="coral-t"' : '') + '>' + (r.a.pct == null ? '—' : r.a.pct + '%') + '</b></td></tr>'; }).join('') + '</tbody></table></div></section>';
    }).join('');
    if (!per.some(function (x) { return x.rows.length; })) html += emptyState('🌱', 'No students yet', 'Add students to see attendance reports.');
    var sheet = [['Class', 'Student', 'Present', 'Absent', 'Leave', 'Half-day', 'Days marked', 'Attendance %']];
    per.forEach(function (x) { x.rows.forEach(function (r) { sheet.push([x.c.name, r.s.name, r.a.P, r.a.A, r.a.L, r.a.H, r.a.m, r.a.pct == null ? '' : r.a.pct]); }); });
    sheet.push([]); sheet.push(['Class', 'Attendance %', 'Working days']);
    per.forEach(function (x) { sheet.push([x.c.name, x.pct == null ? '' : x.pct, wd]); });
    return { title: 'Attendance report · ' + fmtMonth(ym), html: html, sheets: [{ name: 'Attendance ' + fmtMonth(ym), rows: sheet }] };
  }
  function reportEnquiries(ym) {
    var months = last12(ym), from = months[0];
    var inWin = S.enquiries.filter(function (e) { var m = (e.date || '').slice(0, 7); return m >= from && m <= ym; });
    var rows = months.map(function (m) { var l = S.enquiries.filter(function (e) { return (e.date || '').slice(0, 7) === m; }); var a = l.filter(isConverted).length; return { m: m, n: l.length, a: a, web: l.filter(function (e) { return e.source === 'Website'; }).length, pct: pctOf(a, l.length) }; });
    var fb = ['Interested', 'Doubtful', ''].map(function (f) { var l = inWin.filter(function (e) { return enqFeedback(e) === f; }); var a = l.filter(isConverted).length; return { label: f || 'No feedback', n: l.length, a: a, pct: pctOf(a, l.length) }; });
    var src = ENQ_SOURCES.map(function (s) { var l = inWin.filter(function (e) { return e.source === s; }); return { label: s, n: l.length, a: l.filter(isConverted).length }; }).filter(function (x) { return x.n; });
    var tn = inWin.length, ta = inWin.filter(isConverted).length;
    var html = '<div class="stats">' + stat('📝', 'Enquiries (12 months)', String(tn), fmtMonth(from) + ' – ' + fmtMonth(ym), 'sky') + stat('🎓', 'Admitted', String(ta), (pctOf(ta, tn) == null ? '—' : pctOf(ta, tn) + '%') + ' conversion', 'green') + stat('🌐', 'From website', String(inWin.filter(function (e) { return e.source === 'Website'; }).length), 'Website form', 'purple') + '</div>';
    html += '<section class="card"><h3>By feedback</h3><div class="table-wrap scroll-x"><table class="table rep"><thead><tr><th>Feedback</th><th class="num">Enquiries</th><th class="num">Admitted</th><th class="num">Conversion</th></tr></thead><tbody>' +
      fb.map(function (x) { return '<tr><td>' + esc(x.label) + '</td><td class="num">' + x.n + '</td><td class="num">' + x.a + '</td><td class="num">' + (x.pct == null ? '—' : x.pct + '%') + '</td></tr>'; }).join('') + '</tbody></table></div></section>';
    if (src.length) html += '<section class="card"><h3>By source</h3>' + barsHTML(src.map(function (x, i) { return { label: x.label, value: x.n, color: EXP_COLORS[i % EXP_COLORS.length] }; })) + '</section>';
    html += '<section class="card"><h3>Month by month</h3><div class="table-wrap scroll-x"><table class="table rep"><thead><tr><th>Month</th><th class="num">Enquiries</th><th class="num">Admitted</th><th class="num">Conv.</th><th class="num">Web</th></tr></thead><tbody>' +
      rows.slice().reverse().map(function (r) { return '<tr><td>' + esc(fmtMonth(r.m)) + '</td><td class="num">' + r.n + '</td><td class="num">' + r.a + '</td><td class="num">' + (r.pct == null ? '—' : r.pct + '%') + '</td><td class="num">' + r.web + '</td></tr>'; }).join('') + '</tbody></table></div></section>';
    var sheet = [['Month', 'Enquiries', 'Admitted', 'Conversion %', 'From website']].concat(rows.map(function (r) { return [fmtMonth(r.m), r.n, r.a, r.pct == null ? '' : r.pct, r.web]; }));
    sheet.push([]); sheet.push(['Feedback', 'Enquiries', 'Admitted', 'Conversion %']);
    fb.forEach(function (x) { sheet.push([x.label, x.n, x.a, x.pct == null ? '' : x.pct]); });
    return { title: 'Enquiry → admission report · ' + fmtMonth(from) + ' – ' + fmtMonth(ym), html: html, sheets: [{ name: 'Enquiries', rows: sheet }] };
  }
  function reportProfit(ym) {
    var months = last12(ym);
    var rows = months.map(function (m) { var c = cashIn(m), e = sumAmt(expensesIn(m)), sa = salariesIn(m); return { m: m, c: c, e: e, s: sa, p: round2(c - e - sa) }; });
    var cur = rows[rows.length - 1];
    var cats = EXP_CATS.map(function (c, i) { return { label: c, value: sumAmt(expensesIn(ym).filter(function (x) { return x.category === c; })), color: EXP_COLORS[i] }; }).filter(function (x) { return x.value > 0; });
    var tot = rows.reduce(function (a, r) { a.c += r.c; a.e += r.e; a.s += r.s; a.p += r.p; return a; }, { c: 0, e: 0, s: 0, p: 0 });
    var html = '<div class="stats">' + stat('💰', 'Fees received', inr(cur.c), fmtMonth(ym), 'green') + stat('🧾', 'Expenses', inr(cur.e), 'Rent, snacks, etc.', 'coral') + stat('💸', 'Salaries', inr(cur.s), 'Paid in ' + fmtMonth(ym), 'yellow') + stat(cur.p >= 0 ? '📈' : '📉', cur.p >= 0 ? 'Profit' : 'Loss', inr(Math.abs(cur.p)), fmtMonth(ym), cur.p >= 0 ? 'sky' : 'coral') + '</div>';
    if (cats.length) html += '<section class="card"><h3>' + esc(fmtMonth(ym)) + ' expenses by category</h3>' + barsHTML(cats, inr) + '</section>';
    html += '<section class="card"><h3>Collection vs expenses vs profit</h3><div class="table-wrap scroll-x"><table class="table rep"><thead><tr><th>Month</th><th class="num">Fees received</th><th class="num">Expenses</th><th class="num">Salaries</th><th class="num">Profit</th></tr></thead><tbody>' +
      rows.slice().reverse().map(function (r) { return '<tr><td>' + esc(fmtMonth(r.m)) + '</td><td class="num">' + inr(r.c) + '</td><td class="num">' + inr(r.e) + '</td><td class="num">' + inr(r.s) + '</td><td class="num"><b class="' + (r.p < 0 ? 'coral-t' : 'green-t') + '">' + inr(r.p) + '</b></td></tr>'; }).join('') +
      '<tr class="tot"><td>12 months</td><td class="num">' + inr(tot.c) + '</td><td class="num">' + inr(tot.e) + '</td><td class="num">' + inr(tot.s) + '</td><td class="num">' + inr(tot.p) + '</td></tr></tbody></table></div><p class="muted small">Cash basis: fees by payment date, expenses by date, salaries by paid-on date.</p></section>';
    var sheet = [['Month', 'Fees received', 'Expenses', 'Salaries', 'Profit']].concat(rows.map(function (r) { return [fmtMonth(r.m), r.c, r.e, r.s, r.p]; }));
    sheet.push(['12 months', round2(tot.c), round2(tot.e), round2(tot.s), round2(tot.p)]);
    return { title: 'Collection vs expenses vs profit · ' + fmtMonth(months[0]) + ' – ' + fmtMonth(ym), html: html, sheets: [{ name: 'Profit', rows: sheet }] };
  }
  var REPORTS = { fees: ['💰 Fees', reportFees], attendance: ['✅ Attendance', reportAttendance], enquiries: ['📝 Enquiries', reportEnquiries], profit: ['📈 Profit', reportProfit] };
  function currentReport() { if (!REPORTS[UI.repTab]) UI.repTab = 'fees'; if (!isMonth(UI.repMonth)) UI.repMonth = thisMonth(); return REPORTS[UI.repTab][1](UI.repMonth); }
  function viewReports() {
    var rep = currentReport();
    var html = '<div class="seg-tabs rep-tabs">' + Object.keys(REPORTS).map(function (k) { return '<button type="button" class="' + (UI.repTab === k ? 'active' : '') + '" data-act="rep-tab" data-tab="' + k + '">' + REPORTS[k][0] + '</button>'; }).join('') + '</div>';
    html += '<div class="toolbar">' + field('Month', '<input type="month" max="' + thisMonth() + '" value="' + UI.repMonth + '" data-change="rep-month">') + '<span class="row gap"><button class="btn ghost" data-act="rep-print">🖨️ Print / PDF</button><button class="btn ghost" data-act="rep-xlsx">📊 Excel</button></span></div>';
    return html + '<div id="report-body">' + rep.html + '</div>';
  }
  function exportReportsXlsx() {
    var ym = UI.repMonth || thisMonth(), sheets = [];
    Object.keys(REPORTS).forEach(function (k) { sheets = sheets.concat(REPORTS[k][1](ym).sheets); });
    if (downloadXlsx('littlewings-reports-' + ym + '.xlsx', sheets)) toast('Reports exported to Excel');
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
        '<section class="card"><h3>🔐 Change my password</h3>' + pwForm + '</section>' + langCardHTML() + secNote +
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
      field('Class sections', '<input name="sections" maxlength="80" value="' + esc(st.sections || 'A, B, C, D') + '">', '<small class="hint">Shown on the admission form after a class is chosen. Separate with commas, e.g. A, B, C, D</small>', 'span2') +
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
    html += alertsCardHTML() + yearCardHTML() + langCardHTML();
    html += '<section class="card"><h2>🔐 My password</h2><p class="muted small">Signed in as ' + esc(ME.email || '') + '</p>' + pwForm + '</section>' + secNote;

    var r = feeRules();
    html += '<section class="card"><h2>💰 Fee rules</h2><form class="form" data-form="fee-rules" novalidate>' +
      '<div class="grid2">' + field('Fee due by (day of month)', '<input type="number" name="feeDueDay" min="1" max="28" step="1" inputmode="numeric" value="' + r.dueDay + '">', '<small class="hint">Used for the late fee. 1–28.</small>') + '</div>' +
      '<label class="switch-row"><input type="checkbox" name="lateFeeOn"' + (r.lateOn ? ' checked' : '') + '><span><b>Late fee</b><br><small class="muted">Added to a month’s fee when it is not fully paid by the due day. Off by default. Saved payments are never changed.</small></span></label>' +
      '<div class="grid2 sub-fields">' + field('Late fee type', '<select name="lateFeeType">' + options([{ value: 'flat', label: 'Flat amount once' }, { value: 'day', label: 'Per day late' }], r.lateType) + '</select>') +
      field('Amount (₹)', '<input type="number" name="lateFeeAmount" min="0" max="100000" step="1" inputmode="numeric" value="' + (r.lateAmt || '') + '">') +
      field('Max per month (₹, per-day only)', '<input type="number" name="lateFeeMax" min="0" max="1000000" step="1" inputmode="numeric" value="' + (r.lateMax || '') + '" placeholder="No limit">') +
      field('Count late fee from month', '<input type="month" name="lateFeeFrom" value="' + esc(r.lateFrom || thisMonth()) + '">', '<small class="hint">Earlier months never get a late fee</small>') + '</div>' +
      '<label class="switch-row"><input type="checkbox" name="siblingOn"' + (r.sibOn ? ' checked' : '') + '><span><b>Sibling discount</b><br><small class="muted">For the 2nd and later child who shares a parent mobile number with a child admitted earlier. Off by default.</small></span></label>' +
      '<div class="grid2 sub-fields">' + field('Discount type', '<select name="siblingType">' + options([{ value: 'pct', label: '% off monthly fee' }, { value: 'flat', label: '₹ off monthly fee' }], r.sibType) + '</select>') +
      field('Discount value', '<input type="number" name="siblingValue" min="0" max="100000" step="1" inputmode="numeric" value="' + (r.sibVal || '') + '">') + '</div>' +
      '<p class="muted small">The Parents app shows the same amounts (the database uses the same rules).</p><button class="btn primary">Save fee rules</button></form></section>';
    html += '<section class="card"><h2>💬 WhatsApp messages</h2><form class="form" data-form="templates" novalidate>' +
      field('Fee reminder', '<textarea name="tplFee" rows="5" maxlength="800">' + esc(feeTpl()) + '</textarea>') +
      field('Birthday wish', '<textarea name="tplBirthday" rows="4" maxlength="800">' + esc(bdayTpl()) + '</textarea>') +
      '<p class="muted small">Words in {curly brackets} are filled in for you: {parent} {child} {amount} {month} {class} {school} {phone} (birthday also {age}).</p>' +
      '<div class="row gap wrap"><button class="btn primary">Save messages</button><button type="button" class="btn ghost" data-act="tpl-reset">Reset to default</button></div></form></section>';
    html += '<section class="card"><h2>💾 Backup</h2><p class="muted">' + (st.lastBackup ? 'Last backup: ' + esc(fmtDate(st.lastBackup.slice(0, 10))) + '.' : 'No backup taken yet.') + ' Download an Excel backup every month.</p><a class="btn primary" href="#/backup">Go to Backup</a></section>';
    if (Store.hasLegacy()) {
      var lg = Store.legacyData().data, imp = Store.rawGet('legacyImportedAt');
      html += '<section class="card"><div class="callout warn"><b>📥 Old data on this device</b><p>This browser still has data from the old version of the dashboard (saved only on this device): ' +
        asArray(lg.students).length + ' students, ' + asArray(lg.payments).length + ' payments, ' + Object.keys(asObject(lg.attendance)).length + ' attendance days, ' + asArray(lg.enquiries).length + ' enquiries, ' + asArray(lg.staff).length + ' staff.' +
        (imp ? ' <b>Already imported on ' + esc(fmtDate(imp.slice(0, 10))) + '.</b>' : '') + '</p><button class="btn primary" data-act="import-legacy">' + (imp ? 'Import again' : 'Import this device’s old local data into the cloud') + '</button></div></section>';
    }
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
    return SB.from('notices').insert({ title: title, body: body, audience: aud, pinned: fd.get('pinned') === '1', expires_on: exp || null }).select('id').then(function (r) {
      if (r.error) { toast('Could not post: ' + (/row-level|permission/i.test(r.error.message) ? 'not allowed for your account' : r.error.message), 'err'); return; }
      f.reset(); toast('Notice posted 📢');
      if (r.data && r.data[0]) pushNotify('notice', { ref: r.data[0].id });
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
      S.settings.sections = g('sections') || 'A, B, C, D';
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

  FORMS['fee-rules'] = function (f, fd) {
    var g = function (k) { return String(fd.get(k) == null ? '' : fd.get(k)).trim(); };
    var dd = parseInt(g('feeDueDay'), 10);
    if (!(dd >= 1 && dd <= 28)) return fieldError(f, 'feeDueDay', 'Choose a day from 1 to 28');
    var lateOn = fd.get('lateFeeOn') != null, sibOn = fd.get('siblingOn') != null;
    var amt = +g('lateFeeAmount') || 0, mx = +g('lateFeeMax') || 0, sv = +g('siblingValue') || 0;
    if (amt < 0 || mx < 0 || sv < 0) return fieldError(f, 'lateFeeAmount', 'Amounts can’t be negative');
    if (lateOn && !(amt > 0)) return fieldError(f, 'lateFeeAmount', 'Enter the late fee amount');
    if (sibOn && !(sv > 0)) return fieldError(f, 'siblingValue', 'Enter the discount');
    if (sibOn && g('siblingType') !== 'flat' && sv > 100) return fieldError(f, 'siblingValue', 'A % discount can be at most 100');
    S.settings.feeDueDay = dd;
    S.settings.lateFeeOn = lateOn; S.settings.lateFeeType = g('lateFeeType') === 'day' ? 'day' : 'flat'; S.settings.lateFeeAmount = Math.round(amt); S.settings.lateFeeMax = Math.round(mx);
    S.settings.lateFeeFrom = isMonth(g('lateFeeFrom')) ? g('lateFeeFrom') : (S.settings.lateFeeFrom || thisMonth());
    S.settings.siblingOn = sibOn; S.settings.siblingType = g('siblingType') === 'flat' ? 'flat' : 'pct'; S.settings.siblingValue = Math.round(sv * 100) / 100;
    persist('settings');
    toast('Fee rules saved');
    render();
  };
  FORMS.templates = function (f, fd) {
    var a = String(fd.get('tplFee') || '').trim(), b = String(fd.get('tplBirthday') || '').trim();
    if (a.length < 10) return fieldError(f, 'tplFee', 'Message is too short');
    if (b.length < 10) return fieldError(f, 'tplBirthday', 'Message is too short');
    S.settings.tplFee = a === TPL_FEE ? '' : a.slice(0, 800);
    S.settings.tplBirthday = b === TPL_BDAY ? '' : b.slice(0, 800);
    persist('settings');
    toast('WhatsApp messages saved');
    render();
  };
  Object.keys(FORMS_EXTRA).forEach(function (k) { FORMS[k] = FORMS_EXTRA[k]; });

  function exportCSV(t) {
    var rows, date = todayISO();
    if (t === 'students') {
      rows = [['Name', 'Class', 'Section', 'Date of birth', 'Age', 'Mother', 'Mother mobile', 'Father', 'Father mobile', 'Guardian', 'Guardian mobile', 'Phone', 'WhatsApp', 'Address', 'Admission date', 'Yearly fee (INR)', 'Monthly fee (INR)', 'Status', 'Emergency contact', 'Authorised pickup', 'Medical notes', 'Notes']].concat(
        S.students.slice().sort(byName).map(function (s) { return [s.name, className(s.classId), s.section || '', fmtDate(s.dob), ageText(s.dob), s.motherName || '', s.motherPhone || '', s.fatherName || '', s.fatherPhone || '', s.guardianName || '', s.guardianPhone || '', primaryPhone(s), s.whatsapp, s.address || '', fmtDate(s.admissionDate), num(s.yearlyFee), num(s.monthlyFee), s.status || 'Active', s.emergency, s.pickup, s.medical, s.notes]; }));
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
      rows = [['Date', 'Student', 'Date of birth', 'Father', 'Father mobile', 'Father qualification', 'Mother', 'Mother mobile', 'Mother qualification', 'Address', 'Feedback', 'Source', 'Status', 'Follow-up', 'Notes']].concat(
        S.enquiries.slice().sort(function (a, b) { return (a.date || '') < (b.date || '') ? -1 : 1; }).map(function (e) { return [fmtDate(e.date), e.childName, fmtDate(e.dob), e.fatherName || e.parentName, e.fatherPhone || e.phone, e.fatherQual || '', e.motherName || '', e.motherPhone || '', e.motherQual || '', e.address || '', e.feedback || '', e.source, e.status, fmtDate(e.followUp), e.notes]; }));
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
    return fetchNoticesForBackup().then(function (notices) {
      S.settings.lastBackup = new Date().toISOString();
      persist('settings');
      var obj = Store.exportAll();
      obj.notices = notices || [];
      downloadFile('littlewings-backup-' + todayISO() + '.json', JSON.stringify(obj, null, 1), 'application/json');
      toast('Backup downloaded — keep it somewhere safe');
      render();
    });
  }
  function cleanId(v) { v = String(v == null ? '' : v); return v && v.length <= 64 ? v : ''; }
  function mergeData(d) {
    var c = { students: 0, payments: 0, enquiries: 0, staff: 0, days: 0, holidays: 0, expenses: 0, salaries: 0, staff_attendance: 0, fee_reminders: 0, vans: 0, class_posts: 0, timetables: 0, exams: 0, marks: 0, albums: 0 };
    ['students', 'payments', 'enquiries', 'staff', 'holidays', 'expenses', 'salaries', 'staff_attendance', 'fee_reminders', 'vans', 'class_posts', 'timetables', 'exams', 'marks', 'albums'].forEach(function (t) {
      asArray(d[t]).forEach(function (r) {
        if (!r || typeof r !== 'object' || !cleanId(r.id)) return;
        if ((t === 'students' || t === 'class_posts' || t === 'timetables' || t === 'exams' || t === 'marks') && !CLASS_BY_ID[r.classId]) return;
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
    persist('settings', 'students', 'attendance', 'payments', 'enquiries', 'staff', 'holidays', 'expenses', 'salaries', 'staff_attendance', 'fee_reminders', 'vans', 'class_posts', 'timetables', 'exams', 'marks', 'albums');
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
   * v2.6 (BATCH 2) — language, media helpers, phone alerts, homework &
   * daily updates, timetable, exams & report cards, admission documents,
   * transport, ID cards & TC, promotion, parent messages, audit log, gallery.
   * ===================================================================== */
  var LANGS = [{ id: 'en', label: 'English', short: 'EN' }, { id: 'te', label: 'తెలుగు', short: 'తె' }, { id: 'hi', label: 'हिन्दी', short: 'हि' }];
  // Navigation + key labels. Anything missing falls back to English.
  var I18N = {
    te: {
      'Daily': 'రోజువారీ', 'Money': 'డబ్బు', 'School': 'పాఠశాల', 'Admin': 'అడ్మిన్',
      'Dashboard': 'డాష్‌బోర్డ్', 'My Class': 'నా తరగతి', 'Classes': 'తరగతులు', 'Students': 'విద్యార్థులు', 'Attendance': 'హాజరు',
      'Notices': 'నోటీసులు', 'Fees': 'ఫీజులు', 'Pending fees': 'బకాయి ఫీజులు', 'Enquiries': 'విచారణలు', 'Reports': 'నివేదికలు',
      'Expenses': 'ఖర్చులు', 'Staff': 'సిబ్బంది', 'Holidays': 'సెలవులు', 'Backup': 'బ్యాకప్', 'Settings': 'సెట్టింగ్‌లు', 'Account': 'ఖాతా',
      'More': 'మరిన్ని', 'Homework & updates': 'హోంవర్క్ & అప్‌డేట్‌లు', 'Timetable': 'టైమ్‌టేబుల్', 'Exams & reports': 'పరీక్షలు & రిపోర్టులు',
      'Transport': 'రవాణా (వ్యాన్)', 'ID cards & TC': 'ఐడీ కార్డులు & టీసీ', 'Promotion': 'తరగతి ప్రమోషన్', 'Parent messages': 'తల్లిదండ్రుల సందేశాలు',
      'Audit log': 'మార్పుల రికార్డు', 'Gallery': 'గ్యాలరీ', 'Sign out': 'సైన్ అవుట్', 'Language': 'భాష', 'Save': 'సేవ్ చేయండి', 'Cancel': 'రద్దు',
      'Delete': 'తొలగించు', 'Edit': 'మార్చు', 'Print / PDF': 'ప్రింట్ / PDF', 'Class': 'తరగతి', 'Date': 'తేదీ', 'New post': 'కొత్త పోస్ట్',
      'Homework': 'హోంవర్క్', 'Today we learned': 'ఈరోజు మేము నేర్చుకున్నది', 'Meal': 'భోజనం', 'Title': 'శీర్షిక', 'Details': 'వివరాలు',
      'Photo (optional)': 'ఫోటో (ఐచ్ఛికం)', 'Report card': 'ప్రోగ్రెస్ రిపోర్ట్', 'Report cards': 'ప్రోగ్రెస్ రిపోర్టులు', 'Marks': 'మార్కులు', 'Remarks': 'అభిప్రాయం', 'Published': 'ప్రచురించబడింది',
      'Not published': 'ప్రచురించలేదు', 'New exam': 'కొత్త పరీక్ష', 'Subjects': 'విషయాలు', 'New album': 'కొత్త ఆల్బమ్', 'Whole school': 'మొత్తం పాఠశాల',
      'Upload photos / videos': 'ఫోటోలు / వీడియోలు అప్‌లోడ్ చేయండి', 'Edit timetable': 'టైమ్‌టేబుల్ మార్చండి', 'Add van': 'వ్యాన్ జోడించండి', 'Print van list': 'వ్యాన్ జాబితా ప్రింట్',
      'Print ID cards': 'ఐడీ కార్డులు ప్రింట్', 'Transfer certificate': 'బదిలీ సర్టిఫికేట్ (టీసీ)', 'Promote students': 'విద్యార్థులను ప్రమోట్ చేయండి', 'Undo last promotion': 'చివరి ప్రమోషన్ రద్దు',
      'Mark seen': 'చూసినట్లు గుర్తించు', 'Reply': 'జవాబు', 'New': 'కొత్తది', 'Seen': 'చూశారు', 'Replied': 'జవాబిచ్చారు', 'All': 'అన్నీ',
      'Admission documents': 'ప్రవేశ పత్రాలు', 'Upload': 'అప్‌లోడ్', 'View': 'చూడండి', 'Academic year': 'విద్యా సంవత్సరం', 'Phone alerts': 'ఫోన్ అలర్ట్‌లు',
      'Record payment': 'చెల్లింపు నమోదు', 'Add student': 'విద్యార్థిని జోడించండి', 'Students, homework, exams': 'విద్యార్థులు, హోంవర్క్, పరీక్షలు',
      'Daily homework, learning and meal notes': 'రోజువారీ హోంవర్క్, నేర్చుకున్నవి, భోజనం', 'Weekly class timetable': 'వారపు తరగతి టైమ్‌టేబుల్',
      'Marks, grades and report cards': 'మార్కులు, గ్రేడ్‌లు, ప్రోగ్రెస్ రిపోర్టులు', 'School photos and videos': 'పాఠశాల ఫోటోలు, వీడియోలు',
      'Vans, drivers and van fees': 'వ్యాన్‌లు, డ్రైవర్లు, వ్యాన్ ఫీజు', 'Printable ID cards and TC': 'ప్రింట్ చేయగల ఐడీ కార్డులు, టీసీ',
      'Move students to the next class': 'విద్యార్థులను తదుపరి తరగతికి పంపండి', 'Messages from parents': 'తల్లిదండ్రుల నుండి సందేశాలు', 'Who changed what': 'ఎవరు ఏమి మార్చారు',
      'School and class notices': 'పాఠశాల, తరగతి నోటీసులు', 'Dues and WhatsApp reminders': 'బకాయిలు, వాట్సాప్ రిమైండర్లు', 'Fees, attendance, enquiries, profit': 'ఫీజులు, హాజరు, విచారణలు, లాభం',
      'Rent, snacks, stationery…': 'అద్దె, స్నాక్స్, స్టేషనరీ…', 'Staff, salary, staff attendance': 'సిబ్బంది, జీతం, సిబ్బంది హాజరు', 'Holidays and events': 'సెలవులు, కార్యక్రమాలు',
      'Download Excel / JSON backup': 'ఎక్సెల్ / JSON బ్యాకప్ డౌన్‌లోడ్', 'School, fee rules, logins': 'పాఠశాల, ఫీజు నియమాలు, లాగిన్‌లు', 'Password, language, app': 'పాస్‌వర్డ్, భాష, యాప్'
    },
    hi: {
      'Daily': 'रोज़ाना', 'Money': 'पैसा', 'School': 'स्कूल', 'Admin': 'एडमिन',
      'Dashboard': 'डैशबोर्ड', 'My Class': 'मेरी कक्षा', 'Classes': 'कक्षाएँ', 'Students': 'विद्यार्थी', 'Attendance': 'उपस्थिति',
      'Notices': 'सूचनाएँ', 'Fees': 'फीस', 'Pending fees': 'बकाया फीस', 'Enquiries': 'पूछताछ', 'Reports': 'रिपोर्ट',
      'Expenses': 'खर्च', 'Staff': 'स्टाफ़', 'Holidays': 'छुट्टियाँ', 'Backup': 'बैकअप', 'Settings': 'सेटिंग्स', 'Account': 'खाता',
      'More': 'और', 'Homework & updates': 'गृहकार्य और अपडेट', 'Timetable': 'समय-सारणी', 'Exams & reports': 'परीक्षा और रिपोर्ट कार्ड',
      'Transport': 'परिवहन (वैन)', 'ID cards & TC': 'आईडी कार्ड और टीसी', 'Promotion': 'कक्षा उन्नति', 'Parent messages': 'अभिभावकों के संदेश',
      'Audit log': 'बदलाव रिकॉर्ड', 'Gallery': 'गैलरी', 'Sign out': 'साइन आउट', 'Language': 'भाषा', 'Save': 'सहेजें', 'Cancel': 'रद्द करें',
      'Delete': 'हटाएँ', 'Edit': 'बदलें', 'Print / PDF': 'प्रिंट / PDF', 'Class': 'कक्षा', 'Date': 'तारीख', 'New post': 'नई पोस्ट',
      'Homework': 'गृहकार्य', 'Today we learned': 'आज हमने सीखा', 'Meal': 'भोजन', 'Title': 'शीर्षक', 'Details': 'विवरण',
      'Photo (optional)': 'फ़ोटो (वैकल्पिक)', 'Report card': 'रिपोर्ट कार्ड', 'Report cards': 'रिपोर्ट कार्ड', 'Marks': 'अंक', 'Remarks': 'टिप्पणी', 'Published': 'प्रकाशित',
      'Not published': 'प्रकाशित नहीं', 'New exam': 'नई परीक्षा', 'Subjects': 'विषय', 'New album': 'नया एल्बम', 'Whole school': 'पूरा स्कूल',
      'Upload photos / videos': 'फ़ोटो / वीडियो अपलोड करें', 'Edit timetable': 'समय-सारणी बदलें', 'Add van': 'वैन जोड़ें', 'Print van list': 'वैन सूची प्रिंट करें',
      'Print ID cards': 'आईडी कार्ड प्रिंट करें', 'Transfer certificate': 'स्थानांतरण प्रमाणपत्र (टीसी)', 'Promote students': 'विद्यार्थियों को अगली कक्षा में भेजें', 'Undo last promotion': 'पिछली उन्नति वापस लें',
      'Mark seen': 'देखा हुआ चिह्नित करें', 'Reply': 'जवाब', 'New': 'नया', 'Seen': 'देखा गया', 'Replied': 'जवाब दिया', 'All': 'सभी',
      'Admission documents': 'प्रवेश दस्तावेज़', 'Upload': 'अपलोड', 'View': 'देखें', 'Academic year': 'शैक्षणिक वर्ष', 'Phone alerts': 'फ़ोन अलर्ट',
      'Record payment': 'भुगतान दर्ज करें', 'Add student': 'विद्यार्थी जोड़ें', 'Students, homework, exams': 'विद्यार्थी, गृहकार्य, परीक्षा',
      'Daily homework, learning and meal notes': 'रोज़ का गृहकार्य, सीखना और भोजन', 'Weekly class timetable': 'कक्षा की साप्ताहिक समय-सारणी',
      'Marks, grades and report cards': 'अंक, ग्रेड और रिपोर्ट कार्ड', 'School photos and videos': 'स्कूल की फ़ोटो और वीडियो',
      'Vans, drivers and van fees': 'वैन, ड्राइवर और वैन फीस', 'Printable ID cards and TC': 'प्रिंट करने योग्य आईडी कार्ड और टीसी',
      'Move students to the next class': 'विद्यार्थियों को अगली कक्षा में भेजें', 'Messages from parents': 'अभिभावकों के संदेश', 'Who changed what': 'किसने क्या बदला',
      'School and class notices': 'स्कूल और कक्षा की सूचनाएँ', 'Dues and WhatsApp reminders': 'बकाया और व्हाट्सऐप रिमाइंडर', 'Fees, attendance, enquiries, profit': 'फीस, उपस्थिति, पूछताछ, लाभ',
      'Rent, snacks, stationery…': 'किराया, नाश्ता, स्टेशनरी…', 'Staff, salary, staff attendance': 'स्टाफ़, वेतन, स्टाफ़ उपस्थिति', 'Holidays and events': 'छुट्टियाँ और कार्यक्रम',
      'Download Excel / JSON backup': 'एक्सेल / JSON बैकअप डाउनलोड करें', 'School, fee rules, logins': 'स्कूल, फीस नियम, लॉगिन', 'Password, language, app': 'पासवर्ड, भाषा, ऐप'
    }
  };
  var LANG = (function () { var l = ''; if (!PART_B) return 'en'; try { l = localStorage.getItem('lw-lang') || ''; } catch (e) { /* ignore */ } return I18N[l] ? l : 'en'; })();
  function langSaved() { try { return !!localStorage.getItem('lw-lang'); } catch (e) { return false; } }
  function t(s) { return (I18N[LANG] && I18N[LANG][s]) || s; }
  if (!PART_B) { (function rm() { var ls = document.getElementById('lang-sel'); if (ls) ls.parentNode.removeChild(ls); else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', rm); })(); }
  function applyLangAttr() { document.documentElement.lang = LANG === 'en' ? 'en-IN' : LANG + '-IN'; var sel = document.getElementById('lang-sel'); if (sel) sel.value = LANG; }
  function setLang(l, fromServer) {
    if (l !== 'en' && !I18N[l]) l = 'en';
    LANG = l;
    try { localStorage.setItem('lw-lang', l); } catch (e) { /* ignore */ }
    applyLangAttr();
    // Saved per user too (own user_metadata only; harmless if offline).
    if (!fromServer && SB && ME) SB.auth.updateUser({ data: { lw_lang: l } }).catch(function () {});
    if (ME) showShell();
  }
  function langSelectHTML(cls) {
    if (!PART_B) return '';
    return '<select class="' + (cls || '') + '" data-change="lang" aria-label="Language">' + LANGS.map(function (l) { return '<option value="' + l.id + '"' + (l.id === LANG ? ' selected' : '') + '>' + esc(l.label) + '</option>'; }).join('') + '</select>';
  }

  /* ---------- media (private buckets, signed URLs) ---------- */
  var mediaCache = {};
  function signedURL(bucket, path, secs) {
    if (!SB || !path) return Promise.resolve('');
    secs = secs || 3600;
    var k = bucket + '/' + path, c = mediaCache[k];
    if (c && c.exp > Date.now() + 30000) return Promise.resolve(c.url);
    return SB.storage.from(bucket).createSignedUrl(path, secs).then(function (r) {
      var url = r && r.data && r.data.signedUrl;
      if (!url) return '';
      mediaCache[k] = { url: url, exp: Date.now() + (secs - 120) * 1000 };
      return url;
    }).catch(function () { return ''; });
  }
  function mediaHTML(bucket, path, type, cls) {
    return '<div class="media ' + (cls || '') + '" data-media-bucket="' + esc(bucket) + '" data-media-path="' + esc(path) + '" data-media-type="' + (type === 'video' ? 'video' : 'image') + '"><span class="media-wait">' + (type === 'video' ? '🎬' : '🖼️') + '</span></div>';
  }
  function hydrateMedia(root) {
    if (!root || !root.querySelectorAll) return;
    Array.prototype.forEach.call(root.querySelectorAll('[data-media-path]'), function (el) {
      if (el.getAttribute('data-media-loaded')) return;
      el.setAttribute('data-media-loaded', '1');
      signedURL(el.getAttribute('data-media-bucket'), el.getAttribute('data-media-path')).then(function (url) {
        if (!url || !el.parentNode) { el.innerHTML = '<span class="media-wait">⚠️</span>'; return; }
        var m;
        if (el.getAttribute('data-media-type') === 'video') { m = document.createElement('video'); m.controls = true; m.preload = 'metadata'; m.setAttribute('playsinline', ''); }
        else { m = document.createElement('img'); m.alt = ''; m.loading = 'lazy'; if (!el.classList.contains('album-cover')) m.setAttribute('data-act', 'media-open'); }
        m.src = url;
        el.innerHTML = ''; el.appendChild(m);
      });
    });
  }
  function compressImg(file, max, q) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type || '')) return reject(new Error('Please choose a photo (JPEG or PNG)'));
      var img = new Image(), src = URL.createObjectURL(file);
      img.onload = function () {
        var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
        if (w > max || h > max) { if (w >= h) { h = Math.round(h * max / w) || 1; w = max; } else { w = Math.round(w * max / h) || 1; h = max; } }
        var c = document.createElement('canvas'); c.width = w; c.height = h;
        var ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(src);
        c.toBlob(function (b) { if (!b) reject(new Error('Could not process the photo')); else resolve(b); }, 'image/jpeg', q || 0.8);
      };
      img.onerror = function () { URL.revokeObjectURL(src); reject(new Error('Could not read the photo')); };
      img.src = src;
    });
  }
  function upload(bucket, path, blob, type) {
    return SB.storage.from(bucket).upload(path, blob, { upsert: true, contentType: type || blob.type || 'application/octet-stream', cacheControl: '3600' }).then(function (r) {
      if (r.error) throw new Error(/row-level|security|unauthor/i.test(r.error.message || '') ? 'Upload not allowed for your account' : (r.error.message || 'Upload failed'));
      delete mediaCache[bucket + '/' + path];
      return path;
    });
  }
  function removeFiles(bucket, paths) {
    paths = paths.filter(Boolean);
    if (!SB || !paths.length) return Promise.resolve();
    return SB.storage.from(bucket).remove(paths).then(function () { paths.forEach(function (p) { delete mediaCache[bucket + '/' + p]; }); }).catch(function () {});
  }
  function addDays(iso, n) { return new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) + n * 86400000).toISOString().slice(0, 10); }
  function b2Class(key) {
    if (!isAdmin()) return CLASS_BY_ID[ME.classId] ? ME.classId : '';
    if (!CLASS_BY_ID[UI[key]]) UI[key] = CLASSES[0].id;
    return UI[key];
  }
  function classSelectHTML(key, allOpt) {
    if (!isAdmin()) return '';
    return field(t('Class'), '<select data-change="b2-class" data-key="' + key + '">' + options((allOpt ? [{ value: 'all', label: allOpt }] : []).concat(CLASSES.map(function (c) { return { value: c.id, label: c.emoji + ' ' + c.name }; })), UI[key]) + '</select>');
  }
  function noClassHTML() { return emptyState('🏫', 'No class linked to your login', 'Ask the admin to set your class in Settings → Teacher logins.'); }
  function printSheet(inner, fileTitle, cls) {
    var root = $('#print-root');
    if (!root) return;
    root.className = 'pdoc-root ' + (cls || '');
    root.innerHTML = inner;
    var old = document.title;
    var restore = function () { document.title = old; root.innerHTML = ''; root.className = ''; window.removeEventListener('afterprint', restore); };
    var imgs = $$('img', root).filter(function (i) { return !i.complete; }), left = imgs.length, done = false;
    var go = function () { if (done) return; done = true; document.title = fileTitle || old; window.addEventListener('afterprint', restore); setTimeout(function () { window.print(); }, 80); };
    if (!left) return go();
    imgs.forEach(function (i) { i.onload = i.onerror = function () { if (--left <= 0) go(); }; });
    setTimeout(go, 6000);
  }
  function waOpen(phone, text) { var url = waHref(phone, text); if (url) window.open(url, '_blank', 'noopener'); }

  /* ---------- phone alerts (Web Push via the lw-push Edge Function) ---------- */
  function pushCall(action, payload) {
    var tokP = SB ? SB.auth.getSession().then(function (r) { return r.data.session ? r.data.session.access_token : null; }) : Promise.resolve(null);
    return tokP.then(function (tok) {
      if (!tok) throw new Error('Please sign in again.');
      return fetch(CFG.supabaseUrl + '/functions/v1/lw-push', {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: CFG.supabaseKey, Authorization: 'Bearer ' + tok },
        body: JSON.stringify(Object.assign({ action: action }, payload || {}))
      });
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (j) { if (!res.ok) throw new Error(j.error || ('Server error ' + res.status)); return j; });
    });
  }
  // Fire-and-forget: upload pending changes first so the server sees them.
  function pushNotify(kind, payload) {
    if (!PART_B || !SB || navigator.onLine === false) return Promise.resolve(null);
    return Store.flush().then(function () { return pushCall('notify', Object.assign({ kind: kind }, payload || {})); })
      .then(function (r) { if (r && r.sent) toast('📲 Alert sent to ' + r.sent + ' parent phone' + (r.sent === 1 ? '' : 's')); return r; })
      .catch(function (e) { console.warn('push', e && e.message); return null; });
  }

  /* ---------- homework & daily updates ---------- */
  var POST_KINDS = [{ id: 'Homework', icon: '📚' }, { id: 'Learned', icon: '🌟' }, { id: 'Meal', icon: '🍱' }];
  function postKind(k) { for (var i = 0; i < POST_KINDS.length; i++) if (POST_KINDS[i].id === k) return POST_KINDS[i]; return POST_KINDS[0]; }
  function postKindLabel(k) { return k === 'Learned' ? t('Today we learned') : k === 'Meal' ? t('Meal') : t('Homework'); }
  function findPost(id) { return S.class_posts.filter(function (p) { return p.id === id; })[0] || null; }
  function viewHomework() {
    var cid = b2Class('hwClass');
    if (!cid) return noClassHTML();
    var since = addDays(todayISO(), -45);
    var posts = S.class_posts.filter(function (p) { return p.classId === cid && (p.date || '') >= since; })
      .sort(function (a, b) { return a.date !== b.date ? (a.date < b.date ? 1 : -1) : (String(a.at || '') < String(b.at || '') ? 1 : -1); });
    var html = '<div class="toolbar">' + classSelectHTML('hwClass') + '<button class="btn primary" data-act="post-add">➕ ' + esc(t('New post')) + '</button></div>' +
      '<p class="muted small">Parents of ' + esc(className(cid)) + ' see these in the Parents app (last 30 days). New posts for today also send a phone alert to parents who turned alerts on.</p>';
    if (!posts.length) return html + emptyState('📚', 'Nothing posted yet', 'Post today’s homework, “Today we learned…” or a meal note for ' + className(cid) + '.', '<button class="btn primary" data-act="post-add">➕ ' + esc(t('New post')) + '</button>');
    var last = '';
    posts.forEach(function (p) {
      if (p.date !== last) { html += '<h3 class="day-h">' + esc(fmtDate(p.date)) + (p.date === todayISO() ? ' · <span class="tag">Today</span>' : '') + '</h3>'; last = p.date; }
      var k = postKind(p.kind);
      html += '<article class="card post"><div class="row between"><span class="tag post-' + esc(k.id.toLowerCase()) + '">' + k.icon + ' ' + esc(postKindLabel(k.id)) + '</span><span class="row gap">' +
        '<button class="icon-btn" data-act="post-edit" data-id="' + esc(p.id) + '" title="Edit" aria-label="Edit">✏️</button><button class="icon-btn" data-act="post-del" data-id="' + esc(p.id) + '" title="Delete" aria-label="Delete">🗑️</button></span></div>' +
        (p.title ? '<h3 class="post-title">' + esc(p.title) + '</h3>' : '') + (p.text ? '<p class="pre">' + esc(p.text) + '</p>' : '') +
        (p.photo ? mediaHTML('class-media', p.photo, 'image', 'post-photo') : '') +
        '<small class="muted">' + esc(p.by || '') + (p.at ? ' · ' + esc(stampIST(p.at)) : '') + '</small></article>';
    });
    return html;
  }
  function openPostForm(p) {
    var cid = p ? p.classId : b2Class('hwClass');
    if (!cid) return;
    var body = '<form class="form" novalidate><div class="grid2">' +
      (isAdmin() ? field(t('Class') + ' *', '<select name="classId"' + (p ? ' disabled' : '') + '>' + options(CLASSES.map(function (c) { return { value: c.id, label: c.emoji + ' ' + c.name }; }), cid) + '</select>') : '') +
      field('Type *', '<select name="kind">' + options(POST_KINDS.map(function (k) { return { value: k.id, label: k.icon + ' ' + postKindLabel(k.id) }; }), p ? p.kind : 'Homework') + '</select>') +
      field(t('Date') + ' *', '<input type="date" name="date" value="' + esc(p ? p.date : todayISO()) + '" max="' + addDays(todayISO(), 7) + '" required>') +
      field(t('Title'), '<input name="title" maxlength="120" value="' + esc(p ? p.title || '' : '') + '" placeholder="e.g. Write A to E, 2 times">', '', 'span2') +
      field(t('Details'), '<textarea name="text" rows="4" maxlength="2000" placeholder="Homework, what we learned today, or today’s meal">' + esc(p ? p.text || '' : '') + '</textarea>', '', 'span2') +
      field(t('Photo (optional)'), '<input type="file" name="photo" accept="image/*">', (p && p.photo ? '<label class="check"><input type="checkbox" name="removePhoto" value="1"> Remove the current photo</label>' : '') + '<small class="hint">Compressed on this phone before upload.</small>', 'span2') +
      '</div><div class="form-actions"><button type="button" class="btn ghost" data-act="modal-close">' + esc(t('Cancel')) + '</button><button class="btn primary">' + esc(t('Save')) + '</button></div></form>';
    openModal({
      title: p ? 'Edit post' : t('New post') + ' · ' + className(cid), size: 'wide', body: body,
      onSubmit: function (form, fd) {
        var g = function (k) { return String(fd.get(k) == null ? '' : fd.get(k)).trim(); };
        var c = p ? p.classId : (isAdmin() ? g('classId') : ME.classId);
        var kind = postKind(g('kind')).id, date = g('date'), title = g('title').slice(0, 120), text = g('text').slice(0, 2000);
        if (!CLASS_BY_ID[c]) { fieldError(form, 'classId', 'Choose a class'); return false; }
        if (!isISODate(date)) { fieldError(form, 'date', 'Choose a date'); return false; }
        if (!title && !text) { fieldError(form, 'title', 'Write a title or some details'); return false; }
        var file = fd.get('photo'), id = p ? p.id : 'cp-' + uid();
        var photo = p ? p.photo || '' : '';
        var step = Promise.resolve();
        if (file && file.size) {
          step = compressImg(file, 1280, 0.8).then(function (b) { return b.size > 1900000 ? compressImg(file, 900, 0.7) : b; })
            .then(function (b) { return upload('class-media', c + '/' + id + '.jpg', b, 'image/jpeg'); }).then(function (path) { photo = path; });
        } else if (g('removePhoto') === '1' && photo) {
          step = removeFiles('class-media', [photo]).then(function () { photo = ''; });
        }
        return step.then(function () {
          var rec = { id: id, classId: c, kind: kind, date: date, title: title, text: text, photo: photo, by: p ? p.by : ME.name, at: p ? p.at : new Date().toISOString() };
          if (p) rec.editedAt = new Date().toISOString();
          S.class_posts = S.class_posts.filter(function (x) { return x.id !== id; }).concat([rec]);
          persist('class_posts');
          toast(p ? 'Post updated' : 'Posted for ' + className(c) + ' 📚');
          render();
          if (!p) pushNotify('post', { ref: id });
          return true;
        }).catch(function (e) { fieldError(form, 'photo', e.message); return false; });
      }
    });
  }

  /* ---------- timetable ---------- */
  var TT_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function ttOf(cid) { return S.timetables.filter(function (r) { return r.id === cid && r.classId === cid; })[0] || null; }
  function ttPeriodHTML(p) {
    p = p || { time: '', cells: [] };
    return '<div class="tt-period card"><div class="row between">' + field('Time', '<input name="time" maxlength="30" value="' + esc(p.time || '') + '" placeholder="9:00 – 9:30">') +
      '<button type="button" class="icon-btn" data-act="tt-row-del" title="Remove period" aria-label="Remove period">🗑️</button></div><div class="tt-cells">' +
      TT_DAYS.map(function (d, i) { return field(d, '<input name="cell" data-day="' + i + '" maxlength="60" value="' + esc(asArray(p.cells)[i] || '') + '">'); }).join('') + '</div></div>';
  }
  function viewTimetable() {
    var cid = b2Class('ttClass');
    if (!cid) return noClassHTML();
    var tt = ttOf(cid), periods = asArray(tt && tt.periods);
    var html = '<div class="toolbar">' + classSelectHTML('ttClass') + (UI.ttEdit === cid ? '' : '<button class="btn primary" data-act="tt-edit">✏️ ' + esc(t('Edit timetable')) + '</button>') + '</div>';
    if (UI.ttEdit === cid) {
      return html + '<form class="form" data-form="tt-save" novalidate><div id="tt-periods">' + (periods.length ? periods : [null, null, null]).map(ttPeriodHTML).join('') + '</div>' +
        '<button type="button" class="btn ghost" data-act="tt-row-add">➕ Add period</button>' +
        field('Note for parents (optional)', '<input name="note" maxlength="200" value="' + esc(tt && tt.note || '') + '" placeholder="e.g. Saturday: half day">') +
        '<div class="form-actions"><button type="button" class="btn ghost" data-act="tt-cancel">' + esc(t('Cancel')) + '</button><button class="btn primary">' + esc(t('Save')) + '</button></div></form>';
    }
    if (!periods.length) return html + emptyState('🗓️', 'No timetable yet', 'Add the weekly timetable for ' + className(cid) + '. Parents see it in the Parents app.', '<button class="btn primary" data-act="tt-edit">✏️ ' + esc(t('Edit timetable')) + '</button>');
    return html + '<div class="table-wrap"><table class="table tt"><thead><tr><th>Time</th>' + TT_DAYS.map(function (d) { return '<th>' + d + '</th>'; }).join('') + '</tr></thead><tbody>' +
      periods.map(function (p) { return '<tr><th>' + esc(p.time || '') + '</th>' + TT_DAYS.map(function (d, i) { return '<td>' + esc(asArray(p.cells)[i] || '') + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>' +
      (tt.note ? '<p class="note">' + esc(tt.note) + '</p>' : '') + '<p class="muted small">Updated ' + esc(tt.at ? stampIST(tt.at) : '') + (tt.by ? ' by ' + esc(tt.by) : '') + '</p>';
  }

  /* ---------- exams, marks & report cards ---------- */
  var DEFAULT_SUBJECTS = {
    toddlers: ['Rhymes & songs', 'Colours & shapes', 'Motor skills', 'Social skills'],
    nursery: ['English', 'Telugu', 'Numbers', 'Rhymes', 'Drawing'],
    lkg: ['English', 'Telugu', 'Hindi', 'Maths', 'EVS', 'Drawing'],
    ukg: ['English', 'Telugu', 'Hindi', 'Maths', 'EVS', 'Drawing']
  };
  function examById(id) { return S.exams.filter(function (e) { return e.id === id; })[0] || null; }
  function marksOf(examId, sid) { return S.marks.filter(function (m) { return m.examId === examId && m.studentId === sid; })[0] || null; }
  function academicYear() {
    var y = String(S.settings.academicYear || '');
    if (/^\d{4}-\d{2}$/.test(y)) return y;
    var ym = thisMonth(), yr = +ym.slice(0, 4), start = +ym.slice(5, 7) >= 6 ? yr : yr - 1;
    return start + '-' + String((start + 1) % 100).padStart(2, '0');
  }
  function nextYear(y) { var a = +String(y).slice(0, 4) + 1; return a + '-' + String((a + 1) % 100).padStart(2, '0'); }
  function gradeOf(pct) { return pct >= 90 ? 'A+' : pct >= 75 ? 'A' : pct >= 60 ? 'B' : pct >= 45 ? 'C' : 'D'; }
  function examResult(e, m) {
    var rows = [], tot = 0, max = 0, numeric = true;
    asArray(e.subjects).forEach(function (sub, i) {
      var v = m && m.marks ? m.marks[sub.name] : '';
      v = v == null ? '' : String(v);
      var mx = num(sub.max), n = parseFloat(v), isNum = mx > 0 && v !== '' && isFinite(n);
      if (isNum) { tot += n; max += mx; } else if (mx > 0 && v !== '' && !/^ab$/i.test(v)) numeric = false;
      rows.push({ name: sub.name, value: v, max: mx, grade: isNum ? gradeOf(n / mx * 100) : (mx > 0 ? (/^ab$/i.test(v) ? 'AB' : '') : v) });
    });
    return { rows: rows, total: round2(tot), max: max, pct: max > 0 && numeric ? Math.round(tot / max * 1000) / 10 : null };
  }
  function viewExams(arg) {
    if (arg) return viewExam(arg);
    var cid = b2Class('exClass');
    if (!cid) return noClassHTML();
    var list = S.exams.filter(function (e) { return e.classId === cid; }).sort(function (a, b) { return String(a.date || '') < String(b.date || '') ? 1 : -1; });
    var n = activeStudents(cid).length;
    var html = '<div class="toolbar">' + classSelectHTML('exClass') + '<button class="btn primary" data-act="exam-add">➕ ' + esc(t('New exam')) + '</button></div>' +
      '<p class="muted small">' + (isAdmin() ? 'Turn on “Publish” when an exam’s marks are final: parents then see their own child’s report card in the Parents app.' : 'The admin publishes report cards to parents when marks are final.') + '</p>';
    if (!list.length) return html + emptyState('📝', 'No exams yet', 'Create an exam or term (e.g. “Term 1”) with its subjects, then enter marks or grades.', '<button class="btn primary" data-act="exam-add">➕ ' + esc(t('New exam')) + '</button>');
    return html + list.map(function (e) {
      var done = S.marks.filter(function (m) { return m.examId === e.id && Object.keys(asObject(m.marks)).some(function (k) { return String(m.marks[k]) !== ''; }); }).length;
      return '<article class="card exam"><div class="row between"><div><h3><a href="#/exams/' + encodeURIComponent(e.id) + '">' + esc(e.name) + '</a></h3><small class="muted">' + esc([e.term, e.year, e.date ? fmtDate(e.date) : ''].filter(Boolean).join(' · ')) + '</small></div>' +
        (e.published ? badge(t('Published'), '#6cc48a') : badge(t('Not published'), '#c9ced6')) + '</div>' +
        '<p class="small">' + asArray(e.subjects).length + ' subjects · marks entered for <b>' + done + '</b> of ' + n + ' students</p>' +
        '<div class="row gap wrap"><a class="btn small primary" href="#/exams/' + encodeURIComponent(e.id) + '">✏️ ' + esc(t('Marks')) + '</a><button class="btn small ghost" data-act="rc-print-all" data-id="' + esc(e.id) + '">🖨️ ' + esc(t('Report cards')) + '</button>' +
        '<button class="btn small ghost" data-act="exam-edit" data-id="' + esc(e.id) + '">' + esc(t('Edit')) + '</button><button class="icon-btn" data-act="exam-del" data-id="' + esc(e.id) + '" title="Delete exam" aria-label="Delete exam">🗑️</button>' +
        (isAdmin() ? '<label class="switch-row inline"><input type="checkbox" data-change="exam-publish" data-id="' + esc(e.id) + '"' + (e.published ? ' checked' : '') + '><span><b>Publish</b> to parents</span></label>' : '') + '</div></article>';
    }).join('');
  }
  function openExamForm(e) {
    var cid = e ? e.classId : b2Class('exClass');
    var subj = e ? asArray(e.subjects).map(function (s) { return s.name + (num(s.max) > 0 ? ' | ' + num(s.max) : ''); }).join('\n') : DEFAULT_SUBJECTS[cid].map(function (s) { return s + ' | 50'; }).join('\n');
    openModal({
      title: e ? 'Edit exam' : t('New exam') + ' · ' + className(cid), size: 'wide',
      body: '<form class="form" novalidate><div class="grid2">' +
        field('Exam name *', '<input name="name" maxlength="60" value="' + esc(e ? e.name : '') + '" placeholder="e.g. Term 1 assessment" required>') +
        field('Term', '<input name="term" maxlength="30" value="' + esc(e ? e.term || '' : '') + '" placeholder="Term 1 / Half-yearly / Annual">') +
        field(t('Date'), '<input type="date" name="date" value="' + esc(e ? e.date || '' : todayISO()) + '">') +
        field(t('Academic year'), '<input name="year" maxlength="7" value="' + esc(e ? e.year || '' : academicYear()) + '" placeholder="2026-27">') +
        field(t('Subjects') + ' *', '<textarea name="subjects" rows="6" maxlength="1500">' + esc(subj) + '</textarea>', '<small class="hint">One subject per line. Add “| maximum marks” for marks (e.g. <b>English | 50</b>), or leave it out to enter a grade or a short remark (e.g. <b>Motor skills</b> → A, B, “Good”).</small>', 'span2') +
        '</div><div class="form-actions"><button type="button" class="btn ghost" data-act="modal-close">' + esc(t('Cancel')) + '</button><button class="btn primary">' + esc(t('Save')) + '</button></div></form>',
      onSubmit: function (form, fd) {
        var g = function (k) { return String(fd.get(k) == null ? '' : fd.get(k)).trim(); };
        if (!g('name')) { fieldError(form, 'name', 'Enter the exam name'); return false; }
        var seen = {}, subjects = [];
        g('subjects').split(/\n+/).forEach(function (line) {
          var parts = line.split('|'), name = String(parts[0] || '').replace(/\s+/g, ' ').trim().slice(0, 40), mx = Math.max(0, Math.min(1000, parseInt(parts[1], 10) || 0));
          if (name && !seen[name.toLowerCase()] && subjects.length < 15) { seen[name.toLowerCase()] = 1; subjects.push({ name: name, max: mx }); }
        });
        if (!subjects.length) { fieldError(form, 'subjects', 'Add at least one subject'); return false; }
        if (g('year') && !/^\d{4}-\d{2}$/.test(g('year'))) { fieldError(form, 'year', 'Use the form 2026-27'); return false; }
        var rec = Object.assign({}, e || { id: 'ex-' + uid(), classId: cid, published: false, createdAt: new Date().toISOString() }, { name: g('name').slice(0, 60), term: g('term').slice(0, 30), date: isISODate(g('date')) ? g('date') : '', year: g('year'), subjects: subjects, by: ME.name });
        S.exams = S.exams.filter(function (x) { return x.id !== rec.id; }).concat([rec]);
        persist('exams'); toast(e ? 'Exam updated' : 'Exam created'); render();
        return true;
      }
    });
  }
  function viewExam(id) {
    var e = examById(id);
    if (!e || (!isAdmin() && e.classId !== ME.classId)) return emptyState('📝', 'Exam not found', 'It may have been deleted.', '<a class="btn primary" href="#/exams">Back to exams</a>');
    var studs = activeStudents(e.classId);
    var html = '<div class="toolbar"><a class="btn ghost" href="#/exams">← ' + esc(t('Exams & reports')) + '</a><button class="btn ghost" data-act="rc-print-all" data-id="' + esc(e.id) + '">🖨️ ' + esc(t('Report cards')) + '</button></div>' +
      '<section class="card"><h2>' + esc(e.name) + ' · ' + esc(className(e.classId)) + '</h2><p class="muted small">' + esc([e.term, e.year, e.date ? fmtDate(e.date) : ''].filter(Boolean).join(' · ')) + ' · ' + (e.published ? '✅ ' + esc(t('Published')) : esc(t('Not published'))) + '</p>' +
      '<p class="muted small">Enter marks (or <b>AB</b> for absent) where a maximum is set; otherwise a grade or a short word. Tap Save at the bottom.</p></section>';
    if (!studs.length) return html + emptyState('🧒', 'No students in this class', 'Add students first.');
    html += '<form class="form" data-form="marks-save" data-id="' + esc(e.id) + '" novalidate>' + studs.map(function (s) {
      var m = marksOf(e.id, s.id), mk = asObject(m && m.marks);
      return '<section class="card mk-card"><div class="row between"><h3>' + esc(s.name) + (s.section ? ' <small class="muted">Sec ' + esc(s.section) + '</small>' : '') + '</h3><button type="button" class="btn small ghost" data-act="rc-view" data-exam="' + esc(e.id) + '" data-sid="' + esc(s.id) + '">📄 ' + esc(t('Report card')) + '</button></div><div class="mk-grid">' +
        asArray(e.subjects).map(function (sub, i) {
          return field(esc(sub.name) + (num(sub.max) > 0 ? ' <small class="muted">/ ' + num(sub.max) + '</small>' : ''), '<input name="m|' + esc(s.id) + '|' + i + '" maxlength="12" value="' + esc(mk[sub.name] == null ? '' : mk[sub.name]) + '"' + (num(sub.max) > 0 ? ' inputmode="decimal"' : '') + '>');
        }).join('') + '</div>' + field(t('Remarks'), '<textarea name="r|' + esc(s.id) + '" rows="2" maxlength="600">' + esc(m && m.remarks || '') + '</textarea>') + '</section>';
    }).join('') + '<div class="form-actions sticky-save"><button class="btn primary">💾 ' + esc(t('Save')) + ' ' + esc(t('Marks')) + '</button></div></form>';
    return html;
  }
  function reportCardHTML(e, s, m) {
    var st = S.settings, r = examResult(e, m);
    return '<article class="rc"><header class="rc-head"><img src="assets/logo.jpeg" alt="" width="58" height="58"><div><h1>' + esc(st.schoolName) + '</h1><p>' + esc(st.address || '') + (st.phone ? ' · ' + esc(st.phone) : '') + '</p></div></header>' +
      '<h2 class="rc-title">Progress Report · ' + esc(e.name) + (e.year ? ' · ' + esc(e.year) : '') + '</h2>' +
      '<div class="rc-meta"><span>Name: <b>' + esc(s.name) + '</b></span><span>Class: <b>' + esc(classLabel(s)) + '</b></span>' + (s.dob ? '<span>Date of birth: <b>' + esc(fmtDate(s.dob)) + '</b></span>' : '') + (primaryName(s) ? '<span>Parent: <b>' + esc(primaryName(s)) + '</b></span>' : '') + (e.term || e.date ? '<span>' + esc([e.term, e.date ? fmtDate(e.date) : ''].filter(Boolean).join(' · ')) + '</span>' : '') + '</div>' +
      '<table class="rc-tbl"><thead><tr><th>Subject</th><th>Marks</th><th>Grade</th></tr></thead><tbody>' + r.rows.map(function (x) {
        return '<tr><td>' + esc(x.name) + '</td><td>' + (x.max > 0 ? esc(x.value === '' ? '—' : x.value) + ' / ' + x.max : '—') + '</td><td><b>' + esc(x.grade || (x.max > 0 ? '' : x.value) || '—') + '</b></td></tr>';
      }).join('') + (r.max > 0 ? '<tr class="tot"><td>Total</td><td>' + r.total + ' / ' + r.max + '</td><td><b>' + (r.pct != null ? r.pct + '% · ' + gradeOf(r.pct) : '') + '</b></td></tr>' : '') + '</tbody></table>' +
      '<div class="rc-rem"><b>' + esc(t('Remarks')) + '</b><p>' + esc(m && m.remarks || '—') + '</p></div>' +
      '<p class="rc-key">Grades: A+ 90%+ · A 75%+ · B 60%+ · C 45%+ · D below 45% · AB absent</p>' +
      '<div class="slip-sign rc-sign"><div>Class teacher</div><div>Principal</div><div>Parent</div></div></article>';
  }
  function reportCardText(e, s, m) {
    var r = examResult(e, m);
    return '📄 ' + S.settings.schoolName + ' – Progress report\n' + s.name + ' (' + classLabel(s) + ')\n' + e.name + (e.year ? ' · ' + e.year : '') + '\n\n' +
      r.rows.map(function (x) { return x.name + ': ' + (x.max > 0 ? (x.value === '' ? '—' : x.value) + '/' + x.max + (x.grade ? ' (' + x.grade + ')' : '') : (x.value || '—')); }).join('\n') +
      (r.max > 0 ? '\nTotal: ' + r.total + '/' + r.max + (r.pct != null ? ' (' + r.pct + '%)' : '') : '') + (m && m.remarks ? '\n\nRemarks: ' + m.remarks : '') + '\n\n– ' + S.settings.schoolName;
  }
  function openReportCard(examId, sid) {
    var e = examById(examId), s = studentById(sid);
    if (!e || !s) return;
    var m = marksOf(e.id, s.id), phone = s.whatsapp || primaryPhone(s);
    openModal({ title: t('Report card') + ' · ' + s.name, size: 'wide', body: '<div class="rc-preview">' + reportCardHTML(e, s, m) + '</div><div class="form-actions"><button class="btn ghost" data-act="rc-wa" data-exam="' + esc(e.id) + '" data-sid="' + esc(s.id) + '"' + (phone ? '' : ' disabled title="No parent phone"') + '>💬 WhatsApp</button><button class="btn primary" data-act="rc-print" data-exam="' + esc(e.id) + '" data-sid="' + esc(s.id) + '">🖨️ ' + esc(t('Print / PDF')) + '</button></div>' });
  }
  function printReportCards(e, sids) {
    var inner = sids.map(function (sid) { var s = studentById(sid); return s ? reportCardHTML(e, s, marksOf(e.id, s.id)) : ''; }).join('');
    if (!inner) { toast('No students to print', 'err'); return; }
    printSheet(inner, 'Report cards - ' + e.name + ' - ' + className(e.classId), 'rc-print');
  }

  /* ---------- admission documents (admin only, private bucket) ---------- */
  var DOC_TYPES = ['Aadhaar', 'Birth certificate', 'Vaccination record', 'Photo', 'Previous school TC', 'Address proof', 'Other'];
  function docsOf(sid) { return S.student_docs.filter(function (d) { return d.studentId === sid; }).sort(function (a, b) { return String(a.at || '') < String(b.at || '') ? 1 : -1; }); }
  function docsHTML(s) {
    var list = docsOf(s.id);
    return '<h4>📎 ' + esc(t('Admission documents')) + '</h4>' + (list.length ? '<ul class="mini-list">' + list.map(function (d) {
      return '<li><span><b>' + esc(d.type) + '</b><small>' + esc(d.name || '') + ' · ' + (d.size ? Math.max(1, Math.round(d.size / 1024)) + ' KB · ' : '') + esc(d.at ? fmtDate(d.at.slice(0, 10)) : '') + '</small></span><span class="row gap"><button type="button" class="btn small ghost" data-act="doc-view" data-id="' + esc(d.id) + '">' + esc(t('View')) + '</button><button type="button" class="icon-btn" data-act="doc-del" data-id="' + esc(d.id) + '" title="Delete document" aria-label="Delete document">🗑️</button></span></li>';
    }).join('') + '</ul>' : '<p class="muted small">No documents yet. Only the admin can see these (not teachers or parents).</p>') +
      '<form class="form doc-up" data-form="doc-upload" data-id="' + esc(s.id) + '" novalidate><div class="grid2">' + field('Document type', '<select name="type">' + options(DOC_TYPES, 'Aadhaar') + '</select>') +
      field('File (PDF or photo, max 10 MB)', '<input type="file" name="file" accept="application/pdf,image/jpeg,image/png,image/webp">') + '</div><button class="btn small primary">⬆️ ' + esc(t('Upload')) + '</button></form>';
  }
  function refreshDocs(sid) { var b = document.getElementById('student-docs-box'), s = studentById(sid); if (b && s) b.innerHTML = docsHTML(s); }

  /* ---------- transport ---------- */
  function vanById(id) { return S.vans.filter(function (v) { return v.id === id; })[0] || null; }
  function vanStudents(vid) { return S.students.filter(function (s) { return s.vanId === vid && !isInactive(s); }).sort(byName); }
  function viewTransport() {
    var vans = S.vans.slice().sort(byName);
    var html = '<div class="toolbar"><button class="btn primary" data-act="van-add">➕ ' + esc(t('Add van')) + '</button>' + (vans.length ? '<button class="btn ghost" data-act="van-print">🖨️ ' + esc(t('Print van list')) + '</button>' : '') + '</div>' +
      '<p class="muted small">The van fee is added to a child’s monthly dues as a separate line (from the chosen month), with the same late-fee rule. Saved payments are never changed.</p>';
    if (!vans.length) return html + emptyState('🚐', 'No vans yet', 'Add each van or route with the driver’s name and phone, then assign students.', '<button class="btn primary" data-act="van-add">➕ ' + esc(t('Add van')) + '</button>');
    return html + vans.map(function (v) {
      var st = vanStudents(v.id), fees = st.reduce(function (a, s) { return a + vanMonth(s, thisMonth()); }, 0);
      return '<article class="card van"><div class="row between"><h3>🚐 ' + esc(v.name) + '</h3><span class="row gap"><button class="icon-btn" data-act="van-edit" data-id="' + esc(v.id) + '" title="Edit" aria-label="Edit">✏️</button><button class="icon-btn" data-act="van-del" data-id="' + esc(v.id) + '" title="Delete" aria-label="Delete">🗑️</button></span></div>' +
        (v.route ? '<p class="small">🛣️ ' + esc(v.route) + '</p>' : '') +
        '<div class="kvs"><div class="kv"><span>Driver</span><b>' + esc(v.driver || '—') + '</b></div><div class="kv"><span>Driver’s phone</span><b>' + phoneLinks(v.driverPhone) + '</b></div>' + (v.vehicleNo ? '<div class="kv"><span>Vehicle no.</span><b>' + esc(v.vehicleNo) + '</b></div>' : '') +
        '<div class="kv"><span>Students</span><b>' + st.length + '</b></div><div class="kv"><span>Van fees (' + esc(fmtMonth(thisMonth())) + ')</span><b>' + inr(fees) + '</b></div></div>' +
        (st.length ? '<p class="small muted">' + st.map(function (s) { return esc(s.name); }).join(', ') + '</p>' : '') +
        '<button class="btn small primary" data-act="van-students" data-id="' + esc(v.id) + '">🧒 Assign students</button></article>';
    }).join('');
  }
  function openVanForm(v) {
    openModal({
      title: v ? 'Edit van' : t('Add van'), size: 'wide',
      body: '<form class="form" novalidate><div class="grid2">' + field('Van / route name *', '<input name="name" maxlength="50" value="' + esc(v ? v.name : '') + '" placeholder="Van 1 – Vuyyuru town" required>') +
        field('Vehicle no.', '<input name="vehicleNo" maxlength="20" value="' + esc(v ? v.vehicleNo || '' : '') + '">') +
        field('Driver name', '<input name="driver" maxlength="50" value="' + esc(v ? v.driver || '' : '') + '">') +
        field('Driver’s mobile', '<input name="driverPhone" type="tel" inputmode="tel" maxlength="15" value="' + esc(v ? v.driverPhone || '' : '') + '">') +
        field('Route / stops', '<textarea name="route" rows="2" maxlength="300">' + esc(v ? v.route || '' : '') + '</textarea>', '', 'span2') +
        field('Default van fee per month (₹)', '<input type="number" name="fee" min="0" max="100000" step="1" inputmode="numeric" value="' + esc(v ? v.fee || '' : '') + '">', '<small class="hint">Suggested when you assign a student; each child can have their own amount.</small>') +
        '</div><div class="form-actions"><button type="button" class="btn ghost" data-act="modal-close">' + esc(t('Cancel')) + '</button><button class="btn primary">' + esc(t('Save')) + '</button></div></form>',
      onSubmit: function (form, fd) {
        var g = function (k) { return String(fd.get(k) == null ? '' : fd.get(k)).trim(); };
        if (!g('name')) { fieldError(form, 'name', 'Enter a name for the van'); return false; }
        if (g('driverPhone') && !validPhone(g('driverPhone'))) { fieldError(form, 'driverPhone', 'Enter a 10-digit mobile number'); return false; }
        var rec = Object.assign({}, v || { id: 'van-' + uid() }, { name: g('name'), vehicleNo: g('vehicleNo'), driver: g('driver'), driverPhone: g('driverPhone') ? normPhone(g('driverPhone')) : '', route: g('route'), fee: Math.max(0, num(g('fee'))) });
        S.vans = S.vans.filter(function (x) { return x.id !== rec.id; }).concat([rec]);
        persist('vans'); toast('Van saved'); render(); return true;
      }
    });
  }
  function openVanStudents(v) {
    var studs = activeStudents();
    var body = '<form class="form" novalidate><input class="search" data-input="kid-filter" placeholder="Search students" aria-label="Search students"><div class="kid-picker van-pick">' + CLASSES.map(function (c) {
      var l = studs.filter(function (s) { return s.classId === c.id; });
      if (!l.length) return '';
      return '<h4>' + c.emoji + ' ' + esc(c.name) + '</h4>' + l.map(function (s) {
        var on = s.vanId === v.id, other = s.vanId && s.vanId !== v.id ? vanById(s.vanId) : null;
        return '<div class="kid-opt van-row" data-name="' + esc(String(s.name || '').toLowerCase()) + '"><label class="check"><input type="checkbox" name="on" value="' + esc(s.id) + '"' + (on ? ' checked' : '') + '> <b>' + esc(s.name) + '</b>' + (other ? ' <small class="muted">(now in ' + esc(other.name) + ')</small>' : '') + '</label>' +
          '<span class="van-fee"><input type="number" name="fee|' + esc(s.id) + '" min="0" max="100000" step="1" inputmode="numeric" aria-label="Van fee for ' + esc(s.name) + '" value="' + esc(on ? num(s.vanFee) : (v.fee || '')) + '"><input type="month" name="from|' + esc(s.id) + '" aria-label="Van from month" value="' + esc(on && isMonth(s.vanFrom) ? s.vanFrom : thisMonth()) + '"></span></div>';
      }).join('');
    }).join('') + '</div><p class="muted small">Fee per month (₹) and the month the van starts. Untick to stop the van from this month; earlier months keep their van fee.</p><div class="form-actions"><button type="button" class="btn ghost" data-act="modal-close">' + esc(t('Cancel')) + '</button><button class="btn primary">' + esc(t('Save')) + '</button></div></form>';
    openModal({
      title: '🧒 ' + v.name, size: 'wide', body: body,
      onSubmit: function (form, fd) {
        var on = fd.getAll('on').map(String), last = addMonths(thisMonth(), -1), n = 0;
        S.students.forEach(function (s) {
          if (on.indexOf(s.id) >= 0) {
            var fee = Math.max(0, num(fd.get('fee|' + s.id))), from = String(fd.get('from|' + s.id) || '');
            if (!isMonth(from)) from = thisMonth();
            if (s.vanId !== v.id || num(s.vanFee) !== fee || s.vanFrom !== from || s.vanTo) { s.vanId = v.id; s.vanFee = fee; s.vanFrom = from; s.vanTo = ''; n++; }
          } else if (s.vanId === v.id) {
            s.vanId = '';
            if (isMonth(s.vanFrom) && s.vanFrom <= last && num(s.vanFee) > 0) s.vanTo = last; else { s.vanFee = 0; s.vanFrom = ''; s.vanTo = ''; }
            n++;
          }
        });
        persist('students'); toast(n ? n + ' student' + (n === 1 ? '' : 's') + ' updated' : 'No changes'); render(); return true;
      }
    });
  }
  function printVanList() {
    var inner = S.vans.slice().sort(byName).map(function (v) {
      var st = vanStudents(v.id);
      return '<section class="card"><h3>🚐 ' + esc(v.name) + (v.vehicleNo ? ' · ' + esc(v.vehicleNo) : '') + '</h3><p>Driver: <b>' + esc(v.driver || '—') + '</b>' + (v.driverPhone ? ' · ' + esc(v.driverPhone) : '') + (v.route ? '<br>Route: ' + esc(v.route) : '') + '</p>' +
        (st.length ? '<div class="table-wrap"><table class="table"><thead><tr><th>#</th><th>Student</th><th>Class</th><th>Parent</th><th>Phone</th><th>Address</th></tr></thead><tbody>' + st.map(function (s, i) {
          return '<tr><td>' + (i + 1) + '</td><td>' + esc(s.name) + '</td><td>' + esc(classLabel(s)) + '</td><td>' + esc(primaryName(s)) + '</td><td>' + esc(primaryPhone(s)) + '</td><td>' + esc(s.address || '') + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<p class="muted">No students assigned.</p>') + '</section>';
    }).join('');
    printDoc('Van list', '<div class="pdoc-body">' + inner + '</div>', 'Little Wings van list');
  }

  /* ---------- ID cards & transfer certificate ---------- */
  function idCardHTML(s, photoUrl) {
    var st = S.settings, c = CLASS_BY_ID[s.classId] || {};
    return '<div class="idc" style="--c:' + esc(c.color || '#38a8e0') + '"><div class="idc-top"><img src="assets/logo.jpeg" alt=""><div><b>' + esc(st.schoolName) + '</b><small>Student ID card · ' + esc(academicYear()) + '</small></div></div>' +
      '<div class="idc-body"><div class="idc-photo">' + (photoUrl ? '<img src="' + esc(photoUrl) + '" alt="">' : '<span>' + esc(initials(s.name)) + '</span>') + '</div><div class="idc-info"><b class="idc-name">' + esc(s.name) + '</b>' +
      '<span>Class: <b>' + esc(className(s.classId)) + (s.section ? ' – ' + esc(s.section) : '') + '</b></span>' + (s.dob ? '<span>DOB: ' + esc(fmtDate(s.dob)) + '</span>' : '') +
      (primaryName(s) ? '<span>Parent: ' + esc(primaryName(s)) + '</span>' : '') + (primaryPhone(s) ? '<span>📞 ' + esc(primaryPhone(s)) + '</span>' : '') + '</div></div>' +
      '<div class="idc-foot">' + esc(st.address || '') + (st.phone ? ' · ' + esc(st.phone) : '') + '</div></div>';
  }
  function viewIdCards() {
    if (!UI.idClass) UI.idClass = 'all';
    var studs = activeStudents(UI.idClass === 'all' ? '' : UI.idClass);
    var left = S.students.filter(function (s) { return s.status === 'Left' && (UI.idClass === 'all' || s.classId === UI.idClass); }).sort(byName);
    var html = '<div class="toolbar">' + classSelectHTML('idClass', 'All classes') + '</div>';
    html += '<section class="card"><h2>🪪 Student ID cards</h2><p class="muted small">8 cards per A4 sheet (85.6 × 54 mm). Choose “Save as PDF” in the print window for a PDF.</p>' +
      (studs.length ? '<form data-form="id-print" novalidate><label class="check"><input type="checkbox" data-act="id-all" checked> <b>Select all (' + studs.length + ')</b></label><div class="kid-picker id-pick">' + studs.map(function (s) {
        return '<label class="check kid-opt"><input type="checkbox" name="sid" value="' + esc(s.id) + '" checked> ' + esc(s.name) + ' <small class="muted">' + esc(classLabel(s)) + '</small>' + (photoPathOf(s) ? '' : ' <small class="warn-t">no photo</small>') + '</label>';
      }).join('') + '</div><button class="btn primary">🖨️ ' + esc(t('Print ID cards')) + '</button></form>' : '<p class="muted">No active students.</p>') + '</section>';
    html += '<section class="card"><h2>📜 ' + esc(t('Transfer certificate')) + '</h2><p class="muted small">Issuing a TC sets the student to “Left” (or Inactive) with the leaving date. Their attendance, fees and receipts stay in the records.</p>' +
      (studs.length ? '<ul class="mini-list">' + studs.map(function (s) { return '<li><span><b>' + esc(s.name) + '</b><small>' + esc(classLabel(s)) + '</small></span><button class="btn small ghost" data-act="tc-new" data-id="' + esc(s.id) + '">📜 Issue TC</button></li>'; }).join('') + '</ul>' : '') +
      (left.length ? '<h4>Left</h4><ul class="mini-list">' + left.map(function (s) { return '<li><span><b>' + esc(s.name) + '</b><small>' + esc(classLabel(s)) + (s.leavingDate ? ' · left ' + esc(fmtDate(s.leavingDate)) : '') + (s.tc && s.tc.no ? ' · ' + esc(s.tc.no) : '') + '</small></span>' + (s.tc && s.tc.no ? '<button class="btn small ghost" data-act="tc-print" data-id="' + esc(s.id) + '">🖨️ Reprint TC</button>' : '<button class="btn small ghost" data-act="tc-new" data-id="' + esc(s.id) + '">📜 Issue TC</button>') + '</li>'; }).join('') + '</ul>' : '') + '</section>';
    return html;
  }
  function printIdCards(ids) {
    var list = ids.map(studentById).filter(Boolean);
    if (!list.length) { toast('Choose at least one student', 'err'); return; }
    toast('Preparing ' + list.length + ' ID card' + (list.length === 1 ? '' : 's') + '…');
    Promise.all(list.map(function (s) { var p = photoPathOf(s); return p ? studentPhotoURL(p) : Promise.resolve(''); })).then(function (urls) {
      var pages = [];
      for (var i = 0; i < list.length; i += 8) pages.push('<div class="idsheet-page">' + list.slice(i, i + 8).map(function (s, j) { return idCardHTML(s, urls[i + j]); }).join('') + '</div>');
      printSheet(pages.join(''), 'Little Wings ID cards', 'idsheet');
    });
  }
  function tcHTML(s) {
    var tc = s.tc || {}, row = function (k, v) { return '<tr><th>' + k + '</th><td>' + v + '</td></tr>'; };
    return '<div class="tc"><div class="tc-no"><span>TC No: <b>' + esc(tc.no || '') + '</b></span><span>Date of issue: <b>' + esc(fmtDate(tc.issued || todayISO())) + '</b></span></div><table class="slip-tbl tc-tbl">' +
      row('Name of the pupil', '<b>' + esc(s.name) + '</b>') + row('Father’s / Mother’s / Guardian’s name', esc([s.fatherName, s.motherName, s.guardianName].filter(Boolean).join(' / ') || primaryName(s) || '—')) +
      row('Date of birth', esc(fmtDate(s.dob)) + (isISODate(s.dob) ? ' <small>(' + esc(new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(s.dob + 'T12:00:00'))) + ')</small>' : '')) +
      row('Date of admission', esc(fmtDate(s.admissionDate))) + row('Class at the time of leaving', esc(tc.classAt || classLabel(s))) + row('Date of leaving', esc(fmtDate(tc.leavingDate || s.leavingDate))) +
      row('Reason for leaving', esc(tc.reason || '—')) + row('Conduct', esc(tc.conduct || 'Good')) + row('Fee dues', esc(tc.dues > 0 ? 'Pending ' + inr(tc.dues) : 'No dues')) +
      (tc.remarks ? row('Remarks', esc(tc.remarks)) : '') + '</table><p class="tc-cert">Certified that the above particulars are correct as per the school records.</p><div class="slip-sign"><div>Class teacher</div><div>Principal / Head (with seal)</div></div></div>';
  }
  function openTCForm(s) {
    var reasons = ['Parent’s request', 'Shifting to another place', 'Joining another school', 'Completed UKG', 'Other'];
    openModal({
      title: t('Transfer certificate') + ' · ' + s.name, size: 'wide',
      body: '<form class="form" novalidate><div class="grid2">' + field('Date of leaving *', '<input type="date" name="leavingDate" value="' + esc(s.leavingDate || todayISO()) + '" required>') +
        field('Status after leaving', '<select name="status">' + options([{ value: 'Left', label: 'Left' }, { value: 'Inactive', label: 'Inactive' }], 'Left') + '</select>') +
        field('Reason', '<select name="reason">' + options(reasons, reasons[0]) + '</select>') + field('Conduct', '<input name="conduct" maxlength="40" value="Good">') +
        field('Class at the time of leaving', '<input name="classAt" maxlength="40" value="' + esc(classLabel(s)) + '">') + field('Remarks', '<input name="remarks" maxlength="200">') +
        '</div><p class="note">Fee dues now: <b>' + inr(outstanding(s)) + '</b> (printed on the TC).</p><div class="form-actions"><button type="button" class="btn ghost" data-act="modal-close">' + esc(t('Cancel')) + '</button><button class="btn primary">📜 Save &amp; print TC</button></div></form>',
      onSubmit: function (form, fd) {
        var g = function (k) { return String(fd.get(k) == null ? '' : fd.get(k)).trim(); };
        if (!isISODate(g('leavingDate'))) { fieldError(form, 'leavingDate', 'Choose the leaving date'); return false; }
        var seq = Math.max(1, parseInt(S.settings.tcSeq, 10) || 1);
        var used = {}; S.students.forEach(function (x) { if (x.tc && x.tc.no) used[x.tc.no] = 1; });
        var no = 'TC-' + String(seq).padStart(4, '0');
        while (used[no]) { seq++; no = 'TC-' + String(seq).padStart(4, '0'); }
        s.tc = { no: no, issued: todayISO(), leavingDate: g('leavingDate'), reason: g('reason'), conduct: g('conduct') || 'Good', classAt: g('classAt'), remarks: g('remarks'), dues: round2(outstanding(s)), by: ME.name };
        s.status = g('status') === 'Inactive' ? 'Inactive' : 'Left';
        s.leavingDate = g('leavingDate');
        S.settings.tcSeq = seq + 1;
        persist('students', 'settings');
        toast('TC ' + no + ' saved · ' + s.name + ' marked ' + s.status);
        render();
        setTimeout(function () { printDoc('Transfer Certificate', tcHTML(s), 'TC ' + no + ' - ' + s.name); }, 0);
        return true;
      }
    });
  }

  /* ---------- year-end promotion (with undo) ---------- */
  var NEXT_CLASS = { toddlers: 'nursery', nursery: 'lkg', lkg: 'ukg', ukg: 'left' };
  function lastPromotion() { return S.promotions.filter(function (p) { return !p.undone && Array.isArray(p.items) && p.at; }).sort(function (a, b) { return String(a.at) < String(b.at) ? 1 : -1; })[0] || null; }
  function viewPromotion() {
    var yr = academicYear(), studs = activeStudents(), lp = lastPromotion();
    var mFrom = (+thisMonth().slice(5, 7) >= 4 ? thisMonth().slice(0, 4) : String(+thisMonth().slice(0, 4))) + '-06';
    if (mFrom < thisMonth()) mFrom = thisMonth();
    var html = '<section class="card"><h2>🎓 ' + esc(t('Promotion')) + '</h2><p>' + esc(t('Academic year')) + ' now: <b>' + esc(yr) + '</b></p><p class="muted small">Moves the chosen students to the next class for the new academic year. Attendance, payments and receipts are kept. Earlier months keep their old fee (saved as fee history), so past dues are not re-priced. You can undo the last promotion.</p></section>';
    if (lp) html += '<div class="callout"><b>Last promotion</b><p>' + esc(stampIST(lp.at)) + ' · ' + lp.items.length + ' student' + (lp.items.length === 1 ? '' : 's') + ' · ' + esc(lp.fromYear) + ' → ' + esc(lp.toYear) + ' · by ' + esc(lp.by || '') + '</p><button class="btn ghost" data-act="promo-undo">↩️ ' + esc(t('Undo last promotion')) + '</button></div>';
    if (!studs.length) return html + emptyState('🧒', 'No active students', 'There is nobody to promote.');
    html += '<form class="form" data-form="promo-run" novalidate><section class="card"><div class="grid2">' +
      field('New academic year *', '<input name="toYear" maxlength="7" value="' + esc(nextYear(yr)) + '" placeholder="2027-28">') +
      field('New class & fees from month *', '<input type="month" name="fromMonth" value="' + esc(mFrom) + '">', '<small class="hint">Months before this keep the old class fee.</small>') + '</div>' +
      '<label class="switch-row"><input type="radio" name="feeMode" value="carry" checked><span><b>Carry over each child’s current fee</b></span></label>' +
      '<label class="switch-row"><input type="radio" name="feeMode" value="new"><span><b>Set a new yearly fee for each class</b><br><small class="muted">Only for promoted students; blank = keep their fee.</small></span></label>' +
      '<div class="grid2 sub-fields">' + CLASSES.map(function (c) { return field(c.emoji + ' ' + esc(c.name) + ' – yearly fee (₹)', '<input type="number" name="fee|' + c.id + '" min="0" max="1000000" step="1" inputmode="numeric">'); }).join('') + '</div></section>' +
      '<section class="card"><div class="row between"><h3>Students (' + studs.length + ')</h3><label class="check"><input type="checkbox" data-act="promo-all" checked> Select all</label></div><div class="promo-list">' + studs.slice().sort(function (a, b) { return CLASSES.indexOf(CLASS_BY_ID[a.classId]) - CLASSES.indexOf(CLASS_BY_ID[b.classId]) || byName(a, b); }).map(function (s) {
        var nx = NEXT_CLASS[s.classId];
        return '<div class="promo-row"><label class="check"><input type="checkbox" name="sid" value="' + esc(s.id) + '" checked> <b>' + esc(s.name) + '</b></label><span class="promo-to"><small class="muted">' + esc(className(s.classId)) + ' →</small><select name="to|' + esc(s.id) + '" aria-label="New class for ' + esc(s.name) + '">' +
          options(CLASSES.map(function (c) { return { value: c.id, label: c.name }; }).concat([{ value: 'left', label: '🎓 Leaves (Left)' }]), nx) + '</select></span></div>';
      }).join('') + '</div></section><div class="form-actions sticky-save"><button class="btn primary">👀 Preview &amp; ' + esc(t('Promote students')) + '</button></div></form>';
    return html;
  }
  function runPromotion(f, fd) {
    var toYear = String(fd.get('toYear') || '').trim(), fromMonth = String(fd.get('fromMonth') || ''), mode = fd.get('feeMode') === 'new' ? 'new' : 'carry';
    if (!/^\d{4}-\d{2}$/.test(toYear)) return fieldError(f, 'toYear', 'Use the form 2027-28');
    if (!isMonth(fromMonth)) return fieldError(f, 'fromMonth', 'Choose the month');
    var newFee = {}; CLASSES.forEach(function (c) { var v = String(fd.get('fee|' + c.id) || '').trim(); if (v !== '' && num(v) >= 0) newFee[c.id] = num(v); });
    var plan = fd.getAll('sid').map(String).map(function (id) { var s = studentById(id); var to = String(fd.get('to|' + id) || ''); return s && (CLASS_BY_ID[to] || to === 'left') ? { s: s, to: to } : null; }).filter(Boolean);
    if (!plan.length) { toast('Choose at least one student', 'err'); return; }
    var counts = {};
    plan.forEach(function (x) { var k = className(x.s.classId) + ' → ' + (x.to === 'left' ? 'Left' : className(x.to)); counts[k] = (counts[k] || 0) + 1; });
    var summary = Object.keys(counts).map(function (k) { return k + ': ' + counts[k]; }).join(' · ');
    return confirmBox(plan.length + ' students → ' + toYear + '. ' + summary + '. Fees: ' + (mode === 'carry' ? 'carry over' : 'new yearly fee where set') + ', from ' + fmtMonth(fromMonth) + '. You can undo this afterwards.', { ok: t('Promote students'), danger: false, title: 'Preview' }).then(function (ok) {
      if (!ok) return;
      var fromYear = academicYear(), until = addMonths(fromMonth, -1);
      var batch = { id: 'pr-' + uid(), at: new Date().toISOString(), by: ME.name, fromYear: fromYear, toYear: toYear, fromMonth: fromMonth, feeMode: mode, items: [] };
      plan.forEach(function (x) {
        var s = x.s;
        batch.items.push({ studentId: s.id, to: x.to, prev: { classId: s.classId, status: s.status || 'Active', academicYear: s.academicYear || '', leavingDate: s.leavingDate || '', monthlyFee: num(s.monthlyFee), yearlyFee: num(s.yearlyFee), feeHist: JSON.parse(JSON.stringify(asArray(s.feeHist))) } });
        if (x.to === 'left') { s.status = 'Left'; s.leavingDate = s.leavingDate || addDays(fromMonth + '-01', -1); return; }
        var hist = asArray(s.feeHist).filter(function (h) { return h.until !== until; });
        hist.push({ until: until, monthly: num(s.monthlyFee), yearly: num(s.yearlyFee), classId: s.classId });
        s.feeHist = hist.sort(function (a, b) { return a.until < b.until ? -1 : 1; }).slice(-20);
        s.classId = x.to; s.academicYear = toYear;
        if (mode === 'new' && newFee[x.to] != null) { s.yearlyFee = newFee[x.to]; if (x.to !== 'nursery') s.monthlyFee = 0; }
      });
      S.promotions.push(batch);
      S.settings.academicYear = toYear;
      persist('students', 'promotions', 'settings');
      toast('🎓 ' + plan.length + ' students promoted to ' + toYear);
      render();
    });
  }
  function undoPromotion() {
    var lp = lastPromotion();
    if (!lp) return;
    confirmBox('Undo the promotion of ' + lp.items.length + ' students (' + lp.fromYear + ' → ' + lp.toYear + ')? Their class, status and fees go back to how they were before it.', { ok: 'Undo', danger: false, title: t('Undo last promotion') }).then(function (ok) {
      if (!ok) return;
      var n = 0;
      lp.items.forEach(function (it) {
        var s = studentById(it.studentId), p = it.prev;
        if (!s || !p) return;
        s.classId = p.classId; s.status = p.status || 'Active'; s.academicYear = p.academicYear;
        if (p.leavingDate) s.leavingDate = p.leavingDate; else delete s.leavingDate;
        s.monthlyFee = p.monthlyFee; s.yearlyFee = p.yearlyFee; s.feeHist = p.feeHist;
        n++;
      });
      lp.undone = true; lp.undoneAt = new Date().toISOString();
      S.settings.academicYear = lp.fromYear;
      persist('students', 'promotions', 'settings');
      toast('Promotion undone for ' + n + ' students'); render();
    });
  }

  /* ---------- parent messages (feedback inbox) ---------- */
  function fbById(id) { return S.feedback.filter(function (f) { return f.id === id; })[0] || null; }
  function fbStatusLabel(s) { return s === 'Replied' ? t('Replied') : s === 'Seen' ? t('Seen') : t('New'); }
  function viewFeedback() {
    if (!UI.fbFilter) UI.fbFilter = 'New';
    var all = S.feedback.slice().sort(function (a, b) { return String(a.createdAt || '') < String(b.createdAt || '') ? 1 : -1; });
    var nNew = all.filter(function (f) { return (f.status || 'New') === 'New'; }).length;
    var list = UI.fbFilter === 'New' ? all.filter(function (f) { return (f.status || 'New') === 'New'; }) : all;
    var html = '<div class="seg-tabs"><button type="button" class="' + (UI.fbFilter === 'New' ? 'active' : '') + '" data-act="fb-filter" data-f="New">' + esc(t('New')) + ' (' + nNew + ')</button><button type="button" class="' + (UI.fbFilter === 'All' ? 'active' : '') + '" data-act="fb-filter" data-f="All">' + esc(t('All')) + ' (' + all.length + ')</button></div>' +
      '<p class="muted small">Parents send these from the Parents app (up to 5 a day each). They see the status and your reply note.</p>';
    if (!list.length) return html + emptyState('💬', UI.fbFilter === 'New' ? 'No new messages' : 'No messages yet', 'Messages from parents will appear here.');
    return html + list.map(function (f) {
      var st = f.status || 'New', col = st === 'Replied' ? '#6cc48a' : st === 'Seen' ? '#ffc93c' : '#38a8e0';
      return '<article class="card fb' + (st === 'New' ? ' is-new' : '') + '"><div class="row between"><div><b>' + esc(f.parentName || 'Parent') + '</b> <small class="muted">· ' + esc(f.studentName || '') + '</small><br><small class="muted">' + esc(f.createdAt ? stampIST(f.createdAt) : '') + '</small></div>' + badge(fbStatusLabel(st), col) + '</div>' +
        '<p class="pre">' + esc(f.message || '') + '</p>' + (f.reply ? '<div class="callout"><b>Your reply</b><p class="pre">' + esc(f.reply) + '</p><small class="muted">' + esc(f.repliedAt ? stampIST(f.repliedAt) : '') + '</small></div>' : '') +
        '<div class="row gap wrap">' + (st === 'New' ? '<button class="btn small ghost" data-act="fb-seen" data-id="' + esc(f.id) + '">👁️ ' + esc(t('Mark seen')) + '</button>' : '') + '<button class="btn small primary" data-act="fb-reply" data-id="' + esc(f.id) + '">↩️ ' + esc(t('Reply')) + '</button>' +
        '<button class="icon-btn" data-act="fb-del" data-id="' + esc(f.id) + '" title="Delete" aria-label="Delete">🗑️</button></div></article>';
    }).join('');
  }

  /* ---------- audit log (admin, read straight from the database) ---------- */
  var AUDIT_TABLES = [{ value: '', label: 'All tables' }, { value: 'students', label: 'Students' }, { value: 'student_fees', label: 'Student fees' }, { value: 'payments', label: 'Payments' }, { value: 'settings', label: 'Settings' }];
  function viewAudit() {
    var a = UI.audit || (UI.audit = { tbl: '', action: '', from: addDays(todayISO(), -30), to: todayISO(), q: '' });
    setTimeout(loadAudit, 0);
    return '<form class="form" data-form="audit-filter" novalidate><div class="toolbar audit-f">' +
      field('Table', '<select name="tbl">' + options(AUDIT_TABLES, a.tbl) + '</select>') +
      field('Change', '<select name="action">' + options([{ value: '', label: 'All' }, { value: 'insert', label: 'Added' }, { value: 'update', label: 'Changed' }, { value: 'delete', label: 'Deleted' }], a.action) + '</select>') +
      field('From', '<input type="date" name="from" value="' + esc(a.from) + '">') + field('To', '<input type="date" name="to" value="' + esc(a.to) + '">') +
      field('Search (user or change)', '<input name="q" maxlength="40" value="' + esc(a.q) + '">') + '<button class="btn primary">🔍 Filter</button></div></form>' +
      '<p class="muted small">Every change to students, fees, payments and settings is recorded by the database itself (who, when, what changed). Passwords and keys are never recorded. Only the admin can read this.</p><div id="audit-list"><p class="muted">Loading…</p></div>';
  }
  function auditRecName(r) {
    if (r.tbl === 'students' || r.tbl === 'student_fees') { var s = studentById(r.rec); return s ? s.name : r.rec; }
    if (r.tbl === 'payments') { var p = findPayment(r.rec); return p ? p.receiptNo + ' · ' + p.studentName : r.rec; }
    return r.tbl === 'settings' ? 'School settings' : r.rec;
  }
  function loadAudit() {
    var box = document.getElementById('audit-list'), a = UI.audit;
    if (!box || !SB || !a) return;
    var q = SB.from('audit_log').select('id,at,user_name,user_role,tbl,rec,action,summary').order('at', { ascending: false }).limit(300);
    if (a.tbl) q = q.eq('tbl', a.tbl);
    if (a.action) q = q.eq('action', a.action);
    if (isISODate(a.from)) q = q.gte('at', a.from + 'T00:00:00+05:30');
    if (isISODate(a.to)) q = q.lte('at', a.to + 'T23:59:59+05:30');
    var s = String(a.q || '').replace(/[%_,()*\\]/g, ' ').trim();
    if (s) q = q.or('user_name.ilike.%' + s + '%,summary.ilike.%' + s + '%,rec.ilike.%' + s + '%');
    q.then(function (r) {
      if (!document.getElementById('audit-list')) return;
      if (r.error) { box.innerHTML = '<p class="note warn">Could not load the log: ' + esc(r.error.message) + '</p>'; return; }
      var rows = r.data || [];
      var ACT = { insert: ['Added', '#6cc48a'], update: ['Changed', '#38a8e0'], delete: ['Deleted', '#ff7a6b'] };
      box.innerHTML = rows.length ? '<p class="muted small">' + rows.length + (rows.length === 300 ? '+ (newest 300)' : '') + ' changes</p><ul class="audit-list">' + rows.map(function (x) {
        var ac = ACT[x.action] || [x.action, '#9aa7b4'];
        return '<li><div class="row between"><span>' + badge(ac[0], ac[1]) + ' <b>' + esc(x.tbl) + '</b> · ' + esc(auditRecName(x)) + '</span><small class="muted">' + esc(stampIST(x.at)) + '</small></div><small class="muted">by ' + esc(x.user_name || 'system') + (x.user_role ? ' (' + esc(x.user_role) + ')' : '') + '</small>' + (x.summary ? '<p class="audit-sum">' + esc(x.summary) + '</p>' : '') + '</li>';
      }).join('') + '</ul>' : emptyState('🔎', 'No changes found', 'Try a wider date range or another filter.');
    });
  }

  /* ---------- gallery / events ---------- */
  var VIDEO_TYPES = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };
  var GAL_MAX_VIDEO = 25 * 1024 * 1024;
  function albumById(id) { return S.albums.filter(function (a) { return a.id === id; })[0] || null; }
  function audienceLabel(cid) { return cid ? (CLASS_BY_ID[cid] ? CLASS_BY_ID[cid].emoji + ' ' + className(cid) : cid) : '🏫 ' + t('Whole school'); }
  function viewGallery(arg) {
    if (arg) return viewAlbum(arg);
    var list = S.albums.slice().sort(function (a, b) { return String(a.date || '') < String(b.date || '') ? 1 : -1; });
    var html = isAdmin() ? '<div class="toolbar"><button class="btn primary" data-act="album-add">➕ ' + esc(t('New album')) + '</button></div><p class="muted small">Photos are compressed before upload; videos up to 25 MB. Parents see whole-school albums and their own child’s class albums.</p>' : '';
    if (!list.length) return html + emptyState('🖼️', 'No albums yet', isAdmin() ? 'Create an album for an event (e.g. “Annual Day 2026”) and add photos and videos.' : 'The admin has not shared any albums yet.');
    return html + '<div class="album-grid">' + list.map(function (a) {
      var items = asArray(a.items), cover = items.filter(function (i) { return i.type !== 'video'; })[0];
      return '<a class="album-card card" href="#/gallery/' + encodeURIComponent(a.id) + '">' + (cover ? mediaHTML('gallery', cover.path, 'image', 'album-cover') : '<div class="media album-cover"><span class="media-wait">' + (items.length ? '🎬' : '🖼️') + '</span></div>') +
        '<b>' + esc(a.title) + '</b><small class="muted">' + esc(a.date ? fmtDate(a.date) : '') + ' · ' + items.length + ' item' + (items.length === 1 ? '' : 's') + '</small><small>' + esc(audienceLabel(a.classId)) + '</small></a>';
    }).join('') + '</div>';
  }
  function viewAlbum(id) {
    var a = albumById(id);
    if (!a) return emptyState('🖼️', 'Album not found', 'It may have been deleted.', '<a class="btn primary" href="#/gallery">Back to gallery</a>');
    var items = asArray(a.items);
    var html = '<div class="toolbar"><a class="btn ghost" href="#/gallery">← ' + esc(t('Gallery')) + '</a>' + (isAdmin() ? '<label class="btn primary file-btn">⬆️ ' + esc(t('Upload photos / videos')) + '<input type="file" accept="image/*,video/mp4,video/webm,video/quicktime" multiple data-change="gal-upload" data-id="' + esc(a.id) + '" hidden></label><button class="btn ghost" data-act="album-edit" data-id="' + esc(a.id) + '">' + esc(t('Edit')) + '</button><button class="icon-btn" data-act="album-del" data-id="' + esc(a.id) + '" title="Delete album" aria-label="Delete album">🗑️</button>' : '') + '</div>' +
      '<section class="card"><h2>' + esc(a.title) + '</h2><p class="muted small">' + esc(a.date ? fmtDate(a.date) : '') + ' · ' + esc(audienceLabel(a.classId)) + ' · ' + items.length + ' item' + (items.length === 1 ? '' : 's') + '</p>' + (a.note ? '<p>' + esc(a.note) + '</p>' : '') + '<p id="gal-progress" class="note" hidden></p></section>';
    if (!items.length) return html + emptyState('📷', 'No photos yet', isAdmin() ? 'Tap “Upload” to add photos and videos.' : 'Photos will appear here.');
    return html + '<div class="gal-grid">' + items.map(function (it) {
      return '<figure class="gal-item">' + mediaHTML('gallery', it.path, it.type, 'gal-media') + (isAdmin() ? '<button class="icon-btn gal-del" data-act="gal-del" data-album="' + esc(a.id) + '" data-id="' + esc(it.id) + '" title="Delete" aria-label="Delete">🗑️</button>' : '') + '</figure>';
    }).join('') + '</div>';
  }
  function openAlbumForm(a) {
    openModal({
      title: a ? 'Edit album' : t('New album'), size: 'wide',
      body: '<form class="form" novalidate><div class="grid2">' + field('Album / event title *', '<input name="title" maxlength="80" value="' + esc(a ? a.title : '') + '" placeholder="e.g. Annual Day 2026" required>') +
        field(t('Date'), '<input type="date" name="date" value="' + esc(a ? a.date || '' : todayISO()) + '">') +
        field('Who can see it', '<select name="classId">' + options([{ value: '', label: '🏫 ' + t('Whole school') }].concat(CLASSES.map(function (c) { return { value: c.id, label: c.emoji + ' ' + c.name + ' only' }; })), a ? a.classId || '' : '') + '</select>') +
        field('Note (optional)', '<input name="note" maxlength="200" value="' + esc(a ? a.note || '' : '') + '">') +
        '</div><div class="form-actions"><button type="button" class="btn ghost" data-act="modal-close">' + esc(t('Cancel')) + '</button><button class="btn primary">' + esc(t('Save')) + '</button></div></form>',
      onSubmit: function (form, fd) {
        var g = function (k) { return String(fd.get(k) == null ? '' : fd.get(k)).trim(); };
        if (!g('title')) { fieldError(form, 'title', 'Enter a title'); return false; }
        var rec = Object.assign({}, a || { id: 'al-' + uid(), items: [], createdAt: new Date().toISOString() }, { title: g('title'), date: isISODate(g('date')) ? g('date') : '', classId: CLASS_BY_ID[g('classId')] ? g('classId') : '', note: g('note'), by: ME.name });
        S.albums = S.albums.filter(function (x) { return x.id !== rec.id; }).concat([rec]);
        persist('albums'); toast('Album saved');
        if (!a) location.hash = '#/gallery/' + encodeURIComponent(rec.id); else render();
        return true;
      }
    });
  }
  function galleryUpload(input) {
    var a = albumById(attr(input, 'id'));
    var files = Array.prototype.slice.call(input.files || []);
    input.value = '';
    if (!a || !files.length || !isAdmin()) return;
    var prog = document.getElementById('gal-progress'), done = 0, added = 0, skipped = [];
    var say = function (m) { if (prog) { prog.hidden = false; prog.textContent = m; } };
    var chain = Promise.resolve();
    files.slice(0, 50).forEach(function (file) {
      chain = chain.then(function () {
        say('Uploading ' + (done + 1) + ' of ' + files.length + '…');
        var fid = 'g' + uid(), isVid = /^video\//.test(file.type || '');
        var step;
        if (isVid) {
          var ext = VIDEO_TYPES[file.type];
          if (!ext) { skipped.push(file.name + ' (use MP4, WebM or MOV)'); return; }
          if (file.size > GAL_MAX_VIDEO) { skipped.push(file.name + ' (over 25 MB)'); return; }
          step = upload('gallery', a.id + '/' + fid + '.' + ext, file, file.type).then(function (p) { return { id: fid, path: p, type: 'video', name: String(file.name || '').slice(0, 80), size: file.size, at: new Date().toISOString() }; });
        } else if (/^image\//.test(file.type || '')) {
          step = compressImg(file, 1600, 0.82).then(function (b) { return upload('gallery', a.id + '/' + fid + '.jpg', b, 'image/jpeg').then(function (p) { return { id: fid, path: p, type: 'image', name: String(file.name || '').slice(0, 80), size: b.size, at: new Date().toISOString() }; }); });
        } else { skipped.push(file.name + ' (not a photo or video)'); return; }
        return step.then(function (item) {
          var cur = albumById(a.id); if (!cur) return;
          cur.items = asArray(cur.items).concat([item]).slice(-300); added++;
          persist('albums');
        }).catch(function (e) { skipped.push(file.name + ' (' + e.message + ')'); });
      }).then(function () { done++; });
    });
    chain.then(function () {
      say(added + ' uploaded' + (skipped.length ? ' · skipped: ' + skipped.join(', ') : ''));
      toast(added + ' item' + (added === 1 ? '' : 's') + ' added to ' + a.title, skipped.length ? 'err' : 'ok');
      render();
      if (added) pushNotify('album', { ref: a.id });
    });
  }

  /* ---------- settings cards: language, academic year, phone alerts ---------- */
  function langCardHTML() {
    if (!PART_B) return '';
    return '<section class="card"><h2>🌐 ' + esc(t('Language')) + '</h2><p class="muted small">Menus and main labels. Saved on this phone and for your login.</p>' + langSelectHTML('lang-big') + '</section>';
  }
  function yearCardHTML() {
    return '<section class="card"><h2>📅 ' + esc(t('Academic year')) + '</h2><form class="form" data-form="academic-year" novalidate><div class="grid2">' + field(t('Academic year'), '<input name="academicYear" maxlength="7" value="' + esc(academicYear()) + '" placeholder="2026-27">', '<small class="hint">Shown on ID cards and report cards. Year-end promotion moves it forward.</small>') + '</div><button class="btn primary">' + esc(t('Save')) + '</button></form></section>';
  }
  function alertsCardHTML() {
    if (!PART_B) return '';
    setTimeout(function () {
      var box = document.getElementById('alerts-status');
      if (!box) return;
      pushCall('config').then(function (c) {
        if (!document.getElementById('alerts-status')) return;
        box.innerHTML = c.configured ? '<p class="note">✅ Phone alerts are set up. Parents can tap “Turn on alerts” in the Parents app. Alerts go out for new notices, homework/updates, absent marks (today), gallery albums, and fee reminders (only while fees are shown to parents).</p>'
          : '<div class="callout warn"><b>Phone alerts are not switched on yet</b><p>A one-time setup is needed in Supabase (2 minutes):</p><ol class="install-steps">' +
            '<li>Tap <b>Create alert keys</b> below. Two keys appear once, only on this screen (they are not saved anywhere).</li>' +
            '<li>Open <b>Supabase → your project → Edge Functions → Secrets</b> (Manage secrets).</li>' +
            '<li>Add <b>VAPID_PUBLIC_KEY</b> = the public key, <b>VAPID_PRIVATE_KEY</b> = the private key, and optionally <b>VAPID_SUBJECT</b> = mailto:your school email. Save.</li>' +
            '<li>Come back here and reload: this card turns green.</li></ol><p class="small">Never paste the private key into WhatsApp, email or chat. If it is ever shared, create new keys and replace both secrets (parents then tap “Turn on alerts” again).</p>' +
            '<button class="btn primary" data-act="vapid-gen">🔑 Create alert keys</button><div id="vapid-out"></div></div>';
      }).catch(function (e) { box.innerHTML = '<p class="note warn">Could not check alerts: ' + esc(e.message) + '</p>'; });
    }, 0);
    return '<section class="card"><h2>🔔 ' + esc(t('Phone alerts')) + ' (Parents app)</h2><div id="alerts-status"><p class="muted">Checking…</p></div></section>';
  }

  /* ---------- routes, actions, forms ---------- */
  Object.assign(ROUTES, {
    homework: { title: 'Homework & updates', icon: '📚', roles: ['admin', 'teacher'], render: viewHomework },
    timetable: { title: 'Timetable', icon: '🗓️', roles: ['admin', 'teacher'], render: viewTimetable },
    exams: { title: 'Exams & reports', icon: '📝', roles: ['admin', 'teacher'], render: viewExams },
    gallery: { title: 'Gallery', icon: '🖼️', roles: ['admin', 'teacher'], render: viewGallery },
    transport: { title: 'Transport', icon: '🚐', roles: ['admin'], render: viewTransport },
    idcards: { title: 'ID cards & TC', icon: '🪪', roles: ['admin'], render: viewIdCards },
    promotion: { title: 'Promotion', icon: '🎓', roles: ['admin'], render: viewPromotion },
    feedback: { title: 'Parent messages', icon: '💬', roles: ['admin'], render: viewFeedback },
    audit: { title: 'Audit log', icon: '🔎', roles: ['admin'], render: viewAudit }
  });
  ROUTES.more.roles = ['admin', 'teacher'];
  ROUTE_ORDER = ['dashboard', 'classes', 'attendance', 'homework', 'notices', 'timetable', 'exams', 'gallery', 'fees', 'pending', 'enquiries', 'feedback', 'transport', 'idcards', 'promotion', 'reports', 'expenses', 'staff', 'holidays', 'audit', 'backup', 'settings'];
  var BOTTOM_TEACHER = ['dashboard', 'classes', 'attendance', 'homework', 'more'];
  // v2.7.1: the menu is grouped so the 20+ pages are easy to find (side menu and More).
  var NAV_GROUPS = [
    { id: 'daily', title: 'Daily', icon: '☀️', items: ['dashboard', 'classes', 'attendance', 'homework', 'notices'] },
    { id: 'students', title: 'Students', icon: '🧒', items: ['timetable', 'exams', 'idcards', 'promotion', 'transport'] },
    { id: 'money', title: 'Money', icon: '💰', items: ['fees', 'pending', 'expenses', 'staff', 'reports'] },
    { id: 'school', title: 'School', icon: '🏫', items: ['enquiries', 'feedback', 'gallery', 'holidays'] },
    { id: 'admin', title: 'Admin', icon: '🛠️', items: ['audit', 'backup', 'settings'] }
  ];
  function navGroupsFor(keys) {
    var seen = {};
    var groups = NAV_GROUPS.map(function (g) {
      var items = g.items.filter(function (k) { if (keys.indexOf(k) < 0) return false; seen[k] = 1; return true; });
      return { id: g.id, title: g.title, icon: g.icon, items: items };
    });
    var rest = keys.filter(function (k) { return !seen[k]; });
    if (rest.length) groups.push({ id: 'other', title: 'More', icon: '☰', items: rest });
    return groups.filter(function (g) { return g.items.length; });
  }
  function navClosed() { try { var v = JSON.parse(localStorage.getItem('lw-nav-closed') || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
  function setNavClosed(list) { try { localStorage.setItem('lw-nav-closed', JSON.stringify(list)); } catch (e) { /* ignore */ } }
  function sideNavHTML(keys, link) {
    var closed = navClosed();
    return navGroupsFor(keys).map(function (g) {
      var shut = closed.indexOf(g.id) >= 0;
      return '<div class="nav-sec' + (shut ? ' closed' : '') + '" data-group="' + g.id + '"><button type="button" class="nav-gh" data-act="nav-group" data-id="' + g.id + '" aria-expanded="' + (!shut) + '">' +
        '<span>' + esc(t(g.title)) + '</span><i aria-hidden="true">▾</i></button><div class="nav-items">' + g.items.map(link).join('') + '</div></div>';
    }).join('');
  }
  var MORE_SUB = {
    notices: 'School and class notices', pending: 'Dues and WhatsApp reminders', reports: 'Fees, attendance, enquiries, profit', expenses: 'Rent, snacks, stationery…',
    staff: 'Staff, salary, staff attendance', holidays: 'Holidays and events', backup: 'Download Excel / JSON backup', settings: 'School, fee rules, logins',
    homework: 'Daily homework, learning and meal notes', timetable: 'Weekly class timetable', exams: 'Marks, grades and report cards', gallery: 'School photos and videos',
    transport: 'Vans, drivers and van fees', idcards: 'Printable ID cards and TC', promotion: 'Move students to the next class', feedback: 'Messages from parents', audit: 'Who changed what'
  };

  var B2_ACTIONS = {
    'nav-group': function (el) {
      var id = attr(el, 'id'), sec = el.closest('.nav-sec'); if (!sec) return;
      var shut = !sec.classList.contains('closed'); sec.classList.toggle('closed', shut); el.setAttribute('aria-expanded', String(!shut));
      var list = navClosed().filter(function (x) { return x !== id; }); if (shut) list.push(id); setNavClosed(list);
    },
    'more-group': function (el) {
      var id = 'm-' + attr(el, 'id'), sec = el.closest('.more-sec'); if (!sec) return;
      var shut = !sec.classList.contains('closed'); sec.classList.toggle('closed', shut); el.setAttribute('aria-expanded', String(!shut));
      var list = navClosed().filter(function (x) { return x !== id; }); if (shut) list.push(id); setNavClosed(list);
    },
    'post-add': function () { openPostForm(null); },
    'post-edit': function (el) { var p = findPost(attr(el, 'id')); if (p) openPostForm(p); },
    'post-del': function (el) {
      var p = findPost(attr(el, 'id')); if (!p) return;
      confirmBox('Delete this ' + postKindLabel(p.kind).toLowerCase() + ' post (' + fmtDate(p.date) + ')? Parents will no longer see it.', { ok: t('Delete') }).then(function (ok) {
        if (!ok) return;
        removeFiles('class-media', [p.photo]);
        S.class_posts = S.class_posts.filter(function (x) { return x.id !== p.id; });
        persist('class_posts'); toast('Post deleted'); render();
      });
    },
    'tt-edit': function () { UI.ttEdit = b2Class('ttClass'); render(); },
    'tt-cancel': function () { UI.ttEdit = null; render(); },
    'tt-row-add': function () { var box = document.getElementById('tt-periods'); if (box && box.children.length < 12) box.insertAdjacentHTML('beforeend', ttPeriodHTML(null)); },
    'tt-row-del': function (el) { var p = el.closest('.tt-period'); if (p) p.parentNode.removeChild(p); },
    'exam-add': function () { openExamForm(null); },
    'exam-edit': function (el) { var e = examById(attr(el, 'id')); if (e) openExamForm(e); },
    'exam-del': function (el) {
      var e = examById(attr(el, 'id')); if (!e) return;
      confirmBox('Delete the exam “' + e.name + '” and all its marks? Parents will no longer see these report cards.', { ok: t('Delete') }).then(function (ok) {
        if (!ok) return;
        S.exams = S.exams.filter(function (x) { return x.id !== e.id; });
        S.marks = S.marks.filter(function (m) { return m.examId !== e.id; });
        persist('exams', 'marks'); toast('Exam deleted'); location.hash = '#/exams'; render();
      });
    },
    'rc-view': function (el) { openReportCard(attr(el, 'exam'), attr(el, 'sid')); },
    'rc-print': function (el) { var e = examById(attr(el, 'exam')); if (e) printReportCards(e, [attr(el, 'sid')]); },
    'rc-print-all': function (el) { var e = examById(attr(el, 'id')); if (e) printReportCards(e, activeStudents(e.classId).map(function (s) { return s.id; })); },
    'rc-wa': function (el) {
      var e = examById(attr(el, 'exam')), s = studentById(attr(el, 'sid'));
      if (e && s) waOpen(s.whatsapp || primaryPhone(s), reportCardText(e, s, marksOf(e.id, s.id)));
    },
    'doc-view': function (el) {
      var d = S.student_docs.filter(function (x) { return x.id === attr(el, 'id'); })[0];
      if (!d) return;
      var w = window.open('', '_blank');
      signedURL('student-docs', d.path, 120).then(function (url) {
        if (!url) { if (w) w.close(); toast('Could not open the document', 'err'); return; }
        if (w) w.location.href = url; else location.href = url;
      });
    },
    'doc-del': function (el) {
      var d = S.student_docs.filter(function (x) { return x.id === attr(el, 'id'); })[0];
      if (!d) return;
      confirmBox('Delete the ' + d.type + ' document (' + (d.name || '') + ')? The file is removed permanently.', { ok: t('Delete') }).then(function (ok) {
        if (!ok) return;
        removeFiles('student-docs', [d.path]).then(function () {
          S.student_docs = S.student_docs.filter(function (x) { return x.id !== d.id; });
          persist('student_docs'); toast('Document deleted'); refreshDocs(d.studentId);
        });
      });
    },
    'van-add': function () { openVanForm(null); },
    'van-edit': function (el) { var v = vanById(attr(el, 'id')); if (v) openVanForm(v); },
    'van-students': function (el) { var v = vanById(attr(el, 'id')); if (v) openVanStudents(v); },
    'van-print': printVanList,
    'van-del': function (el) {
      var v = vanById(attr(el, 'id')); if (!v) return;
      if (vanStudents(v.id).length) { toast('Remove its students first (Assign students → untick)', 'err'); return; }
      confirmBox('Delete the van “' + v.name + '”?', { ok: t('Delete') }).then(function (ok) { if (!ok) return; S.vans = S.vans.filter(function (x) { return x.id !== v.id; }); persist('vans'); toast('Van deleted'); render(); });
    },
    'id-all': function (el) { var f = el.closest('form'); if (f) $$('[name=sid]', f).forEach(function (c) { if (!c.closest('.kid-opt').hidden) c.checked = el.checked; }); },
    'tc-new': function (el) { var s = studentById(attr(el, 'id')); if (s && isAdmin()) openTCForm(s); },
    'tc-print': function (el) { var s = studentById(attr(el, 'id')); if (s && s.tc) printDoc('Transfer Certificate', tcHTML(s), 'TC ' + s.tc.no + ' - ' + s.name); },
    'promo-all': function (el) { var f = el.closest('form'); if (f) $$('[name=sid]', f).forEach(function (c) { c.checked = el.checked; }); },
    'promo-undo': function () { if (isAdmin()) undoPromotion(); },
    'fb-filter': function (el) { UI.fbFilter = attr(el, 'f'); render(); },
    'fb-seen': function (el) { var f = fbById(attr(el, 'id')); if (!f) return; f.status = 'Seen'; f.seenAt = new Date().toISOString(); persist('feedback'); showShell(); },
    'fb-reply': function (el) {
      var f = fbById(attr(el, 'id')); if (!f) return;
      openModal({
        title: t('Reply') + ' · ' + (f.parentName || 'Parent'), body: '<form class="form" novalidate><p class="pre muted">' + esc(f.message || '') + '</p>' + field('Reply note (the parent sees this in the app)', '<textarea name="reply" rows="4" maxlength="500">' + esc(f.reply || '') + '</textarea>') +
          '<div class="form-actions"><button type="button" class="btn ghost" data-act="modal-close">' + esc(t('Cancel')) + '</button><button class="btn primary">' + esc(t('Save')) + '</button></div></form>',
        onSubmit: function (form, fd) {
          var r = String(fd.get('reply') || '').trim().slice(0, 500);
          if (!r) { fieldError(form, 'reply', 'Write a short reply'); return false; }
          f.reply = r; f.status = 'Replied'; f.repliedAt = new Date().toISOString(); if (!f.seenAt) f.seenAt = f.repliedAt;
          persist('feedback'); toast('Reply saved'); showShell(); return true;
        }
      });
    },
    'fb-del': function (el) {
      var f = fbById(attr(el, 'id')); if (!f) return;
      confirmBox('Delete this message from ' + (f.parentName || 'the parent') + '?', { ok: t('Delete') }).then(function (ok) { if (!ok) return; S.feedback = S.feedback.filter(function (x) { return x.id !== f.id; }); persist('feedback'); toast('Message deleted'); showShell(); });
    },
    'album-add': function () { if (isAdmin()) openAlbumForm(null); },
    'album-edit': function (el) { var a = albumById(attr(el, 'id')); if (a && isAdmin()) openAlbumForm(a); },
    'album-del': function (el) {
      var a = albumById(attr(el, 'id')); if (!a || !isAdmin()) return;
      confirmBox('Delete the album “' + a.title + '” and its ' + asArray(a.items).length + ' photos/videos? This cannot be undone.', { ok: t('Delete') }).then(function (ok) {
        if (!ok) return;
        removeFiles('gallery', asArray(a.items).map(function (i) { return i.path; })).then(function () {
          S.albums = S.albums.filter(function (x) { return x.id !== a.id; });
          persist('albums'); toast('Album deleted'); location.hash = '#/gallery';
        });
      });
    },
    'gal-del': function (el) {
      var a = albumById(attr(el, 'album')); if (!a || !isAdmin()) return;
      var it = asArray(a.items).filter(function (i) { return i.id === attr(el, 'id'); })[0]; if (!it) return;
      confirmBox('Delete this ' + (it.type === 'video' ? 'video' : 'photo') + '?', { ok: t('Delete') }).then(function (ok) {
        if (!ok) return;
        removeFiles('gallery', [it.path]).then(function () { a.items = asArray(a.items).filter(function (i) { return i.id !== it.id; }); persist('albums'); toast('Deleted'); render(); });
      });
    },
    'media-open': function (el) { if (el.src) window.open(el.src, '_blank', 'noopener'); },
    'vapid-gen': function (el) {
      if (!isAdmin()) return;
      confirmBox('Create a new pair of alert keys? Only do this once, during setup (or if the private key was ever shared). The keys are shown only here and not saved.', { ok: 'Create keys', danger: false, title: 'Alert keys' }).then(function (ok) {
        if (!ok) return;
        el.disabled = true;
        pushCall('generate_keys').then(function (k) {
          var out = document.getElementById('vapid-out'); if (!out) return;
          out.innerHTML = '<div class="vapid-keys">' + field('VAPID_PUBLIC_KEY', '<input readonly value="' + esc(k.publicKey) + '" data-act="select-all">') + field('VAPID_PRIVATE_KEY (secret — paste only into Supabase secrets)', '<input readonly value="' + esc(k.privateKey) + '" data-act="select-all">') + '<p class="small">Tap a key to select it, then copy. Close this page when done; the keys disappear.</p></div>';
        }).catch(function (e) { el.disabled = false; toast(e.message, 'err'); });
      });
    },
    'select-all': function (el) { try { el.select(); } catch (e) { /* ignore */ } }
  };
  var B2_CHANGES = {
    'b2-class': function (el) { UI[attr(el, 'key')] = el.value; UI.ttEdit = null; render(); },
    'lang': function (el) { setLang(el.value); },
    'exam-publish': function (el) {
      var e = examById(attr(el, 'id')); if (!e || !isAdmin()) return;
      e.published = !!el.checked; e.publishedAt = el.checked ? new Date().toISOString() : '';
      persist('exams'); toast(el.checked ? 'Report cards published to parents ✅' : 'Report cards hidden from parents'); render();
    },
    'gal-upload': function (el) { galleryUpload(el); }
  };
  var B2_FORMS = {
    'tt-save': function (f, fd) {
      var cid = UI.ttEdit; if (!CLASS_BY_ID[cid]) return;
      var periods = $$('.tt-period', f).map(function (blk) {
        var time = String($('[name=time]', blk).value || '').trim().slice(0, 30);
        var cells = TT_DAYS.map(function (d, i) { var inp = $('[name=cell][data-day="' + i + '"]', blk); return inp ? String(inp.value || '').trim().slice(0, 60) : ''; });
        return { time: time, cells: cells };
      }).filter(function (p) { return p.time || p.cells.some(Boolean); }).slice(0, 12);
      var rec = { id: cid, classId: cid, periods: periods, note: String(fd.get('note') || '').trim().slice(0, 200), by: ME.name, at: new Date().toISOString() };
      S.timetables = S.timetables.filter(function (x) { return x.id !== cid; }).concat([rec]);
      persist('timetables'); UI.ttEdit = null; toast('Timetable saved for ' + className(cid)); render();
    },
    'marks-save': function (f, fd) {
      var e = examById(f.getAttribute('data-id')); if (!e) return;
      var bad = '', n = 0;
      activeStudents(e.classId).forEach(function (s) {
        var marks = {}, any = false;
        asArray(e.subjects).forEach(function (sub, i) {
          var v = String(fd.get('m|' + s.id + '|' + i) || '').trim().slice(0, 12);
          if (v && num(sub.max) > 0 && !/^ab$/i.test(v)) { var x = parseFloat(v); if (!isFinite(x) || x < 0 || x > num(sub.max) || !/^\d+(\.\d+)?$/.test(v)) { bad = bad || s.name + ' – ' + sub.name + ': enter 0–' + num(sub.max) + ' or AB'; return; } }
          if (/^ab$/i.test(v)) v = 'AB';
          marks[sub.name] = v; if (v) any = true;
        });
        var remarks = String(fd.get('r|' + s.id) || '').trim().slice(0, 600);
        var id = 'mk-' + e.id + '-' + s.id, old = marksOf(e.id, s.id);
        if (!any && !remarks && !old) return;
        var rec = { id: id, classId: e.classId, examId: e.id, studentId: s.id, marks: marks, remarks: remarks, by: ME.name, at: new Date().toISOString() };
        if (old && JSON.stringify(old.marks) === JSON.stringify(marks) && (old.remarks || '') === remarks) return;
        S.marks = S.marks.filter(function (m) { return m.id !== id && !(m.examId === e.id && m.studentId === s.id); }).concat([rec]); n++;
      });
      if (bad) { toast(bad, 'err'); return; }
      persist('marks'); toast(n ? 'Marks saved for ' + n + ' student' + (n === 1 ? '' : 's') : 'No changes'); render();
    },
    'doc-upload': function (f, fd) {
      var sid = f.getAttribute('data-id'), s = studentById(sid), file = fd.get('file'), type = DOC_TYPES.indexOf(String(fd.get('type'))) >= 0 ? String(fd.get('type')) : 'Other';
      if (!s || !isAdmin()) return;
      if (!file || !file.size) { fieldError(f, 'file', 'Choose a file'); return; }
      var mt = file.type || '', ext = mt === 'application/pdf' ? 'pdf' : mt === 'image/png' ? 'png' : mt === 'image/webp' ? 'webp' : mt === 'image/jpeg' ? 'jpg' : '';
      if (!ext) { fieldError(f, 'file', 'Use a PDF, JPG, PNG or WebP file'); return; }
      var step = Promise.resolve(file);
      if (ext !== 'pdf' && file.size > 3 * 1024 * 1024) { ext = 'jpg'; mt = 'image/jpeg'; step = compressImg(file, 2200, 0.85); }
      return step.then(function (blob) {
        if (blob.size > 10 * 1024 * 1024) throw new Error('The file is over 10 MB');
        var id = 'dc-' + uid(), path = sid + '/' + id + '.' + ext;
        return upload('student-docs', path, blob, mt).then(function () {
          S.student_docs.push({ id: id, studentId: sid, type: type, name: String(file.name || type).slice(0, 80), path: path, size: blob.size, mime: mt, at: new Date().toISOString(), by: ME.name });
          persist('student_docs'); toast(type + ' uploaded'); refreshDocs(sid);
        });
      }).catch(function (e) { fieldError(f, 'file', e.message); });
    },
    'id-print': function (f, fd) { printIdCards(fd.getAll('sid').map(String)); },
    'promo-run': function (f, fd) { if (isAdmin()) return runPromotion(f, fd); },
    'audit-filter': function (f, fd) {
      UI.audit = { tbl: String(fd.get('tbl') || ''), action: String(fd.get('action') || ''), from: String(fd.get('from') || ''), to: String(fd.get('to') || ''), q: String(fd.get('q') || '').trim().slice(0, 40) };
      var box = document.getElementById('audit-list'); if (box) box.innerHTML = '<p class="muted">Loading…</p>';
      loadAudit();
    },
    'academic-year': function (f, fd) {
      var y = String(fd.get('academicYear') || '').trim();
      if (!/^\d{4}-\d{2}$/.test(y)) return fieldError(f, 'academicYear', 'Use the form 2026-27');
      S.settings.academicYear = y; persist('settings'); toast(t('Academic year') + ': ' + y);
    }
  };
  Object.keys(B2_FORMS).forEach(function (k) { FORMS[k] = B2_FORMS[k]; });

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
      confirmBox('Delete ' + s.name + ' (' + className(s.classId) + ')? Their attendance records will also be removed.' + (np ? ' Their ' + np + ' payment receipt(s) will be kept for your accounts.' : '') + ' Tip: set status to “Inactive” instead to keep history.', { ok: 'Delete student' }).then(function (ok) {
        if (!ok) return;
        if (s.photoPath) removeStudentPhoto(s.photoPath);
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
    'backup-xlsx': function () { if (isAdmin()) doBackupXlsx(); },
    'remind-one': function (el) {
      var x = pendingRows('').filter(function (r) { return r.s.id === attr(el, 'id'); })[0];
      if (!x) return;
      recordReminder(x);
      toast('Reminder opened in WhatsApp for ' + x.s.name);
      setTimeout(render, 400);
    },
    'remind-all': function () { if (isAdmin()) openRemindAll(); },
    'remind-skip': function () { if (remindQ) { remindQ.i++; remindStep(); } },
    'remind-send': function () {
      if (!remindQ) return;
      var x = remindQ.list[remindQ.i];
      recordReminder(x); remindQ.sent++; remindQ.i++;
      setTimeout(remindStep, 400);
    },
    'hol-add': function () { if (isAdmin()) openHolidayForm(null); },
    'hol-edit': function (el) { var h = S.holidays.filter(function (x) { return x.id === attr(el, 'id'); })[0]; if (h && isAdmin()) openHolidayForm(h); },
    'hol-del': function (el) {
      var h = S.holidays.filter(function (x) { return x.id === attr(el, 'id'); })[0];
      if (!h || !isAdmin()) return;
      confirmBox('Delete “' + (h.title || 'Holiday') + '” (' + holRange(h) + ')?', { ok: 'Delete' }).then(function (ok) {
        if (!ok) return;
        S.holidays = S.holidays.filter(function (x) { return x.id !== h.id; });
        persist('holidays'); toast('Deleted'); render();
      });
    },
    'hol-presets': function () { if (isAdmin()) addPresetHolidays(); },
    'att-force': function () { UI.attForce[UI.attDate] = 1; render(); },
    'att-prevday': function () {
      var d = UI.attDate, guard = 0;
      do { var t = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) - 86400000); d = t.toISOString().slice(0, 10); } while (offDay(d) && guard++ < 70);
      UI.attDate = d; render();
    },
    'exp-add': function () { if (isAdmin()) openExpenseForm(null); },
    'exp-edit': function (el) { var x = S.expenses.filter(function (y) { return y.id === attr(el, 'id'); })[0]; if (x) openExpenseForm(x); },
    'exp-del': function (el) {
      var x = S.expenses.filter(function (y) { return y.id === attr(el, 'id'); })[0];
      if (!x) return;
      confirmBox('Delete the ' + x.category + ' expense of ' + inr(x.amount) + ' on ' + fmtDate(x.date) + '?', { ok: 'Delete expense' }).then(function (ok) {
        if (!ok) return;
        S.expenses = S.expenses.filter(function (y) { return y.id !== x.id; });
        persist('expenses'); toast('Expense deleted'); render();
      });
    },
    'staff-tab': function (el) { UI.staffTab = attr(el, 'tab'); render(); },
    'sal-pay': function (el) { if (isAdmin()) openSalaryForm(attr(el, 'id')); },
    'sal-slip': function (el) { openSalarySlip(attr(el, 'id')); },
    'sal-print': function (el) {
      var x = S.salaries.filter(function (r) { return r.id === attr(el, 'id'); })[0];
      if (x) printDoc('Salary slip · ' + fmtMonth(x.month), salarySlipHTML(x), 'Salary slip ' + (x.slipNo || '') + ' - ' + x.staffName);
    },
    'sal-del': function (el) {
      var x = S.salaries.filter(function (r) { return r.id === attr(el, 'id'); })[0];
      if (!x) return;
      confirmBox('Delete the salary payment of ' + inr(x.amount) + ' to ' + x.staffName + ' for ' + fmtMonth(x.month) + '?', { ok: 'Delete' }).then(function (ok) {
        if (!ok) return;
        S.salaries = S.salaries.filter(function (r) { return r.id !== x.id; });
        persist('salaries'); toast('Salary payment deleted'); render();
      });
    },
    'satt-set': function (el) {
      var dr = UI.sattDraft; if (!dr) return;
      var sid = attr(el, 'sid'), v = attr(el, 'v');
      if (dr.data[sid] === v) delete dr.data[sid]; else dr.data[sid] = v;
      dr.dirty = true; render();
    },
    'satt-all': function () { var dr = UI.sattDraft; if (!dr) return; activeStaff().forEach(function (s) { dr.data[s.id] = 'P'; }); dr.dirty = true; render(); },
    'satt-save': function () {
      var dr = UI.sattDraft; if (!dr || !isAdmin()) return;
      var rec = Object.assign({}, staffAttRec(dr.date) || {});
      delete rec.id;
      activeStaff().forEach(function (s) { if (dr.data[s.id]) rec[s.id] = dr.data[s.id]; else delete rec[s.id]; });
      S.staff_attendance = S.staff_attendance.filter(function (r) { return r.id !== dr.date; });
      if (Object.keys(rec).length) S.staff_attendance.push(Object.assign({ id: dr.date }, rec));
      persist('staff_attendance');
      dr.dirty = false;
      toast('Staff attendance saved · ' + fmtDate(dr.date));
      render();
    },
    'rep-tab': function (el) { UI.repTab = attr(el, 'tab'); render(); },
    'rep-print': function () { var r = currentReport(); printDoc(r.title, '<div class="pdoc-body">' + r.html + '</div>', 'Little Wings ' + r.title); },
    'rep-xlsx': exportReportsXlsx,
    'enq-seen': function (el) { var e = findEnq(attr(el, 'id')); if (!e) return; e.seen = true; e.seenAt = new Date().toISOString(); persist('enquiries'); showShell(); },
    'enq-seen-all': function () { var n = 0; S.enquiries.forEach(function (e) { if (e.web && !e.seen) { e.seen = true; e.seenAt = new Date().toISOString(); n++; } }); if (n) { persist('enquiries'); toast(n + ' marked seen'); showShell(); } },
    'tpl-reset': function () {
      confirmBox('Reset both WhatsApp messages to the default wording?', { ok: 'Reset', danger: false, title: 'Reset messages' }).then(function (ok) {
        if (!ok) return;
        S.settings.tplFee = ''; S.settings.tplBirthday = ''; persist('settings'); toast('Messages reset'); render();
      });
    },
    'csv': function (el) { exportCSV(attr(el, 't')); },
    'erase': doErase
  };
  var CHANGES = {
    'student-status': function (el) { UI.classStatus = el.value; var l = $('#student-list'); if (l) { l.innerHTML = studentListHTML(UI.classTab); hydratePhotos(l); } },
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
    'pend-class': function (el) { UI.pendClass = CLASS_BY_ID[el.value] ? el.value : ''; render(); },
    'exp-month': function (el) { if (isMonth(el.value)) { UI.expMonth = el.value; render(); } },
    'sal-month': function (el) { if (isMonth(el.value)) { UI.salMonth = el.value; render(); } },
    'rep-month': function (el) { if (isMonth(el.value)) { UI.repMonth = el.value > thisMonth() ? thisMonth() : el.value; render(); } },
    'satt-date': function (el) {
      if (!isISODate(el.value)) return;
      if (UI.sattDraft && UI.sattDraft.dirty && !window.confirm('Leave without saving staff attendance?')) { el.value = UI.sattDate; return; }
      UI.sattDate = el.value > todayISO() ? todayISO() : el.value; UI.sattDraft = null; render();
    },
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
  Object.keys(B2_ACTIONS).forEach(function (k) { ACTIONS[k] = B2_ACTIONS[k]; });
  Object.keys(B2_CHANGES).forEach(function (k) { CHANGES[k] = B2_CHANGES[k]; });

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
