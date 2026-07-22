import test from "node:test";
import assert from "node:assert/strict";
import {
  assertSameWorkspace,
  requireWorkspaceScope,
  selectAuthorizedWorkspace
} from "../lib/tenantFoundation.mjs";

const workspaceA = { id: "workspace-a", name: "A" };
const workspaceB = { id: "workspace-b", name: "B" };

test("an untrusted workspace cookie cannot select another tenant", () => {
  assert.equal(
    selectAuthorizedWorkspace([workspaceA], "workspace-b"),
    workspaceA
  );
});

test("a user may select only a workspace in their membership list", () => {
  assert.equal(
    selectAuthorizedWorkspace([workspaceA, workspaceB], "workspace-b"),
    workspaceB
  );
});

test("empty memberships never resolve a workspace", () => {
  assert.equal(selectAuthorizedWorkspace([], "workspace-a"), null);
});

test("connection mutations require an explicit workspace scope", () => {
  assert.equal(requireWorkspaceScope("workspace-a"), "workspace-a");
  assert.throws(() => requireWorkspaceScope(""), /Workspace scope is required/);
});

test("cross-workspace resources are rejected", () => {
  assert.equal(assertSameWorkspace("workspace-a", "workspace-a"), true);
  assert.throws(
    () => assertSameWorkspace("workspace-a", "workspace-b"),
    /Cross-workspace access denied/
  );
});
