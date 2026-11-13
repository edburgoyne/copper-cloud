"""Experimental worker-only adapter for a subset of pygame-ce.

pygame's drawing, surfaces, fonts and events are real pygame-ce objects. The
window, input and clock are adapted because SDL's browser window needs a DOM.
This is compatibility glue, not a Python or JavaScript security sandbox.
"""
import asyncio
import json
import time

import pygame
from js import studio_present, studio_should_render, studio_take_input

_screen = None
_events = []
_held = set()
_mouse_position = (0, 0)
_mouse_buttons = set()
_last_mouse_position = (0, 0)
_real_sleep = asyncio.sleep
_frame_deadline = None


async def _browser_sleep(delay, result=None):
    # Account for work done during the frame instead of adding 1/60s after it.
    global _frame_deadline
    if delay == 0:
        now = time.perf_counter()
        if _frame_deadline is None or now - _frame_deadline > 0.1:
            _frame_deadline = now + 1 / 60
        wait = max(0, _frame_deadline - now)
        _frame_deadline += 1 / 60
        return await _real_sleep(wait, result)
    return await _real_sleep(delay, result)


def _init():
    pygame.font.init()
    return (1, 0)


def _set_mode(size=(640, 480), flags=0, depth=0, display=0, vsync=0):
    global _screen
    width, height = map(int, size)
    if not (1 <= width <= 1280 and 1 <= height <= 960):
        raise ValueError("Studio preview size must be between 1x1 and 1280x960")
    if flags & pygame.OPENGL:
        raise NotImplementedError("OpenGL display modes are not supported by the studio adapter")
    _screen = pygame.Surface((width, height))
    return _screen


def _flip(*_args):
    if _screen is None:
        raise pygame.error("No studio display has been created")
    if not studio_should_render():
        return
    width, height = _screen.get_size()
    studio_present(width, height, pygame.image.tobytes(_screen, "RGBA"))


def _key_code(code):
    special = {
        "ArrowUp": pygame.K_UP, "ArrowDown": pygame.K_DOWN,
        "ArrowLeft": pygame.K_LEFT, "ArrowRight": pygame.K_RIGHT,
        "Space": pygame.K_SPACE, "Escape": pygame.K_ESCAPE,
        "Enter": pygame.K_RETURN, "Backspace": pygame.K_BACKSPACE,
        "ShiftLeft": pygame.K_LSHIFT, "ShiftRight": pygame.K_RSHIFT,
    }
    if code in special:
        return special[code]
    if len(code) == 4 and code.startswith("Key") and code[3].isalpha():
        return ord(code[3].lower())
    if len(code) == 6 and code.startswith("Digit") and code[5].isdigit():
        return ord(code[5])
    return pygame.K_UNKNOWN


def _pump():
    global _mouse_position, _last_mouse_position
    for item in json.loads(studio_take_input()):
        kind = item.get("type")
        if kind == "blur":
            _held.clear()
            _mouse_buttons.clear()
        elif kind in ("keydown", "keyup"):
            key = _key_code(str(item.get("code", "")))
            if kind == "keydown":
                _held.add(key)
            else:
                _held.discard(key)
            event_type = pygame.KEYDOWN if kind == "keydown" else pygame.KEYUP
            _events.append(pygame.event.Event(event_type, key=key, unicode=str(item.get("key", "")), mod=0))
        elif kind in ("mousemove", "mousedown", "mouseup"):
            _last_mouse_position = _mouse_position
            _mouse_position = (int(item.get("x", 0)), int(item.get("y", 0)))
            button = int(item.get("button", 1))
            if kind == "mousedown":
                _mouse_buttons.add(button)
            elif kind == "mouseup":
                _mouse_buttons.discard(button)
            if kind == "mousemove":
                rel = (_mouse_position[0] - _last_mouse_position[0], _mouse_position[1] - _last_mouse_position[1])
                _events.append(pygame.event.Event(pygame.MOUSEMOTION, pos=_mouse_position, rel=rel, buttons=_get_mouse_buttons()))
            else:
                event_type = pygame.MOUSEBUTTONDOWN if kind == "mousedown" else pygame.MOUSEBUTTONUP
                _events.append(pygame.event.Event(event_type, pos=_mouse_position, button=button))
    if len(_events) > 256:
        del _events[:-256]


def _get_events(eventtype=None, pump=True, exclude=None):
    _pump()
    if eventtype is None and exclude is None:
        result = _events[:]
        _events.clear()
        return result
    allowed = None if eventtype is None else {eventtype} if isinstance(eventtype, int) else set(eventtype)
    excluded = set() if exclude is None else {exclude} if isinstance(exclude, int) else set(exclude)
    selected = [event for event in _events if (allowed is None or event.type in allowed) and event.type not in excluded]
    _events[:] = [event for event in _events if event not in selected]
    return selected


class _Pressed:
    def __getitem__(self, key):
        return key in _held


def _pressed():
    _pump()
    return _Pressed()


def _get_mouse_buttons(num_buttons=3):
    return tuple(number in _mouse_buttons for number in range(1, num_buttons + 1))


def _mouse_pos():
    _pump()
    return _mouse_position


def _mouse_pressed(num_buttons=3):
    _pump()
    return _get_mouse_buttons(num_buttons)


class _Clock:
    def __init__(self):
        self._last = time.perf_counter()
        self._elapsed = 0

    def tick(self, _fps=0):
        now = time.perf_counter()
        self._elapsed = max(0, round((now - self._last) * 1000))
        self._last = now
        return self._elapsed

    tick_busy_loop = tick

    def get_time(self):
        return self._elapsed

    get_rawtime = get_time

    def get_fps(self):
        return 1000 / self._elapsed if self._elapsed else 0.0


pygame.init = _init
pygame.quit = lambda: None
pygame.display.set_mode = _set_mode
pygame.display.get_surface = lambda: _screen
pygame.display.flip = _flip
pygame.display.update = _flip
pygame.display.set_caption = lambda *_args: None
pygame.event.get = _get_events
pygame.event.pump = _pump
pygame.key.get_pressed = _pressed
pygame.key.get_mods = lambda: 0
pygame.mouse.get_pos = _mouse_pos
pygame.mouse.get_pressed = _mouse_pressed
pygame.time.Clock = _Clock


async def studio_execute(source):
    """Execute the submitted file and wait for its Pygbag-style asyncio.run()."""
    global _frame_deadline
    _frame_deadline = None
    tasks = []
    original_run, original_sleep = asyncio.run, asyncio.sleep

    def schedule(coro, **_kwargs):
        task = asyncio.create_task(coro)
        tasks.append(task)
        return task

    try:
        # Pyodide already has an event loop. Schedule Pygbag-style entry points.
        asyncio.run = schedule
        asyncio.sleep = _browser_sleep
        namespace = {"__name__": "__main__", "__file__": "main.py"}
        exec(compile(source, "main.py", "exec"), namespace)
        if tasks:
            await asyncio.gather(*tasks)
    finally:
        asyncio.run, asyncio.sleep = original_run, original_sleep
