/**
 * Shared frontend helpers for GameNow pages that load plain scripts (no bundler).
 * Used by: app.js (Battleship / Chess / Gomoku), uno.js (UNO).
 * HTML must load this file before app.js or uno.js.
 */
(function initGameNowCommon(win) {
  const ANIMAL_EMOJIS = ["🐱", "🐶", "🐼", "🐯", "🦊", "🐻", "🐨", "🐸", "🐵", "🐧", "🦁", "🐰"];

  function readJson(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function normalizeBaseUrl(url) {
    return String(url || "").trim().replace(/\/$/, "");
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[character]));
  }

  function firstEmoji(value) {
    if (!value) return "";
    const match = String(value).trim().match(/^\p{Extended_Pictographic}/u);
    return match ? match[0] : "";
  }

  function stripLeadingEmoji(value) {
    if (!value) return "";
    return String(value).trim().replace(/^\p{Extended_Pictographic}\s*/u, "");
  }

  function pickRandomAnimalEmoji() {
    return ANIMAL_EMOJIS[Math.floor(Math.random() * ANIMAL_EMOJIS.length)];
  }

  /** API / Dynamo room id: "battleship#7089" → display segment "7089". */
  function numericRoomCode(roomId) {
    if (roomId == null || roomId === "") return "";
    const s = String(roomId);
    const i = s.indexOf("#");
    if (i >= 0) return s.slice(i + 1);
    return s;
  }

  /** Build storage id from lobby game type + 4-digit code. */
  function compositeRoomId(gameType, numericCode) {
    const digits = String(numericCode || "").replace(/\D/g, "").slice(0, 4);
    const gt = String(gameType || "").trim();
    if (!gt || digits.length !== 4) return "";
    return `${gt}#${digits}`;
  }

  win.GameNowCommon = {
    ANIMAL_EMOJIS,
    readJson,
    normalizeBaseUrl,
    escapeHtml,
    firstEmoji,
    stripLeadingEmoji,
    pickRandomAnimalEmoji,
    numericRoomCode,
    compositeRoomId,
  };
})(typeof window !== "undefined" ? window : globalThis);
