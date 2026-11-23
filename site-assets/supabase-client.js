import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./supabase-config.js";

const validUrl = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(SUPABASE_URL);
export const configurationError = !validUrl || !SUPABASE_PUBLISHABLE_KEY.startsWith("sb_publishable_")
  ? "Copper Cloud sign-in is not configured correctly. Please try again later."
  : "";
export const supabase = configurationError ? null : window.supabase?.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
);
