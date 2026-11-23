from __future__ import annotations

import base64
import hmac
import logging
import os
import re
import secrets
import traceback
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict, List, Optional

import uvicorn
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .context_engine import capture_clipboard_context, export_text_to_docx
from .mcp_executor import get_mcp_manager
from .tts_engine import synthesize_local_speech
from .vram_router import VramRouter

_mcp = get_mcp_manager()
_router = VramRouter(mcp_manager=_mcp)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Warm fast_desktop stdio MCP (CPU-only, ~15MB RAM) without loading any GPU VRAM
    try:
        _mcp.warmup_core()
    except Exception:
        pass
    _router.start_watchdog(interval_sec=8.0)
    yield
    _router.stop_watchdog()
    _router.force_unload_all()
    _mcp.close_all()


app = FastAPI(title="Black Sakura Jarvis-Hub Local Backend", version="1.0.0", lifespan=lifespan)

BACKEND_ERR_LOG = Path(__file__).resolve().parent / "backend_error.log"
SESSION_TOKEN_PATH = Path(__file__).resolve().parent / ".session_token"
_LOCAL_ORIGIN_RE = re.compile(r"^(?:https?://(?:127\.0\.0\.1|localhost)(?::\d+)?|file://.*)$", re.IGNORECASE)
_ALLOWED_HOSTS = {"127.0.0.1", "localhost", "[::1]", "testserver"}


def _init_session_token() -> str:
    env_tok = os.environ.get("JARVIS_API_TOKEN", "").strip()
    if len(env_tok) >= 16:
        tok = env_tok
    else:
        existing = ""
        try:
            if SESSION_TOKEN_PATH.is_file():
                cand = SESSION_TOKEN_PATH.read_text(encoding="utf-8").strip()
                if re.fullmatch(r"[A-Za-z0-9_\-]{32,128}", cand):
                    existing = cand
        except Exception:
            pass
        tok = existing or secrets.token_hex(32)
    try:
        if not SESSION_TOKEN_PATH.is_file() or SESSION_TOKEN_PATH.read_text(encoding="utf-8").strip() != tok:
            tmp = SESSION_TOKEN_PATH.with_suffix(".tmp")
            tmp.write_text(tok, encoding="utf-8")
            tmp.replace(SESSION_TOKEN_PATH)
    except Exception:
        pass
    return tok


_SESSION_TOKEN = _init_session_token()


@app.middleware("http")
async def local_security_middleware(request: Request, call_next):
    # 1. DNS Rebinding guard: reject non-localhost Host headers
    raw_host = (request.headers.get("host") or "").strip().lower()
    if raw_host:
        host_only = raw_host.split("]", 1)[0] + "]" if raw_host.startswith("[") else raw_host.split(":", 1)[0]
        if host_only not in _ALLOWED_HOSTS:
            return JSONResponse(status_code=403, content={"ok": False, "error": "Blocked non-localhost Host header."})

    # 2. Cross-Origin guard: reject requests from external http(s) websites (allow localhost, Electron file://, null)
    origin = (request.headers.get("origin") or "").strip()
    if origin and origin != "null" and not _LOCAL_ORIGIN_RE.match(origin):
        return JSONResponse(status_code=403, content={"ok": False, "error": "Blocked cross-origin request."})

    # 3. Require local session token on all mutating/sensitive requests (blocks CSRF & sandboxed iframes)
    if request.method.upper() not in ("GET", "HEAD", "OPTIONS"):
        provided = (request.headers.get("x-jarvis-token") or "").strip()
        if not provided or not hmac.compare_digest(provided, _SESSION_TOKEN):
            return JSONResponse(
                status_code=401,
                content={"ok": False, "error": "Unauthorized: missing or invalid X-Jarvis-Token."},
            )

    return await call_next(request)


