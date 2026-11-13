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
const MAX_CODE_BYTES = 100 * 1024;
const MAX_OUTPUT = 100 * 1024;
let trustedSources;
let active = null;
let generation = 0;
let lastCode = null;
let releaseNextTab = false;

code.addEventListener("keydown", (event) => {
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
async function readText(path) {
  const response = await fetch(path, { cache: "no-cache" });
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
  const previous = active;
  active = null;
  stopButton.disabled = true;
  setStatus("Stopping…", "stopping");
  await dispose(previous);
  if (generation === ownGeneration) setStatus("Stopped. The worker and its game state were discarded.", "stopped");
}

async function run(source) {
  if (!trustedSources) return;
  if (new TextEncoder().encode(source).length > MAX_CODE_BYTES) {
    setStatus("The program exceeds the 100 KiB source limit.", "error");
    return;
  }
  if (!source.trim()) {
    setStatus("Enter a Python program first.", "error");
    return;
  }
  const ownGeneration = ++generation;
  const previous = active;
  active = null;
  stopButton.disabled = true;
  output.textContent = "";
  copyStatus.textContent = "";
  setStatus("Starting isolated worker…", "starting");
  await dispose(previous);
  if (generation !== ownGeneration) return;

  lastCode = source;
  restartButton.disabled = false;
  canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
  const frame = document.createElement("iframe");
  frame.title = "Isolated Python worker host";
  frame.hidden = true;
  frame.setAttribute("sandbox", "allow-scripts");
  // Give each run a fresh iframe document, including after local code changes.
  frame.src = `./sandbox.html?run=${Date.now()}-${ownGeneration}`;
  active = { frame, source, started: performance.now(), firstFrame: false, sent: false };
  stopButton.disabled = false;
  document.body.append(frame);
}

addEventListener("message", (event) => {
  const session = active;
  if (!session || event.source !== session.frame.contentWindow || event.origin !== "null" || !event.data || typeof event.data !== "object") return;
  const message = event.data;
  if (message.type === "sandbox-ready" && !session.sent) {
    session.sent = true;
    session.frame.contentWindow.postMessage({ type: "start", code: session.source, ...trustedSources }, "*");
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
  } else if (message.type === "error" && typeof message.text === "string") {
    appendOutput(`\n${message.text.slice(0, 8192)}\n`);
    setStatus("Program or runtime error. See the console.", "error");
  } else if (message.type === "warning" && typeof message.text === "string") {
    appendOutput(`\n[Warning] ${message.text.slice(0, 1000)}\n`);
    setStatus(message.text.slice(0, 1000), "warning");
  } else if (message.type === "done") {
    setStatus("Program finished.", "done");
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
runButton.addEventListener("click", () => run(code.value));
stopButton.addEventListener("click", stop);
restartButton.addEventListener("click", () => { if (lastCode !== null) run(lastCode); });
copyButton.addEventListener("click", async () => {
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
    await navigator.clipboard.writeText(output.textContent);
    copyStatus.textContent = "Console copied.";
  } catch {
    copyStatus.textContent = "Could not copy automatically. Select the console text and copy it.";
  }
});
runButton.disabled = true;
Promise.all([readText("./worker.mjs"), readText("./pygame_bridge.py"), readText("./samples/basic.py")])
  .then(([workerSource, bootstrap, example]) => {
    trustedSources = { workerSource, bootstrap };
    code.value = example;
    runButton.disabled = false;
    setStatus("Ready. Press Run to download the runtime and start the example.", "ready");
  })
  .catch((error) => setStatus(`Could not load experiment files: ${error.message}. Serve this directory over HTTP.`, "error"));
