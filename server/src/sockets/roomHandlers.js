import {
  createRoom,
  addPlayerToRoom,
  addLocalPlayersToRoom,
  startDraft,
  getRoom,
  finalizePlayerExit,
  beginDisconnectGrace,
  reconnectPlayer,
  returnToLobby,
  setRematchVote,
  recheckRematchAfterExit,
  RECONNECT_GRACE_MS,
  DIFFICULTY_STATIC_ODDS,
} from "../rooms/roomStore.js";
import { nominatePlayer, placeBid, passOnNomination, assignPosition, swapRosterPositions } from "../rooms/draftStore.js";
import { getPlayers } from "../services/playerCache.js";
import { getNotablePlayerIds } from "../services/notablePlayers.js";
import { filterPlayersByEra } from "../services/era.js";
import { fetchPlayerStats } from "../services/statsClient.js";
import { saveDraftResults } from "../services/db.js";
import { computeDraftResults } from "../scoring/computeResults.js";
import { createKeyedRateLimiter, createSocketEventLimiter } from "../middleware/rateLimit.js";

// Worst case per candidate is roughly MAX_STATS_DRAW_ATTEMPTS × the
// per-attempt timeout (see fetchPlayerStats's AbortSignal in
// statsClient.js) — kept low and tight so a roll takes roughly the same
// amount of time whether the draw succeeds on the first try or has to
// retry, instead of the duration swinging from ~1s up to a minute-plus.
const MAX_STATS_DRAW_ATTEMPTS = 2;
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

// Normally a socket controls exactly one player, so socket.data.playerId is
// authoritative. In local pass-and-play (room:create-local), one socket
// controls every player in the room instead, and the client tells us who's
// "at the controls" for a given action via payload.playerId — trusted only
// when it's one of the identities this socket actually owns.
function resolveActingPlayerId(socket, payload) {
  const requested = payload?.playerId;
  if (requested && socket.data.localPlayerIds?.includes(requested)) return requested;
  return socket.data.playerId;
}

function toNominatedPlayer(candidate, result) {
  if (!result) return { player: candidate, stats: { unavailable: true }, nbaPlayerId: null };

  // Pool entries (nbaPlayersClient.js) only carry id/name/active-status/
  // career span — position, team, and draft year live in the stats response
  // instead (see stats-service's fetch_stats_for_player).
  //
  // Which team "represents" them: an active player's last team already is
  // their current one, so use that; a retired player's last team was often
  // just wherever they happened to finish (a late-career bench stint), so
  // use whichever team they actually played the most games for instead —
  // that's what team color/branding should follow.
  const primaryTeam = candidate.isActive ? result.stats.team : result.stats.mostPlayedTeam || result.stats.team;

  return {
    player: {
      ...candidate,
      position: result.stats.position ?? null,
      team: primaryTeam ? { abbreviation: primaryTeam } : null,
      teamHistory: result.stats.teamHistory || [],
      draftYear: result.stats.draftYear ?? null,
    },
    stats: result.stats,
    nbaPlayerId: result.nbaPlayerId,
  };
}

// One candidate at a time, with a few retries against the same shared pool
// if a candidate's stats fail to fetch (a stats-service hiccup shouldn't
// sink an otherwise-fine roll). Deliberately NOT sampling several
// candidates in parallel per roll anymore — that made rolls slow and much
// more likely to trip stats.nba.com's rate limiting for only a modest
// quality bump. Difficulty instead comes entirely from which pool this
// draws from (see draft:nominate below): a big, real, all-time-leaders pool
// vs. the full pool.
async function drawPlayerWithStats(candidates) {
  const pool = [...candidates];
  let lastCandidate = null;

  for (let attempt = 0; attempt < MAX_STATS_DRAW_ATTEMPTS && pool.length > 0; attempt += 1) {
    const index = Math.floor(Math.random() * pool.length);
    const [candidate] = pool.splice(index, 1);
    lastCandidate = candidate;
    const result = await fetchPlayerStats(candidate.id);
    if (result) return toNominatedPlayer(candidate, result);
  }

  return toNominatedPlayer(lastCandidate, null);
}

