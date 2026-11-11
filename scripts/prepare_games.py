"""Stage and pygbag-build every published game in games/manifest.json."""

from pathlib import Path
import os
import shutil
import subprocess
import sys
import uuid

from manifest_utils import load_manifest, resolve_manifest_path


ROOT = Path(__file__).resolve().parents[1]


def prepare_games(root=ROOT):
    root = Path(root).resolve()
    manifest_path = root / "games" / "manifest.json"
    games = load_manifest(
        published_only=True, validate=True, manifest_path=manifest_path, root=root
    )
    build_root = root / "build" / "game-apps"
    build_root.mkdir(parents=True, exist_ok=True)
    staging_root = root / "build" / f".game-apps-staging-{uuid.uuid4().hex}"
    staging_root.mkdir()

    try:
        for game in games:
            game_id = game["id"]
            source = resolve_manifest_path(
                game["source"], field="source", game_id=game_id, root=root
            )
            app = staging_root / game_id
            app.mkdir()
            shutil.copy2(source, app / "main.py")

            assets_rel = game.get("assets")
            if assets_rel:
                assets = resolve_manifest_path(
                    assets_rel, field="assets", game_id=game_id, root=root
                )
                shutil.copytree(assets, app / "assets")

            app_arg = app.relative_to(root).as_posix()
            print(f"\n=== Building {game_id} from {source.relative_to(root)} ===", flush=True)
            try:
                subprocess.run(
                    [sys.executable, "-u", "-m", "pygbag", "--build", app_arg],
                    cwd=root,
                    check=True,
                )
            except subprocess.CalledProcessError as exc:
                raise SystemExit(
                    f"Pygbag failed while building {game_id!r} (exit {exc.returncode})."
                ) from exc

            destination = build_root / game_id
            previous = staging_root / f"previous-{game_id}"
            moved_previous = False
            try:
                if destination.exists():
                    os.replace(destination, previous)
                    moved_previous = True
                os.replace(app, destination)
            except OSError:
                if moved_previous and not destination.exists():
                    os.replace(previous, destination)
                raise
    finally:
        shutil.rmtree(staging_root, ignore_errors=True)


def main():
    try:
        prepare_games()
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc


if __name__ == "__main__":
    main()
