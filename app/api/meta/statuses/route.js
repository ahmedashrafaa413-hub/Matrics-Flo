import { NextResponse } from "next/server";
import { getMetaToken } from "../../../../lib/metaToken";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);

  const token     = searchParams.get("token") || (await getMetaToken(request));
  const accountId = searchParams.get("account_id");
  const level     = searchParams.get("level") || "campaign";

  if (!token) {
    return NextResponse.json({ success: false, error: "Not connected to Meta" }, { status: 401 });
  }
  if (!accountId) {
    return NextResponse.json({ success: false, error: "account_id is required" }, { status: 400 });
  }

  const endpointMap = {
    campaign: `${accountId}/campaigns`,
    adset:    `${accountId}/adsets`,
    ad:       `${accountId}/ads`,
  };

  const endpoint = endpointMap[level];
  if (!endpoint) {
    return NextResponse.json({ success: false, error: "Invalid level" }, { status: 400 });
  }

  const params = new URLSearchParams({
    fields:       "id,name,status,effective_status",
    limit:        "500",
    access_token: token
  });

  const url = `https://graph.facebook.com/v19.0/${endpoint}?${params}`;

  try {
    const res  = await fetch(url, { cache: "no-store" });
    const data = await res.json();

    if (data.error) {
      return NextResponse.json({ success: false, error: data.error }, { status: 400 });
    }

    // Return a flat map: { [id]: { status, effective_status } }
    const statusMap = {};
    for (const item of data.data || []) {
      statusMap[item.id] = {
        status:           item.status,
        effective_status: item.effective_status
      };
    }

    return NextResponse.json({ success: true, level, statusMap });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
