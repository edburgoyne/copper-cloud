"""
Dino Game - a simple Chrome-dinosaur-style endless runner made with pygame.

Controls:
    SPACE / UP ARROW  - Jump
    R                 - Restart after Game Over
    ESC               - Quit

Install pygame first if you don't have it:
    pip install pygame

Then run:
    python dino_game.py
"""

import asyncio
import pygame
import random

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------
pygame.init()

SCREEN_WIDTH = 800
SCREEN_HEIGHT = 400
GROUND_Y = 320

WHITE = (255, 255, 255)
BLACK = (30, 30, 30)
GRAY = (120, 120, 120)
RED = (200, 40, 40)

screen = pygame.display.set_mode((SCREEN_WIDTH, SCREEN_HEIGHT))
pygame.display.set_caption("Dino Game")
clock = pygame.time.Clock()
FPS = 60

font_small = pygame.font.SysFont("Arial", 22)
font_big = pygame.font.SysFont("Arial", 48, bold=True)

# ---------------------------------------------------------------------------
# Dino (player)
# ---------------------------------------------------------------------------
class Dino:
    def __init__(self):
        self.width = 40
        self.height = 50
        self.x = 60
        self.y = GROUND_Y - self.height
        self.vel_y = 0
        self.gravity = 1.4
        self.jump_strength = -20
        self.is_jumping = False

    def jump(self):
        if not self.is_jumping:
            self.is_jumping = True
            self.vel_y = self.jump_strength

    def update(self):
        if self.is_jumping:
            self.y += self.vel_y
            self.vel_y += self.gravity
            if self.y >= GROUND_Y - self.height:
                self.y = GROUND_Y - self.height
                self.is_jumping = False
                self.vel_y = 0

    def draw(self, surface):
        rect = pygame.Rect(self.x, self.y, self.width, self.height)
        pygame.draw.rect(surface, BLACK, rect, border_radius=6)
        # simple eye so it looks a little less like a plain box
        eye_x = self.x + self.width - 10
        eye_y = self.y + 10
        pygame.draw.circle(surface, WHITE, (eye_x, eye_y), 4)

    def get_rect(self):
        return pygame.Rect(self.x, self.y, self.width, self.height)


# ---------------------------------------------------------------------------
# Obstacle (cactus)
# ---------------------------------------------------------------------------
class Obstacle:
    def __init__(self, x_start, speed):
        self.width = random.choice([20, 28, 36])
        self.height = random.choice([40, 55, 70])
        self.x = x_start
        self.y = GROUND_Y - self.height
        self.speed = speed

    def update(self):
        self.x -= self.speed

    def draw(self, surface):
        rect = pygame.Rect(self.x, self.y, self.width, self.height)
        pygame.draw.rect(surface, (30, 120, 30), rect, border_radius=4)

    def off_screen(self):
        return self.x + self.width < 0

    def get_rect(self):
        return pygame.Rect(self.x, self.y, self.width, self.height)


# ---------------------------------------------------------------------------
# Game state / helpers
# ---------------------------------------------------------------------------
def reset_game():
    global dino, obstacles, speed, score, game_over, spawn_timer, spawn_interval
    dino = Dino()
    obstacles = []
    speed = 8
    score = 0
    game_over = False
    spawn_timer = 0
    spawn_interval = random.randint(60, 110)


def draw_ground(surface, scroll_x):
    pygame.draw.line(surface, GRAY, (0, GROUND_Y), (SCREEN_WIDTH, GROUND_Y), 3)
    # a few dashes that scroll to sell the sense of motion
    dash_width = 20
    gap = 30
    total = dash_width + gap
    offset = int(scroll_x) % total
    x = -offset
    while x < SCREEN_WIDTH:
        pygame.draw.line(
            surface, GRAY, (x, GROUND_Y + 10), (x + dash_width, GROUND_Y + 10), 2
        )
        x += total


def draw_score(surface, score):
    text = font_small.render(f"Score: {score}", True, BLACK)
    surface.blit(text, (SCREEN_WIDTH - text.get_width() - 15, 15))


def draw_game_over(surface, score):
    text = font_big.render("GAME OVER", True, RED)
    surface.blit(
        text,
        (SCREEN_WIDTH // 2 - text.get_width() // 2, SCREEN_HEIGHT // 2 - 60),
    )
    sub = font_small.render(
        f"Score: {score}   -   Press R to restart", True, BLACK
    )
    surface.blit(
        sub,
        (SCREEN_WIDTH // 2 - sub.get_width() // 2, SCREEN_HEIGHT // 2 + 5),
    )


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------
async def main():
    global dino, obstacles, speed, score, game_over, spawn_timer, spawn_interval

    reset_game()
    ground_scroll = 0
    frame_count = 0

    running = True
    while running:
        clock.tick(FPS)

        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False
            elif event.type == pygame.KEYDOWN:
                if event.key == pygame.K_ESCAPE:
                    running = False
                elif event.key in (pygame.K_SPACE, pygame.K_UP):
                    if not game_over:
                        dino.jump()
                elif event.key == pygame.K_r and game_over:
                    reset_game()

        if not game_over:
            frame_count += 1
            dino.update()
            ground_scroll += speed

            # Spawn obstacles on a timer
            spawn_timer += 1
            if spawn_timer >= spawn_interval:
                obstacles.append(Obstacle(SCREEN_WIDTH + 10, speed))
                spawn_timer = 0
                spawn_interval = random.randint(60, 110)

            # Update obstacles, remove off-screen ones, check collisions
            for obs in obstacles[:]:
                obs.update()
                if obs.off_screen():
                    obstacles.remove(obs)
                    score += 1
                if dino.get_rect().colliderect(obs.get_rect()):
                    game_over = True

            # Difficulty ramps up slowly over time
            if frame_count % 300 == 0:
                speed += 0.5

        # ---- Drawing ----
        screen.fill(WHITE)
        draw_ground(screen, ground_scroll)
        dino.draw(screen)
        for obs in obstacles:
            obs.draw(screen)
        draw_score(screen, score)

        if game_over:
            draw_game_over(screen, score)

        pygame.display.flip()
        await asyncio.sleep(0)

    pygame.quit()

asyncio.run(main())
