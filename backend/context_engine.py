from __future__ import annotations

import base64
import csv
import io
import os
import re
import time
import unicodedata
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests

def get_sandbox_root() -> Path:
    env_dir = os.environ.get("JARVIS_SANDBOX_DIR", "").strip()
    if env_dir:
        return Path(env_dir).expanduser().resolve()
    legacy = Path(r"C:\AI-Sandbox")
    if legacy.exists():
        return legacy.resolve()
    return (Path(__file__).resolve().parent.parent / "sandbox").resolve()


SANDBOX_ROOT = get_sandbox_root()
EXPORTS_DIR = SANDBOX_ROOT / "exports"
CONTEXT_CACHE_DIR = SANDBOX_ROOT / "context_cache"

SENSITIVE_FILE_NAMES = {
    ".env", ".env.local", ".env.production", ".session_token",
    "id_rsa", "id_ed25519", "id_ecdsa", "credentials", "ntuser.dat", "sam", "system",
    "cookies", "login data", "web data", "local state",
}
SENSITIVE_FILE_EXTS = {".pem", ".key", ".p12", ".pfx", ".jks", ".kdbx", ".keystore"}
SENSITIVE_PATH_PARTS = (
    "\\.ssh\\", "/.ssh/",
    "\\.aws\\", "/.aws/",
    "\\.gnupg\\", "/.gnupg/",
    "\\windows\\system32\\", "\\windows\\syswow64\\",
    "\\microsoft\\edge\\user data\\", "\\google\\chrome\\user data\\",
    "\\appdata\\roaming\\mozilla\\firefox\\profiles\\",
)


def is_sensitive_file_path(file_path: Path) -> Optional[str]:
    try:
        resolved = file_path.resolve()
    except Exception:
        resolved = file_path
    name_low = resolved.name.lower()
    if name_low in SENSITIVE_FILE_NAMES or name_low.startswith(".env."):
        return f"Security policy blocked reading sensitive file '{resolved.name}'."
    if resolved.suffix.lower() in SENSITIVE_FILE_EXTS:
        return f"Security policy blocked reading sensitive key/certificate file '{resolved.name}'."
    full_low = str(resolved).lower()
    for part in SENSITIVE_PATH_PARTS:
        if part in full_low:
            return "Security policy blocked reading files from protected credential/system directory."
    return None

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"}
DOC_EXTS = {
    ".pdf", ".docx", ".xlsx", ".csv", ".txt", ".md", ".json", ".log",
    ".py", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".html", ".css", ".yml", ".yaml",
}
SKIP_DIRS = {
    "node_modules", ".git", "__pycache__", ".venv", "venv", "dist", "build",
    "$recycle.bin", "system volume information", "appdata",
}


def strip_accents(text: str) -> str:
    s = unicodedata.normalize("NFD", str(text or ""))
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn")
    return s.replace("đ", "d").replace("Đ", "D")


def _sanitize_filename(name: str) -> str:
    clean = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', "-", str(name or "").strip())
    clean = re.sub(r"\s+", "-", clean).strip("-.")
    return clean[:60] or "jarvis-output"


def _resolve_search_roots(folder_hint: str = "") -> List[Path]:
    home = Path.home()
    hint = strip_accents(folder_hint).lower().strip()
    one_drive = Path(os.environ.get("OneDrive", "")) if os.environ.get("OneDrive") else None

    folder_map = {
        "downloads": [home / "Downloads"],
        "tai ve": [home / "Downloads"],
        "download": [home / "Downloads"],
        "desktop": [home / "Desktop", *( [one_drive / "Desktop"] if one_drive else [] )],
        "man hinh nen": [home / "Desktop"],
        "documents": [home / "Documents", *( [one_drive / "Documents"] if one_drive else [] )],
        "tai lieu": [home / "Documents"],
        "screenshots": [home / "Pictures" / "Screenshots", *( [one_drive / "Pictures" / "Screenshots"] if one_drive else [] )],
        "anh chup": [home / "Pictures" / "Screenshots", home / "Pictures"],
        "pictures": [home / "Pictures", home / "Pictures" / "Screenshots"],
        "exports": [EXPORTS_DIR],
        "export": [EXPORTS_DIR],
    }

    for key, paths in folder_map.items():
        if key in hint:
            existing = [p for p in paths if p and p.exists()]
            if existing:
                return existing

    defaults = [
        home / "Downloads",
        home / "Desktop",
        home / "Documents",
        home / "Pictures" / "Screenshots",
        home / "Pictures",
        EXPORTS_DIR,
    ]
    return [p for p in defaults if p.exists()]


