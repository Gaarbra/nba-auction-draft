import { useEffect, useState } from "react";
import { motion } from "motion/react";
import LogoMark from "./LogoMark.jsx";

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

export default function RoomLobby({
  onCreateRoom,
  onJoinRoom,
  onCreateLocalRoom,
  onListPublicRooms,
  connected,
  error,
  isSubmitting,
}) {
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [mode, setMode] = useState("public");
  const [privateSubMode, setPrivateSubMode] = useState("create");
  const [localNames, setLocalNames] = useState(["", ""]);
  const [tilt, setTilt] = useState({ rx: 0, ry: 0 });

  const [publicRooms, setPublicRooms] = useState([]);
  const [publicRoomsLoading, setPublicRoomsLoading] = useState(false);

  function refreshPublicRooms() {
    setPublicRoomsLoading(true);
    onListPublicRooms((rooms) => {
      setPublicRooms(rooms);
      setPublicRoomsLoading(false);
    });
  }

  useEffect(() => {
    // Also re-fires once `connected` flips true — the very first mount can
    // race ahead of the socket actually being created (see App.jsx's
    // handleListPublicRooms), so this is what recovers from that instead of
    // leaving the list stuck empty until someone hits Refresh by hand.
    if (mode === "public" && connected) refreshPublicRooms();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, connected]);

  // A subtle 3D tilt toward the cursor — capped small (±6deg) so it reads as
  // "responsive" rather than gimmicky, and skipped for anyone who's asked
  // the OS for reduced motion.
  function handleCardMouseMove(e) {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    setTilt({ rx: py * -6, ry: px * 6 });
  }

  function handleCardMouseLeave() {
    setTilt({ rx: 0, ry: 0 });
  }

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
    if (mode === "public") {
      onCreateRoom(name, "public");
    } else if (mode === "private" && privateSubMode === "create") {
      onCreateRoom(name, "private");
    } else if (mode === "private" && privateSubMode === "join") {
      onJoinRoom(joinCode, name);
    } else if (mode === "local" && localNamesReady) {
      onCreateLocalRoom(validLocalNames);
    }
  }

  function joinPublicRoom(code) {
    onJoinRoom(code, name);
  }

  const submitLabel =
    mode === "public"
      ? "Create Public Room"
      : mode === "private"
        ? privateSubMode === "create"
          ? "Create Room"
          : "Join Room"
        : "Start Local Game";

  return (
    <motion.div
      className="lobby-card"
      onMouseMove={handleCardMouseMove}
      onMouseLeave={handleCardMouseLeave}
      animate={{ rotateX: tilt.rx, rotateY: tilt.ry }}
      transition={{ type: "spring", stiffness: 200, damping: 20 }}
      style={{ transformPerspective: 900 }}
    >
      <div className="lobby-brand">
        <LogoMark className="lobby-brand-logo" />
        <h1>Hoop Bids</h1>
      </div>

      <div className="mode-toggle">
        <button type="button" className={mode === "public" ? "active" : ""} onClick={() => setMode("public")}>
          Public
        </button>
        <button type="button" className={mode === "private" ? "active" : ""} onClick={() => setMode("private")}>
          Private
        </button>
        <button type="button" className={mode === "local" ? "active" : ""} onClick={() => setMode("local")}>
          Local
        </button>
      </div>

      {mode === "private" && (
        <div className="private-submode-toggle">
          <button
            type="button"
            className={privateSubMode === "create" ? "active" : ""}
            onClick={() => setPrivateSubMode("create")}
          >
            Create
          </button>
          <button
            type="button"
            className={privateSubMode === "join" ? "active" : ""}
            onClick={() => setPrivateSubMode("join")}
          >
            Join with Code
          </button>
        </div>
      )}

      {mode === "public" && (
        <p className="hint-text lobby-mode-hint">
          Open to anyone — create a room others can find and join without a code.
        </p>
      )}
      {mode === "private" && privateSubMode === "create" && (
        <p className="hint-text lobby-mode-hint">Only joinable with the room code you share.</p>
      )}

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

        {mode === "private" && privateSubMode === "join" && (
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
          {submitLabel}
        </button>
      </form>

      {mode === "public" && (
        <div className="public-room-list">
          <div className="public-room-list-header">
            <span>Open Rooms</span>
            <button type="button" className="public-room-refresh" onClick={refreshPublicRooms} disabled={publicRoomsLoading}>
              {publicRoomsLoading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
          {publicRooms.length === 0 ? (
            <p className="hint-text">
              {publicRoomsLoading ? "Looking for open rooms…" : "No open public rooms right now — start one above."}
            </p>
          ) : (
            <ul className="public-room-items">
              {publicRooms.map((r) => (
                <li key={r.code} className="public-room-item">
                  <span className="public-room-item-info">
                    <strong>{r.hostName}</strong>'s room
                    <span className="public-room-item-count">
                      {r.playerCount}/{r.maxPlayers}
                    </span>
                  </span>
                  <motion.button
                    type="button"
                    className="secondary-btn public-room-join-btn"
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.96 }}
                    disabled={!name.trim() || isSubmitting}
                    onClick={() => joinPublicRoom(r.code)}
                    title={!name.trim() ? "Enter your name above first" : undefined}
                  >
                    Join
                  </motion.button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </motion.div>
  );
}
