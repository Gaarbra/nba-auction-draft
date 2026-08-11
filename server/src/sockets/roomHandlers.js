import { createRoom, addPlayerToRoom, removePlayerFromSocket } from "../rooms/roomStore.js";

function toPublicRoom(room) {
  return {
    code: room.code,
    players: room.players.map((p) => ({ id: p.id, name: p.name, budget: p.budget, isHost: p.isHost })),
  };
}

export function registerRoomHandlers(io, socket) {
  socket.on("room:create", ({ name }, callback) => {
    const playerName = (name || "").trim();
    if (!playerName) {
      return callback?.({ error: "NAME_REQUIRED" });
    }

    const room = createRoom();
    const result = addPlayerToRoom(room.code, { id: socket.id, name: playerName });

    if (result.error) {
      return callback?.({ error: result.error });
    }

    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.playerName = playerName;

    callback?.({ room: toPublicRoom(result.room) });
    io.to(room.code).emit("room:update", toPublicRoom(result.room));
  });

  socket.on("room:join", ({ code, name }, callback) => {
    const playerName = (name || "").trim();
    const roomCode = (code || "").trim().toUpperCase();

    if (!playerName || !roomCode) {
      return callback?.({ error: "NAME_AND_CODE_REQUIRED" });
    }

    const result = addPlayerToRoom(roomCode, { id: socket.id, name: playerName });

    if (result.error) {
      return callback?.({ error: result.error });
    }

    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.data.playerName = playerName;

    callback?.({ room: toPublicRoom(result.room) });
    io.to(roomCode).emit("room:update", toPublicRoom(result.room));
  });

  socket.on("room:leave", () => {
    handleDisconnect(io, socket);
  });

  socket.on("disconnect", () => {
    handleDisconnect(io, socket);
  });
}

function handleDisconnect(io, socket) {
  const roomCode = socket.data.roomCode;
  if (!roomCode) return;

  const result = removePlayerFromSocket(socket.id);
  socket.data.roomCode = undefined;

  if (result?.room) {
    io.to(result.roomCode).emit("room:update", toPublicRoom(result.room));
  }
}
