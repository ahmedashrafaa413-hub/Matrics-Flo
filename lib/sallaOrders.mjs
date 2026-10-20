// Salla order helpers shared by the sync, the summary and the order list.

// Orders in these states are not revenue. Salla exposes a stable English
// `slug` on order.status; stores can rename the display `name`, so the
// Arabic/English names are only a fallback for rows synced without a slug.
const EXCLUDED_STATUS_SLUGS = new Set([
  "canceled",
  "cancelled",
  "refunded",
  "restored",
  "restoring",
  "deleted"
]);

const EXCLUDED_STATUS_NAMES = new Set([
  "canceled",
  "cancelled",
  "refunded",
  "restored",
  "ملغي",
  "ملغى",
  "تم الإلغاء",
  "مسترجع",
  "مسترد",
  "تم الاسترجاع",
  "قيد الاسترجاع"
]);

export function isRevenueOrder({ statusSlug, statusName } = {}) {
  const slug = String(statusSlug || "").trim().toLowerCase();
  if (slug) return !EXCLUDED_STATUS_SLUGS.has(slug);

  const name = String(statusName || "").trim().toLowerCase();
  return !EXCLUDED_STATUS_NAMES.has(name);
}

// Salla returns local store time without an offset, e.g.
// "2026-06-03 14:09:36.000000". Stored as-is in a timestamptz column it is
// read as UTC and lands three hours late. Attach the store's offset.
export function normalizeSallaDate(value, offset = "+03:00") {
  if (!value) return null;
  const text = String(value).trim();

  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(text)) return text;

  const match = text.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)/);
  if (match) {
    const time = match[2].length === 5 ? `${match[2]}:00` : match[2];
    return `${match[1]}T${time}${offset}`;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text}T00:00:00${offset}`;
  return text;
}

// PostgREST returns at most 1,000 rows per request, so every read that
// aggregates orders pages through the whole range.
export async function fetchAllRows(buildQuery, pageSize = 1000) {
  const rows = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);

    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}

export function summarizeOrders(orders = []) {
  const counted = orders.filter((order) =>
    isRevenueOrder({
      statusSlug: order.status_slug,
      statusName: order.order_status
    })
  );
  const totalRevenue = counted.reduce(
    (sum, order) => sum + Number(order.total_amount || 0),
    0
  );

  return {
    total_orders: counted.length,
    total_revenue: totalRevenue,
    average_order_value: counted.length ? totalRevenue / counted.length : 0,
    excluded_orders: orders.length - counted.length
  };
}