def find_local_files(
    query: str = "",
    folder_hint: str = "",
    ext_filter: str = "",
    limit: int = 8,
    max_depth: int = 3,
) -> Dict[str, Any]:
    """Fast local file search across Desktop, Downloads, Documents, Pictures, and Exports."""
    roots = _resolve_search_roots(folder_hint)
    norm_q = strip_accents(query).lower().strip()
    tokens = [t for t in re.split(r"[\s_\-.,/\\]+", norm_q) if len(t) >= 2]
    ext_set: set[str] = set()
    if ext_filter:
        for raw_e in re.split(r"[,;\s]+", ext_filter.lower().strip()):
            if raw_e == "image":
                ext_set.update(IMAGE_EXTS)
            elif raw_e == "doc":
                ext_set.update({".pdf", ".docx", ".xlsx", ".csv", ".txt", ".md"})
            elif raw_e:
                ext_set.add(raw_e if raw_e.startswith(".") else f".{raw_e}")

    hits: List[Tuple[float, float, Dict[str, Any]]] = []
    seen_paths: set[str] = set()

    def _scan(dir_path: Path, depth: int) -> None:
        if depth > max_depth or len(hits) >= 250:
            return
        try:
            with os.scandir(dir_path) as it:
                for entry in it:
                    name_low = entry.name.lower()
                    if entry.is_dir(follow_symlinks=False):
                        if name_low not in SKIP_DIRS and not name_low.startswith("."):
                            _scan(Path(entry.path), depth + 1)
                        continue
                    if not entry.is_file(follow_symlinks=False):
                        continue
                    ext = Path(entry.name).suffix.lower()
                    if ext_set and ext not in ext_set:
                        continue
                    full_key = entry.path.lower()
                    if full_key in seen_paths:
                        continue
                    seen_paths.add(full_key)

                    norm_name = strip_accents(entry.name).lower()
                    score = 0.0
                    if tokens:
                        matched = sum(1 for t in tokens if t in norm_name)
                        if matched == 0:
                            continue
                        score = matched / float(len(tokens))
                        if norm_q and norm_q in norm_name:
                            score += 1.0
                    else:
                        score = 1.0

                    try:
                        st = entry.stat(follow_symlinks=False)
                        mtime = float(st.st_mtime)
                        size_kb = round(st.st_size / 1024.0, 1)
                    except Exception:
                        mtime = 0.0
                        size_kb = 0.0

                    hits.append((
                        score,
                        mtime,
                        {
                            "path": entry.path,
                            "name": entry.name,
                            "ext": ext,
                            "kind": "image" if ext in IMAGE_EXTS else "document",
                            "folder": str(Path(entry.path).parent),
                            "size_kb": size_kb,
                            "modified_at": datetime.fromtimestamp(mtime).strftime("%Y-%m-%d %H:%M") if mtime else "",
                        },
                    ))
        except Exception:
            pass

    for root in roots:
        _scan(root, 0)

    hits.sort(key=lambda item: (item[0], item[1]), reverse=True)
    files = [item[2] for item in hits[: max(1, min(limit, 20))]]
    return {
        "ok": True,
        "count": len(files),
        "files": files,
        "roots": [str(r) for r in roots],
    }


