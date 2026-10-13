import { useEffect, useState } from "react";
import { motion } from "motion/react";
import PlayerStatusBadge from "./PlayerStatusBadge.jsx";
import VoteKickBanner, { KickButton } from "./VoteKick.jsx";
import Dropdown from "./Dropdown.jsx";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:4000";

const DIFFICULTIES = [
  { id: "veryeasy", label: "Superstars", hint: "MVPs, perennial All-NBA, and elite scorers only" },
  { id: "easy", label: "Easy", hint: "Stars come up often" },
  { id: "normal", label: "Normal", hint: "A healthy mix" },
  { id: "hard", label: "Hard", hint: "True random draw" },
];

const BIDDING_MODES = [
  { id: "open", label: "Open", hint: "First come, first served, anyone can raise or pass anytime" },
  { id: "orderly", label: "Orderly", hint: "One at a time, in turn order, wait your turn to raise or pass" },
];

const GAME_MODES = [
  { value: "classic", label: "Classic · career stats" },
  { value: "active-now", label: "Active Now · season stats" },
  { value: "peak", label: "Peak Season · best season stats" },
];

// Mirrors MAX_PLAYERS on the server (roomStore.js). Counts below the people
// already in the room are filtered out at render time, not disabled.
const PLAYER_LIMIT_OPTIONS = [2, 3, 4, 5, 6, 7, 8];

function getHintText(playerCount, isHost, isLocal, maxPlayers) {
  if (isLocal) {
    return isHost ? "Everyone's added. Start whenever you're ready." : "Waiting for the host to start.";
  }
  if (playerCount === 1) {
    return isHost
      ? "Playing solo. Start whenever you're ready. You'll draft a full roster and get a score at the end."
      : "Waiting for the host to start.";
  }
  if (playerCount === maxPlayers) {
    return isHost ? "Room is full. Ready to start!" : "Room is full. Waiting for the host to start.";
  }
  return isHost
    ? `You can start now with ${playerCount} players, or wait for up to ${maxPlayers}.`
    : "Waiting for the host to start (or for more players to join).";
}

