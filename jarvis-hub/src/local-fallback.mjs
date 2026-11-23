/**
 * Zero-Token Local Offline & Fast-Path Engine for Jarvis Desktop Hub.
 * Executes common Vietnamese & English desktop/browser commands via fast-desktop MCP
 * in <50ms (instant fast-path) or when all Gemini API keys/models hit quota (429).
 */

function viMatch(text, alternation) {
  const re = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alternation})(?![\\p{L}\\p{N}_])`, "iu");
  return re.test(String(text || ""));
}

const SITE_MAP = [
  { terms: "youtube|ytb|유튜브", url: "https://www.youtube.com", label: "YouTube" },
  { terms: "facebook|fb", url: "https://www.facebook.com", label: "Facebook" },
  { terms: "gmail|hộp\\s+thư|email", url: "https://mail.google.com", label: "Gmail" },
  { terms: "google\\s+drive|drive", url: "https://drive.google.com", label: "Google Drive" },
  { terms: "google\\s+docs|docs", url: "https://docs.google.com", label: "Google Docs" },
  { terms: "github|git", url: "https://github.com", label: "GitHub" },
  { terms: "chatgpt|openai", url: "https://chatgpt.com", label: "ChatGPT" },
  { terms: "gemini", url: "https://gemini.google.com", label: "Google Gemini" },
  { terms: "google", url: "https://www.google.com", label: "Google" },
];

const APP_MAP = [
  { terms: "facebook|fb", app: "facebook", title: "Facebook", label: "Facebook App" },
  { terms: "notepad|ghi\\s+chú", app: "notepad", proc: "notepad", label: "Notepad" },
  { terms: "calc|calculator|máy\\s+tính", app: "calc", proc: "CalculatorApp", label: "Calculator" },
  { terms: "paint|mspaint|vẽ", app: "mspaint", proc: "mspaint", label: "Paint" },
  { terms: "explorer|file\\s+explorer|thư\\s+mục", app: "explorer", proc: "explorer", label: "File Explorer" },
  { terms: "discord", app: "discord", proc: "Discord", label: "Discord" },
  { terms: "spotify", app: "spotify", proc: "Spotify", label: "Spotify" },
  { terms: "zalo", app: "zalo", proc: "Zalo", label: "Zalo" },
  { terms: "steam", app: "steam", proc: "steam", label: "Steam" },
  { terms: "vscode|vs\\s+code|visual\\s+studio\\s+code", app: "code", proc: "Code", label: "VS Code" },
  { terms: "word|winword", app: "winword", proc: "WINWORD", label: "Microsoft Word" },
  { terms: "excel", app: "excel", proc: "EXCEL", label: "Microsoft Excel" },
  { terms: "edge|microsoft\\s+edge|trình\\s+duyệt", app: "msedge", proc: "msedge", label: "Microsoft Edge" },
];

export function isQuotaOrNetworkError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  return (
    msg.includes("429") ||
    msg.includes("quota") ||
    msg.includes("resource_exhausted") ||
    msg.includes("rate limit") ||
    msg.includes("too many requests") ||
    msg.includes("token") ||
    msg.includes("fetch failed") ||
    msg.includes("enotfound") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout")
  );
}

/**
 * Parse a Vietnamese/English user command and execute via executeGuardedTool if matched.
 * Returns { handled: boolean, text: string }
 */
export async function tryLocalFallbackCommand(prompt, executeToolFn) {
  const raw = String(prompt || "").trim();
  if (!raw) return { handled: false, text: "" };

  // 1. YouTube search: "tìm trên youtube <query>" / "youtube tìm <query>"
  const ytSearchMatch =
    raw.match(/(?:tìm(?:\s+kiếm)?(?:\s+trên)?\s+youtube|mở\s+youtube\s+tìm|youtube\s+search)\s+(.+)$/iu) ||
    raw.match(/^(?:tìm\s+video|mở\s+nhạc|bật\s+nhạc)\s+(.+)$/iu);
  if (ytSearchMatch && ytSearchMatch[1]) {
    const query = ytSearchMatch[1].trim();
    const res = await executeToolFn("fastDesktop", "open_edge_url", { youtube_search: query });
    if (res?.cancelled_by_user) return { handled: true, cancelled: true, text: "Đã hủy." };
    return {
      handled: true,
      text: `[Chế độ Dự phòng Offline] Đã mở YouTube tìm kiếm: "${query}".`,
    };
  }

  // 2. Google search: "tìm google <query>" / "tra google <query>"
  const ggSearchMatch = raw.match(/(?:tìm(?:\s+kiếm)?(?:\s+trên)?\s+google|tra\s+google|google\s+search)\s+(.+)$/iu);
  if (ggSearchMatch && ggSearchMatch[1]) {
    const query = ggSearchMatch[1].trim();
    const res = await executeToolFn("fastDesktop", "open_edge_url", { google_search: query });
    if (res?.cancelled_by_user) return { handled: true, cancelled: true, text: "Đã hủy." };
    return {
      handled: true,
      text: `[Chế độ Dự phòng Offline] Đã mở Google tìm kiếm: "${query}".`,
    };
  }

  // 3. Blank new tab: "mở tab mới" / "bật một tab mới" / "new tab"
  if (
    (viMatch(raw, "(?:mở|bật|tạo)\\s+(?:một\\s+|1\\s+)?tab\\s+(?:mới|trống)") || viMatch(raw, "new\\s+tab")) &&
    !SITE_MAP.some((s) => viMatch(raw, s.terms))
  ) {
    const res = await executeToolFn("fastDesktop", "open_edge_url", { new_tab: true });
    if (res?.cancelled_by_user) return { handled: true, cancelled: true, text: "Đã hủy." };
    return {
      handled: true,
      text: "[Chế độ Dự phòng Offline] Đã mở một tab mới trên Microsoft Edge.",
    };
  }

  // 4. Explicit "mở app <name>" launches native/Store desktop app (instead of opening browser tab)
  const explicitAppIntent = viMatch(raw, "app|ứng\\s*dụng|phần\\s*mềm");
  if (explicitAppIntent && viMatch(raw, "mở|bật|chạy|khởi\\s*động|launch|start")) {
    for (const item of APP_MAP) {
      if (viMatch(raw, item.terms)) {
        const res = await executeToolFn("fastDesktop", "launch_app", { app: item.app });
        if (res?.cancelled_by_user) return { handled: true, cancelled: true, text: "Đã hủy." };
        return {
          handled: true,
          text: `[Chế độ Dự phòng Offline] Đã mở ứng dụng ${item.label}.`,
        };
      }
    }
    const dynOpen = raw.match(/(?:mở|bật|chạy|khởi\s*động|launch|start)\s+(?:app|ứng\s*dụng|phần\s*mềm)\s+(.+)$/iu);
    const dynApp = dynOpen?.[1]?.replace(/(?:\s+(?:giúp\s*tôi|dùm|nhé|nha|đi|lên))?[.!?]*$/iu, "").trim();
    if (dynApp && dynApp.length >= 2) {
      const res = await executeToolFn("fastDesktop", "launch_app", { app: dynApp });
      if (res?.cancelled_by_user) return { handled: true, cancelled: true, text: "Đã hủy." };
      return {
        handled: true,
        text: `[Chế độ Dự phòng Offline] Đã mở ứng dụng ${dynApp}.`,
      };
    }
  }

  // 5. Open known websites (skipped when user explicitly said "app"): "mở youtube", "mở tab youtube", etc.
  if (!explicitAppIntent && viMatch(raw, "mở|bật|vào|open|go\\s+to|chạy")) {
    for (const site of SITE_MAP) {
      if (viMatch(raw, site.terms)) {
        const res = await executeToolFn("fastDesktop", "open_edge_url", { url: site.url });
        if (res?.cancelled_by_user) return { handled: true, cancelled: true, text: "Đã hủy." };
        return {
          handled: true,
          text: `[Chế độ Dự phòng Offline] Đã mở ${site.label} (${site.url}) trên Edge.`,
        };
      }
    }

    // Explicit URL or domain (e.g., "mở vnexpress.net")
    const domainMatch = raw.match(/\b((?:https?:\/\/)?[a-z0-9-]+(?:\.[a-z0-9-]+)+\b(?:\/\S*)?)/i);
    if (domainMatch) {
      const candidate = domainMatch[1].startsWith("http") ? domainMatch[1] : `https://${domainMatch[1]}`;
      const res = await executeToolFn("fastDesktop", "open_edge_url", { url: candidate });
      if (res?.cancelled_by_user) return { handled: true, cancelled: true, text: "Đã hủy." };
      return {
        handled: true,
        text: `[Chế độ Dự phòng Offline] Đã mở ${candidate} trên Edge.`,
      };
    }
  }

  // 6. Minimize ("ẩn" / "thu nhỏ") — checked BEFORE close_app so "ẩn" never closes the app!
  if (viMatch(raw, "thu\\s*nhỏ|minimize|ẩn(?:\\s+cửa\\s*sổ|\\s+xuống|\\s+đi|\\s+nó)?")) {
    const matchedApp = APP_MAP.find((a) => viMatch(raw, a.terms));
    const targetArgs = matchedApp?.title
      ? { title: matchedApp.title, action: "minimize" }
      : { process: matchedApp ? matchedApp.proc : "msedge", action: "minimize" };
    const res = await executeToolFn("fastDesktop", "window_control", targetArgs);
    if (res?.cancelled_by_user) return { handled: true, cancelled: true, text: "Đã hủy." };
    return {
      handled: true,
      text: `[Chế độ Dự phòng Offline] Đã ẩn (thu nhỏ) ${matchedApp?.label || "cửa sổ"}.`,
    };
  }

  // 6b. Edge Tab management ("giữ lại 1 tab ... còn lại tắt đi" / "đóng các tab khác") — MUST run before close_app!
  if (
    viMatch(raw, "tab") &&
    viMatch(raw, "giữ\\s*lại|các\\s*tab\\s*khác|tab\\s*khác|còn\\s*lại") &&
    viMatch(raw, "tắt|đóng|xóa")
  ) {
    const keepSite = SITE_MAP.find((s) => viMatch(raw, s.terms));
    const args = keepSite ? { action: "close_others", keep_title: keepSite.label } : { action: "close_others" };
    const res = await executeToolFn("fastDesktop", "manage_edge_tabs", args);
    if (res?.cancelled_by_user) return { handled: true, cancelled: true, text: "Đã hủy." };
    return {
      handled: true,
      text: `[Chế độ Dự phòng Offline] Đã giữ lại tab ${res?.kept_tab || keepSite?.label || "hiện tại"} và đóng ${res?.closed_count ?? 0} tab khác.`,
    };
  }

  // 7. Close app: "tắt/đóng [hẳn] <app>" (never close whole app when user asked to mute/toggle mic/speaker/tab)
  const isInAppControl = viMatch(raw, "mic|micro|tắt\\s*âm|âm\\s*thanh|loa|tai\\s*nghe|mute|unmute|deafen|tab");
  if (viMatch(raw, "discord") && isInAppControl) {
    const wantEnableMic = viMatch(raw, "bật|mở|unmute|bỏ\\s*tắt") && !viMatch(raw, "tắt\\s*(?:mic|micro|âm|tiếng)|mute");
    const checkBtn = async () =>
      executeToolFn("fastDesktop", "uia_click", {
        process: "Discord",
        name: "Tắt âm",
        role: "button",
        exact: true,
        dry_run: true,
      });
    let inspect = await checkBtn().catch(() => null);
    if (!inspect || inspect?.error) {
      await executeToolFn("fastDesktop", "launch_app", { app: "discord" }).catch(() => null);
      inspect = await checkBtn().catch(() => null);
    }
    if (inspect?.cancelled_by_user) return { handled: true, cancelled: true, text: "Đã hủy." };
    const state = String(inspect?.matches?.[0]?.toggle_state || "").toLowerCase();
    if (state === "on" && wantEnableMic) {
      const clicked = await executeToolFn("fastDesktop", "uia_click", {
        process: "Discord",
        name: "Tắt âm",
        role: "button",
        exact: true,
        restore_focus: true,
      });
      if (clicked?.cancelled_by_user) return { handled: true, cancelled: true, text: "Đã hủy." };
      return { handled: true, text: "[Chế độ Dự phòng Offline] Đã bật mic Discord." };
    }
    if (state === "off" && !wantEnableMic) {
      const clicked = await executeToolFn("fastDesktop", "uia_click", {
        process: "Discord",
        name: "Tắt âm",
        role: "button",
        exact: true,
        restore_focus: true,
      });
      if (clicked?.cancelled_by_user) return { handled: true, cancelled: true, text: "Đã hủy." };
      return { handled: true, text: "[Chế độ Dự phòng Offline] Đã tắt mic Discord." };
    }
    if (state === "off" && wantEnableMic) {
      return { handled: true, text: "[Chế độ Dự phòng Offline] Mic Discord đang bật sẵn rồi." };
    }
    if (state === "on" && !wantEnableMic) {
      return { handled: true, text: "[Chế độ Dự phòng Offline] Mic Discord đang tắt sẵn rồi." };
    }
  }
  if (!isInAppControl && viMatch(raw, "tắt|đóng|thoát|close|kill")) {
    for (const item of APP_MAP) {
      if (viMatch(raw, item.terms)) {
        const res = await executeToolFn("fastDesktop", "close_app", { app: item.app });
        if (res?.cancelled_by_user) return { handled: true, cancelled: true, text: "Đã hủy." };
        return {
          handled: true,
          text: `[Chế độ Dự phòng Offline] Đã đóng ${item.label}.`,
        };
      }
    }
    if (explicitAppIntent) {
      const dynClose = raw.match(/(?:tắt|đóng|thoát|close|kill)(?:\s+hẳn)?\s+(?:app|ứng\s*dụng|phần\s*mềm)\s+(.+)$/iu);
      const dynApp = dynClose?.[1]?.replace(/(?:\s+(?:giúp\s*tôi|dùm|nhé|nha|đi))?[.!?]*$/iu, "").trim();
      if (dynApp && dynApp.length >= 2) {
        const res = await executeToolFn("fastDesktop", "close_app", { app: dynApp });
        if (res?.cancelled_by_user) return { handled: true, cancelled: true, text: "Đã hủy." };
        return {
          handled: true,
          text: `[Chế độ Dự phòng Offline] Đã đóng ${dynApp}.`,
        };
      }
    }
  }

  // 8. Move window to Monitor 1 or Monitor 2: "dời/chuyển <app> sang màn hình 1/2"
  if (viMatch(raw, "màn\\s*hình\\s*[12]|màn\\s*hình\\s*(?:lớn|to|nhỏ|phụ|chính)|monitor\\s*[12]")) {
    const mon = viMatch(raw, "2|nhỏ|phụ") ? 2 : 1;
    const matchedApp = APP_MAP.find((a) => viMatch(raw, a.terms));
    const targetArgs = matchedApp?.title
      ? { title: matchedApp.title, action: "move_to_monitor", monitor: mon }
      : { process: matchedApp ? matchedApp.proc : "msedge", action: "move_to_monitor", monitor: mon };
    const res = await executeToolFn("fastDesktop", "window_control", targetArgs);
    if (res?.cancelled_by_user) return { handled: true, cancelled: true, text: "Đã hủy." };
    return {
      handled: true,
      text: `[Chế độ Dự phòng Offline] Đã chuyển ${matchedApp?.label || targetArgs.process} sang màn hình ${mon}.`,
    };
  }

  // 9. Maximize / Fullscreen window
  if (viMatch(raw, "phóng\\s*to|maximize|toàn\\s*màn\\s*hình|full\\s*màn\\s*hình|full\\s*screen|hết\\s*màn\\s*hình")) {
    const matchedApp = APP_MAP.find((a) => viMatch(raw, a.terms));
    const targetArgs = matchedApp?.title
      ? { title: matchedApp.title, action: "maximize" }
      : { process: matchedApp ? matchedApp.proc : "msedge", action: "maximize" };
    const res = await executeToolFn("fastDesktop", "window_control", targetArgs);
    if (res?.cancelled_by_user) return { handled: true, cancelled: true, text: "Đã hủy." };
    return {
      handled: true,
      text: `[Chế độ Dự phòng Offline] Đã phóng to toàn màn hình ${matchedApp?.label || targetArgs.process}.`,
    };
  }

  // 10. Launch app: "mở/bật <app>" (never mistake "bật mic discord" for launching/toggling Discord)
  if (!isInAppControl && viMatch(raw, "mở|bật|chạy|khởi\\s*động|launch|start")) {
    for (const item of APP_MAP) {
      if (viMatch(raw, item.terms)) {
        const res = await executeToolFn("fastDesktop", "launch_app", { app: item.app });
        if (res?.cancelled_by_user) return { handled: true, cancelled: true, text: "Đã hủy." };
        return {
          handled: true,
          text: `[Chế độ Dự phòng Offline] Đã mở ứng dụng ${item.label}.`,
        };
      }
    }
  }

  // 9. Scroll window: "cuộn xuống" / "cuộn lên"
  if (viMatch(raw, "cuộn\\s*xuống|kéo\\s*xuống|scroll\\s*down")) {
    const res = await executeToolFn("fastDesktop", "scroll_window", {
      process: "msedge",
      direction: "down",
      amount: 6,
    });
    if (res?.cancelled_by_user) return { handled: true, cancelled: true, text: "Đã hủy." };
    return { handled: true, text: "[Chế độ Dự phòng Offline] Đã cuộn trang xuống." };
  }

  if (viMatch(raw, "cuộn\\s*lên|kéo\\s*lên|scroll\\s*up")) {
    const res = await executeToolFn("fastDesktop", "scroll_window", {
      process: "msedge",
      direction: "up",
      amount: 6,
    });
    if (res?.cancelled_by_user) return { handled: true, cancelled: true, text: "Đã hủy." };
    return { handled: true, text: "[Chế độ Dự phòng Offline] Đã cuộn trang lên." };
  }

  // 10. Media, Volume & Brightness
  if (viMatch(raw, "giảm\\s*độ\\s*sáng|tối\\s*xuống|tối\\s*bớt|dim\\s*screen")) {
    await executeToolFn("fastDesktop", "set_brightness", { delta: -15 });
    return { handled: true, text: "[Chế độ Dự phòng Offline] Đã giảm độ sáng màn hình (-15%)." };
  }
  if (viMatch(raw, "tăng\\s*độ\\s*sáng|sáng\\s*lên|sáng\\s*hơn|brighten")) {
    await executeToolFn("fastDesktop", "set_brightness", { delta: 15 });
    return { handled: true, text: "[Chế độ Dự phòng Offline] Đã tăng độ sáng màn hình (+15%)." };
  }
  if (viMatch(raw, "tạm\\s*dừng\\s*nhạc|dừng\\s*nhạc|tiếp\\s*tục\\s*nhạc|play|pause")) {
    await executeToolFn("fastDesktop", "send_hotkey", { combo: "media_play_pause" });
    return { handled: true, text: "[Chế độ Dự phòng Offline] Đã nhấn Play/Pause media." };
  }
  if (viMatch(raw, "tăng\\s*âm\\s*lượng|to\\s*lên|volume\\s*up")) {
    await executeToolFn("fastDesktop", "send_hotkey", { combo: "volume_up", repeat: 6 });
    return { handled: true, text: "[Chế độ Dự phòng Offline] Đã tăng âm lượng." };
  }
  if (viMatch(raw, "giảm\\s*âm\\s*lượng|nhỏ\\s*xuống|volume\\s*down")) {
    await executeToolFn("fastDesktop", "send_hotkey", { combo: "volume_down", repeat: 6 });
    return { handled: true, text: "[Chế độ Dự phòng Offline] Đã giảm âm lượng." };
  }
  if (viMatch(raw, "tắt\\s*tiếng|tắt\\s*âm|mute")) {
    await executeToolFn("fastDesktop", "send_hotkey", { combo: "volume_mute" });
    return { handled: true, text: "[Chế độ Dự phòng Offline] Đã bật/tắt tiếng." };
  }

  // 11. Video slider seek ("tua thêm 5 phút", "tua lại 30 giây", "tua tới 1 tiếng 15 phút", "tua tới giữa")
  if (viMatch(raw, "tua")) {
    if (viMatch(raw, "giữa|50%")) {
      const res = await executeToolFn("fastDesktop", "uia_click", {
        process: "msedge",
        role: "slider",
        click_ratio: 0.5,
        content_only: true,
      });
      if (res?.cancelled_by_user) return { handled: true, cancelled: true, text: "Đã hủy." };
      return {
        handled: true,
        text: `[Chế độ Dự phòng Offline] Đã tua video tới giữa (${res?.slider_seek?.after_text || "50%"}).`,
      };
    }
    const h = Number(raw.match(/(\d+)\s*(?:tiếng|giờ|h)\b/i)?.[1] || 0);
    const m = Number(raw.match(/(\d+)\s*(?:phút|p|m)\b/i)?.[1] || 0);
    const s = Number(raw.match(/(\d+)\s*(?:giây|s)\b/i)?.[1] || 0);
    const totalSec = h * 3600 + m * 60 + s;
    if (totalSec > 0) {
      const isBack = viMatch(raw, "lùi|lại|trước|ngược");
      const isDelta = isBack || viMatch(raw, "thêm|tiến|tới\\s+nữa");
      const args = isDelta
        ? { process: "msedge", role: "slider", slider_delta: isBack ? -totalSec : totalSec, content_only: true }
        : { process: "msedge", role: "slider", slider_value: totalSec, content_only: true };
      const res = await executeToolFn("fastDesktop", "uia_click", args);
      if (res?.cancelled_by_user) return { handled: true, cancelled: true, text: "Đã hủy." };
      return {
        handled: true,
        text: `[Chế độ Dự phòng Offline] Đã tua video (${res?.slider_seek?.after_text || `${totalSec}s`}).`,
      };
    }
  }

  // 11b. Select Nth YouTube video left-to-right ("chọn video đầu tiên", "chọn video thứ 2 từ trái sang")
  const nthMatch = raw.match(
    /^(?:chọn|mở|bấm(?:\s+vào)?)\s+video\s+(?:(đầu(?:\s*tiên)?)|thứ\s*([1-9]|một|hai|ba|tư|bốn|năm))(?:\s+(?:từ\s+trái\s+sang(?:\s+phải)?|bên\s+trái|ở\s+trên))?[.!?]?$/iu
  );
  if (nthMatch) {
    const wordMap = { một: 1, hai: 2, ba: 3, tư: 4, bốn: 4, năm: 5 };
    const nVal = nthMatch[1] ? 1 : Number(wordMap[nthMatch[2]?.toLowerCase()] || nthMatch[2] || 1);
    const res = await executeToolFn("fastDesktop", "uia_click", {
      process: "msedge",
      role: "video",
      content_only: true,
      index: Math.max(0, nVal - 1),
    });
    if (res?.cancelled_by_user) return { handled: true, cancelled: true, text: "Đã hủy." };
    return {
      handled: true,
      text: `[Chế độ Dự phòng Offline] Đã chọn video thứ ${nVal}.`,
    };
  }

  // 12. List windows
  if (viMatch(raw, "liệt\\s*kê\\s*cửa\\s*sổ|cửa\\s*sổ\\s*đang\\s*mở|list\\s*windows")) {
    const res = await executeToolFn("fastDesktop", "list_windows", {});
    const titles = (res?.windows || []).slice(0, 8).map((w) => `- **${w.ProcessName}**: ${w.Title}`);
    return {
      handled: true,
      text: `[Chế độ Dự phòng Offline] Đang có ${res?.count || titles.length} cửa sổ:\n${titles.join("\n")}`,
    };
  }

  return { handled: false, text: "" };
}

