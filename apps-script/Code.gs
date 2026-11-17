/**
 * STUDI ALUMNI DEL FOLKS — Pipeline Temuan Anonim + Dashboard
 * ------------------------------------------------------------
 * Pasang script ini TERIKAT (bound) pada spreadsheet "09 Lembar Kerja Riset Del Folks"
 * (Extensions → Apps Script). Semua ID folder/berkas dibaca dari tab Config.
 *
 * Alur:
 *   1. Tim menyalin TEMPLATE Lembar Temuan, mengisi, menaruh di folder 10 INBOX.
 *   2. prosesInbox() berjalan tiap 15 menit (trigger waktu):
 *      - membaca tabel DATA PRIVAT → ditulis ke spreadsheet privat steward, lalu DIKOSONGKAN dari dokumen
 *      - membaca METADATA, TEMUAN, RINGKASAN, REFLEKSI → ditulis anonim ke tab Temuan & Dokumen
 *      - menyamarkan nama informan yang muncul di kutipan → "[nama]"
 *      - memindahkan dokumen ke folder 11 DIPROSES
 *   3. doGet() menyajikan dashboard web yang membaca tab Temuan & Dokumen.
 */

// ===================== KONFIGURASI =====================

function getConfig_() {
  var sh = SpreadsheetApp.getActive().getSheetByName('Config');
  var rows = sh.getDataRange().getValues();
  var cfg = {};
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0]) cfg[String(rows[i][0]).trim()] = rows[i][1];
  }
  return cfg;
}

var LABEL = {
  PRIVAT: 'DATA PRIVAT',
  META: 'METADATA',
  TEMUAN: 'TEMUAN',
  RINGKASAN: 'RINGKASAN',
  REFLEKSI: 'REFLEKSI PEWAWANCARA'
};

var REGIONAL_CODE = {
  'sumut': 'R1', 'sumatera bagian utara': 'R1',
  'sumsel-jabodetabek': 'R2', 'sumsel & jabodetabek': 'R2', 'jabodetabek': 'R2',
  'bandung': 'R3',
  'jateng-diy': 'R4', 'jawa tengah & diy': 'R4', 'jateng': 'R4',
  'jatim-indonesia timur': 'R5', 'jatim & indonesia timur': 'R5', 'jatim': 'R5',
  'luar negeri': 'R6'
};

var JENIS_PREFIX = {
  'wawancara': 'W', 'del talks': 'T', 'fgd': 'F', 'voice note': 'V', 'anotasi ad-art': 'A', 'anotasi ad/art': 'A'
};

// ===================== MENU & TRIGGER =====================

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Del Folks')
    .addItem('Proses INBOX sekarang', 'prosesInbox')
    .addItem('Pasang trigger 15 menit', 'pasangTrigger')
    .addItem('Hapus semua trigger', 'hapusTrigger')
    .addItem('Buka URL dashboard', 'tampilkanUrlDashboard')
    .addToUi();
}

function pasangTrigger() {
  hapusTrigger();
  ScriptApp.newTrigger('prosesInbox').timeBased().everyMinutes(15).create();
  SpreadsheetApp.getUi().alert('Trigger terpasang: prosesInbox tiap 15 menit.');
}

function hapusTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'prosesInbox') ScriptApp.deleteTrigger(t);
  });
}

function tampilkanUrlDashboard() {
  var url = ScriptApp.getService().getUrl();
  SpreadsheetApp.getUi().alert(url ? 'Dashboard: ' + url : 'Belum di-deploy. Deploy → New deployment → Web app.');
}

// ===================== PEMROSESAN INBOX =====================

