import { getSyncJobById, updateSyncJob } from "../lib/syncJobs";
import { syncSnapchatWorkspace } from "../lib/snapchatSyncService";
import { syncSallaWorkspace } from "../lib/sallaSyncService";

const MAX_ATTEMPTS = 3;

function isRetryable(error) {
  const status = Number(error?.status || 0);
  return status === 429 || status >= 500 || status === 0;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function executeProviderSync(jobId) {
  "use step";

  console.log(`[providerSync] START job=${jobId}`);
  const job = await getSyncJobById(jobId);

  await updateSyncJob(jobId, {
    status: "running",
    progress: 10,
    started_at: job.started_at || new Date().toISOString(),
    error: null
  });

  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
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
      lastError = error;
      console.error(
        `[providerSync] ATTEMPT_FAILED job=${jobId} attempt=${attempt} status=${error?.status || 0}`
      );

      if (!isRetryable(error) || attempt === MAX_ATTEMPTS) break;
      await updateSyncJob(jobId, { progress: 10 + attempt * 20 });
      await delay(1000 * 2 ** (attempt - 1));
    }
  }

  await updateSyncJob(jobId, {
    status: "failed",
    progress: 100,
    error: lastError?.message || "Provider synchronization failed",
    result: lastError?.details ? { errors: lastError.details } : null,
    completed_at: new Date().toISOString()
  });

  console.error(`[providerSync] FAIL job=${jobId}`);
  throw lastError;
}

export async function providerSyncWorkflow(jobId) {
  "use workflow";

  console.log(`[providerSyncWorkflow] START job=${jobId}`);
  const result = await executeProviderSync(jobId);
  console.log(`[providerSyncWorkflow] DONE job=${jobId}`);
  return result;
}
