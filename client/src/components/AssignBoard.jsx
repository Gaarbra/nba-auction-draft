import { motion } from "motion/react";
import PlayerHeadshot from "./PlayerHeadshot.jsx";
import PlayerNameLink from "./PlayerNameLink.jsx";
import StatHighlightRow from "./StatHighlightRow.jsx";
import StatRadarChart from "./StatRadarChart.jsx";
import { getTeamColors } from "../teamColors.js";

/* The focused "you won a player — now place them" screen, matching the
   Stitch "Assign Player to Roster Slot" mock: a hero banner for the won
   player, then this player's own five roster slots as large cards. It
   replaces the multi-roster grid only for this brief moment. */

const POSITIONS = ["PG", "SG", "SF", "PF", "C"];
const POS_NAMES = { PG: "Point Guard", SG: "Shooting Guard", SF: "Small Forward", PF: "Power Forward", C: "Center" };
const SLOT_GROUP = { PG: "G", SG: "G", SF: "F", PF: "F", C: "C" };

function positionMatchesSlot(playerPosition, slot) {
  // No listed position -> no slot is "recommended" (don't flag all five
  // amber for a player we have no positional signal for).
  if (!playerPosition) return false;
  return playerPosition.toUpperCase().includes(SLOT_GROUP[slot]);
}

