import test from "node:test";
import assert from "node:assert/strict";
import {
  compareAttribution,
  fetchSallaOrders,
  orderDay,
  paymentLabel,
  summarizeAbandonedCarts,
  summarizeSallaOrders
} from "../lib/sallaLive.mjs";

const order = (o) => ({
  id: o.id,
  total: { amount: o.total, currency: "SAR" },
  date: { date: `${o.day} 14:00:00.000000`, timezone: "Asia/Riyadh" },
  status: { name: o.status || "جديد", slug: o.slug || "under_review" },
  payment_method: o.pay || "mada",
  items: o.items || [{ name: "زيت لورد", quantity: 1 }]
});

test("orderDay reads Salla date objects and strings", () => {
  assert.equal(orderDay(order({ id: 1, total: 1, day: "2026-11-22" })), "2026-11-22");
  assert.equal(orderDay({ created_at: "2026-11-21T10:00:00Z" }), "2026-11-21");
  assert.equal(orderDay({}), "");
});

test("summarizeSallaOrders keeps cancelled orders out of revenue and AOV", () => {
  const s = summarizeSallaOrders([
    order({ id: 1, total: 300, day: "2026-11-22", pay: "tamara" }),
    order({ id: 2, total: 200, day: "2026-11-22", pay: "tabby", items: [{ name: "زيت لورد", quantity: 2 }, { name: "أداة التدليك", quantity: 1 }] }),
    order({ id: 3, total: 999, day: "2026-11-22", status: "ملغي", slug: "canceled" }),
    order({ id: 4, total: 50, day: "2026-11-10" })
  ], { since: "2026-11-20", until: "2026-11-22" });

  assert.equal(s.totals.orders, 3);
  assert.equal(s.totals.valid_orders, 2);
  assert.equal(s.totals.void_orders, 1);
  assert.equal(s.totals.revenue, 500);
  assert.equal(s.totals.avg_order_value, 250);
  assert.equal(s.totals.multi_item_orders, 1);
  assert.deepEqual(s.daily, [{ date: "2026-11-22", orders: 3, revenue: 500 }]);
  assert.equal(s.products[0].name, "زيت لورد");
  assert.equal(s.products[0].orders, 3);
  assert.equal(s.products[0].units, 4);
  assert.equal(s.payments.find((p) => p.name === "تمارا (تقسيط)").revenue, 300);
});

test("paymentLabel maps Salla slugs to Arabic names", () => {
  assert.equal(paymentLabel("tamara"), "تمارا (تقسيط)");
  assert.equal(paymentLabel("unknown_gateway"), "unknown_gateway");
  assert.equal(paymentLabel(""), "غير محدد");
});

test("summarizeAbandonedCarts filters by day and sums totals", () => {
  const carts = [
    { id: 1, total: { amount: 300 }, updated_at: { date: "2026-11-22 10:00:00" } },
    { id: 2, total: { amount: 100 }, updated_at: "2026-11-01 10:00:00" }
  ];
  assert.deepEqual(summarizeAbandonedCarts(carts, { since: "2026-11-22", until: "2026-11-22" }), { count: 1, value: 300, avg_value: 300 });
  assert.equal(summarizeAbandonedCarts(carts).count, 2);
});

test("fetchSallaOrders pages with date filters and stops at the last page", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const page = Number(new URL(url).searchParams.get("page"));
    const data = page === 1
      ? Array.from({ length: 60 }, (_, i) => order({ id: i, total: 10, day: "2026-11-22" }))
      : [order({ id: 99, total: 10, day: "2026-11-21" })];
    return { ok: true, json: async () => ({ data, pagination: { totalPages: 2, total: 61 } }) };
  };
  const r = await fetchSallaOrders({ accessToken: "t", since: "2026-11-21", until: "2026-11-22", fetchImpl });
  assert.equal(r.orders.length, 61);
  assert.equal(r.complete, true);
  assert.equal(calls.length, 2);
  const qs = new URL(calls[0]).searchParams;
  assert.equal(qs.get("from_date"), "2026-11-21");
  assert.equal(qs.get("to_date"), "2026-11-22");
});

test("fetchSallaOrders surfaces HTTP status for auth errors", async () => {
  const fetchImpl = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: "Unauthorized" } }) });
  await assert.rejects(fetchSallaOrders({ accessToken: "t", since: "2026-11-22", until: "2026-11-22", fetchImpl }), (e) => e.status === 401);
});

test("compareAttribution flags platforms claiming more than the store got", () => {
  const c = compareAttribution({
    storeOrders: 29,
    storeRevenue: 7576,
    platforms: { snapchat: { spend: 1000, purchases: 25, revenue: 6000 }, meta: { spend: 500, purchases: 10, revenue: 2500 } }
  });
  assert.equal(c.claimed_purchases, 35);
  assert.equal(c.over_attributed, true);
  assert.equal(c.platforms[0].share_of_store_orders_pct, 86.21);
  assert.equal(c.blended_cpa_sar, 51.72);
  assert.equal(c.unattributed_orders, 0);
});
