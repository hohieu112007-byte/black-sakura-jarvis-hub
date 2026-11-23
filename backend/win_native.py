"""Native Python Win32 & UI Automation fast-path replacing Node/PowerShell overhead for core desktop tools."""
from __future__ import annotations

import ctypes
from ctypes import wintypes
import os
import re
import subprocess
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

import psutil

# --- Security Policy (ported 1:1 from fast-desktop-mcp/server.mjs) ---

BLOCKED_PROCESSES = (
    "taskmgr",
    "regedit",
    "mmc",
    "sechealthui",
    "bitwarden",
    "1password",
    "keepass",
    "keepassxc",
    "antigravity",
    "consent",
    "cmd",
    "powershell",
    "pwsh",
    "windowsterminal",
    "wt",
    "msconfig",
    "control",
)

BLOCKED_TITLE_SUBSTRINGS = (
    "task manager",
    "registry editor",
    "windows security",
    "administrator:",
    "bitwarden",
    "1password",
    "keepass",
    "antigravity",
    "ngân hàng",
    "internet banking",
    "vietcombank",
    "techcombank",
    "mb bank",
    "tpbank",
    "vpbank",
    "bidv",
    "agribank",
    "acb",
    "binance",
    "metamask",
    "phantom",
    "coinbase",
)

BLOCKED_CLOSE_PROCESSES = {
    "explorer",
    "shellexperiencehost",
    "searchhost",
    "startmenuexperiencehost",
    "applicationframehost",
    "system",
    "idle",
    "svchost",
    "csrss",
    "wininit",
    "winlogon",
    "lsass",
    "services",
    "dwm",
    "smss",
    "runtimebroker",
    "conhost",
    "node",
    "code",
    "cursor",
    "claude",
    "language_server",
    "language_server_windows_x64",
}

MINIMIZE_ONLY_EXCEPTIONS = {"antigravity"}

BLOCKED_HOTKEYS = {
    "alt+f4",
    "win+r",
    "win+x",
    "win+l",
    "ctrl+shift+esc",
    "ctrl+alt+delete",
    "shift+delete",
    "ctrl+shift+w",
}

BLOCKED_OPEN_EXTS = {
    ".exe", ".bat", ".ps1", ".cmd", ".vbs", ".vbe",
    ".js", ".jse", ".wsf", ".wsh", ".msi", ".msp",
    ".reg", ".lnk", ".scr", ".com", ".pif", ".cpl",
}

GLOBAL_MEDIA_KEYS = {
    "media_play_pause",
    "media_next",
    "media_prev",
    "media_stop",
    "volume_mute",
    "volume_down",
    "volume_up",
}

NATIVE_FAST_TOOLS = {
    "list_windows",
    "window_control",
    "send_hotkey",
    "click_window_point",
    "type_unicode_text",
    "open_edge_url",
    "open_path",
}


def _is_minimize_exception(keyword: str, action: str) -> bool:
    return action == "minimize" and keyword in MINIMIZE_ONLY_EXCEPTIONS


def is_blacklisted_text(text: str, action: str = "", *, check_processes: bool = True) -> Optional[str]:
    if not text:
        return None
    lower = str(text).lower().strip()
    if check_processes:
        proc_clean = lower.removesuffix(".exe")
        for proc in BLOCKED_PROCESSES:
            if _is_minimize_exception(proc, action):
                continue
            if len(proc) <= 3:
                if proc_clean == proc:
                    return f'Blocked sensitive application/process keyword: "{proc}"'
            elif proc_clean == proc or proc in proc_clean:
                return f'Blocked sensitive application/process keyword: "{proc}"'
    for sub in BLOCKED_TITLE_SUBSTRINGS:
        if _is_minimize_exception(sub, action):
            continue
        if len(sub) <= 3:
            if re.search(rf"\b{re.escape(sub)}\b", lower):
                return f'Blocked sensitive window title keyword: "{sub}"'
        elif sub in lower:
            return f'Blocked sensitive window title keyword: "{sub}"'
    return None


def assert_safe_target(target: Dict[str, Any], action: str) -> None:
    proc = str(target.get("process") or "").lower().removesuffix(".exe")
    title = str(target.get("title") or "").lower()
    for blocked in BLOCKED_PROCESSES:
        if _is_minimize_exception(blocked, action):
            continue
        if len(blocked) <= 3:
            matched = proc == blocked
        else:
            matched = proc == blocked or blocked in proc
        if matched:
            raise PermissionError(f'Security policy blocked {action} on protected process "{target.get("process")}".')
    for sub in BLOCKED_TITLE_SUBSTRINGS:
        if _is_minimize_exception(sub, action):
            continue
        sub_hit = bool(re.search(rf"\b{re.escape(sub)}\b", title)) if len(sub) <= 3 else (sub in title)
        if sub_hit:
            raise PermissionError(f'Security policy blocked {action} on protected window "{target.get("title")}".')
    if action == "close" and proc in BLOCKED_CLOSE_PROCESSES:
        raise PermissionError(f'Security policy blocked closing Windows shell/system process "{target.get("process")}".')


