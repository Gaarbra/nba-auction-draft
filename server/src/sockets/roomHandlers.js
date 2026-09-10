import { randomUUID } from "node:crypto";
import {
  createRoom,
  addPlayerToRoom,
  addLocalPlayersToRoom,
  startDraft,
  getRoom,
  listPublicRooms,
  finalizePlayerExit,
  beginDisconnectGrace,
  reconnectPlayer,
  returnToLobby,
  setRematchVote,
  recheckRematchAfterExit,
  startVoteKick,
  castVoteKick,
  cancelVoteKickByHost,
  recheckVoteKickAfterExit,
  clearVoteKickIfComplete,
  RECONNECT_GRACE_MS,
  computeNotablePoolOdds,
  computeStarPoolOdds,
  computeSuperstarPoolOdds,
} from "../rooms/roomStore.js";
import {
  nominatePlayer,
  rerollNomination,
  placeBid,
  passOnNomination,
  assignPosition,
  swapRosterPositions,
} from "../rooms/draftStore.js";
import { getPlayers } from "../services/playerCache.js";
import { getNotablePlayerIds } from "../services/notablePlayers.js";
import { getTopTeamPlayerIds } from "../services/topTeamPlayers.js";
import { getStarPlayerIds } from "../services/starPlayers.js";
import { getSuperstarPlayerIds } from "../services/superstarPlayers.js";
import { filterPlayersByEra } from "../services/era.js";
import { fetchPlayerStats } from "../services/statsClient.js";
import { saveDraftResults } from "../services/db.js";
import { computeDraftResults } from "../scoring/computeResults.js";
import { createKeyedRateLimiter, createSocketEventLimiter } from "../middleware/rateLimit.js";
import { containsProfanity } from "../utils/nameFilter.js";

// Worst case per candidate is roughly MAX_STATS_DRAW_ATTEMPTS times the
// per-attempt timeout (see fetchPlayerStats's AbortSignal in
// statsClient.js). Kept low and tight so a roll takes roughly the same
// amount of time whether the draw succeeds on the first try or has to
// retry, instead of the duration swinging from ~1s up to a minute-plus.
const MAX_STATS_DRAW_ATTEMPTS = 2;
const MIN_ROLL_MS = 1400;
const MAX_NAME_LENGTH = 30;

// Shared across every connection (module scope). Caps how many rooms a
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
// "at the controls" for a given action via payload.playerId, trusted only
// when it's one of the identities this socket actually owns.
function resolveActingPlayerId(socket, payload) {
  const requested = payload?.playerId;
  if (requested && socket.data.localPlayerIds?.includes(requested)) return requested;
  return socket.data.playerId;
}

