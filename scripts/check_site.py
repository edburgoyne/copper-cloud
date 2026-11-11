"""Validate generated public files and their links against the manifest."""

import json
from pathlib import Path
from urllib.parse import unquote

from manifest_utils import load_manifest


ROOT = Path(__file__).resolve().parents[1]


def check_site(root=ROOT):
    root = Path(root).resolve()
    site = root / "build" / "site"
    homepage = site / "index.html"
    registry = site / "games.json"
    if not homepage.is_file():
        raise ValueError(f"Assembled homepage is missing: {homepage}")
    if not registry.is_file():
        raise ValueError(f"Generated game registry is missing: {registry}")

    try:
        public_games = json.loads(registry.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"Generated game registry is not valid JSON: {exc}") from exc
    if not isinstance(public_games, list):
        raise ValueError("Generated game registry must contain a JSON list.")

    manifest_games = load_manifest(
        published_only=True,
        validate=True,
        manifest_path=root / "games" / "manifest.json",
        root=root,
    )
    expected_ids = [game["id"] for game in manifest_games]
    actual_ids = [game.get("id") for game in public_games if isinstance(game, dict)]
    if actual_ids != expected_ids or len(public_games) != len(expected_ids):
        raise ValueError(
            f"Public registry game IDs {actual_ids!r} do not match published manifest IDs "
            f"{expected_ids!r}."
        )

    public_fields = ("title", "description", "category", "featured", "thumbnail_alt")
    for manifest_game, public_game in zip(manifest_games, public_games):
        for field in public_fields:
            if public_game.get(field) != manifest_game[field]:
                raise ValueError(
                    f"Public game {manifest_game['id']!r} has incorrect {field!r} metadata."
                )

    homepage_text = homepage.read_text(encoding="utf-8")
    for marker in (
        'fetch("./games.json"',
        'cache: "no-cache"',
        "gameGrid.replaceChildren",
        "game.thumbnail",
        "game.url",
    ):
        if marker not in homepage_text:
            raise ValueError(f"Homepage does not appear to load and render games.json ({marker}).")

    for entry in public_games:
        game_id = entry["id"]
        for field in ("url", "thumbnail"):
            value = entry.get(field)
            if not isinstance(value, str) or not value.startswith("./"):
                raise ValueError(f"Public game {game_id!r} has an invalid {field} URL: {value!r}")
            target = (site / unquote(value[2:])).resolve()
            try:
                target.relative_to(site)
            except ValueError as exc:
                raise ValueError(f"Public game {game_id!r} {field} escapes the site: {value!r}") from exc
            if field == "url":
                target = target / "index.html"
            elif target.suffix.lower() not in {".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp"}:
                raise ValueError(f"Public game {game_id!r} thumbnail is not an image URL: {value!r}")
            if not target.is_file():
                raise ValueError(f"Public game {game_id!r} {field} target is missing: {target}")

    for game in load_manifest(
        published_only=False,
        validate=True,
        manifest_path=root / "games" / "manifest.json",
        root=root,
    ):
        if game["published"]:
            continue
        route = site / "games" / "live_games" / game["id"]
        if route.exists():
            raise ValueError(f"Unpublished game {game['id']!r} has a generated public route: {route}")

    print(f"Checked {len(public_games)} public games, routes, thumbnails, and homepage registry loading.")


def main():
    try:
        check_site()
    except (ValueError, OSError) as exc:
        raise SystemExit(str(exc)) from exc


if __name__ == "__main__":
    main()
