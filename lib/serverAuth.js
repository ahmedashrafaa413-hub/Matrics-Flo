import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import {
  createSupabaseAdminClient,
  getServerAccessToken
} from "./supabaseServer";

const ACCESS_COOKIE = "sb-access-token";
const LEGACY_ACCESS_COOKIE = "supabase-access-token";
const REFRESH_COOKIE = "sb-refresh-token";

function getCookieOptions(maxAge) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge
  };
}

function getSupabasePublicClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not configured");
  }

  if (!anonKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY is not configured");
  }

  return createClient(supabaseUrl, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

function saveServerSessionCookies(session) {
  if (!session?.access_token) return;

  const cookieStore = cookies();
  const expiresIn = Number(session.expires_in || 60 * 60);

  cookieStore.set(
    ACCESS_COOKIE,
    session.access_token,
    getCookieOptions(expiresIn)
  );

  cookieStore.set(
    LEGACY_ACCESS_COOKIE,
    session.access_token,
    getCookieOptions(expiresIn)
  );

  if (session.refresh_token) {
    cookieStore.set(
      REFRESH_COOKIE,
      session.refresh_token,
      getCookieOptions(60 * 60 * 24 * 180)
    );
  }
}

function clearServerSessionCookies() {
  const cookieStore = cookies();

  cookieStore.delete(ACCESS_COOKIE);
  cookieStore.delete(LEGACY_ACCESS_COOKIE);
  cookieStore.delete(REFRESH_COOKIE);
}

function getRefreshTokenFromCookies() {
  return cookies().get(REFRESH_COOKIE)?.value || "";
}

async function refreshServerSession() {
  const refreshToken = getRefreshTokenFromCookies();

  if (!refreshToken) {
    return {
      accessToken: "",
      error: "Missing refresh token"
    };
  }

  const supabase = getSupabasePublicClient();

  const { data, error } = await supabase.auth.refreshSession({
    refresh_token: refreshToken
  });

  if (error || !data?.session?.access_token) {
    clearServerSessionCookies();

    return {
      accessToken: "",
      error: error?.message || "Failed to refresh session"
    };
  }

  saveServerSessionCookies(data.session);

  return {
    accessToken: data.session.access_token,
    error: null
  };
}

async function getUserFromAccessToken(accessToken) {
  if (!accessToken) {
    return {
      user: null,
      error: "Missing access token"
    };
  }

  const admin = createSupabaseAdminClient();

  const { data, error } = await admin.auth.getUser(accessToken);

  if (error || !data?.user) {
    return {
      user: null,
      error: error?.message || "Invalid access token"
    };
  }

  return {
    user: data.user,
    error: null
  };
}

function shouldTryRefresh(errorMessage) {
  const message = String(errorMessage || "").toLowerCase();

  return (
    message.includes("jwt") ||
    message.includes("expired") ||
    message.includes("invalid") ||
    message.includes("missing access token") ||
    message.includes("unable to parse") ||
    message.includes("signature") ||
    message.includes("token")
  );
}

export async function getCurrentUser(request) {
  const accessToken = getServerAccessToken(request);

  const firstAttempt = await getUserFromAccessToken(accessToken);

  if (firstAttempt.user) {
    return {
      user: firstAttempt.user,
      error: null
    };
  }

  if (!shouldTryRefresh(firstAttempt.error)) {
    return firstAttempt;
  }

  const refreshed = await refreshServerSession();

  if (!refreshed.accessToken) {
    return {
      user: null,
      error: refreshed.error || firstAttempt.error || "Unauthorized"
    };
  }

  const secondAttempt = await getUserFromAccessToken(refreshed.accessToken);

  if (secondAttempt.user) {
    return {
      user: secondAttempt.user,
      error: null
    };
  }

  clearServerSessionCookies();

  return {
    user: null,
    error: secondAttempt.error || "Unauthorized"
  };
}

export async function requireUser(request) {
  const { user, error } = await getCurrentUser(request);

  if (!user) {
    const authError = new Error(error || "Unauthorized");
    authError.status = 401;
    throw authError;
  }

  return user;
}
