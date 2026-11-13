// Runs the real Pyodide/pygame-ce Wasm and adapter in Node workers, not a browser.
import assert from "node:assert/strict";
import fs from "node:fs";
import { Worker } from "node:worker_threads";

const base = new URL("../", import.meta.url);
const workerURL = new URL("./node-worker.mjs", import.meta.url);
const basic = fs.readFileSync(new URL("samples/basic.py", base), "utf8");
const dino = fs.readFileSync(new URL("../../games/site_games/dino-runner/main.py", base), "utf8");
const exception = fs.readFileSync(new URL("samples/exception.py", base), "utf8");
const infinite = fs.readFileSync(new URL("samples/infinite.py", base), "utf8");

function createRun(code) {
  const worker = new Worker(workerURL, { workerData: { code } });
  const messages = [];
  let changed = () => {};
  worker.on("message", (message) => { messages.push(message); changed(); });
  worker.on("error", (error) => { messages.push({ type: "error", text: error.stack }); changed(); });
  async function waitFor(predicate, timeoutMs = 25000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const match = messages.find(predicate);
      if (match) return match;
      const failure = messages.find((message) => message.type === "error");
      if (failure) throw new Error(failure.text);
      if (Date.now() >= deadline) throw new Error(`Timed out. Recent messages: ${JSON.stringify(messages.slice(-5))}`);
      await new Promise((resolve) => { changed = resolve; setTimeout(resolve, 100); });
    }
  }
  return { worker, messages, waitFor };
}
async function withRun(source, fn) {
  const run = createRun(source);
  try { return await fn(run); } finally { await run.worker.terminate(); }
}

await withRun(basic, async ({ worker, waitFor }) => {
  const initial = await waitFor((m) => m.type === "frame" && m.copperX !== null);
  worker.postMessage({ type: "input", input: { type: "keydown", code: "ArrowRight", key: "ArrowRight" } });
  const moved = await waitFor((m) => m.type === "frame" && m.copperX > initial.copperX + 12);
  assert.ok(moved.copperX > initial.copperX);
  console.log(`PASS real Pygame surface and keyboard: x ${initial.copperX.toFixed(1)} → ${moved.copperX.toFixed(1)}`);
});
await withRun(dino, async ({ worker, waitFor }) => {
  const initial = await waitFor((m) => m.type === "frame" && m.width === 800 && m.dinoTop < 318);
  worker.postMessage({ type: "input", input: { type: "keydown", code: "Space", key: " " } });
  const jumping = await waitFor((m) => m.type === "frame" && m.width === 800 && m.dinoTop < initial.dinoTop - 25);
  assert.ok(jumping.dinoTop < initial.dinoTop);
  console.log(`PASS original Dino Runner source and jump: top ${initial.dinoTop} → ${jumping.dinoTop}`);
});
await withRun(exception, async ({ messages, worker }) => {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Exception test timed out")), 25000);
    worker.on("message", (message) => {
      if (message.type === "error") { clearTimeout(timer); resolve(); }
    });
  });
  assert.match(messages.find((m) => m.type === "error").text, /ValueError: The sample exception reached the console/);
  assert.match(messages.find((m) => m.type === "error").text, /main\.py/);
  console.log("PASS exception includes a Python traceback");
});
{
  const run = createRun(infinite);
  await run.waitFor((m) => m.type === "running");
  await new Promise((resolve) => setTimeout(resolve, 250));
  const start = performance.now();
  await run.worker.terminate();
  assert.ok(performance.now() - start < 3000);
  console.log(`PASS terminate non-yielding Python worker: ${Math.round(performance.now() - start)} ms`);
}
for (const marker of ["FIRST_RUN", "SECOND_RUN"]) {
  await withRun(`print('${marker}')`, async ({ waitFor, messages }) => {
    await waitFor((m) => m.type === "done");
    assert.ok(messages.some((m) => m.type === "output" && m.text.includes(marker)));
    assert.ok(!messages.some((m) => m.type === "output" && m.text.includes(marker === "FIRST_RUN" ? "SECOND_RUN" : "FIRST_RUN")));
  });
}
console.log("PASS repeated runs use independent workers");
console.log("Node/Wasm tests complete. These do not establish browser or sandbox behavior.");
