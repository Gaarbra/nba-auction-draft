import PlayerHeadshot from "./PlayerHeadshot.jsx";

const RANK_LABELS = { 1: "1ST", 2: "2ND", 3: "3RD", 4: "4TH" };

function formatPct(value) {
  return `${value.toFixed(1)}%`;
}

function formatScore(value) {
  return value.toFixed(1);
}

export default function ResultsScreen({ room, currentPlayerId, onLeaveRoom }) {
  const { resultsStatus, results } = room;

  if (resultsStatus === "failed") {
    return (
      <div className="draft-board">
        <div className="draft-header">
          <h2>Draft Complete</h2>
          <button type="button" onClick={onLeaveRoom} className="secondary-btn">
            Leave Room
          </button>
        </div>
        <p className="error-text">
          Couldn't compute final scores (the stats service may be unreachable). Your rosters are still saved below.
        </p>
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
        <button type="button" onClick={onLeaveRoom} className="secondary-btn">
          Leave Room
        </button>
      </div>

      <div className="results-standings">
        {results.teams.map((team) => (
          <div key={team.id} className={`results-team-card ${team.id === currentPlayerId ? "you" : ""}`}>
            <div className="results-team-header">
              <span className="results-rank">{RANK_LABELS[team.rank] || `#${team.rank}`}</span>
              <span className="results-team-name">
                {team.playerName}
                {team.id === currentPlayerId && <span className="you-badge">You</span>}
              </span>
              <span className="results-final-score">{formatScore(team.finalScore)}</span>
            </div>

            <p className="hint-text">
              Sum USG%: {formatPct(team.sumUsagePct)} · Synergy ×{team.synergyMultiplier.toFixed(2)}
            </p>

            <div className="results-roster">
              {team.roster.map((p) => (
                <div key={p.slot} className="results-player-row">
                  <PlayerHeadshot nbaPlayerId={p.nbaPlayerId} alt={p.fullName || p.slot} className="results-headshot" />
                  <div className="results-player-info">
                    <span className="slot-label">{p.slot}</span>
                    <span className="results-player-name" title={p.fullName || undefined}>
                      {p.fullName || "—"}
                    </span>
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
          </div>
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
    </div>
  );
}
