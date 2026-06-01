import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !anonKey || !serviceKey) {
    return NextResponse.json(
      { success: false, error: "Missing Supabase environment variables" },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "");

  if (!token) {
    return NextResponse.json(
      { success: false, error: "Missing auth token" },
      { status: 401 }
    );
  }

  const authClient = createClient(supabaseUrl, anonKey);
  const adminClient = createClient(supabaseUrl, serviceKey);

  const {
    data: { user },
    error: userError
  } = await authClient.auth.getUser(token);

  if (userError || !user) {
    return NextResponse.json(
      { success: false, error: "Invalid user session" },
      { status: 401 }
    );
  }

  const { data: existingWorkspace } = await adminClient
    .from("workspaces")
    .select("*")
    .eq("owner_id", user.id)
    .maybeSingle();

  if (existingWorkspace) {
    return NextResponse.json({
      success: true,
      workspace: existingWorkspace
    });
  }

  const { data: workspace, error: workspaceError } = await adminClient
    .from("workspaces")
    .insert({
      owner_id: user.id,
      name: `${user.email} Workspace`
    })
    .select()
    .single();

  if (workspaceError) {
    return NextResponse.json(
      { success: false, error: workspaceError.message },
      { status: 400 }
    );
  }

  await adminClient.from("workspace_members").insert({
    workspace_id: workspace.id,
    user_id: user.id,
    role: "owner"
  });

  return NextResponse.json({
    success: true,
    workspace
  });
}
