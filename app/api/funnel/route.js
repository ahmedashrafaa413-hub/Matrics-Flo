// Data for the /funnel dashboard: live Snapchat rows at campaign, ad squad or
// ad level for the signed-in user's active workspace, plus GA4 sessions.
// Read-only: it only reads stats from Snapchat and GA4, never edits accounts.
//
//   GET /api/funnel?view=accounts
//   GET /api/funnel?view=snapchat&account_id=..&level=adsquad&date_preset=last_7d
//       [&since=YYYY-MM-DD&until=YYYY-MM-DD][&campaign_id=..][&adsquad_id=..]
//   GET /api/funnel?view=ga4&date_preset=last_7d [&since&until]

import { NextResponse } from "next/server";
import { getActiveWorkspace } from "../../../lib/workspace";
import {
  getAdAccounts,
  getGa4OverviewForWorkspace,
  getSnapchatInsightsForWorkspace
} from "../../../lib/mcpWorkspaceData";
import { parseCustomRange } from "../../../lib/mcpDateRange.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const PRESETS = ["today", "yesterday", "last_7d", "last_30d"];
const LEVELS = ["campaign", "adsquad", "ad"];
const ID_RE = /^[A-Za-z0-9-]{1,64}$/;

function json(payload, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

function readRange(params) {
  const since = params.get("since");
  const until = params.get("until");
  if (since || until) {
    const range = parseCustomRange(since ?? undefined, until ?? undefined);
    if (range?.error) return { error: range.error };
    return { range, datePreset: null };
  }
  const datePreset = params.get("date_preset") || "last_7d";
  if (!PRESETS.includes(datePreset)) return { error: "Invalid date_preset" };
  return { range: null, datePreset };
}

export async function GET(request) {
  let workspaceId;
  try {
    const { workspace } = await getActiveWorkspace(request);
    workspaceId = workspace.id;
  } catch (error) {
    return json({ success: false, error: error.message || "Unauthorized" }, error.status || 401);
  }

  const params = new URL(request.url).searchParams;
  const view = params.get("view") || "snapchat";

  if (view === "accounts") {
    try {
      const { snapchat } = await getAdAccounts(workspaceId, { discoverLive: false });
      return json({ success: true, connected: snapchat.connected, accounts: snapchat.accounts });
    } catch (error) {
      return json({ success: false, error: error.message }, 500);
    }
  }

  const { range, datePreset, error: rangeError } = readRange(params);
  if (rangeError) return json({ success: false, error: rangeError }, 400);

  if (view === "ga4") {
    try {
      const result = await getGa4OverviewForWorkspace({ workspaceId, datePreset: datePreset || "last_30d", range });
      return json(result.success ? result : { success: false, error: result.message }, result.success ? 200 : 200);
    } catch (error) {
      return json({ success: false, error: error.message }, 500);
    }
  }

  if (view !== "snapchat") return json({ success: false, error: "Invalid view" }, 400);

  const accountId = params.get("account_id") || "";
  if (!ID_RE.test(accountId)) return json({ success: false, error: "Invalid account_id" }, 400);
  const level = params.get("level") || "adsquad";
  if (!LEVELS.includes(level)) return json({ success: false, error: "Invalid level" }, 400);
  const scope = {};
  for (const [arg, key] of [["campaign_id", "campaignId"], ["adsquad_id", "adsquadId"]]) {
    const value = params.get(arg);
    if (!value) continue;
    if (!ID_RE.test(value)) return json({ success: false, error: `Invalid ${arg}` }, 400);
    scope[key] = value;
  }
  if (level === "campaign" && (scope.campaignId || scope.adsquadId)) {
    return json({ success: false, error: "campaign_id and adsquad_id apply to levels adsquad and ad" }, 400);
  }

  let account;
  try {
    const { snapchat } = await getAdAccounts(workspaceId, { discoverLive: false });
    account = snapchat.accounts.find((a) => a.id === accountId);
  } catch (error) {
    return json({ success: false, error: error.message }, 500);
  }
  if (!account) return json({ success: false, error: "This Snapchat account is not connected to the current workspace." }, 404);

  try {
    const result = await getSnapchatInsightsForWorkspace({
      workspaceId,
      accountId,
      datePreset: datePreset || "last_7d",
      level,
      range,
      ...scope,
      actionReportTime: "conversion",
      timeBudgetMs: 48000
    });
    if (!result.success) return json({ success: false, error: result.message }, 502);
    if (result.source !== "live") return json({ success: false, error: `Snapchat live request failed: ${result.live_error || "unknown error"}` }, 502);
    return json({
      success: true,
      account: { id: account.id, name: account.name, currency: result.summary?.currency || account.currency || "USD" },
      level,
      date_preset: range ? null : datePreset,
      since: range?.since || null,
      until: range?.until || null,
      start_time: result.start_time,
      end_time: result.end_time,
      summary: result.summary,
      rows: result.rows,
      complete: result.complete,
      spend_coverage_pct: result.spend_coverage_pct,
      account_spend: result.account_spend,
      missing_campaigns: result.missing_campaigns || null,
      attribution: result.attribution,
      ...scope
    });
  } catch (error) {
    return json({ success: false, error: error.message }, 500);
  }
}
