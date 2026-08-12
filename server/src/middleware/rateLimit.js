// Small, dependency-free rate limiting. This is a casual friends-scale app
// behind whatever the hosting platform's own edge/proxy already provides —
// these are a defense-in-depth backstop against a spammy client or script,
// not a substitute for real DDoS protection.

/**
 * Fixed-window counter keyed by an arbitrary string (IP, socket id, etc).
 * Sweeps expired entries periodically so long-running processes don't leak
 * memory for keys that stop showing up (players who left, rotated IPs).
 */
export function createKeyedRateLimiter({ windowMs, max, sweepEveryMs = 5 * 60_000 }) {
  const hits = new Map();

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (now > entry.resetAt) hits.delete(key);
    }
  }, sweepEveryMs);
  sweep.unref?.();

  return function isAllowed(key) {
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || now > entry.resetAt) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (entry.count >= max) return false;
    entry.count += 1;
    return true;
  };
}

/** Express middleware wrapping createKeyedRateLimiter, keyed by request IP. */
export function httpRateLimit({ windowMs, max, message = "Too many requests" }) {
  const isAllowed = createKeyedRateLimiter({ windowMs, max });
  return (req, res, next) => {
    if (!isAllowed(req.ip)) {
      return res.status(429).json({ error: message });
    }
    next();
  };
}

/**
 * A single socket's own fixed-window counter — no shared Map needed since
 * it's already scoped to one connection's lifetime and dies with it.
 */
export function createSocketEventLimiter(windowMs, max) {
  let count = 0;
  let resetAt = Date.now() + windowMs;
  return function isAllowed() {
    const now = Date.now();
    if (now > resetAt) {
      count = 0;
      resetAt = now + windowMs;
    }
    count += 1;
    return count <= max;
  };
}
