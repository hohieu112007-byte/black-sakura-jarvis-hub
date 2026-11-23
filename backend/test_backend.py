"""Comprehensive health, VRAM Keep-Alive, STT, MCP, and Router verification suite."""
from __future__ import annotations

import base64
import io
import json
import time
import wave
from pathlib import Path
from typing import Dict
from unittest.mock import patch

import requests

from backend.antigravity_bridge import TASK_INBOX_PATH, _load_inbox, _save_inbox, queue_antigravity_task
from backend.mcp_executor import execute_mcp_tool, get_mcp_manager
from backend.vram_router import CONFIG_PATH, VramRouter, is_gaming

BASE = "http://127.0.0.1:8765"
OLLAMA = "http://127.0.0.1:11434"
SESSION_TOKEN_PATH = Path(__file__).resolve().parent / ".session_token"


def _auth_headers() -> Dict[str, str]:
    if SESSION_TOKEN_PATH.exists():
        tok = SESSION_TOKEN_PATH.read_text(encoding="utf-8").strip()
        if tok:
            return {"X-Jarvis-Token": tok}
    return {}


def _make_silence_wav_b64(seconds: float = 0.6) -> str:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(16000)
        wf.writeframes(b"\x00\x00" * int(16000 * seconds))
    return base64.b64encode(buf.getvalue()).decode("ascii")


