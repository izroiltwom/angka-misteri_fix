// =========================================================
// ANGKA MISTERI — REFACTORED CLEAN ENGINE (FIREBASE RTDB)
// =========================================================

const $ = (id) => document.getElementById(id);

let userId = localStorage.getItem("am_user_id") || "";
let playerName = localStorage.getItem("am_player_name") || "";
let playerNumber = 0; // 1 or 2

let room = {
  code: "",
  mode: "duel",
  digits: 6,
  maxGuesses: 20,
  turnTime: 30
};

let secret = "";
let secretVisible = false;
let hasSubmittedSecret = false;

let myHistory = [];
let opponentHistory = [];

let practiceSecret = "";
let practiceCount = 0;

let currentRoomRef = null;
let currentRoomData = null;
let timerInterval = null;
let currentTurnEndsAt = 0;
let isProcessingGuess = false;


/* =========================================================
   TIMEOUT HELPER
========================================================= */

function withTimeout(promise, ms = 5000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout koneksi Firebase")), ms))
  ]);
}


/* =========================================================
   KONEKSI & PROFIL
========================================================= */

function setupConnection() {
  if (!db) {
    $("connPill").textContent = "● Mode Luring";
    $("connPill").style.color = "var(--danger)";
    return;
  }
  db.ref(".info/connected").on("value", (snap) => {
    if (snap.val() === true) {
      $("connPill").textContent = "● Online";
      $("connPill").style.color = "var(--green)";
    } else {
      $("connPill").textContent = "● Menyambungkan...";
      $("connPill").style.color = "var(--gold)";
    }
  });
}

setupConnection();

function initProfile() {
  if (!userId) {
    userId = String(Math.floor(10000000 + Math.random() * 90000000));
    localStorage.setItem("am_user_id", userId);
  }
  if (playerName) {
    $("name").value = playerName;
  }
  $("loginId").textContent = userId;
}

initProfile();

async function ensureProfile() {
  setMessage("setupMessage", "");
  const nameVal = $("name").value.trim();
  if (!nameVal) {
    setMessage("setupMessage", "Masukkan nama pemain terlebih dahulu.");
    $("name").focus();
    return false;
  }
  playerName = nameVal;
  localStorage.setItem("am_player_name", playerName);

  if (db) {
    db.ref(`users/${userId}`).set({
      id: userId,
      name: playerName,
      updated_at: new Date().toISOString()
    }).catch(() => {});
  }
  return true;
}


/* =========================================================
   NAVIGASI SCREEN
========================================================= */

function showScreen(screenId) {
  ["setupScreen", "waitingScreen", "secretScreen", "gameScreen", "resultScreen"].forEach(id => {
    $(id).classList.add("hidden");
  });
  $(screenId).classList.remove("hidden");
}

function setMessage(id, text) {
  $(id).textContent = text || "";
}

