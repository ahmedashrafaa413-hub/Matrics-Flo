import { createClient } from "@supabase/supabase-js";
import { getSupabasePublicConfig } from "./authFoundation.mjs";

let browserClient;

export function getSupabaseBrowserClient() {
  if (browserClient) return browserClient;

  const { url, anonKey } = getSupabasePublicConfig();
  browserClient = createClient(url, anonKey);

  return browserClient;
}
