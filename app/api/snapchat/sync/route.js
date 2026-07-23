import { NextResponse } from "next/server";
import { getActiveWorkspace } from "../../../../lib/workspace";
import { assertTrustedMutation } from "../../../../lib/requestSecurity.mjs";
import { assertRateLimit, consumeRateLimit } from "../../../../lib/rateLimit.mjs";
import { startProviderSync } from "../../../../lib/startProviderSync";
import {
  VALID_SWIPE,
  VALID_VIEW
} from "../../../../lib/snapchatApi";

export const dynamic = "force-dynamic";

function todayDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function normalizeLevel(level) {
  const raw = String(level || "campaign").toLowerCase().trim();
  if (raw === "overview" || raw === "account") return "account";
  if (raw === "campaign" || raw === "campaigns") return "campaign";
  if (raw === "adsquad" || raw === "ad_squad" || raw === "ad_squads") {
    return "adsquad";
  }
  if (raw === "ad" || raw === "ads") return "ad";
  return null;
}

export async function POST(request) {
  try {
    assertTrustedMutation(request);
    const { workspace, user } = await getActiveWorkspace(request);
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get("account_id") || "";

    if (!accountId) {
      return NextResponse.json(
        { success: false, error: "account_id is required" },
        { status: 400 }
      );
    }

    const levels = Array.from(
      new Set(
        (searchParams.get("levels") || searchParams.get("level") || "campaign")
          .split(",")
          .map(normalizeLevel)
          .filter(Boolean)
      )
    );

    if (!levels.length) {
      return NextResponse.json(
        { success: false, error: "No valid levels requested" },
        { status: 400 }
      );
    }

    const swRaw = searchParams.get("swipe_window") || "28_DAY";
    const vwRaw = searchParams.get("view_window") || "1_DAY";
    const params = {
      datePreset: searchParams.get("date_preset") || "last_30d",
      metricDate: searchParams.get("metric_date") || todayDate(),
      levels,
      limit: Math.min(Math.max(Number(searchParams.get("limit") || 20), 1), 100),
      candidateLimit: Math.min(
        Math.max(Number(searchParams.get("candidate_limit") || 500), 1),
        1000
      ),
      swipeWindow: VALID_SWIPE.includes(swRaw) ? swRaw : "28_DAY",
      viewWindow: VALID_VIEW.includes(vwRaw) ? vwRaw : "1_DAY"
    };

    const rateLimit = await consumeRateLimit({
      scope: "snapchat-sync",
      identity: `${workspace.id}:${user.id}`,
      limit: 6,
      windowSeconds: 600
    });
    assertRateLimit(rateLimit);

    const started = await startProviderSync({
      workspaceId: workspace.id,
      userId: user.id,
      provider: "snapchat",
      accountId,
      params
    });

    return NextResponse.json(
      {
        success: true,
        accepted: true,
        reused: started.reused,
        job_id: started.job.id,
        run_id: started.runId,
        status: started.job.status,
        rate_limit: {
          remaining: rateLimit.remaining,
          reset_at: rateLimit.resetAt
        }
      },
      { status: started.reused ? 200 : 202 }
    );
  } catch (error) {
    const headers = {};
    if (error.retryAfter) headers["Retry-After"] = error.retryAfter;

    return NextResponse.json(
      {
        success: false,
        provider: "Snapchat Ads",
        error: error.message || "Failed to start Snapchat sync"
      },
      { status: error.status || 500, headers }
    );
  }
}

export async function GET() {
  return NextResponse.json(
    { success: false, error: "Method not allowed. Use POST for synchronization." },
    { status: 405, headers: { Allow: "POST" } }
  );
}
