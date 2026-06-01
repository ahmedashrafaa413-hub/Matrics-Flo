import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);

  const code = searchParams.get("code");

  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;

  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL;

  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const supabaseServiceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  return NextResponse.json({
    codeReceived: !!code,

    META_APP_ID: !!appId,
    META_APP_SECRET: !!appSecret,

    NEXT_PUBLIC_APP_URL:
      !!process.env.NEXT_PUBLIC_APP_URL,

    APP_URL:
      !!process.env.APP_URL,

    NEXT_PUBLIC_SUPABASE_URL:
      !!supabaseUrl,

    NEXT_PUBLIC_SUPABASE_ANON_KEY:
      !!supabaseAnonKey,

    SUPABASE_SERVICE_ROLE_KEY:
      !!supabaseServiceKey,
  });
}