export default function RoomView({ room, currentPlayerId, socket, onLeaveRoom, onStartDraft }) {
  const [gameMode, setGameMode] = useState("classic");
  const maxPlayers = room.maxPlayers ?? 8;
  const [limitError, setLimitError] = useState("");
  const currentPlayer = room.players.find((p) => p.id === currentPlayerId);
  const isHost = Boolean(currentPlayer?.isHost);

  const [eras, setEras] = useState([]);
  const [era, setEra] = useState("all");
  const [difficulty, setDifficulty] = useState("normal");
  const [biddingMode, setBiddingMode] = useState("open");
  const [allowPositionSwaps, setAllowPositionSwaps] = useState(true);

  useEffect(() => {
    if (!isHost) return;
    fetch(`${SERVER_URL}/api/players/eras`)
      .then((res) => res.json())
      .then((data) => setEras(data.eras || []))
      .catch(() => setEras([]));
  }, [isHost]);

  const [codeCopied, setCodeCopied] = useState(false);

  function copyInviteLink() {
    const url = `${window.location.origin}${window.location.pathname}?room=${room.code}`;
    navigator.clipboard?.writeText(url);
  }

  function copyRoomCode() {
    navigator.clipboard?.writeText(room.code);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 1500);
  }

  return (
    <div className="room-card">
      <div className="room-header">
        <div>
          <h2>
            {room.isLocal ? "Local Game" : "Room Code"}
            {!room.isLocal && (
              <span className={`visibility-chip ${room.visibility}`}>
                {room.visibility === "public" ? "Public" : "Private"}
              </span>
            )}
          </h2>
          {room.isLocal ? (
            <span className="room-code local">Pass &amp; Play</span>
          ) : (
            <button type="button" onClick={copyRoomCode} className="room-code-btn" title="Copy code">
              <span className="room-code">{room.code}</span>
              <span className="room-code-copy-hint">{codeCopied ? "Copied!" : "Click to copy"}</span>
            </button>
          )}
        </div>
        {!room.isLocal && !room.isSolo && (
          <button type="button" onClick={copyInviteLink} className="secondary-btn">
            Copy Invite Link
          </button>
        )}
      </div>

      {!room.isLocal && !room.isSolo && <VoteKickBanner room={room} currentPlayerId={currentPlayerId} socket={socket} />}

      <h3>
        Players ({room.players.length}/{maxPlayers})
      </h3>
      <ul className="lobby-players" aria-label="Players in the lobby" aria-live="polite" aria-relevant="additions removals">
        {room.players.map((p) => {
          const name = <span className="player-name">
              <span className="lobby-player-name">{p.name}</span>
              {p.isHost && <span className="host-badge">Host</span>}
              {p.id === currentPlayerId && <span className="you-badge">You</span>}
              <PlayerStatusBadge player={p} reconnectGraceMs={room.reconnectGraceMs} />
            </span>;
          return <li key={p.id} className={p.id === currentPlayerId ? "you" : ""}>
            {isHost && !room.isLocal && !room.isSolo && p.id !== currentPlayerId && !room.voteKick ? (
              <details className="lobby-player-menu" name="lobby-player-actions">
                <summary aria-label={`Manage ${p.name}`} title={`Manage ${p.name}`}>{name}</summary>
                <div className="lobby-player-actions">
                  <KickButton room={room} currentPlayerId={currentPlayerId} socket={socket} targetPlayerId={p.id} />
                </div>
              </details>
            ) : name}
          </li>;
        })}
      </ul>

      <p className="hint-text">{getHintText(room.players.length, isHost, room.isLocal, maxPlayers)}</p>

      {isHost && (
        <div className="room-settings">
          {!room.isSolo && !room.isLocal && <div className="era-picker-label">
            Player limit
            <Dropdown
              label="Player limit"
              value={maxPlayers}
              onChange={(value) => {
                setLimitError("");
                socket.emit("room:set-player-limit", { maxPlayers: Number(value) }, (response) => {
                  if (response?.error) setLimitError(response.error === "PLAYER_LIMIT_TOO_SMALL" ? "The limit cannot be smaller than the number of players already here." : "Could not change the player limit. Try again.");
                });
              }}
              options={PLAYER_LIMIT_OPTIONS.filter((count) => count >= room.players.length).map((count) => ({ value: count, label: `${count} players` }))}
            />
          </div>}
          {limitError && <p className="error-text" role="alert">{limitError}</p>}
          <div className="era-picker-label">
            Game mode
            <Dropdown label="Game mode" value={gameMode} onChange={setGameMode} options={GAME_MODES} />
          </div>
          <div className="era-picker-label" hidden={gameMode === "active-now"}>
            Player pool for this draft
            <Dropdown
              label="Player pool for this draft"
              className="era-picker"
              value={era}
              onChange={setEra}
              options={
                eras.length === 0
                  ? [{ value: "all", label: "All Eras" }]
                  : eras.map((e) => ({ value: e.id, label: `${e.label} (${e.count})` }))
              }
            />
          </div>
          {gameMode === "active-now" && <p className="hint-text">Active players. One regular season only. Ratings, suggested bids and final scores use the current season; before it starts, they use last season. Updated every Saturday.</p>}
          {gameMode === "peak" && <p className="hint-text">Every player scores from their single best season ever, not their career average. Pick any era; ratings and final scores use that peak season.</p>}
          <div className="era-picker-label room-difficulty">
            Difficulty (how often you land a stronger player)
            <div className="difficulty-picker">
              {DIFFICULTIES.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className={`difficulty-option ${difficulty === d.id ? "active" : ""}`}
                  onClick={() => setDifficulty(d.id)}
                  title={gameMode === "active-now" ? "Strength is based only on the selected season" : d.hint}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
          {/* Bidding mode and position-swap-with-others don't mean anything
              with no one else at the table -- solo never bids and there's
              no other roster to swap with. */}
          {!room.isSolo && (
            <div className="era-picker-label">
              Bidding
              <div className="difficulty-picker">
                {BIDDING_MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className={`difficulty-option ${biddingMode === m.id ? "active" : ""}`}
                    onClick={() => setBiddingMode(m.id)}
                    title={m.hint}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {!room.isSolo && (
            <label className="swap-setting-label">
              <input
                type="checkbox"
                checked={allowPositionSwaps}
                onChange={(e) => setAllowPositionSwaps(e.target.checked)}
              />
              Allow position changes after a player is drafted
            </label>
          )}
          <motion.button
            type="button"
            onClick={() => onStartDraft(gameMode === "active-now" ? "all" : era, allowPositionSwaps, difficulty, biddingMode, gameMode)}
            className="primary-btn start-btn"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
          >
            {room.players.length === 1 ? "Start Solo Draft" : "Start Draft"}
          </motion.button>
        </div>
      )}

      <button type="button" onClick={onLeaveRoom} className="leave-btn">
        Leave Room
      </button>
    </div>
  );
}
