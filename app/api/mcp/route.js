import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "../../../lib/supabaseServer";
import { userHasWorkspaceAccess, getUserWorkspaces } from "../../../lib/workspace";
import { consumeRateLimit } from "../../../lib/rateLimit.mjs";
import { listCanonicalFields } from "../../../lib/mcpFieldDictionary.mjs";
import {
  getAdAccounts,
  getGa4OverviewForWorkspace,
  getGoogleAdsAccounts,
  getGoogleAdsInsightsForWorkspace,
  getIntegrationsByWorkspace,
  getMetaInsightsForWorkspace,
  getPerformanceOverviewForWorkspace,
  getSnapchatChangeHistoryForWorkspace,
  getSnapchatInsightsForWorkspace
} from "../../../lib/mcpWorkspaceData";
import { MAX_RANGE_DAYS, parseCustomRange } from "../../../lib/mcpDateRange.mjs";
import { MAX_DAILY_RANGE_DAYS } from "../../../lib/snapchatDaily.mjs";
import { ACTION_REPORT_TIMES } from "../../../lib/snapchatApi";
import { GOOGLE_ADS_LEVELS, normalizeCustomerId } from "../../../lib/googleAdsApi.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const PRESETS = ["today", "yesterday", "last_7d", "last_30d", "maximum"];
const RANGE_PROPS = {
  since: { type: "string", description: `Custom range start, YYYY-MM-DD (Asia/Riyadh), inclusive. Give with until; overrides date_preset. Max ${MAX_RANGE_DAYS} days.` },
  until: { type: "string", description: "Custom range end, YYYY-MM-DD (Asia/Riyadh), inclusive. Give with since." }
};
const FIELDS_TOOL = { name: "list_fields", description: "Discover canonical marketing metrics and platform mappings. Mappings do not assert live availability.", inputSchema: { type: "object", properties: { platform: { type: "string", enum: ["snapchat", "meta", "tiktok", "google"] } }, additionalProperties: false } };
const ACCOUNTS_TOOL = { name: "list_accounts", description: "Discover accessible MetricsFlo accounts. Account IDs are workspace UUIDs; missing integration status is null, never invented.", inputSchema: { type: "object", properties: {}, additionalProperties: false } };
const WORKSPACES_TOOL = { name: "list_workspaces", description: "List workspaces available to the authenticated MetricsFlo owner.", inputSchema: { type: "object", properties: {}, additionalProperties: false } };
const TOOL = {
  name: "get_performance_overview",
  description: "Cross-platform performance for a workspace: totals in SAR plus one row per Meta and Snapchat ad account (all connected accounts unless an account ID is given), and GA4. Meta and Snapchat are live from the ad platforms. Accepts a date_preset or a custom since/until range. Never infer missing metrics.",
  inputSchema: {
    type: "object",
    properties: {
      date_preset: { type: "string", enum: PRESETS },
      ...RANGE_PROPS,
      workspace_id: { type: "string", description: "Workspace UUID authorized for this user" },
      snapchat_account_id: { type: "string", description: "Optional Snapchat ad account ID from list_ad_accounts. If omitted, every connected Snapchat account is included." },
      meta_account_id: { type: "string", description: "Optional Meta ad account ID (act_...) from list_ad_accounts. If omitted, every connected Meta account is included." }
    },
    required: ["workspace_id"],
    additionalProperties: false
  }
};
const LIST_AD_ACCOUNTS_TOOL = {
  name: "list_ad_accounts",
  description: "List Meta, Snapchat and Google Ads ad accounts connected to a workspace. Returns account IDs and names needed for get_meta_insights, get_snapchat_insights and get_google_ads_insights. Google Ads accounts are read live from the Google Ads API.",
  inputSchema: {
    type: "object",
    properties: {
      workspace_id: { type: "string", description: "Workspace UUID" }
    },
    required: ["workspace_id"],
    additionalProperties: false
  }
};
const GET_META_INSIGHTS_TOOL = {
  name: "get_meta_insights",
  description: "Live Meta Ads performance (spend, impressions, clicks, purchases, revenue, ROAS, funnel and video metrics) by account, campaign, ad set or ad, for a date preset or a custom since/until range.",
  inputSchema: {
    type: "object",
    properties: {
      workspace_id: { type: "string", description: "Workspace UUID" },
      account_id: { type: "string", description: "Meta ad account ID (e.g. act_123456789) from list_ad_accounts" },
      date_preset: { type: "string", enum: PRESETS },
      ...RANGE_PROPS,
      level: { type: "string", enum: ["account", "campaign", "adset", "ad"], description: "Aggregation level (default: campaign)" }
    },
    required: ["workspace_id", "account_id"],
    additionalProperties: false
  }
};
const GET_SNAPCHAT_INSIGHTS_TOOL = {
  name: "get_snapchat_insights",
  description: "Live Snapchat Ads performance from the Snapchat Marketing API (spend, impressions, swipes, purchases, revenue, ROAS) by account, campaign, ad squad or ad, for a date preset or a custom since/until range. Attribution: 28-day swipe, 1-day view; purchases on the day they happened (conversion time) unless action_report_time is impression.",
  inputSchema: {
    type: "object",
    properties: {
      workspace_id: { type: "string", description: "Workspace UUID" },
      account_id: { type: "string", description: "Snapchat ad account ID from list_ad_accounts" },
      date_preset: { type: "string", enum: PRESETS },
      ...RANGE_PROPS,
      level: { type: "string", enum: ["account", "campaign", "adsquad", "ad"], description: "Aggregation level (default: campaign). adsquad and ad drill down from the campaigns that spent; on large accounts pass campaign_id (or adsquad_id for ads) for complete numbers." },
      campaign_id: { type: "string", description: "Optional: limit adsquad or ad level to this campaign ID (from a campaign-level row)." },
      adsquad_id: { type: "string", description: "Optional: at ad level, only this ad squad's ads; at adsquad level, only this ad squad (e.g. with daily, its days around a budget or bid edit)." },
      daily: { type: "boolean", description: `Optional: add a day-by-day series (date, spend, revenue, purchases, add_to_cart, initiate_checkout, impressions, swipes, roas, cpa, ctr, cpm) to every row and to summary, for lining edits from get_snapchat_change_history up with the days before and after. Core metrics only (no extended). Range up to ${MAX_DAILY_RANGE_DAYS} days; not with date_preset maximum.` },
      action_report_time: { type: "string", enum: ACTION_REPORT_TIMES, description: "Optional: conversion (default) counts a purchase on the day it happened, as Ads Manager does with conversion-time reporting; impression counts it on the day of the ad impression it is attributed to." }
    },
    required: ["workspace_id", "account_id"],
    additionalProperties: false
  }
};
const CHANGE_CATEGORIES = ["budget", "bid", "status", "schedule", "targeting", "optimization", "creative", "name", "other"];
const GET_SNAPCHAT_CHANGE_HISTORY_TOOL = {
  name: "get_snapchat_change_history",
  description: "Live Snapchat change history (Snapchat audit logs): every edit to ad squads (default), campaigns or ads in a date range, with before and after values, who made it and when. Budgets and bids are in account currency, with delta and delta_pct, so budget increases and bid changes can be lined up with get_snapchat_insights.",
  inputSchema: {
    type: "object",
    properties: {
      workspace_id: { type: "string", description: "Workspace UUID" },
      account_id: { type: "string", description: "Snapchat ad account ID from list_ad_accounts" },
      date_preset: { type: "string", enum: PRESETS },
      ...RANGE_PROPS,
      level: { type: "string", enum: ["campaign", "adsquad", "ad"], description: "Which entities' changes to read (default: adsquad). ad needs campaign_id." },
      campaign_id: { type: "string", description: "Optional: only this campaign (its ad squads or ads at those levels)." },
      entity_id: { type: "string", description: "Optional: one campaign or ad squad ID (matching level) for its full history in the range." },
      categories: { type: "array", items: { type: "string", enum: CHANGE_CATEGORIES }, description: "Optional: only these kinds of change, e.g. [\"budget\", \"bid\"]. Default: all." }
    },
    required: ["workspace_id", "account_id"],
    additionalProperties: false
  }
};
const GET_GOOGLE_ADS_INSIGHTS_TOOL = {
  name: "get_google_ads_insights",
  description: "Live Google Ads performance from the Google Ads API (cost, impressions, clicks, CTR, CPC, conversions, conversion value, ROAS, CPA; search impression share per campaign) by account, campaign, ad group, asset group (Performance Max), ad, keyword or search term, for a date preset or a custom since/until range. Money is in the account currency; conversions are the account's primary conversion actions.",
  inputSchema: {
    type: "object",
    properties: {
      workspace_id: { type: "string", description: "Workspace UUID" },
      account_id: { type: "string", description: "Google Ads customer ID (digits, dashes allowed) from list_ad_accounts" },
      date_preset: { type: "string", enum: PRESETS },
      ...RANGE_PROPS,
      level: { type: "string", enum: GOOGLE_ADS_LEVELS, description: "Aggregation level (default: campaign). Performance Max has asset_group instead of ad_group/ad. search_term returns the top 1000 by cost." },
      campaign_id: { type: "string", description: "Optional: only this campaign (digits)." },
      ad_group_id: { type: "string", description: "Optional: only this ad group (digits), for ad, keyword and search_term levels." },
      daily: { type: "boolean", description: `Optional: add a day-by-day series to every row. Range up to ${MAX_DAILY_RANGE_DAYS} days; not with date_preset maximum.` }
    },
    required: ["workspace_id", "account_id"],
    additionalProperties: false
  }
};
const GET_GA4_OVERVIEW_TOOL = {
  name: "get_ga4_overview",
  description: "Fetch Google Analytics 4 website metrics (sessions, users, bounce rate, engagement rate, pageviews, conversions) for a date preset or a custom since/until range.",
  inputSchema: {
    type: "object",
    properties: {
      workspace_id: { type: "string", description: "Workspace UUID" },
      date_preset: { type: "string", enum: PRESETS },
      ...RANGE_PROPS,
      property_id: { type: "string", description: "Optional GA4 property ID (digits). Default: the property selected in MetricsFlo, or the only one on the Google account. If neither exists the error lists the available properties." }
    },
    required: ["workspace_id"],
    additionalProperties: false
  }
};

