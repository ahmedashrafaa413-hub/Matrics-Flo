import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ACTION_REPORT_TIME, fetchEntityStats } from "../lib/snapchatApi.js";

async function requestedUrl(args) {
  const original = globalThis.fetch;
  let url = null;
  globalThis.fetch = async (u) => {
    url = u;
    return new Response(JSON.stringify({ total_stats: [{ total_stat: { stats: { spend: 1000000 } } }] }), { status: 200 });
  };
  try {
    await fetchEntityStats({ level: "campaign", entityId: "c1", token: "t", startTime: "2026-11-22T00:00:00.000+03:00", endTime: "2026-11-23T00:00:00.000+03:00", swipeWindow: "28_DAY", viewWindow: "1_DAY", ...args });
  } finally {
    globalThis.fetch = original;
  }
  return new URL(url);
}

test("entity stats ask Snapchat for the requested action report time", async () => {
  assert.equal((await requestedUrl({ actionReportTime: "conversion" })).searchParams.get("action_report_time"), "conversion");
  assert.equal((await requestedUrl({ actionReportTime: "impression" })).searchParams.get("action_report_time"), "impression");
});

test("entity stats keep the default for a missing or unknown action report time", async () => {
  assert.equal((await requestedUrl({})).searchParams.get("action_report_time"), ACTION_REPORT_TIME);
  assert.equal((await requestedUrl({ actionReportTime: "bogus" })).searchParams.get("action_report_time"), ACTION_REPORT_TIME);
});

test("MCP get_snapchat_insights defaults to conversion time and validates action_report_time", async () => {
  const route = await readFile(new URL("../app/api/mcp/route.js", import.meta.url), "utf8");
  assert.match(route, /action_report_time: \{ type: "string", enum: ACTION_REPORT_TIMES/);
  assert.match(route, /let actionReportTime = "conversion";/);
  assert.match(route, /action_report_time must be one of/);
});
