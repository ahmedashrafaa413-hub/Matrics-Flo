import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const BASE = "https://adsapi.snapchat.com/v1";

async function snap(path, token) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  return res.json();
}

export async function GET() {
  const token = cookies().get("snapchat_token")?.value;
  if (!token) {
    return NextResponse.json({ success: false, error: "Not connected to Snapchat" }, { status: 401 });
  }

  try {
    const orgsData = await snap("/me/organizations", token);
    const orgs     = orgsData.organizations || [];

    if (!orgs.length) {
      return NextResponse.json({ success: false, error: "No organizations found" }, { status: 404 });
    }

    const accountsResults = await Promise.all(
      orgs.map(org => snap(`/organizations/${org.organization.id}/adaccounts`, token))
    );

    const accounts = accountsResults
      .flatMap(res => res.adaccounts || [])
      .map(a => ({
        id:       a.adaccount.id,
        name:     a.adaccount.name,
        currency: a.adaccount.currency,
        org_id:   a.adaccount.organization_id,
        status:   a.adaccount.status,
        timezone: a.adaccount.timezone,
      }));

    return NextResponse.json({ success: true, data: accounts });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
