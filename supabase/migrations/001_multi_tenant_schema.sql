-- MetricsFlo Multi-Tenant Foundation
-- Version: 001_multi_tenant_schema

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- =========================
-- Helpers
-- =========================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =========================
-- Organizations
-- =========================
-- Organization = agency/company owner

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  slug text unique,
  logo_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_organizations_updated_at on public.organizations;

create trigger trg_organizations_updated_at
before update on public.organizations
for each row
execute function public.set_updated_at();

-- =========================
-- Workspaces
-- =========================
-- Workspace = one client / one store / one brand

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  slug text,
  brand_name text,
  country text default 'SA',
  currency text default 'SAR',
  timezone text default 'Asia/Riyadh',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug)
);

drop trigger if exists trg_workspaces_updated_at on public.workspaces;

create trigger trg_workspaces_updated_at
before update on public.workspaces
for each row
execute function public.set_updated_at();

-- =========================
-- Workspace Members
-- =========================
-- Who can access each workspace

create table if not exists public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member',
  status text not null default 'active',
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id),
  constraint workspace_members_role_check check (
    role in ('owner', 'admin', 'member', 'viewer')
  ),
  constraint workspace_members_status_check check (
    status in ('active', 'invited', 'disabled')
  )
);

drop trigger if exists trg_workspace_members_updated_at on public.workspace_members;

create trigger trg_workspace_members_updated_at
before update on public.workspace_members
for each row
execute function public.set_updated_at();

-- =========================
-- User Sessions / Active Workspace
-- =========================
-- Stores current active workspace per user

create table if not exists public.user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  active_workspace_id uuid references public.workspaces(id) on delete set null,
  active_organization_id uuid references public.organizations(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

drop trigger if exists trg_user_sessions_updated_at on public.user_sessions;

create trigger trg_user_sessions_updated_at
before update on public.user_sessions
for each row
execute function public.set_updated_at();

-- =========================
-- Platform Connections
-- =========================
-- One row per connected platform per workspace
-- Example: Meta, Snapchat, Salla, GA4, Shopify

create table if not exists public.platform_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,

  provider text not null,
  provider_user_id text,
  provider_account_id text,
  provider_account_name text,

  access_token text,
  refresh_token text,
  token_type text,
  expires_at timestamptz,
  scopes text[],

  status text not null default 'connected',
  currency text default 'SAR',
  timezone text default 'Asia/Riyadh',

  metadata jsonb not null default '{}'::jsonb,

  last_sync_at timestamptz,
  last_error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint platform_connections_provider_check check (
    provider in ('meta', 'snapchat', 'salla', 'ga4', 'shopify', 'google_ads', 'tiktok')
  ),
  constraint platform_connections_status_check check (
    status in ('connected', 'expired', 'revoked', 'error', 'disabled')
  )
);

create index if not exists idx_platform_connections_workspace_provider
on public.platform_connections (workspace_id, provider);

create index if not exists idx_platform_connections_provider_account
on public.platform_connections (provider, provider_account_id);

drop trigger if exists trg_platform_connections_updated_at on public.platform_connections;

create trigger trg_platform_connections_updated_at
before update on public.platform_connections
for each row
execute function public.set_updated_at();

-- =========================
-- Platform Accounts
-- =========================
-- Stores available ad accounts/stores/properties under a connection

create table if not exists public.platform_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  connection_id uuid references public.platform_connections(id) on delete cascade,

  provider text not null,
  account_id text not null,
  account_name text not null,
  account_type text default 'ad_account',
  currency text default 'SAR',
  timezone text default 'Asia/Riyadh',
  status text default 'active',

  is_primary boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (workspace_id, provider, account_id)
);

create index if not exists idx_platform_accounts_workspace_provider
on public.platform_accounts (workspace_id, provider);

drop trigger if exists trg_platform_accounts_updated_at on public.platform_accounts;

create trigger trg_platform_accounts_updated_at
before update on public.platform_accounts
for each row
execute function public.set_updated_at();

