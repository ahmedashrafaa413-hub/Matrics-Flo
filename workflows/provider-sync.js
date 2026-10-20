import { FatalError, getStepMetadata } from "workflow";
import { getSyncJobById, updateSyncJob } from "../lib/syncJobs";
import { syncSnapchatWorkspace } from "../lib/snapchatSyncService";
import { syncSallaWorkspace } from "../lib/sallaSyncService";

// The Workflow runtime retries a step that throws. Retrying is done there
// only (no loop inside the step), so a sync runs at most MAX_ATTEMPTS times.
const MAX_RETRIES = 2;
const MAX_ATTEMPTS = MAX_RETRIES + 1;

function isRetryable(error) {
  const status = Number(error?.status || 0);
  return status === 429 || status >= 500 || status === 0;
}

async function executeProviderSync(jobId) {
  "use step";

  const { attempt } = getStepMetadata();
  console.log(`[providerSync] START job=${jobId} attempt=${attempt}`);
  const job = await getSyncJobById(jobId);

  await updateSyncJob(jobId, {
    status: "running",
    progress: Math.min(10 + (attempt - 1) * 30, 90),
    started_at: job.started_at || new Date().toISOString(),
    error: null
  });

  try {
    let result;

    if (job.provider === "snapchat") {
      result = await syncSnapchatWorkspace({
        workspaceId: job.workspace_id,
        accountId: job.account_id,
        ...job.request_params
      });
    } else if (job.provider === "salla") {
      result = await syncSallaWorkspace({
        workspaceId: job.workspace_id,
        userId: job.user_id
      });
    } else {
      const error = new Error(`Unsupported sync provider: ${job.provider}`);
      error.status = 400;
      throw error;
    }

    await updateSyncJob(jobId, {
      status: "succeeded",
      progress: 100,
      result,
      error: null,
      completed_at: new Date().toISOString()
    });

    console.log(`[providerSync] DONE job=${jobId} attempt=${attempt}`);
    return result;
  } catch (error) {
    const willRetry = isRetryable(error) && attempt < MAX_ATTEMPTS;
    console.error(
      `[providerSync] ATTEMPT_FAILED job=${jobId} attempt=${attempt} status=${error?.status || 0} retry=${willRetry}`
    );

    if (willRetry) {
      // Leave the job "running" and let the runtime schedule the retry.
      throw error;
    }

    await updateSyncJob(jobId, {
      status: "failed",
      progress: 100,
      error: error?.message || "Provider synchronization failed",
      result: error?.details ? { errors: error.details } : null,
      completed_at: new Date().toISOString()
    });

    console.error(`[providerSync] FAIL job=${jobId}`);
    // FatalError stops the runtime from retrying a job already marked failed
    // (expired tokens, bad input, or the last allowed attempt).
    throw new FatalError(error?.message || "Provider synchronization failed");
  }
}

executeProviderSync.maxRetries = MAX_RETRIES;

export async function providerSyncWorkflow(jobId) {
  "use workflow";

  console.log(`[providerSyncWorkflow] START job=${jobId}`);
  const result = await executeProviderSync(jobId);
  console.log(`[providerSyncWorkflow] DONE job=${jobId}`);
  return result;
}
