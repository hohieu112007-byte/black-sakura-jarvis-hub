from __future__ import annotations

import asyncio
import json
import os
import shutil
import threading
import traceback
from pathlib import Path
from typing import Any, Dict, List, Optional

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from .context_engine import SANDBOX_ROOT
from .win_native import NATIVE_FAST_TOOLS, try_execute_native

PROJECT_ROOT = Path(__file__).resolve().parent.parent
FAST_DESKTOP_ENTRY = PROJECT_ROOT / "fast-desktop-mcp" / "server.mjs"
PLAYWRIGHT_PROFILE_DIR = SANDBOX_ROOT / "browser-profile"

SERVER_ALIASES = {
    "fast_desktop": "fast_desktop",
    "fast-desktop": "fast_desktop",
    "fastdesktop": "fast_desktop",
    "agent_desktop": "agent_desktop",
    "agent-desktop": "agent_desktop",
    "agentdesktop": "agent_desktop",
    "playwright": "playwright",
}


def normalize_server_name(name: str) -> str:
    key = str(name or "").strip().lower()
    if key not in SERVER_ALIASES:
        raise ValueError(f"Unsupported MCP server: {name}")
    return SERVER_ALIASES[key]


def _find_npx_entry(*parts: str) -> Optional[Path]:
    npx_root = Path(os.environ.get("LOCALAPPDATA", "")) / "npm-cache" / "_npx"
    if not npx_root.exists():
        return None
    for child in npx_root.iterdir():
        cand = child.joinpath("node_modules", *parts)
        if cand.is_file():
            return cand
    return None


def _resolve_node_runtime() -> tuple[str, Dict[str, str]]:
    """Use system node.exe when available; fall back to Electron runtime with ELECTRON_RUN_AS_NODE=1 for zero-Node portable PCs."""
    env = dict(os.environ)
    node_bin = shutil.which("node")
    if not node_bin:
        prog_node = Path(r"C:\Program Files\nodejs\node.exe")
        if prog_node.is_file():
            node_bin = str(prog_node)
    if node_bin:
        return node_bin, env
    electron_exe = env.get("JARVIS_ELECTRON_EXE", "").strip()
    if electron_exe and Path(electron_exe).is_file():
        env["ELECTRON_RUN_AS_NODE"] = "1"
        return electron_exe, env
    return "node", env


def _build_server_params(server_key: str) -> StdioServerParameters:
    if server_key == "fast_desktop":
        node_bin, node_env = _resolve_node_runtime()
        return StdioServerParameters(
            command=node_bin,
            args=[str(FAST_DESKTOP_ENTRY)],
            cwd=str(FAST_DESKTOP_ENTRY.parent),
            env=node_env,
        )
    if server_key == "agent_desktop":
        direct_exe = Path(os.environ.get("APPDATA", "")) / "npm" / "node_modules" / "agent-desktop" / "bin" / "agent-desktop-win32-x64.exe"
        if direct_exe.is_file():
            return StdioServerParameters(
                command=str(direct_exe),
                args=["mcp"],
                env=dict(os.environ),
            )
        cmd_bin = shutil.which("cmd.exe") or "cmd.exe"
        return StdioServerParameters(
            command=cmd_bin,
            args=["/c", "agent-desktop", "mcp"],
            env=dict(os.environ),
        )
    if server_key == "playwright":
        PLAYWRIGHT_PROFILE_DIR.mkdir(parents=True, exist_ok=True)
        pw_cli = _find_npx_entry("@playwright", "mcp", "cli.js")
        if pw_cli is not None:
            node_bin, node_env = _resolve_node_runtime()
            return StdioServerParameters(
                command=node_bin,
                args=[str(pw_cli), "--user-data-dir", str(PLAYWRIGHT_PROFILE_DIR)],
                env=node_env,
            )
        cmd_bin = shutil.which("cmd.exe") or "cmd.exe"
        return StdioServerParameters(
            command=cmd_bin,
            args=[
                "/c",
                "npx",
                "-y",
                "@playwright/mcp@latest",
                "--user-data-dir",
                str(PLAYWRIGHT_PROFILE_DIR),
            ],
            env=dict(os.environ),
        )
    raise ValueError(f"Unknown MCP server: {server_key}")


