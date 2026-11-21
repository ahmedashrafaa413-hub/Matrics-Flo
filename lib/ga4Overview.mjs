// Shared GA4 overview report. Used by /api/ga/overview and the MCP server.

export function getGa4DateRange(range) {
  if (range === "today") return { startDate: "today", endDate: "today" };
  if (range === "yesterday") return { startDate: "yesterday", endDate: "yesterday" };
  if (range === "7daysAgo") return { startDate: "7daysAgo", endDate: "today" };
  if (range === "90daysAgo") return { startDate: "90daysAgo", endDate: "today" };
  return { startDate: "30daysAgo", endDate: "today" };
}

export function parseGa4OverviewRow(data) {
  const values = data?.rows?.[0]?.metricValues || [];

  const sessions = Number(values[0]?.value || 0);
  const users = Number(values[1]?.value || 0);
  const pageViews = Number(values[2]?.value || 0);
  const conversions = Number(values[3]?.value || 0);
  const engagementRate = Number(values[4]?.value || 0) * 100;
  const bounceRate = Number(values[5]?.value || 0) * 100;
  const averageSessionDuration = Number(values[6]?.value || 0);
  const conversionRate = sessions > 0 ? (conversions / sessions) * 100 : 0;

  return {
    sessions,
    users,
    pageViews,
    conversions,
    conversionRate: Number(conversionRate.toFixed(2)),
    engagementRate: Number(engagementRate.toFixed(2)),
    bounceRate: Number(bounceRate.toFixed(2)),
    averageSessionDuration: Number(averageSessionDuration.toFixed(2))
  };
}

// Returns { ok, status, data, metrics, dateRange }.
// `dateRange` ({ startDate, endDate } as YYYY-MM-DD) overrides `range`.
export async function fetchGa4Overview({ accessToken, propertyId, range, dateRange: customRange = null, fetchImpl = fetch }) {
  const dateRange = customRange || getGa4DateRange(range);

  const response = await fetchImpl(
    `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`,
    {
      method: "POST",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        dateRanges: [dateRange],
        metrics: [
          { name: "sessions" },
          { name: "totalUsers" },
          { name: "screenPageViews" },
          { name: "conversions" },
          { name: "engagementRate" },
          { name: "bounceRate" },
          { name: "averageSessionDuration" }
        ]
      })
    }
  );

  const data = await response.json();

  return {
    ok: response.ok,
    status: response.status,
    data,
    dateRange,
    metrics: response.ok ? parseGa4OverviewRow(data) : null
  };
}