def extract_text_from_file(file_path: str | Path, max_chars: int = 48000) -> Dict[str, Any]:
    """Read text cleanly from PDF, DOCX, XLSX, CSV, TXT, MD, or source code files."""
    p = Path(str(file_path))
    blocked_reason = is_sensitive_file_path(p)
    if blocked_reason:
        return {"ok": False, "blocked_guard": True, "error": blocked_reason}
    if not p.exists() or not p.is_file():
        return {"ok": False, "error": f"Không tìm thấy file: {p}"}

    ext = p.suffix.lower()
    if ext in IMAGE_EXTS:
        return {
            "ok": True,
            "kind": "image",
            "path": str(p),
            "name": p.name,
            "text": "",
            "page_count": 1,
            "char_count": 0,
        }

    text_parts: List[str] = []
    page_count = 1
    try:
        if ext == ".pdf":
            from pypdf import PdfReader

            reader = PdfReader(str(p))
            page_count = len(reader.pages)
            for idx, page in enumerate(reader.pages):
                pg_txt = (page.extract_text() or "").strip()
                if pg_txt:
                    text_parts.append(f"[Trang {idx + 1}]\n{pg_txt}")
                if sum(len(x) for x in text_parts) >= max_chars:
                    break
        elif ext == ".docx":
            from docx import Document

            doc = Document(str(p))
            for para in doc.paragraphs:
                t = para.text.strip()
                if t:
                    text_parts.append(t)
            for tbl in doc.tables:
                rows_md: List[str] = []
                for row in tbl.rows[:60]:
                    cells = [c.text.strip().replace("\n", " ") for c in row.cells]
                    rows_md.append(" | ".join(cells))
                if rows_md:
                    text_parts.append("\n".join(rows_md))
        elif ext == ".xlsx":
            import openpyxl

            wb = openpyxl.load_workbook(str(p), read_only=True, data_only=True)
            for sheet_name in wb.sheetnames[:4]:
                ws = wb[sheet_name]
                rows_txt: List[str] = [f"### Sheet: {sheet_name}"]
                for r_idx, row in enumerate(ws.iter_rows(values_only=True)):
                    if r_idx >= 120:
                        break
                    vals = [str(v) if v is not None else "" for v in row[:18]]
                    if any(vals):
                        rows_txt.append(" | ".join(vals))
                if len(rows_txt) > 1:
                    text_parts.append("\n".join(rows_txt))
            wb.close()
        else:
            raw = p.read_text(encoding="utf-8", errors="replace")
            text_parts.append(raw[:max_chars])
    except Exception as exc:
        return {"ok": False, "error": f"Không đọc được file {p.name}: {exc}"}

    full_text = "\n\n".join(text_parts).strip()
    truncated = len(full_text) > max_chars
    if truncated:
        full_text = full_text[:max_chars]

    return {
        "ok": True,
        "kind": "document",
        "path": str(p),
        "name": p.name,
        "ext": ext,
        "page_count": page_count,
        "char_count": len(full_text),
        "truncated": truncated,
        "text": full_text,
    }


def save_base64_image_to_cache(b64_data: str, prefix: str = "context") -> Path:
    CONTEXT_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    raw = str(b64_data or "").strip()
    if "," in raw and raw.lower().startswith("data:image"):
        raw = raw.split(",", 1)[1]
    img_bytes = base64.b64decode(raw)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")[:18]
    out_path = CONTEXT_CACHE_DIR / f"{prefix}_{stamp}.png"
    out_path.write_bytes(img_bytes)
    _prune_cache_dir(max_files=18)
    return out_path


