// Workspace-scoped data access for the MCP server.
//
// The MCP request carries only a bearer token: no browser cookies and no
// active-workspace cookie. Earlier versions called the app's own HTTP routes
// through METRICSFLO_INTERNAL_ORIGIN, which broke whenever that origin
// redirected (the redirect drops the Cookie header) or sat behind Vercel
// Authentication (the reply is an HTML login page). Everything here reads
// the database and the ad platforms directly, for a workspace the caller has
// already been authorized for.

import { createSupabaseAdminClient } from "./supabaseServer";
import { getMetaTokenForWorkspace } from "./metaToken";
import { getGaConnectionForWorkspace } from "./gaToken";
import { getSnapchatTokenForWorkspace } from "./snapchatToken";
import { getDateRange as getSnapchatPresetRange } from "./snapchatApi";
import { fetchSnapchatLiveInsights } from "./snapchatLive";
import { fetchSnapchatChangeHistory } from "./snapchatChangeHistory";
import { snapchatTimeRange } from "./mcpDateRange.mjs";
import { fetchMetaInsights } from "./metaInsights.mjs";
import { buildMetaGraphUrl, fetchMetaCollection } from "./metaApi.mjs";
import { findLatestSnapchatMetricDate, readSnapchatCache } from "./snapchatCache.mjs";
import { fetchGa4Overview } from "./ga4Overview.mjs";
import { toSAR } from "./currency";
import {
  groupByWorkspace,
  listAdAccountsFromRows,
  mapWithConcurrency,
  mergeLiveMetaAccounts,
  summarizeIntegrations,
  withTimeout
} from "./mcpConnections.mjs";

const GA_RANGE_MAP = {
  today: "today",
  yesterday: "yesterday",
  last_7d: "7daysAgo",
  last_30d: "30daysAgo",
  maximum: "30daysAgo"
};

async function loadConnectionRows(workspaceIds) {
  if (!workspaceIds.length) return [];
  const { data, error } = await createSupabaseAdminClient()
    .from("platform_connections")
    .select("workspace_id, provider, account_id, account_name, account_currency, is_active, updated_at, metadata, access_token, refresh_token")
    .in("workspace_id", workspaceIds)
    .eq("is_active", true);

  if (error) throw new Error(error.message);

  // Never let token material leave this function.
  return (data || []).map(({ access_token, refresh_token, ...row }) => ({
    ...row,
    has_access_token: Boolean(access_token),
    has_refresh_token: Boolean(refresh_token)
  }));
}

export async function getIntegrationsByWorkspace(workspaceIds) {
  const grouped = groupByWorkspace(await loadConnectionRows(workspaceIds));
  return Object.fromEntries(
    workspaceIds.map((id) => [id, summarizeIntegrations(grouped[id] || [])])
  );
}

// Individual Meta accounts are persisted only by the OAuth callback, so an
// account shared with the user later would be missing from the rows. Merge a
// live me/adaccounts lookup in; fall back to the persisted rows if Meta is
// slow or unreachable.
async function discoverLiveMetaAccounts(workspaceId) {
  const token = await getMetaTokenForWorkspace(workspaceId);
  if (!token) return null;
  const url = buildMetaGraphUrl("me/adaccounts", { fields: "id,name,account_status,currency", limit: 500 });
  const result = await withTimeout(fetchMetaCollection({ url, token, maxPages: 10 }), 8000, "Meta account discovery");
  return result.data;
}

export async function getAdAccounts(workspaceId, { discoverLive = true } = {}) {
  const rows = await loadConnectionRows([workspaceId]);
  let meta = listAdAccountsFromRows(rows, "meta");
  if (discoverLive && meta.connected) {
    try {
      const live = await discoverLiveMetaAccounts(workspaceId);
      if (live) meta = { ...meta, accounts: mergeLiveMetaAccounts(meta.accounts, live) };
    } catch (error) {
      meta = { ...meta, discovery_error: error.message };
    }
  }
  return {
    meta,
    snapchat: listAdAccountsFromRows(rows, "snapchat")
  };
}