# CORSMiddleware added after local_security_middleware so it wraps responses & handles preflight cleanly
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^(?:https?://(?:127\.0\.0\.1|localhost)(?::\d+)?|file://.*|null)$",
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-Jarvis-Token"],
)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    tb = traceback.format_exc()
    try:
        with BACKEND_ERR_LOG.open("a", encoding="utf-8") as f:
            f.write(f"\n--- {request.method} {request.url.path} ---\n{tb}\n")
    except Exception:
        pass
    logging.exception("Unhandled backend exception on %s", request.url.path)
    return JSONResponse(
        status_code=500,
        content={"ok": False, "error": f"Lỗi Backend ({type(exc).__name__}): {str(exc)[:220]}"},
    )


class ExecuteRequest(BaseModel):
    text: Optional[str] = None
    command: Optional[str] = None
    wav_base64: Optional[str] = None
    context: Optional[Dict[str, Any]] = None
    safety_mode: Optional[str] = None
    approved: bool = False


class SetSafetyRequest(BaseModel):
    safety_mode: str


class SetApiFallbackRequest(BaseModel):
    enabled: bool
    api_key: Optional[str] = None


class SetThinkingRequest(BaseModel):
    mode: str


class SetGamingGuardRequest(BaseModel):
    enabled: bool


class SetOmniParserRequest(BaseModel):
    enabled: bool


class SetBrowserUseRequest(BaseModel):
    enabled: bool


class SetNumCtxRequest(BaseModel):
    num_ctx: int


class SetModelRequest(BaseModel):
    model: str


class SetKeepAliveRequest(BaseModel):
    keep_alive: str


class TtsRequest(BaseModel):
    text: str
    voice: Optional[str] = "vi-VN-HoaiMyNeural"


class ExportWordRequest(BaseModel):
    title: Optional[str] = "Ghi chú Jarvis"
    content: str
    open_after: bool = True


class DictateRequest(BaseModel):
    wav_base64: Optional[str] = None
    text: Optional[str] = None
    auto_type: bool = True


class SyncAppsRequest(BaseModel):
    apps: List[str] = []


@app.get("/status")
@app.get("/api/status")
def get_status() -> Dict[str, Any]:
    return _router.get_status()


@app.post("/set-model")
@app.post("/api/model")
@app.post("/settings/model")
def set_model(req: SetModelRequest) -> Dict[str, Any]:
    return _router.set_model(req.model)


@app.post("/set-keep-alive")
@app.post("/api/keep-alive")
@app.post("/settings/keep-alive")
def set_keep_alive(req: SetKeepAliveRequest) -> Dict[str, Any]:
    return _router.set_keep_alive(req.keep_alive)


@app.post("/set-safety")
@app.post("/api/safety")
def set_safety(req: SetSafetyRequest) -> Dict[str, Any]:
    mode = _router.set_safety_mode(req.safety_mode)
    return {"ok": True, "safety_mode": mode}


@app.post("/set-api-fallback")
def set_api_fallback(req: SetApiFallbackRequest) -> Dict[str, Any]:
    try:
        return _router.set_api_fallback(req.enabled, api_key=req.api_key)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/set-thinking")
def set_thinking(req: SetThinkingRequest) -> Dict[str, Any]:
    return _router.set_thinking_mode(req.mode)


@app.post("/set-gaming-guard")
def set_gaming_guard(req: SetGamingGuardRequest) -> Dict[str, Any]:
    return _router.set_gaming_guard(req.enabled)


@app.post("/set-omniparser")
@app.post("/api/omniparser")
def set_omniparser(req: SetOmniParserRequest) -> Dict[str, Any]:
    return _router.set_omniparser(req.enabled)


@app.post("/set-browser-use")
@app.post("/api/browser-use")
def set_browser_use(req: SetBrowserUseRequest) -> Dict[str, Any]:
    return _router.set_browser_use(req.enabled)


@app.post("/set-num-ctx")
def set_num_ctx(req: SetNumCtxRequest) -> Dict[str, Any]:
    return _router.set_num_ctx(req.num_ctx)


@app.post("/clipboard-context")
def clipboard_context() -> Dict[str, Any]:
    return capture_clipboard_context()


