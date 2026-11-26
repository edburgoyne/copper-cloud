import * as auth from "./auth.js";

const grid = document.querySelector("#project-grid");
const count = document.querySelector("#project-count");
const message = document.querySelector("#project-message");
const scope = document.querySelector("#storage-scope");
const DEFAULT_COVER = "./site-assets/game-placeholder.svg";
let projectStore;
let ownerId = "guest";
let refreshGeneration = 0;

function showMessage(text, isError = false) {
  message.hidden = false;
  message.textContent = text;
  message.classList.toggle("is-error", isError);
}

function actionButton(label, action) {
  const button = document.createElement("button");
  button.className = "button button-secondary button-small";
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", async () => {
    if (button.disabled) return;
    button.disabled = true;
    button.textContent = `${label}…`;
    try { await action(); }
    catch (error) { showMessage(error.message || `Could not ${label.toLowerCase()} this game.`, true); }
    finally { if (button.isConnected) { button.disabled = false; button.textContent = label; } }
  });
  return button;
}

function coverUrl(project) {
  if (!project.cover) return DEFAULT_COVER;
  try { return URL.createObjectURL(project.cover); }
  catch { return DEFAULT_COVER; }
}

function renderProject(project) {
  const card = document.createElement("article");
  card.className = "project-card";
  const art = document.createElement("div");
  art.className = "project-thumbnail";
  const image = document.createElement("img");
  image.src = coverUrl(project);
  image.alt = project.cover ? `Cover image for ${project.title}` : "";
  image.addEventListener("error", () => { image.src = DEFAULT_COVER; image.alt = ""; }, { once: true });
  art.append(image);

  const body = document.createElement("div");
  body.className = "project-card-body";
  const title = document.createElement("h3");
  title.textContent = project.title;
  const modified = document.createElement("p");
  modified.className = "project-modified";
  const date = new Date(project.updatedAt);
  modified.textContent = `Last changed ${Number.isNaN(date.getTime()) ? "recently" : date.toLocaleString()}`;
  const actions = document.createElement("div");
  actions.className = "project-card-actions";

  const open = document.createElement("a");
  open.className = "button button-primary button-small";
  open.href = `./game-studio.html?project=${encodeURIComponent(project.id)}`;
  open.textContent = "Open / Edit";
  actions.append(open);
  actions.append(actionButton("Export .py", () => projectStore.exportProjectSource(project.title, project.source)));
  actions.append(actionButton("Rename", async () => {
    const nextTitle = window.prompt("Choose a name for this game.", project.title);
    if (nextTitle === null || !nextTitle.trim()) return;
    await projectStore.renameProject(project.id, nextTitle, ownerId);
    await refresh();
  }));
  const photoLabel = document.createElement("label");
  photoLabel.className = "button button-secondary button-small project-photo-label";
  photoLabel.textContent = "Change card photo";
  const photoInput = document.createElement("input");
  photoInput.type = "file";
  photoInput.accept = "image/png,image/jpeg,image/webp";
  photoInput.setAttribute("aria-label", `Upload a card photo for ${project.title}`);
  photoInput.addEventListener("change", async () => {
    const [file] = photoInput.files || [];
    if (!file) return;
    try {
      await projectStore.updateProjectCard(project.id, ownerId, { cover: file });
      await refresh();
    } catch (error) { showMessage(error.message, true); }
    finally { photoInput.value = ""; }
  });
  photoLabel.append(photoInput);
  actions.append(photoLabel);
  actions.append(actionButton("Delete", async () => {
    if (!window.confirm(`Delete “${project.title}”? This cannot be undone.`)) return;
    await projectStore.deleteProject(project.id, ownerId);
    await refresh();
  }));
  actions.append(actionButton("Submit Game", () => {
    window.dispatchEvent(new CustomEvent("copper-submit-saved-game", { detail: { projectId: project.id } }));
  }));

  body.append(title, modified, actions);
  card.append(art, body);
  return card;
}

async function refresh() {
  const generation = ++refreshGeneration;
  grid.replaceChildren();
  message.hidden = true;
  try {
    projectStore ||= await import("./project-store.js");
    const projects = await projectStore.listProjects(ownerId);
    if (generation !== refreshGeneration) return;
    count.textContent = `${projects.length} ${projects.length === 1 ? "game" : "games"} saved here`;
    if (!projects.length) {
      showMessage("You haven’t saved a game yet. Start in Game Studio, then press Save whenever you’re ready to give your project a name.");
      return;
    }
    for (const project of projects) grid.append(renderProject(project));
  } catch (error) {
    if (generation !== refreshGeneration) return;
    count.textContent = "Your local projects could not be loaded";
    showMessage(`${error.message} You can still create a game in Game Studio and export its source.`, true);
  }
}

async function initialize() {
  try {
    const { data, error } = await auth.getSession();
    if (error) throw error;
    ownerId = data.session?.user?.id || "guest";
    scope.textContent = data.session
      ? "These games are saved in this browser under your signed-in account. Account sync is not available yet."
      : "Your projects are saved in this browser. Browser data can be cleared, and projects do not move between devices, so export the games you want to keep.";
    await refresh();
  } catch {
    ownerId = "guest";
    scope.textContent = "Your projects are saved in this browser. Export important games as .py files for a backup.";
    await refresh();
  }
  try {
    auth.onAuthStateChange((_event, session) => {
      ownerId = session?.user?.id || "guest";
      scope.textContent = session?.user
        ? "These games are saved in this browser under your signed-in account. Account sync is not available yet."
        : "Your projects are saved in this browser. Browser data can be cleared, and projects do not move between devices, so export the games you want to keep.";
      void refresh();
    });
  } catch { /* Browser-local projects remain available if authentication is not configured. */ }
}

void initialize();
