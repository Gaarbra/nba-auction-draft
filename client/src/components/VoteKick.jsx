import { useState } from "react";
import { motion } from "motion/react";

// Shared between RoomView (lobby) and DraftBoard (mid-draft) — the host can
// start a vote against anyone else currently connected, but starting it
// isn't a unilateral kick: everyone else eligible has to actually approve
// before it goes through (see server/src/rooms/roomStore.js for the vote
// math). Disabled entirely for local pass-and-play rooms, where every
// "player" is just the same person at the controls.
const ERROR_MESSAGES = {
  NOT_HOST: "Only the host can start a vote to remove someone.",
  VOTE_KICK_IN_PROGRESS: "A removal vote is already in progress.",
  CANNOT_KICK_SELF: "You can't start a vote against yourself.",
  PLAYER_NOT_FOUND: "That player isn't in the room anymore.",
  NOT_AVAILABLE_LOCAL: "Votekick isn't available in local pass-and-play.",
  INVALID_ROOM_STATE: "Can't start a vote right now.",
  NO_VOTE_KICK: "That vote has already ended.",
  CANNOT_VOTE_ON_OWN_KICK: "You can't vote on your own removal.",
  NOT_INITIATOR: "Only the player who started the vote can cancel it.",
  NOT_IN_ROOM: "You're not in this room.",
  RATE_LIMITED: "Slow down a bit — try again in a few seconds.",
};

function friendlyError(code) {
  return ERROR_MESSAGES[code] || "Something went wrong.";
}

/** Small "Kick" trigger next to a player row — host-only, hidden for local
 * rooms, for yourself, and while a vote is already underway (the server
 * only allows one at a time anyway). */
export function KickButton({ room, currentPlayerId, socket, targetPlayerId }) {
  const [error, setError] = useState("");
  const currentPlayer = room.players.find((p) => p.id === currentPlayerId);
  const isHost = Boolean(currentPlayer?.isHost);

  if (room.isLocal || !isHost || targetPlayerId === currentPlayerId || room.voteKick) return null;

  function startVote() {
    setError("");
    socket.emit("room:vote-kick-start", { targetId: targetPlayerId }, (response) => {
      if (response?.error) setError(friendlyError(response.error));
    });
  }

  return (
    <span className="kick-btn-wrap">
      <button type="button" className="kick-btn" onClick={startVote} title="Start a vote to remove this player">
        Kick
      </button>
      {error && <span className="error-text kick-error">{error}</span>}
    </span>
  );
}

/** The vote-in-progress banner — approve/reject for anyone still eligible
 * to vote, a live tally, and a cancel option for whoever started it. */
export default function VoteKickBanner({ room, currentPlayerId, socket }) {
  const [error, setError] = useState("");
  const voteKick = room.voteKick;
  if (!voteKick) return null;

  const target = room.players.find((p) => p.id === voteKick.targetId);
  const eligibleIds = new Set(
    room.players.filter((p) => p.connected && !p.forfeited && p.id !== voteKick.targetId).map((p) => p.id)
  );
  const approveCount = voteKick.approveIds.filter((id) => eligibleIds.has(id)).length;
  // Strict majority — must match the server's tallyVoteKick threshold exactly.
  const threshold = Math.floor(eligibleIds.size / 2) + 1;

  const isTarget = currentPlayerId === voteKick.targetId;
  const isInitiator = currentPlayerId === voteKick.initiatedBy;
  const canVote = eligibleIds.has(currentPlayerId);
  const myVote = voteKick.approveIds.includes(currentPlayerId)
    ? true
    : voteKick.rejectIds.includes(currentPlayerId)
      ? false
      : null;

  function castVote(confirmed) {
    setError("");
    socket.emit("room:vote-kick-cast", { confirmed }, (response) => {
      if (response?.error) setError(friendlyError(response.error));
    });
  }

  function cancelVote() {
    setError("");
    socket.emit("room:vote-kick-cancel", {}, (response) => {
      if (response?.error) setError(friendlyError(response.error));
    });
  }

  return (
    <motion.div
      className="vote-kick-banner"
      initial={{ opacity: 0, y: -10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 26 }}
    >
      <p className="vote-kick-title">
        {isTarget ? (
          <>A vote is underway to remove you from the room.</>
        ) : (
          <>
            Vote to remove <strong>{target?.name || "this player"}</strong>
          </>
        )}
        <span className="vote-kick-tally">
          {approveCount}/{threshold} votes
        </span>
      </p>

      {canVote && !isTarget && (
        <div className="vote-kick-actions">
          <motion.button
            type="button"
            className="secondary-btn"
            whileTap={{ scale: 0.96 }}
            disabled={myVote === true}
            onClick={() => castVote(true)}
          >
            {myVote === true ? "Voted to remove ✓" : "Vote to Remove"}
          </motion.button>
          <motion.button
            type="button"
            className="secondary-btn"
            whileTap={{ scale: 0.96 }}
            disabled={myVote === false}
            onClick={() => castVote(false)}
          >
            Keep Them
          </motion.button>
        </div>
      )}

      {isInitiator && (
        <button type="button" className="vote-kick-cancel" onClick={cancelVote}>
          Cancel Vote
        </button>
      )}

      {error && <p className="error-text">{error}</p>}
    </motion.div>
  );
}
