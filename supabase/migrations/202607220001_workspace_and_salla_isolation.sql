-- Security hotfix: make workspace membership server-managed and isolate Salla
-- order identities by workspace. This migration intentionally preserves the
-- single legacy `default_user` order that predates workspaces.

-- Browser clients may read only their own membership. Membership creation,
-- role changes and deletion are performed through trusted server routes using
-- the service role after application-level authorization.
drop policy if exists "Users can insert own membership" on public.workspace_members;
drop policy if exists "Users can view own memberships" on public.workspace_members;
drop policy if exists "member access" on public.workspace_members;

create policy "users_read_own_membership"
on public.workspace_members
for select
to authenticated
using ((select auth.uid()) = user_id);

revoke insert, update, delete on public.workspace_members from anon, authenticated;
grant select on public.workspace_members to authenticated;

-- Workspaces are readable by their owner or an existing member. All writes are
-- server-managed so a member cannot promote themselves or rewrite tenant data.
drop policy if exists "Users can insert own workspace" on public.workspaces;
drop policy if exists "Users can view own workspaces" on public.workspaces;
drop policy if exists "member access" on public.workspaces;

create policy "members_read_workspace"
on public.workspaces
for select
to authenticated
using (
  owner_id = (select auth.uid())
  or exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = workspaces.id
      and wm.user_id = (select auth.uid())
  )
);

revoke insert, update, delete on public.workspaces from anon, authenticated;
grant select on public.workspaces to authenticated;

-- Organization records are also server-managed. Keep owner read access only.
drop policy if exists "owner access" on public.organizations;

create policy "owners_read_organization"
on public.organizations
for select
to authenticated
using (
  owner_id = (select auth.uid())
  or owner_user_id = (select auth.uid())
);

revoke insert, update, delete on public.organizations from anon, authenticated;
grant select on public.organizations to authenticated;

-- New Salla rows use workspace_id as the tenant identity. PostgreSQL allows
-- the preserved legacy NULL workspace row while enforcing uniqueness for all
-- current workspace-scoped records.
alter table public.salla_orders
  drop constraint if exists salla_orders_user_order_unique;

alter table public.salla_orders
  drop constraint if exists salla_orders_user_id_order_id_key;

alter table public.salla_orders
  add constraint salla_orders_workspace_order_unique
  unique (workspace_id, order_id);

create index if not exists idx_salla_orders_workspace_order_date
on public.salla_orders (workspace_id, order_date);
