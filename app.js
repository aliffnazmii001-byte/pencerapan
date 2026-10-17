'use strict';

const ASPECTS = BORANG.aspects;
const TOTAL_ITEMS = ASPECTS.reduce((n, a) => n + a.items.length, 0);
const STORE_KEY = 'pencerapan.v1.records';
const SETTINGS_KEY = 'pencerapan.v1.settings';
const HINT_KEY = 'pencerapan.v1.hideInstallHint';
const ROMAN = ['i', 'ii', 'iii', 'iv'];
const JENIS = ['Kendiri', 'Pencerapan 1', 'Pencerapan 2'];
const SCORES = [4, 3, 2, 1, 0];

/* ---------- storan (dalam iPad sahaja) ---------- */

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    toast('Gagal simpan. Storan iPad mungkin penuh.');
    return false;
  }
}

let records = loadJSON(STORE_KEY, []);
// No. KP tidak disimpan langsung dalam app
for (const r of records) delete r.info.kp;
let settings = loadJSON(SETTINGS_KEY, { nama: '', jawatan: '' });
let current = null; // { rec, sec }
let pending = null;
let pendingTimer = null;

function saveRecords() {
  if (saveJSON(STORE_KEY, records)) flashSaved();
}

function touch(rec) {
  rec.updatedAt = Date.now();
  saveRecords();
}

// taipan (catatan, ulasan) disimpan selepas jari berhenti sekejap
function touchSoon(rec) {
  pending = rec;
  clearTimeout(pendingTimer);
  pendingTimer = setTimeout(flush, 400);
}

function flush() {
  clearTimeout(pendingTimer);
  if (pending) {
    const rec = pending;
    pending = null;
    touch(rec);
  }
}

window.addEventListener('pagehide', flush);
document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });

/* ---------- pengiraan skor ---------- */

function itemKey(a, it) { return `${a.code}:${it.key}`; }

function tickCount(a, it) { return a.type === 'C' ? 3 : it.perkara.length; }

function getItem(rec, a, it) {
  return rec.items[itemKey(a, it)] || { t: Array(tickCount(a, it)).fill(false), band: null, ov: null, note: '' };
}

function ensureItem(rec, a, it) {
  const k = itemKey(a, it);
  if (!rec.items[k]) rec.items[k] = getItem(rec, a, it);
  return rec.items[k];
}

// Skor ikut peraturan dalam borang. null = belum dinilai.
function autoScore(a, st) {
  const n = st.t.filter(Boolean).length;
  if (a.type === 'C') {
    // 4.6.1: band 0 = pelibatan tertinggi ... 3 = terendah, 4 = tiada
    if (st.band == null) return null;
    const level = 4 - st.band;
    const need = { 4: 3, 3: 2, 2: 1, 1: 1 };
    for (let s = level; s >= 1; s--) if (n >= need[s]) return s;
    return 0;
  }
  if (n === 0) return null;
  if (a.type === 'B') return n; // 4 perkara: skor = bilangan perkara
  // 3 perkara: 4 = semua; 3 = (i)+(ii) atau (i)+(iii); 2 = (ii)+(iii); 1 = satu perkara
  if (n === 3) return 4;
  if (n === 2) return st.t[0] ? 3 : 2;
  return 1;
}

function itemScore(a, st) {
  return st.ov != null ? st.ov : autoScore(a, st);
}

function summarize(rec) {
  let total = 0;
  let filled = 0;
  const missing = [];
  const aspects = ASPECTS.map(a => {
    let sum = 0;
    let done = 0;
    const scores = a.items.map(it => {
      const s = itemScore(a, getItem(rec, a, it));
      if (s == null) missing.push({ a, it });
      else { sum += s; done++; }
      return s;
    });
    const weighted = sum / a.max * 100 * a.weight;
    total += weighted;
    filled += done;
    return { a, sum, done, scores, weighted, avg: done ? sum / (done * 4) : null };
  });
  return { aspects, total, filled, missing };
}

/* ---------- utiliti ---------- */

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => n.toFixed(2);
const pct = x => `${Math.round(x * 100)}%`;

function todayISO() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function dmy(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function toast(msg, ms = 2800) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), ms);
}

