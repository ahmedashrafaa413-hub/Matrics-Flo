import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "../../../lib/supabaseServer";
import { requireUser } from "../../../lib/serverAuth";
import {
  getActiveWorkspace,
  getUserWorkspaces,
  setActiveWorkspaceCookie
} from "../../../lib/workspace";

export const dynamic = "force-dynamic";

function slugify(value) {
  return String(value || "workspace")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export async function GET(request) {
  try {
    const { user, workspace } = await getActiveWorkspace(request);
    const workspaces = await getUserWorkspaces(user.id);

    return NextResponse.json({
      success: true,
      active_workspace_id: workspace.id,
      workspaces
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Failed to load workspaces"
      },
      {
        status: error.status || 500
      }
    );
  }
}

export async function POST(request) {
  try {
    const user = await requireUser(request);
    const admin = createSupabaseAdminClient();
    const body = await request.json().catch(() => ({}));

    const name = String(body.name || "").trim();
    const defaultCurrency = String(body.default_currency || "SAR").toUpperCase();
    const timezone = String(body.timezone || "Asia/Riyadh");

    if (!name) {
      return NextResponse.json(
        {
          success: false,
          error: "Workspace name is required"
        },
        {
          status: 400
        }
      );
    }

    let organizationId = body.organization_id || "";

    const workspaces = await getUserWorkspaces(user.id);
    const accessibleOrganizationIds = new Set(
      workspaces.map((workspace) => workspace.organization_id).filter(Boolean)
    );

    if (organizationId && !accessibleOrganizationIds.has(organizationId)) {
      const { data: ownedOrganization, error: organizationAccessError } = await admin
        .from("organizations")
        .select("id")
        .eq("id", organizationId)
        .eq("owner_user_id", user.id)
        .maybeSingle();

      if (organizationAccessError) {
        throw new Error(organizationAccessError.message);
      }

      if (!ownedOrganization) {
        return NextResponse.json(
          {
            success: false,
            error: "You do not have access to this organization"
          },
          { status: 403 }
        );
      }
    }

    if (!organizationId) {
      organizationId = workspaces?.[0]?.organization_id || "";
    }

    if (!organizationId) {
      const { data: organization, error: organizationError } = await admin
        .from("organizations")
        .insert({
          name: user.user_metadata?.company_name || "My Organization",
          owner_id: user.id,
          owner_user_id: user.id
        })
        .select("*")
        .single();

      if (organizationError) {
        throw new Error(organizationError.message);
      }

      organizationId = organization.id;
    }

    const { data: workspace, error: workspaceError } = await admin
      .from("workspaces")
      .insert({
        organization_id: organizationId,
        owner_id: user.id,
        created_by: user.id,
        name,
        slug: slugify(name),
        default_currency: defaultCurrency,
        timezone
      })
      .select("*")
      .single();

    if (workspaceError) {
      throw new Error(workspaceError.message);
    }

    const { error: memberError } = await admin.from("workspace_members").insert({
      workspace_id: workspace.id,
      user_id: user.id,
      role: "owner"
    });

    if (memberError) {
      throw new Error(memberError.message);
    }

    const { error: preferenceError } = await admin.from("user_sessions").upsert(
      {
        user_id: user.id,
        active_workspace_id: workspace.id
      },
      { onConflict: "user_id" }
    );

    if (preferenceError) {
      throw new Error(preferenceError.message);
    }

    setActiveWorkspaceCookie(workspace.id);

    return NextResponse.json({
      success: true,
      workspace: {
        ...workspace,
        role: "owner"
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Failed to create workspace"
      },
      {
        status: error.status || 500
      }
    );
  }
}
