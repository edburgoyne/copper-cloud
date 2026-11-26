import * as auth from "./auth.js";
import { supabase } from "./supabase-client.js";

const accessMessage = document.querySelector("#review-access-message");
const content = document.querySelector("#review-content");
const count = document.querySelector("#review-count");
const message = document.querySelector("#review-message");
const actionSummary = document.querySelector("#review-action-summary");
const list = document.querySelector("#review-list");
const OPEN_STATUSES = ["submitted", "under_review", "changes_requested"];
const STATUS_LABELS = {
  submitted: "New submission",
  under_review: "Under review",
  changes_requested: "Changes requested",
};
const RECOMMENDATIONS = {
  approval_recommended: "Recommended approval",
  rejection_recommended: "Recommended not approved",
  changes_requested: "Requested changes",
};

let activeSession = null;
let activeRole = null;
let generation = 0;

function setAccess(text, linkToLogin = false) {
  accessMessage.replaceChildren();
  accessMessage.hidden = false;
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  accessMessage.append(paragraph);
  if (linkToLogin) {
    const link = document.createElement("a");
    link.className = "button button-primary button-small";
    link.href = `./auth.html?returnTo=${encodeURIComponent(new URL("./review-submissions.html", location.href).href)}`;
    link.textContent = "Log in";
    accessMessage.append(link);
  }
  content.hidden = true;
}

function explainError(error) {
  const text = String(error?.message || "").toLowerCase();
  if (/you must be logged in|not signed in/.test(text)) return "Your session ended. Log in again to continue reviewing.";
  if (/admin permissions required|super admin permissions required/.test(text)) return "Your account does not have permission to perform that action.";
  if (/no longer open|already has a final decision|submission not found/.test(text)) return "This submission changed or was closed. Refresh the queue and review the latest version.";
  if (!navigator.onLine || /fetch|network|offline/.test(text)) return "We couldn’t reach Copper Cloud. Check your connection and try again.";
  return "We couldn’t complete that review. Refresh the page and try again.";
}

function statusLabel(status) { return STATUS_LABELS[status] || "Open submission"; }
function dateLabel(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : date.toLocaleString();
}
function addDetail(container, label, value) {
  const row = document.createElement("p");
  const name = document.createElement("strong");
  name.textContent = `${label}: `;
  row.append(name, document.createTextNode(value || "Not provided"));
  container.append(row);
}

function makeField(labelText, id, tagName, maxLength, helpText) {
  const wrapper = document.createElement("div");
  wrapper.className = "review-field";
  const label = document.createElement("label");
  label.htmlFor = id;
  label.textContent = labelText;
  const field = document.createElement(tagName);
  field.id = id;
  field.maxLength = maxLength;
  field.required = true;
  if (tagName === "textarea") field.rows = 4;
  const help = document.createElement("p");
  help.className = "field-help";
  help.textContent = helpText;
  wrapper.append(label, field, help);
  return { wrapper, field };
}

async function loadRecommendationHistory(submission, host) {
  const loading = document.createElement("p");
  loading.textContent = "Loading reviewer recommendations…";
  host.replaceChildren(loading);
  const { data, error } = await supabase.from("submission_events")
    .select("event_type,details,created_at")
    .eq("submission_id", submission.id)
    .in("event_type", ["approval_recommended", "rejection_recommended", "changes_requested"])
    .order("created_at", { ascending: false });
  if (error) throw error;
  host.replaceChildren();
  if (!data?.length) {
    const empty = document.createElement("p");
    empty.textContent = "No reviewer recommendations yet. You can make the final decision from the current submission.";
    host.append(empty);
    return;
  }
  const history = document.createElement("ul");
  history.className = "review-history";
  for (const item of data) {
    const entry = document.createElement("li");
    const heading = document.createElement("strong");
    heading.textContent = RECOMMENDATIONS[item.event_type] || "Reviewer note";
    const time = document.createElement("time");
    time.dateTime = item.created_at;
    time.textContent = dateLabel(item.created_at);
    const feedback = document.createElement("p");
    feedback.textContent = item.details?.feedback || "No note was added.";
    entry.append(heading, time, feedback);
    history.append(entry);
  }
  host.append(history);
}

function actionStatus(node, text, error = false) {
  node.textContent = text;
  node.classList.toggle("is-error", error);
}

