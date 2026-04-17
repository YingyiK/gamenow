/* ─────────────────────────────────────────────────────────────
   UNO Frontend — uno.js
   Shared string/emoji/localStorage helpers: /game-shared.js (load first).

   File map (top → bottom):
     Constants & state → URL helpers → Boot
     Views → Session → Events → Room actions → Game actions
     Data fetch (REST) → WebSocket → Render (lobby / room / game)
     Card helpers → Utils (api, toast, requireName)
   ───────────────────────────────────────────────────────────── */

const {
  readJson,
  escapeHtml: esc,
  firstEmoji,
  stripLeadingEmoji: stripEmoji,
  pickRandomAnimalEmoji,
  numericRoomCode,
  compositeRoomId,
} = window.GameNowCommon;

const REST_URL = "https://9tnuo0hn4k.execute-api.us-west-2.amazonaws.com/prod";
const WS_URL   = "wss://dzhq6f9ar8.execute-api.us-west-2.amazonaws.com/prod";
const SESSION_KEY = "gamenowUnoSession";
const PROFILE_KEY = "gamenowUnoProfileName";

const state = {
  session: null,
  room: null,
  game: null,
  chat: [],
  ws: null,
  wsIntentionalClose: false,
  roomJoined: false,
  profileName: "",
  selectedCard: null,
  pendingWildCard: null,
};

/* ── URL ↔ room id (guest vs live; mirrors app route + isViewingLiveRoom) ─── */

function getUnoRoomIdFromPath() {
  const m = window.location.pathname.match(/\/uno\/(\d{4})/);
  return m ? m[1] : null;
}

function roomsApiPath(gameType, numericRoomId) {
  return `/rooms/by-code/${gameType}/${numericRoomId}`;
}

/** Session exists and matches the room id in the current URL (same idea as app.js isViewingLiveRoom). */
function isLiveUnoRoom() {
  const id = getUnoRoomIdFromPath();
  return Boolean(state.session && id && numericRoomCode(state.session.roomId) === String(id));
}

/* ── Boot ──────────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", () => {
  loadSession();
  bindEvents();
  const pathRoomId = getUnoRoomIdFromPath();
  if (pathRoomId) {
    const input = document.getElementById("room-code-input");
    if (input) input.value = pathRoomId;
    if (isLiveUnoRoom()) {
      void restoreSession();
    } else {
      disconnectSocket();
      state.room = null;
      state.game = null;
      state.chat = [];
      state.roomJoined = false;
      void fetchPublicRoom(pathRoomId).then(() => renderAll());
    }
  } else {
    renderAll();
  }
});

/* ── Views ─────────────────────────────────────────────────── */
function showView(name) {
  ["lobby","room","game"].forEach(v => {
    document.getElementById("view-" + v).classList.toggle("hidden", v !== name);
  });
  const forfeitNavBtn = document.getElementById("forfeit-nav-btn");
  if (forfeitNavBtn) forfeitNavBtn.classList.toggle("hidden", name !== "game");
  // 游戏进行中隐藏 Invite 按钮
  const copyLinkBtn = document.getElementById("copy-link-btn");
  if (copyLinkBtn) copyLinkBtn.classList.toggle("hidden", name === "game");
}

/* ── Session ───────────────────────────────────────────────── */
function loadSession() {
  const session = readJson(SESSION_KEY);
  if (session?.roomId != null) {
    const rid = String(session.roomId);
    if (/^\d{4}$/.test(rid)) {
      session.roomId = compositeRoomId("uno", rid);
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    }
  }
  state.session = session;
  state.profileName = localStorage.getItem(PROFILE_KEY) || state.session?.playerName || pickRandomAnimalEmoji();
  syncNameInputs(state.profileName);
}

function persistSession() {
  if (state.session) localStorage.setItem(SESSION_KEY, JSON.stringify(state.session));
  else localStorage.removeItem(SESSION_KEY);
}

function clearSession() {
  state.session = null; state.room = null; state.game = null;
  state.chat = []; state.roomJoined = false;
  persistSession(); disconnectSocket();
}

function setSession(data) {
  state.session = {
    roomId: data.roomId, playerId: data.playerId,
    playerToken: data.playerToken, playerName: data.playerName,
    hostPlayerId: data.hostPlayerId,
  };
  persistSession();
}

