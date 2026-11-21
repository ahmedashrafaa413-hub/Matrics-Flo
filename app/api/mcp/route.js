import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "../../../lib/supabaseServer";
import { userHasWorkspaceAccess, getUserWorkspaces } from "../../../lib/workspace";
import { consumeRateLimit } from "../../../lib/rateLimit.mjs";
import { listCanonicalFields } from "../../../lib/mcpFieldDictionary.mjs";
import {
  getAdAccounts,
  getGa4OverviewForWorkspace,
  getIntegrationsByWorkspace,
  getMetaInsightsForWorkspace,
  getPerformanceOverviewForWorkspace,
  getSnapchatInsightsForWorkspace
} from "../../../lib/mcpWorkspaceData";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const PRESETS = ["today", "yesterday", "last_7d", "last_30d", "maximum"];
const FIELDS_TOOL = { name: "list_fields", description: "Discover canonical marketing metrics and platform mappings. Mappings do not assert live availability.", inputSchema: { type: "object", properties: { platform: { type: "string", enum: ["snapchat", "meta", "tiktok", "google"] } }, additionalProperties: false } };
const ACCOUNTS_TOOL = { name: "list_accounts", description: "Discover accessible MetricsFlo accounts. Account IDs are workspace UUIDs; missing integration status is null, never invented.", inputSchema: { type: "object", properties: {}, additionalProperties: false } };
const WORKSPACES_TOOL = { name: "list_workspaces", description: "List workspaces available to the authenticated MetricsFlo owner.", inputSchema: { type: "object", properties: {}, additionalProperties: false } };
const TOOL = {
  name: "get_performance_overview",
  description: "Cross-platform performance for a workspace: totals in SAR plus one row per Meta and Snapchat ad account (all connected accounts unless an account ID is given), and GA4. Meta is live; Snapchat is the last synced snapshot. Never infer missing metrics.",
  inputSchema: {
    type: "object",
    properties: {
      date_preset: { type: "string", enum: PRESETS },
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
  description: "List Meta and Snapchat ad accounts connected to a workspace. Returns account IDs and names needed for get_meta_insights and get_snapchat_insights.",
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
  description: "Live Meta Ads performance (spend, impressions, clicks, purchases, revenue, ROAS, funnel and video metrics) by account, campaign, ad set or ad for a date preset.",
  inputSchema: {
    type: "object",
    properties: {
      workspace_id: { type: "string", description: "Workspace UUID" },
      account_id: { type: "string", description: "Meta ad account ID (e.g. act_123456789) from list_ad_accounts" },
      date_preset: { type: "string", enum: PRESETS },
      level: { type: "string", enum: ["account", "campaign", "adset", "ad"], description: "Aggregation level (default: campaign)" }
    },
    required: ["workspace_id", "account_id"],
    additionalProperties: false
  }
};
const GET_SNAPCHAT_INSIGHTS_TOOL = {
  name: "get_snapchat_insights",
  description: "Snapchat Ads performance (spend, impressions, swipes, purchases, revenue, ROAS) by account, campaign, ad squad or ad, from the most recent MetricsFlo sync for that date preset.",
  inputSchema: {
    type: "object",
    properties: {
      workspace_id: { type: "string", description: "Workspace UUID" },
      account_id: { type: "string", description: "Snapchat ad account ID from list_ad_accounts" },
      date_preset: { type: "string", enum: PRESETS },
      level: { type: "string", enum: ["account", "campaign", "adsquad", "ad"], description: "Aggregation level (default: campaign)" }
    },
    required: ["workspace_id", "account_id"],
    additionalProperties: false
  }
};
const GET_GA4_OVERVIEW_TOOL = {
  name: "get_ga4_overview",
  description: "Fetch Google Analytics 4 website metrics (sessions, users, bounce rate, engagement rate, pageviews, conversions) for a date preset.",
  inputSchema: {
    type: "object",
    properties: {
      workspace_id: { type: "string", description: "Workspace UUID" },
      date_preset: { type: "string", enum: PRESETS }
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
  if (body.method === "tools/list") return rpc(id, { tools: [ACCOUNTS_TOOL, FIELDS_TOOL, WORKSPACES_TOOL, TOOL, LIST_AD_ACCOUNTS_TOOL, GET_META_INSIGHTS_TOOL, GET_SNAPCHAT_INSIGHTS_TOOL, GET_GA4_OVERVIEW_TOOL] });
  if (body.method !== "tools/call") return fail(id, -32601, "Method not found", 404);

  const { name, arguments: args = {} } = body.params || {};
  if (!args || typeof args !== "object" || Array.isArray(args)) return fail(id, -32602, "Invalid tool arguments");

  const TOOL_ARGS = {
    [FIELDS_TOOL.name]: ["platform"],
    [ACCOUNTS_TOOL.name]: [],
    [WORKSPACES_TOOL.name]: [],
    [TOOL.name]: ["workspace_id", "date_preset", "snapchat_account_id", "meta_account_id"],
    [LIST_AD_ACCOUNTS_TOOL.name]: ["workspace_id"],
    [GET_META_INSIGHTS_TOOL.name]: ["workspace_id", "account_id", "date_preset", "level"],
    [GET_SNAPCHAT_INSIGHTS_TOOL.name]: ["workspace_id", "account_id", "date_preset", "level"],
    [GET_GA4_OVERVIEW_TOOL.name]: ["workspace_id", "date_preset"]
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

  if (name === LIST_AD_ACCOUNTS_TOOL.name) {
    try {
      const { meta, snapchat } = await getAdAccounts(workspaceId);
      return ok({ workspace_id: workspaceId, meta, snapchat });
    } catch (e) { return toolError(`Ad accounts unavailable: ${e.message}`); }
  }

  if (name === GET_META_INSIGHTS_TOOL.name || name === GET_SNAPCHAT_INSIGHTS_TOOL.name) {
    const isMeta = name === GET_META_INSIGHTS_TOOL.name;
    const accountId = typeof args.account_id === "string" ? args.account_id.trim() : "";
    const level = args.level ?? "campaign";
    const levels = isMeta ? ["account", "campaign", "adset", "ad"] : ["account", "campaign", "adsquad", "ad"];
    if (!accountId || accountId.length > 100 || !/^[A-Za-z0-9_-]+$/.test(accountId)) return fail(id, -32602, "Invalid account_id");
    if (!levels.includes(level)) return fail(id, -32602, "Invalid level");

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
        ? await getMetaInsightsForWorkspace({ workspaceId, accountId, datePreset, level })
        : await getSnapchatInsightsForWorkspace({ workspaceId, accountId, datePreset, level });
      if (!result.success) return ok({ success: false, platform, account_id: accountId, date_preset: datePreset, message: result.message });

      if (isMeta) {
        return ok({
          success: true,
          platform,
          account_id: accountId,
          account_name: account.name,
          date_preset: datePreset,
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

      return ok({
        success: true,
        platform,
        account_id: accountId,
        account_name: account.name,
        date_preset: datePreset,
        level,
        currency: result.summary?.currency || account.currency || "USD",
        summary: result.summary,
        rows: result.rows.map(({ raw, ...r }) => r),
        total_rows: result.total_rows,
        has_more: result.has_more,
        snapshot_date: result.metric_date,
        last_synced_at: result.last_synced_at,
        is_cached_data: true,
        note: "Snapchat data is the most recent MetricsFlo sync for this date preset. Run a sync from the Snapchat page to refresh."
      });
    } catch (e) {
      return toolError(`${isMeta ? "Meta" : "Snapchat"} insights unavailable: ${e.message}`);
    }
  }

  if (name === GET_GA4_OVERVIEW_TOOL.name) {
    try {
      const result = await getGa4OverviewForWorkspace({ workspaceId, datePreset });
      return ok({ platform: "ga4", date_preset: datePreset, ...result });
    } catch (e) { return toolError(`GA4 data unavailable: ${e.message}`); }
  }

  // get_performance_overview
  const clean = (value) => (typeof value === "string" ? value.trim() : "");
  try {
    const overview = await getPerformanceOverviewForWorkspace({
      workspaceId,
      datePreset,
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
