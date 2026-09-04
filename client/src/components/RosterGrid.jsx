import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import PlayerHeadshot from "./PlayerHeadshot.jsx";
import PlayerNameLink from "./PlayerNameLink.jsx";
import CoinRow from "./CoinRow.jsx";
import PlayerStatusBadge from "./PlayerStatusBadge.jsx";
import { KickButton } from "./VoteKick.jsx";
import { getTeamColors } from "../teamColors.js";

const POSITIONS = ["PG", "SG", "SF", "PF", "C"];

function formatStat(value) {
  return value === null || value === undefined ? "N/A" : value;
}

export default function RosterGrid({
  room,
  currentPlayerId,
  socket,
  nominatingId,
  floatingByPlayer = {},
  assigningSlot = false,
  onAssignSlot,
}) {
  const [selectedSlot, setSelectedSlot] = useState(null);

  const canSwap = Boolean(room.allowPositionSwaps) && room.status === "drafting";

  // Right after winning a bid, the open slot the player taps IS the pick —
  // no separate row of position buttons duplicating the same five labels
  // already shown here. Swapping (after the roster's built out) stays a
  // distinct flow below; the two never overlap in practice.
  function handleSlotClick(pos, isMine, occupant) {
    if (isMine && assigningSlot && !occupant) {
      onAssignSlot?.(pos);
      return;
    }

    if (!canSwap) return;

    if (selectedSlot === null) {
      setSelectedSlot(pos);
      return;
    }
    if (selectedSlot === pos) {
      setSelectedSlot(null);
      return;
    }

    socket.emit("draft:swap-positions", { slotA: selectedSlot, slotB: pos, playerId: currentPlayerId }, () => {});
    setSelectedSlot(null);
  }

  return (
    <div className="roster-grid">
      {room.players.map((player) => {
        const roster = room.draft?.rosters?.[player.id] || {};
        const isMine = player.id === currentPlayerId;
        const floating = floatingByPlayer[player.id];
        return (
          <div key={player.id} className={`roster-card ${isMine ? "you" : ""} ${player.forfeited ? "forfeited" : ""}`}>
            <AnimatePresence>
              {floating && (
                <motion.div
                  key={floating.id}
                  className={`floating-bubble floating-bubble-${floating.kind}`}
                  initial={{ opacity: 0, y: 6, scale: 0.7 }}
                  animate={{ opacity: 1, y: -6, scale: 1 }}
                  exit={{ opacity: 0, y: -16, scale: 0.85 }}
                  transition={{ type: "spring", stiffness: 400, damping: 22 }}
                >
                  {floating.kind === "reaction" ? (
                    <span className="floating-bubble-emoji">{floating.content}</span>
                  ) : (
                    <span className="floating-bubble-text">{floating.content}</span>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
            <div className="roster-card-header">
              <span className="player-name">
                {player.name}
                {player.isHost && <span className="host-badge">Host</span>}
                {isMine && <span className="you-badge">You</span>}
                {player.id === nominatingId && <span className="nominating-badge">Nominating</span>}
                <PlayerStatusBadge player={player} reconnectGraceMs={room.reconnectGraceMs} />
              </span>
              {!player.forfeited && (
                <KickButton room={room} currentPlayerId={currentPlayerId} socket={socket} targetPlayerId={player.id} />
              )}
            </div>
            <CoinRow budget={player.budget} />
            <div className="roster-slots">
              {POSITIONS.map((pos) => {
                const occupant = roster[pos];
                const assignable = isMine && assigningSlot && !occupant;
                const interactive = assignable || (isMine && canSwap);
                const colors = occupant ? getTeamColors(occupant.team?.abbreviation) : null;
                // A plain div, not a <button> — the hover tooltip nests a
                // real <a> (the NBA.com stats link) inside it, and a link
                // inside a <button> is invalid HTML that browsers handle
                // inconsistently. role/tabIndex/onKeyDown restore the
                // button-like keyboard behavior whenever a tap here does
                // something (assigning a fresh pick, or swapping later).
                return (
                  <div
                    key={pos}
                    role={interactive ? "button" : undefined}
                    tabIndex={interactive ? 0 : undefined}
                    aria-label={assignable ? `Add to ${pos}` : undefined}
                    onClick={() => handleSlotClick(pos, isMine, occupant)}
                    onKeyDown={(e) => {
                      if (!interactive) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleSlotClick(pos, isMine, occupant);
                      }
                    }}
                    className={[
                      "roster-slot",
                      occupant ? "filled" : "open",
                      interactive ? "interactive" : "",
                      assignable ? "assignable" : "",
                      selectedSlot === pos ? "selected" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    style={
                      colors
                        ? { "--team-primary": colors.primary, "--team-secondary": colors.secondary }
                        : undefined
                    }
                  >
                    <div className="roster-slot-media">
                      <AnimatePresence>
                        {occupant ? (
                          <motion.div
                            key={occupant.nbaPlayerId ?? occupant.fullName}
                            initial={{ opacity: 0, scale: 0.4 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ type: "spring", stiffness: 300, damping: 18 }}
                            style={{ width: "100%", height: "100%" }}
                          >
                            <PlayerHeadshot
                              nbaPlayerId={occupant.nbaPlayerId}
                              photoUrl={occupant.stats?.photoUrl}
                              alt={occupant.fullName}
                              className="roster-slot-headshot"
                            />
                          </motion.div>
                        ) : (
                          <span className="roster-slot-empty-icon" aria-hidden="true" />
                        )}
                      </AnimatePresence>
                    </div>
                    <span className="slot-label">{pos}</span>
                    {occupant && <span className="slot-cost">{occupant.acquiredFor}c</span>}
                    {occupant && (
                      <div className="slot-tooltip">
                        <span className="slot-tooltip-name">
                          <PlayerNameLink nbaPlayerId={occupant.nbaPlayerId} name={occupant.fullName} />
                        </span>
                        <span className="slot-tooltip-meta">
                          {occupant.team?.abbreviation || "Free Agent"}
                          {occupant.position ? ` · ${occupant.position}` : ""}
                          {occupant.acquiredFor != null ? ` · ${occupant.acquiredFor}c` : ""}
                        </span>
                        {occupant.stats && !occupant.stats.unavailable && (
                          <span className="slot-tooltip-stats">
                            {formatStat(occupant.stats.pointsPerGame)} PTS ·{" "}
                            {formatStat(occupant.stats.reboundsPerGame)} REB ·{" "}
                            {formatStat(occupant.stats.assistsPerGame)} AST ·{" "}
                            {formatStat(occupant.stats.stealsPerGame)} STL ·{" "}
                            {formatStat(occupant.stats.blocksPerGame)} BLK
                          </span>
                        )}
                        {occupant.teamHistory?.length > 1 && (
                          <span className="slot-tooltip-teams">
                            Teams: {occupant.teamHistory.map((t) => t.abbreviation).join(", ")}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
