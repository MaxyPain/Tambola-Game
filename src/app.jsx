
import React, { useEffect, useMemo, useReducer, useRef } from "react";
import { createRoot } from "react-dom/client";
import { io } from "socket.io-client";
import "./styles.css";

const socket = io({
  transports: ["websocket", "polling"],
});

function getLocal(key, fallback = "") {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function setLocal(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

function generateId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);
}

function getPlayerId() {
  const existing = getLocal("tambola_player_id");
  if (existing) return existing;
  const id = generateId();
  setLocal("tambola_player_id", id);
  return id;
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

function makeConfetti() {
  const layer = document.createElement("div");
  layer.className = "confetti-layer";
  const colors = ["#7c9cff", "#69e2b4", "#ffd166", "#ff7f7f", "#ffffff"];

  for (let i = 0; i < 120; i += 1) {
    const piece = document.createElement("div");
    piece.className = "confetti";
    piece.style.left = `${Math.random() * 100}vw`;
    piece.style.top = `${-10 - Math.random() * 30}vh`;
    piece.style.background = colors[i % colors.length];
    piece.style.transform = `rotate(${Math.random() * 360}deg)`;
    piece.style.animationDuration = `${2.2 + Math.random() * 2.3}s`;
    piece.style.animationDelay = `${Math.random() * 0.5}s`;
    piece.style.opacity = String(0.8 + Math.random() * 0.2);
    piece.style.width = `${6 + Math.random() * 8}px`;
    piece.style.height = `${10 + Math.random() * 14}px`;
    layer.appendChild(piece);
  }

  document.body.appendChild(layer);
  window.setTimeout(() => layer.remove(), 4500);
}

function playTone(type = "draw") {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.connect(gain);
    gain.connect(ctx.destination);

    if (type === "win") {
      oscillator.type = "triangle";
      oscillator.frequency.setValueAtTime(660, now);
      oscillator.frequency.exponentialRampToValueAtTime(990, now + 0.18);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.18, now + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
      oscillator.start(now);
      oscillator.stop(now + 0.65);
    } else {
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(420, now);
      oscillator.frequency.exponentialRampToValueAtTime(220, now + 0.12);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      oscillator.start(now);
      oscillator.stop(now + 0.2);
    }

    oscillator.onended = () => ctx.close().catch(() => {});
  } catch {}
}

function speak(text) {
  try {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.9;
    u.pitch = 1;
    u.lang = "en-US";
    window.speechSynthesis.speak(u);
  } catch {}
}

const initialState = {
  connection: "connecting",
  roomId: "",
  playerId: getPlayerId(),
  name: getLocal("tambola_name", ""),
  roomLimit: 2,
  ticket: null,
  marked: [],
  room: null,
  players: [],
  calledNumbers: [],
  currentNumber: null,
  speech: "",
  voteCount: 0,
  requiredVotes: 0,
  timerMs: 30000,
  drawDeadline: null,
  winner: null,
  paused: false,
  isHost: false,
  error: "",
  info: "",
  showWinner: false,
  showNumberPopup: false,
  voteCooldown: false,
};

function reducer(state, action) {
  switch (action.type) {
    case "set":
      return { ...state, ...action.payload };
    case "error":
      return { ...state, error: action.message, info: "" };
    case "info":
      return { ...state, info: action.message, error: "" };
    case "clear_msg":
      return { ...state, error: "", info: "" };
    case "room_created":
      return {
        ...state,
        roomId: action.roomId,
        room: action.room,
        ticket: action.self.ticket,
        marked: action.self.marked,
        isHost: action.self.isHost,
        name: action.self.name,
        error: "",
      };
    case "self_state":
      return {
        ...state,
        ticket: action.self.ticket,
        marked: action.self.marked,
        isHost: action.self.isHost,
        name: action.self.name,
        roomId: action.self.roomId,
        error: "",
        info: state.info === "Joining room..." ? "Joined successfully! Scroll down for your ticket." : state.info,
      };
    case "room_state":
      return {
        ...state,
        room: action.room,
        roomId: action.room.id,
        players: action.room.players || [],
        calledNumbers: action.room.calledNumbers || [],
        voteCount: action.room.voteCount || 0,
        requiredVotes: action.room.requiredVotes || 0,
        timerMs: action.room.timerMs || 30000,
        drawDeadline: action.room.drawDeadline || null,
        winner: action.room.winner || null,
        paused: !!action.room.paused,
        isHost: !!action.room.players?.find((p) => p.playerId === action.selfId && p.isHost),
      };
    case "drawn":
      return {
        ...state,
        currentNumber: action.number,
        speech: action.speech,
        voteCount: 0,
        showWinner: false,
        showNumberPopup: true,
      };
    case "winner":
      return { ...state, winner: action.winner, showWinner: true };
    case "hide_popup":
      return { ...state, showNumberPopup: false };
    case "kicked":
      return { ...state, roomId: "", room: null, ticket: null, marked: [], players: [], calledNumbers: [], currentNumber: null, info: "", error: "You were removed from the room." };
    default:
      return state;
  }
}

