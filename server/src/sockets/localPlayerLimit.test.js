import test from "node:test";
import assert from "node:assert/strict";
import { registerRoomHandlers } from "./roomHandlers.js";
test("local socket accepts eight players and rejects nine", () => {
  const handlers = new Map();
  const socket = { id: "eight-test", data: {}, handshake: { address: "test" }, on: (name, fn) => handlers.set(name, fn), join() {}, emit() {} };
  const io = { to: () => ({ emit() {} }), emit() {} };
  registerRoomHandlers(io, socket);
  const names = Array.from({length: 8}, (_, i) => `Player ${i}`);
  let response;
  handlers.get("room:create-local")({ names }, r => { response = r; });
  assert.equal(response.error, undefined);
  assert.equal(response.room.players.length, 8);
  handlers.get("room:create-local")({ names: [...names, "Ninth"] }, r => { response = r; });
  assert.equal(response.error, "INVALID_LOCAL_PLAYERS");
});
