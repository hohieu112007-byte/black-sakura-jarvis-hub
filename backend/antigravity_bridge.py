from __future__ import annotations

import json
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

PROJECT_ROOT = Path(__file__).resolve().parent.parent
BRIDGE_DIR = PROJECT_ROOT / "bridge_queue"
TASK_INBOX_PATH = BRIDGE_DIR / "task_inbox.json"

_QUEUE_LOCK = threading.Lock()


def _load_inbox() -> list[dict]:
    if not TASK_INBOX_PATH.exists():
        return []
    try:
        data = json.loads(TASK_INBOX_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _save_inbox(items: list[dict]) -> None:
    BRIDGE_DIR.mkdir(parents=True, exist_ok=True)
    TASK_INBOX_PATH.write_text(json.dumps(items[-50:], ensure_ascii=False, indent=2), encoding="utf-8")


def queue_antigravity_task(task_text: str, context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    clean = str(task_text or "").strip()
    if not clean:
        raise ValueError("Task text is empty")

    prompt_command = f"/autowon [AUTO-AI-PC] {clean}"
    entry = {
        "id": uuid.uuid4().hex[:10],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "flag": "/autowon",
        "target_model": "Gemini 3.8 Flash (Low)",
        "command": prompt_command,
        "goal": clean,
        "context": context or {},
        "status": "queued",
    }
    with _QUEUE_LOCK:
        items = _load_inbox()
        items.append(entry)
        _save_inbox(items)
    return entry


def dispatch_to_antigravity(
    task_text: str,
    context: Optional[Dict[str, Any]] = None,
    auto_send_ui: bool = True,
) -> Dict[str, Any]:
    """
    Queue task to Auto AI PC/bridge_queue/task_inbox.json with /autowon flag
    and optionally inject '/autowon [AUTO-AI-PC] <task>' into an open Antigravity window.
    """
    entry = queue_antigravity_task(task_text, context=context)
    prompt_command = entry["command"]
    clipboard_copied = False
    ui_dispatched = False
    bridge_note = ""

    try:
        import pyperclip  # type: ignore

        pyperclip.copy(prompt_command)
        clipboard_copied = True
    except Exception as exc:
        bridge_note = f"Clipboard error: {exc}"

    if auto_send_ui and clipboard_copied:
        try:
            from pywinauto import Desktop  # type: ignore

            desktop = Desktop(backend="uia")
            windows = desktop.windows(title_re=".*Antigravity.*")
            if windows:
                win = windows[0]
                try:
                    if win.is_minimized():
                        win.restore()
                except Exception:
                    pass
                win.set_focus()
                time.sleep(0.18)
                # Focus chat input in Antigravity (Ctrl+L) or paste directly and submit
                win.type_keys("^l", pause=0.05)
                time.sleep(0.12)
                win.type_keys("^v{ENTER}", pause=0.05)
                ui_dispatched = True
            else:
                bridge_note = "Không thấy cửa sổ Antigravity đang mở; đã xếp hàng vào task_inbox.json & clipboard."
        except Exception as exc:
            bridge_note = f"Đã ghi task_inbox.json & clipboard (chưa tự dán vào UI: {exc})."

    return {
        "ok": True,
        "route": "antigravity_flash",
        "task_id": entry["id"],
        "queue_file": str(TASK_INBOX_PATH),
        "command": prompt_command,
        "clipboard_copied": clipboard_copied,
        "ui_dispatched": ui_dispatched,
        "note": bridge_note or "Đã chuyển tác vụ sang Antigravity (/autowon [AUTO-AI-PC]).",
    }
