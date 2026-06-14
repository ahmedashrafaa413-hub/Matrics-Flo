import { NextResponse } from "next/server";
import { getSnapchatToken } from "../../../../lib/snapchatToken";

export const dynamic = "force-dynamic";

const BASE = "https://adsapi.snapchat.com/v1";

const FIELDS = [
  "impressions",
  "spend",
  "swipes",
  "swipe_up_percent",
  "conversion_purchases",
  "conversion_purchases_value",
  "conversion_add_cart",
  "conversion_save",
  "video_views",
  "video_views_15s",
  "screen_time_millis",
  "quartile_1",
  "quartile_2",
  "quartile_3",
  "view_completion",
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function safeNum(v)         { const n = Number(v||0); return Number.isFinite(n) ? n : 0; }
function safeDivide(a, b)   { const x=safeNum(a), y=safeNum(b); return y ? x/y : 0; }
function fromMicros(v)      { return safeNum(v) / 1_000_000; }
function pad(v)             { return String(v).padStart(2,"0"); }
function toFixed2(v)        { return Number(safeNum(v).toFixed(2)); }

// ── Riyadh date helpers ───────────────────────────────────────────────────────
function getRiyadhNow() {
  const d = new Date(Date.now() + 3 * 3600_000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth()+1, d: d.getUTCDate(), h: d.getUTCHours() };
}
function addDays({ y, m, d, h }, n) {
  const dt = new Date(Date.UTC(y, m-1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth()+1, d: dt.getUTCDate(), h };
}
function toTS({ y, m, d }, hour=0) {
  return `${y}-${pad(m)}-${pad(d)}T${pad(hour)}:00:00.000+03:00`;
}
function getDateRange(preset) {
  const now = getRiyadhNow();
  const today = { y: now.y, m: now.m, d: now.d, h: now.h };
  const eh = Math.min(now.h + 1, 23);
  const map = {
    today:      { s: today,              e: today,      eh },
    yesterday:  { s: addDays(today,-1),  e: today,      eh: 0 },
    last_7d:    { s: addDays(today,-6),  e: today,      eh },
    last_30d:   { s: addDays(today,-29), e: today,      eh },
    this_month: { s: {...today, d:1},    e: today,      eh },
    last_90d:   { s: addDays(today,-89), e: today,      eh },
    maximum:    { s: addDays(today,-1095), e: today,    eh },
  };
  const p = map[preset] || map.last_30d;
  return { startTime: toTS(p.s, 0), endTime: toTS(p.e, p.eh) };
}

// ── HTTP ──────────────────────────────────────────────────────────────────────
async function snapGet(path, token) {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text) }; }
  catch { return { ok: res.ok, status: res.status, data: null, raw: text.slice(0,500) }; }
}

// ── Attribution window converter ──────────────────────────────────────────────
function toSnapWindow(raw) {
  const n = parseInt(raw || "0");
  if (!n) return "ZERO";
  return `${n}_DAY`;
}

