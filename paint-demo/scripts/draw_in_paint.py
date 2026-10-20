"""GUI-only Windows Paint demo. No Codex and no OpenAI API calls.

Opens a NEW Paint window, draws bounded paths in the central canvas, and
captures only that Paint window. Requires an unlocked user desktop session.
"""
from __future__ import annotations

import ctypes
import ctypes.wintypes
import json
import os
import subprocess
import sys
import time
from pathlib import Path

OUT = Path("paint-demo/out")
OUT.mkdir(parents=True, exist_ok=True)


def status(**data):
    (OUT / "status.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def paint_windows():
    user32 = ctypes.windll.user32
    windows = []
    callback = ctypes.WINFUNCTYPE(ctypes.wintypes.BOOL, ctypes.wintypes.HWND, ctypes.wintypes.LPARAM)
    user32.EnumWindows.argtypes = [callback, ctypes.wintypes.LPARAM]

    def visit(hwnd, _):
        if not user32.IsWindowVisible(hwnd):
            return True
        n = user32.GetWindowTextLengthW(hwnd) + 1
        if n < 2:
            return True
        buff = ctypes.create_unicode_buffer(n)
        user32.GetWindowTextW(hwnd, buff, n)
        title = buff.value
        if "paint" in title.casefold() or "그림판" in title:
            windows.append((int(hwnd), title))
        return True

    user32.EnumWindows(callback(visit), 0)
    return windows


def rectangle(hwnd):
    rect = ctypes.wintypes.RECT()
    if not ctypes.windll.user32.GetWindowRect(hwnd, ctypes.byref(rect)):
        raise RuntimeError("Cannot read Paint window bounds")
    return rect.left, rect.top, rect.right, rect.bottom


def main():
    if os.name != "nt":
        raise RuntimeError("Windows required")
    try:
        ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        pass

    # Win32 HWND is pointer-sized; without prototypes ctypes may truncate it.
    u = ctypes.windll.user32
    u.IsWindowVisible.argtypes = [ctypes.wintypes.HWND]
    u.GetWindowTextLengthW.argtypes = [ctypes.wintypes.HWND]
    u.GetWindowTextW.argtypes = [ctypes.wintypes.HWND, ctypes.wintypes.LPWSTR, ctypes.c_int]
    u.GetWindowRect.argtypes = [ctypes.wintypes.HWND, ctypes.POINTER(ctypes.wintypes.RECT)]
    u.GetForegroundWindow.restype = ctypes.wintypes.HWND
    u.SetForegroundWindow.argtypes = [ctypes.wintypes.HWND]
    u.ShowWindow.argtypes = [ctypes.wintypes.HWND, ctypes.c_int]

    import pyautogui as p
    p.FAILSAFE = True
    p.PAUSE = 0.05
    screen = p.size()
    if screen.width < 900 or screen.height < 650:
        raise RuntimeError(f"Desktop is too small or inaccessible: {screen}")

    plan = json.loads(
        Path("paint-demo/commands/house.json").read_text(encoding="utf-8")
    )
    strokes = plan.get("strokes")
    if not isinstance(strokes, list) or not 1 <= len(strokes) <= 30:
        raise ValueError("Invalid stroke count")
    points_count = 0
    for stroke in strokes:
        if not isinstance(stroke, list) or not 2 <= len(stroke) <= 50:
            raise ValueError("Invalid stroke")
        for xy in stroke:
            if (
                not isinstance(xy, list)
                or len(xy) != 2
                or any(type(v) is not int or not 0 <= v <= 1000 for v in xy)
            ):
                raise ValueError("Expected normalized integer x/y (0..1000)")
            points_count += 1
    if points_count > 500:
        raise ValueError("Too many mouse inputs")

    existing = {h for h, _ in paint_windows()}
    subprocess.Popen(["mspaint.exe"], stdout=subprocess.DEVNULL,
                     stderr=subprocess.DEVNULL)
    chosen = None
    deadline = time.monotonic() + 25
    while time.monotonic() < deadline:
        new = [(h, title) for h, title in paint_windows() if h not in existing]
        if new:
            chosen = new[-1]
            break
        time.sleep(0.5)
    if chosen is None:
        raise RuntimeError(
            "No new Paint window; unlock Windows and start runner in a logged-in "
            "interactive session (not as a Windows service)."
        )

    hwnd, title = chosen
    user32 = ctypes.windll.user32
    user32.ShowWindow(hwnd, 3)  # maximize
    time.sleep(1.5)
    user32.SetForegroundWindow(hwnd)
    time.sleep(0.8)
    if user32.GetForegroundWindow() != hwnd:
        raise RuntimeError("Paint is not foreground; refusing mouse input")

    left, top, right, bottom = rectangle(hwnd)
    w, h = right - left, bottom - top
    if w < 900 or h < 650:
        raise RuntimeError(f"Paint is too small: {w}x{h}")

    # Stay inside the middle of a fresh canvas; avoid ribbon and window chrome.
    area_left = left + round(0.23 * w)
    area_top = top + round(0.34 * h)
    area_w, area_h = round(0.53 * w), round(0.52 * h)

    def pt(x, y):
        sx = area_left + round(x * area_w / 1000)
        sy = area_top + round(y * area_h / 1000)
        if not (10 < sx < screen.width - 10 and 240 < sy < screen.height - 10):
            raise RuntimeError(f"Point outside the safe drawing area: {(sx, sy)}")
        return sx, sy

    projected = [[pt(*xy) for xy in stroke] for stroke in strokes]
    status(state="drawing", paint_title=title, paint_rect=[left, top, right, bottom],
           strokes=len(strokes), points=points_count)
    print(f"Paint={title!r}; screen={screen}; strokes={len(strokes)}; "
          f"points={points_count}", flush=True)

    # Fresh Windows Paint normally selects a drawing tool by default.
    for stroke in projected:
        if user32.GetForegroundWindow() != hwnd:
            raise RuntimeError("Foreground changed; stopping mouse input")
        p.moveTo(*stroke[0], duration=0.13)
        p.mouseDown(button="left")
        try:
            for x, y in stroke[1:]:
                p.moveTo(x, y, duration=0.10)
        finally:
            p.mouseUp(button="left")
        time.sleep(0.08)

    time.sleep(0.8)
    x0, y0 = max(0, left), max(0, top)
    x1, y1 = min(screen.width, right), min(screen.height, bottom)
    p.screenshot(region=(x0, y0, x1 - x0, y1 - y0)).save(
        OUT / "paint_window.png"
    )
    status(state="mouse_actions_completed", paint_title=title,
           strokes=len(strokes), points=points_count,
           note="Inspect paint_window.png: successful mouse input does not prove visible drawing")
    print("FINISHED: paint-demo/out/paint_window.png", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        status(state="failed", error=f"{type(exc).__name__}: {exc}")
        print(f"FAILED: {type(exc).__name__}: {exc}", file=sys.stderr, flush=True)
        raise
