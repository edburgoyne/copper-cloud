# Browser-based Pygame studio: proof-of-concept report

**Status: draft complete. Recommendation: Conditionally feasible.** Real Python and pygame-ce have executed the editor's example and the unchanged Dino Runner source in a user's browser. The user confirmed Dino's controls, Run/Stop/Restart, and stopping a non-yielding loop; Dino initially ran slowly but felt faster after the timing and rendering changes. A harmless security probe passed the specific checks below. Refresh during an active game, broader browser compatibility, and adversarial security testing remain outstanding.

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
| C — Exception | **Browser and Node/Wasm passed:** a deliberate `ValueError` produced a traceback containing `main.py`. The user reported the browser console output was unwieldy because it also included a long JavaScript/Wasm stack. Error formatting has since been shortened and awaits browser retesting. |
| D — Infinite loop | **Browser and Node/Wasm passed:** the user confirmed Stop ended the infinite-loop sample; in Node a separate worker terminated in 19 ms in one run. No Python exception is expected for valid infinite-loop code. A heartbeat warning was added; whether it appeared in the user's test was not reported. |
| E — Repeated execution | **Browser:** the user reported that Run, Stop, and Restart function as intended and ran the example, exception, infinite loop, Dino Runner, and security probe in successive runs. **Node/Wasm:** separate workers ran different source texts with independent output. A specific browser test for leaked state between programs was not performed. |
| F — Refresh | The user refreshed during troubleshooting and successfully ran programs afterward. Refresh during an active game and confirmation that its worker terminates were not explicitly tested. |
| G — Browser compatibility | An initial headless Chromium run failed before Python started. A subsequent user-run browser test loaded Pyodide with the `data:` workaround, then exposed the CSP issue; after the CSP adjustment the user reported the example rendered. The browser and version were not recorded. Firefox was not installed for automated testing. |
| H — Security boundaries | **Browser, limited probe passed:** the user reported `document`, `localStorage`, and `parent` absent from the worker's `js` globals and `worker_origin null`. Requests to the local site and `example.com` were blocked by `connect-src`; a request to the runtime CDN returned 200. No real credentials were used. These checks do not prove resistance to all escapes, authenticated requests, or resource-exhaustion attacks. |

The user confirmed that editor indentation and the console-copy button work after the update, liked the placement of the copy button, and confirmed that the network warnings explain the blocked requests clearly.

