import * as auth from "./auth.js";
import { supabase } from "./supabase-client.js";
import { createSubmission, friendlySubmissionError, getSubmissionFeedback, listUserSubmissions, signedCoverUrl, validateSubmission, MAX_COVER_BYTES, MAX_SOURCE_BYTES } from "./submissions.js";

const DRAFT_ID = "form";
const formSection = document.querySelector("#submission-form-section");
const form = document.querySelector("#submission-form");
const projectSelect = document.querySelector("#submission-project");
const titleInput = document.querySelector("#submission-title");
const descriptionInput = document.querySelector("#submission-description");
const controlsInput = document.querySelector("#submission-controls");
const coverInput = document.querySelector("#submission-cover");
const coverPreview = document.querySelector("#submission-cover-preview");
const coverRemoveButton = document.querySelector("#submission-cover-remove");
const sendButton = document.querySelector("#submission-send");
const message = document.querySelector("#submission-message");
const authNotice = document.querySelector("#submission-auth-notice");
const authLogin = document.querySelector("#submission-login-link");
const authSignup = document.querySelector("#submission-signup-link");
const sourceNote = document.querySelector("#submission-source-note");
const submissionsMessage = document.querySelector("#submissions-message");
const submissionsGrid = document.querySelector("#submissions-grid");
const statusLabels = {
  submitted: "Waiting for review",
  under_review: "Under review",
  changes_requested: "Changes requested",
  approved: "Approved",
  rejected: "Not approved",
};
const eventLabels = {
  approval_recommended: "A reviewer recommended approval",
  rejection_recommended: "A reviewer recommended not approving this game",
  changes_requested: "A reviewer requested changes",
  approved: "Your game was approved",
  rejected: "Your game was not approved",
};

let projectStore;
let session = null;
let ownerId = "guest";
let localProjects = [];
let selectedSource = "";
let selectedProjectId = "";
let restoredDraft = null;
let pending = false;
let selectedCover = null;
let coverPreviewUrl = null;
let draftTimer = null;
let draftWrite = Promise.resolve(true);
const loadedFeedback = new Set();

function setMessage(text, error = false) {
  message.textContent = text;
  message.classList.toggle("is-error", error);
}

async function readDraft() {
  const draft = await projectStore.readSubmissionDraft(DRAFT_ID);
  if (draft && typeof draft.source === "string" && new TextEncoder().encode(draft.source).byteLength <= MAX_SOURCE_BYTES) return draft;
  try {
    const legacy = JSON.parse(localStorage.getItem("copper-cloud-submission-draft-v1") || "null");
    if (!legacy || typeof legacy.source !== "string" || new TextEncoder().encode(legacy.source).byteLength > MAX_SOURCE_BYTES) return null;
    if (await projectStore.writeSubmissionDraft(DRAFT_ID, legacy)) localStorage.removeItem("copper-cloud-submission-draft-v1");
    return legacy;
  } catch { return null; }
}

function saveDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => { void flushDraft(); }, 250);
}

async function flushDraft() {
  clearTimeout(draftTimer);
  const draft = {
    projectId: selectedProjectId,
    projectTitle: projectSelect.selectedOptions[0]?.textContent || "",
    source: selectedSource,
    title: titleInput.value,
    description: descriptionInput.value,
    controls: controlsInput.value,
    cover: selectedCover,
    coverName: selectedCover?.name || "",
  };
  draftWrite = draftWrite.then(() => projectStore.writeSubmissionDraft(DRAFT_ID, draft));
  if (!await draftWrite) sourceNote.textContent = "This browser could not save your form draft. Keep this page open until you submit.";
}

function showCoverPreview(file, name = file?.name || "Selected cover image") {
  if (coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl);
  if (!file) {
    coverPreviewUrl = null;
    coverPreview.hidden = true;
    coverPreview.removeAttribute("src");
    coverRemoveButton.hidden = true;
    return;
  }
  coverPreviewUrl = URL.createObjectURL(file);
  coverPreview.src = coverPreviewUrl;
  coverPreview.alt = `Preview of ${name}`;
  coverPreview.hidden = false;
  coverRemoveButton.hidden = false;
}

