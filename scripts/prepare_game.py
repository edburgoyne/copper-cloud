"""Stage and pygbag-build every game listed in games/manifest.json."""

from pathlib import Path
import json
import shutil
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "games" / "manifest.json"
BUILD_ROOT = ROOT / "build" / "game-apps"

try:
    games = json.loads(MANIFEST.read_text())
except (OSError, json.JSONDecodeError) as exc:
    raise SystemExit(f"Could not read game registry {MANIFEST}: {exc}") from exc

if not games:
    raise SystemExit("No games are configured in games/manifest.json")

slugs = [game.get("slug") for game in games]
if len(slugs) != len(set(slugs)):
    raise SystemExit("Every game in games/manifest.json must have a unique slug")

for game in games:
    slug = game.get("slug", "")
    if not slug or Path(slug).name != slug or slug in {".", ".."}:
        raise SystemExit(f"Invalid game slug: {slug!r}")

    source = ROOT / game["source"]
    if not source.is_file():
        raise SystemExit(f"Source for {slug!r} does not exist: {source}")

    app = BUILD_ROOT / slug
    if app.exists():
        shutil.rmtree(app)
    app.mkdir(parents=True)
    shutil.copy2(source, app / "main.py")

    assets_rel = game.get("assets")
    if assets_rel:
        assets = ROOT / assets_rel
        if not assets.is_dir():
            raise SystemExit(f"Assets for {slug!r} do not exist: {assets}")
        shutil.copytree(assets, app / "assets")

    app_arg = app.relative_to(ROOT).as_posix()
    print(f"\n=== Building {slug} from {source.relative_to(ROOT)} ===", flush=True)
    subprocess.run(
        [sys.executable, "-m", "pygbag", "--build", app_arg],
        cwd=ROOT,
        check=True,
    )
