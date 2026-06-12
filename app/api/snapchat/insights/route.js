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
  "video_views"
];

// Cache: 10 minutes
const memoryCache = new Map();
const CACHE_TTL = 10 * 60 * 1000;

// Parallel batch config
const BATCH_SIZE       = 15;
const BATCH_DELAY_MS   = 200;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function safeNumber(v) { const n = Number(v||0); return Number.isFinite(n) ? n : 0; }
function safeDivide(a, b) { const x=safeNumber(a), y=safeNumber(b); return y ? x/y : 0; }
function moneyFromMicros(v) { return safeNumber(v) / 1_000_000; }
function pad(v) { return String(v).padStart(2,"0"); }

// ── Cache helpers ─────────────────────────────────────────────────────────────
function getCacheKey({ accountId, level, datePreset, activeOnly }) {
  return `${accountId}:${level}:${datePreset}:${activeOnly?1:0}`;
}
function getCached(key) {
  const c = memoryCache.get(key);
  if (!c) return null;
  if (Date.now() - c.ts > CACHE_TTL) { memoryCache.delete(key); return null; }
  return c.data;
}
function setCache(key, data) { memoryCache.set(key, { ts: Date.now(), data }); }

// ── Riyadh date helpers ──────────────────────────────────────────────────────
function getRiyadhDateParts(date = new Date()) {
  const r = new Date(date.getTime() + 3 * 3600_000);
  return { year: r.getUTCFullYear(), month: r.getUTCMonth()+1, day: r.getUTCDate(), hour: r.getUTCHours() };
}
function dateToUTC({ year, month, day }) {
  return new Date(Date.UTC(year, month-1, day, 0, 0, 0, 0));
}
function addDays(parts, n) {
  const d = dateToUTC(parts); d.setUTCDate(d.getUTCDate() + n);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth()+1, day: d.getUTCDate() };
}
function toRiyadhTS(parts, hour = 0) {
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(hour)}:00:00.000+03:00`;
}
function getDateRange(preset) {
  const now = getRiyadhDateParts();
  const today = { year: now.year, month: now.month, day: now.day };
  const nextHour = Math.min(now.hour + 1, 23);
  const presets = {
    today:      { s: today,          e: today,          eh: nextHour },
    yesterday:  { s: addDays(today,-1), e: today,        eh: 0 },
    last_7d:    { s: addDays(today,-6), e: today,        eh: nextHour },
    last_30d:   { s: addDays(today,-29), e: today,       eh: nextHour },
    this_month: { s: { ...today, day: 1 }, e: today,     eh: nextHour },
    last_90d:   { s: addDays(today,-89), e: today,       eh: nextHour },
    maximum:    { s: addDays(today,-1095), e: today,     eh: nextHour },
  };
  const p = presets[preset] || presets.last_30d;
  return { startTime: toRiyadhTS(p.s, 0), endTime: toRiyadhTS(p.e, p.eh) };
}

// ── HTTP ─────────────────────────────────────────────────────────────────────
async function snapFetch(url, token) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text) }; }
  catch { return { ok: res.ok, status: res.status, raw: text.slice(0, 800) }; }
}

// ── Stats extraction ─────────────────────────────────────────────────────────
function extractStats(payload, entityId) {
  const arr = payload?.total_stats || [];
  const match = arr.find(i => (i.total_stat||i)?.id === entityId) || arr[0] || null;
  return match?.total_stat?.stats || match?.stats || {};
}

// ── Entity stats (single) ─────────────────────────────────────────────────────
async function fetchEntityStats({ entityType, entityId, token, startTime, endTime }) {
  const url =
    `${BASE}/${entityType}/${entityId}/stats` +
    `?granularity=TOTAL` +
    `&fields=${encodeURIComponent(FIELDS.join(","))}` +
    `&start_time=${encodeURIComponent(startTime)}` +
    `&end_time=${encodeURIComponent(endTime)}`;
  const r = await snapFetch(url, token);
  if (!r.ok) return { ok: false, status: r.status, stats: {} };
  return { ok: true, stats: extractStats(r.data, entityId) };
}

// ── Parallel batch stats ──────────────────────────────────────────────────────
async function fetchStatsParallel({ entities, entityType, token, startTime, endTime }) {
  const statsMap = {};
  for (let i = 0; i < entities.length; i += BATCH_SIZE) {
    const batch = entities.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (e) => {
        const r = await fetchEntityStats({ entityType, entityId: e.id, token, startTime, endTime });
        statsMap[e.id] = r.stats || {};
        if (r.status === 429) statsMap["__rate_limited__"] = true;
      })
    );
    if (statsMap["__rate_limited__"]) break;
    if (i + BATCH_SIZE < entities.length) await sleep(BATCH_DELAY_MS);
  }
  return statsMap;
}

// ── Account-level summary (accurate totals) ───────────────────────────────────
async function fetchAccountSummary({ accountId, token, startTime, endTime }) {
  const url =
    `${BASE}/adaccounts/${accountId}/stats` +
    `?granularity=TOTAL` +
    `&fields=${encodeURIComponent(FIELDS.join(","))}` +
    `&start_time=${encodeURIComponent(startTime)}` +
    `&end_time=${encodeURIComponent(endTime)}`;
  const r = await snapFetch(url, token);
  if (!r.ok) return null;
  const s     = extractStats(r.data, accountId);
  const spend = moneyFromMicros(s.spend);
  const rev   = moneyFromMicros(s.conversion_purchases_value);
  const pur   = safeNumber(s.conversion_purchases);
  const imp   = safeNumber(s.impressions);
  const sw    = safeNumber(s.swipes);
  const vv    = safeNumber(s.video_views);
  return {
    spend, revenue: rev, roas: safeDivide(rev, spend),
    purchases: pur, cpa: safeDivide(spend, pur),
    impressions: imp, swipes: sw, clicks: sw,
    ctr:  safeDivide(sw,  imp) * 100,
    cpc:  safeDivide(spend, sw),
    cpm:  safeDivide(spend, imp) * 1000,
    video_views: vv,
    video_view_rate: safeDivide(vv, imp) * 100,
  };
}

// ── Entity list fetchers ──────────────────────────────────────────────────────
function normStatus(raw) {
  const s = String(raw?.status || raw?.effective_status || "").toUpperCase();
  if (["ACTIVE","RUNNING"].includes(s)) return "ACTIVE";
  if (["PAUSED","INACTIVE"].includes(s)) return "PAUSED";
  if (["PENDING","UNDER_REVIEW","REVIEW"].includes(s)) return "PENDING";
  return s || "UNKNOWN";
}

async function fetchEntities({ accountId, level, token }) {
  const paths = { campaign: "campaigns", adsquad: "adsquads", ad: "ads" };
  const path  = paths[level] || "campaigns";
  const url   = `${BASE}/adaccounts/${accountId}/${path}?limit=500`;
  const r     = await snapFetch(url, token);
  if (!r.ok) return { ok: false, status: r.status, error: r.data || r.raw, entities: [] };

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
  } else if (level === "ad") {
    entities = (r.data?.ads || []).map(i => {
      const a = i.ad || i;
      return { id: a.id, name: a.name||"Unnamed", ad_name: a.name||"Unnamed", adsquad_id: a.ad_squad_id||"", status: normStatus(a) };
    });
  }
  return { ok: true, entities };
}

// ── Normalize row ─────────────────────────────────────────────────────────────
function normalizeRow(entity, stats) {
  const spend = moneyFromMicros(stats.spend);
  const rev   = moneyFromMicros(stats.conversion_purchases_value);
  const pur   = safeNumber(stats.conversion_purchases);
  const imp   = safeNumber(stats.impressions);
  const sw    = safeNumber(stats.swipes);
  const vv    = safeNumber(stats.video_views);
  return {
    ...entity,
    spend, revenue: rev, purchase_value: rev,
    roas: safeDivide(rev, spend),
    purchases: pur, cpa: safeDivide(spend, pur),
    impressions: imp, swipes: sw, clicks: sw,
    ctr:  safeDivide(sw,  imp) * 100,
    cpc:  safeDivide(spend, sw),
    cpm:  safeDivide(spend, imp) * 1000,
    video_views: vv,
    video_view_rate: safeDivide(vv, imp) * 100,
  };
}

function buildSummary(rows) {
  const t = rows.reduce((acc, r) => {
    acc.spend     += safeNumber(r.spend);
    acc.revenue   += safeNumber(r.revenue);
    acc.purchases += safeNumber(r.purchases);
    acc.impressions += safeNumber(r.impressions);
    acc.swipes    += safeNumber(r.swipes);
    acc.video_views += safeNumber(r.video_views);
    return acc;
  }, { spend:0, revenue:0, purchases:0, impressions:0, swipes:0, video_views:0 });
  return {
    ...t, clicks: t.swipes,
    roas: safeDivide(t.revenue, t.spend),
    cpa:  safeDivide(t.spend, t.purchases),
    ctr:  safeDivide(t.swipes, t.impressions) * 100,
    cpc:  safeDivide(t.spend, t.swipes),
    cpm:  safeDivide(t.spend, t.impressions) * 1000,
    video_view_rate: safeDivide(t.video_views, t.impressions) * 100,
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const accountId  = searchParams.get("account_id");
  const level      = searchParams.get("level")       || "campaign";
  const datePreset = searchParams.get("date_preset") || "last_30d";
  const activeOnly = searchParams.get("active_only") === "1";
  const force      = searchParams.get("force")       === "1";

  if (!accountId) return NextResponse.json({ success: false, error: "account_id is required" });

  const cacheKey = getCacheKey({ accountId, level, datePreset, activeOnly });
  if (!force) {
    const cached = getCached(cacheKey);
    if (cached) return NextResponse.json({ ...cached, cached: true });
  }

  const token = await getSnapchatToken();
  if (!token) return NextResponse.json({ success: false, error: "Not connected to Snapchat" });

  const { startTime, endTime } = getDateRange(datePreset);
  const entityType = { campaign:"campaigns", adsquad:"adsquads", ad:"ads" }[level] || "campaigns";

  // 1. Fetch account summary (accurate totals — fast, 1 call)
  const [accountSummary, entitiesResult] = await Promise.all([
    fetchAccountSummary({ accountId, token, startTime, endTime }),
    fetchEntities({ accountId, level, token }),
  ]);

  if (!entitiesResult.ok) {
    return NextResponse.json({ success: false, source: "entities", error: entitiesResult.error });
  }

  const allEntities = entitiesResult.entities;

  // 2. Active first — sort active to top
  const sorted = [
    ...allEntities.filter(e => e.status === "ACTIVE"),
    ...allEntities.filter(e => e.status !== "ACTIVE"),
  ];

  // 3. Load active only by default, all if requested
  const toLoad = activeOnly
    ? sorted.filter(e => e.status === "ACTIVE")
    : sorted;

  // 4. Parallel batch stats
  const statsMap = await fetchStatsParallel({
    entities: toLoad, entityType, token, startTime, endTime
  });

  const rateLimited = !!statsMap["__rate_limited__"];
  const rows = toLoad.map(e => normalizeRow(e, statsMap[e.id] || {}));

  // 5. Summary — use account-level if available (most accurate)
  const summary = accountSummary || buildSummary(rows);

  const payload = {
    success:    true,
    provider:   "Snapchat Ads",
    account_id: accountId,
    level,
    date_preset: datePreset,
    start_time:  startTime,
    end_time:    endTime,
    total_entities:   allEntities.length,
    active_entities:  allEntities.filter(e => e.status === "ACTIVE").length,
    loaded_count:     rows.length,
    active_only:      activeOnly,
    rate_limited:     rateLimited,
    summary,
    data: rows,
  };

  setCache(cacheKey, payload);
  return NextResponse.json(payload);
}