def assert_safe_target_name(name_or_alias: str, action: str = "action", *, is_title: bool = False) -> Optional[str]:
    lower = str(name_or_alias or "").strip().lower().removesuffix(".exe")
    if not lower:
        return None
    reason = is_blacklisted_text(lower, action=action, check_processes=not is_title)
    if reason:
        return reason
    if not is_title and action == "close" and lower in BLOCKED_CLOSE_PROCESSES:
        return f'Security policy blocked closing protected shell/system process "{name_or_alias}".'
    return None


def normalize_hotkey_combo(raw_combo: str) -> Tuple[str, List[int], bool]:
    """Normalize hotkey string and reject dangerous system combinations."""
    clean = re.sub(r"\s+", "", str(raw_combo or "").strip().lower())
    if not clean:
        raise ValueError("Hotkey combo cannot be empty.")

    mod_aliases = {"ctrl": "ctrl", "control": "ctrl", "alt": "alt", "menu": "alt", "shift": "shift", "win": "win", "meta": "win", "super": "win"}
    key_aliases = {
        "enter": "return", "return": "return", "esc": "escape", "escape": "escape",
        "del": "delete", "delete": "delete", "bs": "backspace", "backspace": "backspace",
        "space": "space", "tab": "tab", "up": "up", "down": "down", "left": "left", "right": "right",
        "home": "home", "end": "end", "pgup": "pageup", "pageup": "pageup", "pgdn": "pagedown", "pagedown": "pagedown",
    }

    if clean in GLOBAL_MEDIA_KEYS:
        vk = _KEY_VK_MAP[clean]
        return clean, [vk], True

    parts = [p for p in clean.split("+") if p]
    mods: List[str] = []
    keys: List[str] = []
    for p in parts:
        if p in mod_aliases:
            m = mod_aliases[p]
            if m not in mods:
                mods.append(m)
        else:
            k = key_aliases.get(p, p)
            keys.append(k)

    # Canonical modifier order to match BLOCKED_HOTKEYS reliably
    ordered_mods = [m for m in ("ctrl", "alt", "shift", "win") if m in mods]
    canonical = "+".join([*ordered_mods, *keys])
    if canonical in BLOCKED_HOTKEYS or clean in BLOCKED_HOTKEYS:
        raise PermissionError(f'Security policy blocked dangerous hotkey "{raw_combo}".')
    if len(keys) != 1:
        raise ValueError(f'Unsupported hotkey format: "{raw_combo}".')
    main_key = keys[0]
    vk_list = [_KEY_VK_MAP[m] for m in ordered_mods]
    if main_key in _KEY_VK_MAP:
        vk_list.append(_KEY_VK_MAP[main_key])
    elif len(main_key) == 1 and ("a" <= main_key <= "z" or "0" <= main_key <= "9"):
        vk_list.append(ord(main_key.upper()))
    else:
        raise ValueError(f'Unsupported key in hotkey: "{main_key}".')
    return canonical, vk_list, False


def is_blocked_hotkey(raw_combo: str) -> Optional[str]:
    try:
        normalize_hotkey_combo(raw_combo)
        return None
    except PermissionError as exc:
        return str(exc)
    except Exception:
        return None


# --- Win32 ctypes bindings ---

_IS_WINDOWS = os.name == "nt"
if _IS_WINDOWS:
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    try:
        dwmapi = ctypes.WinDLL("dwmapi", use_last_error=False)
    except Exception:
        dwmapi = None
    user32.GetForegroundWindow.restype = wintypes.HWND
    user32.IsWindowVisible.argtypes = [wintypes.HWND]
    user32.IsWindowVisible.restype = wintypes.BOOL
    user32.IsIconic.argtypes = [wintypes.HWND]
    user32.IsIconic.restype = wintypes.BOOL
    user32.IsZoomed.argtypes = [wintypes.HWND]
    user32.IsZoomed.restype = wintypes.BOOL
    user32.GetWindowTextLengthW.argtypes = [wintypes.HWND]
    user32.GetWindowTextLengthW.restype = ctypes.c_int
    user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    user32.GetWindowTextW.restype = ctypes.c_int
    user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
    user32.GetWindowRect.restype = wintypes.BOOL
    user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user32.GetWindowThreadProcessId.restype = wintypes.DWORD
    user32.BringWindowToTop.argtypes = [wintypes.HWND]
    user32.BringWindowToTop.restype = wintypes.BOOL
    user32.SetForegroundWindow.argtypes = [wintypes.HWND]
    user32.SetForegroundWindow.restype = wintypes.BOOL
    user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
    user32.ShowWindow.restype = wintypes.BOOL
    user32.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
    user32.PostMessageW.restype = wintypes.BOOL
    user32.SetWindowPos.argtypes = [wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.UINT]
    user32.SetWindowPos.restype = wintypes.BOOL
    user32.AttachThreadInput.argtypes = [wintypes.DWORD, wintypes.DWORD, wintypes.BOOL]
    user32.AttachThreadInput.restype = wintypes.BOOL
    user32.GetCursorPos.argtypes = [ctypes.POINTER(wintypes.POINT)]
    user32.GetCursorPos.restype = wintypes.BOOL
    user32.SetCursorPos.argtypes = [ctypes.c_int, ctypes.c_int]
    user32.SetCursorPos.restype = wintypes.BOOL
    user32.GetMonitorInfoW.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
    user32.GetMonitorInfoW.restype = wintypes.BOOL
    kernel32.GetCurrentThreadId.restype = wintypes.DWORD
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL
    kernel32.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
    kernel32.QueryFullProcessImageNameW.restype = wintypes.BOOL
