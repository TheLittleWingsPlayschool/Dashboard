/**
 * Little Wings — Google Sheet mirror of the Dashboard  (v1.0)
 * --------------------------------------------------------------
 * Paste this whole file into: the "Dashboard" Google Sheet → Extensions → Apps Script.
 * It copies (one way) the dashboard data into the tabs of this sheet:
 *   Students · Enquiries · Payments · Pending fees · Attendance · Expenses · Salaries · Staff · Holidays · README · Sync log
 * Edits made in this sheet DO NOT go back to the dashboard and are overwritten at the next sync.
 *
 * Runs inside Google (no AI, no computer needed):
 *   - every 5 minutes (time trigger made by installTrigger), and
 *   - within seconds after a save in the dashboard, once the web app (doPost) is deployed and
 *     the Supabase webhook is switched on (see the setup guide).
 *
 * KEEP THIS FILE PRIVATE: SHEET_TOKEN reads all school data and WEBHOOK_SECRET starts syncs.
 * Never share the script, a copy of it, or a screenshot of the CONFIG lines.
 */

// ============================ CONFIG ============================
var SUPABASE_URL   = '__SUPABASE_URL__';
var SUPABASE_KEY   = '__SUPABASE_KEY__';          // publishable key (public, same as the website)
var SHEET_TOKEN    = '__SHEET_TOKEN__';           // secret: read token for public.sheet_export
var WEBHOOK_SECRET = '__WEBHOOK_SECRET__';        // secret: only Supabase knows it (starts a sync)
var TIMEZONE       = 'Asia/Kolkata';
var EVERY_MINUTES  = 5;                           // safety-net schedule (1, 5, 10, 15 or 30)
// ================================================================

