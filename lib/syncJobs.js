import { createHash } from "node:crypto";
import { createSupabaseAdminClient } from "./supabaseServer";
import { requireWorkspaceScope } from "./tenantFoundation.mjs";
import { isFreshSyncJob } from "./syncJobFreshness.mjs";

const ACTIVE_STATUSES = ["queued", "running"];

function buildRequestKey({ workspaceId, provider, accountId, params }) {
  const normalized = JSON.stringify({
    workspaceId,
    provider,
    accountId: accountId || "",
    params: params || {}
  });

  return createHash("sha256").update(normalized).digest("hex");
}

export async function createOrReuseSyncJob({
  workspaceId,
  userId,
  provider,
  accountId = "",
  params = {}
}) {
  requireWorkspaceScope(workspaceId);
  const admin = createSupabaseAdminClient();
  const requestKey = buildRequestKey({
    workspaceId,
    provider,
    accountId,
    params
  });

  const { data: active, error: activeError } = await admin
    .from("provider_sync_jobs")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("request_key", requestKey)
    .in("status", ACTIVE_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (activeError) throw new Error(activeError.message);
  if (active && isFreshSyncJob(active)) return { job: active, reused: true };

  if (active) {
    const completedAt = new Date().toISOString();
    const { error: expireError } = await admin
      .from("provider_sync_jobs")
      .update({
        status: "failed",
        progress: 100,
        error: "Synchronization expired after 30 minutes without completing.",
        completed_at: completedAt,
        updated_at: completedAt
      })
      .eq("id", active.id)
      .in("status", ACTIVE_STATUSES);

    if (expireError) throw new Error(expireError.message);
  }

  const { data, error } = await admin
    .from("provider_sync_jobs")
    .insert({
      workspace_id: workspaceId,
      user_id: userId,
      provider,
      account_id: accountId || null,
      request_key: requestKey,
      request_params: params || {},
      status: "queued",
      progress: 0
    })
    .select("*")
    .single();

  if (error?.code === "23505") {
    const { data: racedJob, error: racedError } = await admin
      .from("provider_sync_jobs")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("request_key", requestKey)
      .in("status", ACTIVE_STATUSES)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (racedError) throw new Error(racedError.message);
    return { job: racedJob, reused: true };
  }

  if (error) throw new Error(error.message);
  return { job: data, reused: false };
}

export async function attachWorkflowRun(jobId, runId) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("provider_sync_jobs")
    .update({
      run_id: runId,
      updated_at: new Date().toISOString()
    })
    .eq("id", jobId)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function getSyncJobForWorkspace({ jobId, workspaceId }) {
  requireWorkspaceScope(workspaceId);
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("provider_sync_jobs")
    .select("*")
    .eq("id", jobId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data || null;
}

export async function getSyncJobById(jobId) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("provider_sync_jobs")
    .select("*")
    .eq("id", jobId)
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function updateSyncJob(jobId, updates) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("provider_sync_jobs")
    .update({
      ...updates,
      updated_at: new Date().toISOString()
    })
    .eq("id", jobId)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data;
}
