import { randomUUID } from "node:crypto";
import { initializeDraft, removePlayerFromDraft } from "./draftStore.js";
import { ERA_BUCKETS } from "../services/era.js";

const VALID_ERA_IDS = new Set(["all", "active", ...ERA_BUCKETS.map((b) => b.id)]);

// Difficulty is just the odds (per roll) that a nomination draws from the
// data-driven "notable" pool — hundreds of real all-time statistical
// leaders, sourced fresh from stats.nba.com and cached for a week (see
// notablePlayers.js) — instead of the full era pool. A single random draw
// happens either way (see drawPlayerWithStats in roomHandlers.js); this is
// what actually matters against a big/varied pool like "All Eras", where a
// pick from the full ~5,200-player history is unlikely to land anyone
// recognizable regardless of difficulty. Nobody is ever excluded outright —
// even on Easy there's still a chance of drawing the full pool — and the
// notable pool itself is built from real leaderboards, not a hand-picked
// list, so which names show up still varies roll to roll.
export const DIFFICULTY_STATIC_ODDS = { easy: 0.92, normal: 0.55, hard: 0 };
const VALID_DIFFICULTIES = new Set(Object.keys(DIFFICULTY_STATIC_ODDS));

// A narrow era (e.g. "2020s", notable pool ~10 players) shouldn't dominate
// every roll with the exact same handful of names — but it also shouldn't
// lose the "well-known players show up a lot" feel just because it's a
// young decade with few players old enough to crack an all-time top 500.
// Every era except 2020s comfortably clears MIN_NOTABLE_POOL_FOR_FULL_ODDS
// (58+ notable players — see server/verify scripts from this era of the
// project's history for the real numbers), so this floor only ever engages
// for that one outlier: scale down for real variety as the pool shrinks,
// but never below POOL_SIZE_SCALE_FLOOR.
const MIN_NOTABLE_POOL_FOR_FULL_ODDS = 30;
const POOL_SIZE_SCALE_FLOOR = 0.7;

/**
 * The odds (0-1) that a single nomination draw should come from the
 * data-driven "notable" pool rather than the full era pool, for a given
 * difficulty and how many notable players actually exist in the current
 * era. Pure and deterministic — the actual coin flip (`Math.random() <
 * odds`) and the actual uniform draw within whichever pool that picks live
 * in roomHandlers.js; this only computes the threshold.
 * @param {string} difficulty
 * @param {number} notablePoolSize
 * @returns {number}
 */
export function computeNotablePoolOdds(difficulty, notablePoolSize) {
  const base = DIFFICULTY_STATIC_ODDS[difficulty] ?? DIFFICULTY_STATIC_ODDS.normal;
  const poolSizeScale = Math.max(POOL_SIZE_SCALE_FLOOR, Math.min(1, notablePoolSize / MIN_NOTABLE_POOL_FOR_FULL_ODDS));
  return base * poolSizeScale;
}

// "open" (the long-standing default): anyone still active on a nomination
// can bid or pass whenever they want, first-come-first-served. "orderly":
// only one specific person may act at a time, cycling through turn order —
// see nextBidTurnId in draftStore.js for the actual turn logic.
const VALID_BIDDING_MODES = new Set(["open", "orderly"]);

const rooms = new Map();

const MIN_PLAYERS = 1;
const MAX_PLAYERS = 4;
const STARTING_BUDGET = 20;

// How long a disconnected player's slot is held open for them to reclaim via
// room:rejoin before their team is finalized without them.
export const RECONNECT_GRACE_MS = 60_000;

// How long an unresolved votekick stays open before it's auto-cancelled —
// long enough for everyone to notice and respond, short enough that it
// doesn't just sit there blocking a new one from being started.
export const VOTE_KICK_TIMEOUT_MS = 30_000;

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  } while (rooms.has(code));
  return code;
}

export function createRoom(visibility = "private") {
  const code = generateRoomCode();
  const room = {
    code,
    players: [],
    status: "waiting",
    createdAt: Date.now(),
    // "private": needs the room code to join (today's long-standing default).
    // "public": also listable via listPublicRooms(), joinable without a code.
    visibility: visibility === "public" ? "public" : "private",
    // playerId -> setTimeout handle, for pending disconnect-grace forfeits.
    pendingForfeits: new Map(),
  };
  rooms.set(code, room);
  return room;
}

