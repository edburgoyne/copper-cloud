// Headed Chromium smoke tests over the built-in Chrome DevTools Protocol.
// No Playwright dependency is installed in this environment. This script keeps
// a temporary browser profile and serves the experiment plus built site on loopback.
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const experimentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(experimentRoot, "..", "..");
const buildRoot = path.join(repositoryRoot, "build");
const publicRoot = path.join(buildRoot, "site");
const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const profileRoot = fs.mkdtempSync(path.join(buildRoot, "studio-chrome-profile-"));
const browserSources = {
  dinoRunner: fs.readFileSync(path.join(repositoryRoot, "games", "site_games", "dino-runner", "main.py"), "utf8"),
  moderate: fs.readFileSync(path.join(experimentRoot, "samples", "performance.py"), "utf8"),
  securityProbe: fs.readFileSync(path.join(experimentRoot, "samples", "security_probe.py"), "utf8"),
};
const passed = [];
let failPublicSandboxOnce = false;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function record(result) {
  passed.push(result);
  console.log(`PASS ${result}`);
}

function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".js") || file.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".py") || file.endsWith(".md")) return "text/plain; charset=utf-8";
  if (file.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

const server = http.createServer((request, response) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname); }
  catch { response.writeHead(400).end("Bad request"); return; }
  const publicPrefix = "/__public/";
  const isPublic = pathname.startsWith(publicPrefix);
  const root = isPublic ? publicRoot : experimentRoot;
  const localPath = isPublic ? pathname.slice(publicPrefix.length) : pathname.replace(/^\//, "");
  const file = path.resolve(root, localPath || "index.html");
  if (!file.startsWith(root + path.sep) && file !== path.join(root, "index.html")) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  fs.readFile(file, (error, data) => {
    if (error) { response.writeHead(404).end("Not found"); return; }
    if (isPublic && failPublicSandboxOnce && pathname.endsWith("/game-studio-runtime/sandbox.html")) {
      failPublicSandboxOnce = false;
      const original = "launchWorker(runtime, PUBLIC_DEMO_BUNDLE.samples[message.sample]);";
      const injected = data.toString("utf8").replace(original, "send({ type: \"error\", text: \"Test-only runtime startup failure.\" });");
      if (injected === data.toString("utf8")) {
        response.writeHead(500).end("Could not inject the one-time test failure.");
        return;
      }
      data = Buffer.from(injected, "utf8");
    }
    response.writeHead(200, { "content-type": contentType(file), "cache-control": "no-store" });
    response.end(data);
  });
});

function listen(serverInstance) {
  return new Promise((resolve, reject) => {
    serverInstance.once("error", reject);
    serverInstance.listen(0, "127.0.0.1", () => {
      serverInstance.removeListener("error", reject);
      resolve(serverInstance.address().port);
    });
  });
}

async function freePort() {
  const reservation = net.createServer();
  const port = await listen(reservation);
  await new Promise((resolve) => reservation.close(resolve));
  return port;
}

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
    });
  }
  call(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.call("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Page evaluation failed");
    return result.result?.value;
  }
}

async function waitFor(cdp, expression, description, timeoutMs = 90000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const value = await cdp.evaluate(expression);
      if (value) return value;
    } catch { /* Navigation can destroy the current execution context briefly. */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const state = await cdp.evaluate("({status:document.querySelector('#status')?.textContent,phase:document.querySelector('#status')?.dataset.phase,output:document.querySelector('#console')?.textContent.slice(-1200)})");
  throw new Error(`Timed out waiting for ${description}: ${JSON.stringify(state)}`);
}

async function setSource(cdp, source) {
  await cdp.evaluate(`(() => { window.__studioRunStartedAt=performance.now(); window.__studioFrameTimes=[]; const editor=document.querySelector('#code'); editor.value=${JSON.stringify(source)}; editor.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('#run').click(); return true; })()`);
}