function syncNameInputs(value) {
  const v = String(value || "").trimStart().slice(0, 24);
  state.profileName = v;
  ["player-name-input","room-player-name-input"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = v;
  });
  localStorage.setItem(PROFILE_KEY, v);
}

/* ── Events ────────────────────────────────────────────────── */
function bindEvents() {
  document.getElementById("create-room-btn").addEventListener("click", createRoom);
  document.getElementById("join-room-btn").addEventListener("click", () => {
    const code = document.getElementById("room-code-input").value.replace(/\D/g,"").slice(0,4);
    if (code.length === 4) joinRoomByCode(code);
    else toast("Enter a 4-digit room code.", true);
  });
  document.getElementById("join-current-room-btn").addEventListener("click", () => {
    const m = window.location.pathname.match(/\/uno\/(\d{4})/);
    if (m) joinRoomByCode(m[1]);
  });
  document.getElementById("start-game-btn").addEventListener("click", startRoom);
  document.getElementById("leave-room-btn").addEventListener("click", leaveRoom);
  document.getElementById("leave-seat-btn").addEventListener("click", leaveRoom);
  document.getElementById("copy-link-btn").addEventListener("click", copyLink);
  document.getElementById("draw-pile").addEventListener("click", drawCard);
  document.getElementById("uno-shout-btn").addEventListener("click", shoutUno);
  document.getElementById("forfeit-nav-btn").addEventListener("click", forfeit);
  document.getElementById("restart-btn").addEventListener("click", restartGame);
  document.getElementById("send-chat-btn").addEventListener("click", sendChat);
  document.getElementById("chat-input").addEventListener("keydown", e => { if (e.key === "Enter") sendChat(); });
  document.getElementById("player-name-input").addEventListener("input", e => syncNameInputs(e.target.value));
  document.getElementById("room-player-name-input").addEventListener("input", e => syncNameInputs(e.target.value));
  document.querySelectorAll(".color-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.getElementById("color-picker").classList.add("hidden");
      if (state.pendingWildCard) {
        submitPlayCard(state.pendingWildCard, btn.dataset.color);
        state.pendingWildCard = null;
      }
    });
  });
}

/* ── Room actions ──────────────────────────────────────────── */
async function createRoom() {
  try {
    const playerName = requireName();
    const room = await api("/rooms", { method: "POST", body: { gameType: "uno", playerName } });
    setSession(room);
    history.pushState({}, "", "/uno/" + numericRoomCode(room.roomId));
    document.getElementById("copy-link-btn").classList.remove("hidden");
    await restoreSession();
  } catch (e) { toast(e.message, true); }
}

async function joinRoomByCode(roomId) {
  try {
    if (numericRoomCode(state.session?.roomId) === roomId) {
      await restoreSession();
      return;
    }
    const playerName = requireName();
    const roomBase = roomsApiPath("uno", roomId);
    let room;
    try {
      room = await api(roomBase + "/join", { method: "POST", body: { playerName } });
    } catch (joinErr) {
      if (!/room not found/i.test(String(joinErr.message || ""))) {
        toast(joinErr.message, true);
        return;
      }
      try {
        room = await api("/rooms", { method: "POST", body: { gameType: "uno", playerName, roomId } });
      } catch (createErr) {
        if (!/already exists/i.test(String(createErr.message || ""))) {
          toast(createErr.message, true);
          return;
        }
        room = await api(roomBase + "/join", { method: "POST", body: { playerName } });
      }
    }
    setSession(room);
    history.pushState({}, "", "/uno/" + numericRoomCode(room.roomId));
    document.getElementById("copy-link-btn").classList.remove("hidden");
    await restoreSession();
  } catch (e) {
    toast(e.message, true);
  }
}

async function leaveRoom() {
  if (!state.session) return;
  try {
    await api(roomsApiPath("uno", numericRoomCode(state.session.roomId)) + "/leave", {
      method: "POST",
      body: { playerId: state.session.playerId, playerToken: state.session.playerToken },
    });
  } catch (_) {}
  clearSession();
  history.pushState({}, "", "/uno");
  document.getElementById("copy-link-btn").classList.add("hidden");
  renderAll();
}

async function startRoom() {
  if (!state.session) return;
  try {
    await api("/uno/" + numericRoomCode(state.session.roomId) + "/start", {
      method: "POST",
      body: { playerId: state.session.playerId, playerToken: state.session.playerToken },
    });
    await refreshAll();
  } catch (e) { toast(e.message, true); }
}

