import {
  createRoom,
  addPlayerToRoom,
  startDraft,
  getRoom,
  finalizePlayerExit,
  beginDisconnectGrace,
  reconnectPlayer,
  RECONNECT_GRACE_MS,
} from "../rooms/roomStore.js";
import { nominatePlayer, placeBid, passOnNomination, assignPosition, swapRosterPositions } from "../rooms/draftStore.js";
import { getPlayers } from "../services/playerCache.js";
import { filterPlayersByEra } from "../services/era.js";
import { fetchPlayerStats } from "../services/statsClient.js";
import { computeDraftResults } from "../scoring/computeResults.js";
import { createKeyedRateLimiter, createSocketEventLimiter } from "../middleware/rateLimit.js";

const MAX_STATS_DRAW_ATTEMPTS = 6;
const MIN_ROLL_MS = 1400;
const MAX_NAME_LENGTH = 30;

// Shared across every connection (module scope) — caps how many rooms a
// single IP can spin up, since an unbounded flood of rooms is the one
// server-memory-exhaustion vector a per-socket limiter alone can't catch
// (a script could just open a fresh socket per room).
const roomCreateLimiter = createKeyedRateLimiter({ windowMs: 10 * 60_000, max: 15 });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function drawPlayerWithStats(candidates) {
  const pool = [...candidates];
  let lastPlayer = null;

  for (let attempt = 0; attempt < MAX_STATS_DRAW_ATTEMPTS && pool.length > 0; attempt += 1) {
    const index = Math.floor(Math.random() * pool.length);
    const [candidate] = pool.splice(index, 1);
    const result = await fetchPlayerStats(candidate.id);
    lastPlayer = candidate;
    if (result) {
      // Pool entries (nbaPlayersClient.js) only carry id/name/active-status/
      // career span — position, team, and draft year live in the stats
      // response instead (see stats-service's fetch_stats_for_player).
      return {
        player: {
          ...candidate,
          position: result.stats.position ?? null,
          team: result.stats.team ? { abbreviation: result.stats.team } : null,
          draftYear: result.stats.draftYear ?? null,
        },
        stats: result.stats,
        nbaPlayerId: result.nbaPlayerId,
      };
    }
  }

  return { player: lastPlayer, stats: { unavailable: true }, nbaPlayerId: null };
}

function toPublicRoom(room) {
  const base = {
    code: room.code,
    status: room.status,
    draftEra: room.draftEra || null,
    allowPositionSwaps: room.allowPositionSwaps || false,
    resultsStatus: room.resultsStatus || null,
    results: room.results || null,
    reconnectGraceMs: RECONNECT_GRACE_MS,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      budget: p.budget,
      isHost: p.isHost,
      connected: p.connected,
      forfeited: p.forfeited,
      disconnectedAt: p.disconnectedAt,
    })),
  };

  if (!room.draft) return base;

  return {
    ...base,
    draft: {
      turnOrder: room.draft.turnOrder,
      currentNominatorId: room.draft.currentNominatorId,
      rosters: room.draft.rosters,
      draftedPlayerIds: room.draft.draftedPlayerIds,
      nomination: room.draft.nomination,
    },
  };
}

/** Kicks off the (slow, one-time) end-of-draft scoring pass if the draft just completed and hasn't been scored yet. */
function maybeComputeResults(io, room, roomCode) {
  if (room.status !== "complete" || room.results || room.resultsStatus === "computing") return;

  room.resultsStatus = "computing";
  io.to(roomCode).emit("room:update", toPublicRoom(room));

  computeDraftResults(room)
    .then((results) => {
      room.results = results;
      room.resultsStatus = "ready";
      io.to(roomCode).emit("room:update", toPublicRoom(room));
    })
    .catch((err) => {
      console.error(`[computeDraftResults] failed for room ${roomCode}:`, err);
      room.resultsStatus = "failed";
      io.to(roomCode).emit("room:update", toPublicRoom(room));
    });
}