async function measureRunningBrowserRun(cdp, name) {
  return cdp.evaluate(`new Promise(resolve => setTimeout(() => {
    const frames = window.__studioFrameTimes || [];
    const intervals = frames.slice(1).map((time, index) => time - frames[index]).filter(value => value > 0);
    const sorted = [...intervals].sort((a, b) => a - b);
    const mean = intervals.length ? intervals.reduce((sum, value) => sum + value, 0) / intervals.length : 0;
    const jitter = intervals.length ? Math.sqrt(intervals.reduce((sum, value) => sum + (value - mean) ** 2, 0) / intervals.length) : 0;
    const text = document.querySelector('#console').textContent;
    const ready = text.match(/Runtime ready: ([0-9.]+)s/);
    const first = text.match(/First frame: ([0-9.]+)s after Run/);
    resolve({
      workload: ${JSON.stringify(name)},
      runtimeReadySeconds: ready ? Number(ready[1]) : null,
      firstFrameSeconds: first ? Number(first[1]) : null,
      frames: frames.length,
      fps: intervals.length && frames.at(-1) > frames[0] ? Number(((frames.length - 1) * 1000 / (frames.at(-1) - frames[0])).toFixed(1)) : 0,
      meanFrameMs: Number(mean.toFixed(2)),
      p95FrameMs: sorted.length ? Number(sorted[Math.floor((sorted.length - 1) * 0.95)].toFixed(2)) : null,
      frameJitterStdDevMs: Number(jitter.toFixed(2)),
      mainPageHeapMiB: performance.memory ? Number((performance.memory.usedJSHeapSize / 1048576).toFixed(1)) : null,
    });
  }, 2500))`);
}

async function measureBrowserRun(cdp, name, source) {
  await setSource(cdp, source);
  await waitFor(cdp, "document.querySelector('#status')?.dataset.phase === 'running'", `${name} first frame`, 90000);
  const measurement = await measureRunningBrowserRun(cdp, name);
  measurement.stopToUiMs = await cdp.evaluate(`new Promise(resolve => {
    const node = document.querySelector('#status');
    const started = performance.now();
    if (node.dataset.phase === 'stopped') return resolve(0);
    const observer = new MutationObserver(() => {
      if (node.dataset.phase !== 'stopped') return;
      observer.disconnect();
      clearTimeout(timeout);
      resolve(Number((performance.now() - started).toFixed(2)));
    });
    const timeout = setTimeout(() => { observer.disconnect(); resolve(null); }, 10000);
    observer.observe(node, { attributes: true, attributeFilter: ['data-phase'] });
    document.querySelector('#stop').click();
  })`);
  assert(measurement.stopToUiMs !== null, `${name} worker stop did not reach the UI`);
  return measurement;
}

