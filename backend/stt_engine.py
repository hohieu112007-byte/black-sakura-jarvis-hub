from __future__ import annotations

import gc
import importlib.util
import io
import json
import os
import re
import tempfile
import threading
import time
import wave
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple, Union

import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parent.parent
HUB_STATE_PATH = PROJECT_ROOT / "jarvis-hub" / "state.json"
VIETNOTE_HF_REPO = "Kaisye/VietNote-Zipformer-78M-Streaming"
_DEFAULT_SANDBOX = Path(
    os.environ.get("JARVIS_SANDBOX_DIR")
    or (r"C:\AI-Sandbox" if Path(r"C:\AI-Sandbox").exists() else str(PROJECT_ROOT / "sandbox"))
)
DEFAULT_VIETNOTE_DIR = Path(
    os.environ.get("VIETNOTE_ASR_DIR") or str(_DEFAULT_SANDBOX / "models" / "vietnote-asr")
)

_CUDA_DLL_HANDLES = []


def _ensure_cuda_dll_paths() -> None:
    """Register CUDA 12 DLL directories (including Ollama's bundled cuda_v12) so faster-whisper finds cublas64_12.dll."""
    candidates = [
        Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Ollama" / "lib" / "ollama" / "cuda_v12",
    ]
    cuda_base = Path(r"C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA")
    if cuda_base.exists():
        for p in sorted(cuda_base.glob("v12*/bin"), reverse=True):
            candidates.append(p)
    cur_path = os.environ.get("PATH", "")
    for d in candidates:
        try:
            if d and d.exists():
                ds = str(d)
                if ds not in cur_path:
                    os.environ["PATH"] = ds + os.pathsep + os.environ.get("PATH", "")
                    cur_path = os.environ["PATH"]
                if hasattr(os, "add_dll_directory"):
                    _CUDA_DLL_HANDLES.append(os.add_dll_directory(ds))
        except Exception:
            pass


_ensure_cuda_dll_paths()

INITIAL_VI_EN_PROMPT = (
    "OK Luna, Hey Luna, Luna sleep, ngủ đi Luna, ẩn Luna, OK Nova, Hey Nova, Hey Jarvis, sleep, ngủ đi. "
    "Mở trình duyệt, tắt trình duyệt, đóng trình duyệt, mở Edge, tắt Edge, mở Chrome, tắt Chrome, "
    "cho Discord full màn hình, cho Discord toàn màn hình, thu nhỏ Discord, phóng to cửa sổ, "
    "mở app Facebook, tắt app Facebook, mở Discord, bật mic Discord, mở mic Discord, mở âm Discord, bật âm Discord, tắt âm Discord, mở micro Discord, tắt mic Discord, bỏ tắt âm Discord, tắt tiếng Discord, "
    "chọn video, chọn video của kênh, chọn video đầu tiên, bấm vào video, mở YouTube, tìm video, "
    "tăng âm lượng, giảm âm lượng, giữ lại 1 tab, chuyển sang màn hình 2, "
    "Mở Notepad, Calculator, Zalo, CapCut, OBS, Telegram, Word, Excel, Steam, Brave, Spotify, VS Code, "
    "Google Docs, Shopee. Light mode, dark mode, party mode, xả VRAM, game mode, panic stop."
)