else:
    user32 = None
    kernel32 = None
    dwmapi = None

ULONG_PTR = ctypes.c_uint64 if ctypes.sizeof(ctypes.c_void_p) == 8 else ctypes.c_uint32

_KEY_VK_MAP: Dict[str, int] = {
    "ctrl": 0x11,
    "alt": 0x12,
    "shift": 0x10,
    "win": 0x5B,
    "return": 0x0D,
    "escape": 0x1B,
    "tab": 0x09,
    "space": 0x20,
    "backspace": 0x08,
    "delete": 0x2E,
    "insert": 0x2D,
    "home": 0x24,
    "end": 0x23,
    "pageup": 0x21,
    "pagedown": 0x22,
    "left": 0x25,
    "up": 0x26,
    "right": 0x27,
    "down": 0x28,
    "f1": 0x70, "f2": 0x71, "f3": 0x72, "f4": 0x73,
    "f5": 0x74, "f6": 0x75, "f7": 0x76, "f8": 0x77,
    "f9": 0x78, "f10": 0x79, "f11": 0x7A, "f12": 0x7B,
    "media_next": 0xB0,
    "media_prev": 0xB1,
    "media_stop": 0xB2,
    "media_play_pause": 0xB3,
    "volume_mute": 0xAD,
    "volume_down": 0xAE,
    "volume_up": 0xAF,
    "-": 0xBD,
    "=": 0xBB,
    "[": 0xDB,
    "]": 0xDD,
    ";": 0xBA,
    "'": 0xDE,
    ",": 0xBC,
    ".": 0xBE,
    "/": 0xBF,
}

INPUT_MOUSE = 0
INPUT_KEYBOARD = 1
KEYEVENTF_KEYUP = 0x0002
KEYEVENTF_UNICODE = 0x0004
MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004
MOUSEEVENTF_RIGHTDOWN = 0x0008
MOUSEEVENTF_RIGHTUP = 0x0010

SW_HIDE = 0
SW_SHOWNORMAL = 1
SW_SHOWMINIMIZED = 2
SW_MAXIMIZE = 3
SW_RESTORE = 9
WM_CLOSE = 0x0010
DWMWA_CLOAKED = 14


class _MOUSEINPUT(ctypes.Structure):
    _fields_ = [
        ("dx", wintypes.LONG),
        ("dy", wintypes.LONG),
        ("mouseData", wintypes.DWORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ULONG_PTR),
    ]


class _KEYBDINPUT(ctypes.Structure):
    _fields_ = [
        ("wVk", wintypes.WORD),
        ("wScan", wintypes.WORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ULONG_PTR),
    ]


class _HARDWAREINPUT(ctypes.Structure):
    _fields_ = [
        ("uMsg", wintypes.DWORD),
        ("wParamL", wintypes.WORD),
        ("wParamH", wintypes.WORD),
    ]


class _INPUT_UNION(ctypes.Union):
    _fields_ = [("mi", _MOUSEINPUT), ("ki", _KEYBDINPUT), ("hi", _HARDWAREINPUT)]


class _INPUT(ctypes.Structure):
    _fields_ = [("type", wintypes.DWORD), ("union", _INPUT_UNION)]


class _MONITORINFO(ctypes.Structure):
    _fields_ = [
        ("cbSize", wintypes.DWORD),
        ("rcMonitor", wintypes.RECT),
        ("rcWork", wintypes.RECT),
        ("dwFlags", wintypes.DWORD),
    ]


def _get_process_name_by_pid(pid: int) -> str:
    if pid <= 0:
        return ""
    try:
        return psutil.Process(pid).name().removesuffix(".exe")
    except Exception:
        pass
    if _IS_WINDOWS and kernel32 is not None:
        h = kernel32.OpenProcess(0x1000, False, pid)
        if h:
            try:
                sz = wintypes.DWORD(512)
                buf = ctypes.create_unicode_buffer(512)
                if kernel32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(sz)) and buf.value:
                    return Path(buf.value).stem
            except Exception:
                pass
            finally:
                kernel32.CloseHandle(h)
    return ""


def _is_window_cloaked(hwnd: int) -> bool:
    if dwmapi is None:
        return False
    cloaked = ctypes.c_int(0)
    try:
        res = dwmapi.DwmGetWindowAttribute(
            wintypes.HWND(hwnd),
            wintypes.DWORD(DWMWA_CLOAKED),
            ctypes.byref(cloaked),
            ctypes.sizeof(cloaked),
        )
        return res == 0 and cloaked.value != 0
    except Exception:
        return False


