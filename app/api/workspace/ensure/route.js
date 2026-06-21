import { NextResponse } from "next/server";
import { ensureDefaultWorkspace } from "../../../../lib/workspace";

export const dynamic = "force-dynamic";

async function handler(request) {
  try {
    const { user, workspace, created } = await ensureDefaultWorkspace(request);

    return NextResponse.json({
      success: true,
      created,
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
        error: error.message || "Failed to ensure workspace"
      },
      {
        status: error.status || 500
      }
    );
  }
}

export async function GET(request) {
  return handler(request);
}

export async function POST(request) {
  return handler(request);
}
