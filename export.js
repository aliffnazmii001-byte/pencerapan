'use strict';

// Isi templat Excel asal (borang pencerapan) dengan skor daripada app.
// Fail diubah terus pada XML supaya format, warna dan formula asal kekal.

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';

let templateBuf = null;

async function loadTemplate() {
  if (!templateBuf) {
    const res = await fetch('template.xlsx');
    if (!res.ok) throw new Error('templat Excel tidak dijumpai');
    templateBuf = await res.arrayBuffer();
  }
  return templateBuf;
}

function colNum(col) {
  let n = 0;
  for (const ch of col) n = n * 26 + ch.charCodeAt(0) - 64;
  return n;
}

function splitRef(ref) {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  return [m[1], +m[2]];
}

function parseXml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('fail templat rosak');
  return doc;
}

// Sesetengah browser sudah letak deklarasi XML sendiri, sesetengah tidak; pastikan ada tepat satu
const serialize = doc => XML_DECL + new XMLSerializer().serializeToString(doc).replace(/^<\?xml[^>]*\?>\s*/, '');

class SheetXml {
  constructor(text) {
    this.doc = parseXml(text);
    this.data = this.doc.getElementsByTagNameNS(NS, 'sheetData')[0];
    this.rows = new Map();
    for (const r of this.data.children) this.rows.set(+r.getAttribute('r'), r);
  }

  el(name) { return this.doc.createElementNS(NS, name); }

  row(n) {
    let r = this.rows.get(n);
    if (r) return r;
    r = this.el('row');
    r.setAttribute('r', n);
    const after = [...this.rows.keys()].filter(k => k > n).sort((a, b) => a - b)[0];
    this.data.insertBefore(r, after != null ? this.rows.get(after) : null);
    this.rows.set(n, r);
    return r;
  }

  cell(ref) {
    const [col, n] = splitRef(ref);
    const row = this.row(n);
    let before = null;
    for (const c of row.children) {
      const [cc] = splitRef(c.getAttribute('r'));
      if (cc === col) return c;
      if (colNum(cc) > colNum(col)) { before = c; break; }
    }
    const c = this.el('c');
    c.setAttribute('r', ref);
    row.insertBefore(c, before);
    return c;
  }

  strip(c, keepFormula) {
    for (const k of [...c.children]) if (!(keepFormula && k.localName === 'f')) c.removeChild(k);
    c.removeAttribute('t');
    return c;
  }

  clear(ref) { this.strip(this.cell(ref), true); }

  num(ref, n) {
    const c = this.strip(this.cell(ref), false);
    const v = this.el('v');
    v.textContent = String(n);
    c.appendChild(v);
  }

  str(ref, text) {
    const c = this.strip(this.cell(ref), false);
    c.setAttribute('t', 'inlineStr');
    const is = this.el('is');
    const t = this.el('t');
    t.setAttributeNS(XML_NS, 'xml:space', 'preserve');
    t.textContent = text;
    is.appendChild(t);
    c.appendChild(is);
  }

  // Nilai formula yang dikira oleh app, supaya fail terus betul walaupun dibuka tanpa kira semula
  // (contoh: pratonton di iPad atau Google Drive). Beri `formula` untuk tambah formula baharu.
  cached(ref, value, formula) {
    const c = this.cell(ref);
    if (formula != null) {
      this.strip(c, false);
      const f = this.el('f');
      f.textContent = formula;
      c.appendChild(f);
    } else {
      this.strip(c, true);
    }
    if (typeof value === 'string') c.setAttribute('t', 'str');
    const v = this.el('v');
    v.textContent = String(value);
    c.appendChild(v);
  }

  style(ref, s) { this.cell(ref).setAttribute('s', s); }

  rowHeight(n, ht) {
    const r = this.row(n);
    r.setAttribute('ht', ht);
    r.setAttribute('customHeight', '1');
  }

  merge(range) {
    let mc = this.doc.getElementsByTagNameNS(NS, 'mergeCells')[0];
    if (!mc) {
      mc = this.el('mergeCells');
      this.data.parentNode.insertBefore(mc, this.data.nextSibling);
    }
    const m = this.el('mergeCell');
    m.setAttribute('ref', range);
    mc.appendChild(m);
    mc.setAttribute('count', mc.children.length);
  }

  toString() { return serialize(this.doc); }
}

// Gaya baharu: teks berbalut, rata atas (untuk ulasan dan catatan)
async function addWrapStyle(zip) {
  const doc = parseXml(await zip.file('xl/styles.xml').async('string'));
  const xfs = doc.getElementsByTagNameNS(NS, 'cellXfs')[0];
  const xf = xfs.children[0].cloneNode(true);
  for (const al of [...xf.getElementsByTagNameNS(NS, 'alignment')]) xf.removeChild(al);
  const al = doc.createElementNS(NS, 'alignment');
  al.setAttribute('vertical', 'top');
  al.setAttribute('wrapText', '1');
  xf.insertBefore(al, xf.firstChild);
  xf.setAttribute('applyAlignment', '1');
  xfs.appendChild(xf);
  xfs.setAttribute('count', xfs.children.length);
  zip.file('xl/styles.xml', serialize(doc));
  return String(xfs.children.length - 1);
}