function flashSaved() {
  const el = document.getElementById('saved');
  if (!el) return;
  el.textContent = 'Disimpan ✓';
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

function isStandalone() {
  return navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
}

function fileName(rec, ext) {
  const i = rec.info;
  const base = ['Pencerapan', i.nama || 'Tanpa nama', i.jenis, dmy(i.tarikh).replace(/\//g, '-')]
    .filter(Boolean).join(' - ').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  return ext ? `${base}.${ext}` : base;
}

/* ---------- navigasi ---------- */

function route() {
  flush();
  const parts = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  if (parts[0] === 'r') {
    const rec = records.find(r => r.id === parts[1]);
    if (rec) return renderEditor(rec, parts[2] || 'info', parts[3]);
  }
  current = null;
  renderHome();
}

function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

window.addEventListener('hashchange', route);

/* ---------- skrin senarai ---------- */

function isEmpty(rec) {
  const i = rec.info;
  return !i.nama && !i.subjek && !i.kelas && !rec.ulasan && Object.keys(rec.items).length === 0;
}

function installHint() {
  let hidden = false;
  try { hidden = !!localStorage.getItem(HINT_KEY); } catch { /* storan disekat */ }
  if (isStandalone() || hidden) return '';
  return `<div class="hint">
    <div><b>Pasang di iPad:</b> buka laman ini dalam Safari, tekan butang Kongsi <b>⬆︎</b>, kemudian pilih <b>Tambah ke Skrin Utama</b>. Lepas tu app boleh dibuka tanpa internet.</div>
    <button class="btn ghost small" data-act="hide-hint">Tutup</button>
  </div>`;
}

function recCard(rec) {
  const s = summarize(rec);
  const i = rec.info;
  const meta = [i.subjek, i.kelas, dmy(i.tarikh)].filter(Boolean).map(esc).join(' · ');
  const status = s.filled === TOTAL_ITEMS
    ? '<span class="tag ok">Lengkap</span>'
    : `<span class="tag warn">Draf · ${s.filled}/${TOTAL_ITEMS} item</span>`;
  const hay = [i.nama, i.subjek, i.kelas, i.jenis].join(' ').toLowerCase();
  return `<button class="rec-card" data-open="${rec.id}" data-hay="${esc(hay)}">
    <div class="rec-main">
      <div class="rec-name">${esc(i.nama) || '<em>Tanpa nama</em>'}</div>
      <div class="rec-meta">${meta || '&nbsp;'}</div>
      <div class="rec-tags">${i.jenis ? `<span class="tag">${esc(i.jenis)}</span>` : ''}${status}${rec.exportedAt ? '<span class="tag">Excel dah disimpan</span>' : ''}</div>
    </div>
    <div class="rec-score"><b>${fmt(s.total)}</b><small>/ 100</small></div>
  </button>`;
}

function renderHome() {
  const before = records.length;
  records = records.filter(r => !isEmpty(r));
  if (records.length !== before) saveRecords();
  const list = [...records].sort((a, b) => b.updatedAt - a.updatedAt);
  document.getElementById('app').innerHTML = `
    <header class="appbar">
      <div class="appbar-title"><h1>Pencerapan Guru</h1><span>${esc(BORANG.header.standard)}</span></div>
      <button class="btn ghost" data-act="settings">Tetapan</button>
    </header>
    <main class="home">
      ${installHint()}
      <button class="btn primary big new-btn" data-act="new"><span class="plus">+</span> Pencerapan baharu</button>
      ${list.length ? `
        <div class="list-head"><h2>Senarai pencerapan</h2><span>${list.length} rekod</span></div>
        ${list.length > 4 ? '<input class="search" type="search" placeholder="Cari nama guru, subjek atau kelas" data-search>' : ''}
        <div class="rec-list">${list.map(recCard).join('')}</div>`
      : '<div class="empty">Belum ada pencerapan.<br>Tekan <b>+ Pencerapan baharu</b> untuk mula.</div>'}
    </main>`;
  window.scrollTo(0, 0);
}

function newRecord() {
  const rec = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    info: { nama: '', jenis: '', tarikh: todayISO(), subjek: '', kelas: '' },
    items: {},
    ulasan: '',
    pemantau: { nama: settings.nama || '', jawatan: settings.jawatan || '' },
  };
  records.push(rec);
  saveRecords();
  go(`#/r/${rec.id}/info`);
}

/* ---------- skrin borang ---------- */

function navHTML(rec, sec) {
  const s = summarize(rec);
  const infoOk = rec.info.nama && rec.info.jenis;
  const aspectBtns = s.aspects.map(x => {
    const state = x.done === x.a.items.length ? 'done' : x.done ? 'partial' : '';
    return `<button class="nav-item ${sec === x.a.code ? 'active' : ''}" data-sec="${x.a.code}">
      <span class="nav-code">${x.a.code}</span><span class="nav-title">${esc(x.a.title)}</span>
      <span class="nav-mini ${state}" data-mini="${x.a.code}">${x.sum}/${x.a.max}</span>
    </button>`;
  }).join('');
  return `<button class="nav-item keep ${sec === 'info' ? 'active' : ''}" data-sec="info">
      <span class="nav-code">${infoOk ? '✓' : '1'}</span><span class="nav-title">Maklumat guru</span></button>
    ${aspectBtns}
    <button class="nav-item keep ${sec === 'rumusan' ? 'active' : ''}" data-sec="rumusan">
      <span class="nav-code">Σ</span><span class="nav-title">Rumusan &amp; simpan</span></button>`;
}

function renderEditor(rec, sec, focusItem) {
  if (sec !== 'info' && sec !== 'rumusan' && !ASPECTS.some(a => a.code === sec)) sec = 'info';
  current = { rec, sec };
  if (rec.lastSec !== sec) { rec.lastSec = sec; saveJSON(STORE_KEY, records); }
  document.getElementById('app').innerHTML = `
    <header class="appbar">
      <button class="btn ghost" data-act="home">‹ Senarai</button>
      <div class="appbar-title"><h1 id="bar-name">${esc(rec.info.nama) || 'Guru baharu'}</h1><span id="saved" class="saved">Disimpan automatik dalam iPad</span></div>
      <div class="total-pill"><small>Jumlah</small><b id="total-val">0.00</b></div>
    </header>
    <div class="layout">
      <nav class="sidenav" id="sidenav">${navHTML(rec, sec)}</nav>
      <main class="content" id="content">${sectionHTML(rec, sec)}</main>
    </div>`;
  measureBar();
  refreshChrome(rec);
  const active = document.querySelector('.sidenav .active');
  if (active) active.scrollIntoView({ block: 'nearest', inline: 'center' });
  const target = focusItem && document.getElementById(`item-${sec}-${focusItem}`);
  if (target) {
    target.scrollIntoView({ block: 'center' });
    target.classList.add('flash');
  } else {
    window.scrollTo(0, 0);
  }
}

function measureBar() {
  const bar = document.querySelector('.appbar');
  if (bar) document.documentElement.style.setProperty('--bar-h', `${bar.offsetHeight}px`);
}
window.addEventListener('resize', measureBar);

function refreshChrome(rec) {
  const s = summarize(rec);
  const tv = document.getElementById('total-val');
  if (tv) tv.textContent = fmt(s.total);
  for (const x of s.aspects) {
    const m = document.querySelector(`[data-mini="${x.a.code}"]`);
    if (!m) continue;
    m.textContent = `${x.sum}/${x.a.max}`;
    m.classList.toggle('done', x.done === x.a.items.length);
    m.classList.toggle('partial', x.done > 0 && x.done < x.a.items.length);
  }
  const head = document.getElementById('asp-score');
  if (head && current) {
    const x = s.aspects.find(y => y.a.code === current.sec);
    if (x) head.textContent = `Skor aspek ${x.sum}/${x.a.max} · ${x.done}/${x.a.items.length} item diisi`;
  }
}

function sectionHTML(rec, sec) {
  if (sec === 'info') return infoHTML(rec);
  if (sec === 'rumusan') return rumusanHTML(rec);
  return aspectHTML(rec, ASPECTS.find(a => a.code === sec));
}

function infoHTML(rec) {
  const i = rec.info;
  const names = [...new Set(records.filter(r => r !== rec && r.info.nama).map(r => r.info.nama))];
  const field = (key, label, extra = '') =>
    `<label class="field"><span>${label}</span><input data-info="${key}" value="${esc(i[key])}" ${extra}></label>`;
  return `
    <div class="sec-head">
      <div class="eyebrow">Langkah 1</div>
      <h2>Maklumat guru</h2>
      <p class="std">Semua maklumat disimpan automatik dalam iPad ini sahaja. Tiada apa dihantar ke internet.</p>
    </div>
    <div class="card form">
      <label class="field wide"><span>Nama guru</span>
        <input data-info="nama" value="${esc(i.nama)}" list="guru-list" autocomplete="off" autocapitalize="words" placeholder="Nama penuh guru"></label>
      <datalist id="guru-list">${names.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
      ${field('subjek', 'Mata pelajaran', 'autocapitalize="words"')}
      ${field('kelas', 'Kelas', 'autocapitalize="characters"')}
      ${field('tarikh', 'Tarikh', 'type="date"')}
      <div class="field"><span>Jenis penilaian</span>
        <div class="seg">${JENIS.map(j => `<button data-jenis="${j}" class="${i.jenis === j ? 'on' : ''}" aria-pressed="${i.jenis === j}">${j}</button>`).join('')}</div>
      </div>
    </div>
    <div class="sec-foot"><span></span><button class="btn primary" data-sec="${ASPECTS[0].code}">Mula menilai: ${ASPECTS[0].code} ›</button></div>`;
}

function aspectHTML(rec, a) {
  const idx = ASPECTS.indexOf(a);
  const prev = idx === 0 ? 'info' : ASPECTS[idx - 1].code;
  const next = idx === ASPECTS.length - 1 ? 'rumusan' : ASPECTS[idx + 1].code;
  const prevLabel = prev === 'info' ? 'Maklumat guru' : prev;
  const nextLabel = next === 'rumusan' ? 'Rumusan' : `Seterusnya: ${next}`;
  return `
    <div class="sec-head">
      <div class="eyebrow">${esc(a.aspek)}</div>
      <h2>${a.code} ${esc(a.title)}</h2>
      <p class="std">${esc(a.standard)}</p>
      <div class="asp-meta"><span id="asp-score"></span><span>Wajaran ${Math.round(a.weight * 100)}%</span></div>
      <details class="rubric"><summary>Panduan skor</summary>
        <ul>${SCORES.map(s => `<li><b class="sc s${s}">${s}</b><span>${esc(a.rubric[s])}</span></li>`).join('')}</ul>
        <p><b>Tindakan:</b> ${esc(a.tindakan)}</p>
      </details>
    </div>
    <p class="leadin">${esc(a.leadin)}</p>
    ${a.items.map(it => itemHTML(rec, a, it)).join('')}
    <div class="sec-foot">
      <button class="btn" data-sec="${prev}">‹ ${prevLabel}</button>
      <button class="btn primary" data-sec="${next}">${nextLabel} ›</button>
    </div>`;
}

function itemHTML(rec, a, it, noteOpen = false) {
  const st = getItem(rec, a, it);
  const auto = autoScore(a, st);
  const score = st.ov != null ? st.ov : auto;
  const offset = a.type === 'C' ? 1 : 0;
  const perkara = it.perkara.slice(offset);
  const badgeLabel = score == null ? 'belum' : st.ov != null ? 'manual' : 'skor';
  const band = a.type !== 'C' ? '' : `
    <div class="band"><div class="band-label">(i) Pelibatan murid</div>
      <div class="seg">${it.bands.map((b, k) => `<button data-band="${k}" class="${st.band === k ? 'on' : ''}" aria-pressed="${st.band === k}">${esc(b)}</button>`).join('')}<button data-band="4" class="${st.band === 4 ? 'on' : ''}" aria-pressed="${st.band === 4}">Tiada</button></div>
    </div>`;
  return `<article class="item" id="item-${a.code}-${it.key}" data-a="${a.code}" data-i="${it.key}">
    <div class="item-head">
      <span class="item-key">${it.key})</span>
      <h3>${esc(it.text)}</h3>
      <div class="badge s${score ?? 'x'}"><b>${score ?? '–'}</b><small>${badgeLabel}</small></div>
    </div>
    ${band}
    <div class="perkara-list">
      ${perkara.map((p, k) => `<button class="perkara ${st.t[k] ? 'on' : ''}" data-tick="${k}" aria-pressed="${!!st.t[k]}">
        <span class="box" aria-hidden="true"></span><span class="roman">(${ROMAN[k + offset]})</span><span class="ptext">${esc(p)}</span></button>`).join('')}
    </div>
    <div class="item-foot">
      <div class="chips"><span class="chips-label">Skor</span>
        ${SCORES.map(s => `<button class="chip s${s} ${score === s ? 'on' : ''}" data-ov="${s}" aria-pressed="${score === s}" aria-label="Skor ${s}">${s}</button>`).join('')}
        ${st.ov != null ? `<button class="link" data-act="reset-ov">Ikut tick${auto != null ? ` (${auto})` : ''}</button>` : ''}
      </div>
      <button class="link" data-act="note">${st.note ? 'Catatan ✎' : '+ Catatan'}</button>
    </div>
    <textarea class="note" data-note rows="2" placeholder="Catatan ringkas: apa yang sepatutnya ada, apa yang diperhati…" ${st.note || noteOpen ? '' : 'hidden'}>${esc(st.note)}</textarea>
  </article>`;
}

function rerenderItem(a, it) {
  const el = document.getElementById(`item-${a.code}-${it.key}`);
  if (!el) return;
  const noteOpen = !el.querySelector('.note').hidden;
  el.outerHTML = itemHTML(current.rec, a, it, noteOpen);
  refreshChrome(current.rec);
}

/* ---------- rumusan ---------- */

function insights(rec) {
  const s = summarize(rec);
  const scored = s.aspects.filter(x => x.done > 0);
  const strengths = [...scored].filter(x => x.avg >= 0.75).sort((x, y) => y.avg - x.avg).slice(0, 3);
  const weak = [...scored].filter(x => x.avg < 0.75).sort((x, y) => x.avg - y.avg).slice(0, 3);
  const lowItems = [];
  for (const x of s.aspects) {
    x.a.items.forEach((it, k) => {
      const sc = x.scores[k];
      if (sc != null && sc <= 2) lowItems.push({ a: x.a, it, score: sc, st: getItem(rec, x.a, it) });
    });
  }
  return { s, strengths, weak, lowItems };
}

function unmetPerkara(a, it, st) {
  const offset = a.type === 'C' ? 1 : 0;
  const out = it.perkara.slice(offset)
    .map((p, k) => (st.t[k] ? null : `(${ROMAN[k + offset]}) ${p}`))
    .filter(Boolean);
  if (a.type === 'C' && st.band != null && st.band !== 0) {
    out.unshift(`(i) pelibatan murid ${st.band === 4 ? 'tiada' : `hanya ${it.bands[st.band]}`}`);
  }
  return out;
}

function collectNotes(rec) {
  const out = [];
  for (const a of ASPECTS) {
    for (const it of a.items) {
      const note = getItem(rec, a, it).note.trim();
      if (note) out.push({ label: `${a.code} (${it.key}) ${it.text}`, short: `${a.code} (${it.key})`, note });
    }
  }
  return out;
}

function draftUlasan(rec) {
  const { strengths, lowItems } = insights(rec);
  const parts = [];
  if (strengths.length) {
    parts.push(`Kekuatan: Guru menunjukkan amalan yang baik dalam ${strengths.map(x => `${x.a.code} (${x.a.title.toLowerCase()})`).join(', ')}.`);
  }
  if (lowItems.length) {
    parts.push('Cadangan penambahbaikan:\n' + lowItems.map(({ a, it, st }) => {
      const unmet = unmetPerkara(a, it, st);
      return `- ${a.code} (${it.key}) ${it.text}.${unmet.length ? ` Belum dipenuhi: ${unmet.join('; ')}.` : ''}`;
    }).join('\n'));
  }
  const notes = collectNotes(rec);
  if (notes.length) parts.push('Catatan pemerhatian:\n' + notes.map(n => `- ${n.short}: ${n.note}`).join('\n'));
  return parts.join('\n\n');
}

function rumusanHTML(rec) {
  const { s, strengths, weak, lowItems } = insights(rec);
  const i = rec.info;
  const infoMissing = [!i.nama && 'nama guru', !i.jenis && 'jenis penilaian', !i.tarikh && 'tarikh'].filter(Boolean);
  const byAspect = new Map();
  for (const m of s.missing) {
    if (!byAspect.has(m.a.code)) byAspect.set(m.a.code, []);
    byAspect.get(m.a.code).push(m.it.key);
  }
  const rows = s.aspects.map(x => `<tr>
      <td><button class="row-btn" data-sec="${x.a.code}"><b>${x.a.code}</b> ${esc(x.a.title)}</button>
        <div class="bar"><i style="width:${(x.sum / x.a.max) * 100}%"></i></div></td>
      <td class="n">${x.sum} / ${x.a.max}<small>${x.done}/${x.a.items.length} item</small></td>
      <td class="n">${Math.round(x.a.weight * 100)}%</td>
      <td class="n"><b>${fmt(x.weighted)}</b></td>
    </tr>`).join('');

  const warnings = (s.missing.length || infoMissing.length) ? `
    <div class="card warn-card">
      <h3>Belum lengkap</h3>
      ${infoMissing.length ? `<p>Maklumat guru: ${infoMissing.join(', ')} belum diisi. <button class="link" data-sec="info">Isi sekarang</button></p>` : ''}
      ${s.missing.length ? `<p>${s.missing.length} item belum diberi skor. Tekan untuk pergi terus:</p>
        <div class="jumps">${[...byAspect].map(([code, keys]) => keys.map(k => `<button class="jump" data-jump="${code}/${k}">${code} (${k})</button>`).join('')).join('')}</div>` : ''}
    </div>` : '';

  const insightCard = s.filled === 0 ? '' : `
    <div class="card insights">
      <h3>Kekuatan</h3>
      ${strengths.length ? `<ul>${strengths.map(x => `<li><b>${x.a.code}</b> ${esc(x.a.title)} (${pct(x.avg)})</li>`).join('')}</ul>` : '<p class="muted">Tiada aspek mencapai 75% lagi.</p>'}
      <h3>Perlu penambahbaikan</h3>
      ${weak.length || lowItems.length ? `<ul>
        ${weak.map(x => `<li><b>${x.a.code}</b> ${esc(x.a.title)} (${pct(x.avg)})</li>`).join('')}
        ${lowItems.map(({ a, it, score }) => `<li>${a.code} (${it.key}) ${esc(it.text)}: skor ${score}</li>`).join('')}
      </ul>` : '<p class="muted">Tiada item dengan skor 2 ke bawah.</p>'}
    </div>`;

  return `
    <div class="sec-head">
      <div class="eyebrow">Langkah akhir</div>
      <h2>Rumusan</h2>
      <p class="std">Semak markah, tulis ulasan, kemudian simpan fail Excel untuk dimasukkan ke Drive guru.</p>
    </div>
    <div class="card">
      <table class="sum-table">
        <thead><tr><th>Aspek</th><th class="n">Skor</th><th class="n">Wajaran</th><th class="n">Markah</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td>Jumlah skor</td><td class="n">${s.filled}/${TOTAL_ITEMS} item</td><td class="n">100%</td><td class="n">${fmt(s.total)}</td></tr></tfoot>
      </table>
    </div>
    ${warnings}
    ${insightCard}
    <div class="card">
      <div class="row-head"><h3>Ulasan dan cadangan penambahbaikan</h3>
        <button class="btn small" data-act="draft">Isi draf automatik</button></div>
      <div class="field"><textarea id="ulasan" placeholder="Tulis ulasan, atau tekan 'Isi draf automatik' untuk mula daripada skor dan catatan.">${esc(rec.ulasan)}</textarea></div>
    </div>
    <div class="card form">
      <label class="field"><span>Nama pemantau</span><input data-pemantau="nama" value="${esc(rec.pemantau.nama)}" autocapitalize="words"></label>
      <label class="field"><span>Jawatan</span><input data-pemantau="jawatan" value="${esc(rec.pemantau.jawatan)}" autocapitalize="words"></label>
    </div>
    <div class="actions">
      <button class="btn primary big" data-act="excel">Simpan Excel (untuk Drive)</button>
      <button class="btn big" data-act="print">Cetak / PDF</button>
    </div>
    <div class="sec-foot">
      <button class="btn" data-sec="${ASPECTS[ASPECTS.length - 1].code}">‹ ${ASPECTS[ASPECTS.length - 1].code}</button>
      <button class="btn danger" data-act="delete">Padam pencerapan ini</button>
    </div>`;
}

/* ---------- dialog ---------- */

const dlg = () => document.getElementById('dlg');
let exportFile = null;

function openSettings() {
  const d = dlg();
  d.innerHTML = `<form class="dlg-body" method="dialog">
    <h3>Tetapan</h3>
    <p class="dlg-tip">Nama dan jawatan pemantau akan diisi automatik untuk setiap pencerapan baharu.</p>
    <label class="field"><span>Nama pemantau</span><input name="nama" value="${esc(settings.nama)}" autocapitalize="words"></label>
    <label class="field"><span>Jawatan</span><input name="jawatan" value="${esc(settings.jawatan)}" autocapitalize="words" placeholder="cth: Guru Besar"></label>
    <div class="dlg-actions">
      <button class="btn primary" value="save">Simpan</button>
      <button class="btn ghost" value="cancel">Batal</button>
    </div>
    <p class="dlg-tip">Semua rekod disimpan dalam iPad ini sahaja (${records.length} rekod). Simpan Excel setiap pencerapan ke Drive sebagai salinan.</p>
  </form>`;
  d.onclose = () => {
    if (d.returnValue !== 'save') return;
    const f = d.querySelector('form');
    settings = { nama: f.nama.value.trim(), jawatan: f.jawatan.value.trim() };
    saveJSON(SETTINGS_KEY, settings);
    toast('Tetapan disimpan');
  };
  d.showModal();
}

async function openExport(rec) {
  flush();
  const d = dlg();
  d.onclose = null;
  const s = summarize(rec);
  const warn = [];
  if (!rec.info.nama) warn.push('Nama guru belum diisi.');
  if (!rec.info.jenis) warn.push('Jenis penilaian belum dipilih.');
  if (s.missing.length) warn.push(`${s.missing.length} item belum diberi skor (akan kosong dalam Excel).`);
  d.innerHTML = `<div class="dlg-body">
    <h3>Simpan fail Excel</h3>
    ${warn.map(w => `<div class="dlg-warn">${w}</div>`).join('')}
    <p id="exp-status">Menyediakan fail…</p>
    <div class="dlg-actions" id="exp-actions"></div>
    <button class="btn ghost" data-act="close-dlg" style="width:100%">Tutup</button>
  </div>`;
  d.showModal();
  try {
    const blob = await buildExcel(rec);
    exportFile = new File([blob], fileName(rec, 'xlsx'), { type: XLSX_MIME });
    const canShare = !!(navigator.canShare && navigator.canShare({ files: [exportFile] }));
    document.getElementById('exp-status').innerHTML = `Fail sedia: <b>${esc(exportFile.name)}</b>`;
    document.getElementById('exp-actions').innerHTML = `
      ${canShare ? '<button class="btn primary big" data-act="share">Kongsi ke Google Drive / Files</button>' : ''}
      <button class="btn ${canShare ? '' : 'primary big'}" data-act="download">Muat turun fail</button>
      ${canShare ? '<p class="dlg-tip">Dalam senarai kongsi, pilih <b>Drive</b>, kemudian pilih folder guru tersebut dan tekan Muat Naik.</p>' : ''}`;
  } catch (err) {
    document.getElementById('exp-status').textContent = `Gagal sediakan fail: ${err.message}`;
  }
}

function markExported() {
  if (current) {
    current.rec.exportedAt = Date.now();
    touch(current.rec);
  }
}

/* ---------- tindakan ---------- */

const actions = {
  home: () => go('#/'),
  new: newRecord,
  settings: openSettings,
  'hide-hint': () => {
    try { localStorage.setItem(HINT_KEY, '1'); } catch { /* abaikan */ }
    renderHome();
  },
  excel: () => openExport(current.rec),
  'close-dlg': () => dlg().close(),
  share: async () => {
    try {
      await navigator.share({ files: [exportFile] });
      markExported();
      toast('Fail dikongsi');
    } catch (err) {
      if (err.name !== 'AbortError') toast(`Tak dapat kongsi: ${err.message}. Cuba "Muat turun fail".`, 4000);
    }
  },
  download: () => {
    const url = URL.createObjectURL(exportFile);
    const a = document.createElement('a');
    a.href = url;
    a.download = exportFile.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    markExported();
  },
  print: () => {
    flush();
    const rec = current.rec;
    document.getElementById('print-root').innerHTML = printHTML(rec);
    const title = document.title;
    document.title = fileName(rec);
    window.addEventListener('afterprint', () => { document.title = title; }, { once: true });
    window.print();
  },
  draft: () => {
    const rec = current.rec;
    const text = draftUlasan(rec);
    if (!text) return toast('Isi skor atau catatan dahulu.');
    if (rec.ulasan.trim() && !confirm('Ulasan sedia ada akan diganti dengan draf automatik. Teruskan?')) return;
    rec.ulasan = text;
    document.getElementById('ulasan').value = text;
    touch(rec);
  },
  delete: () => {
    const rec = current.rec;
    if (!confirm(`Padam pencerapan ${rec.info.nama || 'ini'}? Tindakan ini tidak boleh diundur.`)) return;
    records = records.filter(r => r !== rec);
    saveRecords();
    go('#/');
  },
};

function itemAction(t, itemEl) {
  const rec = current.rec;
  const a = ASPECTS.find(x => x.code === itemEl.dataset.a);
  const it = a.items.find(x => x.key === itemEl.dataset.i);
  if (t.dataset.act === 'note') {
    const ta = itemEl.querySelector('.note');
    ta.hidden = false;
    ta.focus();
    return;
  }
  const st = ensureItem(rec, a, it);
  if (t.dataset.tick != null) {
    const k = +t.dataset.tick;
    st.t[k] = !st.t[k];
    st.ov = null;
  } else if (t.dataset.band != null) {
    const k = +t.dataset.band;
    st.band = st.band === k ? null : k;
    st.ov = null;
  } else if (t.dataset.ov != null) {
    const s = +t.dataset.ov;
    st.ov = st.ov === s || autoScore(a, st) === s ? null : s;
  } else if (t.dataset.act === 'reset-ov') {
    st.ov = null;
  } else {
    return;
  }
  touch(rec);
  rerenderItem(a, it);
}

document.addEventListener('click', e => {
  const t = e.target.closest('button');
  if (!t || t.closest('form[method="dialog"]')) return;
  if (t.dataset.open) {
    const rec = records.find(r => r.id === t.dataset.open);
    return go(`#/r/${t.dataset.open}/${(rec && rec.lastSec) || 'info'}`);
  }
  if (t.dataset.sec && current) return go(`#/r/${current.rec.id}/${t.dataset.sec}`);
  if (t.dataset.jump && current) return go(`#/r/${current.rec.id}/${t.dataset.jump}`);
  if (t.dataset.jenis && current) {
    current.rec.info.jenis = t.dataset.jenis;
    touch(current.rec);
    t.parentElement.querySelectorAll('button').forEach(b => {
      b.classList.toggle('on', b === t);
      b.setAttribute('aria-pressed', b === t);
    });
    document.getElementById('sidenav').innerHTML = navHTML(current.rec, current.sec);
    return;
  }
  const itemEl = t.closest('.item');
  if (itemEl && current) return itemAction(t, itemEl);
  const act = t.dataset.act;
  if (act && actions[act]) actions[act](t, e);
});

document.addEventListener('input', e => {
  const t = e.target;
  if (t.matches('[data-search]')) {
    const q = t.value.trim().toLowerCase();
    document.querySelectorAll('.rec-card').forEach(c => { c.hidden = q && !c.dataset.hay.includes(q); });
    return;
  }
  if (!current) return;
  const rec = current.rec;
  if (t.dataset.info) {
    rec.info[t.dataset.info] = t.value;
    if (t.dataset.info === 'nama') document.getElementById('bar-name').textContent = t.value || 'Guru baharu';
    touchSoon(rec);
  } else if (t.matches('[data-note]')) {
    const itemEl = t.closest('.item');
    const a = ASPECTS.find(x => x.code === itemEl.dataset.a);
    const it = a.items.find(x => x.key === itemEl.dataset.i);
    ensureItem(rec, a, it).note = t.value;
    touchSoon(rec);
  } else if (t.id === 'ulasan') {
    rec.ulasan = t.value;
    touchSoon(rec);
  } else if (t.dataset.pemantau) {
    rec.pemantau[t.dataset.pemantau] = t.value;
    settings[t.dataset.pemantau] = t.value.trim();
    saveJSON(SETTINGS_KEY, settings);
    touchSoon(rec);
  }
});

// pilih nama guru yang pernah dicerap: isi subjek dan kelas yang masih kosong
document.addEventListener('change', e => {
  const t = e.target;
  if (!current || t.dataset.info !== 'nama') return;
  const rec = current.rec;
  const prev = records
    .filter(r => r !== rec && r.info.nama.trim().toLowerCase() === t.value.trim().toLowerCase())
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (!prev) return;
  let changed = false;
  for (const k of ['subjek', 'kelas']) {
    if (!rec.info[k] && prev.info[k]) { rec.info[k] = prev.info[k]; changed = true; }
  }
  if (changed) {
    touch(rec);
    document.querySelectorAll('[data-info]').forEach(inp => { inp.value = rec.info[inp.dataset.info]; });
    toast('Maklumat diisi daripada pencerapan lepas');
  }
});

/* ---------- mula ---------- */

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* app tetap jalan tanpa mod luar talian */ });
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

route();
