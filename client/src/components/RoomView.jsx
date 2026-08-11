const MAX_PLAYERS = 4;

export default function RoomView({ room, currentPlayerId, onLeaveRoom }) {
  const emptySlots = MAX_PLAYERS - room.players.length;

  function copyInviteLink() {
    const url = `${window.location.origin}${window.location.pathname}?room=${room.code}`;
    navigator.clipboard?.writeText(url);
  }

  return (
    <div className="room-card">
      <div className="room-header">
        <div>
          <h2>Room Code</h2>
          <p className="room-code">{room.code}</p>
        </div>
        <button type="button" onClick={copyInviteLink} className="secondary-btn">
          Copy Invite Link
        </button>
      </div>

      <h3>
        Players ({room.players.length}/{MAX_PLAYERS})
      </h3>
      <ul className="player-list">
        {room.players.map((p) => (
          <li key={p.id} className={p.id === currentPlayerId ? "you" : ""}>
            <span className="player-name">
              {p.name}
              {p.isHost && <span className="host-badge">Host</span>}
              {p.id === currentPlayerId && <span className="you-badge">You</span>}
            </span>
            <span className="player-budget">{p.budget} coins</span>
          </li>
        ))}
        {Array.from({ length: emptySlots }).map((_, i) => (
          <li key={`empty-${i}`} className="empty-slot">
            Waiting for player…
          </li>
        ))}
      </ul>

      <p className="hint-text">
        {room.players.length < MAX_PLAYERS
          ? "Waiting for more players to join before the draft can start."
          : "Room is full. Draft setup coming soon."}
      </p>

      <button type="button" onClick={onLeaveRoom} className="leave-btn">
        Leave Room
      </button>
    </div>
  );
}
