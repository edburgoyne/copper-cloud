"use strict";

const code = document.querySelector("#code");
const canvas = document.querySelector("#preview");
const output = document.querySelector("#console");
const status = document.querySelector("#status");
const runButton = document.querySelector("#run");
const stopButton = document.querySelector("#stop");
const restartButton = document.querySelector("#restart");
const copyButton = document.querySelector("#copy-console");
const copyStatus = document.querySelector("#copy-status");
const editorStatus = document.querySelector("#editor-status");
const errorPanel = document.querySelector("#python-error");
const errorHeading = document.querySelector("#error-heading");
const errorExplanation = document.querySelector("#error-explanation");
const errorLocation = document.querySelector("#error-location");
const errorTraceback = document.querySelector("#error-traceback");
const errorCopyStatus = document.querySelector("#error-copy-status");
const diagnosticSummary = document.querySelector("#diagnostic-summary");
const runtimeDetails = document.querySelector("#runtime-details");
const runtimeConsole = document.querySelector("#runtime-console");
const sourceStatus = document.querySelector("#source-status");
const copySourceButton = document.querySelector("#copy-source");
const demoMode = document.body.dataset.studioMode === "fixed-demo";
const demoSampleId = "dino-runner";
const demoSamplePath = document.body.dataset.sampleSource || "./samples/basic.py";
const runtimeBase = document.body.dataset.runtimeBase || "./site-assets/game-studio-runtime/";
const sandboxUrl = document.body.dataset.sandboxUrl || "./sandbox.html";
const MAX_CODE_BYTES = 5 * 1024 * 1024;
const MAX_OUTPUT = 100 * 1024;
const MAX_DIAGNOSTICS = 24 * 1024;
let trustedSources;
let active = null;
let generation = 0;
let lastCode = null;
let releaseNextTab = false;
let runtimeController = null;
let runtimePromise = null;

code.addEventListener("keydown", (event) => {
  if (demoMode) return;
  if (event.key === "Escape") {
    releaseNextTab = true;
    editorStatus.textContent = "Press Tab or Shift+Tab to move focus out of the editor.";
    return;
  }
  if (event.key !== "Tab") {
    if (!["Shift", "Control", "Alt", "Meta"].includes(event.key)) releaseNextTab = false;
    return;
  }
  if (releaseNextTab) {
    releaseNextTab = false;
    editorStatus.textContent = "";
    return;
  }
  if (event.ctrlKey || event.altKey || event.metaKey) return;
  event.preventDefault();
  const start = code.selectionStart;
  const end = code.selectionEnd;
  if (!event.shiftKey && start === end) {
    code.setRangeText("    ", start, end, "end");
  } else {
    const text = code.value;
    const lineStart = start === 0 ? 0 : text.lastIndexOf("\n", start - 1) + 1;
    const selectionEnd = end > start && text[end - 1] === "\n" ? end - 1 : end;
    const nextBreak = text.indexOf("\n", selectionEnd);
    const lineEnd = nextBreak === -1 ? text.length : nextBreak;
    const lines = text.slice(lineStart, lineEnd).split("\n");
    const changed = lines.map((line) => event.shiftKey ? line.replace(/^(?:\t| {1,4})/, "") : `    ${line}`);
    const firstChange = changed[0].length - lines[0].length;
    const totalChange = changed.reduce((sum, line, index) => sum + line.length - lines[index].length, 0);
    code.setRangeText(changed.join("\n"), lineStart, lineEnd, "start");
    const nextStart = Math.max(lineStart, start + firstChange);
    const nextEnd = start === end ? nextStart : Math.max(nextStart, end + totalChange);
    code.setSelectionRange(nextStart, nextEnd);
  }
  code.dispatchEvent(new Event("input", { bubbles: true }));
});
code.addEventListener("blur", () => { releaseNextTab = false; editorStatus.textContent = ""; });

function setStatus(text, phase) {
  status.textContent = text;
  status.dataset.phase = phase;
}
function appendOutput(text) {
  if (output.textContent.length >= MAX_OUTPUT) return;
  const room = MAX_OUTPUT - output.textContent.length;
  output.textContent += text.slice(0, room);
  if (text.length > room) output.textContent += "\n[Output limit reached.]\n";
  output.scrollTop = output.scrollHeight;
}
function appendDiagnostics(text) {
  if (runtimeConsole.textContent.length >= MAX_DIAGNOSTICS) return;
  const room = MAX_DIAGNOSTICS - runtimeConsole.textContent.length;
  runtimeConsole.textContent += text.slice(0, room);
  if (text.length > room) runtimeConsole.textContent += "\n[Technical details limit reached.]\n";
  runtimeDetails.hidden = false;
}
function clearFeedback() {
  errorPanel.hidden = true;
  errorHeading.textContent = "Python error";
  errorExplanation.textContent = "";
  errorLocation.textContent = "";
  errorTraceback.textContent = "";
  errorCopyStatus.textContent = "";
  diagnosticSummary.hidden = true;
  diagnosticSummary.textContent = "";
  runtimeConsole.textContent = "";
  runtimeDetails.hidden = true;
  runtimeDetails.open = false;
}
function showPythonError(message) {
  errorHeading.textContent = message.errorType || "Python error";
  errorExplanation.textContent = message.explanation || "Python could not finish this program.";
  errorLocation.textContent = message.lineNumber
    ? `main.py, line ${message.lineNumber}${message.sourceLine ? `: ${message.sourceLine}` : ""}`
    : "Source line unavailable.";
  errorTraceback.textContent = message.traceback || "Python traceback unavailable.";
  errorPanel.hidden = false;
  if (message.technical) appendDiagnostics(message.technical);
  setStatus(demoMode
    ? "The bundled sample hit a Python error. Restart it to try again."
    : "Python error. Read the explanation and traceback, then edit and run again.", "error");
}
async function copyText(text, report) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
    await navigator.clipboard.writeText(text);
    report.textContent = "Copied.";
  } catch {
    report.textContent = "Could not copy automatically. Select the text and copy it.";
  }
}
async function readText(path, signal) {
  const response = await fetch(path, { cache: "no-cache", signal });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.text();
}

