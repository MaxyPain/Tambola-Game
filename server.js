
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "dist", "public");
const rooms = new Map();

function createId(len = 6) {
  return crypto.randomBytes(len).toString("hex").slice(0, len).toUpperCase();
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function range(start, end) {
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

function digitsSpeech(n) {
  return String(n)
    .split("")
    .map((d) => ({
      0: "Zero",
      1: "One",
      2: "Two",
      3: "Three",
      4: "Four",
      5: "Five",
      6: "Six",
      7: "Seven",
      8: "Eight",
      9: "Nine",
    }[d] || d))
    .join(" and ");
}

function fullSpeech(n) {
  return `Number ${n}... ${digitsSpeech(n)}`;
}

const columnRanges = [
  [1, 9],
  [10, 19],
  [20, 29],
  [30, 39],
  [40, 49],
  [50, 59],
  [60, 69],
  [70, 79],
  [80, 90],
];

function hashTicket(ticket) {
  return JSON.stringify(ticket);
}

function generateTicket(existingHashes) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const grid = Array.from({ length: 3 }, () => Array(9).fill(null));
    const usedNumbers = new Set();

    // Make a valid 15-cell ticket: 5 numbers per row, max 2 per column.
    const columnUse = Array(9).fill(0);

    for (let row = 0; row < 3; row += 1) {
      const availableCols = shuffle(range(0, 8).filter((c) => columnUse[c] < 2));
      const rowCols = [];

      for (const c of availableCols) {
        if (rowCols.length < 5 && !rowCols.includes(c)) {
          rowCols.push(c);
          columnUse[c] += 1;
        }
      }

      while (rowCols.length < 5) {
        const c = range(0, 8).find((x) => columnUse[x] < 2 && !rowCols.includes(x));
        if (c === undefined) break;
        rowCols.push(c);
        columnUse[c] += 1;
      }

      rowCols.sort((a, b) => a - b);

      for (const col of rowCols) {
        const [start, end] = columnRanges[col];
        let num;
        let tries = 0;
        do {
          num = Math.floor(Math.random() * (end - start + 1)) + start;
          tries += 1;
        } while (usedNumbers.has(num) && tries < 100);

        usedNumbers.add(num);
        grid[row][col] = num;
      }
    }

    if (grid.flat().filter((x) => x !== null).length !== 15) continue;

    const h = hashTicket(grid);
    if (existingHashes.has(h)) continue;
    existingHashes.add(h);
    return grid;
  }

  throw new Error("Unable to generate unique ticket");
}

function createRoom(playerLimit) {
  const id = createId(6);
  const room = {
    id,
    createdAt: Date.now(),
    playerLimit,
    timerMs: 30000,
    paused: false,
    pausedRemainingMs: null,
    drawDeadline: null,
    drawTimer: null,
    winner: null,
    hostPlayerId: null,
    calledNumbers: [],
    remainingNumbers: shuffle(range(1, 90)),
    votes: new Set(),
    ticketHashes: new Set(),
    players: new Map(), // playerId => player
    lastDrawTime: 0,
  };

  rooms.set(id, room);
  return room;
}

function serializeRoom(room) {
  const connectedPlayers = [...room.players.values()].map((p) => ({
    playerId: p.playerId,
    name: p.name,
    isHost: p.isHost,
    connected: p.connected,
    hasWon: p.hasWon,
    joinedAt: p.joinedAt,
  }));

  const activeConnectedCount = connectedPlayers.filter((p) => p.connected).length;
  const requiredVotes = activeConnectedCount > 0 ? activeConnectedCount : connectedPlayers.length;

  return {
    id: room.id,
    playerLimit: room.playerLimit,
    timerMs: room.timerMs,
    paused: room.paused,
    drawDeadline: room.drawDeadline,
    winner: room.winner,
    hostPlayerId: room.hostPlayerId,
    calledNumbers: room.calledNumbers,
    remainingCount: room.remainingNumbers.length,
    players: connectedPlayers,
    requiredVotes,
    voteCount: room.votes.size,
  };
}

function emitRoomState(room) {
  io.to(room.id).emit("room:state", serializeRoom(room));
}

function setHost(room, playerId) {
  room.hostPlayerId = playerId;
  for (const p of room.players.values()) {
    p.isHost = p.playerId === playerId;
  }
}

function ensureHost(room) {
  if (room.hostPlayerId && room.players.has(room.hostPlayerId)) return;
  const nextHost = [...room.players.values()].find((p) => p.connected) || [...room.players.values()][0];
  if (nextHost) setHost(room, nextHost.playerId);
}

function clearDrawTimer(room) {
  if (room.drawTimer) clearTimeout(room.drawTimer);
  room.drawTimer = null;
}

function checkAndStartTimer(room) {
  if (room.paused || room.winner || room.remainingNumbers.length === 0) return;
  const activeConnectedCount = [...room.players.values()].filter(p => p.connected).length;
  if (activeConnectedCount < room.playerLimit) {
    clearDrawTimer(room);
    room.drawDeadline = null;
  } else if (!room.drawTimer) {
    scheduleAutoDraw(room, true);
  }
}