var TABS = [
  { name: 'Students', key: 'students', cols: [
    ['Name', 'name'], ['Class', 'class'], ['Section', 'section'], ['Status', 'status'], ['Admission date', 'admission_date', 'date'],
    ['Date of birth', 'dob', 'date'], ['Father', 'father_name'], ['Father mobile', 'father_phone', 'phone'], ['Mother', 'mother_name'],
    ['Mother mobile', 'mother_phone', 'phone'], ['Guardian', 'guardian_name'], ['Guardian mobile', 'guardian_phone', 'phone'],
    ['Phone', 'phone', 'phone'], ['WhatsApp', 'whatsapp', 'phone'], ['Emergency', 'emergency', 'phone'], ['Pickup', 'pickup'],
    ['Address', 'address'], ['Monthly fee', 'monthly_fee', 'money'], ['Yearly fee', 'yearly_fee', 'money'], ['Van fee', 'van_fee', 'money'] ] },
  { name: 'Enquiries', key: 'enquiries', cols: [
    ['Date', 'date', 'date'], ['Child', 'child_name'], ['Date of birth', 'dob', 'date'], ['Class', 'class'], ['Father', 'father_name'],
    ['Father mobile', 'father_phone', 'phone'], ['Mother', 'mother_name'], ['Mother mobile', 'mother_phone', 'phone'], ['Parent', 'parent_name'],
    ['Phone', 'phone', 'phone'], ['Source', 'source'], ['Feedback', 'feedback'], ['Status', 'status'], ['Follow-up', 'follow_up', 'date'], ['Notes', 'notes'] ] },
  { name: 'Payments', key: 'payments', cols: [
    ['Paid on', 'paid_on', 'date'], ['Receipt no', 'receipt_no'], ['Student', 'student'], ['Class', 'class'], ['Parent', 'parent'],
    ['Months', 'months'], ['Amount', 'amount', 'money'], ['Mode', 'mode'], ['Reference', 'ref'], ['Discount', 'discount', 'money'],
    ['Late fee', 'late_fee', 'money'], ['Van fee', 'van_fee', 'money'], ['Balance after', 'balance_after', 'money'], ['Received by', 'received_by'], ['Note', 'note'] ] },
  { name: 'Pending fees', key: 'pending', cols: [
    ['Student', 'student'], ['Class', 'class'], ['Section', 'section'], ['Parent', 'parent'], ['Mobile', 'phone', 'phone'], ['Month', 'month', 'month'],
    ['Monthly fee', 'monthly_fee', 'money'], ['Van fee', 'van_fee', 'money'], ['Sibling discount', 'discount', 'money'], ['Late fees', 'late_fee', 'money'],
    ['Due this month', 'this_month_due', 'money'], ['Total due', 'total_due', 'money'], ['Months billed', 'months_billed', 'int'],
    ['Months paid', 'months_paid', 'int'], ['Total paid', 'total_paid', 'money'], ['Fees from', 'fees_from', 'month'] ] },
  { name: 'Attendance', key: 'attendance', cols: [
    ['Date', 'date', 'date'], ['Class', 'class'], ['Student', 'student'], ['Status', 'status'] ] },
  { name: 'Expenses', key: 'expenses', cols: [
    ['Date', 'date', 'date'], ['Title', 'title'], ['Category', 'category'], ['Amount', 'amount', 'money'], ['Mode', 'mode'], ['Note', 'note'] ] },
  { name: 'Salaries', key: 'salaries', cols: [
    ['Month', 'month', 'month'], ['Staff', 'staff'], ['Role', 'role'], ['Monthly salary', 'base', 'money'], ['Bonus', 'bonus', 'money'],
    ['Advance', 'advance', 'money'], ['Deduction', 'deduction', 'money'], ['Paid', 'amount', 'money'], ['Paid on', 'paid_on', 'date'],
    ['Mode', 'mode'], ['Slip no', 'slip_no'], ['Note', 'note'] ] },
  { name: 'Staff', key: 'staff', cols: [
    ['Name', 'name'], ['Role', 'role'], ['Class', 'class'], ['Mobile', 'phone', 'phone'], ['Salary', 'salary', 'money'], ['Joined', 'joined', 'date'], ['Status', 'status'] ] },
  { name: 'Holidays', key: 'holidays', cols: [
    ['From', 'from', 'date'], ['To', 'to', 'date'], ['Title', 'title'], ['Type', 'type'], ['Note', 'note'] ] }
];
var FORMATS = { date: 'dd mmm yyyy', month: 'mmm yyyy', money: '[$₹]#,##0', int: '0', phone: '@', text: '@' };
var README = 'README', LOG = 'Sync log';

// ---------------------------------------------------------------- pure helpers (unit-tested)
function cellValue_(v, type) {
  if (v === null || v === undefined || v === '') return '';
  type = type || 'text';
  if (type === 'date') {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : String(v);
  }
  if (type === 'month') {
    var k = /^(\d{4})-(\d{2})$/.exec(String(v));
    return k ? new Date(+k[1], +k[2] - 1, 1) : String(v);
  }
  if (type === 'money' || type === 'int') { var n = Number(v); return isFinite(n) ? n : String(v); }
  return String(v);                              // phones & text always as text
}
function buildRows_(tab, items) {
  var rows = [tab.cols.map(function (c) { return c[0]; })];
  (items || []).forEach(function (it) { rows.push(tab.cols.map(function (c) { return cellValue_(it ? it[c[1]] : '', c[2]); })); });
  return rows;
}
function buildAll_(data) {
  var out = {};
  TABS.forEach(function (t) { out[t.name] = buildRows_(t, Array.isArray(data[t.key]) ? data[t.key] : []); });
  return out;
}
function ctEqual_(a, b) {
  a = String(a || ''); b = String(b || '');
  var d = a.length ^ b.length, n = Math.max(a.length, b.length);
  for (var i = 0; i < n; i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0 && a.length > 0;
}
function scrub_(s) {
  s = String(s && s.message ? s.message : s);
  [SHEET_TOKEN, WEBHOOK_SECRET].forEach(function (x) { if (x && x.length > 8) s = s.split(x).join('***'); });
  return s.replace(/p_token[^,}]*/gi, 'p_token:***').slice(0, 500);
}
function dataSig_(data) {
  var copy = {}; TABS.forEach(function (t) { copy[t.key] = data[t.key] || []; });
  copy.month = data.as_of_month || '';
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(copy), Utilities.Charset.UTF_8));
}
function nowIST_() { return Utilities.formatDate(new Date(), TIMEZONE, 'dd MMM yyyy, hh:mm:ss a') + ' IST'; }

