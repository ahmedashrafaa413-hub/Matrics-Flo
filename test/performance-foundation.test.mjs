import test from "node:test";
import assert from "node:assert/strict";
import { buildConnectionStatus } from "../lib/connectionStatus.mjs";

test("connection status separates providers without exposing tokens", () => {
  const status = buildConnectionStatus([
    {
      provider: "meta",
      account_id: "act_123",
      account_name: "Main Meta",
      account_currency: "SAR",
      access_token: "must-not-leak",
      metadata: { connection_type: "meta_ad_account" },
      is_active: true
    },
    {
      provider: "ga4",
      account_id: "ga4_default",
      account_name: "GA",
      metadata: { property_name: "MetricsFlo Property" },
      is_active: true
    },
    {
      provider: "salla",
      account_id: "salla_default",
      account_name: "Salla Store",
      is_active: true
    }
  ]);

  assert.equal(status.meta.connected, true);
  assert.deepEqual(status.meta.accounts, [
    { id: "act_123", name: "Main Meta", currency: "SAR" }
  ]);
  assert.equal(status.ga4.property_name, "MetricsFlo Property");
  assert.equal(status.salla.store_name, "Salla Store");
  assert.equal(JSON.stringify(status).includes("must-not-leak"), false);
});

test("inactive and default provider records are not shown as ad accounts", () => {
  const status = buildConnectionStatus([
    {
      provider: "meta",
      account_id: "meta_default",
      account_name: "Meta",
      is_active: true
    },
    {
      provider: "snapchat",
      account_id: "snapchat_default",
      account_name: "Snapchat",
      is_active: false
    }
  ]);

  assert.equal(status.meta.connected, true);
  assert.deepEqual(status.meta.accounts, []);
  assert.equal(status.snapchat.connected, false);
});
