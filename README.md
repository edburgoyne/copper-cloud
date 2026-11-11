# Copper Cloud Arcade

Copper Cloud hosts browser playable Pygame games. Pygbag builds each published game, and GitHub Actions assembles and publishes the static site to GitHub Pages. The game list and card metadata live in `games/manifest.json`.

## Project layout

```text
copper-cloud/
├── games/
│   ├── manifest.json
│   └── site_games/
│       ├── battle-royale/
│       │   ├── main.py
│       │   ├── thumbnail.svg
│       │   └── assets/
│       └── dino-runner/
│           ├── main.py
│           ├── dino-runner.svg
│           └── assets/
├── scripts/
│   ├── manifest_utils.py
│   ├── prepare_games.py
│   └── assemble_site.py
├── index.html
└── .github/workflows/pygbag.yml
```

`build/` contains generated Pygbag apps and the assembled site. It is ignored by Git.

## Set up the local environment

Use Python 3.11 to match GitHub Actions. Pygbag 0.9.3 is pinned in the workflow and should be used locally too:

**Windows PowerShell**

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install pygbag==0.9.3
```

**macOS or Linux**

```sh
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install pygbag==0.9.3
```

## Add a game

1. Create `games/site_games/<game-id>/main.py` with an async, Pygbag-compatible Pygame game. Use a lowercase ID with words separated by hyphens.
2. Put game-specific files in `games/site_games/<game-id>/assets/` if needed. If you include an `assets` path in the manifest, create that directory; otherwise omit the field.
3. Add an SVG cover in the game's folder.
4. Add a record to the `games` list in `games/manifest.json`:

```json
{
  "id": "new-runner",
  "title": "New Runner",
  "description": "A short description shown on the game card.",
  "category": "Arcade",
  "version": "1.0.0",
  "published": false,
  "featured": false,
  "source": "games/site_games/new-runner/main.py",
  "assets": "games/site_games/new-runner/assets",
  "thumbnail": "games/site_games/new-runner/thumbnail.svg",
  "thumbnail_alt": "A short description of the cover image."
}
```

Set `published` to `true` when the game is ready for the public site. Published games are built and included in the homepage automatically. The game URL is derived from its ID, so existing routes stay stable: `/games/live_games/<game-id>/`. The homepage reads generated `build/site/games.json`; do not add or edit game cards directly in `index.html`.

The manifest validator checks every entry, including unpublished entries, for a unique ID that is URL-safe and filesystem-safe, required metadata, Boolean publishing flags, source and thumbnail files, and optional asset folders. Paths must stay inside the repository and cannot traverse with `..` or symlinks.

To publish a game, change its `published` value to `true`; to remove it from the next public build, change it to `false`. Validation still checks unpublished entries so drafts are ready to build when enabled. Generated game routes live under `build/site/games/live_games/` and are recreated from the published manifest on each assembly.

## Validate and test

Run these commands from the repository root. They use only Python's built-in test framework:

**Windows PowerShell**

```powershell
python scripts/manifest_utils.py
python -m unittest discover -s tests -v
```

**macOS or Linux**

```sh
python scripts/manifest_utils.py
python -m unittest discover -s tests -v
```

The tests use temporary fixture repositories, so they do not modify game sources or your assembled site. `scripts/check_site.py` checks the assembled homepage, JSON registry, public game routes, thumbnails, unpublished route exclusion, and homepage registry-loading code.

## Build and preview locally

Run the build steps from the repository root (`copper-cloud/`), not from `scripts/`:

```sh
python scripts/prepare_games.py
python scripts/assemble_site.py
python scripts/check_site.py
```

Use two terminals from the repository root for the local preview. In the first, start Pygbag's development server and leave it running:

```sh
python -m pygbag build/game-apps/battle-royale
```

Pygbag uses this server on port 8000 to proxy its WebAssembly packages during local development. In the second terminal, serve the assembled homepage:

```sh
python -m http.server 8080 --directory build/site
```

Open `http://localhost:8080/` (or `http://localhost:8080/index.html`). In PowerShell, activate the environment first with `.\.venv\Scripts\Activate.ps1`. GitHub Pages uses Pygbag's public CDN, so the port 8000 server is only needed for local preview. Assembly prepares a complete staged site before replacing `build/site`, and checks all required Pygbag outputs before changing the current site.

The first Pygbag build may take longer while it prepares the browser runtime. The assembled site contains only published games and their cover images.

## Publish

The workflow in `.github/workflows/pygbag.yml` checks out the repository, installs Python 3.11 and Pygbag 0.9.3, validates the manifest, runs the unit tests, builds published games, assembles and checks `build/site`, then publishes to the existing `gh-pages` branch. Any failed step stops deployment. It runs on pushes to `main` and can be started manually from the GitHub Actions tab. The workflow needs repository contents write permission for the existing `gh-pages` publishing action. Keep GitHub Pages configured to deploy from `gh-pages` at the repository root.

When a build fails, inspect the first failing GitHub Actions step. Manifest errors identify the game and field; a missing Pygbag output means the game build did not finish successfully. Run the same validation, test, build, assembly, and site-check commands locally to reproduce it. A successful compile confirms generated files exist, not that gameplay works in a browser.

The homepage fetches `games.json` with `cache: "no-cache"`, asking browsers and the hosting cache to revalidate this small registry. Larger Pygbag game files keep normal caching. If a game list still looks old after a publish, hard refresh the page or open it in a private window and check that the deployed `games.json` contains the expected entries.

The existing game URLs are:

- Battle Royale Mini: `https://edburgoyne.github.io/copper-cloud/games/live_games/battle-royale/`
- Dino Runner: `https://edburgoyne.github.io/copper-cloud/games/live_games/dino-runner/`
