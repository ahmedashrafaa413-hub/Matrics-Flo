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
import { fetchMetaInsights } from "./metaInsights.mjs";
import { findLatestSnapchatMetricDate, readSnapchatCache } from "./snapchatCache.mjs";
import { fetchGa4Overview } from "./ga4Overview.mjs";
import { toSAR } from "./currency";
import {
  groupByWorkspace,
  listAdAccountsFromRows,
  mapWithConcurrency,
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

export async function getAdAccounts(workspaceId) {
  const rows = await loadConnectionRows([workspaceId]);
  return {
    meta: listAdAccountsFromRows(rows, "meta"),
    snapchat: listAdAccountsFromRows(rows, "snapchat")
  };
}

export async function getMetaInsightsForWorkspace({ workspaceId, accountId, datePreset, level }) {
  const token = await getMetaTokenForWorkspace(workspaceId);
  if (!token) {
    return { success: false, message: "Meta is not connected for this workspace." };
  }
  const result = await fetchMetaInsights({ token, accountId, level, datePreset });
  return { success: true, ...result };
}

export async function getSnapchatInsightsForWorkspace({ workspaceId, accountId, datePreset, level, pageSize = 200 }) {
  const admin = createSupabaseAdminClient();
  const metricDate = await findLatestSnapchatMetricDate(admin, {
    workspaceId,
    accountId,
    datePreset,
    level
  });

  if (!metricDate) {
    return {
      success: false,
      message: `No synced Snapchat data for date_preset "${datePreset}" on this account. Run a sync for that range from the Snapchat page in MetricsFlo.`
    };
  }

  const cache = await readSnapchatCache(admin, {
    workspaceId,
    accountId,
    datePreset,
    level,
    metricDate,
    page: 1,
    pageSize
  });
  return { success: true, ...cache };
}

export async function getGa4OverviewForWorkspace({ workspaceId, datePreset }) {
  const { connection, propertyId, propertyName } = await getGaConnectionForWorkspace(workspaceId);
  if (!connection) return { success: false, message: "Google Analytics is not connected for this workspace." };
  if (!propertyId) return { success: false, message: "No GA4 property is selected in MetricsFlo." };

  const range = GA_RANGE_MAP[datePreset] || "30daysAgo";
  const report = await fetchGa4Overview({ accessToken: connection.access_token, propertyId, range });
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
    range,
    dateRange: report.dateRange,
    metrics: report.metrics
  };
}

function round2(value) {
  return Number(Number(value || 0).toFixed(2));
}

function accountLine({ platform, account, summary, metricDate = null, lastSyncedAt = null }) {
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
  metaAccountId = "",
  snapchatAccountId = ""
}) {
  const { meta, snapchat } = await getAdAccounts(workspaceId);
  const pick = (list, id) => (id ? list.filter((a) => a.id === id) : list);
  const metaAccounts = pick(meta.accounts, metaAccountId);
  const snapAccounts = pick(snapchat.accounts, snapchatAccountId);
  const errors = [];

  const metaTask = (async () => {
    if (!meta.connected || !metaAccounts.length) return [];
    const token = await getMetaTokenForWorkspace(workspaceId);
    if (!token) return [];
    const lines = await mapWithConcurrency(metaAccounts, 5, async (account) => {
      try {
        const result = await fetchMetaInsights({ token, accountId: account.id, level: "account", datePreset });
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
    const admin = createSupabaseAdminClient();
    const lines = await mapWithConcurrency(snapAccounts, 5, async (account) => {
      try {
        const metricDate = await findLatestSnapchatMetricDate(admin, {
          workspaceId, accountId: account.id, datePreset, level: "account"
        });
        if (!metricDate) return null;
        const cache = await readSnapchatCache(admin, {
          workspaceId, accountId: account.id, datePreset, level: "account", metricDate, pageSize: 10
        });
        return accountLine({
          platform: "snapchat",
          account,
          summary: cache.summary,
          metricDate,
          lastSyncedAt: cache.last_synced_at
        });
      } catch (error) {
        errors.push({ platform: "snapchat", account_id: account.id, account_name: account.name, error: error.message });
        return null;
      }
    });
    return lines.filter(Boolean);
  })();

  const gaTask = getGa4OverviewForWorkspace({ workspaceId, datePreset });

  const settle = async (task, label) => {
    try {
      return await withTimeout(task, 40000, label);
    } catch (error) {
      errors.push({ platform: label, error: error.message });
      return null;
    }
  };

  const [metaLines, snapLines, ga4] = await Promise.all([
    settle(metaTask, "meta"),
    settle(snapTask, "snapchat"),
    settle(gaTask, "ga4")
  ]);

  const accounts = [...(metaLines || []), ...(snapLines || [])].sort((a, b) => b.spend_sar - a.spend_sar);
  const snapshotDates = [...new Set((snapLines || []).map((l) => l.snapshot_date))];

  return {
    success: true,
    workspace: { id: workspaceId },
    date_preset: datePreset,
    totals: totals(accounts),
    by_platform: {
      meta: { connected: meta.connected, accounts_checked: metaAccounts.length, ...totals(metaLines || []) },
      snapchat: {
        connected: snapchat.connected,
        accounts_checked: snapAccounts.length,
        accounts_with_synced_data: (snapLines || []).length,
        ...totals(snapLines || [])
      }
    },
    accounts,
    ga4: ga4?.success ? { property_name: ga4.property_name, range: ga4.range, metrics: ga4.metrics } : null,
    errors,
    notes: [
      "Meta numbers are live from the Meta Graph API.",
      `Snapchat numbers come from the last MetricsFlo sync for "${datePreset}"${snapshotDates.length ? ` (snapshot dates: ${snapshotDates.join(", ")})` : ""}; run a sync for fresher data.`,
      "SAR totals use MetricsFlo's fixed exchange rates; per-account rows keep the original currency."
    ]
  };
}
