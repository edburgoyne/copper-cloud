import * as auth from "./auth.js";
import { supabase } from "./supabase-client.js";
import { friendlySubmissionError, signedCoverUrl, updateSubmission, validateSubmission, MAX_COVER_BYTES } from "./submissions.js";

const code = document.querySelector("#code");
const saveButton = document.querySelector("#save-project");
const saveState = document.querySelector("#save-state");
const titleNode = document.querySelector("#project-title");
const notice = document.querySelector("#project-notice");
const sourceStatus = document.querySelector("#source-status");
const importInput = document.querySelector("#import-file");
const restoreButton = document.querySelector("#restore-draft");
const submissionPanel = document.querySelector("#submission-edit-panel");
const submissionTitle = document.querySelector("#submission-edit-title-input");
const submissionDescription = document.querySelector("#submission-edit-description");
const submissionControls = document.querySelector("#submission-edit-controls");
const submissionCoverInput = document.querySelector("#submission-edit-cover");
const submissionCoverPreview = document.querySelector("#submission-edit-cover-preview");
const submissionCoverRemove = document.querySelector("#submission-edit-cover-remove");
const submissionUpdateButton = document.querySelector("#update-submission");
const submissionEditState = document.querySelector("#submission-edit-state");
const submissionEditMessage = document.querySelector("#submission-edit-message");
const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
let projects;
let ownerId = "guest";
let activeProject = null;
let edited = false;
let saveVersion = 0;
let saveTimer = null;
let recoveryTimer = null;
let saveChain = Promise.resolve();
let activeSubmission = null;
let selectedSubmissionCover = null;
let removeSubmissionCover = false;
let submissionCoverPreviewUrl = null;
let submissionCoverRenderVersion = 0;

function showNotice(text, error = false) {
  notice.textContent = text;
  notice.classList.toggle("is-error", error);
}

function showSaveState(text, error = false) {
  saveState.textContent = text;
  saveState.classList.toggle("is-error", error);
}

function showSubmissionCover(file, path = "") {
  const version = ++submissionCoverRenderVersion;
  if (submissionCoverPreviewUrl) URL.revokeObjectURL(submissionCoverPreviewUrl);
  submissionCoverPreviewUrl = null;
  submissionCoverPreview.hidden = true;
  submissionCoverPreview.removeAttribute("src");
  if (file) {
    submissionCoverPreviewUrl = URL.createObjectURL(file);
    submissionCoverPreview.src = submissionCoverPreviewUrl;
    submissionCoverPreview.alt = "Preview of the replacement submission cover";
    submissionCoverPreview.hidden = false;
    submissionCoverRemove.hidden = false;
    return;
  }
  if (path) {
    void signedCoverUrl(supabase, path).then((url) => {
      if (version !== submissionCoverRenderVersion) return;
      if (url) {
        submissionCoverPreview.src = url;
        submissionCoverPreview.alt = "Current submission cover image";
        submissionCoverPreview.hidden = false;
      }
    }).catch(() => { if (version === submissionCoverRenderVersion) submissionEditMessage.textContent = "The existing private cover image could not be loaded."; });
    submissionCoverRemove.hidden = false;
    return;
  }
  submissionCoverRemove.hidden = true;
}

