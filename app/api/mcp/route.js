import { NextResponse } from "next/server";
import { requireUser } from "../../../lib/serverAuth";
import { getServerAccessToken } from "../../../lib/supabaseServer";
import { userHasWorkspaceAccess, getUserWorkspaces } from "../../../lib/workspace";
import { consumeRateLimit } from "../../../lib/rateLimit.mjs";
import { listCanonicalFields } from "../../../lib/mcpFieldDictionary.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PRESETS = ["today", "yesterday", "last_7d", "last_30d", "maximum"];
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

function rpc(id, result) { return NextResponse.json({ jsonrpc: "2.0", id, result }, { headers: { "Cache-Control": "no-store", "MCP-Protocol-Version": "2025-03-26" } }); }
function fail(id, code, message, status = 400) {
  return NextResponse.json({ jsonrpc: "2.0", id, error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  return NextResponse.json({ error: "Use MCP JSON-RPC POST with an authorized bearer token." }, { status: 405 });
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
  const id = body?.id ?? null;
  if (body?.jsonrpc !== "2.0" || typeof body.method !== "string") return fail(id, -32600, "Invalid JSON-RPC request");
  if (body === null || typeof body !== "object" || Array.isArray(body)) return fail(id, -32600, "Invalid JSON-RPC request");

  // Fail closed until the owner UUID is configured server-side.
  const ownerId = process.env.METRICSFLO_AI_OWNER_USER_ID;
  if (!ownerId) return fail(id, -32003, "AI integration is disabled", 403);
  if (!request.headers.get("authorization")?.startsWith("Bearer ")) return fail(id, -32001, "Bearer authentication required", 401);

  let user;
  try { user = await requireUser(request); } catch { return fail(id, -32001, "Invalid or expired access token", 401); }
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
  if (body.method === "tools/list") return rpc(id, { tools: [ACCOUNTS_TOOL, FIELDS_TOOL, WORKSPACES_TOOL, TOOL] });
  if (body.method !== "tools/call") return fail(id, -32601, "Method not found", 404);

  const { name, arguments: args = {} } = body.params || {};
  if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).some((key) => !["workspace_id", "date_preset", "platform"].includes(key))) return fail(id, -32602, "Invalid tool arguments");
  if (name === FIELDS_TOOL.name) {
    if (Object.keys(args).some((key) => key !== "platform")) return fail(id, -32602, "Unexpected arguments");
    try { return rpc(id, { content: [{ type: "text", text: JSON.stringify({ fields: listCanonicalFields(args.platform) }) }] }); }
    catch { return fail(id, -32602, "Unsupported platform"); }
  }
  if (name === ACCOUNTS_TOOL.name || name === WORKSPACES_TOOL.name) {
    if (Object.keys(args).length) return fail(id, -32602, "Unexpected arguments");
    try {
      const workspaces = await getUserWorkspaces(user.id);
      const accounts = workspaces.map(({ id, name, role, default_currency, timezone }) => ({ account_id: id, name, role, currency: default_currency || null, timezone: timezone || null, contribution_margin: null, platforms: null }));
      return rpc(id, { content: [{ type: "text", text: JSON.stringify(name === ACCOUNTS_TOOL.name ? { accounts } : workspaces.map(({ id, name, role }) => ({ id, name, role }))) }] });
    } catch { return fail(id, -32000, "Workspaces unavailable", 502); }
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
  const token = getServerAccessToken(request);
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
  try {
    const response = await fetch(url, {
      headers: {
        Cookie: `sb-access-token=${encodeURIComponent(token)}; metricsflo_active_workspace=${encodeURIComponent(workspaceId)}`
      },
      cache: "no-store",
      signal: AbortSignal.timeout(25000)
    });
    if (!response.ok) return fail(id, -32000, "Analytics source unavailable", 502);
    const responseText = await response.text();
    if (responseText.length > 512000) return fail(id, -32000, "Analytics response too large; narrow your request", 413);
    const data = JSON.parse(responseText);
    if (data?.success === false || data?.workspace?.id !== workspaceId) return fail(id, -32000, "Analytics workspace validation failed", 502);
    return rpc(id, { content: [{ type: "text", text: JSON.stringify(data) }] });
  } catch {
    return fail(id, -32000, "Analytics request failed", 502);
  }
}