function loginUrl() {
  const returnTo = new URL("./my-games.html?submission=1", location.href).href;
  return `./auth.html?returnTo=${encodeURIComponent(returnTo)}`;
}

function setGuestPrompt() {
  authLogin.href = loginUrl();
  authSignup.href = `./auth.html?mode=signup&returnTo=${encodeURIComponent(new URL("./my-games.html?submission=1", location.href).href)}`;
  authNotice.hidden = false;
}

function updateSourceNote() {
  if (!selectedSource) {
    sourceNote.textContent = "Python source is included automatically from the selected game.";
    return;
  }
  const size = new TextEncoder().encode(selectedSource).byteLength;
  sourceNote.textContent = `Python source is ready to include (${Math.ceil(size / 1024)} KiB). It will not run when you submit.`;
}

async function loadProjects(draft = restoredDraft) {
  projectStore ||= await import("./project-store.js");
  localProjects = await projectStore.listProjects(ownerId);
  projectSelect.replaceChildren(new Option("Choose a game…", ""));
  for (const project of localProjects) projectSelect.add(new Option(project.title, project.id));
  selectedProjectId = "";
  selectedSource = "";
  let missingProjectNotice = "";

  if (draft?.source) {
    const localMatch = localProjects.find((project) => project.id === draft.projectId);
    if (localMatch) {
      projectSelect.value = localMatch.id;
      selectedProjectId = localMatch.id;
      selectedSource = draft.source;
      if (draft.projectTitle && !titleInput.value) titleInput.value = draft.projectTitle;
    } else {
      const label = `${draft.projectTitle || draft.title || "Previously selected game"} (saved form draft)`;
      projectSelect.add(new Option(label, "__saved_draft__"));
      projectSelect.value = "__saved_draft__";
      selectedProjectId = draft.projectId || "__saved_draft__";
      selectedSource = draft.source;
      missingProjectNotice = "This game is not in this account’s local library. Its saved code is preserved here and will still be submitted.";
    }
    titleInput.value = draft.title || draft.projectTitle || titleInput.value;
    descriptionInput.value = draft.description || "";
    controlsInput.value = draft.controls || "";
    selectedCover = draft.cover instanceof Blob ? draft.cover : null;
    if (selectedCover) showCoverPreview(selectedCover, draft.coverName);
  }
  updateSourceNote();
  if (missingProjectNotice) sourceNote.textContent = missingProjectNotice;
}

async function openForm(projectId = "") {
  formSection.hidden = false;
  setMessage("");
  if (projectId) {
    await loadProjects(null);
    const project = localProjects.find((item) => item.id === projectId);
    if (project) {
      projectSelect.value = project.id;
      selectedProjectId = project.id;
      selectedSource = project.source;
      titleInput.value = project.title;
      saveDraft();
      updateSourceNote();
    } else {
      setMessage("That saved game is not available in this account’s local library.", true);
    }
  } else if (!projectSelect.options.length || localProjects.length === 0) {
    await loadProjects(null);
  }
  formSection.scrollIntoView({ behavior: "smooth", block: "start" });
  projectSelect.focus();
}

function statusLabel(status) {
  return statusLabels[status] || "Status update pending";
}

function readableDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : date.toLocaleString();
}

function detailLine(label, value) {
  const row = document.createElement("p");
  const strong = document.createElement("strong");
  strong.textContent = `${label}: `;
  row.append(strong, document.createTextNode(value || "Not provided"));
  return row;
}

async function loadFeedback(submission, host, button) {
  if (loadedFeedback.has(submission.id)) return;
  loadedFeedback.add(submission.id);
  button.textContent = "Loading feedback…";
  button.disabled = true;
  try {
    const feedback = await getSubmissionFeedback(supabase, submission.id);
    const list = document.createElement("ul");
    list.className = "submission-feedback-list";
    if (!feedback.length) {
      const empty = document.createElement("p");
      empty.textContent = "No reviewer feedback yet.";
      host.append(empty);
    } else {
      for (const item of feedback) {
        const entry = document.createElement("li");
        const heading = document.createElement("strong");
        heading.textContent = eventLabels[item.event_type] || "Review update";
        const date = document.createElement("time");
        date.dateTime = item.created_at;
        date.textContent = readableDate(item.created_at);
        const note = document.createElement("p");
        note.textContent = item.feedback || "No extra note was added.";
        entry.append(heading, date, note);
        list.append(entry);
      }
      host.append(list);
    }
  } catch (error) {
    loadedFeedback.delete(submission.id);
    button.textContent = "Retry feedback";
    const problem = document.createElement("p");
    problem.className = "is-error";
    problem.textContent = friendlySubmissionError(error);
    host.append(problem);
  } finally {
    if (loadedFeedback.has(submission.id)) {
      button.textContent = "Feedback loaded";
      button.disabled = true;
    } else button.disabled = false;
  }
}

