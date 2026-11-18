# Game Studio Phase 2 — remaining work

Updated 2026-11-17. The Phase 2 runtime-hardening work is complete for this experimental prototype. The original handoff below predates the fixed-source public demo; the current status and remaining work are summarized first.

## Current integration status

The public site now has a WIP Game Studio page that displays and copies the bundled Dino Runner source and runs only the embedded Dino Runner sample through the existing Pyodide/Pygame runtime. Executable Python is never read from the editor, URL parameters, browser storage, or application messages; the runtime message only names the allowlisted sample. Each run uses the existing sandboxed opaque-origin iframe and a disposable worker. The editable prototype remains unpublished.

The public static site contains no Supabase client, authentication flow, session token, or privileged application API. The runner receives no authenticated data or site credentials. The tested build contains no matches for Supabase, access-token, or session-access code in its public page and runner files. The main site CSP and authentication settings were not changed.

The browser controls and fixed-source allowlist constrain normal use of this demonstration. They do not stop a technically capable visitor from modifying code that executes locally in their own browser. This is not a security architecture for arbitrary public Python.

### Current verification

- Reassembled build/site from the original Dino Runner source. The generated read-only source and embedded runner sample must match games/site_games/dino-runner/main.py byte for byte; the site checker passed.
- Repository tests: 12 passed. Frontend checks: 7 passed. Node/Wasm runtime suite passed.
- Headed Google Chrome 157.0.8103.79: 23 checks passed through the built public site and existing experiment. Public checks covered read-only typing, source selection/copy, fixed execution despite editor/URL/storage changes, allowlisted app messages, Space jump, Stop, Restart, repeated runs, refresh cleanup, mobile layout, and recovery after a one-time test-server startup failure.
- The test-server failure injection affects one sandbox response only. The next run used the unmodified assembled runtime and loaded the bundled game from jsDelivr. The browser checks are a smoke suite, not a security certification.

### Remaining work

- Run the browser suite in Firefox when available. Current browser evidence covers headed Chromium only.
- Measure startup, worker/Wasm memory, and CPU on a representative low-powered student device. Current local measurements do not cover one.
- Keep the tested Pygame subset and untested behavior explicit; see the compatibility guide.
- For future arbitrary user-written Python, design separate execution hosting without site credentials, response-header CSP and CORS, runtime egress controls, reviewed message handling, and enforceable CPU/memory limits. The current iframe still needs unsafe-eval and permits connections to jsDelivr. Worker termination is a cleanup/recovery control, not a hard resource quota.

### Withdrawing the public preview

Remove the Game Studio navigation links from index.html, games.html, play.html, create.html, about.html, and game-studio.html, and remove the contextual link on games.html. Then remove game-studio.html from SITE_FILES, remove the build_game_studio_runtime call and generated sample copy from scripts/assemble_site.py, remove site-assets/game-studio-preview.svg, and remove the Game Studio publication assertions from scripts/check_site.py. Reassemble and check build/site before publishing. This withdrawal procedure does not change the separate experimental prototype or the original Dino Runner game source.

## Completed in Phase 2

- Added a beginner-facing Python error panel with deterministic explanations, source location, readable traceback, expandable technical detail, and copy actions.
- Kept runtime/security diagnostics separate from Python output. The warning for stalled code is phrased as a possibility.
- Made each run use a fresh iframe and disposable worker. Stop, normal completion, Python errors, and refresh clean up the worker and game state.
- Bounded source, output, diagnostics, frame dimensions, frame rate, and queued input. Validated input messages. Focus loss clears held keys and mouse buttons and emits release events.
- Added real Pyodide/pygame-ce Node/Wasm coverage and fixtures for graphics, sprites, images, fonts, timing, input, errors, worker termination, and state isolation.
- Added a repeatable Node/Wasm benchmark, headed Chromium/CDP lifecycle and security tests, a Game Studio creation guide, and separate AI generation instructions.

## Phase 2 verification (historical)

