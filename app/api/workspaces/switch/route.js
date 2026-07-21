import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "../../../../lib/supabaseServer";
import { requireUser } from "../../../../lib/serverAuth";
import {
  setActiveWorkspaceCookie,
  userHasWorkspaceAccess
} from "../../../../lib/workspace";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const user = await requireUser(request);
    const body = await request.json().catch(() => ({}));

    const workspaceId = body.workspace_id || body.workspaceId || "";

    if (!workspaceId) {
      return NextResponse.json(
        {
          success: false,
          error: "workspace_id is required"
        },
        {
          status: 400
        }
      );
    }

    const hasAccess = await userHasWorkspaceAccess(user.id, workspaceId);

    if (!hasAccess) {
      return NextResponse.json(
        {
          success: false,
          error: "You do not have access to this workspace"
        },
        {
          status: 403
        }
      );
    }

    const admin = createSupabaseAdminClient();

    const { error: preferenceError } = await admin.from("user_sessions").upsert(
      {
        user_id: user.id,
        active_workspace_id: workspaceId
      },
      { onConflict: "user_id" }
    );

    if (preferenceError) {
      throw new Error(preferenceError.message);
    }

    setActiveWorkspaceCookie(workspaceId);

    return NextResponse.json({
      success: true,
      active_workspace_id: workspaceId
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Failed to switch workspace"
      },
      {
        status: error.status || 500
      }
    );
  }
}
