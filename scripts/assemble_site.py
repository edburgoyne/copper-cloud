"""Assemble the static site and published Pygbag games under build/site."""

import json
import os
from pathlib import Path
import shutil
from urllib.parse import quote
import uuid

from manifest_utils import load_manifest, resolve_manifest_path


ROOT = Path(__file__).resolve().parents[1]
SITE_FILES = ("index.html", "games.html", "play.html", "create.html", "about.html", "GAME_CREATION_GUIDE.md")


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
