const DATABASE_NAME = "copper-cloud-projects";
const DATABASE_VERSION = 2;
const PROJECTS_STORE = "projects";
const DRAFTS_STORE = "drafts";
const RECOVERY_KEY = "copper-cloud-studio-recovery-v1";
const MAX_SOURCE_BYTES = 5 * 1024 * 1024;

function openDatabase() {
  if (!globalThis.indexedDB) {
    return Promise.reject(new Error("This browser does not provide local project storage."));
  }
  return new Promise((resolve, reject) => {
    let request;
    try {
      request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    } catch (error) {
      reject(storageError(error));
      return;
    }
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PROJECTS_STORE)) {
        const store = database.createObjectStore(PROJECTS_STORE, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      }
      if (!database.objectStoreNames.contains(DRAFTS_STORE)) database.createObjectStore(DRAFTS_STORE, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(storageError(request.error));
    request.onblocked = () => reject(new Error("Project storage is busy in another tab. Close the other Copper Cloud tab and try again."));
  });
}

function storageError(error) {
  if (error?.name === "QuotaExceededError") {
    return new Error("The browser is out of storage space. Export an important project and try again.");
  }
  if (error?.name === "SecurityError") {
    return new Error("The browser blocked local project storage. Check its privacy settings and try again.");
  }
  return new Error(error?.message || "Local project storage is unavailable in this browser.");
}

async function transact(mode, action, storeName = PROJECTS_STORE) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    let transaction;
    let value;
    let hasValue = false;
    let actionError = null;
    try {
      transaction = database.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      action(store, (result) => { value = result; hasValue = true; }, (error) => { actionError = error; });
    } catch (error) {
      database.close();
      reject(storageError(error));
      return;
    }
    transaction.oncomplete = () => {
      database.close();
      resolve(hasValue ? value : undefined);
    };
    transaction.onerror = () => {
      database.close();
      reject(actionError || storageError(transaction.error));
    };
    transaction.onabort = () => {
      database.close();
      reject(actionError || storageError(transaction.error));
    };
  });
}

function validateTitle(title) {
  if (typeof title !== "string" || !title.trim()) throw new Error("Give this game a name before saving.");
  const clean = title.trim();
  if (clean.length < 3) throw new Error("Game names must be at least 3 characters long.");
  if (clean.length > 100) throw new Error("Game names must be 100 characters or fewer.");
  return clean;
}

function validateSource(source) {
  if (typeof source !== "string") throw new Error("Game source must be text.");
  if (new TextEncoder().encode(source).byteLength > MAX_SOURCE_BYTES) {
    throw new Error("This game is larger than the 5 MiB source limit.");
  }
  return source;
}

