import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const cookieStore = cookies();
  const token = cookieStore.get("sb-access-token")?.value;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { workspace_id } = await request.json();
  if (!workspace_id) {
    return NextResponse.json({ success: false, error: "workspace_id is required" }, { status: 400 });
  }

  // Verify user is a member of this workspace
  const { data: member } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspace_id)
    .eq("user_id", user.id)
    .single();

  if (!member) {
    return NextResponse.json({ success: false, error: "Access denied" }, { status: 403 });
  }

  // Update active workspace
  const { error } = await supabase
    .from("user_sessions")
    .upsert({
      user_id: user.id,
      active_workspace_id: workspace_id,
      updated_at: new Date().toISOString()
    }, { onConflict: "user_id" });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  // Clear Meta token cookie so new workspace starts fresh
  const response = NextResponse.json({ success: true, workspace_id, role: member.role });
  response.cookies.delete("primary_meta_account");

  return response;
}
