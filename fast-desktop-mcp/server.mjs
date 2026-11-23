import readline from "node:readline";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import { exportDocumentFile } from "./docx-exporter.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKER_SCRIPT = path.join(__dirname, "win32-worker.ps1");

const SUPPORTED_PROTOCOL_VERSIONS = new Set([
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
  "2024-10-07",
]);

const BLOCKED_PROCESSES = [
  "taskmgr",
  "regedit",
  "mmc",
  "sechealthui",
  "bitwarden",
  "1password",
  "keepass",
  "keepassxc",
  "antigravity",
  "consent",
  "cmd",
  "powershell",
  "pwsh",
  "windowsterminal",
  "wt",
  "msconfig",
  "control",
];

const BLOCKED_TITLE_SUBSTRINGS = [
  "task manager",
  "registry editor",
  "windows security",
  "administrator:",
  "bitwarden",
  "1password",
  "keepass",
  "antigravity",
  "ngân hàng",
  "internet banking",
  "vietcombank",
  "techcombank",
  "mb bank",
  "tpbank",
  "vpbank",
  "bidv",
  "agribank",
  "acb",
  "binance",
  "metamask",
  "phantom",
  "coinbase",
];

const BLOCKED_CLOSE_PROCESSES = new Set([
  "explorer",
  "shellexperiencehost",
  "searchhost",
  "startmenuexperiencehost",
  "applicationframehost",
  "system",
  "idle",
  "svchost",
  "csrss",
  "wininit",
  "winlogon",
  "lsass",
  "services",
  "dwm",
  "smss",
  "runtimebroker",
  "conhost",
  "node",
  "code",
  "cursor",
  "claude",
  "language_server",
  "language_server_windows_x64",
]);

const MINIMIZE_ONLY_EXCEPTIONS = new Set(["antigravity"]);

function isMinimizeExceptionAllowed(keyword, action) {
  return action === "minimize" && MINIMIZE_ONLY_EXCEPTIONS.has(keyword);
}

function isBlacklistedText(text, action = "") {
  if (!text) return null;
  const lower = String(text).toLowerCase();
  for (const proc of BLOCKED_PROCESSES) {
    if (isMinimizeExceptionAllowed(proc, action)) continue;
    if (lower === proc || lower === `${proc}.exe` || lower.includes(proc)) {
      return `Blocked sensitive application/process keyword: "${proc}"`;
    }
  }
  for (const sub of BLOCKED_TITLE_SUBSTRINGS) {
    if (isMinimizeExceptionAllowed(sub, action)) continue;
    if (lower.includes(sub)) {
      return `Blocked sensitive window title keyword: "${sub}"`;
    }
  }
  return null;
}

function assertSafeTarget(target, action) {
  const proc = String(target?.process || "").toLowerCase().replace(/\.exe$/, "");
  const title = String(target?.title || "").toLowerCase();

  for (const blocked of BLOCKED_PROCESSES) {
    if (isMinimizeExceptionAllowed(blocked, action)) continue;
    if (proc === blocked || proc.includes(blocked)) {
      throw new Error(`Security policy blocked ${action} on protected process "${target.process}".`);
    }
  }
  for (const sub of BLOCKED_TITLE_SUBSTRINGS) {
    if (isMinimizeExceptionAllowed(sub, action)) continue;
    if (title.includes(sub)) {
      throw new Error(`Security policy blocked ${action} on protected window "${target.title}".`);
    }
  }
  if (action === "close" && BLOCKED_CLOSE_PROCESSES.has(proc)) {
    throw new Error(`Security policy blocked closing Windows shell/system process "${target.process}".`);
  }
}

function assertSafeAppAlias(alias, action = "launch") {
  const lower = String(alias || "").trim().toLowerCase().replace(/\.exe$/, "");
  if (!lower) {
    throw new Error("App name/alias cannot be empty.");
  }
  if (/[;&|`$<>\\/*?]/.test(lower)) {
    throw new Error("Invalid characters in app name/alias.");
  }
  const blocked = isBlacklistedText(lower);
  if (blocked) {
    throw new Error(`Security policy blocked ${action} on "${alias}": ${blocked}`);
  }
  if (action === "close") {
    if (lower.length < 2) {
      throw new Error("App name/alias for close_app must be at least 2 characters.");
    }
    if (BLOCKED_CLOSE_PROCESSES.has(lower)) {
      throw new Error(`Security policy blocked closing protected shell/system process "${alias}".`);
    }
  }
  return lower;
}

function buildSafeHttpUrl({ url, youtube_search, google_search, new_tab }) {
  if (new_tab === true && !url && !youtube_search && !google_search) {
    return "edge://newtab";
  }
  let raw = url;
  if (!raw && youtube_search) {
    const cleanYt = String(youtube_search).trim();
    if (/^(youtube|ytb|youtube\.com|trang\s*chủ(?:\s*youtube)?|home)$/i.test(cleanYt)) {
      raw = "https://www.youtube.com";
    } else {
      raw = `https://www.youtube.com/results?search_query=${encodeURIComponent(cleanYt)}`;
    }
  } else if (!raw && google_search) {
    const cleanGg = String(google_search).trim();
    if (/^(google|google\.com|trang\s*chủ(?:\s*google)?|home)$/i.test(cleanGg)) {
      raw = "https://www.google.com";
    } else {
      raw = `https://www.google.com/search?q=${encodeURIComponent(cleanGg)}`;
    }
  }

  if (!raw || typeof raw !== "string") {
    throw new Error("Provide one of: url, youtube_search, google_search, or new_tab: true.");
  }

  let trimmed = raw.trim();
  const lowerTrimmed = trimmed.toLowerCase();
  if (lowerTrimmed === "about:blank" || lowerTrimmed === "edge://newtab") {
    return lowerTrimmed;
  }

  // Repair AI-corrupted HTML entities inside URL strings (e.g. %C3%uacute; -> ú)
  const entityFixMap = {
    "&uacute;": "ú", "%uacute;": "ú", "&aacute;": "á", "%aacute;": "á",
    "&eacute;": "é", "%eacute;": "é", "&iacute;": "í", "%iacute;": "í",
    "&oacute;": "ó", "%oacute;": "ó", "&yacute;": "ý", "%yacute;": "ý",
    "&agrave;": "à", "%agrave;": "à", "&acirc;": "â", "%acirc;": "â",
    "&ecirc;": "ê", "%ecirc;": "ê", "&ocirc;": "ô", "%ocirc;": "ô",
  };
  for (const [bad, ch] of Object.entries(entityFixMap)) {
    if (trimmed.toLowerCase().includes(bad)) {
      trimmed = trimmed.replace(new RegExp(`(?:%C3|%C2)?${bad}`, "gi"), encodeURIComponent(ch));
    }
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Invalid URL: "${raw}"`);
  }

  // Re-encode search_query/q cleanly if URL had raw non-ASCII or broken percent encoding
  if (/youtube\.com$/i.test(parsed.hostname) && parsed.pathname === "/results" && parsed.searchParams.has("search_query")) {
    const q = parsed.searchParams.get("search_query");
    parsed.search = "";
    parsed.searchParams.set("search_query", q);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Only http:// and https:// URLs are allowed (got "${parsed.protocol}").`);
  }

  const normalized = parsed.toString();
  if (/[\r\n\0]/.test(normalized)) {
    throw new Error("URL contains invalid control characters.");
  }

  const titleCheck = isBlacklistedText(parsed.hostname);
  if (titleCheck) {
    throw new Error(`Security policy blocked opening sensitive domain "${parsed.hostname}".`);
  }

  return normalized;
}

const GLOBAL_MEDIA_KEYS = new Set([
  "media_play_pause",
  "media_next",
  "media_prev",
  "media_stop",
  "volume_mute",
  "volume_down",
  "volume_up",
]);

const BLOCKED_HOTKEYS = new Set([
  "alt+f4",
  "win+r",
  "win+x",
  "win+l",
  "ctrl+shift+esc",
  "ctrl+alt+delete",
  "shift+delete",
  "ctrl+shift+w",
]);

const MODIFIER_ALIASES = new Map([
  ["ctrl", "ctrl"],
  ["control", "ctrl"],
  ["alt", "alt"],
  ["menu", "alt"],
  ["shift", "shift"],
  ["win", "win"],
  ["lwin", "win"],
]);

const KEY_ALIASES = new Map([
  ["del", "delete"],
  ["escape", "esc"],
  ["return", "enter"],
  ["back", "backspace"],
  ["ins", "insert"],
  ["pgup", "pageup"],
  ["pgdn", "pagedown"],
]);