// ── Fetch entities ─────────────────────────────────────────────────────────────
async function fetchEntities(accountId, level, token) {
  const pathMap = { campaign: "campaigns", adsquad: "adsquads", ad: "ads" };
  const path = pathMap[level] || "campaigns";
  const r = await snapGet(`/adaccounts/${accountId}/${path}?limit=500`, token);
  if (!r.ok) return { ok: false, error: r.data || r.raw, entities: [] };

  const normStatus = (raw) => {
    const s = String(raw?.status || raw?.effective_status || "").toUpperCase();
    if (["ACTIVE","RUNNING"].includes(s))      return "ACTIVE";
    if (["PAUSED","INACTIVE"].includes(s))     return "PAUSED";
    if (["PENDING","UNDER_REVIEW"].includes(s))return "PENDING";
    if (["DELETED","ARCHIVED"].includes(s))    return s;
    return s || "UNKNOWN";
  };

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

// ── Fetch bulk stats ───────────────────────────────────────────────────────────
// Snapchat supports fetching stats for multiple entities in one call
// using the account-level endpoint with campaign_id/adsquad_id/ad_id breakdown
async function fetchBulkStats({ accountId, level, token, startTime, endTime, swipeWindow, viewWindow }) {
  const breakdownMap = { campaign: "campaign", adsquad: "ad_squad", ad: "ad" };
  const breakdown = breakdownMap[level] || "campaign";

  const url =
    `${BASE}/adaccounts/${accountId}/stats` +
    `?granularity=TOTAL` +
    `&fields=${encodeURIComponent(FIELDS.join(","))}` +
    `&breakdown=${breakdown}` +
    `&start_time=${encodeURIComponent(startTime)}` +
    `&end_time=${encodeURIComponent(endTime)}` +
    `&swipe_up_attribution_window=${swipeWindow}` +
    `&view_attribution_window=${viewWindow}`;

  const r = await snapGet(url, token);
  if (!r.ok) return { ok: false, statsMap: {} };

  // Build a map of entityId → stats
  const statsMap = {};
  const rows = r.data?.total_stats || r.data?.timeseries_stats || [];

  rows.forEach(item => {
    const stat = item.total_stat || item;
    const id   = stat.id || stat.campaign_id || stat.ad_squad_id || stat.ad_id;
    if (id) statsMap[id] = stat.stats || stat;
  });

  return { ok: true, statsMap };
}

// ── Fetch account-level summary ────────────────────────────────────────────────
async function fetchAccountSummary({ accountId, token, startTime, endTime, swipeWindow, viewWindow }) {
  const url =
    `${BASE}/adaccounts/${accountId}/stats` +
    `?granularity=TOTAL` +
    `&fields=${encodeURIComponent(FIELDS.join(","))}` +
    `&start_time=${encodeURIComponent(startTime)}` +
    `&end_time=${encodeURIComponent(endTime)}` +
    `&swipe_up_attribution_window=${swipeWindow}` +
    `&view_attribution_window=${viewWindow}`;

  const r = await snapGet(url, token);
  if (!r.ok) return null;

  const arr   = r.data?.total_stats || [];
  const match = arr[0];
  const s     = match?.total_stat?.stats || match?.stats || {};

  return normalizeStats(s);
}

// ── Normalize stats → row ──────────────────────────────────────────────────────
function normalizeStats(s) {
  const spend  = fromMicros(s.spend);
  const rev    = fromMicros(s.conversion_purchases_value);
  const pur    = safeNum(s.conversion_purchases);
  const atc    = safeNum(s.conversion_add_cart);
  const imp    = safeNum(s.impressions);
  const sw     = safeNum(s.swipes);
  const vv     = safeNum(s.video_views);
  const vv15   = safeNum(s.video_views_15s);
  const q1     = safeNum(s.quartile_1);
  const q2     = safeNum(s.quartile_2);
  const q3     = safeNum(s.quartile_3);
  const vc     = safeNum(s.view_completion);

  // Hook Rate = video_views / impressions (first moment of engagement)
  const hookRate = safeDivide(vv, imp) * 100;
  // Hold Rate = video_views_15s / video_views
  const holdRate = safeDivide(vv15, vv) * 100;
  // Completion Rate = view_completion / video_views
  const completionRate = safeDivide(vc, vv) * 100;

  return {
    spend:        toFixed2(spend),
    revenue:      toFixed2(rev),
    purchase_value: toFixed2(rev),
    roas:         toFixed2(safeDivide(rev, spend)),
    purchases:    pur,
    cpa:          toFixed2(safeDivide(spend, pur)),
    add_to_cart:  atc,
    cost_per_atc: toFixed2(safeDivide(spend, atc)),
    impressions:  imp,
    swipes:       sw,
    clicks:       sw,
    ctr:          toFixed2(safeDivide(sw, imp) * 100),
    cpc:          toFixed2(safeDivide(spend, sw)),
    cpm:          toFixed2(safeDivide(spend, imp) * 1000),
    video_views:  vv,
    video_views_15s: vv15,
    hook_rate:    toFixed2(hookRate),
    hold_rate:    toFixed2(holdRate),
    completion_rate: toFixed2(completionRate),
    quartile_1:   q1,
    quartile_2:   q2,
    quartile_3:   q3,
    view_completion: vc,
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
    acc.video_views += safeNum(r.video_views);
    acc.video_views_15s += safeNum(r.video_views_15s);
    acc.view_completion += safeNum(r.view_completion);
    return acc;
  }, { spend:0, revenue:0, purchases:0, add_to_cart:0, impressions:0, swipes:0, video_views:0, video_views_15s:0, view_completion:0 });

  return {
    spend:        toFixed2(t.spend),
    revenue:      toFixed2(t.revenue),
    purchase_value: toFixed2(t.revenue),
    purchases:    t.purchases,
    add_to_cart:  t.add_to_cart,
    impressions:  t.impressions,
    swipes:       t.swipes,
    clicks:       t.swipes,
    roas:         toFixed2(safeDivide(t.revenue, t.spend)),
    cpa:          toFixed2(safeDivide(t.spend, t.purchases)),
    cost_per_atc: toFixed2(safeDivide(t.spend, t.add_to_cart)),
    ctr:          toFixed2(safeDivide(t.swipes, t.impressions) * 100),
    cpc:          toFixed2(safeDivide(t.spend, t.swipes)),
    cpm:          toFixed2(safeDivide(t.spend, t.impressions) * 1000),
    video_views:  t.video_views,
    video_views_15s: t.video_views_15s,
    hook_rate:    toFixed2(safeDivide(t.video_views, t.impressions) * 100),
    hold_rate:    toFixed2(safeDivide(t.video_views_15s, t.video_views) * 100),
    completion_rate: toFixed2(safeDivide(t.view_completion, t.video_views) * 100),
  };
}

