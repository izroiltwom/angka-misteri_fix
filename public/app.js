// =========================================================
// ANGKA MISTERI v1.0.3 — REFACTORED CLEAN ENGINE (FIREBASE RTDB)
// =========================================================

const $ = (id) => document.getElementById(id);

function safeAdd(id, cls) { const el = $(id); if (el) el.classList.add(cls); }
function safeRemove(id, cls) { const el = $(id); if (el) el.classList.remove(cls); }
function safeToggle(id, cls, force) { const el = $(id); if (el) el.classList.toggle(cls, force); }

let userId = localStorage.getItem("am_user_id") || "";
let playerName = localStorage.getItem("am_player_name") || "";
let playerNumber = 0; // 1, 2, or 0 (spectator)
let isSpectator = false;

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
    const pill = $("connPill");
    if (pill) { pill.textContent = "● Mode Luring"; pill.style.color = "var(--danger)"; }
    return;
  }
  db.ref(".info/connected").on("value", (snap) => {
    const pill = $("connPill");
    if (!pill) return;
    if (snap.val() === true) {
      pill.textContent = "● Online";
      pill.style.color = "var(--green)";
    } else {
      pill.textContent = "● Menyambungkan...";
      pill.style.color = "var(--gold)";
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
    const nameInput = $("name");
    if (nameInput) nameInput.value = playerName;
  }
  const loginIdEl = $("loginId");
  if (loginIdEl) loginIdEl.textContent = userId;
}

initProfile();

async function ensureProfile() {
  setMessage("setupMessage", "");
  const nameInput = $("name");
  const nameVal = nameInput ? nameInput.value.trim() : "";
  if (!nameVal) {
    setMessage("setupMessage", "Masukkan nama pemain terlebih dahulu.");
    if (nameInput) nameInput.focus();
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
  console.log("SHOW SCREEN:", screenId);
  ["setupScreen", "waitingScreen", "spectateScreen", "secretScreen", "gameScreen", "resultScreen"].forEach(id => {
    safeAdd(id, "hidden");
  });
  safeRemove(screenId, "hidden");
}

function setMessage(id, text) {
  const el = $(id);
  if (el) el.textContent = text || "";
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

const modeSelect = $("mode");
if (modeSelect) {
  modeSelect.addEventListener("change", () => {
    const m = modeSelect.value;
    safeToggle("duelSetting", "hidden", m !== "duel");
    safeToggle("lariSetting", "hidden", m !== "lari");
    safeToggle("roomCode", "hidden", m === "latihan");
    safeToggle("joinBtn", "hidden", m === "latihan");
  });
}


/* =========================================================
   SPECTATOR MODE (TONTON LIVE)
========================================================= */

const spectateBtn = $("spectateBtn");
if (spectateBtn) {
  spectateBtn.addEventListener("click", async () => {
    if (!db) {
      setMessage("setupMessage", "Firebase belum terhubung.");
      return;
    }
    showScreen("spectateScreen");
    loadActiveMatches();
  });
}

const backFromSpectateBtn = $("backFromSpectateBtn");
if (backFromSpectateBtn) {
  backFromSpectateBtn.addEventListener("click", () => {
    showScreen("setupScreen");
  });
}

async function loadActiveMatches() {
  const container = $("activeMatchesList");
  if (!container) return;
  container.innerHTML = '<p class="field-hint">Memuat daftar pertandingan live...</p>';

  try {
    const snap = await withTimeout(db.ref("rooms").once("value"), 5000);
    const allRooms = snap.val() || {};
    const active = [];

    for (const [code, r] of Object.entries(allRooms)) {
      if (r && (r.status === "playing" || r.status === "secret_setup")) {
        active.push(r);
      }
    }

    // Urutkan pertandingan paling baru di atas
    active.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

    if (!active.length) {
      container.innerHTML = '<p class="field-hint">Belum ada pertandingan aktif saat ini.</p>';
      return;
    }

    container.innerHTML = active.map(r => {
      const p1 = r.player1?.name || "Pemain 1";
      const p2 = r.player2?.name || "Pemain 2";
      const modeText = r.mode === "duel" ? "Duel" : (r.mode === "lari" ? "Lari" : (r.mode === "lawan" ? "Lawan" : "Kawan"));
      return `
        <div class="match-card">
          <div>
            <strong>${p1} vs ${p2}</strong>
            <span>Room: ${r.code} • Mode: ${modeText} (${r.digits} Digit)</span>
          </div>
          <button onclick="watchMatch('${r.code}')">👁️ Tonton</button>
        </div>
      `;
    }).join("");
  } catch (err) {
    container.innerHTML = `<p class="field-hint" style="color: var(--danger);">Gagal memuat: ${err.message}</p>`;
  }
}

window.watchMatch = function(code) {
  isSpectator = true;
  playerNumber = 0;
  listenToRoom(code);
};


/* =========================================================
   PENCARIAN LAWAN OTOMATIS (MATCHMAKING)
========================================================= */

const matchmakeBtn = $("matchmakeBtn");
if (matchmakeBtn) {
  matchmakeBtn.addEventListener("click", async () => {
    if (!(await ensureProfile())) return;

    if (!db) {
      setMessage("setupMessage", "Firebase belum terhubung.");
      return;
    }

    const mode = $("mode") ? $("mode").value : "duel";
    const digits = Number($("digits") ? $("digits").value : 6);
    const maxGuesses = Number($("maxGuesses") ? $("maxGuesses").value : 20);
    const turnTime = Number($("turnTime") ? $("turnTime").value : 30);

    setMessage("setupMessage", "🔍 Mencari lawan otomatis...");

    try {
      const roomsSnap = await withTimeout(db.ref("rooms").once("value"), 5000);
      const allRooms = roomsSnap.val() || {};

      let matchedCode = null;
      for (const [c, r] of Object.entries(allRooms)) {
        if (
          r &&
          r.status === "waiting" &&
          r.mode === mode &&
          Number(r.digits) === digits &&
          Number(r.turnTime || 30) === turnTime &&
          Number(r.maxGuesses || 20) === maxGuesses &&
          r.player1 &&
          r.player1.id !== userId
        ) {
          matchedCode = c;
          break;
        }
      }

      if (matchedCode) {
        // Auto Join!
        setMessage("setupMessage", `Lawan ditemukan! Menghubungkan ke room ${matchedCode}...`);
        const roomRef = db.ref(`rooms/${matchedCode}`);
        const r = allRooms[matchedCode];

        playerNumber = 2;
        room = { code: matchedCode, mode: r.mode, digits: r.digits, maxGuesses: r.maxGuesses, turnTime: r.turnTime };
        hasSubmittedSecret = false;
        isSpectator = false;

        if (r.mode === "lawan" || r.mode === "kawan") {
          await withTimeout(roomRef.child("player2").set({ id: userId, name: playerName, ready: true }), 5000);
          await withTimeout(roomRef.update({ status: "playing", currentTurn: 1, turnDeadline: Date.now() + (r.turnTime || 30) * 1000 }), 5000);
        } else {
          await withTimeout(roomRef.child("player2").set({ id: userId, name: playerName, ready: false }), 5000);
          await withTimeout(roomRef.update({ status: "secret_setup" }), 5000);
        }

        setMessage("setupMessage", "");
        listenToRoom(matchedCode);
      } else {
        // Auto Create new room & wait for incoming match
        const newCode = makeCode();
        const roomRef = db.ref(`rooms/${newCode}`);

        const sharedSecret = (mode === "lawan" || mode === "kawan") ? generateSecret(digits) : null;
        const roomData = {
          code: newCode,
          mode,
          digits,
          maxGuesses,
          turnTime,
          status: "waiting",
          created_at: Date.now()
        };
        if (sharedSecret) roomData.sharedSecret = sharedSecret;

        await withTimeout(roomRef.set(roomData), 5000);
        await withTimeout(roomRef.child("player1").set({ id: userId, name: playerName, ready: true }), 5000);

        playerNumber = 1;
        room = { code: newCode, mode, digits, maxGuesses, turnTime };
        hasSubmittedSecret = false;
        isSpectator = false;

        const roomCodeDisp = $("roomCodeDisplay");
        if (roomCodeDisp) roomCodeDisp.textContent = newCode;
        setMessage("waitingTitle", "Pencarian Lawan Otomatis");
        setMessage("waitingDesc", "Sistem sedang mencari lawan dengan pengaturan yang sama...");

        setMessage("setupMessage", "");
        showScreen("waitingScreen");
        listenToRoom(newCode);
      }
    } catch (err) {
      console.error(err);
      setMessage("setupMessage", "Gagal mencari lawan: " + err.message);
    }
  });
}


/* =========================================================
   BUAT ROOM / LATIHAN
========================================================= */

const createBtn = $("createBtn");
if (createBtn) {
  createBtn.addEventListener("click", async () => {
    if (!(await ensureProfile())) return;

    const mode = $("mode") ? $("mode").value : "duel";
    const digits = Number($("digits") ? $("digits").value : 6);
    const maxGuesses = Number($("maxGuesses") ? $("maxGuesses").value : 20);
    const turnTime = Number($("turnTime") ? $("turnTime").value : 30);

    // MODE LATIHAN SOLO
    if (mode === "latihan") {
      practiceSecret = generateSecret(digits);
      practiceCount = 0;
      room = { code: "LATIHAN", mode: "latihan", digits, maxGuesses: 0, turnTime: 0 };
      secret = "";
      secretVisible = false;
      playerNumber = 1;
      isSpectator = false;

      safeAdd("scoreboard", "hidden");
      const secretDisp = $("secretDisplay");
      if (secretDisp && secretDisp.parentElement) secretDisp.parentElement.classList.add("hidden");
      safeAdd("histories", "practice-history");
      const oppHist = $("opponentHistory");
      if (oppHist && oppHist.parentElement) oppHist.parentElement.classList.add("hidden");

      const gameRoomEl = $("gameRoom");
      if (gameRoomEl) gameRoomEl.textContent = "SOLO";
      const gameModeEl = $("gameMode");
      if (gameModeEl) gameModeEl.textContent = "Latihan";

      myHistory = [];
      opponentHistory = [];
      renderHistories();

      setMessage("turnStatus", "Latihan solo — silakan menebak");
      setMessage("timer", "Tanpa batas waktu");
      const guessInput = $("guess");
      if (guessInput) {
        guessInput.placeholder = `Tebak (${digits} digit)`;
        guessInput.value = "";
      }
      const guessBtn = $("guessBtn");
      if (guessBtn) guessBtn.disabled = false;

      setMessage("guessMessage", "");
      showScreen("gameScreen");
      return;
    }

    if (!db) {
      setMessage("setupMessage", "Firebase belum terhubung.");
      return;
    }

    let code = cleanCode($("roomCode") ? $("roomCode").value : "");
    if (!code) code = makeCode();

    setMessage("setupMessage", "Membuat room...");

    try {
      const roomRef = db.ref(`rooms/${code}`);

      // MODE LAWAN & KAWAN
      if (mode === "lawan" || mode === "kawan") {
        const sharedSecret = generateSecret(digits);
        await withTimeout(roomRef.set({
          code,
          mode,
          digits,
          maxGuesses,
          turnTime,
          status: "waiting",
          sharedSecret,
          created_at: Date.now()
        }), 5000);

        await withTimeout(roomRef.child("player1").set({
          id: userId,
          name: playerName,
          ready: true
        }), 5000);

        playerNumber = 1;
        room = { code, mode, digits, maxGuesses, turnTime };
        isSpectator = false;
        const roomCodeDisp = $("roomCodeDisplay");
        if (roomCodeDisp) roomCodeDisp.textContent = code;
        setMessage("setupMessage", "");
        showScreen("waitingScreen");
        listenToRoom(code);
        return;
      }

      // MODE DUEL & LARI
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
      isSpectator = false;

      const roomCodeDisp = $("roomCodeDisplay");
      if (roomCodeDisp) roomCodeDisp.textContent = code;
      setMessage("setupMessage", "");
      showScreen("waitingScreen");
      listenToRoom(code);
    } catch (err) {
      console.error(err);
      setMessage("setupMessage", "Gagal membuat room: " + err.message);
    }
  });
}


/* =========================================================
   MASUK ROOM
========================================================= */

const joinBtn = $("joinBtn");
if (joinBtn) {
  joinBtn.addEventListener("click", async () => {
    if (!(await ensureProfile())) return;

    if (!db) {
      setMessage("setupMessage", "Firebase belum terhubung.");
      return;
    }

    const code = cleanCode($("roomCode") ? $("roomCode").value : "");
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
      isSpectator = false;

      if (r.mode === "lawan" || r.mode === "kawan") {
        await withTimeout(roomRef.child("player2").set({
          id: userId,
          name: playerName,
          ready: true
        }), 5000);

        await withTimeout(roomRef.update({
          status: "playing",
          currentTurn: 1,
          turnDeadline: Date.now() + (r.turnTime || 30) * 1000
        }), 5000);

        setMessage("setupMessage", "");
        listenToRoom(code);
        return;
      }

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
}


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

    if (r.status === "secret_setup" && r.player1?.secret && r.player2?.secret) {
      r.status = "playing";
      currentRoomRef.update({
        status: "playing",
        currentTurn: r.currentTurn || 1,
        turnDeadline: r.turnDeadline || (Date.now() + (r.turnTime || 30) * 1000)
      }).catch(() => {});
    }

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

    if (r.status === "waiting") {
      if (!isSpectator) showScreen("waitingScreen");
    }
    else if (r.status === "secret_setup") {
      if (isSpectator) {
        setMessage("setupMessage", "Menunggu kedua pemain menyimpan angka rahasia...");
        return;
      }
      const mySecret = r[`player${playerNumber}`]?.secret;
      if (!mySecret && !hasSubmittedSecret) {
        const secretScreenEl = $("secretScreen");
        if (secretScreenEl && secretScreenEl.classList.contains("hidden")) {
          showScreen("secretScreen");
          const secretInput = $("secret");
          if (secretInput) {
            secretInput.value = "";
            secretInput.maxLength = r.digits;
          }
          setMessage("secretMessage", `Masukkan angka rahasia ${r.digits} digit.`);
        }
      } else {
        const secretScreenEl = $("secretScreen");
        if (secretScreenEl && !secretScreenEl.classList.contains("hidden") && hasSubmittedSecret) {
          setMessage("secretMessage", "Angka rahasia tersimpan. Menunggu lawan...");
        }
      }
    }
    else if (r.status === "playing") {
      const gameScreenEl = $("gameScreen");
      const inGame = gameScreenEl && !gameScreenEl.classList.contains("hidden");
      if (!inGame) {
        startGameSession(r.currentTurn || 1);
      }
      processGuesses(r.guesses);

      if (r.mode === "duel" || r.mode === "lawan" || r.mode === "kawan") {
        if (r.turnDeadline && Date.now() > r.turnDeadline && r.currentTurn === playerNumber && !isSpectator) {
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

const secretBtn = $("secretBtn");
if (secretBtn) {
  secretBtn.addEventListener("click", async () => {
    const secretInput = $("secret");
    const val = secretInput ? secretInput.value.trim() : "";
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
}

const forceStartBtn = $("forceStartBtn");
if (forceStartBtn) {
  forceStartBtn.addEventListener("click", async () => {
    if (currentRoomRef) {
      try {
        const snap = await currentRoomRef.once("value");
        const r = snap.val();
        if (r && (r.mode === "lawan" || r.mode === "kawan" || (r.player1?.secret && r.player2?.secret))) {
          await currentRoomRef.update({
            status: "playing",
            currentTurn: 1,
            turnDeadline: Date.now() + (r.turnTime || 30) * 1000
          });
          startGameSession(1);
        } else {
          setMessage("secretMessage", "Menunggu lawan menyimpan angka rahasia...");
        }
      } catch (err) {
        setMessage("secretMessage", "Gagal masuk game: " + err.message);
      }
    }
  });
}

function startGameSession(turn) {
  safeRemove("scoreboard", "hidden");
  const secretDisp = $("secretDisplay");
  if (secretDisp && secretDisp.parentElement) {
    if (isSpectator) {
      secretDisp.parentElement.classList.add("hidden");
    } else {
      secretDisp.parentElement.classList.remove("hidden");
    }
  }

  if (isSpectator) {
    safeAdd("guessForm", "hidden");
    safeRemove("spectatorBadge", "hidden");
  } else {
    safeRemove("guessForm", "hidden");
    safeAdd("spectatorBadge", "hidden");
  }

  safeRemove("histories", "practice-history");
  const oppHist = $("opponentHistory");
  if (oppHist && oppHist.parentElement) oppHist.parentElement.classList.remove("hidden");

  const guessInput = $("guess");
  if (guessInput) guessInput.placeholder = `Tebak (${room.digits} digit)`;

  myHistory = [];
  opponentHistory = [];
  renderHistories();

  const gameRoomEl = $("gameRoom");
  if (gameRoomEl) gameRoomEl.textContent = room.code;
  const gameModeEl = $("gameMode");
  if (gameModeEl) {
    if (room.mode === "lawan") gameModeEl.textContent = "Lawan";
    else if (room.mode === "kawan") gameModeEl.textContent = "Kawan (Tim)";
    else if (room.mode === "duel") gameModeEl.textContent = "Duel";
    else gameModeEl.textContent = "Lari";
  }

  setMessage("historyTitle", "Maksimal Tebakan: " + (room.maxGuesses || 20));

  const yourHeader = document.querySelector(".history-box.yours h3 span");
  const theirHeader = document.querySelector(".history-box.theirs h3 span");
  if (room.mode === "kawan") {
    if (yourHeader) yourHeader.innerHTML = "🧠 Tebakan Anda";
    if (theirHeader) theirHeader.innerHTML = "🤝 Tebakan Kawan";
  } else {
    if (yourHeader) yourHeader.innerHTML = "🧠 Tebakan Anda";
    if (theirHeader) theirHeader.innerHTML = "🍀 Tebakan Lawan";
  }

  if (secretDisp) {
    if (room.mode === "lawan" || room.mode === "kawan") {
      safeAdd("showSecretBtn", "hidden");
      setMessage("secretDisplayLabel", "Angka Rahasia Target Server");
      secretDisp.textContent = "•".repeat(room.digits);
    } else {
      safeRemove("showSecretBtn", "hidden");
      setMessage("secretDisplayLabel", "Angka Rahasia Anda");
      secretDisp.textContent = secretVisible ? secret : "•".repeat(room.digits);
    }
  }

  if (guessInput) guessInput.value = "";
  setMessage("guessMessage", "");

  showScreen("gameScreen");
  updateTurnDisplay(turn, room.turnTime, null);
}

function updateTurnDisplay(turn, seconds, endsAt) {
  if (isSpectator) {
    setMessage("turnStatus", turn === 1 ? "🎯 Giliran Pemain 1" : "🎯 Giliran Pemain 2");
    stopTimer();
    return;
  }

  if (room.mode === "lari" || room.mode === "kawan") {
    setMessage("turnStatus", room.mode === "kawan" ? "🤝 Kerja sama menebak bersama!" : "⚡ Silakan menebak!");
    const guessBtn = $("guessBtn");
    if (guessBtn) guessBtn.disabled = false;
    stopTimer();
    setMessage("timer", "Bebas");
    return;
  }

  if (turn === playerNumber) {
    setMessage("turnStatus", "🎯 Giliran Anda");
    const guessBtn = $("guessBtn");
    if (guessBtn) guessBtn.disabled = false;
  } else {
    setMessage("turnStatus", "⏳ Giliran Lawan");
    const guessBtn = $("guessBtn");
    if (guessBtn) guessBtn.disabled = true;
  }

  currentTurnEndsAt = endsAt ? Number(endsAt) : (Date.now() + Number(seconds || room.turnTime) * 1000);
  startTimer(currentTurnEndsAt);
}

function startTimer(endsAt) {
  stopTimer();
  function tick() {
    const rem = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
    setMessage("timer", `${rem} dtk`);
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

const guessForm = $("guessForm");
if (guessForm) {
  guessForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (isProcessingGuess || isSpectator) return;

    const guessInput = $("guess");
    const val = guessInput ? guessInput.value.trim() : "";
    if (!/^\d+$/.test(val) || val.length !== room.digits || !hasUniqueDigits(val)) {
      setMessage("guessMessage", `Masukkan ${room.digits} digit unik.`);
      return;
    }

    if (room.mode === "latihan") {
      practiceCount++;
      const res = calculateBH(practiceSecret, val);
      addHistoryItem("my", val, res.betul, res.hampir, practiceCount);
      if (guessInput) guessInput.value = "";
      if (res.betul === room.digits) {
        setMessage("guessMessage", "🎉 Benar! Anda menang.");
        const guessBtn = $("guessBtn");
        if (guessBtn) guessBtn.disabled = true;
        setMessage("turnStatus", "Selesai!");
      } else {
        setMessage("guessMessage", "Coba lagi!");
      }
      return;
    }

    if (!currentRoomRef || !currentRoomData) return;

    let targetSecret = "";
    if (room.mode === "lawan" || room.mode === "kawan") {
      targetSecret = currentRoomData.sharedSecret;
    } else {
      const oppNum = playerNumber === 1 ? 2 : 1;
      targetSecret = currentRoomData[`player${oppNum}`]?.secret;
    }

    if (!targetSecret) {
      setMessage("guessMessage", "Menunggu rahasia target...");
      return;
    }

    isProcessingGuess = true;
    try {
      const res = calculateBH(targetSecret, val);
      const count = myHistory.length + 1;
      await currentRoomRef.child(`guesses/player${playerNumber}`).push({
        guess: val,
        betul: res.betul,
        hampir: res.hampir,
        count,
        timestamp: Date.now()
      });

      if (guessInput) guessInput.value = "";
      setMessage("guessMessage", "");

      if (res.betul === room.digits) {
        if (room.mode === "kawan") {
          await finishMatch(3);
        } else {
          await finishMatch(playerNumber);
        }
      } else if (room.mode === "duel" || room.mode === "lawan") {
        const nextT = playerNumber === 1 ? 2 : 1;
        await currentRoomRef.update({ currentTurn: nextT, turnDeadline: Date.now() + room.turnTime * 1000 });
      }
    } catch (err) {
      setMessage("guessMessage", "Gagal kirim tebakan.");
    } finally {
      isProcessingGuess = false;
    }
  });
}

function processGuesses(guessesObj = {}) {
  const p1 = Object.values(guessesObj.player1 || {}).sort((a,b) => (a.timestamp||0)-(b.timestamp||0));
  const p2 = Object.values(guessesObj.player2 || {}).sort((a,b) => (a.timestamp||0)-(b.timestamp||0));

  const mapWithSeq = (arr) => arr.map((item, idx) => ({ ...item, seq: idx + 1 })).reverse().slice(0, 20);

  if (isSpectator) {
    myHistory = mapWithSeq(p1);
    opponentHistory = mapWithSeq(p2);
  } else {
    myHistory = mapWithSeq(playerNumber === 1 ? p1 : p2);
    opponentHistory = mapWithSeq(playerNumber === 1 ? p2 : p1);
  }
  renderHistories();
}

function addHistoryItem(type, guess, betul, hampir, count) {
  const item = { guess, seq: count, betul, hampir };
  if (type === "my") { myHistory.unshift(item); myHistory = myHistory.slice(0, 20); }
  else { opponentHistory.unshift(item); opponentHistory = opponentHistory.slice(0, 20); }
  renderHistories();
}

function renderHistories() {
  const myHistEl = $("myHistory");
  const oppHistEl = $("opponentHistory");
  if (myHistEl) myHistEl.innerHTML = renderList(myHistory);
  if (oppHistEl) oppHistEl.innerHTML = renderList(opponentHistory);
}

function renderList(list) {
  if (!list.length) return `<div class="empty-history">Belum ada tebakan</div>`;
  return list.map(i => `
    <div class="history-row">
      <span class="history-number"><b>#${i.seq || 1}</b><span>${i.guess}</span></span>
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

    if (winnerNum === 3) {
      r1.update({ points: (d1.points||0)+1, wins: (d1.wins||0)+1, games: (d1.games||0)+1 }).catch(()=>{});
      r2.update({ points: (d2.points||0)+1, wins: (d2.wins||0)+1, games: (d2.games||0)+1 }).catch(()=>{});
    } else if (winnerNum === 1) {
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
      player1: currentRoomData.sharedSecret || currentRoomData.player1?.secret || "-",
      player2: currentRoomData.sharedSecret || currentRoomData.player2?.secret || "-"
    }
  }).catch(()=>{});
}

function updatePlayersMeta(p1Name, p1Pts, p2Name, p2Pts) {
  const p1NameEl = $("player1Name");
  const p2NameEl = $("player2Name");
  const p1PtsEl = $("player1Points");
  const p2PtsEl = $("player2Points");

  if (p1NameEl) p1NameEl.textContent = p1Name || "Pemain A";
  if (p2NameEl) p2NameEl.textContent = p2Name || "Menunggu...";
  if (p1PtsEl) p1PtsEl.textContent = p1Pts;
  if (p2PtsEl) p2PtsEl.textContent = p2Pts;

  safeToggle("playerCard1", "active", playerNumber === 1);
  safeToggle("playerCard2", "active", playerNumber === 2);
}

function showResultScreen(winner, r) {
  stopTimer();
  showScreen("resultScreen");
  const p1N = r.player1?.name || "Pemain A";
  const p2N = r.player2?.name || "Pemain B";
  const resP1 = $("resultPlayer1Label");
  const resP2 = $("resultPlayer2Label");
  const resSec1 = $("resultSecret1");
  const resSec2 = $("resultSecret2");
  const resLine = $("resultScoreline");

  if (resP1) resP1.textContent = p1N;
  if (resP2) resP2.textContent = p2N;

  if (r.mode === "lawan" || r.mode === "kawan") {
    const targetSec = r.sharedSecret || "-";
    if (resSec1) resSec1.textContent = targetSec;
    if (resSec2) resSec2.textContent = targetSec;
  } else if (r.mode === "latihan") {
    if (resSec1) resSec1.textContent = practiceSecret || "-";
    if (resSec2) resSec2.textContent = practiceSecret || "-";
  } else {
    const s1 = r.secrets?.player1 || r.player1?.secret || "-";
    const s2 = r.secrets?.player2 || r.player2?.secret || "-";
    if (resSec1) resSec1.textContent = s1;
    if (resSec2) resSec2.textContent = s2;
  }

  if (resLine) {
    if (r.mode === "kawan") {
      resLine.innerHTML = `
        <div><span>${p1N}</span><strong>Menang Bersama (Tim)</strong></div>
        <div><span>${p2N}</span><strong>Menang Bersama (Tim)</strong></div>
      `;
    } else {
      resLine.innerHTML = `
        <div><span>${p1N}</span><strong>${r.winner === 1 ? "Menang" : "Kalah"}</strong></div>
        <div><span>${p2N}</span><strong>${r.winner === 2 ? "Menang" : "Kalah"}</strong></div>
      `;
    }
  }

  const resIcon = $("resultIcon");
  const resTitle = $("resultTitle");
  const resMsg = $("resultMessage");

  if (r.mode === "kawan") {
    if (resIcon) resIcon.textContent = "🤝";
    if (resTitle) resTitle.textContent = "Misi Berhasil!";
    if (resMsg) resMsg.textContent = "Kalian berhasil bekerja sama menebak angka rahasia tim!";
  } else if (winner === playerNumber) {
    if (resIcon) resIcon.textContent = "🏆";
    if (resTitle) resTitle.textContent = "Anda Menang!";
    if (resMsg) resMsg.textContent = "Hebat! Tebakanmu lebih akurat.";
  } else {
    if (resIcon) resIcon.textContent = "😿";
    if (resTitle) resTitle.textContent = "Anda Kalah";
    if (resMsg) resMsg.textContent = "Lawan lebih dulu menebak angka rahasiamu.";
  }
}


/* =========================================================
   TOMBOL KELUAR / RESET
========================================================= */

const showSecBtn = $("showSecretBtn");
if (showSecBtn) {
  showSecBtn.addEventListener("click", () => {
    if (room.mode === "lawan" || room.mode === "kawan" || isSpectator) return;
    secretVisible = !secretVisible;
    const secDisp = $("secretDisplay");
    if (secDisp) secDisp.textContent = secretVisible ? secret : "•".repeat(room.digits);
    showSecBtn.textContent = secretVisible ? "Sembunyikan" : "Tampilkan";
  });
}

const leaveBtn = $("leaveBtn");
if (leaveBtn) leaveBtn.addEventListener("click", resetApp);

const backBtn = $("backBtn");
if (backBtn) backBtn.addEventListener("click", resetApp);

const cancelBtn = $("cancelBtn");
if (cancelBtn) cancelBtn.addEventListener("click", resetApp);

function resetApp() {
  detachRoomListener();
  stopTimer();
  playerNumber = 0;
  isSpectator = false;
  safeRemove("guessForm", "hidden");
  safeAdd("spectatorBadge", "hidden");

  room = { code: "", mode: "duel", digits: 6, maxGuesses: 20, turnTime: 30 };
  secret = "";
  secretVisible = false;
  hasSubmittedSecret = false;
  myHistory = [];
  opponentHistory = [];
  const roomCodeInput = $("roomCode");
  const secretInput = $("secret");
  const guessInput = $("guess");
  const secretDisp = $("secretDisplay");
  if (roomCodeInput) roomCodeInput.value = "";
  if (secretInput) secretInput.value = "";
  if (guessInput) guessInput.value = "";
  if (secretDisp) secretDisp.textContent = "••••••";
  if (showSecBtn) showSecBtn.textContent = "Tampilkan";

  renderHistories();
  setMessage("setupMessage", "");
  setMessage("secretMessage", "");
  setMessage("guessMessage", "");
  showScreen("setupScreen");
}

showScreen("setupScreen");
renderHistories();
