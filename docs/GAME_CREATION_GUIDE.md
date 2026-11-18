# Game Studio Game Creation Guide (Experimental)

The public Game Studio page is a separate, fixed-source preview: visitors can view and copy the bundled Dino Runner source and play that sample, but cannot edit or run their own Python there. This guide describes the experimental editable prototype only; its source editor and generated programs are not published as a public site feature.

This guide describes the isolated browser experiment at `experiments/browser-pygame-studio/`. It is a different runtime from the public Copper Cloud arcade build: Game Studio uses Pyodide, while the arcade's published games use Pygbag. This prototype is not linked from the public site and does not accept submissions.

The runtime is experimental. A headed Chromium smoke suite passed on 2026-11-17 using Google Chrome 157.0.8103.79 on the development computer. It covered program lifecycle, error recovery, keyboard and mouse input, and selected sandbox boundaries. Firefox was unavailable, and this one-machine smoke test does not establish broad browser compatibility, security, or low-powered-device performance. Node/Wasm results verify Python and pygame-ce behavior under Node; they are not browser tests.

## Runtime versions and limits

- Pyodide 314.0.7, with CPython 3.14.2 compiled to WebAssembly.
- pygame-ce 2.5.7.
- Maximum submitted source: 100 KiB.
- Display surface: each dimension must be between 1 and 1280 by 1 and 960 pixels.
- The adapter transfers complete RGBA frames to the page, with a 30 FPS transfer cap. A 640×400 frame is about 0.98 MiB before browser-side work.
- A new disposable worker and interpreter are used for every run. Stop terminates the worker, including a synchronous loop that does not yield.

## Required program shape

Use a complete Python file, import `asyncio` and `pygame`, create a display surface, and yield in every main-loop pass. Keep each frame's work small.

```python
import asyncio
import pygame

pygame.init()
screen = pygame.display.set_mode((640, 400))
clock = pygame.time.Clock()


async def main():
    x = 320
    running = True
    while running:
        for event in pygame.event.get():
            if event.type == pygame.KEYDOWN and event.key == pygame.K_ESCAPE:
                running = False

        keys = pygame.key.get_pressed()
        x += 4 * (keys[pygame.K_RIGHT] - keys[pygame.K_LEFT])
        screen.fill((27, 31, 34))
        pygame.draw.circle(screen, (197, 138, 85), (x, 200), 20)
        pygame.display.flip()
        clock.tick(60)
        await asyncio.sleep(0)


asyncio.run(main())
```

`await asyncio.sleep(0)` is important. It lets the browser process input and frames. `pygame.time.Clock.tick()` reports elapsed time but does not itself wait to enforce its FPS argument; the adapter paces `asyncio.sleep(0)` approximately. A synchronous loop that never yields cannot handle input, though Stop can terminate its worker.

## Compatibility matrix

“Supported” below means exercised in the Node/Wasm test harness with this adapter. It does not mean all pygame-ce behavior is supported or that a browser has been verified.

| Feature | Classification | Tested behavior and limits |
| --- | --- | --- |
| `pygame.Surface`, fill/blit, `pygame.draw` | Supported | Surfaces, shapes, blitting, and pixel reads exercised. Frames are copied from the worker to the page. |
| `pygame.Rect` | Supported | Construction and overlap checks exercised. |
| `pygame.transform.scale` and `rotate` | Supported | Basic scale and rotation exercised. |
| Surface alpha and blending | Supported | `SRCALPHA` surface and alpha compositing exercised. |
| `pygame.sprite.Sprite` and `Group` | Supported | Basic update and draw exercised. Advanced sprite collision/group APIs are untested. |
| Display `set_mode`, `get_surface`, `flip` | Supported | Uses an off-screen Pygame Surface in the worker, not a native SDL/browser display. |
| `display.update(rect)` | Partially supported | The rectangle argument is ignored; the adapter sends the complete surface. No dirty-rectangle optimization. |
| Display flags, resizing, fullscreen, OpenGL | Unsupported or untested | There is no resizable native display. OpenGL is explicitly rejected. Other flags are not meaningfully implemented. |
| Keyboard events and held keys | Partially supported | Letters, digits, arrows, Space, Escape, Enter, Backspace, and Shift are mapped. Other keys and modifier state are incomplete; `get_mods()` returns zero. |
| Mouse motion, buttons, position, focus loss | Partially supported | Node/Wasm tests cover motion, buttons, position, and blur releases. The headed Chromium smoke test covered a click and keyboard release when focus left the preview; browser mouse-blur behavior and Firefox remain untested. |
| Event queue filtering and `pump` options | Partially supported | Basic `event.get()` is exercised. Full pygame queue/filter semantics are untested; the adapter's `pump` argument is ignored. |
| `pygame.time.Clock` and async loop | Partially supported | `tick`, elapsed time, and yielding loop tested. FPS limiting is approximate and timers (`set_timer`) are untested. |
| Default font and missing-font fallback | Supported | Rendering with `Font(None, size)` and fallback through a missing `SysFont` name exercised. |
| Custom fonts | Untested | The prototype has no asset-upload UI. |
| Image load from the runtime virtual filesystem | Supported in Node/Wasm tests | A Python-generated PNG was written and loaded by relative path. Arbitrary user asset upload is not implemented. |
| Sprite sheets and broader image formats | Untested | No browser compatibility claim. |
| Audio and browser autoplay | Untested | The adapter does not provide an audio setup or user-gesture flow. Do not rely on sound. |
| Native extensions or arbitrary Python packages | Unsupported | The runtime only loads its bundled Pyodide packages; native desktop dependencies will not work. |

