const MAX_TRACKED_KEYS = 5000;

/**
 * Fixed-window counter for the unauthenticated ordering endpoints.
 * A single restaurant runs one server process, so in-process state is enough;
 * a multi-instance deployment must move this to shared storage.
 */
export function createRateLimiter({ windowMs, max }) {
  const buckets = new Map();

  function prune(now) {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }

  return {
    /** @returns {{ allowed: boolean, retryAfter: number, remaining: number }} */
    check(key) {
      if (!Number.isFinite(max) || max <= 0) return { allowed: true, retryAfter: 0, remaining: Infinity };
      const now = Date.now();
      if (buckets.size > MAX_TRACKED_KEYS) prune(now);
      const bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + windowMs });
        return { allowed: true, retryAfter: 0, remaining: max - 1 };
      }
      bucket.count += 1;
      if (bucket.count > max) {
        return { allowed: false, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)), remaining: 0 };
      }
      return { allowed: true, retryAfter: 0, remaining: max - bucket.count };
    },
    size() {
      return buckets.size;
    }
  };
}

/** Fastify preHandler that rejects bursts from one client with 429 + Retry-After. */
export function rateLimitGuard(limiter, message) {
  return function guard(request, reply, done) {
    const { allowed, retryAfter } = limiter.check(request.ip || "unknown");
    if (allowed) {
      done();
      return;
    }
    reply.header("retry-after", retryAfter);
    reply.code(429).send({ error: message, retryAfter });
  };
}
