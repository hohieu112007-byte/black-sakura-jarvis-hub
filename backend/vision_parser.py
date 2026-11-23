"""Lazy-loaded OmniParser V2 (Set-of-Mark icon/button detector) with strict VRAM lifecycle."""
from __future__ import annotations

import base64
import gc
import importlib.util
import io
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from PIL import Image, ImageDraw, ImageFont

from .context_engine import SANDBOX_ROOT

OMNIPARSER_CACHE_DIR = SANDBOX_ROOT / "models" / "omniparser-v2"


def _check_omniparser_deps() -> List[str]:
    missing: List[str] = []
    for pkg in ("torch", "ultralytics"):
        if importlib.util.find_spec(pkg) is None:
            missing.append(pkg)
    return missing


class OmniParserEngine:
    """Optional lazy-loaded OmniParser V2 Set-of-Mark detector for accurate icon/button clicks."""

    def __init__(self, enabled: bool = False) -> None:
        self.enabled = bool(enabled)
        self._lock = threading.RLock()
        self._yolo_model: Any = None
        self._device: Optional[str] = None
        self._last_error: str = ""

    def set_enabled(self, enabled: bool) -> bool:
        with self._lock:
            self.enabled = bool(enabled)
            if not self.enabled:
                self.unload_vram()
            return self.enabled

    def is_loaded(self) -> bool:
        with self._lock:
            return self._yolo_model is not None

    def is_available(self) -> bool:
        return len(_check_omniparser_deps()) == 0

    def get_vram_gb(self) -> float:
        with self._lock:
            if self._yolo_model is not None and self._device == "cuda":
                return 1.6
            return 0.0

    def get_status(self) -> Dict[str, Any]:
        missing = _check_omniparser_deps()
        weights_cached = (OMNIPARSER_CACHE_DIR / "icon_detect" / "model.pt").is_file()
        return {
            "enabled": self.enabled,
            "available": len(missing) == 0,
            "loaded": self.is_loaded(),
            "device": self._device or "none",
            "vram_gb": self.get_vram_gb(),
            "missing_deps": missing,
            "weights_cached": weights_cached,
            "last_error": self._last_error,
        }

    def unload_vram(self) -> Dict[str, Any]:
        with self._lock:
            was_loaded = self._yolo_model is not None
            if self._yolo_model is not None:
                try:
                    del self._yolo_model
                except Exception:
                    pass
                self._yolo_model = None
            self._device = None
        gc.collect()
        try:
            import torch  # type: ignore

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
                torch.cuda.ipc_collect()
        except Exception:
            pass
        return {"unloaded": was_loaded, "vram_loaded": False}

    def _ensure_loaded_locked(self) -> bool:
        if self._yolo_model is not None:
            return True
        missing = _check_omniparser_deps()
        if missing:
            self._last_error = f"Chưa cài gói Python: {', '.join(missing)}"
            return False
        try:
            import torch  # type: ignore
            from huggingface_hub import hf_hub_download  # type: ignore
            from ultralytics import YOLO  # type: ignore

            OMNIPARSER_CACHE_DIR.mkdir(parents=True, exist_ok=True)
            weight_path = OMNIPARSER_CACHE_DIR / "icon_detect" / "model.pt"
            if not weight_path.is_file():
                downloaded = hf_hub_download(
                    repo_id="microsoft/OmniParser-v2.0",
                    filename="icon_detect/model.pt",
                    local_dir=str(OMNIPARSER_CACHE_DIR),
                )
                weight_path = Path(downloaded)

            model = YOLO(str(weight_path))
            device = "cuda" if torch.cuda.is_available() else "cpu"
            model.to(device)
            self._yolo_model = model
            self._device = device
            self._last_error = ""
            return True
        except Exception as exc:
            self._last_error = str(exc)[:220]
            self._yolo_model = None
            self._device = None
            return False

    def parse_screenshot(
        self,
        raw_b64: str,
        *,
        max_edge: int = 1280,
        conf_threshold: float = 0.08,
        max_boxes: int = 60,
    ) -> Dict[str, Any]:
        """Detect UI elements and draw numbered Set-of-Mark boxes for Vision LLM box_id selection."""
        if not self.enabled:
            return {"ok": False, "fallback": True, "reason": "OmniParser đang tắt."}
        if not self.is_available():
            missing = _check_omniparser_deps()
            return {
                "ok": False,
                "fallback": True,
                "reason": f"Chưa cài đặt thư viện OmniParser ({', '.join(missing)}).",
            }

        with self._lock:
            if not self._ensure_loaded_locked():
                return {"ok": False, "fallback": True, "reason": self._last_error or "Không nạp được OmniParser."}
            assert self._yolo_model is not None

            raw_bytes = base64.b64decode(raw_b64)
            with Image.open(io.BytesIO(raw_bytes)) as im:
                im = im.convert("RGB")
                w, h = im.size
                if max(w, h) > max_edge:
                    scale = max_edge / float(max(w, h))
                    nw = max(1, int(round(w * scale)))
                    nh = max(1, int(round(h * scale)))
                    im = im.resize((nw, nh), Image.Resampling.LANCZOS)
                else:
                    nw, nh = w, h

                results = self._yolo_model.predict(
                    source=im,
                    conf=conf_threshold,
                    iou=0.45,
                    verbose=False,
                )
                raw_boxes: List[Tuple[float, float, float, float, float]] = []
                if results:
                    r0 = results[0]
                    boxes_obj = getattr(r0, "boxes", None)
                    if boxes_obj is not None and getattr(boxes_obj, "xyxy", None) is not None:
                        xyxy_list = boxes_obj.xyxy.tolist()
                        conf_list = boxes_obj.conf.tolist() if getattr(boxes_obj, "conf", None) is not None else [0.5] * len(xyxy_list)
                        for coords, conf in zip(xyxy_list, conf_list):
                            x1, y1, x2, y2 = [float(v) for v in coords[:4]]
                            if (x2 - x1) >= 6 and (y2 - y1) >= 6:
                                raw_boxes.append((x1, y1, x2, y2, float(conf)))

                # Sort top-to-bottom, left-to-right for stable Set-of-Mark IDs
                raw_boxes.sort(key=lambda b: (round(b[1] / 24.0), b[0]))
                raw_boxes = raw_boxes[:max_boxes]
                if not raw_boxes:
                    return {"ok": False, "fallback": True, "reason": "OmniParser không phát hiện phần tử nào."}

                annotated = im.copy()
                draw = ImageDraw.Draw(annotated)
                font = ImageFont.load_default()
                palette = [
                    (220, 38, 38),
                    (37, 99, 235),
                    (22, 163, 74),
                    (147, 51, 234),
                    (234, 88, 12),
                ]
                som_boxes: List[Dict[str, Any]] = []
                for idx, (x1, y1, x2, y2, conf) in enumerate(raw_boxes, start=1):
                    col = palette[(idx - 1) % len(palette)]
                    draw.rectangle([x1, y1, x2, y2], outline=col, width=2)
                    tag = str(idx)
                    tw = max(14, len(tag) * 7 + 6)
                    th = 13
                    lx = max(0, min(nw - tw, int(x1)))
                    ly = max(0, int(y1) - th if y1 >= th else int(y1))
                    draw.rectangle([lx, ly, lx + tw, ly + th], fill=col)
                    draw.text((lx + 3, ly + 1), tag, fill=(255, 255, 255), font=font)

                    cx = (x1 + x2) / 2.0
                    cy = (y1 + y2) / 2.0
                    som_boxes.append({
                        "id": idx,
                        "cx_norm": round(cx / float(nw), 4),
                        "cy_norm": round(cy / float(nh), 4),
                        "bbox_norm": [
                            round(x1 / float(nw), 4),
                            round(y1 / float(nh), 4),
                            round(x2 / float(nw), 4),
                            round(y2 / float(nh), 4),
                        ],
                        "conf": round(conf, 3),
                    })

                out_buf = io.BytesIO()
                annotated.save(out_buf, format="PNG", optimize=True)
                out_b64 = base64.b64encode(out_buf.getvalue()).decode("ascii")
                return {
                    "ok": True,
                    "image_b64": out_b64,
                    "width": nw,
                    "height": nh,
                    "boxes": som_boxes,
                    "device": self._device or "cpu",
                }