async function loadSubmissionForEdit(submissionId) {
  submissionPanel.hidden = false;
  saveButton.hidden = true;
  document.querySelector(".studio-demo .section-intro").textContent = "Changes to this submitted copy stay in this browser until you choose Update Submission.";
  submissionEditState.textContent = "Loading your submitted copy…";
  if (!ownerId || ownerId === "guest" || !supabase) {
    submissionEditState.textContent = "Log in to edit your submission.";
    const returnTo = new URL(location.href);
    location.replace(`./auth.html?returnTo=${encodeURIComponent(returnTo.href)}`);
    return;
  }
  const { data: submission, error } = await supabase.from("game_submissions")
    .select("id,user_id,title,description,controls,source_code,status,updated_at,cover_image_path")
    .eq("id", submissionId)
    .maybeSingle();
  if (error || !submission || submission.user_id !== ownerId) {
    submissionEditState.textContent = "This submission could not be found or is not available to your account.";
    submissionEditState.classList.add("is-error");
    return;
  }
  if (!["submitted", "under_review", "changes_requested"].includes(submission.status)) {
    submissionEditState.textContent = "This submission has a final decision and can no longer be edited.";
    submissionEditState.classList.add("is-error");
    code.readOnly = true;
    return;
  }
  activeSubmission = submission;
  titleNode.textContent = `${submission.title} · Submission revision`;
  code.value = submission.source_code;
  submissionTitle.value = submission.title;
  submissionDescription.value = submission.description;
  submissionControls.value = submission.controls;
  showSubmissionCover(null, submission.cover_image_path);
  submissionCoverRemove.textContent = "Remove current cover";
  const draft = await projects.readSubmissionDraft(submission.id);
  if (draft?.originalUpdatedAt === submission.updated_at) {
    code.value = draft.source;
    submissionTitle.value = draft.title || submission.title;
    submissionDescription.value = draft.description || submission.description;
    submissionControls.value = draft.controls || submission.controls;
    selectedSubmissionCover = draft.cover instanceof Blob ? draft.cover : null;
    removeSubmissionCover = Boolean(draft.removeCover);
    if (selectedSubmissionCover) showSubmissionCover(selectedSubmissionCover);
    else if (removeSubmissionCover) showSubmissionCover(null);
    submissionEditMessage.textContent = "Recovered your unsaved submission edits from this browser.";
  } else if (draft) {
    await projects.clearSubmissionDraft(submission.id);
    submissionEditMessage.textContent = "The submission changed since this local draft was saved. The latest submitted version has been loaded.";
  }
  submissionEditState.textContent = `Editing your submitted copy (${submission.status.replaceAll("_", " ")}). Your Saved Games project will not be changed.`;
  submissionDescription.addEventListener("input", () => { edited = true; queueSubmissionDraft(); });
  submissionTitle.addEventListener("input", () => { edited = true; queueSubmissionDraft(); });
  submissionControls.addEventListener("input", () => { edited = true; queueSubmissionDraft(); });
  submissionCoverInput.addEventListener("change", () => {
    const file = submissionCoverInput.files?.[0] || null;
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size < 1 || file.size > MAX_COVER_BYTES) {
      submissionEditMessage.textContent = "Choose a PNG, JPEG, or WebP cover image no larger than 3 MiB.";
      submissionEditMessage.classList.add("is-error");
      submissionCoverInput.value = "";
      return;
    }
    selectedSubmissionCover = file;
    removeSubmissionCover = false;
    submissionEditMessage.textContent = "Cover replacement selected; it will upload when you choose Update Submission.";
    submissionEditMessage.classList.remove("is-error");
    showSubmissionCover(file);
    submissionCoverRemove.textContent = "Remove selected cover";
    void saveSubmissionDraft();
  });
  submissionCoverRemove.addEventListener("click", () => {
    selectedSubmissionCover = null;
    submissionCoverInput.value = "";
    removeSubmissionCover = Boolean(submission.cover_image_path);
    showSubmissionCover(null);
    submissionCoverRemove.textContent = "Remove current cover";
    submissionEditMessage.textContent = removeSubmissionCover ? "Current cover will be removed when you update the submission." : "No cover image selected.";
    void saveSubmissionDraft();
  });
  submissionUpdateButton.addEventListener("click", updateSubmissionCopy);
  if (submission.cover_image_path) submissionCoverRemove.hidden = false;
  try {
    validateSubmission({ title: submissionTitle.value, description: submissionDescription.value, controls: submissionControls.value }, code.value);
  } catch (error) { submissionEditMessage.textContent = error.message; submissionEditMessage.classList.add("is-error"); }
}