class _PersistentMcpWorker:
    """Keeps one stdio MCP server alive inside a dedicated asyncio task to satisfy anyio scope affinity."""

    def __init__(self, server_key: str, loop: asyncio.AbstractEventLoop) -> None:
        self.server_key = server_key
        self.loop = loop
        self._queue: Optional[asyncio.Queue] = None
        self._task: Optional[asyncio.Task] = None
        self._tools: List[Dict[str, Any]] = []
        self._connected = False
        self._start_lock = threading.Lock()

    @property
    def connected(self) -> bool:
        return self._connected and self._task is not None and not self._task.done()

    @property
    def cached_tools(self) -> List[Dict[str, Any]]:
        return list(self._tools)

    def _ensure_worker_started_coro(self) -> None:
        if self._task is None or self._task.done():
            self._queue = asyncio.Queue()
            self._task = self.loop.create_task(self._worker_main())

    async def _worker_main(self) -> None:
        params = _build_server_params(self.server_key)
        assert self._queue is not None
        errlog_fh = open(os.devnull, "w", encoding="utf-8")
        try:
            async with stdio_client(params, errlog=errlog_fh) as (read_stream, write_stream):
                async with ClientSession(read_stream, write_stream) as session:
                    await session.initialize()
                    tools_resp = await session.list_tools()
                    self._tools = [
                        {
                            "name": t.name,
                            "description": t.description or "",
                            "inputSchema": getattr(t, "input_schema", None) or getattr(t, "inputSchema", {}) or {},
                        }
                        for t in (tools_resp.tools or [])
                    ]
                    self._connected = True

                    while True:
                        item = await self._queue.get()
                        if item is None:
                            break
                        action, payload, fut, call_timeout = item
                        if fut.cancelled():
                            continue
                        try:
                            if action == "list_tools":
                                fut.set_result(list(self._tools))
                            elif action == "call_tool":
                                tool_name, arguments = payload
                                inner_timeout = max(5.0, float(call_timeout) - 1.5)
                                try:
                                    raw_res = await asyncio.wait_for(
                                        session.call_tool(tool_name, arguments=arguments or {}),
                                        timeout=inner_timeout,
                                    )
                                except asyncio.TimeoutError:
                                    if not fut.done():
                                        fut.set_exception(TimeoutError(f"MCP tool '{tool_name}' timed out after {inner_timeout:.1f}s"))
                                    self._connected = False
                                    break
                                fut.set_result(_normalize_mcp_result(self.server_key, tool_name, raw_res))
                            else:
                                fut.set_exception(ValueError(f"Unknown action: {action}"))
                        except BaseException as exc:
                            if not fut.done():
                                fut.set_exception(RuntimeError("".join(traceback.format_exception(exc))))
        except BaseException as exc:
            self._connected = False
            sub_err = RuntimeError("".join(traceback.format_exception(exc)))
            if self._queue is not None:
                while not self._queue.empty():
                    try:
                        item = self._queue.get_nowait()
                        if item is not None:
                            _, _, fut, _ = item
                            if not fut.done():
                                fut.set_exception(sub_err)
                    except Exception:
                        break
        finally:
            self._connected = False
            try:
                errlog_fh.close()
            except Exception:
                pass

    def _dispatch(self, action: str, payload: Any, timeout: float = 40.0) -> Any:
        async def _send() -> Any:
            self._ensure_worker_started_coro()
            assert self._queue is not None
            fut = self.loop.create_future()
            await self._queue.put((action, payload, fut, timeout))
            return await asyncio.wait_for(fut, timeout=timeout)

        future = asyncio.run_coroutine_threadsafe(_send(), self.loop)
        return future.result(timeout=timeout + 2.0)

    def ensure_ready(self, timeout: float = 35.0) -> List[Dict[str, Any]]:
        return self._dispatch("list_tools", None, timeout=timeout)

    def call_tool(self, tool_name: str, arguments: Optional[Dict[str, Any]] = None, timeout: float = 40.0) -> Dict[str, Any]:
        return self._dispatch("call_tool", (tool_name, arguments or {}), timeout=timeout)

    def close(self) -> None:
        async def _stop() -> None:
            if self._queue is not None and self._task is not None and not self._task.done():
                await self._queue.put(None)
                try:
                    await asyncio.wait_for(self._task, timeout=3.0)
                except Exception:
                    self._task.cancel()

        try:
            asyncio.run_coroutine_threadsafe(_stop(), self.loop).result(timeout=4.0)
        except Exception:
            pass
        self._connected = False


