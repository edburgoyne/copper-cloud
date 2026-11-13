"""Shared loading and validation for Copper Cloud's game manifest."""

import argparse
import json
from pathlib import Path, PureWindowsPath
import re


ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "games" / "manifest.json"
GAME_ID_PATTERN = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*\Z")
WINDOWS_RESERVED_IDS = {"con", "prn", "aux", "nul"} | {
    f"{prefix}{number}"
    for prefix in ("com", "lpt")
    for number in range(1, 10)
}
REQUIRED_TEXT_FIELDS = ("title", "description", "category", "version", "creator")


def _manifest_path(value, field, game_id, root):
    """Resolve a repository-relative path, including Windows paths, safely."""
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Game {game_id!r} must have a non-empty {field!r} path.")

    windows_path = PureWindowsPath(value)
    relative_path = Path(value.replace("\\", "/"))
    if relative_path.is_absolute() or windows_path.is_absolute() or windows_path.drive:
        raise ValueError(f"Game {game_id!r} has an absolute {field!r} path: {value!r}")
    if ".." in relative_path.parts or ".." in windows_path.parts:
        raise ValueError(f"Game {game_id!r} has a {field!r} path containing '..': {value!r}")

    resolved_root = root.resolve()
    resolved = (root / relative_path).resolve()
    try:
        resolved.relative_to(resolved_root)
    except ValueError as exc:
        raise ValueError(
            f"Game {game_id!r} has a {field!r} path outside the repository: {value!r}"
        ) from exc
    return resolved


def resolve_manifest_path(value, *, field, game_id, root=ROOT):
    """Resolve a repository-relative path and reject escapes and symlinks out."""
    return _manifest_path(value, field, game_id, Path(root))


def _load_json(manifest_path):
    try:
        with manifest_path.open(encoding="utf-8") as file:
            manifest = json.load(file)
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"Could not read game manifest {manifest_path}: {exc}") from exc
    if not isinstance(manifest, dict) or not isinstance(manifest.get("games"), list):
        raise ValueError("Game manifest must be an object containing a 'games' list.")
    return manifest["games"]


def validate_games(games, *, root=ROOT):
    """Validate every manifest game, including entries that are unpublished."""
    seen_ids = set()
    for index, game in enumerate(games):
        if not isinstance(game, dict):
            raise ValueError(f"Manifest game at index {index} must be an object.")

        game_id = game.get("id")
        if (
            not isinstance(game_id, str)
            or not GAME_ID_PATTERN.fullmatch(game_id)
            or game_id in WINDOWS_RESERVED_IDS
        ):
            raise ValueError(
                f"Invalid game ID at index {index}: {game_id!r}; use lowercase letters, "
                "numbers, and single hyphens between words."
            )
        if game_id in seen_ids:
            raise ValueError(f"Duplicate game ID: {game_id!r}.")
        seen_ids.add(game_id)

        for field in REQUIRED_TEXT_FIELDS:
            if not isinstance(game.get(field), str) or not game[field].strip():
                raise ValueError(f"Game {game_id!r} must have a non-empty {field!r}.")
        for field in ("published", "featured"):
            if not isinstance(game.get(field), bool):
                raise ValueError(f"Game {game_id!r} must set {field!r} to true or false.")
        controls = game.get("controls")
        if not isinstance(controls, list) or not controls or any(
            not isinstance(control, str) or not control.strip() for control in controls
        ):
            raise ValueError(f"Game {game_id!r} must have a non-empty list of 'controls'.")
        aspect_ratio = game.get("aspect_ratio")
        if (
            not isinstance(aspect_ratio, list)
            or len(aspect_ratio) != 2
            or any(type(dimension) is not int or not 0 < dimension <= 8192 for dimension in aspect_ratio)
        ):
            raise ValueError(f"Game {game_id!r} must have an 'aspect_ratio' of two positive dimensions.")
        if not isinstance(game.get("thumbnail_alt"), str) or not game["thumbnail_alt"].strip():
            raise ValueError(f"Game {game_id!r} must have non-empty 'thumbnail_alt' text.")

        source = resolve_manifest_path(
            game.get("source"), field="source", game_id=game_id, root=root
        )
        if source.suffix.lower() != ".py" or not source.is_file():
            raise ValueError(f"Source for {game_id!r} must be an existing Python file: {source}")
        try:
            with source.open("rb"):
                pass
        except OSError as exc:
            raise ValueError(f"Source for {game_id!r} cannot be read: {source}: {exc}") from exc

        thumbnail = resolve_manifest_path(
            game.get("thumbnail"), field="thumbnail", game_id=game_id, root=root
        )
        if not thumbnail.is_file():
            raise ValueError(f"Thumbnail for {game_id!r} does not exist or is not a file: {thumbnail}")
        try:
            with thumbnail.open("rb"):
                pass
        except OSError as exc:
            raise ValueError(
                f"Thumbnail for {game_id!r} cannot be read: {thumbnail}: {exc}"
            ) from exc

        assets_value = game.get("assets")
        if assets_value is not None:
            assets = resolve_manifest_path(
                assets_value, field="assets", game_id=game_id, root=root
            )
            if not assets.is_dir():
                raise ValueError(f"Assets for {game_id!r} do not exist or are not a directory: {assets}")
    return games


def load_manifest(*, published_only=True, validate=False, manifest_path=MANIFEST_PATH, root=None):
    """Load the manifest, optionally validate every entry, and filter by status."""
    manifest_path = Path(manifest_path)
    repo_root = Path(root) if root is not None else manifest_path.resolve().parents[1]
    games = _load_json(manifest_path)
    if validate:
        validate_games(games, root=repo_root)
    if published_only:
        return [game for game in games if game.get("published") is True]
    return games


def main():
    parser = argparse.ArgumentParser(description="Validate the Copper Cloud game manifest.")
    parser.add_argument("--manifest", type=Path, default=MANIFEST_PATH)
    parser.add_argument("--root", type=Path, default=ROOT)
    args = parser.parse_args()
    try:
        games = load_manifest(
            published_only=False,
            validate=True,
            manifest_path=args.manifest,
            root=args.root,
        )
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc
    print(f"Validated {len(games)} games in {args.manifest}")


if __name__ == "__main__":
    main()
