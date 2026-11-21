import test from "node:test";
import assert from "node:assert/strict";
import { buildExtendedMetrics, EXTENDED_FIELDS } from "../lib/snapchatExtendedMetrics.mjs";

test("requests a broad, duplicate-free field list without the core fields", () => {
  assert.equal(new Set(EXTENDED_FIELDS).size, EXTENDED_FIELDS.length);
  for (const core of ["impressions", "swipes", "spend", "conversion_purchases", "quartile_1", "screen_time_millis"]) {
    assert.ok(!EXTENDED_FIELDS.includes(core), core);
  }
  for (const f of ["video_views", "video_views_15s", "uniques", "frequency", "landing_page_views", "conversion_sign_ups", "conversion_add_cart_value"]) {
    assert.ok(EXTENDED_FIELDS.includes(f), f);
  }
});

test("converts units, drops zeros and derives rates", () => {
  const m = buildExtendedMetrics({
    impressions: 1000, swipes: 50, spend: 20_000_000, screen_time_millis: 1_500_000,
    video_views: 400, video_views_15s: 100, landing_page_views: 25,
    uniques: 700, frequency: 1.4286, conversion_add_cart_value: 33_500_000, coupon_used_local: 0, conversion_sign_ups: 0
  });
  assert.equal(m.video_views, 400);
  assert.equal(m.reach, 700);
  assert.equal(m.frequency, 1.43);
  assert.equal(m.conversion_add_cart_value, 33.5);
  assert.equal(m.video_view_rate, 40);
  assert.equal(m.cost_per_video_view, 0.05);
  assert.equal(m.view_rate_15s, 10);
  assert.equal(m.avg_screen_time_sec, 1.5);
  assert.equal(m.landing_page_view_rate, 50);
  assert.ok(!("coupon_used" in m));
  assert.ok(!("conversion_sign_ups" in m));
});

test("summed totals leave out reach and frequency", () => {
  const m = buildExtendedMetrics({ impressions: 10, uniques: 8, frequency: 1.25, video_views: 3 }, { summed: true });
  assert.equal(m.video_views, 3);
  assert.ok(!("reach" in m) && !("frequency" in m));
});
