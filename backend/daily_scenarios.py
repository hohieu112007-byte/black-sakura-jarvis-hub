"""Composable Intent-Slot Frames & Zero-VRAM Daily Actions (<50ms, 0 MB VRAM)."""
from __future__ import annotations

import re
import time
from typing import Any, Callable, Dict, List, Optional, Tuple

_EXECUTION_TOOL_CB = Optional[Callable[[str, str, Dict[str, Any]], Dict[str, Any]]]


def word_match(text: str, pattern: str) -> bool:
    return bool(re.search(rf"(?<![\w])(?:{pattern})(?![\w])", str(text or ""), re.IGNORECASE))


KNOWN_APPS: Dict[str, Tuple[str, str]] = {
    "notepad": ("notepad", "Notepad"),
    "ghi chú": ("notepad", "Notepad"),
    "calculator": ("calc", "Calculator"),
    "calc": ("calc", "Calculator"),
    "máy tính": ("calc", "Calculator"),
    "paint": ("mspaint", "Paint"),
    "mspaint": ("mspaint", "Paint"),
    "word": ("winword", "Microsoft Word"),
    "winword": ("winword", "Microsoft Word"),
    "excel": ("excel", "Microsoft Excel"),
    "powerpoint": ("powerpnt", "PowerPoint"),
    "brave": ("brave", "Brave"),
    "chrome": ("chrome", "Google Chrome"),
    "google chrome": ("chrome", "Google Chrome"),
    "edge": ("msedge", "Microsoft Edge"),
    "microsoft edge": ("msedge", "Microsoft Edge"),
    "trình duyệt": ("msedge", "Microsoft Edge"),
    "discord": ("discord", "Discord"),
    "spotify": ("spotify", "Spotify"),
    "zalo": ("zalo", "Zalo"),
    "steam": ("steam", "Steam"),
    "capcut": ("capcut", "CapCut"),
    "telegram": ("telegram", "Telegram"),
    "obs studio": ("obs", "OBS Studio"),
    "obs": ("obs", "OBS Studio"),
    "chatgpt": ("chatgpt", "ChatGPT"),
    "unikey": ("unikey", "Unikey"),
    "facebook": ("facebook", "Facebook App"),
    "face book": ("facebook", "Facebook App"),
    "fb": ("facebook", "Facebook App"),
    "vs code": ("code", "VS Code"),
    "vscode": ("code", "VS Code"),
    "visual studio code": ("code", "VS Code"),
    "file explorer": ("explorer", "File Explorer"),
    "explorer": ("explorer", "File Explorer"),
    "thư mục": ("explorer", "File Explorer"),
    "antigravity": ("antigravity", "Antigravity"),
}

KNOWN_WEBSITES: Dict[str, Tuple[str, str]] = {
    "youtube": ("https://www.youtube.com", "YouTube"),
    "ytb": ("https://www.youtube.com", "YouTube"),
    "facebook": ("https://www.facebook.com", "Facebook"),
    "face book": ("https://www.facebook.com", "Facebook"),
    "fb": ("https://www.facebook.com", "Facebook"),
    "messenger": ("https://www.messenger.com", "Messenger"),
    "tiktok": ("https://www.tiktok.com", "TikTok"),
    "instagram": ("https://www.instagram.com", "Instagram"),
    "threads": ("https://www.threads.net", "Threads"),
    "reddit": ("https://www.reddit.com", "Reddit"),
    "twitter": ("https://x.com", "X (Twitter)"),
    "google translate": ("https://translate.google.com", "Google Dịch"),
    "google dịch": ("https://translate.google.com", "Google Dịch"),
    "google maps": ("https://maps.google.com", "Google Maps"),
    "google sheets": ("https://sheets.google.com", "Google Sheets"),
    "google docs": ("https://docs.google.com", "Google Docs"),
    "google drive": ("https://drive.google.com", "Google Drive"),
    "gmail": ("https://mail.google.com", "Gmail"),
    "google": ("https://www.google.com", "Google"),
    "chatgpt": ("https://chatgpt.com", "ChatGPT"),
    "gemini": ("https://gemini.google.com", "Google Gemini"),
    "claude": ("https://claude.ai", "Claude"),
    "github": ("https://github.com", "GitHub"),
    "shopee": ("https://shopee.vn", "Shopee"),
    "lazada": ("https://www.lazada.vn", "Lazada"),
    "tiki": ("https://tiki.vn", "Tiki"),
    "netflix": ("https://www.netflix.com", "Netflix"),
    "spotify web": ("https://open.spotify.com", "Spotify Web"),
    "zing mp3": ("https://zingmp3.vn", "Zing MP3"),
    "vnexpress": ("https://vnexpress.net", "VnExpress"),
    "wikipedia": ("https://vi.wikipedia.org", "Wikipedia"),
}

HOTKEY_FRAMES: List[Tuple[str, str, int, str, Optional[str]]] = [
    (r"tăng\s+âm\s+lượng|âm\s+lượng\s+lên|volume\s+up|loa\s+to\s+lên|vặn\s+to\s+lên|mở\s+to\s+lên|to\s+tiếng\s+lên", "volume_up", 6, "Đã tăng âm lượng.", None),
    (r"giảm\s+âm\s+lượng|âm\s+lượng\s+xuống|volume\s+down|vặn\s+nhỏ\s+lại|nhỏ\s+tiếng\s+lại|giảm\s+tiếng", "volume_down", 6, "Đã giảm âm lượng.", None),
    (r"tắt\s+tiếng|tắt\s+loa|im\s+lặng|mute\s+loa|bật\s+tiếng|bỏ\s+tắt\s+tiếng|unmute\s+loa", "volume_mute", 1, "Đã bật/tắt tiếng hệ thống.", None),
    (r"next\s*bài|chuyển\s*bài|bài\s*tiếp|qua\s*bài|video\s*tiếp", "media_next", 1, "Đã chuyển bài tiếp theo.", None),
    (r"bài\s+trước|lùi\s+bài|quay\s+lại\s+bài|previous\s+track", "media_prev", 1, "Đã quay lại bài trước.", None),
    (r"pause\s*nhạc|tạm\s*dừng(?:\s+(?:nhạc|video|phim))?|dừng\s*(?:nhạc|phát|video)|tiếp\s*tục\s*(?:nhạc|video|phát)|phát\s+tiếp|play\s+nhạc", "media_play_pause", 1, "Đã Play/Pause.", None),
    (r"khôi\s+phục\s+tab|mở\s+lại\s+tab\s+(?:vừa\s+đóng|cũ)|reopen\s+tab", "ctrl+shift+t", 1, "Đã mở lại tab vừa đóng.", "msedge"),
    (r"close\s*tab|đóng\s*tab(?:\s+hiện\s+tại|\s+này)?|tắt\s*tab(?:\s+này)?", "ctrl+w", 1, "Đã đóng tab hiện tại.", "msedge"),
    (r"tải\s+lại\s+trang|làm\s+mới\s+trang|reload(?:\s+page)?|refresh(?:\s+page)?|f5", "f5", 1, "Đã tải lại trang.", "msedge"),
    (r"quay\s+lại\s+trang(?:\s+trước)?|back\s+trang|lùi\s+trang", "alt+left", 1, "Đã quay lại trang trước.", "msedge"),
    (r"tiến\s+trang\s+sau|trang\s+tiếp\s+theo|forward\s+page", "alt+right", 1, "Đã chuyển tới trang sau.", "msedge"),
    (r"tab\s+ẩn\s+danh|cửa\s+sổ\s+ẩn\s+danh|incognito|inprivate", "ctrl+shift+n", 1, "Đã mở cửa sổ ẩn danh.", "msedge"),
    (r"lịch\s+sử\s+(?:duyệt\s+web|edge|trình\s+duyệt)", "ctrl+h", 1, "Đã mở lịch sử trình duyệt.", "msedge"),
    (r"tải\s+xuống\s+(?:edge|trình\s+duyệt)|mở\s+downloads?", "ctrl+j", 1, "Đã mở mục Tải xuống.", "msedge"),
    (r"phóng\s+to\s+chữ|zoom\s+in", "ctrl+=", 2, "Đã phóng to nội dung trang.", "msedge"),
    (r"thu\s+nhỏ\s+chữ|zoom\s+out", "ctrl+-", 2, "Đã thu nhỏ nội dung trang.", "msedge"),
    (r"đặt\s+lại\s+zoom|zoom\s+mặc\s+định|zoom\s+100", "ctrl+0", 1, "Đã đưa zoom về 100%.", "msedge"),
    (r"xuống\s+cuối\s+trang|cuộn\s+xuống\s+cuối", "end", 1, "Đã cuộn xuống cuối trang.", "msedge"),
    (r"lên\s+đầu\s+trang|cuộn\s+lên\s+đầu", "home", 1, "Đã cuộn lên đầu trang.", "msedge"),
    (r"(?:bật|tắt)\s+phụ\s+đề|subtitles?", "c", 1, "Đã bật/tắt phụ đề video.", "msedge"),
    (r"toàn\s+màn\s+hình\s+video|full\s+video", "f", 1, "Đã bật/tắt toàn màn hình video.", "msedge"),
    (r"chế\s+độ\s+rạp|theater\s+mode", "t", 1, "Đã bật/tắt chế độ rạp.", "msedge"),
    (r"tắt\s+tiếng\s+video|bật\s+tiếng\s+video", "m", 1, "Đã bật/tắt tiếng video.", "msedge"),
    (r"chụp\s+(?:ảnh\s+)?màn\s+hình\s+nhanh|snipping\s+tool", "win+shift+s", 1, "Đã mở công cụ chụp màn hình.", None),
    (r"về\s+màn\s+hình\s+chính|hiện\s+desktop|show\s+desktop|thu\s+hết\s+cửa\s+sổ", "win+d", 1, "Đã thu tất cả cửa sổ về Desktop.", None),
    (r"chuyển\s+cửa\s+sổ|đổi\s+cửa\s+sổ|alt\s+tab", "alt+tab", 1, "Đã chuyển sang cửa sổ khác.", None),
    (r"mở\s+task\s+manager|quản\s+lý\s+tác\s+vụ", "ctrl+shift+esc", 1, "Đã mở Task Manager.", None),
    (r"đóng\s+cửa\s+sổ\s+(?:này|hiện\s+tại)", "alt+f4", 1, "Đã đóng cửa sổ hiện tại.", None),
    (r"^(?:copy|sao\s+chép(?:\s+đi|\s+lại)?)$", "ctrl+c", 1, "Đã sao chép (Ctrl+C).", None),
    (r"^(?:paste|dán(?:\s+ra|\s+vào)?)$", "ctrl+v", 1, "Đã dán (Ctrl+V).", None),
    (r"^(?:cut|cắt\s+đoạn\s+này)$", "ctrl+x", 1, "Đã cắt (Ctrl+X).", None),
    (r"chọn\s+tất\s+cả|bôi\s+đen\s+hết|select\s+all", "ctrl+a", 1, "Đã chọn tất cả (Ctrl+A).", None),
    (r"^(?:undo|hoàn\s+tác|quay\s+lại\s+bước\s+trước)$", "ctrl+z", 1, "Đã hoàn tác (Ctrl+Z).", None),
    (r"^(?:redo|làm\s+lại\s+bước\s+vừa\s+hoàn\s+tác)$", "ctrl+y", 1, "Đã làm lại (Ctrl+Y).", None),
    (r"^(?:save|lưu\s+file(?:\s+lại)?|lưu\s+lại)$", "ctrl+s", 1, "Đã lưu (Ctrl+S).", None),
]

QUICK_SEARCH_QUERIES: List[Tuple[str, str, str]] = [
    (r"thời\s+tiết\s+hôm\s+nay", "thời tiết hôm nay", "Đã tra thời tiết hôm nay trên Google."),
    (r"giá\s+vàng\s+hôm\s+nay", "giá vàng hôm nay", "Đã tra giá vàng hôm nay trên Google."),
    (r"tỷ\s+giá\s+(?:đô\s+la|usd|ngoại\s+tệ)\s+hôm\s+nay", "tỷ giá USD hôm nay", "Đã tra tỷ giá hôm nay trên Google."),
    (r"kết\s+quả\s+bóng\s+đá\s+hôm\s+nay|lịch\s+bóng\s+đá\s+hôm\s+nay", "lịch bóng đá hôm nay", "Đã mở lịch & kết quả bóng đá trên Google."),
    (r"tin\s+tức\s+hôm\s+nay", "tin tức mới nhất hôm nay", "Đã mở tin tức hôm nay trên Google."),
]