## Assets and dependencies

The current editor sends Python source, not a project folder. Keep games self-contained or generate simple images/sounds in Python. There is no file picker, upload, save-to-account, or custom asset mounting feature. Do not assume a path on the student's computer exists in the browser virtual filesystem.

Use `pygame` and the Python standard library. Do not assume a package is available merely because it can be installed on desktop Python. Game Studio's Pyodide package environment is separate from the Pygbag publishing environment.

## Errors and recovery

The console presents common Python errors with a deterministic explanation, source line when available, a shortened Python traceback, and expandable technical details. Runtime and security-policy diagnostics are shown separately. Error explanations are not AI generated and can be incomplete.

After an error, edit the source and press Run. Restart reruns the most recently submitted source. Stop discards the worker and its state. A warning that execution may be stalled is a heartbeat heuristic, not proof that code is frozen.

## Testing

From the repository root, download the pinned Pyodide/pygame-ce files and run the real Node/Wasm checks:

```powershell
.\.venv\Scripts\python.exe experiments/browser-pygame-studio/tools/download_runtime.py
node experiments/browser-pygame-studio/tools/test-runtime.mjs
node experiments/browser-pygame-studio/tools/benchmark-runtime.mjs
node experiments/browser-pygame-studio/tools/test-browser.mjs
```

The browser harness launches a visible Chrome window and serves only the experiment from loopback. It requires Chrome at the default Windows path or `CHROME_PATH`; the environment used for the recorded result had no Playwright dependency. Run it with a normal headed browser environment and record the exact version. Firefox coverage remains outstanding.

To try the editor in a browser, serve it over HTTP:

```powershell
.\.venv\Scripts\python.exe -m http.server 8768 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8768/experiments/browser-pygame-studio/`, click Run, and focus the preview for input. Browser results must be recorded separately from Node/Wasm results. Test current Chromium and Firefox versions where available, including stopping, refresh during a run, error recovery, keyboard focus, and mouse input.

## Common issues

- **No frame appears:** serve over HTTP, check the browser console/network tab for blocked CDN requests, and ensure the loop awaits `asyncio.sleep(0)`.
- **A module cannot be imported:** it may not be included in the Pyodide runtime. Remove it or check the tested package list.
- **A key remains active:** click the preview, use the supported keys, and move focus away to trigger a release. Report browser-specific problems with the browser/version.
- **Image/font/audio file not found:** this prototype does not upload project assets. Use self-contained code and supported built-in resources.
- **Game feels slow:** reduce display dimensions, full-screen drawing work, transforms, and frame copies. The measured Node results are not device performance estimates.

## Readiness checklist

- [ ] The game uses a yielding async loop and supported APIs.
- [ ] It runs in the current headed Chromium and Firefox versions available to the project.
- [ ] Stop, restart, exceptions, input focus, and refresh have been checked in a real browser.
- [ ] It uses no private files, credentials, account APIs, backend calls, or unsupported assets.
- [ ] It has been reviewed for resource use and is still treated as untrusted code.
- [ ] Public submission and publication are not available through this prototype.
