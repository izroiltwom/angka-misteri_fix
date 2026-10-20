const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");
const { initDb, ensureUser, loginUser, getUser, recordMatch, getLeaderboard } = require("./db");

const app = express();
const server = http.createServer(app);

const wss = new WebSocket.Server({
  server,
  clientTracking: true
});

const PORT = process.env.PORT || 3000;


/* =========================================================
   PENGATURAN
========================================================= */

const ALLOWED_TURN_TIMES = [
  10,
  15,
  20,
  30,
  45,
  60,
  90,
  120
];

/*
  Room tetap disimpan selama 5 menit
  setelah kedua pemain terputus.
*/
const ROOM_GRACE_TIME = 5 * 60 * 1000;


/* =========================================================
   EXPRESS
========================================================= */

app.use(express.json());

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);


/* =========================================================
   ROOM
========================================================= */

const rooms = new Map();


/* =========================================================
   HELPER
========================================================= */

function cleanCode(code) {
  return String(code || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
}


function makeCode() {
  let code;

  do {
    code = Math.random()
      .toString(36)
      .substring(2, 8)
      .toUpperCase();
  } while (rooms.has(code));

  return code;
}


function send(ws, data) {
  if (
    !ws ||
    ws.readyState !== WebSocket.OPEN
  ) {
    return false;
  }

  try {
    ws.send(JSON.stringify(data));
    return true;
  } catch (error) {
    console.error(
      "Gagal mengirim WebSocket:",
      error.message
    );

    return false;
  }
}


function broadcast(room, data) {
  send(room.player1.ws, data);
  send(room.player2.ws, data);
}


function getPlayer(room, number) {
  return number === 1
    ? room.player1
    : room.player2;
}


function getOpponent(room, number) {
  return number === 1
    ? room.player2
    : room.player1;
}


function isConnected(player) {
  return !!(
    player &&
    player.ws &&
    player.ws.readyState === WebSocket.OPEN
  );
}


function bothPlayersConnected(room) {
  return (
    isConnected(room.player1) &&
    isConnected(room.player2)
  );
}


/* =========================================================
   VALIDASI DIGIT
========================================================= */

function hasUniqueDigits(value) {
  const text = String(value);

  return (
    new Set(text.split("")).size ===
    text.length
  );
}


/* =========================================================
   HITUNG BETUL / HAMPIR
========================================================= */

function calculateBH(secret, guess) {
  let betul = 0;
  let hampir = 0;


  /*
    BETUL:
    digit sama dan posisi sama.
  */

  for (
    let i = 0;
    i < secret.length;
    i++
  ) {
    if (guess[i] === secret[i]) {
      betul++;
    }
  }


  /*
    HAMPIR:
    digit ada di secret tetapi
    posisinya berbeda.
  */

  for (
    let i = 0;
    i < guess.length;
    i++
  ) {
    if (
      guess[i] !== secret[i] &&
      secret.includes(guess[i])
    ) {
      hampir++;
    }
  }


  return {
    betul,
    hampir
  };
}


/* =========================================================
   ROOM CLEANUP
========================================================= */

function cancelRoomCleanup(room) {
  if (room.cleanupTimer) {
    clearTimeout(room.cleanupTimer);
    room.cleanupTimer = null;
  }
}


function scheduleRoomCleanup(room) {
  cancelRoomCleanup(room);

  room.cleanupTimer = setTimeout(() => {

    if (
      !isConnected(room.player1) &&
      !isConnected(room.player2)
    ) {

      stopTurnTimer(room);

      rooms.delete(room.code);

      console.log(
        `Room ${room.code} dihapus setelah timeout.`
      );
    }

  }, ROOM_GRACE_TIME);
}


/* =========================================================
   TIMER DUEL
========================================================= */

function stopTurnTimer(room) {

  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }

  room.turnStartedAt = 0;
  room.turnEndsAt = 0;
}


/*
  Menghitung sisa waktu berdasarkan
  jam server.
*/
function getRemainingTurnTime(room) {

  if (
    room.mode !== "duel" ||
    !room.started ||
    !room.turnEndsAt
  ) {
    return room.turnTime;
  }

  const remainingMs =
    room.turnEndsAt - Date.now();

  return Math.max(
    0,
    Math.ceil(
      remainingMs / 1000
    )
  );
}