@app.post("/export-word")
def export_word_doc(req: ExportWordRequest) -> Dict[str, Any]:
    import os

    out_path = export_text_to_docx(
        title=req.title or "Ghi chú Jarvis",
        content=req.content,
        filename_prefix="jarvis-note",
    )
    if req.open_after and out_path.exists():
        try:
            os.startfile(str(out_path))
        except Exception:
            pass
    return {"ok": True, "path": str(out_path), "filename": out_path.name}


@app.post("/unload-vram")
@app.post("/api/unload-vram")
def unload_vram() -> Dict[str, Any]:
    res = _router.force_unload_all()
    return {**res, "status": _router.get_status()}


@app.post("/panic")
@app.post("/api/panic")
def panic() -> Dict[str, Any]:
    return _router.panic()


@app.post("/tts")
@app.post("/api/tts")
def text_to_speech(req: TtsRequest) -> Dict[str, Any]:
    return synthesize_local_speech(req.text, voice=req.voice or "vi-VN-HoaiMyNeural")


@app.post("/dictate")
@app.post("/api/dictate")
def execute_dictation(req: DictateRequest) -> Dict[str, Any]:
    if req.wav_base64:
        try:
            wav_bytes = base64.b64decode(req.wav_base64)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Invalid wav_base64: {exc}") from exc
        return _router.handle_dictation_wav(wav_bytes, auto_type=req.auto_type)
    if req.text and req.text.strip():
        return _router.handle_dictation_text(req.text, auto_type=req.auto_type)
    raise HTTPException(status_code=400, detail="Missing 'wav_base64' or 'text'")


@app.post("/sync-apps")
def sync_apps(req: SyncAppsRequest) -> Dict[str, Any]:
    _router.sync_apps(req.apps)
    return {"ok": True, "count": len(_router.synced_apps)}


@app.post("/execute")
@app.post("/api/command")
def execute_command(req: ExecuteRequest) -> Dict[str, Any]:
    if req.wav_base64:
        try:
            wav_bytes = base64.b64decode(req.wav_base64)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Invalid wav_base64: {exc}") from exc
        return _router.handle_voice_wav(wav_bytes, context=req.context)

    cmd_text = (req.text or req.command or "").strip()
    if not cmd_text:
        raise HTTPException(status_code=400, detail="Missing 'text' or 'wav_base64'")
    return _router.route_and_execute(
        cmd_text,
        context=req.context,
        safety_mode=req.safety_mode,
        approved=req.approved,
    )


@app.post("/voice")
async def execute_voice(request: Request, file: Optional[UploadFile] = File(default=None)) -> Dict[str, Any]:
    if file is not None:
        wav_bytes = await file.read()
        return await run_in_threadpool(_router.handle_voice_wav, wav_bytes)

    content_type = (request.headers.get("content-type") or "").lower()
    data: Dict[str, Any] = {}
    if "application/json" in content_type:
        try:
            parsed = await request.json()
            if isinstance(parsed, dict):
                data = parsed
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Invalid JSON body: {exc}") from exc
    elif "multipart/form-data" in content_type or "application/x-www-form-urlencoded" in content_type:
        form = await request.form()
        up_file = form.get("file")
        if hasattr(up_file, "read"):
            wav_bytes = await up_file.read()
            return await run_in_threadpool(_router.handle_voice_wav, wav_bytes)
        data = {k: v for k, v in form.items()}

    b64 = data.get("wav_base64")
    ctx = data.get("context") if isinstance(data.get("context"), dict) else None
    if b64:
        try:
            wav_bytes = base64.b64decode(str(b64))
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Invalid wav_base64: {exc}") from exc
        return await run_in_threadpool(_router.handle_voice_wav, wav_bytes, ctx)

    fallback_text = str(data.get("text") or data.get("command") or "").strip()
    if fallback_text:
        return await run_in_threadpool(_router.route_and_execute, fallback_text, ctx)

    raise HTTPException(status_code=400, detail="No audio or text provided")


if __name__ == "__main__":
    uvicorn.run("backend.server:app", host="127.0.0.1", port=8765, reload=False)