def normalize_vietnamese_voice_command(raw_text: str) -> str:
    """Fix common Whisper Vietnamese/mixed-English phonetic confusions on short desktop control commands."""
    clean = re.sub(r"\s+", " ", str(raw_text or "").strip())
    if not clean:
        return ""

    # Strip trailing punctuation added by Whisper unless it ends a filename/domain
    if clean.endswith(".") and not re.search(r"\.(?:com|vn|net|org|io|exe|py|docx|png|jpg)\.$", clean, re.IGNORECASE):
        clean = clean[:-1].strip()
    clean = re.sub(r"[!?,]+$", "", clean).strip()
    clean = re.sub(r"\b(?:sreach|seach|serch|sớt)\b", "search", clean, flags=re.IGNORECASE)
    # Collapse Whisper's stray mid-phrase commas in short commands (keep comma before "tìm kiếm"/"search")
    if len(clean) <= 85:
        clean = re.sub(r"\s*,\s+(?!(?:tìm(?:\s+kiếm)?|search)\b)", " ", clean, flags=re.IGNORECASE)

    # Strip optional spoken wake-word prefix when user speaks whole command in one breath (e.g. "OK Luna mở âm Discord")
    clean = re.sub(
        r"^(?:(?:ok|okay|hey|hi|hello|ê|a|chào)\s+)+(?:luna|lunar|loona|lena|nova|alpha|sora|milo|jarvis)\b[,.\s]*",
        "",
        clean,
        flags=re.IGNORECASE,
    ).strip()

    # Common phonetic errors seen in live mic captures
    clean = re.sub(
        r"\b(?:car\s*disk|disk\s*cut|đít\s*co|đít\s*cọt|dis\s*cọt|goddisk|gốt\s*dis)\b",
        "Discord",
        clean,
        flags=re.IGNORECASE,
    )
    clean = re.sub(
        r"\b(mở|bật|tắt|đóng|mic|âm|tiếng|app)\s+dis\b",
        r"\1 Discord",
        clean,
        flags=re.IGNORECASE,
    )
    clean = re.sub(
        r"^\s*ở\s+(?=(?:tab|tạp|táp|tap|youtube|facebook|google|discord|zalo|edge|chrome)\b)",
        "mở ",
        clean,
        flags=re.IGNORECASE,
    )
    clean = re.sub(
        r"\b(mở(?:\s+thêm)?(?:\s+(?:1|một))?|bật|tắt|đóng|chuyển(?:\s+sang|\s+qua)?|giữ(?:\s+lại)?)\s+(?:tạp|táp|tap)\b",
        r"\1 tab",
        clean,
        flags=re.IGNORECASE,
    )
    clean = re.sub(
        r"\b(?:bỏ|hủy)\s+(?:tắt|tắc)\s+(?:app|ăm|ăn|ấm|ầm|am|em)\s+(discord)\b",
        r"bỏ tắt âm \1",
        clean,
        flags=re.IGNORECASE,
    )
    clean = re.sub(
        r"\b(?:mờ|má|mở|mạ|bật)\s+(?:mứt|mít|mích|míc|mức|mắt(?:\s*(?:go|gô|cô))?|mét|mất|mát|mi|mí|nick|biết|ích|mic\s*rô)\s+(discord)\b",
        r"mở mic \1",
        clean,
        flags=re.IGNORECASE,
    )
    clean = re.sub(
        r"\b(?:tắt|đóng)\s+(?:mứt|mít|mích|míc|mức|mắt(?:\s*(?:go|gô|cô))?|mét|mất|mát|mi|mí|nick|ích|mic\s*rô)\s+(discord)\b",
        r"tắt mic \1",
        clean,
        flags=re.IGNORECASE,
    )
    clean = re.sub(
        r"\b(?:mờ|má|mở|mạ|bật)\s+(?:âm|app|am|ăm|ăn|ấm|ầm|em|anh|im|amta|am\s*ta|ăm\s*ta|âm\s*ta|âm\s*tắt|ăn\s*ta|an\s*ta|am\s*tắt|âm\s*tắc)\s+(discord)\b",
        r"mở âm \1",
        clean,
        flags=re.IGNORECASE,
    )
    clean = re.sub(
        r"\b(?:tắt|đóng)\s+(?:am|ăm|ăn|ấm|ầm|em|anh|im|amta|âm\s*ta)\s+(discord)\b",
        r"tắt âm \1",
        clean,
        flags=re.IGNORECASE,
    )
    clean = re.sub(
        r"^\s*(tắt|đóng)\s+app\s+(?=(?:youtube|facebook|google|gmail|shopee|tiktok)\b.*?(?:mới\s*mở|vừa\s*mở|này|đó))",
        r"\1 tab ",
        clean,
        flags=re.IGNORECASE,
    )
    clean = re.sub(
        r"\b(?:trên\s+duếc|trên\s+duyệt|trình\s+duếc|tình\s+duyệt|chình\s+duyệt|trình\s+dược)\b",
        "trình duyệt",
        clean,
        flags=re.IGNORECASE,
    )
    clean = re.sub(r"\bvi\s*đê\s*ô\b|\bvi\s+deo\b", "video", clean, flags=re.IGNORECASE)
    clean = re.sub(
        r"\b(?:full\s*man|food\s*mang|foodmang|food\s*screen|god\s*food\s*screen|good\s*food\s*screen|full\s*màn)\b",
        "full màn hình",
        clean,
        flags=re.IGNORECASE,
    )
    clean = re.sub(
        r"\b(?:pạt|bạc|pa|ba|pha)\s*(?:ti|ty)\s*(?:mode|mốt|mơ|mood)?\b|\bparty\s*(?:mốt|mơ|mood)\b",
        "party mode",
        clean,
        flags=re.IGNORECASE,
    )
    clean = re.sub(
        r"^\s*(?:tạc|tắc|tất|tác)\s+(?=(?:edge|chrome|trình\s+duyệt|app|ứng\s+dụng|facebook|discord|zalo|youtube|máy|mic)\b)",
        "tắt ",
        clean,
        flags=re.IGNORECASE,
    )
    clean = re.sub(
        r"\b(sang|qua|về|ra|lên|xuống)\s+mạng\s+(1|2|3|một|hai|ba|chính|phụ)\b",
        r"\1 màn \2",
        clean,
        flags=re.IGNORECASE,
    )
    clean = re.sub(
        r"^\s*(?:chào|gọi|car|trong)\s+(?=(?:discord|edge|chrome|facebook|zalo|youtube|steam|notepad)\b.*?(?:full|toàn\s+màn|fullscreen|màn\s+hình|thu\s+nhỏ|phóng\s+to|màn\s*[12]|sang\s+màn))",
        "cho ",
        clean,
        flags=re.IGNORECASE,
    )
    clean = re.sub(
        r"^\s*cho\s+(?=(?:video|kênh|nhóm|bài|tab)\b)",
        "chọn ",
        clean,
        flags=re.IGNORECASE,
    )
    clean = re.sub(
        r"\b(mở|bật|tắt|đóng|thoát)\s+(?:ét|ết|ếch|éc|ép)\b",
        r"\1 Edge",
        clean,
        flags=re.IGNORECASE,
    )
    clean = re.sub(
        r"^(?:hey\s+|ok\s+|hi\s+)?(?:jarvis|gia\s*vít|cha\s*vít|da\s*vít|ra\s*vít|xà\s*vít|giá\s*vít)\s+(?:xờ\s*líp|sờ\s*líp|slíp|slip|líp|xíp|xờ\s*lít|sờ\s*lít|sờ\s*lip|sleep)$",
        "jarvis sleep",
        clean,
        flags=re.IGNORECASE,
    )
    clean = re.sub(
        r"^(?:xờ\s*líp|sờ\s*líp|slíp|slip|sờ\s*lít|xờ\s*lít|sờ\s*lip)$",
        "sleep",
        clean,
        flags=re.IGNORECASE,
    )
    return re.sub(r"\s+", " ", clean).strip()


