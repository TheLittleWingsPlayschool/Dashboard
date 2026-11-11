/*!
 * The Little Wings — shared fee receipt (v2.4). Used by the admin dashboard
 * and the Parents app. No dependencies, no network: HTML receipt + print to
 * one clean page (Save as PDF from the print dialog) + a PNG image drawn on a
 * canvas + a WhatsApp text summary.
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
  function png(r) {
    return loadImg(r.logo).then(function (logo) {
      var W = 1200, P = 56, s = r.school || {};
      var c = document.createElement('canvas'), ctx = c.getContext('2d');
      var F = '"Segoe UI", Roboto, "Noto Sans", Helvetica, Arial, sans-serif';
      // measure pass for height
      c.width = W; c.height = 10;
      ctx.font = '18px ' + F;
      var addr = wrap(ctx, s.address || '', W - P * 2 - 120 - 260);
      ctx.font = 'bold 26px ' + F;
      var words = wrap(ctx, amountWords(r.amount), W - P * 2 - 340);
      var rows = [['Student name', r.studentName || '—', true], ['Class', r.className || '—'], ['Parent / Guardian', r.parentName || '—'], ['Fee for', period(r.months)]];
      if (Number(r.yearlyFee) > 0) rows.push(['Yearly fee', inr(r.yearlyFee)]);
      if (Number(r.monthlyFee) > 0) rows.push(['Monthly fee', inr(r.monthlyFee)]);
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
      if (logo) { ctx.save(); ctx.beginPath(); ctx.arc(P + 50, y + 50, 50, 0, Math.PI * 2); ctx.clip(); ctx.drawImage(logo, P, y, 100, 100); ctx.restore(); }
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
      return new Promise(function (res, rej) { c.toBlob(function (b) { if (b) res(b); else rej(new Error('Could not make the image')); }, 'image/png'); });
    });
  }
  function roundRect(ctx, x, y, w, h, rad) {
    ctx.beginPath(); ctx.moveTo(x + rad, y); ctx.arcTo(x + w, y, x + w, y + h, rad); ctx.arcTo(x + w, y + h, x, y + h, rad); ctx.arcTo(x, y + h, x, y, rad); ctx.arcTo(x, y, x + w, y, rad); ctx.closePath();
  }
  // Share the PNG (phone share sheet: WhatsApp, Drive…) or download it.
  function saveImage(r, filename) {
    return png(r).then(function (blob) {
      var name = (filename || ('Receipt-' + (r.receiptNo || 'LW'))).replace(/[^\w.-]+/g, '_') + '.png';
      var file = null;
      try { file = new File([blob], name, { type: 'image/png' }); } catch (e) { file = null; }
      if (file && navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
        return navigator.share({ files: [file], title: 'Fee receipt ' + (r.receiptNo || '') }).then(function () { return 'shared'; }, function (e) { if (e && e.name === 'AbortError') return 'cancelled'; return download(blob, name); });
      }
      return download(blob, name);
    });
  }
  function download(blob, name) {
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
    return 'downloaded';
  }

  window.LWReceipt = { html: html, text: text, print: print, png: png, saveImage: saveImage, inWords: inWords, amountWords: amountWords, period: period, fmtDate: fmtDate, inr: inr };
})();
