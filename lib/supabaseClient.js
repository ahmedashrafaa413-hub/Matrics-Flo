import { createClient } from "@supabase/supabase-js";
import { getSupabasePublicConfig } from "./authFoundation.mjs";

let browserClient;

export function getSupabaseBrowserClient() {
  if (browserClient) return browserClient;

  const { url, anonKey } = getSupabasePublicConfig({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  });

  browserClient = createClient(url, anonKey);

  return browserClient;
}
