import { createSupabaseAdminClient } from "./supabaseServer";
import { getSallaConnectionForWorkspace } from "./sallaToken";

const PER_PAGE = 100;
const MAX_PAGES = 100;
const BATCH_SIZE = 500;

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

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const error = new Error(
        data?.error?.message || data?.message || "Salla orders request failed"
      );
      error.status = res.status;
      throw error;
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
    orders: allOrders,
    pagesFetched: page,
    totalPagesReported: totalPages,
    hitPageCap: page >= MAX_PAGES
  };
}

export async function syncSallaWorkspace({ workspaceId, userId }) {
  const connection = await getSallaConnectionForWorkspace(workspaceId);

  if (!connection?.access_token) {
    const error = new Error("Salla is not connected");
    error.status = 401;
    throw error;
  }

  const result = await fetchAllOrders(connection.access_token);
  const rows = result.orders.map((order) =>
    normalizeOrder(order, {
      userId,
      workspaceId,
      connectionId: connection.id
    })
  );

  const admin = createSupabaseAdminClient();
  let savedCount = 0;

  for (let index = 0; index < rows.length; index += BATCH_SIZE) {
    const batch = rows.slice(index, index + BATCH_SIZE);
    if (!batch.length) continue;

    const { error } = await admin
      .from("salla_orders")
      .upsert(batch, { onConflict: "workspace_id,order_id" });

    if (error) throw new Error(error.message);
    savedCount += batch.length;
  }

  return {
    success: true,
    store: connection.account_name,
    merchant_id: connection.metadata?.merchant_id || null,
    fetched_orders: result.orders.length,
    saved_orders: savedCount,
    pages_fetched: result.pagesFetched,
    total_pages_reported: result.totalPagesReported,
    hit_page_cap: result.hitPageCap
  };
}
