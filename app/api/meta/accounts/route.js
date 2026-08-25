import { NextResponse } from "next/server";
import { getMetaToken } from "../../../../lib/metaToken";
import { buildMetaGraphUrl, fetchMetaCollection } from "../../../../lib/metaApi.mjs";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const token = await getMetaToken(request);

    if (!token) {
      return NextResponse.json(
        { success: false, error: "Not connected to Meta" },
        { status: 401 }
      );
    }

    const url = buildMetaGraphUrl("me/adaccounts", {
      fields: "id,name,account_status,currency",
      limit: 500
    });
    const result = await fetchMetaCollection({ url, token });

    return NextResponse.json({
      success: true,
      provider: "Meta Ads",
      data: result.data,
      pages_loaded: result.pages
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message || "Failed to load Meta accounts" },
      { status: error.status || 500 }
    );
  }
}