/*
  Mulai timer giliran Duel.

  SERVER menjadi sumber waktu utama.

  turnEndsAt = waktu ketika giliran berakhir.
*/
function startTurnTimer(room) {

  stopTurnTimer(room);

  if (room.mode !== "duel") {
    return;
  }

  if (!room.started) {
    return;
  }


  /*
    Catat waktu mulai.
  */

  room.turnStartedAt =
    Date.now();


  /*
    Catat waktu berakhir.
  */

  room.turnEndsAt =
    room.turnStartedAt +
    room.turnTime * 1000;


  /*
    Kirim waktu berakhir kepada
    kedua pemain.
  */

  broadcast(room, {

    type: "TURN",

    turn:
      room.turn,

    seconds:
      room.turnTime,

    endsAt:
      room.turnEndsAt

  });


  /*
    Timer server.

    Saat selesai, server tetap
    memeriksa apakah giliran
    masih sama dan game masih aktif.
  */

  const currentTurn =
    room.turn;

  const currentEndsAt =
    room.turnEndsAt;


  room.timer = setTimeout(() => {

    /*
      Kalau game sudah selesai,
      abaikan timer ini.
    */

    if (!room.started) {
      return;
    }


    /*
      Kalau giliran sudah berubah,
      timer ini sudah tidak berlaku.
    */

    if (
      room.turn !== currentTurn ||
      room.turnEndsAt !== currentEndsAt
    ) {
      return;
    }


    /*
      Pastikan waktu memang sudah habis.
    */

    if (
      Date.now() <
      currentEndsAt
    ) {

      /*
        Kalau timer sedikit terlalu cepat,
        jadwalkan kembali berdasarkan
        waktu yang benar.
        */

      const remaining =
        currentEndsAt - Date.now();

      room.timer =
        setTimeout(
          () => {

            if (
              !room.started ||
              room.turn !== currentTurn ||
              room.turnEndsAt !== currentEndsAt
            ) {
              return;
            }

            finishTurnByTimeout(room);

          },
          Math.max(
            10,
            remaining
          )
        );

      return;
    }


    finishTurnByTimeout(room);

  }, room.turnTime * 1000);
}


/*
  Dipanggil saat waktu giliran habis.
*/
function finishTurnByTimeout(room) {

  if (!room.started) {
    return;
  }


  room.timer = null;


  /*
    Pindah giliran.
  */

  room.turn =
    room.turn === 1
      ? 2
      : 1;


  /*
    Mulai timer baru.
  */

  startTurnTimer(room);


  /*
    Beri tahu pemain bahwa waktu habis.

    TURN juga akan dikirim oleh
    startTurnTimer().
  */

  broadcast(room, {

    type: "TIME_UP",

    turn:
      room.turn

  });
}


/* =========================================================
   INFO ROOM
========================================================= */

function sendRoomInfo(
  room,
  playerNumber
) {

  const player =
    getPlayer(
      room,
      playerNumber
    );

  send(player.ws, {

    type: "ROOM",

    code:
      room.code,

    mode:
      room.mode,

    digits:
      room.digits,

    maxGuesses:
      room.maxGuesses,

    turnTime:
      room.turnTime,

    playerNumber,
    players: {
      player1: { name: room.player1.name || "Pemain A", points: room.player1.points || 0 },
      player2: { name: room.player2.name || "Menunggu...", points: room.player2.points || 0 }
    }

  });
}


/* =========================================================
   SYNC STATE
========================================================= */

function sendCurrentState(
  room,
  playerNumber
) {

  const player =
    getPlayer(
      room,
      playerNumber
    );


  if (!player.ws) {
    return;
  }


  /*
    Informasi room.
  */

  sendRoomInfo(
    room,
    playerNumber
  );


  /*
    Jika game sedang berjalan.
  */

  if (room.started) {

    send(player.ws, {

      type: "GAME_START",

      turn:
        room.turn

    });


    if (
      room.mode === "duel"
    ) {

      send(player.ws, {

        type: "TURN",

        turn:
          room.turn,

        seconds:
          getRemainingTurnTime(
            room
          ),

        endsAt:
          room.turnEndsAt

      });

    }

    return;
  }


  /*
    Jika game belum mulai tetapi
    kedua pemain sudah terhubung.
  */

  if (
    bothPlayersConnected(room)
  ) {

    send(player.ws, {

      type: "READY",

      mode:
        room.mode,

      digits:
        room.digits,

      maxGuesses:
        room.maxGuesses,

      turnTime:
        room.turnTime

    });

  }
}