// Anggaran bilangan baris untuk teks dalam ruang D:Q di helaian Rumusan
function lineCount(text, perLine = 150) {
  return text.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length / perLine)), 0);
}

async function buildExcel(rec) {
  const zip = await JSZip.loadAsync(await loadTemplate());
  const sum = summarize(rec);
  const info = rec.info;

  for (const x of sum.aspects) {
    const a = x.a;
    const path = `xl/worksheets/${a.sheetFile}`;
    const sh = new SheetXml(await zip.file(path).async('string'));
    const freq = { 4: 0, 3: 0, 2: 0, 1: 0, 0: 0 };

    a.items.forEach((it, k) => {
      const score = x.scores[k];
      for (const s of SCORES) sh.clear(a.cols[s] + it.scoreRow); // buang markah lama
      if (score != null) {
        sh.num(a.cols[score] + it.scoreRow, 1);
        freq[score]++;
      }
      sh.cached(a.checkCol + it.scoreRow, score != null ? '' : 0);
    });
    for (const s of SCORES) {
      sh.cached(a.cols[s] + a.freqRow, freq[s]);
      sh.cached(a.cols[s] + a.skorRow, freq[s] * s);
    }
    // Jumlah skor aspek. Templat asal tiada formula di sini untuk 4.5.1, jadi tambah jika perlu.
    const totalRef = `D${a.totalRow}`;
    const hasFormula = sh.cell(totalRef).getElementsByTagNameNS(NS, 'f').length > 0;
    const formula = hasFormula ? null
      : `IF(${a.checkCol}${a.totalRow}="X","X",SUM(D${a.skorRow}:${a.cols[0]}${a.skorRow}))`;
    sh.cached(totalRef, x.sum, formula);
    sh.cached(a.checkCol + a.totalRow, 1);

    if (a === ASPECTS[0]) {
      // C5 (No. KP) sengaja dibiarkan kosong: app tidak menyimpan No. KP
      const vals = { C4: info.nama, C5: '', C6: info.jenis, C7: dmy(info.tarikh), C8: info.subjek, C9: info.kelas };
      for (const [ref, v] of Object.entries(vals)) {
        if (v) sh.str(ref, v.trim());
        else sh.clear(ref);
      }
    }
    zip.file(path, sh.toString());
  }

  // ---- helaian Rumusan ----
  const rpath = 'xl/worksheets/sheet9.xml';
  const rs = new SheetXml(await zip.file(rpath).async('string'));
  // Maklumat guru disalin dari 4.1.1; sel kosong dipaparkan kosong, bukan 0
  const infoCells = [['C', 'C4', info.nama], ['D', 'C5', ''], ['E', 'C6', info.jenis],
    ['F', 'C7', dmy(info.tarikh)], ['G', 'C8', info.subjek], ['H', 'C9', info.kelas]];
  for (const [col, src, v] of infoCells) {
    rs.cached(`${col}3`, v ? v.trim() : '', `IF('4.1.1'!${src}="","",'4.1.1'!${src})`);
  }
  sum.aspects.forEach((x, k) => rs.cached(`${String.fromCharCode(73 + k)}3`, x.weighted)); // I3..P3
  rs.cached('Q3', sum.total);
  rs.cached('D5', `JUMLAH SKOR :  ${sum.total.toFixed(2)}`, '"JUMLAH SKOR :  "&TEXT(Q3,"0.00")');

  const wrap = await addWrapStyle(zip);
  const ulasan = rec.ulasan.trim();
  if (ulasan) {
    rs.str('D8', ulasan);
    rs.style('D8', wrap);
    rs.merge('D8:Q15');
    const ht = Math.max(15, Math.ceil(lineCount(ulasan) * 15 / 8));
    for (let r = 8; r <= 15; r++) rs.rowHeight(r, ht);
  }
  rs.str('D16', `Nama Pemantau  : ${rec.pemantau.nama || ''}`);
  rs.str('D17', `Jawatan                  : ${rec.pemantau.jawatan || ''}`);

  const notes = collectNotes(rec);
  if (notes.length) {
    rs.str('D19', 'CATATAN PENCERAPAN');
    rs.style('D19', '49');
    notes.forEach((n, k) => {
      const r = 20 + k;
      const text = `${n.label}: ${n.note}`;
      rs.str(`D${r}`, text);
      rs.style(`D${r}`, wrap);
      rs.merge(`D${r}:Q${r}`);
      rs.rowHeight(r, Math.max(15.75, lineCount(text) * 15));
    });
  }
  zip.file(rpath, rs.toString());

  // Excel kira semula semua formula bila fail dibuka; buang calcChain lama
  let wb = await zip.file('xl/workbook.xml').async('string');
  wb = wb.replace(/<calcPr([^>]*?)\/>/, (m, attrs) => (attrs.includes('fullCalcOnLoad') ? m : `<calcPr${attrs} fullCalcOnLoad="1"/>`));
  zip.file('xl/workbook.xml', wb);
  if (zip.file('xl/calcChain.xml')) {
    zip.remove('xl/calcChain.xml');
    const rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
    zip.file('xl/_rels/workbook.xml.rels', rels.replace(/<Relationship [^>]*Target="calcChain\.xml"[^>]*\/>/, ''));
    const ct = await zip.file('[Content_Types].xml').async('string');
    zip.file('[Content_Types].xml', ct.replace(/<Override PartName="\/xl\/calcChain\.xml"[^>]*\/>/, ''));
  }

  return zip.generateAsync({ type: 'blob', mimeType: XLSX_MIME, compression: 'DEFLATE' });
}