function rpc(id, result) { return NextResponse.json({ jsonrpc: "2.0", id, result }, { headers: { "Cache-Control": "no-store", "MCP-Protocol-Version": "2025-03-26" } }); }
function fail(id, code, message, status = 400, requestUrl = null) {
  const headers = { "Cache-Control": "no-store" };
  if (status === 401) {
    // RFC 9728: advertise protected-resource metadata to OAuth-capable MCP clients.
    const origin = requestUrl;
    try {
      const url = new URL(origin);
      if (url.protocol === "https:" && !url.username && !url.password && !url.port &&
          (url.hostname === "metricsflo.com" || url.hostname === "www.metricsflo.com" ||
           /^ad-intelligence-platform-[a-z0-9-]+-ahmed-ashraf-projects\.vercel\.app$/.test(url.hostname))) {
        headers["WWW-Authenticate"] = `Bearer resource_metadata="${new URL("/.well-known/oauth-protected-resource/mcp", url)}"`;
      } else {
        headers["WWW-Authenticate"] = "Bearer";
      }
    } catch { headers["WWW-Authenticate"] = "Bearer"; }
  }
  return NextResponse.json({ jsonrpc: "2.0", id, error: { code, message } }, { status, headers });
}

export async function GET(request) {
  // Unauthenticated discovery probes must receive the same OAuth challenge as POST.
  // Do not expose MCP tools or user data on GET.
  return fail(null, -32001, "Bearer authentication required", 401, request.url);
}