async function finishGame(room, winner, reason = "normal") {
  if (room.finished) return;

  room.finished = true;
  room.started = false;
  stopTurnTimer(room);

  let scores = null;
  try {
    scores = await recordMatch({
      roomCode: room.code,
      player1Id: room.player1.userId,
      player2Id: room.player2.userId,
      winnerNumber: winner
    });
  } catch (error) {
    console.error("Gagal menyimpan skor:", error);
  }

  if (scores) {
    room.player1.points = Number(scores.player1?.points || room.player1.points || 0);
    room.player1.wins = Number(scores.player1?.wins || room.player1.wins || 0);
    room.player1.draws = Number(scores.player1?.draws || room.player1.draws || 0);
    room.player1.losses = Number(scores.player1?.losses || room.player1.losses || 0);
    room.player2.points = Number(scores.player2?.points || room.player2.points || 0);
    room.player2.wins = Number(scores.player2?.wins || room.player2.wins || 0);
    room.player2.draws = Number(scores.player2?.draws || room.player2.draws || 0);
    room.player2.losses = Number(scores.player2?.losses || room.player2.losses || 0);
  }

  broadcast(room, {
    type: "GAME_OVER",
    winner,
    reason,
    secrets: {
      player1: room.player1.secret,
      player2: room.player2.secret
    },
    players: {
      player1: { name: room.player1.name, points: room.player1.points || 0, wins: room.player1.wins || 0, draws: room.player1.draws || 0, losses: room.player1.losses || 0 },
      player2: { name: room.player2.name, points: room.player2.points || 0, wins: room.player2.wins || 0, draws: room.player2.draws || 0, losses: room.player2.losses || 0 }
    }
  });
}


/* =========================================================
   MULAI GAME
========================================================= */

function startGame(room) {

  if (room.started) {
    return;
  }


  /*
    Kedua secret harus ada.
  */

  if (
    !room.player1.secret ||
    !room.player2.secret
  ) {
    return;
  }


  room.started = true;

  room.turn = 1;


  room.player1.guesses = 0;
  room.player2.guesses = 0;


  /*
    Beri tahu kedua pemain.
  */

  broadcast(room, {

    type: "GAME_START",

    turn:
      room.turn

  });


  /*
    Timer hanya dipakai
    untuk mode Duel.
  */

  if (
    room.mode === "duel"
  ) {

    startTurnTimer(room);

  }
}


/* =========================================================
   PROFIL PEMAIN
========================================================= */

app.post("/api/profile", async (req, res) => {
  try {
    const userId = String(req.body.userId || "").trim() || null;
    const name = String(req.body.name || "").trim();

    if (!name) {
      return res.status(400).json({ error: "Nama pemain wajib diisi." });
    }

    const user = await ensureUser(userId, name);
    return res.json({ user });
  } catch (error) {
    console.error("Profile error:", error);
    return res.status(500).json({ error: "Profil pemain gagal disimpan." });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const userId = String(req.body.userId || "").trim();
    if (!userId) return res.status(400).json({ error: "ID pemain wajib diisi." });

    const user = await loginUser(userId);
    if (!user) return res.status(401).json({ error: "ID pemain tidak ditemukan." });

    return res.json({ user });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ error: "Login gagal." });
  }
});

app.get("/api/profile/:id", async (req, res) => {
  try {
    const user = await getUser(req.params.id);
    if (!user) return res.status(404).json({ error: "Profil tidak ditemukan." });
    return res.json({ user });
  } catch (error) {
    console.error("Profile lookup error:", error);
    return res.status(500).json({ error: "Profil tidak dapat dibaca." });
  }
});

app.get("/api/leaderboard", async (req, res) => {
  try {
    return res.json({ users: await getLeaderboard(req.query.limit) });
  } catch (error) {
    console.error("Leaderboard error:", error);
    return res.status(500).json({ error: "Leaderboard tidak dapat dibaca." });
  }
});


/* =========================================================
   BUAT ROOM
========================================================= */

