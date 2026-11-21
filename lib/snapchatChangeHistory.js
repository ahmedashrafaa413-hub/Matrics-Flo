// Live Snapchat change history for the MCP server: budget, bid, status,
// schedule and targeting edits on campaigns, ad squads or ads, read from the
// Snapchat "external_changelogs" endpoints.
//
// Only entities whose updated_at falls on or after the range start can have
// changes in the range, so the rest are skipped without a request.

import { fetchChildEntities, fetchEntities, fetchEntityChangeLogs, fetchEntityOwner } from "./snapchatApi";
import { filterChanges, parseChangeLogEntry, summarizeEntityChanges } from "./snapchatChangeLog.mjs";

const CONCURRENCY = 12;
const ENTITY_LIMIT = 400;
const TIME_BUDGET_MS = 45000;

function errorText(error) {
  if (!error) return "unknown error";
  if (typeof error === "string") return error.slice(0, 300);
  return String(error.debug_message || error.display_message || error.request_status || JSON.stringify(error)).slice(0, 300);
}

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

function notFound(message) {
  return Object.assign(new Error(message), { status: 404 });
}

// Entities of the requested level that the account (or campaign) holds.
async function listCandidates({ token, accountId, level, campaignId, entityId, deadline }) {
  if (entityId) {
    const ownerLevel = level === "campaign" ? "campaign" : "adsquad";
    const owner = await fetchEntityOwner({ level: ownerLevel, entityId, token });
    if (!owner.ok) throw notFound(`${level} ${entityId} was not found.`);
    let accountOwner = owner.owner_id;
    let campaign = level === "campaign" ? owner : null;
    if (level === "adsquad") {
      campaign = await fetchEntityOwner({ level: "campaign", entityId: owner.owner_id, token });
      accountOwner = campaign.ok ? campaign.owner_id : null;
    }
    if (accountOwner !== accountId || (campaignId && level === "adsquad" && owner.owner_id !== campaignId)) {
      throw notFound(`${level} ${entityId} is not in Snapchat ad account ${accountId}.`);
    }
    return {
      entities: [{ id: entityId, name: owner.name, ...(level === "adsquad" ? { campaign_id: owner.owner_id, campaign_name: campaign?.name || null } : {}) }],
      unlisted: 0
    };
  }

  if (campaignId) {
    const owner = await fetchEntityOwner({ level: "campaign", entityId: campaignId, token });
    if (!owner.ok || owner.owner_id !== accountId) throw notFound(`Campaign ${campaignId} is not in Snapchat ad account ${accountId}.`);
    if (level === "campaign") return { entities: [{ id: campaignId, name: owner.name }], unlisted: 0 };
    const squads = await fetchChildEntities({ parentLevel: "campaign", parentId: campaignId, token });
    if (!squads.ok) throw new Error(`Snapchat ad squad list failed: ${errorText(squads.error)}`);
    const tagged = squads.entities.map((s) => ({ ...s, campaign_name: owner.name }));
    if (level === "adsquad") return { entities: tagged, unlisted: squads.truncated ? 1 : 0 };
    const lists = await mapUntilDeadline(tagged, CONCURRENCY, deadline, async (squad) => {
      const ads = await fetchChildEntities({ parentLevel: "adsquad", parentId: squad.id, token });
      return ads.ok
        ? { ok: true, truncated: ads.truncated, ads: ads.entities.map((a) => ({ ...a, adsquad_name: squad.name, campaign_id: campaignId, campaign_name: owner.name })) }
        : { ok: false };
    });
    const okLists = lists.filter((l) => l?.ok);
    return {
      entities: okLists.flatMap((l) => l.ads),
      unlisted: tagged.length - okLists.length + okLists.filter((l) => l.truncated).length
    };
  }

  if (level === "ad") throw Object.assign(new Error("Ad level change history needs campaign_id."), { status: 400 });
  const listed = await fetchEntities({ accountId, level, token });
  if (!listed.ok) throw new Error(`Snapchat ${level} list failed: ${errorText(listed.error)}`);
  if (level === "adsquad") {
    const campaigns = await fetchEntities({ accountId, level: "campaign", token });
    const names = new Map((campaigns.ok ? campaigns.entities : []).map((c) => [c.id, c.name]));
    return { entities: listed.entities.map((s) => ({ ...s, campaign_name: names.get(s.campaign_id) || null })), unlisted: 0 };
  }
  return { entities: listed.entities, unlisted: 0 };
}

