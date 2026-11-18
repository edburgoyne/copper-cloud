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
const compatibility = fs.readFileSync(new URL("samples/compatibility.py", base), "utf8");
const inputSample = fs.readFileSync(new URL("samples/input.py", base), "utf8");

function createRun(code, options = {}) {
  const startedAt = performance.now();
  const worker = new Worker(workerURL, { workerData: { code, ...options } });
  const messages = [];
  const frames = [];
  let changed = () => {};
  worker.on("message", (message) => {
    if (message.type === "frame") {
      frames.push({ at: performance.now(), width: message.width, height: message.height });
      delete message.pixels;
    }
    messages.push(message);
    changed();
  });
  worker.on("error", (error) => { messages.push({ type: "error", text: error.stack }); changed(); });
  async function waitFor(predicate, timeoutMs = 25000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const match = messages.find(predicate);
      if (match) return match;
      const failure = messages.find((message) => ["error", "python-error"].includes(message.type));
      if (failure) throw new Error(failure.text || JSON.stringify({
        failure,
        recentOutput: messages.filter((message) => message.type === "output").slice(-12),
      }));
      if (Date.now() >= deadline) throw new Error(`Timed out. Recent messages: ${JSON.stringify(messages.slice(-5))}`);
      await new Promise((resolve) => { changed = resolve; setTimeout(resolve, 100); });
    }
  }
  return { worker, messages, frames, startedAt, waitFor };
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
      if (message.type === "python-error") { clearTimeout(timer); resolve(); }
    });
  });
  const error = messages.find((m) => m.type === "python-error");
  assert.equal(error.errorType, "ValueError");
  assert.equal(error.lineNumber, 2);
  assert.match(error.sourceLine, /raise ValueError/);
  assert.match(error.traceback, /ValueError: The sample exception reached the console/);
  assert.match(error.explanation, /value/);
  assert.match(error.technical, /PythonError/);
  console.log("PASS beginner-readable Python exception, source line, traceback, and technical details");
});
await withRun(compatibility, async ({ messages, waitFor }) => {
  await waitFor((message) => message.type === "done");
  assert.ok(messages.some((message) => message.type === "output" && message.text.includes("COMPATIBILITY_OK")));
  console.log("PASS Pygame surfaces, Rect, transforms, alpha, sprites, image I/O, fonts, clock, and display");
});
await withRun(inputSample, async ({ worker, messages, waitFor }) => {
  const send = (input) => worker.postMessage({ type: "input", input });
  await waitFor((message) => message.type === "output" && message.text.includes("INPUT_READY"));
  send({ type: "keydown", code: "KeyA", key: "a", repeat: false });
  await waitFor((message) => message.type === "output" && message.text.includes("KEY_A_DOWN_OK"));
  send({ type: "keyup", code: "KeyA", key: "a", repeat: false });
  await waitFor((message) => message.type === "output" && message.text.includes("KEY_A_UP_OK"));
  send({ type: "keydown", code: "KeyB", key: "b", repeat: false });
  await waitFor((message) => message.type === "output" && message.text.includes("KEY_B_HELD_OK"));
  send({ type: "blur" });
  await waitFor((message) => message.type === "output" && message.text.includes("BLUR_RELEASE_OK"));
  send({ type: "mousemove", x: 50, y: 30, button: 0 });
  send({ type: "mousedown", x: 50, y: 30, button: 1 });
  await waitFor((message) => message.type === "output" && message.text.includes("MOUSE_DOWN_OK"));
  send({ type: "mouseup", x: 50, y: 30, button: 1 });
  await waitFor((message) => message.type === "output" && message.text.includes("MOUSE_UP_OK"));
  send({ type: "mousedown", x: 50, y: 30, button: 1 });
  await waitFor((message) => message.type === "output" && message.text.includes("MOUSE_BLUR_HELD_OK"));
  send({ type: "blur" });
  await waitFor((message) => message.type === "output" && message.text.includes("MOUSE_BLUR_RELEASE_OK"));
  await waitFor((message) => message.type === "done");
  assert.ok(messages.some((message) => message.type === "output" && message.text.includes("INPUT_OK")));
  console.log("PASS key events, held keys, blur releases, mouse position, and mouse buttons");
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
const stateA = createRun(`
import asyncio, pygame
leak_marker = 'GAME_A_GLOBAL'
pygame.init()
pygame.display.set_mode((40, 30))
open('studio-isolation.tmp', 'w').write('GAME_A_FILE')
async def background():
    await asyncio.sleep(3600)
async def main():
    asyncio.create_task(background())
    assert len(asyncio.all_tasks()) >= 2
    print('ISOLATION_A_READY')
    while True:
        pygame.event.get()
        if pygame.key.get_pressed()[pygame.K_RIGHT]:
            print('ISOLATION_A_KEY_HELD')
            return
        await asyncio.sleep(0)
asyncio.run(main())
`);
try {
  await stateA.waitFor((message) => message.type === "output" && message.text.includes("ISOLATION_A_READY"));
  stateA.worker.postMessage({ type: "input", input: { type: "keydown", code: "ArrowRight", key: "ArrowRight", repeat: false } });
  await stateA.waitFor((message) => message.type === "output" && message.text.includes("ISOLATION_A_KEY_HELD"));
  await stateA.waitFor((message) => message.type === "done");
} finally {
  await stateA.worker.terminate();
}
await withRun(`
import asyncio, os, pygame
assert 'leak_marker' not in globals()
assert not os.path.exists('studio-isolation.tmp')
assert pygame.display.get_surface() is None
assert not pygame.key.get_pressed()[pygame.K_RIGHT]
assert len(asyncio.all_tasks()) == 1
print('STATE_ISOLATION_OK')
`, async ({ waitFor, messages }) => {
  await waitFor((message) => message.type === "done");
  assert.ok(messages.some((message) => message.type === "output" && message.text.includes("STATE_ISOLATION_OK")));
  assert.ok(!messages.some((message) => message.type === "output" && message.text.includes("GAME_A_FILE")));
});
console.log("PASS globals, Pygame display/input, virtual files, and pending task isolation across worker replacement");
console.log("Node/Wasm tests complete. These do not establish browser or sandbox behavior.");