function normalizeHotkey(combo) {
  const raw = String(combo || "").trim().toLowerCase();
  if (!raw) throw new Error("combo must be a non-empty string.");
  const tokens = raw.split("+").map((t) => t.trim()).filter(Boolean);
  if (tokens.length === 0) throw new Error("combo must contain at least one key.");

  const mods = new Set();
  for (let i = 0; i < tokens.length - 1; i++) {
    const mapped = MODIFIER_ALIASES.get(tokens[i]);
    if (!mapped) {
      throw new Error(`Invalid modifier "${tokens[i]}" in combo "${combo}".`);
    }
    mods.add(mapped);
  }
  const rawMain = tokens[tokens.length - 1];
  const mainKey = KEY_ALIASES.get(rawMain) || rawMain;
  const sortedMods = ["ctrl", "alt", "shift", "win"].filter((m) => mods.has(m));
  const canonical = sortedMods.length ? `${sortedMods.join("+")}+${mainKey}` : mainKey;

  if (BLOCKED_HOTKEYS.has(canonical)) {
    throw new Error(`Security policy blocked dangerous hotkey "${combo}" (${canonical}).`);
  }
  return {
    canonical,
    workerCombo: sortedMods.length ? `${sortedMods.join("+")}+${mainKey}` : mainKey,
    isGlobalMedia: sortedMods.length === 0 && GLOBAL_MEDIA_KEYS.has(mainKey),
  };
}

const BLOCKED_OPEN_EXTENSIONS = new Set([
  ".exe", ".bat", ".cmd", ".ps1", ".psm1", ".psd1", ".vbs", ".vbe",
  ".js", ".jse", ".mjs", ".cjs", ".wsf", ".wsh", ".hta", ".msi",
  ".msp", ".reg", ".scr", ".com", ".pif", ".cpl", ".dll", ".sys", ".lnk",
]);

function getSafeOpenRoots() {
  const home = os.homedir();
  return [
    path.resolve("C:\\AI-Sandbox"),
    path.resolve(home, "Documents"),
    path.resolve(home, "Desktop"),
    path.resolve(home, "Downloads"),
  ];
}

function assertSafeOpenPath(inputPath) {
  const raw = String(inputPath || "").trim();
  if (!raw) throw new Error("path must be a non-empty string.");
  if (/[\r\n\0]/.test(raw)) throw new Error("path contains invalid characters.");

  const resolved = path.resolve(raw);
  const ext = path.extname(resolved).toLowerCase();
  if (ext && BLOCKED_OPEN_EXTENSIONS.has(ext)) {
    throw new Error(`Security policy blocked opening executable/script file "${ext}".`);
  }

  const lowerResolved = resolved.toLowerCase();
  const allowed = getSafeOpenRoots().some((root) => {
    const r = root.toLowerCase();
    return lowerResolved === r || lowerResolved.startsWith(r + path.sep);
  });
  if (!allowed) {
    throw new Error(
      `Security policy only allows opening paths inside C:\\AI-Sandbox, Documents, Desktop, or Downloads.`
    );
  }
  return resolved;
}

class Win32Worker {
  constructor() {
    this.proc = null;
    this.rl = null;
    this.queue = Promise.resolve();
    this.pendingResolve = null;
    this.pendingReject = null;
  }

  ensureStarted() {
    if (this.proc && !this.proc.killed && this.proc.exitCode === null) {
      return;
    }

    this.proc = spawn(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", WORKER_SCRIPT],
      {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      }
    );

    this.proc.stderr.on("data", (chunk) => {
      process.stderr.write(`[fast-desktop-worker] ${chunk.toString("utf8")}`);
    });

    this.rl = readline.createInterface({
      input: this.proc.stdout,
      crlfDelay: Infinity,
    });

    this.rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      if (this.pendingResolve) {
        const resolve = this.pendingResolve;
        this.pendingResolve = null;
        this.pendingReject = null;
        try {
          resolve(JSON.parse(trimmed));
        } catch (err) {
          resolve({ ok: false, error: `Invalid worker JSON: ${err.message}; raw=${trimmed}` });
        }
      }
    });

    this.proc.on("exit", (code, signal) => {
      if (this.pendingReject) {
        const reject = this.pendingReject;
        this.pendingResolve = null;
        this.pendingReject = null;
        reject(new Error(`Win32 worker exited unexpectedly (code=${code}, signal=${signal})`));
      }
      this.proc = null;
      this.rl = null;
    });
  }

  request(payload, timeoutMs = 10000) {
    const run = async () => {
      this.ensureStarted();
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          if (this.pendingReject) {
            this.pendingResolve = null;
            this.pendingReject = null;
            try {
              this.proc?.kill();
            } catch {}
            reject(new Error(`Win32 worker timed out after ${timeoutMs}ms`));
          }
        }, timeoutMs);

        this.pendingResolve = (val) => {
          clearTimeout(timer);
          resolve(val);
        };
        this.pendingReject = (err) => {
          clearTimeout(timer);
          reject(err);
        };

        this.proc.stdin.write(`${JSON.stringify(payload)}\n`, "utf8");
      });
    };

    const next = this.queue.then(run, run);
    this.queue = next.catch(() => {});
    return next;
  }

  dispose() {
    try {
      this.proc?.kill();
    } catch {}
  }
}

const worker = new Win32Worker();

function findMatchingWindow(windows, { hwnd, process: procFilter, title }) {
  if (hwnd !== undefined && hwnd !== null && String(hwnd).trim() !== "") {
    const target = String(hwnd).trim();
    return windows.find((w) => String(w.hwnd) === target) || null;
  }

  let matches = windows;
  if (procFilter) {
    const p = String(procFilter).toLowerCase().replace(/\.exe$/, "");
    const byProc = matches.filter((w) => String(w.process || "").toLowerCase().includes(p));
    if (byProc.length > 0) {
      matches = byProc;
    } else if (!title) {
      // Fallback for Edge PWAs / UWP apps (e.g. Facebook running as process "msedge" with title "Facebook")
      const pwaFirst = matches.filter((w) => {
        const procLow = String(w.process || "").toLowerCase();
        const titleLow = String(w.title || "").toLowerCase();
        const isEdgeTab = procLow === "msedge" && titleLow.includes("microsoft") && titleLow.includes("edge");
        return !isEdgeTab && titleLow.includes(p);
      });
      matches =
        pwaFirst.length > 0
          ? pwaFirst
          : matches.filter((w) => String(w.title || "").toLowerCase().includes(p));
    } else {
      matches = [];
    }
  }
  if (title) {
    const t = String(title).toLowerCase();
    matches = matches.filter((w) => String(w.title || "").toLowerCase().includes(t));
  }
  if (!procFilter && !title) {
    throw new Error("Specify at least one target selector: hwnd, title, or process.");
  }

  // Prefer non-minimized larger windows if multiple match
  matches.sort((a, b) => {
    if (a.minimized !== b.minimized) return a.minimized ? 1 : -1;
    return (b.width || 0) - (a.width || 0);
  });
  return matches[0] || null;
}

