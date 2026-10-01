import { createKeyedRateLimiter } from "./rateLimit.js";

export async function verifyHuman(token, { secret, hostname, fetcher = fetch }) {
  if (typeof token !== "string" || !token || token.length > 2048) return false;
  try {
    const response = await fetcher("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, response: token }),
      signal: AbortSignal.timeout(8000),
    });
    const result = await response.json();
    return response.ok && result.success === true && result.hostname === hostname && result.action === "connect";
  } catch {
    return false;
  }
}

export function socketSecurity(io, { origin, secret, production, trustProxy }) {
  // ponytail: one Node process owns rooms and limits; shared storage is required before scaling out.
  const connections = createKeyedRateLimiter({ windowMs: 60_000, max: 30 });
  const events = createKeyedRateLimiter({ windowMs: 10_000, max: 120 });
  io.use(async (socket, next) => {
    const forwarded = socket.handshake.headers["x-forwarded-for"];
    const ip = trustProxy && typeof forwarded === "string"
      ? forwarded.split(",").at(-1).trim() : socket.handshake.address;
    socket.data.clientIp = ip;
    if (!connections(ip)) return next(new Error("RATE_LIMITED"));
    if (socket.handshake.headers.origin !== origin) return next(new Error("ORIGIN_REJECTED"));
    if (secret) {
      if (!await verifyHuman(socket.handshake.auth?.token, { secret, hostname: new URL(origin).hostname })) {
        return next(new Error("HUMAN_VERIFICATION_FAILED"));
      }
    } else if (production) {
      return next(new Error("HUMAN_VERIFICATION_NOT_CONFIGURED"));
    }
    socket.use(([event, payload, callback], proceed) => {
      const reply = typeof callback === "function" ? callback : () => {};
      if (!events(ip)) return reply({ error: "RATE_LIMITED" });
      // All current events accept an object (or no payload), never arrays/null/primitives.
      if (payload !== undefined && (!payload || typeof payload !== "object" || Array.isArray(payload))) {
        return reply({ error: "INVALID_PAYLOAD" });
      }
      if (callback !== undefined && typeof callback !== "function") return;
      if (payload?.code !== undefined && typeof payload.code !== "string") return reply({ error: "INVALID_PAYLOAD" });
      if (["room:create", "room:create-local", "room:join", "room:rejoin", "room:rejoin-local"].includes(event) && socket.data.roomCode) {
        return reply({ error: "ALREADY_IN_ROOM" });
      }
      proceed();
    });
    next();
  });
}
