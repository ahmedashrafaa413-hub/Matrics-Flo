import { NextResponse } from "next/server";
import { getActiveWorkspace } from "../../../../lib/workspace";
import { buildAnalyticsSnapshot, buildPlatformOverview, normalizeCampaign } from "../../../../lib/analyticsEngine.mjs";

export const dynamic = "force-dynamic";

const PREVIOUS_PRESET = {
  today: "yesterday"
};

async function readJson(url, cookie) {
  try {
    const response = await fetch(url, { cache: "no-store", headers: cookie ? { Cookie: cookie } : {} });
    const data = await response.json();
    return { success: response.ok && data?.success !== false, status: response.status, data };
  } catch (error) {
    return { success: false, status: 502, data: null, error: error.message };
  }
}

export async function GET(request) {
  try {
    const { workspace } = await getActiveWorkspace(request);
    const url = new URL(request.url);
    const baseUrl = `${url.protocol}//${url.host}`;
    const cookie = request.headers.get("cookie") || "";
    const datePreset = url.searchParams.get("date_preset") || "last_30d";
    const previousPreset = PREVIOUS_PRESET[datePreset] || null;
    const metaAccountId = url.searchParams.get("meta_account_id") || "";
    const snapchatAccountId = url.searchParams.get("snapchat_account_id") || "";
    const tiktokAccountId = url.searchParams.get("tiktok_account_id") || "";

    const performanceUrl = (preset) => {
      const params = new URLSearchParams({ date_preset: preset, salla_currency: "SAR" });
      if (metaAccountId) params.set("meta_account_id", metaAccountId);
      if (snapchatAccountId) params.set("snapchat_account_id", snapchatAccountId);
      if (tiktokAccountId) params.set("tiktok_account_id", tiktokAccountId);
      return `${baseUrl}/api/performance/overview?${params}`;
    };

    const requests = [
      readJson(performanceUrl(datePreset), cookie),
      previousPreset
        ? readJson(performanceUrl(previousPreset), cookie)
        : Promise.resolve({ success: false, data: null, unavailable: true }),
      metaAccountId
        ? readJson(`${baseUrl}/api/meta/insights?account_id=${encodeURIComponent(metaAccountId)}&level=campaign&date_preset=${encodeURIComponent(datePreset)}`, cookie)
        : Promise.resolve({ success: false, data: null }),
      snapchatAccountId
        ? readJson(`${baseUrl}/api/snapchat/data?account_id=${encodeURIComponent(snapchatAccountId)}&level=campaign&date_preset=${encodeURIComponent(datePreset)}&page_size=200`, cookie)
        : Promise.resolve({ success: false, data: null }),
      tiktokAccountId
        ? readJson(`${baseUrl}/api/tiktok/data?account_id=${encodeURIComponent(tiktokAccountId)}&level=campaign&date_preset=${encodeURIComponent(datePreset)}`, cookie)
        : Promise.resolve({ success:false, data:null }),
      // GA4 takes the same preset names, so every source covers the same days.
      readJson(`${baseUrl}/api/ga/overview?range=${encodeURIComponent(datePreset)}`, cookie),
      readJson(`${baseUrl}/api/ga/realtime`, cookie)
    ];
    const [current, previous, meta, snapchat, tiktok, ga, realtime] = await Promise.all(requests);
    const campaigns = [
      ...(meta.data?.data || []).map((row) => normalizeCampaign(row, "Meta Ads")),
      ...(snapchat.data?.rows || []).map((row) => normalizeCampaign(row, "Snapchat Ads")),
      ...(tiktok.data?.rows || []).map((row) => normalizeCampaign(row, "TikTok Ads"))
    ].filter((row) => row.id || row.name);
    const sources = [
      { source: "Meta Ads", connected: Boolean(metaAccountId), success: meta.success },
      { source: "Snapchat Ads", connected: Boolean(snapchatAccountId), success: snapchat.success },
      { source: "TikTok Ads", connected: Boolean(tiktokAccountId), success: tiktok.success },
      { source: "Salla", connected: true, success: current.success && !current.data?.debug?.some((entry) => entry.source === "Salla" && !entry.success) },
      { source: "GA4", connected: true, success: ga.success }
    ];
    const freshness = {
      snapchatConnected: Boolean(snapchatAccountId),
      snapchatLastSyncedAt: snapchat.data?.last_synced_at || null
    };
    const analytics = buildAnalyticsSnapshot({
      current: current.data?.summary || {},
      previous: previous.data?.summary || {},
      campaigns,
      sources,
      freshness
    });
    const platformOverview = buildPlatformOverview(
      current.success ? current.data?.sources || [] : [],
      previous.success ? previous.data?.sources || [] : []
    );

    const unavailableSources = sources.filter((source) => source.connected && !source.success);
    const partialData = !current.success || Boolean(current.data?.partial_data) || unavailableSources.length > 0;
    return NextResponse.json({
      success: current.success,
      partial_data: partialData,
      unavailable_sources: unavailableSources.map((source) => source.source),
      workspace: { id: workspace.id, name: workspace.name },
      date_preset: datePreset,
      comparison_preset: previousPreset,
      current: current.success ? current.data?.summary || null : null,
      previous: previous.data?.summary || null,
      platforms: current.success ? current.data?.sources || [] : [],
      platform_overview: platformOverview,
      campaigns,
      ga4: ga.success ? ga.data?.metrics || null : null,
      realtime: realtime.success ? realtime.data?.realtime || null : null,
      freshness,
      ...analytics
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || "Analytics unavailable" }, { status: error.status || 500 });
  }
}