function prosesInbox() {
  var cfg = getConfig_();
  var inbox = DriveApp.getFolderById(cfg.INBOX_FOLDER_ID);
  var processed = DriveApp.getFolderById(cfg.PROCESSED_FOLDER_ID);
  var files = inbox.getFilesByType(MimeType.GOOGLE_DOCS);
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;

  try {
    while (files.hasNext()) {
      var file = files.next();
      // Lewati berkas yang masih diedit dalam 3 menit terakhir (orang belum selesai mengisi)
      if (Date.now() - file.getLastUpdated().getTime() < 3 * 60 * 1000) continue;
      if (/template/i.test(file.getName())) continue;
      try {
        var hasil = prosesSatuDokumen_(file, cfg);
        file.moveTo(processed);
        log_(file, hasil.kode, 'OK', hasil.jumlahTemuan + ' temuan');
      } catch (e) {
        log_(file, '', 'GAGAL', String(e && e.message || e));
      }
    }
  } finally {
    lock.releaseLock();
  }
}

function prosesSatuDokumen_(file, cfg) {
  var doc = DocumentApp.openById(file.getId());
  var body = doc.getBody();
  var tables = body.getTables();
  var found = {};
  for (var i = 0; i < tables.length; i++) {
    var t = tables[i];
    if (t.getNumRows() === 0) continue;
    var head = clean_(t.getCell(0, 0).getText()).toUpperCase();
    for (var k in LABEL) {
      if (head.indexOf(LABEL[k]) === 0) found[k] = t;
    }
  }
  if (!found.META || !found.TEMUAN) {
    throw new Error('Tabel METADATA atau TEMUAN tidak ditemukan. Pastikan memakai template.');
  }

  var meta = kvTable_(found.META);
  var ringkasan = found.RINGKASAN ? kvTable_(found.RINGKASAN) : {};
  var refleksi = found.REFLEKSI ? kvTable_(found.REFLEKSI) : {};
  var privat = found.PRIVAT ? kvTable_(found.PRIVAT) : {};

  var jenis = pilih_(meta, 'jenis kegiatan');
  var angkatan = pilih_(meta, 'angkatan');
  var regional = pilih_(meta, 'regional');
  var kode = buatKode_(jenis, angkatan, regional);

  // Nama-nama yang harus disamarkan di kutipan
  var namaPrivat = [];
  Object.keys(privat).forEach(function (k) {
    if (/nama/i.test(k) && privat[k]) namaPrivat.push(privat[k]);
  });

  // ---- Temuan ----
  var temuanRows = [];
  var tt = found.TEMUAN;
  var now = new Date();
  // baris 0 = judul tabel, baris 1 = header kolom, baris 2+ = data
  for (var r = 2; r < tt.getNumRows(); r++) {
    var row = tt.getRow(r);
    if (row.getNumCells() < 5) continue;
    var rq = clean_(row.getCell(0).getText());
    var tema = clean_(row.getCell(1).getText());
    var kutipan = samarkan_(clean_(row.getCell(2).getText()), namaPrivat);
    var makna = samarkan_(clean_(row.getCell(3).getText()), namaPrivat);
    var kd = clean_(row.getCell(4).getText()).toUpperCase();
    if (!tema && !kutipan && !makna) continue;
    temuanRows.push([
      kode + '-' + String(temuanRows.length + 1).padStart(2, '0'),
      kode, jenis, pilih_(meta, 'tanggal'), angkatan, regional,
      pilih_(meta, 'tingkat keterlibatan'), pilih_(meta, 'sikap awal'),
      rq || '', tema, kutipan, makna, kd, now
    ]);
  }

  var ss = SpreadsheetApp.getActive();
  if (temuanRows.length) {
    var shT = ss.getSheetByName('Temuan');
    shT.getRange(shT.getLastRow() + 1, 1, temuanRows.length, temuanRows[0].length).setValues(temuanRows);
  }

  // ---- Dokumen (satu baris per lembar) ----
  var shD = ss.getSheetByName('Dokumen');
  shD.appendRow([
    kode, jenis, pilih_(meta, 'tanggal'), angkatan, regional,
    pilih_(meta, 'tingkat keterlibatan'), pilih_(meta, 'sikap awal'),
    pilih_(meta, 'durasi'), pilih_(meta, 'format data'), pilih_(meta, 'persetujuan'),
    pilih_(meta, 'inisial'), temuanRows.length,
    samarkan_(pilih_(ringkasan, 'tiga hal'), namaPrivat),
    pilih_(ringkasan, 'perasaan dominan'),
    samarkan_(pilih_(ringkasan, 'mengejutkan'), namaPrivat),
    samarkan_(pilih_(ringkasan, 'harus diubah'), namaPrivat),
    pilih_(ringkasan, 'kesediaan'),
    pilih_(ringkasan, 'penilaian struktur'),
    pilih_(ringkasan, 'sikap iuran'),
    now
  ]);

  // ---- Refleksi (internal) ----
  var shR = ss.getSheetByName('Refleksi') || ss.insertSheet('Refleksi');
  if (shR.getLastRow() === 0) shR.appendRow(['Kode dokumen', 'Apa yang mewarnai jawaban', 'Dugaan tema baru', 'Siapa lagi diajak', 'Diproses pada']);
  shR.appendRow([kode, pilih_(refleksi, 'mewarnai'), pilih_(refleksi, 'tema baru'), pilih_(refleksi, 'siapa lagi'), now]);

  // ---- Data privat → spreadsheet steward, lalu kosongkan dari dokumen ----
  if (found.PRIVAT) {
    var priv = SpreadsheetApp.openById(cfg.PRIVATE_SHEET_ID).getSheets()[0];
    priv.appendRow([
      kode, pilih_(privat, 'nama informan'), pilih_(privat, 'kontak'),
      pilih_(privat, 'pewawancara'), pilih_(privat, 'orang kedua'),
      file.getId(), file.getName(), now, ''
    ]);
    var pt = found.PRIVAT;
    for (var pr = 1; pr < pt.getNumRows(); pr++) {
      if (pt.getRow(pr).getNumCells() > 1) pt.getCell(pr, 1).setText('[dihapus — tersimpan di berkas steward]');
    }
    doc.setName(kode + ' — ' + file.getName().replace(/Temuan_/i, ''));
    doc.saveAndClose();
  }

  return { kode: kode, jumlahTemuan: temuanRows.length };
}