-- =========================
-- Salla Orders
-- =========================
-- Real orders from Salla as source of truth

create table if not exists public.salla_orders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  connection_id uuid references public.platform_connections(id) on delete set null,

  salla_order_id text not null,
  order_reference text,
  order_date timestamptz,
  status text,

  customer_id text,
  customer_email text,
  customer_phone text,

  currency text default 'SAR',
  total_amount numeric default 0,
  paid_amount numeric default 0,
  refunded_amount numeric default 0,

  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  referrer text,
  landing_page text,
  coupon_code text,

  attribution_source text,
  attribution_platform text,
  attribution_campaign_id text,

  raw jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (workspace_id, salla_order_id)
);

create index if not exists idx_salla_orders_workspace_date
on public.salla_orders (workspace_id, order_date);

create index if not exists idx_salla_orders_workspace_source
on public.salla_orders (workspace_id, attribution_source);

drop trigger if exists trg_salla_orders_updated_at on public.salla_orders;

create trigger trg_salla_orders_updated_at
before update on public.salla_orders
for each row
execute function public.set_updated_at();

-- =========================
-- Platform Daily Metrics
-- =========================
-- Normalized daily metrics for Meta/Snapchat/etc.

create table if not exists public.platform_daily_metrics (
  id uuid primary key default gen_random_uuid(),

  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  connection_id uuid references public.platform_connections(id) on delete set null,

  provider text not null,
  account_id text not null,
  account_name text,

  entity_level text not null default 'account',
  entity_id text not null,
  entity_name text,

  date date not null,

  currency text default 'SAR',

  spend numeric default 0,
  impressions numeric default 0,
  clicks numeric default 0,
  swipes numeric default 0,
  video_views numeric default 0,

  purchases numeric default 0,
  revenue numeric default 0,

  ctr numeric default 0,
  cpc numeric default 0,
  cpm numeric default 0,
  cpa numeric default 0,
  roas numeric default 0,

  raw jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (workspace_id, provider, account_id, entity_level, entity_id, date)
);

create index if not exists idx_platform_daily_metrics_workspace_date
on public.platform_daily_metrics (workspace_id, date);

create index if not exists idx_platform_daily_metrics_provider
on public.platform_daily_metrics (workspace_id, provider, date);

drop trigger if exists trg_platform_daily_metrics_updated_at on public.platform_daily_metrics;

create trigger trg_platform_daily_metrics_updated_at
before update on public.platform_daily_metrics
for each row
execute function public.set_updated_at();

-- =========================
-- AI Recommendations
-- =========================

create table if not exists public.ai_recommendations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,

  provider text,
  entity_level text,
  entity_id text,
  entity_name text,

  recommendation_type text not null default 'performance',
  severity text not null default 'medium',

  title text not null,
  message text not null,
  action_items jsonb not null default '[]'::jsonb,

  status text not null default 'open',

  source_data jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint ai_recommendations_status_check check (
    status in ('open', 'done', 'dismissed')
  ),
  constraint ai_recommendations_severity_check check (
    severity in ('low', 'medium', 'high', 'critical')
  )
);

create index if not exists idx_ai_recommendations_workspace_status
on public.ai_recommendations (workspace_id, status);

drop trigger if exists trg_ai_recommendations_updated_at on public.ai_recommendations;

create trigger trg_ai_recommendations_updated_at
before update on public.ai_recommendations
for each row
execute function public.set_updated_at();

-- =========================
-- Row Level Security
-- =========================
-- Tenant data is accessed only by authenticated server routes after membership
-- checks. The service role bypasses RLS; anon/authenticated browser clients do not.

alter table public.organizations enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.user_sessions enable row level security;
alter table public.platform_connections enable row level security;
alter table public.platform_accounts enable row level security;
alter table public.salla_orders enable row level security;
alter table public.platform_daily_metrics enable row level security;
alter table public.ai_recommendations enable row level security;