async function testPublicDemo(cdp, port) {
  await cdp.call("Page.navigate", { url: "http://127.0.0.1:" + port + "/__public/game-studio.html?code=raise%20ValueError%28%27url%20source%20must%20not%20run%27%29" });
  await waitFor(cdp, "document.body.dataset.studioMode === 'fixed-demo' && document.querySelector('#source-status')?.textContent.includes('read-only')", "public fixed-source Game Studio page");
  const publicReady = await cdp.evaluate("(() => { const editor=document.querySelector('#code'); return {readOnly:editor.readOnly,source:editor.value,runDisabled:document.querySelector('#run').disabled,stopDisabled:document.querySelector('#stop').disabled,restartDisabled:document.querySelector('#restart').disabled,authUI:!!document.querySelector('[data-auth], [data-supabase], input[type=password]')}; })()");
  assert(publicReady.readOnly && publicReady.source.includes("Dino Game") && !publicReady.runDisabled, "Public page did not load its read-only sample and enable Run");
  assert(publicReady.stopDisabled && publicReady.restartDisabled && !publicReady.authUI, "Public demo controls or unauthenticated page state were incorrect before the first run");
  await cdp.evaluate("window.__publicOriginalSource=document.querySelector('#code').value; document.querySelector('#code').focus(); document.querySelector('#code').setSelectionRange(0,0)");
  await cdp.call("Input.insertText", { text: "raise ValueError('UI edit must be blocked')\n" });
  assert(await cdp.evaluate("document.querySelector('#code').value === window.__publicOriginalSource"), "Typing changed the read-only public source");
  await cdp.evaluate("(() => { const editor=document.querySelector('#code'); editor.focus(); editor.setSelectionRange(0,editor.value.length); window.__selectedSampleLength=editor.selectionEnd-editor.selectionStart; Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copiedSample=text}}}); document.querySelector('#copy-source').click(); })()");
  await waitFor(cdp, "window.__copiedSample?.includes('Dino Game')", "copy read-only sample source");
  assert(await cdp.evaluate("window.__selectedSampleLength === document.querySelector('#code').value.length"), "The read-only source could not be selected");
  record("built public page blocks typing and loads selectable/copyable read-only source; no authentication UI");

  await cdp.call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const mobileLayout = await cdp.evaluate("({viewport:innerWidth,document:document.documentElement.scrollWidth})");
  assert(mobileLayout.document <= mobileLayout.viewport, "Public demo overflows the mobile viewport");
  await cdp.call("Emulation.clearDeviceMetricsOverride");
  record("public Game Studio page fits a narrow mobile viewport");

  failPublicSandboxOnce = true;
  await cdp.evaluate("document.querySelector('#run').click()");
  await waitFor(cdp, "document.querySelector('#python-error')?.hidden === false && document.querySelector('#error-heading')?.textContent === 'Runtime error'", "injected runtime startup failure", 30000);
  assert(await cdp.evaluate("document.querySelector('#status').dataset.phase === 'error'"), "Injected runtime failure did not reach the error state");
  record("public demo reports a one-time runtime startup failure");
  await cdp.evaluate("localStorage.setItem('studio-code', \"raise RuntimeError('storage source must not run')\"); document.querySelector('#code').value=\"raise ValueError('editor source must not run')\"; document.querySelector('#run').click()");
  await waitFor(cdp, "document.querySelector('#status')?.dataset.phase === 'running'", "public fixed Dino after runtime error", 90000);
  assert(await cdp.evaluate("document.querySelector('#python-error').hidden && !document.querySelector('#console').textContent.includes('must not run')"), "URL, storage, or editor contents changed the fixed program after a runtime error");
  const opaqueSandbox = await cdp.evaluate("(() => { const f=[...document.querySelectorAll('iframe')].find(item=>item.title==='Isolated Python worker host'); let locationBlocked=false; try { void f.contentWindow.location.href; } catch { locationBlocked=true; } return {sandbox:f.getAttribute('sandbox'),documentHidden:f.contentDocument===null,locationBlocked}; })()");
  assert(opaqueSandbox.sandbox === "allow-scripts" && opaqueSandbox.documentHidden && opaqueSandbox.locationBlocked, "Public worker iframe lost its opaque-origin sandbox");
  record("public Run ignores URL, localStorage, and editor text; iframe remains sandboxed with opaque origin");

  await cdp.evaluate("window.__firstDemoWindow=[...document.querySelectorAll('iframe')].find(item=>item.title==='Isolated Python worker host').contentWindow; document.querySelector('#restart').click()");
  await waitFor(cdp, "document.querySelector('#status')?.dataset.phase === 'running'", "public Restart", 90000);
  assert(await cdp.evaluate("[...document.querySelectorAll('iframe')].find(item=>item.title==='Isolated Python worker host').contentWindow !== window.__firstDemoWindow"), "Restart reused the prior sandbox iframe");
  record("public Restart starts a fresh isolated worker with the bundled sample");

  await cdp.evaluate("document.querySelector('#preview').focus()");
  await cdp.call("Input.dispatchKeyEvent", { type: "keyDown", key: " ", code: "Space", windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 });
  await cdp.call("Input.dispatchKeyEvent", { type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 });
  await new Promise((resolve) => setTimeout(resolve, 180));
  const dinoTop = await cdp.evaluate("(() => { const ctx=document.querySelector('#preview').getContext('2d'); const data=ctx.getImageData(60,0,40,318).data; let top=318; for(let y=0;y<318;y++) for(let x=0;x<40;x++){const i=(y*40+x)*4;if(data[i]<60&&data[i+1]<60&&data[i+2]<60) top=Math.min(top,y);} return top; })()");
  assert(dinoTop < 260, "Space did not make the bundled Dino jump (top pixel " + dinoTop + ")");
  record("public Dino Runner receives Space keyboard input and jumps");

  await cdp.evaluate("document.querySelector('#stop').click()");
  await waitFor(cdp, "document.querySelector('#status')?.dataset.phase === 'stopped' && ![...document.querySelectorAll('iframe')].some(item=>item.title==='Isolated Python worker host')", "public Stop cleanup");
  await cdp.evaluate("document.querySelector('#run').click()");
  await waitFor(cdp, "document.querySelector('#status')?.dataset.phase === 'running'", "public repeated Run", 90000);
  await cdp.evaluate("document.querySelector('#stop').click()");
  await waitFor(cdp, "document.querySelector('#status')?.dataset.phase === 'stopped'", "public repeated Stop");
  record("public Stop discards its worker; repeated Run and Stop succeed");

  await cdp.evaluate("document.querySelector('#run').click()");
  await waitFor(cdp, "document.querySelector('#status')?.dataset.phase === 'running'", "public refresh run", 90000);
  const publicWorkerIds = (await cdp.call("Target.getTargets")).targetInfos.filter((target) => target.type === "worker").map((target) => target.targetId);
  await cdp.call("Page.reload", { ignoreCache: true });
  await waitFor(cdp, "document.body.dataset.studioMode === 'fixed-demo' && document.querySelector('#source-status')?.textContent.includes('read-only')", "public page after refresh");
  await waitFor(cdp, "![...document.querySelectorAll('iframe')].some(item=>item.title==='Isolated Python worker host') && document.querySelector('#status')?.dataset.phase === 'ready'", "public refresh cleanup");
  const afterPublicRefresh = new Set((await cdp.call("Target.getTargets")).targetInfos.map((target) => target.targetId));
  assert(publicWorkerIds.every((id) => !afterPublicRefresh.has(id)), "A public Game Studio worker survived page refresh");
  await cdp.evaluate("document.querySelector('#run').click()");
  await waitFor(cdp, "document.querySelector('#status')?.dataset.phase === 'running'", "public Run after refresh", 90000);
  record("public refresh removes the previous worker and permits another Run");
}