function cleanCode(code) {
  return String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

function makeCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function hasUniqueDigits(value) {
  const text = String(value);
  return new Set(text.split("")).size === text.length;
}

function generateSecret(digits) {
  const nums = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
  for (let i = nums.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [nums[i], nums[j]] = [nums[j], nums[i]];
  }
  return nums.slice(0, digits).join("");
}

function calculateBH(secretStr, guessStr) {
  let betul = 0;
  let hampir = 0;
  for (let i = 0; i < secretStr.length; i++) {
    if (guessStr[i] === secretStr[i]) betul++;
  }
  for (let i = 0; i < guessStr.length; i++) {
    if (guessStr[i] !== secretStr[i] && secretStr.includes(guessStr[i])) hampir++;
  }
  return { betul, hampir };
}


/* =========================================================
   PENGATURAN MODE
========================================================= */

$("mode").addEventListener("change", () => {
  const m = $("mode").value;
  $("duelSetting").classList.toggle("hidden", m !== "duel");
  $("lariSetting").classList.toggle("hidden", m !== "lari");
  $("roomCode").classList.toggle("hidden", m === "latihan");
  $("joinBtn").classList.toggle("hidden", m === "latihan");
});


/* =========================================================
   BUAT ROOM / LATIHAN
========================================================= */

$("createBtn").addEventListener("click", async () => {
  if (!(await ensureProfile())) return;

  const mode = $("mode").value;
  const digits = Number($("digits").value);
  const maxGuesses = Number($("maxGuesses").value);
  const turnTime = Number($("turnTime").value);

  // MODE LATIHAN SOLO
  if (mode === "latihan") {
    practiceSecret = generateSecret(digits);
    practiceCount = 0;
    room = { code: "LATIHAN", mode: "latihan", digits, maxGuesses: 0, turnTime: 0 };
    secret = "";
    secretVisible = false;
    playerNumber = 1;

    $("scoreboard").classList.add("hidden");
    $("secretDisplay").parentElement.classList.add("hidden");
    $("histories").classList.add("practice-history");
    $("opponentHistory").parentElement.classList.add("hidden");
    $("gameRoom").textContent = "SOLO";
    $("gameMode").textContent = "Latihan";

    myHistory = [];
    opponentHistory = [];
    renderHistories();

    $("turnStatus").textContent = "Latihan solo — silakan menebak";
    $("timer").textContent = "Tanpa batas waktu";
    $("guess").placeholder = `Tebak (${digits} digit)`;
    $("guess").value = "";
    $("guessBtn").disabled = false;
    setMessage("guessMessage", "");
    showScreen("gameScreen");
    return;
  }

  if (!db) {
    setMessage("setupMessage", "Firebase belum terhubung.");
    return;
  }

  let code = cleanCode($("roomCode").value);
  if (!code) code = makeCode();

  setMessage("setupMessage", "Membuat room...");

  try {
    const roomRef = db.ref(`rooms/${code}`);
    await withTimeout(roomRef.set({
      code,
      mode,
      digits,
      maxGuesses,
      turnTime,
      status: "waiting",
      created_at: Date.now()
    }), 5000);

    await withTimeout(roomRef.child("player1").set({
      id: userId,
      name: playerName,
      ready: false
    }), 5000);

    playerNumber = 1;
    room = { code, mode, digits, maxGuesses, turnTime };
    hasSubmittedSecret = false;

    $("roomCodeDisplay").textContent = code;
    setMessage("setupMessage", "");
    showScreen("waitingScreen");
    listenToRoom(code);
  } catch (err) {
    console.error(err);
    setMessage("setupMessage", "Gagal membuat room: " + err.message);
  }
});


/* =========================================================
   MASUK ROOM
========================================================= */

$("joinBtn").addEventListener("click", async () => {
  if (!(await ensureProfile())) return;

  if (!db) {
    setMessage("setupMessage", "Firebase belum terhubung.");
    return;
  }

  const code = cleanCode($("roomCode").value);
  if (!code) {
    setMessage("setupMessage", "Masukkan kode room.");
    return;
  }

  setMessage("setupMessage", "Mencari room...");

  try {
    const roomRef = db.ref(`rooms/${code}`);
    const snap = await withTimeout(roomRef.once("value"), 5000);

    if (!snap.exists()) {
      setMessage("setupMessage", "Room tidak ditemukan.");
      return;
    }

    const r = snap.val();
    if (r.player1?.id === userId) {
      setMessage("setupMessage", "Tidak bisa masuk ke room sendiri.");
      return;
    }
    if (r.player2 && r.player2.id !== userId) {
      setMessage("setupMessage", "Room sudah penuh.");
      return;
    }

    playerNumber = 2;
    room = { code: r.code, mode: r.mode, digits: r.digits, maxGuesses: r.maxGuesses, turnTime: r.turnTime };
    hasSubmittedSecret = false;

    await withTimeout(roomRef.child("player2").set({
      id: userId,
      name: playerName,
      ready: false
    }), 5000);

    await withTimeout(roomRef.update({ status: "secret_setup" }), 5000);

    setMessage("setupMessage", "");
    listenToRoom(code);
  } catch (err) {
    console.error(err);
    setMessage("setupMessage", "Gagal masuk room: " + err.message);
  }
});


/* =========================================================
   ROOM LISTENER (REALTIME SYNC)
========================================================= */

function detachRoomListener() {
  if (currentRoomRef) {
    currentRoomRef.off();
    currentRoomRef = null;
  }
}

function listenToRoom(code) {
  detachRoomListener();
  currentRoomRef = db.ref(`rooms/${code}`);

  currentRoomRef.on("value", async (snap) => {
    const r = snap.val();
    if (!r) return;
    currentRoomData = r;

    // 1. Jika kedua pemain sudah mengisi secret, update status ke playing
    if (r.status === "secret_setup" && r.player1?.secret && r.player2?.secret) {
      r.status = "playing";
      currentRoomRef.update({
        status: "playing",
        currentTurn: r.currentTurn || 1,
        turnDeadline: r.turnDeadline || (Date.now() + (r.turnTime || 30) * 1000)
      }).catch(() => {});
    }

    // Update scoreboard points
    let p1Pts = 0, p2Pts = 0;
    if (r.player1?.id) {
      db.ref(`users/${r.player1.id}/points`).once("value").then(s => {
        p1Pts = Number(s.val() || 0);
        updatePlayersMeta(r.player1?.name, p1Pts, r.player2?.name, p2Pts);
      }).catch(() => {});
    }
    if (r.player2?.id) {
      db.ref(`users/${r.player2.id}/points`).once("value").then(s => {
        p2Pts = Number(s.val() || 0);
        updatePlayersMeta(r.player1?.name, p1Pts, r.player2?.name, p2Pts);
      }).catch(() => {});
    }
    updatePlayersMeta(r.player1?.name, p1Pts, r.player2?.name, p2Pts);

    // 2. Routing berdasarkan status
    if (r.status === "waiting") {
      showScreen("waitingScreen");
    }
    else if (r.status === "secret_setup") {
      const mySecret = r[`player${playerNumber}`]?.secret;
      if (!mySecret && !hasSubmittedSecret) {
        if ($("secretScreen").classList.contains("hidden")) {
          showScreen("secretScreen");
          $("secret").value = "";
          $("secret").maxLength = r.digits;
          setMessage("secretMessage", `Masukkan angka rahasia ${r.digits} digit.`);
        }
      } else {
        if (!$("secretScreen").classList.contains("hidden") && hasSubmittedSecret) {
          setMessage("secretMessage", "Angka rahasia tersimpan. Menunggu lawan...");
        }
      }
    }
    else if (r.status === "playing") {
      const inGame = !$("gameScreen").classList.contains("hidden");
      if (!inGame) {
        startGameSession(r.currentTurn || 1);
      }
      processGuesses(r.guesses);

      if (r.mode === "duel") {
        if (r.turnDeadline && Date.now() > r.turnDeadline && r.currentTurn === playerNumber) {
          const nextT = playerNumber === 1 ? 2 : 1;
          currentRoomRef.update({ currentTurn: nextT, turnDeadline: Date.now() + r.turnTime * 1000 });
        }
        updateTurnDisplay(r.currentTurn, r.turnTime, r.turnDeadline);
      } else {
        updateTurnDisplay(1, r.turnTime, null);
      }
    }
    else if (r.status === "finished") {
      stopTimer();
      showResultScreen(r.winner, r);
    }
  });
}


/* =========================================================
   ANGKA RAHASIA & GAMEPLAY
========================================================= */

$("secretBtn").addEventListener("click", async () => {
  const val = $("secret").value.trim();
  if (!/^\d+$/.test(val) || val.length !== room.digits) {
    setMessage("secretMessage", `Harus tepat ${room.digits} digit angka.`);
    return;
  }
  if (!hasUniqueDigits(val)) {
    setMessage("secretMessage", "Setiap digit harus berbeda.");
    return;
  }

  secret = val;
  hasSubmittedSecret = true;

  if (currentRoomRef) {
    try {
      await withTimeout(currentRoomRef.child(`player${playerNumber}`).update({
        secret: val,
        ready: true
      }), 5000);
      setMessage("secretMessage", "Angka rahasia tersimpan. Menunggu lawan...");

      const snap = await currentRoomRef.once("value");
      const r = snap.val();
      if (r && r.player1?.secret && r.player2?.secret) {
        await currentRoomRef.update({
          status: "playing",
          currentTurn: 1,
          turnDeadline: Date.now() + (r.turnTime || 30) * 1000
        });
      }
    } catch (err) {
      setMessage("secretMessage", "Gagal menyimpan: " + err.message);
    }
  }
});

function startGameSession(turn) {
  $("scoreboard").classList.remove("hidden");
  $("secretDisplay").parentElement.classList.remove("hidden");
  $("histories").classList.remove("practice-history");
  $("opponentHistory").parentElement.classList.remove("hidden");
  $("guess").placeholder = `Tebak (${room.digits} digit)`;

  myHistory = [];
  opponentHistory = [];
  renderHistories();

  $("gameRoom").textContent = room.code;
  $("gameMode").textContent = room.mode === "duel" ? "Duel" : "Lari";
  $("secretDisplay").textContent = secretVisible ? secret : "•".repeat(room.digits);
  $("guess").value = "";
  setMessage("guessMessage", "");

  showScreen("gameScreen");
  updateTurnDisplay(turn, room.turnTime, null);
}

function updateTurnDisplay(turn, seconds, endsAt) {
  if (room.mode === "lari") {
    $("turnStatus").textContent = "⚡ Silakan menebak!";
    $("guessBtn").disabled = false;
    stopTimer();
    $("timer").textContent = "Bebas";
    return;
  }

  if (turn === playerNumber) {
    $("turnStatus").textContent = "🎯 Giliran Anda";
    $("guessBtn").disabled = false;
  } else {
    $("turnStatus").textContent = "⏳ Giliran Lawan";
    $("guessBtn").disabled = true;
  }

  currentTurnEndsAt = endsAt ? Number(endsAt) : (Date.now() + Number(seconds || room.turnTime) * 1000);
  startTimer(currentTurnEndsAt);
}

function startTimer(endsAt) {
  stopTimer();
  function tick() {
    const rem = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
    $("timer").textContent = `${rem} dtk`;
    if (rem <= 0) stopTimer();
  }
  tick();
  timerInterval = setInterval(tick, 100);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}


/* =========================================================
   TEBAKAN
========================================================= */

$("guessForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (isProcessingGuess) return;

  const val = $("guess").value.trim();
  if (!/^\d+$/.test(val) || val.length !== room.digits || !hasUniqueDigits(val)) {
    setMessage("guessMessage", `Masukkan ${room.digits} digit unik.`);
    return;
  }

  if (room.mode === "latihan") {
    practiceCount++;
    const res = calculateBH(practiceSecret, val);
    addHistoryItem("my", val, res.betul, res.hampir, practiceCount);
    $("guess").value = "";
    if (res.betul === room.digits) {
      setMessage("guessMessage", "🎉 Benar! Anda menang.");
      $("guessBtn").disabled = true;
      $("turnStatus").textContent = "Selesai!";
    } else {
      setMessage("guessMessage", "Coba lagi!");
    }
    return;
  }

  if (!currentRoomRef || !currentRoomData) return;
  const oppNum = playerNumber === 1 ? 2 : 1;
  const oppSecret = currentRoomData[`player${oppNum}`]?.secret;
  if (!oppSecret) {
    setMessage("guessMessage", "Menunggu rahasia lawan...");
    return;
  }

  isProcessingGuess = true;
  try {
    const res = calculateBH(oppSecret, val);
    const count = myHistory.length + 1;
    await currentRoomRef.child(`guesses/player${playerNumber}`).push({
      guess: val,
      betul: res.betul,
      hampir: res.hampir,
      count,
      timestamp: Date.now()
    });

    $("guess").value = "";
    setMessage("guessMessage", "");

    if (res.betul === room.digits) {
      await finishMatch(playerNumber);
    } else if (room.mode === "duel") {
      const nextT = playerNumber === 1 ? 2 : 1;
      await currentRoomRef.update({ currentTurn: nextT, turnDeadline: Date.now() + room.turnTime * 1000 });
    }
  } catch (err) {
    setMessage("guessMessage", "Gagal kirim tebakan.");
  } finally {
    isProcessingGuess = false;
  }
});