export async function POST(request) {
  // Bound the request before parsing untrusted JSON.
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > 8192) return fail(null, -32600, "Request too large", 413);
  let body;
  try {
    const raw = await request.text();
    if (raw.length > 8192) return fail(null, -32600, "Request too large", 413);
    body = JSON.parse(raw);
  } catch { return fail(null, -32700, "Invalid JSON"); }
  const id = body && typeof body === "object" && !Array.isArray(body) ? (body.id ?? null) : null;
  if (body === null || typeof body !== "object" || Array.isArray(body) || body.jsonrpc !== "2.0" || typeof body.method !== "string") return fail(id, -32600, "Invalid JSON-RPC request");

  // Always advertise OAuth to unauthenticated clients before checking deployment policy.
  // The owner policy still fails closed for every authenticated request.
  const authorization = request.headers.get("authorization") || "";
  if (!/^Bearer [^\s]+$/.test(authorization)) return fail(id, -32001, "Bearer authentication required", 401, request.url);
  const ownerId = process.env.METRICSFLO_AI_OWNER_USER_ID;
  if (!ownerId) return fail(id, -32003, "AI integration is disabled", 403);

  // MCP accepts only the explicitly supplied bearer token; never fall back to browser cookies or refresh sessions.
  const token = authorization.slice("Bearer ".length);
  let user;
  try {
    const { data, error } = await createSupabaseAdminClient().auth.getUser(token);
    if (error || !data?.user) return fail(id, -32001, "Invalid or expired access token", 401, request.url);
    user = data.user;
  } catch { return fail(id, -32001, "Invalid or expired access token", 401); }
  if (user.id !== ownerId) return fail(id, -32003, "AI integration is not enabled for this account", 403);

  // Shared database-backed limit, fail closed if storage is unavailable.
  try {
    const quota = await consumeRateLimit({
      scope: "private_mcp",
      identity: user.id,
      limit: 60,
      windowSeconds: 60
    });
    if (!quota.allowed) return fail(id, -32029, "Rate limit exceeded", 429);
  } catch { return fail(id, -32000, "Rate limit storage unavailable", 503); }

  if (body.method === "initialize") {
    if (!body.params || typeof body.params.protocolVersion !== "string") return fail(id, -32602, "Missing MCP protocol version");
    return rpc(id, {
    protocolVersion: "2025-03-26",
    capabilities: { tools: {} },
    serverInfo: { name: "metricsflo-private", version: "0.1.0" }
  });
  }
  if (body.method === "notifications/initialized") return new Response(null, { status: 202, headers: { "Cache-Control": "no-store" } });
  if (body.method === "ping") return rpc(id, {});
  if (body.method === "tools/list") return rpc(id, { tools: [ACCOUNTS_TOOL, FIELDS_TOOL, WORKSPACES_TOOL, TOOL, LIST_AD_ACCOUNTS_TOOL, GET_META_INSIGHTS_TOOL, GET_SNAPCHAT_INSIGHTS_TOOL, GET_SNAPCHAT_CHANGE_HISTORY_TOOL, GET_GOOGLE_ADS_INSIGHTS_TOOL, GET_GA4_OVERVIEW_TOOL] });
  if (body.method !== "tools/call") return fail(id, -32601, "Method not found", 404);

  const { name, arguments: args = {} } = body.params || {};
  if (!args || typeof args !== "object" || Array.isArray(args)) return fail(id, -32602, "Invalid tool arguments");

  const TOOL_ARGS = {
    [FIELDS_TOOL.name]: ["platform"],
    [ACCOUNTS_TOOL.name]: [],
    [WORKSPACES_TOOL.name]: [],
    [TOOL.name]: ["workspace_id", "date_preset", "since", "until", "snapchat_account_id", "meta_account_id"],
    [LIST_AD_ACCOUNTS_TOOL.name]: ["workspace_id"],
    [GET_META_INSIGHTS_TOOL.name]: ["workspace_id", "account_id", "date_preset", "since", "until", "level"],
    [GET_SNAPCHAT_INSIGHTS_TOOL.name]: ["workspace_id", "account_id", "date_preset", "since", "until", "level", "campaign_id", "adsquad_id", "daily", "action_report_time"],
    [GET_SNAPCHAT_CHANGE_HISTORY_TOOL.name]: ["workspace_id", "account_id", "date_preset", "since", "until", "level", "campaign_id", "entity_id", "categories"],
    [GET_GOOGLE_ADS_INSIGHTS_TOOL.name]: ["workspace_id", "account_id", "date_preset", "since", "until", "level", "campaign_id", "ad_group_id", "daily"],
    [GET_GA4_OVERVIEW_TOOL.name]: ["workspace_id", "date_preset", "since", "until", "property_id"]
  };
  const allowedArgs = TOOL_ARGS[name];
  if (!allowedArgs) return fail(id, -32602, "Unknown tool");
  if (Object.keys(args).some((key) => !allowedArgs.includes(key))) return fail(id, -32602, "Unexpected arguments");

  // Tool failures are returned as MCP tool errors (HTTP 200, isError) so the
  // client shows the reason instead of a bare "Bad Gateway".
  const ok = (payload) => rpc(id, { content: [{ type: "text", text: JSON.stringify(payload) }] });
  const toolError = (message) => rpc(id, { isError: true, content: [{ type: "text", text: JSON.stringify({ success: false, error: message }) }] });

  if (name === FIELDS_TOOL.name) {
    try { return ok({ fields: listCanonicalFields(args.platform) }); }
    catch { return fail(id, -32602, "Unsupported platform"); }
  }

  if (name === ACCOUNTS_TOOL.name || name === WORKSPACES_TOOL.name) {
    try {
      const workspaces = await getUserWorkspaces(user.id);
      if (name === WORKSPACES_TOOL.name) return ok(workspaces.map(({ id: wsId, name: wsName, role }) => ({ id: wsId, name: wsName, role })));
      const integrations = await getIntegrationsByWorkspace(workspaces.map((w) => w.id));
      return ok({
        accounts: workspaces.map(({ id: wsId, name: wsName, role, default_currency, timezone }) => ({
          account_id: wsId,
          name: wsName,
          role,
          currency: default_currency || null,
          timezone: timezone || null,
          contribution_margin: null,
          platforms: integrations[wsId] || []
        }))
      });
    } catch (e) { return toolError(`Workspaces unavailable: ${e.message}`); }
  }

  // Every remaining tool is scoped to one workspace the user belongs to.
  const workspaceId = args.workspace_id;
  if (typeof workspaceId !== "string" || !/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(workspaceId)) return fail(id, -32602, "Invalid workspace_id");
  if (!(await userHasWorkspaceAccess(user.id, workspaceId))) return fail(id, -32003, "Workspace access denied", 403);

  const datePreset = args.date_preset ?? "last_30d";
  if (!PRESETS.includes(datePreset)) return fail(id, -32602, "Invalid date_preset");
  const range = parseCustomRange(args.since, args.until);
  if (range?.error) return fail(id, -32602, range.error);
  // What the caller sees as the period of the numbers.
  const period = range ? { date_preset: "custom", date_range: { since: range.since, until: range.until } } : { date_preset: datePreset };

  if (name === LIST_AD_ACCOUNTS_TOOL.name) {
    try {
      const [{ meta, snapchat }, google_ads] = await Promise.all([getAdAccounts(workspaceId), getGoogleAdsAccounts(workspaceId)]);
      return ok({ workspace_id: workspaceId, meta, snapchat, google_ads });
    } catch (e) { return toolError(`Ad accounts unavailable: ${e.message}`); }
  }

  if (name === GET_META_INSIGHTS_TOOL.name || name === GET_SNAPCHAT_INSIGHTS_TOOL.name) {
    const isMeta = name === GET_META_INSIGHTS_TOOL.name;
    const accountId = typeof args.account_id === "string" ? args.account_id.trim() : "";
    const level = args.level ?? "campaign";
    const levels = isMeta ? ["account", "campaign", "adset", "ad"] : ["account", "campaign", "adsquad", "ad"];
    if (!accountId || accountId.length > 100 || !/^[A-Za-z0-9_-]+$/.test(accountId)) return fail(id, -32602, "Invalid account_id");
    if (!levels.includes(level)) return fail(id, -32602, "Invalid level");
    const scope = {};
    for (const [arg, field] of [["campaign_id", "campaignId"], ["adsquad_id", "adsquadId"]]) {
      if (args[arg] === undefined) continue;
      const value = typeof args[arg] === "string" ? args[arg].trim() : "";
      if (!/^[A-Za-z0-9-]{1,64}$/.test(value)) return fail(id, -32602, `Invalid ${arg}`);
      scope[field] = value;
    }
    if (scope.adsquadId && !(level === "ad" || (!isMeta && level === "adsquad"))) return fail(id, -32602, "adsquad_id only applies to levels adsquad and ad");
    if (scope.adsquadId && scope.campaignId && level === "adsquad") return fail(id, -32602, "Give campaign_id or adsquad_id at level adsquad, not both");
    let daily = false;
    if (!isMeta && args.daily !== undefined) {
      // Clients holding an older copy of the tool schema send "true"/"false".
      const value = typeof args.daily === "string" ? args.daily.trim().toLowerCase() : args.daily;
      if (value !== true && value !== false && value !== "true" && value !== "false") return fail(id, -32602, "daily must be true or false");
      daily = value === true || value === "true";
    }
    if (daily && (range ? range.days > MAX_DAILY_RANGE_DAYS : datePreset === "maximum")) {
      return fail(id, -32602, `daily is limited to ${MAX_DAILY_RANGE_DAYS} days; pass a shorter since/until range`);
    }
    if (scope.campaignId && !["adsquad", "ad"].includes(level)) return fail(id, -32602, "campaign_id only applies to levels adsquad and ad");
    let actionReportTime = "conversion";
    if (!isMeta && args.action_report_time !== undefined) {
      const value = typeof args.action_report_time === "string" ? args.action_report_time.trim().toLowerCase() : "";
      if (!ACTION_REPORT_TIMES.includes(value)) return fail(id, -32602, `action_report_time must be one of ${ACTION_REPORT_TIMES.join(", ")}`);
      actionReportTime = value;
    }

    // The account must belong to this workspace.
    let account;
    try {
      const { meta, snapchat } = await getAdAccounts(workspaceId);
      account = (isMeta ? meta : snapchat).accounts.find((a) => a.id === accountId);
    } catch (e) { return toolError(`Ad accounts unavailable: ${e.message}`); }
    if (!account) return toolError(`${isMeta ? "Meta" : "Snapchat"} account ${accountId} is not connected to this workspace. Use list_ad_accounts to see valid IDs.`);

    const platform = isMeta ? "meta" : "snapchat";
    try {
      const result = isMeta
        ? await getMetaInsightsForWorkspace({ workspaceId, accountId, datePreset, level, range })
        : await getSnapchatInsightsForWorkspace({ workspaceId, accountId, datePreset, level, range, ...scope, ...(daily ? { daily } : {}), actionReportTime });
      if (!result.success) return ok({ success: false, platform, account_id: accountId, ...period, message: result.message });

      if (isMeta) {
        return ok({
          success: true,
          platform,
          account_id: accountId,
          account_name: account.name,
          ...period,
          level,
          currency: result.currency || account.currency || null,
          summary: result.summary,
          rows: result.data.map((r) => ({
            id: r.ad_id || r.adset_id || r.campaign_id || r.account_id,
            name: r.ad_name || r.adset_name || r.campaign_name || r.account_name,
            ...(level !== "campaign" && level !== "account" ? { campaign_name: r.campaign_name } : {}),
            ...(level === "ad" ? { adset_name: r.adset_name } : {}),
            spend: Number(r.spend || 0),
            impressions: Number(r.impressions || 0),
            reach: Number(r.reach || 0),
            frequency: Number(r.frequency || 0),
            clicks: Number(r.clicks || 0),
            link_clicks: Number(r.inline_link_clicks || 0),
            ctr: Number(r.ctr || 0),
            cpc: Number(r.cpc || 0),
            cpm: Number(r.cpm || 0),
            landing_page_views: r.landing_page_views,
            view_content: r.view_content,
            add_to_cart: r.add_to_cart,
            initiate_checkout: r.initiate_checkout,
            purchases: r.purchases,
            revenue: r.purchase_value,
            roas: r.roas,
            cpa: r.cpa,
            hook_rate: r.hook_rate,
            hold_rate: r.hold_rate,
            date_start: r.date_start,
            date_stop: r.date_stop
          })),
          pages_loaded: result.pages_loaded
        });
      }

      const common = {
        success: true,
        platform,
        source: result.source,
        account_id: accountId,
        account_name: account.name,
        ...period,
        level,
        currency: result.summary?.currency || account.currency || "USD",
        summary: result.summary
      };
      if (result.source === "live") {
        return ok({
          ...common,
          rows: result.rows,
          total_rows: result.rows.length,
          complete: result.complete,
          account_spend: result.account_spend,
          spend_coverage_pct: result.spend_coverage_pct,
          entities_total: result.entities_total,
          entities_skipped_out_of_range: result.entities_skipped_out_of_range,
          entities_checked: result.entities_checked,
          entities_unchecked: result.entities_unchecked,
          failed_requests: result.failed_requests,
          parents_unlisted: result.parents_unlisted,
          upstream_incomplete: result.upstream_incomplete,
          ...(result.missing_campaigns ? { missing_campaigns: result.missing_campaigns, missing_campaigns_total: result.missing_campaigns_total } : {}),
          ...(daily ? { daily: true } : {}),
          ...(result.ads_manager_note ? { ads_manager_note: result.ads_manager_note } : {}),
          extended_metrics: result.extended_metrics,
          ...(scope.campaignId ? { campaign_id: scope.campaignId } : {}),
          ...(scope.adsquadId ? { adsquad_id: scope.adsquadId } : {}),
          ...(result.complete
            ? {}
            : { note: result.missing_campaigns?.length
                ? "Not every entity could be checked in time. summary covers the checked entities only (spend_coverage_pct of account_spend). missing_campaigns lists the campaigns whose ad squads are not fully covered: ask again with campaign_id for each to complete them."
                : "Not every entity could be checked in time. summary covers the checked entities only (spend_coverage_pct of account_spend); pass campaign_id (or adsquad_id for ads) or a shorter date range for full coverage." }),
          attribution: result.attribution,
          start_time: result.start_time,
          end_time: result.end_time
        });
      }
      return ok({
        ...common,
        rows: result.rows.map(({ raw, ...r }) => r),
        total_rows: result.total_rows,
        has_more: result.has_more,
        snapshot_date: result.metric_date,
        last_synced_at: result.last_synced_at,
        is_cached_data: true,
        live_error: result.live_error,
        note: "The live Snapchat request failed, so these numbers are the most recent MetricsFlo sync for this date preset."
      });
    } catch (e) {
      return toolError(`${isMeta ? "Meta" : "Snapchat"} insights unavailable: ${e.message}`);
    }
  }

  if (name === GET_SNAPCHAT_CHANGE_HISTORY_TOOL.name) {
    const accountId = typeof args.account_id === "string" ? args.account_id.trim() : "";
    if (!accountId || accountId.length > 100 || !/^[A-Za-z0-9_-]+$/.test(accountId)) return fail(id, -32602, "Invalid account_id");
    const level = args.level ?? "adsquad";
    if (!["campaign", "adsquad", "ad"].includes(level)) return fail(id, -32602, "Invalid level");
    const ids = {};
    for (const arg of ["campaign_id", "entity_id"]) {
      if (args[arg] === undefined) continue;
      const value = typeof args[arg] === "string" ? args[arg].trim() : "";
      if (!/^[A-Za-z0-9-]{1,64}$/.test(value)) return fail(id, -32602, `Invalid ${arg}`);
      ids[arg] = value;
    }
    if (ids.entity_id && level === "ad") return fail(id, -32602, "entity_id applies to levels campaign and adsquad");
    if (level === "ad" && !ids.campaign_id) return fail(id, -32602, "level ad needs campaign_id");
    let categories = [];
    if (args.categories !== undefined) {
      if (!Array.isArray(args.categories) || args.categories.some((c) => !CHANGE_CATEGORIES.includes(c))) return fail(id, -32602, "Invalid categories");
      categories = [...new Set(args.categories)];
    }
    let account;
    try {
      const { snapchat } = await getAdAccounts(workspaceId);
      account = snapchat.accounts.find((a) => a.id === accountId);
    } catch (e) { return toolError(`Ad accounts unavailable: ${e.message}`); }
    if (!account) return toolError(`Snapchat account ${accountId} is not connected to this workspace. Use list_ad_accounts to see valid IDs.`);
    try {
      const result = await getSnapchatChangeHistoryForWorkspace({
        workspaceId, accountId, datePreset, range, level, categories,
        campaignId: ids.campaign_id || "", entityId: ids.entity_id || ""
      });
      if (!result.success) return ok({ success: false, platform: "snapchat", account_id: accountId, ...period, message: result.message });
      const { success, ...history } = result;
      return ok({
        success: true,
        platform: "snapchat",
        source: "live",
        account_id: accountId,
        account_name: account.name,
        currency: account.currency || null,
        ...period,
        ...(categories.length ? { categories } : {}),
        ...history,
        ...(history.complete ? {} : { note: "Some entities could not be checked in time or failed; pass campaign_id or entity_id, or a shorter range, for full coverage." }),
        money_note: "Budget and bid values (fields ending in _micro in Snapchat) are converted to account currency."
      });
    } catch (e) {
      return toolError(`Snapchat change history unavailable: ${e.message}`);
    }
  }

  if (name === GET_GOOGLE_ADS_INSIGHTS_TOOL.name) {
    const accountId = normalizeCustomerId(typeof args.account_id === "string" ? args.account_id.trim() : "");
    if (!accountId) return fail(id, -32602, "Invalid account_id");
    const level = args.level ?? "campaign";
    if (!GOOGLE_ADS_LEVELS.includes(level)) return fail(id, -32602, "Invalid level");
    const scope = {};
    for (const [arg, field] of [["campaign_id", "campaignId"], ["ad_group_id", "adGroupId"]]) {
      if (args[arg] === undefined) continue;
      const value = typeof args[arg] === "string" ? args[arg].trim() : "";
      if (!/^\d{1,20}$/.test(value)) return fail(id, -32602, `Invalid ${arg}`);
      scope[field] = value;
    }
    if (scope.campaignId && level === "account") return fail(id, -32602, "campaign_id does not apply to level account");
    if (scope.adGroupId && !["ad", "keyword", "search_term", "ad_group"].includes(level)) return fail(id, -32602, "ad_group_id applies to levels ad_group, ad, keyword and search_term");
    let daily = false;
    if (args.daily !== undefined) {
      const value = typeof args.daily === "string" ? args.daily.trim().toLowerCase() : args.daily;
      if (value !== true && value !== false && value !== "true" && value !== "false") return fail(id, -32602, "daily must be true or false");
      daily = value === true || value === "true";
    }
    if (daily && (range ? range.days > MAX_DAILY_RANGE_DAYS : datePreset === "maximum")) {
      return fail(id, -32602, `daily is limited to ${MAX_DAILY_RANGE_DAYS} days; pass a shorter since/until range`);
    }

    let accounts;
    try { accounts = await getGoogleAdsAccounts(workspaceId); }
    catch (e) { return toolError(`Google Ads accounts unavailable: ${e.message}`); }
    if (!accounts.connected) return ok({ success: false, platform: "google_ads", account_id: accountId, ...period, message: "Google Ads is not connected for this workspace. Connect it on the Connections page in MetricsFlo." });
    const account = accounts.accounts.find((a) => a.id === accountId);
    if (!account) return toolError(`Google Ads account ${accountId} is not reachable from this workspace's Google login${accounts.discovery_error ? ` (${accounts.discovery_error})` : ""}. Use list_ad_accounts to see valid IDs.`);

    try {
      const result = await getGoogleAdsInsightsForWorkspace({ workspaceId, account, datePreset, level, range, daily, ...scope });
      if (!result.success) return ok({ success: false, platform: "google_ads", account_id: accountId, ...period, message: result.message });
      const { success, since, until, summary, rows } = result;
      const text = JSON.stringify({
        success: true,
        platform: "google_ads",
        source: "live",
        account_id: accountId,
        account_name: account.name,
        currency: account.currency || null,
        time_zone: account.time_zone || null,
        ...period,
        date_range: { since, until },
        level,
        summary,
        rows
      });
      if (text.length > 512000) return toolError("Google Ads report too large; pass campaign_id or ad_group_id, or a shorter range");
      return rpc(id, { content: [{ type: "text", text }] });
    } catch (e) {
      return toolError(`Google Ads data unavailable: ${e.message}`);
    }
  }

  if (name === GET_GA4_OVERVIEW_TOOL.name) {
    try {
      let propertyId = "";
      if (args.property_id !== undefined) {
        propertyId = typeof args.property_id === "string" ? args.property_id.trim().replace(/^properties\//, "") : "";
        if (!/^\d{1,20}$/.test(propertyId)) return fail(id, -32602, "Invalid property_id");
      }
      const result = await getGa4OverviewForWorkspace({ workspaceId, datePreset, range, propertyId });
      return ok({ platform: "ga4", ...period, ...result });
    } catch (e) { return toolError(`GA4 data unavailable: ${e.message}`); }
  }

  // get_performance_overview
  const clean = (value) => (typeof value === "string" ? value.trim() : "");
  try {
    const overview = await getPerformanceOverviewForWorkspace({
      workspaceId,
      datePreset,
      range,
      metaAccountId: clean(args.meta_account_id),
      snapchatAccountId: clean(args.snapchat_account_id)
    });
    const text = JSON.stringify(overview);
    if (text.length > 512000) return toolError("Overview too large; pass meta_account_id or snapchat_account_id to narrow it");
    return rpc(id, { content: [{ type: "text", text }] });
  } catch (e) {
    return toolError(`Performance overview unavailable: ${e.message}`);
  }
}
