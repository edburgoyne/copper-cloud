"""Moderate drawing/transform workload for Node/Wasm frame measurements."""
import asyncio
import math
import pygame


async def main():
    pygame.init()
    screen = pygame.display.set_mode((640, 400))
    clock = pygame.time.Clock()
    marker = pygame.Surface((40, 24), pygame.SRCALPHA)
    pygame.draw.polygon(marker, (197, 138, 85, 220), [(0, 24), (20, 0), (40, 24)])
    positions = [(i * 37 % 640, i * 53 % 400, i % 6 + 2) for i in range(120)]
    frame = 0
    while True:
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                return
        screen.fill((24, 29, 34))
        for index, (x, y, radius) in enumerate(positions):
            offset = int(10 * math.sin(frame / 12 + index))
            pygame.draw.circle(screen, (60 + index % 150, 120, 190), (x, y + offset), radius)
            pygame.draw.rect(screen, (197, 138, 85), (x, y, 6, 3))
        rotated = pygame.transform.rotate(marker, frame % 360)
        screen.blit(rotated, (290, 180))
        pygame.display.flip()
        clock.tick(60)
        frame += 1
        await asyncio.sleep(0)


asyncio.run(main())
