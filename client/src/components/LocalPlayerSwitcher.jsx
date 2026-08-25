// Pass-and-play control strip: lets whoever's holding the device declare
// which local player they're acting as right now. App.jsx auto-advances
// this when it's unambiguous (someone's turn to nominate or assign), but
// bidding needs a manual switch since any local player with open roster
// slots might be the one who wants to act next.
export default function LocalPlayerSwitcher({ room, currentPlayerId, onSwitch }) {
  return (
    <div className="local-switcher">
      <span className="local-switcher-label">Acting as</span>
      <div className="local-switcher-tabs">
        {room.players.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`local-switcher-tab ${p.id === currentPlayerId ? "active" : ""}`}
            onClick={() => onSwitch(p.id)}
          >
            {p.name}
          </button>
        ))}
      </div>
    </div>
  );
}