async function restoreSession() {
  if (!state.session) return;
  await refreshAll();
  connectSocket();
}

/* ── Game actions ──────────────────────────────────────────── */
function onCardClick(cardStr) {
  if (!state.game?.isYourTurn) { toast("It's not your turn.", true); return; }
  if (state.selectedCard === cardStr) {
    playCard(cardStr);
  } else {
    state.selectedCard = cardStr;
    renderHand();
  }
}

async function playCard(cardStr) {
  if (cardStr.startsWith("Wild:")) {
    state.pendingWildCard = cardStr;
    document.getElementById("color-picker").classList.remove("hidden");
    return;
  }
  await submitPlayCard(cardStr, null);
}

async function submitPlayCard(cardStr, chosenColor) {
  state.selectedCard = null;
  try {
    const data = await api("/uno/" + numericRoomCode(state.session.roomId) + "/play", {
      method: "POST",
      body: {
        playerId: state.session.playerId,
        playerToken: state.session.playerToken,
        card: cardStr,
        chosenColor: chosenColor || null,
      },
    });
    state.game = data;
    renderGame();
  } catch (e) { toast(e.message, true); renderHand(); }
}

async function drawCard() {
  if (!state.session || !state.game?.isYourTurn) return;
  try {
    const data = await api("/uno/" + numericRoomCode(state.session.roomId) + "/draw", {
      method: "POST",
      body: { playerId: state.session.playerId, playerToken: state.session.playerToken },
    });
    state.game = data;
    renderGame();
  } catch (e) { toast(e.message, true); }
}

async function shoutUno() {
  if (!state.session) return;
  try {
    const data = await api("/uno/" + numericRoomCode(state.session.roomId) + "/uno", {
      method: "POST",
      body: { playerId: state.session.playerId, playerToken: state.session.playerToken },
    });
    state.game = data;
    renderGame();
    toast("UNO! 🃏");
  } catch (e) { toast(e.message, true); }
}

async function forfeit() {
  if (!state.session || !confirm("End this game and return to room?")) return;
  try {
    await api("/uno/" + numericRoomCode(state.session.roomId) + "/forfeit", {
      method: "POST",
      body: { playerId: state.session.playerId, playerToken: state.session.playerToken },
    });
    state.game = null;
    await refreshAll();
  } catch (e) { toast(e.message, true); }
}

async function restartGame() {
  if (!state.session) return;
  try {
    await api("/uno/" + numericRoomCode(state.session.roomId) + "/start", {
      method: "POST",
      body: { playerId: state.session.playerId, playerToken: state.session.playerToken },
    });
    if (state.room) state.room.status = "playing";
    await refreshAll();
  } catch (e) { toast(e.message, true); }
}

function sendChat() {
  const input = document.getElementById("chat-input");
  const msg = input.value.trim();
  if (!msg) return;
  sendWs({ action: "sendChat", message: msg });
  input.value = "";
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(window.location.href);
    toast("Link copied! Share with friends.");
  } catch (_) { toast("Copy the URL from your browser.", true); }
}

/* ── Data fetch ────────────────────────────────────────────── */
async function refreshAll() {
  if (!state.session) {
    renderAll();
    return;
  }
  try {
    await fetchRoom();
    if (state.room?.status === "playing" || state.room?.status === "finished") {
      await fetchGame();
    }
  } catch (e) { toast(e.message, true); }
  renderAll();
}

async function fetchRoom() {
  state.room = await api(roomsApiPath("uno", numericRoomCode(state.session.roomId)));
  state.session.hostPlayerId = state.room.hostPlayerId;
  persistSession();
}

async function fetchPublicRoom(roomId) {
  try {
    state.room = await api(roomsApiPath("uno", roomId));
  } catch (_) {}
}

async function fetchGame() {
  if (!state.session) return;
  const q = new URLSearchParams({ playerId: state.session.playerId, playerToken: state.session.playerToken });
  state.game = await api("/uno/" + numericRoomCode(state.session.roomId) + "?" + q.toString());
}

