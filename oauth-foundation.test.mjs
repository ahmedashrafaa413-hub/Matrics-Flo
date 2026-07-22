import test from "node:test";
import assert from "node:assert/strict";
import {
  getAppUrl,
  getRequiredEnv,
  oauthStateCookie,
  verifyOAuthState
} from "../lib/oauthFoundation.mjs";

test("canonical app URL uses SITE_URL and removes trailing slash", () => {
  const request = { url: "https://preview.example/api/test" };
  assert.equal(
    getAppUrl(request, { NEXT_PUBLIC_SITE_URL: "https://www.metricsflo.com/" }),
    "https://www.metricsflo.com"
  );
});

test("required OAuth environment variables fail explicitly", () => {
  assert.throws(
    () => getRequiredEnv(["CLIENT_ID", "CLIENT_SECRET"], { CLIENT_ID: "id" }),
    /CLIENT_SECRET/
  );
});

test("OAuth state must match the provider cookie", () => {
  const request = {
    cookies: {
      get(name) {
        return name === oauthStateCookie("ga") ? { value: "expected" } : undefined;
      }
    }
  };

  assert.equal(verifyOAuthState(request, "ga", "expected"), true);
  assert.equal(verifyOAuthState(request, "ga", "wrong"), false);
  assert.equal(verifyOAuthState(request, "meta", "expected"), false);
});