def _prune_cache_dir(max_files: int = 18) -> None:
    if not CONTEXT_CACHE_DIR.exists():
        return
    try:
        files = sorted(
            (p for p in CONTEXT_CACHE_DIR.iterdir() if p.is_file()),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        for old in files[max_files:]:
            try:
                old.unlink()
            except Exception:
                pass
    except Exception:
        pass


def capture_clipboard_context() -> Dict[str, Any]:
    """Read an image, copied file path(s), or plain text currently in the Windows Clipboard."""
    try:
        from PIL import Image, ImageGrab

        grabbed = ImageGrab.grabclipboard()
        if isinstance(grabbed, Image.Image):
            CONTEXT_CACHE_DIR.mkdir(parents=True, exist_ok=True)
            stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            out_path = CONTEXT_CACHE_DIR / f"clipboard_{stamp}.png"
            grabbed.save(str(out_path), format="PNG")
            _prune_cache_dir()
            return {"ok": True, "kind": "image", "path": str(out_path), "name": out_path.name}
        if isinstance(grabbed, list) and grabbed:
            valid = [str(x) for x in grabbed if Path(str(x)).is_file()]
            if valid:
                p = Path(valid[0])
                return {
                    "ok": True,
                    "kind": "image" if p.suffix.lower() in IMAGE_EXTS else "document",
                    "path": str(p),
                    "name": p.name,
                    "all_paths": valid,
                }
    except Exception:
        pass

    try:
        import pyperclip

        txt = str(pyperclip.paste() or "").strip()
        if txt:
            maybe_p = Path(txt.strip('"').strip("'"))
            if maybe_p.exists() and maybe_p.is_file():
                return {
                    "ok": True,
                    "kind": "image" if maybe_p.suffix.lower() in IMAGE_EXTS else "document",
                    "path": str(maybe_p),
                    "name": maybe_p.name,
                }
            return {"ok": True, "kind": "text", "text": txt}
    except Exception:
        pass

    return {"ok": False, "error": "Clipboard hiện đang trống hoặc không chứa ảnh/văn bản."}


def export_text_to_docx(title: str, content: str, filename_prefix: str = "jarvis-doc") -> Path:
    from docx import Document

    EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_path = EXPORTS_DIR / f"{_sanitize_filename(filename_prefix)}-{stamp}.docx"

    doc = Document()
    doc.add_heading(title or "Kết quả Jarvis AI", level=1)
    for block in str(content or "").split("\n"):
        line = block.rstrip()
        if not line.strip():
            continue
        if line.startswith("### "):
            doc.add_heading(line[4:].strip(), level=3)
        elif line.startswith("## "):
            doc.add_heading(line[3:].strip(), level=2)
        elif line.startswith("# "):
            doc.add_heading(line[2:].strip(), level=1)
        elif re.match(r"^[-*•]\s+", line.strip()):
            doc.add_paragraph(re.sub(r"^[-*•]\s+", "", line.strip()), style="List Bullet")
        else:
            doc.add_paragraph(line)

    doc.save(str(out_path))
    return out_path


def export_csv_text(raw_output: str, filename_prefix: str = "jarvis-table") -> Path:
    EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_path = EXPORTS_DIR / f"{_sanitize_filename(filename_prefix)}-{stamp}.csv"

    clean = str(raw_output or "").strip()
    fence = re.search(r"```(?:csv|markdown|md|txt)?\s*(.*?)```", clean, re.DOTALL | re.IGNORECASE)
    if fence:
        clean = fence.group(1).strip()

    lines = [ln.strip() for ln in clean.splitlines() if ln.strip()]
    rows: List[List[str]] = []
    if any("|" in ln for ln in lines):
        for ln in lines:
            if re.match(r"^\|?[\s:\-|]+\|?$", ln):
                continue
            if "|" in ln:
                cells = [c.strip() for c in ln.strip("|").split("|")]
                rows.append(cells)
    else:
        reader = csv.reader(io.StringIO(clean))
        rows = [r for r in reader if any(cell.strip() for cell in r)]

    if not rows:
        rows = [[ln] for ln in lines]

    with out_path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerows(rows)
    return out_path


def _split_text_chunks(text: str, chunk_chars: int = 2400, overlap_chars: int = 120) -> List[str]:
    clean = str(text or "").strip()
    if len(clean) <= chunk_chars:
        return [clean] if clean else []

    chunks: List[str] = []
    start = 0
    total = len(clean)
    while start < total:
        end = min(total, start + chunk_chars)
        if end < total:
            split_at = clean.rfind("\n\n", start + int(chunk_chars * 0.55), end)
            if split_at == -1:
                split_at = clean.rfind("\n", start + int(chunk_chars * 0.65), end)
            if split_at == -1:
                split_at = clean.rfind(". ", start + int(chunk_chars * 0.7), end)
            if split_at != -1:
                end = split_at + 1
        part = clean[start:end].strip()
        if part:
            chunks.append(part)
        if end >= total:
            break
        start = max(end - overlap_chars, start + 200)
    return chunks


def _is_zero_keep_alive(keep_alive: Any) -> bool:
    if isinstance(keep_alive, bool):
        return False
    if keep_alive == 0:
        return True
    return str(keep_alive or "").strip().lower() in ("0", "0s")


def _unload_ollama_model_if_zero(ollama_url: str, model: str, keep_alive: Any) -> None:
    if not _is_zero_keep_alive(keep_alive):
        return
    try:
        requests.post(
            f"{ollama_url}/api/generate",
            json={"model": model, "prompt": "", "keep_alive": 0, "stream": False},
            timeout=4.0,
        )
    except Exception:
        pass


def _ollama_chat_text(
    *,
    ollama_url: str,
    model: str,
    prompt: str,
    images: Optional[List[str]] = None,
    keep_alive: Any = "5m",
    num_ctx: int = 8192,
    think: bool = False,
    num_predict: int = 1400,
    timeout_sec: float = 85.0,
) -> str:
    in_flight_ka: Any = "1m" if _is_zero_keep_alive(keep_alive) else keep_alive
    msg: Dict[str, Any] = {"role": "user", "content": prompt}
    if images:
        msg["images"] = images
    payload: Dict[str, Any] = {
        "model": model,
        "stream": False,
        "think": think,
        "keep_alive": in_flight_ka,
        "options": {
            "temperature": 0.25 if not think else 0.45,
            "num_ctx": int(num_ctx),
            "num_predict": int(num_predict),
        },
        "messages": [msg],
    }
    try:
        resp = requests.post(f"{ollama_url}/api/chat", json=payload, timeout=(4.0, timeout_sec))
        resp.raise_for_status()
        data = resp.json().get("message") or {}
        content = str(data.get("content") or "").strip()
        if not content and think:
            payload["think"] = False
            payload["options"]["num_predict"] = min(1400, int(num_predict))
            r2 = requests.post(f"{ollama_url}/api/chat", json=payload, timeout=(4.0, 65.0))
            r2.raise_for_status()
            content = str((r2.json().get("message") or {}).get("content") or "").strip()
        return content
    finally:
        _unload_ollama_model_if_zero(ollama_url, model, keep_alive)


def _detect_export_intent(prompt_low: str) -> str:
    if re.search(r"excel|csv|bảng\s*tính|spreadsheet", prompt_low):
        return "csv"
    if re.search(r"xuất\s*(?:ra\s*)?(?:file\s*)?word|lưu\s*(?:thành|ra)\s*word|file\s*docx|tạo\s*word", prompt_low):
        return "docx"
    if re.search(r"dịch\s+.*?(?:toàn\s+bộ|cả\s+file|tài\s+liệu)|tài\s+liệu\s+.*?dịch", prompt_low):
        return "docx_auto"
    return ""


def process_document_with_4b(
    *,
    file_path: str | Path,
    user_prompt: str,
    ollama_url: str,
    model: str = "qwen3.5:4b",
    keep_alive: Any = "5m",
    num_ctx: int = 8192,
    use_thinking: bool = False,
) -> Dict[str, Any]:
    """Read PDF/DOCX/XLSX/TXT/Code and run single-pass or chunked Map-Reduce with Qwen 4B."""
    doc_info = extract_text_from_file(file_path)
    if not doc_info.get("ok"):
        return {"ok": False, "tier": 2, "route": "local_document", "reply": doc_info.get("error") or "Lỗi đọc file."}

    doc_text = str(doc_info.get("text") or "").strip()
    if not doc_text:
        return {
            "ok": False,
            "tier": 2,
            "route": "local_document",
            "reply": f"File {doc_info['name']} không có văn bản trích xuất được (nếu là PDF scan ảnh, hãy chụp màn hình trang đó hoặc xuất ảnh để 4B đọc bằng Vision).",
        }

    low = str(user_prompt or "").lower()
    is_translate = bool(re.search(r"dịch|translate|chuyển\s+ngữ|tiếng\s+việt|tiếng\s+anh", low))
    is_summary = bool(re.search(r"tóm\s*tắt|tổng\s*hợp|ý\s*chính|nội\s+dung\s+chính|summary", low))
    export_kind = _detect_export_intent(low)

    chunks = _split_text_chunks(doc_text, chunk_chars=2600 if is_translate else 3400)
    in_flight_ka: Any = "1m" if _is_zero_keep_alive(keep_alive) else keep_alive
    t0 = time.monotonic()

    try:
        if len(chunks) <= 1:
            single_prompt = (
                f"Tài liệu: {doc_info['name']} ({doc_info.get('page_count', 1)} trang)\n"
                f"Yêu cầu của người dùng: {user_prompt}\n\n"
                f"Nội dung tài liệu:\n{chunks[0]}\n\n"
                "Hãy trả lời bằng Tiếng Việt rõ ràng, chính xác, trình bày mạch lạc."
            )
            final_output = _ollama_chat_text(
                ollama_url=ollama_url,
                model=model,
                prompt=single_prompt,
                keep_alive=in_flight_ka,
                num_ctx=num_ctx,
                think=use_thinking and not is_translate,
                num_predict=1600,
            )
        else:
            # Limit chunks for ultra-huge files to stay responsive on local 4B
            capped_chunks = chunks[:12]
            chunk_outputs: List[str] = []
            for idx, ch in enumerate(capped_chunks, start=1):
                if is_translate:
                    c_prompt = (
                        f"Dịch chính xác và tự nhiên đoạn {idx}/{len(capped_chunks)} của tài liệu '{doc_info['name']}' "
                        f"theo yêu cầu: '{user_prompt}'. Chỉ trả về bản dịch sạch, giữ nguyên bố cục đầu mục/danh sách:\n\n{ch}"
                    )
                else:
                    c_prompt = (
                        f"Đọc đoạn {idx}/{len(capped_chunks)} của tài liệu '{doc_info['name']}' và trích xuất thông tin/tóm tắt "
                        f"phục vụ yêu cầu: '{user_prompt}'. Trả lời súc tích bằng Tiếng Việt:\n\n{ch}"
                    )
                ans = _ollama_chat_text(
                    ollama_url=ollama_url,
                    model=model,
                    prompt=c_prompt,
                    keep_alive=in_flight_ka,
                    num_ctx=num_ctx,
                    think=False,
                    num_predict=1300,
                )
                if ans:
                    chunk_outputs.append(ans)

            if is_translate:
                final_output = "\n\n".join(chunk_outputs)
            elif is_summary or len(chunk_outputs) > 1:
                combined = "\n\n".join(f"[Phần {i + 1}]\n{txt}" for i, txt in enumerate(chunk_outputs))
                reduce_prompt = (
                    f"Dựa trên các phần đã trích xuất từ tài liệu '{doc_info['name']}', hãy tổng hợp lại một câu trả lời "
                    f"hoàn chỉnh, mạch lạc bằng Tiếng Việt cho yêu cầu: '{user_prompt}':\n\n{combined[:9500]}"
                )
                final_output = _ollama_chat_text(
                    ollama_url=ollama_url,
                    model=model,
                    prompt=reduce_prompt,
                    keep_alive=in_flight_ka,
                    num_ctx=num_ctx,
                    think=use_thinking,
                    num_predict=1500,
                ) or "\n\n".join(chunk_outputs)
            else:
                final_output = "\n\n".join(chunk_outputs)
    finally:
        _unload_ollama_model_if_zero(ollama_url, model, keep_alive)

    exported_path: Optional[Path] = None
    if export_kind == "csv":
        exported_path = export_csv_text(final_output, filename_prefix=Path(doc_info["name"]).stem)
    elif export_kind in ("docx", "docx_auto") and (export_kind == "docx" or len(final_output) > 650):
        exported_path = export_text_to_docx(
            title=f"{doc_info['name']} — Jarvis AI",
            content=final_output,
            filename_prefix=Path(doc_info["name"]).stem,
        )

    if exported_path and exported_path.exists():
        try:
            os.startfile(str(exported_path))
        except Exception:
            pass
        preview = final_output[:480].strip()
        reply = (
            f"Đã xử lý xong **{doc_info['name']}** ({len(chunks)} phần, {round(time.monotonic() - t0, 1)}s) "
            f"và xuất ra `{exported_path.name}`:\n\n{preview}{'...' if len(final_output) > 480 else ''}"
        )
    else:
        reply = final_output or f"Đã đọc {doc_info['name']} nhưng không có kết quả trả về."

    return {
        "ok": True,
        "tier": 2,
        "route": "local_document",
        "model_used": model,
        "file_path": str(file_path),
        "file_name": doc_info["name"],
        "chunks_processed": len(chunks),
        "exported_path": str(exported_path) if exported_path else None,
        "reply": reply,
    }


def process_image_with_4b(
    *,
    image_path: str | Path,
    user_prompt: str,
    ollama_url: str,
    vision_model: str = "qwen3.5:4b",
    keep_alive: Any = "5m",
    num_ctx: int = 8192,
    use_thinking: bool = False,
) -> Dict[str, Any]:
    """Analyze, OCR, translate, or extract tables from an image file using Qwen 4B Vision."""
    p = Path(str(image_path))
    if not p.exists() or not p.is_file():
        return {"ok": False, "tier": 2, "route": "local_vision", "reply": f"Không tìm thấy ảnh: {p}"}

    try:
        from PIL import Image

        with Image.open(p) as im:
            im = im.convert("RGB")
            w, h = im.size
            max_edge = 1440
            if max(w, h) > max_edge:
                scale = max_edge / float(max(w, h))
                im = im.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.Resampling.LANCZOS)
            buf = io.BytesIO()
            im.save(buf, format="PNG", optimize=True)
            prep_b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    except Exception:
        prep_b64 = base64.b64encode(p.read_bytes()).decode("ascii")

    low = str(user_prompt or "").lower()
    export_kind = _detect_export_intent(low)

    if export_kind == "csv":
        prompt_txt = (
            f"Ảnh: {p.name}. Yêu cầu: {user_prompt}\n"
            "Hãy trích xuất toàn bộ dữ liệu dạng bảng trong ảnh thành CSV chuẩn (ngăn cách bằng dấu phẩy, dòng đầu là tiêu đề cột). "
            "Chỉ xuất nội dung CSV sạch để mở trực tiếp trong Excel."
        )
    else:
        prompt_txt = (
            f"Quan sát ảnh ngữ cảnh ({p.name}) và thực hiện chính xác yêu cầu bằng Tiếng Việt: {user_prompt}"
        )

    in_flight_ka: Any = "1m" if _is_zero_keep_alive(keep_alive) else keep_alive
    try:
        ans = _ollama_chat_text(
            ollama_url=ollama_url,
            model=vision_model,
            prompt=prompt_txt,
            images=[prep_b64],
            keep_alive=in_flight_ka,
            num_ctx=num_ctx,
            think=use_thinking,
            num_predict=1500,
            timeout_sec=90.0,
        )
    finally:
        _unload_ollama_model_if_zero(ollama_url, vision_model, keep_alive)

    exported_path: Optional[Path] = None
    if export_kind == "csv":
        exported_path = export_csv_text(ans, filename_prefix=p.stem)
    elif export_kind == "docx":
        exported_path = export_text_to_docx(
            title=f"{p.name} — Jarvis Vision",
            content=ans,
            filename_prefix=p.stem,
        )

    if exported_path and exported_path.exists():
        try:
            os.startfile(str(exported_path))
        except Exception:
            pass
        reply = f"Đã xử lý ảnh **{p.name}** và xuất ra `{exported_path.name}`:\n\n{ans[:500]}"
    else:
        reply = ans or f"Đã xem ảnh {p.name} nhưng chưa trích xuất được nội dung."

    return {
        "ok": True,
        "tier": 2,
        "route": "local_vision",
        "model_used": vision_model,
        "file_path": str(p),
        "file_name": p.name,
        "exported_path": str(exported_path) if exported_path else None,
        "reply": reply,
    }
