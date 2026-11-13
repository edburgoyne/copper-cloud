# Project handoff: Copper Cloud Arcade

## Hosting model

Copper Cloud is a static browser-game site. `games/manifest.json` is the source of truth for public game metadata, source and thumbnail paths, and publishing status. Pygbag compiles published Pygame sources; `scripts/assemble_site.py` assembles `build/site/`; GitHub Actions publishes that directory to GitHub Pages.

The homepage, games library, and player read the generated `games.json`. `play.html?game=<game-id>` wraps each game; the existing direct Pygbag routes remain `games/live_games/<game-id>/`. All links are relative to the assembled site root. Drafts are validated but excluded from the generated registry and public routes.

## Current layout

- `index.html`, `games.html`, `play.html`, `create.html`, and `about.html` are the static pages.
- `site-assets/` contains shared styles, frontend logic, the replaceable logo and favicon, and the missing-cover fallback.
- `GAME_CREATION_GUIDE.md` is the downloadable guide for students.
- `games/site_games/<game-id>/` contains each source, cover, and optional assets.
- `scripts/` validates the manifest, builds games, assembles the site, and checks its output.
- `tests/` contains Python build-pipeline tests and dependency-free JavaScript interaction tests.

## Current games

- Battle Royale Mini: ID `battle-royale`; published and featured.
- Dino Runner: ID `dino-runner`; unpublished and featured. It will appear in the featured section only when published.

Neither game needs an account. The manifest's `creator` is a configurable public display label. It also provides controls, screen dimensions, category, description, thumbnail, and alt text. Keep IDs and existing direct URLs stable. Do not put private account information in the manifest.

## Local workflow and deployment

See `README.md` for setup, validation, build, preview, and deployment commands. The site must be served over HTTP for registry loading. Pygbag's build and browser runtime need network access to its CDN. A successful build or an HTTP response does not verify browser gameplay; test the actual game, controls, restart, and fullscreen in a browser.

The existing `.github/workflows/pygbag.yml` validates the manifest, runs Python tests, builds published games with Pygbag 0.9.3, assembles and checks the site, then publishes `build/site` to `gh-pages`. Generated build files are ignored by Git.

You can use playwrite for frontend testing, but must adhere to all the rules in UI-tester-suite (besides creating a report) (fo)