export function requireWorkspaceScope(workspaceId) {
  if (!workspaceId || typeof workspaceId !== "string") {
    const error = new Error("Workspace scope is required");
    error.status = 403;
    throw error;
  }

  return workspaceId;
}

export function selectAuthorizedWorkspace(workspaces, ...preferredIds) {
  const allowed = Array.isArray(workspaces)
    ? workspaces.filter((workspace) => workspace?.id)
    : [];

  for (const preferredId of preferredIds) {
    if (!preferredId) continue;
    const match = allowed.find((workspace) => workspace.id === preferredId);
    if (match) return match;
  }

  return allowed[0] || null;
}

export const WORKSPACE_ROLE_RANK = Object.freeze({
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3
});

export function hasWorkspaceRole(role, minimumRole) {
  const actual = WORKSPACE_ROLE_RANK[role];
  const required = WORKSPACE_ROLE_RANK[minimumRole];

  if (required === undefined) {
    throw new Error(`Unknown workspace role: ${minimumRole}`);
  }

  return actual !== undefined && actual >= required;
}

export function requireWorkspaceRole(workspace, minimumRole) {
  requireWorkspaceScope(workspace?.id);

  if (!hasWorkspaceRole(workspace?.role, minimumRole)) {
    const error = new Error(
      `This action requires the ${minimumRole} role in this workspace`
    );
    error.status = 403;
    throw error;
  }

  return workspace;
}

export function assertSameWorkspace(expectedWorkspaceId, resourceWorkspaceId) {
  requireWorkspaceScope(expectedWorkspaceId);

  if (expectedWorkspaceId !== resourceWorkspaceId) {
    const error = new Error("Cross-workspace access denied");
    error.status = 403;
    throw error;
  }

  return true;
}
