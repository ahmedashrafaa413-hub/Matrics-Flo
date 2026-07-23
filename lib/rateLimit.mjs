import { createSupabaseAdminClient } from "./supabaseServer.js";
import { hashRateLimitKey } from "./tokenEncryption.mjs";

export async function consumeRateLimit({
  scope,
  identity,
  limit,
  windowSeconds
}) {
  if (!scope || !identity) {
    throw new Error("Rate limit scope and identity are required");
  }

  const safeLimit = Math.max(1, Math.floor(Number(limit) || 1));
  const safeWindow = Math.max(1, Math.floor(Number(windowSeconds) || 60));
  const admin = createSupabaseAdminClient();
  const keyHash = hashRateLimitKey(`${scope}:${identity}`);

  const { data, error } = await admin.rpc("consume_api_rate_limit", {
    p_key_hash: keyHash,
    p_limit: safeLimit,
    p_window_seconds: safeWindow
  });

  if (error) {
    const rateLimitError = new Error(
      `Rate limit storage is unavailable: ${error.message}`
    );
    rateLimitError.status = 503;
    throw rateLimitError;
  }

  const result = Array.isArray(data) ? data[0] : data;

  return {
    allowed: Boolean(result?.allowed),
    remaining: Math.max(0, Number(result?.remaining || 0)),
    resetAt: result?.reset_at || null
  };
}

export function assertRateLimit(result) {
  if (result?.allowed) return;

  const error = new Error("Too many requests. Please wait before trying again.");
  error.status = 429;
  error.retryAfter = result?.resetAt || null;
  throw error;
}