export function getRoom(code) {
  return rooms.get(code?.toUpperCase());
}

/** Open, joinable-without-a-code rooms — for the lobby's "Public" tab. Local
 * pass-and-play rooms are never listable (there's no one else to join). */
export function listPublicRooms() {
  const list = [];
  for (const room of rooms.values()) {
    if (room.visibility !== "public") continue;
    if (room.status !== "waiting") continue;
    if (room.isLocal) continue;
    if (room.players.length >= MAX_PLAYERS) continue;

    const host = room.players.find((p) => p.isHost);
    list.push({
      code: room.code,
      hostName: host?.name || "Someone",
      playerCount: room.players.length,
      maxPlayers: MAX_PLAYERS,
      createdAt: room.createdAt,
    });
  }
  // Newest first — a room that's been sitting open a while is more likely
  // abandoned than one just created.
  list.sort((a, b) => b.createdAt - a.createdAt);
  return list;
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

// Pass-and-play: one socket controls every player in the room, so they're
// all created up front (instead of joining one at a time) and bound to the
// same socketId. Cleans up the room it created if any name in the batch
// fails validation partway through, rather than leaving a half-built room
// with no way for the client to retry cleanly.
export function addLocalPlayersToRoom(names, socketId) {
  if (!Array.isArray(names) || names.length < 2 || names.length > MAX_PLAYERS) {
    return { error: "INVALID_LOCAL_PLAYERS" };
  }

  const room = createRoom();
  const players = [];
  for (const name of names) {
    const result = addPlayerToRoom(room.code, { name, socketId });
    if (result.error) {
      rooms.delete(room.code);
      return { error: result.error };
    }
    players.push(result.player);
  }

  room.isLocal = true;
  return { room, players };
}

export function startDraft(code, playerId, era, allowPositionSwaps, difficulty, biddingMode) {
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
  const draftDifficulty = difficulty || "normal";
  if (!VALID_DIFFICULTIES.has(draftDifficulty)) {
    return { error: "INVALID_DIFFICULTY" };
  }
  const draftBiddingMode = biddingMode || "open";
  if (!VALID_BIDDING_MODES.has(draftBiddingMode)) {
    return { error: "INVALID_BIDDING_MODE" };
  }

  room.status = "drafting";
  room.draftEra = draftEra;
  room.difficulty = draftDifficulty;
  room.biddingMode = draftBiddingMode;
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

// Only the host can start a votekick, but starting one doesn't kick anyone
// outright — it opens a vote that a majority of everyone else still in the
// room (the target excluded) has to actually approve. That's the whole
// point of making this a *vote*kick instead of a plain host-kick: it caps
// what the host can unilaterally do to one other player, while still
// giving the room a way to remove someone disruptive without needing every
// single remaining player on board (unanimous would let one holdout block
// it forever).
function eligibleVoteKickVoters(room, targetId) {
  return room.players.filter((p) => p.connected && !p.forfeited && p.id !== targetId).map((p) => p.id);
}

function clearVoteKickTimer(room) {
  if (room.voteKick?.timer) clearTimeout(room.voteKick.timer);
}

function cancelVoteKick(room) {
  clearVoteKickTimer(room);
  room.voteKick = null;
}

/** Recomputes whether the pending votekick should resolve (kicked, or called
 * off as mathematically unreachable) given the current vote tally — called
 * after every vote AND after anyone's connection status changes, since a
 * departure changes who's still eligible to vote and can flip either
 * outcome on its own. */
function tallyVoteKick(room) {
  const vk = room.voteKick;
  if (!vk) return { room, resolved: false };

  const eligible = eligibleVoteKickVoters(room, vk.targetId);
  if (eligible.length === 0) {
    cancelVoteKick(room);
    return { room, resolved: true, kicked: false };
  }

  // Strict majority, not "half" — Math.ceil(n/2) would let exactly 1 of 2
  // eligible voters pass a vote that only half the room actually backed.
  const threshold = Math.floor(eligible.length / 2) + 1;
  let approve = 0;
  let reject = 0;
  for (const id of eligible) {
    const vote = vk.votes.get(id);
    if (vote === true) approve += 1;
    else if (vote === false) reject += 1;
  }

  if (approve >= threshold) {
    clearVoteKickTimer(room);
    room.voteKick = null;
    // Capture the target's socketId before finalizePlayerExit runs — in the
    // lobby ("waiting") it removes them from room.players outright, so
    // looking this up afterward would always come back empty and the
    // targeted "you were kicked" notification would silently never fire.
    const targetSocketId = room.players.find((p) => p.id === vk.targetId)?.socketId;
    const exitResult = finalizePlayerExit(room, vk.targetId);
    return { room: exitResult.room, resolved: true, kicked: true, targetId: vk.targetId, targetSocketId };
  }

  // Once enough people have voted no that the remaining undecided voters
  // couldn't possibly push it over threshold, there's no point leaving it
  // open — call it off instead of making everyone wait for the timeout.
  if (eligible.length - reject < threshold) {
    cancelVoteKick(room);
    return { room, resolved: true, kicked: false };
  }

  return { room, resolved: false };
}

/** Host-only: opens a votekick against another connected player. Resolves
 * immediately (no vote needed) when the host is the only other eligible
 * voter in the room — there's no one left to wait on. `onExpire` is called
 * if the vote is still unresolved after VOTE_KICK_TIMEOUT_MS, so the caller
 * (which owns `io`) can broadcast the auto-cancellation. */
export function startVoteKick(code, initiatorId, targetId, onExpire) {
  const room = getRoom(code);
  if (!room) return { error: "ROOM_NOT_FOUND" };
  if (room.isLocal) return { error: "NOT_AVAILABLE_LOCAL" };
  if (room.status !== "waiting" && room.status !== "drafting") return { error: "INVALID_ROOM_STATE" };
  if (room.voteKick) return { error: "VOTE_KICK_IN_PROGRESS" };
  if (targetId === initiatorId) return { error: "CANNOT_KICK_SELF" };

  const initiator = room.players.find((p) => p.id === initiatorId);
  if (!initiator || !initiator.connected) return { error: "NOT_IN_ROOM" };
  if (!initiator.isHost) return { error: "NOT_HOST" };

  const target = room.players.find((p) => p.id === targetId);
  if (!target || !target.connected || target.forfeited) return { error: "PLAYER_NOT_FOUND" };

  // Starting the vote counts as the host's own yes vote.
  room.voteKick = { targetId, initiatedBy: initiatorId, votes: new Map([[initiatorId, true]]), startedAt: Date.now(), timer: null };

  const tally = tallyVoteKick(room);
  if (tally.resolved) return { room: tally.room, kicked: Boolean(tally.kicked), targetSocketId: tally.targetSocketId };

  room.voteKick.timer = setTimeout(() => {
    if (!room.voteKick) return;
    cancelVoteKick(room);
    onExpire?.();
  }, VOTE_KICK_TIMEOUT_MS);

  return { room };
}

export function castVoteKick(code, playerId, approve) {
  const room = getRoom(code);
  if (!room) return { error: "ROOM_NOT_FOUND" };
  if (!room.voteKick) return { error: "NO_VOTE_KICK" };
  if (playerId === room.voteKick.targetId) return { error: "CANNOT_VOTE_ON_OWN_KICK" };

  const player = room.players.find((p) => p.id === playerId);
  if (!player || !player.connected) return { error: "NOT_IN_ROOM" };

  room.voteKick.votes.set(playerId, approve !== false);
  const tally = tallyVoteKick(room);
  return { room: tally.room, kicked: Boolean(tally.kicked), targetSocketId: tally.targetSocketId };
}

/** Lets the host who started a votekick call it off early. */
export function cancelVoteKickByHost(code, playerId) {
  const room = getRoom(code);
  if (!room) return { error: "ROOM_NOT_FOUND" };
  if (!room.voteKick) return { error: "NO_VOTE_KICK" };
  if (room.voteKick.initiatedBy !== playerId) return { error: "NOT_INITIATOR" };

  cancelVoteKick(room);
  return { room };
}

/** Re-evaluates a pending votekick after someone's connection status
 * changes (left, disconnected, reconnected) — a departure can resolve a
 * vote (kick or cancel) on its own even with no new vote cast, same idea
 * as recheckRematchAfterExit. */
export function recheckVoteKickAfterExit(room) {
  if (!room?.voteKick) return room;

  // The target may have already left on their own (e.g. their disconnect
  // grace period expired independently of this vote) — the vote is moot at
  // that point, not just short a voter, so cancel it outright instead of
  // leaving a stale "vote in progress" banner for someone who's already gone.
  const target = room.players.find((p) => p.id === room.voteKick.targetId);
  if (!target || !target.connected) {
    cancelVoteKick(room);
    return room;
  }

  return tallyVoteKick(room).room;
}

/** A finished draft has no more use for an in-flight votekick (there's
 * nothing left to remove someone from) — called from maybeComputeResults,
 * the one place a draft can flip to "complete" without already going
 * through the leave/disconnect recheck above (a normal winning assignment). */
export function clearVoteKickIfComplete(room) {
  if (room?.status === "complete" && room.voteKick) cancelVoteKick(room);
}

/**
 * Shared reset for both "Return to Lobby" and a resolved rematch: drops
 * anyone who forfeited or is currently disconnected (their game is over,
 * and keeping a ghost entry around in the new lobby would just be an inert
 * row nobody can interact with), refunds everyone still here back to a
 * fresh budget, and clears the finished draft/results/rematch state.
 */
function resetRoomToLobby(room) {
  cancelVoteKick(room);
  room.players = room.players.filter((p) => p.connected && !p.forfeited);
  for (const player of room.players) {
    player.budget = STARTING_BUDGET;
  }
  if (room.players.length > 0 && !room.players.some((p) => p.isHost)) {
    room.players[0].isHost = true;
  }

  room.status = "waiting";
  room.draft = undefined;
  room.results = null;
  room.resultsStatus = null;
  room.rematchVotes = new Set();
}

export function returnToLobby(code, playerId) {
  const room = getRoom(code);
  if (!room) return { error: "ROOM_NOT_FOUND" };
  if (room.status !== "complete") return { error: "DRAFT_NOT_COMPLETE" };

  const player = room.players.find((p) => p.id === playerId);
  if (!player) return { error: "NOT_IN_ROOM" };
  if (!player.isHost) return { error: "NOT_HOST" };

  resetRoomToLobby(room);
  return { room };
}

/** If every currently connected, non-forfeited player has confirmed, resets the room and redeals a fresh draft with the same era/difficulty/swap settings — no lobby stop, straight back into a new game. Called after every vote change AND after a mid-vote departure, since someone leaving can turn a pending vote unanimous on its own. */
function recheckRematch(room) {
  if (room.status !== "complete" || !room.rematchVotes || room.rematchVotes.size === 0) return;

  const requiredIds = room.players.filter((p) => p.connected && !p.forfeited).map((p) => p.id);
  const allConfirmed = requiredIds.length > 0 && requiredIds.every((id) => room.rematchVotes.has(id));
  if (!allConfirmed) return;

  const era = room.draftEra || "all";
  const difficulty = room.difficulty || "normal";
  const biddingMode = room.biddingMode || "open";
  const allowPositionSwaps = room.allowPositionSwaps;

  resetRoomToLobby(room);
  room.status = "drafting";
  room.draftEra = era;
  room.difficulty = difficulty;
  room.biddingMode = biddingMode;
  room.allowPositionSwaps = allowPositionSwaps;
  initializeDraft(room);
}

export function setRematchVote(code, playerId, confirmed) {
  const room = getRoom(code);
  if (!room) return { error: "ROOM_NOT_FOUND" };
  if (room.status !== "complete") return { error: "DRAFT_NOT_COMPLETE" };

  const player = room.players.find((p) => p.id === playerId);
  if (!player || !player.connected) return { error: "NOT_IN_ROOM" };

  if (!room.rematchVotes) room.rematchVotes = new Set();
  if (confirmed) room.rematchVotes.add(playerId);
  else room.rematchVotes.delete(playerId);

  recheckRematch(room);
  return { room };
}

/** Re-evaluates a pending rematch vote after someone leaves the room — exported separately from setRematchVote since a departure (not a vote) is what triggers the recheck here. */
export function recheckRematchAfterExit(room) {
  recheckRematch(room);
}

export const config = { MIN_PLAYERS, MAX_PLAYERS, STARTING_BUDGET };