def build_dynamic_initial_prompt(extra_terms: Optional[List[str]] = None) -> str:
    merged: List[str] = []
    seen = set()
    candidates: List[str] = list(extra_terms or [])

    if HUB_STATE_PATH.exists():
        try:
            st = json.loads(HUB_STATE_PATH.read_text(encoding="utf-8"))
            for k in ("customDictionary", "installedApps"):
                vals = st.get(k)
                if isinstance(vals, list):
                    candidates.extend(str(v).strip() for v in vals if str(v).strip())
        except Exception:
            pass

    for term in candidates:
        low = term.lower()
        if low and low not in seen and low not in INITIAL_VI_EN_PROMPT.lower():
            seen.add(low)
            merged.append(term)
        if len(merged) >= 24:
            break

    if not merged:
        return INITIAL_VI_EN_PROMPT
    return f"{INITIAL_VI_EN_PROMPT} {', '.join(merged)}."

KEEP_ALIVE_SECONDS = {
    "0s": 0,
    "1m": 60,
    "2m": 120,
    "5m": 300,
    "15m": 900,
    "always": -1,
}


def normalize_keep_alive_key(value: Optional[str]) -> str:
    raw = str(value or "5m").strip().lower()
    if raw in ("0", "0s", "off", "immediate"):
        return "0s"
    if raw in ("1m", "60", "60s", "1p", "1phut", "1 phút"):
        return "1m"
    if raw in ("2m", "120", "120s"):
        return "2m"
    if raw in ("5m", "300", "300s"):
        return "5m"
    if raw in ("15m", "900", "900s"):
        return "15m"
    if raw in ("always", "-1", "forever", "pin"):
        return "always"
    return "5m"


