# MetricsFlo Multi-User Step 1

## Files included

```txt
supabase/migrations/001_multi_tenant_schema.sql
lib/supabaseServer.js
lib/serverAuth.js
lib/workspace.js
middleware.js
app/api/workspace/ensure/route.js
app/api/workspace/current/route.js
app/api/workspaces/route.js
app/api/workspaces/switch/route.js
```

## Implementation order

1. Run the SQL migration in Supabase SQL Editor.
2. Add the JS files to the exact project paths.
3. Make sure these env vars exist in Vercel:

```txt
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

4. Deploy.
5. Test:

```txt
https://metricsflo.com/api/workspace/ensure
https://metricsflo.com/api/workspace/current
https://metricsflo.com/api/workspaces
```

## Important

This is the foundation only. The next step is to update platform OAuth callbacks and insights APIs to read/write tokens from `platform_connections` by `workspace_id`.