// ---------------------------------------------------------------- Supabase call (retries)
function fetchExport_() {
  var url = SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/rpc/sheet_export';
  var opts = { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY }, payload: JSON.stringify({ p_token: SHEET_TOKEN }) };
  var wait = [0, 2000, 6000, 15000], last = '';
  for (var i = 0; i < wait.length; i++) {
    if (wait[i]) Utilities.sleep(wait[i]);
    try {
      var r = UrlFetchApp.fetch(url, opts), code = r.getResponseCode();
      if (code === 200) {
        var d = JSON.parse(r.getContentText());
        if (d && d.ok === true) return d;
        throw new Error('Export refused (' + ((d && d.error) || 'unknown') + ') — check SHEET_TOKEN or wait 10 minutes if busy');
      }
      last = 'HTTP ' + code;
      if (code !== 429 && code < 500) throw new Error('Export failed: ' + last);
    } catch (e) {
      last = scrub_(e);
      if (/refused|Export failed/.test(last)) throw new Error(last);
    }
  }
  throw new Error('Supabase not reachable after retries: ' + last);
}

// ---------------------------------------------------------------- sheet writing
function sheet_(ss, name) { return ss.getSheetByName(name) || ss.insertSheet(name); }
function writeTab_(ss, tab, rows) {
  var sh = sheet_(ss, tab.name), nr = rows.length, nc = tab.cols.length;
  var f = sh.getFilter(); if (f) f.remove();
  sh.getBandings().forEach(function (b) { b.remove(); });
  sh.clear();
  if (sh.getMaxRows() < nr + 1) sh.insertRowsAfter(sh.getMaxRows(), nr + 1 - sh.getMaxRows());
  if (sh.getMaxColumns() < nc) sh.insertColumnsAfter(sh.getMaxColumns(), nc - sh.getMaxColumns());
  if (sh.getMaxRows() > nr + 200) sh.deleteRows(nr + 101, sh.getMaxRows() - nr - 100);
  if (nr > 1) tab.cols.forEach(function (c, j) { sh.getRange(2, j + 1, nr - 1, 1).setNumberFormat(FORMATS[c[2] || 'text']); });
  sh.getRange(1, 1, nr, nc).setValues(rows);                       // one bulk write
  sh.getRange(1, 1, 1, nc).setFontWeight('bold').setBackground('#1f6f99').setFontColor('#ffffff').setWrap(true);
  sh.setFrozenRows(1);
  var body = sh.getRange(1, 1, Math.max(nr, 2), nc);
  body.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, true, false);
  if (nr > 1) sh.getRange(1, 1, nr, nc).createFilter();
  else sh.getRange(2, 1).setValue('(no rows yet)').setFontColor('#888888');
  try { sh.autoResizeColumns(1, nc); } catch (e) { /* ignore */ }
  tab.cols.forEach(function (c, j) { if (sh.getColumnWidth(j + 1) > 320) sh.setColumnWidth(j + 1, 320); if (sh.getColumnWidth(j + 1) < 80) sh.setColumnWidth(j + 1, 80); });
  return nr - 1;
}
function writeReadme_(ss, status, counts, data) {
  var sh = sheet_(ss, README);
  var rows = [
    ['Little Wings Dashboard — Google Sheet copy', ''],
    ['Read-only copy', 'Edits here do NOT go back to the dashboard and are overwritten at the next sync. Change data in the dashboard.'],
    ['Last synced (IST)', status.ok ? nowIST_() : (PropertiesService.getScriptProperties().getProperty('lastOkIST') || 'never')],
    ['Status', status.text],
    ['Source', 'Little Wings Dashboard (Supabase) via public.sheet_export — one-way, read-only'],
    ['Updates', 'Every ' + EVERY_MINUTES + ' minutes, and a few seconds after each save when the webhook is on'],
    ['Data as of', data && data.generated_at ? data.generated_at + ' IST' : '—'],
    ['', ''], ['Tab', 'Rows']
  ];
  TABS.forEach(function (t) { rows.push([t.name, counts && counts[t.name] != null ? counts[t.name] : '—']); });
  sh.clear();
  sh.getRange(1, 1, rows.length, 2).setValues(rows);
  sh.getRange(1, 1).setFontWeight('bold').setFontSize(14);
  sh.getRange(2, 1, 6, 1).setFontWeight('bold');
  sh.getRange(9, 1, 1, 2).setFontWeight('bold').setBackground('#1f6f99').setFontColor('#ffffff');
  sh.getRange(4, 2).setFontColor(status.ok ? '#1b7a3a' : '#b3261e').setFontWeight('bold');
  sh.setColumnWidth(1, 170); sh.setColumnWidth(2, 640); sh.getRange(1, 2, rows.length, 1).setWrap(true);
}
function log_(ss, level, msg) {
  try {
    var sh = sheet_(ss, LOG);
    if (sh.getLastRow() === 0) { sh.getRange(1, 1, 1, 3).setValues([['Time (IST)', 'Level', 'Message']]).setFontWeight('bold'); sh.setFrozenRows(1); }
    sh.appendRow([nowIST_(), level, scrub_(msg)]);
    var extra = sh.getLastRow() - 301; if (extra > 0) sh.deleteRows(2, extra);
  } catch (e) { console.error(scrub_(e)); }
}
function dropDefaultSheet_(ss) {
  var s1 = ss.getSheetByName('Sheet1');
  if (!s1 || ss.getSheets().length < 2) return;
  if (TABS.some(function (t) { return !ss.getSheetByName(t.name); })) return;   // only after the new tabs exist
  if (s1.getLastRow() === 0 && s1.getLastColumn() === 0) ss.deleteSheet(s1); else s1.setName('Sheet1 (old)');
}

