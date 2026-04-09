import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { getEnv } from "../config/env";

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!_client) {
    const env = getEnv();
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY not configured");
    }
    _client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  }
  return _client;
}
