import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createSupabaseAdminClient } from "../../../../lib/supabaseServer";
import { startProviderSync } from "../../../../lib/startProviderSync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Presets the dashboards read most. "today" is refreshed by the Snapchat page
// itself every 15 minutes while it is open.
const SNAPCHAT_PRESETS = ["yesterday", "last_7d", "last_30d"];
const SNAPCHAT_LEVELS = ["account", "campaign"];

function todayIn(timeZone = "Asia/Riyadh") {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function isAuthorized(request) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return false;

  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get("authorization") || "");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

// Vercel Cron calls this once a day (vercel.json) with
// `Authorization: Bearer $CRON_SECRET`. It queues one background sync job per
// connected Snapchat ad account and preset, plus one per Salla store; the
// jobs run in the Workflow runtime, so this request returns quickly.
export async function GET(request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const { data: connections, error } = await admin
    .from("platform_connections")
    .select("workspace_id, user_id, provider, account_id, metadata")
    .eq("is_active", true)
    .in("provider", ["snapchat", "salla"]);

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  const { data: workspaces, error: workspaceError } = await admin
    .from("workspaces")
    .select("id, timezone");

  if (workspaceError) {
    return NextResponse.json(
      { success: false, error: workspaceError.message },
      { status: 500 }
    );
  }

  const timeZoneByWorkspace = new Map(
    (workspaces || []).map((workspace) => [workspace.id, workspace.timezone])
  );

  const jobs = [];
  for (const connection of connections || []) {
    if (connection.metadata?.needs_reconnect) continue;

    if (
      connection.provider === "snapchat" &&
      connection.metadata?.connection_type === "snapchat_ad_account"
    ) {
      const metricDate = todayIn(timeZoneByWorkspace.get(connection.workspace_id));
      for (const datePreset of SNAPCHAT_PRESETS) {
        jobs.push({
          workspaceId: connection.workspace_id,
          provider: "snapchat",
          accountId: connection.account_id,
          params: {
            datePreset,
            metricDate,
            levels: SNAPCHAT_LEVELS,
            limit: 20,
            candidateLimit: 500,
            swipeWindow: "28_DAY",
            viewWindow: "1_DAY"
          }
        });
      }
    }

    if (
      connection.provider === "salla" &&
      connection.account_id === "salla_default" &&
      connection.user_id
    ) {
      jobs.push({
        workspaceId: connection.workspace_id,
        provider: "salla",
        accountId: "",
        // salla_orders.user_id is required; attribute the run to whoever
        // connected the store.
        userId: connection.user_id,
        params: {}
      });
    }
  }

  const results = [];
  for (const job of jobs) {
    try {
      const started = await startProviderSync({ userId: null, ...job });
      results.push({ ...job, job_id: started.job.id, reused: started.reused });
    } catch (startError) {
      results.push({ ...job, error: startError.message });
    }
  }

  const failed = results.filter((result) => result.error);
  console.log(
    `[cron/sync] queued=${results.length - failed.length} failed=${failed.length}`
  );

  return NextResponse.json({
    success: failed.length === 0,
    queued: results.length - failed.length,
    failed: failed.map(({ workspaceId, provider, accountId, error: message }) => ({
      workspace_id: workspaceId,
      provider,
      account_id: accountId,
      error: message
    }))
  });
}
