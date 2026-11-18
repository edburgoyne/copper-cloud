# Browser-based Pygame studio: proof-of-concept report

**Current status (2026-11-17): Phase 2 implementation and available verification are complete. Recommendation: Not ready for integration.** The current headed Chrome results and measurements are in section I. Earlier sections retain the proof-of-concept investigation and user-reported observations; section I supersedes their pending-test and readiness statements.

## A. Technical findings

The existing arcade pins **Pygbag 0.9.3**. Its build script copies a published game's Python source and optional assets into an application directory, then Pygbag packages that application. The browser downloads a WebAssembly build of CPython and pygame-ce and executes the Python; the game's Python source is not itself compiled into a standalone native program. Pygbag's documentation describes a virtual filesystem, Python input, and loading a script from a URL, so dynamically supplied source is technically possible with an integration layer; the existing packaging workflow is not a ready-made paste-and-run editor. Sources: [Pygbag internals](https://pygame-web.github.io/wiki/pygbag-internals/), [Pygbag project](https://github.com/pygame-web/pygbag), and [game-loop guidance](https://pygame-web.github.io/wiki/pygbag/).

The prototype instead uses **Pyodide 314.0.7**, CPython 3.14.2 compiled to WebAssembly, and its **pygame-ce 2.5.7** package. Pyodide runs Python text supplied by JavaScript; its documented Web Worker architecture keeps long-running Python off the page's UI thread. Pyodide does support pygame-ce, but its SDL support is explicitly experimental. Its normal SDL canvas expects an HTML canvas, which is not directly available inside a worker. Sources: [Pyodide SDL documentation](https://pyodide.org/en/stable/usage/sdl.html), [Pyodide package list](https://pyodide.org/en/314.0.1/usage/packages-in-pyodide.html), [Pyodide worker documentation](https://pyodide.org/en/stable/usage/webworker.html).

