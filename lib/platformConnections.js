import { createSupabaseAdminClient } from "./supabaseServer";
import { getActiveWorkspace } from "./workspace";
import { requireWorkspaceScope } from "./tenantFoundation.mjs";

export async function getActiveWorkspaceContext(request) {
  const { user, workspace } = await getActiveWorkspace(request);

  if (!workspace?.id) {
    const error = new Error("No active workspace found");
    error.status = 403;
    throw error;
  }

  return {
    user,
    workspace
  };
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

  return {
    user,
    workspace,
    connection: data || null
  };
}

export async function findPlatformConnection({
  workspaceId,
  provider,
  accountId
}) {
  const admin = createSupabaseAdminClient();

  const { data, error } = await admin
    .from("platform_connections")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("provider", provider)
    .eq("account_id", accountId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data || null;
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
  metadata = {},
  isActive = true
}) {
  const { user, workspace } = await getActiveWorkspaceContext(request);
  const admin = createSupabaseAdminClient();

  const safeAccountId = accountId || `${provider}_default`;
  const safeAccountName = accountName || safeAccountId;

  const payload = {
    workspace_id: workspace.id,
    user_id: user.id,
    provider,
    account_id: safeAccountId,
    account_name: safeAccountName,
    account_currency: accountCurrency || "SAR",
    access_token: accessToken || null,
    refresh_token: refreshToken || null,
    token_type: tokenType || "Bearer",
    expires_at: expiresAt,
    scopes: Array.isArray(scopes) ? scopes : [],
    metadata: metadata || {},
    is_active: isActive,
    updated_at: new Date().toISOString()
  };

  const existing = await findPlatformConnection({
    workspaceId: workspace.id,
    provider,
    accountId: safeAccountId
  });

  if (existing?.id) {
    const { data, error } = await admin
      .from("platform_connections")
      .update(payload)
      .eq("id", existing.id)
      .eq("workspace_id", workspace.id)
      .select("*")
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return {
      user,
      workspace,
      connection: data
    };
  }

  const { data, error } = await admin
    .from("platform_connections")
    .insert({
      ...payload,
      created_at: new Date().toISOString()
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return {
    user,
    workspace,
    connection: data
  };
}

export async function updatePlatformConnection({
  workspaceId,
  connectionId,
  updates
}) {
  requireWorkspaceScope(workspaceId);
  const admin = createSupabaseAdminClient();

  const { data, error } = await admin
    .from("platform_connections")
    .update({
      ...updates,
      updated_at: new Date().toISOString()
    })
    .eq("id", connectionId)
    .eq("workspace_id", workspaceId)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function deactivatePlatformConnection({
  request,
  provider,
  accountId = ""
}) {
  const { workspace } = await getActiveWorkspaceContext(request);
  const admin = createSupabaseAdminClient();

  let query = admin
    .from("platform_connections")
    .update({
      is_active: false,
      updated_at: new Date().toISOString()
    })
    .eq("workspace_id", workspace.id)
    .eq("provider", provider);

  if (accountId) {
    query = query.eq("account_id", accountId);
  }

  const { error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return {
    success: true
  };
}
