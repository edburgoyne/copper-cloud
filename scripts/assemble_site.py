"""Assemble the homepage and all registered pygbag games for preview/Pages."""

from pathlib import Path
import json
import shutil


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "games" / "manifest.json"
SITE_ROOT = ROOT / "build" / "site"
LIVE_GAMES = ROOT / "games" / "live_games"

try:
    games = json.loads(MANIFEST.read_text())
except (OSError, json.JSONDecodeError) as exc:
    raise SystemExit(f"Could not read game registry {MANIFEST}: {exc}") from exc

for game in games:
    slug = game["slug"]
    game_build = ROOT / "build" / "game-apps" / slug / "build" / "web"
    if not (game_build / "index.html").is_file():
        raise SystemExit(
            f"No pygbag build found for {slug!r}. Run `python scripts/prepare_game.py` first."
        )

# Both destinations are generated output. Recreate the site tree to remove stale game routes.
if SITE_ROOT.exists():
    shutil.rmtree(SITE_ROOT)
SITE_ROOT.mkdir(parents=True)

# Directories in live_games are generated routes; maintained sources are .py files there.
for existing_route in LIVE_GAMES.iterdir():
    if existing_route.is_dir() and existing_route.name != "__pycache__":
        shutil.rmtree(existing_route)

for game in games:
    slug = game["slug"]
    game_build = ROOT / "build" / "game-apps" / slug / "build" / "web"
    route = Path("games") / "live_games" / slug

    published_game = SITE_ROOT / route
    published_game.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(game_build, published_game)

    # Copy each generated route into the source tree too, so Go Live from root works.
    local_game = ROOT / route
    shutil.copytree(game_build, local_game)
    print(f"Added {slug} at /{route.as_posix()}/")

shutil.copy2(ROOT / "index.html", SITE_ROOT / "index.html")
shutil.copytree(ROOT / "site-assets", SITE_ROOT / "site-assets")
(SITE_ROOT / ".nojekyll").touch()

print(f"Assembled {len(games)} games and the homepage in {SITE_ROOT}")
