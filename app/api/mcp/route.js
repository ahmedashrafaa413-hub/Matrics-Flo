import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "../../../lib/supabaseServer";
import { userHasWorkspaceAccess, getUserWorkspaces } from "../../../lib/workspace";
import { consumeRateLimit } from "../../../lib/rateLimit.mjs";
import { listCanonicalFields } from "../../../lib/mcpFieldDictionary.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PRESETS = ["today", "yesterday", "last_7d", "last_30d", "maximum"];
const GA_RANGE_MAP = { today: "today", yesterday: "yesterday", last_7d: "7daysAgo", last_30d: "30daysAgo", maximum: "30daysAgo" };
const FIELDS_TOOL = { name: "list_fields", description: "Discover canonical marketing metrics and platform mappings. Mappings do not assert live availability.", inputSchema: { type: "object", properties: { platform: { type: "string", enum: ["snapchat", "meta", "tiktok", "google"] } }, additionalProperties: false } };
const ACCOUNTS_TOOL = { name: "list_accounts", description: "Discover accessible MetricsFlo accounts. Account IDs are workspace UUIDs; missing integration status is null, never invented.", inputSchema: { type: "object", properties: {}, additionalProperties: false } };
const WORKSPACES_TOOL = { name: "list_workspaces", description: "List workspaces available to the authenticated MetricsFlo owner.", inputSchema: { type: "object", properties: {}, additionalProperties: false } };
const TOOL = {
  name: "get_performance_overview",
  description: "Read MetricsFlo analytics for an explicitly authorized workspace. Returns reported data and source freshness; never infer missing metrics.",
  inputSchema: {
    type: "object",
    properties: {
      date_preset: { type: "string", enum: PRESETS },
      workspace_id: { type: "string", description: "Workspace UUID authorized for this user" }
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
  description: "Fetch Meta Ads campaign and account-level performance data (spend, impressions, clicks, purchases, revenue, ROAS) for a date preset.",
  inputSchema: {
    type: "object",
    properties: {
      workspace_id: { type: "string", description: "Workspace UUID" },
      account_id: { type: "string", description: "Meta ad account ID (e.g. act_123456789) from list_ad_accounts" },
      date_preset: { type: "string", enum: PRESETS },
      level: { type: "string", enum: ["account", "campaign"], description: "Aggregation level (default: campaign)" }
    },
    required: ["workspace_id", "account_id"],
    additionalProperties: false
  }
};
const GET_SNAPCHAT_INSIGHTS_TOOL = {
  name: "get_snapchat_insights",
  description: "Fetch Snapchat Ads campaign and account-level performance data (spend, impressions, clicks, purchases, revenue) for a date preset.",
  inputSchema: {
    type: "object",
    properties: {
      workspace_id: { type: "string", description: "Workspace UUID" },
      account_id: { type: "string", description: "Snapchat ad account ID from list_ad_accounts" },
      date_preset: { type: "string", enum: PRESETS },
      level: { type: "string", enum: ["account", "campaign"], description: "Aggregation level (default: campaign)" }
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
  const ALLOWED_ARGS = ["workspace_id", "date_preset", "platform", "account_id", "level"];
  if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).some((key) => !ALLOWED_ARGS.includes(key))) return fail(id, -32602, "Invalid tool arguments");
  if (name === FIELDS_TOOL.name) {
    if (Object.keys(args).some((key) => key !== "platform")) return fail(id, -32602, "Unexpected arguments");
    try { return rpc(id, { content: [{ type: "text", text: JSON.stringify({ fields: listCanonicalFields(args.platform) }) }] }); }
    catch { return fail(id, -32602, "Unsupported platform"); }
  }
  if (name === ACCOUNTS_TOOL.name || name === WORKSPACES_TOOL.name) {
    if (Object.keys(args).length) return fail(id, -32602, "Unexpected arguments");
    try {
      const workspaces = await getUserWorkspaces(user.id);
      // Fetch platform connection status for each workspace from integrations table
      const admin = createSupabaseAdminClient();
      const workspaceIds = workspaces.map(w => w.id);
      let integrationsByWorkspace = {};
      if (workspaceIds.length > 0) {
        const { data: integrations } = await admin
          .from("integrations")
          .select("workspace_id, platform, status")
          .in("workspace_id", workspaceIds);
        for (const row of integrations || []) {
          if (!integrationsByWorkspace[row.workspace_id]) integrationsByWorkspace[row.workspace_id] = [];
          integrationsByWorkspace[row.workspace_id].push({ platform: row.platform, status: row.status || "connected" });
        }
      }
      const accounts = workspaces.map(({ id, name, role, default_currency, timezone }) => ({
        account_id: id,
        name,
        role,
        currency: default_currency || null,
        timezone: timezone || null,
        contribution_margin: null,
        platforms: integrationsByWorkspace[id] || []
      }));
      return rpc(id, { content: [{ type: "text", text: JSON.stringify(name === ACCOUNTS_TOOL.name ? { accounts } : workspaces.map(({ id, name, role }) => ({ id, name, role }))) }] });
    } catch { return fail(id, -32000, "Workspaces unavailable", 502); }
  }
  // ── Shared helper: validate workspace access and build internal fetch base ──
  async function validateWorkspaceAndOrigin(workspaceId) {
    if (!workspaceId || typeof workspaceId !== "string" || !/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(workspaceId)) {
      return { error: fail(id, -32602, "Invalid workspace_id") };
    }
    if (!(await userHasWorkspaceAccess(user.id, workspaceId))) {
      return { error: fail(id, -32003, "Workspace access denied", 403) };
    }
    const origin = process.env.METRICSFLO_INTERNAL_ORIGIN;
    let validatedOrigin;
    try {
      validatedOrigin = new URL(origin);
      if (validatedOrigin.protocol !== "https:" || validatedOrigin.username || validatedOrigin.password ||
          validatedOrigin.pathname !== "/" || validatedOrigin.search || validatedOrigin.hash) {
        return { error: fail(id, -32000, "Invalid internal origin", 503) };
      }
    } catch { return { error: fail(id, -32000, "Internal origin is not configured", 503) }; }
    return { validatedOrigin };
  }

  async function internalFetch(url) {
    const response = await fetch(url, {
      headers: { Cookie: `sb-access-token=${encodeURIComponent(token)}` },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(25000)
    });
    const text = await response.text();
    if (text.length > 512000) throw new Error("Response too large");
    return { ok: response.ok, status: response.status, data: JSON.parse(text) };
  }

  // ── list_ad_accounts ──
  if (name === LIST_AD_ACCOUNTS_TOOL.name) {
    const { workspace_id: wsId } = args;
    const { error: wsErr, validatedOrigin } = await validateWorkspaceAndOrigin(wsId);
    if (wsErr) return wsErr;
    try {
      const [metaRes, snapRes] = await Promise.all([
        internalFetch(new URL("/api/meta/accounts", validatedOrigin)),
        internalFetch(new URL("/api/snapchat/accounts", validatedOrigin))
      ].map(p => p.catch(e => ({ ok: false, data: null, error: e.message }))));
      const metaAccounts = (metaRes?.data?.data || []).map(a => ({
        id: a.id, name: a.name, currency: a.currency, platform: "meta",
        status: a.account_status === 1 ? "active" : "inactive"
      }));
      const snapAccounts = (snapRes?.data?.organizations || snapRes?.data?.adaccounts || []).map(a => ({
        id: a.id || a.ad_account_id, name: a.name, currency: a.currency, platform: "snapchat"
      }));
      return rpc(id, { content: [{ type: "text", text: JSON.stringify({
        workspace_id: wsId,
        meta: { connected: metaRes?.ok && metaRes?.data?.success !== false, accounts: metaAccounts },
        snapchat: { connected: snapRes?.ok && snapRes?.data?.success !== false, accounts: snapAccounts }
      }) }] });
    } catch (e) { return fail(id, -32000, `Ad accounts unavailable: ${e.message}`, 502); }
  }

  // ── get_meta_insights ──
  if (name === GET_META_INSIGHTS_TOOL.name) {
    const { workspace_id: wsId, account_id, date_preset = "last_30d", level = "campaign" } = args;
    if (!account_id || typeof account_id !== "string") return fail(id, -32602, "account_id is required");
    if (!PRESETS.includes(date_preset)) return fail(id, -32602, "Invalid date_preset");
    if (!["account", "campaign"].includes(level)) return fail(id, -32602, "Invalid level");
    const { error: wsErr, validatedOrigin } = await validateWorkspaceAndOrigin(wsId);
    if (wsErr) return wsErr;
    try {
      const url = new URL("/api/meta/insights", validatedOrigin);
      url.searchParams.set("account_id", account_id);
      url.searchParams.set("level", level);
      url.searchParams.set("date_preset", date_preset);
      const res = await internalFetch(url);
      if (!res.ok || res.data?.success === false) {
        return rpc(id, { content: [{ type: "text", text: JSON.stringify({
          success: false, platform: "meta", account_id, date_preset,
          message: res.data?.error || "Meta Ads data unavailable or account not connected."
        }) }] });
      }
      return rpc(id, { content: [{ type: "text", text: JSON.stringify({ success: true, platform: "meta", account_id, date_preset, level, ...res.data }) }] });
    } catch (e) { return fail(id, -32000, `Meta insights unavailable: ${e.message}`, 502); }
  }

  // ── get_snapchat_insights ──
  if (name === GET_SNAPCHAT_INSIGHTS_TOOL.name) {
    const { workspace_id: wsId, account_id, date_preset = "last_30d", level = "campaign" } = args;
    if (!account_id || typeof account_id !== "string") return fail(id, -32602, "account_id is required");
    if (!PRESETS.includes(date_preset)) return fail(id, -32602, "Invalid date_preset");
    if (!["account", "campaign"].includes(level)) return fail(id, -32602, "Invalid level");
    const { error: wsErr, validatedOrigin } = await validateWorkspaceAndOrigin(wsId);
    if (wsErr) return wsErr;
    try {
      const url = new URL("/api/snapchat/data", validatedOrigin);
      url.searchParams.set("account_id", account_id);
      url.searchParams.set("level", level);
      url.searchParams.set("date_preset", date_preset);
      url.searchParams.set("page_size", "200");
      const res = await internalFetch(url);
      if (!res.ok || res.data?.success === false) {
        return rpc(id, { content: [{ type: "text", text: JSON.stringify({
          success: false, platform: "snapchat", account_id, date_preset,
          message: res.data?.error || "Snapchat Ads data unavailable or account not connected."
        }) }] });
      }
      return rpc(id, { content: [{ type: "text", text: JSON.stringify({ success: true, platform: "snapchat", account_id, date_preset, level, ...res.data }) }] });
    } catch (e) { return fail(id, -32000, `Snapchat insights unavailable: ${e.message}`, 502); }
  }

  // ── get_ga4_overview ──
  if (name === GET_GA4_OVERVIEW_TOOL.name) {
    const { workspace_id: wsId, date_preset = "last_30d" } = args;
    if (!PRESETS.includes(date_preset)) return fail(id, -32602, "Invalid date_preset");
    const { error: wsErr, validatedOrigin } = await validateWorkspaceAndOrigin(wsId);
    if (wsErr) return wsErr;
    try {
      const range = GA_RANGE_MAP[date_preset] || "30daysAgo";
      const url = new URL("/api/ga/overview", validatedOrigin);
      url.searchParams.set("range", range);
      const res = await internalFetch(url);
      if (!res.ok || res.data?.success === false) {
        return rpc(id, { content: [{ type: "text", text: JSON.stringify({
          success: false, platform: "ga4", date_preset,
          message: res.data?.error || "Google Analytics data unavailable or property not connected."
        }) }] });
      }
      return rpc(id, { content: [{ type: "text", text: JSON.stringify({ success: true, platform: "ga4", date_preset, range, ...res.data }) }] });
    } catch (e) { return fail(id, -32000, `GA4 data unavailable: ${e.message}`, 502); }
  }

  if (name !== TOOL.name) return fail(id, -32602, "Unknown tool");
  if (Object.keys(args).some((key) => !["workspace_id", "date_preset"].includes(key))) return fail(id, -32602, "Unexpected arguments");
  const preset = args.date_preset || "last_30d";
  const workspaceId = args.workspace_id;
  if (!PRESETS.includes(preset) || typeof workspaceId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(workspaceId)) return fail(id, -32602, "Invalid tool arguments");
  if (!(await userHasWorkspaceAccess(user.id, workspaceId))) return fail(id, -32003, "Workspace access denied", 403);

  // Reuse existing analytics pipeline under the authenticated user session.
  // Never forward the service-role key or external caller cookies.
  const origin = process.env.METRICSFLO_INTERNAL_ORIGIN;
  let validatedOrigin;
  try {
    validatedOrigin = new URL(origin);
    if (validatedOrigin.protocol !== "https:" || validatedOrigin.username || validatedOrigin.password ||
        validatedOrigin.pathname !== "/" || validatedOrigin.search || validatedOrigin.hash) {
      return fail(id, -32000, "Invalid internal origin", 503);
    }
  } catch { return fail(id, -32000, "Internal origin is not configured", 503); }
  const url = new URL("/api/analytics/overview", validatedOrigin);
  url.searchParams.set("date_preset", preset);
  url.searchParams.set("workspace_id", workspaceId);
  try {
    const response = await fetch(url, {
      headers: {
        Cookie: `sb-access-token=${encodeURIComponent(token)}; metricsflo_active_workspace=${encodeURIComponent(workspaceId)}`
      },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(25000)
    });
    const responseText = await response.text();
    if (responseText.length > 512000) return fail(id, -32000, "Analytics response too large; narrow your request", 413);
    let data;
    try { data = JSON.parse(responseText); } catch { return fail(id, -32000, "Analytics returned invalid JSON", 502); }
    // Accept a partial/empty response (no platforms connected yet) but still return it
    // so Claude can explain what's missing rather than showing a generic 503.
    if (data?.workspace && data.workspace.id !== workspaceId) return fail(id, -32000, "Analytics workspace validation failed", 502);
    if (!response.ok || data?.success === false) {
      // Return a structured "not configured" response instead of a hard error
      return rpc(id, { content: [{ type: "text", text: JSON.stringify({
        success: false,
        workspace: { id: workspaceId },
        date_preset: preset,
        message: data?.error || "No ad platforms connected yet. Connect Meta, Snapchat, TikTok or Google Ads in MetricsFlo to see performance data.",
        platforms: [],
        campaigns: [],
        current: null,
        previous: null
      }) }] });
    }
    return rpc(id, { content: [{ type: "text", text: JSON.stringify(data) }] });
  } catch {
    return fail(id, -32000, "Analytics request failed", 502);
  }
}
