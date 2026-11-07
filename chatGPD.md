# Project handoff: Copper Cloud Arcade

Update this note with observed behavior, deployment results, and lessons from future server work.

## Goal and hosting model

The user wants a manually curated homepage containing multiple games, with desktop-friendly Pygame development copies and browser-ready published copies. GitHub Pages is static hosting. Go Live and Pages serve files; pygbag compiles Python/Pygame to browser files. Neither static host executes `.py` source.

## Scalable game layout

```text
games/
├── assets/<slug>/                 # per-game resources copied into pygbag app
├── in_progress/<name>.py          # synchronous desktop Pygame
├── live_games/<name>.py           # async pygbag-ready source
├── live_games/<slug>/             # generated local web route, gitignored
└── manifest.json                  # registry of live source, slug, assets
```

Homepage cards are intentionally edited by hand in `index.html`; each card URL must match its manifest slug at `./games/live_games/<slug>/`. Cover art lives in `site-assets/`.

Pygbag requires an app directory with `main.py`. `scripts/prepare_game.py` now loops over every manifest entry, stages each source as `build/game-apps/<slug>/main.py`, copies its optional assets, and runs `python -m pygbag --build` for each. `scripts/assemble_site.py` copies all generated routes to `build/site/games/live_games/<slug>/` for GitHub Pages and into the source tree for local Go Live. `.gitignore` ignores generated directories under `games/live_games/`.

## Current games

- Battle Royale Mini: desktop source `games/in_progress/battle_royale.py`; pygbag source `games/live_games/battle_royale.py`; slug `battle-royale`; homepage art `site-assets/battle-royale-mini.svg`.
- Dino Game: desktop source `games/in_progress/dino_game.py`; pygbag source `games/live_games/dino_game.py`; slug `dino-runner`; homepage art `site-assets/dino-runner.svg`.
- Both manifest builds completed successfully. Assembly created both route pages under `build/site/games/live_games/` and local Go Live paths. Python sources and scripts passed `py_compile`.

The Dino desktop copy uses a synchronous loop. Its live copy is async and yields after `pygame.display.flip()`. Its async `main()` declares the mutable module-level game state as global. Battle Royale's live source likewise declares `game_state`, `frame_count`, `storm_timer`, and `storm_radius` global inside its async loop.

## Current commands

Run the Dino desktop version:

```sh
./.venv/bin/python games/in_progress/dino_game.py
```

Build all manifest games and assemble the full site:

```sh
./.venv/bin/python scripts/prepare_game.py
./.venv/bin/python scripts/assemble_site.py
./.venv/bin/python -m http.server 8080 --directory build/site
```

Open `http://localhost:8080`. To use Go Live, open root `index.html` after assembly; generated routes are copied under `games/live_games/`.

## Deployment

`.github/workflows/pygbag.yml` runs the two scripts above and publishes `build/site` to `gh-pages` on `main` pushes or manual dispatch. GitHub remote: `https://github.com/edburgoyne/copper-cloud.git`. Expected Pages root: `https://edburgoyne.github.io/copper-cloud/`.

Before first publish, enable **Settings → Actions → General → Workflow permissions → Read and write permissions** and set **Settings → Pages → Build and deployment → Deploy from a branch → gh-pages → /(root)**.

## Previous troubleshooting

- `.venv` was being included in pygbag packaging and triggered a WAV format error. `pygbag.ini` uses `/.venv` in its ignore list; pygbag walks root-relative paths.
- A global Miniconda `pygbag` was selected despite the virtual environment being active. Use `./.venv/bin/python -m pygbag` or the project scripts.
- macOS Python's CA roots were missing. The user ran `/Applications/Python 3.13/Install Certificates.command`, after which pygbag downloaded its template/CDN resources.
- Pygbag 0.9.3 logs a `browserfs.min.js` 404 because BrowserFS was removed. That request alone was not the game failure.
- `pygbag .` launches the game directly at its own root and bypasses the arcade homepage. For the combined site, build all apps, assemble, and serve `build/site` or open the root homepage after routes were generated.

## Not yet confirmed

- Dino's desktop and browser versions have not yet been launched by the user.
- The generated games have not yet been run in a browser after this refactor.
- Go Live with both tiles and the GitHub Actions/Pages deployment have not been confirmed.
- Keep deployment status separate: local game run, successful build, Actions publication, Pages deployment, and browser-verified live game are different checkpoints.

## Adding a game

1. Develop a synchronous desktop version in `games/in_progress/`.
2. Add an async browser-ready copy in `games/live_games/`.
3. Add a unique `slug`, source path, and optional asset directory in `games/manifest.json`.
4. Add a cover to `site-assets/` and manually copy/update a card in `index.html` (including game count).
5. Run the build/assembly commands, verify the local route, then push and verify Actions and Pages.
