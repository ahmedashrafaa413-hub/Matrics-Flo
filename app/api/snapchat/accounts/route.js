import { NextResponse } from "next/server";
import { getSnapchatToken } from "../../../../lib/snapchatToken";

export const dynamic = "force-dynamic";

const SNAPCHAT_API_BASE = "https://adsapi.snapchat.com/v1";

function jsonResponse(payload, status = 200) {
  return NextResponse.json(payload, { status });
}

async function snapFetch(path, token) {
  const url = `${SNAPCHAT_API_BASE}${path}`;

  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json"
    }
  });

  const text = await response.text();

  let data = null;

  try {
    data = JSON.parse(text);
  } catch {
    return {
      ok: false,
      status: response.status,
      data: null,
      error: `Snapchat API did not return JSON. Response starts with: ${text.slice(
        0,
        120
      )}`
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      data,
      error:
        data?.request_status ||
        data?.debug_message ||
        data?.message ||
        `Snapchat API request failed: ${response.status}`
    };
  }

  return {
    ok: true,
    status: response.status,
    data,
    error: null
  };
}

function extractOrganizations(data) {
  const organizations = data?.organizations || data?.organization || [];

  if (!Array.isArray(organizations)) return [];

  return organizations
    .map((item) => item?.organization || item)
    .filter((org) => org?.id);
}

function extractAdAccounts(data) {
  const adaccounts =
    data?.adaccounts || data?.ad_accounts || data?.accounts || [];

  if (!Array.isArray(adaccounts)) return [];

  return adaccounts
    .map((item) => item?.adaccount || item?.ad_account || item?.account || item)
    .filter((account) => account?.id);
}

function normalizeAccount(account, organizationId = "") {
  return {
    id: account.id,
    name: account.name || account.account_name || "Snapchat Account",
    currency: account.currency || account.account_currency || "USD",
    org_id: account.organization_id || organizationId,
    status: account.status || account.account_status || "UNKNOWN",
    timezone: account.timezone || "Asia/Riyadh"
  };
}

export async function GET() {
  try {
    const token = await getSnapchatToken();

    if (!token) {
      return jsonResponse(
        {
          success: false,
          error: "Missing Snapchat access token. Please reconnect Snapchat.",
          data: [],
          accounts: []
        },
        401
      );
    }

    const orgsResult = await snapFetch("/me/organizations", token);

    if (!orgsResult.ok) {
      return jsonResponse(
        {
          success: false,
          error: orgsResult.error,
          status: orgsResult.status,
          data: [],
          accounts: []
        },
        orgsResult.status || 500
      );
    }

    const organizations = extractOrganizations(orgsResult.data);

    if (!organizations.length) {
      return jsonResponse({
        success: true,
        provider: "Snapchat Ads",
        warning: "No Snapchat organizations found for this token.",
        data: [],
        accounts: []
      });
    }

    const allAccounts = [];
    const errors = [];

    for (const org of organizations) {
      const accountsResult = await snapFetch(
        `/organizations/${encodeURIComponent(org.id)}/adaccounts`,
        token
      );

      if (!accountsResult.ok) {
        errors.push({
          organization_id: org.id,
          status: accountsResult.status,
          error: accountsResult.error
        });
        continue;
      }

      const accounts = extractAdAccounts(accountsResult.data).map((account) =>
        normalizeAccount(account, org.id)
      );

      allAccounts.push(...accounts);
    }

    const uniqueAccounts = Array.from(
      new Map(allAccounts.map((account) => [account.id, account])).values()
    );

    return jsonResponse({
      success: true,
      provider: "Snapchat Ads",
      organizations: organizations.map((org) => ({
        id: org.id,
        name: org.name || org.organization_name || "Organization"
      })),
      count: uniqueAccounts.length,
      data: uniqueAccounts,
      accounts: uniqueAccounts,
      errors
    });
  } catch (error) {
    return jsonResponse(
      {
        success: false,
        error: error.message || "Failed to load Snapchat accounts",
        data: [],
        accounts: []
      },
      500
    );
  }
}
