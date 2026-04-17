const FLEET = [
  { name: "carrier", size: 5 },
  { name: "battleship", size: 4 },
  { name: "cruiser", size: 3 },
  { name: "submarine", size: 3 },
  { name: "destroyer", size: 2 },
];

const SESSION_KEY = "gamenowGameSession";
const OLD_SESSION_KEY = "gamenowBattleshipSession";
const CONFIG_KEY = "gamenowBattleshipConfig";
const PROFILE_KEY = "gamenowBattleshipProfileName";
const ANIMAL_EMOJIS = ["🐱", "🐶", "🐼", "🐯", "🦊", "🐻", "🐨", "🐸", "🐵", "🐧", "🦁", "🐰"];

const DEFAULT_API_CONFIG = {
  restUrl: "https://9tnuo0hn4k.execute-api.us-west-2.amazonaws.com/prod",
  wsUrl: "wss://dzhq6f9ar8.execute-api.us-west-2.amazonaws.com/prod",
};

const CHESS_PIECES = {
  K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙",
  k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟",
};

const state = {
  config: {
    restUrl: normalizeBaseUrl(DEFAULT_API_CONFIG.restUrl),
    wsUrl: normalizeBaseUrl(DEFAULT_API_CONFIG.wsUrl),
  },
  session: null,
  route: null,
  room: null,
  game: null,
  ws: null,
  wsIntentionalClose: false,
  roomJoined: false,
  configOpen: false,
  rulesOpen: false,
  chessRulesOpen: false,
  gomokuRulesOpen: false,
  profileName: "",
  chat: [],
  placement: {
    draft: [],
    selectedShipIndex: null,
  },
  chessSelected: null,
  promotionPending: null,
};

const els = {};

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  bindEvents();
  loadConfig();
  loadSession();
  const rawPath = window.location.pathname
    .replace(/\/battleship\.html$/, "/battleship")
    .replace(/\/chess\.html$/, "/chess")
    .replace(/\/gomoku\.html$/, "/gomoku");
  state.route = parseRoute(rawPath);
  renderAll();
  void onRouteChanged();
});

function cacheElements() {
  [
    "view-home",
    "view-battleship",
    "view-chess",
    "view-gomoku",
    "view-room",
    "brand-button",
    "home-continue-room",
    "toggle-rules",
    "rules-panel",
    "lobby-player-name-input",
    "lobby-room-id-input",
    "create-room",
    "join-room",
    "chess-lobby-player-name-input",
    "chess-lobby-room-id-input",
    "chess-create-room",
    "chess-join-room",
    "chess-toggle-rules",
    "chess-rules-panel",
    "gomoku-lobby-player-name-input",
    "gomoku-lobby-room-id-input",
    "gomoku-create-room",
    "gomoku-join-room",
    "gomoku-toggle-rules",
    "gomoku-rules-panel",
    "room-game-title",
    "room-page-title",
    "toast",
    "copy-room-link",
    "seat-strip",
    "room-waiting-actions",
    "start-game",
    "leave-seat",
    "waiting-action-note",
    "room-guest-panel",
    "room-live-panel",
    "room-player-name-input",
    "join-current-room",
    "room-continue-current",
    "session-name",
    "session-room-code",
    "session-seat",
    "session-player-id",
    "room-meta",
    "player-list",
    "refresh-room",
    "leave-room",
    "end-game-btn",
    "battleship-game",
    "toggle-orientation",
    "battle-status-line",
    "randomize-ships",
    "reset-ships",
    "submit-ships",
    "battle-title",
    "round-pill",
    "game-summary",
    "own-board-title",
    "own-board-panel",
    "own-board",
    "placement-panel",
    "opponent-panel",
    "opponent-board",
    "opponent-board-title",
    "chat-log",
    "chat-input",
    "send-chat",
    "chess-game",
    "chess-status-title",
    "chess-round-pill",
    "chess-game-summary",
    "chess-board",
    "chess-board-panel",
    "chess-sidebar-panel",
    "chess-promotion-bar",
    "chess-ready-section",
    "chess-play-section",
    "chess-color-label",
    "chess-draw-offer-banner",
    "chess-accept-draw",
    "chess-decline-draw",
    "chess-finished-section",
    "chess-result-label",
    "chess-leave-btn",
    "gomoku-game",
    "gomoku-status-title",
    "gomoku-round-pill",
    "gomoku-game-summary",
    "gomoku-board",
    "gomoku-board-panel",
    "gomoku-sidebar-panel",
    "gomoku-chat-panel",
    "gomoku-ready-section",
    "gomoku-ready-btn",
    "gomoku-play-section",
    "gomoku-color-label",
    "gomoku-move-list",
    "gomoku-finished-section",
    "gomoku-result-label",
    "gomoku-forfeit-btn",
    "config-panel",
    "config-backdrop",
    "close-config",
    "rest-url",
    "ws-url",
    "save-config",
  ].forEach((id) => {
    els[toCamel(id)] = document.getElementById(id);
  });
}

function bindEvents() {
  els.brandButton?.addEventListener("click", () => { location.href = "/"; });
  els.brandButton?.addEventListener("dblclick", (event) => {
    event.preventDefault();
    openConfigPanel();
  });

  document.addEventListener("click", (event) => {
    const nav = event.target.closest("[data-nav]");
    if (nav) {
      navigateTo(nav.dataset.nav);
    }
  });

  els.homeContinueRoom?.addEventListener("click", () => {
    if (state.session?.roomId) {
      navigateTo(roomPath(state.session.roomId));
    }
  });

  // Battleship lobby
  els.toggleRules?.addEventListener("click", () => {
    state.rulesOpen = !state.rulesOpen;
    renderRulesPanel();
  });
  els.createRoom?.addEventListener("click", createBattleshipRoom);
  els.joinRoom?.addEventListener("click", () => {
    const roomId = normalizeRoomId(els.lobbyRoomIdInput.value);
    if (roomId) {
      void joinRoomByCode(roomId);
    } else {
      setStatus("Please enter a 4-digit room code.", true);
    }
  });
  els.lobbyPlayerNameInput?.addEventListener("input", (event) => syncPlayerNameInputs(event.target.value));
  els.lobbyRoomIdInput?.addEventListener("input", () => normalizeRoomId(els.lobbyRoomIdInput.value));

  // Chess lobby
  els.chessToggleRules?.addEventListener("click", () => {
    state.chessRulesOpen = !state.chessRulesOpen;
    renderChessRulesPanel();
  });
  els.chessCreateRoom?.addEventListener("click", createChessRoom);
  els.chessJoinRoom?.addEventListener("click", () => {
    syncPlayerNameInputs(els.chessLobbyPlayerNameInput.value || state.profileName);
    const roomId = normalizeInputRoomId(els.chessLobbyRoomIdInput);
    if (roomId) {
      void joinRoomByCode(roomId);
    } else {
      setStatus("Please enter a 4-digit room code.", true);
    }
  });
  els.chessLobbyPlayerNameInput?.addEventListener("input", (event) => syncPlayerNameInputs(event.target.value));
  els.chessLobbyRoomIdInput?.addEventListener("input", () => normalizeInputRoomId(els.chessLobbyRoomIdInput));

  // Gomoku lobby
  els.gomokuToggleRules?.addEventListener("click", () => {
    state.gomokuRulesOpen = !state.gomokuRulesOpen;
    renderGomokuRulesPanel();
  });
  els.gomokuCreateRoom?.addEventListener("click", createGomokuRoom);
  els.gomokuJoinRoom?.addEventListener("click", () => {
    syncPlayerNameInputs(els.gomokuLobbyPlayerNameInput.value || state.profileName);
    const roomId = normalizeInputRoomId(els.gomokuLobbyRoomIdInput);
    if (roomId) {
      void joinRoomByCode(roomId);
    } else {
      setStatus("Please enter a 4-digit room code.", true);
    }
  });
  els.gomokuLobbyPlayerNameInput?.addEventListener("input", (event) => syncPlayerNameInputs(event.target.value));
  els.gomokuLobbyRoomIdInput?.addEventListener("input", () => normalizeInputRoomId(els.gomokuLobbyRoomIdInput));

  // Room page
  els.joinCurrentRoom?.addEventListener("click", () => {
    if (state.route?.name === "room") {
      void joinRoomByCode(state.route.roomId);
    }
  });
  els.roomContinueCurrent?.addEventListener("click", () => {
    if (state.session?.roomId) {
      navigateTo(roomPath(state.session.roomId));
    }
  });
  els.copyRoomLink?.addEventListener("click", copyRoomLink);
  els.refreshRoom?.addEventListener("click", refreshAll);
  els.leaveRoom?.addEventListener("click", leaveRoom);
  els.endGameBtn?.addEventListener("click", forfeitGame);
  els.startGame?.addEventListener("click", startRoom);
  els.leaveSeat?.addEventListener("click", leaveRoom);

  // Battleship game
  els.toggleOrientation?.addEventListener("click", rotateSelectedShip);
  els.randomizeShips?.addEventListener("click", randomizeShips);
  els.resetShips?.addEventListener("click", resetShips);
  els.submitShips?.addEventListener("click", submitShips);
  els.sendChat?.addEventListener("click", sendChat);
  els.chatInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") sendChat();
  });
  els.roomPlayerNameInput?.addEventListener("input", (event) => syncPlayerNameInputs(event.target.value));

  // Chess game
  els.chessAcceptDraw?.addEventListener("click", () => void chessDraw("accept"));
  els.chessDeclineDraw?.addEventListener("click", () => void chessDraw("decline"));
  els.chessLeaveBtn?.addEventListener("click", leaveRoom);
  els.chessPromotionBar?.querySelectorAll("[data-promo]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (state.promotionPending) {
        const { from, to } = state.promotionPending;
        state.promotionPending = null;
        void chessMove(from, to, btn.dataset.promo);
      }
    });
  });

  // Gomoku game
  els.gomokuReadyBtn?.addEventListener("click", gomokuReady);
  els.gomokuForfeitBtn?.addEventListener("click", gomokuForfeit);

  els.saveConfig?.addEventListener("click", saveConfig);
  els.closeConfig?.addEventListener("click", closeConfigPanel);
  els.configBackdrop?.addEventListener("click", closeConfigPanel);

  document.addEventListener("keydown", handleGlobalKeydown);
  window.addEventListener("popstate", () => {
    state.route = parseRoute(window.location.pathname);
    renderAll();
    void onRouteChanged();
  });
}

