import asyncio
import pygame

pygame.init()
screen = pygame.display.set_mode((640, 400))
clock = pygame.time.Clock()
position = [320, 200]


async def main():
    running = True
    while running:
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False
        keys = pygame.key.get_pressed()
        position[0] += 4 * (keys[pygame.K_RIGHT] - keys[pygame.K_LEFT])
        position[1] += 4 * (keys[pygame.K_DOWN] - keys[pygame.K_UP])
        position[0] = max(20, min(620, position[0]))
        position[1] = max(20, min(380, position[1]))
        screen.fill((27, 31, 34))
        pygame.draw.circle(screen, (197, 138, 85), position, 20)
        pygame.display.flip()
        clock.tick(60)
        await asyncio.sleep(0)
    pygame.quit()


asyncio.run(main())