def _wav_bytes_to_float32_16k(wav_bytes: bytes) -> np.ndarray:
    with wave.open(io.BytesIO(wav_bytes), "rb") as wf:
        channels = wf.getnchannels()
        sampwidth = wf.getsampwidth()
        framerate = wf.getframerate()
        frames = wf.readframes(wf.getnframes())

    if sampwidth == 2:
        audio = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    elif sampwidth == 4:
        audio = np.frombuffer(frames, dtype=np.int32).astype(np.float32) / 2147483648.0
    else:
        audio = np.frombuffer(frames, dtype=np.uint8).astype(np.float32)
        audio = (audio - 128.0) / 128.0

    if channels > 1:
        audio = audio.reshape(-1, channels).mean(axis=1)

    if framerate != 16000 and len(audio) > 0:
        duration = len(audio) / float(framerate)
        target_len = max(1, int(round(duration * 16000)))
        src_x = np.linspace(0.0, 1.0, num=len(audio), endpoint=False)
        dst_x = np.linspace(0.0, 1.0, num=target_len, endpoint=False)
        audio = np.interp(dst_x, src_x, audio).astype(np.float32)

    # Gentle gain boost for quiet laptop mic clips so word-initial consonants remain crisp
    if len(audio) > 0:
        peak = float(np.max(np.abs(audio)))
        if 0.004 < peak < 0.22:
            gain = min(4.5, 0.35 / peak)
            audio = np.clip(audio * gain, -1.0, 1.0).astype(np.float32)

    return audio


