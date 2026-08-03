export const ACTIVE_SYNC_JOB_TTL_MS = 30 * 60 * 1000;

export function isFreshSyncJob(job, now = Date.now()) {
  const timestamp = Date.parse(job?.updated_at || job?.created_at || "");
  return Number.isFinite(timestamp) && now - timestamp < ACTIVE_SYNC_JOB_TTL_MS;
}
