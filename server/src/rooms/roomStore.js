import { initializeDraft, removePlayerFromDraft } from "./draftStore.js";
import { ERA_BUCKETS } from "../services/era.js";

const VALID_ERA_IDS = new Set(["all", "active", ...ERA_BUCKETS.map((b) => b.id)]);

const rooms = new Map();

const MIN_PLAYERS = 1;
const MAX_PLAYERS = 4;
const STARTING_BUDGET = 20;

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
  };
  rooms.set(code, room);
  return room;
}

export function getRoom(code) {
  return rooms.get(code?.toUpperCase());
}

export function addPlayerToRoom(code, player) {
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
  if (room.players.some((p) => p.name.toLowerCase() === player.name.toLowerCase())) {
    return { error: "NAME_TAKEN" };
  }

  const newPlayer = {
    id: player.id,
    name: player.name,
    budget: STARTING_BUDGET,
    isHost: room.players.length === 0,
  };
  room.players.push(newPlayer);
  return { room };
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

export function removePlayerFromSocket(socketId) {
  for (const room of rooms.values()) {
    const index = room.players.findIndex((p) => p.id === socketId);
    if (index !== -1) {
      const [removed] = room.players.splice(index, 1);

      if (removed.isHost && room.players.length > 0) {
        room.players[0].isHost = true;
      }

      if (room.status === "drafting") {
        removePlayerFromDraft(room, removed.id);
      }

      if (room.players.length === 0) {
        rooms.delete(room.code);
      }

      return { room: rooms.has(room.code) ? room : null, roomCode: room.code };
    }
  }
  return null;
}

export const config = { MIN_PLAYERS, MAX_PLAYERS, STARTING_BUDGET };
