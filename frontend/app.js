const FLEET = [
  { name: "carrier", size: 5 },
  { name: "battleship", size: 4 },
  { name: "cruiser", size: 3 },
  { name: "submarine", size: 3 },
  { name: "destroyer", size: 2 },
];

const CONFIG_KEY = "gamenowBattleshipConfig";
const SESSION_KEY = "gamenowBattleshipSession";
const PROFILE_KEY = "gamenowBattleshipProfileName";
const ANIMAL_EMOJIS = ["🐱", "🐶", "🐼", "🐯", "🦊", "🐻", "🐨", "🐸", "🐵", "🐧", "🦁", "🐰"];

/** Baked-in API endpoints (same stack as `terraform output rest_api_url` / `websocket_url`). Override via hidden config panel if needed. */
const DEFAULT_API_CONFIG = {
  restUrl: "https://9tnuo0hn4k.execute-api.us-west-2.amazonaws.com/prod",
  wsUrl: "wss://dzhq6f9ar8.execute-api.us-west-2.amazonaws.com/prod",
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
  profileName: "",
  chat: [],
  placement: {
    draft: [],
    selectedShipIndex: null,
  },
};

const els = {};

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  bindEvents();
  loadConfig();
  loadSession();
  // battleship.html 上，把路径规范化（去掉 .html 后缀再解析）
  const rawPath = window.location.pathname.replace(/\/battleship\.html$/, "/battleship");
  state.route = parseRoute(rawPath);
  renderAll();
  void onRouteChanged();
});

function cacheElements() {
  [
    "view-home",
    "view-battleship",
    "view-room",
    "brand-button",
    "home-continue-room",
    "toggle-rules",
    "rules-panel",
    "lobby-player-name-input",
    "lobby-room-id-input",
    "create-room",
    "join-room",
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
  els.brandButton.addEventListener("dblclick", (event) => {
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

  els.toggleRules.addEventListener("click", () => {
    state.rulesOpen = !state.rulesOpen;
    renderRulesPanel();
  });

  els.createRoom.addEventListener("click", createRoom);
  els.joinRoom.addEventListener("click", () => {
    const roomId = normalizeRoomId(els.lobbyRoomIdInput.value);
    if (roomId) {
      void joinRoomByCode(roomId);
    } else {
      setStatus("Please enter a 4-digit room code.", true);
    }
  });
  els.joinCurrentRoom.addEventListener("click", () => {
    if (state.route?.name === "room") {
      void joinRoomByCode(state.route.roomId);
    }
  });
  els.roomContinueCurrent.addEventListener("click", () => {
    if (state.session?.roomId) {
      navigateTo(roomPath(state.session.roomId));
    }
  });

  els.copyRoomLink.addEventListener("click", copyRoomLink);
  els.refreshRoom.addEventListener("click", refreshAll);
  els.leaveRoom.addEventListener("click", leaveRoom);
  els.endGameBtn.addEventListener("click", forfeitGame);
  els.startGame.addEventListener("click", startRoom);
  els.leaveSeat.addEventListener("click", leaveRoom);
  els.toggleOrientation.addEventListener("click", rotateSelectedShip);
  els.randomizeShips.addEventListener("click", randomizeShips);
  els.resetShips.addEventListener("click", resetShips);
  els.submitShips.addEventListener("click", submitShips);
  els.sendChat.addEventListener("click", sendChat);

  els.chatInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      sendChat();
    }
  });

  els.lobbyPlayerNameInput.addEventListener("input", (event) => syncPlayerNameInputs(event.target.value));
  els.roomPlayerNameInput.addEventListener("input", (event) => syncPlayerNameInputs(event.target.value));
  els.lobbyRoomIdInput.addEventListener("input", () => normalizeRoomId(els.lobbyRoomIdInput.value));

  els.saveConfig.addEventListener("click", saveConfig);
  els.closeConfig.addEventListener("click", closeConfigPanel);
  els.configBackdrop.addEventListener("click", closeConfigPanel);

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
  state.session = readJson(SESSION_KEY);
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
  els.lobbyPlayerNameInput.value = normalized;
  els.roomPlayerNameInput.value = normalized;
  if (persist) {
    localStorage.setItem(PROFILE_KEY, normalized);
  }
}

function persistSession() {
  if (state.session) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(state.session));
  } else {
    localStorage.removeItem(SESSION_KEY);
  }
}

function parseRoute(pathname) {
  const segments = pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  if (segments.length === 0) {
    return { name: "home" };
  }
  if (segments[0] === "battleship" && segments.length === 1) {
    return { name: "battleship" };
  }
  if (segments[0] === "battleship" && segments.length === 2 && isRoomIdSegment(segments[1])) {
    return { name: "room", roomId: segments[1] };
  }
  return { name: "home" };
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
    renderAll();
    return;
  }

  if (state.route.roomId) {
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
  if (state.config.restUrl) {
    await fetchPublicRoom(state.route.roomId);
  }
  renderAll();
}

