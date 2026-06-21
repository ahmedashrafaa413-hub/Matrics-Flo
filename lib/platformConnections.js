import { createSupabaseAdminClient } from "./supabaseServer";
import { getActiveWorkspace } from "./workspace";

export async function getActiveWorkspaceContext(request) {
  const { user, workspace } = await getActiveWorkspace(request);

  if (!workspace?.id) {
    const error = new Error("No active workspace found");
    error.status = 403;
    throw error;
  }

  return { user, workspace };
}

export async function getPlatformConnection({
  request,
  provider,
  accountId = "",
  requireConnected = true
}) {
  const { user, workspace } = await getActiveWorkspaceContext(request);
  const admin = createSupabaseAdminClient();

  let query = admin
    .from("platform_connections")
    .select("*")
    .eq("workspace_id", workspace.id)
    .eq("provider", provider)
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (accountId) {
    query = query.eq("account_id", accountId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data && requireConnected) {
    const connectionError = new Error(
      `${provider} is not connected for this workspace`
    );
    connectionError.status = 404;
    throw connectionError;
  }

  return { user, workspace, connection: data || null };
}

export async function upsertPlatformConnection({
  request,
  provider,
  accountId = "",
  accountName = "",
  accountCurrency = "SAR",
  accessToken = "",
  refreshToken = "",
  tokenType = "Bearer",
  expiresAt = null,
  scopes = [],
  metadata = {}
}) {
  const { user, workspace } = await getActiveWorkspaceContext(request);
  const admin = createSupabaseAdminClient();

  const safeAccountId = accountId || `${provider}_default`;

  const payload = {
    workspace_id: workspace.id,
    user_id: user.id,
    provider,
    account_id: safeAccountId,
    account_name: accountName || safeAccountId,
    account_currency: accountCurrency || "SAR",
    access_token: accessToken || null,
    refresh_token: refreshToken || null,
    token_type: tokenType || "Bearer",
    expires_at: expiresAt,
    scopes: Array.isArray(scopes) ? scopes : [],
    metadata: metadata || {},
    is_active: true,
    updated_at: new Date().toISOString()
  };

  const { data, error } = await admin
    .from("platform_connections")
    .upsert(payload, {
      onConflict: "workspace_id,provider,account_id"
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return { user, workspace, connection: data };
}

export async function updatePlatformConnection(connectionId, updates) {
  const admin = createSupabaseAdminClient();

  const { data, error } = await admin
    .from("platform_connections")
    .update({
      ...updates,
      updated_at: new Date().toISOString()
    })
    .eq("id", connectionId)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}