function toPublicRoom(room) {
  const base = {
    code: room.code,
    status: room.status,
    draftEra: room.draftEra || null,
    difficulty: room.difficulty || null,
    isLocal: room.isLocal || false,
    allowPositionSwaps: room.allowPositionSwaps || false,
    resultsStatus: room.resultsStatus || null,
    results: room.results || null,
    rematchVotes: room.rematchVotes ? Array.from(room.rematchVotes) : [],
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
      saveDraftResults(room, results); // fire-and-forget — analytics persistence, never blocks the live room
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

  // Pass-and-play: one device, multiple named local players sharing this
  // one socket. Everything downstream (draft:*, room:leave, disconnect)
  // treats socket.data.localPlayerIds as the set of identities this socket
  // is allowed to act as — see resolveActingPlayerId above.
  socket.on("room:create-local", ({ names } = {}, callback) => {
    if (!allowEvent()) return callback?.({ error: "RATE_LIMITED" });
    if (!Array.isArray(names) || names.length < 2 || names.length > 4) {
      return callback?.({ error: "INVALID_LOCAL_PLAYERS" });
    }
    for (const n of names) {
      if (typeof n !== "string" || !n.trim()) return callback?.({ error: "NAME_REQUIRED" });
      if (n.trim().length > MAX_NAME_LENGTH) return callback?.({ error: "NAME_TOO_LONG" });
    }
    const clientIp = socket.handshake.address;
    if (clientIp && !roomCreateLimiter(clientIp)) {
      return callback?.({ error: "RATE_LIMITED" });
    }

    const result = addLocalPlayersToRoom(names, socket.id);
    if (result.error) {
      return callback?.({ error: result.error });
    }

    socket.join(result.room.code);
    socket.data.roomCode = result.room.code;
    socket.data.localPlayerIds = result.players.map((p) => p.id);
    socket.data.playerId = result.players[0].id;

    callback?.({ room: toPublicRoom(result.room), playerIds: socket.data.localPlayerIds });
    io.to(result.room.code).emit("room:update", toPublicRoom(result.room));
  });

  socket.on("room:rejoin-local", ({ code, playerIds } = {}, callback) => {
    if (!allowEvent()) return callback?.({ error: "RATE_LIMITED" });
    const roomCode = (code || "").trim().toUpperCase();
    if (!roomCode || !Array.isArray(playerIds) || playerIds.length === 0) {
      return callback?.({ error: "RECONNECT_FAILED" });
    }

    let room = null;
    const previousSocketIds = new Set();
    for (const pid of playerIds) {
      const result = reconnectPlayer(roomCode, pid, socket.id);
      if (result.error) return callback?.({ error: "RECONNECT_FAILED" });
      room = result.room;
      if (result.previousSocketId) previousSocketIds.add(result.previousSocketId);
    }

    for (const sid of previousSocketIds) {
      io.sockets.sockets.get(sid)?.disconnect(true);
    }

    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.data.localPlayerIds = playerIds;
    socket.data.playerId = playerIds[0];

    callback?.({ room: toPublicRoom(room), playerIds });
    io.to(roomCode).emit("room:update", toPublicRoom(room));
  });

  socket.on("room:start", (payload = {}, callback) => {
    if (!allowEvent()) return callback?.({ error: "RATE_LIMITED" });
    const { era, allowPositionSwaps, difficulty } = payload;
    const roomCode = socket.data.roomCode;
    if (!roomCode) {
      return callback?.({ error: "NOT_IN_ROOM" });
    }

    const playerId = resolveActingPlayerId(socket, payload);
    const result = startDraft(roomCode, playerId, era, allowPositionSwaps, difficulty);
    if (result.error) {
      return callback?.({ error: result.error });
    }

    callback?.({ room: toPublicRoom(result.room) });
    io.to(roomCode).emit("room:update", toPublicRoom(result.room));
  });

  socket.on("draft:nominate", async (payload = {}, callback) => {
    if (!allowEvent()) return callback?.({ error: "RATE_LIMITED" });
    const roomCode = socket.data.roomCode;
    const playerId = resolveActingPlayerId(socket, payload);
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

    // The whole difficulty system now: narrow the candidates down to the
    // data-driven "notable" pool (all-time leaders — see notablePlayers.js)
    // with odds set by difficulty, then do a single random draw from
    // whichever pool that leaves. Only one stats-service call per roll
    // (with retries on failure, not extra parallel candidates) — that's
    // what keeps rolls fast and resilient to stats.nba.com's rate limiting.
    // Falls back to the full pool whenever the notable list came back empty
    // (fetch failure) or this era has none in it.
    const notableIds = await getNotablePlayerIds();
    const notableSet = new Set(notableIds);
    const notablePool = notableSet.size > 0 ? available.filter((p) => notableSet.has(p.id)) : [];
    const staticOdds = DIFFICULTY_STATIC_ODDS[room.difficulty] ?? DIFFICULTY_STATIC_ODDS.normal;
    const drawPool = notablePool.length > 0 && Math.random() < staticOdds ? notablePool : available;

    // The actual draw (with its stats-lookup retries) runs alongside a fixed
    // minimum delay, so the shared rolling animation always plays for at
    // least MIN_ROLL_MS even when the draw resolves instantly from cache.
    const [{ player: chosenPlayer, stats, nbaPlayerId }] = await Promise.all([
      drawPlayerWithStats(drawPool),
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

  socket.on("draft:bid", (payload = {}, callback) => {
    if (!allowEvent()) return callback?.({ error: "RATE_LIMITED" });
    const { amount } = payload;
    const roomCode = socket.data.roomCode;
    const playerId = resolveActingPlayerId(socket, payload);
    if (!roomCode || !playerId) return callback?.({ error: "NOT_IN_ROOM" });

    const room = getRoom(roomCode);
    if (!room) return callback?.({ error: "ROOM_NOT_FOUND" });

    const result = placeBid(room, playerId, amount);
    if (result.error) return callback?.({ error: result.error });

    callback?.({ room: toPublicRoom(result.room) });
    io.to(roomCode).emit("room:update", toPublicRoom(result.room));
  });

  socket.on("draft:pass", (payload = {}, callback) => {
    if (!allowEvent()) return callback?.({ error: "RATE_LIMITED" });
    const roomCode = socket.data.roomCode;
    const playerId = resolveActingPlayerId(socket, payload);
    if (!roomCode || !playerId) return callback?.({ error: "NOT_IN_ROOM" });

    const room = getRoom(roomCode);
    if (!room) return callback?.({ error: "ROOM_NOT_FOUND" });

    const result = passOnNomination(room, playerId);
    if (result.error) return callback?.({ error: result.error });

    callback?.({ room: toPublicRoom(result.room) });
    io.to(roomCode).emit("room:update", toPublicRoom(result.room));
  });

  socket.on("draft:assign", (payload = {}, callback) => {
    if (!allowEvent()) return callback?.({ error: "RATE_LIMITED" });
    const { position } = payload;
    const roomCode = socket.data.roomCode;
    const playerId = resolveActingPlayerId(socket, payload);
    if (!roomCode || !playerId) return callback?.({ error: "NOT_IN_ROOM" });

    const room = getRoom(roomCode);
    if (!room) return callback?.({ error: "ROOM_NOT_FOUND" });

    const result = assignPosition(room, playerId, position);
    if (result.error) return callback?.({ error: result.error });

    callback?.({ room: toPublicRoom(result.room) });
    io.to(roomCode).emit("room:update", toPublicRoom(result.room));
    maybeComputeResults(io, result.room, roomCode);
  });

  socket.on("draft:swap-positions", (payload = {}, callback) => {
    if (!allowEvent()) return callback?.({ error: "RATE_LIMITED" });
    const { slotA, slotB } = payload;
    const roomCode = socket.data.roomCode;
    const playerId = resolveActingPlayerId(socket, payload);
    if (!roomCode || !playerId) return callback?.({ error: "NOT_IN_ROOM" });

    const room = getRoom(roomCode);
    if (!room) return callback?.({ error: "ROOM_NOT_FOUND" });

    const result = swapRosterPositions(room, playerId, slotA, slotB);
    if (result.error) return callback?.({ error: result.error });

    callback?.({ room: toPublicRoom(result.room) });
    io.to(roomCode).emit("room:update", toPublicRoom(result.room));
  });

  socket.on("room:return-to-lobby", (payload = {}, callback) => {
    if (!allowEvent()) return callback?.({ error: "RATE_LIMITED" });
    const roomCode = socket.data.roomCode;
    if (!roomCode) return callback?.({ error: "NOT_IN_ROOM" });

    const playerId = resolveActingPlayerId(socket, payload);
    const result = returnToLobby(roomCode, playerId);
    if (result.error) return callback?.({ error: result.error });

    callback?.({ room: toPublicRoom(result.room) });
    io.to(roomCode).emit("room:update", toPublicRoom(result.room));
  });

  // Rematch needs every currently connected, non-forfeited player to confirm
  // before it fires — see setRematchVote/recheckRematch in roomStore.js. A
  // player can also un-confirm (confirmed: false) before the vote resolves.
  socket.on("room:vote-rematch", (payload = {}, callback) => {
    if (!allowEvent()) return callback?.({ error: "RATE_LIMITED" });
    const roomCode = socket.data.roomCode;
    if (!roomCode) return callback?.({ error: "NOT_IN_ROOM" });

    const playerId = resolveActingPlayerId(socket, payload);
    const confirmed = payload?.confirmed !== false;
    const result = setRematchVote(roomCode, playerId, confirmed);
    if (result.error) return callback?.({ error: result.error });

    callback?.({ room: toPublicRoom(result.room) });
    io.to(roomCode).emit("room:update", toPublicRoom(result.room));
  });

  socket.on("room:leave", () => {
    const roomCode = socket.data.roomCode;
    const playerIds = socket.data.localPlayerIds || (socket.data.playerId ? [socket.data.playerId] : []);
    socket.data.roomCode = undefined;
    socket.data.playerId = undefined;
    socket.data.localPlayerIds = undefined;
    if (!roomCode || playerIds.length === 0) return;

    let room = getRoom(roomCode);
    if (!room) return;

    for (const pid of playerIds) {
      const result = finalizePlayerExit(room, pid);
      room = result.room;
      if (!room) break;
    }

    if (room) {
      // A departure can turn an already-pending rematch vote unanimous on
      // its own (everyone remaining had confirmed, the room was just
      // waiting on the person who left) — recheck before broadcasting.
      recheckRematchAfterExit(room);
      io.to(roomCode).emit("room:update", toPublicRoom(room));
      maybeComputeResults(io, room, roomCode);
    }
  });

  socket.on("disconnect", () => {
    const roomCode = socket.data.roomCode;
    const playerIds = socket.data.localPlayerIds || (socket.data.playerId ? [socket.data.playerId] : []);
    if (!roomCode || playerIds.length === 0) return;

    const room = getRoom(roomCode);
    if (!room) return;

    for (const pid of playerIds) {
      beginDisconnectGrace(room, pid, socket.id, () => {
        const result = finalizePlayerExit(room, pid);
        if (result.room) {
          recheckRematchAfterExit(result.room);
          io.to(roomCode).emit("room:update", toPublicRoom(result.room));
          maybeComputeResults(io, result.room, roomCode);
        }
      });
    }

    // A disconnect (even before its grace period expires) already drops the
    // player out of the rematch's required-confirmations set, same as
    // finalizePlayerExit does — recheck here too, not just on expiry.
    recheckRematchAfterExit(room);
    io.to(roomCode).emit("room:update", toPublicRoom(room));
  });
}