async function createRoom() {
  try {
    ensureConfigured();
    const playerName = requirePlayerName();
    const room = await apiRequest("/rooms", {
      method: "POST",
      body: {
        gameType: "battleship",
        playerName,
      },
    });

    setSession(room);
    navigateTo(roomPath(room.roomId));
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

    setSession(room);
    if (state.route?.name !== "room" || state.route.roomId !== room.roomId) {
      navigateTo(roomPath(room.roomId));
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
    clearSession("You left the room.");
    navigateTo("/battleship");
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
    setStatus("Game started. Place your fleet.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function forfeitGame() {
  if (!state.session) {
    return;
  }
  if (!confirm("End this game and return to the room lobby?")) {
    return;
  }
  try {
    await apiRequest(`/battleship/${state.session.roomId}/forfeit`, {
      method: "POST",
      body: {
        playerId: state.session.playerId,
        playerToken: state.session.playerToken,
      },
    });
    state.game = null;
    await refreshAll();
    setStatus("Game ended. Room is back to the lobby.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function kickPlayer(targetPlayerId) {
  if (!state.session) {
    return;
  }

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
      if (!isWaitingRoomStage()) {
        await fetchGame();
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
  if (!roomId) {
    return;
  }

  try {
    state.room = await apiRequest(`/rooms/${roomId}`);
  } catch (error) {
    state.room = null;
    throw error;
  }
}

async function fetchGame() {
  if (!state.session) {
    return;
  }
  const query = new URLSearchParams({
    playerId: state.session.playerId,
    playerToken: state.session.playerToken,
  });
  state.game = await apiRequest(`/battleship/${state.session.roomId}?${query.toString()}`);
}

function connectSocket() {
  if (!isViewingLiveRoom() || !state.config.wsUrl) {
    return;
  }

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
  if (!isViewingLiveRoom()) {
    return;
  }
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
  if (!state.ws) {
    return;
  }
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
    state.game = payload.state;
    renderAll();
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
  if (!message) {
    return;
  }
  sendWs({ action: "sendChat", message });
  els.chatInput.value = "";
}

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
    if (!placed) {
      return null;
    }
  }
  return draft;
}

function ensureSetupFleetRandomized() {
  if (!canPlaceShips() || state.placement.draft.length > 0) {
    return;
  }
  const draft = buildRandomFleetDraft();
  if (draft) {
    state.placement.draft = draft;
    state.placement.selectedShipIndex = null;
  }
}

function rotateSelectedShip() {
  if (!canPlaceShips()) {
    return;
  }
  const idx = state.placement.selectedShipIndex;
  if (idx === null || idx === undefined) {
    showToast("Select a ship on your board first.", true);
    return;
  }
  const cur = state.placement.draft[idx];
  if (!cur) {
    return;
  }
  const pl = {
    ...cur,
    orientation: cur.orientation === "horizontal" ? "vertical" : "horizontal",
  };
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
  if (!state.session || !canFire()) {
    return;
  }

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

function setSession(roomSession) {
  state.session = {
    roomId: roomSession.roomId,
    playerId: roomSession.playerId,
    playerToken: roomSession.playerToken,
    playerName: roomSession.playerName,
    hostPlayerId: roomSession.hostPlayerId,
  };
  syncPlayerNameInputs(roomSession.playerName);
  state.room = null;
  state.game = null;
  state.chat = [];
  state.placement.draft = [];
  state.placement.selectedShipIndex = null;
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
  state.roomJoined = false;
  persistSession();
  renderAll();
  if (message) {
    setStatus(message);
  }
}

function renderAll() {
  renderRoute();
  renderConfigPanel();
  renderRulesPanel();
  renderHome();
  renderRoomPageHeader();
  renderRoomAccess();
  renderSessionSummary();
  renderRoom();
  renderGame();
  renderChat();
  renderBoards();
  renderPlacementSummary();
}

function renderRoute() {
  els.viewHome?.classList.toggle("hidden", state.route.name !== "home");
  els.viewBattleship?.classList.toggle("hidden", state.route.name !== "battleship");
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
  els.rulesPanel.classList.toggle("hidden", !state.rulesOpen);
  if (els.toggleRules) {
    els.toggleRules.setAttribute("aria-expanded", String(state.rulesOpen));
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
    <div class="mode-pill">Mode: Battleship</div>
    <div>${escapeHtml(roomStateLine())}</div>
  `;
  renderWaitingActions();

  const inGame = isViewingLiveRoom() && !isWaitingRoomStage();
  els.endGameBtn.classList.toggle("hidden", !inGame);
}

function renderGame() {
  if (els.battleStatusLine) {
    els.battleStatusLine.classList.add("hidden");
  }

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
  if (!show) {
    return;
  }

  const host = isHostPlayer();
  const full = hasAllPlayers();
  els.startGame.classList.toggle("hidden", !host);
  els.startGame.disabled = !full;
  els.leaveSeat.disabled = false;
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
  if (!state.game) {
    return "";
  }
  if (state.game.phase === "finished") {
    return "Match over";
  }
  if (state.game.phase !== "playing") {
    return "";
  }
  const raw = state.game.opponentBoard?.playerName || "Opponent";
  const opponentName = stripLeadingEmoji(raw) || raw;
  const meSubmitted = state.game.shotSubmittedThisRound;
  const oppSubmitted = state.game.currentRound?.opponentSubmitted;
  if (!meSubmitted && !oppSubmitted) {
    return `Waiting For You and ${opponentName}`;
  }
  if (!meSubmitted && oppSubmitted) {
    return "Waiting For You";
  }
  if (meSubmitted && !oppSubmitted) {
    return `Waiting For ${opponentName}`;
  }
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
      if (meta.isBow && !received.has(cell)) {
        bow = true;
      }
      if (state.placement.selectedShipIndex === meta.shipIndex) {
        classes.push("ship-selected");
      }
    } else if (shipCells.has(cell)) {
      const pub = shipCells.get(cell);
      const hue = shipHueIndex(pub.name);
      classes.push("ship", `ship-hue-${hue}`);
      const order = pub.cells || [];
      if (order[0] === cell && !received.has(cell)) {
        bow = true;
      }
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
    if (canPlaceShips()) {
      classes.push("clickable");
    }

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
  if (!canPlaceShips()) {
    return;
  }
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
  if (idx === null || idx === undefined) {
    return;
  }
  const current = state.placement.draft[idx];
  if (!current) {
    return;
  }
  const pl = {
    name: current.name,
    startRow: row,
    startCol: col,
    orientation: current.orientation,
  };
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
  if (cellA === cellB) {
    return true;
  }
  const [r1, c1] = cellA.split(",").map(Number);
  const [r2, c2] = cellB.split(",").map(Number);
  return Math.abs(r1 - r2) <= 1 && Math.abs(c1 - c2) <= 1;
}

function isFleetPlacementValid(draft) {
  if (!draft || draft.length !== FLEET.length) {
    return false;
  }
  for (let i = 0; i < draft.length; i += 1) {
    if (!canPlaceShip(draft[i], draftWithoutShipIndex(i))) {
      return false;
    }
  }
  return true;
}

function canPlaceShip(placement, draft) {
  try {
    const cells = shipCellsFromPlacement(placement);
    const occupied = new Set(draft.flatMap(shipCellsFromPlacement));
    if (!cells.every((cell) => !occupied.has(cell))) {
      return false;
    }
    for (const other of draft) {
      const otherCells = shipCellsFromPlacement(other);
      for (const c of cells) {
        for (const o of otherCells) {
          if (cellsAre8Neighbors(c, o)) {
            return false;
          }
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
  if (!ship) {
    throw new Error("Unknown ship");
  }

  const cells = [];
  for (let offset = 0; offset < ship.size; offset += 1) {
    const row = placement.startRow + (placement.orientation === "vertical" ? offset : 0);
    const col = placement.startCol + (placement.orientation === "horizontal" ? offset : 0);
    if (row < 0 || row >= 10 || col < 0 || col >= 10) {
      throw new Error("Out of bounds");
    }
    cells.push(`${row},${col}`);
  }
  return cells;
}

function playerReady(playerId) {
  return Boolean(state.game?.players?.find((player) => player.playerId === playerId)?.ready);
}

function canPlaceShips() {
  if (!isViewingLiveRoom() || !state.session) {
    return false;
  }
  if (isWaitingRoomStage()) {
    return false;
  }
  if (!state.game) {
    return true;
  }
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
  if (!state.room || !state.session) {
    return "Waiting";
  }
  const index = state.room.players.findIndex((player) => player.playerId === state.session.playerId);
  return index >= 0 ? `Seat ${index + 1}` : "Waiting";
}

function sessionIdentityLabel() {
  if (!state.session) {
    return "Not Joined";
  }
  if (state.room?.hostPlayerId === state.session.playerId) {
    return "Host";
  }
  return "Player";
}

function battleTitle() {
  if (!state.game) {
    return "Waiting to Start";
  }
  if (state.game.phase === "finished") {
    return renderWinnerLabel() === "Draw" ? "Draw Game" : `${renderWinnerLabel()} Wins`;
  }
  return combatStatus();
}

function combatStatus() {
  if (!state.game) {
    return "Waiting for match state.";
  }
  if (state.game.phase === "waiting_for_players") {
    return "Waiting for a second player.";
  }
  if (state.game.phase === "setup") {
    return canPlaceShips() ? "Deploy your fleet first." : "Waiting for the opponent to lock their fleet.";
  }
  if (state.game.phase === "finished") {
    return renderWinnerLabel() === "Draw" ? "Both fleets were destroyed at the same time." : `${renderWinnerLabel()} won the match.`;
  }
  if (state.game.canFire) {
    return "Ready to fire";
  }
  if (state.game.waitingForOpponent) {
    return "Shot submitted, waiting for opponent";
  }
  if (state.game.currentRound?.opponentSubmitted && !state.game.currentRound?.yourShot) {
    return "Opponent fired, submit your shot";
  }
  return "Round resolved";
}

function renderWinnerLabel() {
  if (!state.game?.winnerPlayerId) {
    return "None yet";
  }
  if (state.game.winnerPlayerId === "DRAW") {
    return "Draw";
  }
  return playerNameForId(state.game.winnerPlayerId);
}

function fleetStatus() {
  if (!state.game) {
    return "Not deployed";
  }
  const me = state.game.players.find((player) => player.playerId === state.session?.playerId);
  if (!me?.ready) {
    return `${state.placement.draft.length}/${FLEET.length} ships placed`;
  }
  const remaining = state.game.ownBoard.ships.reduce((count, ship) => count + (ship.sunk ? 0 : 1), 0);
  return `${remaining} ships still afloat`;
}

function summaryCard(label, value) {
  return `
    <div class="summary-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
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

function roomStateLine() {
  if (!state.room) {
    return "Loading room state...";
  }
  const hostLabel = state.room.hostPlayerName ? `Host ${state.room.hostPlayerName}` : "Host pending";
  return `Players ${state.room.players.length}/2 · ${formatPhase(state.room.status)} · ${hostLabel}`;
}

function waitingRoomHeadline() {
  if (!state.room) {
    return "Loading room state...";
  }
  if (!hasAllPlayers()) {
    return isHostPlayer() ? "Invite one more player to fill seat 2." : "Seat 1 is taken. Join now to play.";
  }
  return isHostPlayer() ? "Both seats are ready. Start the game when you are ready." : "Both seats are filled. Waiting for the host to start.";
}

function waitingRoomSubline() {
  if (!state.room) {
    return "Loading room state...";
  }
  if (!isViewingLiveRoom()) {
    return "Enter a name below and tap Join to sit down.";
  }
  if (hasAllPlayers()) {
    return "";
  }
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

function firstEmoji(value) {
  if (!value) {
    return "";
  }
  const match = String(value).trim().match(/^\p{Extended_Pictographic}/u);
  return match ? match[0] : "";
}

function stripLeadingEmoji(value) {
  if (!value) {
    return "";
  }
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
  if (playerName) {
    return playerName.slice(0, 24);
  }

  const fallbackName = generateDefaultPlayerName();
  syncPlayerNameInputs(fallbackName);
  return fallbackName;
}

function generateDefaultPlayerName() {
  return ANIMAL_EMOJIS[Math.floor(Math.random() * ANIMAL_EMOJIS.length)];
}

let toastHideTimer = null;

function showToast(message, isError = false) {
  if (!els.toast) {
    return;
  }
  els.toast.textContent = message;
  els.toast.classList.toggle("toast--error", isError);
  els.toast.classList.remove("hidden");
  window.clearTimeout(toastHideTimer);
  toastHideTimer = window.setTimeout(() => {
    els.toast.classList.add("hidden");
  }, 4200);
}

async function copyRoomLink() {
  if (state.route?.name !== "room") {
    return;
  }
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
  if (!playerId) {
    return "Unknown";
  }
  const roomPlayer = state.room?.players?.find((player) => player.playerId === playerId);
  if (roomPlayer?.playerName) {
    return roomPlayer.playerName;
  }
  if (state.session?.playerId === playerId && state.session?.playerName) {
    return state.session.playerName;
  }
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

function isRoomIdSegment(value) {
  return /^\d{4}$/.test(value) || /^[A-Za-z0-9]{8}$/.test(value);
}

function roomPath(roomId) {
  return `/battleship/${roomId}`;
}

function readJson(key) {
  const raw = localStorage.getItem(key);
  return raw ? JSON.parse(raw) : null;
}

function formatPhase(phase) {
  return (phase || "unknown").replace(/_/g, " ");
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