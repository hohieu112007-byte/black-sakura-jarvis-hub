from __future__ import annotations

import asyncio
import base64
import subprocess
import tempfile
from pathlib import Path
from typing import Dict

DEFAULT_VI_VOICE = "vi-VN-HoaiMyNeural"


async def _edge_tts_mp3_bytes(text: str, voice: str) -> bytes:
    import edge_tts

    communicate = edge_tts.Communicate(text=text, voice=voice)
    chunks = []
    async for msg in communicate.stream():
        if msg.get("type") == "audio" and msg.get("data"):
            chunks.append(msg["data"])
    return b"".join(chunks)


def _windows_sapi_wav_bytes(text: str) -> bytes:
    import os

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tf:
        wav_path = Path(tf.name)
    try:
        # Pass user/page text strictly via environment variables (never string interpolation)
        # to prevent PowerShell 5.1 quote/smart-quote injection.
        ps_cmd = (
            "Add-Type -AssemblyName System.Speech; "
            "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
            "$s.SetOutputToWaveFile($env:JARVIS_TTS_WAV); "
            "$s.Speak($env:JARVIS_TTS_TEXT); "
            "$s.Dispose()"
        )
        env = dict(os.environ)
        env["JARVIS_TTS_WAV"] = str(wav_path)
        env["JARVIS_TTS_TEXT"] = str(text)
        subprocess.run(
            ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps_cmd],
            env=env,
            timeout=15,
            check=True,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        return wav_path.read_bytes()
    finally:
        try:
            wav_path.unlink(missing_ok=True)
        except Exception:
            pass


def synthesize_local_speech(text: str, voice: str = DEFAULT_VI_VOICE) -> Dict[str, str]:
    """Synthesize Vietnamese speech with 0 MB VRAM (edge-tts neural primary, Windows SAPI offline fallback)."""
    clean = str(text or "").strip()
    if not clean:
        return {"ok": False, "error": "Empty text"}
    clipped = clean[:1200]

    try:
        mp3_bytes = asyncio.run(_edge_tts_mp3_bytes(clipped, voice=voice or DEFAULT_VI_VOICE))
        if mp3_bytes:
            return {
                "ok": True,
                "audio_base64": base64.b64encode(mp3_bytes).decode("ascii"),
                "mime_type": "audio/mpeg",
                "engine": "edge-tts",
            }
    except Exception:
        pass

    try:
        wav_bytes = _windows_sapi_wav_bytes(clipped)
        if wav_bytes:
            return {
                "ok": True,
                "audio_base64": base64.b64encode(wav_bytes).decode("ascii"),
                "mime_type": "audio/wav",
                "engine": "windows-sapi",
            }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}

    return {"ok": False, "error": "TTS synthesis produced empty audio"}