const TOOLS = [
  {
    name: "open_edge_url",
    description:
      "Fast-open one or multiple web URLs/tabs (urls array or count repeat, up to 10 tabs in 1 call) or direct YouTube/Google search in Microsoft Edge (~0.2-0.4s).",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        url: {
          type: "string",
          description: "Direct http:// or https:// URL to open in Edge",
        },
        urls: {
          type: "array",
          items: { type: "string" },
          description: "Open multiple http:// or https:// URLs as tabs in 1 single call (max 10)",
        },
        count: {
          type: "integer",
          default: 1,
          description: "Number of tabs to open for url/youtube_search/google_search (1-10, default 1)",
        },
        youtube_search: {
          type: "string",
          description: "Search query to open directly on YouTube results page (e.g. 'Trúc Nhân'). NEVER set this to 'youtube' just to open the homepage — use url='https://www.youtube.com' instead.",
        },
        google_search: {
          type: "string",
          description: "Search query to open directly on Google search page in Edge",
        },
        new_tab: {
          type: "boolean",
          default: false,
          description: "If true, open one or more blank New Tab pages (edge://newtab)",
        },
        focus: {
          type: "boolean",
          default: true,
          description: "Bring Microsoft Edge window to the foreground (default true)",
        },
      },
    },
  },
  {
    name: "list_windows",
    description:
      "List visible top-level desktop windows quickly via Win32 API (<30ms), returning hwnd, pid, process, title, bounds, minimized, maximized, and focused state.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        filter: {
          type: "string",
          description: "Optional case-insensitive substring to match window title or process name",
        },
      },
    },
  },
  {
    name: "window_control",
    description:
      "Control a specific desktop window quickly (~20-50ms) by hwnd, title, or process: focus, minimize, maximize, restore, close (graceful WM_CLOSE on that window only), or move/resize across monitors (supports negative coordinates for left monitors). Protected system/admin/banking/Antigravity windows are blocked.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["action"],
      properties: {
        action: {
          type: "string",
          enum: [
            "focus",
            "minimize",
            "maximize",
            "restore",
            "close",
            "move",
            "snap_left",
            "snap_right",
            "snap_top",
            "snap_bottom",
            "move_monitor_1",
            "move_monitor_2",
            "move_smaller_monitor",
            "move_larger_monitor",
          ],
          description: "Window action or multi-monitor snap preset to perform",
        },
        hwnd: {
          type: "string",
          description: "Exact window handle from list_windows (most unambiguous)",
        },
        title: {
          type: "string",
          description: "Case-insensitive substring of window title",
        },
        process: {
          type: "string",
          description: "Case-insensitive process name substring (e.g. 'msedge', 'Discord', 'steam')",
        },
        x: {
          type: "integer",
          description: "Target X coordinate for 'move' (negative allowed for left monitor)",
        },
        y: {
          type: "integer",
          description: "Target Y coordinate for 'move'",
        },
        width: {
          type: "integer",
          description: "Optional target width for 'move'",
        },
        height: {
          type: "integer",
          description: "Optional target height for 'move'",
        },
        monitor: {
          type: "integer",
          enum: [1, 2],
          description: "Optional target monitor (1 = Primary, 2 = Secondary) to combine with maximize/snap_left/snap_right/focus in 1 call",
        },
      },
    },
  },
  {
    name: "launch_app",
    description:
      "Quickly launch any safe desktop application (or control its existing window if already open) in 1 call, with optional auto-wait + target monitor placement/maximize/snap (e.g. monitor: 2, window_action: 'maximize').",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["app"],
      properties: {
        app: {
          type: "string",
          description: "Application name or alias (e.g. 'discord', 'steam', 'edge', 'zalo', 'spotify', 'notepad', 'calc')",
        },
        focus_if_running: {
          type: "boolean",
          default: true,
          description: "If a window for this app is already open, focus/move/snap it instead of launching again",
        },
        monitor: {
          type: "integer",
          enum: [1, 2],
          description: "Optional target monitor (1 = Primary, 2 = Secondary/smaller) to place the app window on",
        },
        window_action: {
          type: "string",
          enum: ["focus", "maximize", "snap_left", "snap_right", "snap_top", "snap_bottom"],
          description: "Optional window layout action to apply automatically once the window is ready (e.g. 'maximize')",
        },
        wait_window: {
          type: "boolean",
          default: true,
          description: "Wait for the app's main window to appear on cold launch (default true)",
        },
        focus: {
          type: "boolean",
          default: true,
          description: "Focus the launched window once found (default true)",
        },
        wait_timeout_ms: {
          type: "integer",
          default: 9000,
          description: "Max ms to wait for main window on cold launch (1000-12000, default 9000)",
        },
      },
    },
  },
  {
    name: "close_app",
    description:
      "Safely quit a non-protected application. Matches exact process/alias only (no prefix wildcard). Sends graceful WM_CLOSE first; automatically cleans up remaining System Tray processes only for known tray/browser apps (discord, steam, zalo, spotify, telegram, edge), while office/editor apps wait gracefully without force-killing so unsaved work is protected unless force=true is explicitly passed.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["app"],
      properties: {
        app: {
          type: "string",
          description: "Exact application name or alias (e.g. 'discord', 'msedge', 'zalo', 'steam', 'spotify', 'notepad', 'word', 'excel')",
        },
        force: {
          type: "boolean",
          description: "Optional override: defaults to true only for known tray/browser apps (discord, steam, zalo, spotify, telegram, edge) and false for office/editor/other apps to protect unsaved files",
        },
        grace_ms: {
          type: "integer",
          default: 700,
          description: "Milliseconds to wait for graceful WM_CLOSE exit (200-3000, default 700)",
        },
      },
    },
  },
  {
    name: "type_unicode_text",
    description:
      "Safely focus a specific non-protected window and type Unicode text (supports Vietnamese diacritics and React/Lexical/Electron contenteditable inputs like Facebook Messenger, Discord, Zalo) via Win32 SendInput KEYEVENTF_UNICODE, optionally pressing Enter to send.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["text"],
      properties: {
        text: {
          type: "string",
          description: "Unicode text to type into the currently focused field of the target window (max 2000 chars)",
        },
        hwnd: {
          type: "string",
          description: "Exact window handle from list_windows",
        },
        title: {
          type: "string",
          description: "Case-insensitive substring of target window title",
        },
        process: {
          type: "string",
          description: "Case-insensitive process name substring of target window",
        },
        press_enter: {
          type: "boolean",
          default: false,
          description: "If true, presses Return after typing text",
        },
        restore_focus: {
          type: "boolean",
          default: false,
          description: "If true, restore focus back to the previously active window after finishing",
        },
      },
    },
  },
  {
    name: "click_window_point",
    description:
      "Focus a specific non-protected window and perform a real mouse click strictly inside that window's bounds (supports absolute x/y or window-relative rel_x/rel_y, with optional image_width/image_height DPI auto-scaling from screenshots). Use to focus React/contenteditable fields like Facebook Messenger before type_unicode_text.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        hwnd: {
          type: "string",
          description: "Exact window handle from list_windows",
        },
        title: {
          type: "string",
          description: "Case-insensitive substring of target window title",
        },
        process: {
          type: "string",
          description: "Case-insensitive process name substring of target window",
        },
        x: {
          type: "integer",
          description: "Absolute screen X coordinate (must fall inside the target window's rect)",
        },
        y: {
          type: "integer",
          description: "Absolute screen Y coordinate (must fall inside the target window's rect)",
        },
        rel_x: {
          type: "integer",
          description: "X offset relative to the target window's left edge (or screenshot width if image_width is set)",
        },
        rel_y: {
          type: "integer",
          description: "Y offset relative to the target window's top edge (or screenshot height if image_height is set)",
        },
        image_width: {
          type: "integer",
          description: "Optional width of the window screenshot used to pick rel_x; auto-scales across monitor DPI",
        },
        image_height: {
          type: "integer",
          description: "Optional height of the window screenshot used to pick rel_y; auto-scales across monitor DPI",
        },
        button: {
          type: "string",
          enum: ["left", "right"],
          default: "left",
          description: "Mouse button to click",
        },
        count: {
          type: "integer",
          default: 1,
          description: "Click count (1 or 2)",
        },
        text: {
          type: "string",
          description: "Optional Unicode text to type immediately after clicking (max 2000 chars), enabling 1-call click+type",
        },
        press_enter: {
          type: "boolean",
          default: false,
          description: "If true and text is provided, presses Return after typing",
        },
        restore_cursor: {
          type: "boolean",
          default: true,
          description: "Immediately restore the mouse cursor to its original position after clicking (~5ms, default true)",
        },
        restore_focus: {
          type: "boolean",
          default: false,
          description: "If true, restore focus back to the previously active window after finishing",
        },
      },
    },
  },
  {
    name: "uia_click",
    description:
      "1-shot UI Automation find + auto-scroll into view + click (+ optional clear_first, Unicode typing & Enter, or exact slider_value/click_ratio seeking) inside a non-protected window (~0.1-0.4s, pixel-accurate across DPI). Supports matching by name/role or exact runtime_id (from uia_read include_controls=true), plus ordered batch steps (1-25) for forms/quizzes.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        hwnd: {
          type: "string",
          description: "Exact window handle from list_windows",
        },
        title: {
          type: "string",
          description: "Case-insensitive substring of target window title",
        },
        process: {
          type: "string",
          description: "Case-insensitive process name substring of target window",
        },
        runtime_id: {
          type: "string",
          description: "Exact element runtime_id (e.g. '42-12345' from uia_read include_controls=true) to click/type directly with 100% precision even on unnamed controls",
        },
        name: {
          type: "string",
          description: "UI element accessible name / label substring (e.g. 'Tắt âm', 'Seek slider', 'Nộp bài')",
        },
        exact: {
          type: "boolean",
          default: false,
          description: "If true, require exact case-insensitive name match instead of substring",
        },
        role: {
          type: "string",
          description: "Optional UIA role filter: video (visible video title cards sorted top-to-bottom, left-to-right), button, edit, textbox, textarea, switch, checkbox, radio, radiobutton, combobox, listitem, menuitem, tab (tabs only), tabbar, link, document, slider, text",
        },
        content_only: {
          type: "boolean",
          default: false,
          description: "If true, skip browser chrome/top controls (view_*) and search inside the active Document pane",
        },
        exclude_name: {
          type: "string",
          description: "Optional case-insensitive substring to exclude from element names",
        },
        index: {
          type: "integer",
          default: 0,
          description: "0-based match index to click when multiple elements match (default 0)",
        },
        limit: {
          type: "integer",
          default: 10,
          description: "Max matching elements to collect (1-40, default 10)",
        },
        sort_by: {
          type: "string",
          enum: ["dom", "position"],
          default: "dom",
          description: "Result ordering: 'dom' (default DOM traversal) or 'position' (visible screen order top-to-bottom row-grouped, left-to-right within each row, deduplicating card links — ideal for picking items 'từ trái sang phải')",
        },
        dry_run: {
          type: "boolean",
          default: false,
          description: "If true, only search and return matching elements + bounds + range values without clicking",
        },
        click_ratio: {
          type: "number",
          description: "Optional horizontal click position ratio (0.0=left edge to 1.0=right edge) on the element bounds instead of center (0.5)",
        },
        slider_value: {
          type: "number",
          description: "For slider/video progress bar (role='slider'): target numeric value (e.g. seconds for YouTube: 3600 for 1 hour, 2700 for 45 min). Automatically reads total duration, computes exact ratio, wakes hidden player bar, clicks, and micro-adjusts if needed.",
        },
        slider_delta: {
          type: "number",
          description: "For slider/video progress bar (role='slider'): relative seconds offset from current video position (e.g. +300 to jump forward 5 min, -120 to rewind 2 min).",
        },
        button: {
          type: "string",
          enum: ["left", "right"],
          default: "left",
          description: "Mouse button to click",
        },
        count: {
          type: "integer",
          default: 1,
          description: "Click count (1 or 2)",
        },
        text: {
          type: "string",
          description: "Optional Unicode text to type immediately after clicking (max 2000 chars)",
        },
        clear_first: {
          type: "boolean",
          default: false,
          description: "If true and text is provided, sends Ctrl+A + Backspace before typing so existing input text is replaced cleanly",
        },
        press_enter: {
          type: "boolean",
          default: false,
          description: "If true and text is provided, presses Return after typing",
        },
        restore_cursor: {
          type: "boolean",
          default: true,
          description: "Immediately restore mouse cursor to its original position after clicking (default true)",
        },
        restore_focus: {
          type: "boolean",
          default: false,
          description: "If true, restore focus back to the previously active window after finishing",
        },
        wait_ms: {
          type: "integer",
          description: "Optional max ms (0-8000) to auto-retry finding the element if UI is still rendering",
        },
        steps: {
          type: "array",
          description: "Optional ordered sequence (1-25 steps) of UIA click/type steps executed in 1 call (e.g. answer multiple quiz radios + essay edits in 1 call), with auto-scroll and auto-retry",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              runtime_id: { type: "string", description: "Exact element runtime_id from uia_read(include_controls: true)" },
              name: { type: "string", description: "UI element accessible name / label substring" },
              exact: { type: "boolean", default: false },
              role: { type: "string", description: "Optional UIA role filter" },
              content_only: { type: "boolean", description: "Skip browser chrome for this step" },
              exclude_name: { type: "string", description: "Exclude element names containing this substring" },
              index: { type: "integer", default: 0 },
              limit: { type: "integer", default: 10 },
              sort_by: { type: "string", enum: ["dom", "position"], default: "dom" },
              click_ratio: { type: "number" },
              slider_value: { type: "number" },
              slider_delta: { type: "number" },
              button: { type: "string", enum: ["left", "right"], default: "left" },
              count: { type: "integer", default: 1 },
              text: { type: "string", description: "Optional Unicode text to type after clicking this step" },
              clear_first: { type: "boolean", default: false },
              press_enter: { type: "boolean", default: false },
              wait_ms: { type: "integer", description: "Max ms (0-8000) to wait for this step element" },
              delay_ms: { type: "integer", description: "Pause ms (0-2000) after this step before the next step (default 120ms)" },
            },
          },
        },
        wait_after_ms: {
          type: "integer",
          description: "Optional pause ms (0-8000) after clicking before returning or running read_after",
        },
        read_after: {
          type: "boolean",
          default: false,
          description: "If true, read UI text in the target window right after clicking (combines action + read in 1 call)",
        },
        read_scope: {
          type: "string",
          description: "Optional container/panel name substring to scope read_after (setting this also enables read_after)",
        },
        read_include_buttons: {
          type: "boolean",
          default: false,
          description: "If true, include button labels in read_after output",
        },
        read_include_controls: {
          type: "boolean",
          default: false,
          description: "If true, include interactive form controls (RADIO, CHECKBOX, EDIT, COMBOBOX, SLIDER, BUTTON with runtime_id) in read_after output",
        },
        read_wait_for_text: {
          type: "string",
          description: "Optional case-insensitive substring to wait for during read_after",
        },
        read_stable_ms: {
          type: "integer",
          description: "Optional stability wait ms (0-6000) until streamed read_after text stops changing",
        },
        read_min_chars: {
          type: "integer",
          description: "Minimum characters required before read_after finishes waiting",
        },
        read_wait_timeout_ms: {
          type: "integer",
          description: "Max ms (0-10000) to poll during read_after",
        },
        read_max_items: {
          type: "integer",
          default: 120,
        },
        read_max_chars: {
          type: "integer",
          default: 8000,
        },
      },
    },
  },
  {
    name: "uia_read",
    description:
      "Read visible text, form controls, quiz options (with runtime_id + selection state), and essay/text inputs inside a non-protected window or Document pane via UI Automation (~0.1-0.5s, no screenshots needed).",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        hwnd: {
          type: "string",
          description: "Exact window handle from list_windows",
        },
        title: {
          type: "string",
          description: "Case-insensitive substring of target window title",
        },
        process: {
          type: "string",
          description: "Case-insensitive process name substring of target window",
        },
        scope_name: {
          type: "string",
          description: "Optional panel/container name substring to scope reading (e.g. 'Hỏi về video này')",
        },
        content_only: {
          type: "boolean",
          default: false,
          description: "If true, focus on the web page Document content and skip browser address bar/chrome controls",
        },
        include_controls: {
          type: "boolean",
          default: false,
          description: "If true, outputs structured interactive controls in DOM order ([RADIO id=... selected=...], [CHECKBOX id=...], [EDIT id=... label=... val=...], [COMBOBOX id=...], [SLIDER id=...], [BUTTON id=...]) for quizzes, forms, and sliders",
        },
        include_buttons: {
          type: "boolean",
          default: false,
          description: "If true, also include button labels (skipped by default to keep text clean)",
        },
        max_items: {
          type: "integer",
          default: 120,
          description: "Max text items to return (1-400, default 120)",
        },
        max_chars: {
          type: "integer",
          default: 8000,
          description: "Max total characters to return (200-24000, default 8000)",
        },
        wait_for_text: {
          type: "string",
          description: "Optional case-insensitive substring to wait for before returning",
        },
        wait_stable_ms: {
          type: "integer",
          description: "Wait until read text stays unchanged (and non-empty) for N ms (0-6000, e.g. 900 for streaming responses)",
        },
        min_chars: {
          type: "integer",
          description: "Minimum characters required before finishing wait",
        },
        wait_timeout_ms: {
          type: "integer",
          description: "Max ms (0-10000) to poll when waiting for text/stability",
        },
        focus: {
          type: "boolean",
          default: false,
          description: "If true, bring target window to foreground before reading (otherwise reads without stealing focus)",
        },
        restore_focus: {
          type: "boolean",
          default: false,
          description: "If true (when focus=true), restore focus back to the previous window after reading",
        },
      },
    },
  },
  {
    name: "scroll_window",
    description:
      "Scroll vertically or horizontally inside a non-protected window via Win32 mouse wheel without requiring headed mode, restoring cursor afterwards.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        hwnd: {
          type: "string",
          description: "Exact window handle from list_windows",
        },
        title: {
          type: "string",
          description: "Case-insensitive substring of target window title",
        },
        process: {
          type: "string",
          description: "Case-insensitive process name substring of target window",
        },
        direction: {
          type: "string",
          enum: ["down", "up", "left", "right"],
          default: "down",
          description: "Scroll direction when dx/dy are not explicitly set",
        },
        amount: {
          type: "integer",
          default: 5,
          description: "Number of wheel notches to scroll in 'direction' (1-50, default 5)",
        },
        dx: {
          type: "integer",
          description: "Optional explicit horizontal wheel notches (-50..50, positive=right, negative=left)",
        },
        dy: {
          type: "integer",
          description: "Optional explicit vertical wheel notches (-50..50, positive=up, negative=down)",
        },
        rel_x: {
          type: "integer",
          description: "Optional X offset inside window (defaults to window center)",
        },
        rel_y: {
          type: "integer",
          description: "Optional Y offset inside window (defaults to window center)",
        },
        restore_cursor: {
          type: "boolean",
          default: true,
          description: "Immediately restore mouse cursor afterwards (default true)",
        },
        restore_focus: {
          type: "boolean",
          default: false,
          description: "If true, restore focus back to the previous window after scrolling",
        },
      },
    },
  },
  {
    name: "send_hotkey",
    description:
      "Send a keyboard shortcut, sequence of shortcuts (combos), repeated key (repeat), or global media key via Win32 SendInput. Global media keys work without changing window focus; app shortcuts (e.g. ['ctrl+shift+tab','ctrl+w','ctrl+w'] to close multiple tabs in 1 call) require a non-protected target window.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        combo: {
          type: "string",
          description: "Single key or modifier combo, e.g. 'media_play_pause', 'volume_up', 'ctrl+k', 'ctrl+w', 'space'",
        },
        combos: {
          type: "array",
          items: { type: "string" },
          description: "Ordered sequence of combos to send in 1 call (e.g. ['ctrl+shift+tab', 'ctrl+w', 'ctrl+w', 'ctrl+w'])",
        },
        repeat: {
          type: "integer",
          default: 1,
          description: "Number of times to repeat combo/combos (1-20, max 30 total keys)",
        },
        delay_ms: {
          type: "integer",
          default: 65,
          description: "Delay in ms between consecutive keys in a sequence (20-500, default 65)",
        },
        hwnd: {
          type: "string",
          description: "Exact window handle from list_windows (not needed for global media keys)",
        },
        title: {
          type: "string",
          description: "Case-insensitive substring of target window title",
        },
        process: {
          type: "string",
          description: "Case-insensitive process name substring of target window",
        },
        restore_focus: {
          type: "boolean",
          default: false,
          description: "If true, restore focus back to the previously active window after sending an app hotkey",
        },
      },
    },
  },
  {
    name: "export_document",
    description:
      "Create a clean, formatted .docx (Word), .csv (Excel UTF-8 BOM), .md, or .txt file inside C:\\AI-Sandbox from markdown text or table rows, and optionally open it immediately in Word/Excel/Notepad on the real desktop.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["filename"],
      properties: {
        filename: {
          type: "string",
          description: "File name or relative path inside C:\\AI-Sandbox (defaults to C:\\AI-Sandbox\\exports\\<filename>, e.g. 'bao-cao.docx' or 'bang-gia.csv')",
        },
        format: {
          type: "string",
          enum: ["docx", "csv", "md", "txt"],
          description: "Optional explicit format override (otherwise inferred from filename extension, default docx)",
        },
        title: {
          type: "string",
          description: "Optional document title (rendered with Title style in .docx or top heading in .md)",
        },
        content: {
          type: "string",
          description: "Markdown/plain content (supports # headings, **bold**, - bullet lists, 1. numbered lists, and | markdown | tables |)",
        },
        rows: {
          type: "array",
          items: {
            type: "array",
            items: { type: "string" },
          },
          description: "Optional 2D array of string rows for .csv export (overrides markdown table extraction)",
        },
        source_path: {
          type: "string",
          description: "Optional path to an existing .md, .txt, or .csv file inside C:\\AI-Sandbox to convert directly without duplicating its text in JSON",
        },
        open_after: {
          type: "boolean",
          default: false,
          description: "If true, immediately open the created file in its default Windows application (Word/Excel/Notepad)",
        },
      },
    },
  },
  {
    name: "open_path",
    description:
      "Safely open a non-executable document, image, or folder inside C:\\AI-Sandbox, Documents, Desktop, or Downloads using its default Windows application.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["path"],
      properties: {
        path: {
          type: "string",
          description: "Full path to a safe file (.docx, .xlsx, .csv, .pdf, .md, .txt, images) or folder inside C:\\AI-Sandbox or user Documents/Desktop/Downloads",
        },
      },
    },
  },
  {
    name: "set_brightness",
    description:
      "Adjust or set the Windows laptop/internal screen brightness (5-100%) via WMI. Use 'delta' (e.g. -15 or +15) for relative change ('giảm độ sáng', 'tăng độ sáng') or 'level' (5-100) for an exact percentage.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        level: {
          type: "integer",
          description: "Target screen brightness percentage (5-100)",
        },
        delta: {
          type: "integer",
          description: "Relative brightness adjustment (-95 to +95), e.g. -15 to dim or +15 to brighten",
        },
      },
    },
  },
  {
    name: "manage_edge_tabs",
    description:
      "Safely list, switch to, or close tabs inside an open Microsoft Edge window WITHOUT closing the Edge browser itself. Use action='close_others' (with optional keep_title like 'YouTube', or omit keep_title to keep the currently active tab) when user asks to keep 1 tab and close the rest.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["action"],
      properties: {
        action: {
          type: "string",
          enum: ["list", "switch", "close_others", "close_matching", "close_latest_matching"],
          description: "Operation on Edge tabs: list open tabs, switch to a tab, close all other tabs while keeping 1 tab, close tabs matching match_title, or close only the newest/rightmost matching tab",
        },
        keep_title: {
          type: "string",
          description: "For action='close_others': substring of the tab title to keep (e.g. 'YouTube'). Omit to keep whichever tab is currently active/selected.",
        },
        match_title: {
          type: "string",
          description: "For action='switch' or 'close_matching': substring of the tab title to match.",
        },
        hwnd: {
          type: "string",
          description: "Optional specific Edge window hwnd from list_windows",
        },
      },
    },
  },
];

