import { NextResponse } from "next/server";
import { getSnapchatToken } from "../../../../lib/snapchatToken";

export const dynamic = "force-dynamic";

const BASE = "https://adsapi.snapchat.com/v1";

const FIELDS = [
  "impressions",
  "spend",
  "swipes",
  "conversion_purchases",
  "conversion_purchases_value",
  "conversion_add_cart",
  "video_views",
  "video_views_15s",
  "view_completion",
].join(",");

const BATCH_SIZE    = 10;
const BATCH_DELAY   = 300;
const CACHE_TTL     = 10 * 60 * 1000;
const cache         = new Map();

// ── Helpers ───────────────────────────────────────────────────────────────────
function safeNum(v)       { const n = Number(v||0); return Number.isFinite(n) ? n : 0; }
function safeDivide(a, b) { const x=safeNum(a), y=safeNum(b); return y ? x/y : 0; }
function fromMicros(v)    { return safeNum(v) / 1_000_000; }
function fix2(v)          { return Number(safeNum(v).toFixed(2)); }
function sleep(ms)        { return new Promise(r => setTimeout(r, ms)); }
function pad(v)           { return String(v).padStart(2,"0"); }

// ── Cache ─────────────────────────────────────────────────────────────────────
function getCached(key) {
  const c = cache.get(key);
  if (!c) return null;
  if (Date.now() - c.ts > CACHE_TTL) { cache.delete(key); return null; }
  return c.data;
}
function setCache(key, data) { cache.set(key, { ts: Date.now(), data }); }

// ── Date helpers — Riyadh (UTC+3) ─────────────────────────────────────────────
function getRiyadhNow() {
  const d = new Date(Date.now() + 3 * 3600_000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth()+1, d: d.getUTCDate(), h: d.getUTCHours() };
}
function shiftDays(base, n) {
  const dt = new Date(Date.UTC(base.y, base.m-1, base.d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth()+1, d: dt.getUTCDate(), h: base.h };
}
// Snapchat needs ISO timestamps — we use UTC midnight for start, next day for end
function toUTCDate(p, offsetDays = 0) {
  const dt = new Date(Date.UTC(p.y, p.m-1, p.d));
  dt.setUTCDate(dt.getUTCDate() + offsetDays);
  return dt.toISOString().split("T")[0];
}
function getDateRange(preset) {
  const now = getRiyadhNow();
  const today = { y: now.y, m: now.m, d: now.d, h: now.h };
  const map = {
    today:      { s: today,               daysBack: 0   },
    yesterday:  { s: shiftDays(today,-1), daysBack: 1   },
    last_7d:    { s: shiftDays(today,-6), daysBack: 6   },
    last_30d:   { s: shiftDays(today,-29),daysBack: 29  },
    this_month: { s: {...today, d:1},     daysBack: null },
    last_90d:   { s: shiftDays(today,-89),daysBack: 89  },
    maximum:    { s: shiftDays(today,-1095),daysBack: 1095 },
  };
  const p = map[preset] || map.last_30d;
  const startDate = toUTCDate(p.s);
  const endDate   = toUTCDate(today, 1); // tomorrow = exclusive end
  return {
    startTime: `${startDate}T00:00:00.000Z`,
    endTime:   `${endDate}T00:00:00.000Z`,
  };
}

// ── Attribution window ────────────────────────────────────────────────────────
function toSnapWindow(raw) {
  const n = parseInt(raw || "0");
  if (!n) return "ZERO";
  return `${n}_DAY`;
}

// ── HTTP ──────────────────────────────────────────────────────────────────────
async function snapGet(url, token) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text) }; }
  catch { return { ok: res.ok, status: res.status, data: null, raw: text.slice(0,500) }; }
}

// ── Extract stats from Snapchat response ──────────────────────────────────────
function extractStats(data, entityId) {
  const arr = data?.total_stats || [];
  // Try to match by id
  for (const item of arr) {
    const stat = item.total_stat || item;
    if (stat.id === entityId || stat.campaign_id === entityId ||
        stat.ad_squad_id === entityId || stat.ad_id === entityId) {
      return stat.stats || stat;
    }
  }
  // Fallback: first item
  if (arr.length > 0) {
    const stat = arr[0].total_stat || arr[0];
    return stat.stats || stat;
  }
  return {};
}

// ── Fetch single entity stats ─────────────────────────────────────────────────
async function fetchOneStats({ entityType, entityId, token, startTime, endTime, swipeWindow, viewWindow }) {
  const url =
    `${BASE}/${entityType}/${entityId}/stats` +
    `?granularity=TOTAL` +
    `&fields=${encodeURIComponent(FIELDS)}` +
    `&start_time=${encodeURIComponent(startTime)}` +
    `&end_time=${encodeURIComponent(endTime)}` +
    `&swipe_up_attribution_window=${swipeWindow}` +
    `&view_attribution_window=${viewWindow}`;
  const r = await snapGet(url, token);
  if (!r.ok) return {};
  return extractStats(r.data, entityId);
}

