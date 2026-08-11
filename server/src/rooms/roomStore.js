const rooms = new Map();

const MAX_PLAYERS = 4;
const STARTING_BUDGET = 20;

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  } while (rooms.has(code));
  return code;
}

export function createRoom() {
  const code = generateRoomCode();
  const room = {
    code,
    players: [],
    createdAt: Date.now(),
  };
  rooms.set(code, room);
  return room;
}

export function getRoom(code) {
  return rooms.get(code?.toUpperCase());
}

export function addPlayerToRoom(code, player) {
  const room = getRoom(code);
  if (!room) {
    return { error: "ROOM_NOT_FOUND" };
  }
  if (room.players.length >= MAX_PLAYERS) {
    return { error: "ROOM_FULL" };
  }
  if (room.players.some((p) => p.name.toLowerCase() === player.name.toLowerCase())) {
    return { error: "NAME_TAKEN" };
  }

  const newPlayer = {
    id: player.id,
    name: player.name,
    budget: STARTING_BUDGET,
    isHost: room.players.length === 0,
  };
  room.players.push(newPlayer);
  return { room };
}

export function removePlayerFromSocket(socketId) {
  for (const room of rooms.values()) {
    const index = room.players.findIndex((p) => p.id === socketId);
    if (index !== -1) {
      const [removed] = room.players.splice(index, 1);

      if (removed.isHost && room.players.length > 0) {
        room.players[0].isHost = true;
      }

      if (room.players.length === 0) {
        rooms.delete(room.code);
      }

      return { room: rooms.has(room.code) ? room : null, roomCode: room.code };
    }
  }
  return null;
}

export const config = { MAX_PLAYERS, STARTING_BUDGET };
