import { supabase, configurationError } from "./supabase-client.js";

export function ready() { if (!supabase) throw new Error(configurationError || "Sign-in is temporarily unavailable."); }
export function validateUsername(value) { return /^[a-zA-Z0-9_]{3,20}$/.test(value); }
export function safeReturnUrl(value) {
  const fallback = new URL("./", location.href);
  if (!value) return fallback.href;
  try {
    const target = new URL(value, location.href);
    if (target.origin !== location.origin || !/^\/(?:copper-cloud\/)?(?:index\.html|games\.html|play\.html|create\.html|about\.html|game-studio\.html|my-games\.html|account\.html)?$/.test(target.pathname)) return fallback.href;
    return target.href;
  } catch { return fallback.href; }
}
export async function signUp(username, email, password, redirectTo) { ready(); return supabase.auth.signUp({ email, password, options: { data: { username }, emailRedirectTo: redirectTo } }); }
export async function signIn(email, password) { ready(); return supabase.auth.signInWithPassword({ email, password }); }
export async function signOut() { ready(); return supabase.auth.signOut(); }
export async function getSession() { ready(); return supabase.auth.getSession(); }
export async function getProfile(id) { ready(); const { data, error } = await supabase.from("profiles").select("id, username, role, created_at").eq("id", id).maybeSingle(); return { data, error }; }
export async function changeUsername(newUsername) { ready(); return supabase.rpc("change_username", { new_username: newUsername }); }
export async function resetPassword(email, redirectTo) { ready(); return supabase.auth.resetPasswordForEmail(email, { redirectTo }); }
export async function updatePassword(password) { ready(); return supabase.auth.updateUser({ password }); }
export function onAuthStateChange(callback) { ready(); return supabase.auth.onAuthStateChange(callback); }

export function authError(error) {
  const message = (error?.message || "").toLowerCase();
  if (!navigator.onLine) return "You appear to be offline. Check your connection and try again.";
  if (/invalid login credentials|invalid email or password/.test(message)) return "Email or password is incorrect.";
  if (/already registered|user already exists/.test(message)) return "An account with that email may already exist. Try logging in.";
  if (/password.*(weak|length|short)|weak password/.test(message)) return "Choose a password with at least 8 characters.";
  if (/rate limit|too many requests/.test(message)) return "Too many attempts. Please wait a few minutes and try again.";
  if (/username|profiles_username/.test(message)) return "That username is unavailable or invalid. Try another username.";
  if (/fetch|network/.test(message)) return "We couldn't reach the sign-in service. Check your connection and try again.";
  return "We couldn't complete that request. Please check your details and try again.";
}
