import { useState } from "react";
import { motion } from "motion/react";
import PlayerHeadshot from "./PlayerHeadshot.jsx";
import PlayerNameLink from "./PlayerNameLink.jsx";

const RANK_LABELS = { 1: "1ST", 2: "2ND", 3: "3RD", 4: "4TH" };

const ERROR_MESSAGES = {
  NOT_HOST: "Only the host can return everyone to the lobby.",
  DRAFT_NOT_COMPLETE: "The draft isn't finished yet.",
  RATE_LIMITED: "Slow down a bit — try again in a few seconds.",
};

function friendlyError(code) {
  return ERROR_MESSAGES[code] || "Something went wrong.";
}

function formatPct(value) {
  return `${value.toFixed(1)}%`;
}

function formatScore(value) {
  return value.toFixed(1);
}

/** "Return to Lobby" (host-only, immediate) and "Rematch" (anyone can propose, needs everyone still around to confirm before it redeals). */
function PostGameActions({ room, currentPlayerId, socket, onLeaveRoom }) {
  const [actionError, setActionError] = useState("");

  const currentPlayer = room.players.find((p) => p.id === currentPlayerId);
  const isHost = Boolean(currentPlayer?.isHost);
  const rematchVotes = room.rematchVotes || [];
  const activePlayers = room.players.filter((p) => p.connected && !p.forfeited);
  const iVoted = rematchVotes.includes(currentPlayerId);

  function handleReturnToLobby() {
    setActionError("");
    socket.emit("room:return-to-lobby", { playerId: currentPlayerId }, (res) => {
      if (res?.error) setActionError(friendlyError(res.error));
    });
  }

  function handleToggleRematch() {
    setActionError("");
    socket.emit("room:vote-rematch", { playerId: currentPlayerId, confirmed: !iVoted }, (res) => {
      if (res?.error) setActionError(friendlyError(res.error));
    });
  }

  return (
    <div className="post-game-actions">
      <div className="rematch-panel">
        <h3 className="results-section-title">Rematch</h3>
        <p className="hint-text">Everyone still here needs to confirm before a new draft starts.</p>
        <ul className="rematch-vote-list">
          {activePlayers.map((p) => (
            <li key={p.id} className={rematchVotes.includes(p.id) ? "confirmed" : ""}>
              <span className="rematch-vote-check" aria-hidden="true">
                {rematchVotes.includes(p.id) ? "✓" : "…"}
              </span>
              {p.name}
              {p.id === currentPlayerId && <span className="you-badge">You</span>}
            </li>
          ))}
        </ul>
        <motion.button
          type="button"
          onClick={handleToggleRematch}
          className="primary-btn"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
        >
          {iVoted ? "Cancel Rematch Vote" : "Confirm Rematch"}
        </motion.button>
      </div>

      <div className="post-game-buttons">
        {isHost && (
          <button type="button" onClick={handleReturnToLobby} className="secondary-btn">
            Return to Lobby
          </button>
        )}
        <button type="button" onClick={onLeaveRoom} className="leave-btn">
          Leave Room
        </button>
      </div>

      {actionError && <p className="error-text">{actionError}</p>}
    </div>
  );
}

export default function ResultsScreen({ room, currentPlayerId, socket, onLeaveRoom }) {
  const { resultsStatus, results } = room;

  if (resultsStatus === "failed") {
    return (
      <div className="draft-board">
        <div className="draft-header">
          <h2>Draft Complete</h2>
        </div>
        <p className="error-text">
          Couldn't compute final scores (the stats service may be unreachable). Your rosters are still saved below.
        </p>
        <PostGameActions room={room} currentPlayerId={currentPlayerId} socket={socket} onLeaveRoom={onLeaveRoom} />
      </div>
    );
  }

  if (resultsStatus !== "ready" || !results) {
    return (
      <div className="draft-board">
        <div className="draft-header">
          <h2>Draft Complete</h2>
          <button type="button" onClick={onLeaveRoom} className="secondary-btn">
            Leave Room
          </button>
        </div>
        <div className="rolling-panel">
          <p className="hint-text">Computing final scores…</p>
          <div className="rolling-name">Crunching the numbers</div>
        </div>
      </div>
    );
  }

  return (
    <div className="draft-board">
      <div className="draft-header">
        <h2>Final Results</h2>
      </div>

      <div className="results-standings">
        {results.teams.map((team, index) => (
          <motion.div
            key={team.id}
            className={`results-team-card ${team.id === currentPlayerId ? "you" : ""}`}
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.12, type: "spring", stiffness: 260, damping: 24 }}
          >
            <div className="results-team-header">
              <span className="results-rank">{RANK_LABELS[team.rank] || `#${team.rank}`}</span>
              <span className="results-team-name">
                {team.playerName}
                {team.id === currentPlayerId && <span className="you-badge">You</span>}
                {team.forfeited && <span className="status-badge forfeited">Left the draft</span>}
              </span>
              <span className="results-final-score">{formatScore(team.finalScore)}</span>
            </div>

            <p className="hint-text">
              Sum USG%: {formatPct(team.sumUsagePct)} · Synergy ×{team.synergyMultiplier.toFixed(2)}
              {team.forfeited && ` · Scored on ${team.filledSlots}/5 slots filled before they left`}
            </p>

            <div className="results-roster">
              {team.roster.map((p) => (
                <div key={p.slot} className="results-player-row">
                  <PlayerHeadshot nbaPlayerId={p.nbaPlayerId} photoUrl={p.photoUrl} alt={p.fullName || p.slot} className="results-headshot" />
                  <div className="results-player-info">
                    <span className="slot-label">{p.slot}</span>
                    <PlayerNameLink
                      nbaPlayerId={p.nbaPlayerId}
                      name={p.fullName || "—"}
                      className="results-player-name"
                    />
                  </div>
                  <div className="results-player-scores">
                    <span title="Offense Score">Op {formatScore(p.op)}</span>
                    <span title="Defensive Impact Rating">
                      DIR {formatScore(p.dir)}
                      {p.usagePctEstimated && (
                        <span className="estimate-flag" title="USG%/DIR estimated for this era — see README">
                          *
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        ))}
      </div>

      <h3 className="results-section-title">Matchups</h3>
      <div className="results-matchups">
        {results.matchups.map((m) => {
          const teamA = results.teams.find((t) => t.id === m.teamAId);
          const teamB = results.teams.find((t) => t.id === m.teamBId);
          const aFavored = m.probA >= m.probB;
          return (
            <div key={`${m.teamAId}-${m.teamBId}`} className="matchup-row">
              <span className={`matchup-side ${aFavored ? "favored" : ""}`}>
                {teamA?.playerName} — {(m.probA * 100).toFixed(0)}%
              </span>
              <span className="matchup-vs">vs</span>
              <span className={`matchup-side ${!aFavored ? "favored" : ""}`}>
                {teamB?.playerName} — {(m.probB * 100).toFixed(0)}%
              </span>
            </div>
          );
        })}
      </div>

      <p className="hint-text results-footnote">
        * marks estimated USG%/defensive stats where the real figure isn't available for that player's era (see
        README for methodology).
      </p>

      <PostGameActions room={room} currentPlayerId={currentPlayerId} socket={socket} onLeaveRoom={onLeaveRoom} />
    </div>
  );
}