def list_windows(filter_text: str = "") -> Dict[str, Any]:
    if not _IS_WINDOWS:
        raise RuntimeError("Native Win32 is only supported on Windows.")
    t0 = time.perf_counter()
    flt = str(filter_text or "").strip().lower()
    fg_hwnd = int(user32.GetForegroundWindow() or 0)
    windows: List[Dict[str, Any]] = []
    pid_cache: Dict[int, str] = {}

    WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    def _cb(hwnd: int, _lparam: int) -> bool:
        if not user32.IsWindowVisible(hwnd):
            return True
        if _is_window_cloaked(hwnd):
            return True
        length = user32.GetWindowTextLengthW(hwnd)
        if length <= 0:
            return True
        buf = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buf, length + 1)
        title = buf.value.strip()
        if not title:
            return True

        rect = wintypes.RECT()
        if not user32.GetWindowRect(hwnd, ctypes.byref(rect)):
            return True
        w = int(rect.right - rect.left)
        h = int(rect.bottom - rect.top)
        minimized = bool(user32.IsIconic(hwnd))
        maximized = bool(user32.IsZoomed(hwnd))
        if not minimized and (w < 80 or h < 40):
            return True

        pid = wintypes.DWORD(0)
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        pid_int = int(pid.value)
        proc = pid_cache.get(pid_int)
        if proc is None:
            proc = _get_process_name_by_pid(pid_int)
            pid_cache[pid_int] = proc

        if flt and flt not in title.lower() and flt not in proc.lower():
            return True

        windows.append({
            "hwnd": str(int(hwnd)),
            "pid": pid_int,
            "process": proc,
            "title": title,
            "x": int(rect.left),
            "y": int(rect.top),
            "width": w,
            "height": h,
            "minimized": minimized,
            "maximized": maximized,
            "focused": int(hwnd) == fg_hwnd,
        })
        return True

    user32.EnumWindows(WNDENUMPROC(_cb), 0)
    return {
        "ok": True,
        "count": len(windows),
        "windows": windows,
        "elapsed_ms": round((time.perf_counter() - t0) * 1000, 1),
    }


def _resolve_target_window(args: Dict[str, Any], action: str) -> Dict[str, Any]:
    hwnd_arg = str(args.get("hwnd") or "").strip()
    proc_arg = str(args.get("process") or "").strip().lower().removesuffix(".exe")
    title_arg = str(args.get("title") or "").strip().lower()
    if not hwnd_arg and not proc_arg and not title_arg:
        raise ValueError("Provide at least one target filter: hwnd, title, or process.")

    if proc_arg:
        reason = is_blacklisted_text(proc_arg, action=action, check_processes=True)
        if reason:
            raise PermissionError(f'Security policy blocked {action} on "{proc_arg}": {reason}')
    if title_arg:
        reason = is_blacklisted_text(title_arg, action=action, check_processes=False)
        if reason:
            raise PermissionError(f'Security policy blocked {action} on "{title_arg}": {reason}')

    wins = list_windows()["windows"]
    matches: List[Dict[str, Any]] = []
    for w in wins:
        if hwnd_arg and w["hwnd"] == hwnd_arg:
            matches = [w]
            break
        w_proc = str(w.get("process") or "").lower()
        w_title = str(w.get("title") or "").lower()
        ok_proc = (not proc_arg) or (proc_arg in w_proc)
        ok_title = (not title_arg) or (title_arg in w_title)
        if ok_proc and ok_title:
            matches.append(w)

    if not matches:
        raise LookupError("No matching visible window found.")
    if proc_arg in ("edge", "msedge") and not title_arg and not hwnd_arg:
        def _is_edge_browser(w: Dict[str, Any]) -> int:
            tl = str(w.get("title") or "").lower()
            return 0 if (
                ("microsoft" in tl and "edge" in tl)
                or "new tab" in tl
                or "tab mới" in tl
                or "inprivate" in tl
            ) else 1
        matches.sort(key=lambda w: (_is_edge_browser(w), 1 if w.get("minimized") else 0, -(w.get("width") or 0)))
    else:
        matches.sort(key=lambda w: (1 if w.get("minimized") else 0, -(w.get("width") or 0)))
    target = matches[0]
    assert_safe_target(target, action)
    return target


def _enum_monitors() -> List[Dict[str, Any]]:
    monitors: List[Dict[str, Any]] = []
    MONITORENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, ctypes.c_void_p, ctypes.c_void_p, ctypes.POINTER(wintypes.RECT), wintypes.LPARAM)

    def _cb(hmon: int, _hdc: int, _lprect: Any, _lparam: int) -> bool:
        mi = _MONITORINFO()
        mi.cbSize = ctypes.sizeof(_MONITORINFO)
        if user32.GetMonitorInfoW(ctypes.c_void_p(hmon), ctypes.byref(mi)):
            work = mi.rcWork
            mon = mi.rcMonitor
            monitors.append({
                "primary": bool(mi.dwFlags & 1),
                "x": int(work.left),
                "y": int(work.top),
                "width": int(work.right - work.left),
                "height": int(work.bottom - work.top),
                "area": int((mon.right - mon.left) * (mon.bottom - mon.top)),
            })
        return True

    user32.EnumDisplayMonitors(0, 0, MONITORENUMPROC(_cb), 0)
    monitors.sort(key=lambda m: (0 if m["primary"] else 1, m["x"]))
    return monitors


