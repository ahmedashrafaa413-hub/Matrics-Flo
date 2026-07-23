import { providerSyncWorkflow } from "../workflows/provider-sync";
import {
  attachWorkflowRun,
  createOrReuseSyncJob
} from "./syncJobs";

export async function startProviderSync({
  workspaceId,
  userId,
  provider,
  accountId = "",
  params = {}
}) {
  const { job, reused } = await createOrReuseSyncJob({
    workspaceId,
    userId,
    provider,
    accountId,
    params
  });

  if (reused) {
    return {
      job,
      runId: job.run_id || null,
      reused: true
    };
  }

  try {
    // Load the Workflow runtime only when an authenticated sync request is
    // actually accepted. Importing it at route module scope makes Next.js load
    // its local CLI dependencies during build-time route collection.
    const { start } = await import("workflow/api");
    const run = await start(providerSyncWorkflow, [job.id]);
    const updated = await attachWorkflowRun(job.id, run.runId);

    return {
      job: updated,
      runId: run.runId,
      reused: false
    };
  } catch (error) {
    const { updateSyncJob } = await import("./syncJobs");
    await updateSyncJob(job.id, {
      status: "failed",
      progress: 100,
      error: error.message || "Failed to start background synchronization",
      completed_at: new Date().toISOString()
    });
    throw error;
  }
}