function renderSubmission(submission) {
  const card = document.createElement("article");
  card.className = "submission-card";
  const heading = document.createElement("div");
  heading.className = "submission-card-heading";
  const title = document.createElement("h3");
  title.textContent = submission.title;
  const status = document.createElement("span");
  status.className = `submission-status submission-status-${submission.status}`;
  status.textContent = statusLabel(submission.status);
  heading.append(title, status);
  const date = document.createElement("time");
  date.className = "project-modified";
  date.dateTime = submission.created_at;
  date.textContent = `Submitted ${readableDate(submission.created_at)}`;
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "View details and feedback";
  const content = document.createElement("div");
  content.className = "submission-details";
  content.append(
    detailLine("Description", submission.description),
    detailLine("Controls", submission.controls),
    detailLine("Last updated", readableDate(submission.updated_at)),
  );
  if (submission.cover_image_path) {
    const cover = document.createElement("img");
    cover.className = "submission-cover";
    cover.alt = `Cover image for ${submission.title}`;
    cover.loading = "lazy";
    content.prepend(cover);
    void signedCoverUrl(supabase, submission.cover_image_path).then((url) => { if (url) cover.src = url; else cover.remove(); }).catch(() => cover.remove());
  }
  if (["submitted", "under_review", "changes_requested"].includes(submission.status)) {
    const edit = document.createElement("a");
    edit.className = "button button-secondary button-small submission-edit-link";
    edit.href = `./game-studio.html?editSubmission=${encodeURIComponent(submission.id)}`;
    edit.textContent = "Edit Submission";
    content.append(edit);
  }
  const feedbackHeading = document.createElement("h4");
  feedbackHeading.textContent = "Reviewer feedback";
  const feedbackHost = document.createElement("div");
  const feedbackButton = document.createElement("button");
  feedbackButton.type = "button";
  feedbackButton.className = "button button-secondary button-small";
  feedbackButton.textContent = "Load feedback";
  feedbackButton.addEventListener("click", () => void loadFeedback(submission, feedbackHost, feedbackButton));
  content.append(feedbackHeading, feedbackButton, feedbackHost);
  details.append(summary, content);
  card.append(heading, date, details);
  return card;
}

