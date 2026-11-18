// This worker runs inside the opaque-origin iframe and is destroyed on Stop.
const started = performance.now();
const send = (type, text) => postMessage({ type, text: String(text), elapsed: Math.round(performance.now() - started) });
function policyWarning(event) {
  const directive = String(event.effectiveDirective || event.violatedDirective || "security policy");
  let destination = "";
  try {
    const url = new URL(event.blockedURI);
    if (url.protocol === "http:" || url.protocol === "https:") destination = ` to ${url.origin}`;
  } catch { /* A blocked value can be "eval", "inline", or another non-URL. */ }
  if (directive.startsWith("connect-src")) {
    return `Network request${destination} was blocked. The studio restricts network requests to jsDelivr. Remove other requests or include the data in your code.`;
  }
  if (directive.startsWith("script-src")) {
    return `A script or dynamic-code operation${destination} was blocked by the browser's security policy. Check which scripts and operations the sandbox allows.`;
  }
  if (directive.startsWith("worker-src")) {
    return "Starting another worker was blocked by the browser's security policy.";
  }
  return `A resource or operation${destination} was blocked by the browser's security policy (${directive}).`;
}
addEventListener("securitypolicyviolation", (event) => send("warning", policyWarning(event)));
const pendingInput = [];
const MAX_PENDING_INPUT = 128;
let lastFrame = 0;
setInterval(() => postMessage({ type: "heartbeat" }), 1000);
globalThis.studio_take_input = () => {
  const input = pendingInput.splice(0);
  return JSON.stringify(input);
};
globalThis.studio_should_render = () => performance.now() - lastFrame >= 1000 / 30;
globalThis.studio_present = (width, height, pythonBytes) => {
  const now = performance.now();
  if (now - lastFrame < 1000 / 30) return;
  lastFrame = now;
  let view;
  try {
    view = pythonBytes.getBuffer("u8");
    const pixels = new Uint8ClampedArray(view.data);
    postMessage({ type: "frame", width, height, pixels: pixels.buffer }, [pixels.buffer]);
  } finally {
    if (view) view.release();
  }
};

let startedProgram = false;
addEventListener("message", async (event) => {
  const message = event.data;
  if (!message || typeof message !== "object") return;
  if (message.type === "input") {
    const input = message.input;
    if (!input || typeof input !== "object" || typeof input.type !== "string") return;
    if (input.type === "blur") {
      pendingInput.length = 0;
      pendingInput.push({ type: "blur" });
    } else if (pendingInput.length < MAX_PENDING_INPUT) {
      pendingInput.push(input);
    } else if (input.type === "keyup" || input.type === "mouseup") {
      // Clear held input first so overflow cannot leave a key or button stuck.
      pendingInput.length = 0;
      pendingInput.push({ type: "blur" }, input);
    }
    return;
  }
  if (message.type !== "start" || startedProgram) return;
  startedProgram = true;
  try {
    send("status", "Loading the Python runtime…");
    const { loadPyodide } = await import("https://cdn.jsdelivr.net/pyodide/v314.0.7/full/pyodide.mjs");
    const pyodide = await loadPyodide({
      stdout: (text) => send("output", text + "\n"),
      stderr: (text) => send("output", text + "\n"),
    });
    send("status", "Loading pygame-ce…");
    await pyodide.loadPackage("pygame-ce");
    pyodide.runPython(message.bootstrap);
    pyodide.globals.set("__studio_source", message.code);
    send("status", "Running program. Click the preview to use the keyboard.");
    await pyodide.runPythonAsync("await studio_execute(__studio_source)");
    send("done", "Program finished.");
  } catch (error) {
    // Keep Python's traceback distinct from JavaScript/WebAssembly diagnostics.
    const detail = String(error?.message ?? error);
    if (/\b(?:SecurityError|NotAllowedError|PermissionError)\b|content security policy|permission denied/i.test(detail)) {
      send("warning", "Access was denied by a browser or runtime restriction. Check the error below and use only supported files, permissions, and network destinations.");
    }
    if (/PythonError|Traceback \(most recent call last\)|File ["']main\.py["']/.test(detail)) {
      try {
        const formatted = globalThis.studio_format_python_error(error, message.code);
        postMessage({ type: "python-error", ...formatted });
      } catch (formatError) {
        send("error", `Python error could not be formatted: ${String(formatError?.message ?? formatError)}`);
      }
    } else {
      postMessage({ type: "error", text: detail.slice(0, 8192), technical: String(error?.stack ?? error).slice(0, 24000) });
    }
  }
});