function handleGlobalKeydown(event) {
  if (event.key === "Escape" && state.configOpen) {
    closeConfigPanel();
  }
  if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "c") {
    event.preventDefault();
    openConfigPanel();
  }
}

function loadConfig() {
  const saved = readJson(CONFIG_KEY);
  const rest = (saved?.restUrl && String(saved.restUrl).trim()) || DEFAULT_API_CONFIG.restUrl;
  const ws = (saved?.wsUrl && String(saved.wsUrl).trim()) || DEFAULT_API_CONFIG.wsUrl;
  state.config = {
    restUrl: normalizeBaseUrl(rest),
    wsUrl: normalizeBaseUrl(ws),
  };
  els.restUrl.value = state.config.restUrl;
  els.wsUrl.value = state.config.wsUrl;
}

function loadSession() {
  let session = readJson(SESSION_KEY);
  if (!session) {
    session = readJson(OLD_SESSION_KEY);
    if (session) session.gameType = "battleship";
  }
  state.session = session;
  state.profileName = localStorage.getItem(PROFILE_KEY) || state.session?.playerName || generateDefaultPlayerName();
  syncPlayerNameInputs(state.profileName);
}

function saveConfig() {
  state.config.restUrl = normalizeBaseUrl(els.restUrl.value);
  state.config.wsUrl = normalizeBaseUrl(els.wsUrl.value);
  localStorage.setItem(CONFIG_KEY, JSON.stringify(state.config));
  closeConfigPanel();
  setStatus("API configuration saved.");
}

function openConfigPanel() {
  state.configOpen = true;
  renderConfigPanel();
}

function closeConfigPanel() {
  state.configOpen = false;
  renderConfigPanel();
}

function syncPlayerNameInputs(value, persist = true) {
  const normalized = String(value || "").trimStart().slice(0, 24);
  state.profileName = normalized;
  if (els.lobbyPlayerNameInput) els.lobbyPlayerNameInput.value = normalized;
  if (els.roomPlayerNameInput) els.roomPlayerNameInput.value = normalized;
  if (els.chessLobbyPlayerNameInput) els.chessLobbyPlayerNameInput.value = normalized;
  if (els.gomokuLobbyPlayerNameInput) els.gomokuLobbyPlayerNameInput.value = normalized;
  if (persist) {
    localStorage.setItem(PROFILE_KEY, normalized);
  }
}

function persistSession() {
  if (state.session) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(state.session));
  } else {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(OLD_SESSION_KEY);
  }
}

function parseRoute(pathname) {
  const segments = pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  if (segments.length === 0) return { name: "home" };
  if (segments[0] === "battleship" && segments.length === 1) return { name: "battleship" };
  if (segments[0] === "battleship" && segments.length === 2 && isRoomIdSegment(segments[1]))
    return { name: "room", roomId: segments[1], gameType: "battleship" };
  if (segments[0] === "chess" && segments.length === 1) return { name: "chess" };
  if (segments[0] === "chess" && segments.length === 2 && isRoomIdSegment(segments[1]))
    return { name: "room", roomId: segments[1], gameType: "chess" };
  if (segments[0] === "gomoku" && segments.length === 1) return { name: "gomoku" };
  if (segments[0] === "gomoku" && segments.length === 2 && isRoomIdSegment(segments[1]))
    return { name: "room", roomId: segments[1], gameType: "gomoku" };
  return { name: "home" };
}

function currentGameType() {
  if (state.session?.gameType) return state.session.gameType;
  if (state.route?.gameType) return state.route.gameType;
  if (state.route?.name === "chess" || state.route?.name === "gomoku" || state.route?.name === "battleship") {
    return state.route.name;
  }
  return "battleship";
}

function navigateTo(path, replace = false) {
  if (window.location.pathname !== path) {
    window.history[replace ? "replaceState" : "pushState"]({}, "", path);
  }
  state.route = parseRoute(path);
  renderAll();
  void onRouteChanged();
}

async function onRouteChanged() {
  renderRoomPageHeader();
  if (state.route.name !== "room") {
    disconnectSocket();
    state.room = null;
    state.game = null;
    state.chat = [];
    state.roomJoined = false;
    state.chessSelected = null;
    state.promotionPending = null;
    renderAll();
    return;
  }

  if (state.route.roomId && els.lobbyRoomIdInput) {
    els.lobbyRoomIdInput.value = state.route.roomId;
  }

  if (state.session?.roomId === state.route.roomId && state.config.restUrl && state.config.wsUrl) {
    await restoreSession();
    return;
  }

  disconnectSocket();
  state.room = null;
  state.game = null;
  state.chat = [];
  state.roomJoined = false;
  state.chessSelected = null;
  state.promotionPending = null;
  if (state.config.restUrl) {
    await fetchPublicRoom(state.route.roomId);
  }
  renderAll();
}

