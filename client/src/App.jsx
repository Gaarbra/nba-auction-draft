import { useEffect, useState } from "react";
import { useSocket } from "./hooks/useSocket.js";
import RoomLobby from "./components/RoomLobby.jsx";
import RoomView from "./components/RoomView.jsx";
import DraftBoard from "./components/DraftBoard.jsx";

const ERROR_MESSAGES = {
  NAME_REQUIRED: "Please enter your name.",
  NAME_AND_CODE_REQUIRED: "Please enter your name and a room code.",
  ROOM_NOT_FOUND: "No room found with that code.",
  ROOM_FULL: "That room already has 4 players.",
  NAME_TAKEN: "Someone in that room already has that name.",
  DRAFT_ALREADY_STARTED: "That draft has already started.",
  NOT_HOST: "Only the host can start the draft.",
  ALREADY_STARTED: "The draft has already started.",
  INVALID_ERA: "That's not a valid era.",
  NO_PLAYERS_LEFT: "No players left in this era's pool.",
};

export default function App() {
  const { socketRef, connected } = useSocket();
  const [room, setRoom] = useState(null);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    function handleRoomUpdate(updatedRoom) {
      setRoom(updatedRoom);
    }

    socket.on("room:update", handleRoomUpdate);
    return () => socket.off("room:update", handleRoomUpdate);
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
    });
  }

  function handleLeaveRoom() {
    socketRef.current.emit("room:leave");
    setRoom(null);
  }

  function handleStartDraft(era, allowPositionSwaps) {
    socketRef.current.emit("room:start", { era, allowPositionSwaps }, (response) => {
      if (response.error) {
        setError(ERROR_MESSAGES[response.error] || "Could not start draft.");
      }
    });
  }

  return (
    <div className="app-shell">
      <div className={`connection-badge ${connected ? "online" : "offline"}`}>
        {connected ? "Connected" : "Connecting…"}
      </div>

      {room ? (
        room.status === "waiting" ? (
          <RoomView
            room={room}
            currentPlayerId={socketRef.current?.id}
            onLeaveRoom={handleLeaveRoom}
            onStartDraft={handleStartDraft}
          />
        ) : (
          <DraftBoard
            room={room}
            currentPlayerId={socketRef.current?.id}
            socket={socketRef.current}
            onLeaveRoom={handleLeaveRoom}
          />
        )
      ) : (
        <RoomLobby
          onCreateRoom={handleCreateRoom}
          onJoinRoom={handleJoinRoom}
          error={error}
          isSubmitting={isSubmitting}
        />
      )}
    </div>
  );
}