// ── Fetch stats for all entities in batches ───────────────────────────────────
async function fetchAllStats({ entities, entityType, token, startTime, endTime, swipeWindow, viewWindow }) {
  const statsMap = {};
  for (let i = 0; i < entities.length; i += BATCH_SIZE) {
    const batch = entities.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (e) => {
      statsMap[e.id] = await fetchOneStats({
        entityType, entityId: e.id, token, startTime, endTime, swipeWindow, viewWindow
      });
    }));
    if (i + BATCH_SIZE < entities.length) await sleep(BATCH_DELAY);
  }
  return statsMap;
}

// ── Fetch account-level summary ───────────────────────────────────────────────
async function fetchAccountSummary({ accountId, token, startTime, endTime, swipeWindow, viewWindow }) {
  const url =
    `${BASE}/adaccounts/${accountId}/stats` +
    `?granularity=TOTAL` +
    `&fields=${encodeURIComponent(FIELDS)}` +
    `&start_time=${encodeURIComponent(startTime)}` +
    `&end_time=${encodeURIComponent(endTime)}` +
    `&swipe_up_attribution_window=${swipeWindow}` +
    `&view_attribution_window=${viewWindow}`;
  const r = await snapGet(url, token);
  if (!r.ok) return null;
  const s = extractStats(r.data, accountId);
  return buildMetrics(s);
}

// ── Fetch entities ─────────────────────────────────────────────────────────────
function normStatus(raw) {
  const s = String(raw?.status || raw?.effective_status || "").toUpperCase();
  if (["ACTIVE","RUNNING"].includes(s))       return "ACTIVE";
  if (["PAUSED","INACTIVE"].includes(s))      return "PAUSED";
  if (["PENDING","UNDER_REVIEW"].includes(s)) return "PENDING";
  return s || "UNKNOWN";
}

async function fetchEntities(accountId, level, token) {
  const pathMap = { campaign: "campaigns", adsquad: "adsquads", ad: "ads" };
  const r = await snapGet(`${BASE}/adaccounts/${accountId}/${pathMap[level]}?limit=500`, token);
  if (!r.ok) return { ok: false, error: r.data || r.raw, entities: [] };

  let entities = [];
  if (level === "campaign") {
    entities = (r.data?.campaigns || []).map(i => {
      const c = i.campaign || i;
      return { id: c.id, name: c.name||"Unnamed", campaign_name: c.name||"Unnamed", status: normStatus(c) };
    });
  } else if (level === "adsquad") {
    entities = (r.data?.adsquads || []).map(i => {
      const a = i.adsquad || i;
      return { id: a.id, name: a.name||"Unnamed", adsquad_name: a.name||"Unnamed", campaign_id: a.campaign_id||"", status: normStatus(a) };
    });
  } else {
    entities = (r.data?.ads || []).map(i => {
      const a = i.ad || i;
      return { id: a.id, name: a.name||"Unnamed", ad_name: a.name||"Unnamed", adsquad_id: a.ad_squad_id||"", status: normStatus(a) };
    });
  }
  return { ok: true, entities };
}

// ── Build metrics from raw stats ───────────────────────────────────────────────
function buildMetrics(s) {
  const spend  = fromMicros(s.spend);
  const rev    = fromMicros(s.conversion_purchases_value);
  const pur    = safeNum(s.conversion_purchases);
  const atc    = safeNum(s.conversion_add_cart);
  const imp    = safeNum(s.impressions);
  const sw     = safeNum(s.swipes);
  const vv     = safeNum(s.video_views);
  const vv15   = safeNum(s.video_views_15s);
  const vc     = safeNum(s.view_completion);

  return {
    spend:           fix2(spend),
    revenue:         fix2(rev),
    purchase_value:  fix2(rev),
    purchases:       pur,
    add_to_cart:     atc,
    impressions:     imp,
    swipes:          sw,
    clicks:          sw,
    video_views:     vv,
    video_views_15s: vv15,
    view_completion: vc,
    roas:            fix2(safeDivide(rev, spend)),
    cpa:             fix2(safeDivide(spend, pur)),
    cost_per_atc:    fix2(safeDivide(spend, atc)),
    ctr:             fix2(safeDivide(sw, imp) * 100),
    cpc:             fix2(safeDivide(spend, sw)),
    cpm:             fix2(safeDivide(spend, imp) * 1000),
    hook_rate:       fix2(safeDivide(vv, imp) * 100),
    hold_rate:       fix2(safeDivide(vv15, vv) * 100),
    completion_rate: fix2(safeDivide(vc, vv) * 100),
  };
}

