"""Tests for manifest validation and static website assembly."""

import json
from pathlib import Path
import shutil
import sys
import subprocess
import unittest
import uuid
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from assemble_site import assemble_site
from check_site import check_site
from manifest_utils import load_manifest, validate_games
from prepare_games import prepare_games


class BuildPipelineTests(unittest.TestCase):
    def setUp(self):
        temp_parent = Path(__file__).resolve().parents[1] / "build" / "test-temp"
        temp_parent.mkdir(parents=True, exist_ok=True)
        self.root = temp_parent / f"fixture-{uuid.uuid4().hex}"
        self.root.mkdir(parents=True)
        (self.root / "games").mkdir()
        (self.root / "index.html").write_text(
            '<script>fetch("./games.json", {cache: "no-cache"}).then((r) => r.json()).then((games) => '
            'gameGrid.replaceChildren(...games.map((game) => game.thumbnail + game.url)));</script>',
            encoding="utf-8",
        )
        self.games = [self.game("public-game", True), self.game("draft-game", False)]
        self.write_manifest()

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def game(self, game_id, published):
        game_dir = self.root / "games" / game_id
        game_dir.mkdir(parents=True)
        (game_dir / "main.py").write_text("print('fixture')\n", encoding="utf-8")
        (game_dir / "cover.png").write_bytes(b"test image fixture")
        return {
            "id": game_id,
            "title": game_id.title(),
            "description": "A fixture game.",
            "category": "Arcade",
            "version": "1.0.0",
            "published": published,
            "featured": False,
            "source": f"games/{game_id}/main.py",
            "thumbnail": f"games/{game_id}/cover.png",
            "thumbnail_alt": "A fixture image.",
        }

    def write_manifest(self):
        (self.root / "games" / "manifest.json").write_text(
            json.dumps({"games": self.games}), encoding="utf-8"
        )

    def make_build(self, game_id):
        app = self.root / "build" / "game-apps" / game_id / "build" / "web"
        app.mkdir(parents=True)
        (app / "index.html").write_text("fixture build", encoding="utf-8")

    def test_valid_manifest_loads_and_filters_published_games(self):
        self.assertEqual(["public-game"], [g["id"] for g in load_manifest(
            published_only=True, validate=True,
            manifest_path=self.root / "games" / "manifest.json", root=self.root
        )])
        self.assertEqual(2, len(validate_games(self.games, root=self.root)))

    def test_malformed_json_fails_gracefully(self):
        path = self.root / "games" / "manifest.json"
        path.write_text("{ invalid", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "Could not read game manifest"):
            load_manifest(manifest_path=path, root=self.root)

    def test_missing_required_field_is_rejected(self):
        del self.games[0]["title"]
        with self.assertRaisesRegex(ValueError, "public-game.*title"):
            validate_games(self.games, root=self.root)

    def test_duplicate_and_invalid_ids_are_rejected(self):
        self.games[1]["id"] = self.games[0]["id"]
        with self.assertRaisesRegex(ValueError, "Duplicate game ID"):
            validate_games(self.games, root=self.root)
        self.games[1]["id"] = "../draft"
        with self.assertRaisesRegex(ValueError, "Invalid game ID"):
            validate_games(self.games, root=self.root)
        self.games[1]["id"] = "con"
        with self.assertRaisesRegex(ValueError, "Invalid game ID"):
            validate_games(self.games, root=self.root)

    def test_invalid_source_and_thumbnail_paths_are_rejected(self):
        original = self.games[0]["source"]
        self.games[0]["source"] = "../outside.py"
        with self.assertRaisesRegex(ValueError, "containing '..'"):
            validate_games(self.games, root=self.root)
        self.games[0]["source"] = original
        self.games[0]["thumbnail"] = "C:\\outside.png"
        with self.assertRaisesRegex(ValueError, "absolute 'thumbnail'"):
            validate_games(self.games, root=self.root)
        self.games[0]["thumbnail"] = "games/public-game/missing.png"
        with self.assertRaisesRegex(ValueError, "Thumbnail.*does not exist"):
            validate_games(self.games, root=self.root)

    def test_symlink_cannot_escape_repository(self):
        outside = self.root.parent / (self.root.name + "-outside.py")
        outside.write_text("pass\n", encoding="utf-8")
        link = self.root / "games" / "outside.py"
        try:
            link.symlink_to(outside)
        except (OSError, NotImplementedError):
            self.skipTest("Symlink creation is unavailable on this system")
        try:
            self.games[0]["source"] = "games/outside.py"
            with self.assertRaisesRegex(ValueError, "outside the repository"):
                validate_games(self.games, root=self.root)
        finally:
            outside.unlink(missing_ok=True)

    def test_unpublished_game_is_excluded_from_registry_and_routes(self):
        self.make_build("public-game")
        assemble_site(self.root)
        check_site(self.root)
        site = self.root / "build" / "site"
        registry = json.loads((site / "games.json").read_text(encoding="utf-8"))
        self.assertEqual(["public-game"], [game["id"] for game in registry])
        self.assertTrue((site / "games" / "live_games" / "public-game" / "index.html").is_file())
        self.assertFalse((site / "games" / "live_games" / "draft-game").exists())

    def test_missing_pygbag_output_fails_without_destroying_existing_site(self):
        site = self.root / "build" / "site"
        site.mkdir(parents=True)
        marker = site / "previous.html"
        marker.write_text("keep me", encoding="utf-8")
        with self.assertRaisesRegex(SystemExit, "No Pygbag build found.*public-game"):
            assemble_site(self.root)
        self.assertEqual("keep me", marker.read_text(encoding="utf-8"))

    def test_failed_game_build_preserves_previous_compiled_output(self):
        build = self.root / "build" / "game-apps" / "public-game" / "build" / "web"
        build.mkdir(parents=True)
        marker = build / "index.html"
        marker.write_text("previous successful build", encoding="utf-8")
        with patch("prepare_games.subprocess.run", side_effect=subprocess.CalledProcessError(1, "pygbag")):
            with self.assertRaisesRegex(SystemExit, "building 'public-game'"):
                prepare_games(self.root)
        self.assertEqual("previous successful build", marker.read_text(encoding="utf-8"))
        self.assertFalse(any((self.root / "build").glob(".game-apps-staging-*")))


if __name__ == "__main__":
    unittest.main()
