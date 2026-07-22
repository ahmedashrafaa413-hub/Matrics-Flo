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

export function assertSameWorkspace(expectedWorkspaceId, resourceWorkspaceId) {
  requireWorkspaceScope(expectedWorkspaceId);

  if (expectedWorkspaceId !== resourceWorkspaceId) {
    const error = new Error("Cross-workspace access denied");
    error.status = 403;
    throw error;
  }

  return true;
}