- `node experiments/browser-pygame-studio/tools/test-runtime.mjs`: passed the full Node/Wasm suite.
- `.venv\Scripts\python.exe -m unittest discover -s tests -v`: 12 passed.
- `node tests/test_frontend.cjs`: 5 passed.
- `node experiments/browser-pygame-studio/tools/test-browser.mjs`: headed Google Chrome 157.0.8103.79 passed all 14 browser checks, including Game A to B isolation, refresh during a running game, recovery after a Python exception, non-yielding Stop, key focus/release, mouse coordinates, indentation, copy-handler text with an instrumented clipboard stub, and harmless security probes.
- `node --check` on changed JavaScript modules and `git diff --check` passed.

The browser performance run measured first-run moving shape at 8.94 s to runtime ready and 9.06 s to first frame; same-profile repeat at 5.89 s and 6.00 s; Dino Runner at 8.14 s and 8.41 s; and the moderate drawing sample at 7.65 s and 7.78 s. Observed frame rates were 19.8–22.9 FPS. The page JavaScript heap was 2.9–11.7 MiB; this does not include the worker's Wasm heap. Browser CPU and actual network transfer size were not measured. See the detailed measurements in `REPORT.md`.

Firefox is not installed in this environment, so Firefox tests remain unexecuted. No low-powered student device was available. The Chrome test used a temporary profile and a local loopback server; it is an automated headed smoke suite over CDP, not Playwright or a security certification.

## Historical handoff before fixed-demo integration

### 1. Complete the security and hosting design

- The sandbox currently needs `unsafe-eval` for pygame-ce's dynamic runtime behavior. Revisit whether a runtime/library change can remove that directive. Until then, keep this experimental code off the authenticated site.
- The worker can reach jsDelivr. Chrome's harmless probe returned 200 for the CDN and was blocked for the local site and `example.com`; this is a narrow CSP result, not complete egress control. An allowed CDN can still receive code-chosen request data.
- Serve execution from a dedicated origin with no Copper Cloud or Supabase cookies, tokens, or privileged APIs. Define HTTP-delivered CSP and other security headers, CORS policy, and runtime hosting before integration. The current experiment uses a CSP meta element and has no production response-header setup.
- Review iframe/worker message handling, output/frame/input bounds, repeat cleanup, and CSP/CORS behavior in each supported browser. Perform adversarial checks without real credentials.
- Browser worker termination is a recovery control; it does not create a hard CPU or memory limit. Decide whether enforceable limits require a separately isolated execution service.

### 2. Extend browser and performance coverage

- Run the headed suite in Firefox if it becomes available; record the exact browser version and results. Do not infer Firefox support from the Chrome or Node/Wasm results.
- Repeat performance measurements on a representative low-powered student device. Current results are from a Windows 11 development computer with Chrome 157.0.8103.79.
- Measure browser worker/Wasm memory, CPU use, and actual compressed runtime transfer size if a suitable browser profiler is available. Current page-heap numbers cover only the editor page.
- Repeat cold and same-profile runs under controlled network/cache conditions. Current timings are single short samples, not a before/after optimization study.

### 3. Expand or explicitly bound Pygame compatibility

The compatibility guide lists what is tested and what is incomplete. Still test or keep explicitly unsupported/untested: timers, key modifiers and the full key map, event queue filtering and pump semantics, display flags/resizing/fullscreen, custom fonts and user asset paths, broader sprite APIs, and audio/autoplay. `display.update(rect)` redraws/transfers the full surface. Do not advertise full pygame-ce compatibility.

### 4. Plan a later integration stage

After the security review, design the dedicated Game Studio page and navigation entry. Keep execution on the separate origin and source code in the browser. Guest editing/running and account-gated submission are future product work; do not add authentication or submission plumbing until that stage is authorized. Keep Game Studio out of the public site for now.

## Phase 2 recommendation (historical)

**Not ready for arbitrary user-written Python.** This was the Phase 2 recommendation before the fixed-sample public preview was implemented. See REPORT.md for the updated demo status, test evidence, compatibility matrix, security analysis, and remaining work.
