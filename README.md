# Pencerapan Guru

App untuk isi borang pencerapan PdPc (SKPMg2 Standard 4) terus di iPad, kemudian simpan sebagai fail Excel ikut templat asal.

- Tick perkara yang dilihat, dan skor 0 hingga 4 dikira sendiri ikut peraturan borang. Skor masih boleh ditukar manual.
- Semua data disimpan dalam iPad sahaja. Tiada apa dihantar ke internet.
- Boleh dibuka tanpa internet selepas ditambah ke Skrin Utama.
- Simpan Excel → Kongsi → Drive untuk masukkan fail ke folder guru.

## Cara pasang di iPad

1. Buka alamat app dalam **Safari** (bukan Chrome).
2. Tekan butang Kongsi ⬆︎, kemudian pilih **Tambah ke Skrin Utama**.
3. Buka app daripada ikon di Skrin Utama, bukan dari Safari. Data hanya kekal dalam app di Skrin Utama.

## Kemas kini app

Jika fail app diubah, tukar nombor `CACHE` dalam `sw.js` (contoh `pencerapan-v2`) supaya iPad ambil versi baharu.
Jika templat Excel berubah, gantikan `template.xlsx` dan jana semula `data.js` (dari folder utama):

```
python tools/gen_data.py "borang pencerapan latest tempete.xlsx" app/data.js
```
