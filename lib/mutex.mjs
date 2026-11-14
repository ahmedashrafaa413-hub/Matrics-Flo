import { consumeRateLimit } from "./rateLimit.mjs";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A short-lived cross-instance lock built on the existing
// consume_api_rate_limit RPC: the first caller in a window gets
// `allowed: true`, every concurrent caller gets `allowed: false`.
// It needs no new table and works across serverless instances.
//
// The lock is not released explicitly; it expires with its window, so keep
// `ttlSeconds` just above the work it protects. Windows are aligned buckets
// (date_bin), so two callers straddling a bucket edge can both win: treat
// this as best-effort and keep the protected write itself compare-and-swap.
export async function tryAcquireLock(name, { ttlSeconds = 30 } = {}) {
  const result = await consumeRateLimit({
    scope: "mutex",
    identity: name,
    limit: 1,
    windowSeconds: ttlSeconds
  });

  return result.allowed;
}

// Runs `work` while holding the lock. A caller that loses the race waits,
// then runs `onContended` (normally: re-read state the winner just wrote).
export async function withLock(
  name,
  work,
  { ttlSeconds = 30, waitMs = 1500, attempts = 6, onContended } = {}
) {
  if (await tryAcquireLock(name, { ttlSeconds })) {
    return work();
  }

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await delay(waitMs);
    if (onContended) {
      const value = await onContended();
      if (value !== undefined && value !== null) return value;
    }
  }

  const error = new Error("Another request is updating this resource. Please retry.");
  error.status = 409;
  throw error;
}