WINDOW_LAYOUT_SLOTS: List[Tuple[str, str, str]] = [
    (r"màn(?:\s+hình)?\s*(?:còn\s*lại|bên\s*kia|kia|khác)", "move_other_monitor", "màn hình còn lại"),
    (r"màn(?:\s+hình)?\s*(?:nhỏ\s*hơn|nhỏ|bé\s*hơn|bé|phụ)", "move_smaller_monitor", "màn hình nhỏ hơn"),
    (r"màn(?:\s+hình)?\s*(?:lớn\s*hơn|to\s*hơn|lớn|to|chính)", "move_larger_monitor", "màn hình lớn hơn"),
    (r"(?:màn(?:\s+hình)?|monitor)\s*(?:số\s*)?(?:1|một|thứ\s*nhất)", "move_monitor_1", "màn hình 1"),
    (r"(?:màn(?:\s+hình)?|monitor)\s*(?:số\s*)?(?:2|hai|thứ\s*hai)", "move_monitor_2", "màn hình 2"),
    (r"(?:nửa\s+|góc\s+|sang\s+|bên\s*)trái|snap\s*left", "snap_left", "nửa trái màn hình"),
    (r"(?:nửa\s+|góc\s+|sang\s+|bên\s*)phải|snap\s*right", "snap_right", "nửa phải màn hình"),
    (r"(?:nửa\s+|góc\s*)trên|snap\s*top", "snap_top", "nửa trên màn hình"),
    (r"(?:nửa\s+|góc\s*)dưới|snap\s*bottom", "snap_bottom", "nửa dưới màn hình"),
    (r"full(?:\s*màn(?:\s*hình)?)?|toàn\s*màn(?:\s*hình)?|phóng\s*to|maximize", "maximize", "toàn màn hình"),
    (r"thu\s*nhỏ|ẩn(?:\s*xuống)?|minimize", "minimize", "thu nhỏ"),
    (r"lên\s*trước|hiện\s*lên|focus", "focus", "lên phía trước"),
]


def _copy_clipboard(text: str) -> bool:
    try:
        import pyperclip  # type: ignore

        pyperclip.copy(str(text or ""))
        return True
    except Exception:
        return False


def resolve_app_entity(raw_or_sentence: str, default_proc: str = "msedge") -> Tuple[str, str]:
    low = str(raw_or_sentence or "").lower()
    for term, pair in KNOWN_APPS.items():
        if word_match(low, re.escape(term)):
            return pair
    cleaned = re.sub(
        r"^(?:cửa\s+sổ|ứng\s+dụng|phần\s+mềm|app|cái|thằng)\s+",
        "",
        str(raw_or_sentence or "").strip(),
        flags=re.IGNORECASE,
    ).strip()
    if cleaned and len(cleaned) >= 2 and not word_match(cleaned, r"này|đó|nó|hiện\s+tại|trang\s+này|web"):
        return cleaned, cleaned
    return default_proc, ("Microsoft Edge" if default_proc == "msedge" else default_proc)


def _resolve_site_or_domain(raw_target: str) -> Optional[Tuple[str, str]]:
    low = str(raw_target or "").lower()
    for term, pair in KNOWN_WEBSITES.items():
        if word_match(low, re.escape(term)):
            return pair
    dom = re.search(r"\b((?:https?://)?[a-z0-9-]+(?:\.[a-z0-9-]+)+\b(?:/\S*)?)", raw_target, re.IGNORECASE)
    if dom and not dom.group(1).lower().endswith((".exe", ".txt", ".docx", ".py")):
        url = dom.group(1) if dom.group(1).startswith("http") else f"https://{dom.group(1)}"
        return url, url
    return None


def _detect_active_browser_proc(
    run_tool: Callable[[str, str, Dict[str, Any]], Dict[str, Any]],
    prefer_title_kw: str = "",
) -> str:
    """Return the active/visible browser process (msedge, chrome, brave, etc.), defaulting to msedge."""
    wins_res = run_tool("fast_desktop", "list_windows", {})
    win_list = wins_res.get("windows") if isinstance(wins_res, dict) else None
    if not isinstance(win_list, list):
        return "msedge"
    browser_procs = ("msedge", "chrome", "brave", "browser", "coccoc", "firefox", "opera")
    candidates: List[Dict[str, Any]] = []
    for w in win_list:
        if not isinstance(w, dict):
            continue
        proc_l = str(w.get("process") or "").lower()
        title_l = str(w.get("title") or "").lower()
        is_edge_pwa = ("msedge" in proc_l) and ("edge" not in title_l)
        if any(bp in proc_l for bp in browser_procs) and not is_edge_pwa and not w.get("minimized") and int(w.get("width") or 0) >= 260:
            candidates.append(w)
    if not candidates:
        return "msedge"
    kw = str(prefer_title_kw or "").strip().lower()
    if kw:
        kw_hits = [w for w in candidates if kw in str(w.get("title") or "").lower()]
        if kw_hits:
            kw_hits.sort(key=lambda w: 0 if w.get("focused") else 1)
            return str(kw_hits[0].get("process") or "msedge")
    focused_win = next((w for w in candidates if w.get("focused")), None)
    if focused_win:
        return str(focused_win.get("process") or "msedge")
    return str(candidates[0].get("process") or "msedge")


def _parse_seek_seconds(low: str) -> Optional[Tuple[bool, int]]:
    # "tua đến phút thứ 5" is an absolute seek; "tua thêm 5 phút" / "tua lại 10 giây" is relative
    has_abs_prep = bool(word_match(low, r"đến|tới|về|vào|tại|lúc")) and not bool(word_match(low, r"tới\s+thêm"))
    is_delta = bool(word_match(low, r"thêm|tới\s+thêm|lùi|lại|giảm")) and not (has_abs_prep and not word_match(low, r"lùi|giảm"))
    sign = -1 if word_match(low, r"lùi|lại|giảm") else 1

    colon_hms = re.search(r"(\d+)\s*:\s*(\d{1,2})\s*:\s*(\d{1,2})", low)
    if colon_hms:
        return is_delta, sign * (int(colon_hms.group(1)) * 3600 + int(colon_hms.group(2)) * 60 + int(colon_hms.group(3)))

    colon_ms = re.search(r"(\d+)\s*:\s*(\d{1,2})", low)
    if colon_ms:
        return is_delta, sign * (int(colon_ms.group(1)) * 60 + int(colon_ms.group(2)))

    total = 0
    matched = False
    for unit_pat, mult in (
        (r"(?:(\d+)\s*(?:tiếng|giờ|hours?|hrs?|h)\b|(?:tiếng|giờ)\s+thứ\s*(\d+))", 3600),
        (r"(?:(\d+)\s*(?:phút|minutes?|mins?|p|m)\b|phút\s+thứ\s*(\d+))", 60),
        (r"(?:(\d+)\s*(?:giây|seconds?|secs?|s)\b|giây\s+thứ\s*(\d+))", 1),
    ):
        m = re.search(unit_pat, low)
        if m:
            num_str = m.group(1) or m.group(2)
            if num_str:
                total += int(num_str) * mult
                matched = True
    return (is_delta, sign * total) if (matched and total > 0) else None


def _extract_nth_video(low: str) -> int:
    wmap = {"đầu": 1, "nhất": 1, "một": 1, "hai": 2, "ba": 3, "tư": 4, "bốn": 4, "năm": 5}
    m = re.search(r"video\s+(?:(đầu(?:\s*tiên)?)|thứ\s*([1-9]|một|hai|ba|tư|bốn|năm|nhất))", low, re.IGNORECASE)
    if m:
        if m.group(1):
            return 1
        tok = (m.group(2) or "1").lower()
        return int(wmap.get(tok, tok))
    return 1


def _frame_window_and_monitor(clean: str, low: str, run_tool) -> Optional[Dict[str, Any]]:
    # Do not hijack visual screen-inspection questions (e.g. "trên màn hình chính đang mở gì?")
    if word_match(low, r"(?:có|hiện|mở|ghi|viết|nói)\s+gì|chụp|nhìn") and not word_match(
        low, r"chuyển|đưa|kéo|ném|sang|qua|move|thu\s*nhỏ|phóng\s*to|chia\s*đôi"
    ):
        return None
    matched_action = ""
    matched_desc = ""
    dest_span = None
    for slot_pat, action_name, desc_vi in WINDOW_LAYOUT_SLOTS:
        m = re.search(slot_pat, low, re.IGNORECASE)
        if m:
            matched_action = action_name
            matched_desc = desc_vi
            dest_span = m.span()
            break
    if not matched_action:
        return None

    is_monitor_move = matched_action.startswith("move_")
    has_window_verb = word_match(
        low,
        r"cho|đưa|chuyển|kéo|ném|đẩy|đặt|gửi|mang|thu\s*nhỏ|ẩn|phóng\s*to|full|chia(?:\s*đôi)?|focus|hiện|minimize|maximize",
    )
    if not has_window_verb and not is_monitor_move:
        return None
    if word_match(low, r"chữ|zoom|video|desktop|hết\s+cửa\s+sổ|tất\s+cả\s+cửa\s+sổ"):
        return None

    head = clean[: dest_span[0]] if dest_span else clean
    head = re.sub(r"\b(?:sang|qua|về|lên|xuống|vào|tới|ra)\s*$", "", head, flags=re.IGNORECASE).strip()
    head = re.sub(
        r"^(?:hãy|vui\s+lòng|giúp\s+tôi|làm\s+ơn)?\s*(?:cho|đưa|chuyển|kéo|ném|đẩy|đặt|gửi|mang|thu\s*nhỏ|ẩn|phóng\s*to|full|chia(?:\s*đôi)?|focus|bật|mở)(?:\s+|$)",
        "",
        head,
        flags=re.IGNORECASE,
    ).strip()

    explicit_named = any(word_match(head or low, re.escape(t)) for t in KNOWN_APPS) or any(
        word_match(head or low, re.escape(s)) for s in KNOWN_WEBSITES
    )
    cleaned_head = re.sub(r"\b(?:cửa\s+sổ|này|đó|nó|hiện\s+tại|đang\s+mở|trên|ở|của)\b", "", head, flags=re.IGNORECASE).strip()
    if not explicit_named and len(cleaned_head) < 2:
        wins = run_tool("fast_desktop", "list_windows", {}).get("windows") or []
        fg = next(
            (
                w for w in wins
                if isinstance(w, dict)
                and w.get("focused")
                and "jarvishub" not in str(w.get("process") or "").lower()
                and "blacksakura" not in str(w.get("process") or "").lower()
            ),
            None,
        )
        if fg and fg.get("hwnd"):
            fg_label = str(fg.get("process") or "cửa sổ hiện tại")
            r = run_tool("fast_desktop", "window_control", {"hwnd": str(fg["hwnd"]), "action": matched_action})
            if r.get("cancelled_by_user") or r.get("needs_confirmation"):
                return r
            ok = bool(r.get("ok", True))
            reply = f"Đã đưa {fg_label} sang {matched_desc}." if is_monitor_move else f"Đã chỉnh {fg_label}: {matched_desc}."
            return {"ok": ok, "tier": 1, "route": "fast_desktop", "reply": reply, "result": r}

    proc, label = resolve_app_entity(head or low, default_proc="msedge")
    args: Dict[str, Any] = {"title": "Facebook", "action": matched_action} if proc == "facebook" else {"process": proc, "action": matched_action}

    r = run_tool("fast_desktop", "window_control", args)
    if r.get("cancelled_by_user") or r.get("needs_confirmation"):
        return r
    if not r.get("ok"):
        # If user named a website tab (e.g. "đưa youtube sang màn 2" or "phóng to gmail"), match browser title
        site_match = next((lbl for term, (_, lbl) in KNOWN_WEBSITES.items() if word_match(head or low, re.escape(term))), "")
        if site_match and not (args.get("title") == site_match):
            r2 = run_tool("fast_desktop", "window_control", {"title": site_match, "action": matched_action})
            if r2.get("cancelled_by_user") or r2.get("needs_confirmation"):
                return r2
            if r2.get("ok"):
                r = r2
                label = site_match
    ok = bool(r.get("ok", True))
    if not ok and not has_window_verb and word_match(low, r"^(?:hãy\s+)?(?:mở|bật|chạy|open|vào|khởi\s*động)\b"):
        return None
    reply = f"Đã đưa {label} sang {matched_desc}." if is_monitor_move else f"Đã chỉnh {label}: {matched_desc}."
    if not ok:
        reply = f"Không tìm thấy cửa sổ {label} đang mở để chỉnh ({r.get('error') or ''})."
    return {"ok": ok, "tier": 1, "route": "fast_desktop", "reply": reply, "result": r}