// `range` is an optional { since, until } from parseCustomRange; it overrides
// datePreset everywhere below.
export async function getMetaInsightsForWorkspace({ workspaceId, accountId, datePreset, level, range = null }) {
  const token = await getMetaTokenForWorkspace(workspaceId);
  if (!token) {
    return { success: false, message: "Meta is not connected for this workspace." };
  }
  const result = await fetchMetaInsights({
    token,
    accountId,
    level,
    datePreset,
    since: range?.since || "",
    until: range?.until || ""
  });
  return { success: true, ...result };
}

async function readSnapchatCacheFallback({ workspaceId, accountId, datePreset, level, pageSize }) {
  const admin = createSupabaseAdminClient();
  const metricDate = await findLatestSnapchatMetricDate(admin, { workspaceId, accountId, datePreset, level });
  if (!metricDate) return null;
  const cache = await readSnapchatCache(admin, {
    workspaceId,
    accountId,
    datePreset,
    level,
    metricDate,
    page: 1,
    pageSize
  });
  return { ...cache, snapshot_date: metricDate };
}

// Snapchat is fetched live from the Marketing API. The MetricsFlo sync cache
// is used only as a fallback when the live call fails for a preset range.
export async function getSnapchatInsightsForWorkspace({ workspaceId, accountId, datePreset, level, range = null, pageSize = 200, timeBudgetMs, campaignId = "", adsquadId = "" }) {
  const token = await getSnapchatTokenForWorkspace(workspaceId);
  const { startTime, endTime } = range ? snapchatTimeRange(range) : getSnapchatPresetRange(datePreset);

  let liveError = token ? null : "Snapchat token is missing or expired; reconnect Snapchat in MetricsFlo.";
  if (token) {
    try {
      const live = await fetchSnapchatLiveInsights({ token, accountId, level, startTime, endTime, campaignId, adsquadId, ...(timeBudgetMs ? { timeBudgetMs } : {}) });
      return { success: true, source: "live", ...live };
    } catch (error) {
      liveError = error.message;
    }
  }

  if (!range && !campaignId && !adsquadId) {
    const cache = await readSnapchatCacheFallback({ workspaceId, accountId, datePreset, level, pageSize }).catch(() => null);
    if (cache) return { success: true, source: "cache", live_error: liveError, ...cache };
  }
  return { success: false, message: `Snapchat live request failed: ${liveError}` };
}

export async function getSnapchatChangeHistoryForWorkspace({ workspaceId, accountId, datePreset, range = null, level, campaignId = "", entityId = "", categories = [] }) {
  const token = await getSnapchatTokenForWorkspace(workspaceId);
  if (!token) return { success: false, message: "Snapchat token is missing or expired; reconnect Snapchat in MetricsFlo." };
  const { startTime, endTime } = range ? snapchatTimeRange(range) : getSnapchatPresetRange(datePreset);
  const history = await fetchSnapchatChangeHistory({ token, accountId, level, startTime, endTime, campaignId, entityId, categories });
  return { success: true, ...history };
}

