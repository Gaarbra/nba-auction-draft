import { useEffect, useState } from "react";
import { useSocket } from "./hooks/useSocket.js";
import RoomLobby from "./components/RoomLobby.jsx";
import RoomView from "./components/RoomView.jsx";

const ERROR_MESSAGES = {
  NAME_REQUIRED: "Please enter your name.",
  NAME_AND_CODE_REQUIRED: "Please enter your name and a room code.",
  ROOM_NOT_FOUND: "No room found with that code.",
  ROOM_FULL: "That room already has 4 players.",
  NAME_TAKEN: "Someone in that room already has that name.",
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

  return (
    <div className="app-shell">
      <div className={`connection-badge ${connected ? "online" : "offline"}`}>
        {connected ? "Connected" : "Connecting…"}
      </div>

      {room ? (
        <RoomView room={room} currentPlayerId={socketRef.current?.id} onLeaveRoom={handleLeaveRoom} />
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