async function testPublicSandboxMessages(cdp) {
  await cdp.evaluate("document.querySelector('#stop').click()");
  await waitFor(cdp, "document.querySelector('#status')?.dataset.phase === 'stopped'", "stop public demo before direct message test");
  const result = await cdp.evaluate("new Promise((resolve,reject)=>{ const frame=document.createElement('iframe'); frame.setAttribute('sandbox','allow-scripts'); frame.src='./site-assets/game-studio-runtime/sandbox.html'; const received=[]; let unknownWasIdle=false; let stopSent=false; let finished=false; const cleanup=()=>{removeEventListener('message',receive);frame.remove();clearTimeout(timeout);}; const fail=(message)=>{if(finished)return;finished=true;cleanup();reject(new Error(message));}; const receive=(event)=>{if(event.source!==frame.contentWindow||event.origin!=='null'||!event.data||typeof event.data!=='object')return;received.push(event.data);if(event.data.type==='python-error')fail('Code from a start message executed');if(event.data.type==='frame'&&!stopSent){stopSent=true;frame.contentWindow.postMessage({type:'stop'},'*');}if(event.data.type==='stopped'){finished=true;const value={unknownWasIdle:unknownWasIdle,ranFixedSample:received.some(item=>item.type==='frame'),sawRuntime:received.some(item=>item.type==='status'&&String(item.text).startsWith('Running program'))};cleanup();resolve(value);}}; const timeout=setTimeout(()=>fail('Sandbox message test timed out'),90000); addEventListener('message',receive); frame.addEventListener('load',()=>{received.length=0;frame.contentWindow.postMessage({type:'start-demo',sample:'not-approved',code:'raise RuntimeError(1)'},'*');setTimeout(()=>{unknownWasIdle=received.every(item=>item.type!=='frame'&&item.type!=='python-error'&&item.type!=='status');frame.contentWindow.postMessage({type:'start-demo',sample:'dino-runner',code:'raise RuntimeError(1)'},'*');},500);}); document.body.append(frame); })");
  assert(result.unknownWasIdle && result.ranFixedSample && result.sawRuntime, "Sandbox message allowlist or bundled-source behavior failed");
  record("unapproved sample IDs do not run; a valid ID ignores a code override and runs the bundled Dino");
}