async function resolveAndValidateWindow(args, action) {
  const queryCheck = isBlacklistedText(args.process, action) || isBlacklistedText(args.title, action);
  if (queryCheck) {
    throw new Error(`Security policy blocked request: ${queryCheck}`);
  }

  const listRes = await worker.request({ cmd: "list_windows", filter: "" });
  if (!listRes.ok) throw new Error(listRes.error || "Failed to enumerate windows");
  const windows = Array.isArray(listRes.data) ? listRes.data : listRes.data ? [listRes.data] : [];

  const target = findMatchingWindow(windows, args);
  if (!target) {
    throw new Error("No matching visible window found.");
  }

  assertSafeTarget(target, action);
  return target;
}

function validateOptionalText(text, required = false) {
  if (typeof text !== "string" || text.length === 0) {
    if (required) throw new Error("text must be a non-empty string.");
    return null;
  }
  if (text.length > 2000) {
    throw new Error("text exceeds maximum allowed length of 2000 characters.");
  }
  return text;
}

async function handleToolCall(name, args = {}) {
  const start = Date.now();

  if (name === "open_edge_url") {
    const count = Number.isInteger(args.count) ? args.count : 1;
    if (count < 1 || count > 10) {
      throw new Error("count must be an integer between 1 and 10.");
    }

    let safeUrls;
    if (Array.isArray(args.urls) && args.urls.length > 0) {
      if (args.urls.length > 10) {
        throw new Error("urls array cannot exceed 10 items.");
      }
      safeUrls = args.urls.map((u) => buildSafeHttpUrl({ url: u }));
    } else {
      const single = buildSafeHttpUrl(args);
      safeUrls = Array.from({ length: count }, () => single);
    }

    const res = await worker.request({
      cmd: "open_edge_url",
      urls: safeUrls,
      focus: args.focus !== false,
    });
    if (!res.ok) throw new Error(res.error || "open_edge_url failed");
    return { ...res.data, elapsed_ms: Date.now() - start };
  }

  if (name === "list_windows") {
    const res = await worker.request({
      cmd: "list_windows",
      filter: args.filter || "",
    });
    if (!res.ok) throw new Error(res.error || "list_windows failed");
    const windows = Array.isArray(res.data) ? res.data : res.data ? [res.data] : [];
    return { count: windows.length, windows, elapsed_ms: Date.now() - start };
  }

  if (name === "window_control") {
    const target = await resolveAndValidateWindow(args, args.action);
    const monitor = args.monitor === 1 || args.monitor === 2 ? args.monitor : 0;

    const ctrlRes = await worker.request({
      cmd: "window_control",
      action: args.action,
      hwnd: target.hwnd,
      x: args.x,
      y: args.y,
      width: args.width,
      height: args.height,
      monitor,
    });
    if (!ctrlRes.ok) throw new Error(ctrlRes.error || "window_control failed");
    return { ...ctrlRes.data, elapsed_ms: Date.now() - start };
  }

  if (name === "launch_app") {
    const appName = String(args.app || "").trim();
    assertSafeAppAlias(appName, "launch");

    const monitor = args.monitor === 1 || args.monitor === 2 ? args.monitor : 0;
    const validWinActions = new Set(["focus", "maximize", "snap_left", "snap_right", "snap_top", "snap_bottom"]);
    const windowAction = typeof args.window_action === "string" && validWinActions.has(args.window_action)
      ? args.window_action
      : "";
    const waitWindow = args.wait_window !== false;
    const focusOnLaunch = args.focus !== false;
    const waitTimeoutMs = Number.isInteger(args.wait_timeout_ms)
      ? Math.max(1000, Math.min(12000, args.wait_timeout_ms))
      : 9000;

    if (args.focus_if_running !== false) {
      const listRes = await worker.request({ cmd: "list_windows", filter: "" });
      if (listRes.ok) {
        const windows = Array.isArray(listRes.data) ? listRes.data : listRes.data ? [listRes.data] : [];
        const needle = appName.toLowerCase();
        const APP_WINDOW_ALIASES = {
          edge: ["msedge", "edge"],
          msedge: ["msedge", "edge"],
          vscode: ["code", "visual studio code"],
          "vs code": ["code", "visual studio code"],
          code: ["code", "visual studio code"],
          "visual studio code": ["code", "visual studio code"],
          chrome: ["chrome", "google chrome"],
          "google chrome": ["chrome", "google chrome"],
          word: ["winword", "word"],
          winword: ["winword", "word"],
          powerpoint: ["powerpnt", "powerpoint"],
          calc: ["applicationframehost", "calculator", "calc"],
          calculator: ["applicationframehost", "calculator", "calc"],
          epic: ["epicgameslauncher", "epic games"],
          legion: ["lenovo legion toolkit", "lenovolegiontoolkit"],
          nvidia: ["nvidia", "nvidia app"],
          obs: ["obs64", "obs studio"],
        };
        const isBrowserAlias = needle === "edge" || needle === "msedge";
        const needles = APP_WINDOW_ALIASES[needle] ? [needle, ...APP_WINDOW_ALIASES[needle]] : [needle];
        const compactNeedles = needles.map((n) => n.replace(/[^a-z0-9]/g, "")).filter((c) => c.length >= 3);
        const existing = windows.find((w) => {
          const proc = String(w.process || "").toLowerCase();
          const title = String(w.title || "").toLowerCase();
          const compactTitle = title.replace(/[^a-z0-9]/g, "");
          const isEdgeBrowserWin =
            proc === "msedge" &&
            ((title.includes("microsoft") && title.includes("edge")) ||
              title.includes("new tab") ||
              title.includes("tab mới") ||
              title.includes("inprivate"));
          if (isBrowserAlias) {
            return (w.width >= 280 || w.minimized) && isEdgeBrowserWin;
          }
          if (isEdgeBrowserWin) {
            return false; // Never hijack an Edge browser tab when launching a dedicated app like Facebook
          }
          return (
            !title.includes("updater") &&
            (w.width >= 280 || w.minimized) &&
            (needles.some((n) => proc.includes(n) || title.includes(n)) ||
              compactNeedles.some((cn) => compactTitle.includes(cn)))
          );
        });
        if (existing) {
          const effectiveAct = windowAction || (monitor > 0 ? `move_monitor_${monitor}` : "focus");
          assertSafeTarget(existing, effectiveAct);
          const actionRes = await worker.request({
            cmd: "window_control",
            action: effectiveAct,
            hwnd: existing.hwnd,
            monitor,
          });
          if (effectiveAct !== "focus" && focusOnLaunch) {
            await worker.request({ cmd: "window_control", action: "focus", hwnd: existing.hwnd, monitor: 0 });
          }
          if (actionRes.ok) {
            return {
              already_running: true,
              focused: focusOnLaunch,
              action: effectiveAct,
              monitor,
              window: existing,
              elapsed_ms: Date.now() - start,
            };
          }
        }
      }
    }

    const launchRes = await worker.request(
      {
        cmd: "launch_app",
        alias: appName,
        monitor,
        window_action: windowAction,
        wait_window: waitWindow,
        focus: focusOnLaunch,
        wait_timeout_ms: waitTimeoutMs,
      },
      waitWindow ? waitTimeoutMs + 4000 : 10000
    );
    if (!launchRes.ok) throw new Error(launchRes.error || "launch_app failed");
    return { ...launchRes.data, already_running: false, elapsed_ms: Date.now() - start };
  }

  if (name === "close_app") {
    const TRAY_FORCE_CLOSE_APPS = new Set([
      "edge",
      "msedge",
      "discord",
      "steam",
      "zalo",
      "spotify",
      "telegram",
      "teams",
      "viber",
    ]);
    const appName = assertSafeAppAlias(args.app, "close");
    const isEdge = appName === "edge" || appName === "msedge";
    const graceMs = Number.isInteger(args.grace_ms)
      ? Math.max(200, Math.min(3000, args.grace_ms))
      : (isEdge ? 1300 : 700);
    const force = typeof args.force === "boolean" ? args.force : TRAY_FORCE_CLOSE_APPS.has(appName);

    const closeRes = await worker.request(
      {
        cmd: "close_app",
        alias: appName,
        grace_ms: graceMs,
        force,
      },
      graceMs + 6000
    );
    if (!closeRes.ok) throw new Error(closeRes.error || "close_app failed");
    return { ...closeRes.data, elapsed_ms: Date.now() - start };
  }

  if (name === "type_unicode_text") {
    const text = validateOptionalText(args.text, true);
    const target = await resolveAndValidateWindow(args, "type");

    const typeRes = await worker.request(
      {
        cmd: "type_unicode_text",
        hwnd: target.hwnd,
        text,
        press_enter: args.press_enter === true,
        restore_focus: args.restore_focus === true,
      },
      15000
    );
    if (!typeRes.ok) throw new Error(typeRes.error || "type_unicode_text failed");
    return { ...typeRes.data, elapsed_ms: Date.now() - start };
  }

  if (name === "click_window_point") {
    const hasAbs = Number.isInteger(args.x) && Number.isInteger(args.y);
    const hasRel = Number.isInteger(args.rel_x) && Number.isInteger(args.rel_y);
    if (!hasAbs && !hasRel) {
      throw new Error("Provide either integer (x, y) or integer (rel_x, rel_y) coordinates.");
    }

    const target = await resolveAndValidateWindow(args, "click");
    const hasImgScale =
      hasRel &&
      Number.isInteger(args.image_width) &&
      args.image_width > 0 &&
      Number.isInteger(args.image_height) &&
      args.image_height > 0;

    const scaledRelX = hasImgScale
      ? Math.round((args.rel_x * target.width) / args.image_width)
      : args.rel_x;
    const scaledRelY = hasImgScale
      ? Math.round((args.rel_y * target.height) / args.image_height)
      : args.rel_y;

    const absX = hasRel ? target.x + scaledRelX : args.x;
    const absY = hasRel ? target.y + scaledRelY : args.y;

    if (
      absX < target.x ||
      absX >= target.x + target.width ||
      absY < target.y ||
      absY >= target.y + target.height
    ) {
      throw new Error(
        `Security policy blocked click outside target window bounds: (${absX}, ${absY}) not in [${target.x},${target.y}..${target.x + target.width},${target.y + target.height})`
      );
    }

    const hasText = typeof args.text === "string" && args.text.length > 0;
    if (hasText && args.text.length > 2000) {
      throw new Error("text exceeds maximum allowed length of 2000 characters.");
    }

    const clickRes = await worker.request(
      {
        cmd: "click_window_point",
        hwnd: target.hwnd,
        x: hasRel ? undefined : absX,
        y: hasRel ? undefined : absY,
        rel_x: hasRel ? args.rel_x : undefined,
        rel_y: hasRel ? args.rel_y : undefined,
        image_width: hasImgScale ? args.image_width : undefined,
        image_height: hasImgScale ? args.image_height : undefined,
        button: args.button === "right" ? "right" : "left",
        count: args.count === 2 ? 2 : 1,
        text: hasText ? args.text : undefined,
        press_enter: hasText && args.press_enter === true,
        restore_cursor: args.restore_cursor !== false,
        restore_focus: args.restore_focus === true,
      },
      15000
    );
    if (!clickRes.ok) throw new Error(clickRes.error || "click_window_point failed");
    return { ...clickRes.data, elapsed_ms: Date.now() - start };
  }

  if (name === "uia_click") {
    const normalizeUiaStepArgs = (raw, label) => {
      if (!raw || typeof raw !== "object") {
        throw new Error(`${label} must be an object.`);
      }
      const qRuntimeId = typeof raw.runtime_id === "string" ? raw.runtime_id.trim() : "";
      const qName = typeof raw.name === "string" ? raw.name.trim() : "";
      const qRole = typeof raw.role === "string" ? raw.role.trim() : "";
      if (!qRuntimeId && !qName && !qRole) {
        throw new Error(`Provide at least one filter (runtime_id, name, or role) in ${label}.`);
      }
      const stepText = validateOptionalText(raw.text, false);
      const hasRatio = typeof raw.click_ratio === "number" && Number.isFinite(raw.click_ratio);
      const hasSlider = typeof raw.slider_value === "number" && Number.isFinite(raw.slider_value);
      const hasSliderDelta = typeof raw.slider_delta === "number" && Number.isFinite(raw.slider_delta);
      return {
        runtime_id: qRuntimeId || undefined,
        name: qName,
        exact: raw.exact === true,
        role: qRole,
        content_only: raw.content_only !== undefined ? raw.content_only === true : args.content_only === true,
        exclude_name:
          typeof raw.exclude_name === "string"
            ? raw.exclude_name.trim()
            : (typeof args.exclude_name === "string" ? args.exclude_name.trim() : ""),
        index: Number.isInteger(raw.index) ? raw.index : 0,
        limit: Number.isInteger(raw.limit) ? raw.limit : 10,
        sort_by: raw.sort_by === "position" ? "position" : (args.sort_by === "position" ? "position" : "dom"),
        click_ratio: hasRatio ? Math.max(0, Math.min(1, raw.click_ratio)) : undefined,
        slider_value: hasSlider ? raw.slider_value : undefined,
        slider_delta: hasSliderDelta ? raw.slider_delta : undefined,
        button: raw.button === "right" ? "right" : "left",
        count: raw.count === 2 ? 2 : 1,
        text: stepText || undefined,
        clear_first: raw.clear_first === true,
        press_enter: Boolean(stepText) && raw.press_enter === true,
        wait_ms: Number.isInteger(raw.wait_ms) ? Math.max(0, Math.min(8000, raw.wait_ms)) : undefined,
        delay_ms: Number.isInteger(raw.delay_ms) ? Math.max(0, Math.min(2000, raw.delay_ms)) : undefined,
      };
    };

    let normalizedSteps = null;
    let singleSpec = null;
    if (Array.isArray(args.steps) && args.steps.length > 0) {
      if (args.steps.length > 25) {
        throw new Error("steps cannot exceed 25 items.");
      }
      normalizedSteps = args.steps.map((st, idx) => normalizeUiaStepArgs(st, `steps[${idx}]`));
    } else {
      singleSpec = normalizeUiaStepArgs(args, "uia_click");
    }

    const target = await resolveAndValidateWindow(args, "click");
    const waitAfterMs = Number.isInteger(args.wait_after_ms) ? Math.max(0, Math.min(8000, args.wait_after_ms)) : 0;
    const readScope = typeof args.read_scope === "string" ? args.read_scope.trim() : "";
    const doReadAfter = args.read_after === true || readScope.length > 0;
    const readStableMs = Number.isInteger(args.read_stable_ms) ? Math.max(0, Math.min(6000, args.read_stable_ms)) : 0;
    const readTimeoutMs = Number.isInteger(args.read_wait_timeout_ms) ? Math.max(0, Math.min(10000, args.read_wait_timeout_ms)) : 0;
    const readWaitBudget = doReadAfter
      ? Math.max(readTimeoutMs, readStableMs > 0 ? readStableMs + 4000 : 0, args.read_wait_for_text ? 5000 : 0)
      : 0;
    const stepsBudget = normalizedSteps
      ? normalizedSteps.reduce((acc, s, idx) => acc + (s.wait_ms ?? (idx > 0 ? 1500 : 500)) + (s.delay_ms ?? 150), 0)
      : (singleSpec.wait_ms || 0);
    const requestTimeout = Math.min(45000, Math.max(15000, stepsBudget + waitAfterMs + readWaitBudget + 6000));

    const payload = {
      cmd: "uia_click",
      hwnd: target.hwnd,
      dry_run: args.dry_run === true,
      content_only: args.content_only === true,
      exclude_name: typeof args.exclude_name === "string" ? args.exclude_name.trim() : "",
      restore_cursor: args.restore_cursor !== false,
      restore_focus: args.restore_focus === true,
      wait_after_ms: waitAfterMs,
      ...(normalizedSteps ? { steps: normalizedSteps } : singleSpec),
      ...(doReadAfter
        ? {
            read_after: true,
            read_scope: readScope,
            read_include_buttons: args.read_include_buttons === true,
            read_include_controls: args.read_include_controls === true,
            read_wait_for_text: typeof args.read_wait_for_text === "string" ? args.read_wait_for_text : "",
            read_stable_ms: readStableMs,
            read_min_chars: Number.isInteger(args.read_min_chars) ? Math.max(0, args.read_min_chars) : 0,
            read_wait_timeout_ms: readTimeoutMs,
            read_max_items: Number.isInteger(args.read_max_items) ? args.read_max_items : 120,
            read_max_chars: Number.isInteger(args.read_max_chars) ? args.read_max_chars : 8000,
          }
        : {}),
    };

    const uiaRes = await worker.request(payload, requestTimeout);
    if (!uiaRes.ok) throw new Error(uiaRes.error || "uia_click failed");
    return { ...uiaRes.data, elapsed_ms: Date.now() - start };
  }

  if (name === "uia_read") {
    const target = await resolveAndValidateWindow(args, "read");
    const waitStableMs = Number.isInteger(args.wait_stable_ms) ? Math.max(0, Math.min(6000, args.wait_stable_ms)) : 0;
    const waitTimeoutMs = Number.isInteger(args.wait_timeout_ms) ? Math.max(0, Math.min(10000, args.wait_timeout_ms)) : 0;
    const waitForText = typeof args.wait_for_text === "string" ? args.wait_for_text : "";
    const budgetMs = Math.max(waitTimeoutMs, waitStableMs > 0 ? waitStableMs + 4000 : 0, waitForText.trim() ? 5000 : 0);

    const readRes = await worker.request(
      {
        cmd: "uia_read",
        hwnd: target.hwnd,
        scope_name: typeof args.scope_name === "string" ? args.scope_name.trim() : "",
        content_only: args.content_only === true,
        include_controls: args.include_controls === true,
        include_buttons: args.include_buttons === true,
        max_items: Number.isInteger(args.max_items) ? Math.max(1, Math.min(400, args.max_items)) : 120,
        max_chars: Number.isInteger(args.max_chars) ? Math.max(200, Math.min(24000, args.max_chars)) : 8000,
        wait_for_text: waitForText,
        wait_stable_ms: waitStableMs,
        min_chars: Number.isInteger(args.min_chars) ? Math.max(0, args.min_chars) : 0,
        wait_timeout_ms: waitTimeoutMs,
        focus: args.focus === true,
        restore_focus: args.restore_focus === true,
      },
      Math.max(15000, budgetMs + 6000)
    );
    if (!readRes.ok) throw new Error(readRes.error || "uia_read failed");
    return { ...readRes.data, elapsed_ms: Date.now() - start };
  }

  if (name === "scroll_window") {
    const target = await resolveAndValidateWindow(args, "scroll");
    let dx = 0;
    let dy = 0;
    const hasExplicitDx = args.dx !== undefined;
    const hasExplicitDy = args.dy !== undefined;
    if (hasExplicitDx || hasExplicitDy) {
      if (hasExplicitDx && (!Number.isInteger(args.dx) || args.dx < -50 || args.dx > 50)) {
        throw new Error("dx must be an integer between -50 and 50.");
      }
      if (hasExplicitDy && (!Number.isInteger(args.dy) || args.dy < -50 || args.dy > 50)) {
        throw new Error("dy must be an integer between -50 and 50.");
      }
      dx = hasExplicitDx ? args.dx : 0;
      dy = hasExplicitDy ? args.dy : 0;
    } else {
      const amount = args.amount === undefined ? 5 : args.amount;
      if (!Number.isInteger(amount) || amount < 1 || amount > 50) {
        throw new Error("amount must be an integer between 1 and 50.");
      }
      const dir = typeof args.direction === "string" ? args.direction : "down";
      if (dir === "down") dy = -amount;
      else if (dir === "up") dy = amount;
      else if (dir === "left") dx = -amount;
      else if (dir === "right") dx = amount;
      else throw new Error("direction must be one of: down, up, left, right.");
    }

    const hasRelX = args.rel_x !== undefined;
    const hasRelY = args.rel_y !== undefined;
    if (hasRelX !== hasRelY) {
      throw new Error("Provide both rel_x and rel_y together, or omit both to scroll at window center.");
    }
    if (hasRelX) {
      if (!Number.isInteger(args.rel_x) || !Number.isInteger(args.rel_y)) {
        throw new Error("rel_x and rel_y must be integers.");
      }
      if (
        !target.minimized &&
        (args.rel_x < 0 || args.rel_x >= target.width || args.rel_y < 0 || args.rel_y >= target.height)
      ) {
        throw new Error(
          `Security policy blocked scroll outside target window bounds: (${args.rel_x}, ${args.rel_y})`
        );
      }
    }

    const scrollRes = await worker.request(
      {
        cmd: "scroll_window",
        hwnd: target.hwnd,
        dx,
        dy,
        rel_x: hasRelX ? args.rel_x : undefined,
        rel_y: hasRelY ? args.rel_y : undefined,
        restore_cursor: args.restore_cursor !== false,
        restore_focus: args.restore_focus === true,
      },
      15000
    );
    if (!scrollRes.ok) throw new Error(scrollRes.error || "scroll_window failed");
    return { ...scrollRes.data, elapsed_ms: Date.now() - start };
  }

  if (name === "send_hotkey") {
    const baseList = Array.isArray(args.combos) && args.combos.length > 0
      ? args.combos
      : (typeof args.combo === "string" && args.combo.trim() ? [args.combo] : []);
    if (baseList.length === 0) {
      throw new Error("Provide either 'combo' or non-empty 'combos' array.");
    }

    const repeat = Number.isInteger(args.repeat) ? args.repeat : 1;
    if (repeat < 1 || repeat > 20) {
      throw new Error("repeat must be an integer between 1 and 20.");
    }

    const parsedSpecs = baseList.map((c) => normalizeHotkey(c));
    const expandedCombos = [];
    for (let r = 0; r < repeat; r++) {
      for (const s of parsedSpecs) {
        expandedCombos.push(s.workerCombo);
      }
    }
    if (expandedCombos.length > 30) {
      throw new Error("Total hotkey steps (combos.length * repeat) cannot exceed 30.");
    }

    const allGlobalMedia = parsedSpecs.every((s) => s.isGlobalMedia);
    let target = null;
    if (!allGlobalMedia) {
      target = await resolveAndValidateWindow(args, "hotkey");
    }

    const delayMs = Number.isInteger(args.delay_ms) ? Math.max(20, Math.min(500, args.delay_ms)) : 65;
    const hkRes = await worker.request({
      cmd: "send_hotkey",
      combos: expandedCombos,
      delay_ms: delayMs,
      hwnd: target ? target.hwnd : undefined,
      restore_focus: args.restore_focus === true,
    });
    if (!hkRes.ok) throw new Error(hkRes.error || "send_hotkey failed");
    return { ...hkRes.data, elapsed_ms: Date.now() - start };
  }

  if (name === "export_document") {
    const exported = exportDocumentFile({
      filename: args.filename,
      format: args.format || "",
      title: args.title || "",
      content: args.content || "",
      rows: Array.isArray(args.rows) ? args.rows : null,
      source_path: typeof args.source_path === "string" ? args.source_path : "",
    });

    let opened = false;
    if (args.open_after === true) {
      const safePath = assertSafeOpenPath(exported.path);
      const openRes = await worker.request({ cmd: "open_path", path: safePath });
      if (!openRes.ok) throw new Error(openRes.error || "Failed to open exported document");
      opened = true;
    }

    return { ...exported, opened, elapsed_ms: Date.now() - start };
  }

  if (name === "manage_edge_tabs") {
    const validActions = new Set(["list", "switch", "close_others", "close_matching", "close_latest_matching"]);
    const action = typeof args.action === "string" ? args.action.trim().toLowerCase() : "";
    if (!validActions.has(action)) {
      throw new Error("action must be one of: list, switch, close_others, close_matching, close_latest_matching.");
    }
    const keepTitle = typeof args.keep_title === "string" ? args.keep_title.trim() : "";
    const matchTitle = typeof args.match_title === "string" ? args.match_title.trim() : "";
    const secAction = action === "list" ? "read" : "tab_control";

    let candidateTargets = [];
    if (args.hwnd) {
      const target = await resolveAndValidateWindow({ hwnd: args.hwnd }, secAction);
      candidateTargets = [target];
    } else {
      const listRes = await worker.request({ cmd: "list_windows", filter: "" });
      if (!listRes.ok) throw new Error(listRes.error || "Failed to enumerate windows");
      const windows = Array.isArray(listRes.data) ? listRes.data : listRes.data ? [listRes.data] : [];
      const needleTitle = (matchTitle || keepTitle).toLowerCase();
      const isEdgeBrowserTitle = (tl) =>
        (tl.includes("microsoft") && tl.includes("edge")) ||
        tl.includes("new tab") ||
        tl.includes("tab mới") ||
        tl.includes("inprivate");

      const edgeWins = windows.filter((w) => {
        const proc = String(w.process || "").toLowerCase();
        return proc === "msedge" && (w.width >= 260 || w.minimized) && (w.height >= 160 || w.minimized);
      });
      if (edgeWins.length === 0) {
        throw new Error("No matching visible window found.");
      }
      edgeWins.sort((a, b) => {
        const atl = String(a.title || "").toLowerCase();
        const btl = String(b.title || "").toLowerCase();
        const aTitleHit = needleTitle && atl.includes(needleTitle) ? 1 : 0;
        const bTitleHit = needleTitle && btl.includes(needleTitle) ? 1 : 0;
        if (aTitleHit !== bTitleHit) return bTitleHit - aTitleHit;
        const aBrowser = isEdgeBrowserTitle(atl) ? 1 : 0;
        const bBrowser = isEdgeBrowserTitle(btl) ? 1 : 0;
        if (aBrowser !== bBrowser) return bBrowser - aBrowser;
        if (a.focused !== b.focused) return a.focused ? -1 : 1;
        if (a.minimized !== b.minimized) return a.minimized ? 1 : -1;
        return (b.width || 0) - (a.width || 0);
      });
      for (const w of edgeWins) {
        assertSafeTarget(w, secAction);
      }
      candidateTargets = edgeWins;
    }

    let lastRes = null;
    for (const target of candidateTargets) {
      const tabRes = await worker.request(
        {
          cmd: "manage_edge_tabs",
          hwnd: target.hwnd,
          action,
          keep_title: keepTitle,
          match_title: matchTitle,
        },
        25000
      );
      lastRes = tabRes;
      if (!tabRes.ok) {
        if (candidateTargets.length === 1) throw new Error(tabRes.error || "manage_edge_tabs failed");
        continue;
      }
      const d = tabRes.data || {};
      const foundMatch =
        action === "list"
          ? Number(d.count || 0) > 0
          : action === "switch"
            ? Boolean(d.switched_to)
            : Number(d.closed_count || 0) > 0;
      if (foundMatch || candidateTargets.length === 1) {
        return { ...d, elapsed_ms: Date.now() - start };
      }
    }
    if (!lastRes?.ok) throw new Error(lastRes?.error || "manage_edge_tabs failed");
    return { ...(lastRes.data || {}), elapsed_ms: Date.now() - start };
  }

  if (name === "set_brightness") {
    const hasLevel = Number.isInteger(args.level);
    const hasDelta = Number.isInteger(args.delta);
    if (!hasLevel && !hasDelta) {
      throw new Error("Provide either 'level' (5-100) or 'delta' (-95 to +95).");
    }
    if (hasLevel && (args.level < 5 || args.level > 100)) {
      throw new Error("level must be between 5 and 100.");
    }
    if (hasDelta && (args.delta < -95 || args.delta > 95)) {
      throw new Error("delta must be between -95 and 95.");
    }
    const bRes = await worker.request({
      cmd: "set_brightness",
      level: hasLevel ? args.level : undefined,
      delta: hasDelta ? args.delta : undefined,
    });
    if (!bRes.ok) throw new Error(bRes.error || "set_brightness failed");
    return { ...bRes.data, elapsed_ms: Date.now() - start };
  }

  if (name === "open_path") {
    const safePath = assertSafeOpenPath(args.path);
    const openRes = await worker.request({ cmd: "open_path", path: safePath });
    if (!openRes.ok) throw new Error(openRes.error || "open_path failed");
    return { ...openRes.data, elapsed_ms: Date.now() - start };
  }

  throw new Error(`Unknown tool: ${name}`);
}

