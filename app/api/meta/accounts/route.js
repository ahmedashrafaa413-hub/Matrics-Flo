import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const queryToken = searchParams.get("token");
  const cookieToken = cookies().get("meta_token")?.value;
  const token = queryToken || cookieToken;

  if (!token) {
    return NextResponse.json(
      { success: false, error: "Not connected to Meta" },
      { status: 401 }
    );
  }

  const url =
    "https://graph.facebook.com/v19.0/me/adaccounts" +
    "?fields=id,name,account_status,currency" +
    `&access_token=${encodeURIComponent(token)}`;

  const response = await fetch(url, { cache: "no-store" });
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
}