/**
 * Instant Zero-Token Fast-Path (< 50ms) ONLY for short, unambiguous single-action desktop commands
 * (avoids multi-step requests, questions, or UI-reading tasks so Gemini handles all complex prompts).
 */
export async function tryInstantFastPath(prompt, executeToolFn) {
  const raw = String(prompt || "").trim();
  if (!raw || raw.length > 56) return { handled: false, text: "" };
  const isStandaloneNthVideo =
    /^(?:chọn|mở|bấm(?:\s+vào)?)\s+video\s+(?:đầu(?:\s*tiên)?|thứ\s*(?:[1-9]|một|hai|ba|tư|bốn|năm))(?:\s+(?:từ\s+trái\s+sang(?:\s+phải)?|bên\s+trái|ở\s+trên))?[.!?]?$/iu.test(
      raw
    );
  if (
    !isStandaloneNthVideo &&
    (/[?？]/.test(raw) ||
      viMatch(
        raw,
        "rồi|và|sau\\s*đó|nhưng|nếu|tại\\s*sao|vì\\s*sao|như\\s*thế\\s*nào|gì|nào|nội\\s*dung|tóm\\s*tắt|chọn\\s*video|video\\s*đầu|click|bấm|đọc|viết|xuất|giải\\s*thích|so\\s*sánh"
      ))
  ) {
    return { handled: false, text: "" };
  }
  const res = await tryLocalFallbackCommand(raw, executeToolFn);
  if (res.handled && !res.cancelled) {
    res.text = res.text.replace("[Chế độ Dự phòng Offline] ", "");
  }
  return res;
}
