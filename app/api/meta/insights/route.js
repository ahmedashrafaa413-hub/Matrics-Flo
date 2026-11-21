import { NextResponse } from "next/server";
import { getMetaToken } from "../../../../lib/metaToken";
import { fetchMetaInsights } from "../../../../lib/metaInsights.mjs";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);

    const token = await getMetaToken(request);

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

    const result = await fetchMetaInsights({
      token,
      accountId,
      level,
      datePreset,
      since: sinceParam || "",
      until: untilParam || ""
    });

    return NextResponse.json({
      success: true,
      provider: "Meta Ads",
      account_id: accountId,
      level,
      date_preset:  sinceParam && untilParam ? "custom" : datePreset,
      date_range:   sinceParam && untilParam ? { since: sinceParam, until: untilParam } : null,
      data: result.data,
      summary: result.summary,
      pages_loaded: result.pages_loaded
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error?.metaError || error?.message || "Internal server error"
      },
      { status: error?.status || 500 }
    );
  }
}
