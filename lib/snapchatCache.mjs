// Shared reader for the synced Snapchat cache (platform_daily_metrics).
// Used by /api/snapchat/data (browser session) and the MCP server
// (explicit workspace). The Supabase admin client is passed in so this
// module stays free of Next.js request APIs and can be unit tested.

function safeNum(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function fix2(value) {
  return Number(safeNum(value).toFixed(2));
}

export function riyadhToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

export function normalizeSnapchatLevel(level) {
  const raw = String(level || "campaign").toLowerCase();

  if (raw === "overview" || raw === "account") return "account";
  if (raw === "campaign" || raw === "campaigns") return "campaign";
  if (raw === "adsquad" || raw === "ad_squad" || raw === "ad_squads") return "adsquad";
  if (raw === "ad" || raw === "ads") return "ad";

  return "campaign";
}

export function buildSnapchatSummary(rows) {
  const total = rows.reduce(
    (acc, row) => {
      acc.spend += safeNum(row.spend);
      acc.revenue += safeNum(row.revenue);
      acc.purchases += safeNum(row.purchases);
      acc.impressions += safeNum(row.impressions);
      acc.clicks += safeNum(row.clicks);
      acc.video_views += safeNum(row.video_views);
      return acc;
    },
    { spend: 0, revenue: 0, purchases: 0, impressions: 0, clicks: 0, video_views: 0 }
  );

  return {
    currency: rows[0]?.currency || "USD",
    spend: fix2(total.spend),
    revenue: fix2(total.revenue),
    purchase_value: fix2(total.revenue),
    purchases: total.purchases,
    impressions: total.impressions,
    swipes: total.clicks,
    clicks: total.clicks,
    video_views: total.video_views,
    roas: fix2(total.spend ? total.revenue / total.spend : 0),
    cpa: fix2(total.purchases ? total.spend / total.purchases : 0),
    ctr: fix2(total.impressions ? (total.clicks / total.impressions) * 100 : 0),
    cpc: fix2(total.clicks ? total.spend / total.clicks : 0),
    cpm: fix2(total.impressions ? (total.spend / total.impressions) * 1000 : 0),
    video_view_rate: fix2(total.impressions ? (total.video_views / total.impressions) * 100 : 0)
  };
}

export function normalizeSnapchatRow(item) {
  const spend = safeNum(item.spend);
  const revenue = safeNum(item.revenue);
  const purchases = safeNum(item.purchases);
  const impressions = safeNum(item.impressions);
  const clicks = safeNum(item.clicks);
  const videoViews = safeNum(item.video_views);

  return {
    id: item.entity_id,
    name: item.entity_name,
    currency: item.currency || "USD",
    spend,
    revenue,
    purchase_value: revenue,
    purchases,
    impressions,
    swipes: clicks,
    clicks,
    video_views: videoViews,
    roas: fix2(spend ? revenue / spend : 0),
    cpa: fix2(purchases ? spend / purchases : 0),
    ctr: fix2(impressions ? (clicks / impressions) * 100 : 0),
    cpc: fix2(clicks ? spend / clicks : 0),
    cpm: fix2(impressions ? (spend / impressions) * 1000 : 0),
    status: item.raw?.status || item.raw?.raw_status || "UNKNOWN",
    raw: item.raw || {}
  };
}

function summaryFromRow(row) {
  return {
    currency: row.currency,
    spend: row.spend,
    revenue: row.revenue,
    purchase_value: row.purchase_value,
    purchases: row.purchases,
    impressions: row.impressions,
    swipes: row.swipes,
    clicks: row.clicks,
    video_views: row.video_views,
    roas: row.roas,
    cpa: row.cpa,
    ctr: row.ctr,
    cpc: row.cpc,
    cpm: row.cpm
  };
}

function scoped(admin, { workspaceId, accountId, datePreset }) {
  return (columns, options) =>
    admin
      .from("platform_daily_metrics")
      .select(columns, options)
      .eq("workspace_id", workspaceId)
      .eq("provider", "snapchat")
      .eq("account_id", accountId)
      .filter("raw->>date_preset", "eq", datePreset);
}

// Most recent metric_date that has a synced snapshot for this preset/level.
// The MCP uses it so a sync from earlier in the week is still returned (with
// its date) instead of an empty answer when nothing was synced today.
export async function findLatestSnapchatMetricDate(admin, { workspaceId, accountId, datePreset, level }) {
  if (!workspaceId) throw new Error("workspaceId is required");
  const { data, error } = await scoped(admin, { workspaceId, accountId, datePreset })("metric_date")
    .eq("entity_level", normalizeSnapchatLevel(level))
    .order("metric_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data?.metric_date || null;
}

export async function readSnapchatCache(admin, {
  workspaceId,
  accountId,
  datePreset = "last_30d",
  level = "campaign",
  metricDate = riyadhToday(),
  page = 1,
  pageSize = 50
}) {
  if (!workspaceId) throw new Error("workspaceId is required");
  if (!accountId) throw Object.assign(new Error("account_id is required"), { status: 400 });

  const entityLevel = normalizeSnapchatLevel(level);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const query = scoped(admin, { workspaceId, accountId, datePreset });

  const baseQuery = query("*", { count: "exact" })
    .eq("metric_date", metricDate)
    .eq("entity_level", entityLevel)
    .order("spend", { ascending: false });

  const { data, error, count } =
    entityLevel === "account" ? await baseQuery.limit(1) : await baseQuery.range(from, to);

  if (error) throw new Error(error.message);

  const dbRows = data || [];
  const rows = dbRows.map(normalizeSnapchatRow);

  // The top-line summary must reflect the TRUE account totals, never a sum
  // over a truncated top-N subset. The accurate total lives in the single
  // entity_level="account" row written during sync.
  const { data: accountRow, error: accountError } = await query("*")
    .eq("metric_date", metricDate)
    .eq("entity_level", "account")
    .maybeSingle();

  if (accountError) throw new Error(accountError.message);

  let summary;

  if (accountRow) {
    summary = summaryFromRow(normalizeSnapchatRow(accountRow));
  } else if (entityLevel === "account" && rows[0]) {
    summary = summaryFromRow(rows[0]);
  } else {
    // No account-level row cached: sum the entity rows for this level.
    // This can under-count if not every entity was saved.
    const { data: allSummaryRows, error: summaryError } = await query(
      "spend,revenue,purchases,impressions,clicks,video_views,currency"
    )
      .eq("metric_date", metricDate)
      .eq("entity_level", entityLevel);

    if (summaryError) throw new Error(summaryError.message);
    summary = buildSnapchatSummary(allSummaryRows || []);
  }

  return {
    entity_level: entityLevel,
    metric_date: metricDate,
    page,
    page_size: pageSize,
    total_rows: count || rows.length,
    loaded_rows: rows.length,
    has_more: entityLevel !== "account" ? to + 1 < (count || 0) : false,
    last_synced_at:
      accountRow?.updated_at ||
      accountRow?.created_at ||
      dbRows[0]?.updated_at ||
      dbRows[0]?.created_at ||
      null,
    summary,
    rows
  };
}
