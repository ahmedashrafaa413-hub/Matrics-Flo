import { NextResponse } from "next/server";
import { getActiveWorkspace } from "../../../../lib/workspace";
import { getSyncJobForWorkspace } from "../../../../lib/syncJobs";

export const dynamic = "force-dynamic";

export async function GET(request, context) {
  try {
    const { jobId } = await context.params;
    const { workspace } = await getActiveWorkspace(request);
    const job = await getSyncJobForWorkspace({
      jobId,
      workspaceId: workspace.id
    });

    if (!job) {
      return NextResponse.json(
        { success: false, error: "Sync job not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      job: {
        id: job.id,
        provider: job.provider,
        account_id: job.account_id,
        status: job.status,
        progress: job.progress,
        result: job.result,
        error: job.error,
        created_at: job.created_at,
        started_at: job.started_at,
        completed_at: job.completed_at,
        updated_at: job.updated_at
      }
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message || "Failed to load sync job" },
      { status: error.status || 500 }
    );
  }
}
