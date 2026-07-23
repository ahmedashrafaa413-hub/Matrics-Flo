import { NextResponse } from "next/server";
import { getActiveWorkspace } from "../../../../lib/workspace";
import { assertTrustedMutation } from "../../../../lib/requestSecurity.mjs";
import { assertRateLimit, consumeRateLimit } from "../../../../lib/rateLimit.mjs";
import { startProviderSync } from "../../../../lib/startProviderSync";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    assertTrustedMutation(request);
    const { workspace, user } = await getActiveWorkspace(request);

    const rateLimit = await consumeRateLimit({
      scope: "salla-sync",
      identity: `${workspace.id}:${user.id}`,
      limit: 4,
      windowSeconds: 600
    });
    assertRateLimit(rateLimit);

    const started = await startProviderSync({
      workspaceId: workspace.id,
      userId: user.id,
      provider: "salla",
      params: {}
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
        provider: "Salla",
        error: error.message || "Failed to start Salla sync"
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