async function createBattleshipRoom() {
  try {
    ensureConfigured();
    const playerName = requirePlayerName();
    const room = await apiRequest("/rooms", {
      method: "POST",
      body: { gameType: "battleship", playerName },
    });
    setSession(room, "battleship");
    navigateTo(roomPath(room.roomId, "battleship"));
    await restoreSession();
    setStatus(`Room ${room.roomId} created. Share the link with your friend.`);
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function createChessRoom() {
  try {
    ensureConfigured();
    syncPlayerNameInputs(els.chessLobbyPlayerNameInput.value || state.profileName);
    const playerName = requirePlayerName();
    const room = await apiRequest("/rooms", {
      method: "POST",
      body: { gameType: "chess", playerName },
    });
    setSession(room, "chess");
    navigateTo(roomPath(room.roomId, "chess"));
    await restoreSession();
    setStatus(`Room ${room.roomId} created. Share the link with your friend.`);
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function createGomokuRoom() {
  try {
    ensureConfigured();
    syncPlayerNameInputs(els.gomokuLobbyPlayerNameInput.value || state.profileName);
    const playerName = requirePlayerName();
    const room = await apiRequest("/rooms", {
      method: "POST",
      body: { gameType: "gomoku", playerName },
    });
    setSession(room, "gomoku");
    navigateTo(roomPath(room.roomId, "gomoku"));
    await restoreSession();
    setStatus(`Room ${room.roomId} created. Share the link with your friend.`);
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function joinRoomByCode(roomId) {
  try {
    ensureConfigured();
    if (hasSavedSessionForRoom(roomId)) {
      if (state.route?.name !== "room" || state.route.roomId !== roomId) {
        navigateTo(roomPath(roomId));
      }
      await restoreSession();
      setStatus(`Restored your seat in room ${roomId}.`);
      return;
    }
    const playerName = requirePlayerName();
    const room = await apiRequest(`/rooms/${roomId}/join`, {
      method: "POST",
      body: { playerName },
    });
    setSession(room, room.gameType || "battleship");
    const targetPath = roomPath(room.roomId, room.gameType || "battleship");
    if (state.route?.name !== "room" || state.route.roomId !== room.roomId) {
      navigateTo(targetPath);
    }
    await restoreSession();
    setStatus(`Joined room ${room.roomId}.`);
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function leaveRoom() {
  if (!state.session) {
    setStatus("You have not joined a room yet.", true);
    return;
  }

  try {
    await apiRequest(`/rooms/${state.session.roomId}/leave`, {
      method: "POST",
      body: {
        playerId: state.session.playerId,
        playerToken: state.session.playerToken,
      },
    });
    const lobbyPath = `/${state.session.gameType || "battleship"}`;
    clearSession("You left the room.");
    navigateTo(lobbyPath);
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function startRoom() {
  if (!state.session) {
    setStatus("Join a room first.", true);
    return;
  }
  if (!isHostPlayer()) {
    setStatus("Only the host can start the game.", true);
    return;
  }

  try {
    await apiRequest(`/rooms/${state.session.roomId}/start`, {
      method: "POST",
      body: {
        playerId: state.session.playerId,
        playerToken: state.session.playerToken,
      },
    });
    await refreshAll();
    setStatus("Game started.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function forfeitGame() {
  if (!state.session) return;
  if (!confirm("End this game and return to the room lobby?")) return;

  const gameType = currentGameType();
  const endpoint = gameType === "chess" ? "resign" : "forfeit";

  try {
    await apiRequest(`/${gameType}/${state.session.roomId}/${endpoint}`, {
      method: "POST",
      body: {
        playerId: state.session.playerId,
        playerToken: state.session.playerToken,
      },
    });
    state.game = null;
    state.chessSelected = null;
    state.promotionPending = null;
    await refreshAll();
    setStatus("Game ended. Room is back to the lobby.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function kickPlayer(targetPlayerId) {
  if (!state.session) return;

  try {
    await apiRequest(`/rooms/${state.session.roomId}/leave`, {
      method: "POST",
      body: {
        playerId: state.session.playerId,
        playerToken: state.session.playerToken,
        targetPlayerId,
      },
    });
    await refreshAll();
    setStatus("Player removed from the room.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function restoreSession() {
  if (!state.session || state.route?.name !== "room" || state.route.roomId !== state.session.roomId) {
    return;
  }

  ensureConfigured();
  state.roomJoined = false;
  await refreshAll();
  connectSocket();
}

async function refreshAll() {
  if (!isRoomRoute()) {
    renderAll();
    return;
  }

  try {
    if (isViewingLiveRoom()) {
      await fetchRoom();
      if (currentGameType() === "chess" && isHostPlayer() && hasAllPlayers() && isWaitingRoomStage()) {
        await startRoom();
        renderAll();
        return;
      }
      if (!isWaitingRoomStage()) {
        await fetchGame();
        if (currentGameType() === "gomoku" && state.game?.phase === "waiting_for_players" && !state.game?.yourReady) {
          void gomokuReady();
        }
        if (currentGameType() === "chess" && state.game?.phase === "waiting_for_players") {
          const myReady = state.game?.players?.find((p) => p.playerId === state.session?.playerId)?.ready;
          if (!myReady) void chessReady();
        }
      }
    } else if (state.route?.roomId) {
      await fetchPublicRoom(state.route.roomId);
    }
  } catch (error) {
    setStatus(error.message, true);
  }
  renderAll();
}

async function fetchRoom() {
  const room = await apiRequest(`/rooms/${state.session.roomId}`);
  state.room = room;

  const me = room.players.find((player) => player.playerId === state.session.playerId);
  if (!me) {
    clearSession("You are no longer in this room.");
    return;
  }

  state.session.hostPlayerId = room.hostPlayerId;
  state.session.playerName = me.playerName;
  syncPlayerNameInputs(me.playerName);
  persistSession();
}

async function fetchPublicRoom(roomId) {
  if (!roomId) return;

  try {
    state.room = await apiRequest(`/rooms/${roomId}`);
  } catch (error) {
    state.room = null;
    throw error;
  }
}

async function fetchGame() {
  if (!state.session) return;
  const gameType = currentGameType();
  const query = new URLSearchParams({
    playerId: state.session.playerId,
    playerToken: state.session.playerToken,
  });
  state.game = await apiRequest(`/${gameType}/${state.session.roomId}?${query.toString()}`);
}

// ── Chess actions ────────────────────────────────────────────────────────────

async function chessReady() {
  if (!state.session) return;
  try {
    state.game = await apiRequest(`/chess/${state.session.roomId}/ready`, {
      method: "POST",
      body: { playerId: state.session.playerId, playerToken: state.session.playerToken },
    });
    renderAll();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function chessMove(from, to, promotion) {
  if (!state.session) return;
  try {
    state.game = await apiRequest(`/chess/${state.session.roomId}/move`, {
      method: "POST",
      body: {
        playerId: state.session.playerId,
        playerToken: state.session.playerToken,
        from,
        to,
        promotion: promotion || null,
      },
    });
    state.chessSelected = null;
    renderAll();
  } catch (error) {
    state.chessSelected = null;
    setStatus(error.message, true);
    renderAll();
  }
}

async function chessDraw(action) {
  if (!state.session) return;
  try {
    state.game = await apiRequest(`/chess/${state.session.roomId}/draw`, {
      method: "POST",
      body: { playerId: state.session.playerId, playerToken: state.session.playerToken, action },
    });
    renderAll();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function chessResign() {
  if (!state.session) return;
  if (!confirm("Resign this game?")) return;
  try {
    await apiRequest(`/chess/${state.session.roomId}/resign`, {
      method: "POST",
      body: { playerId: state.session.playerId, playerToken: state.session.playerToken },
    });
    state.game = null;
    await refreshAll();
  } catch (error) {
    setStatus(error.message, true);
  }
}

// ── Gomoku actions ───────────────────────────────────────────────────────────

async function gomokuReady() {
  if (!state.session) return;
  try {
    state.game = await apiRequest(`/gomoku/${state.session.roomId}/ready`, {
      method: "POST",
      body: { playerId: state.session.playerId, playerToken: state.session.playerToken },
    });
    if (state.game.phase === "playing") {
      await fetchRoom();
    }
    renderAll();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function gomokuPlace(row, col) {
  if (!state.session) return;
  try {
    state.game = await apiRequest(`/gomoku/${state.session.roomId}/place`, {
      method: "POST",
      body: { playerId: state.session.playerId, playerToken: state.session.playerToken, row, col },
    });
    if (state.game.phase === "finished") {
      await fetchRoom();
    }
    renderAll();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function gomokuForfeit() {
  if (!state.session) return;
  if (!confirm("Leave this game and return to the room lobby?")) return;
  try {
    await apiRequest(`/gomoku/${state.session.roomId}/forfeit`, {
      method: "POST",
      body: { playerId: state.session.playerId, playerToken: state.session.playerToken },
    });
    state.game = null;
    await refreshAll();
    setStatus("Game ended.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

// ── WebSocket ────────────────────────────────────────────────────────────────

function connectSocket() {
  if (!isViewingLiveRoom() || !state.config.wsUrl) return;

  // 已经连接中或已连接，跳过
  if (state.ws && (state.ws.readyState === WebSocket.CONNECTING || state.ws.readyState === WebSocket.OPEN)) {
    return;
  }

  // 关闭旧连接
  if (state.ws) {
    state.wsIntentionalClose = true;
    state.ws.close();
    state.ws = null;
  }

  clearJoinTimeout();
  state.wsIntentionalClose = false;
  setConnectionStatus("Connecting");

  const wsUrl = state.config.wsUrl;
  console.log("[WS] Opening WebSocket to", wsUrl);

  state.ws = new WebSocket(wsUrl);
  state.ws.addEventListener("open", () => {
    setConnectionStatus("Joining");
    setStatus("Restoring room connection...");
    const joinPayload = {
      action: "joinRoom",
      roomId: state.session.roomId,
      playerId: state.session.playerId,
      playerToken: state.session.playerToken,
    };
    console.log("[WS] Sending joinRoom:", joinPayload.roomId, joinPayload.playerId);
    sendWs(joinPayload);
    startJoinTimeout();
  });

  state.ws.addEventListener("message", handleWsMessage);
  state.ws.addEventListener("error", (event) => {
    console.error("[WS] WebSocket error event:", event);
  });
  state.ws.addEventListener("close", (event) => {
    console.log("[WS] WebSocket closed: code=%d reason=%s", event.code, event.reason);
    state.ws = null;
    state.roomJoined = false;
    clearJoinTimeout();
    setConnectionStatus("Disconnected");
    renderSessionSummary();
    if (!state.wsIntentionalClose && isViewingLiveRoom()) {
      startPolling();
    }
  });
}

function startJoinTimeout() {
  clearJoinTimeout();
  state._joinTimer = setTimeout(() => {
    if (!state.roomJoined && state.ws) {
      console.warn("[WS] Join timeout after 8s, falling back to polling");
      setConnectionStatus("WS Join Timeout");
      setStatus("WebSocket join timed out. Using polling for updates.", true);
      startPolling();
    }
  }, 8000);
}

function clearJoinTimeout() {
  if (state._joinTimer) {
    clearTimeout(state._joinTimer);
    state._joinTimer = null;
  }
}

function startPolling() {
  stopPolling();
  if (!isViewingLiveRoom()) return;
  console.log("[Poll] Starting room polling fallback");
  state._pollTimer = setInterval(async () => {
    if (!isViewingLiveRoom()) {
      stopPolling();
      return;
    }
    try {
      await refreshAll();
    } catch (error) {
      console.error("[Poll] refresh error:", error);
    }
  }, 5000);
}

function stopPolling() {
  if (state._pollTimer) {
    clearInterval(state._pollTimer);
    state._pollTimer = null;
  }
}

function disconnectSocket() {
  state.roomJoined = false;
  clearJoinTimeout();
  stopPolling();
  if (!state.ws) return;
  state.wsIntentionalClose = true;
  state.ws.close();
  state.ws = null;
  setConnectionStatus("Disconnected");
}

async function handleWsMessage(event) {
  let payload;
  try {
    payload = JSON.parse(event.data);
  } catch (error) {
    return;
  }

  if (payload.type === "CHAT") {
    state.chat.push(payload);
    renderChat();
    return;
  }

  if (payload.type === "ROOM_JOINED") {
    console.log("[WS] ROOM_JOINED received:", payload);
    state.roomJoined = true;
    clearJoinTimeout();
    stopPolling();
    setConnectionStatus(payload.reconnected ? "Reconnected" : "Connected");
    renderSessionSummary();
    setStatus(payload.reconnected ? "Reconnected to the room." : "Connected to the room.");
    await refreshAll();
    return;
  }

  if (payload.type === "ROOM_JOIN_ERROR" || payload.type === "ERROR") {
    console.error("[WS] Server error:", payload);
    clearJoinTimeout();
    setConnectionStatus("Join Failed");
    setStatus(`WebSocket join failed: ${payload.error || "Unknown error"}. Using polling.`, true);
    startPolling();
    return;
  }

  if (payload.type === "GAME_STATE") {
    if (payload.state?.phase === "finished" && state.room?.status === "waiting") return;
    state.game = payload.state;
    renderAll();
    if (currentGameType() === "gomoku" && payload.state?.phase === "waiting_for_players" && !payload.state?.yourReady) {
      void gomokuReady();
    }
    if (currentGameType() === "chess" && payload.state?.phase === "waiting_for_players") {
      const myReady = payload.state?.players?.find((p) => p.playerId === state.session?.playerId)?.ready;
      if (!myReady) void chessReady();
    }
    return;
  }

  if (
    payload.type === "PLAYER_JOINED" ||
    payload.type === "PLAYER_LEFT" ||
    payload.type === "ROOM_STARTED" ||
    payload.type === "ROOM_UPDATED"
  ) {
    if (payload.type === "ROOM_UPDATED" && payload.status === "waiting") {
      state.game = null;
    }
    await refreshAll();
  }
}

function sendWs(payload) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    setStatus("WebSocket is not connected yet.", true);
    return;
  }
  state.ws.send(JSON.stringify(payload));
}

function sendChat() {
  const message = els.chatInput.value.trim();
  if (!message) return;
  sendWs({ action: "sendChat", message });
  els.chatInput.value = "";
}

// ── Session ──────────────────────────────────────────────────────────────────

function setSession(roomSession, gameTypeOverride) {
  state.session = {
    roomId: String(roomSession.roomId),
    playerId: roomSession.playerId,
    playerToken: roomSession.playerToken,
    playerName: roomSession.playerName,
    hostPlayerId: roomSession.hostPlayerId,
    gameType: gameTypeOverride || roomSession.gameType || "battleship",
  };
  syncPlayerNameInputs(roomSession.playerName);
  state.room = null;
  state.game = null;
  state.chat = [];
  state.placement.draft = [];
  state.placement.selectedShipIndex = null;
  state.chessSelected = null;
  state.promotionPending = null;
  state.roomJoined = false;
  persistSession();
}

function clearSession(message) {
  disconnectSocket();
  state.session = null;
  state.room = null;
  state.game = null;
  state.chat = [];
  state.placement.draft = [];
  state.placement.selectedShipIndex = null;
  state.chessSelected = null;
  state.promotionPending = null;
  state.roomJoined = false;
  persistSession();
  renderAll();
  if (message) setStatus(message);
}

// ── Render orchestration ─────────────────────────────────────────────────────

function renderAll() {
  renderRoute();
  renderConfigPanel();
  renderRulesPanel();
  renderChessRulesPanel();
  renderGomokuRulesPanel();
  renderHome();
  renderRoomPageHeader();
  renderRoomAccess();
  renderSessionSummary();
  renderRoom();
  renderGame();
  renderChat();
  if (currentGameType() === "battleship") {
    renderBoards();
    renderPlacementSummary();
  }
}

function renderRoute() {
  els.viewHome?.classList.toggle("hidden", state.route.name !== "home");
  els.viewBattleship?.classList.toggle("hidden", state.route.name !== "battleship");
  els.viewChess?.classList.toggle("hidden", state.route.name !== "chess");
  els.viewGomoku?.classList.toggle("hidden", state.route.name !== "gomoku");
  els.viewRoom?.classList.toggle("hidden", state.route.name !== "room");
}

function renderHome() {
  const canContinue = Boolean(state.session?.roomId);
  if (els.homeContinueRoom) els.homeContinueRoom.disabled = !canContinue;
  if (els.homeContinueRoom) els.homeContinueRoom.textContent = canContinue
    ? `Continue room ${state.session.roomId}`
    : "Continue Last Room";
}

function renderRoomPageHeader() {
  const roomId = state.route?.roomId || "----";
  els.roomPageTitle.textContent = `Room code: ${roomId}`;
  if (els.roomGameTitle) {
    els.roomGameTitle.textContent = formatGameType(currentGameType());
  }
  els.roomContinueCurrent.disabled = !state.session?.roomId;
  els.copyRoomLink.textContent = "Invite";
  els.copyRoomLink.classList.toggle("hidden", state.route?.name !== "room");
  els.leaveRoom.classList.add("hidden");
}

function renderRoomAccess() {
  const roomRoute = isRoomRoute();
  const live = isViewingLiveRoom();
  const allowGuestJoin = roomRoute && !live && (!state.room || (state.room.status === "waiting" && !hasAllPlayers()));
  els.roomGuestPanel.classList.toggle("hidden", !allowGuestJoin);
  els.roomLivePanel.classList.toggle("hidden", !roomRoute);
}

function renderConfigPanel() {
  els.configPanel.classList.toggle("hidden", !state.configOpen);
  els.configPanel.setAttribute("aria-hidden", String(!state.configOpen));
}

function renderRulesPanel() {
  if (els.rulesPanel) {
    els.rulesPanel.classList.toggle("hidden", !state.rulesOpen);
  }
  if (els.toggleRules) {
    els.toggleRules.setAttribute("aria-expanded", String(state.rulesOpen));
  }
}

function renderChessRulesPanel() {
  if (els.chessRulesPanel) {
    els.chessRulesPanel.classList.toggle("hidden", !state.chessRulesOpen);
  }
  if (els.chessToggleRules) {
    els.chessToggleRules.setAttribute("aria-expanded", String(state.chessRulesOpen));
  }
}

function renderGomokuRulesPanel() {
  if (els.gomokuRulesPanel) {
    els.gomokuRulesPanel.classList.toggle("hidden", !state.gomokuRulesOpen);
  }
  if (els.gomokuToggleRules) {
    els.gomokuToggleRules.setAttribute("aria-expanded", String(state.gomokuRulesOpen));
  }
}

function renderSessionSummary() {
  const name = state.session?.playerName || state.profileName || "Guest";
  els.sessionName.textContent = name;
  els.sessionRoomCode.textContent = state.session?.roomId || state.route?.roomId || "----";
  els.sessionSeat.textContent = seatLabel();
  els.sessionPlayerId.textContent = sessionIdentityLabel();
}

function renderRoom() {
  if (!isRoomRoute() || !state.room) {
    els.seatStrip.innerHTML = buildSeatStrip(null);
    els.roomMeta.innerHTML = '<div class="mode-pill">Loading room details...</div>';
    renderWaitingActions();
    return;
  }

  els.seatStrip.innerHTML = buildSeatStrip(state.room);
  els.seatStrip.querySelectorAll("[data-join-seat]").forEach((button) => {
    button.addEventListener("click", () => {
      if (state.route?.name === "room") {
        void joinRoomByCode(state.route.roomId);
      }
    });
  });
  els.roomMeta.innerHTML = `
    <div class="mode-pill">Mode: ${escapeHtml(formatGameType(currentGameType()))}</div>
    <div>${escapeHtml(roomStateLine())}</div>
  `;
  renderWaitingActions();

  const inGame = isViewingLiveRoom() && !isWaitingRoomStage() && state.game?.phase !== "finished" && currentGameType() !== "chess";
  els.endGameBtn.classList.toggle("hidden", !inGame);
}

function renderGame() {
  const gameType = currentGameType();

  // Show/hide game-type panels
  if (els.battleshipGame) els.battleshipGame.classList.toggle("hidden", gameType !== "battleship");
  if (els.chessGame) els.chessGame.classList.toggle("hidden", gameType !== "chess");
  if (els.gomokuGame) els.gomokuGame.classList.toggle("hidden", gameType !== "gomoku");

  if (gameType === "chess") {
    renderChessGame();
    return;
  }
  if (gameType === "gomoku") {
    renderGomokuGame();
    return;
  }

  // ── Battleship rendering ──────────────────────────────────────────────────
  if (els.battleStatusLine) els.battleStatusLine.classList.add("hidden");

  if (!isRoomRoute()) {
    els.battleTitle.textContent = "Waiting to Enter";
    els.roundPill.classList.add("hidden");
    els.roundPill.textContent = "";
    els.gameSummary.innerHTML = `
      <div class="stage-summary-line">Open a room link to enter the game.</div>
      <div class="stage-summary-subline">Room links use the format ${escapeHtml(state.route?.roomId ? roomPath(state.route.roomId) : "/battleship/1234")}.</div>
    `;
    els.opponentBoardTitle.textContent = "Attack Grid";
    els.ownBoardTitle.textContent = "Defense Grid";
    els.placementPanel.classList.add("hidden");
    els.opponentPanel.classList.add("hidden");
    return;
  }

  if (!isViewingLiveRoom()) {
    els.battleTitle.textContent = state.room ? "Room Preview" : "Loading Room";
    els.roundPill.classList.add("hidden");
    els.roundPill.textContent = "";
    els.gameSummary.innerHTML = `
      <div class="stage-summary-line">Join this room to enter the live match.</div>
      <div class="stage-summary-subline">${escapeHtml(state.room ? roomStateLine() : "Loading public room state.")}</div>
    `;
    els.opponentBoardTitle.textContent = "Attack Grid";
    els.ownBoardTitle.textContent = "Defense Grid";
    els.placementPanel.classList.add("hidden");
    els.opponentPanel.classList.add("hidden");
    els.ownBoardPanel.classList.add("hidden");
    return;
  }

  if (isWaitingRoomStage()) {
    els.battleTitle.textContent = isHostPlayer() ? "Waiting Room" : "Choose a Seat";
    els.roundPill.classList.remove("hidden");
    els.roundPill.textContent = `Players ${state.room?.players?.length || 0}/2`;
    els.gameSummary.innerHTML = `
      <div class="stage-summary-line">${escapeHtml(waitingRoomHeadline())}</div>
      <div class="stage-summary-subline">${escapeHtml(waitingRoomSubline())}</div>
    `;
    els.placementPanel.classList.add("hidden");
    els.opponentPanel.classList.add("hidden");
    els.ownBoardPanel.classList.add("hidden");
    return;
  }

  els.roundPill.classList.add("hidden");
  els.roundPill.textContent = "";
  els.ownBoardTitle.textContent = "Your Board";
  els.opponentBoardTitle.textContent = state.game?.opponentBoard?.playerName
    ? `${state.game.opponentBoard.playerName}'s Board`
    : "Attack Grid";

  if (!state.game) {
    els.battleTitle.textContent = "Loading";
    els.gameSummary.innerHTML = `
      <div class="stage-summary-line">Loading match state...</div>
      <div class="stage-summary-subline">Please wait while the room syncs.</div>
    `;
    els.placementPanel.classList.add("hidden");
    els.opponentPanel.classList.add("hidden");
    els.ownBoardPanel.classList.remove("hidden");
    return;
  }

  const setupPhase = state.game.phase === "setup";
  const playingPhase = state.game.phase === "playing" || state.game.phase === "finished";
  els.ownBoardPanel.classList.remove("hidden");
  els.placementPanel.classList.toggle("hidden", !setupPhase);
  els.opponentPanel.classList.toggle("hidden", !playingPhase);

  if (setupPhase) {
    els.battleTitle.textContent = "Deploy Fleet";
    els.gameSummary.innerHTML = `<div class="stage-summary-subline">${escapeHtml(stageSubline())}</div>`;
  } else {
    if (state.game.phase === "finished") {
      els.battleTitle.textContent =
        renderWinnerLabel() === "Draw" ? "Match ended in a draw" : `${renderWinnerLabel()} won the match`;
    } else {
      els.battleTitle.textContent = "Battleship";
    }
    els.gameSummary.innerHTML = "";
    if (els.battleStatusLine) {
      els.battleStatusLine.textContent = middleRackStatus();
      els.battleStatusLine.classList.remove("hidden");
    }
  }
}

function renderWaitingActions() {
  const show = isViewingLiveRoom() && isWaitingRoomStage();
  els.roomWaitingActions.classList.toggle("hidden", !show);
  if (!show) return;

  const host = isHostPlayer();
  const full = hasAllPlayers();
  els.startGame.classList.toggle("hidden", !host);
  els.startGame.disabled = !full;
  els.leaveSeat.disabled = false;
}

// ── Chess rendering ──────────────────────────────────────────────────────────

function renderChessGame() {
  if (!isRoomRoute() || !isViewingLiveRoom()) {
    if (els.chessStatusTitle) els.chessStatusTitle.textContent = "Waiting";
    if (els.chessBoardPanel) els.chessBoardPanel.classList.add("hidden");
    if (els.chessSidebarPanel) els.chessSidebarPanel.classList.add("hidden");
    if (els.chessDrawOfferBanner) els.chessDrawOfferBanner.classList.add("hidden");
    if (els.chessBoard) els.chessBoard.classList.add("hidden");
    return;
  }

  const game = state.game;

  if (!game) {
    if (isWaitingRoomStage()) {
      els.chessStatusTitle.textContent = isHostPlayer() ? "Waiting Room" : "Choose a Seat";
      els.chessRoundPill.classList.remove("hidden");
      els.chessRoundPill.textContent = `Players ${state.room?.players?.length || 0}/2`;
      els.chessGameSummary.innerHTML = `
        <div class="stage-summary-line">${escapeHtml(waitingRoomHeadline())}</div>
        <div class="stage-summary-subline">${escapeHtml(waitingRoomSubline())}</div>
      `;
    } else {
      els.chessStatusTitle.textContent = "Loading...";
      els.chessRoundPill.classList.add("hidden");
      els.chessGameSummary.innerHTML = "";
    }
    els.chessBoardPanel.classList.add("hidden");
    els.chessSidebarPanel.classList.add("hidden");
    els.chessDrawOfferBanner.classList.add("hidden");
    els.chessBoard.classList.add("hidden");
    els.chessReadySection.classList.add("hidden");
    els.chessPlaySection.classList.add("hidden");
    els.chessFinishedSection.classList.add("hidden");
    els.chessPromotionBar.classList.add("hidden");
    return;
  }

  const phase = game.phase;

  if (phase === "waiting_for_players" || phase === "setup") {
    els.chessStatusTitle.textContent = "Starting...";
    els.chessRoundPill.classList.add("hidden");
    els.chessGameSummary.innerHTML = "";
    els.chessBoardPanel.classList.add("hidden");
    els.chessSidebarPanel.classList.add("hidden");
    els.chessDrawOfferBanner.classList.add("hidden");
    els.chessBoard.classList.add("hidden");
    els.chessReadySection.classList.add("hidden");
    els.chessPlaySection.classList.add("hidden");
    els.chessFinishedSection.classList.add("hidden");
    els.chessPromotionBar.classList.add("hidden");
    return;
  }

  if (phase === "playing") {
    els.chessStatusTitle.textContent = game.yourTurn ? "Your turn" : "Opponent's turn";
    els.chessRoundPill.classList.add("hidden");
    els.chessGameSummary.innerHTML = "";
    els.chessBoardPanel.classList.remove("hidden");
    els.chessBoard.classList.remove("hidden");
    els.chessSidebarPanel.classList.add("hidden");
    els.chessReadySection.classList.add("hidden");
    els.chessPlaySection.classList.add("hidden");
    els.chessFinishedSection.classList.add("hidden");

    const hasDrawOffer = Boolean(game.opponentOfferedDraw);
    els.chessDrawOfferBanner.classList.toggle("hidden", !hasDrawOffer);

    const showPromo = Boolean(state.promotionPending);
    els.chessPromotionBar.classList.toggle("hidden", !showPromo);

    renderChessBoard();
    return;
  }

  if (phase === "finished") {
    els.chessStatusTitle.textContent = "Game Over";
    els.chessRoundPill.classList.add("hidden");
    els.chessGameSummary.innerHTML = "";
    els.chessResultLabel.textContent = gameResultText(game);
    els.chessBoardPanel.classList.add("hidden");
    els.chessBoard.classList.add("hidden");
    els.chessSidebarPanel.classList.remove("hidden");
    els.chessReadySection.classList.add("hidden");
    els.chessPlaySection.classList.add("hidden");
    els.chessFinishedSection.classList.remove("hidden");
    els.chessDrawOfferBanner.classList.add("hidden");
    els.chessPromotionBar.classList.add("hidden");
  }
}

function parseFen(fen) {
  const parts = fen.split(" ");
  const placement = parts[0];
  const board = [];
  for (const rankStr of placement.split("/")) {
    const row = [];
    for (const ch of rankStr) {
      if (/\d/.test(ch)) {
        for (let i = 0; i < parseInt(ch, 10); i += 1) row.push(null);
      } else {
        row.push(ch);
      }
    }
    board.push(row);
  }
  return board; // board[0] = rank 8, board[7] = rank 1
}

function squareName(row, col) {
  return String.fromCharCode(97 + col) + String(8 - row);
}

function squareIndex(sq) {
  const col = sq.charCodeAt(0) - 97;
  const row = 8 - parseInt(sq[1], 10);
  return { row, col };
}

function renderChessBoard() {
  if (!els.chessBoard) return;

  const fen = state.game?.fen;
  if (!fen) {
    els.chessBoard.innerHTML = buildEmptyChessBoard();
    return;
  }

  const board = parseFen(fen);
  const yourColor = state.game?.yourColor;
  const isFlipped = yourColor === "black";
  const selected = state.chessSelected;

  const cells = [];
  for (let displayRow = 0; displayRow < 8; displayRow += 1) {
    for (let displayCol = 0; displayCol < 8; displayCol += 1) {
      const row = isFlipped ? 7 - displayRow : displayRow;
      const col = isFlipped ? 7 - displayCol : displayCol;
      const sq = squareName(row, col);
      const piece = board[row][col];
      const isLight = (row + col) % 2 === 0;

      const classes = ["chess-cell", isLight ? "light" : "dark"];
      if (sq === selected) classes.push("selected");

      let pieceHtml = "";
      if (piece) {
        const isWhite = piece === piece.toUpperCase();
        const symbol = CHESS_PIECES[piece] || piece;
        pieceHtml = `<span class="chess-piece ${isWhite ? "white" : "black"}">${symbol}</span>`;
      }

      const canClick = Boolean(state.game?.yourTurn && state.game?.phase === "playing" && !state.promotionPending);
      cells.push(
        `<div class="${classes.join(" ")}"${canClick ? ` data-square="${sq}"` : ""}>${pieceHtml}</div>`
      );
    }
  }

  els.chessBoard.innerHTML = cells.join("");
  els.chessBoard.querySelectorAll("[data-square]").forEach((cell) => {
    cell.addEventListener("click", () => handleChessCellClick(cell.dataset.square));
  });
}

function buildEmptyChessBoard() {
  const cells = [];
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const isLight = (row + col) % 2 === 0;
      cells.push(`<div class="chess-cell ${isLight ? "light" : "dark"}"></div>`);
    }
  }
  return cells.join("");
}

function handleChessCellClick(sq) {
  if (!state.game || state.game.phase !== "playing") return;
  if (!state.game.yourTurn) return;
  if (state.promotionPending) return;

  const board = parseFen(state.game.fen);
  const { row, col } = squareIndex(sq);
  const piece = board[row][col];

  const isMyPiece = piece && (
    (state.game.yourColor === "white" && piece === piece.toUpperCase()) ||
    (state.game.yourColor === "black" && piece === piece.toLowerCase())
  );

  if (state.chessSelected) {
    if (sq === state.chessSelected) {
      state.chessSelected = null;
      renderChessBoard();
      return;
    }
    if (isMyPiece) {
      state.chessSelected = sq;
      renderChessBoard();
      return;
    }
    // Attempt the move
    const from = state.chessSelected;
    state.chessSelected = null;

    // Detect pawn promotion
    const { row: fromRow, col: fromCol } = squareIndex(from);
    const movingPiece = board[fromRow][fromCol];
    const destRank = parseInt(sq[1], 10);
    const needsPromotion =
      (movingPiece === "P" && destRank === 8) ||
      (movingPiece === "p" && destRank === 1);

    if (needsPromotion) {
      state.promotionPending = { from, to: sq };
      renderChessGame();
      return;
    }

    void chessMove(from, sq, null);
    return;
  }

  if (isMyPiece) {
    state.chessSelected = sq;
    renderChessBoard();
  }
}

// ── Gomoku rendering ─────────────────────────────────────────────────────────

function renderGomokuGame() {
  if (!isRoomRoute() || !isViewingLiveRoom()) {
    if (els.gomokuStatusTitle) els.gomokuStatusTitle.textContent = "Waiting";
    if (els.gomokuRoundPill) els.gomokuRoundPill.classList.add("hidden");
    if (els.gomokuGameSummary) els.gomokuGameSummary.innerHTML = "";
    if (els.gomokuBoard) els.gomokuBoard.classList.add("hidden");
    if (els.gomokuBoardPanel) els.gomokuBoardPanel.classList.add("hidden");
    if (els.gomokuSidebarPanel) els.gomokuSidebarPanel.classList.add("hidden");
    if (els.gomokuReadySection) els.gomokuReadySection.classList.add("hidden");
    if (els.gomokuPlaySection) els.gomokuPlaySection.classList.add("hidden");
    if (els.gomokuFinishedSection) els.gomokuFinishedSection.classList.add("hidden");
    if (els.gomokuChatPanel) els.gomokuChatPanel.classList.add("hidden");
    return;
  }

  const game = state.game;

  if (!game) {
    if (isWaitingRoomStage()) {
      els.gomokuStatusTitle.textContent = isHostPlayer() ? "Waiting Room" : "Choose a Seat";
      els.gomokuRoundPill.classList.remove("hidden");
      els.gomokuRoundPill.textContent = `Players ${state.room?.players?.length || 0}/2`;
      els.gomokuGameSummary.innerHTML = `
        <div class="stage-summary-line">${escapeHtml(waitingRoomHeadline())}</div>
        <div class="stage-summary-subline">${escapeHtml(waitingRoomSubline())}</div>
      `;
    } else {
      els.gomokuStatusTitle.textContent = "Loading...";
      els.gomokuRoundPill.classList.add("hidden");
      els.gomokuGameSummary.innerHTML = "";
    }
    els.gomokuBoard.classList.add("hidden");
    els.gomokuBoardPanel.classList.add("hidden");
    els.gomokuSidebarPanel.classList.add("hidden");
    els.gomokuReadySection.classList.add("hidden");
    els.gomokuPlaySection.classList.add("hidden");
    els.gomokuFinishedSection.classList.add("hidden");
    if (els.gomokuChatPanel) els.gomokuChatPanel.classList.add("hidden");
    return;
  }

  const phase = game.phase;

  if (phase === "waiting_for_players") {
    els.gomokuStatusTitle.textContent = "Starting...";
    els.gomokuRoundPill.classList.add("hidden");
    els.gomokuGameSummary.innerHTML = "";
    els.gomokuBoardPanel.classList.add("hidden");
    els.gomokuSidebarPanel.classList.add("hidden");
    els.gomokuBoard.classList.add("hidden");
    els.gomokuReadySection.classList.add("hidden");
    els.gomokuPlaySection.classList.add("hidden");
    els.gomokuFinishedSection.classList.add("hidden");
    if (els.gomokuChatPanel) els.gomokuChatPanel.classList.add("hidden");
    return;
  }

  if (phase === "playing") {
    els.gomokuStatusTitle.textContent = game.yourTurn ? "Your turn" : "Opponent's turn";
    els.gomokuRoundPill.classList.add("hidden");
    els.gomokuGameSummary.innerHTML = "";
    els.gomokuBoardPanel.classList.remove("hidden");
    els.gomokuBoard.classList.remove("hidden");
    els.gomokuSidebarPanel.classList.add("hidden");
    els.gomokuReadySection.classList.add("hidden");
    els.gomokuPlaySection.classList.add("hidden");
    els.gomokuFinishedSection.classList.add("hidden");
    if (els.gomokuChatPanel) els.gomokuChatPanel.classList.remove("hidden");
    renderGomokuBoard();
    return;
  }

  if (phase === "finished") {
    els.gomokuStatusTitle.textContent = "Game Over";
    els.gomokuRoundPill.classList.add("hidden");
    els.gomokuGameSummary.innerHTML = "";
    els.gomokuResultLabel.textContent = gameResultText(game);
    els.gomokuBoardPanel.classList.add("hidden");
    els.gomokuBoard.classList.add("hidden");
    els.gomokuSidebarPanel.classList.remove("hidden");
    els.gomokuReadySection.classList.add("hidden");
    els.gomokuPlaySection.classList.add("hidden");
    els.gomokuFinishedSection.classList.remove("hidden");
    if (els.gomokuChatPanel) els.gomokuChatPanel.classList.remove("hidden");
  }
}

function renderGomokuBoard() {
  if (!els.gomokuBoard) return;

  const game = state.game;
  if (!game || !game.board) {
    els.gomokuBoard.innerHTML = buildEmptyGomokuBoard();
    return;
  }

  const board = game.board;
  const winningSet = new Set(game.winningCells || []);
  const canPlace = Boolean(game.yourTurn && game.phase === "playing");

  const cells = [];
  for (let row = 0; row < 15; row += 1) {
    for (let col = 0; col < 15; col += 1) {
      const val = board[row][col];
      const cellKey = `${row},${col}`;
      const isWinning = winningSet.has(cellKey);

      const classes = ["gomoku-cell"];
      if (val === 0) {
        classes.push("empty-cell");
        if (canPlace) classes.push("clickable");
      } else if (val === 1) {
        classes.push("black-stone");
        if (isWinning) classes.push("winning-cell");
      } else if (val === 2) {
        classes.push("white-stone");
        if (isWinning) classes.push("winning-cell");
      }

      const dataAttr = val === 0 && canPlace ? ` data-gomoku-cell="${row},${col}"` : "";
      cells.push(`<div class="${classes.join(" ")}"${dataAttr}></div>`);
    }
  }

  els.gomokuBoard.innerHTML = cells.join("");
  els.gomokuBoard.querySelectorAll("[data-gomoku-cell]").forEach((cellEl) => {
    cellEl.addEventListener("click", () => {
      const [r, c] = cellEl.dataset.gomokuCell.split(",").map(Number);
      void gomokuPlace(r, c);
    });
  });
}

function buildEmptyGomokuBoard() {
  const cells = [];
  for (let i = 0; i < 225; i += 1) {
    cells.push('<div class="gomoku-cell empty-cell"></div>');
  }
  return cells.join("");
}

// ── Battleship placement ─────────────────────────────────────────────────────

function draftWithoutShipIndex(skipIndex) {
  return state.placement.draft.filter((_, index) => index !== skipIndex);
}

function buildRandomFleetDraft() {
  const draft = [];
  for (const ship of FLEET) {
    let placed = false;
    for (let attempt = 0; attempt < 800 && !placed; attempt += 1) {
      const placement = {
        name: ship.name,
        startRow: Math.floor(Math.random() * 10),
        startCol: Math.floor(Math.random() * 10),
        orientation: Math.random() > 0.5 ? "horizontal" : "vertical",
      };
      if (canPlaceShip(placement, draft)) {
        draft.push(placement);
        placed = true;
      }
    }
    if (!placed) return null;
  }
  return draft;
}

function ensureSetupFleetRandomized() {
  if (!canPlaceShips() || state.placement.draft.length > 0) return;
  const draft = buildRandomFleetDraft();
  if (draft) {
    state.placement.draft = draft;
    state.placement.selectedShipIndex = null;
  }
}

function rotateSelectedShip() {
  if (!canPlaceShips()) return;
  const idx = state.placement.selectedShipIndex;
  if (idx === null || idx === undefined) {
    showToast("Select a ship on your board first.", true);
    return;
  }
  const cur = state.placement.draft[idx];
  if (!cur) return;
  const pl = { ...cur, orientation: cur.orientation === "horizontal" ? "vertical" : "horizontal" };
  try {
    shipCellsFromPlacement(pl);
  } catch {
    showToast("Cannot rotate — ship would leave the board.", true);
    return;
  }
  state.placement.draft[idx] = pl;
  renderAll();
}

function resetShips() {
  state.placement.draft = [];
  state.placement.selectedShipIndex = null;
  renderAll();
}

function randomizeShips() {
  const draft = buildRandomFleetDraft();
  if (!draft) {
    showToast("Auto-placement failed. Try again.", true);
    return;
  }
  state.placement.draft = draft;
  state.placement.selectedShipIndex = null;
  renderAll();
}

async function submitShips() {
  if (!state.session) {
    setStatus("Join a room first.", true);
    return;
  }
  if (state.placement.draft.length !== FLEET.length) {
    showToast("Place all ships before locking your fleet.", true);
    return;
  }
  if (!isFleetPlacementValid(state.placement.draft)) {
    showToast(
      "Cannot lock: ships cannot overlap or touch (including diagonally). Adjust your fleet first.",
      true,
    );
    return;
  }

  try {
    state.game = await apiRequest(`/battleship/${state.session.roomId}/setup`, {
      method: "POST",
      body: {
        playerId: state.session.playerId,
        playerToken: state.session.playerToken,
        placements: state.placement.draft,
      },
    });
    await fetchRoom();
    state.placement.selectedShipIndex = null;
    setStatus("Fleet locked. Waiting for the other player.");
    renderAll();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function fireAt(row, col) {
  if (!state.session || !canFire()) return;

  try {
    state.game = await apiRequest(`/battleship/${state.session.roomId}/fire`, {
      method: "POST",
      body: {
        playerId: state.session.playerId,
        playerToken: state.session.playerToken,
        row,
        col,
      },
    });
    renderAll();
  } catch (error) {
    setStatus(error.message, true);
  }
}

function renderChat() {
  if (!els.chatLog) return;
  els.chatLog.innerHTML = state.chat.map(m => {
    const isMe = m.playerId === state.session?.playerId;
    const name = isMe ? "You" : (state.room?.players?.find(p => p.playerId === m.playerId)?.playerName || "Opponent");
    return `<div class="uno-chat-msg">
      <span class="chat-name">${escapeHtml(name)}:</span>${escapeHtml(m.message)}
    </div>`;
  }).join("");
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
}

function renderPlacementSummary() {
  if (els.toggleOrientation) {
    els.toggleOrientation.disabled = !canPlaceShips() || state.placement.selectedShipIndex === null;
  }
}

function renderBoards() {
  ensureSetupFleetRandomized();
  renderOwnBoard();
  renderOpponentBoard();
}

function shipHueIndex(shipName) {
  const index = FLEET.findIndex((ship) => ship.name === shipName);
  return index >= 0 ? index : 0;
}

function middleRackStatus() {
  if (!state.game) return "";
  if (state.game.phase === "finished") return "Match over";
  if (state.game.phase !== "playing") return "";
  const raw = state.game.opponentBoard?.playerName || "Opponent";
  const opponentName = stripLeadingEmoji(raw) || raw;
  const meSubmitted = state.game.shotSubmittedThisRound;
  const oppSubmitted = state.game.currentRound?.opponentSubmitted;
  if (!meSubmitted && !oppSubmitted) return `Waiting For You and ${opponentName}`;
  if (!meSubmitted && oppSubmitted) return "Waiting For You";
  if (meSubmitted && !oppSubmitted) return `Waiting For ${opponentName}`;
  return "Resolving round…";
}

function renderOwnBoard() {
  if (!isRoomRoute()) {
    els.ownBoard.innerHTML = buildBoardHtml(() => ({ classes: ["board-cell"], label: "", action: "", bow: false }));
    return;
  }
  if (!isViewingLiveRoom()) {
    els.ownBoard.innerHTML = buildBoardHtml(() => ({ classes: ["board-cell"], label: "", action: "", bow: false }));
    return;
  }

  const shipCells = new Map();
  const placements = canPlaceShips() ? draftShipsAsPublic() : state.game?.ownBoard?.ships || [];
  placements.forEach((ship) => ship.cells.forEach((c) => shipCells.set(c, ship)));

  const received = new Map();
  (state.game?.ownBoard?.shotsReceived || []).forEach((shot) => received.set(shot.cell, shot));

  const draftCellMeta = new Map();
  if (canPlaceShips()) {
    state.placement.draft.forEach((pl, shipIndex) => {
      const cells = shipCellsFromPlacement(pl);
      const hue = shipHueIndex(pl.name);
      cells.forEach((c, idx) => {
        draftCellMeta.set(c, { shipIndex, hue, isBow: idx === 0 });
      });
    });
  }

  els.ownBoard.innerHTML = buildBoardHtml((row, col) => {
    const cell = `${row},${col}`;
    const classes = ["board-cell"];
    let label = "";
    let bow = false;

    if (canPlaceShips() && draftCellMeta.has(cell)) {
      const meta = draftCellMeta.get(cell);
      classes.push("ship", `ship-hue-${meta.hue}`);
      if (meta.isBow && !received.has(cell)) bow = true;
      if (state.placement.selectedShipIndex === meta.shipIndex) classes.push("ship-selected");
    } else if (shipCells.has(cell)) {
      const pub = shipCells.get(cell);
      const hue = shipHueIndex(pub.name);
      classes.push("ship", `ship-hue-${hue}`);
      const order = pub.cells || [];
      if (order[0] === cell && !received.has(cell)) bow = true;
    }

    if (received.has(cell)) {
      const shot = received.get(cell);
      if (shot.result === "miss") {
        classes.push("miss");
        label = "•";
      } else {
        classes.push("hit");
        const pub = shipCells.get(cell);
        label = pub?.sunk ? "X" : "";
      }
    }
    if (canPlaceShips()) classes.push("clickable");

    return {
      classes,
      label,
      bow,
      action: canPlaceShips() ? `data-own-cell="${row},${col}"` : "",
    };
  });

  els.ownBoard.querySelectorAll("[data-own-cell]").forEach((cellEl) => {
    cellEl.addEventListener("click", () => handleOwnBoardPlacementClick(cellEl.dataset.ownCell));
  });
}

function handleOwnBoardPlacementClick(cellId) {
  if (!canPlaceShips()) return;
  const [row, col] = cellId.split(",").map(Number);
  const cell = `${row},${col}`;
  for (let i = 0; i < state.placement.draft.length; i += 1) {
    const cells = shipCellsFromPlacement(state.placement.draft[i]);
    if (cells.includes(cell)) {
      state.placement.selectedShipIndex = i;
      renderPlacementSummary();
      renderOwnBoard();
      return;
    }
  }
  if (state.placement.selectedShipIndex !== null && state.placement.selectedShipIndex !== undefined) {
    tryMoveSelectedShipTo(row, col);
  }
}

function tryMoveSelectedShipTo(row, col) {
  const idx = state.placement.selectedShipIndex;
  if (idx === null || idx === undefined) return;
  const current = state.placement.draft[idx];
  if (!current) return;
  const pl = { name: current.name, startRow: row, startCol: col, orientation: current.orientation };
  try {
    shipCellsFromPlacement(pl);
  } catch {
    showToast("Cannot move — ship would leave the board.", true);
    return;
  }
  state.placement.draft[idx] = pl;
  renderAll();
}

function renderOpponentBoard() {
  if (!isRoomRoute()) {
    els.opponentBoard.innerHTML = buildBoardHtml(() => ({ classes: ["board-cell"], label: "", action: "", bow: false }));
    return;
  }
  if (!isViewingLiveRoom()) {
    els.opponentBoard.innerHTML = buildBoardHtml(() => ({ classes: ["board-cell"], label: "", action: "", bow: false }));
    return;
  }

  const fired = new Map();
  (state.game?.opponentBoard?.shotsFired || []).forEach((shot) => fired.set(shot.cell, shot));
  const yourShot = state.game?.currentRound?.yourShot;
  const pendingResult = yourShot?.result;
  const opponentSunkShipNames = new Set(
    (state.game?.opponentBoard?.shotsFired || [])
      .filter((s) => s.result === "hit" && s.sunk && s.shipName)
      .map((s) => s.shipName),
  );

  els.opponentBoard.innerHTML = buildBoardHtml((row, col) => {
    const cell = `${row},${col}`;
    const classes = ["board-cell"];
    let label = "";
    const shot = fired.get(cell);

    if (shot) {
      classes.push(shot.result === "hit" ? "hit" : "miss");
      if (shot.result === "hit") {
        label = shot.shipName && opponentSunkShipNames.has(shot.shipName) ? "X" : "";
      } else {
        label = "•";
      }
    } else if (yourShot && yourShot.cell === cell && pendingResult) {
      classes.push(pendingResult === "hit" ? "hit" : "miss");
      label = pendingResult === "hit" ? "" : "•";
    } else if (canFire()) {
      classes.push("clickable");
    }

    return {
      classes,
      label,
      bow: false,
      action: canFire() && !shot && !(yourShot && yourShot.cell === cell) ? `data-opponent-cell="${row},${col}"` : "",
    };
  });

  els.opponentBoard.querySelectorAll("[data-opponent-cell]").forEach((cellEl) => {
    cellEl.addEventListener("click", () => {
      const [r, c] = cellEl.dataset.opponentCell.split(",").map(Number);
      fireAt(r, c);
    });
  });
}

function buildBoardHtml(cellRenderer) {
  const cells = [];
  for (let row = 0; row < 10; row += 1) {
    for (let col = 0; col < 10; col += 1) {
      const rendered = cellRenderer(row, col);
      const bow = rendered.bow ? '<span class="ship-bow-ring" aria-hidden="true"></span>' : "";
      const text = rendered.label ? escapeHtml(rendered.label) : "";
      cells.push(`<div class="${rendered.classes.join(" ")}" ${rendered.action}>${bow}${text}</div>`);
    }
  }
  return cells.join("");
}

function draftShipsAsPublic() {
  return state.placement.draft.map((placement) => ({
    name: placement.name,
    cells: shipCellsFromPlacement(placement),
    hits: [],
  }));
}

function cellsAre8Neighbors(cellA, cellB) {
  if (cellA === cellB) return true;
  const [r1, c1] = cellA.split(",").map(Number);
  const [r2, c2] = cellB.split(",").map(Number);
  return Math.abs(r1 - r2) <= 1 && Math.abs(c1 - c2) <= 1;
}

function isFleetPlacementValid(draft) {
  if (!draft || draft.length !== FLEET.length) return false;
  for (let i = 0; i < draft.length; i += 1) {
    if (!canPlaceShip(draft[i], draftWithoutShipIndex(i))) return false;
  }
  return true;
}

function canPlaceShip(placement, draft) {
  try {
    const cells = shipCellsFromPlacement(placement);
    const occupied = new Set(draft.flatMap(shipCellsFromPlacement));
    if (!cells.every((cell) => !occupied.has(cell))) return false;
    for (const other of draft) {
      const otherCells = shipCellsFromPlacement(other);
      for (const c of cells) {
        for (const o of otherCells) {
          if (cellsAre8Neighbors(c, o)) return false;
        }
      }
    }
    return true;
  } catch (error) {
    return false;
  }
}

function shipCellsFromPlacement(placement) {
  const ship = FLEET.find((candidate) => candidate.name === placement.name);
  if (!ship) throw new Error("Unknown ship");

  const cells = [];
  for (let offset = 0; offset < ship.size; offset += 1) {
    const row = placement.startRow + (placement.orientation === "vertical" ? offset : 0);
    const col = placement.startCol + (placement.orientation === "horizontal" ? offset : 0);
    if (row < 0 || row >= 10 || col < 0 || col >= 10) throw new Error("Out of bounds");
    cells.push(`${row},${col}`);
  }
  return cells;
}

// ── State helpers ────────────────────────────────────────────────────────────

function playerReady(playerId) {
  return Boolean(state.game?.players?.find((player) => player.playerId === playerId)?.ready);
}

function canPlaceShips() {
  if (!isViewingLiveRoom() || !state.session) return false;
  if (isWaitingRoomStage()) return false;
  if (!state.game) return true;
  const me = state.game.players.find((player) => player.playerId === state.session.playerId);
  return Boolean(me) && !me.ready && state.game.phase !== "playing" && state.game.phase !== "finished";
}

function canFire() {
  return Boolean(isViewingLiveRoom() && state.game?.canFire && state.game?.opponentBoard?.playerId);
}

function isRoomRoute() {
  return state.route?.name === "room";
}

function isViewingLiveRoom() {
  return state.route?.name === "room" && state.session?.roomId === state.route.roomId;
}

function hasSavedSessionForRoom(roomId) {
  return Boolean(
    roomId &&
    state.session?.roomId === roomId &&
    state.session?.playerId &&
    state.session?.playerToken
  );
}

function isHostPlayer() {
  return Boolean(isViewingLiveRoom() && state.room?.hostPlayerId === state.session?.playerId);
}

function hasAllPlayers() {
  return (state.room?.players?.length || 0) >= 2;
}

function isWaitingRoomStage() {
  return Boolean(isRoomRoute() && state.room?.status === "waiting");
}

function seatLabel() {
  if (!state.room || !state.session) return "Waiting";
  const index = state.room.players.findIndex((player) => player.playerId === state.session.playerId);
  return index >= 0 ? `Seat ${index + 1}` : "Waiting";
}

function sessionIdentityLabel() {
  if (!state.session) return "Not Joined";
  if (state.room?.hostPlayerId === state.session.playerId) return "Host";
  return "Player";
}

function gameResultText(game) {
  const winner = game.winnerPlayerId;
  if (winner === "DRAW") return "Draw!";
  if (winner === state.session?.playerId) return "You won!";
  return `${playerNameForId(winner)} won!`;
}

function renderWinnerLabel() {
  if (!state.game?.winnerPlayerId) return "None yet";
  if (state.game.winnerPlayerId === "DRAW") return "Draw";
  return playerNameForId(state.game.winnerPlayerId);
}

function waitingRoomHeadline() {
  if (!state.room) return "Loading room state...";
  if (!hasAllPlayers()) {
    return isHostPlayer() ? "Invite one more player to fill seat 2." : "Seat 1 is taken. Join now to play.";
  }
  return isHostPlayer()
    ? "Both seats are ready. Start the game when you are ready."
    : "Both seats are filled. Waiting for the host to start.";
}

function waitingRoomSubline() {
  if (!state.room) return "Loading room state...";
  if (!isViewingLiveRoom()) return "Enter a name below and tap Join to sit down.";
  if (hasAllPlayers()) return "";
  return "Pick a seat and join this room to start playing.";
}

function stageSubline() {
  if (state.game.phase === "setup") {
    return canPlaceShips()
      ? "Arrange your fleet and lock your layout."
      : "Waiting for the other player to finish setup.";
  }
  if (state.game.phase === "playing") {
    return state.game.canFire
      ? "Choose a target on the opponent board."
      : "The round will resolve after both players submit.";
  }
  if (state.game.phase === "finished") {
    return renderWinnerLabel() === "Draw"
      ? "The match ended in a draw."
      : `${renderWinnerLabel()} won this room.`;
  }
  return "Waiting for the next step.";
}

function roomStateLine() {
  if (!state.room) return "Loading room state...";
  const hostLabel = state.room.hostPlayerName ? `Host ${state.room.hostPlayerName}` : "Host pending";
  return `Players ${state.room.players.length}/2 · ${formatPhase(state.room.status)} · ${hostLabel}`;
}

function buildSeatStrip(room) {
  const seats = [0, 1].map((index) => room?.players?.[index] || null);
  return seats.map((player, index) => renderSeatCard(player, index + 1, room)).join("");
}

function renderSeatCard(player, seatNumber, room) {
  if (!player) {
    const canJoin = !isViewingLiveRoom() && room?.status === "waiting";
    return `
      <div class="seat-card seat-empty">
        <div class="seat-avatar">
          ${canJoin
            ? '<button class="seat-join-button" data-join-seat type="button">Join</button>'
            : '<div class="seat-name">+</div>'}
          <span class="seat-index">${seatNumber}</span>
        </div>
        <div class="seat-helper">${canJoin ? "Tap to take this seat" : "Open seat"}</div>
      </div>
    `;
  }

  const isHost = room?.hostPlayerId === player.playerId;
  const isMe = state.session?.playerId === player.playerId;
  const ready = playerReady(player.playerId);
  const emoji = firstEmoji(player.playerName) || "🙂";
  const label = stripLeadingEmoji(player.playerName) || player.playerName || `Player ${seatNumber}`;

  return `
    <div class="seat-card">
      <div class="seat-avatar">
        <div class="seat-badge-stack">
          ${isHost ? '<span class="seat-badge">HOST</span>' : ""}
          ${isMe ? '<span class="seat-badge">YOU</span>' : ""}
        </div>
        <div class="seat-name">${escapeHtml(emoji)}</div>
        <span class="seat-status-dot${ready ? "" : " hidden"}"></span>
        <span class="seat-index">${seatNumber}</span>
      </div>
      <div class="seat-helper">${escapeHtml(label)}</div>
    </div>
  `;
}

// ── Utilities ────────────────────────────────────────────────────────────────

function firstEmoji(value) {
  if (!value) return "";
  const match = String(value).trim().match(/^\p{Extended_Pictographic}/u);
  return match ? match[0] : "";
}

function stripLeadingEmoji(value) {
  if (!value) return "";
  return String(value).trim().replace(/^\p{Extended_Pictographic}\s*/u, "");
}

async function apiRequest(path, options = {}) {
  const url = `${state.config.restUrl}${path}`;
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(payload.error || `Request failed (${response.status})`);
  }
  return payload;
}

function ensureConfigured() {
  if (els.restUrl.value.trim() && els.wsUrl.value.trim()) {
    state.config.restUrl = normalizeBaseUrl(els.restUrl.value);
    state.config.wsUrl = normalizeBaseUrl(els.wsUrl.value);
    localStorage.setItem(CONFIG_KEY, JSON.stringify(state.config));
  }
  if (!state.config.restUrl || !state.config.wsUrl) {
    throw new Error("REST and WebSocket base URLs are not configured.");
  }
}

function requirePlayerName() {
  const playerName = state.profileName.trim();
  if (playerName) return playerName.slice(0, 24);
  const fallbackName = generateDefaultPlayerName();
  syncPlayerNameInputs(fallbackName);
  return fallbackName;
}

function generateDefaultPlayerName() {
  return ANIMAL_EMOJIS[Math.floor(Math.random() * ANIMAL_EMOJIS.length)];
}

let toastHideTimer = null;

function showToast(message, isError = false) {
  if (!els.toast) return;
  els.toast.textContent = message;
  els.toast.classList.toggle("toast--error", isError);
  els.toast.classList.remove("hidden");
  window.clearTimeout(toastHideTimer);
  toastHideTimer = window.setTimeout(() => {
    els.toast.classList.add("hidden");
  }, 4200);
}

async function copyRoomLink() {
  if (state.route?.name !== "room") return;
  const fullUrl = `${window.location.origin}${roomPath(state.route.roomId)}`;
  try {
    await navigator.clipboard.writeText(fullUrl);
    showToast("Link copied. Share with your friends.");
  } catch (error) {
    showToast("Could not copy. Please copy the address from your browser.", true);
  }
}

function setStatus(_message, _isError = false) {}

function setConnectionStatus(_message) {}

function shortId(value) {
  return value ? value.slice(0, 8) : "";
}

function playerNameForId(playerId) {
  if (!playerId) return "Unknown";
  const roomPlayer = state.room?.players?.find((player) => player.playerId === playerId);
  if (roomPlayer?.playerName) return roomPlayer.playerName;
  if (state.session?.playerId === playerId && state.session?.playerName) return state.session.playerName;
  return shortId(playerId);
}

function normalizeBaseUrl(url) {
  return url.trim().replace(/\/$/, "");
}

function normalizeRoomId(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 4);
  els.lobbyRoomIdInput.value = digits;
  return digits.length === 4 ? digits : "";
}

function normalizeInputRoomId(inputEl) {
  const digits = String(inputEl.value || "").replace(/\D/g, "").slice(0, 4);
  inputEl.value = digits;
  return digits.length === 4 ? digits : "";
}

function isRoomIdSegment(value) {
  return /^\d{4}$/.test(value) || /^[A-Za-z0-9]{8}$/.test(value);
}

function roomPath(roomId, gameType) {
  const gt = gameType || state.session?.gameType || state.route?.gameType || "battleship";
  return `/${gt}/${roomId}`;
}

function readJson(key) {
  const raw = localStorage.getItem(key);
  return raw ? JSON.parse(raw) : null;
}

function formatPhase(phase) {
  return (phase || "unknown").replace(/_/g, " ");
}

function formatGameType(gameType) {
  const names = { battleship: "Battleship", chess: "Chess", gomoku: "Gomoku" };
  return names[gameType] || String(gameType || "");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[character]));
}

function toCamel(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}