function scheduleAutoDraw(room, keepRemaining = false) {
  clearDrawTimer(room);
  if (room.paused || room.winner || room.remainingNumbers.length === 0) return;

  const activeConnectedCount = [...room.players.values()].filter(p => p.connected).length;
  if (activeConnectedCount < room.playerLimit) {
    room.drawDeadline = null;
    return;
  }

  const ms = keepRemaining && room.pausedRemainingMs != null ? room.pausedRemainingMs : room.timerMs;
  room.drawDeadline = Date.now() + ms;
  room.pausedRemainingMs = null;

  room.drawTimer = setTimeout(() => {
    drawNextNumber(room.id, "auto");
  }, ms);

  emitRoomState(room);
}

function makeSpeechNumber(number) {
  return fullSpeech(number);
}

function drawNextNumber(roomId, reason = "vote") {
  const room = rooms.get(roomId);
  if (!room || room.paused || room.winner || room.remainingNumbers.length === 0) return;

  clearDrawTimer(room);
  room.lastDrawTime = Date.now();

  const number = room.remainingNumbers.shift();
  room.calledNumbers.push(number);
  room.votes.clear();

  const payload = {
    number,
    speech: makeSpeechNumber(number),
    reason,
    at: Date.now(),
  };

  io.to(room.id).emit("number:drawn", payload);

  if (room.remainingNumbers.length === 0) {
    room.drawDeadline = null;
  } else {
    scheduleAutoDraw(room);
  }

  emitRoomState(room);
}

function fullHouseComplete(player) {
  const values = [];
  for (const row of player.ticket) {
    for (const n of row) {
      if (n !== null) values.push(n);
    }
  }
  return values.every((n) => player.marked.has(n));
}

function selfPayload(player, room) {
  return {
    playerId: player.playerId,
    name: player.name,
    isHost: player.isHost,
    ticket: player.ticket,
    marked: [...player.marked],
    hasWon: player.hasWon,
    roomId: room.id,
  };
}

function roomById(roomId) {
  return rooms.get(String(roomId || "").toUpperCase()) || null;
}

app.use(express.static(PUBLIC_DIR));

