import { NextResponse } from "next/server";
import { requireUser } from "../../../lib/serverAuth";
import { getServerAccessToken } from "../../../lib/supabaseServer";
import { userHasWorkspaceAccess } from "../../../lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PRESETS = ["today", "yesterday", "last_7d", "last_30d", "maximum"];
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

function rpc(id, result) { return NextResponse.json({ jsonrpc: "2.0", id, result }, { headers: { "Cache-Control": "no-store" } }); }
function fail(id, code, message, status = 400) {
  return NextResponse.json({ jsonrpc: "2.0", id, error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  return NextResponse.json({ error: "Use MCP JSON-RPC POST with an authorized bearer token." }, { status: 405 });
}

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return fail(null, -32700, "Invalid JSON"); }
  const id = body?.id ?? null;
  if (body?.jsonrpc !== "2.0" || typeof body.method !== "string") return fail(id, -32600, "Invalid JSON-RPC request");
  if (JSON.stringify(body).length > 8192) return fail(id, -32600, "Request too large", 413);

  // Fail closed until the owner UUID is configured server-side.
  const ownerId = process.env.METRICSFLO_AI_OWNER_USER_ID;
  if (!ownerId) return fail(id, -32003, "AI integration is disabled", 403);
  if (!request.headers.get("authorization")?.startsWith("Bearer ")) return fail(id, -32001, "Bearer authentication required", 401);

  let user;
  try { user = await requireUser(request); } catch { return fail(id, -32001, "Invalid or expired access token", 401); }
  if (user.id !== ownerId) return fail(id, -32003, "AI integration is not enabled for this account", 403);

  if (body.method === "initialize") return rpc(id, {
    protocolVersion: "2025-03-26",
    capabilities: { tools: {} },
    serverInfo: { name: "metricsflo-private", version: "0.1.0" }
  });
  if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
  if (body.method === "ping") return rpc(id, {});
  if (body.method === "tools/list") return rpc(id, { tools: [TOOL] });
  if (body.method !== "tools/call") return fail(id, -32601, "Method not found", 404);

  const { name, arguments: args = {} } = body.params || {};
  if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).some((key) => !["workspace_id", "date_preset"].includes(key))) return fail(id, -32602, "Invalid tool arguments");
  if (name !== TOOL.name) return fail(id, -32602, "Unknown tool");
  const preset = args.date_preset || "last_30d";
  const workspaceId = args.workspace_id;
  if (!PRESETS.includes(preset) || typeof workspaceId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(workspaceId)) return fail(id, -32602, "Invalid tool arguments");
  if (!(await userHasWorkspaceAccess(user.id, workspaceId))) return fail(id, -32003, "Workspace access denied", 403);

  // Reuse existing analytics pipeline under the authenticated user session.
  // Never forward the service-role key or external caller cookies.
  const token = getServerAccessToken(request);
  const origin = process.env.METRICSFLO_INTERNAL_ORIGIN;
  if (!origin || !origin.startsWith("https://") || origin.includes("/", 8)) return fail(id, -32000, "Internal origin is not configured", 503);
  const url = new URL("/api/analytics/overview", origin);
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
    const data = await response.json();
    if (data?.success === false || data?.workspace?.id !== workspaceId) return fail(id, -32000, "Analytics workspace validation failed", 502);
    return rpc(id, { content: [{ type: "text", text: JSON.stringify(data) }] });
  } catch {
    return fail(id, -32000, "Analytics request failed", 502);
  }
}