class VietNoteASREngine:
    """Zero-VRAM CPU streaming/offline Vietnamese+English Zipformer ASR powered by sherpa-onnx."""

    CORE_ENGLISH_HOTWORDS: tuple[str, ...] = (
        "Discord",
        "Facebook",
        "YouTube",
        "Google",
        "Spotify",
        "Microsoft Edge",
        "Chrome",
        "Brave",
        "Firefox",
        "Steam",
        "CapCut",
        "Obsidian",
        "Telegram",
        "VS Code",
        "Notepad",
        "Calculator",
        "Zalo",
        "Shopee",
        "TikTok",
        "GitHub",
        "Gmail",
        "party mode",
        "light mode",
        "dark mode",
        "game mode",
        "panic stop",
        "full screen",
        "fullscreen",
        "OK Luna",
        "Hey Luna",
        "OK Nova",
        "Hey Jarvis",
        "sleep now",
        "Antigravity",
        "OmniParser",
        "Whisper",
    )

    def __init__(self, model_dir: Optional[Path] = None) -> None:
        self.model_dir = Path(model_dir or DEFAULT_VIETNOTE_DIR)
        self.extra_terms: List[str] = []
        self._recognizer = None
        self._hotwords_sig: str = ""
        self._hotwords_file: Optional[Path] = None
        self._hotwords_count: int = 0
        self._lock = threading.RLock()

    @staticmethod
    def is_package_installed() -> bool:
        return importlib.util.find_spec("sherpa_onnx") is not None

    def find_model_files(self) -> Dict[str, Optional[Path]]:
        out: Dict[str, Optional[Path]] = {
            "encoder": None,
            "decoder": None,
            "joiner": None,
            "tokens": None,
            "bpe_model": None,
        }
        if not self.model_dir.exists():
            return out
        files = [p for p in self.model_dir.rglob("*") if p.is_file()]
        toks = [p for p in files if p.name.lower().endswith("tokens.txt")]
        if not toks:
            toks = [p for p in files if "tokens" in p.name.lower() and p.suffix.lower() == ".txt"]
        if toks:
            out["tokens"] = sorted(toks, key=lambda p: len(str(p)))[0]

        bpes = [p for p in files if p.suffix.lower() == ".model"]
        if bpes:
            out["bpe_model"] = sorted(bpes, key=lambda p: ("bpe" not in p.name.lower(), len(str(p))))[0]

        for role in ("encoder", "decoder", "joiner"):
            cands = [p for p in files if p.suffix.lower() == ".onnx" and role in p.name.lower() and "punct" not in str(p).lower()]
            if cands:
                # Prefer quantized int8 ONNX for fastest CPU inference and lowest RAM
                cands.sort(key=lambda p: ("int8" not in p.name.lower(), len(str(p))))
                out[role] = cands[0]
        return out

    def is_model_ready(self) -> bool:
        files = self.find_model_files()
        return all(files[k] is not None for k in ("encoder", "decoder", "joiner", "tokens"))

    def is_ready(self) -> bool:
        return self.is_package_installed() and self.is_model_ready()

    def build_hotwords_list(self, extra_terms: Optional[List[str]] = None) -> List[str]:
        """Curate selective English app/command hotwords (skips short 1-3 char ambiguous words to prevent false hits)."""
        raw_candidates: List[str] = list(self.CORE_ENGLISH_HOTWORDS)
        raw_candidates.extend(extra_terms or self.extra_terms)
        if HUB_STATE_PATH.exists():
            try:
                st = json.loads(HUB_STATE_PATH.read_text(encoding="utf-8"))
                for key in ("customDictionary", "installedApps"):
                    vals = st.get(key)
                    if isinstance(vals, list):
                        raw_candidates.extend(str(v).strip() for v in vals if str(v).strip())
            except Exception:
                pass

        seen = set()
        cleaned: List[str] = []
        for item in raw_candidates:
            phrase = re.sub(r"[\r\n]+", " ", str(item or "")).strip()
            # Skip too-short single ASCII tokens (<4 chars like "ok", "app", "tab") unless part of multi-word phrase
            if not phrase or len(phrase) > 36:
                continue
            if " " not in phrase and len(phrase) < 4 and phrase.isascii():
                continue
            low = phrase.lower()
            if low in seen:
                continue
            seen.add(low)
            cleaned.append(phrase)
            if len(cleaned) >= 80:
                break
        return cleaned

    def _write_hotwords_file(self, words: List[str]) -> Optional[Path]:
        if not words:
            return None
        target_dir = self.model_dir if self.model_dir.exists() else Path(tempfile.gettempdir())
        target_dir.mkdir(parents=True, exist_ok=True)
        hw_path = target_dir / "jarvis_hotwords.txt"
        hw_path.write_text("\n".join(words) + "\n", encoding="utf-8")
        return hw_path

    def _ensure_loaded_locked(self, extra_terms: Optional[List[str]] = None) -> None:
        files = self.find_model_files()
        if not all(files[k] is not None for k in ("encoder", "decoder", "joiner", "tokens")):
            raise FileNotFoundError(
                f"Chưa tải model {VIETNOTE_HF_REPO} vào {self.model_dir}"
            )
        hotwords = self.build_hotwords_list(extra_terms)
        sig = "|".join(hotwords)
        if self._recognizer is not None and sig == self._hotwords_sig:
            return

        import sherpa_onnx  # type: ignore

        cpu_threads = max(2, min(6, (os.cpu_count() or 4) // 2))
        base_kwargs: Dict[str, Any] = {
            "tokens": str(files["tokens"]),
            "encoder": str(files["encoder"]),
            "decoder": str(files["decoder"]),
            "joiner": str(files["joiner"]),
            "num_threads": cpu_threads,
            "sample_rate": 16000,
            "feature_dim": 80,
            "provider": "cpu",
        }

        recognizer = None
        if hotwords and files.get("bpe_model") is not None:
            hw_file = self._write_hotwords_file(hotwords)
            self._hotwords_file = hw_file
            try:
                recognizer = sherpa_onnx.OnlineRecognizer.from_transducer(
                    **base_kwargs,
                    decoding_method="modified_beam_search",
                    max_active_paths=4,
                    hotwords_file=str(hw_file),
                    hotwords_score=1.6,
                    modeling_unit="bpe",
                    bpe_vocab=str(files["bpe_model"]),
                )
            except Exception:
                recognizer = None

        if recognizer is None:
            recognizer = sherpa_onnx.OnlineRecognizer.from_transducer(
                **base_kwargs,
                decoding_method="greedy_search",
            )
            self._hotwords_count = 0
        else:
            self._hotwords_count = len(hotwords)

        self._recognizer = recognizer
        self._hotwords_sig = sig

    def unload(self) -> None:
        with self._lock:
            self._recognizer = None
            self._hotwords_sig = ""

    def transcribe_pcm16k(
        self,
        samples: np.ndarray,
        normalize_cmd: bool = True,
        extra_terms: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        with self._lock:
            self._ensure_loaded_locked(extra_terms=extra_terms)
            assert self._recognizer is not None
            stream = self._recognizer.create_stream()
            # Append 0.45s silence tail so transducer finalizes trailing Vietnamese syllables cleanly
            padded = np.concatenate([np.asarray(samples, dtype=np.float32), np.zeros(int(16000 * 0.45), dtype=np.float32)])
            stream.accept_waveform(16000, padded)
            stream.input_finished()
            while self._recognizer.is_ready(stream):
                self._recognizer.decode_stream(stream)
            raw_res = self._recognizer.get_result(stream)
            raw_text = str(getattr(raw_res, "text", raw_res) or "").strip()

        clean_text = normalize_vietnamese_voice_command(raw_text) if normalize_cmd else re.sub(r"\s+", " ", raw_text).strip()
        return {
            "text": clean_text,
            "raw_text": raw_text,
            "language": "vi",
            "device": "cpu",
            "engine": "vietnote",
            "hotwords_count": self._hotwords_count,
            "vram_loaded": False,
        }


def download_vietnote_asr_model(target_dir: Optional[Path] = None) -> Dict[str, Any]:
    """Download Kaisye/VietNote-Zipformer-78M-Streaming ONNX/tokens/bpe files via huggingface_hub."""
    from huggingface_hub import HfApi, hf_hub_download  # type: ignore

    out_dir = Path(target_dir or DEFAULT_VIETNOTE_DIR)
    out_dir.mkdir(parents=True, exist_ok=True)
    api = HfApi()
    repo_files = list(api.list_repo_files(VIETNOTE_HF_REPO))

    picked: List[str] = []
    tok = next((f for f in repo_files if f.lower().endswith("tokens.txt")), None)
    if tok:
        picked.append(tok)
    bpe = next((f for f in repo_files if f.lower().endswith(".model")), None)
    if bpe:
        picked.append(bpe)
    for role in ("encoder", "decoder", "joiner"):
        cands = [f for f in repo_files if f.lower().endswith(".onnx") and role in f.lower() and "punct" not in f.lower()]
        if cands:
            cands.sort(key=lambda f: ("int8" not in f.lower(), len(f)))
            picked.append(cands[0])

    downloaded: List[str] = []
    for rel in dict.fromkeys(picked):
        local_p = hf_hub_download(repo_id=VIETNOTE_HF_REPO, filename=rel, local_dir=str(out_dir))
        downloaded.append(str(local_p))

    engine = VietNoteASREngine(out_dir)
    return {
        "ok": engine.is_model_ready(),
        "repo": VIETNOTE_HF_REPO,
        "model_dir": str(out_dir),
        "files": downloaded,
    }


def normalize_stt_engine_mode(mode: Optional[str]) -> str:
    m = str(mode or "hybrid").strip().lower()
    if m in ("vietnote", "zipformer", "sherpa"):
        return "vietnote"
    if m in ("whisper", "faster-whisper", "faster_whisper"):
        return "whisper"
    return "hybrid"


class STTEngine:
    """Hybrid Dual-STT engine combining VietNote-ASR (0 MB VRAM CPU Zipformer + Hotwords) & Faster-Whisper."""

    def __init__(
        self,
        model_size: str = "turbo",
        keep_alive: str = "5m",
        is_gaming_fn: Optional[Callable[[], bool]] = None,
        engine_mode: str = "hybrid",
    ) -> None:
        self.model_size = model_size
        self.keep_alive = normalize_keep_alive_key(keep_alive)
        self.is_gaming_fn = is_gaming_fn
        self.engine_mode = normalize_stt_engine_mode(engine_mode)
        self.extra_terms: List[str] = []
        self.vietnote = VietNoteASREngine()
        self.last_engine_used: str = "whisper"

        self.model = None
        self.active_device: Optional[str] = None
        self.active_compute_type: Optional[str] = None
        self._lock = threading.RLock()
        self._unload_timer: Optional[threading.Timer] = None
        self._unload_deadline: Optional[float] = None

    def set_engine_mode(self, mode: str) -> str:
        normalized = normalize_stt_engine_mode(mode)
        with self._lock:
            self.engine_mode = normalized
            if normalized == "vietnote" and self.model is not None:
                self.unload_vram()
        return normalized

    def get_status(self) -> Dict[str, Any]:
        return {
            "stt_engine_mode": self.engine_mode,
            "stt_active_engine": self.last_engine_used,
            "stt_loaded": self.is_loaded(),
            "stt_device": self.active_device,
            "vietnote_pkg_installed": self.vietnote.is_package_installed(),
            "vietnote_model_ready": self.vietnote.is_model_ready(),
            "vietnote_ready": self.vietnote.is_ready(),
            "vietnote_model_dir": str(self.vietnote.model_dir),
            "vietnote_hotwords_count": len(self.vietnote.build_hotwords_list(self.extra_terms)),
        }

    def is_loaded(self) -> bool:
        with self._lock:
            return self.model is not None

    def get_expires_in_sec(self) -> Optional[int]:
        with self._lock:
            if self.model is None or self._unload_deadline is None:
                return None
            return max(0, int(round(self._unload_deadline - time.monotonic())))

    def set_keep_alive(self, setting: str) -> str:
        normalized = normalize_keep_alive_key(setting)
        with self._lock:
            self.keep_alive = normalized
            if normalized == "0s":
                self.unload_vram()
            elif self.model is not None:
                self._schedule_unload_locked()
        return normalized

    def _cancel_timer_locked(self) -> None:
        if self._unload_timer is not None:
            try:
                self._unload_timer.cancel()
            except Exception:
                pass
            self._unload_timer = None
        self._unload_deadline = None

    def _schedule_unload_locked(self) -> None:
        self._cancel_timer_locked()
        ttl = KEEP_ALIVE_SECONDS.get(self.keep_alive, 300)
        if ttl == 0:
            self.unload_vram()
            return
        if ttl > 0:
            self._unload_deadline = time.monotonic() + float(ttl)
            timer = threading.Timer(float(ttl), self.unload_vram)
            timer.daemon = True
            timer.start()
            self._unload_timer = timer

    def _ensure_loaded_locked(self) -> None:
        if self.model is not None:
            return
        from faster_whisper import WhisperModel

        target_size = "tiny" if (self.is_gaming_fn and self.is_gaming_fn()) else self.model_size
        candidates = [target_size] if target_size == "tiny" else [target_size, "small"]
        last_err: Optional[Exception] = None
        for cand in candidates:
            try:
                self.model = WhisperModel(cand, device="cuda", compute_type="int8_float16")
                self.active_device = "cuda"
                self.active_compute_type = "int8_float16"
                return
            except Exception as exc:
                last_err = exc
                try:
                    self.model = WhisperModel(cand, device="cpu", compute_type="int8")
                    self.active_device = "cpu"
                    self.active_compute_type = "int8"
                    return
                except Exception as exc2:
                    last_err = exc2
        if last_err is not None:
            raise last_err

    def unload_vram(self) -> dict:
        with self._lock:
            self._cancel_timer_locked()
            was_loaded = self.model is not None
            if self.model is not None:
                try:
                    del self.model
                except Exception:
                    pass
                self.model = None
            self.active_device = None
            self.active_compute_type = None

        gc.collect()
        try:
            import torch  # type: ignore

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
                torch.cuda.ipc_collect()
        except Exception:
            pass
        return {"unloaded": was_loaded, "vram_loaded": False}

    def _should_use_vietnote(
        self,
        mode: str = "command",
        is_gaming: bool = False,
        prefer_cpu_only: bool = False,
        ui_language: str = "vi",
    ) -> bool:
        if not self.vietnote.is_ready():
            return False
        if self.engine_mode == "vietnote":
            return True
        if self.engine_mode == "whisper":
            return False
        # Hybrid strategy:
        # - Streaming/chunk dictation (Vietnamese) or GPU-constrained states (gaming / external AI / CPU-only) -> VietNote (0 MB VRAM)
        # - English UI voice commands -> Faster-Whisper (multilingual) unless GPU is constrained
        if is_gaming or prefer_cpu_only or mode == "dictation":
            return True
        if str(ui_language or "vi").strip().lower() == "en":
            return False
        return True

    def transcribe(
        self,
        audio_input: Union[str, os.PathLike, bytes, np.ndarray],
        is_gaming: Optional[bool] = None,
        mode: str = "command",
        prefer_cpu_only: bool = False,
        ui_language: str = "vi",
    ) -> dict:
        gaming_now = bool(is_gaming) if is_gaming is not None else bool(self.is_gaming_fn and self.is_gaming_fn())
        audio_arg: Union[str, np.ndarray]
        pcm_for_vietnote: Optional[np.ndarray] = None
        if isinstance(audio_input, (bytes, bytearray)):
            try:
                audio_arg = _wav_bytes_to_float32_16k(bytes(audio_input))
                pcm_for_vietnote = audio_arg
            except Exception as exc:
                return {"text": "", "language": "vi", "device": self.active_device or "none", "vram_loaded": self.is_loaded(), "error": f"Âm thanh WAV không hợp lệ ({exc})"}
            if len(audio_arg) < 400:
                return {"text": "", "language": "vi", "device": self.active_device or "none", "vram_loaded": self.is_loaded()}
        elif isinstance(audio_input, os.PathLike):
            audio_arg = str(audio_input)
            try:
                pcm_for_vietnote = _wav_bytes_to_float32_16k(Path(audio_input).read_bytes())
            except Exception:
                pcm_for_vietnote = None
        else:
            audio_arg = audio_input
            if isinstance(audio_input, np.ndarray):
                pcm_for_vietnote = audio_input

        if pcm_for_vietnote is not None and self._should_use_vietnote(
            mode=mode,
            is_gaming=gaming_now,
            prefer_cpu_only=prefer_cpu_only,
            ui_language=ui_language,
        ):
            try:
                vn_res = self.vietnote.transcribe_pcm16k(
                    pcm_for_vietnote,
                    normalize_cmd=(mode != "dictation"),
                    extra_terms=self.extra_terms,
                )
                if vn_res.get("text"):
                    self.last_engine_used = "vietnote"
                    return vn_res
                # In hybrid mode, if VietNote returned empty text on active speech, let Whisper take a second pass unless GPU is locked
                if self.engine_mode == "vietnote":
                    self.last_engine_used = "vietnote"
                    return vn_res
            except Exception:
                if self.engine_mode == "vietnote":
                    pass  # Fall through cleanly to Faster-Whisper fallback

        with self._lock:
            self._cancel_timer_locked()
            self._ensure_loaded_locked()
            assert self.model is not None
            trans_kwargs = {
                "language": "en" if str(ui_language or "vi").strip().lower() == "en" and mode != "dictation" else "vi",
                "beam_size": 5,
                "condition_on_previous_text": False,
                "vad_filter": True,
                "vad_parameters": {"threshold": 0.30, "min_silence_duration_ms": 750, "speech_pad_ms": 400},
                "initial_prompt": build_dynamic_initial_prompt(self.extra_terms),
            }
            try:
                segments, info = self.model.transcribe(audio_arg, **trans_kwargs)
                text_parts = []
                for seg in segments:
                    st = getattr(seg, "text", "").strip()
                    if not st:
                        continue
                    low_st = st.lower()
                    no_sp = getattr(seg, "no_speech_prob", 0.0)
                    avg_lp = getattr(seg, "avg_logprob", 0.0)
                    # Drop classic Whisper silence/noise hallucinations (e.g. YouTube outtros on steady hums)
                    if no_sp > 0.65 and len(st) < 55:
                        continue
                    if any(h in low_st for h in ("lalaschool", "la la school", "ghiền mì gõ", "theo dõi và hẹn gặp lại")):
                        continue
                    if (no_sp > 0.15 or avg_lp < -0.45) and any(
                        h in low_st for h in ("subscribe cho kênh", "hãy subscribe", "đăng ký kênh để")
                    ):
                        continue
                    text_parts.append(st)
            except Exception as exc:
                if self.active_device == "cuda":
                    # Recover seamlessly on CPU with 'small' first (much faster on CPU than large-v3-turbo)
                    self.unload_vram()
                    from faster_whisper import WhisperModel
                    cpu_cands = ["tiny"] if gaming_now else ["small", "tiny"]
                    for cand in cpu_cands:
                        try:
                            self.model = WhisperModel(cand, device="cpu", compute_type="int8")
                            break
                        except Exception:
                            self.model = None
                    if self.model is None:
                        return {"text": "", "language": "vi", "device": "none", "vram_loaded": False, "error": f"Lỗi nhận dạng giọng nói: {exc}"}
                    self.active_device = "cpu"
                    self.active_compute_type = "int8"
                    segments, info = self.model.transcribe(audio_arg, **trans_kwargs)
                    text_parts = [seg.text.strip() for seg in segments if getattr(seg, "text", "").strip()]
                else:
                    return {"text": "", "language": "vi", "device": self.active_device or "none", "vram_loaded": self.is_loaded(), "error": f"Lỗi nhận dạng giọng nói: {exc}"}
            joined_raw = " ".join(text_parts).strip()
            text = re.sub(r"\s+", " ", joined_raw).strip() if mode == "dictation" else normalize_vietnamese_voice_command(joined_raw)
            device_used = self.active_device

            if gaming_now or self.keep_alive == "0s":
                self.unload_vram()
                still_loaded = False
            else:
                self._schedule_unload_locked()
                still_loaded = True

        self.last_engine_used = "whisper"
        return {
            "text": text,
            "language": getattr(info, "language", "vi"),
            "device": device_used,
            "engine": "whisper",
            "vram_loaded": still_loaded,
        }


def pre_download_whisper_models(sizes: tuple[str, ...] = ("small", "tiny")) -> dict:
    from faster_whisper import download_model

    results = {}
    for sz in sizes:
        local_dir = download_model(sz)
        results[sz] = str(local_dir)
    return results