function processGuesses(guessesObj = {}) {
  const p1 = Object.values(guessesObj.player1 || {}).sort((a,b) => (b.timestamp||0)-(a.timestamp||0));
  const p2 = Object.values(guessesObj.player2 || {}).sort((a,b) => (b.timestamp||0)-(a.timestamp||0));
  myHistory = (playerNumber === 1 ? p1 : p2).slice(0, 20);
  opponentHistory = (playerNumber === 1 ? p2 : p1).slice(0, 20);
  renderHistories();
}

function addHistoryItem(type, guess, betul, hampir, count) {
  const item = { guess, number: count, betul, hampir };
  if (type === "my") { myHistory.unshift(item); myHistory = myHistory.slice(0, 20); }
  else { opponentHistory.unshift(item); opponentHistory = opponentHistory.slice(0, 20); }
  renderHistories();
}

function renderHistories() {
  $("myHistory").innerHTML = renderList(myHistory);
  $("opponentHistory").innerHTML = renderList(opponentHistory);
}

function renderList(list) {
  if (!list.length) return `<div class="empty-history">Belum ada tebakan</div>`;
  return list.map(i => `
    <div class="history-row">
      <span class="history-number"><b>#${i.number}</b><span>${i.guess}</span></span>
      <strong>${i.betul}B ${i.hampir}H</strong>
    </div>
  `).join("");
}


