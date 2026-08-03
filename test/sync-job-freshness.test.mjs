import test from "node:test";
import assert from "node:assert/strict";
import { ACTIVE_SYNC_JOB_TTL_MS, isFreshSyncJob } from "../lib/syncJobFreshness.mjs";

test("only recent queued or running sync jobs are reusable", () => {
  const now = Date.parse("2026-08-03T12:00:00.000Z");

  assert.equal(
    isFreshSyncJob({ updated_at: new Date(now - ACTIVE_SYNC_JOB_TTL_MS + 1).toISOString() }, now),
    true
  );
  assert.equal(
    isFreshSyncJob({ updated_at: new Date(now - ACTIVE_SYNC_JOB_TTL_MS).toISOString() }, now),
    false
  );
});
