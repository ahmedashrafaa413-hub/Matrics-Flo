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
  ACTION_REPORT_TIME,
  buildMetrics,
  fetchAdAccountSpend,
  fetchChildEntities,
  fetchEntities,
  fetchEntityOwner,
  fetchEntityStats
} from "./snapchatApi";
import { selectReportableEntities } from "./snapchatEntitySelection.mjs";
import { buildExtendedMetrics, EXTENDED_FIELDS, EXTENDED_NOTE } from "./snapchatExtendedMetrics.mjs";
import { dailyRows, missingParents, sumDaily } from "./snapchatDaily.mjs";
import { ADS_MANAGER_NOTE, buildAdsManagerColumns } from "./snapchatAdsManagerColumns.mjs";

const EXTRA_FIELDS = EXTENDED_FIELDS.join(",");

const ENTITY_LIMIT = 900;
const CONCURRENCY = 12;
// The whole call must answer inside the MCP client's 60s limit. No new
// Snapchat request starts after the budget; anything not reached is
// reported as unchecked.
const TIME_BUDGET_MS = 45000;
const SWIPE_WINDOW = "28_DAY";
const VIEW_WINDOW = "1_DAY";
const SWIPE_WINDOW_MS = 28 * 24 * 3600_000;
// Conversion-time purchases in the range can come from impressions up to the
// swipe window earlier, so selection looks back that far.
const lookbackFor = (actionReportTime) => (actionReportTime === "conversion" ? SWIPE_WINDOW_MS : 0);
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
// daily asks for day buckets (granularity=DAY) with the core fields only:
// reach and frequency do not add up across days.
async function statsForEntities({ entities, level, token, startTime, endTime, deadline, daily = false, actionReportTime = ACTION_REPORT_TIME }) {
  // After Snapchat rejects the extended fields once, later entities ask for
  // the core fields only, so a bad field does not double every request.
  let extendedRejected = daily;
  const results = await mapUntilDeadline(entities, CONCURRENCY, deadline, async (entity) => {
    const withExtended = !extendedRejected;
    const result = await fetchEntityStats({
      level,
      entityId: entity.id,
      token,
      startTime,
      endTime,
      swipeWindow: SWIPE_WINDOW,
      viewWindow: VIEW_WINDOW,
      extraFields: withExtended ? EXTRA_FIELDS : "",
      granularity: daily ? "DAY" : "TOTAL",
      actionReportTime
    });
    if (result.extraError) extendedRejected = true;
    return { entity, coreOnly: !withExtended || Boolean(result.extraError), ...result };
  });
  const attempted = results.filter(Boolean);
  const failed = attempted.filter((r) => !r.ok);
  if (attempted.length && failed.length === attempted.length) {
    throw new Error(`Snapchat stats failed for every ${level}: ${errorText(failed[0].error)}`);
  }
  const totals = attempted.reduce((acc, r) => (r.ok ? addRawStats(acc, r.stats) : acc), {});
  const extraErrors = daily ? [] : attempted.filter((r) => r.ok && r.extraError);
  const coreOnly = daily ? 0 : attempted.filter((r) => r.ok && r.coreOnly).length;
  const rows = attempted
    // Keep rows with spend, and rows whose purchases in the range come from
    // earlier impressions (conversion-time reporting) without spend now.
    .filter((r) => r.ok && (Number(r.metrics?.spend || 0) > 0.001 || Number(r.metrics?.purchases || 0) > 0 || Number(r.metrics?.revenue || 0) > 0))
    .map((r) => ({
      id: r.entity.id,
      name: r.entity.name,
      status: r.entity.status,
      ...(r.entity.campaign_id ? { campaign_id: r.entity.campaign_id } : {}),
      ...(r.entity.campaign_name ? { campaign_name: r.entity.campaign_name } : {}),
      ...(r.entity.adsquad_id ? { adsquad_id: r.entity.adsquad_id } : {}),
      ...(r.entity.adsquad_name ? { adsquad_name: r.entity.adsquad_name } : {}),
      ...r.metrics,
      ...(r.coreOnly ? {} : { extended: buildExtendedMetrics(r.stats) }),
      ...(r.coreOnly ? {} : { ads_manager: buildAdsManagerColumns(r.stats, { level, entity: r.entity }) }),
      ...(daily ? { daily: dailyRows(r.days || []) } : {})
    }))
    .sort((a, b) => b.spend - a.spend);
  return {
    attempted: attempted.length,
    failed: failed.length,
    totals,
    rows,
    extendedUnavailable: coreOnly,
    extendedError: extraErrors.length ? errorText(extraErrors[0].extraError) : null
  };
}