app.post(
  "/api/rooms",
  async (req, res) => {

    const mode =
      req.body.mode === "lari"
        ? "lari"
        : "duel";


    let digits =
      Number(
        req.body.digits
      );


    if (
      !Number.isInteger(digits)
    ) {
      digits = 6;
    }


    /*
      Maksimal 10 digit karena
      semua digit harus berbeda.
    */

    digits =
      Math.max(
        1,
        Math.min(
          10,
          digits
        )
      );


    let maxGuesses =
      Number(
        req.body.maxGuesses
      );


    if (
      ![
        20,
        25,
        30,
        35
      ].includes(maxGuesses)
    ) {
      maxGuesses = 20;
    }


    let turnTime =
      Number(
        req.body.turnTime
      );


    if (
      !ALLOWED_TURN_TIMES.includes(
        turnTime
      )
    ) {
      turnTime = 30;
    }


    const userId = String(req.body.userId || "").trim();
    const user = await getUser(userId);

    if (!user) {
      return res.status(400).json({ error: "Profil pemain belum tersimpan. Silakan simpan nama terlebih dahulu." });
    }

    let code =
      cleanCode(
        req.body.code
      );


    if (!code) {
      code =
        makeCode();
    }


    if (
      code.length < 4
    ) {

      return res
        .status(400)
        .json({

          error:
            "Kode room minimal 4 karakter."

        });

    }


    if (
      rooms.has(code)
    ) {

      return res
        .status(409)
        .json({

          error:
            "Kode room sudah digunakan."

        });

    }


    const room = {

      code,

      mode,

      digits,

      maxGuesses,

      turnTime,


      player1: {

        ws: null,
        userId: user.id,
        name: user.name,
        secret: null,
        guesses: 0,
        connectedAt: 0

      },


      player2: {

        ws: null,
        userId: null,
        name: "",
        secret: null,
        guesses: 0,
        connectedAt: 0

      },


      started: false,
      finished: false,

      turn: 1,


      /*
        TIMER SERVER
      */

      timer: null,

      turnStartedAt: 0,

      turnEndsAt: 0,


      cleanupTimer: null

    };


    rooms.set(
      code,
      room
    );


    console.log(
      `Room dibuat: ${code}`
    );


    res.json({

      code,

      mode,

      digits,

      maxGuesses,

      turnTime

    });

  }
);


/* =========================================================
   CEK ROOM
========================================================= */

app.get(
  "/api/rooms/:code",
  (req, res) => {

    const code =
      cleanCode(
        req.params.code
      );


    const room =
      rooms.get(code);


    if (!room) {

      return res
        .status(404)
        .json({

          error:
            "Room tidak ditemukan."

        });

    }


    const player2Joined =
      isConnected(
        room.player2
      );


    res.json({

      code:
        room.code,

      mode:
        room.mode,

      digits:
        room.digits,

      maxGuesses:
        room.maxGuesses,

      turnTime:
        room.turnTime,

      player2Joined

    });

  }
);


/* =========================================================
   WEBSOCKET
========================================================= */

