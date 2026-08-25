export const POSITIONS = ["PG", "SG", "SF", "PF", "C"];

function emptyRoster() {
  return { PG: null, SG: null, SF: null, PF: null, C: null };
}

function getOpenSlots(roster) {
  return POSITIONS.filter((pos) => roster[pos] === null);
}

function isRosterFull(roster) {
  return getOpenSlots(roster).length === 0;
}

function getPlayer(room, playerId) {
  return room.players.find((p) => p.id === playerId);
}

function nextNominatorId(room, fromId) {
  const order = room.draft.turnOrder;
  const startIndex = order.indexOf(fromId);
  for (let step = 1; step <= order.length; step += 1) {
    const candidateId = order[(startIndex + step) % order.length];
    const roster = room.draft.rosters[candidateId];
    if (roster && !isRosterFull(roster)) {
      return candidateId;
    }
  }
  return null;
}

function shuffle(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function initializeDraft(room) {
  const turnOrder = shuffle(room.players.map((p) => p.id));
  const rosters = {};
  for (const id of turnOrder) {
    rosters[id] = emptyRoster();
  }

  room.draft = {
    turnOrder,
    rosters,
    draftedPlayerIds: [],
    currentNominatorId: turnOrder[0],
    nomination: null,
  };
}

const STARTING_BID = 1;

export function nominatePlayer(room, playerId, player) {
  if (room.status !== "drafting") return { error: "NOT_DRAFTING" };
  const draft = room.draft;
  if (draft.nomination) return { error: "NOMINATION_IN_PROGRESS" };
  if (draft.currentNominatorId !== playerId) return { error: "NOT_YOUR_TURN" };

  const nominator = getPlayer(room, playerId);
  if (!nominator) return { error: "NOT_IN_ROOM" };

  if (draft.draftedPlayerIds.includes(player.id)) return { error: "PLAYER_ALREADY_DRAFTED" };

  // A nominator with less than the usual starting bid (down to 0 coins)
  // can still nominate — they just open the bidding at whatever they can
  // actually afford. If nobody else bids, they end up winning the player
  // for that amount via the normal pass-out flow (see passOnNomination),
  // which can be 0. That's what keeps a broke player's turn from stalling
  // the whole draft: their turn always produces a result, they just can't
  // outbid anyone if someone else wants the player too.
  const bid = Math.min(STARTING_BID, nominator.budget);

  // Skip straight to "assigning" not just for a literal one-player room, but
  // whenever no one else in the room is even able to bid (everyone else has
  // already filled their roster). Otherwise the nomination sits in "bidding"
  // forever: a roster-full opponent gets no Pass button (see DraftBoard's
  // "spectating" state), so passOnNomination never runs and stillActive
  // never gets recomputed down to zero. This is the scenario a broke player
  // hits most often, since they're typically the last one to finish drafting.
  const hasActiveOpponent = draft.turnOrder.some(
    (id) => id !== playerId && !isRosterFull(draft.rosters[id])
  );

  draft.nomination = {
    player,
    nominatedBy: playerId,
    currentBid: bid,
    currentBidder: playerId,
    passed: [],
    phase: hasActiveOpponent ? "bidding" : "assigning",
  };

  return { room };
}

export function placeBid(room, playerId, amount) {
  if (room.status !== "drafting") return { error: "NOT_DRAFTING" };
  const draft = room.draft;
  const nomination = draft.nomination;
  if (!nomination || nomination.phase !== "bidding") return { error: "NO_ACTIVE_NOMINATION" };
  if (nomination.currentBidder === playerId) return { error: "ALREADY_HIGH_BIDDER" };
  if (nomination.passed.includes(playerId)) return { error: "ALREADY_PASSED" };

  const bidder = getPlayer(room, playerId);
  if (!bidder) return { error: "NOT_IN_ROOM" };
  if (isRosterFull(draft.rosters[playerId])) return { error: "ROSTER_FULL" };

  const bid = Number(amount);
  if (!Number.isInteger(bid) || bid <= nomination.currentBid) return { error: "BID_TOO_LOW" };
  if (bid > bidder.budget) return { error: "BID_EXCEEDS_BUDGET" };

  nomination.currentBid = bid;
  nomination.currentBidder = playerId;

  return { room };
}

export function passOnNomination(room, playerId) {
  if (room.status !== "drafting") return { error: "NOT_DRAFTING" };
  const draft = room.draft;
  const nomination = draft.nomination;
  if (!nomination || nomination.phase !== "bidding") return { error: "NO_ACTIVE_NOMINATION" };
  if (nomination.currentBidder === playerId) return { error: "CANNOT_PASS_AS_HIGH_BIDDER" };
  if (nomination.passed.includes(playerId)) return { error: "ALREADY_PASSED" };

  nomination.passed.push(playerId);

  const stillActive = draft.turnOrder.filter((id) => {
    if (id === nomination.currentBidder) return false;
    if (isRosterFull(draft.rosters[id])) return false;
    return !nomination.passed.includes(id);
  });

  if (stillActive.length === 0) {
    nomination.phase = "assigning";
  }

  return { room };
}

export function assignPosition(room, playerId, position) {
  if (room.status !== "drafting") return { error: "NOT_DRAFTING" };
  const draft = room.draft;
  const nomination = draft.nomination;
  if (!nomination || nomination.phase !== "assigning") return { error: "NOT_ASSIGNING" };
  if (nomination.currentBidder !== playerId) return { error: "NOT_YOUR_ASSIGNMENT" };
  if (!POSITIONS.includes(position)) return { error: "INVALID_POSITION" };

  const roster = draft.rosters[playerId];
  if (roster[position] !== null) return { error: "SLOT_TAKEN" };

  const winner = getPlayer(room, playerId);
  winner.budget -= nomination.currentBid;
  roster[position] = { ...nomination.player, acquiredFor: nomination.currentBid };
  draft.draftedPlayerIds.push(nomination.player.id);
  draft.nomination = null;

  const allRostersFull = draft.turnOrder.every((id) => isRosterFull(draft.rosters[id]));
  if (allRostersFull) {
    room.status = "complete";
    draft.currentNominatorId = null;
  } else {
    draft.currentNominatorId = nextNominatorId(room, playerId);
  }

  return { room };
}

export function swapRosterPositions(room, playerId, slotA, slotB) {
  if (room.status !== "drafting") return { error: "NOT_DRAFTING" };
  if (!room.allowPositionSwaps) return { error: "SWAPS_NOT_ALLOWED" };
  if (!POSITIONS.includes(slotA) || !POSITIONS.includes(slotB) || slotA === slotB) {
    return { error: "INVALID_SLOTS" };
  }

  const roster = room.draft?.rosters?.[playerId];
  if (!roster) return { error: "NOT_IN_ROOM" };

  const temp = roster[slotA];
  roster[slotA] = roster[slotB];
  roster[slotB] = temp;

  return { room };
}

export function getOpenSlotsForPlayer(room, playerId) {
  return getOpenSlots(room.draft.rosters[playerId]);
}

// Used both for a voluntary mid-draft leave and for a disconnect that timed
// out its reconnect grace period. Deliberately never touches room.players or
// draft.rosters — the caller (roomStore) decides whether to keep the player
// entry around, and their roster (however incomplete) needs to survive so
// computeResults can still rank the team they'd built so far.
export function removePlayerFromDraft(room, playerId) {
  const draft = room.draft;
  if (!draft) return;

  draft.turnOrder = draft.turnOrder.filter((id) => id !== playerId);

  if (draft.nomination) {
    if (draft.nomination.nominatedBy === playerId || draft.nomination.currentBidder === playerId) {
      draft.nomination = null;
    } else {
      draft.nomination.passed = draft.nomination.passed.filter((id) => id !== playerId);

      // The player leaving might have been the last still-active holdout —
      // recompute the same "has everyone but the high bidder passed" check
      // passOnNomination uses, so bidding doesn't stall waiting on someone
      // who's gone.
      const nomination = draft.nomination;
      const stillActive = draft.turnOrder.filter((id) => {
        if (id === nomination.currentBidder) return false;
        if (isRosterFull(draft.rosters[id])) return false;
        return !nomination.passed.includes(id);
      });
      if (stillActive.length === 0) {
        nomination.phase = "assigning";
      }
    }
  }

  if (draft.turnOrder.length === 0) {
    draft.currentNominatorId = null;
    return;
  }

  const allRostersFull = draft.turnOrder.every((id) => isRosterFull(draft.rosters[id]));
  if (allRostersFull) {
    room.status = "complete";
    draft.currentNominatorId = null;
    return;
  }

  if (draft.currentNominatorId === playerId || !draft.turnOrder.includes(draft.currentNominatorId)) {
    draft.currentNominatorId = draft.turnOrder.find((id) => !isRosterFull(draft.rosters[id])) || null;
  }
}