def _force_foreground(hwnd: int) -> None:
    if user32.IsIconic(hwnd):
        user32.ShowWindow(hwnd, SW_RESTORE)
    fg = int(user32.GetForegroundWindow() or 0)
    if fg == hwnd:
        return
    cur_tid = kernel32.GetCurrentThreadId()
    fg_tid = user32.GetWindowThreadProcessId(fg, None) if fg else 0
    attached = False
    if fg_tid and fg_tid != cur_tid:
        attached = bool(user32.AttachThreadInput(cur_tid, fg_tid, True))
    try:
        user32.BringWindowToTop(hwnd)
        ok = bool(user32.SetForegroundWindow(hwnd))
        if not ok:
            # Classic Win32 TOPMOST toggle fallback when background focus lock blocks SetForegroundWindow
            user32.SetWindowPos(hwnd, wintypes.HWND(-1), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0040)
            user32.SetWindowPos(hwnd, wintypes.HWND(-2), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0040)
            user32.SetForegroundWindow(hwnd)
    finally:
        if attached:
            user32.AttachThreadInput(cur_tid, fg_tid, False)


def window_control(args: Dict[str, Any]) -> Dict[str, Any]:
    t0 = time.perf_counter()
    action = str(args.get("action") or "").strip().lower()
    if not action:
        raise ValueError("Missing window_control action.")
    target = _resolve_target_window(args, action)
    hwnd = int(target["hwnd"])
    monitor_idx = int(args.get("monitor") or 0)

    if action == "focus":
        _force_foreground(hwnd)
    elif action == "minimize":
        user32.ShowWindow(hwnd, SW_SHOWMINIMIZED)
    elif action == "maximize":
        if monitor_idx in (1, 2):
            mons = _enum_monitors()
            if monitor_idx <= len(mons):
                m = mons[monitor_idx - 1]
                user32.ShowWindow(hwnd, SW_RESTORE)
                user32.SetWindowPos(hwnd, 0, m["x"] + 20, m["y"] + 20, min(900, m["width"] - 40), min(600, m["height"] - 40), 0x0040)
        user32.ShowWindow(hwnd, SW_MAXIMIZE)
        _force_foreground(hwnd)
    elif action == "restore":
        user32.ShowWindow(hwnd, SW_RESTORE)
    elif action == "close":
        user32.PostMessageW(hwnd, WM_CLOSE, 0, 0)
    elif action == "move":
        x = int(args.get("x", target["x"]))
        y = int(args.get("y", target["y"]))
        w = int(args.get("width", target["width"]))
        h = int(args.get("height", target["height"]))
        user32.ShowWindow(hwnd, SW_RESTORE)
        user32.SetWindowPos(hwnd, 0, x, y, max(200, w), max(150, h), 0x0004 | 0x0040)
    elif action in ("snap_left", "snap_right", "snap_top", "snap_bottom", "move_monitor_1", "move_monitor_2", "move_smaller_monitor", "move_larger_monitor", "move_other_monitor"):
        mons = _enum_monitors()
        if not mons:
            raise RuntimeError("No display monitors detected.")
        if action == "move_monitor_1" or monitor_idx == 1:
            mon = mons[0]
        elif action == "move_monitor_2" or monitor_idx == 2:
            mon = mons[min(1, len(mons) - 1)]
        elif action == "move_smaller_monitor":
            mon = min(mons, key=lambda m: m["area"])
        elif action == "move_larger_monitor":
            mon = max(mons, key=lambda m: m["area"])
        elif action == "move_other_monitor":
            cx = target["x"] + target["width"] // 2
            cy = target["y"] + target["height"] // 2
            cur_mon = next((m for m in mons if m["x"] <= cx < m["x"] + m["width"] and m["y"] <= cy < m["y"] + m["height"]), mons[0])
            other = [m for m in mons if m is not cur_mon]
            mon = other[0] if other else cur_mon
        else:
            # Find monitor containing window center
            cx = target["x"] + target["width"] // 2
            cy = target["y"] + target["height"] // 2
            mon = next((m for m in mons if m["x"] <= cx < m["x"] + m["width"] and m["y"] <= cy < m["y"] + m["height"]), mons[0])

        user32.ShowWindow(hwnd, SW_RESTORE)
        time.sleep(0.05)
        mx, my, mw, mh = mon["x"], mon["y"], mon["width"], mon["height"]
        if action == "snap_left":
            user32.SetWindowPos(hwnd, 0, mx, my, mw // 2, mh, 0x0040)
        elif action == "snap_right":
            user32.SetWindowPos(hwnd, 0, mx + mw // 2, my, mw - mw // 2, mh, 0x0040)
        elif action == "snap_top":
            user32.SetWindowPos(hwnd, 0, mx, my, mw, mh // 2, 0x0040)
        elif action == "snap_bottom":
            user32.SetWindowPos(hwnd, 0, mx, my + mh // 2, mw, mh - mh // 2, 0x0040)
        else:
            user32.SetWindowPos(hwnd, 0, mx + 20, my + 20, max(320, mw - 40), max(240, mh - 40), 0x0040)
            time.sleep(0.04)
            user32.ShowWindow(hwnd, SW_MAXIMIZE)
        _force_foreground(hwnd)
    else:
        raise ValueError(f"Unsupported window_control action: {action}")

    return {
        "ok": True,
        "action": action,
        "hwnd": target["hwnd"],
        "process": target["process"],
        "title": target["title"],
        "elapsed_ms": round((time.perf_counter() - t0) * 1000, 1),
    }


def _send_vk_chord(vks: List[int]) -> None:
    inputs: List[_INPUT] = []
    for vk in vks:
        inp = _INPUT(type=INPUT_KEYBOARD)
        inp.union.ki = _KEYBDINPUT(wVk=vk, wScan=0, dwFlags=0, time=0, dwExtraInfo=0)
        inputs.append(inp)
    for vk in reversed(vks):
        inp = _INPUT(type=INPUT_KEYBOARD)
        inp.union.ki = _KEYBDINPUT(wVk=vk, wScan=0, dwFlags=KEYEVENTF_KEYUP, time=0, dwExtraInfo=0)
        inputs.append(inp)
    arr = (_INPUT * len(inputs))(*inputs)
    user32.SendInput(len(inputs), arr, ctypes.sizeof(_INPUT))


def _send_unicode_string(text: str) -> int:
    if not text:
        return 0
    raw_u16 = text.encode("utf-16-le")
    code_units = [int.from_bytes(raw_u16[i:i + 2], "little") for i in range(0, len(raw_u16), 2)]
    inputs: List[_INPUT] = []
    for cu in code_units:
        d = _INPUT(type=INPUT_KEYBOARD)
        d.union.ki = _KEYBDINPUT(wVk=0, wScan=cu, dwFlags=KEYEVENTF_UNICODE, time=0, dwExtraInfo=0)
        u = _INPUT(type=INPUT_KEYBOARD)
        u.union.ki = _KEYBDINPUT(wVk=0, wScan=cu, dwFlags=KEYEVENTF_UNICODE | KEYEVENTF_KEYUP, time=0, dwExtraInfo=0)
        inputs.append(d)
        inputs.append(u)
    if inputs:
        arr = (_INPUT * len(inputs))(*inputs)
        user32.SendInput(len(inputs), arr, ctypes.sizeof(_INPUT))
    return len(text)


def send_hotkey(args: Dict[str, Any]) -> Dict[str, Any]:
    t0 = time.perf_counter()
    combos = args.get("combos") if isinstance(args.get("combos"), list) and args.get("combos") else ([args.get("combo")] if args.get("combo") else [])
    if not combos:
        raise ValueError("Provide either 'combo' or non-empty 'combos' array.")
    repeat = max(1, min(20, int(args.get("repeat") or 1)))
    delay_ms = max(20, min(500, int(args.get("delay_ms") or 65)))

    parsed = [normalize_hotkey_combo(str(c)) for c in combos]
    expanded = [item for _ in range(repeat) for item in parsed]
    if len(expanded) > 30:
        raise ValueError("Total hotkey steps cannot exceed 30.")

    all_global = all(is_glob for _, _, is_glob in expanded)
    prev_fg = int(user32.GetForegroundWindow() or 0)
    target = None
    if not all_global and (args.get("hwnd") or args.get("process") or args.get("title")):
        target = _resolve_target_window(args, "hotkey")
        _force_foreground(int(target["hwnd"]))
        time.sleep(0.05)

    try:
        for idx, (_canon, vks, _is_glob) in enumerate(expanded):
            _send_vk_chord(vks)
            if idx < len(expanded) - 1:
                time.sleep(delay_ms / 1000.0)
    finally:
        if args.get("restore_focus") is True and prev_fg and prev_fg != int(user32.GetForegroundWindow() or 0):
            _force_foreground(prev_fg)

    return {
        "ok": True,
        "sent_count": len(expanded),
        "combos": [c for c, _, _ in expanded],
        "elapsed_ms": round((time.perf_counter() - t0) * 1000, 1),
    }


def type_unicode_text(args: Dict[str, Any]) -> Dict[str, Any]:
    t0 = time.perf_counter()
    text = str(args.get("text") or "")
    if not text:
        raise ValueError("text cannot be empty.")
    if len(text) > 2000:
        raise ValueError("text exceeds maximum allowed length of 2000 characters.")

    prev_fg = int(user32.GetForegroundWindow() or 0)
    target = _resolve_target_window(args, "type")
    _force_foreground(int(target["hwnd"]))
    time.sleep(0.06)
    try:
        chars = _send_unicode_string(text)
        if args.get("press_enter") is True:
            time.sleep(0.03)
            _send_vk_chord([_KEY_VK_MAP["return"]])
    finally:
        if args.get("restore_focus") is True and prev_fg and prev_fg != int(user32.GetForegroundWindow() or 0):
            _force_foreground(prev_fg)

    return {
        "ok": True,
        "typed_chars": chars,
        "hwnd": target["hwnd"],
        "elapsed_ms": round((time.perf_counter() - t0) * 1000, 1),
    }


def click_window_point(args: Dict[str, Any]) -> Dict[str, Any]:
    t0 = time.perf_counter()
    has_abs = isinstance(args.get("x"), int) and isinstance(args.get("y"), int)
    has_rel = isinstance(args.get("rel_x"), int) and isinstance(args.get("rel_y"), int)
    if not has_abs and not has_rel:
        raise ValueError("Provide either integer (x, y) or integer (rel_x, rel_y).")

    target = _resolve_target_window(args, "click")
    hwnd = int(target["hwnd"])
    if target.get("minimized"):
        _force_foreground(hwnd)
        time.sleep(0.12)
        target = _resolve_target_window({"hwnd": target["hwnd"]}, "click")

    img_w = int(args.get("image_width") or 0)
    img_h = int(args.get("image_height") or 0)
    if has_rel:
        rx = int(args["rel_x"])
        ry = int(args["rel_y"])
        if img_w > 0 and img_h > 0:
            rx = int(round((rx * target["width"]) / img_w))
            ry = int(round((ry * target["height"]) / img_h))
        abs_x = target["x"] + rx
        abs_y = target["y"] + ry
    else:
        abs_x = int(args["x"])
        abs_y = int(args["y"])

    if not (target["x"] <= abs_x < target["x"] + target["width"] and target["y"] <= abs_y < target["y"] + target["height"]):
        raise PermissionError(f"Security policy blocked click outside target window bounds: ({abs_x}, {abs_y})")

    prev_cursor = wintypes.POINT()
    user32.GetCursorPos(ctypes.byref(prev_cursor))
    prev_fg = int(user32.GetForegroundWindow() or 0)

    _force_foreground(hwnd)
    time.sleep(0.05)
    user32.SetCursorPos(abs_x, abs_y)
    time.sleep(0.02)

    down_flag = MOUSEEVENTF_RIGHTDOWN if args.get("button") == "right" else MOUSEEVENTF_LEFTDOWN
    up_flag = MOUSEEVENTF_RIGHTUP if args.get("button") == "right" else MOUSEEVENTF_LEFTUP
    count = 2 if args.get("count") == 2 else 1

    try:
        for _ in range(count):
            d = _INPUT(type=INPUT_MOUSE)
            d.union.mi = _MOUSEINPUT(dx=0, dy=0, mouseData=0, dwFlags=down_flag, time=0, dwExtraInfo=0)
            u = _INPUT(type=INPUT_MOUSE)
            u.union.mi = _MOUSEINPUT(dx=0, dy=0, mouseData=0, dwFlags=up_flag, time=0, dwExtraInfo=0)
            arr = (_INPUT * 2)(d, u)
            user32.SendInput(2, arr, ctypes.sizeof(_INPUT))
            time.sleep(0.03)

        txt = str(args.get("text") or "")
        if txt:
            if len(txt) > 2000:
                raise ValueError("text exceeds 2000 chars.")
            time.sleep(0.05)
            _send_unicode_string(txt)
            if args.get("press_enter") is True:
                time.sleep(0.03)
                _send_vk_chord([_KEY_VK_MAP["return"]])
    finally:
        if args.get("restore_cursor", True) is not False:
            user32.SetCursorPos(prev_cursor.x, prev_cursor.y)
        if args.get("restore_focus") is True and prev_fg and prev_fg != int(user32.GetForegroundWindow() or 0):
            _force_foreground(prev_fg)

    return {
        "ok": True,
        "x": abs_x,
        "y": abs_y,
        "hwnd": target["hwnd"],
        "elapsed_ms": round((time.perf_counter() - t0) * 1000, 1),
    }


def _build_safe_http_url(raw_url: str = "", youtube_search: str = "", google_search: str = "", new_tab: bool = False) -> str:
    if new_tab and not raw_url and not youtube_search and not google_search:
        return "edge://newtab"
    raw = raw_url
    if not raw and youtube_search:
        q = str(youtube_search).strip()
        if re.match(r"^(?:youtube|ytb|youtube\.com|trang\s*chủ(?:\s*youtube)?|home)$", q, re.I):
            raw = "https://www.youtube.com"
        else:
            raw = "https://www.youtube.com/results?" + urlencode({"search_query": q})
    elif not raw and google_search:
        q = str(google_search).strip()
        if re.match(r"^(?:google|google\.com|trang\s*chủ(?:\s*google)?|home)$", q, re.I):
            raw = "https://www.google.com"
        else:
            raw = "https://www.google.com/search?" + urlencode({"q": q})
    if not raw:
        raise ValueError("Provide url, youtube_search, google_search, or new_tab.")
    trimmed = str(raw).strip()
    if trimmed.lower() in ("about:blank", "edge://newtab"):
        return trimmed.lower()
    if any(ch in trimmed for ch in ("\r", "\n", "\x00")):
        raise ValueError("URL contains invalid control characters.")

    parsed = urlparse(trimmed)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError(f'Only valid http:// and https:// URLs are allowed (got "{raw}").')
    if parsed.hostname:
        reason = is_blacklisted_text(parsed.hostname)
        if reason:
            raise PermissionError(f'Security policy blocked opening sensitive domain "{parsed.hostname}".')
    if parsed.hostname and parsed.hostname.lower().endswith("youtube.com") and parsed.path == "/results":
        qs = parse_qs(parsed.query)
        if "search_query" in qs:
            parsed = parsed._replace(query=urlencode({"search_query": qs["search_query"][0]}))
    return urlunparse(parsed)


def _find_msedge_exe() -> Optional[str]:
    candidates = [
        Path(os.environ.get("ProgramFiles(x86)", "")) / "Microsoft" / "Edge" / "Application" / "msedge.exe",
        Path(os.environ.get("ProgramFiles", "")) / "Microsoft" / "Edge" / "Application" / "msedge.exe",
        Path(os.environ.get("LocalAppData", "")) / "Microsoft" / "Edge" / "Application" / "msedge.exe",
    ]
    for p in candidates:
        if p.is_file():
            return str(p)
    return None


def open_edge_url(args: Dict[str, Any]) -> Dict[str, Any]:
    t0 = time.perf_counter()
    urls_arg = args.get("urls") if isinstance(args.get("urls"), list) else []
    target_urls: List[str] = []
    if urls_arg:
        for u in urls_arg[:10]:
            target_urls.append(_build_safe_http_url(raw_url=str(u)))
    else:
        single = _build_safe_http_url(
            raw_url=str(args.get("url") or ""),
            youtube_search=str(args.get("youtube_search") or ""),
            google_search=str(args.get("google_search") or ""),
            new_tab=bool(args.get("new_tab")),
        )
        cnt = max(1, min(10, int(args.get("count") or 1)))
        target_urls = [single] * cnt

    edge_exe = _find_msedge_exe()
    if edge_exe:
        subprocess.Popen(
            [edge_exe, *target_urls],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            close_fds=True,
        )
    else:
        for u in target_urls:
            os.startfile(u)

    if args.get("focus", True) is not False:
        try:
            time.sleep(0.15)
            w = _resolve_target_window({"process": "msedge"}, "focus")
            _force_foreground(int(w["hwnd"]))
        except Exception:
            pass

    return {
        "ok": True,
        "opened_count": len(target_urls),
        "urls": target_urls,
        "elapsed_ms": round((time.perf_counter() - t0) * 1000, 1),
    }


def open_path(args: Dict[str, Any]) -> Dict[str, Any]:
    raw = str(args.get("path") or "").strip()
    if not raw:
        raise ValueError("path is required.")
    p = Path(raw).resolve()
    if p.suffix.lower() in BLOCKED_OPEN_EXTS:
        raise PermissionError(f'Security policy blocked opening executable/script file "{p.name}".')
    sandbox_env = os.environ.get("JARVIS_SANDBOX_DIR", "").strip()
    sandbox_root = Path(sandbox_env).expanduser().resolve() if sandbox_env else (
        Path(r"C:\AI-Sandbox").resolve() if Path(r"C:\AI-Sandbox").exists() else (Path(__file__).resolve().parent.parent / "sandbox").resolve()
    )
    allowed_roots = [
        sandbox_root,
        Path.home() / "Downloads",
        Path.home() / "Desktop",
        Path.home() / "Documents",
        Path.home() / "Pictures",
    ]
    if not any(p == r or r in p.parents for r in allowed_roots):
        raise PermissionError(f'Security policy blocked opening path outside safe directories: "{p}"')
    if not p.exists():
        raise FileNotFoundError(f"Path not found: {p}")
    os.startfile(str(p))
    return {"ok": True, "path": str(p)}


def try_execute_native(tool_name: str, arguments: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    """Execute core Win32 tools directly in Python (<15ms). Returns None if tool should use MCP."""
    if not _IS_WINDOWS or tool_name not in NATIVE_FAST_TOOLS:
        return None
    args = arguments or {}
    try:
        if tool_name == "list_windows":
            out = list_windows(str(args.get("filter") or ""))
        elif tool_name == "window_control":
            out = window_control(args)
        elif tool_name == "send_hotkey":
            out = send_hotkey(args)
        elif tool_name == "type_unicode_text":
            out = type_unicode_text(args)
        elif tool_name == "click_window_point":
            out = click_window_point(args)
        elif tool_name == "open_edge_url":
            out = open_edge_url(args)
        elif tool_name == "open_path":
            out = open_path(args)
        else:
            return None
        return {"server": "python_native", "tool": tool_name, **out}
    except PermissionError as sec_err:
        return {"ok": False, "server": "python_native", "tool": tool_name, "blocked_guard": True, "error": str(sec_err)}
    except Exception as exc:
        return {"ok": False, "server": "python_native", "tool": tool_name, "error": str(exc)}
