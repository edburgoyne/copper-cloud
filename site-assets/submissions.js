const MAX_SOURCE_BYTES = 100 * 1024;

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
    throw inputError("Choose a saved game with Python source under 100 KiB.");
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

export async function createSubmission(client, fields, sourceCode) {
  if (!client) throw new Error("Submission is temporarily unavailable. Please try again later.");
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw sessionError;
  if (!sessionData.session?.user?.id) throw new Error("You must be logged in to submit a game.");
  const clean = validateSubmission(fields, sourceCode);
  const { data, error } = await client.rpc("submit_game", {
    p_title: clean.title,
    p_description: clean.description,
    p_controls: clean.controls,
    p_source_code: sourceCode,
  });
  if (error) throw error;
  return data;
}

export async function listUserSubmissions(client, userId) {
  if (!client || !userId) return [];
  const { data, error } = await client.from("game_submissions")
    .select("id,user_id,title,description,controls,status,created_at,updated_at")
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