export default function AssignBoard({
  ownerName,
  roster,
  budget,
  nomination,
  nominatedByName,
  pendingAssignment,
  assignError,
  onPickPosition,
  onConfirmPending,
  onCancelPending,
}) {
  const player = nomination.player;
  const cost = nomination.currentBid;
  const filledCount = POSITIONS.filter((pos) => roster[pos]).length;
  const stats = player.stats;
  const hasStats = stats && !stats.unavailable;
  const seasonRange =
    hasStats && stats.firstSeason === stats.lastSeason
      ? stats.firstSeason
      : hasStats
        ? `${stats.firstSeason}–${stats.lastSeason}`
        : null;
  const teamColor = getTeamColors(player.team?.abbreviation).primary;

  return (
    <div className="assign-screen">
      {/* ---- Won-player hero banner ---- */}
      <section className="won-banner">
        <div className="won-banner-main">
          <div className="won-banner-avatar">
            <PlayerHeadshot
              nbaPlayerId={player.nbaPlayerId}
              photoUrl={player.stats?.photoUrl}
              alt={player.fullName}
              className="won-banner-headshot"
            />
            <span className="won-banner-chip">Won</span>
          </div>

          <div className="won-banner-bio">
            <div className="won-banner-namerow">
              <h2 className="won-banner-name">
                <PlayerNameLink nbaPlayerId={player.nbaPlayerId} name={player.fullName} />
              </h2>
              {player.position && <span className="won-banner-pos">{player.position}</span>}
            </div>
            <p className="won-banner-meta">
              {player.isActive ? "Currently" : "Played for"}{" "}
              <span className="won-banner-meta-strong">{player.team?.abbreviation || "Free Agent"}</span> ·{" "}
              {player.draftYear ? `Drafted ${player.draftYear}` : "Undrafted"}
            </p>
            <p className="won-banner-sub">
              {stats?.unavailable ? "Stats unavailable for this player." : null}
              {stats?.unavailable ? <span className="won-banner-dot">•</span> : null}
              Nominated by <span className="won-banner-meta-strong">{nominatedByName || "a rival"}</span>
            </p>

            {hasStats && (
              <>
                <p className="won-banner-season">
                  Career avg, {stats.seasonsPlayed} season{stats.seasonsPlayed === 1 ? "" : "s"} · {seasonRange}
                </p>
                <StatHighlightRow stats={stats} />
              </>
            )}
          </div>
        </div>

        <div className="won-banner-aside">
          <div className="won-banner-bid">
            <span className="won-banner-bid-label">Winning bid</span>
            <div className="won-banner-bid-value">
              <span className="won-banner-bid-num">{cost}</span>
              <span className="won-banner-bid-unit">
                <span className="won-banner-bid-coin">{cost === 1 ? "Coin" : "Coins"}</span>
                <span className="won-banner-bid-tier">Standard pick</span>
              </span>
            </div>
          </div>
          {hasStats && <StatRadarChart stats={stats} color={teamColor} />}
        </div>

        <div className="won-banner-prompt">
          <span className="won-banner-prompt-icon" aria-hidden="true">
            ↓
          </span>
          <p>
            You won <strong>{player.fullName}</strong> for{" "}
            <span className="won-banner-prompt-cost">
              {cost} {cost === 1 ? "coin" : "coins"}
            </span>{" "}
            — pick an open slot below to add them.
          </p>
        </div>
      </section>

      {/* ---- Roster slot board ---- */}
      <section className="assign-board">
        <div className="assign-board-head">
          <div>
            <div className="assign-board-title">
              <span className="assign-board-dot" aria-hidden="true" />
              <h3>{ownerName}'s roster</h3>
              <span className="assign-board-count">({filledCount}/5 filled)</span>
            </div>
            <p className="assign-board-subtitle">Pick a position slot to place your new acquisition</p>
          </div>
          <div className="assign-board-progress">
            <div className="assign-board-segments">
              {POSITIONS.map((pos) => (
                <span
                  key={pos}
                  className={`assign-board-segment ${roster[pos] ? "filled" : "open"}`}
                  title={`${pos} — ${roster[pos] ? "filled" : "open"}`}
                />
              ))}
            </div>
            <span className="assign-board-left">{budget}c left</span>
          </div>
        </div>

        <div className="assign-slots">
          {POSITIONS.map((pos) => {
            const occupant = roster[pos];
            const recommended = !occupant && positionMatchesSlot(player.position, pos);

            if (occupant) {
              return (
                <div key={pos} className="assign-slot filled">
                  <div className="assign-slot-head">
                    <span className="assign-slot-pos">{pos}</span>
                    <span className="assign-slot-status done">Filled</span>
                  </div>
                  <div className="assign-slot-body">
                    <div className="assign-slot-avatar">
                      <PlayerHeadshot
                        nbaPlayerId={occupant.nbaPlayerId}
                        photoUrl={occupant.stats?.photoUrl}
                        alt={occupant.fullName}
                        className="assign-slot-headshot"
                      />
                      <span className="assign-slot-cost">{occupant.acquiredFor}c</span>
                    </div>
                    <span className="assign-slot-name">{occupant.fullName}</span>
                    <span className="assign-slot-sub">Acquired for {occupant.acquiredFor}c</span>
                  </div>
                  <div className="assign-slot-foot">
                    <span>Roster lock</span>
                    <span className="assign-slot-foot-strong">Starter</span>
                  </div>
                </div>
              );
            }

            return (
              <motion.button
                key={pos}
                type="button"
                className={`assign-slot open ${recommended ? "recommended" : ""}`}
                onClick={() => onPickPosition(pos)}
                whileHover={{ scale: 1.015 }}
                whileTap={{ scale: 0.98 }}
              >
                {recommended && <span className="assign-slot-badge">Assign here</span>}
                <div className="assign-slot-head">
                  <span className={`assign-slot-pos ${recommended ? "hot" : ""}`}>{pos}</span>
                  <span className={`assign-slot-status ${recommended ? "hot" : ""}`}>
                    {recommended ? "Open slot" : "Available"}
                  </span>
                </div>
                <div className="assign-slot-body">
                  <div className={`assign-slot-placeholder ${recommended ? "hot" : ""}`}>
                    {recommended ? "+" : pos}
                  </div>
                  <span className="assign-slot-name">
                    {recommended ? `Assign ${player.fullName}` : POS_NAMES[pos]}
                  </span>
                  <span className="assign-slot-sub">
                    {recommended ? `Tap to place in ${pos}` : "Tap to assign here"}
                  </span>
                </div>
                <span className={`assign-slot-btn ${recommended ? "hot" : ""}`}>
                  {recommended ? "Confirm slot" : "Select slot"}
                </span>
              </motion.button>
            );
          })}
        </div>

        {pendingAssignment && (
          <div className="budget-warning">
            {pendingAssignment.positionMismatch && (
              <p>
                Put <strong>{player.fullName}</strong> in <strong>{pendingAssignment.position}</strong>? Their listed
                position is {player.position || "unknown"}.
              </p>
            )}
            {pendingAssignment.budgetTight && (
              <p>
                Locking this in leaves you {budget - cost} coins for the rest of your slots — that's tight, you'll want
                at least 1 per slot.
              </p>
            )}
            <button type="button" onClick={() => onConfirmPending(pendingAssignment.position)} className="primary-btn">
              Lock in {pendingAssignment.position} anyway
            </button>
            <button type="button" onClick={onCancelPending} className="secondary-btn">
              Cancel
            </button>
          </div>
        )}

        {assignError && <p className="error-text">{assignError}</p>}
      </section>
    </div>
  );
}
