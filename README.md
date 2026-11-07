# Copper Cloud Arcade

A manually curated homepage for browser games. Pygame games are compiled with pygbag and published together through GitHub Pages.

## Game organization

```text
copper-cloud/
├── games/
│   ├── assets/
│   │   ├── battle-royale/
│   │   └── dino-runner/
│   ├── in_progress/
│   │   ├── battle_royale.py       # synchronous desktop game
│   │   └── dino_game.py           # synchronous desktop game
│   ├── live_games/
│   │   ├── battle_royale.py       # async pygbag source
│   │   ├── dino_game.py           # async pygbag source
│   │   ├── battle-royale/         # generated web route; ignored by git
│   │   └── dino-runner/            # generated web route; ignored by git
│   └── manifest.json              # source and URL slug for each live game
├── scripts/
│   ├── assemble_site.py
│   └── prepare_game.py
├── site-assets/
│   ├── battle-royale-mini.svg
│   └── dino-runner.svg
├── index.html
└── .github/workflows/pygbag.yml
```

The `in_progress` copies use a normal synchronous Pygame loop. For example:

```sh
./.venv/bin/python games/in_progress/dino_game.py
```

Each browser-ready game source is listed in `games/manifest.json`. Pygbag requires each app to contain a file named `main.py`, so the build script stages every listed source under that name in `build/game-apps/<slug>/`, builds it, and keeps the maintained source filenames unchanged. Each slug becomes that game's URL folder.

## Add another Pygame game

1. Develop it in `games/in_progress/<name>.py` using a standard Pygame loop.
2. When it is ready for browser play, put an async pygbag-compatible copy in `games/live_games/<name>.py`.
3. Add a unique URL `slug`, source path, and optional asset directory to `games/manifest.json`.
4. Add its cover image under `site-assets/` and copy a `.game-card` in `index.html`. Point the card to `./games/live_games/<slug>/` and update the visible game count.
5. Run the local build steps below. The scripts build and assemble every game in the manifest.

For example, a new Dino-style entry looks like:

```json
{
  "slug": "new-runner",
  "source": "games/live_games/new_runner.py",
  "assets": "games/assets/new-runner"
}
```

For game-specific assets, use `games/assets/<slug>/`; the build script copies that folder into that game's staged pygbag app as `assets/`.

## Why the homepage tile needs a build

Go Live serves static files; it does not execute Python or compile Pygame. The homepage card navigates to a folder containing pygbag's generated web files. The build and assembly scripts create that folder for Go Live and create the matching folder in `build/site` for GitHub Pages.

Running pygbag against a single game app opens that game's own page directly. It does not serve the arcade homepage. To test the combined site, build and assemble the games first, then serve `build/site` or open the root homepage with Go Live.

## Preview locally

Build every configured game, assemble the homepage, and serve the assembled site:

```sh
./.venv/bin/python scripts/prepare_game.py
./.venv/bin/python scripts/assemble_site.py
./.venv/bin/python -m http.server 8080 --directory build/site
```

Open `http://localhost:8080`. The first pygbag build can take longer while runtime files download. To use Go Live, open the root `index.html` after assembly; the scripts also place each generated game route under `games/live_games/` for this local preview.

To launch one compiled game directly in pygbag's server, use its staged folder, for example:

```sh
./.venv/bin/python -m pygbag build/game-apps/dino-runner
```

This opens the Dino game directly, without the homepage.

## GitHub Pages deployment

The workflow `.github/workflows/pygbag.yml` builds every game in the manifest, assembles the homepage and all game routes into `build/site`, and publishes that directory to `gh-pages` on pushes to `main`. It can also be run manually from **Actions**.

Before deployment, configure:

1. **Settings → Actions → General → Workflow permissions**: **Read and write permissions**.
2. **Settings → Pages → Build and deployment**: **Deploy from a branch**, branch `gh-pages`, folder `/(root)`.

The homepage is `https://edburgoyne.github.io/copper-cloud/`. The game URLs are:

- Battle Royale Mini: `https://edburgoyne.github.io/copper-cloud/games/live_games/battle-royale/`
- Dino Game: `https://edburgoyne.github.io/copper-cloud/games/live_games/dino-runner/`
