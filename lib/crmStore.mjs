// Store numbers from Ahmed's CRM (the same service behind the "CRM
// Connectors" MCP: store_analysis / sales_by_product). The CRM keeps its
// own copy of the Salla store, updated by Salla webhooks, so it has the
// real store's orders even when MetricsFlo's own Salla OAuth points at
// another store.
//
// Config (Vercel env):
//   CRM_API_URL  the CRM's MCP endpoint, e.g. https://crm.example.com/mcp
//   CRM_API_KEY  a server-side bearer token the CRM accepts
//
// The CRM is reached over MCP's Streamable HTTP transport (JSON-RPC over
// POST; replies may be plain JSON or an SSE stream). Read-only tools only.

const PROTOCOL_VERSION = "2025-06-18";

export function crmConfigured(env = process.env) {
  return Boolean(env.CRM_API_URL && env.CRM_API_KEY);
}

// Replies can be application/json or text/event-stream ("data: {...}").
export function parseRpcBody(text, id) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list.find((m) => m?.id === id) || list[0] || null;
  }
  const messages = [];
  for (const block of trimmed.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) continue;
    try {
      messages.push(JSON.parse(data));
    } catch {}
  }
  return messages.find((m) => m?.id === id) || messages.at(-1) || null;
}

function crmError(message, status = 502) {
  return Object.assign(new Error(message), { status });
}

export async function callCrmTool(name, args = {}, { env = process.env, fetchImpl = fetch, timeoutMs = 25000 } = {}) {
  if (!crmConfigured(env)) throw crmError("CRM is not configured (CRM_API_URL / CRM_API_KEY).", 503);

  const url = env.CRM_API_URL;
  const baseHeaders = {
    Authorization: `Bearer ${env.CRM_API_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream"
  };
  const signal = AbortSignal.timeout(timeoutMs);
  let sessionId = "";

  const post = async (message) => {
    const headers = { ...baseHeaders };
    if (sessionId) {
      headers["Mcp-Session-Id"] = sessionId;
      headers["MCP-Protocol-Version"] = PROTOCOL_VERSION;
    }
    const res = await fetchImpl(url, { method: "POST", headers, body: JSON.stringify(message), cache: "no-store", signal });
    sessionId = res.headers?.get?.("mcp-session-id") || sessionId;
    const text = await res.text();
    if (res.status === 401 || res.status === 403) throw crmError("The CRM rejected CRM_API_KEY.", 401);
    if (!res.ok && res.status !== 202) throw crmError(`CRM request failed (${res.status})`);
    return message.id === undefined ? null : parseRpcBody(text, message.id);
  };

  const init = await post({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "metricsflo", version: "1.0.0" } }
  });
  if (init?.error) throw crmError(`CRM initialize failed: ${init.error.message || "unknown error"}`);
  await post({ jsonrpc: "2.0", method: "notifications/initialized" });

  const reply = await post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } });
  if (!reply) throw crmError("CRM returned no reply");
  if (reply.error) throw crmError(`CRM ${name} failed: ${reply.error.message || "unknown error"}`);

  const result = reply.result || {};
  if (result.structuredContent) return result.structuredContent;
  const text = (result.content || []).find((c) => c?.type === "text")?.text;
  if (result.isError) throw crmError(`CRM ${name} failed: ${text || "unknown error"}`);
  try {
    return JSON.parse(text);
  } catch {
    throw crmError(`CRM ${name} returned non-JSON content`);
  }
}

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

// store_analysis labels its KPIs in Arabic; read them by label.
function summaryValue(summary, ...labels) {
  for (const label of labels) {
    const row = (summary || []).find((item) => item?.label === label);
    if (row) return num(row.value);
  }
  return 0;
}

// Maps a store_analysis payload onto the shape /api/salla/live returns,
// so the /salla page renders either source the same way.
export function normalizeCrmStoreAnalysis(payload, { since, until } = {}) {
  const summary = payload?.summary || [];
  const orders = num(payload?.range?.ordersInRange) || summaryValue(summary, "إجمالي الطلبات");
  const revenue = summaryValue(summary, "إجمالي الإيراد");
  const cancelPct = summaryValue(summary, "نسبة الإلغاء");
  const returns = summaryValue(summary, "عدد المرتجعات");
  const voidOrders = Math.round((orders * cancelPct) / 100) + returns;
  const basket = payload?.basket || {};

  return {
    totals: {
      orders,
      valid_orders: Math.max(0, orders - voidOrders),
      void_orders: voidOrders,
      gross_revenue: revenue,
      revenue,
      avg_order_value: summaryValue(summary, "متوسط قيمة الطلب") || (orders ? Math.round(revenue / orders) : 0),
      multi_item_orders: num(basket.multiItemOrders),
      multi_item_pct: num(basket.multiItemPercent),
      repeat_rate_pct: summaryValue(summary, "نسبة إعادة الشراء"),
      cancel_rate_pct: cancelPct,
      return_rate_pct: summaryValue(summary, "نسبة المرتجعات")
    },
    // The CRM gives a monthly trend, not daily.
    daily: [],
    monthly: (payload?.monthly || []).map((m) => ({ month: m.month, orders: num(m.count), revenue: num(m.revenue) })),
    statuses: (payload?.status || []).map((s) => ({ name: s.name, count: num(s.count) })),
    payments: (payload?.payments || []).map((p) => ({ name: p.name, count: num(p.count), revenue: num(p.revenue) })),
    products: (payload?.products || []).map((p) => ({
      name: p.name,
      orders: num(p.orders ?? p.count),
      units: num(p.units ?? p.qty),
      revenue: num(p.revenue)
    })),
    cities: (payload?.cities || []).map((c) => ({ name: c.name, count: num(c.count), revenue: num(c.revenue) })),
    segments: (payload?.segments || []).map((s) => ({ name: s.name, count: num(s.count) })),
    insights: (payload?.insights || []).map((i) => ({ level: i.level, icon: i.icon, title: i.title, body: i.body, stat: i.stat })),
    abandoned_carts: {
      // The CRM reports carts still open now, not per date range.
      in_range: null,
      open_total: {
        count: summaryValue(summary, "سلات متروكة مفتوحة"),
        value: summaryValue(summary, "قيمة السلات المتروكة")
      },
      complete: true
    },
    complete: payload?.range?.applied !== false,
    crm_source: {
      computed_at: payload?.source?.computedAt || payload?.generatedAt || null,
      last_salla_sync: payload?.source?.lastSallaSync || null,
      last_salla_event: payload?.source?.lastSallaEvent || null,
      salla_connected: payload?.source?.sallaConnected ?? null
    },
    date_range: { since, until }
  };
}

export async function fetchCrmStore({ since, until, env, fetchImpl } = {}) {
  const payload = await callCrmTool("store_analysis", { from: since, to: until }, { env, fetchImpl });
  return normalizeCrmStoreAnalysis(payload, { since, until });
}