async function updateSubmissionCopy() {
  if (!activeSubmission || submissionUpdateButton.disabled) return;
  try {
    validateSubmission({ title: submissionTitle.value, description: submissionDescription.value, controls: submissionControls.value }, code.value);
    clearTimeout(saveTimer);
    await saveSubmissionDraft();
    submissionUpdateButton.disabled = true;
    submissionEditMessage.classList.remove("is-error");
    submissionEditMessage.textContent = "Updating your submitted game…";
    const result = await updateSubmission(supabase, activeSubmission, {
      title: submissionTitle.value,
      description: submissionDescription.value,
      controls: submissionControls.value,
    }, code.value, { coverFile: selectedSubmissionCover, removeCurrentCover: removeSubmissionCover });
    activeSubmission = {
      ...activeSubmission,
      title: submissionTitle.value,
      description: submissionDescription.value,
      controls: submissionControls.value,
      source_code: code.value,
      status: activeSubmission.status === "changes_requested" ? "submitted" : activeSubmission.status,
      updated_at: result.updatedAt || new Date().toISOString(),
      cover_image_path: result.coverImagePath,
    };
    titleNode.textContent = `${activeSubmission.title} · Submission revision`;
    selectedSubmissionCover = null;
    removeSubmissionCover = false;
    submissionCoverInput.value = "";
    await projects.clearSubmissionDraft(activeSubmission.id);
    edited = false;
    showSubmissionCover(null, activeSubmission.cover_image_path);
    submissionCoverRemove.textContent = "Remove current cover";
    submissionEditState.textContent = `Updated. Current status: ${activeSubmission.status.replaceAll("_", " ")}.`;
    submissionEditMessage.textContent = "Submission updated. Review status and history are refreshed; your local saved game was not changed.";
    showSaveState("Submission updated");
  } catch (error) {
    submissionEditMessage.textContent = friendlySubmissionError(error);
    submissionEditMessage.classList.add("is-error");
  } finally { submissionUpdateButton.disabled = false; }
}

function validateSource(source) {
  if (new TextEncoder().encode(source).byteLength > MAX_SOURCE_BYTES) throw new Error("This game is larger than the 5 MiB source limit.");
}

function scheduleAutosave() {
  const version = ++saveVersion;
  edited = true;
  if (activeSubmission) {
    showSaveState("Submission draft saved in this browser…");
    queueSubmissionDraft();
    return;
  }
  clearTimeout(recoveryTimer);
  recoveryTimer = setTimeout(() => { void projects.writeRecovery(code.value, ownerId); }, 250);
  if (!activeProject) {
    showSaveState("Unsaved draft · save game to keep it in My Games");
    return;
  }
  showSaveState("Saving…");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const source = code.value;
    saveChain = saveChain.then(async () => {
      await projects.updateProject(activeProject.id, source, ownerId);
      if (version === saveVersion) {
        edited = false;
        await projects.clearRecovery(ownerId);
        showSaveState("Saved");
      }
    }).catch((error) => {
      showSaveState(`Could not autosave: ${error.message}`, true);
    });
  }, 700);
}

function queueSubmissionDraft() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { void saveSubmissionDraft(); }, 350);
}

async function saveSubmissionDraft() {
  if (!activeSubmission) return;
  const saved = await projects.writeSubmissionDraft(activeSubmission.id, {
    source: code.value,
    title: submissionTitle.value,
    description: submissionDescription.value,
    controls: submissionControls.value,
    cover: selectedSubmissionCover,
    removeCover: removeSubmissionCover,
    originalUpdatedAt: activeSubmission.updated_at,
  });
  showSaveState(saved ? "Unsaved submission changes are saved in this browser." : "Could not save the submission draft. Keep this page open and export your code.", !saved);
}

async function saveProject() {
  if (activeSubmission || saveButton.disabled) return;
  saveButton.disabled = true;
  saveButton.textContent = "Saving…";
  try {
    validateSource(code.value);
    clearTimeout(recoveryTimer);
    await projects.writeRecovery(code.value, ownerId);
    if (!activeProject) {
      const title = window.prompt("Name your game (3–100 characters).", "My game");
      if (title === null) return;
      activeProject = await projects.createProject({
        title,
        source: code.value,
        ownerId,
      });
      const url = new URL(location.href);
      url.searchParams.set("project", activeProject.id);
      url.searchParams.delete("new");
      history.replaceState(null, "", url);
    } else {
      const version = saveVersion;
      await saveChain;
      await projects.updateProject(activeProject.id, code.value, ownerId);
      if (version !== saveVersion) await projects.updateProject(activeProject.id, code.value, ownerId);
    }
    edited = false;
    await projects.clearRecovery(ownerId);
    titleNode.textContent = activeProject.title;
    saveButton.textContent = "Save game";
    showSaveState("Saved");
    showNotice("Saved in My Games. You can keep editing; changes autosave.");
  } catch (error) {
    showSaveState(error.message || "Could not save this game.", true);
  } finally {
    saveButton.disabled = false;
    if (saveButton.textContent === "Saving…") saveButton.textContent = "Save game";
  }
}

function safeFilename(title) {
  const safe = String(title || "game").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  return `${safe || "game"}.py`;
}

