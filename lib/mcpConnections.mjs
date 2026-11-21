// Pure helpers that turn platform_connections rows into what the MCP tools
// return. Kept free of Supabase/Next imports so they can be unit tested.

// Rows whose account_id is "<provider>_default" hold the provider's OAuth
// token for the workspace. They are not ad accounts.
export function isTokenRow(row) {
  return String(row?.account_id || "") === `${row?.provider}_default`;
}

function hasCredentials(row) {
  return Boolean(row?.has_access_token || row?.has_refresh_token);
}

// rows: [{ workspace_id, provider, account_id, account_name, account_currency,
//          is_active, has_access_token, has_refresh_token, updated_at, metadata }]
export function summarizeIntegrations(rows) {
  const byProvider = new Map();

  for (const row of rows || []) {
    if (!row?.provider || row.is_active === false) continue;
    const entry = byProvider.get(row.provider) || {
      platform: row.provider,
      connected: false,
      ad_accounts: 0,
      last_updated_at: null
    };
    if (isTokenRow(row)) {
      entry.connected = entry.connected || hasCredentials(row);
    } else {
      entry.ad_accounts += 1;
    }
    if (!entry.last_updated_at || String(row.updated_at) > String(entry.last_updated_at)) {
      entry.last_updated_at = row.updated_at || entry.last_updated_at;
    }
    byProvider.set(row.provider, entry);
  }

  return [...byProvider.values()].sort((a, b) => a.platform.localeCompare(b.platform));
}

export function groupByWorkspace(rows) {
  const grouped = {};
  for (const row of rows || []) {
    (grouped[row.workspace_id] ||= []).push(row);
  }
  return grouped;
}

export function listAdAccountsFromRows(rows, provider) {
  const providerRows = (rows || []).filter((row) => row.provider === provider && row.is_active !== false);
  const tokenRow = providerRows.find(isTokenRow);

  const accounts = providerRows
    .filter((row) => !isTokenRow(row))
    .map((row) => ({
      id: row.account_id,
      name: row.account_name || row.account_id,
      currency: row.account_currency || null,
      platform: provider,
      status: row.metadata?.status || null
    }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));

  return {
    connected: Boolean(tokenRow && hasCredentials(tokenRow)),
    accounts
  };
}

// Persisted rows first (they carry names/currency as saved), then any live
// Meta account the user can access that was never persisted.
export function mergeLiveMetaAccounts(persisted, live) {
  const byId = new Map((persisted || []).map((a) => [a.id, a]));
  for (const account of live || []) {
    if (!account?.id) continue;
    const existing = byId.get(account.id);
    const status = account.account_status === 1 ? "active" : account.account_status ? "inactive" : null;
    byId.set(account.id, {
      id: account.id,
      name: existing?.name || account.name || account.id,
      currency: account.currency || existing?.currency || null,
      platform: "meta",
      status: status || existing?.status || null
    });
  }
  return [...byId.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

// Run async work over items with a fixed number in flight, keeping order.
export async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

export function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