export function registerRoomHandlers(io, socket) {
  // Cheap per-connection throttle against a spammy/scripted client hammering
  // any of these events — each socket gets its own independent counter.
  const allowEvent = createSocketEventLimiter(10_000, 40);

  socket.on("room:create", ({ name } = {}, callback) => {
    if (!allowEvent()) return callback?.({ error: "RATE_LIMITED" });
    if (typeof name !== "string" || !name.trim()) {
      return callback?.({ error: "NAME_REQUIRED" });
    }
    if (name.trim().length > MAX_NAME_LENGTH) {
      return callback?.({ error: "NAME_TOO_LONG" });
    }
    const clientIp = socket.handshake.address;
    if (clientIp && !roomCreateLimiter(clientIp)) {
      return callback?.({ error: "RATE_LIMITED" });
    }

    const room = createRoom();
    const result = addPlayerToRoom(room.code, { name, socketId: socket.id });

    if (result.error) {
      return callback?.({ error: result.error });
    }

    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.playerId = result.player.id;

    callback?.({ room: toPublicRoom(result.room), playerId: result.player.id });
    io.to(room.code).emit("room:update", toPublicRoom(result.room));
  });

  socket.on("room:join", ({ code, name } = {}, callback) => {
    if (!allowEvent()) return callback?.({ error: "RATE_LIMITED" });
    const roomCode = (code || "").trim().toUpperCase();
    if (typeof name !== "string" || !name.trim() || !roomCode) {
      return callback?.({ error: "NAME_AND_CODE_REQUIRED" });
    }
    if (name.trim().length > MAX_NAME_LENGTH) {
      return callback?.({ error: "NAME_TOO_LONG" });
    }

    const result = addPlayerToRoom(roomCode, { name, socketId: socket.id });

    if (result.error) {
      return callback?.({ error: result.error });
    }

    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.data.playerId = result.player.id;

    callback?.({ room: toPublicRoom(result.room), playerId: result.player.id });
    io.to(roomCode).emit("room:update", toPublicRoom(result.room));
  });

  socket.on("room:rejoin", ({ code, playerId } = {}, callback) => {
    if (!allowEvent()) return callback?.({ error: "RATE_LIMITED" });
    const roomCode = (code || "").trim().toUpperCase();
    if (!roomCode || typeof playerId !== "string" || !playerId) {
      return callback?.({ error: "RECONNECT_FAILED" });
    }

    const result = reconnectPlayer(roomCode, playerId, socket.id);
    if (result.error) {
      return callback?.({ error: "RECONNECT_FAILED" });
    }

    if (result.previousSocketId) {
      // Same identity just came back on a different socket while the old
      // one was still marked live — most likely a duplicate tab. Boot the
      // old connection so it shows an honest "disconnected" state instead
      // of silently going stale while this one takes over.
      io.sockets.sockets.get(result.previousSocketId)?.disconnect(true);
    }

    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.data.playerId = playerId;

    callback?.({ room: toPublicRoom(result.room), playerId });
    io.to(roomCode).emit("room:update", toPublicRoom(result.room));
  });

  socket.on("room:start", ({ era, allowPositionSwaps } = {}, callback) => {
    if (!allowEvent()) return callback?.({ error: "RATE_LIMITED" });
    const roomCode = socket.data.roomCode;
    if (!roomCode) {
      return callback?.({ error: "NOT_IN_ROOM" });
    }

    const result = startDraft(roomCode, socket.data.playerId, era, allowPositionSwaps);
    if (result.error) {
      return callback?.({ error: result.error });
    }

    callback?.({ room: toPublicRoom(result.room) });
    io.to(roomCode).emit("room:update", toPublicRoom(result.room));
  });

  socket.on("draft:nominate", async (payload, callback) => {
    if (!allowEvent()) return callback?.({ error: "RATE_LIMITED" });
    const roomCode = socket.data.roomCode;
    const playerId = socket.data.playerId;
    if (!roomCode || !playerId) return callback?.({ error: "NOT_IN_ROOM" });

    const room = getRoom(roomCode);
    if (!room) return callback?.({ error: "ROOM_NOT_FOUND" });

    // Validate up front, before broadcasting anything — a request that was
    // never going to produce a nomination shouldn't kick off a fake "rolling"
    // animation for everyone else in the room.
    if (room.status !== "drafting") return callback?.({ error: "NOT_DRAFTING" });
    if (room.draft?.nomination) return callback?.({ error: "NOMINATION_IN_PROGRESS" });
    if (room.draft?.currentNominatorId !== playerId) return callback?.({ error: "NOT_YOUR_TURN" });

    // Broadcast to the whole room — including the requester — before doing
    // any of the slow work, so every client's rolling animation starts at
    // the same moment instead of only the nominator seeing it locally.
    io.to(roomCode).emit("draft:rolling");

    const allPlayers = await getPlayers();
    const eraPool = filterPlayersByEra(allPlayers, room.draftEra);
    const drafted = new Set(room.draft?.draftedPlayerIds || []);
    const available = eraPool.filter((p) => !drafted.has(p.id));

    if (available.length === 0) {
      io.to(roomCode).emit("draft:rolling-cancelled");
      return callback?.({ error: "NO_PLAYERS_LEFT" });
    }

    // The actual draw (with its stats-lookup retries) runs alongside a fixed
    // minimum delay, so the shared rolling animation always plays for at
    // least MIN_ROLL_MS even when the draw resolves instantly from cache.
    const [{ player: chosenPlayer, stats, nbaPlayerId }] = await Promise.all([
      drawPlayerWithStats(available),
      sleep(MIN_ROLL_MS),
    ]);

    const result = nominatePlayer(room, playerId, { ...chosenPlayer, stats, nbaPlayerId });
    if (result.error) {
      io.to(roomCode).emit("draft:rolling-cancelled");
      return callback?.({ error: result.error });
    }

    callback?.({ room: toPublicRoom(result.room) });
    io.to(roomCode).emit("room:update", toPublicRoom(result.room));
  });

  socket.on("draft:bid", ({ amount } = {}, callback) => {
    if (!allowEvent()) return callback?.({ error: "RATE_LIMITED" });
    const roomCode = socket.data.roomCode;
    const playerId = socket.data.playerId;
    if (!roomCode || !playerId) return callback?.({ error: "NOT_IN_ROOM" });

    const room = getRoom(roomCode);
    if (!room) return callback?.({ error: "ROOM_NOT_FOUND" });

    const result = placeBid(room, playerId, amount);
    if (result.error) return callback?.({ error: result.error });

    callback?.({ room: toPublicRoom(result.room) });
    io.to(roomCode).emit("room:update", toPublicRoom(result.room));
  });

  socket.on("draft:pass", (payload, callback) => {
    if (!allowEvent()) return callback?.({ error: "RATE_LIMITED" });
    const roomCode = socket.data.roomCode;
    const playerId = socket.data.playerId;
    if (!roomCode || !playerId) return callback?.({ error: "NOT_IN_ROOM" });

    const room = getRoom(roomCode);
    if (!room) return callback?.({ error: "ROOM_NOT_FOUND" });

    const result = passOnNomination(room, playerId);
    if (result.error) return callback?.({ error: result.error });

    callback?.({ room: toPublicRoom(result.room) });
    io.to(roomCode).emit("room:update", toPublicRoom(result.room));
  });

  socket.on("draft:assign", ({ position } = {}, callback) => {
    if (!allowEvent()) return callback?.({ error: "RATE_LIMITED" });
    const roomCode = socket.data.roomCode;
    const playerId = socket.data.playerId;
    if (!roomCode || !playerId) return callback?.({ error: "NOT_IN_ROOM" });

    const room = getRoom(roomCode);
    if (!room) return callback?.({ error: "ROOM_NOT_FOUND" });

    const result = assignPosition(room, playerId, position);
    if (result.error) return callback?.({ error: result.error });

    callback?.({ room: toPublicRoom(result.room) });
    io.to(roomCode).emit("room:update", toPublicRoom(result.room));
    maybeComputeResults(io, result.room, roomCode);
  });

  socket.on("draft:swap-positions", ({ slotA, slotB } = {}, callback) => {
    if (!allowEvent()) return callback?.({ error: "RATE_LIMITED" });
    const roomCode = socket.data.roomCode;
    const playerId = socket.data.playerId;
    if (!roomCode || !playerId) return callback?.({ error: "NOT_IN_ROOM" });

    const room = getRoom(roomCode);
    if (!room) return callback?.({ error: "ROOM_NOT_FOUND" });

    const result = swapRosterPositions(room, playerId, slotA, slotB);
    if (result.error) return callback?.({ error: result.error });

    callback?.({ room: toPublicRoom(result.room) });
    io.to(roomCode).emit("room:update", toPublicRoom(result.room));
  });

  socket.on("room:leave", () => {
    const roomCode = socket.data.roomCode;
    const playerId = socket.data.playerId;
    socket.data.roomCode = undefined;
    socket.data.playerId = undefined;
    if (!roomCode || !playerId) return;

    const room = getRoom(roomCode);
    if (!room) return;

    const result = finalizePlayerExit(room, playerId);
    if (result.room) {
      io.to(roomCode).emit("room:update", toPublicRoom(result.room));
      maybeComputeResults(io, result.room, roomCode);
    }
  });

  socket.on("disconnect", () => {
    const roomCode = socket.data.roomCode;
    const playerId = socket.data.playerId;
    if (!roomCode || !playerId) return;

    const room = getRoom(roomCode);
    if (!room) return;

    beginDisconnectGrace(room, playerId, socket.id, () => {
      const result = finalizePlayerExit(room, playerId);
      if (result.room) {
        io.to(roomCode).emit("room:update", toPublicRoom(result.room));
        maybeComputeResults(io, result.room, roomCode);
      }
    });

    io.to(roomCode).emit("room:update", toPublicRoom(room));
  });
}
