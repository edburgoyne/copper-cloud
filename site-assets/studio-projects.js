import * as auth from "./auth.js";

const code = document.querySelector("#code");
const saveButton = document.querySelector("#save-project");
const saveState = document.querySelector("#save-state");
const titleNode = document.querySelector("#project-title");
const notice = document.querySelector("#project-notice");
const sourceStatus = document.querySelector("#source-status");
const importInput = document.querySelector("#import-file");
const restoreButton = document.querySelector("#restore-draft");
const MAX_SOURCE_BYTES = 100 * 1024;
let projects;
let ownerId = "guest";
let activeProject = null;
let edited = false;
let saveVersion = 0;
let saveTimer = null;
let saveChain = Promise.resolve();

function showNotice(text, error = false) {
  notice.textContent = text;
  notice.classList.toggle("is-error", error);
}

function showSaveState(text, error = false) {
  saveState.textContent = text;
  saveState.classList.toggle("is-error", error);
}

function validateSource(source) {
  if (new TextEncoder().encode(source).byteLength > MAX_SOURCE_BYTES) throw new Error("This game is larger than the 100 KiB source limit.");
}

function scheduleAutosave() {
  const version = ++saveVersion;
  edited = true;
  projects.writeRecovery(code.value, ownerId);
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
        projects.clearRecovery(ownerId);
        showSaveState("Saved");
      }
    }).catch((error) => {
      showSaveState(`Could not autosave: ${error.message}`, true);
    });
  }, 700);
}

async function saveProject() {
  if (saveButton.disabled) return;
  saveButton.disabled = true;
  saveButton.textContent = "Saving…";
  try {
    validateSource(code.value);
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
    projects.clearRecovery(ownerId);
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
  anchor.download = safeFilename(activeProject?.title || "game");
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(href), 0);
}

async function importSource() {
  const [file] = importInput.files || [];
  if (!file) return;
  try {
    if (!file.name.toLowerCase().endsWith(".py")) throw new Error("Choose a file ending in .py.");
    if (file.size > MAX_SOURCE_BYTES) throw new Error("Python files must be 100 KiB or smaller.");
    if (activeProject && !window.confirm("Replace the code in this saved game with the imported file?")) return;
    let source;
    try { source = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()); }
    catch { throw new Error("This file is not valid UTF-8 Python source."); }
    validateSource(source);
    code.value = source;
    code.dispatchEvent(new Event("input", { bubbles: true }));
    sourceStatus.textContent = `Imported ${file.name}. The code has not been run.`;
    showNotice("Imported source. Save it to update the saved game.");
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
  const id = new URLSearchParams(location.search).get("project");
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
  const recovery = projects.readRecovery(ownerId);
  restoreButton.hidden = !recovery || recovery.source === code.value;
  restoreButton.addEventListener("click", () => {
    const draft = projects.readRecovery(ownerId);
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
    if (!edited) showSaveState(activeProject ? "Saved" : "Draft · save game to keep it");
  }, { once: true });
  try {
    auth.onAuthStateChange((_event, session) => {
      const nextOwner = session?.user?.id || "guest";
      if (nextOwner !== ownerId) {
        projects.writeRecovery(code.value, ownerId);
        location.reload();
      }
    });
  } catch { /* Local projects work when sign-in is unavailable. */ }
  if (document.querySelector("#status")?.dataset.phase === "ready") document.dispatchEvent(new Event("studio-ready"));
}

void initializeProjects().catch((error) => {
  showNotice(`Project storage is unavailable: ${error.message}`, true);
  saveButton.disabled = true;
});
