export const AUTH_COOKIE_NAMES = Object.freeze({
  access: "sb-access-token",
  legacyAccess: "supabase-access-token",
  refresh: "sb-refresh-token",
  workspace: "metricsflo_active_workspace"
});

export function normalizeSessionMaxAge(value, fallback = 60 * 60) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;

  return Math.min(Math.floor(parsed), 60 * 60 * 24 * 7);
}

export function getSafeInternalPath(value, fallback = "/dashboard") {
  if (typeof value !== "string") return fallback;

  const path = value.trim();

  if (!path.startsWith("/") || path.startsWith("//")) return fallback;
  if (path.includes("\\") || /[\r\n]/.test(path)) return fallback;

  try {
    const parsed = new URL(path, "https://metricsflo.local");
    return parsed.origin === "https://metricsflo.local"
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : fallback;
  } catch {
    return fallback;
  }
}

export function getSupabasePublicConfig(env = process.env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not configured");
  if (!anonKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY is not configured");
  }

  return { url, anonKey };
}
