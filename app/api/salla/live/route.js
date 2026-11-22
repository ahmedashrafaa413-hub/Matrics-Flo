// Live Salla store numbers for the /salla page, read from the Salla API on
// every request (no sync table). Read-only on the store.
//
//   GET /api/salla/live?view=store&date_preset=today|yesterday|last_7d|last_30d|this_month
//   GET /api/salla/live?view=store&since=YYYY-MM-DD&until=YYYY-MM-DD
//   GET /api/salla/live?view=ads&since=..&until=..&snapchat_account_id=..|none&meta_account_id=..|none
//   GET /api/salla/live?view=accounts

import { NextResponse } from "next/server";
import { requireUser } from "../../../../lib/serverAuth";
import { getSallaConnection } from "../../../../lib/sallaToken";
import { getRiyadhDateRange } from "../../../../lib/riyadhDateRange.mjs";
import { parseCustomRange } from "../../../../lib/mcpDateRange.mjs";
import { getAdAccounts, getPerformanceOverviewForWorkspace } from "../../../../lib/mcpWorkspaceData";
import {
  compareAttribution,
  fetchSallaAbandonedCarts,
  fetchSallaOrders,
  summarizeAbandonedCarts,
  summarizeSallaOrders
} from "../../../../lib/sallaLive.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const PRESETS = ["today", "yesterday", "last_7d", "last_30d", "this_month", "last_90d"];
const MAX_DAYS = 92;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function json(payload, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

function readRange(params) {
  const since = params.get("since");
  const until = params.get("until");
  if (since || until) {
    const range = parseCustomRange(since ?? undefined, until ?? undefined);
    if (range?.error) return { error: range.error };
    if (range.days > MAX_DAYS) return { error: `Live Salla range is limited to ${MAX_DAYS} days` };
    return { since: range.since, until: range.until, preset: "custom" };
  }
  const preset = params.get("date_preset") || "today";
  if (!PRESETS.includes(preset)) return { error: "Invalid date_preset" };
  const { from, to } = getRiyadhDateRange(preset);
  return { since: from, until: to, preset };
}

async function storeView({ connection, since, until }) {
  const token = connection.access_token;
  const [ordersResult, cartsResult] = await Promise.allSettled([
    fetchSallaOrders({ accessToken: token, since, until }),
    fetchSallaAbandonedCarts({ accessToken: token })
  ]);

  if (ordersResult.status === "rejected") {
    const error = ordersResult.reason;
    const reconnect = error?.status === 401 || error?.status === 403;
    return json({
      success: false,
      error: reconnect ? "SALLA_AUTH" : error?.message || "Salla orders request failed",
      message: reconnect
        ? "Salla rejected the saved token. Reconnect Salla from Connections."
        : error?.message
    }, reconnect ? 401 : 502);
  }

  const { orders, complete, pages, total_reported } = ordersResult.value;
  const summary = summarizeSallaOrders(orders, { since, until });

  let carts = null;
  let cartsError = null;
  if (cartsResult.status === "fulfilled") {
    carts = {
      in_range: summarizeAbandonedCarts(cartsResult.value.carts, { since, until }),
      open_total: summarizeAbandonedCarts(cartsResult.value.carts),
      complete: cartsResult.value.complete
    };
  } else {
    const status = cartsResult.reason?.status;
    cartsError = status === 401 || status === 403
      ? "The Salla app needs read access to abandoned carts. Enable it in Salla Partners, then reconnect Salla."
      : cartsResult.reason?.message || "Abandoned carts request failed";
  }

  return json({
    success: true,
    source: "live",
    fetched_at: new Date().toISOString(),
    store: {
      name: connection.account_name || connection.metadata?.store_name || "Salla Store",
      merchant_id: connection.metadata?.merchant_id || null
    },
    date_range: { since, until },
    complete,
    pages_fetched: pages,
    total_reported,
    ...summary,
    abandoned_carts: carts,
    abandoned_carts_error: cartsError,
    notes: [
      "Revenue and average order value leave out cancelled, refunded and returned orders.",
      "Salla's order list gives product names and quantities only, so products are ranked by orders and units."
    ]
  });
}

async function adsView({ workspaceId, connection, since, until, params }) {
  const snap = params.get("snapchat_account_id") || "";
  const meta = params.get("meta_account_id") || "";
  for (const id of [snap, meta]) {
    if (id && !ID_RE.test(id)) return json({ success: false, error: "Invalid account id" }, 400);
  }

  const [ordersResult, overviewResult] = await Promise.allSettled([
    fetchSallaOrders({ accessToken: connection.access_token, since, until, timeBudgetMs: 30000 }),
    getPerformanceOverviewForWorkspace({
      workspaceId,
      datePreset: "custom",
      range: { since, until },
      snapchatAccountId: snap,
      metaAccountId: meta,
      includeGa4: false
    })
  ]);

  if (ordersResult.status === "rejected") {
    return json({ success: false, error: ordersResult.reason?.message || "Salla orders request failed" }, 502);
  }
  if (overviewResult.status === "rejected") {
    const error = overviewResult.reason;
    return json({ success: false, error: error?.message || "Ad platforms request failed" }, error?.status || 502);
  }

  const summary = summarizeSallaOrders(ordersResult.value.orders, { since, until });
  const overview = overviewResult.value;
  const comparison = compareAttribution({
    storeOrders: summary.totals.valid_orders,
    storeRevenue: summary.totals.revenue,
    platforms: {
      snapchat: snap === "none" ? null : overview.by_platform?.snapchat,
      meta: meta === "none" ? null : overview.by_platform?.meta
    }
  });

  return json({
    success: true,
    date_range: { since, until },
    orders_complete: ordersResult.value.complete,
    comparison,
    accounts: overview.accounts,
    errors: overview.errors,
    notes: [
      "Store orders exclude cancelled, refunded and returned orders.",
      "Platform purchases are what each ad platform attributes to itself (Snapchat 28-day swipe / 1-day view, Meta account default). When their sum is above the store's orders, the platforms are claiming the same orders."
    ]
  });
}

export async function GET(request) {
  try {
    await requireUser(request);
  } catch (authError) {
    return json({ success: false, error: authError.message || "Unauthorized" }, authError.status || 401);
  }

  const params = new URL(request.url).searchParams;
  const view = params.get("view") || "store";

  let workspace;
  let connection;
  try {
    ({ workspace, connection } = await getSallaConnection(request));
  } catch (error) {
    return json({ success: false, error: error.message || "Workspace error" }, error.status || 500);
  }

  if (view === "accounts") {
    try {
      const { meta, snapchat } = await getAdAccounts(workspace.id, { discoverLive: false });
      return json({ success: true, meta: meta.accounts, snapchat: snapchat.accounts });
    } catch (error) {
      return json({ success: false, error: error.message }, 500);
    }
  }

  if (!connection?.access_token) {
    return json({ success: false, error: "NOT_CONNECTED" }, 401);
  }

  const range = readRange(params);
  if (range.error) return json({ success: false, error: range.error }, 400);

  try {
    if (view === "ads") return await adsView({ workspaceId: workspace.id, connection, ...range, params });
    if (view === "store") return await storeView({ connection, ...range });
    return json({ success: false, error: "Invalid view" }, 400);
  } catch (error) {
    return json({ success: false, error: error.message || "Salla live request failed" }, error.status || 500);
  }
}