/* ---------- laporan untuk cetak / PDF ---------- */

function perkaraCell(a, it, st, score) {
  if (score == null) return '<span class="pr-p no">Belum dinilai</span>';
  const offset = a.type === 'C' ? 1 : 0;
  const out = [];
  if (a.type === 'C') {
    const band = st.band == null ? '–' : st.band === 4 ? 'tiada' : it.bands[st.band];
    out.push(`<span class="pr-p">(i) Pelibatan murid: ${esc(band)}</span>`);
  }
  it.perkara.slice(offset).forEach((p, k) => {
    const on = st.t[k];
    out.push(`<span class="pr-p ${on ? '' : 'no'}">${on ? '✓' : '✗'} (${ROMAN[k + offset]}) ${esc(p)}</span>`);
  });
  if (st.ov != null) out.push('<span class="pr-p">(skor ditetapkan oleh pemantau)</span>');
  return out.join('');
}

function printHTML(rec) {
  const s = summarize(rec);
  const i = rec.info;
  const sumRows = s.aspects.map(x => `<tr><td>${x.a.code} ${esc(x.a.title)}</td><td class="n">${x.sum} / ${x.a.max}</td>
    <td class="n">${Math.round(x.a.weight * 100)}%</td><td class="n">${fmt(x.weighted)}</td></tr>`).join('');
  const aspects = s.aspects.map(x => `<section class="pr-asp">
    <h2><span>${x.a.code} ${esc(x.a.title)}</span><span>${x.sum} / ${x.a.max}</span></h2>
    <table class="pr-items"><thead><tr><th style="width:38%">Item</th><th>Perkara</th><th class="n">Skor</th></tr></thead><tbody>
    ${x.a.items.map((it, k) => {
      const st = getItem(rec, x.a, it);
      const sc = x.scores[k];
      return `<tr><td>${it.key}) ${esc(it.text)}</td><td>${perkaraCell(x.a, it, st, sc)}</td><td class="n"><b>${sc ?? '–'}</b></td></tr>
        ${st.note.trim() ? `<tr class="pr-note"><td colspan="3">Catatan: ${esc(st.note.trim())}</td></tr>` : ''}`;
    }).join('')}
    </tbody></table></section>`).join('');

  return `<div class="pr">
    <header class="pr-head">
      <div><h1>Laporan Pencerapan PdPc</h1><p>${esc(BORANG.header.standard)}</p></div>
      <div class="pr-total"><small>Jumlah skor</small><b>${fmt(s.total)}</b></div>
    </header>
    <table class="pr-info">
      <tr><th>Nama guru</th><td colspan="3">${esc(i.nama)}</td></tr>
      <tr><th>Mata pelajaran</th><td>${esc(i.subjek)}</td><th>Kelas</th><td>${esc(i.kelas)}</td></tr>
      <tr><th>Jenis penilaian</th><td>${esc(i.jenis)}</td><th>Tarikh</th><td>${esc(dmy(i.tarikh))}</td></tr>
    </table>
    <h2>Rumusan skor</h2>
    <table class="pr-sum">
      <thead><tr><th>Aspek</th><th class="n">Skor</th><th class="n">Wajaran</th><th class="n">Markah</th></tr></thead>
      <tbody>${sumRows}</tbody>
      <tfoot><tr><th>Jumlah skor</th><th class="n">${s.filled}/${TOTAL_ITEMS} item</th><th class="n">100%</th><th class="n">${fmt(s.total)}</th></tr></tfoot>
    </table>
    <section class="pr-asp"><h2>Ulasan dan cadangan penambahbaikan</h2><div class="pr-ulasan">${esc(rec.ulasan.trim()) || '&nbsp;'}</div></section>
    ${aspects}
    <div class="pr-sign">
      <div>Nama pemantau:<br><b>${esc(rec.pemantau.nama)}</b></div>
      <div>Jawatan:<br><b>${esc(rec.pemantau.jawatan)}</b></div>
      <div class="line">Tandatangan</div>
    </div>
  </div>`;
}
