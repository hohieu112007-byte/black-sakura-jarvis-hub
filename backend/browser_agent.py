"""Optional guarded Browser-Use integration for authenticated real-browser multi-step workflows."""
from __future__ import annotations

import asyncio
import importlib.util
from typing import Any, Dict, Optional

from .win_native import BLOCKED_TITLE_SUBSTRINGS


def is_browser_use_available() -> bool:
    return importlib.util.find_spec("browser_use") is not None


def is_prompt_domain_blocked(text: str) -> Optional[str]:
    low = str(text or "").lower()
    for kw in BLOCKED_TITLE_SUBSTRINGS:
        if kw in low:
            return f'Security policy blocked Browser-Use on sensitive domain/topic "{kw}".'
    return None


class BrowserUseBridge:
    """Guarded wrapper around browser-use so authenticated browser flows obey domain blocklists."""

    def __init__(self, enabled: bool = False) -> None:
        self.enabled = bool(enabled)
        self._last_error: str = ""

    def set_enabled(self, enabled: bool) -> bool:
        self.enabled = bool(enabled)
        return self.enabled

    def get_status(self) -> Dict[str, Any]:
        return {
            "enabled": self.enabled,
            "available": is_browser_use_available(),
            "last_error": self._last_error,
        }

    def run_task(
        self,
        task_prompt: str,
        *,
        ollama_url: str = "http://127.0.0.1:11434",
        model: str = "qwen3.5:4b",
    ) -> Dict[str, Any]:
        if not self.enabled:
            return {"ok": False, "fallback": True, "reason": "Browser-Use đang tắt."}
        blocked = is_prompt_domain_blocked(task_prompt)
        if blocked:
            return {"ok": False, "blocked_guard": True, "error": blocked}
        if not is_browser_use_available():
            return {
                "ok": False,
                "fallback": True,
                "reason": "Chưa cài đặt gói Python 'browser-use'. Đang chuyển về Playwright / UIA mặc định.",
            }
        try:
            from browser_use import Agent  # type: ignore

            llm_obj = None
            try:
                from browser_use.llm import ChatOllama as BuChatOllama  # type: ignore

                llm_obj = BuChatOllama(model=model, host=ollama_url)
            except Exception:
                try:
                    from langchain_ollama import ChatOllama as LcChatOllama  # type: ignore

                    llm_obj = LcChatOllama(model=model, base_url=ollama_url)
                except Exception:
                    llm_obj = None

            if llm_obj is None:
                return {
                    "ok": False,
                    "fallback": True,
                    "reason": "Thiếu adapter Ollama cho Browser-Use (cài 'langchain-ollama' hoặc nâng cấp 'browser-use'). Đang chuyển về Playwright / UIA.",
                }

            async def _exec() -> str:
                agent = Agent(task=task_prompt, llm=llm_obj)
                res = await agent.run()
                return str(res)

            out = asyncio.run(_exec())
            return {"ok": True, "route": "browser_use", "reply": out}
        except Exception as exc:
            self._last_error = str(exc)[:220]
            return {"ok": False, "fallback": True, "reason": self._last_error}
