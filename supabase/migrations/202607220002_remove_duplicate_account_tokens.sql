-- Keep OAuth secrets only on each provider's workspace-level master record.
-- Ad-account rows are metadata references and do not need duplicate secrets.
update public.platform_connections
set
  access_token = null,
  refresh_token = null,
  expires_at = null,
  scopes = '{}'::text[],
  updated_at = now()
where metadata ->> 'connection_type' in (
  'meta_ad_account',
  'snapchat_ad_account'
);
