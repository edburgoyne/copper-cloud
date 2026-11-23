"""Assemble the static site and published Pygbag games under build/site."""

import json
import os
from pathlib import Path
import shutil
from urllib.parse import quote
import uuid

from manifest_utils import load_manifest, resolve_manifest_path


ROOT = Path(__file__).resolve().parents[1]
SITE_FILES = ("index.html", "games.html", "play.html", "create.html", "about.html", "game-studio.html", "auth.html", "account.html", "forgot-password.html", "reset-password.html", "GAME_CREATION_GUIDE.md")


def build_game_studio_runtime(root, staged_site):
    """Bundle the existing worker runtime with the one approved public sample."""
    runtime_source = root / "experiments" / "browser-pygame-studio"
    sample_path = root / "games" / "site_games" / "dino-runner" / "main.py"
    sandbox_template = runtime_source / "sandbox.html"
    required = (
        runtime_source / "studio.js",
        runtime_source / "worker.mjs",
        runtime_source / "error-format.mjs",
        runtime_source / "pygame_bridge.py",
        sandbox_template,
        sample_path,
    )
    missing = [path for path in required if not path.is_file()]
    if missing:
        raise SystemExit(f"Game Studio runtime input is missing: {missing[0]}")

    bundle = {
        "runtime": {
            "workerSource": (runtime_source / "worker.mjs").read_text(encoding="utf-8"),
            "errorFormatter": (runtime_source / "error-format.mjs").read_text(encoding="utf-8"),
            "bootstrap": (runtime_source / "pygame_bridge.py").read_text(encoding="utf-8"),
        },
        "samples": {
            "dino-runner": sample_path.read_text(encoding="utf-8"),
        },
    }
    if len(bundle["samples"]["dino-runner"].encode("utf-8")) > 102400:
        raise SystemExit("The approved Game Studio sample exceeds the 100 KiB source limit.")

    template = sandbox_template.read_text(encoding="utf-8")
    marker = "const PUBLIC_DEMO_BUNDLE = null;"
    if template.count(marker) != 1:
        raise SystemExit("Game Studio sandbox must contain exactly one public demo bundle marker.")
    serialized = json.dumps(bundle, ensure_ascii=True, separators=(",", ":"))
    serialized = serialized.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
    public_sandbox = template.replace(marker, f"const PUBLIC_DEMO_BUNDLE = {serialized};", 1)

    runtime_output = staged_site / "site-assets" / "game-studio-runtime"
    runtime_output.mkdir(parents=True, exist_ok=True)
    (runtime_output.parent / "game-studio-sample.py").write_text(
        bundle["samples"]["dino-runner"], encoding="utf-8"
    )
    (runtime_output / "sandbox.html").write_text(public_sandbox, encoding="utf-8")
    shutil.copy2(runtime_source / "studio.js", runtime_output / "studio.js")


def assemble_site(root=ROOT):
    root = Path(root).resolve()
    manifest_path = root / "games" / "manifest.json"
    games = load_manifest(
        published_only=True, validate=True, manifest_path=manifest_path, root=root
    )
    site_root = root / "build" / "site"
    games_build_root = root / "build" / "game-apps"
    for filename in SITE_FILES:
        if not (root / filename).is_file():
            raise SystemExit(f"Site source is missing: {root / filename}")
    if not (root / "site-assets").is_dir():
        raise SystemExit(f"Site assets are missing: {root / 'site-assets'}")

    for game in games:
        game_id = game["id"]
        game_build = games_build_root / game_id / "build" / "web"
        if not (game_build / "index.html").is_file():
            raise SystemExit(
                f"No Pygbag build found for {game_id!r} at {game_build}. "
                "Run scripts/prepare_games.py first."
            )

    site_root.parent.mkdir(parents=True, exist_ok=True)
    staging_parent = site_root.parent / f".site-staging-{uuid.uuid4().hex}"
    staging_parent.mkdir()
    staged_site = staging_parent / "site"
    backup_site = staging_parent / "previous-site"
    staged_site.mkdir()
    try:
        public_games = []
        for game in games:
            game_id = game["id"]
            game_build = games_build_root / game_id / "build" / "web"
            route = Path("games") / "live_games" / game_id
            shutil.copytree(game_build, staged_site / route)

            thumbnail = resolve_manifest_path(
                game["thumbnail"], field="thumbnail", game_id=game_id, root=root
            )
            thumbnail_relative = thumbnail.relative_to(root)
            thumbnail_destination = staged_site / thumbnail_relative
            thumbnail_destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(thumbnail, thumbnail_destination)

            public_games.append(
                {
                    "id": game_id,
                    "title": game["title"],
                    "description": game["description"],
                    "category": game["category"],
                    "creator": game["creator"],
                    "controls": game["controls"],
                    "aspect_ratio": game["aspect_ratio"],
                    "featured": game["featured"],
                    "thumbnail": "./" + quote(thumbnail_relative.as_posix(), safe="/"),
                    "thumbnail_alt": game["thumbnail_alt"],
                    "url": "./" + route.as_posix() + "/",
                    "page_url": "./play.html?game=" + quote(game_id, safe=""),
                }
            )
            print(f"Added {game_id} at /{route.as_posix()}/")

        for filename in SITE_FILES:
            shutil.copy2(root / filename, staged_site / filename)
        shutil.copytree(root / "site-assets", staged_site / "site-assets", dirs_exist_ok=True)
        build_game_studio_runtime(root, staged_site)
        (staged_site / "games.json").write_text(
            json.dumps(public_games, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        (staged_site / ".nojekyll").touch()

        moved_previous = False
        try:
            if site_root.exists():
                os.replace(site_root, backup_site)
                moved_previous = True
            os.replace(staged_site, site_root)
        except OSError:
            if moved_previous and not site_root.exists():
                os.replace(backup_site, site_root)
            raise

        if backup_site.exists():
            shutil.rmtree(backup_site)
        print(f"Assembled {len(public_games)} published games in {site_root}")
    finally:
        shutil.rmtree(staging_parent, ignore_errors=True)


def main():
    try:
        assemble_site()
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc


if __name__ == "__main__":
    main()
