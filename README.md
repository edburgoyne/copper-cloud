# Copper Cloud Arcade

Copper Cloud is a static browser arcade for playing Pygame games and learning to make them. GitHub Actions builds the published games with Pygbag and publishes the assembled `build/site/` directory to GitHub Pages. No backend, accounts, or submission service are required.

## Project layout

```text
games/manifest.json             # game metadata and publishing status
games/site_games/<game-id>/     # Python source, optional assets, and cover
scripts/manifest_utils.py       # manifest loading and validation
scripts/prepare_games.py        # build published games with Pygbag
scripts/assemble_site.py        # assemble the static site and registry
scripts/check_site.py           # validate generated site files and links
site-assets/                    # shared CSS, JavaScript, and replaceable SVGs
index.html, games.html, play.html, create.html, about.html
GAME_CREATION_GUIDE.md          # student-facing downloadable guide
tests/                          # build pipeline tests
.github/workflows/pygbag.yml    # existing build and GitHub Pages deployment
```

`build/` contains generated files and is ignored by Git. The frontend reads `build/site/games.json`, generated solely from published manifest entries. Game cards and recommendations are created from that registry; do not hardcode cards into HTML.

The website wrapper for each game is `play.html?game=<game-id>`. The compiled games retain their existing direct routes at `games/live_games/<game-id>/`. Both kinds of links are relative to the site root so they work under a GitHub Pages project path as well as locally. Unpublished games are validated but omitted from the registry and assembled public routes.

## Set up

Use Python 3.11 to match GitHub Actions. The workflow pins Pygbag 0.9.3.

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

## Validate, build, and preview

Run these from the repository root:

```sh
python scripts/manifest_utils.py
python -m unittest discover -s tests -v
node tests/test_frontend.cjs  # optional: requires Node.js, no packages
python scripts/prepare_games.py
python scripts/assemble_site.py
python scripts/check_site.py
python -m http.server 8080 --directory build/site
```

Open `http://localhost:8080/`. Serve the assembled site over HTTP rather than opening the HTML files directly, so the browser can fetch the registry. Click inside a game after it loads to start it and give it keyboard focus. The game wrapper provides restart and, in browsers that support it, fullscreen. The original direct game link is also available below the controls.

Pygbag downloads its browser template during a fresh build, and the games load their WebAssembly runtime from Pygbag's CDN. Internet access is needed. Some local Pygbag configurations use its development server as a package proxy; if the browser requests `localhost:8000`, run `python -m pygbag build/game-apps/battle-royale` in a second terminal while previewing. A successful build confirms the output exists; actually play the game in a browser to verify gameplay.

The assembler stages a complete site before replacing `build/site/`, checks for required game builds first, and preserves the previous site if assembly fails. The build tests use temporary fixture repositories.

## Add a game

See [GAME_CREATION_GUIDE.md](GAME_CREATION_GUIDE.md) for the student-facing instructions. The current build copies the manifest's Python source to `main.py` and optionally copies an `assets/` directory; it does not copy other files beside the source automatically.

1. Create `games/site_games/<game-id>/main.py` with an asynchronous Pygbag-compatible loop that yields every frame. Use lowercase letters and digits separated by single hyphens for the ID.
2. Add a cover image and, if needed, an `assets/` folder. Use relative paths inside the game.
3. Add a manifest entry. For example:

```json
{
  "id": "new-runner",
  "title": "New Runner",
  "description": "A short description shown on the game card.",
  "category": "Arcade",
  "creator": "Copper Cloud",
  "controls": ["Space: jump", "R: restart"],
  "aspect_ratio": [800, 400],
  "version": "1.0.0",
  "published": false,
  "featured": false,
  "source": "games/site_games/new-runner/main.py",
  "assets": "games/site_games/new-runner/assets",
  "thumbnail": "games/site_games/new-runner/thumbnail.svg",
  "thumbnail_alt": "A short description of the cover image."
}
```

`creator` is a public display label and can be changed per game without an account. `controls` is a nonempty list of instructions, and `aspect_ratio` contains the game's positive screen width and height. Omit `assets` when there is no assets folder. The validator checks every entry, including drafts, for required metadata, valid unique IDs, Boolean flags, readable source and thumbnail files, and safe repository-relative paths. Do not include private account information or secrets.

Only games with `published: true` are built and listed; only published entries with `featured: true` appear in the featured section. Set publishing status only when the game is ready. To test a draft without publishing it in the shared manifest, use an isolated local copy with its status changed, then build and play that copy. Never rename an existing ID unless changing its direct URL is intended.

## Branding and frontend

The temporary marks are `site-assets/logo.svg` and `site-assets/favicon.svg`; replace those files to update the shared header and favicon. `site-assets/game-placeholder.svg` is used when a cover cannot load. Theme colors and other shared styles are centralized in `site-assets/styles.css`, while `site-assets/site.js` handles navigation, registry cards, filtering, and the player. The site uses plain HTML, CSS, and JavaScript.

## Deployment

The existing workflow in `.github/workflows/pygbag.yml` installs the pinned dependency, validates the manifest, runs tests, builds published games, assembles and checks the site, and publishes `build/site/` to the `gh-pages` branch. It runs on pushes to `main` and manual dispatch. GitHub Pages should serve the root of `gh-pages`. No generated build files should be committed.

Battle Royale Mini's existing direct URL is `https://edburgoyne.github.io/copper-cloud/games/live_games/battle-royale/`. Dino Runner retains the ID and route `games/live_games/dino-runner/` when published, but is currently unpublished and therefore excluded from new public assemblies. The registry is fetched with `cache: "no-cache"` so browsers can revalidate it after updates.
