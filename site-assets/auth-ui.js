import * as auth from "./auth.js";

const $ = (s) => document.querySelector(s);
const show = (node, text, error = false) => { if (node) { node.textContent = text; node.classList.toggle("error", error); node.hidden = !text; } };
const returnTo = () => auth.safeReturnUrl(new URLSearchParams(location.search).get("returnTo"));
const busy = (form, value) => { const button = form.querySelector('[type="submit"]'); button.disabled = value; button.textContent = value ? "Please wait…" : button.dataset.label; };
function profileId(session) { return session?.user?.id; }
async function initNav() {
  document.querySelectorAll(".header-space").forEach((host) => { host.className = "auth-nav"; host.id = "auth-nav"; });
  const render = async (session) => {
    const host = $("#auth-nav"); if (!host) return;
    if (!session?.user) { host.innerHTML = '<a href="./auth.html">Log In</a><a class="button button-primary nav-signup" href="./auth.html?mode=signup">Sign Up</a>'; return; }
    try { const { data, error } = await auth.getProfile(profileId(session)); if (error || !data) throw error; host.innerHTML = `<span>${escapeText(data.username)}</span><a href="./account.html">Account</a><button type="button" data-logout>Log Out</button>`; }
    catch { host.innerHTML = '<a href="./auth.html">Log In</a><a href="./auth.html?mode=signup">Sign Up</a>'; }
  };
  try { const { data } = await auth.getSession(); await render(data.session); auth.onAuthStateChange((_event, session) => { void render(session); }); }
  catch { await render(null); }
  document.addEventListener("click", async (event) => { if (event.target.closest("[data-logout]")) { try { await auth.signOut(); location.href = "./"; } catch { location.reload(); } } });
}
function escapeText(value) { const node = document.createElement("span"); node.textContent = value; return node.innerHTML; }
function initAuthForm() {
  const form = $("#auth-form"); if (!form) return;
  const mode = new URLSearchParams(location.search).get("mode") === "signup" ? "signup" : "login";
  $("#signup-fields").hidden = mode !== "signup"; $("#auth-title").textContent = mode === "signup" ? "Create your account" : "Log in";
  $("#auth-submit").textContent = mode === "signup" ? "Sign Up" : "Log In"; $("#auth-submit").dataset.label = $("#auth-submit").textContent;
  $("#auth-switch").href = `./auth.html?mode=${mode === "signup" ? "login" : "signup"}${new URLSearchParams(location.search).has("returnTo") ? `&returnTo=${encodeURIComponent(returnTo())}` : ""}`;
  $("#auth-switch").textContent = mode === "signup" ? "Already have an account? Log in" : "Need an account? Sign up";
  form.addEventListener("submit", async (event) => { event.preventDefault(); const status = $("#form-status"); show(status, ""); busy(form, true);
    try {
      const email = $("#email").value.trim(); const password = $("#password").value;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
      if (mode === "signup") { const username = $("#username").value.trim(); if (!auth.validateUsername(username)) throw new Error("Use 3–20 letters, numbers, or underscores for your username."); if (password.length < 8) throw new Error("Choose a password with at least 8 characters."); if (password !== $("#confirm-password").value) throw new Error("Passwords do not match."); const { data, error } = await auth.signUp(username, email, password, new URL("./auth.html", location.href).href); if (error) throw error; if (data.session) location.href = returnTo(); else show(status, "Check your email for a confirmation link. You can log in after confirming."); }
      else { const { data, error } = await auth.signIn(email, password); if (error) throw error; if (!data.session) throw new Error("Sign-in did not create a session. Please try again."); location.href = returnTo(); }
    } catch (error) { show(status, error.message && (error.message.startsWith("Use ") || error.message.startsWith("Choose ") || error.message === "Passwords do not match." || error.message === "Enter a valid email address.") ? error.message : auth.authError(error), true); }
    finally { busy(form, false); }
  });
}
function initAccount() {
  const page = $("[data-account-page]"); if (!page) return;
  (async () => { const { data } = await auth.getSession(); if (!data.session) { location.replace(`./auth.html?returnTo=${encodeURIComponent(new URL("./account.html", location.href).href)}`); return; }
    const profile = await auth.getProfile(data.session.user.id); if (profile.error || !profile.data) { show($("#account-status"), "We couldn't load your profile. Please refresh or log in again.", true); return; }
    $("#account-username").textContent = profile.data.username; $("#account-email").textContent = data.session.user.email || ""; $("#account-role").textContent = profile.data.role;
    $("#username-form").addEventListener("submit", async (event) => { event.preventDefault(); const form = event.currentTarget; const name = $("#new-username").value.trim(); if (!auth.validateUsername(name)) { show($("#account-status"), "Use 3–20 letters, numbers, or underscores.", true); return; } busy(form, true); try { const { error } = await auth.changeUsername(name); if (error) throw error; const refreshed = await auth.getProfile(data.session.user.id); if (refreshed.error) throw refreshed.error; $("#account-username").textContent = refreshed.data.username; show($("#account-status"), "Username updated."); } catch (error) { show($("#account-status"), auth.authError(error), true); } finally { busy(form, false); } });
  })().catch(() => show($("#account-status"), "Sign-in is temporarily unavailable.", true));
}
function initRecovery() {
  const form = $("#recovery-form"); if (!form) return;
  form.addEventListener("submit", async (event) => { event.preventDefault(); busy(form, true); try { const { error } = await auth.resetPassword($("#recovery-email").value.trim(), new URL("./reset-password.html", location.href).href); if (error) throw error; show($("#form-status"), "If an account uses that email, a recovery link is on its way."); } catch (error) { show($("#form-status"), auth.authError(error), true); } finally { busy(form, false); } });
}
function initReset() {
 const form = $("#reset-form"); if (!form) return;
 form.addEventListener("submit", async (event) => { event.preventDefault(); busy(form, true); try { if ($("#new-password").value.length < 8) throw new Error("Choose a password with at least 8 characters."); if ($("#new-password").value !== $("#confirm-password").value) throw new Error("Passwords do not match."); const { error } = await auth.updatePassword($("#new-password").value); if (error) throw error; show($("#form-status"), "Password updated. You can now log in."); form.reset(); } catch (error) { show($("#form-status"), auth.authError(error), true); } finally { busy(form, false); } });
}
void initNav(); initAuthForm(); initAccount(); initRecovery(); initReset();