def _frame_click_in_app(clean: str, low: str, run_tool) -> Optional[Dict[str, Any]]:
    """Frame: [nhấn/bấm] nút <button_name> [trên/trong/ở <app_name>]."""
    m = re.search(
        r"^(?:hãy\s+)?(?:nhấn|bấm|click|chọn)(?:\s+vào)?\s+(?:nút|button|mục)\s+[\"']?(.+?)[\"']?$",
        clean,
        re.IGNORECASE,
    )
    if not m:
        return None
    if word_match(low, r"video|gemini|tóm\s*tắt"):
        return None

    body = m.group(1).strip().rstrip(".!?")
    target_proc = "msedge"
    target_label = "ứng dụng đang mở"

    split_app = re.search(r"^(.+?)\s+(?:trên|trong|ở|của)\s+(?:app|ứng\s+dụng|cửa\s+sổ)?\s*(.+)$", body, re.IGNORECASE)
    if split_app:
        btn_name = split_app.group(1).strip().strip("\"'")
        app_raw = split_app.group(2).strip()
        target_proc, target_label = resolve_app_entity(app_raw, default_proc="msedge")
    else:
        btn_name = body.strip("\"'")
        # Try foreground window if not Edge-specific
        wins = run_tool("fast_desktop", "list_windows", {}).get("windows") or []
        fg = next(
            (w for w in wins if w.get("focused") and str(w.get("process") or "").lower() not in ("jarvishub", "blacksakurajarvishub")),
            None,
        )
        if fg and fg.get("process"):
            target_proc = str(fg["process"])
            target_label = target_proc

    if not btn_name:
        return None
    r = run_tool("fast_desktop", "uia_click", {"process": target_proc, "name": btn_name, "content_only": False})
    if r.get("cancelled_by_user") or r.get("needs_confirmation"):
        return r
    ok = bool(r.get("ok", True))
    reply = f"Đã bấm nút '{btn_name}' trên {target_label}." if ok else f"Không tìm thấy nút '{btn_name}' trên {target_label} ({r.get('error') or ''})."
    return {"ok": ok, "tier": 1, "route": "fast_desktop", "reply": reply, "result": r}


def _frame_web_extract_copy(clean: str, low: str, run_tool) -> Optional[Dict[str, Any]]:
    """Frame: [lấy/copy/trích] dữ liệu/nội dung [trên <site_or_page>] -> copy to clipboard + return."""
    m = re.search(
        r"^(?:đi\s+)?(?:lấy|copy|sao\s*chép|trích(?:\s+xuất)?)\s+(?:hết\s+|toàn\s+bộ\s+)?(?:dữ\s*liệu|nội\s*dung|văn\s*bản|chữ|thông\s*tin)(?:\s+(?:trên|từ|ở|của)\s+(.+))?$",
        clean,
        re.IGNORECASE,
    )
    if not m:
        return None

    target_part = (m.group(1) or "").strip().rstrip(".!?")
    site = _resolve_site_or_domain(target_part) if target_part else None
    if site is not None:
        r_open = run_tool("fast_desktop", "open_edge_url", {"url": site[0]})
        if r_open.get("cancelled_by_user") or r_open.get("needs_confirmation"):
            return r_open
        time.sleep(2.4)

    b_proc = _detect_active_browser_proc(run_tool)
    r_read = run_tool("fast_desktop", "uia_read", {"process": b_proc, "content_only": True, "max_items": 160})
    txt = str(r_read.get("text") or "").strip()
    if not txt:
        return {"ok": False, "tier": 1, "route": "fast_desktop", "reply": "Không lấy được nội dung chữ trên trang web (trang có thể trống hoặc chưa mở trên Edge).", "result": r_read}

    copied = _copy_clipboard(txt)
    preview = re.sub(r"\s+", " ", txt)[:260]
    msg = f"Đã lấy & copy vào Clipboard ({len(txt)} ký tự):\n{preview}..." if copied else f"Đã đọc dữ liệu ({len(txt)} ký tự):\n{preview}..."
    return {"ok": True, "tier": 1, "route": "fast_desktop", "reply": msg, "copied_chars": len(txt), "result": r_read}


def _frame_quiz_or_essay(
    clean: str,
    low: str,
    run_tool,
    deep_solve_fn: Optional[Callable[[str, str], Dict[str, Any]]] = None,
) -> Optional[Dict[str, Any]]:
    """Frame: Làm trắc nghiệm hoặc tự luận trên trang web đang mở (đọc UIA -> AI giải -> copy/trả về Hub)."""
    m = re.search(
        r"^(?:hãy\s+|giúp\s+tôi\s+)?(?:làm|giải|trả\s+lời|viết)\s+(?:bài\s+)?(?:trắc\s+nghiệm|tự\s+luận|câu\s+hỏi|bài\s+tập)(?:\s+(?:trên|ở|tại)\s+(.+))?$",
        clean,
        re.IGNORECASE,
    )
    if not m:
        return None

    target_part = (m.group(1) or "").strip().rstrip(".!?")
    site = _resolve_site_or_domain(target_part) if target_part else None
    if site is not None:
        r_open = run_tool("fast_desktop", "open_edge_url", {"url": site[0]})
        if r_open.get("cancelled_by_user") or r_open.get("needs_confirmation"):
            return r_open
        time.sleep(2.4)

    b_proc = _detect_active_browser_proc(run_tool)
    r_read = run_tool("fast_desktop", "uia_read", {"process": b_proc, "content_only": True, "include_controls": True, "max_items": 180})
    raw_txt = str(r_read.get("text") or "").strip()
    if not raw_txt:
        return {"ok": False, "tier": 1, "route": "fast_desktop", "reply": "Không đọc được nội dung câu hỏi trên trang Edge đang mở.", "result": r_read}

    is_quiz = word_match(low, r"trắc\s+nghiệm")
    prompt = (
        f"Dựa trên nội dung trang web dưới đây, hãy chọn chính xác đáp án trắc nghiệm (ghi rõ Câu + Đáp án đúng + giải thích ngắn 1 câu)."
        if is_quiz
        else f"Dựa trên đề bài trên trang web dưới đây, hãy viết bài trả lời tự luận mạch lạc bằng Tiếng Việt."
    )
    if deep_solve_fn is not None:
        solved = deep_solve_fn(f"{clean}\n{prompt}", raw_txt)
        ans = str(solved.get("reply") or "").strip()
        if ans:
            _copy_clipboard(ans)
        return {
            "ok": bool(solved.get("ok", True)),
            "tier": solved.get("tier", 2),
            "route": solved.get("route", "local_agent"),
            "model_used": solved.get("model_used"),
            "reply": ans or "Đã đọc trang nhưng chưa giải được bài.",
            "result": r_read,
        }

    return {"ok": True, "tier": 1, "route": "fast_desktop", "reply": raw_txt[:800], "result": r_read}


def _frame_type_into_app(clean: str, low: str, run_tool) -> Optional[Dict[str, Any]]:
    """Frame: gõ/nhập/nhắn <nội dung> vào/trên <app>."""
    m = re.search(
        r"^(?:hãy\s+)?(?:gõ|nhập|viết|nhắn)\s+[\"']?(.+?)[\"']?\s+(?:vào|trên|trong|ở)\s+(?:app|ứng\s+dụng|cửa\s+sổ)?\s*([a-zA-Z0-9\sÀ-ỹ_-]+)$",
        clean,
        re.IGNORECASE,
    )
    if not m or word_match(low, r"trắc\s+nghiệm|tự\s+luận|code|bài\s+tập"):
        return None
    txt = m.group(1).strip()
    app_raw = m.group(2).strip().rstrip(".!?")
    if word_match(app_raw, r"trang\s+này|web\s+này|màn\s+hình"):
        return None
    proc, label = resolve_app_entity(app_raw, default_proc="notepad")
    if proc == "msedge" and "edge" not in app_raw.lower():
        return None

    r_focus = run_tool("fast_desktop", "window_control", {"process": proc, "action": "focus"})
    if r_focus.get("cancelled_by_user") or r_focus.get("needs_confirmation"):
        return r_focus
    if not r_focus.get("ok"):
        return {"ok": False, "tier": 1, "route": "fast_desktop", "reply": f"Không thấy cửa sổ {label} để nhập chữ.", "result": r_focus}

    press_enter = word_match(low, r"^nhắn|gửi")
    r_type = run_tool("fast_desktop", "type_unicode_text", {"process": proc, "text": txt, "press_enter": press_enter})
    if r_type.get("cancelled_by_user") or r_type.get("needs_confirmation"):
        return r_type
    return {"ok": bool(r_type.get("ok", True)), "tier": 1, "route": "fast_desktop", "reply": f"Đã nhập '{txt}' vào {label}.", "result": r_type}


def _frame_youtube_gemini_summarize(
    clean: str,
    low: str,
    run_tool,
    summarize_fn: Optional[Callable[[str, str], str]] = None,
) -> Optional[Dict[str, Any]]:
    if not (word_match(low, r"youtube|ytb") and word_match(low, r"tóm\s*tắt|summarize") and word_match(low, r"video|gemini|nút")):
        return None

    idx_num = _extract_nth_video(low)
    steps_done: List[str] = []

    wins_res = run_tool("fast_desktop", "list_windows", {})
    has_yt_tab = any(
        "youtube" in str(w.get("title") or "").lower() and "msedge" in str(w.get("process") or "").lower()
        for w in (wins_res.get("windows") or [])
    )
    if not has_yt_tab:
        r_yt = run_tool("fast_desktop", "open_edge_url", {"url": "https://www.youtube.com"})
        if r_yt.get("cancelled_by_user") or r_yt.get("needs_confirmation"):
            return r_yt
        steps_done.append("mở YouTube")
        time.sleep(2.4)

    r_vid = run_tool("fast_desktop", "uia_click", {"process": "msedge", "role": "video", "content_only": True, "index": max(0, idx_num - 1)})
    if r_vid.get("cancelled_by_user") or r_vid.get("needs_confirmation"):
        return r_vid
    if not r_vid.get("ok"):
        return {
            "ok": False,
            "tier": 1,
            "route": "fast_desktop",
            "reply": f"Đã mở YouTube nhưng chưa bấm được video thứ {idx_num} ({r_vid.get('error') or 'không thấy danh sách video'}).",
            "result": r_vid,
        }
    steps_done.append(f"chọn video thứ {idx_num}")
    time.sleep(2.8)

    gem_btn_hit = None
    for btn_name in ("Tóm tắt", "Summarize", "Ask Gemini", "Gemini", "Tóm tắt video"):
        chk = run_tool("fast_desktop", "uia_click", {"process": "msedge", "name": btn_name, "content_only": False})
        if chk.get("ok"):
            gem_btn_hit = btn_name
            steps_done.append(f"nhấn nút '{btn_name}'")
            time.sleep(4.2)
            break

    read_res = run_tool("fast_desktop", "uia_read", {"process": "msedge", "content_only": True, "max_items": 140})
    raw_txt = str(read_res.get("text") or "").strip()

    if gem_btn_hit:
        summary = summarize_fn("Tóm tắt ngắn gọn nội dung từ bảng Gemini trên trang này", raw_txt) if (summarize_fn and raw_txt) else raw_txt[:900]
        return {
            "ok": True,
            "tier": 1,
            "route": "fast_desktop",
            "reply": summary or f"Đã thực hiện: {', '.join(steps_done)}.",
            "steps_executed": len(steps_done) + 1,
            "result": read_res,
        }

    fallback_sum = summarize_fn("Tóm tắt tiêu đề & mô tả video đang mở trên trang", raw_txt) if (summarize_fn and raw_txt) else ""
    note = f"Đã {', '.join(steps_done)}, nhưng không tìm thấy nút 'Gemini / Tóm tắt' hiển thị trên cửa sổ Edge để bấm."
    if fallback_sum:
        note += f"\n\nTóm tắt nhanh thông tin video trên trang:\n{fallback_sum}"
    return {"ok": False, "tier": 1, "route": "fast_desktop", "reply": note, "result": read_res}


