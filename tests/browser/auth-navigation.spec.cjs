const { test, expect } = require("@playwright/test");

const authStub = `
window.supabase = { createClient: () => {
  const listeners = new Set();
  const read = () => JSON.parse(localStorage.getItem("test-session") || "null");
  const emit = (event) => listeners.forEach((fn) => fn(event, read()));
  return {
    auth: {
      getSession: async () => ({ data: { session: read() } }),
      onAuthStateChange: (fn) => { listeners.add(fn); queueMicrotask(() => fn("INITIAL_SESSION", read())); return { data: { subscription: { unsubscribe() { listeners.delete(fn); } } } }; },
      signInWithPassword: async ({ email }) => { const session = { user: { id: "user-1", email } }; localStorage.setItem("test-session", JSON.stringify(session)); emit("SIGNED_IN"); return { data: { session }, error: null }; },
      signOut: async () => { localStorage.removeItem("test-session"); emit("SIGNED_OUT"); return { error: null }; },
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: read() ? { id: "user-1", username: "CopperPlayer", role: "player" } : null, error: null }) }) }) }),
  };
} };
`;

test("shared navigation reflects login across pages and refresh, then clears on logout", async ({ page }) => {
  await page.route("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2", (route) => route.fulfill({ contentType: "application/javascript", body: authStub }));
  await page.goto("/index.html");
  await expect(page.locator("#auth-nav a", { hasText: "Log In" })).toBeVisible();
  await expect(page.locator("#auth-nav a", { hasText: "Sign Up" })).toBeVisible();

  await page.getByRole("link", { name: "Log In" }).click();
  await page.getByLabel("Email").fill("player@example.test");
  await page.locator("#password").fill("password123");
  await page.getByRole("button", { name: "Log In" }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("#auth-nav")).toContainText("CopperPlayer");
  await expect(page.locator("#auth-nav a", { hasText: "Account" })).toBeVisible();
  await expect(page.locator("#auth-nav button", { hasText: "Log Out" })).toBeVisible();

  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Games" }).click();
  await expect(page.locator("#auth-nav")).toContainText("CopperPlayer");
  await page.reload();
  await expect(page.locator("#auth-nav")).toContainText("CopperPlayer");
  await page.locator("#auth-nav button", { hasText: "Log Out" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("#auth-nav a", { hasText: "Log In" })).toBeVisible();
  await expect(page.locator("#auth-nav a", { hasText: "Sign Up" })).toBeVisible();
});