// ── Memory cache ───────────────────────────────────────────────────────────────
const cache = new Map();
const CACHE_TTL = 10 * 60 * 1000;
function getCached(key) {
  const c = cache.get(key);
  if (!c) return null;
  if (Date.now() - c.ts > CACHE_TTL) { cache.delete(key); return null; }
  return c.data;
}
function setCache(key, data) { cache.set(key, { ts: Date.now(), data }); }

// ── Main handler ───────────────────────────────────────────────────────────────
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const accountId  = searchParams.get("account_id");
  const level      = searchParams.get("level")        || "campaign";
  const datePreset = searchParams.get("date_preset")  || "last_30d";
  const activeOnly = searchParams.get("active_only")  === "1";
  const force      = searchParams.get("force")        === "1";
  const swipeWindow = toSnapWindow(searchParams.get("swipe_up_attribution_window") || "28d");
  const viewWindow  = toSnapWindow(searchParams.get("view_attribution_window")     || "1d");

  if (!accountId) return NextResponse.json({ success: false, error: "account_id is required" });

  const cacheKey = `${accountId}:${level}:${datePreset}:${activeOnly?1:0}:${swipeWindow}:${viewWindow}`;
  if (!force) {
    const cached = getCached(cacheKey);
    if (cached) return NextResponse.json({ ...cached, cached: true });
  }

  const token = await getSnapchatToken();
  if (!token) return NextResponse.json({ success: false, error: "Not connected to Snapchat" });

  const { startTime, endTime } = getDateRange(datePreset);

  // 1. Fetch entities + bulk stats + account summary — all in parallel
  const [entitiesResult, bulkResult, accountSummary] = await Promise.all([
    fetchEntities(accountId, level, token),
    fetchBulkStats({ accountId, level, token, startTime, endTime, swipeWindow, viewWindow }),
    fetchAccountSummary({ accountId, token, startTime, endTime, swipeWindow, viewWindow }),
  ]);

  if (!entitiesResult.ok) {
    return NextResponse.json({ success: false, error: entitiesResult.error });
  }

  const allEntities = entitiesResult.entities;
  const statsMap    = bulkResult.statsMap;

  // 2. Filter: only ACTIVE + PAUSED + PENDING (skip DELETED/ARCHIVED)
  const allowed = ["ACTIVE", "PAUSED", "PENDING"];
  const filtered = activeOnly
    ? allEntities.filter(e => e.status === "ACTIVE")
    : allEntities.filter(e => allowed.includes(e.status));

  // 3. Build enriched rows
  const allRows = filtered.map(entity => ({
    ...entity,
    ...normalizeStats(statsMap[entity.id] || {}),
  }));

  // 4. Keep only rows with spend > 0 OR currently ACTIVE (hide empty ghosts)
  const rows = allRows.filter(r => r.spend > 0 || r.status === "ACTIVE");

  // 5. Sort by spend descending
  rows.sort((a, b) => safeNum(b.spend) - safeNum(a.spend));

  // 6. Summary — account-level is most accurate, fallback to row aggregation
  const summary = accountSummary || buildSummary(rows);

  const payload = {
    success:     true,
    provider:    "Snapchat Ads",
    account_id:  accountId,
    level,
    date_preset: datePreset,
    start_time:  startTime,
    end_time:    endTime,
    attribution: { swipe: swipeWindow, view: viewWindow },
    total_entities:  allEntities.length,
    active_entities: allEntities.filter(e => e.status === "ACTIVE").length,
    loaded_count:    rows.length,
    active_only:     activeOnly,
    summary,
    data: rows,
  };

  setCache(cacheKey, payload);
  return NextResponse.json(payload);
}