function sendJsonRpc(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

async function handleJsonRpcMessage(msg) {
  // Ignore notifications (no id)
  if (msg.id === undefined || msg.id === null) {
    return;
  }

  const { id, method, params } = msg;

  try {
    if (method === "initialize") {
      const requested = params?.protocolVersion;
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.has(requested) ? requested : "2025-03-26";
      sendJsonRpc({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: "fast-desktop", version: "1.0.0" },
        },
      });
      return;
    }

    if (method === "ping") {
      sendJsonRpc({ jsonrpc: "2.0", id, result: {} });
      return;
    }

    if (method === "tools/list") {
      sendJsonRpc({
        jsonrpc: "2.0",
        id,
        result: { tools: TOOLS },
      });
      return;
    }

    if (method === "tools/call") {
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};
      try {
        const result = await handleToolCall(toolName, toolArgs);
        sendJsonRpc({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: JSON.stringify(result) }],
          },
        });
      } catch (err) {
        sendJsonRpc({
          jsonrpc: "2.0",
          id,
          result: {
            isError: true,
            content: [{ type: "text", text: err.message || String(err) }],
          },
        });
      }
      return;
    }

    sendJsonRpc({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  } catch (err) {
    sendJsonRpc({
      jsonrpc: "2.0",
      id,
      error: { code: -32603, message: err.message || String(err) },
    });
  }
}

const inputRl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

inputRl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const parsed = JSON.parse(trimmed);
    handleJsonRpcMessage(parsed);
  } catch (err) {
    process.stderr.write(`[fast-desktop-mcp] Failed to parse JSON-RPC line: ${err.message}\n`);
  }
});

inputRl.on("close", () => {
  worker.dispose();
  process.exit(0);
});

process.on("SIGINT", () => {
  worker.dispose();
  process.exit(0);
});
process.on("SIGTERM", () => {
  worker.dispose();
  process.exit(0);
});
