import { NextResponse } from "next/server";
import { getMetaToken } from "../../../../lib/metaToken";

export const dynamic = "force-dynamic";

const GRAPH_VERSION = "v19.0";

export async function GET(request) {
  try {
    const token = await getMetaToken(request);

    if (!token) {
      return NextResponse.json(
        { success: false, error: "Not connected to Meta" },
        { status: 401 }
      );
    }

    const url =
      `https://graph.facebook.com/${GRAPH_VERSION}/me/adaccounts` +
      "?fields=id,name,account_status,currency";

    const response = await fetch(url, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await response.json();

    if (data.error) {
      return NextResponse.json(
        { success: false, error: data.error },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      provider: "Meta Ads",
      data: data.data || []
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message || "Failed to load Meta accounts" },
      { status: error.status || 500 }
    );
  }
}
