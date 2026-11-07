# Project handoff: Battle Royale Mini web deployment

This file records the project's goals, current state, deployment setup, and lessons learned. Update it when behavior or hosting status changes so future work can continue from verified facts.

## What the user wants

- Keep the existing Pygame survival shooter working.
- Run it in a browser using WebAssembly through `pygbag`.
- Publish it to GitHub Pages from this repository.
- Use this project to build reliable, repeatable habits for setting up and maintaining web game hosting.

The hosting target is static GitHub Pages. There is no separate application server to provision or maintain; pygbag packages the game and GitHub Pages serves the generated files.

## Project layout

```text
copper-cloud/
├── .github/workflows/pygbag.yml  # build and publish workflow
├── assets/                       # future game images, sounds, and fonts
├── .gitignore
├── chatGPD.md                    # this handoff note
├── main.py                       # game entry point
├── pygbag.ini                    # excludes the local virtual environment
└── README.md                     # setup and deployment instructions
```

## What works

- The game is in the root `main.py`, which pygbag recognizes as its entry point.
- The game uses an asynchronous loop and `asyncio.run(main())`.
- Local pygbag packaging succeeded with:

  ```sh
  ./.venv/bin/python -m pygbag .
  ```

- The user reported that the game eventually ran locally in the browser.
- `pygbag.ini` excludes `/.venv`, using the root-relative path format pygbag's packager expects. This prevents Pygame's example WAV files in the environment from being packaged.
- `.gitignore` ignores Python environments and generated `build/` output.
- `.github/workflows/pygbag.yml` is configured to build on pushes to `main` and manual dispatch, then publish `build/web` to `gh-pages`.
- Repository remote: `https://github.com/edburgoyne/copper-cloud.git`.
- Expected Pages URL: `https://edburgoyne.github.io/copper-cloud/`.

## Problems found and fixes

1. **Pygbag packaged the virtual environment.**
   - Symptom: build failed on `pygame/examples/data/secosmic_lo.wav`.
   - Cause: pygbag walked `.venv` under the project directory.
   - Fix: `pygbag.ini` sets `ignoreDirs = ["/.venv"]`. The shorter `.venv` pattern did not match pygbag's paths such as `/.venv/lib/...`.

2. **Wrong pygbag executable was used.**
   - Symptom: traceback pointed to `/opt/miniconda3/bin/pygbag`, despite `.venv` being activated.
   - Fix: call pygbag through the environment explicitly with `./.venv/bin/python -m pygbag .`.

3. **TLS certificate verification failed while pygbag fetched its template.**
   - Symptom: `CERTIFICATE_VERIFY_FAILED` for `pygame-web.github.io`.
   - Fix applied by the user: opened `/Applications/Python 3.13/Install Certificates.command`. A later run downloaded the template and CDN files successfully.

4. **The browser initially showed a blank screen.**
   - Pygbag's first startup can take time to download Python/WASM and pygame-ce. The local server must remain running; `Ctrl+C` stops it.
   - The log included a 404 for `browserfs.min.js`. BrowserFS was removed from pygbag 0.9.3; that 404 alone was not the game crash.

5. **Game crashed on startup with `UnboundLocalError` for `game_state`.**
   - Cause: `main()` both read and assigned module-level game variables.
   - Fix in `main.py`: declare `game_state`, `frame_count`, `storm_timer`, and `storm_radius` global inside `main()`.

6. **Font cache warning in browser.**
   - Message: `no font cache (fc-list format) file found`.
   - This was a warning, not the crash above. Revisit only if text is missing or unreadable in the browser.

## What is not confirmed yet

- A successful GitHub Actions workflow run has not been observed.
- Publication to the `gh-pages` branch and a live GitHub Pages deployment have not been confirmed.
- The live URL has not yet been checked in a browser.
- Mobile controls and playability have not been tested.

## Next deployment steps

1. In GitHub, set **Settings → Actions → General → Workflow permissions** to **Read and write permissions**.
2. Commit and push the project files to `main` if they are still uncommitted:

   ```sh
   git add .gitignore README.md main.py pygbag.ini assets .github/workflows/pygbag.yml chatGPD.md
   git commit -m "Prepare game for pygbag deployment"
   git push origin main
   ```

3. Watch **Actions → Build and publish pygbag game**. Resolve any workflow errors before proceeding.
4. In **Settings → Pages**, select **Deploy from a branch**, branch `gh-pages`, folder `/(root)`. If the branch is not available yet, wait for the workflow to create it and refresh the settings page.
5. Wait for Pages deployment to finish, then open `https://edburgoyne.github.io/copper-cloud/` and confirm the game starts.

## Maintenance notes for future work

- Keep source code and game assets in the repository; do not put assets outside the project root.
- Keep the Pygbag async yield in the game loop. If changing the loop, confirm it still yields every frame in the browser.
- For packaging errors, inspect the full traceback and the packager's ignored file list before changing assets or suppressing validation errors.
- For browser blank screens, keep the local server open and inspect the `?-i` debug output for the first Python traceback. Distinguish harmless missing optional CDN requests from errors that stop `main.py`.
- For hosting changes, verify the full path: source commit → Actions build → `gh-pages` branch update → Pages deployment → live URL.
- Record confirmed results here, including date, workflow run outcome, Pages URL, and any new hosting issues. Do not mark deployment complete based only on a successful local build.
