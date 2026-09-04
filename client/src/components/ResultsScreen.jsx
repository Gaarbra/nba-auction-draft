import { useState } from "react";
import { motion } from "motion/react";
import PlayerHeadshot from "./PlayerHeadshot.jsx";
import PlayerNameLink from "./PlayerNameLink.jsx";

const RANK_LABELS = { 1: "1st", 2: "2nd", 3: "3rd", 4: "4th" };

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

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true" width="16" height="16">
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M21 3v5h-5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 21v-5h5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true" width="16" height="16">
      <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** One standings card. The winner (and the current user) open with their
 *  roster showing; the rest collapse to rank + score with a tap to expand,
 *  matching the Stitch results mock without hiding anyone's team. */
function TeamCard({ team, index, isYou }) {
  const [open, setOpen] = useState(index === 0 || isYou);

  return (
    <motion.div
      className={`results-team-card ${isYou ? "you" : ""} ${index === 0 ? "leader" : ""} ${open ? "open" : ""}`}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1, type: "spring", stiffness: 260, damping: 24 }}
    >
      <div className="results-team-header">
        <span className="results-rank-chip">{RANK_LABELS[team.rank] || `#${team.rank}`}</span>
        <span className="results-team-name">
          {team.playerName}
          {isYou && <span className="results-you">(You)</span>}
          {team.forfeited && <span className="status-badge forfeited">Left the draft</span>}
        </span>
        <span className="results-score-block">
          <span className="results-final-score">{formatScore(team.finalScore)}</span>
          {open && (
            <span className="results-score-meta">
              Sum USG%: {formatPct(team.sumUsagePct)} · Synergy ×{team.synergyMultiplier.toFixed(2)}
            </span>
          )}
        </span>
      </div>

      {open ? (
        <>
          <div className="results-roster">
            {team.roster.map((p) => (
              <div key={p.slot} className="results-player-row">
                <div className="results-player-id">
                  <PlayerHeadshot
                    nbaPlayerId={p.nbaPlayerId}
                    photoUrl={p.photoUrl}
                    alt={p.fullName || p.slot}
                    className="results-headshot"
                  />
                  <div>
                    <div className="results-player-slot">{p.slot}</div>
                    <PlayerNameLink
                      nbaPlayerId={p.nbaPlayerId}
                      name={p.fullName || "—"}
                      className="results-player-name"
                    />
                  </div>
                </div>
                <div className="results-player-scores">
                  <span title="Offense Score">
                    <span className="lbl">Op</span>
                    {formatScore(p.op)}
                  </span>
                  <span title="Defensive Impact Rating">
                    <span className="lbl">DIR</span>
                    {formatScore(p.dir)}
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
          {team.forfeited && (
            <p className="hint-text results-forfeit-note">
              Scored on {team.filledSlots}/5 slots filled before they left.
            </p>
          )}
        </>
      ) : (
        <button type="button" className="results-expand" onClick={() => setOpen(true)}>
          Expand roster
        </button>
      )}
    </motion.div>
  );
}

/** Right-hand panel: "Rematch" confirmation checklist plus the room-exit
 *  actions. "Return to Lobby" stays host-only; "Rematch" needs everyone
 *  still around to confirm before it redeals. */
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
    <div className="rematch-panel">
      <p className="rematch-lead">Everyone still here needs to confirm before a new draft starts.</p>

      <ul className="rematch-vote-list">
        {activePlayers.map((p) => {
          const confirmed = rematchVotes.includes(p.id);
          return (
            <li key={p.id} className={confirmed ? "confirmed" : ""}>
              <span>
                {p.name}
                {p.id === currentPlayerId && <span className="you-badge">You</span>}
              </span>
              <span className="rematch-vote-mark" aria-hidden="true">
                {confirmed ? <CheckIcon /> : "···"}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="rematch-actions">
        <motion.button
          type="button"
          onClick={handleToggleRematch}
          className="primary-btn rematch-confirm"
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.98 }}
        >
          {iVoted ? "Cancel rematch vote" : "Confirm rematch"}
          <RefreshIcon />
        </motion.button>

        {isHost && (
          <button type="button" onClick={handleReturnToLobby} className="secondary-btn rematch-return">
            Return to lobby
          </button>
        )}
      </div>

      <div className="rematch-leave-row">
        <button type="button" onClick={onLeaveRoom} className="rematch-leave">
          Leave room
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
      <div className="results-screen">
        <h1 className="results-title">Draft complete</h1>
        <p className="error-text">
          Couldn't compute final scores (the stats service may be unreachable). Your rosters are still saved.
        </p>
        <PostGameActions room={room} currentPlayerId={currentPlayerId} socket={socket} onLeaveRoom={onLeaveRoom} />
      </div>
    );
  }

  if (resultsStatus !== "ready" || !results) {
    return (
      <div className="results-screen">
        <h1 className="results-title">Draft complete</h1>
        <div className="rolling-panel">
          <p className="hint-text">Computing final scores…</p>
          <div className="rolling-name">Crunching the numbers</div>
        </div>
      </div>
    );
  }

  return (
    <div className="results-screen">
      <h1 className="results-title">Final results</h1>

      <div className="results-grid">
        <div className="results-main">
          <div className="results-standings">
            {results.teams.map((team, index) => (
              <TeamCard key={team.id} team={team} index={index} isYou={team.id === currentPlayerId} />
            ))}
          </div>

          <section className="results-matchups-section">
            <h3 className="results-subtitle">Matchups</h3>
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
                    <span className={`matchup-side end ${!aFavored ? "favored" : ""}`}>
                      {teamB?.playerName} — {(m.probB * 100).toFixed(0)}%
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          <p className="hint-text results-footnote">
            * marks estimated USG%/defensive stats where the real figure isn't available for that player's era (see
            README for methodology).
          </p>
        </div>

        <div className="results-side">
          <PostGameActions room={room} currentPlayerId={currentPlayerId} socket={socket} onLeaveRoom={onLeaveRoom} />
        </div>
      </div>
    </div>
  );
}
