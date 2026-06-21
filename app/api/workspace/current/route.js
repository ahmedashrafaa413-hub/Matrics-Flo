import { NextResponse } from "next/server";
import { getActiveWorkspace } from "../../../../lib/workspace";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { user, workspace } = await getActiveWorkspace();

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email
      },
      workspace
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Failed to load active workspace"
      },
      {
        status: error.status || 500
      }
    );
  }
}