async function main() {
  assert(fs.existsSync(chromePath), `Chrome was not found at ${chromePath}. Set CHROME_PATH to its executable.`);
  assert(fs.existsSync(path.join(publicRoot, "game-studio.html")), "Assemble build/site before running the public demo browser checks.");
  const port = await listen(server);
  const debugPort = await freePort();
  const url = `http://127.0.0.1:${port}/`;
  const chrome = spawn(chromePath, [
    `--remote-debugging-port=${debugPort}`,
    "--remote-allow-origins=*",
    `--user-data-dir=${profileRoot}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--enable-precise-memory-info",
    url,
  ], { stdio: "ignore", windowsHide: false });

  try {
    let version;
    let targets;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      try {
        version = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json();
        targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
        break;
      } catch { await new Promise((resolve) => setTimeout(resolve, 250)); }
    }
    assert(version?.Browser, "Chrome DevTools endpoint did not start.");
    const page = targets.find((target) => target.type === "page");
    assert(page?.webSocketDebuggerUrl, "Chrome page target was not found.");
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    const cdp = new Cdp(socket);
    await cdp.call("Runtime.enable");
    await cdp.call("Page.enable");
    await cdp.call("Target.setDiscoverTargets", { discover: true });
    await cdp.evaluate(`(() => {
      const original = CanvasRenderingContext2D.prototype.putImageData;
      CanvasRenderingContext2D.prototype.putImageData = function(...args) {
        if (this.canvas?.id === "preview" && window.__studioFrameTimes?.length < 5000) {
          window.__studioFrameTimes.push(performance.now());
        }
        return original.apply(this, args);
      };
      return true;
    })()`);
    await waitFor(cdp, "document.querySelector('#status')?.dataset.phase === 'ready'", "editor ready");
    record("experiment loaded over loopback HTTP");

    const movingShape = `import asyncio, pygame
pygame.init()
screen = pygame.display.set_mode((100, 80))
GAME_A_GLOBAL = 'private-to-this-worker'
async def main():
    while True:
        x = (pygame.time.get_ticks() // 16) % 100
        for event in pygame.event.get():
            if event.type == pygame.KEYDOWN and event.key == pygame.K_RIGHT:
                print('A_KEY_HELD')
            if event.type == pygame.MOUSEBUTTONDOWN:
                print('A_MOUSE_HELD')
        screen.fill((10, 20, 30))
        pygame.draw.circle(screen, (197, 138, 85), (x, 40), 10)
        pygame.display.flip()
        await asyncio.sleep(0)
asyncio.run(main())`;
    const browserPerformance = [await measureBrowserRun(cdp, "moving shape, first run", movingShape)];
    record("Pygame program starts and renders");
    browserPerformance.push(await measureBrowserRun(cdp, "moving shape, cached run", movingShape));
    browserPerformance.push(await measureBrowserRun(cdp, "Dino Runner", browserSources.dinoRunner));
    browserPerformance.push(await measureBrowserRun(cdp, "moderate drawing workload", browserSources.moderate));
    record("moving shape, Dino Runner, and moderate workload measured in headed Chromium");

    await setSource(cdp, movingShape);
    await waitFor(cdp, "document.querySelector('#status')?.dataset.phase === 'running'", "Game A first frame");
    await cdp.evaluate("document.querySelector('#preview').focus()");
    await cdp.call("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39 });
    const previewRect = await cdp.evaluate("(() => { const r=document.querySelector('#preview').getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; })()");
    await cdp.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: previewRect.x + 10, y: previewRect.y + 10 });
    await cdp.call("Input.dispatchMouseEvent", { type: "mousePressed", x: previewRect.x + 10, y: previewRect.y + 10, button: "left", clickCount: 1 });
    await waitFor(cdp, "document.querySelector('#console')?.textContent.includes('A_KEY_HELD') && document.querySelector('#console')?.textContent.includes('A_MOUSE_HELD')", "held input reaches Game A");
    await cdp.evaluate("document.querySelector('#stop').click()");
    await waitFor(cdp, "document.querySelector('#status')?.dataset.phase === 'stopped'", "Stop Game A with held input");
    await cdp.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: previewRect.x + 10, y: previewRect.y + 10, button: "left", clickCount: 1 });
    await cdp.call("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39 });

    await setSource(cdp, `import asyncio, pygame
assert 'GAME_A_GLOBAL' not in globals()
assert pygame.display.get_surface() is None
assert not pygame.key.get_pressed()[pygame.K_RIGHT]
assert not pygame.mouse.get_pressed()[0]
print('B_STATE_CLEAN')`);
    await waitFor(cdp, "document.querySelector('#console')?.textContent.includes('B_STATE_CLEAN')", "fresh Game B state");
    record("Game A globals/display/input do not appear in fresh Game B");

    await setSource(cdp, `def fail():
    raise ValueError("The sample exception reached the console")
fail()`);
    await waitFor(cdp, "document.querySelector('#python-error')?.hidden === false && document.querySelector('#error-heading')?.textContent === 'ValueError'", "structured Python error", 90000);
    const errorResult = await cdp.evaluate("({explanation:document.querySelector('#error-explanation').textContent,line:document.querySelector('#error-location').textContent,trace:document.querySelector('#error-traceback').textContent,detailsHidden:document.querySelector('#runtime-details').open})");
    assert(errorResult.explanation.includes("value") && errorResult.line.includes("line 2") && errorResult.trace.includes("ValueError"), "Python error panel did not show expected details");
    assert(!errorResult.detailsHidden, "Technical details disclosure should be collapsed by default");
    record("exception panel gives type/explanation/source/traceback and keeps technical details collapsed");

    await cdp.evaluate("Object.defineProperty(navigator, 'clipboard', {configurable:true,value:{writeText:async text=>{window.__copiedText=text}}}); document.querySelector('#copy-error').click()");
    await waitFor(cdp, "document.querySelector('#error-copy-status')?.textContent === 'Copied.'", "copy error details");
    assert((await cdp.evaluate("window.__copiedText")).includes("ValueError"), "Copied error text omitted the Python exception");
    await cdp.evaluate("document.querySelector('#runtime-details').open = true");
    assert(await cdp.evaluate("document.querySelector('#runtime-details').open"), "Technical details could not be expanded");
    record("error details copy correctly and technical diagnostics can be expanded");

    await cdp.evaluate("document.querySelector('#restart').click()");
    await waitFor(cdp, "document.querySelector('#python-error')?.hidden === false", "restart after exception", 90000);
    await setSource(cdp, "print('EDITOR_RECOVERED')");
    await waitFor(cdp, "document.querySelector('#console')?.textContent.includes('EDITOR_RECOVERED')", "Run after exception", 90000);
    await cdp.evaluate("Object.defineProperty(navigator, 'clipboard', {configurable:true,value:{writeText:async text=>{window.__copiedText=text}}}); document.querySelector('#copy-console').click()");
    await waitFor(cdp, "document.querySelector('#copy-status')?.textContent === 'Copied.'", "copy program output");
    assert((await cdp.evaluate("window.__copiedText")).includes("EDITOR_RECOVERED"), "Copied program output omitted the printed text");
    record("editor runs a new program after exception and restart");

    await setSource(cdp, `while True:
    pass`);
    await waitFor(cdp, "document.querySelector('#status')?.textContent.includes('Running program')", "non-yielding program execution", 90000);
    await waitFor(cdp, "document.querySelector('#diagnostic-summary')?.textContent.includes('may be stuck')", "stalled-program warning", 15000);
    await cdp.evaluate("document.querySelector('#stop').click()");
    await waitFor(cdp, "document.querySelector('#status')?.dataset.phase === 'stopped'", "Stop non-yielding program");
    record("non-yielding program warning and Stop");

    await setSource(cdp, `import asyncio, pygame
pygame.init()
screen = pygame.display.set_mode((100, 80))
async def main():
    running = True
    while running:
        for event in pygame.event.get():
            if event.type == pygame.KEYDOWN and event.key == pygame.K_a:
                print('KEY_A_DOWN')
            if event.type == pygame.KEYUP and event.key == pygame.K_a:
                print('KEY_A_UP')
                running = False
        screen.fill((0, 0, 0))
        pygame.display.flip()
        await asyncio.sleep(0)
asyncio.run(main())`);
    await waitFor(cdp, "document.querySelector('#status')?.dataset.phase === 'running'", "keyboard input program");
    await cdp.evaluate("document.querySelector('#preview').focus()");
    await cdp.call("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65 });
    await waitFor(cdp, "document.querySelector('#console')?.textContent.includes('KEY_A_DOWN')", "key down");
    await cdp.evaluate("document.querySelector('#code').focus()");
    await waitFor(cdp, "document.querySelector('#console')?.textContent.includes('KEY_A_UP')", "key release after focus leaves preview");
    record("keyboard focus enters preview and focus loss releases the held key");

    await setSource(cdp, `import asyncio, pygame
pygame.init()
screen = pygame.display.set_mode((100, 80))
async def main():
    while True:
        for event in pygame.event.get():
            if event.type == pygame.MOUSEBUTTONDOWN:
                print(f'MOUSE_CLICK {event.pos[0]} {event.pos[1]}')
                return
        screen.fill((0, 0, 0))
        pygame.display.flip()
        await asyncio.sleep(0)
asyncio.run(main())`);
    await waitFor(cdp, "document.querySelector('#status')?.dataset.phase === 'running'", "mouse input program");
    const mouseTarget = await cdp.evaluate("(() => { const r=document.querySelector('#preview').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()");
    await cdp.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: mouseTarget.x, y: mouseTarget.y });
    await cdp.call("Input.dispatchMouseEvent", { type: "mousePressed", x: mouseTarget.x, y: mouseTarget.y, button: "left", clickCount: 1 });
    await waitFor(cdp, "document.querySelector('#console')?.textContent.includes('MOUSE_CLICK')", "mouse click event");
    const mouseResult = await cdp.evaluate("document.querySelector('#console').textContent.match(/MOUSE_CLICK (\\d+) (\\d+)/)?.slice(1).map(Number)");
    assert(mouseResult && Math.abs(mouseResult[0] - 50) <= 1 && Math.abs(mouseResult[1] - 40) <= 1,
      `Mouse coordinates were not mapped to the Pygame surface center: ${JSON.stringify(mouseResult)}`);
    record("mouse click and preview coordinate mapping");

    await cdp.evaluate(`(() => {
      const editor=document.querySelector('#code');
      editor.value="if True:\\nprint('INDENT_OK')";
      editor.focus();
      editor.setSelectionRange(editor.value.indexOf('print'),editor.value.indexOf('print'));
      editor.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));
      return editor.value;
    })()`);
    assert(await cdp.evaluate("document.querySelector('#code').value.includes(\"\\n    print('INDENT_OK')\")"), "Tab did not indent the Python line");
    await cdp.evaluate("document.querySelector('#run').click()");
    await waitFor(cdp, "document.querySelector('#console')?.textContent.includes('INDENT_OK')", "run indented program", 90000);
    record("editor indentation and subsequent run");

    const localOrigin = `http://127.0.0.1:${port}/`;
    const securitySource = browserSources.securityProbe
      .replace("http://127.0.0.1:8768/", localOrigin) + "\nprint('SECURITY_PROBE_DONE')";
    await setSource(cdp, securitySource);
    await waitFor(cdp, "document.querySelector('#console')?.textContent.includes('SECURITY_PROBE_DONE')", "harmless network boundary probe", 90000);
    const securityOutput = await cdp.evaluate("document.querySelector('#console').textContent");
    assert(securityOutput.includes("document False") && securityOutput.includes("localStorage False") && securityOutput.includes("parent False"), "Worker exposed an unexpected page global");
    assert(securityOutput.includes("worker_origin null"), "Worker did not have an opaque origin");
    assert(securityOutput.includes("local_site blocked") && securityOutput.includes("other_site blocked"), "CSP did not block a local-site and external-site fetch");
    const cdnResult = securityOutput.match(/runtime_cdn[^\n]*/)?.[0] || "no CDN result printed";
    console.log(`Security probe CDN result: ${cdnResult}`);
    assert(securityOutput.includes("runtime_cdn allowed 200"), `Expected the configured runtime CDN request to succeed; probe reported: ${cdnResult}`);
    record("harmless worker-origin and CSP network probes; CDN remains reachable");

    await setSource(cdp, `import asyncio, pygame
pygame.init()
screen = pygame.display.set_mode((50, 40))
async def main():
    while True:
        pygame.event.get()
        screen.fill((10, 20, 30))
        pygame.display.flip()
        await asyncio.sleep(0)
asyncio.run(main())`);
    await waitFor(cdp, "document.querySelector('#status')?.dataset.phase === 'running'", "refresh test program");
    const workerTargetsBeforeRefresh = (await cdp.call("Target.getTargets")).targetInfos
      .filter((target) => target.type === "worker").map((target) => target.targetId);
    await cdp.call("Page.reload", { ignoreCache: true });
    await waitFor(cdp, "document.querySelector('#status')?.dataset.phase === 'ready'", "editor after refresh", 90000);
    if (workerTargetsBeforeRefresh.length) {
      const until = Date.now() + 10000;
      let staleTargets = workerTargetsBeforeRefresh;
      while (Date.now() < until && staleTargets.length) {
        const currentIds = new Set((await cdp.call("Target.getTargets")).targetInfos.map((target) => target.targetId));
        staleTargets = workerTargetsBeforeRefresh.filter((id) => currentIds.has(id));
        if (staleTargets.length) await new Promise((resolve) => setTimeout(resolve, 200));
      }
      assert(!staleTargets.length, `Worker targets survived page refresh: ${staleTargets.join(", ")}`);
      record("refresh destroys the active worker target");
    }
    await setSource(cdp, "print('REFRESH_RECOVERED')");
    await waitFor(cdp, "document.querySelector('#console')?.textContent.includes('REFRESH_RECOVERED')", "Run after refresh", 90000);
    record(workerTargetsBeforeRefresh.length
      ? "refresh reloads editor and permits a new run"
      : "refresh reloads editor and permits a new run (Chrome did not expose the worker as a target)");

    await testPublicDemo(cdp, port);
    await testPublicSandboxMessages(cdp);
    console.log(JSON.stringify({ browser: version.Browser, protocolVersion: version["Protocol-Version"], mode: "headed Chromium via CDP", browserPerformance, passed }, null, 2));
    socket.close();
  } finally {
    server.close();
    try { execFileSync("taskkill.exe", ["/PID", String(chrome.pid), "/T", "/F"], { stdio: "ignore" }); }
    catch { chrome.kill(); }
    await new Promise((resolve) => {
      if (chrome.exitCode !== null) resolve();
      else {
        chrome.once("close", resolve);
        setTimeout(resolve, 5000);
      }
    });
    const resolvedBuild = path.resolve(buildRoot);
    const resolvedProfile = path.resolve(profileRoot);
    if (resolvedProfile.startsWith(resolvedBuild + path.sep) && resolvedProfile.includes("studio-chrome-profile-")) {
      try { fs.rmSync(resolvedProfile, { recursive: true, force: true }); }
      catch (error) { console.warn(`Temporary browser profile remains at ${resolvedProfile}: ${error.message}`); }
    }
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
