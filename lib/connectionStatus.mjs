const DEFAULT_ACCOUNT_IDS = new Set([
  "meta_default",
  "snapchat_default",
  "ga4_default",
  "salla_default"
]);

function publicAccount(connection) {
  return {
    id: connection.account_id,
    name: connection.account_name || connection.account_id,
    currency: connection.account_currency || "SAR"
  };
}

export function buildConnectionStatus(connections = []) {
  const active = connections.filter((connection) => connection?.is_active !== false);
  const forProvider = (provider) =>
    active.filter((connection) => connection.provider === provider);

  const meta = forProvider("meta");
  const snapchat = forProvider("snapchat");
  const ga4 = forProvider("ga4")[0] || null;
  const salla = forProvider("salla")[0] || null;

  const metaAccounts = meta
    .filter(
      (connection) =>
        connection.metadata?.connection_type === "meta_ad_account" ||
        !DEFAULT_ACCOUNT_IDS.has(connection.account_id)
    )
    .map(publicAccount);

  const snapchatAccounts = snapchat
    .filter(
      (connection) =>
        connection.metadata?.connection_type === "snapchat_ad_account" ||
        !DEFAULT_ACCOUNT_IDS.has(connection.account_id)
    )
    .map(publicAccount);

  return {
    meta: {
      connected: meta.length > 0,
      accounts: metaAccounts
    },
    ga4: {
      connected: Boolean(ga4),
      property_name: ga4?.metadata?.property_name || ga4?.account_name || ""
    },
    salla: {
      connected: Boolean(salla),
      store_name: salla?.account_name || ""
    },
    snapchat: {
      connected: snapchat.length > 0,
      accounts: snapchatAccounts,
      account_name:
        snapchatAccounts[0]?.name || snapchat[0]?.account_name || ""
    }
  };
}
