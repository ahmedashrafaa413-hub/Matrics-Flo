import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function getSupabase() {
  const cookieStore = cookies();
  const token = cookieStore.get("sb-access-token")?.value;
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
  return supabase;
}

// GET /api/workspaces — list all workspaces for current user
export async function GET() {
  const supabase = getSupabase();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  // Get workspaces where user is a member
  const { data: memberships, error } = await supabase
    .from("workspace_members")
    .select(`
      role,
      workspace:workspaces (
        id, name, client_name, created_at,
        org:organizations ( id, name, plan )
      )
    `)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  // Get active workspace from session
  const { data: session } = await supabase
    .from("user_sessions")
    .select("active_workspace_id")
    .eq("user_id", user.id)
    .single();

  const workspaces = (memberships || []).map(m => ({
    ...m.workspace,
    role: m.role,
    is_active: m.workspace?.id === session?.active_workspace_id
  }));

  return NextResponse.json({
    success: true,
    workspaces,
    active_workspace_id: session?.active_workspace_id || workspaces[0]?.id || null
  });
}

// POST /api/workspaces — create new workspace
export async function POST(request) {
  const supabase = getSupabase();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { name, client_name, org_id } = await request.json();
  if (!name) {
    return NextResponse.json({ success: false, error: "name is required" }, { status: 400 });
  }

  let organizationId = org_id;

  // If no org_id, create a new organization
  if (!organizationId) {
    const { data: org, error: orgError } = await supabase
      .from("organizations")
      .insert({ name: name + " Org", owner_id: user.id })
      .select()
      .single();

    if (orgError) {
      return NextResponse.json({ success: false, error: orgError.message }, { status: 500 });
    }
    organizationId = org.id;
  }

  // Create workspace
  const { data: workspace, error: wsError } = await supabase
    .from("workspaces")
    .insert({ name, client_name, org_id: organizationId })
    .select()
    .single();

  if (wsError) {
    return NextResponse.json({ success: false, error: wsError.message }, { status: 500 });
  }

  // Add creator as admin
  await supabase.from("workspace_members").insert({
    workspace_id: workspace.id,
    user_id: user.id,
    role: "admin"
  });

  // Set as active workspace
  await supabase.from("user_sessions").upsert({
    user_id: user.id,
    active_workspace_id: workspace.id,
    updated_at: new Date().toISOString()
  }, { onConflict: "user_id" });

  return NextResponse.json({ success: true, workspace });
}