// ── Build summary from rows ────────────────────────────────────────────────────
function buildSummary(rows) {
  const t = rows.reduce((acc, r) => {
    acc.spend       += safeNum(r.spend);
    acc.revenue     += safeNum(r.revenue);
    acc.purchases   += safeNum(r.purchases);
    acc.add_to_cart += safeNum(r.add_to_cart);
    acc.impressions += safeNum(r.impressions);
    acc.swipes      += safeNum(r.swipes);
    acc.vv          += safeNum(r.video_views);
    acc.vv15        += safeNum(r.video_views_15s);
    acc.vc          += safeNum(r.view_completion);
    return acc;
  }, { spend:0,revenue:0,purchases:0,add_to_cart:0,impressions:0,swipes:0,vv:0,vv15:0,vc:0 });

  return {
    spend:           fix2(t.spend),
    revenue:         fix2(t.revenue),
    purchase_value:  fix2(t.revenue),
    purchases:       t.purchases,
    add_to_cart:     t.add_to_cart,
    impressions:     t.impressions,
    swipes:          t.swipes,
    clicks:          t.swipes,
    video_views:     t.vv,
    video_views_15s: t.vv15,
    roas:            fix2(safeDivide(t.revenue, t.spend)),
    cpa:             fix2(safeDivide(t.spend, t.purchases)),
    cost_per_atc:    fix2(safeDivide(t.spend, t.add_to_cart)),
    ctr:             fix2(safeDivide(t.swipes, t.impressions) * 100),
    cpc:             fix2(safeDivide(t.spend, t.swipes)),
    cpm:             fix2(safeDivide(t.spend, t.impressions) * 1000),
    hook_rate:       fix2(safeDivide(t.vv, t.impressions) * 100),
    hold_rate:       fix2(safeDivide(t.vv15, t.vv) * 100),
    completion_rate: fix2(safeDivide(t.vc, t.vv) * 100),
  };
}

// ── Main handler ───────────────────────────────────────────────────────────────
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const accountId   = searchParams.get("account_id");
  const level       = searchParams.get("level")       || "campaign";
  const datePreset  = searchParams.get("date_preset") || "last_30d";
  const activeOnly  = searchParams.get("active_only") === "1";
  const force       = searchParams.get("force")       === "1";
  const swipeWindow = toSnapWindow(searchParams.get("swipe_up_attribution_window") || "28d");
  const viewWindow  = toSnapWindow(searchParams.get("view_attribution_window")     || "1d");

  if (!accountId) return NextResponse.json({ success: false, error: "account_id is required" });

  const cacheKey = `${accountId}:${level}:${datePreset}:${activeOnly?1:0}:${swipeWindow}:${viewWindow}`;
  if (!force) {
    const cached = getCached(cacheKey);
    if (cached) return NextResponse.json({ ...cached, cached: true });
  }

  const token = searchParams.get("snap_token") || await getSnapchatToken();
  if (!token) return NextResponse.json({ success: false, error: "Not connected to Snapchat" });

  const { startTime, endTime } = getDateRange(datePreset);
  const entityTypeMap = { campaign: "campaigns", adsquad: "adsquads", ad: "ads" };
  const entityType    = entityTypeMap[level] || "campaigns";

  // 1. Fetch entities + account summary in parallel
  const [entitiesResult, accountSummary] = await Promise.all([
    fetchEntities(accountId, level, token),
    fetchAccountSummary({ accountId, token, startTime, endTime, swipeWindow, viewWindow }),
  ]);

  if (!entitiesResult.ok) {
    return NextResponse.json({ success: false, error: entitiesResult.error });
  }

  const allEntities = entitiesResult.entities;

  // 2. Filter: ACTIVE + PAUSED + PENDING only (skip DELETED/ARCHIVED)
  const allowed  = ["ACTIVE", "PAUSED", "PENDING"];
  const toLoad   = activeOnly
    ? allEntities.filter(e => e.status === "ACTIVE")
    : allEntities.filter(e => allowed.includes(e.status));

  // 3. Fetch stats for each entity
  const statsMap = await fetchAllStats({
    entities: toLoad, entityType, token, startTime, endTime, swipeWindow, viewWindow
  });

  // 4. Build rows
  const allRows = toLoad.map(e => ({
    ...e,
    ...buildMetrics(statsMap[e.id] || {}),
  }));

  // 5. Filter: only rows with spend > 0 OR ACTIVE
  const rows = allRows.filter(r => r.spend > 0 || r.status === "ACTIVE");

  // 6. Sort by spend descending
  rows.sort((a, b) => safeNum(b.spend) - safeNum(a.spend));

  // 7. Summary
  const summary = accountSummary || buildSummary(rows);

  const payload = {
    success:        true,
    provider:       "Snapchat Ads",
    account_id:     accountId,
    level,
    date_preset:    datePreset,
    start_time:     startTime,
    end_time:       endTime,
    attribution:    { swipe: swipeWindow, view: viewWindow },
    total_entities: allEntities.length,
    active_entities:allEntities.filter(e => e.status === "ACTIVE").length,
    loaded_count:   rows.length,
    active_only:    activeOnly,
    summary,
    data: rows,
  };

  setCache(cacheKey, payload);
  return NextResponse.json(payload);
}
