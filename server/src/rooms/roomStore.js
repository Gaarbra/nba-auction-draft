import { randomUUID } from "node:crypto";
import { initializeDraft, removePlayerFromDraft } from "./draftStore.js";
import { ERA_BUCKETS } from "../services/era.js";

const VALID_ERA_IDS = new Set(["all", "active", ...ERA_BUCKETS.map((b) => b.id)]);

const rooms = new Map();

const MIN_PLAYERS = 1;
const MAX_PLAYERS = 4;
const STARTING_BUDGET = 20;

// How long a disconnected player's slot is held open for them to reclaim via
// room:rejoin before their team is finalized without them.
export const RECONNECT_GRACE_MS = 60_000;

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  } while (rooms.has(code));
  return code;
}

export function createRoom() {
  const code = generateRoomCode();
  const room = {
    code,
    players: [],
    status: "waiting",
    createdAt: Date.now(),
    // playerId -> setTimeout handle, for pending disconnect-grace forfeits.
    pendingForfeits: new Map(),
  };
  rooms.set(code, room);
  return room;
}

export function getRoom(code) {
  return rooms.get(code?.toUpperCase());
}

function normalizeName(name) {
  return (name || "").trim().slice(0, 30);
}

export function addPlayerToRoom(code, { name, socketId }) {
  const room = getRoom(code);
  if (!room) {
    return { error: "ROOM_NOT_FOUND" };
  }
  if (room.status !== "waiting") {
    return { error: "DRAFT_ALREADY_STARTED" };
  }
  if (room.players.length >= MAX_PLAYERS) {
    return { error: "ROOM_FULL" };
  }

  const playerName = normalizeName(name);
  if (room.players.some((p) => p.name.toLowerCase() === playerName.toLowerCase())) {
    return { error: "NAME_TAKEN" };
  }

  const newPlayer = {
    id: randomUUID(),
    name: playerName,
    budget: STARTING_BUDGET,
    isHost: room.players.length === 0,
    socketId,
    connected: true,
    forfeited: false,
    disconnectedAt: null,
  };
  room.players.push(newPlayer);
  return { room, player: newPlayer };
}

export function startDraft(code, playerId, era, allowPositionSwaps) {
  const room = getRoom(code);
  if (!room) {
    return { error: "ROOM_NOT_FOUND" };
  }

  const player = room.players.find((p) => p.id === playerId);
  if (!player) {
    return { error: "NOT_IN_ROOM" };
  }
  if (!player.isHost) {
    return { error: "NOT_HOST" };
  }
  if (room.status !== "waiting") {
    return { error: "ALREADY_STARTED" };
  }
  if (room.players.length < MIN_PLAYERS) {
    return { error: "NOT_ENOUGH_PLAYERS" };
  }
  const draftEra = era || "all";
  if (!VALID_ERA_IDS.has(draftEra)) {
    return { error: "INVALID_ERA" };
  }

  room.status = "drafting";
  room.draftEra = draftEra;
  room.allowPositionSwaps = Boolean(allowPositionSwaps);
  initializeDraft(room);
  return { room };
}

function clearPendingForfeit(room, playerId) {
  const timer = room.pendingForfeits.get(playerId);
  if (timer) {
    clearTimeout(timer);
    room.pendingForfeits.delete(playerId);
  }
}

function reassignHostIfNeeded(room, departedPlayer) {
  if (!departedPlayer.isHost) return;
  const nextHost = room.players.find((p) => p.id !== departedPlayer.id && p.connected);
  if (nextHost) nextHost.isHost = true;
}

/**
 * Permanently ends a player's participation — either because they clicked
 * "Leave Room" or because their reconnect grace period ran out. In the
 * lobby (status "waiting") this is a plain removal, same as before. Once
 * drafting has started, the player is deliberately NOT removed from
 * room.players: their roster (however incomplete) needs to still be there
 * for the end-of-draft scoring pass to rank, so we just mark them
 * disconnected/forfeited and drop them from the live turn order.
 */
export function finalizePlayerExit(room, playerId) {
  clearPendingForfeit(room, playerId);
  const player = room.players.find((p) => p.id === playerId);
  if (!player) return { room };

  if (room.status === "waiting") {
    room.players = room.players.filter((p) => p.id !== playerId);
    reassignHostIfNeeded(room, player);
  } else {
    player.connected = false;
    player.forfeited = true;
    reassignHostIfNeeded(room, player);
    if (room.status === "drafting") {
      removePlayerFromDraft(room, playerId);
    }
  }

  const anyoneConnected = room.players.some((p) => p.connected);
  if (!anyoneConnected) {
    rooms.delete(room.code);
    return { room: null, roomCode: room.code };
  }

  return { room, roomCode: room.code };
}

/** Marks a player disconnected and starts their reconnect grace timer. `onExpire` runs finalizePlayerExit and broadcasts once the timer fires. */
export function beginDisconnectGrace(room, playerId, socketId, onExpire) {
  const player = room.players.find((p) => p.id === playerId);
  // Guard against a stale socket's disconnect firing after the player has
  // already reconnected on a new socket (e.g. a flaky connection racing a
  // fresh room:rejoin) — only the currently-registered socket may start the
  // grace timer.
  if (!player || player.socketId !== socketId) return;

  player.connected = false;
  player.disconnectedAt = Date.now();

  const timer = setTimeout(() => {
    room.pendingForfeits.delete(playerId);
    onExpire();
  }, RECONNECT_GRACE_MS);
  room.pendingForfeits.set(playerId, timer);
}

export function reconnectPlayer(code, playerId, socketId) {
  const room = getRoom(code);
  if (!room) return { error: "ROOM_NOT_FOUND" };

  const player = room.players.find((p) => p.id === playerId);
  if (!player) return { error: "PLAYER_NOT_FOUND" };

  // If this identity was already live on a different socket (e.g. the same
  // person opened a second tab that shares localStorage), that previous
  // socket is about to become a zombie — its owner should be told to boot
  // it, rather than the room silently flip-flopping which tab is "really"
  // them. The caller (which has access to `io`) is responsible for actually
  // disconnecting it.
  const previousSocketId = player.connected ? player.socketId : null;

  clearPendingForfeit(room, playerId);
  player.connected = true;
  player.forfeited = false;
  player.disconnectedAt = null;
  player.socketId = socketId;

  return { room, player, previousSocketId: previousSocketId !== socketId ? previousSocketId : null };
}

export const config = { MIN_PLAYERS, MAX_PLAYERS, STARTING_BUDGET };