/* =========================================================
   SKOR & SELESAI
========================================================= */

async function finishMatch(winnerNum) {
  if (!currentRoomRef || !currentRoomData) return;
  const p1Id = currentRoomData.player1?.id;
  const p2Id = currentRoomData.player2?.id;

  if (db && p1Id && p2Id) {
    const r1 = db.ref(`users/${p1Id}`);
    const r2 = db.ref(`users/${p2Id}`);
    const [s1, s2] = await Promise.all([r1.once("value").catch(()=>null), r2.once("value").catch(()=>null)]);
    const d1 = s1?.val() || {};
    const d2 = s2?.val() || {};

    if (winnerNum === 1) {
      r1.update({ points: (d1.points||0)+1, wins: (d1.wins||0)+1, games: (d1.games||0)+1 }).catch(()=>{});
      r2.update({ points: (d2.points||0)+0, losses: (d2.losses||0)+1, games: (d2.games||0)+1 }).catch(()=>{});
    } else if (winnerNum === 2) {
      r1.update({ points: (d1.points||0)+0, losses: (d1.losses||0)+1, games: (d1.games||0)+1 }).catch(()=>{});
      r2.update({ points: (d2.points||0)+1, wins: (d2.wins||0)+1, games: (d2.games||0)+1 }).catch(()=>{});
    }
  }

  await currentRoomRef.update({
    status: "finished",
    winner: winnerNum,
    secrets: {
      player1: currentRoomData.player1?.secret || "-",
      player2: currentRoomData.player2?.secret || "-"
    }
  }).catch(()=>{});
}

