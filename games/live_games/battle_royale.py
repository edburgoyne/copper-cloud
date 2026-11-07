"""
Battle Royale Mini - an original top-down survival shooter inspired by the
battle-royale genre (shrinking storm, loot pickups, simple building, bots,
a rare legendary weapon, and an optional resource-gathering "Craft Royale"
mode). This is an original game, not a copy of any existing commercial title.

Controls:
    W A S D        - Move
    Mouse          - Aim
    Left Click     - Shoot
    Q              - Place a wood wall in front of you (needs 10 wood)
    F              - Place a stone wall in front of you (Craft Royale only, needs 10 stone)
    E              - Harvest a nearby tree/rock for wood/stone (Craft Royale only)
    1 / 2 / 3 / 4  - Pick Easy / Medium / Hard / Craft Royale on the menu screen
    R              - Return to menu after Game Over / Victory
    ESC            - Quit

Install pygame first if you don't have it:
    pip install pygame

Then run:
    python battle_royale.py
"""

import asyncio
import pygame
import random
import math

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------
pygame.init()

SCREEN_WIDTH = 900
SCREEN_HEIGHT = 600

WHITE = (255, 255, 255)
BLACK = (20, 20, 20)
GRAY = (110, 110, 110)
DARK_GRAY = (60, 60, 60)
GREEN = (60, 170, 80)
DARK_GREEN = (40, 120, 60)
BLUE = (60, 120, 220)
RED = (210, 60, 60)
YELLOW = (230, 200, 40)
PURPLE = (150, 70, 200)
BROWN = (140, 100, 60)
GOLD = (255, 200, 30)
STORM_COLOR = (140, 60, 200)

screen = pygame.display.set_mode((SCREEN_WIDTH, SCREEN_HEIGHT))
pygame.display.set_caption("Battle Royale Mini")
clock = pygame.time.Clock()
FPS = 60

font_small = pygame.font.SysFont("Arial", 18)
font_med = pygame.font.SysFont("Arial", 26, bold=True)
font_big = pygame.font.SysFont("Arial", 52, bold=True)

WEAPON_STATS = {
    "pistol": {"damage": 12, "cooldown": 18, "speed": 14, "color": YELLOW},
    "rifle": {"damage": 18, "cooldown": 8, "speed": 18, "color": RED},
    "shotgun": {"damage": 9, "cooldown": 35, "speed": 16, "color": PURPLE, "pellets": 5},
    "legendary": {"damage": 35, "cooldown": 10, "speed": 24, "color": GOLD, "pellets": 3, "spread": 0.12},
}

# ---------------------------------------------------------------------------
# Difficulty presets
# ---------------------------------------------------------------------------
DIFFICULTY_SETTINGS = {
    "easy": {
        "label": "EASY",
        "map_width": 1400,
        "map_height": 900,
        "bot_count": 5,
        "storm_shrink_duration": 35 * FPS,
        "storm_shrink_speed": 0.2,
        "bot_speed_mult": 0.8,
        "bot_cooldown_mult": 1.4,
        "bot_accuracy_spread": 0.35,
        "bot_engage_range": 240,
        "loot_count": 16,
        "resource_mode": False,
    },
    "medium": {
        "label": "MEDIUM",
        "map_width": 2000,
        "map_height": 1300,
        "bot_count": 9,
        "storm_shrink_duration": 25 * FPS,
        "storm_shrink_speed": 0.32,
        "bot_speed_mult": 1.0,
        "bot_cooldown_mult": 1.0,
        "bot_accuracy_spread": 0.18,
        "bot_engage_range": 320,
        "loot_count": 24,
        "resource_mode": False,
    },
    "hard": {
        "label": "HARD",
        "map_width": 2800,
        "map_height": 1800,
        "bot_count": 15,
        "storm_shrink_duration": 18 * FPS,
        "storm_shrink_speed": 0.48,
        "bot_speed_mult": 1.2,
        "bot_cooldown_mult": 0.7,
        "bot_accuracy_spread": 0.06,
        "bot_engage_range": 420,
        "loot_count": 34,
        "resource_mode": False,
    },
    "craft": {
        "label": "CRAFT ROYALE",
        "map_width": 2000,
        "map_height": 1300,
        "bot_count": 8,
        "storm_shrink_duration": 28 * FPS,
        "storm_shrink_speed": 0.28,
        "bot_speed_mult": 0.95,
        "bot_cooldown_mult": 1.1,
        "bot_accuracy_spread": 0.2,
        "bot_engage_range": 300,
        "loot_count": 20,
        "resource_mode": True,
        "tree_count": 26,
        "rock_count": 18,
    },
}


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------
def clamp(value, low, high):
    return max(low, min(high, value))