function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${crypto.getRandomValues(new Uint32Array(4)).join("-")}`;
}

export async function createProject({ title, source, ownerId = "guest" }) {
  const now = new Date().toISOString();
  const project = {
    id: newId(),
    ownerId,
    title: validateTitle(title),
    source: validateSource(source),
    createdAt: now,
    updatedAt: now,
  };
  await transact("readwrite", (store) => store.add(project));
  return project;
}

export async function getProject(id, ownerId = "guest") {
  if (typeof id !== "string" || !id) return null;
  return transact("readonly", (store, setValue) => {
    const request = store.get(id);
    request.onsuccess = () => setValue(request.result && (request.result.ownerId || "guest") === ownerId ? request.result : null);
  });
}

export async function listProjects(ownerId = "guest") {
  const projects = await transact("readonly", (store, setValue) => {
    const request = store.getAll();
    request.onsuccess = () => setValue(request.result || []);
  });
  return projects.filter((project) => (project.ownerId || "guest") === ownerId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function updateProject(id, source, ownerId = "guest") {
  validateSource(source);
  return transact("readwrite", (store, setValue, fail) => {
    const request = store.get(id);
    request.onsuccess = () => {
      if (!request.result || (request.result.ownerId || "guest") !== ownerId) {
        fail(new Error("This saved game was removed in another tab. Export your changes before leaving."));
        store.transaction.abort();
        return;
      }
      const project = { ...request.result, source, updatedAt: new Date().toISOString() };
      const put = store.put(project);
      put.onsuccess = () => setValue(project);
    };
  });
}

export async function renameProject(id, title, ownerId = "guest") {
  const cleanTitle = validateTitle(title);
  return transact("readwrite", (store, setValue, fail) => {
    const request = store.get(id);
    request.onsuccess = () => {
      if (!request.result || (request.result.ownerId || "guest") !== ownerId) {
        fail(new Error("This saved game was removed in another tab."));
        store.transaction.abort();
        return;
      }
      const project = { ...request.result, title: cleanTitle, updatedAt: new Date().toISOString() };
      const put = store.put(project);
      put.onsuccess = () => setValue(project);
    };
  });
}

export async function updateProjectCard(id, ownerId, patch) {
  if (Object.hasOwn(patch, "title")) patch = { ...patch, title: validateTitle(patch.title) };
  if (Object.hasOwn(patch, "cover")) {
    const cover = patch.cover;
    if (cover && (!(cover instanceof Blob) || !["image/png", "image/jpeg", "image/webp"].includes(cover.type) || cover.size > 3 * 1024 * 1024)) {
      throw new Error("Choose a PNG, JPEG, or WebP image no larger than 3 MiB.");
    }
  }
  return transact("readwrite", (store, setValue, fail) => {
    const request = store.get(id);
    request.onsuccess = () => {
      if (!request.result || (request.result.ownerId || "guest") !== ownerId) {
        fail(new Error("This saved game could not be found."));
        store.transaction.abort();
        return;
      }
      const project = { ...request.result, ...patch, updatedAt: new Date().toISOString() };
      const put = store.put(project);
      put.onsuccess = () => setValue(project);
    };
  });
}

export async function deleteProject(id, ownerId = "guest") {
  return transact("readwrite", (store, _setValue, fail) => {
    const request = store.get(id);
    request.onsuccess = () => {
      if (!request.result || (request.result.ownerId || "guest") !== ownerId) {
        fail(new Error("This saved game could not be found."));
        store.transaction.abort();
        return;
      }
      store.delete(id);
    };
  });
}

function recoveryKey(ownerId) { return `${RECOVERY_KEY}:${ownerId || "guest"}`; }

export async function readRecovery(ownerId = "guest") {
  try {
    const value = localStorage.getItem(recoveryKey(ownerId));
    if (value) {
      const legacy = JSON.parse(value);
      if (typeof legacy.source === "string" && legacy.source && Number.isFinite(legacy.updatedAt)) {
        validateSource(legacy.source);
        if (await writeRecovery(legacy.source, ownerId)) localStorage.removeItem(recoveryKey(ownerId));
      } else localStorage.removeItem(recoveryKey(ownerId));
    }
  } catch { /* Continue with the IndexedDB copy. */ }
  try {
    return await transact("readonly", (store, setValue) => {
      const request = store.get(`studio:${ownerId || "guest"}`);
      request.onsuccess = () => setValue(request.result || null);
    }, DRAFTS_STORE);
  } catch { return null; }
}

export async function writeRecovery(source, ownerId = "guest") {
  try {
    validateSource(source);
    await transact("readwrite", (store) => store.put({ key: `studio:${ownerId || "guest"}`, source, updatedAt: Date.now() }), DRAFTS_STORE);
    return true;
  } catch {
    return false;
  }
}

export async function clearRecovery(ownerId = "guest") {
  try { await transact("readwrite", (store) => store.delete(`studio:${ownerId || "guest"}`), DRAFTS_STORE); } catch { /* Recovery is best-effort. */ }
}

export async function readSubmissionDraft(submissionId) {
  if (!submissionId) return null;
  try {
    return await transact("readonly", (store, setValue) => {
      const request = store.get(`submission:${submissionId}`);
      request.onsuccess = () => setValue(request.result?.draft || null);
    }, DRAFTS_STORE);
  } catch { return null; }
}

export async function writeSubmissionDraft(submissionId, draft) {
  if (!submissionId || !draft || typeof draft.source !== "string") return false;
  try {
    validateSource(draft.source);
    await transact("readwrite", (store) => store.put({ key: `submission:${submissionId}`, draft: { ...draft, updatedAt: Date.now() } }), DRAFTS_STORE);
    return true;
  } catch { return false; }
}

export async function clearSubmissionDraft(submissionId) {
  if (!submissionId) return;
  try { await transact("readwrite", (store) => store.delete(`submission:${submissionId}`), DRAFTS_STORE); } catch { /* Best-effort cleanup. */ }
}

export function projectExportName(title) {
  const safe = String(title || "game")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return `${safe || "game"}.py`;
}

export function exportProjectSource(title, source) {
  const blob = new Blob([source], { type: "text/x-python;charset=utf-8" });
  const anchor = document.createElement("a");
  const objectUrl = URL.createObjectURL(blob);
  anchor.href = objectUrl;
  anchor.download = projectExportName(title);
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}
