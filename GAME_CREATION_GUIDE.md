# Make a game for Copper Cloud

You can make a small game with Python and Pygame, then use Pygbag to try it in a browser. Start with something you can play in a few minutes: one player, one goal, and one challenge. Add more only after that version works.

Submissions to Copper Cloud are planned for the future and are not open yet. Save your project and keep improving it. A future review will check that games work in the browser and are suitable for the community.

## Project structure

In the Copper Cloud repository, a game has a lowercase, hyphenated ID and this structure:

```text
games/site_games/my-game/
├── main.py
├── thumbnail.svg
└── assets/               # optional; images, sounds, and other game files
```

The build pipeline copies your chosen source file to `main.py` and, when specified in the manifest, copies `assets/` into the game. It does **not** automatically copy other files alongside `main.py`. Keep needed files in `assets/`, refer to them with relative paths such as `assets/player.png`, and use filenames with matching capitalization. If you need extra Python modules, coordinate with the project maintainer to confirm how they will be packaged.

The maintainer adds a record to `games/manifest.json` with the ID, title, description, category, creator label, controls, screen dimensions, thumbnail, and publication settings. Do not put private information in the game or its public metadata.

## A browser-friendly game loop

Pygbag needs the game to give the browser a chance to run between frames. Use an async `main()` and `await asyncio.sleep(0)` in every pass through the main loop. Here is a minimal starting point:

```python
import asyncio
import pygame


async def main():
    pygame.init()
    screen = pygame.display.set_mode((800, 450))
    clock = pygame.time.Clock()
    x = 400
    running = True
    while running:
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False
        keys = pygame.key.get_pressed()
        if keys[pygame.K_LEFT]:
            x -= 4
        if keys[pygame.K_RIGHT]:
            x += 4
        screen.fill((36, 40, 43))
        pygame.draw.circle(screen, (197, 138, 85), (x, 225), 20)
        pygame.display.flip()
        clock.tick(60)
        await asyncio.sleep(0)
    pygame.quit()


asyncio.run(main())
```

Avoid a blocking or infinite loop that never yields, long `time.sleep()` calls, and desktop-only features such as opening local system dialogs or depending on a server on the player's computer. Keep work per frame small so the game remains responsive.

## Assets, dependencies, and controls

- Use assets you created or have permission to share. Keep their sizes reasonable and include any required attribution.
- Use Python's standard library and Pygame where possible. Extra packages, especially ones needing native code, may not work in Pygbag's browser environment; ask a maintainer to verify compatibility before relying on them. The current pipeline installs Pygbag 0.9.3, not arbitrary project dependencies.
- Do not rely on absolute file paths, private files, direct access to a player's filesystem, a backend service, or secret keys. Browser and desktop environments have different restrictions.
- Make the game playable with a keyboard. Describe every important key and any mouse controls in the manifest. Avoid requiring a particular keyboard shortcut that the browser reserves.
- Clearly explain the goal and how to restart. Keep on-screen text readable at smaller sizes.

## Test your game

1. Run the Python game locally and play through the start, normal play, and an ending or restart. Test incorrect inputs and edge cases.
2. Ask someone else to play without coaching. Notice what is confusing and make it clearer.
3. With Pygbag 0.9.3 installed and the game registered as published in your **local** manifest, run `python scripts/prepare_games.py`, `python scripts/assemble_site.py`, and `python scripts/check_site.py` from the repository root. Do not publish a draft merely to test it in a shared manifest; use a separate local copy instead.
4. Serve the assembled site using the local preview instructions in `README.md`. Open the game's Copper Cloud page, wait for it to load, click inside the game, and actually play it. Try keyboard and mouse controls, restart, fullscreen, and a smaller browser window.
5. Fix errors, repeat the tests, and make sure your game still runs without access to private files or credentials.

Pygbag downloads browser runtime files, so building or playing a browser version can require an internet connection. A successful build alone does not prove the game plays correctly.

## Checklist for a future submission

- [ ] My project has a working `main.py` and an async loop that yields every frame.
- [ ] Needed files are in `assets/`, use relative paths, and are allowed to be shared.
- [ ] I can explain the important parts of my code and have removed secrets and private information.
- [ ] I included a title, creator label, category, description, controls, screen dimensions, and an accessible thumbnail description.
- [ ] I tested the game in a browser, including its controls and restart, and fixed problems I found.
- [ ] I am ready for a review and understand submissions are not open yet.

## Ask an AI coding assistant

You can use a prompt like this:

> Help me make a small Python and Pygame game where a player moves left and right to catch falling stars. Explain each part in beginner-friendly language. Use an async Pygbag-compatible game loop that yields every frame, keyboard controls, and a restart. Start with a simple playable version, then suggest a few tests I can run. Please explain how I can change the difficulty myself.

Read the answer, ask about anything you don't understand, and test the result yourself. AI-generated code can make mistakes; improving and understanding it is part of creating your game.
