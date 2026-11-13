// Test harness only: runs the same bridge with the pinned Wasm runtime in Node.
import { parentPort, workerData } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const base = new URL("../../../build/browser-studio-runtime-314.0.7/", import.meta.url);
const { loadPyodide } = await import(new URL("pyodide.mjs", base));
const pending = [];
parentPort.on("message", (message) => { if (message?.type === "input") pending.push(message.input); });
globalThis.studio_take_input = () => JSON.stringify(pending.splice(0));
globalThis.studio_should_render = () => true;
globalThis.studio_present = (width, height, bytes) => {
  const view = bytes.getBuffer("u8");
  try {
    const data = view.data;
    let copperX = 0, copperCount = 0, dinoTop = height;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (data[i] === 197 && data[i + 1] === 138 && data[i + 2] === 85) { copperX += x; copperCount++; }
        if (width === 800 && x >= 60 && x < 100 && y < 318 && data[i] < 60 && data[i + 1] < 60 && data[i + 2] < 60) dinoTop = Math.min(dinoTop, y);
      }
    }
    parentPort.postMessage({ type: "frame", width, height, copperX: copperCount ? copperX / copperCount : null, dinoTop });
  } finally { view.release(); }
};

try {
  const started = performance.now();
  const py = await loadPyodide({
    indexURL: fileURLToPath(base),
    stdout: (text) => parentPort.postMessage({ type: "output", text }),
    stderr: (text) => parentPort.postMessage({ type: "output", text }),
  });
  await py.loadPackage("pygame-ce");
  py.runPython(fs.readFileSync(new URL("../pygame_bridge.py", import.meta.url), "utf8"));
  py.globals.set("__studio_source", workerData.code);
  parentPort.postMessage({ type: "running", elapsed: Math.round(performance.now() - started) });
  await py.runPythonAsync("await studio_execute(__studio_source)");
  parentPort.postMessage({ type: "done" });
} catch (error) {
  parentPort.postMessage({ type: "error", text: String(error) });
}