/* ── WebSocket ─────────────────────────────────────────────── */
function connectSocket() {
  if (!state.session) return;
  if (state.ws) { state.wsIntentionalClose = true; state.ws.close(); }
  state.wsIntentionalClose = false;
  state.ws = new WebSocket(WS_URL);

  state.ws.addEventListener("open", () => {
    sendWs({ action: "joinRoom", roomId: state.session.roomId,
      playerId: state.session.playerId, playerToken: state.session.playerToken });
    // fallback poll if WS join doesn't respond in 8s
    state._joinTimer = setTimeout(() => {
      if (!state.roomJoined) startPolling();
    }, 8000);
  });

  state.ws.addEventListener("message", handleWsMessage);

  state.ws.addEventListener("close", () => {
    state.ws = null; state.roomJoined = false;
    clearTimeout(state._joinTimer);
    if (!state.wsIntentionalClose && state.session) startPolling();
  });
}

function disconnectSocket() {
  clearTimeout(state._joinTimer); stopPolling();
  if (!state.ws) return;
  state.wsIntentionalClose = true; state.ws.close(); state.ws = null;
}

function startPolling() {
  stopPolling();
  if (!state.session) return;
  state._pollTimer = setInterval(() => { if (state.session) refreshAll(); else stopPolling(); }, 5000);
}

function stopPolling() {
  if (state._pollTimer) { clearInterval(state._pollTimer); state._pollTimer = null; }
}

async function handleWsMessage(event) {
  let payload;
  try { payload = JSON.parse(event.data); } catch (_) { return; }

  if (payload.type === "CHAT") {
    state.chat.push(payload);
    renderChat();
    return;
  }
  if (payload.type === "ROOM_JOINED") {
    state.roomJoined = true;
    clearTimeout(state._joinTimer); stopPolling();
    await refreshAll();
    return;
  }
  if (payload.type === "ROOM_JOIN_ERROR") {
    startPolling(); return;
  }
  if (payload.type === "GAME_STATE") {
    state.game = payload.state;
    if (state.game.phase === "playing" || state.game.phase === "finished") {
      if (state.room) state.room.status = state.game.phase;
    }
    renderAll();
    return;
  }
  if (["PLAYER_JOINED","PLAYER_LEFT","ROOM_STARTED","ROOM_UPDATED"].includes(payload.type)) {
    if (payload.type === "ROOM_UPDATED" && payload.status === "waiting") state.game = null;
    await refreshAll();
  }
}

function sendWs(payload) {
  if (state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(payload));
}

/* ── Render ────────────────────────────────────────────────── */
function renderAll() {
  const pathRoomId = getUnoRoomIdFromPath();

  if (!state.session) {
    if (pathRoomId && state.room) {
      showView("room");
      renderRoom();
      return;
    }
    showView("lobby");
    return;
  }

  if (!isLiveUnoRoom()) {
    if (pathRoomId && state.room) {
      showView("room");
      renderRoom();
      return;
    }
    showView("lobby");
    return;
  }

  const status = state.room?.status;
  if (status === "playing" || status === "finished") {
    showView("game");
    renderGame();
  } else {
    showView("room");
    renderRoom();
  }
}

function renderRoom() {
  const room = state.room;
  const roomId = getUnoRoomIdFromPath() || numericRoomCode(state.session?.roomId) || "----";
  document.getElementById("room-code-display").textContent = "Room code: " + roomId;
  document.getElementById("copy-link-btn").classList.toggle("hidden", !state.session);
  document.getElementById("leave-room-btn").classList.toggle("hidden", !state.session);

  // seat strip
  const seats = room?.players || [];
  const maxSeats = Math.max(6, seats.length + (seats.length < 6 ? 1 : 0));
  let seatHtml = "";
  for (let i = 0; i < Math.min(maxSeats, 6); i++) {
    const p = seats[i];
    if (!p) {
      seatHtml += `<div class="seat-card seat-empty"><div class="seat-avatar"><div class="seat-name">+</div><span class="seat-index">${i+1}</span></div><div class="seat-helper">Open seat</div></div>`;
    } else {
      const isMe = state.session?.playerId === p.playerId;
      const isHost = room?.hostPlayerId === p.playerId;
      const emoji = firstEmoji(p.playerName) || "🙂";
      const label = stripEmoji(p.playerName) || p.playerName || "Player " + (i+1);
      seatHtml += `<div class="seat-card"><div class="seat-avatar"><div class="seat-badge-stack">${isHost?'<span class="seat-badge">HOST</span>':''}${isMe?'<span class="seat-badge">YOU</span>':''}</div><div class="seat-name">${esc(emoji)}</div><span class="seat-index">${i+1}</span></div><div class="seat-helper">${esc(label)}</div></div>`;
    }
  }
  document.getElementById("seat-strip").innerHTML = seatHtml;

  // meta
  document.getElementById("room-meta").textContent = seats.length + " / 6 players · " + (room?.status || "waiting");

  // show waiting actions only if I'm in the room
  const amInRoom = state.session && seats.some(p => p.playerId === state.session.playerId);
  document.getElementById("room-waiting-actions").classList.toggle("hidden", !amInRoom);
  document.getElementById("room-guest-panel").classList.toggle("hidden", amInRoom);

  // host can start if ≥2 players
  const isHost = state.session?.playerId === room?.hostPlayerId;
  document.getElementById("start-game-btn").disabled = !isHost || seats.length < 2;
  document.getElementById("start-game-btn").textContent = isHost ? "Start Game" : "Waiting for host...";
}