def _frame_party_mode(clean: str, low: str, run_tool) -> Optional[Dict[str, Any]]:
    is_party = bool(
        word_match(low, r"party\s*(?:mode|mốt|mood)|chế\s*độ\s*party")
        or re.search(r"^(?:bật|mở|vào|chạy|kích\s*hoạt)\s+party(?:\s+(?:mode|mốt|mood))?[.!?]?$", low, re.IGNORECASE)
        or re.search(r"^party[.!?]?$", low, re.IGNORECASE)
    )
    if not is_party:
        return None

    wins_info = run_tool("fast_desktop", "list_windows", {}).get("windows") or []
    open_procs = {str(w.get("process") or "").lower() for w in wins_info}
    browser_app = "chrome" if ("chrome" in open_procs and "msedge" not in open_procs) else "msedge"
    browser_label = "Google Chrome" if browser_app == "chrome" else "Microsoft Edge"

    r_steam = run_tool("fast_desktop", "launch_app", {"app": "steam", "wait_timeout_ms": 6000, "window_action": "focus"})
    if r_steam.get("cancelled_by_user") or r_steam.get("needs_confirmation"):
        return r_steam

    r_browser = run_tool("fast_desktop", "launch_app", {"app": browser_app, "wait_timeout_ms": 5000, "window_action": "focus"})
    if r_browser.get("cancelled_by_user") or r_browser.get("needs_confirmation"):
        return r_browser

    r_discord = run_tool(
        "fast_desktop",
        "launch_app",
        {"app": "discord", "monitor": 2, "window_action": "maximize", "wait_timeout_ms": 9500},
    )
    if r_discord.get("cancelled_by_user") or r_discord.get("needs_confirmation"):
        return r_discord

    if r_discord.get("ok", True) and (not r_discord.get("action_applied") or not r_discord.get("window_found")):
        time.sleep(0.7)
        r_win = run_tool("fast_desktop", "window_control", {"process": "Discord", "action": "maximize", "monitor": 2})
        if r_win.get("cancelled_by_user") or r_win.get("needs_confirmation"):
            return r_win

    ok_all = bool(r_steam.get("ok", True)) and bool(r_browser.get("ok", True)) and bool(r_discord.get("ok", True))
    return {
        "ok": ok_all,
        "tier": 1,
        "route": "fast_desktop",
        "reply": f"Đã bật Party Mode: mở Steam, {browser_label} và Discord toàn màn hình ở màn phụ.",
        "result": {
            "steam": r_steam,
            "browser": r_browser,
            "discord": r_discord,
        },
    }


def _close_matching_browser_tabs(
    run_tool: Callable[[str, str, Dict[str, Any]], Dict[str, Any]],
    target_label: str,
    *,
    prefer_latest: bool = False,
    close_all: bool = False,
) -> Dict[str, Any]:
    """Close matching tabs on Edge (via manage_edge_tabs) with fast Win32/UIA fallbacks for Chrome/Edge/other browsers."""
    tab_action = "close_latest_matching" if prefer_latest else "close_matching"
    tab_args: Dict[str, Any] = {"action": tab_action}
    if target_label:
        tab_args["match_title"] = target_label
    tab_r = run_tool("fast_desktop", "manage_edge_tabs", tab_args)
    if tab_r.get("cancelled_by_user") or tab_r.get("needs_confirmation"):
        return {"interrupt": tab_r}

    closed_n = int(tab_r.get("closed_count") or 0)
    edge_already_closed = closed_n > 0
    if closed_n == 0 and target_label and prefer_latest and not tab_r.get("only_one_tab"):
        tab_r2 = run_tool("fast_desktop", "manage_edge_tabs", {"action": "close_latest_matching", "match_title": ""})
        if tab_r2.get("cancelled_by_user") or tab_r2.get("needs_confirmation"):
            return {"interrupt": tab_r2}
        tab_r = tab_r2
        closed_n = int(tab_r.get("closed_count") or 0)
        edge_already_closed = closed_n > 0

    if (closed_n == 0 or close_all) and target_label and not tab_r.get("only_one_tab"):
        wins_r = run_tool("fast_desktop", "list_windows", {})
        win_list = wins_r.get("windows") if isinstance(wins_r, dict) else None
        browser_wins: List[Dict[str, Any]] = []
        if isinstance(win_list, list):
            browser_procs = ("msedge", "chrome", "brave", "browser", "coccoc", "firefox", "opera")
            for w in win_list:
                if not isinstance(w, dict):
                    continue
                proc_l = str(w.get("process") or "").lower()
                if edge_already_closed and "msedge" in proc_l:
                    continue
                title_l = str(w.get("title") or "").lower()
                # Skip standalone Edge PWAs (whose title lacks "edge") if manage_edge_tabs already skipped them or close_app handles them
                is_edge_pwa = ("msedge" in proc_l) and ("edge" not in title_l)
                if (
                    any(bp in proc_l for bp in browser_procs)
                    and not is_edge_pwa
                    and not w.get("minimized")
                    and int(w.get("width") or 0) >= 260
                ):
                    browser_wins.append(w)
            browser_wins.sort(
                key=lambda w: (
                    0 if w.get("focused") else 1,
                    0 if "msedge" in str(w.get("process") or "").lower() else 1,
                )
            )

        t_low = target_label.lower()
        fallback_details: List[Dict[str, Any]] = []
        for bw in browser_wins:
            if closed_n > 0 and not close_all:
                break
            b_title = str(bw.get("title") or "").lower()
            b_hwnd = str(bw.get("hwnd") or "").strip()
            if not b_hwnd or t_low not in b_title:
                continue
            hk = run_tool("fast_desktop", "send_hotkey", {"combo": "ctrl+w", "hwnd": b_hwnd})
            if hk.get("cancelled_by_user") or hk.get("needs_confirmation"):
                return {"interrupt": hk}
            if hk.get("ok"):
                closed_n += 1
                fallback_details.append({"hotkey": hk, "window": bw})

        if closed_n == 0 or close_all:
            for bw in browser_wins[:4]:
                if closed_n > 0 and not close_all:
                    break
                b_hwnd = str(bw.get("hwnd") or "").strip()
                if not b_hwnd:
                    continue
                attempts = 4 if close_all else 1
                for _ in range(attempts):
                    click_tab = run_tool("fast_desktop", "uia_click", {"hwnd": b_hwnd, "name": target_label, "role": "tab"})
                    if click_tab.get("cancelled_by_user") or click_tab.get("needs_confirmation"):
                        return {"interrupt": click_tab}
                    if not click_tab.get("ok"):
                        break
                    hk = run_tool("fast_desktop", "send_hotkey", {"combo": "ctrl+w", "hwnd": b_hwnd})
                    if hk.get("cancelled_by_user") or hk.get("needs_confirmation"):
                        return {"interrupt": hk}
                    if not hk.get("ok"):
                        break
                    closed_n += 1
                    fallback_details.append({"uia_click": click_tab, "hotkey": hk, "window": bw})
                    if not close_all:
                        break

        if fallback_details:
            return {
                "closed_count": closed_n,
                "only_one_tab": False,
                "raw": fallback_details[0] if len(fallback_details) == 1 else {"closed": fallback_details},
            }

    return {
        "closed_count": closed_n,
        "only_one_tab": bool(tab_r.get("only_one_tab")),
        "raw": tab_r,
    }


