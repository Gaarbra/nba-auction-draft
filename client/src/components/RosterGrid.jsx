import { useState } from "react";
import PlayerHeadshot from "./PlayerHeadshot.jsx";
import CoinRow from "./CoinRow.jsx";
import PlayerStatusBadge from "./PlayerStatusBadge.jsx";
import { getTeamColors } from "../teamColors.js";

const POSITIONS = ["PG", "SG", "SF", "PF", "C"];

export default function RosterGrid({ room, currentPlayerId, socket }) {
  const [selectedSlot, setSelectedSlot] = useState(null);

  const canSwap = Boolean(room.allowPositionSwaps) && room.status === "drafting";

  function handleSlotClick(pos) {
    if (!canSwap) return;

    if (selectedSlot === null) {
      setSelectedSlot(pos);
      return;
    }
    if (selectedSlot === pos) {
      setSelectedSlot(null);
      return;
    }

    socket.emit("draft:swap-positions", { slotA: selectedSlot, slotB: pos }, () => {});
    setSelectedSlot(null);
  }

  return (
    <div className="roster-grid">
      {room.players.map((player) => {
        const roster = room.draft?.rosters?.[player.id] || {};
        const isMine = player.id === currentPlayerId;
        return (
          <div key={player.id} className={`roster-card ${isMine ? "you" : ""} ${player.forfeited ? "forfeited" : ""}`}>
            <div className="roster-card-header">
              <span className="player-name">
                {player.name}
                {player.isHost && <span className="host-badge">Host</span>}
                {isMine && <span className="you-badge">You</span>}
                <PlayerStatusBadge player={player} reconnectGraceMs={room.reconnectGraceMs} />
              </span>
            </div>
            <CoinRow budget={player.budget} />
            <div className="roster-slots">
              {POSITIONS.map((pos) => {
                const occupant = roster[pos];
                const interactive = isMine && canSwap;
                const colors = occupant ? getTeamColors(occupant.team?.abbreviation) : null;
                return (
                  <button
                    key={pos}
                    type="button"
                    disabled={!interactive}
                    onClick={() => handleSlotClick(pos)}
                    className={[
                      "roster-slot",
                      occupant ? "filled" : "open",
                      interactive ? "interactive" : "",
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
                      {occupant ? (
                        <PlayerHeadshot
                          nbaPlayerId={occupant.nbaPlayerId}
                          alt={occupant.fullName}
                          className="roster-slot-headshot"
                        />
                      ) : (
                        <span className="roster-slot-empty-icon" aria-hidden="true" />
                      )}
                    </div>
                    <span className="slot-label">{pos}</span>
                    {occupant && <span className="slot-cost">{occupant.acquiredFor}c</span>}
                    {occupant && (
                      <div className="slot-tooltip">
                        <span className="slot-tooltip-name">{occupant.fullName}</span>
                        <span className="slot-tooltip-meta">
                          {occupant.team?.abbreviation || "Free Agent"}
                          {occupant.position ? ` · ${occupant.position}` : ""}
                        </span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
