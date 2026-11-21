// Live Snapchat Ads reporting for the MCP server, straight from the Snapchat
// Marketing API (no prior sync needed). Uses the same per-entity stats calls
// as /api/snapchat/insights, which the code base found to be the only
// reliable source of numbers (the bulk breakdown endpoint drops stats on
// large accounts).

import { buildMetrics, fetchAdAccountSpend, fetchEntities, fetchEntityStats } from "./snapchatApi";
import { selectReportableEntities } from "./snapchatEntitySelection.mjs";

const ENTITY_LIMIT = 700;
const CONCURRENCY = 12;
// Stop starting new stats requests after this long so the MCP call (60s
// limit) always answers; entities not reached are reported as unchecked.
const TIME_BUDGET_MS = 40000;
const SWIPE_WINDOW = "28_DAY";
const VIEW_WINDOW = "1_DAY";
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map();

function errorText(error) {
  if (!error) return "unknown error";
  if (typeof error === "string") return error.slice(0, 300);
  return String(error.debug_message || error.display_message || error.request_status || JSON.stringify(error)).slice(0, 300);
}

function addRawStats(totals, stats) {
  for (const [key, value] of Object.entries(stats || {})) {
    totals[key] = (Number(totals[key]) || 0) + (Number(value) || 0);
  }
  return totals;
}

// Like mapWithConcurrency, but no new item starts after the deadline; those
// slots stay null.
async function mapUntilDeadline(items, limit, deadline, mapper) {
  const out = new Array(items.length).fill(null);
  let next = 0;
  async function worker() {
    while (next < items.length && Date.now() < deadline) {
      const i = next++;
      out[i] = await mapper(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// level: account | campaign | adsquad | ad
export async function fetchSnapchatLiveInsights({ token, accountId, level = "campaign", startTime, endTime, timeBudgetMs = TIME_BUDGET_MS }) {
  const key = `${accountId}:${level}:${startTime}:${endTime}:${timeBudgetMs}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { ...hit.value, cached: true };

  // Account totals are the sum of every campaign (including paused/deleted
  // ones that still spent in the range), with spend taken from the
  // ad-account endpoint for exact Ads Manager parity.
  const entityLevel = level === "account" ? "campaign" : level;
  const [entitiesResult, spendResult] = await Promise.all([
    fetchEntities({ accountId, level: entityLevel, token }),
    fetchAdAccountSpend({ accountId, token, startTime, endTime })
  ]);
  if (!entitiesResult.ok) throw new Error(`Snapchat ${entityLevel} list failed: ${errorText(entitiesResult.error)}`);

  const selection = selectReportableEntities(entitiesResult.entities, { startTime, endTime, limit: ENTITY_LIMIT });
  const entities = selection.selected;
  const deadline = Date.now() + timeBudgetMs;
  const results = await mapUntilDeadline(entities, CONCURRENCY, deadline, async (entity) => {
    const result = await fetchEntityStats({
      level: entityLevel,
      entityId: entity.id,
      token,
      startTime,
      endTime,
      swipeWindow: SWIPE_WINDOW,
      viewWindow: VIEW_WINDOW
    });
    return { entity, ...result };
  });

  const attempted = results.filter(Boolean);
  const failed = attempted.filter((r) => !r.ok);
  if (attempted.length && failed.length === attempted.length) {
    throw new Error(`Snapchat stats failed for every ${entityLevel}: ${errorText(failed[0].error)}`);
  }

  const totals = results.reduce((acc, r) => (r?.ok ? addRawStats(acc, r.stats) : acc), {});
  const unchecked = selection.candidates - attempted.length;
  const complete = !failed.length && unchecked === 0;
  const checkedSpend = Number(totals.spend) || 0;
  const accountSpend = spendResult.ok ? Number(spendResult.spend) || 0 : null;
  // With every candidate checked, take spend from the ad-account endpoint for
  // exact Ads Manager parity. Otherwise keep the summed entity totals so spend,
  // revenue and ROAS describe the same set of entities, and report coverage.
  if (complete && accountSpend !== null) totals.spend = accountSpend;
  const spendCoverage = accountSpend ? Math.min(100, Number(((checkedSpend / accountSpend) * 100).toFixed(1))) : null;

  const rows =
    level === "account"
      ? []
      : results
          .filter((r) => r?.ok && Number(r.metrics?.spend || 0) > 0.001)
          .map((r) => ({
            id: r.entity.id,
            name: r.entity.name,
            status: r.entity.status,
            ...(r.entity.campaign_id ? { campaign_id: r.entity.campaign_id } : {}),
            ...(r.entity.adsquad_id ? { adsquad_id: r.entity.adsquad_id } : {}),
            ...r.metrics
          }))
          .sort((a, b) => b.spend - a.spend);

  const value = {
    summary: buildMetrics(totals),
    rows,
    entities_total: entitiesResult.entities.length,
    entities_skipped_out_of_range: selection.skipped_out_of_range,
    entities_checked: attempted.length,
    entities_unchecked: unchecked,
    failed_requests: failed.length,
    complete,
    account_spend: accountSpend === null ? null : Number((accountSpend / 1e6).toFixed(2)),
    spend_coverage_pct: spendCoverage,
    attribution: { swipe_window: SWIPE_WINDOW, view_window: VIEW_WINDOW, action_report_time: "impression" },
    start_time: startTime,
    end_time: endTime
  };
  cache.set(key, { at: Date.now(), value });
  return value;
}