def _normalize_mcp_result(server_key: str, tool_name: str, raw_res: Any) -> Dict[str, Any]:
    texts: List[str] = []
    images_data: List[str] = []
    for item in getattr(raw_res, "content", []) or []:
        ctype = getattr(item, "type", None)
        if ctype == "text" or hasattr(item, "text"):
            txt = getattr(item, "text", "")
            if txt:
                texts.append(txt)
        elif ctype == "image":
            img_b64 = getattr(item, "data", "")
            if isinstance(img_b64, str) and img_b64:
                images_data.append(img_b64)

    joined = "\n".join(texts).strip()
    is_error = bool(getattr(raw_res, "isError", False) or getattr(raw_res, "is_error", False))
    parsed: Any = None
    if joined:
        try:
            parsed = json.loads(joined)
        except Exception:
            parsed = {"text": joined}
    else:
        parsed = {}

    if not isinstance(parsed, dict):
        parsed = {"data": parsed}

    result: Dict[str, Any] = {
        "ok": not is_error,
        "server": server_key,
        "tool": tool_name,
        **parsed,
    }
    if images_data:
        result["images_count"] = len(images_data)
        result["__images"] = images_data
    if is_error and "error" not in result:
        result["error"] = joined or f"{server_key}.{tool_name} failed"
    return result


class LocalMcpManager:
    """Direct Python MCP client hub for fast-desktop, agent-desktop, and playwright."""

    def __init__(self) -> None:
        self.python_native_enabled = True
        self._loop = asyncio.new_event_loop()
        self._thread = threading.Thread(target=self._run_loop, name="mcp-executor-loop", daemon=True)
        self._thread.start()

        self._workers: Dict[str, _PersistentMcpWorker] = {
            "fast_desktop": _PersistentMcpWorker("fast_desktop", self._loop),
            "agent_desktop": _PersistentMcpWorker("agent_desktop", self._loop),
            "playwright": _PersistentMcpWorker("playwright", self._loop),
        }

    def _run_loop(self) -> None:
        asyncio.set_event_loop(self._loop)
        self._loop.run_forever()

    def warmup_core(self) -> Dict[str, bool]:
        status: Dict[str, bool] = {}
        try:
            self._workers["fast_desktop"].ensure_ready(timeout=25.0)
            status["fast_desktop"] = True
        except Exception:
            status["fast_desktop"] = False
        status["agent_desktop"] = self._workers["agent_desktop"].connected
        status["playwright"] = self._workers["playwright"].connected
        return status

    def get_status(self) -> Dict[str, bool]:
        st = {k: w.connected for k, w in self._workers.items()}
        st["python_native_win32"] = bool(self.python_native_enabled)
        return st

    def list_tools(self, server_name: str, ensure: bool = True) -> List[Dict[str, Any]]:
        key = normalize_server_name(server_name)
        worker = self._workers[key]
        if ensure and not worker.connected:
            return worker.ensure_ready()
        return worker.cached_tools

    def execute_mcp_tool(
        self,
        server_name: str,
        tool_name: str,
        arguments: Optional[Dict[str, Any]] = None,
        timeout: float = 40.0,
    ) -> Dict[str, Any]:
        key = normalize_server_name(server_name)
        if key == "fast_desktop" and self.python_native_enabled and tool_name in NATIVE_FAST_TOOLS:
            native_res = try_execute_native(tool_name, arguments or {})
            if native_res is not None:
                if native_res.get("ok") or native_res.get("blocked_guard") or "no matching visible window" in str(native_res.get("error") or "").lower():
                    return native_res
        worker = self._workers[key]
        try:
            return worker.call_tool(tool_name, arguments=arguments or {}, timeout=timeout)
        except Exception as exc:
            # Retry once if the worker process closed unexpectedly
            if not worker.connected:
                try:
                    return worker.call_tool(tool_name, arguments=arguments or {}, timeout=timeout)
                except Exception as retry_exc:
                    return {"ok": False, "server": key, "tool": tool_name, "error": str(retry_exc)}
            return {"ok": False, "server": key, "tool": tool_name, "error": str(exc)}

    def panic_stop(self) -> Dict[str, Any]:
        # Keep fast_desktop intact for emergency release, stop heavy browser/UI workers
        closed = []
        for key in ("playwright", "agent_desktop"):
            if self._workers[key].connected:
                self._workers[key].close()
                closed.append(key)
        return {"ok": True, "stopped_servers": closed}

    def close_all(self) -> None:
        for worker in self._workers.values():
            worker.close()
        if self._loop.is_running():
            self._loop.call_soon_threadsafe(self._loop.stop)


_GLOBAL_MCP_MANAGER: Optional[LocalMcpManager] = None
_GLOBAL_LOCK = threading.Lock()


def get_mcp_manager() -> LocalMcpManager:
    global _GLOBAL_MCP_MANAGER
    with _GLOBAL_LOCK:
        if _GLOBAL_MCP_MANAGER is None:
            _GLOBAL_MCP_MANAGER = LocalMcpManager()
        return _GLOBAL_MCP_MANAGER


def execute_mcp_tool(
    server_name: str,
    tool_name: str,
    arguments: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    return get_mcp_manager().execute_mcp_tool(server_name, tool_name, arguments)
