import { useState } from "react";
import PlayerHeadshot from "./PlayerHeadshot.jsx";
import CoinRow from "./CoinRow.jsx";

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
          <div key={player.id} className={`roster-card ${isMine ? "you" : ""}`}>
            <div className="roster-card-header">
              <span className="player-name">
                {player.name}
                {player.isHost && <span className="host-badge">Host</span>}
                {isMine && <span className="you-badge">You</span>}
              </span>
            </div>
            <CoinRow budget={player.budget} />
            <div className="roster-slots">
              {POSITIONS.map((pos) => {
                const occupant = roster[pos];
                const interactive = isMine && canSwap;
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
                    title={occupant ? occupant.fullName : undefined}
                  >
                    {occupant ? (
                      <PlayerHeadshot
                        nbaPlayerId={occupant.nbaPlayerId}
                        alt={occupant.fullName}
                        className="roster-slot-headshot"
                      />
                    ) : (
                      <span className="roster-slot-empty-icon" aria-hidden="true" />
                    )}
                    <span className="slot-label">{pos}</span>
                    {occupant && <span className="slot-cost">{occupant.acquiredFor}c</span>}
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