def try_daily_scenario(
    text: str,
    mcp: Any,
    summarize_fn: Optional[Callable[[str, str], str]] = None,
    tool_runner: _EXECUTION_TOOL_CB = None,
    deep_solve_fn: Optional[Callable[[str, str], Dict[str, Any]]] = None,
    recent_memory: Optional[List[Dict[str, Any]]] = None,
) -> Optional[Dict[str, Any]]:
    """Composable Intent-Slot Frame router covering everyday Windows/Web/App commands (<50ms, 0 MB VRAM)."""
    clean = str(text or "").strip()
    if not clean:
        return None
    clean = re.sub(r"\b(?:sreach|seach|serch|sớt)\b", "search", clean, flags=re.IGNORECASE)
    if len(clean) <= 85:
        clean = re.sub(r"\s*,\s+(?!(?:tìm(?:\s+kiếm)?|search)\b)", " ", clean, flags=re.IGNORECASE)
        clean = re.sub(r"\s+", " ", clean).strip()
    low = clean.lower()

    # Frame S: Hub Sleep / Hide Assistant to system tray (never put PC to sleep or guess apps)
    if re.search(
        r"^(?:(?:hey|ok|okay|hi|hello)\s+)?(?:(?:jarvis|luna|nova|alpha|sora|milo)\s+sleep(?:\s+now)?|sleep(?:\s+now)?(?:\s+(?:jarvis|luna|nova|alpha|sora|milo))?|(?:(?:jarvis|luna|nova|alpha|sora|milo)\s+)?go\s+to\s+sleep(?:\s+(?:jarvis|luna|nova|alpha|sora|milo))?|ngủ\s*đi(?:\s+(?:jarvis|luna|nova|alpha|sora|milo))?|(?:jarvis|luna|nova|alpha|sora|milo)\s+ngủ(?:\s*đi)?|tạm\s+ẩn(?:\s+(?:jarvis|luna|nova|alpha|sora|milo))?|ẩn\s+(?:jarvis|luna|nova|alpha|sora|milo|hub)(?:\s+xuống\s+khay)?|thu\s+gọn\s+(?:jarvis|luna|hub))[.!?]?$",
        low,
        re.IGNORECASE,
    ):
        return {
            "ok": True,
            "tier": 1,
            "route": "fast_desktop",
            "hub_sleep": True,
            "hubSleep": True,
            "reply": "Đã ẩn trợ lý xuống khay.",
        }

    def run_tool(srv: str, name: str, args: Dict[str, Any]) -> Dict[str, Any]:
        if tool_runner is not None:
            return tool_runner(srv, name, args)
        return mcp.execute_mcp_tool(srv, name, args)

    # Frame P: Party Mode -> Open Steam + Browser + Discord full on secondary monitor
    party_res = _frame_party_mode(clean, low, run_tool)
    if party_res is not None:
        return party_res

    # Frame A1: Multi-step YouTube -> pick Nth video -> Gemini summarize -> Hub
    yt_gem = _frame_youtube_gemini_summarize(clean, low, run_tool, summarize_fn=summarize_fn)
    if yt_gem is not None:
        return yt_gem

    # Frame A2: Quiz / Essay on webpage (uses Tier 3 API first if enabled, else Local 3B)
    quiz_res = _frame_quiz_or_essay(clean, low, run_tool, deep_solve_fn=deep_solve_fn)
    if quiz_res is not None:
        return quiz_res

    # Frame A3: Extract & copy web data to clipboard + show snippet
    copy_web = _frame_web_extract_copy(clean, low, run_tool)
    if copy_web is not None:
        return copy_web

    # Do not hijack generic multi-step/coding prompts
    if word_match(low, r"rồi|sau\s+đó|trắc\s+nghiệm|tự\s+luận|viết|soạn|phân\s+tích|hình\s+ảnh"):
        return None
    if word_match(low, r"tóm\s+tắt") and not word_match(low, r"^(?:đọc|tóm\s+tắt)\s+(?:trang\s+này|màn\s+hình|web\s+này|nội\s+dung\s+này)$"):
        return None

    # Frame B: Discord mic ("Tắt âm") & headphones/deafen ("Tắt tiếng")
    if word_match(low, r"discord|dis") and word_match(low, r"mic|micro|micrô|tai\s*nghe|loa|deafen|tắt\s*âm|bật\s*âm|mở\s*âm|tắt\s*tiếng|bật\s*tiếng|mở\s*tiếng|mute|unmute"):
        is_deafen = word_match(low, r"tai\s*nghe|deafen|loa|tắt\s*tiếng|bật\s*tiếng|mở\s*tiếng") and not word_match(low, r"mic|micro|micrô")
        btn_label = "Tắt tiếng" if is_deafen else "Tắt âm"
        alt_label = "Deafen" if is_deafen else "Mute"
        noun_vi = "tai nghe/loa Discord" if is_deafen else "mic Discord"
        low_no_undo = re.sub(r"\b(?:bỏ\s+tắt|bỏ\s+mute|ngừng\s+tắt|hết\s+tắt)\b", "unmute", low)
        want_off = word_match(low_no_undo, r"tắt\s*(?:mic|micro|micrô|âm|tiếng|tai\s*nghe|loa)|mute|deafen")
        want_on = word_match(low_no_undo, r"bật|mở|unmute") and not want_off

        used_label = btn_label
        inspect = run_tool("fast_desktop", "uia_click", {"process": "Discord", "name": btn_label, "role": "button", "exact": True, "dry_run": True})
        if not inspect.get("ok"):
            inspect_alt = run_tool("fast_desktop", "uia_click", {"process": "Discord", "name": alt_label, "role": "button", "exact": True, "dry_run": True})
            if inspect_alt.get("ok"):
                inspect = inspect_alt
                used_label = alt_label
        if not inspect.get("ok"):
            # Wake Discord Electron Chromium Accessibility tree before launching/retrying
            wins_now = run_tool("fast_desktop", "list_windows", {}).get("windows") or []
            discord_win = next((w for w in wins_now if "discord" in str(w.get("process") or "").lower()), None)
            if not discord_win or discord_win.get("minimized"):
                run_tool("fast_desktop", "launch_app", {"app": "discord"})
                time.sleep(1.0)
            run_tool(
                "agent_desktop",
                "desktop_snapshot",
                {"app": "Discord", "interactive_only": True, "compact": True, "force_electron_a11y": True},
            )
            # Electron/Chromium can take ~1.5-2.5s after first force_electron_a11y to publish voice-bar UIA nodes
            for delay_s in (0.85, 0.95, 1.0):
                time.sleep(delay_s)
                inspect = run_tool("fast_desktop", "uia_click", {"process": "Discord", "name": btn_label, "role": "button", "exact": False, "dry_run": True})
                if inspect.get("ok"):
                    used_label = btn_label
                    break
                inspect_alt = run_tool("fast_desktop", "uia_click", {"process": "Discord", "name": alt_label, "role": "button", "exact": False, "dry_run": True})
                if inspect_alt.get("ok"):
                    inspect = inspect_alt
                    used_label = alt_label
                    break
        if not inspect.get("ok"):
            return {"ok": False, "tier": 1, "route": "fast_desktop", "reply": f"Không tìm thấy nút {btn_label} trong Discord.", "result": inspect}
        matches = inspect.get("matches") or []
        toggle_state = str((matches[0] if matches else {}).get("toggle_state", "")).lower()
        if (toggle_state == "on" and want_on) or (toggle_state == "off" and not want_on) or not toggle_state:
            r = run_tool("fast_desktop", "uia_click", {"process": "Discord", "name": used_label, "role": "button", "exact": True, "restore_focus": True})
            if r.get("cancelled_by_user") or r.get("needs_confirmation"):
                return r
            ok_clk = bool(r.get("ok", True))
            return {
                "ok": ok_clk,
                "tier": 1,
                "route": "fast_desktop",
                "reply": f"Đã {'bật' if want_on else 'tắt'} {noun_vi}." if ok_clk else f"Chưa bấm được nút {used_label} trong Discord ({r.get('error') or ''}).",
                "result": r,
            }
        return {"ok": True, "tier": 1, "route": "fast_desktop", "reply": f"{noun_vi} đang ở đúng trạng thái yêu cầu."}

    # Frame B1.5: Discord Share Screen / Stream ("share màn hình", "stream màn hình", "chia sẻ màn hình")
    is_stream_cmd = word_match(low, r"share\s*màn\s*hình|stream\s*màn\s*hình|chia\s*sẻ\s*màn\s*hình|phát\s*trực\s*tiếp|go\s*live")
    if is_stream_cmd and ("discord" in low or word_match(low, r"stream|share|chia\s*sẻ")):
        m_num = re.search(r"(?:màn(?:\s*hình)?|screen)\s*(?:số\s*)?([12]|một|hai)", low)
        target_scr = 1
        if m_num:
            t_tok = m_num.group(1).lower()
            target_scr = 2 if t_tok in ("2", "hai") else 1

        def _find_and_click_ad(names: List[str], role: Optional[str] = None) -> Dict[str, Any]:
            for nm in names:
                f_args: Dict[str, Any] = {"app": "Discord", "name": nm}
                if role:
                    f_args["role"] = role
                f_res = run_tool("agent_desktop", "desktop_find", f_args)
                matches = ((f_res.get("data") or {}).get("matches") or []) if f_res.get("ok") else []
                ref = next((m.get("ref_id") for m in matches if m.get("ref_id")), None)
                if ref:
                    return run_tool("agent_desktop", "desktop_click", {"ref_id": ref})
            return {"ok": False, "error": f"Not found: {names}"}

        # 1. Focus Discord window
        run_tool("fast_desktop", "launch_app", {"app": "discord", "window_action": "focus"})
        time.sleep(0.35)

        # 2. Click 'Toàn màn hình' / 'Screens' tab; if not open yet, open modal via 'Chia Sẻ Màn Hình'
        r_tab = _find_and_click_ad(["Toàn màn hình", "Screens"], role="tab")
        if not r_tab.get("ok"):
            open_btn = run_tool("fast_desktop", "uia_click", {"process": "Discord", "name": "Chia Sẻ Màn Hình", "role": "button", "exact": True})
            if not open_btn.get("ok"):
                open_btn = run_tool("fast_desktop", "uia_click", {"process": "Discord", "name": "Share Your Screen", "role": "button", "exact": False})
            time.sleep(0.8)
            r_tab = _find_and_click_ad(["Toàn màn hình", "Screens"], role="tab")
        time.sleep(0.5)

        # 3. Click target screen (Màn hình 1 / Screen 1 / Màn hình 2 / Screen 2)
        r_scr = _find_and_click_ad([f"Màn hình {target_scr}", f"Screen {target_scr}", f"Display {target_scr}"])
        time.sleep(0.4)

        # 4. Click 'Phát trực tiếp' / 'Go Live'
        r_live = _find_and_click_ad(["Phát trực tiếp", "Go Live"], role="button")
        if not r_live.get("ok"):
            r_live = _find_and_click_ad(["Phát trực tiếp", "Go Live"])

        ok_flow = bool(r_live.get("ok") or r_scr.get("ok"))
        reply_txt = (
            f"Đã bắt đầu chia sẻ Màn hình {target_scr} trên Discord."
            if r_live.get("ok")
            else (
                f"Đã chọn Màn hình {target_scr} trên Discord (hãy kiểm tra nút Phát trực tiếp)."
                if r_scr.get("ok")
                else f"Đã mở hộp thoại chia sẻ màn hình trên Discord (tab={'OK' if r_tab.get('ok') else 'Chưa thấy'}, màn={'OK' if r_scr.get('ok') else 'Chưa thấy'})."
            )
        )
        return {
            "ok": ok_flow,
            "tier": 1,
            "route": "fast_desktop",
            "reply": reply_txt,
            "result": r_live if r_live.get("ok") else (r_scr if r_scr.get("ok") else r_tab),
        }

    # Frame B2: Generic click button inside any app/window
    btn_click = _frame_click_in_app(clean, low, run_tool)
    if btn_click is not None:
        return btn_click

    # Frame B3: Type / send text into any app
    type_res = _frame_type_into_app(clean, low, run_tool)
    if type_res is not None:
        return type_res

    # Frame C: Export Word note / Find text in page
    note_m = re.search(r"^(?:xuất\s+(?:file\s+)?word|lưu\s+ghi\s+chú)\s+(.+)$", clean, re.IGNORECASE)
    if note_m:
        note_body = note_m.group(1).strip()
        r = run_tool("fast_desktop", "export_document", {"filename": "jarvis-quick-note.docx", "title": "Ghi chú Jarvis", "content": note_body, "open_after": True})
        if r.get("cancelled_by_user") or r.get("needs_confirmation"):
            return r
        return {"ok": bool(r.get("ok", True)), "tier": 1, "route": "fast_desktop", "reply": "Đã xuất ghi chú ra file Word.", "result": r}

    find_page = re.search(r"^(?:tìm\s+chữ|ctrl\s*\+?\s*f)\s+[\"']?(.+?)[\"']?(?:\s+trên\s+trang)?$", clean, re.IGNORECASE)
    if find_page:
        kw = find_page.group(1).strip()
        b_proc = _detect_active_browser_proc(run_tool)
        run_tool("fast_desktop", "send_hotkey", {"combo": "ctrl+f", "process": b_proc})
        r_t = run_tool("fast_desktop", "type_unicode_text", {"process": b_proc, "text": kw, "press_enter": True})
        if r_t.get("cancelled_by_user") or r_t.get("needs_confirmation"):
            return r_t
        return {"ok": bool(r_t.get("ok", True)), "tier": 1, "route": "fast_desktop", "reply": f"Đã tìm chữ '{kw}' trên trang.", "result": r_t}

    # Frame D: Brightness slot
    pct_bright = re.search(r"(?:độ\s+sáng|màn\s+hình|brightness).*?(\d{1,3})\s*%?", low)
    if pct_bright and word_match(low, r"độ\s+sáng|brightness|chỉnh\s+sáng|đặt\s+sáng"):
        lvl = max(5, min(100, int(pct_bright.group(1))))
        r = run_tool("fast_desktop", "set_brightness", {"level": lvl})
        if r.get("cancelled_by_user") or r.get("needs_confirmation"):
            return r
        return {"ok": r.get("ok", True), "tier": 1, "route": "fast_desktop", "reply": f"Đã đặt độ sáng màn hình {lvl}%.", "result": r}
    if word_match(low, r"tăng\s+độ\s+sáng|sáng\s+màn\s+hình\s+lên|màn\s+hình\s+sáng\s+lên|brightness\s+up"):
        r = run_tool("fast_desktop", "set_brightness", {"delta": 15})
        if r.get("cancelled_by_user") or r.get("needs_confirmation"):
            return r
        return {"ok": r.get("ok", True), "tier": 1, "route": "fast_desktop", "reply": f"Đã tăng độ sáng ({r.get('brightness', '')}%).", "result": r}
    if word_match(low, r"giảm\s+độ\s+sáng|tối\s+màn\s+hình\s+lại|màn\s+hình\s+tối\s+lại|brightness\s+down"):
        r = run_tool("fast_desktop", "set_brightness", {"delta": -15})
        if r.get("cancelled_by_user") or r.get("needs_confirmation"):
            return r
        return {"ok": r.get("ok", True), "tier": 1, "route": "fast_desktop", "reply": f"Đã giảm độ sáng ({r.get('brightness', '')}%).", "result": r}

    # Frame E: Video Seek & Nth Video Pick
    if word_match(low, r"tua|seek|nhảy\s+tới|kéo\s+video"):
        parsed_seek = _parse_seek_seconds(low)
        if parsed_seek is not None:
            is_delta, sec = parsed_seek
            b_proc = _detect_active_browser_proc(run_tool, prefer_title_kw="youtube")
            args: Dict[str, Any] = {"process": b_proc, "role": "slider", "content_only": True}
            args["slider_delta" if is_delta else "slider_value"] = sec
            r = run_tool("fast_desktop", "uia_click", args)
            if r.get("cancelled_by_user") or r.get("needs_confirmation"):
                return r
            return {"ok": r.get("ok", True), "tier": 1, "route": "fast_desktop", "reply": "Đã tua video theo yêu cầu.", "result": r}

    nth_vid = re.search(
        r"^(?:hãy\s+)?(?:chọn|mở|bấm(?:\s+vào)?|nhấn(?:\s+vào)?)\s+(?:(1|một)\s+video|video(?:\s+(?:(?:trên\s+)?youtube|này))?\s*(?:(đầu(?:\s*tiên)?|thứ\s*nhất)|thứ\s*([1-9]|một|hai|ba|tư|bốn|năm)))(?:\s+(?:tính\s+từ|từ|ở|bên|phía|hàng|cột|nào\s*đó|gì\s*đó).*?)?[.!?]?$",
        low,
        re.IGNORECASE,
    )
    nth_side_only = None
    if not nth_vid:
        nth_side_only = re.search(
            r"^(?:hãy\s+)?(?:chọn|mở|bấm(?:\s+vào)?|nhấn(?:\s+vào)?)\s+video(?:\s+(?:(?:trên\s+)?youtube|này))?\s+(?:(?:tính\s+từ|từ|ở|ngoài\s+cùng)\s+)?(?:bên\s+trái|góc\s+trái|trái|trên\s+cùng)(?:\s+(?:thứ\s*([1-9]|một|hai|ba|tư|bốn|năm)|sang(?:\s+phải)?|qua(?:\s+phải)?|vào))*[.!?]?$",
            low,
            re.IGNORECASE,
        )
    if nth_vid or nth_side_only:
        wmap = {"một": 1, "hai": 2, "ba": 3, "tư": 4, "bốn": 4, "năm": 5}
        if nth_vid:
            idx_num = 1 if (nth_vid.group(1) or nth_vid.group(2)) else int(wmap.get(nth_vid.group(3) or "1", nth_vid.group(3) or 1))
        else:
            tok_side = nth_side_only.group(1) if nth_side_only else None
            idx_num = int(wmap.get(tok_side or "1", tok_side or 1)) if tok_side else 1
        wins_info = run_tool("fast_desktop", "list_windows", {}).get("windows") or []
        browser_wins = [w for w in wins_info if str(w.get("process") or "").lower() in ("msedge", "chrome")]
        yt_win = next((w for w in browser_wins if "youtube" in str(w.get("title") or "").lower()), None)
        if yt_win and yt_win.get("process"):
            b_proc = str(yt_win["process"])
        else:
            open_procs = {str(w.get("process") or "").lower() for w in browser_wins}
            b_proc = "chrome" if ("chrome" in open_procs and "msedge" not in open_procs) else "msedge"
            if b_proc == "msedge":
                sw_yt = run_tool("fast_desktop", "manage_edge_tabs", {"action": "switch", "match_title": "YouTube"})
                if sw_yt.get("ok") and sw_yt.get("switched"):
                    time.sleep(0.35)
        r = run_tool("fast_desktop", "uia_click", {"process": b_proc, "role": "video", "content_only": True, "index": max(0, idx_num - 1)})
        if r.get("cancelled_by_user") or r.get("needs_confirmation"):
            return r
        ok_click = bool(r.get("ok", True))
        return {
            "ok": ok_click,
            "tier": 1,
            "route": "fast_desktop",
            "reply": f"Đã chọn video thứ {idx_num} trên tab đang mở." if ok_click else f"Chưa tìm thấy video thứ {idx_num} trên tab đang mở ({r.get('error') or ''}).",
            "result": r,
        }

    # Explicit search inside YouTube phrasing like "Mở video YouTube, tìm kiếm chúc nhân" or "Mở tab YouTube search ..."
    yt_vid_search = re.search(
        r"^(?:hãy\s+)?(?:mở|tìm|bật)\s+(?:(?:1|một)\s+)?(?:tab\s+|video\s+)?(?:trên\s+)?youtube[,:\s]+(?:tìm(?:\s+kiếm)?|search)\s+(.+?)[.!?]?$",
        clean,
        re.IGNORECASE,
    )
    if yt_vid_search:
        q = yt_vid_search.group(1).strip()
        if q:
            r = run_tool("fast_desktop", "open_edge_url", {"youtube_search": q})
            if r.get("cancelled_by_user") or r.get("needs_confirmation"):
                return r
            return {"ok": True, "tier": 1, "route": "fast_desktop", "reply": f"Đã tìm trên YouTube: {q}.", "result": r}

    # Open/play video about a topic on YouTube: check current tab first, else search + click top video
    pick_vid = re.search(
        r"^(?:hãy\s+)?(?:chọn|bấm(?:\s+vào)?|nhấn(?:\s+vào)?|mở|xem)\s+video(?:\s+(?:trên\s+)?youtube)?\s+(?:(của\s+kênh|của|kênh|về|chủ\s+đề)\s+)?(.+?)[.!?]?$",
        clean,
        re.IGNORECASE,
    )
    if pick_vid and not word_match(low, r"tìm\s*kiếm|trên\s+youtube\s+tìm|đầu\s*tiên|thứ\s*[1-9]|thứ\s*(?:nhất|một|hai|ba|tư|bốn|năm)|tính\s+từ|từ\s+trái|bên\s+trái|bên\s+phải"):
        prep = (pick_vid.group(1) or "").lower()
        is_channel_pick = "kênh" in prep or "của" in prep
        is_open_topic_cmd = word_match(low, r"^mở|^xem") and (word_match(low, r"youtube") or "về" in prep)
        kw = re.sub(r"^(?:(?:trên\s+)?youtube\s+|của\s+kênh|kênh|của|về|chủ\s+đề|có\s+chữ|tên\s+là)\s+", "", pick_vid.group(2).strip(), flags=re.IGNORECASE).strip()
        kw = re.sub(r"^(?:về|của\s+kênh|của|kênh)\s+", "", kw, flags=re.IGNORECASE).strip()
        if kw and kw.lower() != "youtube":
            wins_info = run_tool("fast_desktop", "list_windows", {}).get("windows") or []
            open_procs = {str(w.get("process") or "").lower() for w in wins_info}
            b_proc = "chrome" if ("chrome" in open_procs and "msedge" not in open_procs) else "msedge"
            browser_wins = [w for w in wins_info if str(w.get("process") or "").lower() in ("msedge", "chrome")]
            in_open_tab_kw = any(kw.lower() in str(w.get("title") or "").lower() for w in browser_wins)
            has_yt_tab = any("youtube" in str(w.get("title") or "").lower() for w in browser_wins)

            if b_proc == "msedge" and not in_open_tab_kw:
                sw_res = run_tool("fast_desktop", "manage_edge_tabs", {"action": "switch", "match_title": kw})
                if sw_res.get("ok") and sw_res.get("switched"):
                    in_open_tab_kw = True
                    time.sleep(0.35)

            # 1) Try matching video cards inside CURRENT open tab (never opens a new tab)
            r_vid = run_tool("fast_desktop", "uia_click", {"process": b_proc, "role": "video", "name": kw, "content_only": True})
            if r_vid.get("cancelled_by_user") or r_vid.get("needs_confirmation"):
                return r_vid
            if r_vid.get("ok"):
                return {"ok": True, "tier": 1, "route": "fast_desktop", "reply": f"Đã chọn video '{kw}' trong tab đang mở.", "result": r_vid}

            # 2) On channel/search pages matching kw (e.g. "Trúc Nhân - YouTube"), pick top video in that tab
            if in_open_tab_kw and (has_yt_tab or browser_wins):
                r_first = run_tool("fast_desktop", "uia_click", {"process": b_proc, "role": "video", "content_only": True, "index": 0})
                if r_first.get("cancelled_by_user") or r_first.get("needs_confirmation"):
                    return r_first
                if r_first.get("ok"):
                    return {"ok": True, "tier": 1, "route": "fast_desktop", "reply": f"Đã chọn video của {kw} ngay trên tab đang mở.", "result": r_first}

            # 3) Try matching visible link inside current tab
            r_any = run_tool("fast_desktop", "uia_click", {"process": b_proc, "name": kw, "content_only": True})
            if r_any.get("cancelled_by_user") or r_any.get("needs_confirmation"):
                return r_any
            if r_any.get("ok"):
                return {"ok": True, "tier": 1, "route": "fast_desktop", "reply": f"Đã bấm video '{kw}' trong tab hiện tại.", "result": r_any}

            # 4) If topic/channel video is not on current tab, search YouTube & play first result
            if is_open_topic_cmd or is_channel_pick:
                r_search = run_tool("fast_desktop", "open_edge_url", {"youtube_search": kw})
                if r_search.get("cancelled_by_user") or r_search.get("needs_confirmation"):
                    return r_search
                time.sleep(2.4)
                r_play = run_tool("fast_desktop", "uia_click", {"process": "msedge", "role": "video", "content_only": True, "index": 0})
                if r_play.get("ok"):
                    return {"ok": True, "tier": 1, "route": "fast_desktop", "reply": f"Đã tìm và mở video về '{kw}' trên YouTube.", "result": r_play}
                return {"ok": True, "tier": 1, "route": "fast_desktop", "reply": f"Đã tìm video về '{kw}' trên YouTube.", "result": r_search}

    # Frame F: Window Move / Monitor Switch / Layout Frame
    win_frame_res = _frame_window_and_monitor(clean, low, run_tool)
    if win_frame_res is not None:
        return win_frame_res

    # Frame G: Browser Tab Frame
    if word_match(low, r"tab") and word_match(low, r"giữ\s*lại|các\s*tab\s*khác|tab\s*khác|còn\s*lại") and word_match(low, r"tắt|đóng|xóa"):
        keep = next((label for term, (_, label) in KNOWN_WEBSITES.items() if word_match(low, re.escape(term))), "")
        args = {"action": "close_others"}
        if keep:
            args["keep_title"] = keep
        r = run_tool("fast_desktop", "manage_edge_tabs", args)
        if r.get("cancelled_by_user") or r.get("needs_confirmation"):
            return r
        return {"ok": r.get("ok", True), "tier": 1, "route": "fast_desktop", "reply": f"Đã giữ lại tab {keep or 'hiện tại'} và đóng các tab khác.", "result": r}

    tab_switch = re.search(r"^(?:chuyển\s+(?:sang|qua)|qua|sang|bật)\s+tab\s+(.+)$", clean, re.IGNORECASE)
    if tab_switch:
        target_tab = tab_switch.group(1).strip().rstrip(".!?")
        if target_tab and not word_match(low, r"mới|trống"):
            r = run_tool("fast_desktop", "manage_edge_tabs", {"action": "switch", "match_title": target_tab})
            if r.get("cancelled_by_user") or r.get("needs_confirmation"):
                return r
            switched_ok = bool(r.get("ok") and (r.get("switched") or int(r.get("tab_index") or -1) >= 0))
            if not switched_ok:
                b_proc = _detect_active_browser_proc(run_tool)
                clk = run_tool("fast_desktop", "uia_click", {"process": b_proc, "name": target_tab, "role": "tab"})
                if clk.get("cancelled_by_user") or clk.get("needs_confirmation"):
                    return clk
                if clk.get("ok"):
                    return {"ok": True, "tier": 1, "route": "fast_desktop", "reply": f"Đã chuyển sang tab {target_tab}.", "result": clk}
            return {
                "ok": switched_ok,
                "tier": 1,
                "route": "fast_desktop",
                "reply": f"Đã chuyển sang tab {target_tab}." if switched_ok else f"Không tìm thấy tab {target_tab} đang mở để chuyển.",
                "result": r,
            }

    if (word_match(low, r"(?:mở|bật|tạo)\s+(?:một\s+|1\s+)?tab\s+(?:mới|trống)") or word_match(low, r"new\s+tab")) and not any(
        word_match(low, re.escape(s)) for s in KNOWN_WEBSITES
    ):
        r = run_tool("fast_desktop", "open_edge_url", {"new_tab": True})
        if r.get("cancelled_by_user") or r.get("needs_confirmation"):
            return r
        return {"ok": r.get("ok", True), "tier": 1, "route": "fast_desktop", "reply": "Đã mở tab mới trên Edge.", "result": r}

    # Frame G2: Close specific / newly-opened tab, BOTH tab+app, & short-term memory pronoun resolution
    is_close_cmd = word_match(low, r"tắt|đóng|thoát|close|kill") and not word_match(
        low, r"bỏ\s+tắt|đừng\s+tắt|không\s+tắt|hủy\s+tắt|thôi\s+tắt|unmute"
    )
    has_recency_or_pronoun = word_match(low, r"mới\s*mở|vừa\s*mở|vừa\s*bật|mới\s*bật|mới\s*tạo|vừa\s*tạo|mới\s*nhất|cuối\s*cùng|lúc\s*nãy|nó|cái\s*(?:đó|này|vừa|mới)")
    wants_both_or_all = word_match(low, r"cả\s*(?:hai|2)|hết|tất\s*cả|toàn\s*bộ") or (
        word_match(low, r"tab") and word_match(low, r"app|ứng\s*dụng|phần\s*mềm")
    )
    explicit_site_label = next((label for term, (_, label) in KNOWN_WEBSITES.items() if word_match(low, re.escape(term))), "")
    explicit_app_match = next(((alias, label) for term, (alias, label) in KNOWN_APPS.items() if word_match(low, re.escape(term))), None)
    if is_close_cmd and wants_both_or_all and (explicit_site_label or explicit_app_match or has_recency_or_pronoun):
        now_ts = time.time()
        mem_items = [
            m for m in reversed(recent_memory or [])
            if isinstance(m, dict) and (now_ts - float(m.get("ts") or now_ts)) <= 600.0
        ]
        last_tab_mem = next((m for m in mem_items if m.get("target_kind") == "tab" and m.get("target_label")), None)
        last_app_mem = next((m for m in mem_items if m.get("target_kind") == "app" and m.get("target_alias")), None)

        site_label = explicit_site_label or (str(last_tab_mem["target_label"]) if last_tab_mem else "")
        if explicit_app_match:
            app_alias, app_label = explicit_app_match
        elif last_app_mem:
            app_alias = str(last_app_mem["target_alias"])
            app_label = str(last_app_mem.get("target_label") or app_alias)
        else:
            app_alias, app_label = "", ""

        # If user named a dual web+app target (e.g. "đóng cả hai cái facebook mới mở"), ensure both targets are tried
        if site_label and not app_alias:
            matched_app = next(
                ((a, lbl) for _, (a, lbl) in KNOWN_APPS.items() if a.lower() == site_label.lower() or site_label.lower() in lbl.lower()),
                None,
            )
            if matched_app:
                app_alias, app_label = matched_app
        if app_alias and not site_label:
            matched_site = next(
                (lbl for t, (_, lbl) in KNOWN_WEBSITES.items() if t == app_alias.lower() or lbl.lower() == app_alias.lower()),
                "",
            )
            site_label = matched_site

        app_closed_n = 0
        app_res: Dict[str, Any] = {}
        if app_alias:
            app_res = run_tool("fast_desktop", "close_app", {"app": app_alias})
            if app_res.get("cancelled_by_user") or app_res.get("needs_confirmation"):
                return app_res
            app_closed_n = int(app_res["windows_closed"]) if "windows_closed" in app_res else (1 if app_res.get("ok") else 0)

        tab_res: Dict[str, Any] = {"closed_count": 0, "only_one_tab": False, "raw": {}}
        if site_label:
            tab_res = _close_matching_browser_tabs(run_tool, site_label, prefer_latest=False, close_all=True)
            if "interrupt" in tab_res:
                return tab_res["interrupt"]

        tab_closed_n = int(tab_res.get("closed_count") or 0)
        if app_closed_n > 0 and tab_closed_n > 0:
            return {
                "ok": True,
                "tier": 1,
                "route": "fast_desktop",
                "reply": f"Đã đóng cả {app_label} và tab {site_label}.",
                "result": {"app": app_res, "tabs": tab_res.get("raw")},
            }
        if app_closed_n > 0:
            extra = (
                f" (tab {site_label} đang là tab duy nhất trên Edge nên giữ nguyên trình duyệt)"
                if tab_res.get("only_one_tab")
                else (f" (không thấy tab {site_label} đang mở)" if site_label else "")
            )
            return {
                "ok": True,
                "tier": 1,
                "route": "fast_desktop",
                "reply": f"Đã đóng {app_label}{extra}.",
                "result": {"app": app_res, "tabs": tab_res.get("raw")},
            }
        if tab_closed_n > 0:
            extra = f" (không thấy {app_label} đang mở)" if app_label else ""
            return {
                "ok": True,
                "tier": 1,
                "route": "fast_desktop",
                "reply": f"Đã đóng tab {site_label}{extra}.",
                "result": {"app": app_res, "tabs": tab_res.get("raw")},
            }
        if tab_res.get("only_one_tab"):
            return {
                "ok": False,
                "tier": 1,
                "route": "fast_desktop",
                "reply": f"Edge hiện chỉ còn 1 tab duy nhất ({site_label or 'hiện tại'}); hãy nói 'tắt trình duyệt' nếu muốn đóng cả Edge.",
                "result": tab_res.get("raw") or {},
            }
        target_desc = site_label or app_label or "vừa mở"
        return {
            "ok": False,
            "tier": 1,
            "route": "fast_desktop",
            "reply": f"Không thấy {target_desc} (cả app lẫn tab) đang mở để đóng.",
            "result": {"app": app_res, "tabs": tab_res.get("raw")},
        }

    if is_close_cmd and (
        (word_match(low, r"tab") and (explicit_site_label or has_recency_or_pronoun))
        or (not explicit_site_label and word_match(low, r"^(?:tắt|đóng)\s+(?:cái\s+)?(?:vừa|mới)\s*(?:mở|bật)|^(?:tắt|đóng)\s+(?:nó|cái\s*đó|cái\s*này)(?:\s+(?:đi|lại))?$"))
        or (word_match(low, r"app|ứng\s*dụng") and has_recency_or_pronoun and not explicit_site_label)
    ):
        now_ts = time.time()
        mem_items = [
            m for m in reversed(recent_memory or [])
            if isinstance(m, dict) and (now_ts - float(m.get("ts") or now_ts)) <= 600.0
        ]
        last_tab_mem = next((m for m in mem_items if m.get("target_kind") == "tab" and m.get("target_label")), None)
        last_app_mem = next((m for m in mem_items if m.get("target_kind") == "app" and m.get("target_alias")), None)

        if (
            not explicit_site_label
            and not word_match(low, r"tab")
            and last_app_mem is not None
            and (last_tab_mem is None or float(last_app_mem.get("ts") or 0) >= float(last_tab_mem.get("ts") or 0))
        ):
            app_alias = str(last_app_mem["target_alias"])
            app_label = str(last_app_mem.get("target_label") or app_alias)
            r = run_tool("fast_desktop", "close_app", {"app": app_alias})
            if r.get("cancelled_by_user") or r.get("needs_confirmation"):
                return r
            closed_w = int(r["windows_closed"]) if "windows_closed" in r else (1 if r.get("ok") else 0)
            return {
                "ok": bool(closed_w > 0 or r.get("ok")),
                "tier": 1,
                "route": "fast_desktop",
                "reply": f"Đã tắt {app_label} vừa mở." if closed_w > 0 else f"Không thấy cửa sổ {app_label} đang mở để tắt.",
                "result": r,
            }

        target_label = explicit_site_label or (str(last_tab_mem["target_label"]) if last_tab_mem else "")
        single_tab_requested = word_match(low, r"\b(?:1|một)\s+tab\b")
        use_latest = bool(has_recency_or_pronoun or not explicit_site_label or single_tab_requested)
        tab_res = _close_matching_browser_tabs(run_tool, target_label, prefer_latest=use_latest, close_all=False)
        if "interrupt" in tab_res:
            return tab_res["interrupt"]
        closed_n = int(tab_res.get("closed_count") or 0)
        tab_r = tab_res.get("raw") if isinstance(tab_res.get("raw"), dict) else {}
        if closed_n > 0:
            desc = f"tab {target_label} vừa mở" if (target_label and use_latest) else (f"tab {target_label}" if target_label else "tab vừa mở")
            return {"ok": True, "tier": 1, "route": "fast_desktop", "reply": f"Đã đóng {desc}.", "result": tab_r}
        if tab_res.get("only_one_tab"):
            return {
                "ok": False,
                "tier": 1,
                "route": "fast_desktop",
                "reply": f"Edge hiện chỉ còn 1 tab duy nhất ({target_label or 'hiện tại'}); hãy nói 'tắt trình duyệt' nếu muốn đóng cả Edge.",
                "result": tab_r,
            }
        err_detail = f" ({tab_r.get('error')})" if (not tab_r.get("ok") and tab_r.get("error")) else ""
        return {
            "ok": False,
            "tier": 1,
            "route": "fast_desktop",
            "reply": f"Không tìm thấy tab {target_label or 'phù hợp'} đang mở trên Edge để đóng{err_detail}.",
            "result": tab_r,
        }

    # Frame H: Hotkey & Scroll & Read Page
    for pat, combo, repeat, reply_txt, target_proc in HOTKEY_FRAMES:
        if word_match(low, pat) or re.search(pat, low, re.IGNORECASE):
            hk_args: Dict[str, Any] = {"combo": combo}
            if repeat > 1:
                hk_args["repeat"] = repeat
            if target_proc:
                hk_args["process"] = _detect_active_browser_proc(run_tool, prefer_title_kw="youtube" if combo in ("c", "f", "t", "m") else "") if target_proc == "msedge" else target_proc
            r = run_tool("fast_desktop", "send_hotkey", hk_args)
            if r.get("cancelled_by_user") or r.get("needs_confirmation"):
                return r
            return {"ok": r.get("ok", True), "tier": 1, "route": "fast_desktop", "reply": reply_txt, "result": r}

    if word_match(low, r"cuộn\s+xuống|kéo\s+xuống|lướt\s+xuống|scroll\s+down"):
        explicit_app = any(word_match(low, re.escape(t)) for t in KNOWN_APPS)
        proc = resolve_app_entity(low)[0] if explicit_app else _detect_active_browser_proc(run_tool)
        r = run_tool("fast_desktop", "scroll_window", {"process": proc, "direction": "down"})
        if r.get("cancelled_by_user") or r.get("needs_confirmation"):
            return r
        return {"ok": r.get("ok", True), "tier": 1, "route": "fast_desktop", "reply": "Đã cuộn xuống.", "result": r}
    if word_match(low, r"cuộn\s+lên|kéo\s+lên|lướt\s+lên|scroll\s+up"):
        explicit_app = any(word_match(low, re.escape(t)) for t in KNOWN_APPS)
        proc = resolve_app_entity(low)[0] if explicit_app else _detect_active_browser_proc(run_tool)
        r = run_tool("fast_desktop", "scroll_window", {"process": proc, "direction": "up"})
        if r.get("cancelled_by_user") or r.get("needs_confirmation"):
            return r
        return {"ok": r.get("ok", True), "tier": 1, "route": "fast_desktop", "reply": "Đã cuộn lên.", "result": r}

    if word_match(low, r"^(?:đọc|tóm\s+tắt)\s+(?:trang\s+này|màn\s+hình|web\s+này|nội\s+dung\s+này)$"):
        proc = _detect_active_browser_proc(run_tool)
        r = run_tool("fast_desktop", "uia_read", {"process": proc, "content_only": True, "max_items": 120})
        raw_txt = str(r.get("text") or "")
        reply = summarize_fn(clean, raw_txt) if (summarize_fn and raw_txt.strip()) else (raw_txt[:400] or "Đã đọc nội dung trang.")
        return {"ok": r.get("ok", True), "tier": 1, "route": "fast_desktop", "reply": reply, "result": r}

    # Frame I: Search & Direct Domains
    yt_q = re.search(
        r"(?:tìm(?:\s+kiếm)?(?:\s+trên)?\s+youtube|"
        r"(?:mở|vào|bật)\s+(?:(?:1|một)\s+)?(?:tab\s+)?youtube(?:\s+(?:rồi|và))?\s+(?:tìm(?:\s+kiếm)?|search|gõ)|"
        r"mở\s+nhạc|bật\s+nhạc|nghe\s+bài|tìm\s+video)\s+(.+)$",
        clean,
        re.IGNORECASE,
    )
    if yt_q:
        q = yt_q.group(1).strip()
        r = run_tool("fast_desktop", "open_edge_url", {"youtube_search": q})
        if r.get("cancelled_by_user") or r.get("needs_confirmation"):
            return r
        return {"ok": r.get("ok", True), "tier": 1, "route": "fast_desktop", "reply": f"Đã tìm trên YouTube: {q}.", "result": r}

    gg_q = re.search(r"(?:tìm(?:\s+kiếm)?(?:\s+trên)?\s+google|tra\s+google|google\s+search|tra\s+cứu|^google)\s+(.+)$", clean, re.IGNORECASE)
    if gg_q:
        q = gg_q.group(1).strip()
        r = run_tool("fast_desktop", "open_edge_url", {"google_search": q})
        if r.get("cancelled_by_user") or r.get("needs_confirmation"):
            return r
        return {"ok": r.get("ok", True), "tier": 1, "route": "fast_desktop", "reply": f"Đã tìm Google: {q}.", "result": r}

    for pat, q, reply_txt in QUICK_SEARCH_QUERIES:
        if word_match(low, pat):
            r = run_tool("fast_desktop", "open_edge_url", {"google_search": q})
            if r.get("cancelled_by_user") or r.get("needs_confirmation"):
                return r
            return {"ok": r.get("ok", True), "tier": 1, "route": "fast_desktop", "reply": reply_txt, "result": r}

    if word_match(low, r"mở|vào|lên|truy\s*cập|open"):
        site = _resolve_site_or_domain(clean)
        if site is not None and not word_match(low, r"app|ứng\s*dụng|phần\s*mềm") and not any(
            word_match(low, re.escape(s)) for s in KNOWN_WEBSITES
        ):
            r = run_tool("fast_desktop", "open_edge_url", {"url": site[0]})
            if r.get("cancelled_by_user") or r.get("needs_confirmation"):
                return r
            return {"ok": r.get("ok", True), "tier": 1, "route": "fast_desktop", "reply": f"Đã mở {site[0]}.", "result": r}

    # Frame J: Close Apps & Matching Browser Tabs (never treat "bỏ tắt / đừng tắt / hủy tắt" as close_app)
    if word_match(low, r"tắt|đóng|thoát|close|kill") and not word_match(low, r"bỏ\s+tắt|đừng\s+tắt|không\s+tắt|hủy\s+tắt|thôi\s+tắt|unmute"):
        if word_match(low, r"trình\s*duyệt|browser") and not word_match(low, r"tab"):
            wins_info = run_tool("fast_desktop", "list_windows", {}).get("windows") or []
            open_procs = {str(w.get("process") or "").lower() for w in wins_info}
            targets = [p for p in ("msedge", "chrome", "brave", "coccoc", "browser", "firefox", "opera") if p in open_procs] or ["msedge"]
            last_r: Dict[str, Any] = {"ok": False}
            closed_names: List[str] = []
            for p_name in targets:
                rc = run_tool("fast_desktop", "close_app", {"app": p_name})
                if rc.get("cancelled_by_user") or rc.get("needs_confirmation"):
                    return rc
                last_r = rc
                if rc.get("ok") and int(rc.get("windows_closed") or 1) > 0:
                    closed_names.append(p_name)
            return {
                "ok": bool(closed_names or last_r.get("ok")),
                "tier": 1,
                "route": "fast_desktop",
                "reply": f"Đã đóng trình duyệt ({', '.join(closed_names)})." if closed_names else "Không thấy trình duyệt nào đang mở.",
                "result": last_r,
            }
        explicit_app_close = word_match(low, r"app|ứng\s*dụng|phần\s*mềm")
        if not word_match(low, r"tab"):
            for term, (alias, label) in KNOWN_APPS.items():
                if word_match(low, re.escape(term)):
                    r = run_tool("fast_desktop", "close_app", {"app": alias})
                    if r.get("cancelled_by_user") or r.get("needs_confirmation"):
                        return r
                    win_closed = int(r["windows_closed"]) if "windows_closed" in r else (1 if r.get("ok") else 0)
                    if not explicit_app_close and win_closed == 0 and term in KNOWN_WEBSITES:
                        site_label = KNOWN_WEBSITES[term][1]
                        tab_res = _close_matching_browser_tabs(run_tool, site_label, prefer_latest=False, close_all=False)
                        if "interrupt" in tab_res:
                            return tab_res["interrupt"]
                        if int(tab_res.get("closed_count") or 0) > 0:
                            return {"ok": True, "tier": 1, "route": "fast_desktop", "reply": f"Đã đóng tab {site_label}.", "result": tab_res.get("raw") or {}}
                        if tab_res.get("only_one_tab"):
                            return {
                                "ok": False,
                                "tier": 1,
                                "route": "fast_desktop",
                                "reply": f"Edge hiện chỉ còn 1 tab duy nhất ({site_label}); hãy nói 'tắt trình duyệt' nếu muốn đóng cả Edge.",
                                "result": tab_res.get("raw") or {"only_one_tab": True},
                            }
                    if win_closed > 0:
                        return {"ok": True, "tier": 1, "route": "fast_desktop", "reply": f"Đã đóng {label}.", "result": r}
                    return {"ok": False, "tier": 1, "route": "fast_desktop", "reply": f"Không thấy {label} đang mở để đóng.", "result": r}

        dyn_close = re.search(r"(?:tắt|đóng|thoát|close|kill)\s+(?:app|ứng\s*dụng|phần\s*mềm)\s+(.+)$", clean, re.IGNORECASE)
        if dyn_close:
            raw_target = re.sub(r"(?:\s+(?:giúp\s*tôi|dùm|nhé|nha|đi|lên|xuống))?[.!?]*$", "", dyn_close.group(1), flags=re.IGNORECASE).strip()
            if len(raw_target) >= 2:
                r = run_tool("fast_desktop", "close_app", {"app": raw_target})
                if r.get("cancelled_by_user") or r.get("needs_confirmation"):
                    return r
                return {"ok": r.get("ok", True), "tier": 1, "route": "fast_desktop", "reply": f"Đã đóng ứng dụng {raw_target}.", "result": r}

    # Frame K: Website & App Launch (skip when command also asks to message/type inside the app)
    if word_match(low, r"mở|bật|chạy|open|vào|lên|truy\s*cập|khởi\s*động") and not word_match(
        low, r"nhắn|gửi|gõ|nhập|chat|bấm\s+nút|chọn\s+(?:nhóm|kênh|người)"
    ):
        if word_match(low, r"trình\s*duyệt|browser") and not word_match(low, r"tab"):
            wins_info = run_tool("fast_desktop", "list_windows", {}).get("windows") or []
            open_procs = {str(w.get("process") or "").lower() for w in wins_info}
            b_app = "chrome" if ("chrome" in open_procs and "msedge" not in open_procs) else "msedge"
            r = run_tool("fast_desktop", "launch_app", {"app": b_app, "window_action": "focus"})
            if r.get("cancelled_by_user") or r.get("needs_confirmation"):
                return r
            return {"ok": bool(r.get("ok", True)), "tier": 1, "route": "fast_desktop", "reply": f"Đã mở trình duyệt ({b_app}).", "result": r}
        if word_match(low, r"tab") and word_match(low, r"app|ứng\s*dụng|phần\s*mềm") and not word_match(low, r"video"):
            site_hit = next(((url, label) for site_term, (url, label) in KNOWN_WEBSITES.items() if word_match(low, re.escape(site_term))), None)
            app_hit = next(((alias, label) for term, (alias, label) in KNOWN_APPS.items() if word_match(low, re.escape(term))), None)
            if site_hit and app_hit:
                url, site_label = site_hit
                app_alias, app_label = app_hit
                r_tab = run_tool("fast_desktop", "open_edge_url", {"url": url})
                if r_tab.get("cancelled_by_user") or r_tab.get("needs_confirmation"):
                    return r_tab
                r_app = run_tool("fast_desktop", "launch_app", {"app": app_alias})
                if r_app.get("cancelled_by_user") or r_app.get("needs_confirmation"):
                    return r_app
                tab_ok = bool(r_tab.get("ok", True))
                app_ok = bool(r_app.get("ok", True))
                opened_items: List[Dict[str, str]] = []
                parts_msg: List[str] = []
                if tab_ok:
                    opened_items.append({"kind": "tab", "label": site_label})
                    parts_msg.append(f"tab {site_label}")
                if app_ok:
                    opened_items.append({"kind": "app", "alias": app_alias, "label": app_label})
                    parts_msg.append(app_label)
                if tab_ok and app_ok:
                    reply_both = f"Đã mở cả {parts_msg[0]} và {parts_msg[1]}."
                elif tab_ok:
                    reply_both = f"Đã mở tab {site_label} (chưa mở được {app_label}: {r_app.get('error') or 'chưa cài đặt'})."
                elif app_ok:
                    reply_both = f"Đã mở {app_label} (chưa mở được tab {site_label})."
                else:
                    reply_both = f"Không mở được tab {site_label} hay {app_label}."
                return {
                    "ok": bool(tab_ok or app_ok),
                    "tier": 1,
                    "route": "fast_desktop",
                    "reply": reply_both,
                    "opened_items": opened_items,
                    "result": {"tab": r_tab, "app": r_app},
                }

        # Optional monitor placement on launch (e.g. "mở discord trên màn phụ", "mở youtube trên màn chính")
        launch_mon: Optional[int] = None
        launch_move_action: str = ""
        if word_match(low, r"màn(?:\s+hình)?\s*(?:phụ|số\s*2|2|hai|thứ\s*hai|nhỏ(?:\s*hơn)?|bé(?:\s*hơn)?)"):
            launch_mon = 2
            launch_move_action = "move_monitor_2"
        elif word_match(low, r"màn(?:\s+hình)?\s*(?:chính|số\s*1|1|một|thứ\s*nhất|lớn(?:\s*hơn)?|to(?:\s*hơn)?)"):
            launch_mon = 1
            launch_move_action = "move_monitor_1"
        elif word_match(low, r"màn(?:\s+hình)?\s*(?:còn\s*lại|bên\s*kia|kia|khác)"):
            launch_move_action = "move_other_monitor"

        if not word_match(low, r"app|ứng\s*dụng|phần\s*mềm") and not word_match(low, r"video"):
            for site_term, (url, label) in KNOWN_WEBSITES.items():
                if word_match(low, re.escape(site_term)):
                    if site_term in ("youtube", "ytb"):
                        m_extra = re.search(
                            r"(?:youtube|ytb)\s+(?:rồi\s+)?(?:(?:tìm(?:\s+kiếm)?|search|gõ|xem|nghe)\s+)?(.+)$",
                            clean,
                            re.IGNORECASE,
                        )
                        if m_extra:
                            extra_q = re.sub(r"\s*(?:đi|nhé|nha|giúp\s*tôi|dùm)[.!?]*$", "", m_extra.group(1), flags=re.IGNORECASE).strip()
                            if extra_q and not word_match(extra_q.lower(), r"màn|trên\s+màn|ở\s+màn|tab\s+mới|lên|đi"):
                                r = run_tool("fast_desktop", "open_edge_url", {"youtube_search": extra_q})
                                if r.get("cancelled_by_user") or r.get("needs_confirmation"):
                                    return r
                                return {"ok": r.get("ok", True), "tier": 1, "route": "fast_desktop", "reply": f"Đã tìm trên YouTube: {extra_q}.", "result": r}
                    r = run_tool("fast_desktop", "open_edge_url", {"url": url})
                    if r.get("cancelled_by_user") or r.get("needs_confirmation"):
                        return r
                    if launch_move_action and r.get("ok", True):
                        b_proc = _detect_active_browser_proc(run_tool)
                        run_tool("fast_desktop", "window_control", {"process": b_proc, "action": launch_move_action})
                    return {"ok": r.get("ok", True), "tier": 1, "route": "fast_desktop", "reply": f"Đã mở {label}.", "result": r}

        for term, (alias, label) in KNOWN_APPS.items():
            if word_match(low, re.escape(term)):
                launch_args: Dict[str, Any] = {"app": alias}
                if launch_mon is not None:
                    launch_args["monitor"] = launch_mon
                r = run_tool("fast_desktop", "launch_app", launch_args)
                if r.get("cancelled_by_user") or r.get("needs_confirmation"):
                    return r
                if launch_move_action == "move_other_monitor" and r.get("ok", True):
                    run_tool("fast_desktop", "window_control", {"process": alias, "action": "move_other_monitor"})
                ok = bool(r.get("ok", True))
                reply_msg = f"Đã mở {label}." if ok else f"Không mở được {label} ({r.get('error') or 'chưa cài đặt'})."
                return {"ok": ok, "tier": 1, "route": "fast_desktop", "reply": reply_msg, "result": r}

        dyn_open = re.search(r"(?:mở|bật|chạy|open|khởi\s*động)\s+(?:app|ứng\s*dụng|phần\s*mềm)\s+(.+)$", clean, re.IGNORECASE)
        if dyn_open:
            raw_app = re.sub(r"(?:\s+(?:giúp\s*tôi|dùm|nhé|nha|đi|lên))?[.!?]*$", "", dyn_open.group(1), flags=re.IGNORECASE).strip()
            if len(raw_app) >= 2:
                r = run_tool("fast_desktop", "launch_app", {"app": raw_app})
                if r.get("cancelled_by_user") or r.get("needs_confirmation"):
                    return r
                ok = bool(r.get("ok", True))
                reply_msg = f"Đã mở ứng dụng {raw_app}." if ok else f"Không tìm thấy ứng dụng {raw_app} trên máy."
                return {"ok": ok, "tier": 1, "route": "fast_desktop", "reply": reply_msg, "result": r}

    return None
