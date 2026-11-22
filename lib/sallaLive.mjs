// Live Salla store data, read straight from the Salla Merchant API
// (https://api.salla.dev/admin/v2) on every request. Nothing is stored:
// the /salla page no longer depends on the salla_orders sync table.
// Read-only: only GET requests are sent to Salla.

const SALLA_API = "https://api.salla.dev/admin/v2";
const PER_PAGE = 60;

// Orders in these states are not real sales; they are counted but kept out
// of net revenue and AOV.
const VOID_STATUS = /cancel|refund|restor|return|ملغ|مسترجع|مرتجع|استرجاع/i;

const PAYMENT_LABELS = {
  tamara: "تمارا (تقسيط)",
  tabby: "تابي (تقسيط)",
  mada: "مدى",
  credit_card: "بطاقة ائتمانية",
  apple_pay: "Apple Pay",
  stc_pay: "STC Pay",
  bank: "تحويل بنكي",
  cod: "الدفع عند الاستلام",
  paypal: "PayPal",
  free: "مجاني",
  waiting: "بانتظار الدفع"
};

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (value) => Math.round(num(value) * 100) / 100;

export function paymentLabel(method) {
  const key = String(method || "").trim();
  if (!key) return "غير محدد";
  return PAYMENT_LABELS[key.toLowerCase()] || key;
}

// Salla dates come as { date: "2026-11-22 14:48:20.000000", timezone: "Asia/Riyadh" }
// or as a plain string. Store times are Riyadh time already.
export function orderDay(order) {
  const raw = order?.date?.date || order?.created_at?.date || order?.date || order?.created_at || "";
  const match = String(raw).match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : "";
}

function orderTotal(order) {
  return num(order?.total?.amount ?? order?.amounts?.total?.amount ?? order?.total_amount);
}

function orderStatus(order) {
  const status = order?.status;
  if (status && typeof status === "object") {
    return {
      name: status.customized?.name || status.name || status.slug || "غير محدد",
      slug: status.slug || ""
    };
  }
  return { name: status ? String(status) : "غير محدد", slug: status ? String(status) : "" };
}

function orderCity(order) {
  return (
    order?.customer?.city ||
    order?.shipping?.address?.city ||
    order?.shipping?.receiver?.city ||
    order?.ship_to?.city ||
    ""
  );
}

function cartDay(cart) {
  const raw = cart?.updated_at?.date || cart?.updated_at || cart?.created_at?.date || cart?.created_at || "";
  const match = String(raw).match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : "";
}

function cartTotal(cart) {
  return num(cart?.total?.amount ?? cart?.total ?? cart?.subtotal?.amount ?? cart?.amounts?.total?.amount);
}

function bump(map, key, init) {
  if (!map.has(key)) map.set(key, init());
  return map.get(key);
}

// Pure aggregation so it can be tested without the network.
export function summarizeSallaOrders(orders, { since, until } = {}) {
  const inRange = (day) => !day || ((!since || day >= since) && (!until || day <= until));
  const rows = (orders || []).filter((order) => inRange(orderDay(order)));

  const daily = new Map();
  const statuses = new Map();
  const payments = new Map();
  const products = new Map();
  const cities = new Map();
  let gross = 0;
  let net = 0;
  let validOrders = 0;
  let voidOrders = 0;
  let multiItem = 0;

  for (const order of rows) {
    const total = orderTotal(order);
    const status = orderStatus(order);
    const isVoid = VOID_STATUS.test(`${status.slug} ${status.name}`);
    gross += total;
    if (isVoid) voidOrders += 1;
    else {
      validOrders += 1;
      net += total;
    }

    const day = orderDay(order);
    if (day) {
      const d = bump(daily, day, () => ({ date: day, orders: 0, revenue: 0 }));
      d.orders += 1;
      if (!isVoid) d.revenue += total;
    }

    const s = bump(statuses, status.name, () => ({ name: status.name, slug: status.slug, count: 0 }));
    s.count += 1;

    const label = paymentLabel(order?.payment_method);
    const p = bump(payments, label, () => ({ name: label, count: 0, revenue: 0 }));
    p.count += 1;
    if (!isVoid) p.revenue += total;

    const city = orderCity(order);
    if (city) {
      const c = bump(cities, city, () => ({ name: city, count: 0, revenue: 0 }));
      c.count += 1;
      if (!isVoid) c.revenue += total;
    }

    const items = Array.isArray(order?.items) ? order.items : [];
    if (items.length > 1) multiItem += 1;
    const seen = new Set();
    for (const item of items) {
      const name = item?.name || item?.product?.name || "منتج بدون اسم";
      const entry = bump(products, name, () => ({ name, orders: 0, units: 0, thumbnail: item?.thumbnail || null }));
      entry.units += num(item?.quantity || 1);
      if (!seen.has(name)) {
        entry.orders += 1;
        seen.add(name);
      }
    }
  }

  const byCount = (a, b) => b.count - a.count;
  const roundRevenue = (row) => ({ ...row, revenue: round2(row.revenue) });

  return {
    totals: {
      orders: rows.length,
      valid_orders: validOrders,
      void_orders: voidOrders,
      gross_revenue: round2(gross),
      revenue: round2(net),
      avg_order_value: round2(validOrders ? net / validOrders : 0),
      multi_item_orders: multiItem,
      multi_item_pct: round2(rows.length ? (multiItem / rows.length) * 100 : 0)
    },
    daily: [...daily.values()].map(roundRevenue).sort((a, b) => a.date.localeCompare(b.date)),
    statuses: [...statuses.values()].sort(byCount),
    payments: [...payments.values()].map(roundRevenue).sort(byCount),
    products: [...products.values()].sort((a, b) => b.orders - a.orders || b.units - a.units).slice(0, 25),
    cities: [...cities.values()].map(roundRevenue).sort(byCount).slice(0, 15)
  };
}