wss.on(
  "connection",
  async (ws, req) => {

    /*
      HEARTBEAT
    */

    ws.isAlive = true;


    ws.on(
      "pong",
      () => {

        ws.isAlive = true;

      }
    );


    const url =
      new URL(
        req.url,
        `http://${req.headers.host}`
      );


    const code =
      cleanCode(
        url.searchParams.get(
          "room"
        )
      );


    const playerNumber =
      Number(
        url.searchParams.get(
          "player"
        )
      );

    const userId =
      String(
        url.searchParams.get("userId") || ""
      ).trim();


    const room =
      rooms.get(code);


    /*
      ROOM TIDAK DITEMUKAN
    */

    if (!room) {

      send(ws, {

        type: "ERROR",

        message:
          "Room tidak ditemukan."

      });


      ws.close();

      return;

    }


    /*
      PEMAIN TIDAK VALID
    */

    if (
      playerNumber !== 1 &&
      playerNumber !== 2
    ) {

      send(ws, {

        type: "ERROR",

        message:
          "Pemain tidak valid."

      });


      ws.close();

      return;

    }


    if (![1, 2].includes(playerNumber)) {
      send(ws, { type: "ERROR", message: "Nomor pemain tidak valid." });
      ws.close();
      return;
    }

    const user = await getUser(userId);
    if (!user) {
      send(ws, { type: "ERROR", message: "Profil pemain tidak ditemukan." });
      ws.close();
      return;
    }

    const player =
      getPlayer(
        room,
        playerNumber
      );

    if (player.userId && player.userId !== user.id && isConnected(player)) {
      send(ws, { type: "ERROR", message: "Slot pemain tersebut sudah digunakan." });
      ws.close();
      return;
    }

    if (!room.started && player.userId && player.userId !== user.id) {
      player.secret = null;
      player.guesses = 0;
    }

    player.userId = user.id;
    player.name = user.name;
    player.points = Number(user.points || 0);
    player.wins = Number(user.wins || 0);
    player.draws = Number(user.draws || 0);
    player.losses = Number(user.losses || 0);


    /*
      KONEKSI LAMA
    */

    const oldSocket =
      player.ws;


    /*
      RECONNECT / DUPLICATE
    */

    if (
      oldSocket &&
      oldSocket !== ws
    ) {

      console.log(
        `Mengganti koneksi lama Player ${playerNumber} di room ${room.code}`
      );


      try {

        oldSocket.close(
          1000,
          "Koneksi diganti"
        );

      } catch {

        // abaikan

      }

    }


    /*
      KONEKSI BARU
    */

    player.ws =
      ws;

    player.connectedAt =
      Date.now();


    cancelRoomCleanup(
      room
    );


    console.log(
      `Player ${playerNumber} terhubung ke room ${room.code}`
    );

    broadcast(room, {
      type: "PLAYERS",
      players: {
        player1: { name: room.player1.name || "Pemain A", points: room.player1.points || 0 },
        player2: { name: room.player2.name || "Menunggu...", points: room.player2.points || 0 }
      }
    });


    /*
      Sinkronisasi state.
    */

    sendCurrentState(
      room,
      playerNumber
    );


    /*
      Jika kedua pemain sudah terhubung
      dan game belum dimulai.
    */

    if (
      bothPlayersConnected(room) &&
      !room.started
    ) {

      /*
        Jika secret belum lengkap,
        kirim READY.
      */

      if (
        !room.player1.secret ||
        !room.player2.secret
      ) {

        broadcast(room, {

          type: "READY",

          mode:
            room.mode,

          digits:
            room.digits,

          maxGuesses:
            room.maxGuesses,

          turnTime:
            room.turnTime

        });

      }


      /*
        Jika secret sudah lengkap,
        mulai game.
      */

      if (
        room.player1.secret &&
        room.player2.secret
      ) {

        startGame(room);

      }

    }


    /* =====================================================
       PESAN
    ===================================================== */

    ws.on(
      "message",
      async (raw) => {

        /*
          Pastikan koneksi masih
          merupakan koneksi aktif.
        */

        if (
          player.ws !== ws
        ) {
          return;
        }


        let msg;


        try {

          msg =
            JSON.parse(
              raw.toString()
            );

        } catch {

          send(ws, {

            type: "ERROR",

            message:
              "Pesan tidak valid."

          });

          return;

        }


        /* =================================================
           SET SECRET
        ================================================= */

        if (
          msg.type === "SET_SECRET"
        ) {

          /*
            Tidak boleh mengganti secret
            setelah game dimulai.
          */

          if (
            room.started
          ) {

            send(ws, {

              type: "ERROR",

              message:
                "Permainan sudah dimulai."

            });

            return;

          }


          const value =
            String(
              msg.secret || ""
            );


          /*
            Harus angka.
          */

          if (
            !/^\d+$/.test(value)
          ) {

            send(ws, {

              type: "ERROR",

              message:
                "Angka rahasia harus berupa angka."

            });

            return;

          }


          /*
            Harus tepat jumlah digit.
          */

          if (
            value.length !==
            room.digits
          ) {

            send(ws, {

              type: "ERROR",

              message:
                `Angka rahasia harus ${room.digits} digit.`

            });

            return;

          }


          /*
            Semua digit harus berbeda.
          */

          if (
            !hasUniqueDigits(value)
          ) {

            send(ws, {

              type: "ERROR",

              message:
                "Setiap digit angka rahasia harus berbeda. Contoh: 1234 boleh, 1233 tidak boleh."

            });

            return;

          }


          /*
            Simpan secret.
          */

          player.secret =
            value;


          send(ws, {

            type:
              "SECRET_OK"

          });


          /*
            Jika kedua secret sudah ada,
            mulai game.
          */

          if (
            room.player1.secret &&
            room.player2.secret &&
            bothPlayersConnected(room) &&
            !room.started
          ) {

            startGame(room);

          }


          return;

        }


        /* =================================================
           GUESS
        ================================================= */

        if (
          msg.type === "GUESS"
        ) {

          /*
            Game harus sudah berjalan.
          */

          if (
            !room.started
          ) {

            send(ws, {

              type: "ERROR",

              message:
                "Permainan belum dimulai."

            });

            return;

          }


          /*
            Pastikan koneksi aktif.
          */

          if (
            player.ws !== ws
          ) {

            return;

          }


          const guess =
            String(
              msg.guess || ""
            );


          /*
            Harus angka.
          */

          if (
            !/^\d+$/.test(guess)
          ) {

            send(ws, {

              type: "ERROR",

              message:
                "Tebakan harus berupa angka."

            });

            return;

          }


          /*
            Harus tepat jumlah digit.
          */

          if (
            guess.length !==
            room.digits
          ) {

            send(ws, {

              type: "ERROR",

              message:
                `Tebakan harus ${room.digits} digit.`

            });

            return;

          }


          /*
            Digit tebakan harus berbeda.
          */

          if (
            !hasUniqueDigits(guess)
          ) {

            send(ws, {

              type: "ERROR",

              message:
                "Setiap digit tebakan juga harus berbeda. Contoh: 1234 boleh, 1233 tidak boleh."

            });

            return;

          }


          /*
            DUEL:
            hanya pemain yang mendapat
            giliran yang boleh menebak.
          */

          if (
            room.mode === "duel" &&
            room.turn !== playerNumber
          ) {

            send(ws, {

              type: "ERROR",

              message:
                "Sekarang giliran lawan."

            });

            return;

          }


          /*
            DUEL:
            pastikan waktu belum habis.
          */

          if (
            room.mode === "duel"
          ) {

            if (
              !room.turnEndsAt ||
              Date.now() >= room.turnEndsAt
            ) {

              /*
                Kalau ternyata timer server
                belum sempat memproses timeout,
                langsung pindahkan giliran.
              */

              const oldTurn =
                room.turn;


              room.turn =
                room.turn === 1
                  ? 2
                  : 1;


              startTurnTimer(room);


              broadcast(room, {

                type: "TIME_UP",

                turn:
                  room.turn

              });


              /*
                Pemain yang tadi mencoba
                menebak sudah terlambat.
              */

              return;

            }

          }


          /*
            LARI:
            cek batas tebakan pemain.
          */

          if (
            room.mode === "lari" &&
            player.guesses >=
              room.maxGuesses
          ) {

            send(ws, {

              type: "ERROR",

              message:
                "Batas tebakan sudah habis."

            });

            return;

          }


          /*
            Ambil secret LAWAN.
          */

          const opponent =
            getOpponent(
              room,
              playerNumber
            );


          if (
            !opponent.secret
          ) {

            send(ws, {

              type: "ERROR",

              message:
                "Angka rahasia lawan belum siap."

            });

            return;

          }


          /*
            Tambah jumlah tebakan.
          */

          player.guesses++;


          /*
            Hitung terhadap secret LAWAN.
          */

          const result =
            calculateBH(
              opponent.secret,
              guess
            );


          /*
            Kirim hasil kepada
            pemain yang menebak.
          */

          send(ws, {

            type:
              "GUESS_RESULT",

            guess,

            betul:
              result.betul,

            hampir:
              result.hampir,

            count:
              player.guesses

          });


          /*
            Kirim tebakan kepada lawan.
          */

          send(
            opponent.ws,
            {

              type:
                "OPPONENT_GUESS",

              guess,

              betul:
                result.betul,

              hampir:
                result.hampir,

              count:
                player.guesses

            }
          );


          /*
            JIKA MENANG
          */

          if (
            result.betul ===
            room.digits
          ) {

            await finishGame(
              room,
              playerNumber,
              "guessed"
            );

            return;

          }


          /*
            DUEL:
            pindah giliran.
          */

          if (
            room.mode === "duel"
          ) {

            room.turn =
              playerNumber === 1
                ? 2
                : 1;


            startTurnTimer(
              room
            );


            return;

          }


          /*
            LARI:
            cek apakah kedua pemain
            sudah menghabiskan semua
            tebakan.
          */

          if (
            room.mode === "lari"
          ) {

            if (
              room.player1.guesses >=
                room.maxGuesses &&
              room.player2.guesses >=
                room.maxGuesses
            ) {

              await finishGame(
                room,
                0,
                "both_exhausted"
              );

            }

          }


          return;

        }


        /* =================================================
           PING
        ================================================= */

        if (
          msg.type === "PING"
        ) {

          send(ws, {

            type:
              "PONG"

          });

          return;

        }

      }
    );


    /* =====================================================
       CLOSE
    ===================================================== */

    ws.on(
      "close",
      () => {

        /*
          Jangan mengosongkan koneksi
          kalau sudah digantikan koneksi baru.
        */

        if (
          player.ws !== ws
        ) {

          console.log(
            `Koneksi lama Player ${playerNumber} ditutup, tetapi koneksi baru sudah aktif.`
          );

          return;

        }


        player.ws =
          null;


        console.log(
          `Player ${playerNumber} terputus dari room ${room.code}`
        );


        /*
          Secret TIDAK dihapus.
        */


        /*
          Kalau kedua pemain terputus,
          mulai grace period.
        */

        if (
          !isConnected(room.player1) &&
          !isConnected(room.player2)
        ) {

          scheduleRoomCleanup(
            room
          );

        }

      }
    );


    ws.on(
      "error",
      (error) => {

        console.error(
          `WebSocket Player ${playerNumber}:`,
          error.message
        );

      }
    );

  }
);