// Wait briefly for the iframe to terminate its worker before removing the frame.
function dispose(session) {
  if (!session) return Promise.resolve();
  return new Promise((resolve) => {
    let timer;
    function finish() {
      clearTimeout(timer);
      removeEventListener("message", receiveStop);
      session.frame.remove();
      resolve();
    }
    function receiveStop(event) {
      if (event.source === session.frame.contentWindow && event.origin === "null" && event.data?.type === "stopped") finish();
    }
    addEventListener("message", receiveStop);
    timer = setTimeout(finish, 500);
    session.frame.contentWindow?.postMessage({ type: "stop" }, "*");
  });
}

async function stop() {
  const ownGeneration = ++generation;
  runtimeController?.abort();
  runtimeController = null;
  runtimePromise = null;
  runButton.disabled = false;
  const previous = active;
  active = null;
  stopButton.disabled = true;
  setStatus("Stopping…", "stopping");
  await dispose(previous);
  if (generation === ownGeneration) setStatus("Stopped. The worker and its game state were discarded.", "stopped");
}

async function run(source) {
  const program = demoMode ? null : source;
  if (!demoMode) {
    if (new TextEncoder().encode(program).length > MAX_CODE_BYTES) {
      setStatus("The program exceeds the 5 MiB source limit.", "error");
      return;
    }
    if (!program.trim()) {
      setStatus("Enter a Python program first.", "error");
      return;
    }
  }
  const ownGeneration = ++generation;
  const previous = active;
  active = null;
  stopButton.disabled = false;
  output.textContent = "";
  copyStatus.textContent = "";
  clearFeedback();
  setStatus("Loading the Python runtime on first Run…", "loading-runtime");
  await dispose(previous);
  if (generation !== ownGeneration) return;

  if (!trustedSources) {
    runtimeController = new AbortController();
    const controller = runtimeController;
    const loading = Promise.all([
      readText(`${runtimeBase}worker.mjs`, controller.signal),
      readText(`${runtimeBase}error-format.mjs`, controller.signal),
      readText(`${runtimeBase}pygame_bridge.py`, controller.signal),
    ]).then(([workerSource, errorFormatter, bootstrap]) => ({ workerSource, errorFormatter, bootstrap }))
      .then((runtime) => { trustedSources = runtime; return runtime; });
    runtimePromise = loading;
    runButton.disabled = true;
    try { await loading; }
    catch (error) {
      runtimeController = null;
      if (runtimePromise === loading) runtimePromise = null;
      runButton.disabled = false;
      if (generation !== ownGeneration || error.name === "AbortError") return;
      stopButton.disabled = true;
      setStatus(`Could not load Python runtime: ${error.message}`, "error");
      return;
    }
    if (runtimePromise === loading) runtimePromise = null;
    runtimeController = null;
    runButton.disabled = false;
    if (generation !== ownGeneration) return;
  }
  stopButton.disabled = true;

  lastCode = demoMode ? demoSampleId : program;
  restartButton.disabled = false;
  canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
  const frame = document.createElement("iframe");
  frame.title = "Isolated Python worker host";
  frame.hidden = true;
  frame.setAttribute("sandbox", "allow-scripts");
  // Give each run a fresh iframe document, including after local code changes.
  frame.src = demoMode ? sandboxUrl : `${sandboxUrl}?run=${Date.now()}-${ownGeneration}`;
  active = { frame, source: program, started: performance.now(), firstFrame: false, sent: false };
  stopButton.disabled = false;
  document.body.append(frame);
}