def main() -> None:
    t0 = time.time()
    api = requests.Session()
    api.headers.update(_auth_headers())

    # 1. Ollama & 3 local models present
    tags_resp = requests.get(f"{OLLAMA}/api/tags", timeout=5)
    assert tags_resp.ok, "Ollama API is not reachable on 127.0.0.1:11434"
    names = {m.get("name") for m in tags_resp.json().get("models", [])}
    for req_model in ("qwen3:0.6b", "qwen3:1.7b", "qwen3.5:4b"):
        assert req_model in names, f"Missing Ollama model: {req_model} (found {names})"
    print("1_OLLAMA_MODELS_OK:", sorted(req_model for req_model in ("qwen3:0.6b", "qwen3:1.7b", "qwen3.5:4b")))

    # 2. FastAPI live /status
    st0 = api.get(f"{BASE}/status", timeout=5).json()
    assert st0["ok"] is True
    assert st0["mcp_status"]["fast_desktop"] is True, f"fast_desktop not warm: {st0}"
    print("2_BACKEND_STATUS_OK:", st0["current_model"], st0["keep_alive_setting"], st0["mcp_status"])

    # 3. Model switching, thinking mode & config.json persistence
    for alias, full in (("0.6b", "qwen3:0.6b"), ("1.7b", "qwen3:1.7b"), ("4b", "qwen3.5:4b")):
        r_m = api.post(f"{BASE}/set-model", json={"model": alias}, timeout=10).json()
        assert r_m["current_model"] == full and r_m["model_alias"] == alias
    r_th_off = api.post(f"{BASE}/set-thinking", json={"mode": "off"}, timeout=10).json()
    assert r_th_off["thinking_mode"] == "off"
    r_th_auto = api.post(f"{BASE}/set-thinking", json={"mode": "auto"}, timeout=10).json()
    assert r_th_auto["thinking_mode"] == "auto"
    cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    assert cfg["current_model"] == "qwen3.5:4b"
    print("3_SET_MODEL_AND_CONFIG_OK:", cfg)

    # 4. Keep-Alive 2m -> Ollama inference loads 0.6b (think=false) -> Switch 0s unloads VRAM immediately
    api.post(f"{BASE}/set-model", json={"model": "0.6b"}, timeout=10).raise_for_status()
    r_2m = api.post(f"{BASE}/set-keep-alive", json={"keep_alive": "2m"}, timeout=10).json()
    assert r_2m["keep_alive_setting"] == "2m"

    r_warm = requests.post(
        f"{OLLAMA}/api/chat",
        json={
            "model": "qwen3:0.6b",
            "stream": False,
            "think": False,
            "keep_alive": "2m",
            "options": {"num_predict": 16},
            "messages": [{"role": "user", "content": "hi"}],
        },
        timeout=75,
    ).json()
    assert r_warm.get("message", {}).get("content"), f"Unexpected Ollama reply: {r_warm}"
    st_warm = api.get(f"{BASE}/status", timeout=5).json()
    assert st_warm["vram_loaded"] is True and "qwen3:0.6b" in st_warm["ollama_loaded_models"]

    r_1m = api.post(f"{BASE}/set-keep-alive", json={"keep_alive": "1m"}, timeout=10).json()
    assert r_1m["keep_alive_setting"] == "1m"
    r_1m_cmd = api.post(f"{BASE}/execute", json={"text": "giữ vram 1 phút"}, timeout=10).json()
    assert r_1m_cmd["ok"] is True and r_1m_cmd["tier"] == 1

    r_0s = api.post(f"{BASE}/set-keep-alive", json={"keep_alive": "0s"}, timeout=10).json()
    assert r_0s["keep_alive_setting"] == "0s" and r_0s["vram_loaded"] is False
    assert r_0s["ollama_loaded_models"] == [], f"Model still in VRAM after 0s: {r_0s}"
    print("4_KEEP_ALIVE_AND_0S_UNLOAD_OK: warm -> unloaded=[]")

    # 5. Faster-Whisper /voice lazy load + auto unload on 0s
    r_voice = api.post(f"{BASE}/voice", json={"wav_base64": _make_silence_wav_b64(0.6)}, timeout=45).json()
    assert r_voice["ok"] is True
    assert r_voice["stt"]["vram_loaded"] is False
    print("5_WHISPER_STT_0S_OK: device=" + str(r_voice["stt"].get("device")))

    # 6. /unload-vram & Tier 1 Fast-Path
    r_ul = api.post(f"{BASE}/unload-vram", timeout=10).json()
    assert r_ul["ok"] is True and r_ul["vram_loaded"] is False
    r_fp = api.post(f"{BASE}/execute", json={"text": "xả vram"}, timeout=10).json()
    assert r_fp["ok"] is True and r_fp["tier"] == 1
    print("6_TIER1_AND_UNLOAD_ENDPOINT_OK")

    # 7. Direct Python MCP connections (fast_desktop & agent_desktop)
    mgr = get_mcp_manager()
    fd_res = execute_mcp_tool("fast_desktop", "list_windows", {})
    assert fd_res.get("ok") is True, f"fast_desktop failed: {fd_res}"
    ad_res = execute_mcp_tool("agent_desktop", "desktop_list_displays", {})
    assert ad_res.get("ok") is True, f"agent_desktop failed: {ad_res}"
    mgr.close_all()
    print("7_DIRECT_MCP_OK: fast_desktop & agent_desktop responded")

    # 8. Gaming auto-detection unit check (mocked cs2.exe)
    class _FakeProc:
        def __init__(self, name: str) -> None:
            self.info = {"name": name}

    with patch("backend.vram_router.psutil.process_iter", return_value=[_FakeProc("cs2.exe")]):
        import backend.vram_router as vr

        vr._GAMING_CACHE["ts"] = 0.0
        assert is_gaming() is True
        vr._GAMING_CACHE["ts"] = 0.0
    print("8_GAMING_GUARD_OK")

    # 9. Antigravity Bridge queue test (with cleanup)
    before = _load_inbox()
    entry = queue_antigravity_task("test-stability-check", {"source": "test_backend.py"})
    assert entry["flag"] == "/autowon" and TASK_INBOX_PATH.exists()
    _save_inbox(before)
    print("9_ANTIGRAVITY_BRIDGE_QUEUE_OK")

    # 10. Multi-step Fast-Path + Local TTS + Dictation text + Vision tag check
    r_multi = api.post(f"{BASE}/execute", json={"text": "xả vram rồi game mode"}, timeout=15).json()
    assert r_multi["ok"] is True and r_multi.get("steps_executed") == 2
    print("10_MULTI_STEP_FAST_PATH_OK:", r_multi["reply"])

    r_tts = api.post(f"{BASE}/tts", json={"text": "Xin chào Jarvis Local."}, timeout=20).json()
    assert r_tts["ok"] is True and len(r_tts.get("audio_base64", "")) > 200
    print("11_LOCAL_TTS_OK:", r_tts["engine"], r_tts["mime_type"])

    r_dict = api.post(f"{BASE}/dictate", json={"text": "xin chào thế giới", "auto_type": False}, timeout=10).json()
    assert r_dict["ok"] is True and r_dict["user_text"] == "Xin chào thế giới"
    print("12_DICTATION_CLEAN_OK:", r_dict["user_text"])

    st_vis = api.get(f"{BASE}/status", timeout=5).json()
    assert st_vis.get("vision_available") is True, f"Vision model missing: {st_vis}"
    print("13_LOCAL_VISION_READY_OK:", st_vis["vision_available"])

    # 11. Restore clean default (4b + 5m + 0 MB VRAM)
    api.post(f"{BASE}/set-model", json={"model": "4b"}, timeout=10).raise_for_status()
    r_fin = api.post(f"{BASE}/set-keep-alive", json={"keep_alive": "5m"}, timeout=10).json()
    assert r_fin["current_model"] == "qwen3.5:4b" and r_fin["keep_alive_setting"] == "5m"
    api.post(f"{BASE}/unload-vram", timeout=10).raise_for_status()
    print(f"ALL_BACKEND_STABILITY_TESTS_PASSED in {round(time.time() - t0, 2)}s")


if __name__ == "__main__":
    main()
