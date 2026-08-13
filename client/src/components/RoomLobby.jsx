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

export default function RoomLobby({ onCreateRoom, onJoinRoom, error, isSubmitting }) {
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [mode, setMode] = useState("create");

  function handleSubmit(e) {
    e.preventDefault();
    if (mode === "create") {
      onCreateRoom(name);
    } else {
      onJoinRoom(joinCode, name);
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
      </div>

      <form onSubmit={handleSubmit}>
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

        {error && <p className="error-text">{error}</p>}

        <button type="submit" className="primary-btn" disabled={isSubmitting}>
          {mode === "create" ? "Create Room" : "Join Room"}
        </button>
      </form>
    </div>
  );
}
