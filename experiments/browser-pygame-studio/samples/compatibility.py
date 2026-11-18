"""Small self-check of the Pygame features adapted by this experiment."""
import asyncio
import io
import os

import pygame


async def main():
    pygame.init()
    screen = pygame.display.set_mode((160, 120))
    assert pygame.display.get_surface() is screen

    rect = pygame.Rect(4, 5, 20, 10)
    assert rect.colliderect(pygame.Rect(10, 8, 8, 8))
    assert not rect.colliderect(pygame.Rect(30, 30, 2, 2))

    alpha = pygame.Surface((2, 2), pygame.SRCALPHA)
    alpha.fill((255, 0, 0, 128))
    background = pygame.Surface((2, 2))
    background.fill((0, 0, 255))
    background.blit(alpha, (0, 0))
    blended = background.get_at((0, 0))
    assert 120 <= blended.r <= 136 and 120 <= blended.b <= 136, blended

    scaled = pygame.transform.scale(alpha, (8, 6))
    rotated = pygame.transform.rotate(scaled, 20)
    assert rotated.get_width() >= 8 and rotated.get_height() >= 6

    class Marker(pygame.sprite.Sprite):
        def __init__(self):
            super().__init__()
            self.image = pygame.Surface((3, 3))
            self.image.fill((20, 200, 50))
            self.rect = self.image.get_rect(topleft=(8, 9))

    sprites = pygame.sprite.Group(Marker())
    sprites.update()
    sprite_target = pygame.Surface((80, 60))
    sprites.draw(sprite_target)
    assert sprite_target.get_at((8, 9))[:3] == (20, 200, 50)

    stream = io.BytesIO()
    pygame.image.save(alpha, stream, "compat.png")
    with open("studio-compat.png", "wb") as image_file:
        image_file.write(stream.getvalue())
    loaded = pygame.image.load("studio-compat.png")
    assert loaded.get_size() == (2, 2)
    os.remove("studio-compat.png")

    font = pygame.font.Font(None, 18)
    label = font.render("Studio", True, (255, 255, 255))
    assert label.get_width() > 0 and label.get_height() > 0
    fallback_font = pygame.font.SysFont("studio-font-that-does-not-exist", 16)
    assert fallback_font.render("fallback", True, (255, 255, 255)).get_width() > 0

    clock = pygame.time.Clock()
    await asyncio.sleep(0)
    clock.tick(60)
    assert clock.get_time() >= 0
    assert isinstance(clock.get_fps(), float)

    screen.blit(background, (0, 0))
    pygame.display.update(pygame.Rect(0, 0, 2, 2))
    pygame.display.flip()
    print("COMPATIBILITY_OK:surface,draw,rect,transform,alpha,sprite,image,font,clock,display")
    pygame.quit()


asyncio.run(main())