export async function fetchSnapchatChangeHistory({
  token,
  accountId,
  level = "adsquad",
  startTime,
  endTime,
  campaignId = "",
  entityId = "",
  categories = [],
  timeBudgetMs = TIME_BUDGET_MS
}) {
  const deadline = Date.now() + timeBudgetMs;
  const { entities, unlisted } = await listCandidates({ token, accountId, level, campaignId, entityId, deadline });

  const startMs = Date.parse(startTime);
  // updated_at is the last edit, so anything last edited before the range
  // has no change inside it. Entities without updated_at are kept.
  const touched = entities.filter((e) => entityId || !e.updated_at || Date.parse(e.updated_at) >= startMs);
  touched.sort((a, b) => (Date.parse(b.updated_at) || Infinity) - (Date.parse(a.updated_at) || Infinity));
  const selected = touched.slice(0, ENTITY_LIMIT);

  const results = await mapUntilDeadline(selected, CONCURRENCY, deadline, async (entity) => {
    const r = await fetchEntityChangeLogs({ level, entityId: entity.id, token, since: startTime });
    return { entity, ...r };
  });
  const attempted = results.filter(Boolean);
  const failed = attempted.filter((r) => !r.ok);
  if (attempted.length && failed.length === attempted.length) {
    throw new Error(`Snapchat change logs failed for every ${level}: ${errorText(failed[0].error)}`);
  }

  const rows = attempted
    .filter((r) => r.ok)
    .map((r) => {
      const changes = filterChanges(r.entries.map(parseChangeLogEntry), { start: startTime, end: endTime, categories });
      return {
        id: r.entity.id,
        name: r.entity.name,
        status: r.entity.status,
        ...(r.entity.campaign_id ? { campaign_id: r.entity.campaign_id } : {}),
        ...(r.entity.campaign_name ? { campaign_name: r.entity.campaign_name } : {}),
        ...(r.entity.adsquad_id ? { adsquad_id: r.entity.adsquad_id } : {}),
        ...(r.entity.adsquad_name ? { adsquad_name: r.entity.adsquad_name } : {}),
        summary: summarizeEntityChanges(changes),
        ...(r.truncated ? { history_truncated: true } : {}),
        changes: changes.map(({ entity_id, entity_name, entity_type, ...rest }) => rest)
      };
    })
    .filter((row) => row.changes.length)
    .sort((a, b) => Date.parse(b.changes[0].at) - Date.parse(a.changes[0].at));

  const unchecked = touched.length - attempted.length;
  // Entities whose history hit the page cap or a failed later page may be
  // missing changes in the range, even when none of theirs are listed.
  const truncatedIds = attempted.filter((r) => r.ok && r.truncated).map((r) => r.entity.id);
  const count = (category) => rows.reduce((n, r) => n + (r.summary[category]?.changes || 0), 0);
  return {
    level,
    rows,
    total_rows: rows.length,
    totals: { changes: rows.reduce((n, r) => n + r.changes.length, 0), budget_changes: count("budget"), bid_changes: count("bid"), status_changes: count("status") },
    entities_total: entities.length,
    entities_not_edited_in_range: entities.length - touched.length,
    entities_checked: attempted.length,
    entities_unchecked: unchecked,
    parents_unlisted: unlisted,
    failed_requests: failed.length,
    ...(failed.length ? { first_error: errorText(failed[0].error) } : {}),
    histories_truncated: truncatedIds.length,
    ...(truncatedIds.length ? { histories_truncated_ids: truncatedIds.slice(0, 50) } : {}),
    complete: !failed.length && unchecked === 0 && !unlisted && !truncatedIds.length,
    start_time: startTime,
    end_time: endTime
  };
}
