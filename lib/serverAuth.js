import { createSupabaseAdminClient, getServerAccessToken } from "./supabaseServer";

export async function getCurrentUser(request) {
  const token = getServerAccessToken(request);

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

export async function requireUser(request) {
  const { user, error } = await getCurrentUser(request);

  if (!user) {
    const authError = new Error(error || "Unauthorized");
    authError.status = 401;
    throw authError;
  }

  return user;
}
