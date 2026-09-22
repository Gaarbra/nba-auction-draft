import { useEffect, useRef, useState } from "react";
import StatHighlightRow from "./StatHighlightRow.jsx";
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
  hideCost = false,
  onlyPlayerId = null,
}) {
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [inspected, setInspected] = useState(null);
  const [drag, setDrag] = useState(null);
  const [moveMessage, setMoveMessage] = useState("");
  const [moving, setMoving] = useState(false);
  const pointer = useRef(null);
  const suppressClick = useRef(false);
  const movePending = useRef(false);

  useEffect(() => {
    setSelectedSlot(null);
    setInspected(null);
    setDrag(null);
    pointer.current = null;
  }, [currentPlayerId, assigningSlot, room.status, room.allowPositionSwaps]);

  const canSwap = Boolean(room.allowPositionSwaps) && room.status === "drafting";
  const players = onlyPlayerId ? room.players.filter((p) => p.id === onlyPlayerId) : room.players;

  function movePlayer(from, to) {
    if (!canSwap || assigningSlot || movePending.current || from === to) return;
    if (!room.draft?.rosters?.[currentPlayerId]?.[from]) return;
    movePending.current = true;
    setMoving(true);
    setSelectedSlot(null);
    setMoveMessage("Moving player...");
    socket.timeout(5000).emit("draft:swap-positions", {
      slotA: from, slotB: to, playerId: currentPlayerId,
    }, (error, response) => {
      movePending.current = false;
      setMoving(false);
      if (error || response?.error) {
        setMoveMessage("Move not confirmed. Check your roster and connection before trying again.");
      } else {
        setInspected({ playerId: currentPlayerId, pos: to });
        setMoveMessage(`Moved ${from} to ${to}. Players exchange positions if both slots are filled.`);
      }
    });
  }

  function handleSlotClick(pos, playerId, occupant) {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    const isMine = playerId === currentPlayerId;
    if (isMine && assigningSlot && !occupant) {
      if (selectedSlot === pos) {
        setSelectedSlot(null);
        onAssignSlot?.(pos);
      } else setSelectedSlot(pos);
      return;
    }
    if (isMine && canSwap && !assigningSlot && selectedSlot) {
      if (selectedSlot === pos) setSelectedSlot(null);
      else movePlayer(selectedSlot, pos);
      return;
    }
    if (occupant) setInspected({ playerId, pos });
  }

  function startDrag(event, pos, occupant, isMine) {
    if (!isMine || !canSwap || assigningSlot || moving || !occupant || !event.isPrimary || event.button !== 0) return;
    if (event.target.closest("a, button")) return;
    suppressClick.current = false;
    pointer.current = { id: event.pointerId, pos, occupant, x: event.clientX, y: event.clientY, active: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function dragTarget(event) {
    const slot = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-roster-position]");
    return slot?.dataset.rosterOwner === currentPlayerId ? slot.dataset.rosterPosition : null;
  }

  function updateDrag(event) {
    const held = pointer.current;
    if (!held || held.id !== event.pointerId) return;
    if (!held.active && Math.hypot(event.clientX - held.x, event.clientY - held.y) < 8) return;
    held.active = true;
    suppressClick.current = true;
    setDrag({ ...held, x: event.clientX, y: event.clientY, target: dragTarget(event) });
  }

  function endDrag(event, cancelled = false) {
    const held = pointer.current;
    if (!held || held.id !== event.pointerId) return;
    const target = !cancelled && held.active ? dragTarget(event) : null;
    pointer.current = null;
    setDrag(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (target && target !== held.pos) movePlayer(held.pos, target);
  }

  return (
    <div className="roster-grid" onKeyDown={(event) => {
      if (event.key === "Escape") {
        pointer.current = null;
        setDrag(null);
        setSelectedSlot(null);
      }
    }}>
      <p className="roster-move-status" role="status">{moveMessage}</p>
      {drag && (
        <div className="roster-drag-preview" aria-hidden="true" style={{ left: drag.x, top: drag.y }}>
          <PlayerHeadshot nbaPlayerId={drag.occupant.nbaPlayerId} photoUrl={drag.occupant.stats?.photoUrl} alt="" />
          <span>{drag.target && drag.target !== drag.pos ? `Drop at ${drag.target}` : "Drag to a position"}</span>
        </div>
      )}
      {canSwap && !assigningSlot && (
        <p className="roster-grid-swap-hint">Drag a player to a position. Drop on another player to swap. Tap a player to see stats.</p>
      )}
      {players.map((player) => {
        const roster = room.draft?.rosters?.[player.id] || {};
        const isMine = player.id === currentPlayerId;
        const floating = floatingByPlayer[player.id];
        const inspectedPlayer = inspected?.playerId === player.id ? roster[inspected.pos] : null;
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
                const armed = assignable && selectedSlot === pos;
                const interactive = assignable || Boolean(occupant) || (isMine && canSwap && !assigningSlot);
                const draggable = isMine && canSwap && !assigningSlot && Boolean(occupant) && !moving;
                const colors = occupant ? getTeamColors(occupant.team?.abbreviation) : null;
                // A plain div, not a <button>. The hover tooltip nests a
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
                    aria-label={armed ? `Tap again to confirm ${pos}` : assignable ? `Add to ${pos}` : `${pos}: ${occupant?.fullName || "Empty"}${selectedSlot && isMine && !assigningSlot ? ", move here" : occupant ? ", show stats" : ""}`}
                    data-roster-owner={player.id}
                    data-roster-position={pos}
                    onPointerDown={(event) => startDrag(event, pos, occupant, isMine)}
                    onPointerMove={updateDrag}
                    onPointerUp={endDrag}
                    onPointerCancel={(event) => endDrag(event, true)}
                    onLostPointerCapture={(event) => endDrag(event, true)}
                    onDragStart={(event) => event.preventDefault()}
                    onClick={(event) => { if (!event.target.closest("a")) handleSlotClick(pos, player.id, occupant); }}
                    onKeyDown={(e) => {
                      if (!interactive || e.target.closest("a")) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleSlotClick(pos, player.id, occupant);
                      }
                    }}
                    className={[
                      "roster-slot",
                      draggable ? "draggable" : "",
                      drag?.target === pos && isMine && drag.pos !== pos ? "drop-target" : "",
                      occupant ? "filled" : "open",
                      interactive ? "interactive" : "",
                      assignable ? "assignable" : "",
                      armed ? "armed" : "",
                      isMine && !assignable && selectedSlot === pos ? "selected" : "",
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
                    {armed && <span className="slot-armed-hint">Tap again</span>}
                    {/* Solo prices every pick the same flat amount -- a cost
                        tag that never varies isn't telling you anything, so
                        it's dropped rather than repeated five times over. */}
                    {occupant && !hideCost && <span className="slot-cost">{occupant.acquiredFor}c</span>}
                    {occupant && (
                      <div className="slot-tooltip">
                        <span className="slot-tooltip-name">
                          <PlayerNameLink nbaPlayerId={occupant.nbaPlayerId} name={occupant.fullName} />
                        </span>
                        <span className="slot-tooltip-meta">
                          {occupant.team?.abbreviation || "Free Agent"}
                          {occupant.position ? ` · ${occupant.position}` : ""}
                          {!hideCost && occupant.acquiredFor != null ? ` · ${occupant.acquiredFor}c` : ""}
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
            {inspectedPlayer && (
              <section className="roster-player-details" aria-label={`${inspectedPlayer.fullName} stats`}>
                <div className="roster-details-heading">
                  <strong>{inspectedPlayer.fullName}</strong>
                  <button type="button" className="secondary-btn" onClick={() => { setInspected(null); setSelectedSlot(null); }}>Close</button>
                </div>
                <p className="hint-text">{inspected.pos} · Listed position: {inspectedPlayer.position || "Unknown"} · Career averages</p>
                {inspectedPlayer.stats && !inspectedPlayer.stats.unavailable
                  ? <StatHighlightRow stats={inspectedPlayer.stats} />
                  : <p className="hint-text">Stats unavailable for this player.</p>}
                {isMine && canSwap && !assigningSlot && (
                  <button type="button" className="secondary-btn" disabled={moving} onClick={() => setSelectedSlot(selectedSlot ? null : inspected.pos)}>
                    {selectedSlot ? "Cancel move" : "Move player"}
                  </button>
                )}
                {isMine && selectedSlot && !assigningSlot && <p role="status" className="hint-text">Choose a position in the row above. An occupied position swaps both players.</p>}
              </section>
            )}
          </div>
        );
      })}
    </div>
  );
}
