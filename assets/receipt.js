/*!
 * The Little Wings — shared fee receipt (v2.5). Used by the admin dashboard
 * and the Parents app. No dependencies, no network: HTML receipt + print to
 * one clean page (Save as PDF from the print dialog) + a PNG image drawn on a
 * canvas + a WhatsApp text summary. v2.9: the picture / a one-page PDF can be
 * shared as a real file (navigator.share) or saved, made entirely on the phone.
 */
(function () {
  'use strict';
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var inrFmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 2 });
  function inr(n) { return inrFmt.format(Number(n) || 0); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function isMonth(s) { return /^\d{4}-\d{2}$/.test(s || ''); }
  function fmtMonth(ym) { return isMonth(ym) ? MONTHS[+ym.slice(5, 7) - 1] + ' ' + ym.slice(0, 4) : ''; }
  function fmtDate(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? (+m[3]) + ' ' + MONTHS[+m[2] - 1] + ' ' + m[1] : (iso || '—'); }
  function nextMonth(ym) { var y = +ym.slice(0, 4), m = +ym.slice(5, 7) + 1; if (m > 12) { m = 1; y++; } return y + '-' + String(m).padStart(2, '0'); }

  // Indian numbering: crore, lakh, thousand. Integer part only.
  function inWords(amount) {
    var n = Math.floor(Math.abs(Number(amount) || 0));
    if (n === 0) return 'Zero';
    var a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    var b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    function two(x) { return x < 20 ? a[x] : b[Math.floor(x / 10)] + (x % 10 ? ' ' + a[x % 10] : ''); }
    function three(x) { return x >= 100 ? a[Math.floor(x / 100)] + ' Hundred' + (x % 100 ? ' ' + two(x % 100) : '') : two(x); }
    var out = [];
    var crore = Math.floor(n / 1e7); n %= 1e7;
    var lakh = Math.floor(n / 1e5); n %= 1e5;
    var th = Math.floor(n / 1000); n %= 1000;
    if (crore) out.push((crore > 999 ? inWords(crore) : three(crore)) + ' Crore');
    if (lakh) out.push(two(lakh) + ' Lakh');
    if (th) out.push(two(th) + ' Thousand');
    if (n) out.push(three(n));
    return out.join(' ');
  }
  // "Rupees One Thousand Five Hundred Only" / "... and Fifty Paise Only"
  function amountWords(amount) {
    var v = Math.round((Number(amount) || 0) * 100), r = Math.floor(v / 100), p = v % 100;
    return 'Rupees ' + inWords(r) + (p ? ' and ' + inWords(p) + ' Paise' : '') + ' Only';
  }
  // ["2026-11"] -> "Nov 2026"; consecutive -> "Nov 2026 – Jan 2027 (3 months)"
  function period(months) {
    var l = (months || []).filter(isMonth).slice().sort();
    if (!l.length) return '—';
    if (l.length === 1) return fmtMonth(l[0]);
    var consecutive = l.every(function (m, i) { return i === 0 || nextMonth(l[i - 1]) === m; });
    if (consecutive) return fmtMonth(l[0]) + ' – ' + fmtMonth(l[l.length - 1]) + ' (' + l.length + ' months)';
    return l.map(fmtMonth).join(', ');
  }
  function balanceText(r) {
    if (r.balance == null || !isFinite(r.balance)) return '';
    return r.balance > 0 ? inr(r.balance) : 'Nil (no dues)';
  }

  /* ---------- HTML ---------- */
  function html(r) {
    var s = r.school || {};
    var row = function (k, v, cls) { return '<tr' + (cls ? ' class="' + cls + '"' : '') + '><th>' + k + '</th><td>' + v + '</td></tr>'; };
    var bal = balanceText(r);
    return '<article class="lwr' + (r.sample ? ' lwr-sample' : '') + '" aria-label="Fee receipt ' + esc(r.receiptNo) + '">' +
      (r.sample ? '<div class="lwr-wm" aria-hidden="true">SAMPLE</div>' : '') +
      '<div class="lwr-band" aria-hidden="true"></div>' +
      '<header class="lwr-head"><img class="lwr-logo" src="' + esc(r.logo || 'assets/logo.jpeg') + '" alt="" width="72" height="72">' +
      '<div class="lwr-school"><h2>' + esc(s.name || 'The Little Wings Play School') + '</h2>' +
      (s.address ? '<p>' + esc(s.address) + '</p>' : '') +
      '<p>' + (s.phone ? 'Ph / WhatsApp: ' + esc(s.phone) : '') + (s.phone && s.email ? ' &middot; ' : '') + (s.email ? esc(s.email) : '') + '</p></div>' +
      '<div class="lwr-tag"><b>FEE RECEIPT</b>' + (r.copy ? '<span>' + esc(r.copy) + '</span>' : '') + '</div></header>' +
      '<div class="lwr-meta"><div><small>Receipt No.</small><b>' + esc(r.receiptNo || '—') + '</b></div><div><small>Date</small><b>' + esc(fmtDate(r.date)) + '</b></div><div><small>Payment mode</small><b>' + esc(r.mode || '—') + '</b></div></div>' +
      '<table class="lwr-tbl"><tbody>' +
      row('Student name', '<b>' + esc(r.studentName || '—') + '</b>') +
      row('Class', esc(r.className || '—')) +
      row('Parent / Guardian', esc(r.parentName || '—')) +
      row('Fee for', esc(period(r.months))) +
      (Number(r.yearlyFee) > 0 ? row('Yearly fee', esc(inr(r.yearlyFee))) : '') +
      (Number(r.monthlyFee) > 0 ? row('Monthly fee', esc(inr(r.monthlyFee))) : '') +
      (Number(r.discount) > 0 ? row('Sibling discount', esc(inr(r.discount)) + ' / month') : '') +
      (Number(r.vanFee) > 0 ? row('Van fee', esc(inr(r.vanFee)) + ' / month') : '') +
      (Number(r.lateFee) > 0 ? row('Late fee included', esc(inr(r.lateFee))) : '') +
      (r.ref ? row('Reference', esc(r.ref)) : '') +
      '</tbody></table>' +
      '<div class="lwr-amount"><div class="lwr-amt"><small>Amount paid</small><b>' + esc(inr(r.amount)) + '</b></div><div class="lwr-words"><small>Amount in words</small><b>' + esc(amountWords(r.amount)) + '</b></div></div>' +
      (bal ? '<p class="lwr-bal">' + esc(r.balanceLabel || 'Balance due after this payment') + ': <b>' + esc(bal) + '</b></p>' : '') +
      '<div class="lwr-sign"><div class="lwr-recv"><small>Received by</small><b>' + (r.receivedBy ? esc(r.receivedBy) : '&nbsp;') + '</b></div><div class="lwr-sigline">Signature / School seal</div></div>' +
      '<footer class="lwr-foot">This is a computer-generated receipt. Thank you!</footer>' +
      '</article>';
  }

  /* ---------- WhatsApp text ---------- */
  function text(r) {
    var s = r.school || {}, bal = balanceText(r);
    return '🧾 *Fee Receipt ' + (r.receiptNo || '') + '*\n' + (s.name || 'The Little Wings Play School') + '\n\n' +
      'Student: ' + (r.studentName || '') + (r.className ? ' (' + r.className + ')' : '') + '\n' +
      'Fee for: ' + period(r.months) + '\n' +
      'Amount paid: ' + inr(r.amount) + '\n(' + amountWords(r.amount) + ')\n' +
      (Number(r.vanFee) > 0 ? 'Van fee: ' + inr(r.vanFee) + ' / month\n' : '') +
      (Number(r.lateFee) > 0 ? 'Late fee included: ' + inr(r.lateFee) + '\n' : '') +
      (Number(r.discount) > 0 ? 'Sibling discount: ' + inr(r.discount) + ' / month\n' : '') +
      'Mode: ' + (r.mode || '') + (r.ref ? ' · Ref ' + r.ref : '') + '\n' +
      'Date: ' + fmtDate(r.date) + '\n' +
      (bal ? 'Balance due: ' + bal + '\n' : '') +
      (r.receivedBy ? 'Received by: ' + r.receivedBy + '\n' : '') +
      '\nThank you! 🙏' + (s.phone ? '\n' + s.phone : '');
  }

  /* ---------- print (one page; "Save as PDF" in the print dialog) ---------- */
  function print(list, title) {
    var root = document.getElementById('print-root');
    if (!root) return;
    root.innerHTML = list.map(html).join('<div class="lwr-cut" aria-hidden="true">✂ ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·</div>');
    root.className = list.length > 1 ? 'two' : 'one';
    var oldTitle = document.title;
    var restore = function () { document.title = oldTitle; root.innerHTML = ''; window.removeEventListener('afterprint', restore); };
    var go = function () {
      if (title) document.title = title; // becomes the PDF file name
      window.addEventListener('afterprint', restore);
      setTimeout(function () { window.print(); }, 60);
    };
    var imgs = Array.prototype.slice.call(root.querySelectorAll('img')).filter(function (i) { return !i.complete; });
    if (!imgs.length) go();
    else { var left = imgs.length; imgs.forEach(function (i) { var d = function () { if (--left === 0) go(); }; i.onload = d; i.onerror = d; }); }
  }

  /* ---------- PNG image (canvas; same-origin logo only, nothing uploaded) ---------- */
  function loadImg(src) {
    return new Promise(function (res) { if (!src) return res(null); var i = new Image(); i.onload = function () { res(i); }; i.onerror = function () { res(null); }; i.src = src; });
  }
  function wrap(ctx, str, maxW) {
    var words = String(str || '').split(/\s+/), lines = [], cur = '';
    words.forEach(function (w) { var t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; });
    if (cur) lines.push(cur);
    return lines;
  }
  // Telugu / Hindi names and labels use the phone's own Indian-language fonts.
  var FONT = '"Segoe UI", Roboto, "Noto Sans", "Noto Sans Telugu", "Noto Sans Devanagari", "Nirmala UI", Gautami, Mangal, Helvetica, Arial, sans-serif';
  function fontsReady() { try { return document.fonts && document.fonts.ready ? Promise.race([document.fonts.ready, new Promise(function (r) { setTimeout(r, 1500); })]) : Promise.resolve(); } catch (e) { return Promise.resolve(); } }
  function drawLogo(ctx, logo, x, y, size) {
    ctx.save(); ctx.beginPath(); ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2); ctx.clip();
    if (logo) ctx.drawImage(logo, x, y, size, size);
    else { ctx.fillStyle = '#38a8e0'; ctx.fillRect(x, y, size, size); ctx.fillStyle = '#fff'; ctx.font = 'bold ' + Math.round(size * 0.38) + 'px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('LW', x + size / 2, y + size / 2); }
    ctx.restore(); ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  }
  function png(r) { return receiptCanvas(r).then(function (c) { return canvasBlob(c, 'image/png'); }); }
  function receiptCanvas(r) {
    return Promise.all([loadImg(r.logo), fontsReady()]).then(function (got) {
      var logo = got[0];
      var W = 1200, P = 56, s = r.school || {};
      var c = document.createElement('canvas'), ctx = c.getContext('2d');
      var F = FONT;
      // measure pass for height
      c.width = W; c.height = 10;
      ctx.font = '18px ' + F;
      var addr = wrap(ctx, s.address || '', W - P * 2 - 120 - 260);
      ctx.font = 'bold 26px ' + F;
      var words = wrap(ctx, amountWords(r.amount), W - P * 2 - 340);
      var rows = [['Student name', r.studentName || '—', true], ['Class', r.className || '—'], ['Parent / Guardian', r.parentName || '—'], ['Fee for', period(r.months)]];
      if (Number(r.yearlyFee) > 0) rows.push(['Yearly fee', inr(r.yearlyFee)]);
      if (Number(r.monthlyFee) > 0) rows.push(['Monthly fee', inr(r.monthlyFee)]);
      if (Number(r.discount) > 0) rows.push(['Sibling discount', inr(r.discount) + ' / month']);
      if (Number(r.vanFee) > 0) rows.push(['Van fee', inr(r.vanFee) + ' / month']);
      if (Number(r.lateFee) > 0) rows.push(['Late fee included', inr(r.lateFee)]);
      if (r.ref) rows.push(['Reference', r.ref]);
      var bal = balanceText(r);
      var H = 24 + 150 + addr.length * 24 + 110 + rows.length * 48 + 40 + Math.max(110, 50 + words.length * 34) + (bal ? 60 : 0) + 170 + 60;
      c.width = W; c.height = H;
      ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
      var g = ctx.createLinearGradient(0, 0, W, 0);
      g.addColorStop(0, '#38a8e0'); g.addColorStop(0.333, '#38a8e0'); g.addColorStop(0.334, '#ff7a6b'); g.addColorStop(0.666, '#ff7a6b'); g.addColorStop(0.667, '#ffc93c'); g.addColorStop(1, '#ffc93c');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, 14);
      ctx.strokeStyle = '#d5dde6'; ctx.lineWidth = 3; ctx.strokeRect(1.5, 1.5, W - 3, H - 3);
      var y = 50;
      drawLogo(ctx, logo, P, y, 100);
      var x = P + 124;
      ctx.fillStyle = '#1b6e99'; ctx.font = 'bold 34px ' + F; ctx.textBaseline = 'top';
      ctx.fillText(s.name || 'The Little Wings Play School', x, y + 4, W - x - P - 250);
      ctx.fillStyle = '#4a5a6b'; ctx.font = '18px ' + F;
      var yy = y + 50;
      addr.forEach(function (l) { ctx.fillText(l, x, yy); yy += 24; });
      ctx.fillText([s.phone ? 'Ph / WhatsApp: ' + s.phone : '', s.email || ''].filter(Boolean).join('  ·  '), x, yy, W - x - P - 250);
      // tag
      ctx.fillStyle = '#ff7a6b'; roundRect(ctx, W - P - 230, y, 230, 54, 27); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 24px ' + F; ctx.textAlign = 'center'; ctx.fillText('FEE RECEIPT', W - P - 115, y + 14);
      if (r.copy) { ctx.fillStyle = '#5a6b7c'; ctx.font = '17px ' + F; ctx.fillText(r.copy, W - P - 115, y + 64); }
      ctx.textAlign = 'left';
      y = Math.max(y + 130, yy + 40);
      ctx.fillStyle = '#38a8e0'; ctx.fillRect(P, y, W - P * 2, 4); y += 22;
      // meta
      var cols = [['Receipt No.', r.receiptNo || '—'], ['Date', fmtDate(r.date)], ['Payment mode', r.mode || '—']], cw = (W - P * 2) / 3;
      cols.forEach(function (m, i) { ctx.fillStyle = '#6b7b8c'; ctx.font = '16px ' + F; ctx.fillText(m[0].toUpperCase(), P + i * cw, y); ctx.fillStyle = '#1e2b38'; ctx.font = 'bold 26px ' + F; ctx.fillText(m[1], P + i * cw, y + 24, cw - 16); });
      y += 78;
      rows.forEach(function (rw) {
        ctx.fillStyle = '#5a6b7c'; ctx.font = '20px ' + F; ctx.fillText(rw[0], P, y + 12);
        ctx.fillStyle = '#1e2b38'; ctx.font = (rw[2] ? 'bold ' : '') + '22px ' + F; ctx.fillText(rw[1], P + 300, y + 11, W - P * 2 - 300);
        ctx.strokeStyle = '#e3e9ef'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 5]); ctx.beginPath(); ctx.moveTo(P, y + 47); ctx.lineTo(W - P, y + 47); ctx.stroke(); ctx.setLineDash([]);
        y += 48;
      });
      y += 28;
      var bh = Math.max(110, 50 + words.length * 34);
      ctx.fillStyle = '#eaf6ec'; roundRect(ctx, P, y, W - P * 2, bh, 16); ctx.fill();
      ctx.fillStyle = '#1e7a3c'; ctx.font = '16px ' + F; ctx.fillText('AMOUNT PAID', P + 24, y + 20);
      ctx.font = 'bold 44px ' + F; ctx.fillText(inr(r.amount), P + 24, y + 44, 280);
      ctx.fillStyle = '#5a6b7c'; ctx.font = '16px ' + F; ctx.fillText('AMOUNT IN WORDS', P + 330, y + 20);
      ctx.fillStyle = '#1e2b38'; ctx.font = 'bold 26px ' + F;
      words.forEach(function (l, i) { ctx.fillText(l, P + 330, y + 46 + i * 34); });
      y += bh + 20;
      if (bal) { ctx.fillStyle = '#1e2b38'; ctx.font = '22px ' + F; var lbl = (r.balanceLabel || 'Balance due after this payment') + ': '; ctx.fillText(lbl, P, y + 10); var lw = ctx.measureText(lbl).width; ctx.font = 'bold 22px ' + F; ctx.fillStyle = r.balance > 0 ? '#c2453a' : '#1e7a3c'; ctx.fillText(bal, P + lw, y + 10); y += 60; }
      y += 30;
      ctx.fillStyle = '#6b7b8c'; ctx.font = '16px ' + F; ctx.fillText('RECEIVED BY', P, y);
      ctx.fillStyle = '#1e2b38'; ctx.font = 'bold 24px ' + F; ctx.fillText(r.receivedBy || '', P, y + 24, 520);
      ctx.strokeStyle = '#8a98a6'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(W - P - 340, y + 56); ctx.lineTo(W - P, y + 56); ctx.stroke();
      ctx.fillStyle = '#5a6b7c'; ctx.font = '17px ' + F; ctx.textAlign = 'center'; ctx.fillText('Signature / School seal', W - P - 170, y + 64);
      y += 120;
      ctx.fillStyle = '#8b97a3'; ctx.font = '17px ' + F; ctx.fillText('This is a computer-generated receipt. Thank you!', W / 2, y);
      ctx.textAlign = 'left';
      if (r.sample) { ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(-0.42); ctx.fillStyle = 'rgba(255,122,107,0.16)'; ctx.font = 'bold 190px ' + F; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('SAMPLE', 0, 0); ctx.restore(); }
      return c;
    });
  }
  function roundRect(ctx, x, y, w, h, rad) {
    ctx.beginPath(); ctx.moveTo(x + rad, y); ctx.arcTo(x + w, y, x + w, y + h, rad); ctx.arcTo(x + w, y + h, x, y + h, rad); ctx.arcTo(x, y + h, x, y, rad); ctx.arcTo(x, y, x + w, y, rad); ctx.closePath();
  }
  /* ---------- any document (salary slip, report card…) drawn the same way ----------
   * d = { school, logo, tag, copy, title, meta: [[label, value]], rows: [[label, value, bold]],
   *       table: { head: [], rows: [[]], foot: [], widths: [fractions] }, amount: { label, value, words },
   *       note: { label, text }, small, signs: [labels], footer, sample } */
  function docCanvas(d) {
    return Promise.all([loadImg(d.logo), fontsReady()]).then(function (got) {
      var logo = got[0], W = 1200, P = 56, s = d.school || {};
      var c = document.createElement('canvas');
      c.width = W; c.height = 10;
      var draw = function (H) {
        var ctx = c.getContext('2d'); ctx.textBaseline = 'top'; ctx.textAlign = 'left';
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
        var g = ctx.createLinearGradient(0, 0, W, 0);
        g.addColorStop(0, '#38a8e0'); g.addColorStop(0.333, '#38a8e0'); g.addColorStop(0.334, '#ff7a6b'); g.addColorStop(0.666, '#ff7a6b'); g.addColorStop(0.667, '#ffc93c'); g.addColorStop(1, '#ffc93c');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, 14);
        var y = 50, x = P + 124, tagW = d.tag ? 260 : 0;
        drawLogo(ctx, logo, P, y, 100);
        ctx.fillStyle = '#1b6e99'; ctx.font = 'bold 34px ' + FONT; ctx.fillText(s.name || 'The Little Wings Play School', x, y + 4, W - x - P - tagW - 10);
        ctx.fillStyle = '#4a5a6b'; ctx.font = '18px ' + FONT;
        var yy = y + 50;
        wrap(ctx, s.address || '', W - x - P - tagW - 10).forEach(function (l) { ctx.fillText(l, x, yy); yy += 24; });
        var contact = [s.phone ? 'Ph / WhatsApp: ' + s.phone : '', s.email || ''].filter(Boolean).join('  ·  ');
        if (contact) { ctx.fillText(contact, x, yy, W - x - P - tagW - 10); yy += 24; }
        if (d.tag) {
          ctx.font = 'bold 22px ' + FONT;
          ctx.fillStyle = '#ff7a6b'; roundRect(ctx, W - P - tagW, y, tagW, 54, 27); ctx.fill();
          ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(d.tag, W - P - tagW / 2, y + 15, tagW - 20);
          if (d.copy) { ctx.fillStyle = '#5a6b7c'; ctx.font = '17px ' + FONT; ctx.fillText(d.copy, W - P - tagW / 2, y + 64); }
          ctx.textAlign = 'left';
        }
        y = Math.max(y + 130, yy + 30);
        ctx.fillStyle = '#38a8e0'; ctx.fillRect(P, y, W - P * 2, 4); y += 24;
        if (d.title) { ctx.fillStyle = '#1e2b38'; ctx.font = 'bold 30px ' + FONT; wrap(ctx, d.title, W - P * 2).forEach(function (l) { ctx.fillText(l, P, y); y += 40; }); y += 6; }
        if (d.meta && d.meta.length) {
          var per = 3, cw = (W - P * 2) / per;
          for (var i = 0; i < d.meta.length; i += per) {
            d.meta.slice(i, i + per).forEach(function (m, j) { ctx.fillStyle = '#6b7b8c'; ctx.font = '16px ' + FONT; ctx.fillText(String(m[0]).toUpperCase(), P + j * cw, y, cw - 16); ctx.fillStyle = '#1e2b38'; ctx.font = 'bold 25px ' + FONT; ctx.fillText(String(m[1] == null ? '—' : m[1]), P + j * cw, y + 24, cw - 16); });
            y += 70;
          }
          y += 6;
        }
        (d.rows || []).forEach(function (rw) {
          ctx.font = (rw[2] ? 'bold ' : '') + '22px ' + FONT;
          var lines = wrap(ctx, String(rw[1] == null ? '—' : rw[1]), W - P * 2 - 300);
          ctx.fillStyle = '#5a6b7c'; ctx.font = '20px ' + FONT; ctx.fillText(rw[0], P, y + 12, 290);
          ctx.fillStyle = '#1e2b38'; ctx.font = (rw[2] ? 'bold ' : '') + '22px ' + FONT;
          lines.forEach(function (l, k) { ctx.fillText(l, P + 300, y + 11 + k * 30); });
          var h = 48 + (lines.length - 1) * 30;
          ctx.strokeStyle = '#e3e9ef'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 5]); ctx.beginPath(); ctx.moveTo(P, y + h - 1); ctx.lineTo(W - P, y + h - 1); ctx.stroke(); ctx.setLineDash([]);
          y += h;
        });
        if (d.rows && d.rows.length) y += 24;
        if (d.table) {
          var tb = d.table, ws = tb.widths || tb.head.map(function () { return 1 / tb.head.length; });
          var colX = []; var acc = P; ws.forEach(function (w) { colX.push(acc); acc += w * (W - P * 2); });
          var rowH = 50;
          ctx.fillStyle = '#e8f5fc'; ctx.fillRect(P, y, W - P * 2, rowH);
          ctx.fillStyle = '#1b6e99'; ctx.font = 'bold 21px ' + FONT;
          tb.head.forEach(function (h, k) { ctx.fillText(h, colX[k] + 14, y + 14, ws[k] * (W - P * 2) - 20); });
          y += rowH;
          var line = function (cells, bold, bg) {
            if (bg) { ctx.fillStyle = bg; ctx.fillRect(P, y, W - P * 2, rowH); }
            ctx.fillStyle = '#1e2b38'; ctx.font = (bold ? 'bold ' : '') + '21px ' + FONT;
            cells.forEach(function (v, k) { ctx.font = (bold || k === cells.length - 1 ? 'bold ' : '') + '21px ' + FONT; ctx.fillText(String(v == null ? '' : v), colX[k] + 14, y + 14, ws[k] * (W - P * 2) - 20); });
            ctx.strokeStyle = '#d5dde6'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(P, y + rowH); ctx.lineTo(W - P, y + rowH); ctx.stroke();
            y += rowH;
          };
          tb.rows.forEach(function (r0) { line(r0, false); });
          if (tb.foot) line(tb.foot, true, '#fff7dc');
          ctx.strokeStyle = '#c5d2de'; ctx.lineWidth = 2; ctx.strokeRect(P, y - rowH * (tb.rows.length + 1 + (tb.foot ? 1 : 0)), W - P * 2, rowH * (tb.rows.length + 1 + (tb.foot ? 1 : 0)));
          y += 26;
        }
        if (d.amount) {
          ctx.font = 'bold 26px ' + FONT;
          var wl = wrap(ctx, d.amount.words || '', W - P * 2 - 340), bh = Math.max(110, 50 + wl.length * 34);
          ctx.fillStyle = '#eaf6ec'; roundRect(ctx, P, y, W - P * 2, bh, 16); ctx.fill();
          ctx.fillStyle = '#1e7a3c'; ctx.font = '16px ' + FONT; ctx.fillText(String(d.amount.label || 'AMOUNT').toUpperCase(), P + 24, y + 20);
          ctx.font = 'bold 44px ' + FONT; ctx.fillText(d.amount.value || '', P + 24, y + 44, 280);
          if (wl.length) { ctx.fillStyle = '#5a6b7c'; ctx.font = '16px ' + FONT; ctx.fillText('AMOUNT IN WORDS', P + 330, y + 20); ctx.fillStyle = '#1e2b38'; ctx.font = 'bold 26px ' + FONT; wl.forEach(function (l, k) { ctx.fillText(l, P + 330, y + 46 + k * 34); }); }
          y += bh + 24;
        }
        if (d.note) {
          ctx.font = '21px ' + FONT;
          var nl = wrap(ctx, d.note.text || '—', W - P * 2 - 48), nh = 56 + nl.length * 30;
          ctx.fillStyle = '#f6f8fb'; roundRect(ctx, P, y, W - P * 2, nh, 14); ctx.fill();
          ctx.fillStyle = '#1b6e99'; ctx.font = 'bold 20px ' + FONT; ctx.fillText(d.note.label || '', P + 24, y + 16);
          ctx.fillStyle = '#1e2b38'; ctx.font = '21px ' + FONT; nl.forEach(function (l, k) { ctx.fillText(l, P + 24, y + 46 + k * 30); });
          y += nh + 20;
        }
        if (d.small) { ctx.fillStyle = '#6b7b8c'; ctx.font = '17px ' + FONT; wrap(ctx, d.small, W - P * 2).forEach(function (l) { ctx.fillText(l, P, y); y += 24; }); y += 10; }
        if (d.signs && d.signs.length) {
          y += 60;
          var sw = (W - P * 2) / d.signs.length;
          d.signs.forEach(function (lb, k) {
            var x0 = P + k * sw + 20, x1 = P + (k + 1) * sw - 20;
            ctx.strokeStyle = '#8a98a6'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
            ctx.fillStyle = '#5a6b7c'; ctx.font = '17px ' + FONT; ctx.textAlign = 'center'; ctx.fillText(lb, (x0 + x1) / 2, y + 10, x1 - x0); ctx.textAlign = 'left';
          });
          y += 50;
        }
        y += 24;
        ctx.fillStyle = '#8b97a3'; ctx.font = '17px ' + FONT; ctx.textAlign = 'center'; ctx.fillText(d.footer || 'This is a computer-generated document.', W / 2, y); ctx.textAlign = 'left';
        y += 50;
        ctx.strokeStyle = '#d5dde6'; ctx.lineWidth = 3; ctx.strokeRect(1.5, 1.5, W - 3, H - 3);
        if (d.sample) { ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(-0.42); ctx.fillStyle = 'rgba(255,122,107,0.16)'; ctx.font = 'bold 190px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('SAMPLE', 0, 0); ctx.restore(); }
        return y;
      };
      var H = Math.ceil(draw(10));
      c.width = W; c.height = H;
      draw(H);
      return c;
    });
  }

  /* ---------- files: PNG (JPEG if big) and a one-page A4 PDF, all made on the phone ---------- */
  function canvasBlob(c, type, q) {
    return new Promise(function (res, rej) { c.toBlob(function (b) { if (b) res(b); else rej(new Error('Could not make the image')); }, type, q); });
  }
  function safeName(n) { return String(n || 'Document').replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').replace(/_(?=\.|$)/g, '').replace(/^_/, '').slice(0, 80) || 'Document'; }
  function mkFile(blob, name, type) { try { return new File([blob], name, { type: type }); } catch (e) { blob.name = name; return blob; } }
  var MAX_IMG = 1500000;   // ~1.5 MB: above this the picture is sent as JPEG
  function imageFile(c, name) {
    return canvasBlob(c, 'image/png').then(function (b) {
      if (b.size <= MAX_IMG) return mkFile(b, safeName(name) + '.png', 'image/png');
      return canvasBlob(c, 'image/jpeg', 0.9).then(function (j) { return mkFile(j, safeName(name) + '.jpg', 'image/jpeg'); });
    });
  }
  function blobBytes(b) { return b.arrayBuffer ? b.arrayBuffer() : new Response(b).arrayBuffer(); }
  function pdfFile(c, name, title) {
    return canvasBlob(c, 'image/jpeg', 0.92).then(blobBytes).then(function (buf) {
      return mkFile(new Blob([pdfBytes(new Uint8Array(buf), c.width, c.height, title || name)], { type: 'application/pdf' }), safeName(name) + '.pdf', 'application/pdf');
    });
  }
  // Minimal PDF 1.4: one A4 page with the JPEG picture of the document (no fonts needed, so Telugu/₹ always look right).
  function pdfBytes(jpg, w, h, title) {
    var PW = 595.28, PH = 841.89, M = 24;
    var sc = Math.min((PW - 2 * M) / w, (PH - 2 * M) / h), dw = w * sc, dh = h * sc, x = (PW - dw) / 2, y = PH - M - dh;
    var enc = function (str) { var a = new Uint8Array(str.length); for (var i = 0; i < str.length; i++) a[i] = str.charCodeAt(i) & 0xff; return a; };
    var ttl = String(title || '').replace(/[^\x20-\x7e]/g, '').replace(/[()\\]/g, '');
    var content = 'q ' + dw.toFixed(2) + ' 0 0 ' + dh.toFixed(2) + ' ' + x.toFixed(2) + ' ' + y.toFixed(2) + ' cm /Im0 Do Q';
    var parts = [], offsets = [], len = 0;
    var push = function (u) { parts.push(u); len += u.length; };
    push(enc('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'));
    var obj = function (n, body, stream) {
      offsets[n] = len;
      push(enc(n + ' 0 obj\n' + body + (stream ? '\nstream\n' : '\nendobj\n')));
      if (stream) { push(stream); push(enc('\nendstream\nendobj\n')); }
    };
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PW + ' ' + PH + '] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>');
    obj(4, '<< /Type /XObject /Subtype /Image /Width ' + w + ' /Height ' + h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpg.length + ' >>', jpg);
    obj(5, '<< /Length ' + content.length + ' >>', enc(content));
    obj(6, '<< /Title (' + ttl + ') /Producer (The Little Wings) >>');
    var xref = len, rows = ['xref', '0 7', '0000000000 65535 f '];
    for (var i = 1; i <= 6; i++) rows.push(String(offsets[i]).padStart(10, '0') + ' 00000 n ');
    push(enc(rows.join('\n') + '\ntrailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n' + xref + '\n%%EOF\n'));
    var out = new Uint8Array(len), o = 0;
    parts.forEach(function (u) { out.set(u, o); o += u.length; });
    return out;
  }

  /* ---------- share the real file (WhatsApp etc.), or save it ---------- */
  function canShareFiles(type) {
    try { return !!(navigator.share && navigator.canShare && navigator.canShare({ files: [mkFile(new Blob(['x'], { type: type || 'image/png' }), type === 'application/pdf' ? 'x.pdf' : 'x.png', type || 'image/png')] })); } catch (e) { return false; }
  }
  function download(blob, name) {
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name || blob.name || 'file'; a.rel = 'noopener'; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 4000);
    return 'downloaded';
  }
  // Files are made in advance when a receipt opens, so the Share tap can open the share sheet at once
  // (phones only allow the share sheet straight after a tap).
  var cache = {};
  function prepare(key, make) {
    if (!cache[key]) {
      var e = cache[key] = { file: null, p: null };
      e.p = Promise.resolve().then(make).then(function (f) { e.file = f; return f; }, function (err) { delete cache[key]; throw err; });
    }
    return cache[key].p;
  }
  function ready(key) { return cache[key] && cache[key].file; }
  function forget(prefix) { Object.keys(cache).forEach(function (k) { if (!prefix || k.indexOf(prefix) === 0) delete cache[k]; }); }
  /* o = { key, make: () => Promise<File>, type: 'image/png'|'application/pdf', title, text, waUrl,
   *       save: true to always save instead of share, toast: (msg, kind) => void, msgs: {…} }
   * resolves 'shared' | 'cancelled' | 'retry' | 'saved-wa' | 'downloaded' | 'error' */
  function shareDoc(o) {
    var M = Object.assign({ savedWa: 'Saved — attach it in WhatsApp', saved: 'Saved', retry: 'Ready — tap Share again', fail: 'Could not make the file' }, o.msgs || {});
    var say = o.toast || function () {};
    var got = ready(o.key), getFile = function () { return got ? Promise.resolve(got) : prepare(o.key, o.make); };
    if (o.save) return getFile().then(function (f) { download(f, f.name); say(M.saved); return 'downloaded'; }, function (e) { say(M.fail + ': ' + (e && e.message || e), 'err'); return 'error'; });
    if (canShareFiles(o.type)) {
      return getFile().then(function (f) {
        if (!navigator.canShare({ files: [f] })) { download(f, f.name); say(M.saved); return 'downloaded'; }
        var data = { files: [f], title: o.title || f.name };
        if (o.text) data.text = o.text;
        return navigator.share(data).then(function () { return 'shared'; }, function (e) {
          if (e && e.name === 'AbortError') return 'cancelled';           // closed the share sheet: no error
          if (e && e.name === 'NotAllowedError') { say(M.retry); return 'retry'; }  // tap expired while the file was made
          download(f, f.name); say(M.saved); return 'downloaded';
        });
      }, function (e) { say(M.fail + ': ' + (e && e.message || e), 'err'); return 'error'; });
    }
    // Computer / browser without file sharing: open WhatsApp now (still inside the tap), then save the file.
    if (o.waUrl) { try { window.open(o.waUrl, '_blank', 'noopener'); } catch (e) { /* ignore */ } }
    return getFile().then(function (f) { download(f, f.name); say(o.waUrl ? M.savedWa : M.saved); return o.waUrl ? 'saved-wa' : 'downloaded'; }, function (e) { say(M.fail + ': ' + (e && e.message || e), 'err'); return 'error'; });
  }
  // Kept for older screens: share the picture on phones, save it elsewhere.
  function saveImage(r, filename) {
    var name = filename || ('Receipt-' + (r.receiptNo || 'LW'));
    return shareDoc({ key: 'old|' + name, make: function () { return receiptCanvas(r).then(function (c) { return imageFile(c, name); }); }, type: 'image/png', title: 'Fee receipt ' + (r.receiptNo || '') });
  }

  window.LWReceipt = { html: html, text: text, print: print, png: png, saveImage: saveImage, receiptCanvas: receiptCanvas, docCanvas: docCanvas, imageFile: imageFile, pdfFile: pdfFile, pdfBytes: pdfBytes, shareDoc: shareDoc, prepare: prepare, ready: ready, forget: forget, canShareFiles: canShareFiles, download: download, inWords: inWords, amountWords: amountWords, period: period, fmtDate: fmtDate, inr: inr };
})();