function bindReviewerActions(form, submission, buttons, status) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const recommendation = event.submitter?.value;
    if (!RECOMMENDATIONS_BY_VALUE.has(recommendation)) return;
    const feedback = form.querySelector("textarea").value.trim();
    if (!feedback || feedback.length > 2000) {
      actionStatus(status, "Add a note of 1–2,000 characters for the student.", true);
      form.querySelector("textarea").focus();
      return;
    }
    buttons.forEach((button) => { button.disabled = true; });
    actionStatus(status, "Saving your recommendation…");
    try {
      const { error } = await supabase.rpc("review_submission", {
        p_submission_id: submission.id,
        p_recommendation: recommendation,
        p_feedback: feedback,
      });
      if (error) throw error;
      actionSummary.textContent = `Recommendation saved for “${submission.title}”. The student can see your note in My Submissions.`;
      actionSummary.hidden = false;
      buttons.forEach((button) => { button.disabled = true; });
      await refreshQueue();
    } catch (error) {
      actionStatus(status, explainError(error), true);
      buttons.forEach((button) => { button.disabled = false; });
    }
  });
}

const RECOMMENDATIONS_BY_VALUE = new Set(["approve", "reject", "request_changes"]);

function bindApproval(form, submission, buttons, status) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const decision = event.submitter?.value;
    if (!new Set(["approve", "reject"]).has(decision)) return;
    const feedback = form.querySelector("textarea").value.trim();
    if (!feedback || feedback.length > 2000) {
      actionStatus(status, "Add a final note of 1–2,000 characters for the student.", true);
      form.querySelector("textarea").focus();
      return;
    }
    const prompt = decision === "approve"
      ? `Approve “${submission.title}”? This records approval but does not publish the game.`
      : `Reject “${submission.title}”? The student will see your final decision and note.`;
    if (!window.confirm(prompt)) return;
    buttons.forEach((button) => { button.disabled = true; });
    actionStatus(status, "Saving the final decision…");
    try {
      const { error } = await supabase.rpc("decide_submission", {
        p_submission_id: submission.id,
        p_decision: decision,
        p_feedback: feedback,
      });
      if (error) throw error;
      const decisionLabel = decision === "approve" ? "Approved" : "Rejected";
      actionStatus(status, `${decisionLabel}. The student can see the decision and note in My Submissions.${decision === "approve" ? " The game has not been published." : ""}`);
      actionSummary.textContent = `${decisionLabel} “${submission.title}”. The student can see your decision and note in My Submissions.${decision === "approve" ? " The game has not been published." : ""}`;
      actionSummary.hidden = false;
      await refreshQueue();
    } catch (error) {
      buttons.forEach((button) => { button.disabled = false; });
      actionStatus(status, explainError(error), true);
    }
  });
}

async function loadCover(submission, host) {
  if (!submission.cover_image_path || !supabase?.storage) return;
  const { data, error } = await supabase.storage.from("submission-covers").createSignedUrl(submission.cover_image_path, 60);
  if (error) throw error;
  const image = document.createElement("img");
  image.className = "review-cover";
  image.src = data.signedUrl;
  image.alt = `Cover image submitted for ${submission.title}`;
  host.prepend(image);
}

