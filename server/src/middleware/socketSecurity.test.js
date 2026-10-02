import test from "node:test";
import assert from "node:assert/strict";
import { isAllowedSocketOrigin, verifyHuman, socketSecurity } from "./socketSecurity.js";
import { createKeyedRateLimiter } from "./rateLimit.js";
import { createRoom, addPlayerToRoom, reconnectPlayer } from "../rooms/roomStore.js";

test("same-origin polling without Origin passes the origin gate but still requires verification", async () => {
  const origin = "https://girma.me";
  const headers = { host: "girma.me", "sec-fetch-site": "same-origin" };
  assert.equal(isAllowedSocketOrigin(headers, origin), true);
  assert.equal(isAllowedSocketOrigin({ origin }, origin), true);
  for (const invalid of [
    {}, { host: "girma.me" },
    { ...headers, host: "other.example" },
    { ...headers, host: "girma.me:444" },
    { ...headers, "sec-fetch-site": "cross-site" },
    { ...headers, "sec-fetch-site": "same-site" },
    { ...headers, origin: "https://other.example" },
    { ...headers, origin: "null" },
    { ...headers, origin: "" },
  ]) assert.equal(isAllowedSocketOrigin(invalid, origin), false);
  let middleware;
  socketSecurity({ use: fn => { middleware = fn; } }, { origin, secret: "test-secret", production: true });
  const socket = { data: {}, handshake: { headers, address: "127.0.0.1" } };
  let rejection;
  await middleware(socket, error => { rejection = error; });
  assert.equal(rejection.message, "HUMAN_VERIFICATION_FAILED");
});

test("verification diagnostics explain rejection without exposing credentials or token contents", async (t) => {
  const logs = [];
  t.mock.method(console, "warn", (...args) => logs.push(args));
  const options = { secret: "private-secret", hostname: "example.com" };
  const accepted = await verifyHuman("private-token", { ...options, fetcher: async () => ({
    ok: true, status: 200, json: async () => ({ success: false, "error-codes": ["invalid-input-secret", "private-token"], secret: "private-secret" }),
  }) });
  assert.equal(accepted, false);
  assert.deepEqual(logs[0][1].codes, ["invalid-input-secret"]);
  assert.equal(JSON.stringify(logs).includes("private-token"), false);
  assert.equal(JSON.stringify(logs).includes("private-secret"), false);
  logs.length = 0;
  assert.equal(await verifyHuman("private-token", { ...options, fetcher: async () => ({
    ok: true, status: 200, json: async () => ({ success: true, hostname: "other.example", action: "connect" }),
  }) }), false);
  assert.equal(logs[0][1].verified, true);
  assert.equal(logs[0][1].hostnameMatches, false);
  assert.equal(logs[0][1].actionMatches, true);
});

test("verification fails closed, checks action/hostname, and limits token size", async () => {
  const options = { secret: "test", hostname: "example.com" };
  const verify = (result) => verifyHuman("token", { ...options, fetcher: async () => ({ ok: true, json: async () => result }) });
  assert.equal(await verify({ success: true, hostname: "example.com", action: "connect" }), true);
  assert.equal(await verify({ success: true, hostname: "attacker.com", action: "connect" }), false);
  assert.equal(await verify({ success: true, hostname: "example.com", action: "other" }), false);
  assert.equal(await verify({ success: false }), false);
  assert.equal(await verifyHuman("", options), false);
  assert.equal(await verifyHuman("x".repeat(2049), options), false);
  assert.equal(await verifyHuman("token", { ...options, fetcher: async () => { throw new Error("offline"); } }), false);
});

test("reconnection requires the private token, without mutating on rejection", () => {
  const room = createRoom("private");
  const { player } = addPlayerToRoom(room.code, { name: "Tester", socketId: "original" });
  player.reconnectToken = "private-token";
  assert.ok(reconnectPlayer(room.code, player.id, "attacker").error);
  assert.ok(reconnectPlayer(room.code, player.id, "attacker", "wrong").error);
  assert.equal(player.socketId, "original");
  assert.equal(reconnectPlayer(room.code, player.id, "new", "private-token").error, undefined);
  player.forfeited = true;
  assert.ok(reconnectPlayer(room.code, player.id, "again", "private-token").error);
});

test("socket gate rejects production without verification and validates packets", async () => {
  let middleware;
  const io = { use: (fn) => { middleware = fn; } };
  const config = { origin: "https://example.com", production: true, trustProxy: false };
  socketSecurity(io, config);
  let packetCheck;
  const socket = { data: {}, handshake: { address: "127.0.0.1", headers: { origin: config.origin, "x-forwarded-for": "fake" } }, use: (fn) => { packetCheck = fn; } };
  let error;
  await middleware(socket, (err) => { error = err; });
  assert.equal(error.message, "HUMAN_VERIFICATION_NOT_CONFIGURED");
  assert.equal(socket.data.clientIp, "127.0.0.1");
  socketSecurity(io, { ...config, production: false });
  await middleware(socket, (err) => { error = err; });
  assert.equal(error, undefined);
  let reply;
  packetCheck(["room:join", null, (value) => { reply = value; }], () => assert.fail("invalid payload accepted"));
  assert.equal(reply.error, "INVALID_PAYLOAD");
  socket.data.roomCode = "ROOM";
  packetCheck(["room:create", {}, (value) => { reply = value; }], () => assert.fail("second room accepted"));
  assert.equal(reply.error, "ALREADY_IN_ROOM");
  const limiter = createKeyedRateLimiter({ windowMs: 60000, max: 1 });
  assert.equal(limiter("ip"), true);
  assert.equal(limiter("ip"), false);
  assert.equal(limiter("other"), true);
});