function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [roomInput, setRoomInput] = React.useState(getLocal("tambola_room", ""));
  const [nameInput, setNameInput] = React.useState(state.name || "");
  const [playerLimit, setPlayerLimit] = React.useState(20);
  const [timerValue, setTimerValue] = React.useState(30);
  const [countdown, setCountdown] = React.useState(null);
  const [draftReady, setDraftReady] = React.useState(false);
  const ticketGridRef = useRef(null);

  useEffect(() => setNameInput(state.name || ""), [state.name]);
  useEffect(() => setRoomInput(state.roomId || getLocal("tambola_room", "")), [state.roomId]);

  useEffect(() => {
    const onConnect = () => dispatch({ type: "set", payload: { connection: "connected" } });
    const onDisconnect = () => dispatch({ type: "set", payload: { connection: "offline" } });

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);

    socket.on("app:error", ({ message }) => dispatch({ type: "error", message }));
    socket.on("app:info", ({ message }) => dispatch({ type: "info", message }));
    socket.on("app:kicked", () => dispatch({ type: "kicked" }));

    socket.on("room:created", ({ roomId, playerId, room }) => {
      setLocal("tambola_room", roomId);
      setLocal("tambola_player_id", playerId);
      dispatch({ type: "room_created", roomId, room, self: { ticket: null, marked: [], isHost: true, name: nameInput || "Host" } });
      dispatch({ type: "info", message: "Room created. Share the code or link." });
      setRoomInput(roomId);
    });

    socket.on("self:state", (self) => {
      dispatch({ type: "self_state", self });
      if (self.name) setLocal("tambola_name", self.name);
      setLocal("tambola_room", self.roomId);
      setLocal("tambola_player_id", self.playerId);
    });

    socket.on("room:state", (room) => {
      const selfId = getLocal("tambola_player_id");
      dispatch({ type: "room_state", room, selfId });
      if (room.winner) {
        dispatch({ type: "winner", winner: room.winner });
      }
    });

    socket.on("room:vote_state", ({ voteCount, requiredVotes }) => {
      dispatch({ type: "set", payload: { voteCount, requiredVotes } });
    });

    socket.on("number:drawn", ({ number, speech }) => {
      dispatch({ type: "drawn", number, speech });
      setCountdown(null);
      playTone("draw");
      speak(speech);
      const el = document.getElementById("current-number");
      if (el) {
        el.classList.remove("pulse");
        void el.offsetWidth;
        el.classList.add("pulse");
      }
    });

    socket.on("game:won", (winner) => {
      dispatch({ type: "winner", winner });
      makeConfetti();
      playTone("win");
    });

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("app:error");
      socket.off("app:info");
      socket.off("app:kicked");
      socket.off("room:created");
      socket.off("self:state");
      socket.off("room:state");
      socket.off("room:vote_state");
      socket.off("number:drawn");
      socket.off("game:won");
    };
  }, []);

  useEffect(() => {
    if (!state.drawDeadline || state.paused) {
      setCountdown(null);
      return;
    }
    const tick = () => {
      const left = Math.max(0, Math.ceil((state.drawDeadline - Date.now()) / 1000));
      setCountdown(left);
    };
    tick();
    const timer = setInterval(tick, 500);
    return () => clearInterval(timer);
  }, [state.drawDeadline, state.paused]);

  useEffect(() => {
    if (!state.showWinner) return;
    const t = setTimeout(() => dispatch({ type: "set", payload: { showWinner: false } }), 5000);
    return () => clearTimeout(t);
  }, [state.showWinner]);

  useEffect(() => {
    if (!state.showNumberPopup) return;
    const t = setTimeout(() => dispatch({ type: "hide_popup" }), 3500);
    return () => clearTimeout(t);
  }, [state.showNumberPopup]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomFromUrl = params.get("room");
    if (roomFromUrl) {
      const upperRoom = roomFromUrl.toUpperCase();
      setRoomInput(upperRoom);
      
      const localRoom = getLocal("tambola_room", "");
      if (localRoom === upperRoom) {
        const playerId = getLocal("tambola_player_id", getPlayerId());
        socket.emit("room:reconnect", {
          roomId: upperRoom,
          playerId,
        });
      } else {
        dispatch({ type: "info", message: `Ready to join room ${upperRoom}. Enter your name and click Join.` });
      }
    }
  }, []);

  const shareLink = useMemo(() => {
    if (!state.roomId) return "";
    return `${window.location.origin}${window.location.pathname}?room=${state.roomId}`;
  }, [state.roomId]);

  const createRoom = () => {
    const name = (nameInput || "Host").trim();
    if (!name) return dispatch({ type: "error", message: "Enter your name." });
    socket.emit("room:create", {
      playerLimit: Number(playerLimit) || 20,
      name,
      playerId: getPlayerId(),
    });
  };

  const joinRoom = () => {
    const roomId = (roomInput || "").trim().toUpperCase();
    const name = (nameInput || "").trim();
    if (!roomId) return dispatch({ type: "error", message: "Enter a room code." });
    if (!name) return dispatch({ type: "error", message: "Enter your name." });
    setLocal("tambola_name", name);
    setLocal("tambola_room", roomId);
    dispatch({ type: "info", message: "Joining room..." });
    socket.emit("room:join", {
      roomId,
      playerId: getPlayerId(),
      name,
    });
  };

  const reconnectRoom = () => {
    const roomId = (roomInput || "").trim().toUpperCase();
    if (!roomId) return;
    socket.emit("room:reconnect", {
      roomId,
      playerId: getPlayerId(),
    });
  };

  const voteDraw = () => {
    if (!state.roomId || state.showNumberPopup || state.winner) return;
    socket.emit("vote:draw", {
      roomId: state.roomId,
      playerId: getPlayerId(),
    });
  };

  const toggleMark = (value) => {
    if (!state.roomId) return;
    if (state.marked.includes(value)) return;
    socket.emit("ticket:toggleMark", {
      roomId: state.roomId,
      playerId: getPlayerId(),
      number: value,
    });
  };

  const kickPlayer = (targetPlayerId) => {
    if (!state.roomId) return;
    socket.emit("admin:kick", {
      roomId: state.roomId,
      playerId: getPlayerId(),
      targetPlayerId,
    });
  };

  const togglePause = () => {
    if (!state.roomId) return;
    socket.emit("admin:toggle_pause", {
      roomId: state.roomId,
      playerId: getPlayerId(),
    });
  };

  const forceDraw = () => {
    if (!state.roomId) return;
    socket.emit("admin:force_draw", {
      roomId: state.roomId,
      playerId: getPlayerId(),
    });
  };

  const setTimer = () => {
    if (!state.roomId) return;
    socket.emit("admin:set_timer", {
      roomId: state.roomId,
      playerId: getPlayerId(),
      timerMs: Number(timerValue) * 1000,
    });
  };

  const current = state.currentNumber ? String(state.currentNumber).padStart(2, "0") : "--";
  const isConnected = state.connection === "connected";

  return (
    <div className="shell">
      <div className="header">
        <div className="brand">
          <h1>Tambola Pro</h1>
          <p>Multi-device local or public room play with consensus draw, auto fallback, and admin controls.</p>
        </div>
        <div className="pill">{isConnected ? "Connected" : "Disconnected"} · {state.roomId ? `Room ${state.roomId}` : "No room"}</div>
      </div>

      <div className="grid">
        <section className="card">
          <div className="card-header">
            <h2>Room Control</h2>
          </div>
          <div className="card-body stack">
            <div>
              <label>Your name</label>
              <input
                className="input"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="Enter your name"
              />
            </div>

            <div>
              <label>Expected number of players</label>
              <input
                className="input"
                type="number"
                min="1"
                max="100"
                value={playerLimit}
                onChange={(e) => setPlayerLimit(e.target.value)}
              />
            </div>

            <button className="button full" onClick={createRoom}>Create Room</button>

            <div className="hr" />

            <div>
              <label>Room code</label>
              <input
                className="input"
                value={roomInput}
                onChange={(e) => setRoomInput(e.target.value.toUpperCase())}
                placeholder="Enter room code"
                maxLength={8}
              />
            </div>

            <div className="row">
              <button className="button secondary" onClick={joinRoom} style={{ flex: 1 }}>Join Room</button>
              <button className="button secondary" onClick={reconnectRoom} style={{ flex: 1 }}>Rejoin</button>
            </div>

            {state.roomId && (
              <>
                <div className="notice">
                  Share this link with phones on the same Wi‑Fi or the public internet:
                  <div style={{ marginTop: 8, wordBreak: "break-all", fontWeight: 800 }}>{shareLink}</div>
                </div>

                <div className="row">
                  <button
                    className="button secondary"
                    onClick={async () => {
                      try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                  await navigator.clipboard.writeText(shareLink);
                  dispatch({ type: "info", message: "Link copied." });
                } else {
                  dispatch({ type: "error", message: "Copy not supported on this browser." });
                }
                      } catch {
                        dispatch({ type: "error", message: "Could not copy link." });
                      }
                    }}
                    style={{ flex: 1 }}
                  >
                    Copy Link
                  </button>
                  <button className="button secondary" onClick={async () => {
                    try {
              if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(state.roomId);
                dispatch({ type: "info", message: "Room code copied." });
              } else {
                dispatch({ type: "error", message: "Copy not supported on this browser." });
              }
                    } catch {
                      dispatch({ type: "error", message: "Could not copy room code." });
                    }
                  }} style={{ flex: 1 }}>
                    Copy Code
                  </button>
                </div>
              </>
            )}

            <div className="help">
              Each device keeps its own player key in browser storage, so refresh returns the same ticket and state.
            </div>

            {(state.error || state.info) && (
              <div className="notice" style={{ background: state.error ? "rgba(255,127,127,0.14)" : "rgba(105,226,180,0.12)", borderColor: state.error ? "rgba(255,127,127,0.24)" : "rgba(105,226,180,0.24)" }}>
                {state.error || state.info}
              </div>
            )}
          </div>

          <div className="hr" />

          <div className="card-header" style={{ paddingBottom: 0 }}>
            <h3>Admin Panel</h3>
          </div>

          <div className="card-body stack">
            <div className="flex-between">
              <div>
                <div className="help">Timer</div>
                <div className="timer">{state.winner ? "Ended" : state.paused ? "Paused" : `${countdown ?? Math.ceil((state.timerMs || 30000) / 1000)}s`}</div>
              </div>
              <div>
                <div className="help">Votes</div>
                <div className="timer">{state.voteCount}/{state.requiredVotes || 0}</div>
              </div>
            </div>

            <div className="row">
              <button className="button secondary" onClick={togglePause} style={{ flex: 1 }}>{state.paused ? "Resume" : "Pause"}</button>
              <button className="button secondary" onClick={forceDraw} style={{ flex: 1 }}>Force Draw</button>
            </div>

            <div className="row">
              <select className="select" value={timerValue} onChange={(e) => setTimerValue(Number(e.target.value))} style={{ flex: 1 }}>
                <option value={10}>10 sec</option>
                <option value={15}>15 sec</option>
                <option value={20}>20 sec</option>
                <option value={30}>30 sec</option>
                <option value={45}>45 sec</option>
                <option value={60}>60 sec</option>
              </select>
              <button className="button secondary" onClick={setTimer} style={{ flex: 1 }}>Set Timer</button>
            </div>

            <div className="help">
              Host can pause, resume, change timer duration, force a draw, and remove players from the room.
            </div>

            <div className="list">
              {state.players.map((p) => (
                <div className="player-row" key={p.playerId}>
                  <div>
                    <strong>{p.name}</strong>
                    <div className="mini">{p.connected ? "Online" : "Offline"} · {p.hasWon ? "Winner" : "Playing"}</div>
                  </div>
                  <div className="row" style={{ alignItems: "center" }}>
                    {p.isHost && <span className="badge host">Host</span>}
                    {p.hasWon && <span className="badge win">Winner</span>}
                    {!p.connected && <span className="badge offline">Offline</span>}
                    {state.isHost && !p.isHost && (
                      <button className="button danger small" onClick={() => kickPlayer(p.playerId)}>Kick</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="stack">
          <div className="card big-number-card">
            <div className="flex-between">
              <h2>Current Number</h2>
              <span className="timer">Room {state.roomId || "—"}</span>
            </div>
            <div id="current-number" className="big-number" style={{ marginTop: 16 }}>{current}</div>
            <div className="subtle">
              {state.currentNumber ? state.speech : "Waiting for the first draw."}
            </div>

            <div className="board">
              {Array.from({ length: 90 }, (_, i) => i + 1).map((n) => {
                const called = state.calledNumbers.includes(n);
                const active = state.currentNumber === n;
                return (
                  <div className={`ball ${called ? "called" : ""} ${active ? "active" : ""} ${state.winner ? "winner" : ""}`} key={n}>
                    {String(n).padStart(2, "0")}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h2>All Called Numbers</h2>
            </div>
            <div className="card-body">
              <div className="summary" style={{ justifyContent: "flex-start", maxHeight: 150, overflowY: "auto" }}>
                {state.calledNumbers.length === 0 ? <span className="subtle">No numbers drawn yet.</span> : state.calledNumbers.map((n) => (
                  <span className="chip" key={n}>{String(n).padStart(2, "0")}</span>
                ))}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div className="flex-between">
                <h2>Your Ticket</h2>
                <span className="timer">{state.marked.length} marked</span>
              </div>
            </div>
            <div className="card-body">
              {!state.ticket ? (
                <div className="help">Join a room to receive your ticket.</div>
              ) : (
                <div className="ticket-wrap" ref={ticketGridRef}>
                  <div className="help">Tap only the numbers that have already been called.</div>
                  <div className="ticket">
                    {[].concat(...state.ticket).map((cell, index) => {
                      if (cell === null) {
                        return <div className="cell empty" key={index} />;
                      }
                      const marked = state.marked.includes(cell);
                    const calledIndex = state.calledNumbers.indexOf(cell);
                    const clickable = calledIndex !== -1;
                    const missed = !marked && clickable && (state.calledNumbers.length - calledIndex > 2);
                      return (
                        <div
                        className={`cell ${marked ? "marked" : ""} ${clickable && !marked ? "clickable" : ""} ${missed ? "missed" : ""}`}
                          key={index}
                        onClick={() => clickable && !marked && toggleMark(cell)}
                        role={clickable && !marked ? "button" : undefined}
                        tabIndex={clickable && !marked ? 0 : undefined}
                        >
                          {cell}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h2>Game Status</h2>
            </div>
            <div className="card-body stack">
              <div className="notice">
                {state.paused ? "The game is paused." : state.winner ? `Winner: ${state.winner.name}` : 
                 state.room && state.players.filter(p => p.connected).length < state.room.playerLimit ? `Waiting for more players... (${state.players.filter(p => p.connected).length}/${state.room.playerLimit}). Timer will start automatically.` :
                 state.room ? "Game in progress." : "Create or join a room to start."}
              </div>
              <div className="flex-between">
                <span className="timer">Connected players: {state.players.filter((p) => p.connected).length}</span>
                <span className="timer">Room limit: {state.room?.playerLimit || state.roomLimit}</span>
              </div>
            </div>
          </div>
        </section>
      </div>

      {state.roomId && !state.winner && (
        <button className="fab" onClick={voteDraw} style={state.showNumberPopup ? { opacity: 0.6, pointerEvents: "none" } : {}}>
          <span>{state.showNumberPopup ? "Calling..." : "Vote / Draw Next"}</span>
          <small>{state.voteCount}/{state.requiredVotes || 0}</small>
        </button>
      )}

      {state.showWinner && state.winner && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="timer">Winner</div>
            <h2>{state.winner.name}</h2>
            <p>Full house completed. Confetti and sound triggered for all connected devices.</p>
            <div className="row" style={{ justifyContent: "center" }}>
              <button className="button success" onClick={() => dispatch({ type: "set", payload: { showWinner: false } })}>Close</button>
            </div>
          </div>
        </div>
      )}

      {state.showNumberPopup && state.currentNumber && (
        <div className="number-popup-backdrop">
          <div className="number-popup pulse">
            {state.currentNumber}
          </div>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
