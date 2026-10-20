import { NextResponse } from "next/server";
import { getPlatformConnection } from "../../../../lib/platformConnections";
import { getTikTokReport, summarizeTikTokRows } from "../../../../lib/tiktokApi.mjs";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const accountId = url.searchParams.get("account_id") || "";
    if (!accountId) return NextResponse.json({ success:false, error:"account_id is required" }, { status:400 });
    const [{ connection:account }, { connection:master }] = await Promise.all([
      getPlatformConnection({ request, provider:"tiktok", accountId }),
      getPlatformConnection({ request, provider:"tiktok", accountId:"tiktok_default" })
    ]);
    const level = url.searchParams.get("level") === "account" ? "account" : "campaign";
    const rows = await getTikTokReport({
      token:master.access_token, advertiserId:accountId,
      datePreset:url.searchParams.get("date_preset") || "last_30d", level,
      currency:account.account_currency || "SAR"
    });
    return NextResponse.json({ success:true, account_id:accountId, rows,
      summary:summarizeTikTokRows(rows, account.account_currency || "SAR") });
  } catch (error) {
    return NextResponse.json({ success:false, error:error.message || "TikTok data unavailable" }, { status:error.status || 500 });
  }
}
