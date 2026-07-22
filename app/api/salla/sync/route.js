import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "../../../../lib/supabaseServer";
import { requireUser } from "../../../../lib/serverAuth";
import { getSallaConnection } from "../../../../lib/sallaToken";
import { assertTrustedMutation } from "../../../../lib/requestSecurity.mjs";

export const dynamic = "force-dynamic";

const PER_PAGE = 100;
// Safety cap so one sync request can't run forever on a huge store — at
// 100 orders/page that's up to 10,000 orders per call. Re-running sync
// picks up any remainder since every order is upserted by its own id.
const MAX_PAGES = 100;

function normalizeOrder(order, { userId, workspaceId, connectionId }) {
  return {
    user_id: userId,
    workspace_id: workspaceId,
    connection_id: connectionId,
    order_id: String(order.id || order.reference_id),
    order_status: order.status?.name || order.status || null,
    total_amount: Number(order.total?.amount || order.amounts?.total?.amount || 0),
    currency:
      order.total?.currency ||
      order.amounts?.total?.currency ||
      order.currency ||
      "SAR",
    order_date:
      order.date?.date ||
      order.created_at?.date ||
      order.created_at ||
      null,
    raw_data: order,
    created_at: new Date().toISOString()
  };
}

// Salla's orders list is paginated — previous code only ever fetched page
// 1, so any store with more orders than one page silently lost the rest.
// This walks every page until Salla reports there's nothing left, using
// the page's own item count as a fallback signal if the pagination
// metadata shape isn't the one we expect.
async function fetchAllOrders(accessToken) {
  const allOrders = [];
  let page = 1;
  let totalPages = null;

  while (page <= MAX_PAGES) {
    const res = await fetch(
      `https://api.salla.dev/admin/v2/orders?per_page=${PER_PAGE}&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json"
        },
        cache: "no-store"
      }
    );

    const data = await res.json();

    if (!res.ok) {
      return { ok: false, status: res.status, error: data, orders: allOrders };
    }

    const pageOrders = Array.isArray(data.data) ? data.data : [];
    allOrders.push(...pageOrders);

    totalPages =
      data.pagination?.totalPages ||
      data.pagination?.total_pages ||
      data.pagination?.lastPage ||
      data.pagination?.last_page ||
      null;

    const hasMore = totalPages ? page < totalPages : pageOrders.length === PER_PAGE;

    if (!hasMore) break;
    page += 1;
  }

  return {
    ok: true,
    orders: allOrders,
    pages_fetched: page,
    total_pages_reported: totalPages,
    hit_page_cap: page >= MAX_PAGES
  };
}

export async function POST(request) {
  try {
    assertTrustedMutation(request);
    await requireUser(request);
  } catch (authError) {
    return NextResponse.json(
      { success: false, error: authError.message || "Unauthorized" },
      { status: authError.status || 401 }
    );
  }

  const { user, workspace, connection } = await getSallaConnection(request);

  if (!connection?.access_token) {
    return NextResponse.json(
      { success: false, error: "Salla is not connected" },
      { status: 401 }
    );
  }

  const result = await fetchAllOrders(connection.access_token);

  if (!result.ok) {
    return NextResponse.json(
      { success: false, step: "salla_sync_orders", error: result.error },
      { status: 500 }
    );
  }

  const rows = result.orders.map((order) =>
    normalizeOrder(order, {
      userId: user.id,
      workspaceId: workspace.id,
      connectionId: connection.id
    })
  );

  const admin = createSupabaseAdminClient();

  // Upsert in batches — Supabase/PostgREST has a practical payload size
  // limit, and a store with thousands of orders would otherwise be sent
  // as one giant request.
  const BATCH_SIZE = 500;
  let savedCount = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    if (!batch.length) continue;

    const { error: saveError } = await admin.from("salla_orders").upsert(
      batch,
      { onConflict: "workspace_id,order_id" }
    );

    if (saveError) {
      return NextResponse.json(
        {
          success: false,
          step: "supabase_orders_save",
          error: saveError,
          saved_before_failure: savedCount
        },
        { status: 500 }
      );
    }

    savedCount += batch.length;
  }

  return NextResponse.json({
    success: true,
    store: connection.account_name,
    merchant_id: connection.metadata?.merchant_id || null,
    fetched_orders: result.orders.length,
    saved_orders: savedCount,
    pages_fetched: result.pages_fetched,
    total_pages_reported: result.total_pages_reported,
    hit_page_cap: result.hit_page_cap
  });
}

export async function GET() {
  return NextResponse.json(
    { success: false, error: "Method not allowed. Use POST for synchronization." },
    { status: 405, headers: { Allow: "POST" } }
  );
}
