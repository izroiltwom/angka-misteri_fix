# Angka Misteri — Logika dan Keberuntungan

Game tebak angka multiplayer berbasis Node.js, Express, dan WebSocket.

## Fitur

- Room duel / lari.
- Tebak angka dengan aturan digit unik.
- Histori tebakan pemain dan lawan tetap berdampingan kiri-kanan pada desktop, HP portrait, dan landscape.
- Identitas pemain berbasis ID: nama cukup dibuat satu kali, lalu login berikutnya menggunakan ID yang tersimpan.
- Tidak menggunakan SQL/PostgreSQL. Data pengguna, skor, dan histori hasil pertandingan disimpan di `data/users.json`.
- Skor pertandingan: menang **1**, kalah **0**, seri **0,5**.
- Judul dan branding: **Angka Misteri — Logika dan Keberuntungan**, dengan simbol 🧠 dan 🍀.

## Menjalankan lokal

```bash
npm install
npm start
```

Server menggunakan `PORT` jika tersedia, atau port `3000`.

## Penyimpanan data

File `data/users.json` dibuat otomatis saat server pertama kali berjalan. Karena data disimpan di filesystem, server/container yang filesystem-nya sementara memerlukan disk atau volume persisten agar ID, nama, dan skor tidak hilang setelah restart atau redeploy.

## Deployment

Untuk Docker, aplikasi membuat direktori `/app/data` dan menjalankannya sebagai user `node`. Jika platform deployment mendukung persistent disk/volume, arahkan storage persisten ke `/app/data`.

## Identitas pemain
ID pemain berupa nomor 8 digit yang dibuat otomatis oleh server saat pendaftaran pertama. Browser menyimpan ID tersebut di localStorage sehingga perangkat yang sama dapat login kembali tanpa memasukkan nama. Jangan hapus data situs/browser jika ingin mempertahankan login perangkat tersebut.