// ===================== UTIL =====================

function kvTable_(table) {
  var obj = {};
  for (var r = 1; r < table.getNumRows(); r++) {
    var row = table.getRow(r);
    if (row.getNumCells() < 2) continue;
    var k = clean_(row.getCell(0).getText()).toLowerCase();
    var v = clean_(row.getCell(1).getText());
    if (k) obj[k] = v;
  }
  return obj;
}

// Ambil nilai dari kvTable berdasarkan potongan label (tidak harus persis)
function pilih_(obj, fragment) {
  fragment = fragment.toLowerCase();
  for (var k in obj) {
    if (k.indexOf(fragment) !== -1) return hapusPetunjuk_(obj[k]);
  }
  return '';
}

// Jika pengisi tidak mengubah teks petunjuk (misal "ya / tidak"), anggap kosong
function hapusPetunjuk_(v) {
  if (!v) return '';
  if (/\(pilih/i.test(v) || /^contoh:/i.test(v) || /^YYYY-MM-DD$/i.test(v)) return '';
  // teks petunjuk berbentuk pilihan "a / b / c" yang belum diganti pengisi
  if (/\s\/\s/.test(v) && v.length < 160) return '';
  return v;
}

function clean_(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function samarkan_(text, names) {
  if (!text) return '';
  names.forEach(function (n) {
    n.split(/[\s,]+/).forEach(function (tok) {
      if (tok.length >= 3) {
        text = text.replace(new RegExp('\\b' + escapeRe_(tok) + '\\b', 'gi'), '[nama]');
      }
    });
  });
  return text;
}

function escapeRe_(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function buatKode_(jenis, angkatan, regional) {
  var p = JENIS_PREFIX[(jenis || '').toLowerCase()] || 'X';
  var a = (angkatan || '').replace(/[^0-9\-]/g, '') || '0000';
  var r = REGIONAL_CODE[(regional || '').toLowerCase()] || 'R0';
  var seq = berikutnya_(p);
  return p + '-' + a + '-' + r + '-' + String(seq).padStart(3, '0');
}

function berikutnya_(prefix) {
  var props = PropertiesService.getDocumentProperties();
  var key = 'SEQ_' + prefix;
  var n = Number(props.getProperty(key) || 0) + 1;
  props.setProperty(key, String(n));
  return n;
}

function log_(file, kode, status, msg) {
  SpreadsheetApp.getActive().getSheetByName('Log Proses')
    .appendRow([new Date(), file.getId(), file.getName(), kode, status, msg]);
}

// ===================== WEB APP (DASHBOARD) =====================

function doGet(e) {
  var cfg = getConfig_();
  // Endpoint JSON anonim untuk situs delfolks.org (?format=json)
  if (e && e.parameter && e.parameter.format === 'json') {
    var out = JSON.stringify(getPublicData_(cfg));
    return ContentService.createTextOutput(out).setMimeType(ContentService.MimeType.JSON);
  }
  var t = HtmlService.createTemplateFromFile('Dashboard');
  t.judul = cfg.JUDUL_DASHBOARD || 'Dashboard Studi Del Folks';
  t.tanggalPublikasi = cfg.TANGGAL_PUBLIKASI || '';
  return t.evaluate()
    .setTitle(t.judul)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// Data mentah anonim (tanpa inisial pewawancara, tanpa refleksi) untuk dashboard di situs
function getPublicData_(cfg) {
  var ss = SpreadsheetApp.getActive();
  var dok = sheetToObjects_(ss.getSheetByName('Dokumen')).map(function (d) {
    return {
      kode: d['Kode dokumen'], jenis: d['Jenis kegiatan'], tanggal: d['Tanggal'], angkatan: d['Angkatan'],
      regional: d['Regional'], keterlibatan: d['Keterlibatan'], sikap_awal: d['Sikap awal'],
      perasaan: d['Perasaan dominan'], harus_diubah: d['Satu hal yang harus diubah'],
      kesediaan: d['Kesediaan berperan'], struktur: d['Penilaian struktur'], iuran: d['Sikap iuran']
    };
  });
  var tem = sheetToObjects_(ss.getSheetByName('Temuan')).map(function (t) {
    return {
      id: t['ID temuan'], kode: t['Kode dokumen'], jenis: t['Jenis kegiatan'], angkatan: t['Angkatan'],
      regional: t['Regional'], keterlibatan: t['Keterlibatan'], rq: t['RQ'], tema: t['Tema'],
      kutipan: t['Kutipan (anonim)'], makna: t['Makna / interpretasi'], kode_induk: t['Kode']
    };
  });
  return {
    diperbarui: new Date().toISOString(),
    config: {
      tanggalMulai: cfg.TANGGAL_MULAI instanceof Date ? Utilities.formatDate(cfg.TANGGAL_MULAI, Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(cfg.TANGGAL_MULAI || ''),
      tanggalPublikasi: String(cfg.TANGGAL_PUBLIKASI || ''),
      target: { 'Wawancara': Number(cfg.TARGET_WAWANCARA || 0), 'Del Talks': Number(cfg.TARGET_DELTALKS || 0), 'FGD': Number(cfg.TARGET_FGD || 0), 'Voice note': Number(cfg.TARGET_VOICENOTE || 0) }
    },
    dokumen: dok, temuan: tem
  };
}

function getDashboardData() {
  var ss = SpreadsheetApp.getActive();
  var cfg = getConfig_();
  var temuan = sheetToObjects_(ss.getSheetByName('Temuan'));
  var dokumen = sheetToObjects_(ss.getSheetByName('Dokumen'));

  var target = {
    'Wawancara': Number(cfg.TARGET_WAWANCARA || 0),
    'Del Talks': Number(cfg.TARGET_DELTALKS || 0),
    'FGD': Number(cfg.TARGET_FGD || 0),
    'Voice note': Number(cfg.TARGET_VOICENOTE || 0)
  };

  var perJenis = {};
  var perRegional = {};
  var perKelompok = {};   // regional x keterlibatan
  var perMinggu = {};
  var mulai = cfg.TANGGAL_MULAI ? new Date(cfg.TANGGAL_MULAI) : null;

  dokumen.forEach(function (d) {
    var j = d['Jenis kegiatan'] || 'Lainnya';
    perJenis[j] = (perJenis[j] || 0) + 1;
    var r = d['Regional'] || 'Tidak diisi';
    perRegional[r] = (perRegional[r] || 0) + 1;
    var k = r + '|' + (d['Keterlibatan'] || '?');
    perKelompok[k] = (perKelompok[k] || 0) + 1;
    if (mulai && d['Tanggal']) {
      var dt = new Date(d['Tanggal']);
      if (!isNaN(dt)) {
        var w = Math.max(1, Math.floor((dt - mulai) / (7 * 864e5)) + 1);
        perMinggu[w] = (perMinggu[w] || 0) + 1;
      }
    }
  });

  var perRQ = {};
  var perKode = {};
  var temaCount = {};
  temuan.forEach(function (t) {
    var rq = t['RQ'] || '?';
    perRQ[rq] = (perRQ[rq] || 0) + 1;
    var kd = (t['Kode'] || '').split(/[\s:]+/)[0] || '?';
    perKode[kd] = (perKode[kd] || 0) + 1;
    var tema = (t['Tema'] || '').toLowerCase();
    if (tema) temaCount[tema] = (temaCount[tema] || 0) + 1;
  });

  var hitung = function (field) {
    var o = {};
    dokumen.forEach(function (d) { var v = d[field]; if (v) o[v] = (o[v] || 0) + 1; });
    return o;
  };

  var terbaru = temuan.slice(-40).reverse().map(function (t) {
    return {
      id: t['ID temuan'], jenis: t['Jenis kegiatan'], angkatan: t['Angkatan'], regional: t['Regional'],
      keterlibatan: t['Keterlibatan'], rq: t['RQ'], tema: t['Tema'], kutipan: t['Kutipan (anonim)'],
      makna: t['Makna / interpretasi'], kode: t['Kode']
    };
  });

  var topTema = Object.keys(temaCount).map(function (k) { return [k, temaCount[k]]; })
    .sort(function (a, b) { return b[1] - a[1]; }).slice(0, 15);

  return {
    diperbarui: new Date().toISOString(),
    totalDokumen: dokumen.length,
    totalTemuan: temuan.length,
    totalSuara: dokumen.reduce(function (s, d) { return s + ((d['Jenis kegiatan'] === 'Del Talks') ? 2 : 1); }, 0),
    target: target, perJenis: perJenis, perRegional: perRegional, perKelompok: perKelompok,
    perMinggu: perMinggu, perRQ: perRQ, perKode: perKode, topTema: topTema,
    perasaan: hitung('Perasaan dominan'), struktur: hitung('Penilaian struktur'),
    iuran: hitung('Sikap iuran'), kesediaan: hitung('Kesediaan berperan'),
    harusDiubah: dokumen.map(function (d) { return d['Satu hal yang harus diubah']; }).filter(Boolean).slice(-20).reverse(),
    terbaru: terbaru
  };
}

function sheetToObjects_(sh) {
  if (!sh || sh.getLastRow() < 2) return [];
  var vals = sh.getDataRange().getValues();
  var head = vals[0];
  return vals.slice(1).filter(function (r) { return r[0]; }).map(function (r) {
    var o = {};
    head.forEach(function (h, i) {
      var v = r[i];
      if (v instanceof Date) v = Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      o[h] = v;
    });
    return o;
  });
}
