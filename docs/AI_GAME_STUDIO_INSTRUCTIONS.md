# Instructions for AI assistants: experimental Game Studio games

The public Game Studio (WIP) page is a fixed Dino Runner demonstration. Do not imply generated Python can be pasted into or run from that public page. The instructions below target only the isolated experimental editor.

Use this document when generating a complete Python program for `experiments/browser-pygame-studio/`. This target uses Pyodide 314.0.7 and pygame-ce 2.5.7 with a small custom display/input/timing adapter. It is not the same environment as the Pygbag 0.9.3 arcade publishing pipeline.

## Generate a small, understandable game

- Return one complete Python file. Keep it self-contained; there is no project archive, asset upload, or custom dependency installer in the prototype.
- Use `asyncio` and `pygame`. Avoid imports that are not part of the bundled Pyodide environment.
- Create a modest display surface, preferably around 640×400 or smaller until browser performance is measured.
- Use an `async def main()` loop and `await asyncio.sleep(0)` on every pass through the loop. Do not use a synchronous infinite loop or `time.sleep()` for animation.
- Process events with `pygame.event.get()`, draw using tested Surface/draw/Rect/transform operations, call `pygame.display.flip()`, and use `pygame.time.Clock()` for elapsed-time information.
- Prefer simple shapes, a small number of objects, and short per-frame calculations. Frame buffers are copied from the worker to the page.
- Use the tested keyboard subset: letters, digits, arrows, Space, Escape, Enter, Backspace, and Shift. Do not assume modifier keys or every pygame key constant are mapped.
- Basic mouse motion, button, and position APIs are adapted. A smoke test verified mouse clicks and keyboard release after focus left the preview in Chrome 157.0.8103.79; Firefox and mouse-blur behavior remain unverified.
- Use the default font. Do not depend on custom fonts, external files, sprite-sheet upload, audio, fullscreen, resizing, OpenGL, native dialogs, or desktop SDL behavior.
- Explain controls and the goal in comments or on-screen text. Keep the program easy for a beginner to change.

## Starter structure

```python
import asyncio
import pygame

pygame.init()
screen = pygame.display.set_mode((640, 400))
clock = pygame.time.Clock()


async def main():
    running = True
    x = 320
    while running:
        for event in pygame.event.get():
            if event.type == pygame.KEYDOWN and event.key == pygame.K_ESCAPE:
                running = False

        keys = pygame.key.get_pressed()
        if keys[pygame.K_LEFT]:
            x -= 4
        if keys[pygame.K_RIGHT]:
            x += 4

        screen.fill((27, 31, 34))
        pygame.draw.circle(screen, (197, 138, 85), (x, 200), 18)
        pygame.display.flip()
        clock.tick(60)
        await asyncio.sleep(0)


asyncio.run(main())
```

## Help the student test and debug

Tell the student to paste the entire program, press Run, click the preview to focus controls, and read the Python error panel if execution fails. Suggest checking indentation, spelling, defined variables, imports, and whether every loop yields. Stop can terminate a loop that does not yield; it cannot make that loop process input.

The tested subset is documented in `docs/GAME_CREATION_GUIDE.md`. Do not describe untested APIs as supported, promise identical behavior to desktop pygame or Pygbag, or claim the game has been browser tested unless an actual browser test was run and recorded. Node/Wasm tests are not browser tests.

This is an experimental isolated prototype, not a public submission system. Do not add authentication, Supabase calls, secrets, network dependencies, or publication code to generated games.