function renderSubmission(submission) {
  const card = document.createElement("article");
  card.className = "review-card";
  card.dataset.submissionId = submission.id;
  const top = document.createElement("div");
  top.className = "review-card-heading";
  const title = document.createElement("h3");
  title.textContent = submission.title;
  const status = document.createElement("span");
  status.className = `submission-status submission-status-${submission.status}`;
  status.textContent = statusLabel(submission.status);
  top.append(title, status);
  const timestamp = document.createElement("time");
  timestamp.className = "project-modified";
  timestamp.dateTime = submission.created_at;
  timestamp.textContent = `Submitted ${dateLabel(submission.created_at)}`;
  const body = document.createElement("div");
  body.className = "review-card-body";
  addDetail(body, "Description", submission.description);
  addDetail(body, "Controls", submission.controls);
  if (submission.cover_image_path) {
    const coverStatus = document.createElement("p");
    coverStatus.className = "review-cover-status";
    coverStatus.textContent = "Loading private cover image…";
    body.prepend(coverStatus);
    void loadCover(submission, body).then(() => coverStatus.remove()).catch(() => {
      coverStatus.textContent = "The private cover image could not be loaded.";
      coverStatus.classList.add("is-error");
    });
  }
  const source = document.createElement("details");
  source.className = "review-source";
  const sourceSummary = document.createElement("summary");
  sourceSummary.textContent = "View Python source (read only)";
  const code = document.createElement("pre");
  code.className = "review-code";
  code.tabIndex = 0;
  code.setAttribute("aria-label", `Read-only source code for ${submission.title}`);
  code.textContent = submission.source_code;
  source.append(sourceSummary, code);
  const actions = document.createElement("div");
  actions.className = "review-action-panel";
  const feedbackField = makeField(
    "Recommendation feedback to the student",
    `review-feedback-${submission.id}`,
    "textarea",
    2000,
    "Write a clear, helpful note (1–2,000 characters).",
  );
  const actionStatusNode = document.createElement("p");
  actionStatusNode.className = "review-action-status";
  actionStatusNode.setAttribute("role", "status");

  {
    const form = document.createElement("form");
    form.className = "review-action-form review-recommendation-form";
    form.append(feedbackField.wrapper);
    const buttons = [];
    for (const [value, label, className] of [
      ["approve", "Recommend approval", "button-primary"],
      ["request_changes", "Request changes", "button-secondary"],
      ["reject", "Recommend not approved", "button-secondary"],
    ]) {
      const button = document.createElement("button");
      button.type = "submit";
      button.name = "recommendation";
      button.value = value;
      button.className = `button ${className} button-small`;
      button.textContent = label;
      buttons.push(button);
      form.append(button);
    }
    form.append(actionStatusNode);
    bindReviewerActions(form, submission, buttons, actionStatusNode);
    actions.append(form);
  }
  if (activeRole === "super_admin") {
    const history = document.createElement("section");
    history.className = "review-recommendations";
    const heading = document.createElement("h4");
    heading.textContent = "Admin recommendations";
    const historyContent = document.createElement("div");
    history.append(heading, historyContent);
    const finalForm = document.createElement("form");
    finalForm.className = "review-action-form review-final-form";
    const finalField = makeField("Final decision note to the student", `final-feedback-${submission.id}`, "textarea", 2000, "Required for either final decision (1–2,000 characters).");
    const decisionStatus = document.createElement("p");
    decisionStatus.className = "review-action-status";
    decisionStatus.setAttribute("role", "status");
    finalForm.append(finalField.wrapper);
    const approve = document.createElement("button");
    approve.type = "submit";
    approve.value = "approve";
    approve.className = "button button-primary button-small";
    approve.textContent = "Approve game";
    const reject = document.createElement("button");
    reject.type = "submit";
    reject.value = "reject";
    reject.className = "button button-secondary button-small";
    reject.textContent = "Reject game";
    finalForm.append(approve, reject, decisionStatus);
    bindApproval(finalForm, submission, [...finalForm.querySelectorAll("button")], decisionStatus);
    actions.append(history, finalForm);
    void loadRecommendationHistory(submission, historyContent).catch((error) => {
      const problem = document.createElement("p");
      problem.className = "is-error";
      problem.textContent = explainError(error);
      historyContent.replaceChildren(problem);
    });
  }
  card.append(top, timestamp, body, source, actions);
  return card;
}

async function refreshQueue() {
  const ownGeneration = ++generation;
  list.replaceChildren();
  message.hidden = false;
  message.classList.remove("is-error");
  message.textContent = "Loading open submissions…";
  try {
    const { data, error } = await supabase.from("game_submissions")
      .select("id,user_id,title,description,controls,source_code,status,created_at,updated_at,cover_image_path")
      .in("status", OPEN_STATUSES)
      .order("created_at", { ascending: true });
    if (error) throw error;
    if (ownGeneration !== generation) return;
    const submissions = data || [];
    count.textContent = `${submissions.length} ${submissions.length === 1 ? "submission" : "submissions"} awaiting a decision`;
    if (!submissions.length) {
      message.textContent = "There are no open submissions right now.";
      return;
    }
    message.hidden = true;
    for (const submission of submissions) list.append(renderSubmission(submission));
  } catch (error) {
    if (ownGeneration !== generation) return;
    message.classList.add("is-error");
    message.textContent = explainError(error);
    count.textContent = "The review queue could not be loaded";
  }
}

async function loadRole(session) {
  activeSession = session;
  if (!session?.user?.id) {
    setAccess("Log in with an admin or super-admin account to review game submissions.", true);
    return;
  }
  const { data, error } = await auth.getProfile(session.user.id);
  if (error || !data) {
    setAccess("We couldn’t verify your reviewer permissions. Refresh the page or log in again.");
    return;
  }
  if (!["admin", "super_admin"].includes(data.role)) {
    setAccess("This page is for admins and super admins. Your account can still use Game Studio and My Games.");
    return;
  }
  activeRole = data.role;
  accessMessage.hidden = true;
  content.hidden = false;
  await refreshQueue();
}

async function initialize() {
  if (!supabase) {
    setAccess("Reviewer tools are unavailable because sign-in is not configured.");
    return;
  }
  const { data, error } = await auth.getSession();
  if (error) {
    setAccess("We couldn’t check your account. Check your connection and refresh the page.");
    return;
  }
  await loadRole(data.session);
  auth.onAuthStateChange((_event, session) => {
    if (session?.user?.id !== activeSession?.user?.id) {
      activeRole = null;
      void loadRole(session);
    }
  });
}

void initialize().catch(() => setAccess("Reviewer tools could not be loaded. Refresh the page and try again."));