/* =========================================================
   WEBSOCKET HEARTBEAT
========================================================= */

const heartbeatInterval =
  setInterval(
    () => {

      wss.clients.forEach(
        (ws) => {

          if (
            ws.readyState !==
            WebSocket.OPEN
          ) {
            return;
          }


          if (
            ws.isAlive === false
          ) {

            console.log(
              "WebSocket tidak merespons, koneksi dihentikan."
            );


            try {
              ws.terminate();
            } catch {
              // abaikan
            }

            return;

          }


          ws.isAlive =
            false;


          try {

            ws.ping();

          } catch {

            try {
              ws.terminate();
            } catch {
              // abaikan
            }

          }

        }
      );

    },
    25000
  );


wss.on(
  "close",
  () => {

    clearInterval(
      heartbeatInterval
    );

  }
);



/* =========================================================
   MODE LATIHAN SOLO (angka rahasia tetap di server)
========================================================= */
const practiceSessions = new Map();
function makePracticeSecret(digits) {
  const pool = "0123456789".split("");
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pool.slice(0, digits).join("");
}
app.post("/api/practice/start", async (req, res) => {
  try {
    const userId = String(req.body.userId || "").trim();
    const user = await getUser(userId);
    if (!user) return res.status(400).json({ error: "Profil pemain belum tersimpan." });
    const digits = Math.max(1, Math.min(10, Number.isInteger(Number(req.body.digits)) ? Number(req.body.digits) : 6));
    const sessionId = require("crypto").randomBytes(18).toString("hex");
    practiceSessions.set(sessionId, { userId, digits, secret: makePracticeSecret(digits), guesses: 0, createdAt: Date.now(), done: false });
    return res.json({ sessionId, digits });
  } catch (error) { console.error("Practice start error:", error); return res.status(500).json({ error: "Gagal memulai latihan." }); }
});
app.post("/api/practice/guess", (req, res) => {
  const session = practiceSessions.get(String(req.body.sessionId || ""));
  if (!session || session.done || Date.now() - session.createdAt > 3 * 60 * 60 * 1000) return res.status(400).json({ error: "Sesi latihan tidak valid atau sudah selesai. Mulai latihan baru." });
  const guess = String(req.body.guess || "");
  if (!/^\d+$/.test(guess) || guess.length !== session.digits) return res.status(400).json({ error: `Tebakan harus ${session.digits} digit.` });
  if (!hasUniqueDigits(guess)) return res.status(400).json({ error: "Setiap digit tebakan harus berbeda." });
  const result = calculateBH(session.secret, guess);
  session.guesses++;
  const won = guess === session.secret;
  if (won) { session.done = true; practiceSessions.delete(String(req.body.sessionId)); }
  return res.json({ betul: result.betul, hampir: result.hampir, count: session.guesses, won });
});

/* =========================================================
   HEALTH CHECK
========================================================= */

app.get(
  ["/health", "/api/health"],
  (req, res) => {

    res.json({

      ok: true,

      rooms:
        rooms.size,

      connections:
        wss.clients.size

    });

  }
);


/* =========================================================
   START SERVER
========================================================= */

initDb()
  .then(() => {
    server.listen(
      PORT,
      "0.0.0.0",
      () => {
        console.log(
          `Angka Misteri server berjalan di port ${PORT}`
        );
      }
    );
  })
  .catch((error) => {
    console.error("Penyimpanan data gagal diinisialisasi:", error);
    process.exit(1);
  });
