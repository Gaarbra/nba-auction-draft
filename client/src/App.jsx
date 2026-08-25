import { useEffect, useRef, useState } from "react";
import { useSocket } from "./hooks/useSocket.js";
import RoomLobby from "./components/RoomLobby.jsx";
import RoomView from "./components/RoomView.jsx";
import DraftBoard from "./components/DraftBoard.jsx";
import LocalPlayerSwitcher from "./components/LocalPlayerSwitcher.jsx";

const SESSION_KEY = "nba-auction-draft:session";

const ERROR_MESSAGES = {
  NAME_REQUIRED: "Please enter your name.",
  NAME_AND_CODE_REQUIRED: "Please enter your name and a room code.",
  NAME_TOO_LONG: "That name is too long.",
  ROOM_NOT_FOUND: "No room found with that code.",
  ROOM_FULL: "That room already has 4 players.",
  NAME_TAKEN: "Someone in that room already has that name.",
  DRAFT_ALREADY_STARTED: "That draft has already started.",
  NOT_HOST: "Only the host can start the draft.",
  ALREADY_STARTED: "The draft has already started.",
  INVALID_ERA: "That's not a valid era.",
  INVALID_DIFFICULTY: "That's not a valid difficulty.",
  NO_PLAYERS_LEFT: "No players left in this era's pool.",
  RECONNECT_FAILED: "Your previous session couldn't be resumed — please rejoin.",
  RATE_LIMITED: "Slow down a bit — try again in a few seconds.",
  INVALID_LOCAL_PLAYERS: "Enter between 2 and 4 player names.",
};

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSession(session) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Storage unavailable (private browsing, quota) — reconnect just won't
    // survive a refresh; the live session still works fine.
  }
}

function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

export default function App() {
  const { socketRef, connected } = useSocket();
  const [room, setRoom] = useState(null);
  const [currentPlayerId, setCurrentPlayerId] = useState(null);
  const [localPlayerIds, setLocalPlayerIds] = useState(null);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);

  const sessionRef = useRef(loadSession());

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    function handleRoomUpdate(updatedRoom) {
      setRoom(updatedRoom);
    }

    function attemptRejoin() {
      const session = sessionRef.current;
      if (!session) return;

      setIsReconnecting(true);
      if (session.localPlayerIds) {
        socket.emit("room:rejoin-local", { code: session.roomCode, playerIds: session.localPlayerIds }, (response) => {
          setIsReconnecting(false);
          if (response.error) {
            sessionRef.current = null;
            clearSession();
            return;
          }
          setRoom(response.room);
          setLocalPlayerIds(response.playerIds);
          setCurrentPlayerId(response.playerIds[0]);
        });
        return;
      }

      socket.emit("room:rejoin", { code: session.roomCode, playerId: session.playerId }, (response) => {
        setIsReconnecting(false);
        if (response.error) {
          sessionRef.current = null;
          clearSession();
          return;
        }
        setRoom(response.room);
        setCurrentPlayerId(response.playerId);
      });
    }

    socket.on("room:update", handleRoomUpdate);
    socket.on("connect", attemptRejoin);
    if (socket.connected) attemptRejoin();

    return () => {
      socket.off("room:update", handleRoomUpdate);
      socket.off("connect", attemptRejoin);
    };
  }, [socketRef]);

  function handleCreateRoom(name) {
    setError("");
    setIsSubmitting(true);
    socketRef.current.emit("room:create", { name }, (response) => {
      setIsSubmitting(false);
      if (response.error) {
        setError(ERROR_MESSAGES[response.error] || "Could not create room.");
        return;
      }
      setRoom(response.room);
      setCurrentPlayerId(response.playerId);
      setLocalPlayerIds(null);
      sessionRef.current = { roomCode: response.room.code, playerId: response.playerId };
      saveSession(sessionRef.current);
    });
  }

  function handleJoinRoom(code, name) {
    setError("");
    setIsSubmitting(true);
    socketRef.current.emit("room:join", { code, name }, (response) => {
      setIsSubmitting(false);
      if (response.error) {
        setError(ERROR_MESSAGES[response.error] || "Could not join room.");
        return;
      }
      setRoom(response.room);
      setCurrentPlayerId(response.playerId);
      setLocalPlayerIds(null);
      sessionRef.current = { roomCode: response.room.code, playerId: response.playerId };
      saveSession(sessionRef.current);
    });
  }

  function handleCreateLocalRoom(names) {
    setError("");
    setIsSubmitting(true);
    socketRef.current.emit("room:create-local", { names }, (response) => {
      setIsSubmitting(false);
      if (response.error) {
        setError(ERROR_MESSAGES[response.error] || "Could not start local game.");
        return;
      }
      setRoom(response.room);
      setLocalPlayerIds(response.playerIds);
      setCurrentPlayerId(response.playerIds[0]);
      sessionRef.current = { roomCode: response.room.code, localPlayerIds: response.playerIds };
      saveSession(sessionRef.current);
    });
  }

  function handleLeaveRoom() {
    socketRef.current.emit("room:leave");
    sessionRef.current = null;
    clearSession();
    setRoom(null);
    setCurrentPlayerId(null);
    setLocalPlayerIds(null);
  }

  function handleStartDraft(era, allowPositionSwaps, difficulty) {
    socketRef.current.emit("room:start", { era, allowPositionSwaps, difficulty, playerId: currentPlayerId }, (response) => {
      if (response.error) {
        setError(ERROR_MESSAGES[response.error] || "Could not start draft.");
      }
    });
  }

  // Pass-and-play: whoever needs to act next (the nominator, or the winning
  // bidder about to assign a slot) is automatically brought "to the
  // controls" if they're one of this device's local players — saves a
  // manual switch for the common case. Deliberately left alone during open
  // bidding, since any local player with room on their roster might want to
  // act next and guessing which one would just fight the switcher.
  useEffect(() => {
    if (!localPlayerIds) return;
    const draft = room?.draft;
    if (!draft) return;
    const nomination = draft.nomination;
    const target = nomination ? (nomination.phase === "assigning" ? nomination.currentBidder : null) : draft.currentNominatorId;
    if (target && localPlayerIds.includes(target)) {
      setCurrentPlayerId(target);
    }
  }, [room?.draft?.currentNominatorId, room?.draft?.nomination?.phase, room?.draft?.nomination?.currentBidder, localPlayerIds]);

  return (
    <div className="app-shell">
      <div className={`connection-badge ${connected ? "online" : "offline"}`}>
        {connected ? "Connected" : "Connecting…"}
      </div>

      {isReconnecting && !room ? (
        <div className="lobby-card">
          <p className="hint-text">Reconnecting to your room…</p>
        </div>
      ) : room ? (
        <div className="room-with-switcher">
          {localPlayerIds && (
            <LocalPlayerSwitcher room={room} currentPlayerId={currentPlayerId} onSwitch={setCurrentPlayerId} />
          )}
          {room.status === "waiting" ? (
            <RoomView
              room={room}
              currentPlayerId={currentPlayerId}
              onLeaveRoom={handleLeaveRoom}
              onStartDraft={handleStartDraft}
            />
          ) : (
            <DraftBoard
              room={room}
              currentPlayerId={currentPlayerId}
              socket={socketRef.current}
              onLeaveRoom={handleLeaveRoom}
            />
          )}
        </div>
      ) : (
        <RoomLobby
          onCreateRoom={handleCreateRoom}
          onJoinRoom={handleJoinRoom}
          onCreateLocalRoom={handleCreateLocalRoom}
          error={error}
          isSubmitting={isSubmitting}
        />
      )}
    </div>
  );
}
