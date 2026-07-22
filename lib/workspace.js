import { cookies } from "next/headers";
import { createSupabaseAdminClient } from "./supabaseServer";
import { requireUser } from "./serverAuth";
import { selectAuthorizedWorkspace } from "./tenantFoundation.mjs";

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

async function saveActiveWorkspace(admin, userId, workspaceId) {
  const { error } = await admin.from("user_sessions").upsert(
    {
      user_id: userId,
      active_workspace_id: workspaceId
    },
    { onConflict: "user_id" }
  );

  if (error) throw new Error(error.message);
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
    .eq("user_id", userId);

  if (error) {
    throw new Error(error.message);
  }

  return (data || [])
    .map((item) => ({
      ...(item.workspace || {}),
      role: item.role
    }))
    .filter((workspace) => workspace.id);
}

export async function ensureDefaultWorkspace(request) {
  const user = await requireUser(request);
  const admin = createSupabaseAdminClient();

  const currentWorkspaces = await getUserWorkspaces(user.id);

  if (currentWorkspaces.length > 0) {
    const cookieWorkspaceId = getActiveWorkspaceCookie();

    const activeWorkspace = selectAuthorizedWorkspace(
      currentWorkspaces,
      cookieWorkspaceId
    );

    setActiveWorkspaceCookie(activeWorkspace.id);

    await saveActiveWorkspace(admin, user.id, activeWorkspace.id);

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

  const { data: organization, error: organizationError } = await admin
    .from("organizations")
    .insert({
      name: organizationName,
      owner_id: user.id,
      owner_user_id: user.id
    })
    .select("*")
    .single();

  if (organizationError) {
    throw new Error(organizationError.message);
  }

  const workspaceName = "Default Workspace";

  const { data: workspace, error: workspaceError } = await admin
    .from("workspaces")
    .insert({
      organization_id: organization.id,
      owner_id: user.id,
      created_by: user.id,
      name: workspaceName,
      slug: slugify(workspaceName),
      default_currency: "SAR",
      timezone: "Asia/Riyadh"
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

  await saveActiveWorkspace(admin, user.id, workspace.id);

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

export async function getActiveWorkspace(request) {
  const user = await requireUser(request);
  const admin = createSupabaseAdminClient();

  const workspaces = await getUserWorkspaces(user.id);

  if (workspaces.length === 0) {
    return ensureDefaultWorkspace(request);
  }

  const cookieWorkspaceId = getActiveWorkspaceCookie();

  // The signed-in user's membership list is the authorization boundary. When
  // the cookie points to one of those workspaces, it is safe to return it
  // immediately instead of reading and rewriting user_sessions on every API
  // request.
  const cookieWorkspace = workspaces.find(
    (workspace) => workspace.id === cookieWorkspaceId
  );

  if (cookieWorkspace) {
    return {
      user,
      workspace: cookieWorkspace,
      created: false
    };
  }

  const { data: preference, error: preferenceError } = await admin
    .from("user_sessions")
    .select("active_workspace_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (preferenceError) throw new Error(preferenceError.message);

  const preferredWorkspaceId = preference?.active_workspace_id || "";

  const workspace = selectAuthorizedWorkspace(
    workspaces,
    preferredWorkspaceId
  );

  setActiveWorkspaceCookie(workspace.id);

  if (preference?.active_workspace_id !== workspace.id) {
    await saveActiveWorkspace(admin, user.id, workspace.id);
  }

  return {
    user,
    workspace,
    created: false
  };
}