An initialized Pyodide interpreter can execute multiple source strings through its Python execution API. This prototype intentionally discards the whole worker after a run instead of reusing that interpreter: doing so clears game state and allows a non-yielding program to be terminated. Reusing a worker could reduce startup time but would require a reliable reset strategy and still cannot interrupt a blocked worker without destroying it. See [Pyodide's JavaScript API](https://pyodide.org/en/stable/usage/api/js-api.html).

To investigate termination without blocking the editor, this experiment uses genuine pygame-ce `Surface` drawing in a worker and adapts a small subset of the display, keyboard, mouse, and clock APIs. Completed pixel buffers travel through messages to the editor's canvas. Similar surface-based worker adaptation exists in [Python Arena's open-source implementation](https://github.com/AntonyPerez0/pythonarena/blob/main/src/engine/arena_pygame.py); this prototype is a separate, much smaller implementation.

Pygbag-style `asyncio.run(main())` is scheduled on Pyodide's existing event loop. Statements after that call execute before the scheduled coroutine finishes, unlike normal blocking `asyncio.run`. `asyncio.sleep(0)` is adapted toward a 60 fps deadline that accounts for frame work, and `Clock.tick()` reports elapsed time without sleeping. These choices change timing and are **not** a promise of identical behavior. A synchronous infinite loop will not process game input, but can be stopped by terminating its worker. A heartbeat warning has been added for a worker that may be stuck; it is a usability hint, not a security or resource guarantee.

## B. Prototype and local preview

All files are under `experiments/browser-pygame-studio/`; the existing arcade, manifest, game sources, and deployment workflow are untouched by this experiment.

- `index.html`, `studio.css`, and `studio.js`: editor with Tab/Shift+Tab indentation, controls, preview, copyable console, and parent-side messaging. Press Escape followed by Tab to move focus out of the editor.
- `sandbox.html`: hidden iframe host with `sandbox="allow-scripts"` and a restrictive Content Security Policy.
- `worker.mjs`: loads the pinned runtime and runs the supplied source in a disposable worker.
- `pygame_bridge.py`: pygame display/input/timing adapter; it does not change the original games.
- `samples/`: the moving-shape example, exception, infinite loop, and harmless security probe.
- `tools/download_runtime.py`, `tools/node-worker.mjs`, and `tools/test-runtime.mjs`: isolated runtime download and Node/WebAssembly tests.

From the repository root, start a local server:

```powershell
.\.venv\Scripts\python.exe -m http.server 8768 --bind 127.0.0.1
```

Open `http://127.0.0.1:8768/experiments/browser-pygame-studio/` in a regular browser. The prototype loads its pinned runtime from `https://cdn.jsdelivr.net/pyodide/v314.0.7/full/`; internet access is needed for a first load. Enter or paste one Python file, click **Run**, and focus the preview for keyboard input. **Restart** reruns the last submitted source in a fresh worker; **Run** submits the current editor contents. No code is sent to a Python execution server.

Pyodide can also be hosted as static files, including on GitHub Pages, with appropriate WebAssembly MIME types and CORS headers. The current prototype is configured for the CDN; self-hosting would require changing the loader and CSP and verifying cross-origin access from the opaque-origin worker. See [Pyodide deployment documentation](https://pyodide.org/en/stable/usage/downloading-and-deploying.html).

For the local Node/WebAssembly tests, download the pinned runtime into the ignored `build/browser-studio-runtime-314.0.7/` directory and run:

```powershell
.\.venv\Scripts\python.exe experiments/browser-pygame-studio/tools/download_runtime.py
node experiments/browser-pygame-studio/tools/test-runtime.mjs
```

The helper verifies the pygame wheel against the hash in the downloaded Pyodide lockfile. The downloaded files are experimental test artifacts and are not part of the deployed site.

## C. Compatibility results

The Node tests execute the real Pyodide/pygame-ce WebAssembly runtime and the same Python adapter, but are **not browser tests**.

The initial automated attempt used headless Chromium before the user's later headed-only instruction. The requested `UI-tester-suite/.agents/skills/manual-test/SKILL.md` says to "Call `planner_setup_page` once with the selected `project` and `seedFile` before using browser tools." Its MCP server started, but the tool rejected the attempt to send its initialization input, so no headed Playwright browser actions were performed. The subsequent browser results below were reported by the user from a regular browser; its name and version were not recorded. No separate manual-test report was created.

| Case | Actual result |
| --- | --- |
| A — Basic Pygame and keyboard | **Browser rendering passed:** the user reported the example working after a genuine pygame-ce frame appeared. **Node/Wasm input passed:** simulated Right input moved the shape from x≈319.5 to x≈335.5. The user also confirmed keyboard controls in Dino Runner; the basic example's arrow movement was not separately reported. |
| B — Existing game | **Browser:** the user ran the original Dino Runner source unchanged and confirmed Space, Up Arrow, R, and Escape work. Dino initially ran slowly and took 10.35 s to first frame; after the adapter changes the user reported that it felt faster. Arial was unavailable and pygame used its default font. **Node/Wasm:** simulated Space moved the dinosaur's top from y=270 to y=231. The adapter changes runtime APIs and timing, so full gameplay equivalence is not established. |
| C — Exception | **Browser and Node/Wasm passed:** a deliberate `ValueError` produced a traceback containing `main.py`. The Phase 2 headed Chrome test confirmed the shortened error panel, source line, technical details disclosure, and error-copy handler; see section I. |
| D — Infinite loop | **Browser and Node/Wasm passed:** the user confirmed Stop ended the infinite-loop sample; in Node a separate worker terminated in 19 ms in one run. No Python exception is expected for valid infinite-loop code. A heartbeat warning was added; whether it appeared in the user's test was not reported. |
| E — Repeated execution | **Browser:** the user reported that Run, Stop, and Restart function as intended and ran the example, exception, infinite loop, Dino Runner, and security probe in successive runs. **Node/Wasm:** separate workers ran different source texts with independent output. A specific browser test for leaked state between programs was not performed. |
| F — Refresh | The user refreshed during troubleshooting and successfully ran programs afterward. Refresh during an active game and confirmation that its worker terminates were not explicitly tested. |
| G — Browser compatibility | The initial headless attempt failed before Python started. A later user-run browser loaded the `data:` workaround and exposed the CSP issue; after the CSP adjustment, the user confirmed a rendered example. Those historical browser/version details were not recorded. The current headed Chrome suite is documented in section I; Firefox remains unavailable. |
| H — Security boundaries | **Browser, limited probe passed:** the user reported `document`, `localStorage`, and `parent` absent from the worker's `js` globals and `worker_origin null`. Requests to the local site and `example.com` were blocked by `connect-src`; a request to the runtime CDN returned 200. No real credentials were used. These checks do not prove resistance to all escapes, authenticated requests, or resource-exhaustion attacks. |

The user confirmed that editor indentation and the console-copy button work after the update, liked the placement of the copy button, and confirmed that the network warnings explain the blocked requests clearly.

The first Chromium failure was accompanied by the browser message `Refused to cross-origin redirects of the top-level worker script.`, consistent with a documented problem involving **module workers from `blob:` URLs inside opaque-origin sandboxed iframes**. The iframe now creates a self-contained `data:` module worker while keeping the sandbox. A user-run browser test progressed through Pyodide startup with this workaround, then identified the separate CSP evaluation error described below. See the [reproduction and browser matrix](https://github.com/maplibre/maplibre-gl-js/issues/8909).

The unchanged site's existing checks also passed: 12 Python build tests and five simulated-DOM JavaScript tests. Local HTTP checks returned the experiment's HTML, scripts, samples, and bridge successfully. These checks do not establish browser gameplay.

### Recorded browser observations

- The earlier user-run example displayed a first frame after a reported **8.97 s** runtime initialization and **9.84 s** total. The user reported that the studio worked. Controlled headed Chrome measurements are in section I.
- The deliberate exception displayed a Python traceback ending with `ValueError: The sample exception reached the console`, including the original `main.py` line numbers. The initial output also contained a long JavaScript/Wasm stack, which the user found disruptive; the shorter error format was later confirmed by the headed Chrome suite in section I.
- The `while True: pass` sample produced no Python exception, as expected, and the user confirmed that Stop worked. The worker heartbeat warning is a heuristic for a stalled worker, not proof of an infinite loop.
- Dino Runner reported **8.56 s** to runtime readiness and **10.35 s** to its first frame in one attempt. It initially felt slow; after the frame-copy and timing changes, the user said it ran faster and confirmed Space, Up Arrow, R, and Escape. pygame warned that Arial was unavailable and used its default font.
- The user confirmed indentation and Copy console, and reported roughly **10 s** for an initial load and **3–5 s** for later reloads. These are subjective observations rather than controlled benchmarks.

The significant Python portion of the user's initial exception output was:

```text
PythonError: Traceback (most recent call last):
  File "/lib/python314.zip/_pyodide/_base.py", line 619, in eval_code_async
    await CodeRunner(
    ...<10 lines>...
    .run_async(globals, locals)
  File "/lib/python314.zip/_pyodide/_base.py", line 422, in run_async
    await coroutine
  File "<exec>", line 1, in <module>
  File "<exec>", line 191, in studio_execute
  File "main.py", line 5, in <module>
  File "main.py", line 2, in fail
ValueError: The sample exception reached the console
```

The additional JavaScript/Wasm stack has been omitted here for readability; it was present in that initial output. Line numbers may differ in the current version of the bridge.

After the clearer-warning change, the user reran the security probe and confirmed that its warnings were understandable. The reported console output was:

```text
Loading pygame-ce
Loaded pygame-ce
pygame-ce 2.5.7 (SDL 2.32.10, Python 3.14.2)
[Runtime ready: 7.54s]
document False
localStorage False
parent False
worker_origin null

[Warning] Network request to http://127.0.0.1:8768 was blocked. The studio restricts network requests to jsDelivr. Remove other requests or include the data in your code.
local_site blocked JsException

[Warning] Network request to https://example.com was blocked. The studio restricts network requests to jsDelivr. Remove other requests or include the data in your code.
other_site blocked JsException
runtime_cdn allowed 200
```

## D. Security and isolation

The editor sends only the submitted code and trusted experiment scripts to a hidden iframe. It grants `allow-scripts` but **not** `allow-same-origin`, top navigation, popups, forms, or storage-access permissions. A worker is created inside that iframe, and the parent accepts messages only from its current iframe; frame sizes and console output are bounded. According to the browser model, an iframe without `allow-same-origin` has an opaque origin; do not combine `allow-scripts` and `allow-same-origin` for a same-origin frame. See [MDN's iframe sandbox documentation](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe#sandbox).

The console now gives a plain-language warning for observed browser policy violations and common access-denied exceptions. Network warnings show at most the destination origin, omitting its path and query. This is best-effort feedback: programs can catch errors, and browsers or APIs may report restrictions in other ways, so not every security failure can be identified.

The iframe's CSP allows runtime scripts and connections to jsDelivr, plus the `data:` worker needed for the compatibility workaround. In a user's browser, Pyodide loaded but pygame-ce's dynamic-library loader failed under `wasm-unsafe-eval` alone because it attempted JavaScript evaluation. The sandbox now also permits `unsafe-eval`; this relaxes a defense against dynamically generated JavaScript and is a significant security tradeoff to evaluate before production. It does not change the parent page's CSP. See [MDN on the distinction between these CSP directives](https://github.com/mdn/content/blob/main/files/en-us/web/http/reference/headers/content-security-policy/script-src/index.md).

A `data:` worker inherits the creator's CSP under the documented worker CSP model. In the user's browser, the earlier policy did block the worker's JavaScript evaluation; after `unsafe-eval` was allowed, the game reached its first frame. The user's harmless probe then observed local-site and external-site requests blocked while the runtime CDN remained reachable. Cross-browser enforcement and other egress paths remain unverified. See [MDN on worker CSP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy#csp_in_workers). The allowed CDN is still a network destination and could receive attacker-chosen request data; this is not a complete network-denial policy.

Python can use Pyodide's JavaScript bridge inside its worker. WebAssembly alone is not a security boundary for arbitrary code. Browser same-origin rules and CSP are defenses, not proof that credentials, authenticated requests, every network channel, or browser vulnerabilities are inaccessible. The code, output, frame dimensions, frame rate, and pending input are bounded, but there is no hard memory quota, guaranteed CPU limit, or protection against browser/OS denial of service. Worker messages are untrusted and can be forged by the program.

For production, use a separate origin with **no** Copper Cloud or Supabase credentials, strict HTTP-delivered CSP and permissions policy, carefully reviewed message validation, no privileged APIs, verified network controls, and browser-specific adversarial tests. Consider a separately isolated execution service if stronger enforceable resource or network limits are needed. Do not expose this proof of concept to untrusted community submissions.

## E. Download sizes and performance

The following six files were downloaded into ignored `build/` for local tests. These are **file sizes on disk**, not necessarily compressed network transfer sizes:

| File | Bytes |
| --- | ---: |
| `pyodide.mjs` | 17,931 |
| `pyodide.asm.mjs` | 1,250,344 |
| `pyodide.asm.wasm` | 9,598,218 |
| `python_stdlib.zip` | 2,545,637 |
| `pyodide-lock.json` | 119,077 |
| `pygame_ce-2.5.7-cp314-cp314-pyemscripten_2026_0_wasm32.whl` | 1,528,232 |
| **Total** | **15,059,439 bytes (14.36 MiB)** |

In one Node.js run using already downloaded local files, the interpreter initialized in about **1.36 s** and pygame-ce was ready in about **1.51 s** total. In one earlier user-run browser attempt, the prototype reported **8.97 s** to runtime readiness and **9.84 s** to first frame. The browser had made earlier attempts, so its cache state is unknown; these are single observations, not cold-start benchmarks. Section I later records headed Chrome frame rate and editor-page heap. Browser worker/Wasm memory, CPU, and actual transfer size remain unmeasured.

The user reported an initial load of about 10 seconds and later reloads of about 3–5 seconds after the changes. Each run deliberately creates a fresh worker and initializes a new interpreter, even when browser downloads are cached. A future design could investigate a prewarmed spare worker, while measuring its memory cost and ensuring that runs never inherit another program's state.

Frames are transferred as uncompressed RGBA buffers. An 800×400 game produces 1,280,000 bytes per frame; at the 30-frame-per-second message cap, that is up to 38.4 MB/s of pixel data between contexts, excluding additional copies and drawing. This is a calculated upper bound, not a measured throughput, and may be too expensive on lower-powered devices. After the user reported slow Dino gameplay, the adapter was changed to skip copying frames that would be dropped and to account for frame work in its timing. The user reported it felt faster, but frame rate was not measured.

## F. Approaches compared

| Approach | Pygame and dynamic code | Browser, hosting, and compilation | Reset, isolation, size, and licensing |
| --- | --- | --- | --- |
| Pygbag 0.9.3 | pygame-ce and CPython/Wasm; dynamic source can be fed to its interpreter with additional integration. Existing project packages each game ahead of publication. | Static hosting works; no server-side compilation is inherently required for already available browser-compatible source and runtime. Browser-specific behavior for a new editor is untested. | Normal SDL rendering is tied to a page thread; robust interruption of non-yielding code and isolation need additional design. Runtime transfer and startup were not measured here. Pygbag itself is MIT licensed; audit its CPython, pygame-ce, SDL, and other bundled component licenses before redistribution. |
| Pyodide + worker adapter, this experiment | Real pygame-ce surfaces and dynamically supplied CPython code; display/input/timing are adapted and incomplete, audio and asset uploads are unsupported. | Static files plus CDN; no Python backend or per-program server compilation. The headed Chrome smoke suite is in section I; Firefox and broader cross-browser testing remain outstanding. Chrome/Firefox/Safari are documented Pyodide targets. | Disposable workers stopped a non-yielding loop in the browser and Node tests. Local file sizes and measured timings are above. Pyodide is MPL-2.0, CPython uses the PSF license, and pygame-ce is LGPL-2.1; review notices and redistribution obligations. |
| Python Arena | Open-source teaching system using Pyodide and real pygame-ce with a much larger display/input shim; it replays interactions and silences sound, so it is not identical to live Pygbag gameplay. | Runs locally in the browser using a worker and static assets; its site reports a roughly 6 MB core and 1.5 MB pygame download, not measurements of this prototype. Browser support and timing were not independently tested here. | Workers are terminated on timeout and restarted; the site's code is MIT licensed, while its lesson content has separate CC BY-NC-SA terms. Study its security model before reuse. Sources: [project source](https://github.com/AntonyPerez0/pythonarena), [about and licenses](https://pythonarena.org/about/). |

## G. Recommendation

**Not ready for integration.** The later Phase 2 suite verifies lifecycle behavior and selected security boundaries in headed Chrome, and measures representative workloads. Firefox coverage, low-powered-device measurements, a dedicated-origin hosting/security design, and enforceable resource limits remain open. The adapter's limited compatibility and relaxed sandbox CSP require a security review before student-facing use.

## H. Next steps

1. Review the `unsafe-eval` requirement, CDN egress, and a dedicated execution origin with no Copper Cloud or Supabase credentials. Define HTTP security headers and CORS before public integration.
2. Run the browser suite in Firefox when available; measure memory, CPU, and download transfer size with browser tooling and repeat on a low-powered device.
3. Add compatibility tests or keep unverified timers, modifiers, event-queue semantics, display modes, custom assets/fonts, broader sprite operations, and audio explicitly unsupported.
4. Review supply-chain integrity, version updates, and license notices before redistribution or public release.

## I. Phase 2 runtime hardening update (2026-11-17)

This update was implemented only in the isolated experiment. It did not modify the arcade pages, game manifest, Pygbag workflow, Supabase, or authentication.

### Changes and automated results

- Python exceptions now have a compact student-facing panel with error class, deterministic explanation, source line where available, and a shortened Python traceback. Raw diagnostics are available in a collapsed details panel. Runtime/security warnings are separated from normal output.
- The sandbox terminates its worker after normal completion and errors, as well as on Stop or replacement. Input messages are checked for known shapes and coordinate/key bounds. Input overflow and focus loss clear held state and emit release events.
- The Node/Wasm suite now tests drawing, `Rect`, transforms, alpha, sprite groups, generated virtual-filesystem image loading, fallback/default fonts, display flip/update, Clock, keyboard/mouse events, focus-loss release, errors, non-yielding worker termination, and state isolation across fresh workers. It also verifies the Python error formatter's type, explanation, line, traceback, and technical diagnostics.
- Created `docs/GAME_CREATION_GUIDE.md` for students and `docs/AI_GAME_STUDIO_INSTRUCTIONS.md` for assistants. Both describe the experimental runtime separately from the Pygbag publishing pipeline and limit compatibility claims to tested behavior.
- A headed Chromium test harness using the built-in Chrome DevTools Protocol was added because Playwright and Playwright MCP were unavailable in the environment. Google Chrome 157.0.8103.79 passed the suite below. Firefox is unavailable.

The full Node/Wasm functional suite passed. After the experiment changes, the repository's Python suite passed (12 tests), and its frontend JavaScript suite passed (five tests). JavaScript syntax checks and `git diff --check` also passed.

### Headed Chromium test results

The suite ran a visible Chrome window over loopback HTTP using CDP (not Playwright). All 14 checks passed:

- Game A to Game B discarded Python globals, display state, held keyboard state, and mouse button state.
- Refresh during a running program removed the old worker target, reloaded the editor, and allowed a new run.
- A `ValueError` showed its type, explanation, source line, and traceback; technical diagnostics opened on request. The error/output copy handlers supplied the expected text to an instrumented clipboard stub; operating-system clipboard permissions were not tested.
- The editor ran after an exception and Restart; the stalled-worker warning described a possibility and Stop terminated a synchronous loop.
- Keyboard focus entering the preview worked, moving focus away generated a key release, mouse clicks mapped to Pygame surface coordinates, and Tab indentation produced runnable code.
- The harmless worker probe found `document`, `localStorage`, and `parent` unavailable and the worker origin opaque. Chrome blocked fetches to the local site and `example.com`; the configured jsDelivr URL returned HTTP 200.

This is a headed browser smoke suite on one development computer, not cross-browser certification. It used no real credentials. The runtime CDN is an allowed egress destination and can receive code-chosen request data; these observations do not prove complete data-loss prevention.

### Headed Chromium performance sample

Chrome was started with a fresh temporary profile. “Repeat” uses the same profile after the first run. Runtime-ready and first-frame times are measured from Run; frame intervals are timestamped at the editor canvas `putImageData` call over a 2.5-second sample. Main-page heap does not include the worker's Wasm heap. Stop timing measures Stop click to the UI's stopped state.

| Workload | Runtime ready | First frame | FPS | Mean / p95 frame interval | Jitter (std dev) | Editor-page JS heap | Stop to UI |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Moving shape, fresh profile | 8.94 s | 9.06 s | 22.9 | 43.75 / 50.6 ms | 7.41 ms | 2.9 MiB | 2.6 ms |
| Moving shape, same-profile repeat | 5.89 s | 6.00 s | 22.0 | 45.38 / 51.3 ms | 6.98 ms | 4.8 MiB | 2.7 ms |
| Dino Runner | 8.14 s | 8.41 s | 19.8 | 50.57 / 53.7 ms | 9.47 ms | 11.7 MiB | 4.1 ms |
| Moderate draw workload | 7.65 s | 7.78 s | 20.7 | 48.39 / 52.6 ms | 4.73 ms | 5.6 MiB | 1.3 ms |

These are single short measurements from Windows 11 build 26200, Intel Core 7 250U (12 logical cores), and 32 GiB RAM, using Chrome 157.0.8103.79. CPU, worker/Wasm memory, compressed runtime network transfer, and low-powered-device behavior were not measured. The repeated run was faster, but this is not a controlled before/after optimization study.

### Development-host measurements

The separate `tools/benchmark-runtime.mjs` run used Node 24.14.1, Pyodide 314.0.7, pygame-ce 2.5.7, Windows 11 build 26200, Intel Core 7 250U (12 logical cores), and 32 GiB RAM. These values are from local runtime files and worker-to-Node frame transfers; they do not measure browser canvas rendering or a Chromebook.

| Workload | Runtime ready | First frame | FPS | Mean / p95 frame interval | Approx. wasm heap | Stop |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| First local-runtime moving shape | 1.58 s | 1.62 s | 20.4 | 49.08 / 52.33 ms | 36 MiB | 17 ms |
| Warm moving shape | 1.49 s | 1.52 s | 20.8 | 48.14 / 53.38 ms | 36 MiB | 12 ms |
| Dino Runner | 1.64 s | 1.71 s | 19.8 | 50.63 / 67.08 ms | 36 MiB | 20 ms |
| Moderate draw/transform sample | 1.56 s | 1.60 s | 21.0 | 47.73 / 51.61 ms | 36 MiB | 16 ms |

Three extra restart-to-first-frame measurements were 1.53–1.56 s; worker termination was 9–11 ms. Whole Node-process RSS during samples was 186–210 MiB; process CPU estimates were 12.5–21.8%. The local runtime files total 15,059,439 bytes (14.36 MiB) before network compression. These were single short samples. They are not browser, low-powered-device, or before/after optimization comparisons.

### Compatibility classifications

The test evidence and detailed limits are in [`../../docs/GAME_CREATION_GUIDE.md`](../../docs/GAME_CREATION_GUIDE.md). In summary, the Node/Wasm-tested subset includes Pygame surfaces/drawing, `Rect`, scale/rotate, alpha blending, basic sprites, basic display surface/flip, generated image load from the virtual filesystem, default/fallback fonts, Clock delta, yielded async loops, and the exercised key/mouse inputs. Partial or untested behavior includes display flags and dirty rectangles, resizing/fullscreen, full keyboard/modifier mapping, exact event-queue semantics, timers, custom asset/font upload, broader sprite APIs, and all audio/autoplay behavior. This is not full pygame-ce compatibility.

### Security and readiness

The iframe remains sandboxed without `allow-same-origin`; Python executes in a disposable worker, not on a server. Chrome verified the tested local/external request blocks and the configured CDN request. The worker input/frame/output boundaries have additional bounds and checks. The iframe still requires `unsafe-eval` for pygame-ce's dynamic runtime behavior, and the runtime CDN remains an allowed network destination. Firefox policy enforcement and broader egress paths remain unverified. There is no enforceable hard browser memory quota or CPU limit.

**Historical recommendation before the fixed-code demo: not ready for arbitrary user-written Python.** The following section records the later fixed-source integration and supersedes the earlier recommendation for this limited demonstration.

## J. Fixed-source public preview integration (2026-11-17)

### Public behavior

- Added a WIP Game Studio page to the static site navigation. It displays the original Dino Runner Python in a native read-only text area that supports selection, scrolling, and copying.
- Run, Stop, and Restart use the existing Pyodide/pygame-ce runtime. The page's sample display and the embedded sandbox source are generated from the original games/site_games/dino-runner/main.py file, and the site checker verifies an exact byte match.
- The host sends only the allowlisted sample ID. The public sandbox bundle has no arbitrary-source start path. Editor contents, query parameters, storage values, and code fields in application messages are not passed as executable Python.
- The experimental editable prototype is not included in the assembled site. There is no editor submission, upload, save, login, or account feature.

### Security assessment and limits

Repository and built-page checks found no Supabase client, auth/session integration, site credentials, or privileged application API for the runner to access. The public site is static and has no backend or authenticated data. No concrete credential or privilege exposure was found in the same-origin GitHub Pages setup, so the fixed-source demonstration was enabled.

The execution document remains in an iframe sandbox without allow-same-origin and communicates through validated messages. Each run gets a disposable worker. The restrictive CSP meta policy is scoped to that sandbox document; the main website policy was not changed. The worker runtime still needs unsafe-eval and can connect to jsDelivr. The CDN is a permitted network destination. The policy is not an HTTP response-header policy, and the browser does not provide a hard CPU or memory quota here.

These controls prevent ordinary page interactions from selecting arbitrary Python, but they do not prevent a technically capable visitor from changing locally executed code with browser tools or a modified local copy. This preview does not establish a security boundary for future arbitrary user-written Python. Do not place credentials or authenticated data in the runtime. A later public code editor needs a separate security and hosting design.

### Verification

- Assembled the site from the canonical Dino Runner source and passed scripts/check_site.py.
- Repository suite: 12 passed. Frontend suite: 7 passed. Real Node/Wasm Pyodide/pygame-ce suite passed.
- Headed Google Chrome 157.0.8103.79 passed all 23 recorded checks in the extended CDP browser harness.
- Public checks covered read-only typing, source selection/copy, mobile layout, fixed execution after DOM editor mutation and URL/storage values, iframe sandbox/opaque origin, Space jump, Stop, fresh-worker Restart, repeated runs, refresh cleanup, and application messages with both an unapproved sample ID and a code override.
- Error recovery was checked by making the local test server alter one sandbox response to send a one-time runtime startup error, then running again against the unmodified assembled runtime. This is a deterministic UI recovery test, not a CDN outage test.
- The same headed run tested the experimental editor lifecycle, input, exception handling, worker cleanup, and selected CSP/network boundaries. Chrome allowed the configured jsDelivr request and blocked the tested local-site and example.com requests. This limited probe is not proof of complete egress control.
- Firefox and a low-powered student device were unavailable. The browser suite is a smoke test, not a security certification.

No workflow, authentication, Supabase, push, or deployment change was made. The current public entry can be withdrawn using the steps in experiments/browser-pygame-studio/REMAINING_WORK.md.