function updatePlayersMeta(p1Name, p1Pts, p2Name, p2Pts) {
  $("player1Name").textContent = p1Name || "Pemain A";
  $("player2Name").textContent = p2Name || "Menunggu...";
  $("player1Points").textContent = p1Pts;
  $("player2Points").textContent = p2Pts;
  $("playerCard1").classList.toggle("active", playerNumber === 1);
  $("playerCard2").classList.toggle("active", playerNumber === 2);
}

function showResultScreen(winner, r) {
  stopTimer();
  showScreen("resultScreen");
  const p1N = r.player1?.name || "Pemain A";
  const p2N = r.player2?.name || "Pemain B";
  $("resultPlayer1Label").textContent = p1N;
  $("resultPlayer2Label").textContent = p2N;
  $("resultSecret1").textContent = r.secrets?.player1 || "-";
  $("resultSecret2").textContent = r.secrets?.player2 || "-";

  $("resultScoreline").innerHTML = `
    <div><span>${p1N}</span><strong>${r.winner === 1 ? "Menang" : "Kalah"}</strong></div>
    <div><span>${p2N}</span><strong>${r.winner === 2 ? "Menang" : "Kalah"}</strong></div>
  `;

  if (winner === playerNumber) {
    $("resultIcon").textContent = "🏆";
    $("resultTitle").textContent = "Anda Menang!";
    $("resultMessage").textContent = "Hebat! Tebakanmu lebih akurat.";
  } else {
    $("resultIcon").textContent = "😿";
    $("resultTitle").textContent = "Anda Kalah";
    $("resultMessage").textContent = "Lawan lebih dulu menebak angka rahasiamu.";
  }
}


/* =========================================================
   TOMBOL KELUAR / RESET
========================================================= */

$("showSecretBtn").addEventListener("click", () => {
  secretVisible = !secretVisible;
  $("secretDisplay").textContent = secretVisible ? secret : "•".repeat(room.digits);
  $("showSecretBtn").textContent = secretVisible ? "Sembunyikan" : "Tampilkan";
});

$("leaveBtn").addEventListener("click", resetApp);
$("backBtn").addEventListener("click", resetApp);
$("cancelBtn").addEventListener("click", resetApp);

function resetApp() {
  detachRoomListener();
  stopTimer();
  playerNumber = 0;
  room = { code: "", mode: "duel", digits: 6, maxGuesses: 20, turnTime: 30 };
  secret = "";
  secretVisible = false;
  hasSubmittedSecret = false;
  myHistory = [];
  opponentHistory = [];
  $("roomCode").value = "";
  $("secret").value = "";
  $("guess").value = "";
  showScreen("setupScreen");
}

showScreen("setupScreen");
renderHistories();
