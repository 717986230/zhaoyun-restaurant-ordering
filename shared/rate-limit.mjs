const MAX_TRACKED_KEYS = 5000;

/**
 * Fixed-window counter for the unauthenticated ordering endpoints, and for
 * guessing passwords and tokens (shared/http.mjs).
 *
 * In memory: a restaurant's Node server is one process, so this is the whole
 * budget there. A Worker runs many isolates that share no memory, so there it
 * throttles a burst from one client rather than enforcing a global budget —
 * worth having anyway, and the database-backed limits (shared/ordering.mjs)
 * are the global ones.
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
