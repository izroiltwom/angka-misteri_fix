const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

// Penyimpanan persisten berbasis file JSON — tanpa SQL/database engine.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "users.json");

let state = { users: {}, matches: [] };
let writeQueue = Promise.resolve();

async function initDb() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    state = {
      users: parsed && parsed.users && typeof parsed.users === "object" ? parsed.users : {},
      matches: Array.isArray(parsed?.matches) ? parsed.matches : []
    };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await persist();
  }
}

function persist() {
  const snapshot = JSON.stringify(state, null, 2);
  writeQueue = writeQueue.then(async () => {
    const tempFile = `${DATA_FILE}.tmp`;
    await fs.writeFile(tempFile, snapshot, "utf8");
    await fs.rename(tempFile, DATA_FILE);
  });
  return writeQueue;
}

function normalizeName(name) {
  return String(name || "").trim().replace(/\s+/g, " ").slice(0, 20);
}

function cloneUser(user) {
  return user ? { ...user } : null;
}

async function ensureUser(userId, name) {
  const normalized = normalizeName(name);
  if (!normalized) throw new Error("Nama pemain wajib diisi.");

  if (userId && state.users[userId]) {
    return cloneUser(state.users[userId]);
  }

  let id = String(userId || "").trim();
  if (!id) {
    do {
      id = String(Math.floor(10000000 + Math.random() * 90000000));
    } while (state.users[id]);
  }
  const user = {
    id,
    name: normalized,
    points: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    games: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  state.users[id] = user;
  await persist();
  return cloneUser(user);
}

async function loginUser(userId) {
  const id = String(userId || "").trim();
  if (!id) return null;
  return cloneUser(state.users[id]);
}

async function getUser(userId) {
  return loginUser(userId);
}

async function recordMatch({ roomCode, player1Id, player2Id, winnerNumber }) {
  const isDraw = winnerNumber === 0;
  const winnerId = isDraw ? null : (winnerNumber === 1 ? player1Id : player2Id);
  const loserId = isDraw ? null : (winnerNumber === 1 ? player2Id : player1Id);

  const p1 = state.users[player1Id];
  const p2 = state.users[player2Id];
  if (!p1 || !p2) throw new Error("Pemain tidak ditemukan.");

  p1.games += 1;
  p2.games += 1;
  p1.updated_at = new Date().toISOString();
  p2.updated_at = new Date().toISOString();

  if (isDraw) {
    p1.points += 0.5;
    p2.points += 0.5;
    p1.draws += 1;
    p2.draws += 1;
  } else {
    const winner = state.users[winnerId];
    const loser = state.users[loserId];
    winner.points += 1;
    winner.wins += 1;
    loser.losses += 1;
    winner.updated_at = new Date().toISOString();
    loser.updated_at = new Date().toISOString();
  }

  state.matches.push({
    id: crypto.randomUUID(),
    roomCode,
    player1Id,
    player2Id,
    winnerId,
    result: isDraw ? "draw" : "win",
    created_at: new Date().toISOString()
  });

  // Batasi histori teknis agar file tidak tumbuh tanpa batas.
  if (state.matches.length > 5000) state.matches = state.matches.slice(-5000);

  await persist();
  return {
    player1: cloneUser(p1),
    player2: cloneUser(p2)
  };
}

async function getLeaderboard(limit = 20) {
  const max = Math.max(1, Math.min(100, Number(limit) || 20));
  return Object.values(state.users)
    .sort((a, b) => b.points - a.points || b.wins - a.wins || a.name.localeCompare(b.name))
    .slice(0, max)
    .map(cloneUser);
}

module.exports = { initDb, ensureUser, loginUser, getUser, recordMatch, getLeaderboard };