function renderGame() {
  const g = state.game;
  if (!g) return;

  // winner banner
  const winnerBanner = document.getElementById("winner-banner");
  if (g.phase === "finished" && g.winnerPlayerId) {
    const winnerName = g.players.find(p => p.playerId === g.winnerPlayerId)?.playerName || g.winnerPlayerId;
    const isMe = g.winnerPlayerId === state.session?.playerId;
    winnerBanner.textContent = isMe ? "🎉 You won!" : "🏆 " + winnerName + " won!";
    winnerBanner.classList.remove("hidden");
    document.getElementById("restart-panel").classList.remove("hidden");
  } else {
    winnerBanner.classList.add("hidden");
    document.getElementById("restart-panel").classList.add("hidden");
  }

  // players strip
  const playersEl = document.getElementById("uno-players");
  playersEl.innerHTML = g.players.map(p => {
    const isMe = p.playerId === state.session?.playerId;
    const isCurrent = p.playerId === g.currentPlayerId;
    return `<div class="uno-player-chip ${isCurrent ? "active" : ""} ${isMe ? "you" : ""}">
      <div class="chip-name">${esc(p.playerName)}${isMe ? " (you)" : ""}</div>
      <div class="chip-count">🃏 ${p.handCount} cards</div>
      ${p.saidUno ? '<span class="uno-chip-badge uno-said">UNO!</span>' : ""}
    </div>`;
  }).join("");

  // colour strip
  const colorStrip = document.getElementById("color-strip");
  colorStrip.className = "current-color-strip c-" + (g.currentColor || "Wild");

  // turn indicator
  const turnEl = document.getElementById("turn-indicator");
  if (g.phase === "finished") {
    turnEl.textContent = "Game over";
    turnEl.className = "turn-indicator waiting";
  } else if (g.isYourTurn) {
    turnEl.textContent = "⚡ Your turn!";
    turnEl.className = "turn-indicator your-turn";
  } else {
    const currentName = g.players.find(p => p.playerId === g.currentPlayerId)?.playerName || "Opponent";
    turnEl.textContent = currentName + "'s turn...";
    turnEl.className = "turn-indicator waiting";
  }

  // pending draw banner
  const pendingBanner = document.getElementById("pending-banner");
  if (g.pendingDrawCount > 0 && g.isYourTurn) {
    pendingBanner.textContent = "⚠️ Play a draw card or draw " + g.pendingDrawCount + " cards!";
    pendingBanner.classList.remove("hidden");
  } else {
    pendingBanner.classList.add("hidden");
  }

  // top card
  renderCard(document.getElementById("top-card"), g.topCard, false, false);

  // draw pile
  const drawEl = document.getElementById("draw-pile");
  drawEl.classList.toggle("disabled", !g.isYourTurn || g.phase === "finished");
  document.getElementById("draw-count").textContent = g.drawPileCount + " cards";

  // direction
  document.getElementById("direction-indicator").className =
    "direction-indicator" + (g.direction === -1 ? " ccw" : "");

  // UNO button
  const unoBtnEl = document.getElementById("uno-shout-btn");
  const myHand = g.yourHand || [];
  unoBtnEl.disabled = myHand.length !== 1 || g.yourSaidUno || g.phase !== "playing";

  // forfeit button
  const forfeitNavBtn = document.getElementById("forfeit-nav-btn");
  if (forfeitNavBtn) forfeitNavBtn.classList.toggle("hidden", g.phase === "finished");

  // hand
  renderHand();
  renderChat();
}

