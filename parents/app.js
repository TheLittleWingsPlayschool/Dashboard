/*!
 * Little Wings Parents (v1.1.0) — attendance, notices and fee receipts for parents.
 * Plain static app, no build step. Talks to the school's Supabase project with
 * the PUBLIC publishable key only; what a parent can see is decided by the
 * database (RLS + parent-only RPCs). Child data is cached in this browser for
 * offline viewing and removed on sign-out.
 */
(function () {
  'use strict';

  var VERSION = '1.1.0';
  var TZ = 'Asia/Kolkata';
  var DOMAIN = 'parents.littlewings.app';
  var OFFICE = '+91 79955 54105', OFFICE_TEL = 'tel:+917995554105';
  var CACHE = 'lwp_c_', SEEN = 'lwp_seen_';
  var CLASSES = {
    toddlers: { name: 'Toddlers', emoji: '🐣', color: '#ffc93c' },
    nursery: { name: 'Nursery', emoji: '🌱', color: '#38a8e0' },
    lkg: { name: 'LKG', emoji: '🎨', color: '#ff7a6b' },
    ukg: { name: 'UKG', emoji: '🚀', color: '#6cc48a' }
  };
  var ST = {
    P: { label: 'Present', cls: 'p', emoji: '✅', short: 'P' },
    A: { label: 'Absent', cls: 'a', emoji: '❌', short: 'A' },
    L: { label: 'Leave', cls: 'l', emoji: '🌴', short: 'L' },
    H: { label: 'Half-day', cls: 'h', emoji: '🌗', short: '½' }
  };
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  var CFG = window.LW_CONFIG || {};
  var SB = (window.supabase && CFG.supabaseUrl && CFG.supabaseKey) ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'lw-parent-auth' }
  }) : null;

  /* ---------- small helpers ---------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var dparts = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  function todayISO() { var p = {}; dparts.formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; }); return p.year + '-' + p.month + '-' + p.day; }
  function thisMonth() { return todayISO().slice(0, 7); }
  function addMonths(ym, n) { var y = +ym.slice(0, 4), m = +ym.slice(5, 7) + n; y += Math.floor((m - 1) / 12); m = (((m - 1) % 12) + 12) % 12 + 1; return y + '-' + String(m).padStart(2, '0'); }
  function daysIn(ym) { return new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0).getDate(); }
  function weekday(iso) { return new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)).getDay(); }
  function monthName(ym) { return MONTHS[+ym.slice(5, 7) - 1] + ' ' + ym.slice(0, 4); }
  function niceDate(iso) { var d = new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)); return d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }); }
  function stamp(iso) { try { return new Intl.DateTimeFormat('en-IN', { timeZone: TZ, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso)); } catch (e) { return ''; } }
  function normPhone(p) { var d = String(p || '').replace(/\D/g, ''); if (d.length === 12 && d.indexOf('91') === 0) d = d.slice(2); else if (d.length === 11 && d.charAt(0) === '0') d = d.slice(1); return d; }
  function fmtMobile(d) { return d && d.length === 10 ? d.slice(0, 5) + ' ' + d.slice(5) : d || ''; }
  function className(id) { return CLASSES[id] ? CLASSES[id].name : ''; }
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage full: ignore */ } }
  function isNetErr(e) { var m = (e && (e.message || e.details)) || String(e || ''); return navigator.onLine === false || /fetch|network|load failed|timeout|offline/i.test(m); }
  function toast(msg, type) {
    var root = $('#toast-root'); if (!root) return;
    var el = document.createElement('div'); el.className = 'toast ' + (type || ''); el.textContent = msg; root.appendChild(el);
    while (root.children.length > 2) root.removeChild(root.firstChild);
    setTimeout(function () { el.classList.add('out'); }, 2600); setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 3000);
  }
  function isStandalone() { return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true; }

  /* ---------- state ---------- */
  var S = null; // { uid, name, phone, children:[], cur, month, att:{sid:{ym:{day:st}}}, fees:{sid:{enabled,sum,pays}}, notices:[], savedAt, error }
  var tab = 'home', online = navigator.onLine !== false, loading = false, deferredInstall = null, channel = null, pollT = null, lastRefresh = 0;

  function cacheKey() { return CACHE + S.uid; }
  function saveCache() { if (S) lsSet(cacheKey(), { v: 1, name: S.name, phone: S.phone, children: S.children, cur: S.cur, att: S.att, fees: S.fees, notices: S.notices, savedAt: S.savedAt }); }
  function clearAllLocal() {
    try { Object.keys(localStorage).forEach(function (k) { if (k.indexOf('lwp_') === 0) localStorage.removeItem(k); }); } catch (e) { /* ignore */ }
  }
  function child() { if (!S) return null; for (var i = 0; i < S.children.length; i++) if (S.children[i].id === S.cur) return S.children[i]; return S.children[0] || null; }
  function attFor(sid, ym) { return (S.att[sid] && S.att[sid][ym]) || null; }

  /* ---------- auth screens ---------- */
  function installHint() {
    if (isStandalone()) return '';
    return '<div class="install-hint"><p id="install-btn-wrap"' + (deferredInstall ? '' : ' hidden') + '><button type="button" class="btn sky block" data-act="install">📲 Install app</button></p>' +
      '<details><summary>📲 Install this app on your phone</summary><ol class="install-steps">' +
      '<li><b>iPhone (Safari):</b> tap <b>Share</b> (square with arrow ⬆️) → <b>Add to Home Screen</b> → <b>Add</b>.</li>' +
      '<li><b>Android (Chrome):</b> tap <b>⋮</b> (menu) → <b>Install app</b> or <b>Add to Home screen</b>.</li></ol></details></div>';
  }
  function showLogin(msg, isErr) {
    stopLive();
    S = null;
    document.title = 'Little Wings Parents';
    $('#app').innerHTML = '<div class="auth-wrap"><div class="auth-card">' +
      '<img class="auth-logo" src="../assets/logo.jpeg" alt="The Little Wings Play School logo" width="104" height="104">' +
      '<h1>Little Wings Parents</h1><p class="hello"><span class="telugu">నమస్తే 🙏</span> Welcome! See your child’s attendance, fee receipts and school notices.</p>' +
      '<form id="login" novalidate>' +
      '<label class="field"><span class="lbl">Mobile number</span><span class="tel-wrap"><span class="cc">+91</span><input name="mobile" type="tel" inputmode="numeric" autocomplete="username" maxlength="14" placeholder="98765 43210" value="' + esc(fmtMobile(lsGet('lwp_last') || '')) + '" required></span></label>' +
      '<label class="field"><span class="lbl">Password</span><span class="pw-wrap"><input name="password" type="password" autocomplete="current-password" maxlength="72" required><button type="button" class="pw-toggle" data-act="pw" aria-label="Show password">👁️</button></span></label>' +
      (msg ? '<p class="note ' + (isErr ? 'err-box' : '') + '">' + esc(msg) + '</p>' : '') +
      '<button class="btn primary block">Sign in</button>' +
      '<p class="note warn small"><b>Forgot password?</b> Please ask the school office: <a href="' + OFFICE_TEL + '">' + OFFICE + '</a>.</p>' +
      '</form>' + installHint() + '</div><p class="auth-foot">🔐 Your login shows only your own child’s details. · The Little Wings Play School, Vuyyuru · v' + VERSION + '</p></div>';
    var f = $('#login');
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      $$('.err', f).forEach(function (x) { x.remove(); }); $$('.invalid', f).forEach(function (x) { x.classList.remove('invalid'); });
      var mob = normPhone(f.mobile.value), pw = f.password.value;
      if (!/^[6-9]\d{9}$/.test(mob)) return fieldErr(f, 'mobile', 'Enter your 10-digit mobile number');
      if (!pw) return fieldErr(f, 'password', 'Enter your password');
      var btn = $('button.primary', f); btn.disabled = true; btn.textContent = 'Signing in…';
      SB.auth.signInWithPassword({ email: mob + '@' + DOMAIN, password: pw }).then(function (r) {
        btn.disabled = false; btn.textContent = 'Sign in';
        if (r.error) {
          f.password.value = '';
          var m = r.error.message || '';
          return fieldErr(f, 'password', /invalid login/i.test(m) ? 'Wrong mobile number or password.' : /fetch|network/i.test(m) ? 'No internet. Please try again.' : /rate|too many/i.test(m) ? 'Too many tries. Please wait a few minutes.' : m);
        }
        lsSet('lwp_last', mob);
        start(r.data.session.user);
      }).catch(function (err) { btn.disabled = false; btn.textContent = 'Sign in'; fieldErr(f, 'password', isNetErr(err) ? 'No internet. Please try again.' : err.message); });
    });
  }
  function fieldErr(f, name, msg) {
    var inp = f.querySelector('[name="' + name + '"]'), wrap = inp.closest('.field');
    wrap.classList.add('invalid');
    var s = document.createElement('small'); s.className = 'err'; s.textContent = msg; wrap.appendChild(s);
    inp.focus();
  }
  function showLoading(msg) {
    $('#app').innerHTML = '<div class="auth-wrap"><div class="auth-card center"><img class="auth-logo" src="../assets/logo.jpeg" alt="" width="104" height="104"><h1>Little Wings Parents</h1><p class="hello">' + esc(msg || 'Loading…') + '</p><div class="spinner"></div></div></div>';
  }

  /* ---------- session ---------- */
  function start(user) {
    var email = user.email || '';
    S = { uid: user.id, name: '', phone: email.split('@')[1] === DOMAIN ? email.split('@')[0] : '', children: [], cur: '', month: thisMonth(), att: {}, fees: {}, notices: [], savedAt: null, error: '' };
    var c = lsGet(cacheKey());
    if (c && c.v === 1) {
      S.name = c.name || ''; S.children = Array.isArray(c.children) ? c.children : []; S.cur = c.cur || '';
      S.att = c.att && typeof c.att === 'object' ? c.att : {}; S.fees = c.fees && typeof c.fees === 'object' ? c.fees : {}; S.notices = Array.isArray(c.notices) ? c.notices : []; S.savedAt = c.savedAt || null;
    }
    if (S.children.length) render(); else showLoading('Loading your child’s details…');
    startLive();
    refresh(true);
  }
  function signOut(msg, isErr) {
    stopLive();
    clearAllLocal();
    closeSheet();
    var done = function () { showLogin(msg || 'You have signed out. Your child’s details were removed from this phone.', isErr); };
    if (SB) SB.auth.signOut({ scope: 'local' }).catch(function () {}).then(done); else done();
  }

  function rpcAttendance(sid, ym) {
    return SB.rpc('parent_attendance', { p_student: sid, p_from: ym + '-01', p_to: ym + '-' + String(daysIn(ym)).padStart(2, '0') }).then(function (r) {
      if (r.error) throw r.error;
      var m = {}; (r.data || []).forEach(function (x) { if (ST[x.status]) m[String(x.day).slice(0, 10)] = x.status; });
      S.att[sid] = S.att[sid] || {}; S.att[sid][ym] = m;
    });
  }
  // Fees: only through the parent_fees / parent_payments RPCs. The database
  // returns the signed-in parent's own child only, and nothing at all unless
  // the school switched on "Show fees to parents".
  function rpcFees(sid) {
    return Promise.all([SB.rpc('parent_fees', { p_student: sid }), SB.rpc('parent_payments', { p_student: sid })]).then(function (r) {
      if (r[0].error) throw r[0].error;
      if (r[1].error) throw r[1].error;
      var sum = (r[0].data || [])[0] || null;
      // The switch is school-wide: when it is off, forget every child's saved fee data on this phone.
      if (!sum || !sum.enabled) { if (sum && !sum.enabled) S.fees = {}; S.fees[sid] = { enabled: false, at: new Date().toISOString() }; return; }
      S.fees[sid] = { enabled: true, sum: sum, pays: r[1].data || [], at: new Date().toISOString() };
    });
  }
  function loadNotices() {
    return SB.from('notices').select('id,title,body,audience,pinned,expires_on,author_name,author_role,created_at')
      .order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(100).then(function (r) {
        if (r.error) throw r.error;
        S.notices = r.data || [];
      });
  }
  function refresh(full) {
    if (!S || !SB) return Promise.resolve();
    if (navigator.onLine === false) { online = false; render(); return Promise.resolve(); }
    if (loading) return Promise.resolve();
    loading = true; lastRefresh = Date.now();
    var uid = S.uid;
    var p = full ? SB.from('profiles').select('role,name').eq('id', uid).maybeSingle().then(function (r) {
      if (r.error) throw r.error;
      if (!r.data || r.data.role !== 'parent') { var e = new Error('not-parent'); e.notParent = !!r.data; e.noAccess = true; throw e; }
      S.name = r.data.name || S.name;
      return SB.rpc('parent_children');
    }).then(function (r) {
      if (r.error) throw r.error;
      S.children = (r.data || []).map(function (k) { return { id: k.id, name: k.name, classId: k.class_id }; });
      if (!S.children.some(function (k) { return k.id === S.cur; })) S.cur = S.children[0] ? S.children[0].id : '';
    }) : Promise.resolve();
    return p.then(function () {
      var jobs = [loadNotices()];
      var k = child();
      if (k) {
        jobs.push(rpcAttendance(k.id, thisMonth()));
        jobs.push(rpcFees(k.id));
        if (S.month !== thisMonth()) jobs.push(rpcAttendance(k.id, S.month));
      }
      return Promise.all(jobs);
    }).then(function () {
      if (!S || S.uid !== uid) return;
      online = true; S.error = ''; S.savedAt = new Date().toISOString();
      saveCache(); loading = false; render();
    }).catch(function (e) {
      loading = false;
      if (!S || S.uid !== uid) return;
      if (e && e.noAccess) { signOut(e.notParent ? 'This login is not a parent login. Staff please use the school dashboard.' : 'Your login was removed. Please contact the school office: ' + OFFICE + '.', true); return; }
      if (e && (e.status === 401 || /jwt|token/i.test(e.message || ''))) { signOut('Please sign in again.', true); return; }
      if (isNetErr(e)) online = false; else S.error = 'Could not refresh (' + (e.message || 'error') + '). Pull down to try again.';
      render();
    });
  }
  function startLive() {
    stopLive();
    try {
      channel = SB.channel('lwp-notices-' + S.uid)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'notices' }, function () { setTimeout(function () { if (S) loadNotices().then(function () { saveCache(); render(); }).catch(function () {}); }, 600); })
        .subscribe();
    } catch (e) { /* polling below still works */ }
    pollT = setInterval(function () { if (S && document.visibilityState !== 'hidden' && Date.now() - lastRefresh > 55000) refresh(false); }, 60000);
  }
  function stopLive() {
    if (channel && SB) { try { SB.removeChannel(channel); } catch (e) { /* ignore */ } }
    channel = null; clearInterval(pollT); pollT = null;
  }

  /* ---------- views ---------- */
  function seenAt() { return (S && lsGet(SEEN + S.uid)) || ''; }
  function newCount() { var t = seenAt(); return S.notices.filter(function (n) { return !t || n.created_at > t; }).length; }
  function header() {
    var k = child();
    var sub = k ? (CLASSES[k.classId] ? CLASSES[k.classId].emoji + ' ' : '') + className(k.classId) + ' · The Little Wings' : 'The Little Wings Play School';
    var html = '<header class="top"><div class="top-row"><img src="../assets/logo.jpeg" alt="" width="42" height="42"><div class="top-title"><b>' + esc(k ? k.name : 'Little Wings Parents') + '</b><small>' + esc(sub) + '</small></div>' +
      '<button class="icon-btn" data-act="refresh" aria-label="Refresh" title="Refresh">' + (loading ? '⏳' : '🔄') + '</button><button class="icon-btn" data-act="account" aria-label="My account" title="My account">👤</button></div>';
    if (S.children.length > 1) html += '<div class="kid-switch" role="tablist" aria-label="Choose child">' + S.children.map(function (c) { return '<button class="kid-chip' + (c.id === S.cur ? ' active' : '') + '" data-act="kid" data-id="' + esc(c.id) + '" role="tab" aria-selected="' + (c.id === S.cur) + '">' + esc(c.name) + '</button>'; }).join('') + '</div>';
    html += '</header>';
    if (!online) html += '<div class="banner offline">📴 You are offline. Showing what was saved' + (S.savedAt ? ' on ' + esc(stamp(S.savedAt)) : '') + '.</div>';
    else if (S.error) html += '<div class="banner error">' + esc(S.error) + '</div>';
    return html;
  }
  function counts(m, ym) {
    var c = { P: 0, A: 0, L: 0, H: 0, marked: 0, pct: null };
    Object.keys(m || {}).forEach(function (d) { if (d.slice(0, 7) === ym && ST[m[d]]) { c[m[d]]++; c.marked++; } });
    if (c.marked) c.pct = Math.round((c.P + 0.5 * c.H) / c.marked * 100);
    return c;
  }
  function summaryHTML(m, ym) {
    var c = counts(m, ym);
    return '<div class="sum-grid">' + ['P', 'A', 'L', 'H'].map(function (s) { return '<div class="sum ' + ST[s].cls + '"><b>' + c[s] + '</b><span>' + ST[s].label + '</span></div>'; }).join('') + '</div>' +
      '<div class="pct"><div class="pct-row"><span>Attendance</span><span>' + (c.pct == null ? '—' : c.pct + '%') + '</span></div><div class="pct-bar"><i style="width:' + (c.pct || 0) + '%"></i></div>' +
      '<p class="muted small">' + (c.marked ? c.marked + ' school day' + (c.marked === 1 ? '' : 's') + ' marked in ' + esc(monthName(ym)) + '.' : 'No attendance marked yet in ' + esc(monthName(ym)) + '.') + '</p></div>';
  }
  function noticeHTML(n, isNew) {
    var tag = n.audience === 'all' ? '<span class="tag school">🏫 School</span>' : '<span class="tag cls" style="--c:' + esc((CLASSES[n.audience] || {}).color || '#38a8e0') + '">' + esc((CLASSES[n.audience] || {}).emoji || '') + ' ' + esc(className(n.audience) || 'Class') + '</span>';
    return '<article class="notice' + (n.pinned ? ' pinned' : '') + '"><div class="tags">' + tag + (n.pinned ? '<span class="tag pin">📌 Pinned</span>' : '') + (isNew ? '<span class="tag new">New</span>' : '') + '</div>' +
      '<h3>' + esc(n.title) + '</h3>' + (n.body ? '<p class="body">' + esc(n.body) + '</p>' : '') +
      '<p class="meta">' + esc(n.author_role === 'teacher' ? (n.author_name ? n.author_name + ' (class teacher)' : 'Class teacher') : 'School office') + ' · ' + esc(stamp(n.created_at)) + '</p></article>';
  }
  function viewHome() {
    var k = child(), today = todayISO(), ym = thisMonth();
    if (!k) return noChild();
    var m = attFor(k.id, ym), st = m ? m[today] : null, sun = weekday(today) === 0;
    var tcls = st ? ST[st].cls : sun ? 'hol' : '', icon = st ? ST[st].emoji : sun ? '🎈' : '🕘';
    var ttxt = st ? (st === 'P' ? 'Present today' : st === 'A' ? 'Absent today' : st === 'L' ? 'On leave today' : 'Half-day today') : sun ? 'Sunday — holiday' : (m ? 'Not marked yet' : 'Not loaded yet');
    var first = (S.name || '').split(' ')[0];
    var html = '<p class="greet"><span class="telugu">నమస్తే</span> ' + (first ? esc(first) + ' garu' : '') + ' 🙏</p>' +
      '<section class="card"><h2>Today · ' + esc(niceDate(today)) + '</h2><div class="today ' + tcls + '"><div class="big" aria-hidden="true">' + icon + '</div><div><b>' + esc(ttxt) + '</b><small>' + esc(k.name) + (st || sun ? '' : ' · the teacher usually marks attendance in the morning') + '</small></div></div></section>' +
      '<section class="card"><div class="row between"><h2>This month</h2><button class="btn small ghost" data-act="tab" data-tab="calendar">📅 Calendar</button></div>' + (m ? summaryHTML(m, ym) : '<div class="spinner"></div>') + '</section>';
    var list = S.notices.slice(0, 3), t = seenAt();
    html += '<section class="card"><div class="row between"><h2>📢 Latest notices</h2>' + (S.notices.length ? '<button class="btn small ghost" data-act="tab" data-tab="notices">See all</button>' : '') + '</div>' +
      (list.length ? list.map(function (n) { return noticeHTML(n, !t || n.created_at > t); }).join('') : '<p class="muted">No notices right now.</p>') + '</section>';
    if (!isStandalone()) html += '<section class="card">' + installHint().replace('class="install-hint"', 'class="install-hint" style="margin:0"') + '</section>';
    return html;
  }
  function viewCalendar() {
    var k = child();
    if (!k) return noChild();
    var ym = S.month, m = attFor(k.id, ym), today = todayISO(), n = daysIn(ym), lead = weekday(ym + '-01');
    if (!m && online) { setTimeout(function () { rpcAttendance(k.id, ym).then(function () { saveCache(); render(); }).catch(function (e) { if (isNetErr(e)) { online = false; render(); } }); }, 0); }
    var cells = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(function (d) { return '<div class="wd">' + d + '</div>'; }).join('');
    for (var i = 0; i < lead; i++) cells += '<div class="d blank"></div>';
    for (var d = 1; d <= n; d++) {
      var iso = ym + '-' + String(d).padStart(2, '0'), s = m && m[iso], sun = weekday(iso) === 0;
      var cls = s ? ST[s].cls : iso > today ? 'fut' : sun ? 'hol' : '';
      var lbl = s ? ST[s].label : iso > today ? 'Upcoming' : sun ? 'Holiday' : 'Not marked';
      cells += '<div class="d ' + cls + (iso === today ? ' today' : '') + '" title="' + esc(niceDate(iso) + ': ' + lbl) + '" aria-label="' + esc(d + ' ' + lbl) + '">' + d + (s ? '<i>' + ST[s].short + '</i>' : '') + '</div>';
    }
    var min = addMonths(thisMonth(), -23);
    return '<section class="card"><div class="cal-nav"><button data-act="month" data-d="-1" aria-label="Previous month"' + (ym <= min ? ' disabled' : '') + '>‹</button><h2>' + esc(monthName(ym)) + '</h2><button data-act="month" data-d="1" aria-label="Next month"' + (ym >= thisMonth() ? ' disabled' : '') + '>›</button></div>' +
      (m ? '<div class="cal">' + cells + '</div>' : (online ? '<div class="spinner"></div>' : '<p class="note warn">This month is not saved on the phone. Connect to the internet to see it.</p>')) +
      '<div class="legend"><span><i class="p"></i>Present</span><span><i class="a"></i>Absent</span><span><i class="l"></i>Leave</span><span><i class="h"></i>Half-day</span><span><i class="hol"></i>Sunday / holiday</span><span><i></i>Not marked</span></div></section>' +
      (m ? '<section class="card"><h2>Summary · ' + esc(monthName(ym)) + '</h2>' + summaryHTML(m, ym) + '</section>' : '');
  }
  function viewNotices() {
    var t = seenAt();
    var html = '<section class="card"><div class="row between"><h2>📢 Notices</h2><button class="btn small ghost" data-act="refresh">🔄 Refresh</button></div>' +
      (S.notices.length ? S.notices.map(function (n) { return noticeHTML(n, !t || n.created_at > t); }).join('') : '<div class="empty"><div class="e">📭</div><p>No notices right now. School and class notices will appear here.</p></div>') + '</section>';
    if (S.notices.length && S.notices.some(function (n) { return !t || n.created_at > t; })) {
      var newest = S.notices.reduce(function (a, n) { return n.created_at > a ? n.created_at : a; }, '');
      setTimeout(function () { if (S && tab === 'notices') { lsSet(SEEN + S.uid, newest); updateNavDot(); } }, 1500);
    }
    return html;
  }
  function inr(n) { return window.LWReceipt ? window.LWReceipt.inr(n) : '₹' + (Number(n) || 0); }
  function feeMonthName(ym) { return /^\d{4}-\d{2}$/.test(ym || '') ? monthName(ym) : ''; }
  function viewFees() {
    var k = child();
    if (!k) return noChild();
    var f = S.fees[k.id];
    if (!f) {
      if (online) { setTimeout(function () { if (S && !S.fees[k.id]) rpcFees(k.id).then(function () { saveCache(); render(); }).catch(function (e) { if (isNetErr(e)) { online = false; render(); } }); }, 0); return '<section class="card"><h2>💰 Fees</h2><div class="spinner"></div></section>'; }
      return '<section class="card"><h2>💰 Fees</h2><p class="note warn">Fee details are not saved on this phone yet. Connect to the internet to see them.</p></section>';
    }
    if (!f.enabled) {
      return '<section class="card"><div class="empty"><div class="e">💰</div><p><b>Fee details are not shown yet.</b><br>The school will turn this on soon. For any fee question, please call the school office: <a href="' + OFFICE_TEL + '">' + OFFICE + '</a>.</p></div></section>';
    }
    var m = f.sum, pays = f.pays || [], ym = thisMonth();
    var due = Number(m.total_due) || 0, nowDue = Number(m.this_month_due) || 0, fee = Number(m.monthly_fee) || 0;
    var html = '<section class="card"><h2>💰 Fee summary</h2>';
    if (fee > 0) {
      html += '<div class="fee-due ' + (due > 0 ? 'due' : 'ok') + '"><small>' + (due > 0 ? 'Pending fees' : 'Fees') + '</small><b>' + (due > 0 ? esc(inr(due)) : 'All paid ✓') + '</b>' +
        (due > 0 ? '<span>Please pay at the school office. Ignore if already paid today.</span>' : '<span>No pending fees as of ' + esc(feeMonthName(m.as_of_month) || monthName(ym)) + '. Thank you! 🙏</span>') + '</div>' +
        '<div class="kv-grid"><div><small>Monthly fee</small><b>' + esc(inr(fee)) + '</b></div>' +
        '<div><small>' + esc(feeMonthName(m.as_of_month) || monthName(ym)) + '</small><b class="' + (nowDue > 0 ? 'coral-t' : 'green-t') + '">' + (nowDue > 0 ? esc(inr(nowDue)) + ' due' : 'Paid ✓') + '</b></div>' +
        '<div><small>Months paid</small><b>' + (Number(m.months_paid) || 0) + ' of ' + (Number(m.months_billed) || 0) + '</b></div>' +
        '<div><small>Total paid</small><b>' + esc(inr(m.total_paid)) + '</b></div></div>' +
        (m.fees_from ? '<p class="muted small">Counted from ' + esc(feeMonthName(m.fees_from)) + ' to ' + esc(feeMonthName(m.as_of_month)) + '.</p>' : '');
    } else {
      html += '<p class="muted">The monthly fee is not set yet. Please contact the school office.</p>';
    }
    html += '</section><section class="card"><h2>🧾 Payments &amp; receipts</h2>';
    if (!pays.length) html += '<div class="empty"><div class="e">🧾</div><p>No payments recorded yet.</p></div>';
    else html += '<ul class="pay-list">' + pays.map(function (p) {
      return '<li><div class="pay-main"><b>' + esc(inr(p.amount)) + '</b><span>' + esc(window.LWReceipt ? window.LWReceipt.period(p.months) : '') + '</span><small>' + esc(p.receipt_no) + ' · ' + esc(window.LWReceipt ? window.LWReceipt.fmtDate(p.paid_on) : p.paid_on) + ' · ' + esc(p.mode) + '</small></div>' +
        '<button class="btn small sky" data-act="receipt" data-id="' + esc(p.id) + '">🧾 View / Print receipt</button></li>';
    }).join('') + '</ul>';
    html += '<p class="muted small">Saved ' + esc(stamp(f.at)) + '. Questions about fees? Call <a href="' + OFFICE_TEL + '">' + OFFICE + '</a>.</p></section>';
    return html;
  }
  function receiptFor(pid) {
    var k = child(), f = k && S.fees[k.id];
    if (!f || !f.enabled) return null;
    var p = (f.pays || []).filter(function (x) { return x.id === pid; })[0];
    if (!p) return null;
    var m = f.sum, snap = p.balance_after != null && isFinite(Number(p.balance_after));
    return {
      school: { name: m.school_name, address: m.school_address, phone: m.school_phone, email: m.school_email }, logo: '../assets/logo.jpeg',
      receiptNo: p.receipt_no, date: p.paid_on, studentName: p.student_name || k.name, className: className(p.class_id || k.classId), parentName: p.parent_name || m.parent_name || '',
      months: p.months || [], monthlyFee: p.monthly_fee != null ? p.monthly_fee : m.monthly_fee, amount: p.amount, mode: p.mode, ref: p.ref,
      balance: snap ? Number(p.balance_after) : (Number(m.monthly_fee) > 0 ? Number(m.total_due) || 0 : null),
      balanceLabel: snap ? 'Balance due after this payment' : 'Balance due (as on ' + window.LWReceipt.fmtDate(todayISO()) + ')',
      receivedBy: p.received_by || ''
    };
  }
  function openReceipt(pid) {
    var r = receiptFor(pid);
    if (!r || !window.LWReceipt) return;
    $('#sheet-root').innerHTML = '<div class="sheet-bg" data-act="sheet-bg"><div class="sheet wide" id="rcpt-sheet" role="dialog" aria-modal="true" aria-label="Receipt"><div class="sheet-head"><h2>🧾 Receipt ' + esc(r.receiptNo) + '</h2><button class="icon-btn" data-act="sheet-close" aria-label="Close">✕</button></div>' +
      '<div class="rcpt-preview">' + window.LWReceipt.html(r) + '</div>' +
      '<div class="rcpt-actions"><button class="btn primary" data-act="rcpt-print" data-id="' + esc(pid) + '">🖨️ Print / Save as PDF</button>' +
      '<button class="btn sky" data-act="rcpt-img" data-id="' + esc(pid) + '">🖼️ Save image</button>' +
      '<a class="btn ghost" href="https://wa.me/?text=' + encodeURIComponent(window.LWReceipt.text(r)) + '" target="_blank" rel="noopener">💬 Share on WhatsApp</a></div>' +
      '<p class="muted small">To save a PDF: tap Print, then choose <b>Save as PDF</b> (iPhone: tap Share → Save to Files).</p></div></div>';
    document.body.classList.add('sheet-open');
  }
  function noChild() {
    return '<section class="card"><div class="empty"><div class="e">🧒</div><p><b>No child is linked to this login yet.</b><br>Please contact the school office: <a href="' + OFFICE_TEL + '">' + OFFICE + '</a>.</p></div></section>' +
      '<section class="card"><h2>📢 Notices</h2>' + (S.notices.length ? S.notices.map(function (n) { return noticeHTML(n, false); }).join('') : '<p class="muted">No notices right now.</p>') + '</section>';
  }
  function nav() {
    var nc = S ? newCount() : 0;
    return '<nav class="bottomnav" aria-label="Main">' + [['home', '🏠', 'Home'], ['calendar', '📅', 'Attendance'], ['fees', '💰', 'Fees'], ['notices', '📢', 'Notices']].map(function (x) {
      return '<button data-act="tab" data-tab="' + x[0] + '" class="' + (tab === x[0] ? 'active' : '') + '"' + (tab === x[0] ? ' aria-current="page"' : '') + '><span class="ni">' + x[1] + '</span>' + x[2] + (x[0] === 'notices' && nc && tab !== 'notices' ? '<span class="dot">' + (nc > 9 ? '9+' : nc) + '</span>' : '') + '</button>';
    }).join('') + '</nav>';
  }
  function updateNavDot() { var n = $('.bottomnav'); if (n) n.outerHTML = nav(); }
  function render() {
    if (!S) return;
    var y = window.scrollY;
    var body = tab === 'calendar' ? viewCalendar() : tab === 'notices' ? viewNotices() : tab === 'fees' ? viewFees() : viewHome();
    $('#app').innerHTML = header() + '<main class="view" id="view">' + body + '<p class="muted small center">Little Wings Parents v' + VERSION + ' · India time</p></main>' + nav();
    document.title = (child() ? child().name + ' · ' : '') + 'Little Wings Parents';
    window.scrollTo(0, y);
    if ($('#sheet-root').innerHTML && $('#acct-sheet')) { /* keep sheet */ }
  }

  /* ---------- account sheet ---------- */
  function openSheet() {
    var kids = S.children.map(function (k) { return esc(k.name) + ' (' + esc(className(k.classId)) + ')'; }).join(', ');
    $('#sheet-root').innerHTML = '<div class="sheet-bg" data-act="sheet-bg"><div class="sheet" id="acct-sheet" role="dialog" aria-modal="true" aria-label="My account"><div class="sheet-head"><h2>👤 My account</h2><button class="icon-btn" data-act="sheet-close" aria-label="Close">✕</button></div>' +
      '<p><b>' + esc(S.name || 'Parent') + '</b><br><span class="muted">📱 ' + esc(fmtMobile(S.phone)) + (kids ? '<br>🧒 ' + kids : '') + '</span></p>' +
      '<details><summary class="link">🔐 Change my password</summary><form id="pw-form" novalidate style="margin-top:.7rem">' +
      '<label class="field"><span class="lbl">New password (at least 8 characters)</span><span class="pw-wrap"><input name="password" type="password" autocomplete="new-password" maxlength="72"><button type="button" class="pw-toggle" data-act="pw" aria-label="Show password">👁️</button></span></label>' +
      '<label class="field"><span class="lbl">Confirm new password</span><span class="pw-wrap"><input name="password2" type="password" autocomplete="new-password" maxlength="72"><button type="button" class="pw-toggle" data-act="pw" aria-label="Show password">👁️</button></span></label>' +
      '<button class="btn sky">Save new password</button></form></details>' +
      '<p class="note small">Need help or forgot your password? Call the school office: <a href="' + OFFICE_TEL + '">' + OFFICE + '</a>.</p>' +
      installHint() +
      '<p style="margin-top:1rem"><button class="btn primary block" data-act="signout">🚪 Sign out</button></p><p class="muted small center">Signing out removes your child’s details from this phone.</p></div></div>';
    document.body.classList.add('sheet-open');
    var f = $('#pw-form');
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      $$('.err', f).forEach(function (x) { x.remove(); }); $$('.invalid', f).forEach(function (x) { x.classList.remove('invalid'); });
      var a = f.password.value, b = f.password2.value;
      if (a.length < 8) return fieldErr(f, 'password', 'Use at least 8 characters');
      if (a !== b) return fieldErr(f, 'password2', 'Passwords do not match');
      var btn = $('button.sky', f); btn.disabled = true;
      SB.auth.updateUser({ password: a }).then(function (r) {
        btn.disabled = false;
        if (r.error) return fieldErr(f, 'password', /different/i.test(r.error.message) ? 'Choose a password different from the old one' : isNetErr(r.error) ? 'No internet. Please try again.' : r.error.message);
        f.reset(); toast('Password changed 🔐'); closeSheet();
      }).catch(function (err) { btn.disabled = false; fieldErr(f, 'password', isNetErr(err) ? 'No internet. Please try again.' : err.message); });
    });
  }
  function closeSheet() { var r = $('#sheet-root'); if (r) r.innerHTML = ''; document.body.classList.remove('sheet-open'); }

  /* ---------- events ---------- */
  var ACTS = {
    pw: function (el) { var i = el.parentNode.querySelector('input'); var show = i.type === 'password'; i.type = show ? 'text' : 'password'; el.textContent = show ? '🙈' : '👁️'; el.setAttribute('aria-label', show ? 'Hide password' : 'Show password'); },
    tab: function (el) { tab = el.getAttribute('data-tab'); if (tab === 'calendar' && !S.month) S.month = thisMonth(); render(); window.scrollTo(0, 0); },
    kid: function (el) { S.cur = el.getAttribute('data-id'); saveCache(); render(); var k = child(); if (k && online) Promise.all([rpcAttendance(k.id, thisMonth()), rpcFees(k.id), S.month !== thisMonth() ? rpcAttendance(k.id, S.month) : null]).then(function () { saveCache(); render(); }).catch(function (e) { if (isNetErr(e)) { online = false; render(); } }); },
    month: function (el) {
      var n = addMonths(S.month, +el.getAttribute('data-d'));
      if (n > thisMonth() || n < addMonths(thisMonth(), -23)) return;
      S.month = n; render();
    },
    refresh: function () { if (navigator.onLine === false) { online = false; render(); toast('You are offline', 'err'); return; } refresh(true).then(function () { if (online && !S.error) toast('Updated ✓'); }); render(); },
    account: openSheet,
    receipt: function (el) { openReceipt(el.getAttribute('data-id')); },
    'rcpt-print': function (el) { var r = receiptFor(el.getAttribute('data-id')); if (r) window.LWReceipt.print([r], 'Receipt ' + r.receiptNo + ' - ' + r.studentName); },
    'rcpt-img': function (el) { var r = receiptFor(el.getAttribute('data-id')); if (r) window.LWReceipt.saveImage(r, 'Receipt ' + r.receiptNo + ' - ' + r.studentName).then(function (x) { if (x === 'downloaded') toast('Receipt image saved'); }).catch(function () { toast('Could not make the image', 'err'); }); },
    'sheet-close': closeSheet,
    'sheet-bg': function (el, e) { if (e.target === el) closeSheet(); },
    signout: function () { signOut(); },
    install: function () { if (!deferredInstall) return; var ev = deferredInstall; deferredInstall = null; ev.prompt(); ev.userChoice.finally(function () { var w = $('#install-btn-wrap'); if (w) w.hidden = true; }); }
  };
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-act]');
    if (!el) return;
    var fn = ACTS[el.getAttribute('data-act')];
    if (!fn) return;
    if (el.tagName === 'BUTTON' && el.type !== 'submit') e.preventDefault();
    try { fn(el, e); } catch (err) { console.error(err); }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSheet(); });
  window.addEventListener('online', function () { online = true; if (S) refresh(true); });
  window.addEventListener('offline', function () { online = false; if (S) render(); });
  document.addEventListener('visibilitychange', function () { if (S && document.visibilityState === 'visible' && Date.now() - lastRefresh > 15000) refresh(true); });

  // pull to refresh (when scrolled to the top)
  (function () {
    var y0 = null, dy = 0, ptr = $('#ptr');
    document.addEventListener('touchstart', function (e) { if (!S || window.scrollY > 0 || $('#sheet-root').innerHTML) { y0 = null; return; } y0 = e.touches[0].clientY; dy = 0; }, { passive: true });
    document.addEventListener('touchmove', function (e) {
      if (y0 == null) return;
      dy = e.touches[0].clientY - y0;
      if (dy > 0) ptr.style.transform = 'translateY(' + Math.min(dy * 0.5, 70) + 'px)';
    }, { passive: true });
    document.addEventListener('touchend', function () {
      if (y0 == null) return;
      if (dy > 90) {
        ptr.classList.add('spin'); ptr.style.transform = 'translateY(60px)';
        refresh(true).then(function () { ptr.classList.remove('spin'); ptr.style.transform = ''; });
        render();
      } else ptr.style.transform = '';
      y0 = null; dy = 0;
    });
  })();

  /* ---------- PWA ---------- */
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferredInstall = e; var w = $('#install-btn-wrap'); if (w) w.hidden = false; });
  window.addEventListener('appinstalled', function () { deferredInstall = null; toast('App installed. Open it from your Home Screen.'); });
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    var reload = false;
    navigator.serviceWorker.register('./sw.js', { scope: './' }).then(function (reg) {
      function waiting(w) {
        if (!w) return;
        if (!navigator.serviceWorker.controller) { w.postMessage({ type: 'SKIP_WAITING' }); return; }
        var bar = $('#sw-update'); bar.hidden = false;
        bar.onclick = function () { reload = true; bar.disabled = true; w.postMessage({ type: 'SKIP_WAITING' }); };
      }
      if (reg.waiting) waiting(reg.waiting);
      reg.addEventListener('updatefound', function () { var w = reg.installing; if (w) w.addEventListener('statechange', function () { if (w.state === 'installed' && reg.waiting) waiting(reg.waiting); }); });
    }).catch(function () { /* app still works without it */ });
    navigator.serviceWorker.addEventListener('controllerchange', function () { if (reload) location.reload(); });
  }

  /* ---------- boot ---------- */
  window.__lwp = { version: VERSION, state: function () { return S; } };
  function boot() {
    if (!SB) { $('#app').innerHTML = '<div class="auth-wrap"><div class="auth-card center"><h1>Little Wings Parents</h1><p class="note warn">The app could not start. Check your internet connection and reload.</p><button class="btn primary" onclick="location.reload()">Reload</button></div></div>'; return; }
    SB.auth.getSession().then(function (r) {
      var sess = r && r.data && r.data.session;
      if (!sess) { clearAllLocalExceptLast(); return showLogin(); }
      start(sess.user);
    }).catch(function () { showLogin('You appear to be offline. Please connect to the internet and try again.', true); });
    SB.auth.onAuthStateChange(function (ev) { if (ev === 'SIGNED_OUT' && S) { stopLive(); clearAllLocal(); showLogin('Your session ended. Please sign in again.'); } });
  }
  function clearAllLocalExceptLast() { var last = lsGet('lwp_last'); clearAllLocal(); if (last) lsSet('lwp_last', last); }
  registerSW();
  boot();
})();
