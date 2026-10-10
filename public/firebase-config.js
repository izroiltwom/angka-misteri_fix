// =========================================================
// KONFIGURASI FIREBASE REALTIME DATABASE
// =========================================================

const firebaseConfig = window.FIREBASE_CONFIG || {
  apiKey: "AIzaSyDiQi3cvJMeQxoDKjVWmqIsMpRwFrFUnGs",
  authDomain: "angka-misteri-game.firebaseapp.com",
  databaseURL: "https://angka-misteri-game-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "angka-misteri-game",
  storageBucket: "angka-misteri-game.firebasestorage.app",
  messagingSenderId: "24845109898",
  appId: "1:24845109898:web:8f0dc5366edc4f39393b73"
};

// Inisialisasi Firebase jika belum diinisialisasi
if (typeof firebase !== "undefined" && !firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const db = typeof firebase !== "undefined" ? firebase.database() : null;
