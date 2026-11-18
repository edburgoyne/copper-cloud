"""Validate generated public files and their links against the manifest."""

import json
from pathlib import Path
from urllib.parse import quote, unquote

from assemble_site import SITE_FILES
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
    for filename in SITE_FILES:
        if not (site / filename).is_file():
            raise ValueError(f"Assembled site file is missing: {filename}")
    for filename in (
        "styles.css", "site.js", "logo.svg", "favicon.svg", "game-placeholder.svg",
        "game-studio-sample.py", "game-studio-preview.svg",
    ):
        if not (site / "site-assets" / filename).is_file():
            raise ValueError(f"Assembled site asset is missing: {filename}")
    original_dino_source = root / "games" / "site_games" / "dino-runner" / "main.py"
    public_dino_source = site / "site-assets" / "game-studio-sample.py"
    if not original_dino_source.is_file() or public_dino_source.read_bytes() != original_dino_source.read_bytes():
        raise ValueError("Public Game Studio source must exactly match the original Dino Runner game.")

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

    public_fields = (
        "title", "description", "category", "creator", "controls", "aspect_ratio",
        "featured", "thumbnail_alt",
    )
    for manifest_game, public_game in zip(manifest_games, public_games):
        for field in public_fields:
            if public_game.get(field) != manifest_game[field]:
                raise ValueError(
                    f"Public game {manifest_game['id']!r} has incorrect {field!r} metadata."
                )

    frontend_script = (site / "site-assets" / "site.js").read_text(encoding="utf-8")
    for marker in ('fetch("./games.json"', 'cache: "no-cache"', "createGameCard", "game.page_url"):
        if marker not in frontend_script:
            raise ValueError(f"Frontend does not appear to load and render games.json ({marker}).")
    html_pages = ("index.html", "games.html", "play.html", "create.html", "about.html", "game-studio.html")
    for filename in html_pages:
        page = (site / filename).read_text(encoding="utf-8")
        if "./site-assets/styles.css" not in page or "./site-assets/site.js" not in page:
            raise ValueError(f"Site page {filename!r} is missing shared frontend assets.")
        if 'href="./game-studio.html"' not in page:
            raise ValueError(f"Site page {filename!r} is missing the Game Studio navigation link.")

    games_page = (site / "games.html").read_text(encoding="utf-8")
    if games_page.count('href="./game-studio.html"') < 2:
        raise ValueError("Games page is missing its contextual Game Studio link.")

    studio_page = (site / "game-studio.html").read_text(encoding="utf-8")
    for marker in ('id="code"', "readonly", 'id="run"', 'id="stop"', 'id="restart"', "Dino Runner"):
        if marker not in studio_page:
            raise ValueError(f"Game Studio page is missing required demo markup ({marker}).")
    if "contenteditable" in studio_page.lower() or "<form" in studio_page.lower():
        raise ValueError("Game Studio page must not expose editable or submitting form controls.")

    runtime_dir = site / "site-assets" / "game-studio-runtime"
    sandbox = runtime_dir / "sandbox.html"
    host_script = runtime_dir / "studio.js"
    if not sandbox.is_file() or not host_script.is_file():
        raise ValueError("Assembled Game Studio runner files are missing.")
    sandbox_source = sandbox.read_text(encoding="utf-8")
    if "const PUBLIC_DEMO_BUNDLE = null;" in sandbox_source or '"dino-runner"' not in sandbox_source:
        raise ValueError("Public Game Studio sandbox is missing the bundled Dino Runner allowlist.")
    if 'message.type === "start-demo"' not in sandbox_source or 'message.type === "start" && !PUBLIC_DEMO_BUNDLE' not in sandbox_source:
        raise ValueError("Public sandbox must accept the fixed sample ID and reject editor-mode source messages.")
    if "default-src 'none'" not in sandbox_source or "script-src 'unsafe-inline' 'unsafe-eval'" not in sandbox_source:
        raise ValueError("Public runtime sandbox is missing its restrictive iframe Content Security Policy.")
    host_source = host_script.read_text(encoding="utf-8")
    if 'const demoSampleId = "dino-runner"' not in host_source or 'type: "start-demo", sample: demoSampleId' not in host_source:
        raise ValueError("Public Game Studio host must start only the fixed Dino Runner sample.")
    if 'frame.setAttribute("sandbox", "allow-scripts")' not in host_source or '"allow-same-origin"' in host_source:
        raise ValueError("Public Game Studio host must retain an opaque-origin sandboxed iframe.")
    if (site / "experiments" / "browser-pygame-studio" / "index.html").exists():
        raise ValueError("Editable Game Studio prototype must not be published with the public demo.")

    for entry in public_games:
        game_id = entry["id"]
        if entry.get("url") != f"./games/live_games/{game_id}/":
            raise ValueError(f"Public game {game_id!r} has an incorrect direct game URL.")
        if entry.get("page_url") != "./play.html?game=" + quote(game_id, safe=""):
            raise ValueError(f"Public game {game_id!r} has an incorrect game page URL.")
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

    print(f"Checked {len(public_games)} public games, routes, metadata, thumbnails, and shared site files.")


def main():
    try:
        check_site()
    except (ValueError, OSError) as exc:
        raise SystemExit(str(exc)) from exc


if __name__ == "__main__":
    main()