function _sortHand(hand) {
  // 颜色排序：万能牌最前，其余按 Red/Yellow/Green/Blue
  const colorOrder = { "Wild": 0, "Red": 1, "Yellow": 2, "Green": 3, "Blue": 4 };
  // 数值排序：特殊牌（Skip/Reverse/+2/Wild+4）按名字排，数字牌按数字大小
  const valueOrder = v => {
    if (v === "Wild")    return -3;
    if (v === "Wild+4")  return -2;
    if (v === "Reverse") return 11;
    if (v === "Skip")    return 12;
    if (v === "+2")      return 13;
    const n = parseInt(v, 10);
    return isNaN(n) ? 99 : n;
  };
  return [...hand].sort((a, b) => {
    const ca = a.split(":"), cb = b.split(":");
    const colorA = colorOrder[ca[0]] ?? 9;
    const colorB = colorOrder[cb[0]] ?? 9;
    if (colorA !== colorB) return colorA - colorB;
    return valueOrder(ca[1]) - valueOrder(cb[1]);
  });
}

function renderHand() {
  const g = state.game;
  if (!g) return;
  const handEl = document.getElementById("your-hand");
  const myHand = _sortHand(g.yourHand || []);
  const topCard = g.topCard ? parseCard(g.topCard) : null;
  const currentColor = g.currentColor;
  const isMyTurn = g.isYourTurn && g.phase === "playing";
  const pending = g.pendingDrawCount || 0;

  handEl.innerHTML = myHand.map(cardStr => {
    const card = parseCard(cardStr);
    const isSelected = state.selectedCard === cardStr;
    let playable = false;
    if (isMyTurn && topCard) {
      const isWild = card.color === "Wild";
      const colorMatch = card.color === currentColor;
      const valueMatch = card.value === topCard.value;
      if (pending > 0) {
        playable = card.value === "+2" || card.value === "Wild+4";
      } else {
        playable = isWild || colorMatch || valueMatch;
      }
    }
    const label = cardLabel(card);
    return `<div class="uno-card c-${card.color} ${isSelected ? "selected" : ""} ${(!isMyTurn || !playable) ? "disabled" : ""}"
      onclick="onCardClick('${cardStr}')" title="${cardStr}">
      <span class="card-corner tl">${label}</span>
      <span class="card-value">${label}</span>
      <span class="card-corner br">${label}</span>
    </div>`;
  }).join("");
}

function renderCard(el, cardStr, clickable, disabled) {
  if (!cardStr) { el.innerHTML = ""; el.className = "uno-card"; return; }
  const card = parseCard(cardStr);
  const label = cardLabel(card);
  el.className = "uno-card c-" + card.color + (disabled ? " disabled" : "");
  el.innerHTML = `<span class="card-corner tl">${label}</span><span class="card-value">${label}</span><span class="card-corner br">${label}</span>`;
}

function renderChat() {
  const log = document.getElementById("chat-log");
  log.innerHTML = state.chat.map(m =>
    `<div class="uno-chat-msg"><span class="chat-name">${esc(m.playerId === state.session?.playerId ? "You" : (state.game?.players?.find(p=>p.playerId===m.playerId)?.playerName || "Player"))}:</span>${esc(m.message)}</div>`
  ).join("");
  log.scrollTop = log.scrollHeight;
}

/* ── Card helpers ──────────────────────────────────────────── */
function parseCard(str) {
  const [color, value] = str.split(":");
  return { color, value };
}

function cardLabel(card) {
  if (card.value === "Wild") return "🌈";
  if (card.value === "Wild+4") return "+4";
  if (card.value === "Skip") return "⊘";
  if (card.value === "Reverse") return "⇄";
  return card.value;
}

/* ── Utils ─────────────────────────────────────────────────── */
async function api(path, options = {}) {
  const res = await fetch(REST_URL + path, {
    method: options.method || "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.error || "Request failed (" + res.status + ")");
  return data;
}

let _toastTimer = null;
function toast(msg, isError = false) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.toggle("toast--error", isError);
  el.classList.remove("hidden");
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.add("hidden"), 4000);
}

function requireName() {
  const name = state.profileName.trim();
  if (name) return name.slice(0, 24);
  const fallback = pickRandomAnimalEmoji();
  syncNameInputs(fallback);
  return fallback;
}