app.get("/health", (_req, res) => {
  res.json({ ok: true, rooms: rooms.size });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

io.on("connection", (socket) => {
  socket.on("room:create", ({ playerLimit, name, playerId }) => {
    const limit = Math.max(1, Math.min(Number(playerLimit) || 20, 100));
    const room = createRoom(limit);

    const myPlayerId = String(playerId || crypto.randomBytes(16).toString("hex"));
    const ticket = generateTicket(room.ticketHashes);

    const player = {
      playerId: myPlayerId,
      name: String(name || "Host").trim().slice(0, 32) || "Host",
      ticket,
      marked: new Set(),
      hasWon: false,
      connected: true,
      joinedAt: Date.now(),
      lastSeen: Date.now(),
      isHost: true,
      socketId: socket.id,
    };

    room.players.set(player.playerId, player);
    setHost(room, player.playerId);

    socket.join(room.id);
    socket.data = socket.data || {};
    socket.data.roomId = room.id;
    socket.data.playerId = player.playerId;

    socket.emit("room:created", {
      roomId: room.id,
      playerId: player.playerId,
      room: serializeRoom(room),
    });
    socket.emit("self:state", selfPayload(player, room));
    emitRoomState(room);
    checkAndStartTimer(room);
  });

  socket.on("room:join", ({ roomId, playerId, name }) => {
    const room = roomById(roomId);
    if (!room) {
      socket.emit("app:error", { message: "Room not found." });
      return;
    }

    const normalizedName = String(name || "").trim().slice(0, 32);
    if (!normalizedName) {
      socket.emit("app:error", { message: "Enter a name." });
      return;
    }

    const myPlayerId = String(playerId || crypto.randomBytes(16).toString("hex"));
    const existing = room.players.get(myPlayerId);

    if (!existing && room.players.size >= room.playerLimit) {
      socket.emit("app:error", { message: "Room is full." });
      return;
    }

    let finalName = normalizedName;
    let counter = 2;
    while ([...room.players.values()].some((p) => p.name.toLowerCase() === finalName.toLowerCase() && p.playerId !== myPlayerId)) {
      finalName = `${normalizedName} ${counter}`;
      counter++;
    }

    let player = existing;
    if (!player) {
      const ticket = generateTicket(room.ticketHashes);
      player = {
        playerId: myPlayerId,
        name: finalName,
        ticket,
        marked: new Set(),
        hasWon: false,
        connected: true,
        joinedAt: Date.now(),
        lastSeen: Date.now(),
        isHost: false,
        socketId: socket.id,
      };
      room.players.set(myPlayerId, player);
      if (!room.hostPlayerId) setHost(room, myPlayerId);
    } else {
      player.name = finalName;
      player.connected = true;
      player.lastSeen = Date.now();
      player.socketId = socket.id;
    }

    socket.join(room.id);
    socket.data = socket.data || {};
    socket.data.roomId = room.id;
    socket.data.playerId = player.playerId;

    ensureHost(room);
    socket.emit("self:state", selfPayload(player, room));
    socket.emit("room:state", serializeRoom(room));
    emitRoomState(room);

    checkAndStartTimer(room);
  });

  socket.on("room:reconnect", ({ roomId, playerId }) => {
    const room = roomById(roomId);
    if (!room) {
      socket.emit("app:error", { message: "Room not found." });
      return;
    }

    const player = room.players.get(String(playerId || ""));
    if (!player) {
      socket.emit("app:error", { message: "Player session not found. Please join normally." });
      return;
    }

    player.connected = true;
    player.lastSeen = Date.now();
    player.socketId = socket.id;

    socket.join(room.id);
    socket.data = socket.data || {};
    socket.data.roomId = room.id;
    socket.data.playerId = player.playerId;

    ensureHost(room);
    socket.emit("self:state", selfPayload(player, room));
    socket.emit("room:state", serializeRoom(room));
    emitRoomState(room);
    checkAndStartTimer(room);
  });

  socket.on("vote:draw", ({ roomId, playerId }) => {
    const room = roomById(roomId);
    if (!room || room.paused || room.winner) return;

    if (Date.now() - room.lastDrawTime < 3500) return; // Wait 3.5s before allowing next draw

    const player = room.players.get(String(playerId || ""));
    if (!player || !player.connected) return;

    room.votes.add(player.playerId);

    const activeConnected = [...room.players.values()].filter((p) => p.connected);
    const requiredVotes = activeConnected.length || room.players.size;

    io.to(room.id).emit("room:vote_state", {
      voteCount: room.votes.size,
      requiredVotes,
    });

    if (room.votes.size >= requiredVotes) {
      drawNextNumber(room.id, "vote");
    }
  });

  socket.on("ticket:toggleMark", ({ roomId, playerId, number }) => {
    const room = roomById(roomId);
    if (!room || room.paused) return;

    const player = room.players.get(String(playerId || ""));
    const num = Number(number);

    if (!player || !room.calledNumbers.includes(num)) return;

    if (player.marked.has(num)) return;
    player.marked.add(num);

    if (!player.hasWon && fullHouseComplete(player)) {
      player.hasWon = true;
      room.winner = { playerId: player.playerId, name: player.name, at: Date.now() };
      clearDrawTimer(room); // Stop the countdown
      io.to(room.id).emit("game:won", room.winner);
    }

    socket.emit("self:state", selfPayload(player, room));
    emitRoomState(room);
  });

  socket.on("admin:toggle_pause", ({ roomId, playerId }) => {
    const room = roomById(roomId);
    if (!room) return;
    const player = room.players.get(String(playerId || ""));
    if (!player || !player.isHost) return;

    room.paused = !room.paused;
    if (room.paused) {
      if (room.drawDeadline) room.pausedRemainingMs = Math.max(1000, room.drawDeadline - Date.now());
      clearDrawTimer(room);
    } else {
      checkAndStartTimer(room);
    }
    emitRoomState(room);
  });

  socket.on("admin:set_timer", ({ roomId, playerId, timerMs }) => {
    const room = roomById(roomId);
    if (!room) return;
    const player = room.players.get(String(playerId || ""));
    if (!player || !player.isHost) return;

    const ms = Math.max(5000, Math.min(Number(timerMs) || 30000, 300000));
    room.timerMs = ms;
    if (!room.paused) scheduleAutoDraw(room);
    emitRoomState(room);
  });

  socket.on("admin:kick", ({ roomId, playerId, targetPlayerId }) => {
    const room = roomById(roomId);
    if (!room) return;
    const player = room.players.get(String(playerId || ""));
    if (!player || !player.isHost) return;

    const target = room.players.get(String(targetPlayerId || ""));
    if (!target) return;

    room.votes.delete(target.playerId);
    room.players.delete(target.playerId);

    io.to(target.socketId || "").emit("app:kicked", { roomId: room.id });
    ensureHost(room);
    checkAndStartTimer(room);
    emitRoomState(room);
  });

  socket.on("admin:force_draw", ({ roomId, playerId }) => {
    const room = roomById(roomId);
    if (!room) return;
    const player = room.players.get(String(playerId || ""));
    if (!player || !player.isHost) return;
    drawNextNumber(room.id, "admin");
  });

  socket.on("room:request_state", ({ roomId, playerId }) => {
    const room = roomById(roomId);
    if (!room) return;
    const player = room.players.get(String(playerId || ""));
    if (!player) return;
    socket.emit("self:state", selfPayload(player, room));
    socket.emit("room:state", serializeRoom(room));
  });

  socket.on("disconnect", () => {
    const roomId = socket.data.roomId;
    const playerId = socket.data.playerId;
    const room = roomById(roomId);
    if (!room) return;
    const player = room.players.get(String(playerId || ""));
    if (!player) return;

    player.connected = false;
    player.lastSeen = Date.now();

    if (room.hostPlayerId === player.playerId) {
      ensureHost(room);
    }
    checkAndStartTimer(room);

    emitRoomState(room);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Tambola Pro Ready running on port ${PORT}`);
});
