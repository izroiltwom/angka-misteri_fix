# Angka Misteri — Standalone Android APK

Proyek ini memakai **Capacitor** sebagai pembungkus aplikasi Android standalone untuk game tebak angka **Angka Misteri**.

## Arsitektur Standalone (Tanpa Server Abasthan)

- **Aset Lokal Luring (Offline UI)**: Seluruh file web (`index.html`, `app.css`, `app.js`, `firebase-config.js`) dikemas langsung di dalam file APK (`webDir: "public"`). Aplikasi terbuka secara instan tanpa memuat halaman web dari server luar.
- **Backend Realtime**: Menggunakan **Firebase Realtime Database** untuk pencocokan room, pertukaran angka rahasia, timer giliran, histori tebakan, dan leaderboard.

## Konfigurasi Firebase

Isi kredensial Firebase Console Anda pada file `public/firebase-config.js`:

```javascript
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "angka-misteri-default-rtdb.firebaseapp.com",
  databaseURL: "https://angka-misteri-default-rtdb.firebaseio.com",
  projectId: "angka-misteri",
  storageBucket: "angka-misteri.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:0000000000000000000000"
};
```

## Cara Build & Jalankan APK

### 1. Install Dependency
```powershell
npm install
```

### 2. Sinkronkan Aset Web ke Proyek Android
```powershell
npx cap sync android
```

### 3. Buka Android Studio
```powershell
npx cap open android
```

### 4. Build APK Debug
Di Android Studio:
`Build` → `Build Bundle(s) / APK(s)` → `Build APK(s)`

Lokasi file APK:
```text
android\app\build\outputs\apk\debug\app-debug.apk
```

## Catatan Penting
- Application ID/Package Name: `com.angkamisteri.game`.
- Identitas pemain (ID 8-digit) tersimpan otomatis di perangkat via `localStorage`.
- Pertandingan multiplayer memerlukan koneksi internet untuk terhubung ke Firebase Realtime Database.
- Skor: menang **1**, seri **0,5**, kalah **0**.
