import { cookies } from "next/headers";
import { createSupabaseAdminClient } from "./supabaseServer";
import { requireUser } from "./serverAuth";

const ACTIVE_WORKSPACE_COOKIE = "metricsflo_active_workspace";

function slugify(value) {
  return String(value || "workspace")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function getActiveWorkspaceCookie() {
  return cookies().get(ACTIVE_WORKSPACE_COOKIE)?.value || "";
}

export function setActiveWorkspaceCookie(workspaceId) {
  cookies().set(ACTIVE_WORKSPACE_COOKIE, workspaceId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365
  });
}

export async function userHasWorkspaceAccess(userId, workspaceId) {
  if (!userId || !workspaceId) return false;

  const admin = createSupabaseAdminClient();

  const { data, error } = await admin
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return false;

  return Boolean(data?.id);
}

export async function getUserWorkspaces(userId) {
  const admin = createSupabaseAdminClient();

  const { data, error } = await admin
    .from("workspace_members")
    .select(
      `
      role,
      workspace:workspaces (
        id,
        name,
        slug,
        default_currency,
        timezone,
        organization_id,
        created_at
      )
    `
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data || [])
    .map((item) => ({
      ...item.workspace,
      role: item.role
    }))
    .filter(Boolean);
}

export async function ensureDefaultWorkspace() {
  const user = await requireUser();
  const admin = createSupabaseAdminClient();

  const currentWorkspaces = await getUserWorkspaces(user.id);

  if (currentWorkspaces.length > 0) {
    const activeCookie = getActiveWorkspaceCookie();

    const activeWorkspace =
      currentWorkspaces.find((workspace) => workspace.id === activeCookie) ||
      currentWorkspaces[0];

    setActiveWorkspaceCookie(activeWorkspace.id);

    await admin.from("user_preferences").upsert({
      user_id: user.id,
      active_workspace_id: activeWorkspace.id
    });

    return {
      user,
      workspace: activeWorkspace,
      created: false
    };
  }

  const organizationName =
    user.user_metadata?.company_name ||
    user.user_metadata?.full_name ||
    user.email?.split("@")[0] ||
    "My Organization";

  const { data: organization, error: orgError } = await admin
    .from("organizations")
    .insert({
      name: organizationName,
      owner_user_id: user.id
    })
    .select("*")
    .single();

  if (orgError) {
    throw new Error(orgError.message);
  }

  const workspaceName = "Default Workspace";

  const { data: workspace, error: workspaceError } = await admin
    .from("workspaces")
    .insert({
      organization_id: organization.id,
      name: workspaceName,
      slug: slugify(workspaceName),
      default_currency: "SAR",
      timezone: "Asia/Riyadh",
      created_by: user.id
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

  await admin.from("user_preferences").upsert({
    user_id: user.id,
    active_workspace_id: workspace.id
  });

  setActiveWorkspaceCookie(workspace.id);

  return {
    user,
    workspace: {
      ...workspace,
      role: "owner"
    },
    created: true
  };
}

export async function getActiveWorkspace() {
  const user = await requireUser();
  const admin = createSupabaseAdminClient();
  const workspaces = await getUserWorkspaces(user.id);

  if (workspaces.length === 0) {
    return ensureDefaultWorkspace();
  }

  const cookieWorkspaceId = getActiveWorkspaceCookie();

  const { data: preference } = await admin
    .from("user_preferences")
    .select("active_workspace_id")
    .eq("user_id", user.id)
    .maybeSingle();

  const preferredWorkspaceId =
    cookieWorkspaceId || preference?.active_workspace_id || "";

  const workspace =
    workspaces.find((item) => item.id === preferredWorkspaceId) || workspaces[0];

  setActiveWorkspaceCookie(workspace.id);

  if (preference?.active_workspace_id !== workspace.id) {
    await admin.from("user_preferences").upsert({
      user_id: user.id,
      active_workspace_id: workspace.id
    });
  }

  return {
    user,
    workspace,
    created: false
  };
}

export async function requireWorkspace() {
  const result = await getActiveWorkspace();

  if (!result?.workspace?.id) {
    const error = new Error("No active workspace found");
    error.status = 403;
    throw error;
  }

  return result;
}
