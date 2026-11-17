/* Dashboard progres Studi Alumni Del Folks
   Membaca JSON anonim dari Apps Script (?format=json), menghitung agregat di browser,
   dan mendukung filter jenis / regional / keterlibatan / RQ. */
(function () {
  'use strict';
  var CFG = window.DELFOLKS || {};
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var fmt = function (n) { return new Intl.NumberFormat('id-ID').format(n); };
  var REG_ORDER = ['Sumut', 'Sumsel-Jabodetabek', 'Bandung', 'Jateng-DIY', 'Jatim-Indonesia Timur', 'Luar Negeri'];
  var LVL_ORDER = ['aktif', 'pernah aktif', 'pasif'];
  var RQ_LABEL = { RQ1: 'Makna', RQ2: 'Hambatan', RQ3: 'Program', RQ4: 'Struktur & iuran', RQ5: 'Kepercayaan', RQ6: 'Kesediaan' };
  var RQ_FULL = {
    RQ1: 'Apa makna Del Folks bagi alumni, dan apa yang mereka harapkan darinya?',
    RQ2: 'Mengapa sebagian alumni tidak terlibat atau bergerak sendiri-sendiri? Hambatan apa yang dirasakan?',
    RQ3: 'Program dan layanan apa yang dianggap paling bernilai?',
    RQ4: 'Bagaimana penilaian alumni terhadap rancangan struktur, iuran wajib, pembagian regional, dan pemilihan ketua umum?',
    RQ5: 'Tata kelola, komunikasi, dan akuntabilitas seperti apa yang membuat alumni percaya?',
    RQ6: 'Peran apa yang bersedia diambil alumni, dengan syarat apa?'
  };
  var KODE_FULL = {
    MAKNA: 'arti Del dan Del Folks bagi alumni', HARAPAN: 'program dan manfaat yang diharapkan', HAMBATAN: 'alasan tidak terlibat',
    STRUKTUR: 'pandangan tentang bentuk organisasi', IURAN: 'sikap terhadap iuran', PEMILIHAN: 'cara memilih pengurus dan ketua',
    KEPERCAYAAN: 'syarat agar alumni percaya pada pengurus', KOMUNIKASI: 'kanal dan cara komunikasi yang disukai',
    KESEDIAAN: 'peran yang bersedia diambil', REGIONAL: 'kebutuhan khas tiap regional'
  };

  var RAW = null, STATE = { jenis: '', regional: '', keterlibatan: '', rq: '' };

  // ---------- data ----------
  function load() {
    var demo = /[?&]demo/.test(location.search);
    if (!CFG.endpoint || demo) {
      setStatus('warn', demo ? 'Data contoh' : 'Endpoint belum diatur — menampilkan data contoh');
      showAlert('info', CFG.endpoint ? 'Ini data contoh untuk pratinjau. Hapus ?demo dari alamat untuk data sebenarnya.' : 'Dashboard belum terhubung ke data studi. Pengelola perlu mengisi alamat endpoint di assets/config.js setelah Apps Script di-deploy.');
      RAW = demoData();
      render();
      return;
    }
    setStatus('warn', 'Memuat data…');
    var url = CFG.endpoint + (CFG.endpoint.indexOf('?') > -1 ? '&' : '?') + 'format=json&_=' + Date.now();
    fetch(url, { redirect: 'follow' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) {
        if (!j || !j.dokumen) throw new Error('Format data tidak dikenali');
        RAW = j; render();
        setStatus('ok', 'Diperbarui ' + new Date(j.diperbarui || Date.now()).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }));
      })
      .catch(function (e) {
        setStatus('err', 'Gagal memuat');
        showAlert('err', 'Data tidak bisa dimuat (' + esc(e.message) + '). Coba muat ulang; jika berulang, hubungi pengelola.');
        $('#app').innerHTML = '';
      });
  }

  function setStatus(kind, text) {
    var s = $('#status'); s.innerHTML = '<span class="dot ' + (kind === 'ok' ? '' : kind) + '"></span>' + esc(text);
  }
  function showAlert(kind, html) {
    var a = $('#alert'); a.hidden = false; a.className = 'alert ' + (kind === 'info' ? 'info' : '');
    a.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4m0 4h.01"/></svg><div>' + html + '</div>';
  }

  // ---------- filters ----------
  function buildFilters() {
    var d = RAW.dokumen;
    var opts = function (field, order) {
      var set = {}; d.forEach(function (x) { if (x[field]) set[x[field]] = 1; });
      var keys = Object.keys(set);
      if (order) keys.sort(function (a, b) { return (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99); });
      return keys;
    };
    fill('#f-jenis', opts('jenis'), 'Semua jenis');
    fill('#f-regional', opts('regional', REG_ORDER), 'Semua regional');
    fill('#f-lvl', opts('keterlibatan', LVL_ORDER), 'Semua tingkat');
    fill('#f-rq', ['RQ1', 'RQ2', 'RQ3', 'RQ4', 'RQ5', 'RQ6'], 'Semua RQ', function (k) { return k + ' · ' + RQ_LABEL[k]; });
    ['#f-jenis', '#f-regional', '#f-lvl', '#f-rq'].forEach(function (id, i) {
      $(id).addEventListener('change', function (e) { STATE[['jenis', 'regional', 'keterlibatan', 'rq'][i]] = e.target.value; render(); });
    });
    $('#f-reset').addEventListener('click', function () {
      STATE = { jenis: '', regional: '', keterlibatan: '', rq: '' };
      ['#f-jenis', '#f-regional', '#f-lvl', '#f-rq'].forEach(function (id) { $(id).value = ''; });
      render();
    });
  }
  function fill(id, keys, all, label) {
    var s = $(id); s.innerHTML = '<option value="">' + all + '</option>' + keys.map(function (k) { return '<option value="' + esc(k) + '">' + esc(label ? label(k) : k) + '</option>'; }).join('');
  }

  function filtered() {
    var d = RAW.dokumen.filter(function (x) {
      return (!STATE.jenis || x.jenis === STATE.jenis) && (!STATE.regional || x.regional === STATE.regional) && (!STATE.keterlibatan || x.keterlibatan === STATE.keterlibatan);
    });
    var ids = {}; d.forEach(function (x) { ids[x.kode] = 1; });
    var t = RAW.temuan.filter(function (x) { return ids[x.kode] && (!STATE.rq || x.rq === STATE.rq); });
    return { dokumen: d, temuan: t };
  }

  // ---------- aggregates ----------
  function count(arr, field) { var o = {}; arr.forEach(function (x) { var v = x[field]; if (v) o[v] = (o[v] || 0) + 1; }); return o; }
  function sortedKeys(o, order) {
    return Object.keys(o).sort(function (a, b) { return order ? ((order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99)) : o[b] - o[a]; });
  }

  // ---------- render ----------
  function render() {
    if (!$('#f-jenis').options.length) buildFilters();
    var F = filtered(), d = F.dokumen, t = F.temuan, cfg = RAW.config || {};
    var active = Object.keys(STATE).filter(function (k) { return STATE[k]; });
    $('#f-reset').hidden = !active.length;
    $('#scope').textContent = active.length ? 'Menampilkan ' + fmt(d.length) + ' lembar dan ' + fmt(t.length) + ' temuan sesuai filter.' : 'Menampilkan seluruh data.';

    var suara = d.reduce(function (s, x) { return s + (x.jenis === 'Del Talks' ? 2 : 1); }, 0);
    var regs = Object.keys(count(d, 'regional')).length;
    var minggu = weekly(d, cfg.tanggalMulai);
    var lastW = minggu.length ? minggu[minggu.length - 1].n : 0;

    var html = '';
    html += '<section class="kpis enter" aria-label="Ringkasan">' +
      kpi('Lembar temuan masuk', fmt(d.length), '', lastW ? '<span class="up">+' + lastW + '</span> minggu ini' : '<span class="flat">belum ada minggu ini</span>') +
      kpi('Suara alumni', fmt(suara), '', 'Del Talks dihitung dua suara') +
      kpi('Temuan terkode', fmt(t.length), '', d.length ? (t.length / d.length).toFixed(1) + ' temuan per lembar' : '—') +
      kpi('Regional terwakili', regs, '/ 6', regs < 6 ? (6 - regs) + ' regional belum ada suara' : 'semua regional terwakili') +
      '</section>';

    html += '<div class="grid">';
    // progres vs target
    var target = cfg.target || {}; var perJenis = count(d, 'jenis');
    Object.keys(target).forEach(function (k) { if (!(k in perJenis) && !STATE.jenis) perJenis[k] = 0; });
    html += panel('span-5 enter', 'Progres menuju target', 'per jenis kegiatan', rowsTarget(perJenis, target), 'Garis tegak = target. Target diatur di tab Config.');
    // weekly
    var mulaiTxt = cfg.tanggalMulai ? new Date(cfg.tanggalMulai).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
    html += panel('span-7 enter', 'Lembar masuk per minggu', 'sejak minggu ke-1 studi', weeklyCols(minggu), 'M1 = minggu pertama studi' + (mulaiTxt ? ' (mulai ' + mulaiTxt + ')' : '') + ', M2 = minggu kedua, dan seterusnya. Kolom gelap = minggu berjalan.');
    // coverage weave (signature)
    html += panel('span-7 enter', 'Cakupan suara', 'regional × tingkat keterlibatan', weave(d), null, '<div class="legend"><span><i class="c"></i>sudah terwakili, makin gelap makin banyak</span><span><i class="g"></i>belum ada suara — prioritas ajakan berikutnya</span></div>');
    // per RQ
    var perRQ = count(t, 'rq');
    html += panel('span-5 enter', 'Temuan per pertanyaan penelitian', '', rows(perRQ, { order: ['RQ1', 'RQ2', 'RQ3', 'RQ4', 'RQ5', 'RQ6'], label: function (k) { return k + ' ' + (RQ_LABEL[k] || ''); }, title: function (k) { return RQ_FULL[k] || k; }, cls: 'toba2' }), 'RQ = pertanyaan penelitian (research question). Arahkan kursor ke label untuk membaca pertanyaan lengkapnya; daftar lengkap ada di Keterangan istilah di bawah.');
    // kode induk
    var perKode = {}; t.forEach(function (x) { var k = (x.kode_induk || '').split(/[\s:]+/)[0]; if (k) perKode[k] = (perKode[k] || 0) + 1; });
    html += panel('span-4 enter', 'Temuan per kode induk', '', rows(perKode, { title: function (k) { return KODE_FULL[k] || k; } }), 'Kode induk = kategori tema dalam codebook analisis.');
    // top tema
    var tema = {}; t.forEach(function (x) { var k = (x.tema || '').trim().toLowerCase(); if (k) tema[k] = (tema[k] || 0) + 1; });
    var top = sortedKeys(tema).slice(0, 18);
    html += panel('span-8 enter', 'Tema yang paling sering muncul', top.length + ' dari ' + Object.keys(tema).length + ' tema', top.length ? '<div class="chips">' + top.map(function (k) { return '<span class="chip">' + esc(k) + '<b>' + tema[k] + '</b></span>'; }).join('') + '</div>' : empty(), null);
    // sikap
    html += panel('span-4 enter', 'Penilaian struktur AD/ART', '', rows(count(d, 'struktur'), { order: ['sangat cocok', 'cocok dengan catatan', 'terlalu rumit', 'kurang cocok', 'tidak tahu'] }), null);
    html += panel('span-4 enter', 'Sikap terhadap iuran', '', rows(count(d, 'iuran'), { order: ['setuju wajib', 'setuju bersyarat', 'lebih baik sukarela', 'tolak', 'tidak tahu'] }), null);
    html += panel('span-4 enter', 'Kesediaan berperan', '', rows(count(d, 'kesediaan'), {}), null);
    html += panel('span-4 enter', 'Perasaan dominan percakapan', '', rows(count(d, 'perasaan'), { cls: 'ulos' }), null);
    // harus diubah
    var hd = d.map(function (x) { return x.harus_diubah; }).filter(Boolean).slice(-12).reverse();
    html += panel('span-8 enter', '“Satu hal yang harus diubah”', hd.length + ' jawaban terbaru', hd.length ? '<ul class="list">' + hd.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : empty(), null);
    // findings
    var latest = t.slice().reverse();
    html += panel('span-12 enter', 'Temuan terbaru', 'anonim · ' + fmt(latest.length) + ' temuan', findings(latest.slice(0, 12)) + (latest.length > 12 ? '<div class="more"><button class="btn ghost" id="more" type="button">Tampilkan 12 berikutnya</button></div>' : ''), null);
    html += panel('span-12 enter', 'Keterangan istilah', 'cara membaca dashboard ini', glossary(cfg), null);
    html += '</div>';
    $('#app').innerHTML = html;

    var shown = 12;
    var mb = $('#more');
    if (mb) mb.addEventListener('click', function () {
      shown += 12; var box = mb.parentNode.previousSibling ? mb.parentNode.parentNode : null;
      mb.parentNode.insertAdjacentHTML('beforebegin', findings(latest.slice(shown - 12, shown)));
      if (shown >= latest.length) mb.parentNode.remove();
    });
    requestAnimationFrame(function () { document.querySelectorAll('[data-w]').forEach(function (el) { el.style.setProperty('--w', el.getAttribute('data-w') + '%'); }); document.querySelectorAll('[data-h]').forEach(function (el) { el.style.setProperty('--h', el.getAttribute('data-h') + '%'); }); });
  }

  function kpi(l, v, unit, d) { return '<div class="kpi"><div class="l">' + l + '</div><div class="v">' + v + (unit ? '<small>' + unit + '</small>' : '') + '</div><div class="d">' + d + '</div></div>'; }
  function panel(cls, title, hint, body, note, extra) {
    return '<section class="panel ' + cls + '"><header><h2>' + esc(title) + '</h2>' + (hint ? '<span class="hint">' + esc(hint) + '</span>' : '') + '</header>' + body + (extra || '') + (note ? '<div class="note">' + esc(note) + '</div>' : '') + '</section>';
  }
  function empty() { return '<div class="empty">Belum ada data untuk pilihan ini.</div>'; }

  function rows(o, opt) {
    var keys = sortedKeys(o, opt.order); if (!keys.length) return empty();
    var max = Math.max.apply(null, keys.map(function (k) { return o[k]; })) || 1;
    var total = keys.reduce(function (s, k) { return s + o[k]; }, 0);
    return '<div class="rows">' + keys.map(function (k) {
      var v = o[k], pct = Math.round(100 * v / max);
      return '<div class="row"><div class="lbl" title="' + esc(opt.title ? opt.title(k) : k) + '">' + esc(opt.label ? opt.label(k) : k) + '</div><div class="trk"><div class="fil ' + (opt.cls || '') + '" data-w="' + pct + '"></div></div><div class="val"><b>' + fmt(v) + '</b> · ' + Math.round(100 * v / total) + '%</div></div>';
    }).join('') + '</div>';
  }
  function rowsTarget(o, target) {
    var keys = sortedKeys(o, ['Wawancara', 'Del Talks', 'FGD', 'Voice note', 'Anotasi AD-ART']); if (!keys.length) return empty();
    var max = Math.max.apply(null, keys.map(function (k) { return Math.max(o[k], target[k] || 0); })) || 1;
    return '<div class="rows">' + keys.map(function (k) {
      var v = o[k], tg = target[k], pct = Math.round(100 * v / max), hit = tg && v >= tg;
      return '<div class="row"><div class="lbl">' + esc(k) + '</div><div class="trk"><div class="fil ' + (tg ? (hit ? 'target-hit' : 'target-miss') : '') + '" data-w="' + pct + '"></div>' + (tg ? '<div class="tgt" style="--t:' + Math.round(100 * tg / max) + '%"></div>' : '') + '</div><div class="val"><b>' + fmt(v) + '</b>' + (tg ? ' / ' + fmt(tg) : '') + '</div></div>';
    }).join('') + '</div>';
  }

  function weekly(d, mulai) {
    if (!mulai) return [];
    var m = new Date(mulai); if (isNaN(m)) return [];
    var now = new Date(), maxW = Math.max(1, Math.floor((now - m) / 6048e5) + 1);
    var o = {}; d.forEach(function (x) { var dt = new Date(x.tanggal); if (isNaN(dt)) return; var w = Math.max(1, Math.floor((dt - m) / 6048e5) + 1); if (w > maxW) maxW = w; o[w] = (o[w] || 0) + 1; });
    var out = []; for (var w = 1; w <= maxW; w++) out.push({ w: w, n: o[w] || 0 }); return out;
  }
  function weeklyCols(weeks) {
    if (!weeks.length) return empty();
    var max = Math.max.apply(null, weeks.map(function (x) { return x.n; })) || 1, last = weeks.length;
    return '<div class="cols">' + weeks.map(function (x) {
      return '<div class="col"><div class="n">' + (x.n || '') + '</div><div class="b' + (x.w === last ? ' now' : '') + '" data-h="' + Math.max(2, Math.round(100 * x.n / max)) + '" title="Minggu ' + x.w + ': ' + x.n + '"></div><div class="w">M' + x.w + '</div></div>';
    }).join('') + '</div>';
  }

  function weave(d) {
    var cells = {}, regs = {}, lv = {};
    d.forEach(function (x) { var r = x.regional || 'Tidak diisi', l = x.keterlibatan || 'tidak diisi'; regs[r] = 1; lv[l] = 1; cells[r + '|' + l] = (cells[r + '|' + l] || 0) + 1; });
    var R = REG_ORDER.filter(function (r) { return !STATE.regional || r === STATE.regional; }).concat(Object.keys(regs).filter(function (r) { return REG_ORDER.indexOf(r) < 0; }));
    var L = LVL_ORDER.filter(function (l) { return !STATE.keterlibatan || l === STATE.keterlibatan; }).concat(Object.keys(lv).filter(function (l) { return LVL_ORDER.indexOf(l) < 0; }));
    if (!d.length) return empty();
    var max = Math.max.apply(null, Object.keys(cells).map(function (k) { return cells[k]; })) || 1;
    var h = '<table class="weave"><thead><tr><th>Regional</th>' + L.map(function (l) { return '<th>' + esc(l) + '</th>'; }).join('') + '<th>Total</th></tr></thead><tbody>';
    R.forEach(function (r) {
      var tot = 0;
      h += '<tr><td>' + esc(r) + '</td>' + L.map(function (l) {
        var v = cells[r + '|' + l] || 0; tot += v;
        if (!v) return '<td><div class="cell gap" title="' + esc(r + ' · ' + l) + ': belum ada">0</div></td>';
        var p = Math.round(100 * v / max);
        return '<td><div class="cell" style="--p:' + Math.max(18, p) + '" data-p="' + (p > 55 ? 'high' : 'low') + '" title="' + esc(r + ' · ' + l) + ': ' + v + '">' + v + '</div></td>';
      }).join('') + '<td><div class="tot">' + tot + '</div></td></tr>';
    });
    return h + '</tbody></table>';
  }

  function glossary(cfg) {
    var rq = Object.keys(RQ_FULL).map(function (k) { return '<tr><td><span class="tag">' + k + '</span></td><td><b>' + esc(RQ_LABEL[k]) + '</b> — ' + esc(RQ_FULL[k]) + '</td></tr>'; }).join('');
    var kd = Object.keys(KODE_FULL).map(function (k) { return '<tr><td><span class="tag k">' + k + '</span></td><td>' + esc(KODE_FULL[k]) + '</td></tr>'; }).join('');
    return '<div class="gloss">' +
      '<div><h3>Pertanyaan penelitian (RQ)</h3><table class="gt">' + rq + '</table></div>' +
      '<div><h3>Kode induk</h3><table class="gt">' + kd + '</table>' +
      '<h3>Istilah lain</h3><table class="gt">' +
      '<tr><td><b>M1, M2, …</b></td><td>Minggu ke-1, ke-2, dan seterusnya sejak studi dimulai' + (cfg.tanggalMulai ? ' (' + esc(new Date(cfg.tanggalMulai).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })) + ')' : '') + '.</td></tr>' +
      '<tr><td><b>Lembar temuan</b></td><td>Satu dokumen hasil satu kegiatan (satu wawancara, satu obrolan Del Talks, satu FGD, atau satu voice note), berisi beberapa temuan.</td></tr>' +
      '<tr><td><b>Temuan</b></td><td>Satu baris tema + kutipan + makna yang dicatat pewawancara; satu lembar biasanya berisi 3–7 temuan.</td></tr>' +
      '<tr><td><b>Suara</b></td><td>Jumlah alumni yang didengar. Del Talks melibatkan dua alumni, jadi dihitung dua suara.</td></tr>' +
      '<tr><td><b>Del Talks</b></td><td>Obrolan 20–40 menit antara dua alumni dengan kartu pemandu, direkam atau dirangkum.</td></tr>' +
      '<tr><td><b>Keterlibatan</b></td><td><i>aktif</i> = ikut kegiatan alumni dalam 2 tahun terakhir; <i>pernah aktif</i> = pernah, lalu mundur; <i>pasif</i> = tidak pernah terlibat.</td></tr>' +
      '<tr><td><b>Kode dokumen</b></td><td>Misal <code>T-2014-2016-R2-007</code>: jenis (W wawancara, T Del Talks, F FGD, V voice note), rentang angkatan, regional (R1 Sumut, R2 Sumsel-Jabodetabek, R3 Bandung, R4 Jateng-DIY, R5 Jatim-Indonesia Timur, R6 luar negeri), nomor urut. Tidak ada nama.</td></tr>' +
      '<tr><td><b>Target</b></td><td>Jumlah lembar yang ingin dicapai per jenis kegiatan, ditetapkan tim riset di awal studi.</td></tr>' +
      '</table></div></div>';
  }

  function findings(list) {
    if (!list.length) return empty();
    return list.map(function (x) {
      return '<article class="finding"><div class="meta"><span class="tag">' + esc(x.rq) + '</span>' + (x.kode_induk ? '<span class="tag k">' + esc(x.kode_induk) + '</span>' : '') + '<span>' + esc(x.jenis) + ' · angkatan ' + esc(x.angkatan) + ' · ' + esc(x.regional) + ' · ' + esc(x.keterlibatan) + '</span></div>' +
        (x.tema ? '<div class="tema">' + esc(x.tema) + '</div>' : '') + (x.kutipan ? '<p class="q">' + esc(x.kutipan) + '</p>' : '') + (x.makna ? '<p class="m">' + esc(x.makna) + '</p>' : '') + '</article>';
    }).join('');
  }

  // ---------- demo data ----------
  function demoData() {
    var regs = REG_ORDER.slice(0, 5), lv = LVL_ORDER, jenis = ['Del Talks', 'Del Talks', 'Del Talks', 'Wawancara', 'Voice note', 'Del Talks', 'FGD'];
    var struktur = ['cocok dengan catatan', 'terlalu rumit', 'cocok dengan catatan', 'tidak tahu', 'terlalu rumit', 'sangat cocok'];
    var iuran = ['setuju bersyarat', 'setuju bersyarat', 'lebih baik sukarela', 'setuju wajib', 'tolak', 'setuju bersyarat'];
    var kes = ['relawan', 'anggota saja', 'donatur', 'pengurus regional', 'relawan', 'belum tahu'];
    var pers = ['campur', 'antusias', 'kecewa', 'campur', 'hati-hati', 'antusias'];
    var hd = ['Ajak orang secara personal, bukan broadcast', 'Laporan keuangan terbuka tiap tiga bulan', 'Mulai dari tim kecil yang jelas kerjanya', 'Regional diberi otonomi program', 'Jangan ada syarat lunas iuran untuk alumni muda', 'Pengurus harus orang yang dikenal lintas angkatan'];
    var T = [
      ['RQ2', 'Tidak pernah diajak personal', 'HAMBATAN', 'Selama ini cuma lihat broadcast di grup, nggak pernah ada yang nanya langsung ke saya.', 'Hambatan utama bukan ketidakpedulian, melainkan tidak adanya ajakan personal.'],
      ['RQ4', 'Struktur terlalu besar', 'STRUKTUR', 'Lima belas orang dewan perwakilan? Yang aktif saja belum tentu lima belas.', 'Skala struktur dinilai tidak realistis dibanding jumlah alumni aktif.'],
      ['RQ4', 'Iuran harus transparan', 'IURAN', 'Saya mau bayar, asal tahu uangnya ke mana tiap bulan.', 'Kesediaan membayar bersyarat pada laporan keuangan terbuka.'],
      ['RQ1', 'Ikatan asrama masih kuat', 'MAKNA', 'Yang saya rindukan itu malam-malam belajar bareng di asrama.', 'Makna Del terikat pada pengalaman asrama, bukan pada organisasi.'],
      ['RQ3', 'Jaringan karier', 'HARAPAN', 'Kalau ada senior yang bisa dihubungi soal kerjaan, itu saja sudah cukup.', 'Manfaat konkret yang diharapkan sederhana: akses ke senior.'],
      ['RQ5', 'Percaya pada orang, bukan jabatan', 'KEPERCAYAAN', 'Saya ikut kalau yang ngurus orangnya saya kenal.', 'Kepercayaan bersifat personal, bukan institusional.'],
      ['RQ2', 'Dominasi angkatan tertentu', 'HAMBATAN', 'Rasanya itu urusan angkatan atas, kami cuma diundang kalau butuh orang.', 'Persepsi eksklusivitas menghalangi partisipasi angkatan muda.'],
      ['RQ6', 'Mau jadi relawan, bukan pengurus', 'KESEDIAAN', 'Kalau acara, saya bantu. Kalau rapat tiap bulan, maaf.', 'Kesediaan tinggi untuk peran episodik, rendah untuk peran struktural.'],
      ['RQ4', 'Regional terlalu luas', 'REGIONAL', 'Jatim sampai Papua satu regional, ya nggak akan ketemu.', 'Pembagian regional timur dinilai tidak operasional.'],
      ['RQ3', 'Kontribusi ke adik kelas', 'HARAPAN', 'Beasiswa buat adik-adik yang kesulitan, itu yang bikin saya mau ikut.', 'Motivasi filantropis kuat pada alumni senior.']
    ];
    var dok = [], tem = [], start = new Date('2026-11-17'), seq = 0;
    var regPick = [0,1,1,0,1,2,1,0,3,1,0,2,1,4,0,1,1,2,0,1,3,1,0,2,1,0,1,4,1,0,2];
    var lvPick  = [0,0,2,1,0,0,2,0,1,0,2,0,0,1,0,2,0,0,0,2,1,0,0,0,2,0,1,0,0,2,0];
    var dayPick = [0,1,2,3,4,6,7,7,8,8,9,9,10,10,11,12,13,14,14,15,15,15,16,17,18,19,22,23,24,25,26];
    for (var i = 0; i < 31; i++) {
      var j = jenis[i % jenis.length], r = regs[regPick[i]], l = lv[lvPick[i]];
      var dt = new Date(start.getTime() + dayPick[i] * 864e5);
      var kode = (j === 'Wawancara' ? 'W' : j === 'FGD' ? 'F' : j === 'Voice note' ? 'V' : 'T') + '-20' + (11 + (i % 5) * 3) + '-R' + (regs.indexOf(r) + 1) + '-' + String(++seq).padStart(3, '0');
      dok.push({ kode: kode, jenis: j, tanggal: dt.toISOString().slice(0, 10), angkatan: '20' + (11 + (i % 5) * 3) + '-20' + (13 + (i % 5) * 3), regional: r, keterlibatan: l, sikap_awal: ['mendukung', 'kritis', 'tidak peduli'][i % 3], struktur: struktur[i % 6], iuran: iuran[i % 6], kesediaan: kes[i % 6], perasaan: pers[i % 6], harus_diubah: hd[i % 6] });
      var n = 2 + (i % 4);
      for (var k = 0; k < n; k++) { var tt = T[(i + k * 3) % T.length]; tem.push({ id: kode + '-' + (k + 1), kode: kode, jenis: j, angkatan: dok[i].angkatan, regional: r, keterlibatan: l, rq: tt[0], tema: tt[1], kode_induk: tt[2], kutipan: tt[3], makna: tt[4] }); }
    }
    return { diperbarui: new Date().toISOString(), config: { tanggalMulai: '2026-11-17', target: { 'Wawancara': 12, 'Del Talks': 40, 'FGD': 6, 'Voice note': 30 } }, dokumen: dok, temuan: tem };
  }

  document.addEventListener('DOMContentLoaded', load);
})();