// Every campaign on the account (account and campaign levels).
async function campaignLevel({ token, accountId, startTime, endTime, deadline, daily = false, actionReportTime = ACTION_REPORT_TIME }) {
  const [entitiesResult, spendResult] = await Promise.all([
    fetchEntities({ accountId, level: "campaign", token }),
    fetchAdAccountSpend({ accountId, token, startTime, endTime })
  ]);
  if (!entitiesResult.ok) throw new Error(`Snapchat campaign list failed: ${errorText(entitiesResult.error)}`);

  const selection = selectReportableEntities(entitiesResult.entities, { startTime, endTime, limit: ENTITY_LIMIT, lookbackMs: lookbackFor(actionReportTime) });
  const stats = await statsForEntities({ entities: selection.selected, level: "campaign", token, startTime, endTime, deadline, daily, actionReportTime });
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
async function childLevel({ parents, parentLevel, token, startTime, endTime, deadline, daily = false, actionReportTime = ACTION_REPORT_TIME }) {
  const childLevelName = parentLevel === "campaign" ? "adsquad" : "ad";
  const listed = await mapUntilDeadline(parents, CONCURRENCY, deadline, async (parent) => {
    const result = await fetchChildEntities({ parentLevel, parentId: parent.id, token });
    if (!result.ok) return { ok: false, error: result.error };
    const children = result.entities.map((child) =>
      parentLevel === "campaign"
        ? { ...child, campaign_name: parent.name }
        : { ...child, adsquad_name: parent.name, campaign_id: parent.campaign_id, campaign_name: parent.campaign_name }
    );
    return { ok: true, children, truncated: Boolean(result.truncated) };
  });
  const listedOk = listed.filter((r) => r?.ok);
  // A parent whose child list failed, was not reached, or was cut off by
  // pagination counts as unlisted.
  const parentsUnlisted = parents.length - listedOk.length + listedOk.filter((r) => r.truncated).length;
  const all = listedOk.flatMap((r) => r.children);
  const selection = selectReportableEntities(all, { startTime, endTime, limit: ENTITY_LIMIT, lookbackMs: lookbackFor(actionReportTime) });
  const stats = await statsForEntities({ entities: selection.selected, level: childLevelName, token, startTime, endTime, deadline, daily, actionReportTime });
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
  daily = false,
  actionReportTime = ACTION_REPORT_TIME,
  timeBudgetMs = TIME_BUDGET_MS
}) {
  const key = `${accountId}:${level}:${startTime}:${endTime}:${campaignId}:${adsquadId}:${timeBudgetMs}:${actionReportTime}${daily ? ":daily" : ""}`;
  const hit = cached(key);
  if (hit) return { ...hit, cached: true };
  const deadline = Date.now() + timeBudgetMs;
  const base = { start_time: startTime, end_time: endTime };

  // Scope IDs come from the caller: check they sit inside this ad account
  // before reporting anything under it.
  let scopedCampaign = null;
  let scopedAdsquad = null;
  if (campaignId) {
    const owner = await fetchEntityOwner({ level: "campaign", entityId: campaignId, token });
    if (!owner.ok || owner.owner_id !== accountId) {
      throw Object.assign(new Error(`Campaign ${campaignId} is not in Snapchat ad account ${accountId}.`), { status: 404 });
    }
    scopedCampaign = owner;
  }
  if (adsquadId) {
    const owner = await fetchEntityOwner({ level: "adsquad", entityId: adsquadId, token });
    const campaignOwner = owner.ok && owner.owner_id
      ? scopedCampaign && scopedCampaign.id === owner.owner_id
        ? scopedCampaign
        : await fetchEntityOwner({ level: "campaign", entityId: owner.owner_id, token })
      : null;
    if (!owner.ok || !campaignOwner?.ok || campaignOwner.owner_id !== accountId || (campaignId && owner.owner_id !== campaignId)) {
      throw Object.assign(new Error(`Ad squad ${adsquadId} is not in ${campaignId ? `campaign ${campaignId}` : `Snapchat ad account ${accountId}`}.`), { status: 404 });
    }
    scopedAdsquad = { ...owner, campaign_name: campaignOwner.name };
  }

  // Parent passes that missed anything make the final answer incomplete too.
  const upstream = { failed: 0, unchecked: 0, unlisted: 0 };
  const noteUpstream = (run) => {
    upstream.failed += run.stats.failed;
    upstream.unchecked += run.unchecked;
    upstream.unlisted += run.parentsUnlisted || 0;
  };

  let result;
  // Parents with their own spend, to name the campaigns whose ad squads were
  // not fully covered.
  let spendParents = null;
  if (level === "account" || level === "campaign") {
    const run = await campaignLevel({ token, accountId, startTime, endTime, deadline, daily, actionReportTime });
    result = { ...run, parentsUnlisted: 0 };
  } else if (level === "adsquad" && adsquadId) {
    // One ad squad on its own (e.g. its days around a budget edit).
    const entity = { id: adsquadId, name: scopedAdsquad.name, status: scopedAdsquad.status, settings: scopedAdsquad.settings, campaign_id: scopedAdsquad.owner_id, campaign_name: scopedAdsquad.campaign_name };
    const stats = await statsForEntities({ entities: [entity], level: "adsquad", token, startTime, endTime, deadline, daily, actionReportTime });
    result = { stats, entities_total: 1, skipped: 0, unchecked: 1 - stats.attempted, parentsUnlisted: 0, parentSpend: null };
  } else {
    // Parents of the requested level, with their spend for coverage.
    let parents;
    let parentSpend;
    if (level === "adsquad" || !adsquadId) {
      if (campaignId) {
        parents = [{ id: campaignId, name: scopedCampaign.name }];
        parentSpend = null;
      } else {
        // Reuse a recent campaign-level answer; otherwise give the campaign
        // pass at most half the budget so the children still get time.
        const campaignKey = `${accountId}:campaign:${startTime}:${endTime}:::${timeBudgetMs}:${actionReportTime}`;
        const recent = cached(campaignKey);
        if (recent) {
          parents = recent.rows;
          spendParents = recent.rows;
          parentSpend = recent.account_spend === null ? null : recent.account_spend * 1e6;
          upstream.failed += recent.failed_requests || 0;
          upstream.unchecked += recent.entities_unchecked || 0;
        } else {
          const campaignDeadline = Math.min(deadline, Date.now() + timeBudgetMs / 2);
          const run = await campaignLevel({ token, accountId, startTime, endTime, deadline: campaignDeadline, actionReportTime });
          parents = run.stats.rows;
          spendParents = run.stats.rows;
          parentSpend = run.parentSpend;
          noteUpstream(run);
        }
      }
      if (level === "ad") {
        const squads = await childLevel({ parents, parentLevel: "campaign", token, startTime, endTime, deadline, actionReportTime });
        noteUpstream(squads);
        parents = squads.stats.rows.map((row) => ({ ...row, campaign_name: row.campaign_name || scopedCampaign?.name || null }));
        if (parentSpend === null) parentSpend = Number(squads.stats.totals.spend) || 0;
      }
    } else {
      parents = [{ id: adsquadId, name: scopedAdsquad.name, campaign_id: scopedAdsquad.owner_id, campaign_name: scopedAdsquad.campaign_name }];
      parentSpend = null;
    }
    const parentLevel = level === "adsquad" ? "campaign" : "adsquad";
    const run = await childLevel({ parents, parentLevel, token, startTime, endTime, deadline, daily, actionReportTime });
    result = { ...run, parentSpend };
  }

  const { stats } = result;
  const totals = { ...stats.totals };
  const checkedSpend = Number(totals.spend) || 0;
  const upstreamIncomplete = upstream.failed + upstream.unchecked + upstream.unlisted > 0;
  const complete = !stats.failed && result.unchecked === 0 && !result.parentsUnlisted && !upstreamIncomplete;
  // At account/campaign level, a complete result takes spend from the
  // ad-account endpoint for exact Ads Manager parity. Otherwise the summed
  // entity totals are kept so spend, revenue and ROAS describe the same set.
  if (complete && (level === "account" || level === "campaign") && result.parentSpend !== null) {
    totals.spend = result.parentSpend;
  }
  const parentSpend = result.parentSpend;
  const missing = level === "adsquad" && spendParents && !complete ? missingParents(spendParents, stats.rows) : null;
  const value = {
    summary: {
      ...buildMetrics(totals),
      ...(daily
        ? { daily: sumDaily(stats.rows.map((r) => r.daily)) }
        : { extended: buildExtendedMetrics(totals, { summed: true }), ads_manager: buildAdsManagerColumns(totals, { level, summed: true }) })
    },
    rows: level === "account" ? [] : stats.rows,
    entities_total: result.entities_total,
    entities_skipped_out_of_range: result.skipped,
    entities_checked: stats.attempted,
    entities_unchecked: result.unchecked,
    parents_unlisted: result.parentsUnlisted,
    failed_requests: stats.failed,
    upstream_incomplete: upstreamIncomplete ? upstream : null,
    ...(missing ? { missing_campaigns: missing.slice(0, 40), missing_campaigns_total: missing.length } : {}),
    complete,
    account_spend: parentSpend === null || parentSpend === undefined ? null : Number((parentSpend / 1e6).toFixed(2)),
    spend_coverage_pct: parentSpend ? Math.min(100, Number(((checkedSpend / parentSpend) * 100).toFixed(1))) : null,
    ...(daily ? {} : { ads_manager_note: ADS_MANAGER_NOTE }),
    extended_metrics: {
      note: EXTENDED_NOTE,
      unavailable_for_entities: stats.extendedUnavailable,
      ...(stats.extendedError ? { error: stats.extendedError } : {})
    },
    attribution: { swipe_window: SWIPE_WINDOW, view_window: VIEW_WINDOW, action_report_time: actionReportTime },
    ...base
  };
  cache.set(key, { at: Date.now(), value });
  return value;
}
