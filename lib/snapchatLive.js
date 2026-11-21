// Live Snapchat Ads reporting for the MCP server, straight from the Snapchat
// Marketing API (no prior sync needed). Uses the same per-entity stats calls
// as /api/snapchat/insights, which the code base found to be the only
// reliable source of numbers (the bulk breakdown endpoint drops stats on
// large accounts).
//
// Campaign level lists every campaign on the account. Ad squad and ad levels
// drill down instead: they take the campaigns (or ad squads) that spent in
// the range and list only their children, because large accounts hold
// thousands of old ad squads and ads.

import {
  buildMetrics,
  fetchAdAccountSpend,
  fetchChildEntities,
  fetchEntities,
  fetchEntityStats
} from "./snapchatApi";
import { selectReportableEntities } from "./snapchatEntitySelection.mjs";

const ENTITY_LIMIT = 900;
const CONCURRENCY = 12;
// The whole call must answer inside the MCP client's 60s limit. No new
// Snapchat request starts after the budget; anything not reached is
// reported as unchecked.
const TIME_BUDGET_MS = 45000;
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

function cached(key) {
  const hit = cache.get(key);
  return hit && Date.now() - hit.at < CACHE_TTL_MS ? hit.value : null;
}

// Per-entity stats for an already selected list, stopping at the deadline.
async function statsForEntities({ entities, level, token, startTime, endTime, deadline }) {
  const results = await mapUntilDeadline(entities, CONCURRENCY, deadline, async (entity) => {
    const result = await fetchEntityStats({
      level,
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
    throw new Error(`Snapchat stats failed for every ${level}: ${errorText(failed[0].error)}`);
  }
  const totals = attempted.reduce((acc, r) => (r.ok ? addRawStats(acc, r.stats) : acc), {});
  const rows = attempted
    .filter((r) => r.ok && Number(r.metrics?.spend || 0) > 0.001)
    .map((r) => ({
      id: r.entity.id,
      name: r.entity.name,
      status: r.entity.status,
      ...(r.entity.campaign_id ? { campaign_id: r.entity.campaign_id } : {}),
      ...(r.entity.campaign_name ? { campaign_name: r.entity.campaign_name } : {}),
      ...(r.entity.adsquad_id ? { adsquad_id: r.entity.adsquad_id } : {}),
      ...(r.entity.adsquad_name ? { adsquad_name: r.entity.adsquad_name } : {}),
      ...r.metrics
    }))
    .sort((a, b) => b.spend - a.spend);
  return { attempted: attempted.length, failed: failed.length, totals, rows };
}

// Every campaign on the account (account and campaign levels).
async function campaignLevel({ token, accountId, startTime, endTime, deadline }) {
  const [entitiesResult, spendResult] = await Promise.all([
    fetchEntities({ accountId, level: "campaign", token }),
    fetchAdAccountSpend({ accountId, token, startTime, endTime })
  ]);
  if (!entitiesResult.ok) throw new Error(`Snapchat campaign list failed: ${errorText(entitiesResult.error)}`);

  const selection = selectReportableEntities(entitiesResult.entities, { startTime, endTime, limit: ENTITY_LIMIT });
  const stats = await statsForEntities({ entities: selection.selected, level: "campaign", token, startTime, endTime, deadline });
  return {
    stats,
    entities_total: entitiesResult.entities.length,
    skipped: selection.skipped_out_of_range,
    unchecked: selection.candidates - stats.attempted,
    parentSpend: spendResult.ok ? Number(spendResult.spend) || 0 : null
  };
}

// Children (ad squads of campaigns, or ads of ad squads) of the given
// parents, each tagged with its parent's name.
async function childLevel({ parents, parentLevel, token, startTime, endTime, deadline }) {
  const childLevelName = parentLevel === "campaign" ? "adsquad" : "ad";
  const listed = await mapUntilDeadline(parents, CONCURRENCY, deadline, async (parent) => {
    const result = await fetchChildEntities({ parentLevel, parentId: parent.id, token });
    if (!result.ok) return { ok: false, error: result.error };
    const children = result.entities.map((child) =>
      parentLevel === "campaign"
        ? { ...child, campaign_name: parent.name }
        : { ...child, adsquad_name: parent.name, campaign_id: parent.campaign_id, campaign_name: parent.campaign_name }
    );
    return { ok: true, children };
  });
  const listedOk = listed.filter((r) => r?.ok);
  const parentsUnlisted = parents.length - listedOk.length;
  const all = listedOk.flatMap((r) => r.children);
  const selection = selectReportableEntities(all, { startTime, endTime, limit: ENTITY_LIMIT });
  const stats = await statsForEntities({ entities: selection.selected, level: childLevelName, token, startTime, endTime, deadline });
  return {
    stats,
    entities_total: all.length,
    skipped: selection.skipped_out_of_range,
    unchecked: selection.candidates - stats.attempted,
    parentsUnlisted
  };
}

// level: account | campaign | adsquad | ad. campaignId narrows ad squad and
// ad levels to one campaign; adsquadId narrows ad level to one ad squad.
export async function fetchSnapchatLiveInsights({
  token,
  accountId,
  level = "campaign",
  startTime,
  endTime,
  campaignId = "",
  adsquadId = "",
  timeBudgetMs = TIME_BUDGET_MS
}) {
  const key = `${accountId}:${level}:${startTime}:${endTime}:${campaignId}:${adsquadId}:${timeBudgetMs}`;
  const hit = cached(key);
  if (hit) return { ...hit, cached: true };
  const deadline = Date.now() + timeBudgetMs;
  const base = { start_time: startTime, end_time: endTime };

  let result;
  if (level === "account" || level === "campaign") {
    const run = await campaignLevel({ token, accountId, startTime, endTime, deadline });
    result = { ...run, parentsUnlisted: 0 };
  } else {
    // Parents of the requested level, with their spend for coverage.
    let parents;
    let parentSpend;
    if (level === "adsquad" || !adsquadId) {
      if (campaignId) {
        parents = [{ id: campaignId, name: null }];
        parentSpend = null;
      } else {
        // Reuse a recent campaign-level answer; otherwise give the campaign
        // pass at most half the budget so the children still get time.
        const campaignKey = `${accountId}:campaign:${startTime}:${endTime}:::${timeBudgetMs}`;
        const recent = cached(campaignKey);
        if (recent) {
          parents = recent.rows;
          parentSpend = recent.account_spend === null ? null : recent.account_spend * 1e6;
        } else {
          const campaignDeadline = Math.min(deadline, Date.now() + timeBudgetMs / 2);
          const run = await campaignLevel({ token, accountId, startTime, endTime, deadline: campaignDeadline });
          parents = run.stats.rows;
          parentSpend = run.parentSpend;
        }
      }
      if (level === "ad") {
        const squads = await childLevel({ parents, parentLevel: "campaign", token, startTime, endTime, deadline });
        parents = squads.stats.rows;
        if (parentSpend === null) parentSpend = Number(squads.stats.totals.spend) || 0;
      }
    } else {
      parents = [{ id: adsquadId, name: null }];
      parentSpend = null;
    }
    const parentLevel = level === "adsquad" ? "campaign" : "adsquad";
    const run = await childLevel({ parents, parentLevel, token, startTime, endTime, deadline });
    result = { ...run, parentSpend };
  }

  const { stats } = result;
  const totals = { ...stats.totals };
  const checkedSpend = Number(totals.spend) || 0;
  const complete = !stats.failed && result.unchecked === 0 && !result.parentsUnlisted;
  // At account/campaign level, a complete result takes spend from the
  // ad-account endpoint for exact Ads Manager parity. Otherwise the summed
  // entity totals are kept so spend, revenue and ROAS describe the same set.
  if (complete && (level === "account" || level === "campaign") && result.parentSpend !== null) {
    totals.spend = result.parentSpend;
  }
  const parentSpend = result.parentSpend;
  const value = {
    summary: buildMetrics(totals),
    rows: level === "account" ? [] : stats.rows,
    entities_total: result.entities_total,
    entities_skipped_out_of_range: result.skipped,
    entities_checked: stats.attempted,
    entities_unchecked: result.unchecked,
    parents_unlisted: result.parentsUnlisted,
    failed_requests: stats.failed,
    complete,
    account_spend: parentSpend === null || parentSpend === undefined ? null : Number((parentSpend / 1e6).toFixed(2)),
    spend_coverage_pct: parentSpend ? Math.min(100, Number(((checkedSpend / parentSpend) * 100).toFixed(1))) : null,
    attribution: { swipe_window: SWIPE_WINDOW, view_window: VIEW_WINDOW, action_report_time: "impression" },
    ...base
  };
  cache.set(key, { at: Date.now(), value });
  return value;
}
