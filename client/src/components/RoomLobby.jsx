import { useState } from "react";

// Matches the room-code alphabet the server generates from (roomStore.js) —
// no I/O/0/1, to avoid characters that look alike. Sanitizing pasted text
// against this same set means a code copied out of a text message (with
// stray whitespace, a trailing newline, or smart-quote-mangled casing)
// still lands as a valid, matching code instead of silently failing to join.
const CODE_ALPHABET = /[^ABCDEFGHJKLMNPQRSTUVWXYZ23456789]/g;

function sanitizeCode(raw) {
  return raw.toUpperCase().replace(CODE_ALPHABET, "").slice(0, 5);
}

const MAX_LOCAL_PLAYERS = 4;
const MIN_LOCAL_PLAYERS = 2;

export default function RoomLobby({ onCreateRoom, onJoinRoom, onCreateLocalRoom, error, isSubmitting }) {
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [mode, setMode] = useState("create");
  const [localNames, setLocalNames] = useState(["", ""]);

  function updateLocalName(index, value) {
    setLocalNames((prev) => prev.map((n, i) => (i === index ? value : n)));
  }

  function addLocalNameField() {
    setLocalNames((prev) => (prev.length < MAX_LOCAL_PLAYERS ? [...prev, ""] : prev));
  }

  function removeLocalNameField(index) {
    setLocalNames((prev) => (prev.length > MIN_LOCAL_PLAYERS ? prev.filter((_, i) => i !== index) : prev));
  }

  const validLocalNames = localNames.map((n) => n.trim()).filter(Boolean);
  const localNamesReady = validLocalNames.length >= MIN_LOCAL_PLAYERS;

  function handleSubmit(e) {
    e.preventDefault();
    if (mode === "create") {
      onCreateRoom(name);
    } else if (mode === "join") {
      onJoinRoom(joinCode, name);
    } else if (localNamesReady) {
      onCreateLocalRoom(validLocalNames);
    }
  }

  return (
    <div className="lobby-card">
      <h1>Hoop Bids</h1>

      <div className="mode-toggle">
        <button
          type="button"
          className={mode === "create" ? "active" : ""}
          onClick={() => setMode("create")}
        >
          Create Room
        </button>
        <button
          type="button"
          className={mode === "join" ? "active" : ""}
          onClick={() => setMode("join")}
        >
          Join Room
        </button>
        <button
          type="button"
          className={mode === "local" ? "active" : ""}
          onClick={() => setMode("local")}
        >
          Local Play
        </button>
      </div>

      <form onSubmit={handleSubmit}>
        {mode !== "local" && (
          <label>
            Your Name
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Gabriel"
              maxLength={20}
              required
            />
          </label>
        )}

        {mode === "join" && (
          <label>
            Room Code
            <input
              type="text"
              value={joinCode}
              onChange={(e) => setJoinCode(sanitizeCode(e.target.value))}
              onPaste={(e) => {
                e.preventDefault();
                setJoinCode(sanitizeCode(e.clipboardData.getData("text")));
              }}
              placeholder="e.g. AB12C"
              maxLength={5}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              required
            />
          </label>
        )}

        {mode === "local" && (
          <div className="local-players-field">
            <p className="hint-text local-players-hint">
              Everyone plays from this device, passing it around each turn. Add 2-4 names.
            </p>
            {localNames.map((value, index) => (
              <div key={index} className="local-name-row">
                <input
                  type="text"
                  value={value}
                  onChange={(e) => updateLocalName(index, e.target.value)}
                  placeholder={`Player ${index + 1}`}
                  maxLength={20}
                />
                {localNames.length > MIN_LOCAL_PLAYERS && (
                  <button
                    type="button"
                    className="local-name-remove"
                    onClick={() => removeLocalNameField(index)}
                    aria-label={`Remove player ${index + 1}`}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            {localNames.length < MAX_LOCAL_PLAYERS && (
              <button type="button" className="secondary-btn add-local-player-btn" onClick={addLocalNameField}>
                + Add Player
              </button>
            )}
          </div>
        )}

        {error && <p className="error-text">{error}</p>}

        <button
          type="submit"
          className="primary-btn"
          disabled={isSubmitting || (mode === "local" && !localNamesReady)}
        >
          {mode === "create" ? "Create Room" : mode === "join" ? "Join Room" : "Start Local Game"}
        </button>
      </form>
    </div>
  );
}