function toNominatedPlayer(candidate, result) {
  if (!result) return { player: candidate, stats: { unavailable: true }, nbaPlayerId: null };

  // Pool entries carry only id/name/active-status/career span; position,
  // team, and draft year come from the stats response instead. Which team
  // "represents" them: an active player's last team is their current one,
  // but a retired player's last team is often just a late-career bench
  // stint, so use whichever team they played the most games for instead.
  // That's what team color/branding should follow.
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
// candidates in parallel per roll anymore. That made rolls slow and much
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

// The whole difficulty system, shared by draft:nominate and draft:reroll.
// Four nested pools, tried narrowest-first:
//   1. "superstar" (MVPs + perennial-elite: 3+ All-NBA or 5+ All-Star, see
//      superstarPlayers.js) -- ONLY the "superstars only" difficulty draws
//      from this; every other one leaves its odds at 0.
//   2. "star" (award-driven: MVP/All-NBA/a real All-Star selection, see
//      starPlayers.js) -- genuinely selective honors, not just "was on a
//      winning roster." This is what makes "easy" actually feel like
//      stars, not just recognizable journeymen (see computeStarPoolOdds'
//      own comment in roomStore.js for the Zaza Pachulia case that showed
//      why the notable pool alone wasn't enough).
//   3. "notable" (stat-driven: all-time per-game leaders, see
//      notablePlayers.js, UNIONed with this season's #1 team's current
//      roster, see topTeamPlayers.js -- that second pool catches a
//      recognizable breakout player this season who hasn't built enough of
//      a career track record to crack an all-time list yet)
//   4. the full era pool
// Odds for each tier set by difficulty; falls through to the next tier
// whenever a pool is empty or its coin flip misses. Only one stats-service
// call per roll, not several in parallel -- keeps rolls fast and resilient
// to stats.nba.com's rate limiting.
// `excludeIds` is extra IDs to treat as unavailable beyond what's already
// drafted -- a reroll needs this to rule out drawing the exact same player
// it's trying to get away from.
async function rollPlayerForRoom(room, excludeIds = []) {
  const allPlayers = await getPlayers();
  const eraPool = filterPlayersByEra(allPlayers, room.draftEra);
  const unavailable = new Set([...(room.draft?.draftedPlayerIds || []), ...excludeIds]);
  const available = eraPool.filter((p) => !unavailable.has(p.id));

  if (available.length === 0) return { error: "NO_PLAYERS_LEFT" };

  const [notableIds, topTeamIds, starIds, superstarIds] = await Promise.all([
    getNotablePlayerIds(),
    getTopTeamPlayerIds(),
    getStarPlayerIds(),
    getSuperstarPlayerIds(),
  ]);
  const notableSet = new Set([...notableIds, ...topTeamIds]);
  const notablePool = notableSet.size > 0 ? available.filter((p) => notableSet.has(p.id)) : [];
  const starSet = new Set(starIds);
  const starPool = starSet.size > 0 ? available.filter((p) => starSet.has(p.id)) : [];
  const superstarSet = new Set(superstarIds);
  const superstarPool = superstarSet.size > 0 ? available.filter((p) => superstarSet.has(p.id)) : [];

  // Threshold math lives in computeSuperstarPoolOdds/computeStarPoolOdds/
  // computeNotablePoolOdds (roomStore.js). Every coin flip and
  // drawPlayerWithStats's draw are uniform over whichever pool this lands
  // in: every player in it has an equal chance, every era, every roll.
  const superstarOdds = computeSuperstarPoolOdds(room.difficulty, superstarPool.length);
  const starOdds = computeStarPoolOdds(room.difficulty, starPool.length);
  const notableOdds = computeNotablePoolOdds(room.difficulty, notablePool.length);
  let drawPool;
  if (superstarPool.length > 0 && Math.random() < superstarOdds) {
    drawPool = superstarPool;
  } else if (starPool.length > 0 && Math.random() < starOdds) {
    drawPool = starPool;
  } else if (notablePool.length > 0 && Math.random() < notableOdds) {
    drawPool = notablePool;
  } else {
    drawPool = available;
  }

  // The actual draw (with its stats-lookup retries) runs alongside a fixed
  // minimum delay, so the shared rolling animation always plays for at
  // least MIN_ROLL_MS even when the draw resolves instantly from cache.
  const [{ player, stats, nbaPlayerId }] = await Promise.all([drawPlayerWithStats(drawPool), sleep(MIN_ROLL_MS)]);

  return { player: { ...player, stats, nbaPlayerId } };
}

function toPublicRoom(room) {
  const base = {
    code: room.code,
    status: room.status,
    draftEra: room.draftEra || null,
    difficulty: room.difficulty || null,
    biddingMode: room.biddingMode || null,
    visibility: room.visibility || "private",
    isLocal: room.isLocal || false,
    allowPositionSwaps: room.allowPositionSwaps || false,
    resultsStatus: room.resultsStatus || null,
    results: room.results || null,
    rematchVotes: room.rematchVotes ? Array.from(room.rematchVotes) : [],
    // Eligibility/threshold are derived client-side from players + targetId
    // (connected, non-forfeited, not the target); only the raw ballots need
    // to cross the wire.
    voteKick: room.voteKick
      ? {
          targetId: room.voteKick.targetId,
          initiatedBy: room.voteKick.initiatedBy,
          approveIds: [...room.voteKick.votes.entries()].filter(([, v]) => v).map(([id]) => id),
          rejectIds: [...room.voteKick.votes.entries()].filter(([, v]) => !v).map(([id]) => id),
        }
      : null,
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
      soloRerollUsed: room.draft.soloRerollUsed,
    },
  };
}

/** Kicks off the (slow, one-time) end-of-draft scoring pass if the draft just completed and hasn't been scored yet. */
function maybeComputeResults(io, room, roomCode) {
  clearVoteKickIfComplete(room);
  if (room.status !== "complete" || room.results || room.resultsStatus === "computing") return;

  room.resultsStatus = "computing";
  io.to(roomCode).emit("room:update", toPublicRoom(room));

  computeDraftResults(room)
    .then((results) => {
      room.results = results;
      room.resultsStatus = "ready";
      io.to(roomCode).emit("room:update", toPublicRoom(room));
      saveDraftResults(room, results); // fire-and-forget: analytics persistence, never blocks the live room
    })
    .catch((err) => {
      console.error(`[computeDraftResults] failed for room ${roomCode}:`, err);
      room.resultsStatus = "failed";
      io.to(roomCode).emit("room:update", toPublicRoom(room));
    });
}

