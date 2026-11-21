// Live Snapchat Ads reporting for the MCP server, straight from the Snapchat
// Marketing API (no prior sync needed). Uses the same per-entity stats calls
// as /api/snapchat/insights, which the code base found to be the only
// reliable source of numbers (the bulk breakdown endpoint drops stats on
// large accounts).

import {
  buildMetrics,
  fetchAdAccountSpend,
  fetchEntities,
  fetchEntityStats,
  mapWithConcurrency
} from "./snapchatApi";

const ENTITY_LIMIT = 400;
const CONCURRENCY = 8;
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

// level: account | campaign | adsquad | ad
export async function fetchSnapchatLiveInsights({ token, accountId, level = "campaign", startTime, endTime }) {
  const key = `${accountId}:${level}:${startTime}:${endTime}`;
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

  const entities = entitiesResult.entities.slice(0, ENTITY_LIMIT);
  const results = await mapWithConcurrency(entities, CONCURRENCY, async (entity) => {
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

  const failed = results.filter((r) => !r.ok);
  if (entities.length && failed.length === entities.length) {
    throw new Error(`Snapchat stats failed for every ${entityLevel}: ${errorText(failed[0].error)}`);
  }

  const totals = results.reduce((acc, r) => (r.ok ? addRawStats(acc, r.stats) : acc), {});
  const complete = !failed.length && entitiesResult.entities.length <= ENTITY_LIMIT;
  if (spendResult.ok) totals.spend = spendResult.spend;

  const rows =
    level === "account"
      ? []
      : results
          .filter((r) => r.ok && Number(r.metrics?.spend || 0) > 0.001)
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
    entities_checked: entities.length,
    failed_requests: failed.length,
    complete,
    attribution: { swipe_window: SWIPE_WINDOW, view_window: VIEW_WINDOW, action_report_time: "impression" },
    start_time: startTime,
    end_time: endTime
  };
  cache.set(key, { at: Date.now(), value });
  return value;
}
