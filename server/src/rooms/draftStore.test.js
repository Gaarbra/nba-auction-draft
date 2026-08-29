import test from "node:test";
import assert from "node:assert/strict";
import { nominatePlayer, placeBid, passOnNomination, removePlayerFromDraft } from "./draftStore.js";

function emptyRoster() {
  return { PG: null, SG: null, SF: null, PF: null, C: null };
}

// A minimal room/draft shape, built directly rather than through
// initializeDraft (which shuffles turnOrder randomly) — these tests need a
// deterministic order to assert exact turn-cycling behavior.
function makeRoom({ biddingMode = "open", turnOrder = ["A", "B", "C"], budgets = {} } = {}) {
  const rosters = {};
  for (const id of turnOrder) rosters[id] = emptyRoster();
  return {
    status: "drafting",
    biddingMode,
    players: turnOrder.map((id) => ({ id, budget: budgets[id] ?? 20 })),
    draft: {
      turnOrder: [...turnOrder],
      rosters,
      draftedPlayerIds: [],
      currentNominatorId: turnOrder[0],
      nomination: null,
    },
  };
}

const player = { id: 1, fullName: "Test Player" };

test("orderly mode: nominating sets currentBidTurnId to the next active bidder after the nominator", () => {
  const room = makeRoom({ biddingMode: "orderly" });
  nominatePlayer(room, "A", player);
  assert.strictEqual(room.draft.nomination.currentBidTurnId, "B");
});

test("open mode: nominating leaves currentBidTurnId null (no turn gating)", () => {
  const room = makeRoom({ biddingMode: "open" });
  nominatePlayer(room, "A", player);
  assert.strictEqual(room.draft.nomination.currentBidTurnId, null);
});

test("open mode: bidding and passing out of 'turn' still works — there is no turn to be out of", () => {
  const room = makeRoom({ biddingMode: "open" });
  nominatePlayer(room, "A", player);
  const bidResult = placeBid(room, "C", 5);
  assert.strictEqual(bidResult.error, undefined);
  assert.strictEqual(room.draft.nomination.currentBidder, "C");
});

test("orderly mode: bidding out of turn is rejected", () => {
  const room = makeRoom({ biddingMode: "orderly" });
  nominatePlayer(room, "A", player); // turn -> B
  const result = placeBid(room, "C", 5);
  assert.strictEqual(result.error, "NOT_YOUR_BID_TURN");
});

test("orderly mode: passing out of turn is rejected", () => {
  const room = makeRoom({ biddingMode: "orderly" });
  nominatePlayer(room, "A", player); // turn -> B
  const result = passOnNomination(room, "C");
  assert.strictEqual(result.error, "NOT_YOUR_BID_TURN");
});

test("orderly mode: a valid bid on your turn advances the turn to the next active bidder", () => {
  const room = makeRoom({ biddingMode: "orderly" });
  nominatePlayer(room, "A", player); // bid=1, currentBidder=A, turn=B
  const result = placeBid(room, "B", 3);
  assert.strictEqual(result.error, undefined);
  assert.strictEqual(room.draft.nomination.currentBidder, "B");
  assert.strictEqual(room.draft.nomination.currentBidTurnId, "C");
});

test("orderly mode: passing on your turn advances to the next active bidder", () => {
  const room = makeRoom({ biddingMode: "orderly" });
  nominatePlayer(room, "A", player); // turn=B
  passOnNomination(room, "B"); // turn -> C
  assert.strictEqual(room.draft.nomination.currentBidTurnId, "C");
});

test("orderly mode: everyone but the high bidder passing resolves to assigning and clears the turn", () => {
  const room = makeRoom({ biddingMode: "orderly" });
  nominatePlayer(room, "A", player); // turn=B
  passOnNomination(room, "B"); // turn -> C
  passOnNomination(room, "C"); // no one left -> assigning
  assert.strictEqual(room.draft.nomination.phase, "assigning");
  assert.strictEqual(room.draft.nomination.currentBidTurnId, null);
});

test("orderly mode: the turn cycles back to an earlier bidder if they haven't passed and someone re-raises past them", () => {
  const room = makeRoom({ biddingMode: "orderly" });
  nominatePlayer(room, "A", player); // bid 1 by A, turn=B
  placeBid(room, "B", 5); // B new high bidder, turn=C
  placeBid(room, "C", 8); // C new high bidder, turn should cycle back to A
  assert.strictEqual(room.draft.nomination.currentBidTurnId, "A");
});

test("orderly mode: a player leaving mid-turn hands the turn to the next active bidder instead of getting stuck", () => {
  const room = makeRoom({ biddingMode: "orderly" });
  nominatePlayer(room, "A", player); // turn=B
  removePlayerFromDraft(room, "B"); // B leaves while it's their turn
  assert.strictEqual(room.draft.nomination.currentBidTurnId, "C");
});

test("orderly mode: a player leaving who wasn't on turn doesn't disturb whose turn it is", () => {
  const room = makeRoom({ biddingMode: "orderly", turnOrder: ["A", "B", "C", "D"] });
  nominatePlayer(room, "A", player); // turn=B
  removePlayerFromDraft(room, "D"); // D leaves, not their turn
  assert.strictEqual(room.draft.nomination.currentBidTurnId, "B");
});