The first Chromium failure was accompanied by the browser message `Refused to cross-origin redirects of the top-level worker script.`, consistent with a documented problem involving **module workers from `blob:` URLs inside opaque-origin sandboxed iframes**. The iframe now creates a self-contained `data:` module worker while keeping the sandbox. A user-run browser test progressed through Pyodide startup with this workaround, then identified the separate CSP evaluation error described below. See the [reproduction and browser matrix](https://github.com/maplibre/maplibre-gl-js/issues/8909).

The unchanged site's existing checks also passed: 12 Python build tests and five simulated-DOM JavaScript tests. Local HTTP checks returned the experiment's HTML, scripts, samples, and bridge successfully. These checks do not establish browser gameplay.

### Recorded browser observations

- The example displayed a first frame after a reported **8.97 s** runtime initialization and **9.84 s** total. The user reported that the studio worked.
- The deliberate exception displayed a Python traceback ending with `ValueError: The sample exception reached the console`, including the original `main.py` line numbers. The initial output also contained a long JavaScript/Wasm stack, which the user found disruptive; a shorter error format was added afterward and has not been separately confirmed.
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

In one Node.js run using already downloaded local files, the interpreter initialized in about **1.36 s** and pygame-ce was ready in about **1.51 s** total. In one user-run browser attempt, the prototype reported **8.97 s** to runtime readiness and **9.84 s** to first frame. The browser had made earlier attempts, so its cache state is unknown; these are single observations, not cold-start benchmarks. Browser transfer size, memory use, and frame rate have not yet been measured.

The user reported an initial load of about 10 seconds and later reloads of about 3–5 seconds after the changes. Each run deliberately creates a fresh worker and initializes a new interpreter, even when browser downloads are cached. A future design could investigate a prewarmed spare worker, while measuring its memory cost and ensuring that runs never inherit another program's state.

Frames are transferred as uncompressed RGBA buffers. An 800×400 game produces 1,280,000 bytes per frame; at the 30-frame-per-second message cap, that is up to 38.4 MB/s of pixel data between contexts, excluding additional copies and drawing. This is a calculated upper bound, not a measured throughput, and may be too expensive on lower-powered devices. After the user reported slow Dino gameplay, the adapter was changed to skip copying frames that would be dropped and to account for frame work in its timing. The user reported it felt faster, but frame rate was not measured.

## F. Approaches compared

| Approach | Pygame and dynamic code | Browser, hosting, and compilation | Reset, isolation, size, and licensing |
| --- | --- | --- | --- |
| Pygbag 0.9.3 | pygame-ce and CPython/Wasm; dynamic source can be fed to its interpreter with additional integration. Existing project packages each game ahead of publication. | Static hosting works; no server-side compilation is inherently required for already available browser-compatible source and runtime. Browser-specific behavior for a new editor is untested. | Normal SDL rendering is tied to a page thread; robust interruption of non-yielding code and isolation need additional design. Runtime transfer and startup were not measured here. Pygbag itself is MIT licensed; audit its CPython, pygame-ce, SDL, and other bundled component licenses before redistribution. |
| Pyodide + worker adapter, this experiment | Real pygame-ce surfaces and dynamically supplied CPython code; display/input/timing are adapted and incomplete, audio and asset uploads are unsupported. | Static files plus CDN; no Python backend or per-program server compilation. A user-run browser rendered the example; cross-browser testing remains outstanding. Chrome/Firefox/Safari are documented Pyodide targets. | Disposable workers stopped a non-yielding loop in both the user-run browser and Node tests. Local file sizes and measured timings are above. Pyodide is MPL-2.0, CPython uses the PSF license, and pygame-ce is LGPL-2.1; review notices and redistribution obligations. |
| Python Arena | Open-source teaching system using Pyodide and real pygame-ce with a much larger display/input shim; it replays interactions and silences sound, so it is not identical to live Pygbag gameplay. | Runs locally in the browser using a worker and static assets; its site reports a roughly 6 MB core and 1.5 MB pygame download, not measurements of this prototype. Browser support and timing were not independently tested here. | Workers are terminated on timeout and restarted; the site's code is MIT licensed, while its lesson content has separate CC BY-NC-SA terms. Study its security model before reuse. Sources: [project source](https://github.com/AntonyPerez0/pythonarena), [about and licenses](https://pythonarena.org/about/). |

## G. Recommendation

**Conditionally feasible.** A user's browser has started the sandboxed runtime, executed the editor example and Dino Runner, accepted Dino's keyboard controls, stopped a non-yielding loop, and passed the limited isolation probes above. State separation, refresh, broader compatibility, and adversarial isolation checks remain outstanding. The adapter's restricted APIs and relaxed sandbox CSP require further design before a student-facing feature is appropriate.

## H. Next steps

1. Finish manual browser checks for state separation, refresh during a running game, the shortened exception output, and the heartbeat warning.
2. Repeat cases A–H in identified Chromium and Firefox versions, including dummy-credential/network fixtures. Measure cold/warm transfers, first frame, frame rate, and memory on a representative student device.
3. Expand or replace the display/input adapter only after deciding which Pygame APIs, assets, fonts, sound, and timing differences can be supported. Compare actual gameplay with Pygbag, not just startup.
4. Put execution on a dedicated origin with no credentials, HTTP-level security headers and validated CORS; review all cross-origin messages, egress, worker cleanup, and denial-of-service behavior.
5. Review runtime supply-chain integrity, version updates, and license notices before redistribution or public release.
