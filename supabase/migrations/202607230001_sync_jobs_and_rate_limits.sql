-- Background synchronization state and atomic API rate limiting.
-- Both tables are server-only: browser roles have no grants or policies.

create table if not exists public.provider_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  provider text not null check (provider in ('snapchat', 'salla')),
  account_id text,
  request_key text not null,
  request_params jsonb not null default '{}'::jsonb,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed')),
  progress integer not null default 0 check (progress between 0 and 100),
  run_id text,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.provider_sync_jobs enable row level security;
revoke all on table public.provider_sync_jobs from anon, authenticated;
grant all on table public.provider_sync_jobs to service_role;

create index if not exists idx_provider_sync_jobs_workspace_created
  on public.provider_sync_jobs (workspace_id, created_at desc);

create index if not exists idx_provider_sync_jobs_status_created
  on public.provider_sync_jobs (status, created_at);

create unique index if not exists provider_sync_jobs_one_active_request
  on public.provider_sync_jobs (workspace_id, request_key)
  where status in ('queued', 'running');

create table if not exists public.api_rate_limits (
  key_hash text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 1,
  expires_at timestamptz not null,
  primary key (key_hash, window_started_at)
);

alter table public.api_rate_limits enable row level security;
revoke all on table public.api_rate_limits from anon, authenticated;
grant all on table public.api_rate_limits to service_role;

create index if not exists idx_api_rate_limits_expires_at
  on public.api_rate_limits (expires_at);

create or replace function public.consume_api_rate_limit(
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns table (
  allowed boolean,
  remaining integer,
  reset_at timestamptz
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_window timestamptz;
  v_count integer;
begin
  if p_key_hash is null or p_key_hash = '' then
    raise exception 'p_key_hash is required';
  end if;

  if p_limit < 1 or p_window_seconds < 1 then
    raise exception 'rate limit and window must be positive';
  end if;

  v_window := date_bin(
    make_interval(secs => p_window_seconds),
    v_now,
    timestamptz '2000-01-01 00:00:00+00'
  );

  insert into public.api_rate_limits (
    key_hash,
    window_started_at,
    request_count,
    expires_at
  )
  values (
    p_key_hash,
    v_window,
    1,
    v_window + make_interval(secs => p_window_seconds)
  )
  on conflict (key_hash, window_started_at)
  do update set request_count = public.api_rate_limits.request_count + 1
  returning request_count into v_count;

  return query
  select
    v_count <= p_limit,
    greatest(p_limit - v_count, 0),
    v_window + make_interval(secs => p_window_seconds);
end;
$$;

revoke all on function public.consume_api_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_api_rate_limit(text, integer, integer)
  to service_role;
