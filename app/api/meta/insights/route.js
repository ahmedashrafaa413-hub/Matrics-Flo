import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function getActionValue(actions = [], names = []) {
  const found = actions.find((item) =>
    names.includes(item.action_type)
  );
  return Number(found?.value || 0);
}
function getActionValueAmount(actionValues = [], names = []) {
  const found = actionValues.find((item) =>
    names.includes(item.action_type)
  );
  return Number(found?.value || 0);
}
function safeDivide(a, b) {
  const x = Number(a || 0);
  const y = Number(b || 0);
  if (!y) return 0;
  return x / y;
}

function getVideoMetric(row, key) {
  return Number(
    row?.[key]?.[0]?.value || 0
  );
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);

    const token =
      searchParams.get("token") ||
      cookies().get("meta_token")?.value;

    const accountId  = searchParams.get("account_id");
    const level      = searchParams.get("level")      || "campaign";
    const datePreset = searchParams.get("date_preset")|| "maximum";
    const sinceParam = searchParams.get("since");
    const untilParam = searchParams.get("until");

    if (!token) {
      return NextResponse.json(
        { success: false, error: "Not connected to Meta" },
        { status: 401 }
      );
    }

    if (!accountId) {
      return NextResponse.json(
        { success: false, error: "account_id is required" },
        { status: 400 }
      );
    }

    const fields = [
      "campaign_id",
      "campaign_name",
      "adset_id",
      "adset_name",
      "ad_id",
      "ad_name",
      "spend",
      "impressions",
      "reach",
      "frequency",
      "clicks",
      "inline_link_clicks",
      "ctr",
      "cpc",
      "cpm",
      "actions",
      "action_values",
      "video_play_actions",
      "video_p25_watched_actions",
      "video_p50_watched_actions",
      "video_p75_watched_actions",
      "video_p95_watched_actions",
      "video_p100_watched_actions",
      "video_thruplay_watched_actions",
      "purchase_roas",
      "date_start",
      "date_stop"
    ].join(",");

    const params = new URLSearchParams({
      fields,
      level,
      limit: "200",
      access_token: token
    });

    // Custom date range takes priority over date_preset
    if (sinceParam && untilParam) {
      params.append("time_range", JSON.stringify({ since: sinceParam, until: untilParam }));
    } else {
      params.append("date_preset", datePreset);
    }

    const url = `https://graph.facebook.com/v19.0/${accountId}/insights?${params.toString()}`;

    const response = await fetch(url, { cache: "no-store" });
    const data = await response.json();

    if (data.error) {
      return NextResponse.json(
        {
          success: false,
          error: data.error
        },
        { status: 400 }
      );
    }

    const rows = data.data || [];
    const enriched = rows.map((row) => {
      const purchases = getActionValue(
        row.actions || [],
        [
          "purchase",
          "omni_purchase",
          "offsite_conversion.fb_pixel_purchase"
        ]
      );
      const addToCart = getActionValue(
        row.actions || [],
        [
          "add_to_cart",
          "omni_add_to_cart",
          "offsite_conversion.fb_pixel_add_to_cart"
        ]
      );
      const initiateCheckout = getActionValue(
        row.actions || [],
        [
          "initiate_checkout",
          "omni_initiated_checkout",
          "offsite_conversion.fb_pixel_initiate_checkout"
        ]
      );
      const viewContent = getActionValue(
        row.actions || [],
        [
          "view_content",
          "omni_view_content",
          "offsite_conversion.fb_pixel_view_content"
        ]
      );
      const landingPageViews = getActionValue(
        row.actions || [],
        ["landing_page_view"]
      );
      const purchaseValue = getActionValueAmount(
        row.action_values || [],
        [
          "purchase",
          "omni_purchase",
          "offsite_conversion.fb_pixel_purchase"
        ]
      );
      const spend = Number(row.spend || 0);
      const clicks = Number(row.clicks || 0);
      const impressions = Number(row.impressions || 0);
      const videoPlays = getVideoMetric(row, "video_play_actions");
      const thruplays  = getVideoMetric(row, "video_thruplay_watched_actions");
      const videoViews = getActionValue(row.actions || [], ["video_view"]);
      const video25    = getVideoMetric(row, "video_p25_watched_actions");
      const video50    = getVideoMetric(row, "video_p50_watched_actions");
      const video75    = getVideoMetric(row, "video_p75_watched_actions");
      const video95    = getVideoMetric(row, "video_p95_watched_actions");
      const video100   = getVideoMetric(row, "video_p100_watched_actions");
      const hookRate       = safeDivide(videoViews, impressions) * 100;
      const holdRate       = safeDivide(thruplays, videoPlays)  * 100;
      const completionRate = safeDivide(video100,  videoPlays)  * 100;
      const roas = safeDivide(purchaseValue, spend);
      const cpa = safeDivide(spend, purchases);
      const costPerATC = safeDivide(spend, addToCart);
      const costPerIC = safeDivide(spend, initiateCheckout);
      return {
        ...row,
        purchases,
        purchase_value: purchaseValue,
        add_to_cart: addToCart,
        initiate_checkout: initiateCheckout,
        view_content: viewContent,
        landing_page_views: landingPageViews,
        video_plays: videoPlays,
        thruplays,
        video_views: videoViews,
        video_25: video25,
        video_50: video50,
        video_75: video75,
        video_95: video95,
        video_100: video100,
        hook_rate:       Number(hookRate.toFixed(2)),
        hold_rate:       Number(holdRate.toFixed(2)),
        completion_rate: Number(completionRate.toFixed(2)),
        roas: Number(roas.toFixed(2)),
        cpa: Number(cpa.toFixed(2)),
        cost_per_add_to_cart: Number(costPerATC.toFixed(2)),
        cost_per_initiate_checkout: Number(costPerIC.toFixed(2))
      };
    });
    const summary = enriched.reduce(
      (acc, row) => {
        acc.spend += Number(row.spend || 0);
        acc.impressions += Number(row.impressions || 0);
        acc.clicks += Number(row.clicks || 0);
        acc.purchases += Number(row.purchases || 0);
        acc.purchase_value += Number(row.purchase_value || 0);
        acc.add_to_cart += Number(row.add_to_cart || 0);
        acc.initiate_checkout += Number(row.initiate_checkout || 0);
        acc.view_content += Number(row.view_content || 0);
        acc.landing_page_views += Number(row.landing_page_views || 0);
        return acc;
      },
      {
        spend: 0,
        impressions: 0,
        clicks: 0,
        purchases: 0,
        purchase_value: 0,
        add_to_cart: 0,
        initiate_checkout: 0,
        view_content: 0,
        landing_page_views: 0
      }
    );
    summary.roas = Number(safeDivide(summary.purchase_value, summary.spend).toFixed(2));
    summary.cpa = Number(safeDivide(summary.spend, summary.purchases).toFixed(2));
    summary.cost_per_add_to_cart = Number(safeDivide(summary.spend, summary.add_to_cart).toFixed(2));
    summary.cost_per_initiate_checkout = Number(safeDivide(summary.spend, summary.initiate_checkout).toFixed(2));
    summary.lpv_rate = Number(
      (safeDivide(summary.landing_page_views, summary.clicks) * 100).toFixed(2)
    );
    summary.view_content_rate = Number(
      (
        safeDivide(
          summary.view_content,
          summary.landing_page_views || summary.clicks
        ) * 100
      ).toFixed(2)
    );
    summary.atc_rate = Number(
      (
        safeDivide(
          summary.add_to_cart,
          summary.view_content || summary.landing_page_views || summary.clicks
        ) * 100
      ).toFixed(2)
    );
    summary.checkout_rate = Number(
      (safeDivide(summary.initiate_checkout, summary.add_to_cart) * 100).toFixed(2)
    );
    summary.purchase_rate = Number(
      (safeDivide(summary.purchases, summary.initiate_checkout) * 100).toFixed(2)
    );
    summary.cart_abandonment_rate = Number(
      (
        summary.add_to_cart > 0
          ? ((summary.add_to_cart - summary.purchases) / summary.add_to_cart) * 100
          : 0
      ).toFixed(2)
    );

    return NextResponse.json({
      success: true,
      provider: "Meta Ads",
      account_id: accountId,
      level,
      date_preset:  sinceParam && untilParam ? "custom" : datePreset,
      date_range:   sinceParam && untilParam ? { since: sinceParam, until: untilParam } : null,
      data: enriched,
      summary,
      paging: data.paging || null
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Internal server error"
      },
      { status: 500 }
    );
  }
}