// ---------------------------------------------------------------- main entry points
function syncAll() { return runSync_(25000); }
function runSync_(waitMs) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(waitMs)) return 'busy';
  var ss = SpreadsheetApp.getActive(), props = PropertiesService.getScriptProperties(), started = Date.now();
  try {
    var data = fetchExport_(), counts = {};
    var sig = dataSig_(data), allThere = TABS.every(function (t) { return !!ss.getSheetByName(t.name); }) && !!ss.getSheetByName(README);
    if (allThere && sig === props.getProperty('lastSig')) {             // nothing changed: only refresh the README time (cheap run)
      TABS.forEach(function (t) { counts[t.name] = (data[t.key] || []).length; });
      writeReadme_(ss, { ok: true, text: 'OK (no changes) — ' + TABS.map(function (t) { return t.name + ' ' + counts[t.name]; }).join(' · ') }, counts, data);
      props.setProperty('lastOkIST', nowIST_());
      return 'ok';
    }
    var rows = buildAll_(data);
    TABS.forEach(function (t) { counts[t.name] = writeTab_(ss, t, rows[t.name]); });
    props.setProperty('lastSig', sig);
    writeReadme_(ss, { ok: true, text: 'OK — ' + TABS.map(function (t) { return t.name + ' ' + counts[t.name]; }).join(' · ') }, counts, data);
    props.setProperty('lastOkIST', nowIST_());
    dropDefaultSheet_(ss);
    if (!ss.getSheetByName(LOG)) log_(ss, 'INFO', 'First sync done');
    var order = [README].concat(TABS.map(function (t) { return t.name; }), [LOG]);
    order.forEach(function (n, i) { var s = ss.getSheetByName(n); if (s && s.getIndex() !== i + 1) { ss.setActiveSheet(s); ss.moveActiveSheet(i + 1); } });
    SpreadsheetApp.flush();
    return 'ok';
  } catch (e) {
    props.deleteProperty('lastSig');
    log_(ss, 'ERROR', e);
    try { writeReadme_(ss, { ok: false, text: 'Last sync FAILED at ' + nowIST_() + ': ' + scrub_(e) + ' (see Sync log)' }, null, null); } catch (e2) { /* ignore */ }
    return 'error';
  } finally {
    props.setProperty('lastSyncEnd', String(Date.now()));
    var changed = Number(props.getProperty('lastChange') || 0);
    lock.releaseLock();
    if (changed > started) scheduleSoon_();                       // a save arrived during this sync
  }
}
function syncSoon() {
  deleteTriggers_('syncSoon');
  PropertiesService.getScriptProperties().deleteProperty('soonAt');
  runSync_(25000);
}
function scheduleSoon_() {
  var props = PropertiesService.getScriptProperties(), at = Number(props.getProperty('soonAt') || 0);
  var pending = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'syncSoon'; });
  if (pending && at > Date.now() - 5 * 60000) return;                // one queued run is enough (bursts collapse)
  deleteTriggers_('syncSoon');
  ScriptApp.newTrigger('syncSoon').timeBased().after(10000).create();
  props.setProperty('soonAt', String(Date.now()));
}
/** Webhook from Supabase (Deploy → Web app). Always answers "ok"; only a correct secret starts a sync. */
function doPost(e) {
  var body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (x) { body = {}; }
  if (!WEBHOOK_SECRET || WEBHOOK_SECRET.indexOf('__') === 0 || !ctEqual_(body.secret, WEBHOOK_SECRET)) return ContentService.createTextOutput('ok');
  var props = PropertiesService.getScriptProperties();
  props.setProperty('lastChange', String(Date.now()));
  var lastEnd = Number(props.getProperty('lastSyncEnd') || 0);
  if (Date.now() - lastEnd < 5000) { scheduleSoon_(); return ContentService.createTextOutput('ok'); }
  if (runSync_(0) === 'busy') scheduleSoon_();
  return ContentService.createTextOutput('ok');
}
function doGet() { return ContentService.createTextOutput('ok'); }
function deleteTriggers_(handler) {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (!handler || t.getHandlerFunction() === handler) ScriptApp.deleteTrigger(t); });
}
/** Run once: makes the every-5-minutes trigger (removes duplicates first) and syncs now. */
function installTrigger() {
  deleteTriggers_('syncAll');
  ScriptApp.newTrigger('syncAll').timeBased().everyMinutes(EVERY_MINUTES).create();
  var r = syncAll();
  log_(SpreadsheetApp.getActive(), 'INFO', 'Auto-sync installed (every ' + EVERY_MINUTES + ' min); first sync: ' + r);
  return r;
}
/** Stops the timed syncs. (A deployed web app still syncs on dashboard saves — archive the deployment to stop that too.) */
function removeTriggers() {
  deleteTriggers_();
  PropertiesService.getScriptProperties().deleteProperty('soonAt');
  log_(SpreadsheetApp.getActive(), 'INFO', 'All triggers removed — automatic sync stopped');
}
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Little Wings')
    .addItem('Sync now', 'syncNowMenu')
    .addItem('Turn on auto-sync (every ' + EVERY_MINUTES + ' min)', 'installTrigger')
    .addItem('Stop auto-sync', 'removeTriggers')
    .addToUi();
}
function syncNowMenu() {
  var r = syncAll();
  SpreadsheetApp.getActive().toast(r === 'ok' ? 'Synced ✔' : r === 'busy' ? 'A sync is already running — try again in a minute' : 'Sync failed — see the Sync log tab', 'Little Wings', 6);
}
if (typeof module !== 'undefined') module.exports = { TABS: TABS, buildAll_: buildAll_, buildRows_: buildRows_, cellValue_: cellValue_, ctEqual_: ctEqual_, scrub_: scrub_, syncAll: syncAll, doPost: doPost, installTrigger: installTrigger, removeTriggers: removeTriggers, syncSoon: syncSoon, onOpen: onOpen };
