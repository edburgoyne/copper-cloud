// Development-host Node/Wasm benchmark. This is not a browser or Chromebook result.
import fs from "node:fs";
import { Worker } from "node:worker_threads";

const base = new URL("../", import.meta.url);
const workerURL = new URL("./node-worker.mjs", import.meta.url);
const sources = {
  movingShape: fs.readFileSync(new URL("samples/basic.py", base), "utf8"),
  dinoRunner: fs.readFileSync(new URL("../../games/site_games/dino-runner/main.py", base), "utf8"),
  moderate: fs.readFileSync(new URL("samples/performance.py", base), "utf8"),
};

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

function launch(source) {
  const started = performance.now();
  const worker = new Worker(workerURL, { workerData: { code: source, measureFrames: true } });
  const frames = [];
  const waiters = [];
  let failure = null;
  let readyAt = null;
  worker.on("message", (message) => {
    if (message.type === "running") readyAt = performance.now();
    if (message.type === "frame") frames.push({ at: performance.now(), width: message.width, height: message.height });
    if (message.type === "error" || message.type === "python-error") failure = message;
    for (const waiter of [...waiters]) {
      if (failure) waiter.reject(new Error(JSON.stringify(failure)));
      else if (waiter.predicate(message)) waiter.resolve(message);
    }
  });
  worker.on("error", (error) => { failure = { type: "worker-error", text: error.message }; });
  function waitFor(predicate, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, reject };
      const timeout = setTimeout(() => {
        waiters.splice(waiters.indexOf(waiter), 1);
        reject(new Error("Timed out waiting for the benchmark worker."));
      }, timeoutMs);
      waiter.resolve = (value) => { clearTimeout(timeout); waiters.splice(waiters.indexOf(waiter), 1); resolve(value); };
      waiter.reject = (error) => { clearTimeout(timeout); waiters.splice(waiters.indexOf(waiter), 1); reject(error); };
      waiters.push(waiter);
    });
  }
  return { worker, frames, started, readyAt: () => readyAt, waitFor };
}

async function measure(name, source, sampleMs = 2500) {
  const baselineMemory = process.memoryUsage();
  const run = launch(source);
  let ready;
  try {
    ready = await run.waitFor((message) => message.type === "running");
    await run.waitFor((message) => message.type === "frame");
    const firstFrameMs = run.frames[0].at - run.started;
    const runtimeReadyWallMs = run.readyAt() - run.started;
    const sampleStart = performance.now();
    const cpuStart = process.cpuUsage();
    await new Promise((resolve) => setTimeout(resolve, sampleMs));
    const cpu = process.cpuUsage(cpuStart);
    const sampleEnd = performance.now();
    const sampled = run.frames.filter((frame) => frame.at >= sampleStart && frame.at <= sampleEnd);
    const intervals = sampled.slice(1).map((frame, index) => frame.at - sampled[index].at);
    const meanMs = intervals.length ? intervals.reduce((sum, value) => sum + value, 0) / intervals.length : null;
    const jitterMs = intervals.length && meanMs !== null
      ? Math.sqrt(intervals.reduce((sum, value) => sum + (value - meanMs) ** 2, 0) / intervals.length)
      : null;
    const fps = sampled.length > 1
      ? (sampled.length - 1) * 1000 / (sampled.at(-1).at - sampled[0].at)
      : 0;
    const rssAtSample = process.memoryUsage().rss;
    const cpuPercent = (cpu.user + cpu.system) / ((sampleEnd - sampleStart) * 1000) * 100;
    const stopStarted = performance.now();
    await run.worker.terminate();
    const stopMs = performance.now() - stopStarted;
    return {
      name,
      runtimeReadyWorkerMs: ready.elapsed,
      runtimeReadyWallMs,
      firstFrameMs,
      frames: sampled.length,
      fps: Number(fps.toFixed(1)),
      meanFrameMs: meanMs === null ? null : Number(meanMs.toFixed(2)),
      p95FrameMs: percentile(intervals, 0.95) === null ? null : Number(percentile(intervals, 0.95).toFixed(2)),
      frameJitterStdDevMs: jitterMs === null ? null : Number(jitterMs.toFixed(2)),
      frameBytes: run.frames[0].width * run.frames[0].height * 4,
      transferredMiBPerSecond: Number((fps * run.frames[0].width * run.frames[0].height * 4 / (1024 * 1024)).toFixed(2)),
      wasmMemoryMiB: ready.wasmBytes === null ? null : Number((ready.wasmBytes / 1024 / 1024).toFixed(1)),
      processRssMiB: Number((rssAtSample / 1024 / 1024).toFixed(1)),
      processRssDeltaMiB: Number(((rssAtSample - baselineMemory.rss) / 1024 / 1024).toFixed(1)),
      processHeapUsedMiB: Number((process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1)),
      processCpuPercentApprox: Number(cpuPercent.toFixed(1)),
      stopMs: Number(stopMs.toFixed(2)),
    };
  } catch (error) {
    await run.worker.terminate();
    throw error;
  }
}

async function stopAndRestartCycle(index) {
  const run = launch(sources.movingShape);
  await run.waitFor((message) => message.type === "running");
  await run.waitFor((message) => message.type === "frame");
  const restartMs = performance.now() - run.started;
  const stopStarted = performance.now();
  await run.worker.terminate();
  return { cycle: index, restartToFirstFrameMs: Number(restartMs.toFixed(1)), stopMs: Number((performance.now() - stopStarted).toFixed(2)) };
}

const sizes = [];
for (const name of ["pyodide.mjs", "pyodide.asm.mjs", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json", "pygame_ce-2.5.7-cp314-cp314-pyemscripten_2026_0_wasm32.whl"]) {
  const file = new URL(`../../../build/browser-studio-runtime-314.0.7/${name}`, import.meta.url);
  if (fs.existsSync(file)) sizes.push({ name, bytes: fs.statSync(file).size });
}
const benchmarks = [];
benchmarks.push(await measure("cold local-runtime moving shape", sources.movingShape));
benchmarks.push(await measure("warm local-runtime moving shape", sources.movingShape));
benchmarks.push(await measure("Dino Runner", sources.dinoRunner));
benchmarks.push(await measure("moderate draw/transform workload", sources.moderate));
const cycles = [];
for (let cycle = 1; cycle <= 3; cycle += 1) cycles.push(await stopAndRestartCycle(cycle));
console.log(JSON.stringify({
  note: "Node 24.14.1 + local Pyodide files; Node/Wasm results are not browser or Chromebook results.",
  runtimeFileBytes: sizes,
  runtimeTotalBytes: sizes.reduce((sum, file) => sum + file.bytes, 0),
  benchmarks,
  stopRestartCycles: cycles,
}, null, 2));