export function registerRoomHandlers(io, socket) {
  // Cheap per-connection throttle against a spammy/scripted client hammering
  // any of these events. Each socket gets its own independent counter.
  const allowEvent = createSocketEventLimiter(10_000, 40);

  socket.on("room:create", ({ name, visibility } = {}, callback) => {
    if (!allowEvent()) return callback?.({ error: "RATE_LIMITED" });
    if (typeof name !== "string" || !name.trim()) {
      return callback?.({ error: "NAME_REQUIRED" });
    }
    if (name.trim().length > MAX_NAME_LENGTH) {
      return callback?.({ error: "NAME_TOO_LONG" });
    }
    if (containsProfanity(name)) {
      return callback?.({ error: "NAME_INAPPROPRIATE" });
    }
    const clientIp = socket.handshake.address;
    if (clientIp && !roomCreateLimiter(clientIp)) {
      return callback?.({ error: "RATE_LIMITED" });
    }

    const room = createRoom(visibility === "public" ? "public" : "private");
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

  // Callable before joining any room. The lobby's "Public" tab uses this to
  // browse open rooms it can join without needing a code. A snapshot on
  // request, not a live subscription: simpler, and good enough for a list
  // that's just there to help someone find a room to join.
  socket.on("rooms:list-public", (payload, callback) => {
    if (!allowEvent()) return callback?.({ error: "RATE_LIMITED" });
    callback?.({ rooms: listPublicRooms() });
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
    if (containsProfanity(name)) {
      return callback?.({ error: "NAME_INAPPROPRIATE" });
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
      // one was still marked live, most likely a duplicate tab. Boot the
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
  // is allowed to act as. See resolveActingPlayerId above.
  socket.on("room:create-local", ({ names } = {}, callback) => {
    if (!allowEvent()) return callback?.({ error: "RATE_LIMITED" });
    if (!Array.isArray(names) || names.length < 2 || names.length > 4) {
      return callback?.({ error: "INVALID_LOCAL_PLAYERS" });
    }
    for (const n of names) {
      if (typeof n !== "string" || !n.trim()) return callback?.({ error: "NAME_REQUIRED" });
      if (n.trim().length > MAX_NAME_LENGTH) return callback?.({ error: "NAME_TOO_LONG" });
      if (containsProfanity(n)) return callback?.({ error: "NAME_INAPPROPRIATE" });
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
    const { era, allowPositionSwaps, difficulty, biddingMode } = payload;
    const roomCode = socket.data.roomCode;
    if (!roomCode) {
      return callback?.({ error: "NOT_IN_ROOM" });
    }

    const playerId = resolveActingPlayerId(socket, payload);
    const result = startDraft(roomCode, playerId, era, allowPositionSwaps, difficulty, biddingMode);
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

    // Validate up front, before broadcasting anything. A request that was
    // never going to produce a nomination shouldn't kick off a fake "rolling"
    // animation for everyone else in the room.
    if (room.status !== "drafting") return callback?.({ error: "NOT_DRAFTING" });
    if (room.draft?.nomination) return callback?.({ error: "NOMINATION_IN_PROGRESS" });
    if (room.draft?.currentNominatorId !== playerId) return callback?.({ error: "NOT_YOUR_TURN" });

    // Broadcast to the whole room, including the requester, before doing
    // any of the slow work, so every client's rolling animation starts at
    // the same moment instead of only the nominator seeing it locally.
    io.to(roomCode).emit("draft:rolling");

    const roll = await rollPlayerForRoom(room);
    if (roll.error) {
      io.to(roomCode).emit("draft:rolling-cancelled");
      return callback?.({ error: roll.error });
    }

    const result = nominatePlayer(room, playerId, roll.player);
    if (result.error) {
      io.to(roomCode).emit("draft:rolling-cancelled");
      return callback?.({ error: result.error });
    }

    callback?.({ room: toPublicRoom(result.room) });
    io.to(roomCode).emit("room:update", toPublicRoom(result.room));
  });

  // Solo-only: one reroll for the whole draft (see rerollNomination's own
  // comment in draftStore.js for why solo gets this instead of real
  // bidding). Mirrors draft:nominate's roll-then-broadcast shape, just
  // replacing an existing "assigning"-phase nomination instead of starting
  // a fresh one.
  socket.on("draft:reroll", async (payload = {}, callback) => {
    if (!allowEvent()) return callback?.({ error: "RATE_LIMITED" });
    const roomCode = socket.data.roomCode;
    const playerId = resolveActingPlayerId(socket, payload);
    if (!roomCode || !playerId) return callback?.({ error: "NOT_IN_ROOM" });

    const room = getRoom(roomCode);
    if (!room) return callback?.({ error: "ROOM_NOT_FOUND" });

    if (room.status !== "drafting") return callback?.({ error: "NOT_DRAFTING" });
    if (!room.draft?.nomination || room.draft.nomination.phase !== "assigning") {
      return callback?.({ error: "NO_ACTIVE_NOMINATION" });
    }
    if (room.draft.nomination.currentBidder !== playerId) return callback?.({ error: "NOT_YOUR_ASSIGNMENT" });
    if (room.draft.turnOrder.length !== 1) return callback?.({ error: "REROLL_SOLO_ONLY" });
    if (room.draft.soloRerollUsed) return callback?.({ error: "REROLL_ALREADY_USED" });

    io.to(roomCode).emit("draft:rolling");

    const roll = await rollPlayerForRoom(room, [room.draft.nomination.player.id]);
    if (roll.error) {
      io.to(roomCode).emit("draft:rolling-cancelled");
      return callback?.({ error: roll.error });
    }

    const result = rerollNomination(room, playerId, roll.player);
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
    // Global, not room-scoped. The Market tab (browsing outside any room)
    // is the listener, showing real completed sale prices for whichever
    // player it's looking at as they happen across every active draft.
    // Deliberately carries no player-facing identity (no player name/id
    // from this room, just the NBA player and price) beyond the room code,
    // which is already public/joinable by anyone with it.
    if (result.sale) {
      io.emit("market:sale", { ...result.sale, roomCode, at: Date.now() });
    }
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
  // before it fires. See setRematchVote/recheckRematch in roomStore.js. A
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

  // Executes the actual removal side-effects of a resolved votekick: tells
  // the kicked player's own socket specifically (they're not the one who
  // took the action, so they'd otherwise just see a room:update where
  // they've silently vanished from the player list) and evicts that socket
  // from the room's broadcast group so it stops receiving further updates
  // for a room it's no longer part of.
  function handleVoteKickResolution(room, roomCode, targetId, targetSocketId) {
    // targetSocketId is captured by the caller (roomStore.js) before
    // finalizePlayerExit runs. Looking it up here instead, after the fact,
    // would find nothing in the lobby case, since finalizePlayerExit already
    // removed the target from room.players by the time this runs.
    const targetSocket = io.sockets.sockets.get(targetSocketId);
    if (targetSocket) {
      targetSocket.emit("room:kicked");
      targetSocket.leave(roomCode);
      if (targetSocket.data.playerId === targetId) {
        targetSocket.data.roomCode = undefined;
        targetSocket.data.playerId = undefined;
      }
      if (targetSocket.data.localPlayerIds) {
        targetSocket.data.localPlayerIds = targetSocket.data.localPlayerIds.filter((id) => id !== targetId);
      }
    }
    if (room) {
      recheckRematchAfterExit(room);
      io.to(roomCode).emit("room:update", toPublicRoom(room));
      maybeComputeResults(io, room, roomCode);
    } else {
      io.to(roomCode).emit("room:update", null);
    }
  }

  // Host-only: opens a vote to remove another connected player, from either
  // the lobby or mid-draft. Resolves instantly if the host is the only other
  // eligible voter (nothing to wait on). Otherwise it's genuinely a vote,
  // not a unilateral host kick, so the room's difficulty/era settings can't
  // be steamrolled by one person just because they happened to create it.
  socket.on("room:vote-kick-start", ({ targetId } = {}, callback) => {
    if (!allowEvent()) return callback?.({ error: "RATE_LIMITED" });
    const roomCode = socket.data.roomCode;
    const playerId = resolveActingPlayerId(socket, {});
    if (!roomCode || !playerId) return callback?.({ error: "NOT_IN_ROOM" });

    const result = startVoteKick(roomCode, playerId, targetId, () => {
      const room = getRoom(roomCode);
      if (room) io.to(roomCode).emit("room:update", toPublicRoom(room));
    });
    if (result.error) return callback?.({ error: result.error });

    callback?.({ room: result.room ? toPublicRoom(result.room) : null });
    if (result.kicked) {
      handleVoteKickResolution(result.room, roomCode, targetId, result.targetSocketId);
    } else {
      io.to(roomCode).emit("room:update", toPublicRoom(result.room));
    }
  });

  socket.on("room:vote-kick-cast", ({ confirmed } = {}, callback) => {
    if (!allowEvent()) return callback?.({ error: "RATE_LIMITED" });
    const roomCode = socket.data.roomCode;
    const playerId = resolveActingPlayerId(socket, {});
    if (!roomCode || !playerId) return callback?.({ error: "NOT_IN_ROOM" });

    const room = getRoom(roomCode);
    const targetId = room?.voteKick?.targetId;
    const result = castVoteKick(roomCode, playerId, confirmed !== false);
    if (result.error) return callback?.({ error: result.error });

    callback?.({ room: result.room ? toPublicRoom(result.room) : null });
    if (result.kicked) {
      handleVoteKickResolution(result.room, roomCode, targetId, result.targetSocketId);
    } else {
      io.to(roomCode).emit("room:update", toPublicRoom(result.room));
    }
  });

  socket.on("room:vote-kick-cancel", (payload = {}, callback) => {
    if (!allowEvent()) return callback?.({ error: "RATE_LIMITED" });
    const roomCode = socket.data.roomCode;
    const playerId = resolveActingPlayerId(socket, {});
    if (!roomCode || !playerId) return callback?.({ error: "NOT_IN_ROOM" });

    const result = cancelVoteKickByHost(roomCode, playerId);
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
      // A departure can turn an already-pending rematch vote unanimous, or
      // resolve/moot a pending votekick, on its own. Recheck both before
      // broadcasting. The votekick recheck can (rarely) empty the room too,
      // same as the finalizePlayerExit loop above.
      recheckRematchAfterExit(room);
      room = recheckVoteKickAfterExit(room);
    }

    if (room) {
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
          const afterVoteKick = recheckVoteKickAfterExit(result.room);
          if (afterVoteKick) {
            io.to(roomCode).emit("room:update", toPublicRoom(afterVoteKick));
            maybeComputeResults(io, afterVoteKick, roomCode);
          }
        }
      });
    }

    // A disconnect (even before its grace period expires) already drops the
    // player out of the rematch's/votekick's required-voter sets, same as
    // finalizePlayerExit does. Recheck both here too, not just on expiry.
    recheckRematchAfterExit(room);
    const afterVoteKick = recheckVoteKickAfterExit(room);
    if (afterVoteKick) io.to(roomCode).emit("room:update", toPublicRoom(afterVoteKick));
  });

  // Chat and reactions are purely ephemeral, relayed to the room and never
  // stored on `room` itself, so there's no history to send a new joiner and
  // nothing here for toPublicRoom to serialize. That matches how they're
  // actually used (a live pop-up near the sender's profile plus a
  // session-local scrollback), not a persistent chat log.
  const MAX_CHAT_MESSAGE_LENGTH = 200;
  const ALLOWED_REACTIONS = new Set(["🔥", "😭", "💯", "💔"]);

  socket.on("chat:message", (payload = {}, callback) => {
    if (!allowEvent()) return callback?.({ error: "RATE_LIMITED" });
    const roomCode = socket.data.roomCode;
    const playerId = resolveActingPlayerId(socket, payload);
    if (!roomCode || !playerId) return callback?.({ error: "NOT_IN_ROOM" });
    if (!getRoom(roomCode)) return callback?.({ error: "ROOM_NOT_FOUND" });

    const text = typeof payload.text === "string" ? payload.text.trim().slice(0, MAX_CHAT_MESSAGE_LENGTH) : "";
    if (!text) return callback?.({ error: "EMPTY_MESSAGE" });

    io.to(roomCode).emit("chat:message", { id: randomUUID(), playerId, text, at: Date.now() });
    callback?.({ ok: true });
  });

  socket.on("chat:reaction", (payload = {}, callback) => {
    if (!allowEvent()) return callback?.({ error: "RATE_LIMITED" });
    const roomCode = socket.data.roomCode;
    const playerId = resolveActingPlayerId(socket, payload);
    if (!roomCode || !playerId) return callback?.({ error: "NOT_IN_ROOM" });
    if (!getRoom(roomCode)) return callback?.({ error: "ROOM_NOT_FOUND" });

    if (!ALLOWED_REACTIONS.has(payload.emoji)) return callback?.({ error: "INVALID_REACTION" });

    io.to(roomCode).emit("chat:reaction", { id: randomUUID(), playerId, emoji: payload.emoji, at: Date.now() });
    callback?.({ ok: true });
  });
}