function exportSource() {
  const blob = new Blob([code.value], { type: "text/x-python;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = safeFilename(activeSubmission?.title || activeProject?.title || "game");
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(href), 0);
}

async function importSource() {
  const [file] = importInput.files || [];
  if (!file) return;
  try {
    if (!file.name.toLowerCase().endsWith(".py")) throw new Error("Choose a file ending in .py.");
    if (file.size > MAX_SOURCE_BYTES) throw new Error("Python files must be 5 MiB or smaller.");
    if ((activeProject || activeSubmission) && !window.confirm(activeSubmission ? "Replace the submitted copy’s code with this file? Your local saved game will remain unchanged." : "Replace the code in this saved game with the imported file?")) return;
    let source;
    try { source = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()); }
    catch { throw new Error("This file is not valid UTF-8 Python source."); }
    validateSource(source);
    code.value = source;
    code.dispatchEvent(new Event("input", { bubbles: true }));
    sourceStatus.textContent = `Imported ${file.name}. The code has not been run.`;
    showNotice(activeSubmission ? "Imported source into the submitted copy. Choose Update Submission when you’re ready to send it." : "Imported source. Save it to update the saved game.");
  } catch (error) {
    showNotice(error.message || "Could not import that file.", true);
  } finally {
    importInput.value = "";
  }
}

async function initializeProjects() {
  projects = await import("./project-store.js");
  try {
    const { data } = await auth.getSession();
    ownerId = data.session?.user?.id || "guest";
  } catch { ownerId = "guest"; }
  await new Promise((resolve) => {
    if (["ready", "error"].includes(document.querySelector("#status")?.dataset.phase)) resolve();
    else {
      document.addEventListener("studio-ready", resolve, { once: true });
      document.addEventListener("studio-load-error", resolve, { once: true });
    }
  });
  if (document.querySelector("#status")?.dataset.phase !== "ready") {
    saveButton.disabled = true;
    showSaveState("The editor did not finish loading.", true);
    return;
  }
  const params = new URLSearchParams(location.search);
  const submissionId = params.get("editSubmission");
  if (submissionId) {
    await loadSubmissionForEdit(submissionId);
  } else {
    const id = params.get("project");
    if (id) {
      const project = await projects.getProject(id, ownerId);
      if (project) {
        activeProject = project;
        code.value = project.source;
        titleNode.textContent = project.title;
        saveState.textContent = "Saved";
      } else {
        showNotice("That saved game could not be found in this browser or under this account. Your starter code is still available.", true);
      }
    }
  }
  const recovery = submissionId ? null : await projects.readRecovery(ownerId);
  restoreButton.hidden = submissionId || !recovery || recovery.source === code.value;
  restoreButton.addEventListener("click", async () => {
    const draft = await projects.readRecovery(ownerId);
    if (!draft) { restoreButton.hidden = true; return; }
    code.value = draft.source;
    code.dispatchEvent(new Event("input", { bubbles: true }));
    restoreButton.hidden = true;
  });
  saveButton.addEventListener("click", saveProject);
  document.querySelector("#export-source").addEventListener("click", exportSource);
  importInput.addEventListener("change", importSource);
  code.addEventListener("input", () => {
    try { validateSource(code.value); }
    catch (error) { showSaveState(error.message, true); return; }
    scheduleAutosave();
  });
  document.addEventListener("studio-ready", () => {
    saveButton.disabled = false;
    if (!edited) showSaveState(activeSubmission ? "Submitted copy loaded" : activeProject ? "Saved" : "Draft · save game to keep it");
  }, { once: true });
  try {
    auth.onAuthStateChange(async (_event, session) => {
      const nextOwner = session?.user?.id || "guest";
      if (nextOwner !== ownerId) {
        if (activeSubmission) await saveSubmissionDraft();
        else await projects.writeRecovery(code.value, ownerId);
        location.reload();
      }
    });
  } catch { /* Local projects work when sign-in is unavailable. */ }
  addEventListener("pagehide", () => {
    if (activeSubmission) void saveSubmissionDraft();
    else if (edited) void projects.writeRecovery(code.value, ownerId);
  });
  if (document.querySelector("#status")?.dataset.phase === "ready") document.dispatchEvent(new Event("studio-ready"));
}

void initializeProjects().catch((error) => {
  showNotice(`Project storage is unavailable: ${error.message}`, true);
  saveButton.disabled = true;
});
