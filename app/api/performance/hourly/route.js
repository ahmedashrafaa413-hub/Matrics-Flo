import { NextResponse } from "next/server";
import { requireUser } from "../../../../lib/serverAuth";
import { createSupabaseAdminClient } from "../../../../lib/supabaseServer";
import { getActiveWorkspace } from "../../../../lib/workspace";
import { getSallaConnection } from "../../../../lib/sallaToken";
import { getGaConnection } from "../../../../lib/gaToken";
import { getRiyadhDateRange } from "../../../../lib/riyadhDateRange.mjs";

export const dynamic = "force-dynamic";

const RIYADH_TIMEZONE = "Asia/Riyadh";

function datePart(value) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: RIYADH_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(value));
  const part = (type) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function hourPart(value) {
  return Number(new Intl.DateTimeFormat("en-US", {
    timeZone: RIYADH_TIMEZONE,
    hour: "2-digit",
    hourCycle: "h23"
  }).format(new Date(value)));
}

function emptyHours() {
  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    today_sales: 0,
    yesterday_sales: 0,
    today_orders: 0,
    yesterday_orders: 0,
    today_sessions: 0,
    yesterday_sessions: 0,
    today_conversions: 0,
    yesterday_conversions: 0
  }));
}

async function loadSalla(request, rows, today, yesterday) {
  const { workspace, connection } = await getSallaConnection(request);
  if (!connection) return { success: false, error: "NOT_CONNECTED" };

  const admin = createSupabaseAdminClient();
  const todayRange = getRiyadhDateRange("today");
  const yesterdayRange = getRiyadhDateRange("yesterday");
  const { data, error } = await admin
    .from("salla_orders")
    .select("order_id,total_amount,order_date")
    .eq("workspace_id", workspace.id)
    .gte("order_date", yesterdayRange.fromTimestamp)
    .lt("order_date", todayRange.toExclusiveTimestamp);

  if (error) throw new Error(error.message);

  for (const order of data || []) {
    const date = datePart(order.order_date);
    const hour = hourPart(order.order_date);
    if (!Number.isInteger(hour) || !rows[hour]) continue;
    if (date === today) {
      rows[hour].today_sales += Number(order.total_amount || 0);
      rows[hour].today_orders += 1;
    } else if (date === yesterday) {
      rows[hour].yesterday_sales += Number(order.total_amount || 0);
      rows[hour].yesterday_orders += 1;
    }
  }

  return { success: true, fetched_at: new Date().toISOString() };
}

async function loadGa(request, rows, today, yesterday) {
  const { connection, propertyId } = await getGaConnection(request);
  if (!connection || !propertyId) return { success: false, error: "NOT_CONNECTED" };

  const response = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: "POST",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${connection.access_token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        dateRanges: [{ startDate: "yesterday", endDate: "today" }],
        dimensions: [{ name: "dateHour" }],
        metrics: [{ name: "sessions" }, { name: "conversions" }],
        limit: 100
      })
    }
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || "GA4 hourly report failed");

  const compactToday = today.replaceAll("-", "");
  const compactYesterday = yesterday.replaceAll("-", "");
  for (const row of data.rows || []) {
    const dateHour = row.dimensionValues?.[0]?.value || "";
    const date = dateHour.slice(0, 8);
    const hour = Number(dateHour.slice(8, 10));
    if (!Number.isInteger(hour) || !rows[hour]) continue;
    if (date === compactToday) {
      rows[hour].today_sessions += Number(row.metricValues?.[0]?.value || 0);
      rows[hour].today_conversions += Number(row.metricValues?.[1]?.value || 0);
    } else if (date === compactYesterday) {
      rows[hour].yesterday_sessions += Number(row.metricValues?.[0]?.value || 0);
      rows[hour].yesterday_conversions += Number(row.metricValues?.[1]?.value || 0);
    }
  }

  return { success: true, fetched_at: new Date().toISOString() };
}

export async function GET(request) {
  try {
    await requireUser(request);
    await getActiveWorkspace(request);
    const rows = emptyHours();
    const today = getRiyadhDateRange("today").from;
    const yesterday = getRiyadhDateRange("yesterday").from;
    const [sallaResult, gaResult] = await Promise.allSettled([
      loadSalla(request, rows, today, yesterday),
      loadGa(request, rows, today, yesterday)
    ]);
    const status = (result) => result.status === "fulfilled"
      ? result.value
      : { success: false, error: result.reason?.message || "LOAD_FAILED" };

    return NextResponse.json({
      success: true,
      timezone: RIYADH_TIMEZONE,
      today,
      yesterday,
      generated_at: new Date().toISOString(),
      sources: { salla: status(sallaResult), ga4: status(gaResult) },
      rows
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error?.message || "Failed to load hourly performance" },
      { status: error?.status || 500 }
    );
  }
}
