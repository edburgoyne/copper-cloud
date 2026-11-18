"""Interactive adapter check driven by tools/test-runtime.mjs."""
import asyncio

import pygame


async def main():
    pygame.init()
    pygame.display.set_mode((80, 60))
    print("INPUT_READY")
    seen_a_down = False
    seen_a_up = False
    seen_b_down = False
    seen_b_up = False
    seen_mouse_down = False
    seen_mouse_up = False
    seen_mouse_blur_down = False
    seen_mouse_blur_up = False

    for _ in range(300):
        for event in pygame.event.get():
            if event.type == pygame.KEYDOWN and event.key == pygame.K_a:
                assert pygame.key.get_pressed()[pygame.K_a]
                seen_a_down = True
                print("KEY_A_DOWN_OK")
            elif event.type == pygame.KEYUP and event.key == pygame.K_a:
                assert not pygame.key.get_pressed()[pygame.K_a]
                seen_a_up = True
                print("KEY_A_UP_OK")
            elif event.type == pygame.KEYDOWN and event.key == pygame.K_b:
                assert pygame.key.get_pressed()[pygame.K_b]
                seen_b_down = True
                print("KEY_B_HELD_OK")
            elif event.type == pygame.KEYUP and event.key == pygame.K_b:
                assert not pygame.key.get_pressed()[pygame.K_b]
                seen_b_up = True
                print("BLUR_RELEASE_OK")
            elif event.type == pygame.MOUSEBUTTONDOWN:
                assert event.pos == (50, 30)
                assert pygame.mouse.get_pos() == (50, 30)
                assert pygame.mouse.get_pressed()[0]
                if seen_mouse_up:
                    seen_mouse_blur_down = True
                    print("MOUSE_BLUR_HELD_OK")
                else:
                    seen_mouse_down = True
                    print("MOUSE_DOWN_OK")
            elif event.type == pygame.MOUSEBUTTONUP:
                assert not pygame.mouse.get_pressed()[0]
                if seen_mouse_blur_down:
                    seen_mouse_blur_up = True
                    print("MOUSE_BLUR_RELEASE_OK")
                else:
                    seen_mouse_up = True
                    print("MOUSE_UP_OK")
        if all((seen_a_down, seen_a_up, seen_b_down, seen_b_up, seen_mouse_down, seen_mouse_up, seen_mouse_blur_down, seen_mouse_blur_up)):
            print("INPUT_OK")
            return
        await asyncio.sleep(0)
    raise AssertionError("Timed out waiting for keyboard, blur, or mouse input")


asyncio.run(main())
