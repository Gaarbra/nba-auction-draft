import test from "node:test";
import assert from "node:assert/strict";
import { createRoom, addPlayerToRoom, setRoomPlayerLimit, listPublicRooms } from "./roomStore.js";

test("host limits are enforced for joining and public listings", () => {
  const room = createRoom("public");
  const host = addPlayerToRoom(room.code, { name: "Host", socketId: "host" }).player;
  assert.equal(setRoomPlayerLimit(room.code, "stranger", 2).error, "NOT_HOST");
  for (const limit of [0, 1, 5, 2.5, "2", null]) assert.equal(setRoomPlayerLimit(room.code, host.id, limit).error, "INVALID_PLAYER_LIMIT");
  assert.equal(setRoomPlayerLimit(room.code, host.id, 2).error, undefined);
  assert.equal(listPublicRooms().find((r) => r.code === room.code).maxPlayers, 2);
  addPlayerToRoom(room.code, { name: "Guest", socketId: "guest" });
  assert.equal(addPlayerToRoom(room.code, { name: "Third", socketId: "third" }).error, "ROOM_FULL");
  assert.equal(listPublicRooms().some((r) => r.code === room.code), false);
  setRoomPlayerLimit(room.code, host.id, 3);
  addPlayerToRoom(room.code, { name: "Third", socketId: "third" });
  assert.equal(setRoomPlayerLimit(room.code, host.id, 2).error, "PLAYER_LIMIT_TOO_SMALL");
  room.status = "drafting";
  assert.equal(setRoomPlayerLimit(room.code, host.id, 4).error, "ROOM_SETTINGS_LOCKED");
});

test("solo rooms cannot accept another player", () => {
  const room = createRoom("private", true);
  const host = addPlayerToRoom(room.code, { name: "Solo", socketId: "solo" }).player;
  assert.equal(addPlayerToRoom(room.code, { name: "Intruder", socketId: "other" }).error, "ROOM_FULL");
  assert.equal(setRoomPlayerLimit(room.code, host.id, 2).error, "ROOM_SETTINGS_LOCKED");
});