// GA4 properties the connected Google account can read.
async function listGa4Properties(accessToken) {
  const res = await fetch("https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200", {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(15000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `GA4 property list failed (HTTP ${res.status})`);
  return (data.accountSummaries || []).flatMap((account) =>
    (account.propertySummaries || []).map((p) => ({
      property_id: String(p.property || "").replace("properties/", ""),
      property_name: p.displayName || null,
      account_name: account.displayName || null
    }))
  );
}

export async function getGa4OverviewForWorkspace({ workspaceId, datePreset, range = null, propertyId: requestedPropertyId = "" }) {
  const { connection, propertyId: savedPropertyId, propertyName: savedPropertyName } = await getGaConnectionForWorkspace(workspaceId);
  if (!connection) return { success: false, message: "Google Analytics is not connected for this workspace." };

  // Use the caller's property_id, else the one saved in MetricsFlo, else the
  // only property the Google account has. Any explicit property must be one
  // this connection can read.
  let propertyId = savedPropertyId;
  let propertyName = savedPropertyName;
  let propertySource = "saved";
  if (requestedPropertyId || !savedPropertyId) {
    const properties = await listGa4Properties(connection.access_token);
    if (requestedPropertyId) {
      const match = properties.find((p) => p.property_id === requestedPropertyId);
      if (!match) return { success: false, message: `GA4 property ${requestedPropertyId} is not available to this Google connection.`, properties };
      ({ property_id: propertyId, property_name: propertyName } = match);
      propertySource = "requested";
    } else if (properties.length === 1) {
      ({ property_id: propertyId, property_name: propertyName } = properties[0]);
      propertySource = "only_property";
    } else {
      return {
        success: false,
        message: properties.length
          ? "No GA4 property is saved for this workspace. Pass property_id (one of properties), or select it on the Google Analytics page in MetricsFlo."
          : "The connected Google account has no GA4 properties.",
        properties
      };
    }
  }

  const gaRange = range ? "custom" : GA_RANGE_MAP[datePreset] || "30daysAgo";
  const report = await fetchGa4Overview({
    accessToken: connection.access_token,
    propertyId,
    range: gaRange,
    dateRange: range ? { startDate: range.since, endDate: range.until } : null
  });
  if (!report.ok) {
    return {
      success: false,
      property_id: propertyId,
      message: report.data?.error?.message || `GA4 request failed (HTTP ${report.status})`
    };
  }
  return {
    success: true,
    property_id: propertyId,
    property_name: propertyName,
    property_source: propertySource,
    range: gaRange,
    dateRange: report.dateRange,
    metrics: report.metrics
  };
}

function round2(value) {
  return Number(Number(value || 0).toFixed(2));
}

function accountLine({ platform, account, summary, source = "live", metricDate = null, lastSyncedAt = null }) {
  const currency = summary?.currency || account.currency || "USD";
  const spend = Number(summary?.spend || 0);
  const revenue = Number(summary?.purchase_value ?? summary?.revenue ?? 0);
  return {
    platform,
    account_id: account.id,
    account_name: account.name,
    currency,
    spend: round2(spend),
    revenue: round2(revenue),
    purchases: Number(summary?.purchases || 0),
    impressions: Number(summary?.impressions || 0),
    clicks: Number(summary?.clicks || 0),
    roas: round2(spend ? revenue / spend : 0),
    spend_sar: round2(toSAR(spend, currency)),
    revenue_sar: round2(toSAR(revenue, currency)),
    source,
    ...(metricDate ? { snapshot_date: metricDate } : {}),
    ...(lastSyncedAt ? { last_synced_at: lastSyncedAt } : {})
  };
}

function totals(lines) {
  const sum = lines.reduce(
    (acc, line) => {
      acc.spend_sar += line.spend_sar;
      acc.revenue_sar += line.revenue_sar;
      acc.purchases += line.purchases;
      acc.impressions += line.impressions;
      acc.clicks += line.clicks;
      return acc;
    },
    { spend_sar: 0, revenue_sar: 0, purchases: 0, impressions: 0, clicks: 0 }
  );
  return {
    currency: "SAR",
    spend: round2(sum.spend_sar),
    revenue: round2(sum.revenue_sar),
    purchases: sum.purchases,
    impressions: sum.impressions,
    clicks: sum.clicks,
    roas: round2(sum.spend_sar ? sum.revenue_sar / sum.spend_sar : 0),
    cpa: round2(sum.purchases ? sum.spend_sar / sum.purchases : 0),
    active_accounts: lines.filter((line) => line.spend > 0).length
  };
}

// One call that covers every connected ad account in the workspace (or the
// ones the caller picked), plus GA4. Each platform has its own time budget
// so one slow provider cannot fail the whole answer.
export async function getPerformanceOverviewForWorkspace({
  workspaceId,
  datePreset,
  range = null,
  metaAccountId = "",
  snapchatAccountId = ""
}) {
  const { meta, snapchat } = await getAdAccounts(workspaceId);
  const pick = (list, id, label) => {
    if (!id) return list;
    const found = list.filter((a) => a.id === id);
    if (!found.length) {
      throw Object.assign(new Error(`${label} account ${id} is not connected to this workspace. Use list_ad_accounts to see valid IDs.`), { status: 404 });
    }
    return found;
  };
  const metaAccounts = pick(meta.accounts, metaAccountId, "Meta");
  const snapAccounts = pick(snapchat.accounts, snapchatAccountId, "Snapchat");
  const errors = [];

  const metaTask = (async () => {
    if (!meta.connected || !metaAccounts.length) return [];
    const token = await getMetaTokenForWorkspace(workspaceId);
    if (!token) return [];
    const lines = await mapWithConcurrency(metaAccounts, 5, async (account) => {
      try {
        const result = await fetchMetaInsights({
          token,
          accountId: account.id,
          level: "account",
          datePreset,
          since: range?.since || "",
          until: range?.until || ""
        });
        const summary = { ...result.summary, currency: result.currency || account.currency };
        return accountLine({ platform: "meta", account, summary });
      } catch (error) {
        errors.push({ platform: "meta", account_id: account.id, account_name: account.name, error: error.message });
        return null;
      }
    });
    return lines.filter(Boolean);
  })();

  const snapTask = (async () => {
    if (!snapAccounts.length) return [];
    const lines = await mapWithConcurrency(snapAccounts, 5, async (account) => {
      try {
        const result = await withTimeout(
          getSnapchatInsightsForWorkspace({ workspaceId, accountId: account.id, datePreset, level: "account", range, pageSize: 10, timeBudgetMs: 12000 }),
          25000,
          `Snapchat ${account.id}`
        );
        if (!result.success) {
          errors.push({ platform: "snapchat", account_id: account.id, account_name: account.name, error: result.message });
          return null;
        }
        if (result.source === "live" && !result.complete) {
          errors.push({
            platform: "snapchat",
            account_id: account.id,
            account_name: account.name,
            error: `Partial data: covers ${result.spend_coverage_pct ?? "?"}% of account spend (${result.entities_checked} campaigns checked, ${result.entities_unchecked} not reached, ${result.failed_requests} failed).`
          });
        }
        return accountLine({
          platform: "snapchat",
          account,
          summary: result.summary,
          source: result.source,
          metricDate: result.source === "cache" ? result.snapshot_date : null,
          lastSyncedAt: result.source === "cache" ? result.last_synced_at : null
        });
      } catch (error) {
        errors.push({ platform: "snapchat", account_id: account.id, account_name: account.name, error: error.message });
        return null;
      }
    });
    return lines.filter(Boolean);
  })();

  const gaTask = getGa4OverviewForWorkspace({ workspaceId, datePreset, range });

  const settle = async (task, label, ms = 40000) => {
    try {
      return await withTimeout(task, ms, label);
    } catch (error) {
      errors.push({ platform: label, error: error.message });
      return null;
    }
  };

  const [metaLines, snapLines, ga4] = await Promise.all([
    settle(metaTask, "meta"),
    settle(snapTask, "snapchat", 50000),
    settle(gaTask, "ga4")
  ]);

  const accounts = [...(metaLines || []), ...(snapLines || [])].sort((a, b) => b.spend_sar - a.spend_sar);
  const cachedSnap = (snapLines || []).filter((l) => l.source === "cache");

  return {
    success: true,
    workspace: { id: workspaceId },
    date_preset: range ? "custom" : datePreset,
    ...(range ? { date_range: { since: range.since, until: range.until } } : {}),
    totals: totals(accounts),
    by_platform: {
      meta: { connected: meta.connected, accounts_checked: metaAccounts.length, ...totals(metaLines || []) },
      snapchat: {
        connected: snapchat.connected,
        accounts_checked: snapAccounts.length,
        accounts_with_data: (snapLines || []).length,
        ...totals(snapLines || [])
      }
    },
    accounts,
    ga4: ga4?.success ? { property_name: ga4.property_name, range: ga4.range, dateRange: ga4.dateRange, metrics: ga4.metrics } : null,
    errors,
    notes: [
      "Meta and Snapchat numbers are live from the Meta Graph API and the Snapchat Marketing API.",
      "Snapchat uses 28-day swipe / 1-day view attribution, reported at impression time (Ads Manager default).",
      ...(cachedSnap.length
        ? [`Live Snapchat failed for ${cachedSnap.length} account(s); their rows come from the last MetricsFlo sync (source: "cache").`]
        : []),
      "SAR totals use MetricsFlo's fixed exchange rates; per-account rows keep the original currency."
    ]
  };
}