async function refreshSubmissions() {
  submissionsGrid.replaceChildren();
  submissionsMessage.classList.remove("is-error");
  if (!session?.user?.id) {
    submissionsMessage.hidden = false;
    submissionsMessage.textContent = "Log in to see your submissions.";
    return;
  }
  submissionsMessage.hidden = false;
  submissionsMessage.textContent = "Loading your submissions…";
  try {
    const submissions = await listUserSubmissions(supabase, session.user.id);
    if (!submissions.length) {
      submissionsMessage.textContent = "You haven’t submitted a game yet. Choose Submit Game on one of your saved projects when you’re ready.";
      return;
    }
    submissionsMessage.hidden = true;
    for (const submission of submissions) submissionsGrid.append(renderSubmission(submission));
  } catch (error) {
    submissionsMessage.textContent = friendlySubmissionError(error);
    submissionsMessage.classList.add("is-error");
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  if (pending) return;
  try {
    if (!selectedSource) throw new Error("Choose a saved game first.");
    const fields = { title: titleInput.value, description: descriptionInput.value, controls: controlsInput.value };
    validateSubmission(fields, selectedSource);
    await flushDraft();
    let currentSession = session;
    try {
      const result = await auth.getSession();
      if (result.error) throw result.error;
      currentSession = result.data?.session || null;
      session = currentSession;
    } catch (error) {
      setMessage(friendlySubmissionError(error), true);
      return;
    }
    if (!currentSession?.user?.id) {
      setGuestPrompt();
      setMessage("Log in or create an account to send this game. Your selected code and form stay saved in this browser.");
      authNotice.scrollIntoView({ behavior: "smooth", block: "nearest" });
      authLogin.focus();
      return;
    }
  } catch (error) {
    setMessage(friendlySubmissionError(error), true);
    return;
  }

  pending = true;
  sendButton.disabled = true;
  sendButton.textContent = "Sending…";
  setMessage("Sending your game for review…");
  try {
    const id = await createSubmission(supabase, {
      title: titleInput.value,
      description: descriptionInput.value,
      controls: controlsInput.value,
    }, selectedSource, selectedCover);
    if (!id) throw new Error("Submission was not confirmed by the server.");
    await projectStore.clearSubmissionDraft(DRAFT_ID);
    restoredDraft = null;
    selectedCover = null;
    showCoverPreview(null);
    setMessage("Your game was submitted! You can follow its status below.");
    authNotice.hidden = true;
    await refreshSubmissions();
    submissionsGrid.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    setMessage(friendlySubmissionError(error), true);
  } finally {
    pending = false;
    sendButton.disabled = false;
    sendButton.textContent = "Submit for review";
  }
}

async function initialize() {
  projectStore = await import("./project-store.js");
  restoredDraft = await readDraft();
  try {
    const { data, error } = await auth.getSession();
    if (error) throw error;
    session = data.session;
    ownerId = session?.user?.id || "guest";
  } catch { session = null; ownerId = "guest"; }
  await loadProjects(restoredDraft);
  if (restoredDraft) {
    formSection.hidden = false;
    setMessage("Your saved submission form is ready to continue.");
    if (restoredDraft.projectId && !localProjects.some((project) => project.id === restoredDraft.projectId)) {
      sourceNote.textContent = "This game is not in this account’s local library. Its saved code is preserved here and will still be submitted.";
    }
  }
  if (new URLSearchParams(location.search).get("submission") === "1") formSection.hidden = false;
  if (!session) setGuestPrompt();
  document.querySelector("#open-submit-form").addEventListener("click", () => void openForm());
  window.addEventListener("copper-submit-saved-game", (event) => void openForm(event.detail?.projectId || ""));
  projectSelect.addEventListener("change", async () => {
    const project = localProjects.find((item) => item.id === projectSelect.value);
    selectedProjectId = project?.id || (projectSelect.value === "__saved_draft__" ? selectedProjectId : "");
    selectedSource = project?.source || (projectSelect.value === "__saved_draft__" ? selectedSource : "");
    if (project) titleInput.value = project.title;
    updateSourceNote();
    saveDraft();
  });
  coverInput.addEventListener("change", () => {
    const file = coverInput.files?.[0] || null;
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size < 1 || file.size > MAX_COVER_BYTES) {
      setMessage("Choose a PNG, JPEG, or WebP cover image no larger than 3 MiB.", true);
      coverInput.value = "";
      return;
    }
    setMessage("");
    selectedCover = file;
    showCoverPreview(file);
    saveDraft();
  });
  coverRemoveButton.addEventListener("click", () => {
    selectedCover = null;
    coverInput.value = "";
    showCoverPreview(null);
    saveDraft();
  });
  form.addEventListener("input", saveDraft);
  form.addEventListener("submit", handleSubmit);
  addEventListener("pagehide", () => { void flushDraft(); });
  try {
    auth.onAuthStateChange(async (_event, nextSession) => {
      const previousOwner = ownerId;
      session = nextSession;
      ownerId = session?.user?.id || "guest";
      if (previousOwner !== ownerId) {
        restoredDraft = await readDraft();
        await loadProjects(restoredDraft);
        if (restoredDraft) formSection.hidden = false;
      }
      if (!session) setGuestPrompt();
      else authNotice.hidden = true;
      await refreshSubmissions();
    });
  } catch { /* Local project selection and draft recovery still work without auth setup. */ }
  await refreshSubmissions();
}

void initialize().catch((error) => {
  submissionsMessage.hidden = false;
  submissionsMessage.classList.add("is-error");
  submissionsMessage.textContent = `My Submissions could not be loaded: ${friendlySubmissionError(error)}`;
});
