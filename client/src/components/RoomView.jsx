import { useEffect, useState } from "react";
import CoinRow from "./CoinRow.jsx";
import PlayerStatusBadge from "./PlayerStatusBadge.jsx";

const MAX_PLAYERS = 4;
const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:4000";

const DIFFICULTIES = [
  { id: "easy", label: "Easy", hint: "Stars come up often" },
  { id: "normal", label: "Normal", hint: "A healthy mix" },
  { id: "hard", label: "Hard", hint: "True random draw" },
];

function getHintText(playerCount, isHost, isLocal) {
  if (isLocal) {
    return isHost ? "Everyone's added — start whenever you're ready." : "Waiting for the host to start.";
  }
  if (playerCount === 1) {
    return isHost
      ? "Playing solo — start whenever you're ready. You'll draft a full roster and get a score at the end."
      : "Waiting for the host to start.";
  }
  if (playerCount === MAX_PLAYERS) {
    return isHost ? "Room is full — ready to start!" : "Room is full. Waiting for the host to start.";
  }
  return isHost
    ? `You can start now with ${playerCount} players, or wait for up to ${MAX_PLAYERS}.`
    : "Waiting for the host to start (or for more players to join).";
}

export default function RoomView({ room, currentPlayerId, onLeaveRoom, onStartDraft }) {
  const emptySlots = MAX_PLAYERS - room.players.length;
  const currentPlayer = room.players.find((p) => p.id === currentPlayerId);
  const isHost = Boolean(currentPlayer?.isHost);

  const [eras, setEras] = useState([]);
  const [era, setEra] = useState("all");
  const [difficulty, setDifficulty] = useState("normal");
  const [allowPositionSwaps, setAllowPositionSwaps] = useState(false);

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
          <h2>{room.isLocal ? "Local Game" : "Room Code"}</h2>
          {room.isLocal ? (
            <span className="room-code local">Pass &amp; Play</span>
          ) : (
            <button type="button" onClick={copyRoomCode} className="room-code-btn" title="Copy code">
              <span className="room-code">{room.code}</span>
              <span className="room-code-copy-hint">{codeCopied ? "Copied!" : "Click to copy"}</span>
            </button>
          )}
        </div>
        {!room.isLocal && (
          <button type="button" onClick={copyInviteLink} className="secondary-btn">
            Copy Invite Link
          </button>
        )}
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
              <PlayerStatusBadge player={p} reconnectGraceMs={room.reconnectGraceMs} />
            </span>
            <CoinRow budget={p.budget} />
          </li>
        ))}
        {!room.isLocal &&
          Array.from({ length: emptySlots }).map((_, i) => (
            <li key={`empty-${i}`} className="empty-slot">
              Waiting for player…
            </li>
          ))}
      </ul>

      <p className="hint-text">{getHintText(room.players.length, isHost, room.isLocal)}</p>

      {isHost && (
        <>
          <label className="era-picker-label">
            Player pool for this draft
            <select value={era} onChange={(e) => setEra(e.target.value)} className="era-select era-picker">
              {eras.length === 0 && <option value="all">All Eras</option>}
              {eras.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label} ({e.count})
                </option>
              ))}
            </select>
          </label>
          <label className="era-picker-label">
            Difficulty (how often you land a stronger player)
            <div className="difficulty-picker">
              {DIFFICULTIES.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className={`difficulty-option ${difficulty === d.id ? "active" : ""}`}
                  onClick={() => setDifficulty(d.id)}
                  title={d.hint}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </label>
          <label className="swap-setting-label">
            <input
              type="checkbox"
              checked={allowPositionSwaps}
              onChange={(e) => setAllowPositionSwaps(e.target.checked)}
            />
            Allow players to swap drafted players' positions later
          </label>
          <button
            type="button"
            onClick={() => onStartDraft(era, allowPositionSwaps, difficulty)}
            className="primary-btn start-btn"
          >
            {room.players.length === 1 ? "Start Solo Draft" : "Start Draft"}
          </button>
        </>
      )}

      <button type="button" onClick={onLeaveRoom} className="leave-btn">
        Leave Room
      </button>
    </div>
  );
}