addEventListener("message", (event) => {
  const session = active;
  if (!session || event.source !== session.frame.contentWindow || event.origin !== "null" || !event.data || typeof event.data !== "object") return;
  const message = event.data;
  if (message.type === "sandbox-ready" && !session.sent) {
    session.sent = true;
    session.frame.contentWindow.postMessage(demoMode
      ? { type: "start-demo", sample: demoSampleId }
      : { type: "start", code: session.source, ...trustedSources }, "*");
  } else if (message.type === "frame" && Number.isInteger(message.width) && Number.isInteger(message.height) &&
             message.width > 0 && message.height > 0 && message.width <= 1280 && message.height <= 960 &&
             message.pixels instanceof ArrayBuffer && message.pixels.byteLength === message.width * message.height * 4) {
    if (canvas.width !== message.width || canvas.height !== message.height) {
      canvas.width = message.width;
      canvas.height = message.height;
    }
    canvas.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(message.pixels), message.width, message.height), 0, 0);
    if (!session.firstFrame) {
      session.firstFrame = true;
      const elapsed = ((performance.now() - session.started) / 1000).toFixed(2);
      appendOutput(`[First frame: ${elapsed}s after Run]\n`);
      setStatus("Running. Click the preview to focus the keyboard.", "running");
    }
  } else if (message.type === "status" && typeof message.text === "string") {
    setStatus(message.text.slice(0, 1000), session.firstFrame ? "running" : "starting");
    if (message.text.startsWith("Running program")) appendOutput(`[Runtime ready: ${(message.elapsed / 1000).toFixed(2)}s]\n`);
  } else if (message.type === "output" && typeof message.text === "string") {
    appendOutput(message.text.slice(0, 8192));
  } else if (message.type === "python-error" && typeof message.errorType === "string" &&
             typeof message.explanation === "string" && typeof message.traceback === "string") {
    showPythonError(message);
    stopButton.disabled = true;
  } else if (message.type === "error" && typeof message.text === "string") {
    errorHeading.textContent = "Runtime error";
    errorExplanation.textContent = message.text.slice(0, 2000);
    errorLocation.textContent = "";
    errorTraceback.textContent = "";
    errorPanel.hidden = false;
    if (message.technical) appendDiagnostics(message.technical);
    setStatus("The runtime could not complete this program. See the error details.", "error");
    stopButton.disabled = true;
  } else if (message.type === "warning" && typeof message.text === "string") {
    diagnosticSummary.textContent = message.text.slice(0, 1000);
    diagnosticSummary.hidden = false;
    appendDiagnostics(`[Warning] ${message.text.slice(0, 1000)}\n`);
    setStatus(message.text.slice(0, 1000), "warning");
  } else if (message.type === "done") {
    setStatus("Program finished.", "done");
    stopButton.disabled = true;
  }
});

function sendInput(input) {
  active?.frame.contentWindow?.postMessage({ type: "input", input }, "*");
}
for (const type of ["keydown", "keyup"]) {
  canvas.addEventListener(type, (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) event.preventDefault();
    sendInput({ type, code: event.code, key: event.key, repeat: event.repeat });
  });
}
canvas.addEventListener("blur", () => sendInput({ type: "blur" }));
for (const type of ["mousemove", "mousedown", "mouseup"]) {
  canvas.addEventListener(type, (event) => {
    if (type === "mousedown") canvas.focus();
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(canvas.width - 1, Math.floor((event.clientX - rect.left) * canvas.width / rect.width)));
    const y = Math.max(0, Math.min(canvas.height - 1, Math.floor((event.clientY - rect.top) * canvas.height / rect.height)));
    sendInput({ type, x, y, button: event.button + 1 });
  });
}
canvas.addEventListener("contextmenu", (event) => event.preventDefault());
runButton.addEventListener("click", () => run(demoMode ? null : code.value));
stopButton.addEventListener("click", stop);
restartButton.addEventListener("click", () => { if (lastCode !== null) run(demoMode ? null : lastCode); });
copyButton.addEventListener("click", () => copyText(output.textContent, copyStatus));
if (copySourceButton && sourceStatus) copySourceButton.addEventListener("click", () => copyText(code.value, sourceStatus));
document.querySelector("#copy-error").addEventListener("click", () => {
  copyText(`${errorHeading.textContent}\n${errorExplanation.textContent}\n${errorLocation.textContent}\n${errorTraceback.textContent}`, errorCopyStatus);
});
runButton.disabled = true;
async function initializeStudio() {
  try {
    if (demoMode) {
      code.value = await readText(demoSamplePath);
      trustedSources = { fixedSample: demoSampleId };
      if (sourceStatus) sourceStatus.textContent = "Bundled Dino Runner source loaded. The source is read-only.";
      setStatus("Ready. Press Run to start the bundled Dino Runner sample.", "ready");
    } else {
      code.value = await readText(demoSamplePath);
      if (sourceStatus) sourceStatus.textContent = "Starter code loaded. Edit it, then press Run or Save game.";
      setStatus("Ready. Press Run when you want to start the Python runtime.", "ready");
    }
    runButton.disabled = false;
    document.dispatchEvent(new Event("studio-ready"));
  } catch (error) {
    if (sourceStatus) sourceStatus.textContent = "The bundled sample could not be loaded.";
    setStatus(`Could not load Game Studio files: ${error.message}. Serve the site over HTTP.`, "error");
    runButton.disabled = true;
    document.dispatchEvent(new Event("studio-load-error"));
    return;
  }
}
initializeStudio();
