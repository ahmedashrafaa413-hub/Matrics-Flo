import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { getReportingPeriod, zoneOffset } from "../lib/reportingPeriod.mjs";
import { getGaDateRange } from "../lib/gaDateRange.mjs";
import { getRiyadhDateRange } from "../lib/riyadhDateRange.mjs";
import { hasWorkspaceRole, requireWorkspaceRole } from "../lib/tenantFoundation.mjs";
import {
  isRevenueOrder,
  normalizeSallaDate,
  summarizeOrders
} from "../lib/sallaOrders.mjs";
import { buildConnectionStatus } from "../lib/connectionStatus.mjs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// 2026-10-15 13:00 in Riyadh
const NOW = new Date("2026-10-15T10:00:00.000Z");

test("last_30d is the 30 complete days before today on every platform", () => {
  const period = getReportingPeriod("last_30d", { now: NOW });
  assert.equal(period.from, "2026-09-15");
  assert.equal(period.to, "2026-10-14");
  assert.equal(period.includesToday, false);

  const ga = getGaDateRange("30daysAgo", { now: NOW });
  assert.deepEqual([ga.startDate, ga.endDate], ["2026-09-15", "2026-10-14"]);

  const salla = getRiyadhDateRange("last_30d", NOW);
  assert.equal(salla.fromTimestamp, "2026-09-15T00:00:00+03:00");
  assert.equal(salla.toExclusiveTimestamp, "2026-10-15T00:00:00+03:00");
});

test("last_7d covers seven days, not eight", () => {
  const ga = getGaDateRange("7daysAgo", { now: NOW });
  const days = (new Date(ga.endDate) - new Date(ga.startDate)) / 86_400_000 + 1;
  assert.equal(days, 7);
});

test("last_month is the whole previous calendar month everywhere", () => {
  const period = getReportingPeriod("last_month", { now: NOW });
  assert.deepEqual([period.from, period.to], ["2026-09-01", "2026-09-30"]);

  const january = getReportingPeriod("last_month", {
    now: new Date("2026-01-10T10:00:00Z")
  });
  assert.deepEqual([january.from, january.to], ["2025-12-01", "2025-12-31"]);

  const ga = getGaDateRange("last_month", { now: NOW });
  assert.deepEqual([ga.startDate, ga.endDate], ["2026-09-01", "2026-09-30"]);
});

test("periods follow the given timezone", () => {
  // 22:30 UTC is already the next day in Riyadh but not in UTC.
  const late = new Date("2026-10-15T22:30:00Z");
  assert.equal(getReportingPeriod("today", { now: late }).from, "2026-10-16");
  assert.equal(getReportingPeriod("today", { now: late, timeZone: "UTC" }).from, "2026-10-15");
  assert.equal(zoneOffset("2026-01-15", "UTC"), "+00:00");
  assert.equal(zoneOffset("2026-01-15", "Asia/Riyadh"), "+03:00");
  assert.equal(getReportingPeriod("today", { now: NOW, timeZone: "Not/AZone" }).timeZone, "Asia/Riyadh");
});

test("workspace roles are ranked and enforced", () => {
  assert.equal(hasWorkspaceRole("owner", "admin"), true);
  assert.equal(hasWorkspaceRole("member", "admin"), false);
  assert.equal(hasWorkspaceRole("viewer", "member"), false);
  assert.equal(hasWorkspaceRole(undefined, "viewer"), false);
  assert.throws(
    () => requireWorkspaceRole({ id: "w1", role: "viewer" }, "admin"),
    (error) => error.status === 403
  );
  assert.doesNotThrow(() => requireWorkspaceRole({ id: "w1", role: "admin" }, "admin"));
});

test("connecting a provider or starting OAuth requires an admin", () => {
  assert.match(read("lib/platformConnections.js"), /requireWorkspaceRole\(workspace, "admin"\)/);
  for (const provider of ["meta", "snapchat", "salla", "ga"]) {
    assert.match(
      read(`app/api/${provider}/auth/route.js`),
      /requireWorkspaceRole\(workspace, "admin"\)/,
      provider
    );
  }
});

test("cancelled and refunded Salla orders are not revenue", () => {
  assert.equal(isRevenueOrder({ statusSlug: "under_review" }), true);
  assert.equal(isRevenueOrder({ statusSlug: "canceled" }), false);
  assert.equal(isRevenueOrder({ statusSlug: "refunded" }), false);
  assert.equal(isRevenueOrder({ statusName: "ملغي" }), false);

  const summary = summarizeOrders([
    { total_amount: 100, status_slug: "completed" },
    { total_amount: 50, status_slug: "canceled" },
    { total_amount: 200, order_status: "بإنتظار المراجعة" }
  ]);
  assert.deepEqual(summary, {
    total_orders: 2,
    total_revenue: 300,
    average_order_value: 150,
    excluded_orders: 1
  });
});

test("Salla local times are stored with the Riyadh offset", () => {
  assert.equal(normalizeSallaDate("2026-06-03 14:09:36.000000"), "2026-06-03T14:09:36+03:00");
  assert.equal(normalizeSallaDate("2026-06-03 14:09"), "2026-06-03T14:09:00+03:00");
  assert.equal(normalizeSallaDate("2026-06-03T11:09:36Z"), "2026-06-03T11:09:36Z");
  assert.equal(normalizeSallaDate(null), null);
});

test("the overview reads Salla revenue under the field the summary returns", () => {
  assert.match(read("app/api/salla/summary/route.js"), /total_revenue: totalRevenue/);
  assert.match(read("app/api/performance/overview/route.js"), /sallaSummary\.total_revenue/);
});

test("the Salla summary pages past the 1,000-row PostgREST limit", () => {
  assert.match(read("app/api/salla/summary/route.js"), /fetchAllRows\(buildQuery\)/);
});

test("Snapchat sync writes the new cache before removing the old one", () => {
  const service = read("lib/snapchatSyncService.js");
  assert.ok(service.indexOf(".insert(payloadRows)") < service.indexOf(".delete()"));
});

test("expired connections are reported as needing reconnection", () => {
  const status = buildConnectionStatus([
    { provider: "salla", account_id: "salla_default", metadata: { needs_reconnect: true } },
    { provider: "snapchat", account_id: "snapchat_default", metadata: {} }
  ]);
  assert.equal(status.salla.needs_reconnect, true);
  assert.equal(status.snapchat.needs_reconnect, false);
});

test("token refresh is serialized and never silently reuses an expired token", () => {
  for (const file of ["lib/snapchatToken.js", "lib/sallaToken.js", "lib/metaToken.js", "lib/gaToken.js"]) {
    const source = read(file);
    assert.match(source, /refreshConnectionToken\(/, file);
    assert.doesNotMatch(source, /catch \{\s*\/\/ Refresh failed/, file);
  }
});

test("the daily sync cron is authenticated and scheduled", () => {
  const cron = read("app/api/cron/sync/route.js");
  assert.match(cron, /CRON_SECRET/);
  assert.match(cron, /timingSafeEqual/);
  const vercel = JSON.parse(read("vercel.json"));
  assert.ok(vercel.crons.some((entry) => entry.path === "/api/cron/sync"));
});

test("background sync retries only through the Workflow runtime", () => {
  const workflow = read("workflows/provider-sync.js");
  assert.match(workflow, /FatalError/);
  assert.match(workflow, /maxRetries = MAX_RETRIES/);
  assert.doesNotMatch(workflow, /for \(let attempt/);
});
