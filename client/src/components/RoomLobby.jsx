import { useState } from "react";

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
      <h1>NBA Auction Draft</h1>

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
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="e.g. AB12C"
              maxLength={5}
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
