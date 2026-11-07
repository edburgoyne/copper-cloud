# Battle Royale Mini

A top-down survival shooter built with Pygame. The game is in `main.py`; it draws its graphics in code and currently has no external images, sounds, or fonts.

## Project layout

```text
copper-cloud/
├── .github/
│   └── workflows/
│       └── pygbag.yml
├── assets/
│   └── .gitkeep
├── .gitignore
├── chatGPD.md
├── pygbag.ini
├── README.md
└── main.py
```

Keep any future images, sounds, and custom fonts inside `assets/`, and load them using paths relative to the game directory, for example:

```python
from pathlib import Path

ASSET_DIR = Path(__file__).parent / "assets"
image = pygame.image.load(ASSET_DIR / "player.png")
```

For web builds, use browser friendly formats such as PNG/WEBP images and OGG audio.

## Run locally

Install pygbag, then run it from the repository root:

```sh
./.venv/bin/python -m pip install pygbag
./.venv/bin/python -m pygbag .
```

Open the local URL printed by pygbag (usually `http://localhost:8000`). The first run may take longer while pygbag downloads its runtime components.

## Publish with GitHub Pages

The workflow at `.github/workflows/pygbag.yml` builds with the official pygbag package and publishes `build/web` to the `gh-pages` branch when code is pushed to `main`. It can also be started manually from the repository's **Actions** tab using **Build and publish pygbag game**.

Before the first deployment, configure:

1. **Settings → Actions → General → Workflow permissions**: select **Read and write permissions** and save.
2. **Settings → Pages → Build and deployment**: select **Deploy from a branch**, choose **gh-pages** and **/(root)**.
3. Push to `main` or manually run the workflow. Once the Pages deployment finishes, this repository's URL is `https://edburgoyne.github.io/copper-cloud/` (in general: `https://<username>.github.io/<repo-name>/`).

The game loop uses `async def main()`, yields with `await asyncio.sleep(0)` each frame, and starts through `asyncio.run(main())` for pygbag's browser event loop.
