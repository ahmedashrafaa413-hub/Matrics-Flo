import { cookies } from "next/headers";
import { createSupabaseAdminClient, createSupabaseServerClient } from "./supabaseServer";

export function getAccessTokenFromCookies() {
  const cookieStore = cookies();

  return (
    cookieStore.get("sb-access-token")?.value ||
    cookieStore.get("supabase-access-token")?.value ||
    cookieStore.get("access_token")?.value ||
    ""
  );
}

export async function getCurrentUser() {
  const token = getAccessTokenFromCookies();

  if (!token) {
    return {
      user: null,
      error: "Missing access token"
    };
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.auth.getUser(token);

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

export async function requireUser() {
  const { user, error } = await getCurrentUser();

  if (!user) {
    const authError = new Error(error || "Unauthorized");
    authError.status = 401;
    throw authError;
  }

  return user;
}

export async function getUserScopedSupabase() {
  const user = await requireUser();
  const supabase = createSupabaseServerClient();

  return {
    user,
    supabase
  };
}

export function authErrorResponse(error) {
  const status = error?.status || 500;

  return Response.json(
    {
      success: false,
      error: error?.message || "Server error"
    },
    {
      status
    }
  );
}
