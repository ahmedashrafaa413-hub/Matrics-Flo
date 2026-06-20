import { NextResponse } from "next/server";
import { getSnapchatToken } from "../../../../lib/snapchatToken";

export const dynamic = "force-dynamic";

const BASE = "https://adsapi.snapchat.com/v1";
const CONCURRENCY = 8;

// In-memory cache — thumbnails rarely change, cache for 1 hour
const thumbCache = new Map();
const CACHE_TTL = 60 * 60 * 1000;

function cacheGet(key) {
  const c = thumbCache.get(key);
  if (!c) return null;
  if (Date.now() - c.ts > CACHE_TTL) { thumbCache.delete(key); return null; }
  return c.data;
}
function cacheSet(key, data) { thumbCache.set(key, { ts: Date.now(), data }); }

async function snapFetch(url, token) {
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const text = await res.text();
    try { return { ok: res.ok, status: res.status, data: JSON.parse(text) }; }
    catch { return { ok: false, status: res.status, data: null }; }
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

async function runWithConcurrency(items, concurrency, handler) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor; cursor += 1;
      results[i] = await handler(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

// ── Step 1: ad -> creative_id ─────────────────────────────────────────────────
async function getCreativeIdForAd(adId, token) {
  const cacheKey = `ad_creative:${adId}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const r = await snapFetch(`${BASE}/ads/${adId}`, token);
  if (!r.ok) return null;
  const ad = r.data?.ads?.[0]?.ad || r.data?.ad;
  const creativeId = ad?.creative_id || null;
  if (creativeId) cacheSet(cacheKey, creativeId);
  return creativeId;
}

// ── Step 2: creative_id -> media_id (+ type) ──────────────────────────────────
async function getMediaIdForCreative(creativeId, token) {
  const cacheKey = `creative_media:${creativeId}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const r = await snapFetch(`${BASE}/creatives/${creativeId}`, token);
  if (!r.ok) return null;
  const creative = r.data?.creatives?.[0]?.creative || r.data?.creative;

  const mediaId =
    creative?.top_snap_media_id ||
    creative?.preview_properties?.preview_media_id ||
    creative?.longform_video_properties?.video_media_id ||
    null;

  const result = mediaId
    ? { media_id: mediaId, creative_type: creative?.type || null, headline: creative?.headline || null }
    : null;

  if (result) cacheSet(cacheKey, result);
  return result;
}

// ── Step 3: media_id -> thumbnail url ─────────────────────────────────────────
async function getThumbnailForMedia(mediaId, token) {
  const cacheKey = `media_thumb:${mediaId}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const r = await snapFetch(`${BASE}/media/${mediaId}/thumbnail`, token);
  if (!r.ok) return null;

  // Response shape varies — try common locations for the actual image URL
  const thumb =
    r.data?.media?.[0]?.media?.download_link ||
    r.data?.media?.download_link ||
    r.data?.download_link ||
    r.data?.thumbnail?.download_link ||
    null;

  if (thumb) cacheSet(cacheKey, thumb);
  return thumb;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const adIdsRaw = searchParams.get("ad_ids") || "";
  const adIds = adIdsRaw.split(",").map(s => s.trim()).filter(Boolean);

  if (!adIds.length) {
    return NextResponse.json({ success: false, error: "ad_ids is required" }, { status: 400 });
  }

  const token = await getSnapchatToken();
  if (!token) {
    return NextResponse.json({ success: false, error: "Not connected to Snapchat" }, { status: 401 });
  }

  const results = await runWithConcurrency(adIds, CONCURRENCY, async (adId) => {
    try {
      const creativeId = await getCreativeIdForAd(adId, token);
      if (!creativeId) return { ad_id: adId, thumbnail_url: null, error: "no_creative" };

      const mediaInfo = await getMediaIdForCreative(creativeId, token);
      if (!mediaInfo?.media_id) return { ad_id: adId, creative_id: creativeId, thumbnail_url: null, error: "no_media" };

      const thumbUrl = await getThumbnailForMedia(mediaInfo.media_id, token);

      return {
        ad_id: adId,
        creative_id: creativeId,
        creative_type: mediaInfo.creative_type,
        media_id: mediaInfo.media_id,
        thumbnail_url: thumbUrl,
        error: thumbUrl ? null : "no_thumbnail",
      };
    } catch (e) {
      return { ad_id: adId, thumbnail_url: null, error: e.message };
    }
  });

  const map = {};
  for (const r of results) map[r.ad_id] = r;

  return NextResponse.json({
    success: true,
    count: results.length,
    found: results.filter(r => r.thumbnail_url).length,
    data: results,
    map,
  });
}
