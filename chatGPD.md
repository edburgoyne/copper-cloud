# Project handoff: Copper Cloud Arcade

## Hosting model

Copper Cloud is a static browser game site. `games/manifest.json` is the source of truth for game metadata, source and thumbnail paths, and publishing status. Pygbag compiles published Pygame sources, `scripts/assemble_site.py` builds `build/site/`, and GitHub Actions publishes that directory to GitHub Pages.

## Current layout

```text
games/
├── manifest.json
└── site_games/<game-id>/
    ├── main.py
    ├── <cover>.svg
    └── assets/
scripts/
├── manifest_utils.py
├── prepare_games.py
└── assemble_site.py
index.html
.github/workflows/pygbag.yml
```

The homepage reads the generated `build/site/games.json` and creates its cards at runtime. The assembler copies each cover to its manifest path and publishes game builds under `games/live_games/<game-id>/`. Those routes preserve the existing public URLs.

## Current games

- Dino Runner: `games/site_games/dino-runner/main.py`, ID `dino-runner`.
- Battle Royale Mini: `games/site_games/battle-royale/main.py`, ID `battle-royale`.
- Both reorganized source files match the prior Pygbag sources apart from line endings.

## Local workflow

With the virtual environment active and Pygbag installed:

```sh
python scripts/prepare_games.py
python scripts/assemble_site.py
python -m http.server 8080 --directory build/site
```

Open `http://localhost:8080`. Python 3.11 matches CI. The local `.venv` currently uses Python 3.13.9.

## Manifest rules

- IDs use lowercase letters and digits separated by single hyphens.
- IDs determine public routes; do not rename an existing ID unless changing its public URL is intended.
- Every record includes `title`, `description`, `category`, `version`, boolean `published` and `featured`, `source`, `thumbnail`, and `thumbnail_alt`.
- `assets` is optional and, when present, names a directory copied into the staged Pygbag app.
- Unpublished games are validated but omitted from builds, `games.json`, and the public routes.

## Verification status

- Both Pygbag builds and site assembly passed locally.
- Local HTTP checks returned the homepage, both game routes, and both SVG covers successfully.
- Invalid and duplicate IDs were rejected, and an unpublished game was excluded from a temporary assembled-site check.
- Browser interaction/gameplay and GitHub Pages deployment have not been verified.

## Deployment

`.github/workflows/pygbag.yml` runs `scripts/prepare_games.py` and `scripts/assemble_site.py`, then publishes `build/site` to `gh-pages` on pushes to `main` or manual dispatch. Expected Pages root: `https://edburgoyne.github.io/copper-cloud/`.

The existing game URLs are:

- Battle Royale Mini: `https://edburgoyne.github.io/copper-cloud/games/live_games/battle-royale/`
- Dino Runner: `https://edburgoyne.github.io/copper-cloud/games/live_games/dino-runner/`
