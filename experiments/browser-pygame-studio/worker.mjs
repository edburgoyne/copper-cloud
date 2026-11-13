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
let lastFrame = 0;
setInterval(() => postMessage({ type: "heartbeat" }), 1000);
globalThis.studio_take_input = () => JSON.stringify(pendingInput.splice(0));
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
    if (pendingInput.length < 128 && message.input && typeof message.input === "object") pendingInput.push(message.input);
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
    // PythonError's message includes its traceback; .stack appends noisy Wasm/JS frames.
    const detail = String(error);
    if (/\b(?:SecurityError|NotAllowedError|PermissionError)\b|content security policy|permission denied/i.test(detail)) {
      send("warning", "Access was denied by a browser or runtime restriction. Check the error below and use only supported files, permissions, and network destinations.");
    }
    send("error", detail);
  }
});
