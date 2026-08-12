import { createRoom, addPlayerToRoom, removePlayerFromSocket, startDraft, getRoom } from "../rooms/roomStore.js";
import { nominatePlayer, placeBid, passOnNomination, assignPosition, swapRosterPositions } from "../rooms/draftStore.js";
import { getPlayers } from "../services/playerCache.js";
import { filterPlayersByEra } from "../services/era.js";
import { fetchPlayerStats } from "../services/statsClient.js";
import { computeDraftResults } from "../scoring/computeResults.js";

const MAX_STATS_DRAW_ATTEMPTS = 6;
const MIN_ROLL_MS = 1400;

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
    players: room.players.map((p) => ({ id: p.id, name: p.name, budget: p.budget, isHost: p.isHost })),
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

export function registerRoomHandlers(io, socket) {
  socket.on("room:create", ({ name }, callback) => {
    const playerName = (name || "").trim();
    if (!playerName) {
      return callback?.({ error: "NAME_REQUIRED" });
    }

    const room = createRoom();
    const result = addPlayerToRoom(room.code, { id: socket.id, name: playerName });

    if (result.error) {
      return callback?.({ error: result.error });
    }

    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.playerName = playerName;

    callback?.({ room: toPublicRoom(result.room) });
    io.to(room.code).emit("room:update", toPublicRoom(result.room));
  });

  socket.on("room:join", ({ code, name }, callback) => {
    const playerName = (name || "").trim();
    const roomCode = (code || "").trim().toUpperCase();

    if (!playerName || !roomCode) {
      return callback?.({ error: "NAME_AND_CODE_REQUIRED" });
    }

    const result = addPlayerToRoom(roomCode, { id: socket.id, name: playerName });

    if (result.error) {
      return callback?.({ error: result.error });
    }

    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.data.playerName = playerName;

    callback?.({ room: toPublicRoom(result.room) });
    io.to(roomCode).emit("room:update", toPublicRoom(result.room));
  });

  socket.on("room:start", ({ era, allowPositionSwaps } = {}, callback) => {
    const roomCode = socket.data.roomCode;
    if (!roomCode) {
      return callback?.({ error: "NOT_IN_ROOM" });
    }

    const result = startDraft(roomCode, socket.id, era, allowPositionSwaps);
    if (result.error) {
      return callback?.({ error: result.error });
    }

    callback?.({ room: toPublicRoom(result.room) });
    io.to(roomCode).emit("room:update", toPublicRoom(result.room));
  });

  socket.on("draft:nominate", async (payload, callback) => {
    const roomCode = socket.data.roomCode;
    if (!roomCode) return callback?.({ error: "NOT_IN_ROOM" });

    const room = getRoom(roomCode);
    if (!room) return callback?.({ error: "ROOM_NOT_FOUND" });

    // Validate up front, before broadcasting anything — a request that was
    // never going to produce a nomination shouldn't kick off a fake "rolling"
    // animation for everyone else in the room.
    if (room.status !== "drafting") return callback?.({ error: "NOT_DRAFTING" });
    if (room.draft?.nomination) return callback?.({ error: "NOMINATION_IN_PROGRESS" });
    if (room.draft?.currentNominatorId !== socket.id) return callback?.({ error: "NOT_YOUR_TURN" });

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

    const result = nominatePlayer(room, socket.id, { ...chosenPlayer, stats, nbaPlayerId });
    if (result.error) {
      io.to(roomCode).emit("draft:rolling-cancelled");
      return callback?.({ error: result.error });
    }

    callback?.({ room: toPublicRoom(result.room) });
    io.to(roomCode).emit("room:update", toPublicRoom(result.room));
  });

  socket.on("draft:bid", ({ amount }, callback) => {
    const roomCode = socket.data.roomCode;
    if (!roomCode) return callback?.({ error: "NOT_IN_ROOM" });

    const room = getRoom(roomCode);
    if (!room) return callback?.({ error: "ROOM_NOT_FOUND" });

    const result = placeBid(room, socket.id, amount);
    if (result.error) return callback?.({ error: result.error });

    callback?.({ room: toPublicRoom(result.room) });
    io.to(roomCode).emit("room:update", toPublicRoom(result.room));
  });

  socket.on("draft:pass", (payload, callback) => {
    const roomCode = socket.data.roomCode;
    if (!roomCode) return callback?.({ error: "NOT_IN_ROOM" });

    const room = getRoom(roomCode);
    if (!room) return callback?.({ error: "ROOM_NOT_FOUND" });

    const result = passOnNomination(room, socket.id);
    if (result.error) return callback?.({ error: result.error });

    callback?.({ room: toPublicRoom(result.room) });
    io.to(roomCode).emit("room:update", toPublicRoom(result.room));
  });

  socket.on("draft:assign", ({ position }, callback) => {
    const roomCode = socket.data.roomCode;
    if (!roomCode) return callback?.({ error: "NOT_IN_ROOM" });

    const room = getRoom(roomCode);
    if (!room) return callback?.({ error: "ROOM_NOT_FOUND" });

    const result = assignPosition(room, socket.id, position);
    if (result.error) return callback?.({ error: result.error });

    if (result.room.status === "complete" && !result.room.results) {
      result.room.resultsStatus = "computing";
    }

    callback?.({ room: toPublicRoom(result.room) });
    io.to(roomCode).emit("room:update", toPublicRoom(result.room));

    if (result.room.status === "complete" && result.room.resultsStatus === "computing") {
      computeDraftResults(result.room)
        .then((results) => {
          result.room.results = results;
          result.room.resultsStatus = "ready";
          io.to(roomCode).emit("room:update", toPublicRoom(result.room));
        })
        .catch((err) => {
          console.error(`[computeDraftResults] failed for room ${roomCode}:`, err);
          result.room.resultsStatus = "failed";
          io.to(roomCode).emit("room:update", toPublicRoom(result.room));
        });
    }
  });

  socket.on("draft:swap-positions", ({ slotA, slotB } = {}, callback) => {
    const roomCode = socket.data.roomCode;
    if (!roomCode) return callback?.({ error: "NOT_IN_ROOM" });

    const room = getRoom(roomCode);
    if (!room) return callback?.({ error: "ROOM_NOT_FOUND" });

    const result = swapRosterPositions(room, socket.id, slotA, slotB);
    if (result.error) return callback?.({ error: result.error });

    callback?.({ room: toPublicRoom(result.room) });
    io.to(roomCode).emit("room:update", toPublicRoom(result.room));
  });

  socket.on("room:leave", () => {
    handleDisconnect(io, socket);
  });

  socket.on("disconnect", () => {
    handleDisconnect(io, socket);
  });
}

function handleDisconnect(io, socket) {
  const roomCode = socket.data.roomCode;
  if (!roomCode) return;

  const result = removePlayerFromSocket(socket.id);
  socket.data.roomCode = undefined;

  if (result?.room) {
    io.to(result.roomCode).emit("room:update", toPublicRoom(result.room));
  }
}