export function summarizeAbandonedCarts(carts, { since, until } = {}) {
  const rows = (carts || []).filter((cart) => {
    const day = cartDay(cart);
    return !day || ((!since || day >= since) && (!until || day <= until));
  });
  const value = rows.reduce((sum, cart) => sum + cartTotal(cart), 0);
  return {
    count: rows.length,
    value: round2(value),
    avg_value: round2(rows.length ? value / rows.length : 0)
  };
}

async function sallaGet(path, accessToken, fetchImpl = fetch) {
  const res = await fetchImpl(`${SALLA_API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    cache: "no-store"
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data?.error?.message || data?.message || `Salla request failed (${res.status})`);
    error.status = res.status;
    throw error;
  }
  return data;
}

function totalPagesOf(data) {
  const p = data?.pagination || {};
  return num(p.totalPages || p.total_pages || p.last_page || p.lastPage) || null;
}

// Pages through /orders for the date range. Stops early when a page is
// entirely older than `since` (in case Salla ignores the date filter) and
// when the time budget runs out, reporting `complete: false`.
export async function fetchSallaOrders({ accessToken, since, until, maxPages = 50, timeBudgetMs = 40000, fetchImpl = fetch }) {
  const started = Date.now();
  const orders = [];
  let page = 1;
  let complete = false;
  let totalReported = null;

  while (page <= maxPages) {
    if (Date.now() - started > timeBudgetMs) break;
    const qs = new URLSearchParams({ per_page: String(PER_PAGE), page: String(page), from_date: since, to_date: until });
    const data = await sallaGet(`/orders?${qs}`, accessToken, fetchImpl);
    const list = Array.isArray(data?.data) ? data.data : [];
    orders.push(...list);
    totalReported = num(data?.pagination?.total) || totalReported;

    const totalPages = totalPagesOf(data);
    const days = list.map(orderDay).filter(Boolean);
    const allOlder = days.length > 0 && days.every((day) => day < since);
    const more = totalPages ? page < totalPages : list.length === PER_PAGE;
    if (!more || allOlder) {
      complete = true;
      break;
    }
    page += 1;
  }

  return { orders, pages: page, complete, total_reported: totalReported };
}

export async function fetchSallaAbandonedCarts({ accessToken, maxPages = 10, fetchImpl = fetch }) {
  const carts = [];
  let page = 1;
  let complete = false;
  while (page <= maxPages) {
    const data = await sallaGet(`/carts/abandoned?per_page=65&page=${page}`, accessToken, fetchImpl);
    const list = Array.isArray(data?.data) ? data.data : [];
    carts.push(...list);
    const totalPages = totalPagesOf(data);
    const more = totalPages ? page < totalPages : list.length === 65;
    if (!more) {
      complete = true;
      break;
    }
    page += 1;
  }
  return { carts, complete };
}

// Ad platforms report purchases they attribute to themselves; the store's
// own order count is the ceiling. Share > 100% across platforms means the
// platforms are double-counting the same orders.
export function compareAttribution({ storeOrders, storeRevenue, platforms }) {
  const rows = Object.entries(platforms || {})
    .filter(([, p]) => p && (p.purchases || p.spend))
    .map(([name, p]) => ({
      platform: name,
      spend_sar: round2(p.spend_sar ?? p.spend),
      purchases: num(p.purchases),
      revenue_sar: round2(p.revenue_sar ?? p.revenue),
      share_of_store_orders_pct: round2(storeOrders ? (num(p.purchases) / storeOrders) * 100 : 0)
    }));
  const claimed = rows.reduce((sum, row) => sum + row.purchases, 0);
  const spend = rows.reduce((sum, row) => sum + row.spend_sar, 0);
  return {
    store_orders: storeOrders,
    store_revenue: round2(storeRevenue),
    platforms: rows,
    claimed_purchases: claimed,
    claimed_share_pct: round2(storeOrders ? (claimed / storeOrders) * 100 : 0),
    unattributed_orders: Math.max(0, storeOrders - claimed),
    over_attributed: claimed > storeOrders,
    total_ad_spend_sar: round2(spend),
    blended_cpa_sar: round2(storeOrders ? spend / storeOrders : 0),
    blended_roas: round2(spend ? storeRevenue / spend : 0)
  };
}