def distance(x1, y1, x2, y2):
    return math.hypot(x2 - x1, y2 - y1)


# ---------------------------------------------------------------------------
# Bullet
# ---------------------------------------------------------------------------
class Bullet:
    def __init__(self, x, y, angle, damage, speed, color, owner, owner_ref=None):
        self.x = x
        self.y = y
        self.angle = angle
        self.damage = damage
        self.speed = speed
        self.color = color
        self.owner = owner  # "player" or "bot"
        self.owner_ref = owner_ref  # the actual Fighter instance that fired it
        self.radius = 4
        self.alive = True

    def update(self, map_width, map_height):
        self.x += math.cos(self.angle) * self.speed
        self.y += math.sin(self.angle) * self.speed
        if not (0 <= self.x <= map_width and 0 <= self.y <= map_height):
            self.alive = False

    def draw(self, surface, cam_x, cam_y):
        pygame.draw.circle(
            surface, self.color, (int(self.x - cam_x), int(self.y - cam_y)), self.radius
        )

    def get_rect(self):
        return pygame.Rect(self.x - self.radius, self.y - self.radius, self.radius * 2, self.radius * 2)


# ---------------------------------------------------------------------------
# Wall (simple building mechanic)
# ---------------------------------------------------------------------------
class Wall:
    def __init__(self, x, y, material="wood"):
        self.width = 60
        self.height = 12
        self.x = x
        self.y = y
        self.material = material
        self.hp = 60 if material == "wood" else 120

    def get_rect(self):
        return pygame.Rect(self.x - self.width // 2, self.y - self.height // 2, self.width, self.height)

    def draw(self, surface, cam_x, cam_y):
        rect = self.get_rect()
        rect.x -= cam_x
        rect.y -= cam_y
        if self.material == "wood":
            pygame.draw.rect(surface, BROWN, rect, border_radius=2)
            pygame.draw.rect(surface, (90, 60, 30), rect, 2, border_radius=2)
        else:
            pygame.draw.rect(surface, GRAY, rect, border_radius=2)
            pygame.draw.rect(surface, DARK_GRAY, rect, 2, border_radius=2)


# ---------------------------------------------------------------------------
# Loot pickup
# ---------------------------------------------------------------------------
class Loot:
    def __init__(self, x, y, kind=None):
        self.x = x
        self.y = y
        self.kind = kind if kind else random.choice(["rifle", "shotgun", "medkit", "wood"])
        self.radius = 10 if self.kind != "legendary" else 14
        self.pulse = random.uniform(0, math.tau)

    def get_rect(self):
        return pygame.Rect(self.x - self.radius, self.y - self.radius, self.radius * 2, self.radius * 2)

    def draw(self, surface, cam_x, cam_y):
        sx, sy = int(self.x - cam_x), int(self.y - cam_y)
        colors = {
            "rifle": RED,
            "shotgun": PURPLE,
            "medkit": GREEN,
            "wood": BROWN,
            "legendary": GOLD,
        }
        if self.kind == "legendary":
            self.pulse += 0.08
            glow_radius = self.radius + 6 + int(3 * math.sin(self.pulse))
            glow = pygame.Surface((glow_radius * 4, glow_radius * 4), pygame.SRCALPHA)
            pygame.draw.circle(glow, (*GOLD, 90), (glow_radius * 2, glow_radius * 2), glow_radius * 2)
            surface.blit(glow, (sx - glow_radius * 2, sy - glow_radius * 2))
        pygame.draw.circle(surface, colors[self.kind], (sx, sy), self.radius)
        pygame.draw.circle(surface, BLACK, (sx, sy), self.radius, 2)


# ---------------------------------------------------------------------------
# Resource node (trees / rocks) - the "2D Minecraft" gathering layer, only
# used in Craft Royale mode
# ---------------------------------------------------------------------------
class ResourceNode:
    def __init__(self, x, y, kind):
        self.x = x
        self.y = y
        self.kind = kind  # "tree" or "rock"
        self.radius = 16 if kind == "tree" else 14

    def get_rect(self):
        return pygame.Rect(self.x - self.radius, self.y - self.radius, self.radius * 2, self.radius * 2)

    def draw(self, surface, cam_x, cam_y):
        sx, sy = int(self.x - cam_x), int(self.y - cam_y)
        if self.kind == "tree":
            pygame.draw.rect(surface, (110, 75, 45), (sx - 4, sy, 8, 14))
            pygame.draw.circle(surface, DARK_GREEN, (sx, sy - 6), self.radius)
        else:
            pygame.draw.circle(surface, GRAY, (sx, sy), self.radius)
            pygame.draw.circle(surface, DARK_GRAY, (sx, sy), self.radius, 2)


# ---------------------------------------------------------------------------
# Base entity (shared by player & bots)
# ---------------------------------------------------------------------------
class Fighter:
    def __init__(self, x, y, color):
        self.x = x
        self.y = y
        self.color = color
        self.radius = 16
        self.hp = 100
        self.max_hp = 100
        self.speed = 4
        self.weapon = "pistol"
        self.cooldown_timer = 0
        self.alive = True
        self.wood = 0
        self.stone = 0

    def get_rect(self):
        return pygame.Rect(self.x - self.radius, self.y - self.radius, self.radius * 2, self.radius * 2)

    def take_damage(self, amount):
        self.hp -= amount
        if self.hp <= 0:
            self.hp = 0
            self.alive = False

    def draw_health_bar(self, surface, cam_x, cam_y):
        bar_w = 34
        bar_h = 5
        sx = self.x - cam_x - bar_w // 2
        sy = self.y - cam_y - self.radius - 14
        pygame.draw.rect(surface, DARK_GRAY, (sx, sy, bar_w, bar_h))
        fill = int(bar_w * (self.hp / self.max_hp))
        pygame.draw.rect(surface, GREEN, (sx, sy, fill, bar_h))


# ---------------------------------------------------------------------------
# Player
# ---------------------------------------------------------------------------
class Player(Fighter):
    def __init__(self, x, y):
        super().__init__(x, y, BLUE)
        self.aim_angle = 0

    def handle_movement(self, keys, walls, map_width, map_height):
        dx = dy = 0
        if keys[pygame.K_w]:
            dy -= 1
        if keys[pygame.K_s]:
            dy += 1
        if keys[pygame.K_a]:
            dx -= 1
        if keys[pygame.K_d]:
            dx += 1
        if dx != 0 and dy != 0:
            dx *= 0.7071
            dy *= 0.7071

        new_x = self.x + dx * self.speed
        new_y = self.y + dy * self.speed
        new_x = clamp(new_x, self.radius, map_width - self.radius)
        new_y = clamp(new_y, self.radius, map_height - self.radius)

        test_rect = pygame.Rect(new_x - self.radius, new_y - self.radius, self.radius * 2, self.radius * 2)
        blocked = any(test_rect.colliderect(w.get_rect()) for w in walls)
        if not blocked:
            self.x = new_x
            self.y = new_y

    def shoot(self, bullets):
        if self.cooldown_timer > 0:
            return
        stats = WEAPON_STATS[self.weapon]
        self.cooldown_timer = stats["cooldown"]
        if "pellets" in stats:
            pellets = stats["pellets"]
            spread = stats.get("spread", 0.28)
            for i in range(pellets):
                offset = (i - pellets // 2) * (spread / pellets)
                bullets.append(
                    Bullet(self.x, self.y, self.aim_angle + offset, stats["damage"], stats["speed"], stats["color"], "player")
                )
        else:
            bullets.append(
                Bullet(self.x, self.y, self.aim_angle, stats["damage"], stats["speed"], stats["color"], "player")
            )

    def place_wall(self, walls, material="wood"):
        cost = 10
        if material == "wood":
            if self.wood < cost:
                return
            self.wood -= cost
        else:
            if self.stone < cost:
                return
            self.stone -= cost
        wx = self.x + math.cos(self.aim_angle) * 45
        wy = self.y + math.sin(self.aim_angle) * 45
        walls.append(Wall(wx, wy, material=material))

    def harvest(self, nodes):
        harvest_range = 55
        closest = None
        closest_dist = None
        for node in nodes:
            d = distance(self.x, self.y, node.x, node.y)
            if d < harvest_range and (closest_dist is None or d < closest_dist):
                closest = node
                closest_dist = d
        if closest is not None:
            if closest.kind == "tree":
                self.wood += 15
            else:
                self.stone += 15
            nodes.remove(closest)

    def update(self):
        if self.cooldown_timer > 0:
            self.cooldown_timer -= 1

    def draw(self, surface, cam_x, cam_y):
        sx, sy = int(self.x - cam_x), int(self.y - cam_y)
        pygame.draw.circle(surface, self.color, (sx, sy), self.radius)
        pygame.draw.circle(surface, BLACK, (sx, sy), self.radius, 2)
        end_x = sx + math.cos(self.aim_angle) * (self.radius + 12)
        end_y = sy + math.sin(self.aim_angle) * (self.radius + 12)
        pygame.draw.line(surface, BLACK, (sx, sy), (end_x, end_y), 3)
        self.draw_health_bar(surface, cam_x, cam_y)


# ---------------------------------------------------------------------------
# Bot (simple AI opponent) - behavior scales with difficulty settings
# ---------------------------------------------------------------------------
class Bot(Fighter):
    def __init__(self, x, y, difficulty):
        super().__init__(x, y, RED)
        self.weapon = random.choice(["pistol", "rifle", "shotgun"])
        self.speed *= difficulty["bot_speed_mult"]
        self.cooldown_mult = difficulty["bot_cooldown_mult"]
        self.accuracy_spread = difficulty["bot_accuracy_spread"]
        self.engage_range = difficulty["bot_engage_range"]
        self.decision_timer = 0
        self.move_dir = (random.uniform(-1, 1), random.uniform(-1, 1))

    def update(self, player, bots, storm_center, storm_radius, bullets, walls, map_width, map_height):
        if not self.alive:
            return

        dist_to_center = distance(self.x, self.y, *storm_center)
        if dist_to_center > storm_radius - 40:
            angle_to_center = math.atan2(storm_center[1] - self.y, storm_center[0] - self.x)
            self.x += math.cos(angle_to_center) * self.speed
            self.y += math.sin(angle_to_center) * self.speed
        else:
            # Gather every possible target (the player and all other living bots)
            candidates = []
            if player.alive:
                candidates.append(player)
            for other in bots:
                if other is not self and other.alive:
                    candidates.append(other)

            target = None
            target_dist = None
            for candidate in candidates:
                d = distance(self.x, self.y, candidate.x, candidate.y)
                if d < self.engage_range and (target_dist is None or d < target_dist):
                    target = candidate
                    target_dist = d

            if target is not None:
                angle = math.atan2(target.y - self.y, target.x - self.x)
                self.x += math.cos(angle) * self.speed * 0.6
                self.y += math.sin(angle) * self.speed * 0.6

                if self.cooldown_timer <= 0:
                    stats = WEAPON_STATS[self.weapon]
                    self.cooldown_timer = (stats["cooldown"] + 10) * self.cooldown_mult
                    fire_angle = angle + random.uniform(-self.accuracy_spread, self.accuracy_spread)
                    bullets.append(
                        Bullet(self.x, self.y, fire_angle, stats["damage"], stats["speed"], stats["color"], "bot", owner_ref=self)
                    )
            else:
                self.decision_timer -= 1
                if self.decision_timer <= 0:
                    self.move_dir = (random.uniform(-1, 1), random.uniform(-1, 1))
                    self.decision_timer = random.randint(30, 90)
                self.x += self.move_dir[0] * self.speed * 0.5
                self.y += self.move_dir[1] * self.speed * 0.5

        self.x = clamp(self.x, self.radius, map_width - self.radius)
        self.y = clamp(self.y, self.radius, map_height - self.radius)

        if self.cooldown_timer > 0:
            self.cooldown_timer -= 1

    def draw(self, surface, cam_x, cam_y):
        if not self.alive:
            return
        sx, sy = int(self.x - cam_x), int(self.y - cam_y)
        pygame.draw.circle(surface, self.color, (sx, sy), self.radius)
        pygame.draw.circle(surface, BLACK, (sx, sy), self.radius, 2)
        self.draw_health_bar(surface, cam_x, cam_y)


# ---------------------------------------------------------------------------
# Game state
# ---------------------------------------------------------------------------
def spawn_loot(n, map_width, map_height):
    loot_list = []
    for _ in range(n):
        x = random.randint(40, map_width - 40)
        y = random.randint(40, map_height - 40)
        loot_list.append(Loot(x, y))
    # Exactly one legendary weapon spawns per match, somewhere on the map
    lx = random.randint(40, map_width - 40)
    ly = random.randint(40, map_height - 40)
    loot_list.append(Loot(lx, ly, kind="legendary"))
    return loot_list


def spawn_resource_nodes(tree_count, rock_count, map_width, map_height):
    nodes = []
    for _ in range(tree_count):
        x = random.randint(40, map_width - 40)
        y = random.randint(40, map_height - 40)
        nodes.append(ResourceNode(x, y, "tree"))
    for _ in range(rock_count):
        x = random.randint(40, map_width - 40)
        y = random.randint(40, map_height - 40)
        nodes.append(ResourceNode(x, y, "rock"))
    return nodes


def start_game(selected_difficulty):
    global player, bots, bullets, walls, loot, resource_nodes, storm_center, storm_radius
    global storm_target_radius, storm_timer, storm_shrink_duration, storm_shrink_speed
    global game_state, map_width, map_height, difficulty, difficulty_name

    difficulty_name = selected_difficulty
    difficulty = DIFFICULTY_SETTINGS[selected_difficulty]
    map_width = difficulty["map_width"]
    map_height = difficulty["map_height"]

    player = Player(map_width // 2, map_height // 2)
    bots = []
    for _ in range(difficulty["bot_count"]):
        bx = random.randint(60, map_width - 60)
        by = random.randint(60, map_height - 60)
        bots.append(Bot(bx, by, difficulty))

    bullets = []
    walls = []
    loot = spawn_loot(difficulty["loot_count"], map_width, map_height)

    if difficulty.get("resource_mode"):
        resource_nodes = spawn_resource_nodes(
            difficulty["tree_count"], difficulty["rock_count"], map_width, map_height
        )
    else:
        resource_nodes = []

    storm_center = (map_width // 2, map_height // 2)
    storm_radius = math.hypot(map_width, map_height) / 2
    storm_target_radius = storm_radius
    storm_timer = 0
    storm_shrink_duration = difficulty["storm_shrink_duration"]
    storm_shrink_speed = difficulty["storm_shrink_speed"]

    game_state = "playing"


def start_new_storm_phase():
    global storm_target_radius, storm_timer
    storm_target_radius = max(80, storm_target_radius * 0.6)
    storm_timer = 0


def return_to_menu():
    global game_state
    game_state = "menu"


# ---------------------------------------------------------------------------
# Drawing helpers
# ---------------------------------------------------------------------------
def draw_map_background(surface, cam_x, cam_y):
    surface.fill((225, 235, 210))
    grid_size = 100
    start_x = -int(cam_x) % grid_size
    start_y = -int(cam_y) % grid_size
    x = start_x
    while x < SCREEN_WIDTH:
        pygame.draw.line(surface, (205, 215, 190), (x, 0), (x, SCREEN_HEIGHT), 1)
        x += grid_size
    y = start_y
    while y < SCREEN_HEIGHT:
        pygame.draw.line(surface, (205, 215, 190), (0, y), (SCREEN_WIDTH, y), 1)
        y += grid_size


def draw_storm(surface, cam_x, cam_y):
    overlay = pygame.Surface((SCREEN_WIDTH, SCREEN_HEIGHT), pygame.SRCALPHA)
    overlay.fill((*STORM_COLOR, 70))
    cx, cy = storm_center[0] - cam_x, storm_center[1] - cam_y
    pygame.draw.circle(overlay, (0, 0, 0, 0), (int(cx), int(cy)), int(storm_radius))
    surface.blit(overlay, (0, 0))
    pygame.draw.circle(surface, STORM_COLOR, (int(cx), int(cy)), int(storm_radius), 3)


def draw_hud(surface, player, bots_alive, elapsed_seconds):
    hp_text = font_med.render(f"HP: {int(player.hp)}", True, BLACK)
    surface.blit(hp_text, (15, 15))

    weapon_label = player.weapon.upper()
    weapon_color = WEAPON_STATS[player.weapon]["color"] if player.weapon != "pistol" else BLACK
    weapon_text = font_small.render(f"Weapon: {weapon_label}", True, weapon_color)
    surface.blit(weapon_text, (15, 48))

    wood_text = font_small.render(f"Wood: {player.wood}  (Q to build, needs 10)", True, BLACK)
    surface.blit(wood_text, (15, 70))

    if difficulty.get("resource_mode"):
        stone_text = font_small.render(
            f"Stone: {player.stone}  (F to build stone wall, needs 10)  |  E to harvest nearby tree/rock",
            True,
            BLACK,
        )
        surface.blit(stone_text, (15, 92))

    alive_text = font_med.render(f"Players left: {bots_alive + (1 if player.alive else 0)}", True, BLACK)
    surface.blit(alive_text, (SCREEN_WIDTH - alive_text.get_width() - 15, 15))

    timer_text = font_small.render(f"Time: {elapsed_seconds}s", True, BLACK)
    surface.blit(timer_text, (SCREEN_WIDTH - timer_text.get_width() - 15, 48))

    mode_text = font_small.render(f"Mode: {difficulty['label']}", True, BLACK)
    surface.blit(mode_text, (SCREEN_WIDTH - mode_text.get_width() - 15, 70))


def draw_end_screen(surface, message, color):
    overlay = pygame.Surface((SCREEN_WIDTH, SCREEN_HEIGHT), pygame.SRCALPHA)
    overlay.fill((0, 0, 0, 140))
    surface.blit(overlay, (0, 0))
    text = font_big.render(message, True, color)
    surface.blit(text, (SCREEN_WIDTH // 2 - text.get_width() // 2, SCREEN_HEIGHT // 2 - 60))
    sub = font_small.render("Press R to return to the menu", True, WHITE)
    surface.blit(sub, (SCREEN_WIDTH // 2 - sub.get_width() // 2, SCREEN_HEIGHT // 2 + 10))


def get_menu_buttons():
    labels = [
        ("easy", "1 - EASY"),
        ("medium", "2 - MEDIUM"),
        ("hard", "3 - HARD"),
        ("craft", "4 - CRAFT ROYALE"),
    ]
    buttons = []
    button_w, button_h = 300, 70
    col_gap = 40
    row_gap = 30
    start_y = 240
    grid_left = SCREEN_WIDTH // 2 - button_w - col_gap // 2
    for i, (key, label) in enumerate(labels):
        col = i % 2
        row = i // 2
        x = grid_left + col * (button_w + col_gap)
        y = start_y + row * (button_h + row_gap)
        rect = pygame.Rect(x, y, button_w, button_h)
        buttons.append((key, label, rect))
    return buttons


def draw_menu(surface):
    surface.fill((225, 235, 210))
    title = font_big.render("BATTLE ROYALE MINI", True, BLACK)
    surface.blit(title, (SCREEN_WIDTH // 2 - title.get_width() // 2, 100))

    subtitle = font_small.render(
        "Choose a mode (click a button, or press 1 / 2 / 3 / 4)", True, DARK_GRAY
    )
    surface.blit(subtitle, (SCREEN_WIDTH // 2 - subtitle.get_width() // 2, 170))

    colors = {"easy": GREEN, "medium": YELLOW, "hard": RED, "craft": BROWN}
    for key, label, rect in get_menu_buttons():
        pygame.draw.rect(surface, colors[key], rect, border_radius=8)
        pygame.draw.rect(surface, BLACK, rect, 3, border_radius=8)
        text = font_med.render(label, True, BLACK)
        surface.blit(text, (rect.centerx - text.get_width() // 2, rect.centery - text.get_height() // 2 - 8))

        d = DIFFICULTY_SETTINGS[key]
        details = f"Map {d['map_width']}x{d['map_height']}  |  Bots: {d['bot_count']}"
        details_text = font_small.render(details, True, DARK_GRAY)
        surface.blit(details_text, (rect.centerx - details_text.get_width() // 2, rect.centery + 12))

    hint = font_small.render(
        "Craft Royale adds mineable trees/rocks: gather wood & stone, build wood or stone walls.",
        True,
        DARK_GRAY,
    )
    menu_start_y = 240
    button_h = 70
    row_gap = 30
    surface.blit(
        hint,
        (SCREEN_WIDTH // 2 - hint.get_width() // 2, menu_start_y + 2 * (button_h + row_gap) + 20),
    )


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------
game_state = "menu"
frame_count = 0

async def main():
    global game_state, frame_count, storm_timer, storm_radius

    running = True
    while running:
        clock.tick(FPS)

        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False
            elif event.type == pygame.KEYDOWN:
                if event.key == pygame.K_ESCAPE:
                    running = False
                elif game_state == "menu":
                    if event.key == pygame.K_1:
                        start_game("easy")
                        frame_count = 0
                    elif event.key == pygame.K_2:
                        start_game("medium")
                        frame_count = 0
                    elif event.key == pygame.K_3:
                        start_game("hard")
                        frame_count = 0
                    elif event.key == pygame.K_4:
                        start_game("craft")
                        frame_count = 0
                elif event.key == pygame.K_r and game_state in ("victory", "defeat"):
                    return_to_menu()
                elif event.key == pygame.K_q and game_state == "playing":
                    player.place_wall(walls, material="wood")
                elif event.key == pygame.K_f and game_state == "playing" and difficulty.get("resource_mode"):
                    player.place_wall(walls, material="stone")
                elif event.key == pygame.K_e and game_state == "playing" and difficulty.get("resource_mode"):
                    player.harvest(resource_nodes)
            elif event.type == pygame.MOUSEBUTTONDOWN:
                if game_state == "menu" and event.button == 1:
                    for key, label, rect in get_menu_buttons():
                        if rect.collidepoint(event.pos):
                            start_game(key)
                            frame_count = 0
                elif game_state == "playing" and event.button == 1:
                    player.shoot(bullets)

        if game_state == "playing":
            frame_count += 1
            elapsed_seconds = frame_count // FPS

            keys = pygame.key.get_pressed()
            player.handle_movement(keys, walls, map_width, map_height)
            player.update()

            cam_x = clamp(player.x - SCREEN_WIDTH // 2, 0, max(0, map_width - SCREEN_WIDTH))
            cam_y = clamp(player.y - SCREEN_HEIGHT // 2, 0, max(0, map_height - SCREEN_HEIGHT))
            mouse_x, mouse_y = pygame.mouse.get_pos()
            world_mouse_x = mouse_x + cam_x
            world_mouse_y = mouse_y + cam_y
            player.aim_angle = math.atan2(world_mouse_y - player.y, world_mouse_x - player.x)

            storm_timer += 1
            if storm_timer >= storm_shrink_duration:
                start_new_storm_phase()
            if storm_radius > storm_target_radius:
                storm_radius -= storm_shrink_speed

            if distance(player.x, player.y, *storm_center) > storm_radius:
                player.take_damage(0.15)

            for bot in bots:
                bot.update(player, bots, storm_center, storm_radius, bullets, walls, map_width, map_height)
                if bot.alive and distance(bot.x, bot.y, *storm_center) > storm_radius:
                    bot.take_damage(0.15)

            for b in bullets[:]:
                b.update(map_width, map_height)
                if not b.alive:
                    bullets.remove(b)
                    continue

                hit_wall = False
                for w in walls[:]:
                    if b.get_rect().colliderect(w.get_rect()):
                        w.hp -= 20
                        if w.hp <= 0:
                            walls.remove(w)
                        hit_wall = True
                        break
                if hit_wall:
                    if b in bullets:
                        bullets.remove(b)
                    continue

                if b.owner == "player":
                    for bot in bots:
                        if bot.alive and b.get_rect().colliderect(bot.get_rect()):
                            bot.take_damage(b.damage)
                            if b in bullets:
                                bullets.remove(b)
                            break
                elif b.owner == "bot":
                    hit_something = False
                    if player.alive and b.get_rect().colliderect(player.get_rect()):
                        player.take_damage(b.damage)
                        hit_something = True
                    if not hit_something:
                        for bot in bots:
                            if bot.alive and bot is not b.owner_ref and b.get_rect().colliderect(bot.get_rect()):
                                bot.take_damage(b.damage)
                                hit_something = True
                                break
                    if hit_something and b in bullets:
                        bullets.remove(b)

            for item in loot[:]:
                if player.get_rect().colliderect(item.get_rect()):
                    if item.kind == "medkit":
                        player.hp = min(player.max_hp, player.hp + 30)
                    elif item.kind == "wood":
                        player.wood += 20
                    else:
                        player.weapon = item.kind
                    loot.remove(item)

            bots_alive = sum(1 for b in bots if b.alive)

            if not player.alive:
                game_state = "defeat"
            elif bots_alive == 0:
                game_state = "victory"

        # ---- Drawing ----
        if game_state == "menu":
            draw_menu(screen)
        else:
            cam_x = clamp(player.x - SCREEN_WIDTH // 2, 0, max(0, map_width - SCREEN_WIDTH))
            cam_y = clamp(player.y - SCREEN_HEIGHT // 2, 0, max(0, map_height - SCREEN_HEIGHT))

            draw_map_background(screen, cam_x, cam_y)

            for node in resource_nodes:
                node.draw(screen, cam_x, cam_y)
            for item in loot:
                item.draw(screen, cam_x, cam_y)
            for w in walls:
                w.draw(screen, cam_x, cam_y)
            for bot in bots:
                bot.draw(screen, cam_x, cam_y)
            for b in bullets:
                b.draw(screen, cam_x, cam_y)
            player.draw(screen, cam_x, cam_y)

            draw_storm(screen, cam_x, cam_y)

            bots_alive = sum(1 for b in bots if b.alive)
            elapsed_seconds = frame_count // FPS
            draw_hud(screen, player, bots_alive, elapsed_seconds)

            if game_state == "victory":
                draw_end_screen(screen, "VICTORY ROYALE!", GREEN)
            elif game_state == "defeat":
                draw_end_screen(screen, "ELIMINATED", RED)

        pygame.display.flip()
        await asyncio.sleep(0)

    pygame.quit()


asyncio.run(main())
