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

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);

    const token =
      searchParams.get("token") ||
      cookies().get("meta_token")?.value;

    const accountId = searchParams.get("account_id");
    const level = searchParams.get("level") || "campaign";
    const datePreset = searchParams.get("date_preset") || "maximum";

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
      "purchase_roas",
      "date_start",
      "date_stop"
    ].join(",");

    const params = new URLSearchParams({
      fields,
      level,
      date_preset: datePreset,
      limit: "200",
      access_token: token
    });

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
        return acc;
      },
      {
        spend: 0,
        impressions: 0,
        clicks: 0,
        purchases: 0,
        purchase_value: 0,
        add_to_cart: 0,
        initiate_checkout: 0
      }
    );
    summary.roas = Number(safeDivide(summary.purchase_value, summary.spend).toFixed(2));
    summary.cpa = Number(safeDivide(summary.spend, summary.purchases).toFixed(2));
    summary.cost_per_add_to_cart = Number(safeDivide(summary.spend, summary.add_to_cart).toFixed(2));
    summary.cost_per_initiate_checkout = Number(safeDivide(summary.spend, summary.initiate_checkout).toFixed(2));

    return NextResponse.json({
      success: true,
      provider: "Meta Ads",
      account_id: accountId,
      level,
      date_preset: datePreset,
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
