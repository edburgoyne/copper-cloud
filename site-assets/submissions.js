export const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
export const MAX_COVER_BYTES = 3 * 1024 * 1024;
const COVER_BUCKET = "submission-covers";

function inputError(message) {
  const error = new Error(message);
  error.name = "SubmissionValidationError";
  return error;
}

export function validateSubmission({ title, description, controls }, sourceCode) {
  const clean = {
    title: typeof title === "string" ? title.trim() : "",
    description: typeof description === "string" ? description.trim() : "",
    controls: typeof controls === "string" ? controls.trim() : "",
  };
  if (clean.title.length < 3 || clean.title.length > 100) throw inputError("Title must be 3–100 characters long.");
  if (!clean.description || clean.description.length > 2000) throw inputError("Add a description of up to 2,000 characters.");
  if (!clean.controls || clean.controls.length > 1000) throw inputError("Add controls of up to 1,000 characters.");
  if (typeof sourceCode !== "string" || !sourceCode || new TextEncoder().encode(sourceCode).byteLength > MAX_SOURCE_BYTES) {
    throw inputError("Choose a saved game with Python source no larger than 5 MiB.");
  }
  return clean;
}

export function friendlySubmissionError(error) {
  const message = String(error?.message || "").toLowerCase();
  if (error?.name === "SubmissionValidationError") return error.message;
  if (/choose a saved game first|no saved project selected/.test(message)) return "Choose one of your saved games before submitting.";
  if (/already have three open|three open game submissions/.test(message)) {
    return "You already have 3 games waiting for review. Wait for a decision or update one before submitting another.";
  }
  if (/must be logged in|not signed in|session/.test(message)) return "Log in to submit a game. Your form is saved here.";
  if (/fetch|network|offline|failed to reach/.test(message) || !navigator.onLine) {
    return "We couldn’t reach Copper Cloud. Check your connection and try again.";
  }
  return "We couldn’t submit this game right now. Please try again in a moment.";
}

function coverExtension(file) {
  const extensions = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
  if (!file || !extensions[file.type] || file.size < 1 || file.size > MAX_COVER_BYTES) {
    throw inputError("Choose a PNG, JPEG, or WebP cover image no larger than 3 MiB.");
  }
  return extensions[file.type];
}

export async function signedCoverUrl(client, path) {
  if (!client || !path) return null;
  const { data, error } = await client.storage.from(COVER_BUCKET).createSignedUrl(path, 60);
  if (error) throw error;
  return data?.signedUrl || null;
}

export async function removeCover(client, path) {
  if (!client || !path) return;
  const { error } = await client.storage.from(COVER_BUCKET).remove([path]);
  if (error) throw error;
}

export async function createSubmission(client, fields, sourceCode, coverFile = null) {
  if (!client) throw new Error("Submission is temporarily unavailable. Please try again later.");
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw sessionError;
  if (!sessionData.session?.user?.id) throw new Error("You must be logged in to submit a game.");
  const clean = validateSubmission(fields, sourceCode);
  let path = null;
  if (coverFile) {
    const extension = coverExtension(coverFile);
    const userId = sessionData.session.user.id;
    const objectId = globalThis.crypto?.randomUUID?.();
    if (!objectId) throw new Error("Secure cover uploads are unavailable in this browser. Try a modern browser over HTTPS.");
    path = `${userId}/${objectId}.${extension}`;
    const { error } = await client.storage.from(COVER_BUCKET).upload(path, coverFile, {
      contentType: coverFile.type,
      cacheControl: "3600",
      upsert: false,
    });
    if (error) throw error;
  }
  try {
    const { data, error } = await client.rpc("submit_game", {
      p_title: clean.title,
      p_description: clean.description,
      p_controls: clean.controls,
      p_source_code: sourceCode,
      p_cover_image_path: path,
    });
    if (error) throw error;
    return data;
  } catch (error) {
    if (path) {
      try { await removeCover(client, path); } catch { /* A failed submission must not block best-effort cleanup. */ }
    }
    throw error;
  }
}

export async function updateSubmission(client, submission, fields, sourceCode, { coverFile = null, removeCurrentCover = false } = {}) {
  if (!client || !submission?.id) throw new Error("Submission could not be loaded. Return to My Games and try again.");
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw sessionError;
  if (!sessionData.session?.user?.id) throw new Error("You must be logged in to edit this submission.");
  const clean = validateSubmission(fields, sourceCode);
  if (coverFile && removeCurrentCover) throw inputError("Choose either a new cover image or remove the current image.");
  let path = null;
  if (coverFile) {
    const extension = coverExtension(coverFile);
    const objectId = globalThis.crypto?.randomUUID?.();
    if (!objectId) throw new Error("Secure cover uploads are unavailable in this browser. Try a modern browser over HTTPS.");
    path = `${sessionData.session.user.id}/${objectId}.${extension}`;
    const { error } = await client.storage.from(COVER_BUCKET).upload(path, coverFile, { contentType: coverFile.type, cacheControl: "3600", upsert: false });
    if (error) throw error;
  }
  let updatedAt;
  try {
    const { data, error } = await client.rpc("edit_submission", {
      p_submission_id: submission.id,
      p_title: clean.title,
      p_description: clean.description,
      p_controls: clean.controls,
      p_source_code: sourceCode,
      p_cover_image_path: path,
      p_remove_cover: Boolean(removeCurrentCover),
    });
    if (error) throw error;
    updatedAt = data;
  } catch (error) {
    if (path) {
      try { await removeCover(client, path); } catch { /* Best-effort removal for a replacement rejected by the RPC. */ }
    }
    throw error;
  }
  if ((path || removeCurrentCover) && submission.cover_image_path && submission.cover_image_path !== path) {
    try { await removeCover(client, submission.cover_image_path); } catch { /* Old private objects are harmless if cleanup is temporarily unavailable. */ }
  }
  return {
    updatedAt,
    coverImagePath: path || removeCurrentCover ? path : submission.cover_image_path,
  };
}

export async function listUserSubmissions(client, userId) {
  if (!client || !userId) return [];
  const { data, error } = await client.from("game_submissions")
    .select("id,user_id,title,description,controls,status,created_at,updated_at,cover_image_path")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getSubmissionFeedback(client, submissionId) {
  const { data, error } = await client.rpc("get_submission_feedback", {
    p_submission_id: submissionId,
  });
  if (error) throw error;
  return data || [];
}
