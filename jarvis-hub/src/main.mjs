import { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, dialog, clipboard, shell } from "electron";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import readline from "node:readline";
import { spawn, execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  WORKSPACE_ROOT,
  EXPORTS_DIR,
  loadHubState,
  saveHubState,
  readSafetyMode,
  sanitizeWakeName,
  sanitizeWakeSensitivity,
  setSafetyMode,
} from "./env-loader.mjs";
import { McpHub } from "./mcp-hub.mjs";
import { GeminiAgent } from "./gemini-agent.mjs";
import { tryLocalFallbackCommand } from "./local-fallback.mjs";

const BACKEND_CANDIDATE_PORTS = [
  ...(Number(process.env.JARVIS_BACKEND_PORT) ? [Number(process.env.JARVIS_BACKEND_PORT)] : []),
  8765,
  18765,
  18766,
  18767,
  18768,
  18769,
];
let activeBackendPort = BACKEND_CANDIDATE_PORTS[0];
const getLocalBackendUrl = () => `http://127.0.0.1:${activeBackendPort}`;
const BACKEND_TOKEN_PATH = path.join(WORKSPACE_ROOT, "backend", ".session_token");
let backendBootPromise = null;
const activeBackendControllers = new Set();

async function probeJarvisBackend(port, timeoutMs = 1200) {
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!resp.ok) return null;
    const data = await resp.json();
    // Strict app fingerprint so another local AI app on :8765 (e.g. translation launcher) is NEVER mistaken for Jarvis-Hub
    if (
      data &&
      data.ok === true &&
      typeof data.mcp_status === "object" &&
      (data.app_name === "Black Sakura Jarvis-Hub" || typeof data.api_fallback_enabled === "boolean")
    ) {
      return data;
    }
  } catch {}
  return null;
}

function isPortListeningLocal(port, timeoutMs = 350) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host: "127.0.0.1", port });
    let done = false;
    const finish = (listening) => {
      if (done) return;
      done = true;
      try {
        sock.destroy();
      } catch {}
      resolve(listening);
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => finish(true));
    sock.once("timeout", () => finish(false));
    sock.once("error", () => finish(false));
  });
}

async function isPortFree(port) {
  // On Windows, a service bound to 0.0.0.0:port can sometimes allow a non-exclusive 127.0.0.1 bind;
  // checking TCP connect first guarantees we detect any active listener immediately.
  if (await isPortListeningLocal(port, 350)) return false;
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.unref();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => {
      srv.close(() => resolve(true));
    });
    srv.listen({ port, host: "127.0.0.1", exclusive: true });
  });
}

function pickEphemeralFreePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.unref();
    srv.once("error", () => resolve(18770));
    srv.once("listening", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 18770;
      srv.close(() => resolve(port));
    });
    srv.listen({ port: 0, host: "127.0.0.1", exclusive: true });
  });
}

function readBackendSessionToken() {
  try {
    if (fs.existsSync(BACKEND_TOKEN_PATH)) {
      return fs.readFileSync(BACKEND_TOKEN_PATH, "utf8").trim();
    }
  } catch {}
  return String(process.env.JARVIS_API_TOKEN || "").trim();
}

function abortInFlightBackendCalls() {
  for (const entry of activeBackendControllers) {
    entry.cancelledByWake = true;
    try {
      entry.ctrl.abort();
    } catch {}
  }
}

async function callLocalBackend(endpoint, payload = null, timeoutMs = 90000, autoBoot = true) {
  const attempt = async () => {
    const ctrl = new AbortController();
    const track = endpoint !== "/panic" && endpoint !== "/status";
    const entry = { ctrl, cancelledByWake: false };
    if (track) activeBackendControllers.add(entry);
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const headers = {};
      if (payload !== null) headers["Content-Type"] = "application/json";
      const token = readBackendSessionToken();
      if (token) headers["X-Jarvis-Token"] = token;
      const resp = await fetch(`${getLocalBackendUrl()}${endpoint}`, {
        method: payload !== null ? "POST" : "GET",
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        body: payload !== null ? JSON.stringify(payload) : undefined,
        signal: ctrl.signal,
      });
      if (!resp.ok) {
        if (resp.status === 404 && endpoint === "/status") {
          // Another unrelated service is occupying this port; trigger free-port fallback
          return null;
        }
        let serverDetail = "";
        try {
          const errBody = await resp.json();
          serverDetail = errBody?.error || errBody?.detail || "";
        } catch {}
        return {
          ok: false,
          __httpError: resp.status,
          error: serverDetail || `Backend (:${activeBackendPort}) trả về lỗi HTTP ${resp.status}`,
        };
      }
      const data = await resp.json();
      if (
        endpoint === "/status" &&
        !(
          data &&
          data.ok === true &&
          typeof data.mcp_status === "object" &&
          (data.app_name === "Black Sakura Jarvis-Hub" || typeof data.api_fallback_enabled === "boolean")
        )
      ) {
        return null;
      }
      return data;
    } catch (err) {
      if (err?.name === "AbortError") {
        if (entry.cancelledByWake) {
          return { ok: false, __cancelled: true, cancelled: true };
        }
        return { ok: false, __timeout: true, error: `Backend (:${activeBackendPort}) xử lý quá lâu — thử lại nhé.` };
      }
      return null; // Connection refused / unreachable
    } finally {
      clearTimeout(timer);
      if (track) activeBackendControllers.delete(entry);
    }
  };

  let res = await attempt();
  if ((res === null || res?.__httpError === 404 || res?.__httpError === 405) && autoBoot) {
    await ensureLocalBackendRunning().catch(() => {});
    res = await attempt();
  }
  return res;
}

async function maybeAttachLocalTts(text) {
  if (!hubState.voiceReplyAlways || !text) return {};
  const tts = await callLocalBackend("/tts", { text }, 15000, false);
  if (tts?.ok && tts.audio_base64) {
    return { audioWavBase64: tts.audio_base64, audioMimeType: tts.mime_type || "audio/mpeg" };
  }
  return {};
}

function isRealPythonExe(filePath) {
  try {
    if (!filePath || filePath.toLowerCase().includes(`${path.sep}microsoft${path.sep}windowsapps${path.sep}`)) {
      return false;
    }
    const st = fs.statSync(filePath);
    return st.isFile() && st.size > 50000;
  } catch {
    return false;
  }
}

function resolvePythonExecutable({ preferConsole = false } = {}) {
  const names = preferConsole ? ["python.exe", "pythonw.exe"] : ["pythonw.exe", "python.exe"];
  const venvDirs = [
    path.join(WORKSPACE_ROOT, ".venv", "Scripts"),
    path.join(WORKSPACE_ROOT, "venv", "Scripts"),
  ];
  for (const dir of venvDirs) {
    for (const nm of names) {
      const cand = path.join(dir, nm);
      if (isRealPythonExe(cand)) return cand;
    }
  }
  const searchBases = [
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Python"),
    path.join(process.env.ProgramFiles || "C:\\Program Files"),
    "C:\\",
  ];
  for (const base of searchBases) {
    for (const ver of ["Python314", "Python313", "Python312", "Python311", "Python310"]) {
      const pyDir = path.join(base, ver);
      for (const nm of names) {
        const cand = path.join(pyDir, nm);
        if (isRealPythonExe(cand)) return cand;
      }
    }
  }
  for (const dir of String(process.env.PATH || "").split(path.delimiter)) {
    const cleanDir = dir.trim().replace(/^"|"$/g, "");
    if (!cleanDir) continue;
    for (const nm of names) {
      const cand = path.join(cleanDir, nm);
      if (isRealPythonExe(cand)) return cand;
    }
  }
  return "";
}

function isZoneBlocked(filePath) {
  try {
    return Boolean(filePath && fs.existsSync(`${filePath}:Zone.Identifier`));
  } catch {
    return false;
  }
}

function resolveOllamaLaunch() {
  // Prioritize headless CLI server (`ollama.exe serve`) so the Ollama desktop GUI window never pops up on Hub startup.
  const candidates = [
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Ollama", "ollama.exe"),
    path.join(os.homedir(), "AppData", "Local", "Programs", "Ollama", "ollama.exe"),
    path.join(process.env.ProgramFiles || "", "Ollama", "ollama.exe"),
  ];
  for (const oll of candidates) {
    if (oll && fs.existsSync(oll)) return { exe: oll, args: ["serve"] };
  }
  return null;
}

function getOllamaBaseUrl() {
  return String(process.env.OLLAMA_HOST || "http://127.0.0.1:11434").trim().replace(/\/+$/, "");
}

async function probeOllamaDirect(timeoutMs = 1200) {
  try {
    const resp = await fetch(`${getOllamaBaseUrl()}/api/tags`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!resp.ok) return { online: false, models: [] };
    const data = await resp.json();
    const models = Array.isArray(data?.models)
      ? [...new Set(data.models.map((m) => String(m?.name || "").trim()).filter(Boolean))].sort()
      : [];
    return { online: true, models };
  } catch {
    return { online: false, models: [] };
  }
}

function startOllamaServeHeadless() {
  try {
    const oll = resolveOllamaLaunch();
    if (!oll) return false;
    const pyExe = resolvePythonExecutable();
    if (pyExe.toLowerCase().endsWith("pythonw.exe") && fs.existsSync(pyExe)) {
      const pyCode = [
        "import subprocess, sys",
        "si = subprocess.STARTUPINFO()",
        "si.dwFlags |= subprocess.STARTF_USESHOWWINDOW",
        "si.wShowWindow = 0",
        "subprocess.Popen([sys.argv[1], *sys.argv[2:]], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, startupinfo=si, creationflags=0x08000200, close_fds=True)",
      ].join("; ");
      const p = spawn(pyExe, ["-c", pyCode, oll.exe, ...oll.args], { stdio: "ignore", windowsHide: true });
      p.on("error", () => {});
      p.unref();
    } else {
      const p = spawn(oll.exe, oll.args, { stdio: "ignore", windowsHide: true, detached: true });
      p.on("error", () => {});
      p.unref();
    }
    return true;
  } catch {
    return false;
  }
}

async function ensureLocalBackendRunning(installedApps = []) {
  if (backendBootPromise) return backendBootPromise;
  backendBootPromise = (async () => {
    const ollProbe = await probeOllamaDirect(1100);
    if (!ollProbe.online) {
      startOllamaServeHeadless();
    }

    // 1. Check if a Black Sakura Jarvis-Hub backend is already running on any candidate port
    let st = null;
    for (const p of [...new Set([activeBackendPort, ...BACKEND_CANDIDATE_PORTS])]) {
      const probed = await probeJarvisBackend(p, 1200);
      if (probed) {
        activeBackendPort = p;
        st = probed;
        break;
      }
    }

    // 2. Otherwise pick the first FREE port (avoids conflict if another local AI app holds :8765) and boot uvicorn
    if (!st?.ok) {
      try {
        let chosenPort = null;
        for (const candPort of [...new Set([activeBackendPort, ...BACKEND_CANDIDATE_PORTS])]) {
          if (await isPortFree(candPort)) {
            chosenPort = candPort;
            break;
          }
        }
        if (!chosenPort) {
          chosenPort = await pickEphemeralFreePort();
        }
        activeBackendPort = chosenPort;
        const pyExe = resolvePythonExecutable();
        if (!pyExe) {
          return;
        }
        if (!localBackendProc) {
          localBackendProc = spawn(
            pyExe,
            ["-m", "uvicorn", "backend.server:app", "--host", "127.0.0.1", "--port", String(chosenPort)],
            {
              cwd: WORKSPACE_ROOT,
              stdio: "ignore",
              windowsHide: true,
              env: {
                ...process.env,
                JARVIS_BACKEND_PORT: String(chosenPort),
                JARVIS_ELECTRON_EXE: process.execPath,
              },
            }
          );
          localBackendProc.on("error", () => {
            localBackendProc = null;
          });
          localBackendProc.on("exit", () => {
            localBackendProc = null;
          });
        }
        for (let i = 0; i < 30; i++) {
          if (isQuittingHub) break;
          await new Promise((r) => setTimeout(r, 400));
          st = await probeJarvisBackend(chosenPort, 1200);
          if (st?.ok) break;
        }
      } catch {}
    }
    if (st?.ok) {
      callLocalBackend("/set-safety", { safety_mode: currentSafetyMode }, 2500, false).catch(() => {});
      if (Array.isArray(installedApps) && installedApps.length > 0) {
        callLocalBackend("/sync-apps", { apps: installedApps }, 3000, false).catch(() => {});
      }
    }
  })().finally(() => {
    backendBootPromise = null;
  });
  return backendBootPromise;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HUB_WIN_WIDTH = 640;
const HUB_WIN_HEIGHT = 700;
const COLLAPSE_EMPTY_EDIT_MS = 16000;
const COLLAPSE_NONIDLE_MS = 30000;
const COLLAPSE_DRAWER_MS = 90000;
const DIM_AFTER_IDLE_MS = 16000;
const HIDE_AFTER_IDLE_MS = 36000;
const HIDE_FADE_MS = 350;

let mainWindow = null;
let setupWindow = null;
let activeSetupProc = null;
let tray = null;
let hotkeyProc = null;
let localBackendProc = null;
let mcpHub = null;
let agent = null;
let hubState = loadHubState();
let currentSafetyMode = readSafetyMode();
let nextConfirmId = 1;
const pendingConfirms = new Map();
let activeDisplayId = null;
let displayDebounceTimer = null;
let crossDpiVerifyTimer = null;
let inactivityTimer = null;
let fadeHideTimer = null;
let hoverSafetyTimer = null;
let isQuittingHub = false;
let wakeRestartTimer = null;
let lastWakeAcceptedAt = 0;
let preferPsWakeFallback = false;
let wakeRestartCount = 0;

function appendWakeLog(line) {
  try {
    const logPath = path.join(__dirname, "..", "wake-debug.log");
    if (fs.existsSync(logPath) && fs.statSync(logPath).size > 24576) {
      const prev = fs.readFileSync(logPath, "utf8").split(/\r?\n/).slice(-80).join("\n");
      fs.writeFileSync(logPath, `${prev}\n`, "utf8");
    }
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${line}\n`, "utf8");
  } catch {}
}

const activityState = {
  islandState: "idle",
  busy: false,
  hovering: false,
  drawerOpen: false,
  isEditing: false,
  hasDraftText: false,
  ignoreMouse: true,
  interactiveRects: [],
  lastActiveAt: Date.now(),
  isDimmed: false,
  isFadingOut: false,
};

/**
 * Create a clean 32x32 RGBA PNG tray icon programmatically (no external asset files needed).
 */
function createTrayIcon() {
  const icoPath = path.join(__dirname, "..", "jarvis.ico");
  if (fs.existsSync(icoPath)) {
    const img = nativeImage.createFromPath(icoPath);
    if (!img.isEmpty()) return img.resize({ width: 32, height: 32 });
  }
  const size = 32;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const cx = 15.5;
  const cy = 15.5;
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const px = rowStart + 1 + x * 4;
      if (dist <= 13.5) {
        const t = dist / 13.5;
        // Cyan -> Indigo glow gradient
        raw[px] = Math.round(38 + t * 55);     // R
        raw[px + 1] = Math.round(215 - t * 90); // G
        raw[px + 2] = Math.round(255 - t * 20); // B
        raw[px + 3] = dist > 11.8 ? Math.round(255 * Math.max(0, (13.5 - dist) / 1.7)) : 255;
        if (dist <= 5.2) {
          raw[px] = 225;
          raw[px + 1] = 248;
          raw[px + 2] = 255;
        }
      } else {
        raw[px + 3] = 0;
      }
    }
  }

  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const tBuf = Buffer.from(type, "ascii");
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([tBuf, data])), 0);
    return Buffer.concat([lenBuf, tBuf, data, crcBuf]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const idat = zlib.deflateSync(raw);
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return nativeImage.createFromBuffer(png);
}

function emitHud(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("hub:event", payload);
  }
}

function detectAspectRatioLabel(w, h) {
  if (!w || !h) return "16:9";
  if (h > w) return "Dọc (Portrait)";
  const r = w / h;
  if (r >= 3.0) return "32:9 SuperWide";
  if (r >= 2.2) return "21:9 UltraWide";
  if (r >= 1.72) return "16:9";
  if (r >= 1.54) return "16:10";
  if (r >= 1.44) return "3:2";
  return "4:3";
}

function getAvailableDisplaysInfo() {
  const primaryId = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, idx) => {
    const isPrimary = d.id === primaryId;
    const sf = Number(d.scaleFactor || 1);
    const w = Math.round(d.size?.width || d.bounds?.width || 0);
    const h = Math.round(d.size?.height || d.bounds?.height || 0);
    const physW = Math.round(w * sf);
    const physH = Math.round(h * sf);
    const scale = Math.round(sf * 100);
    const aspect = detectAspectRatioLabel(physW, physH);
    return {
      id: d.id,
      index: idx + 1,
      isPrimary,
      width: w,
      height: h,
      physicalWidth: physW,
      physicalHeight: physH,
      aspectRatio: aspect,
      scalePercent: scale,
      label: `Màn ${idx + 1}${isPrimary ? " (Chính)" : ""} · ${physW}×${physH} (${aspect}, ${scale}%)`,
    };
  });
}

function resolveTargetDisplay() {
  const mode = String(hubState.displayMode || "cursor");
  const all = screen.getAllDisplays();
  if (mode.startsWith("display:")) {
    const targetId = Number(mode.slice("display:".length));
    const found = all.find((d) => d.id === targetId);
    if (found) return found;
  }
  if (mode === "cursor") {
    try {
      const pt = screen.getCursorScreenPoint();
      return screen.getDisplayNearestPoint(pt);
    } catch {}
  }
  return screen.getPrimaryDisplay();
}

function computeAdaptiveZoomForDisplay(display) {
  const wa = display?.workArea || screen.getPrimaryDisplay().workArea;
  const sf = Number(display?.scaleFactor || 1);
  // Small laptops (e.g. 1366x768) or high DPI (150%+) where CSS workArea is tight -> gently shrink to prevent clipping
  if (wa.height < 640 || wa.width < 960) return 0.84;
  if (wa.height < 740 || wa.width < 1180) return 0.92;
  // Native 4K / huge ultrawide at 100% scale -> gently enlarge for readability
  if (wa.width >= 2400 && wa.height >= 1300 && sf <= 1.1) return 1.12;
  return 1.0;
}

function computeCenteredBoundsForDisplay(display) {
  const wa = display?.workArea || screen.getPrimaryDisplay().workArea;
  const zoom = computeAdaptiveZoomForDisplay(display);
  const desiredW = Math.round(HUB_WIN_WIDTH * zoom);
  const desiredH = Math.round(HUB_WIN_HEIGHT * zoom);
  const winW = Math.min(desiredW, Math.max(400, wa.width - 12));
  const winH = Math.min(desiredH, Math.max(380, wa.height - 8));
  return {
    x: Math.round(wa.x + (wa.width - winW) / 2),
    y: Math.round(wa.y),
    width: winW,
    height: winH,
    zoomFactor: zoom,
  };
}

function applyBoundsSafe(targetBounds) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setAlwaysOnTop(true, "screen-saver");
  mainWindow.setBounds(targetBounds);
  const actual = mainWindow.getBounds();
  if (
    Math.abs(actual.x - targetBounds.x) > 2 ||
    Math.abs(actual.y - targetBounds.y) > 2 ||
    Math.abs(actual.width - targetBounds.width) > 4 ||
    Math.abs(actual.height - targetBounds.height) > 4
  ) {
    mainWindow.setBounds(targetBounds);
  }
}

function positionWindowTopCenter() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const target = resolveTargetDisplay();
  const prevDisplayId = activeDisplayId;
  activeDisplayId = target.id;
  const targetBounds = computeCenteredBoundsForDisplay(target);
  applyBoundsSafe(targetBounds);
  try {
    mainWindow.webContents.setZoomFactor(targetBounds.zoomFactor || 1.0);
  } catch {}

  if (prevDisplayId !== null && prevDisplayId !== target.id) {
    clearTimeout(crossDpiVerifyTimer);
    crossDpiVerifyTimer = setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      const verified = resolveTargetDisplay();
      const verifiedBounds = computeCenteredBoundsForDisplay(verified);
      applyBoundsSafe(verifiedBounds);
      try {
        mainWindow.webContents.setZoomFactor(verifiedBounds.zoomFactor || 1.0);
      } catch {}
    }, 80);
  }
}

function clearInactivityTimers() {
  if (inactivityTimer) {
    clearTimeout(inactivityTimer);
    inactivityTimer = null;
  }
  if (fadeHideTimer) {
    clearTimeout(fadeHideTimer);
    fadeHideTimer = null;
  }
}

function stopHoverSafetyPoll() {
  if (hoverSafetyTimer) {
    clearInterval(hoverSafetyTimer);
    hoverSafetyTimer = null;
  }
}

function isCursorInsideInteractiveHub() {
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return false;
  try {
    const cursor = screen.getCursorScreenPoint();
    const b = mainWindow.getBounds();
    const rx = cursor.x - b.x;
    const ry = cursor.y - b.y;
    if (rx < -12 || ry < -12 || rx > b.width + 12 || ry > b.height + 12) {
      return false;
    }
    let zoom = 1.0;
    try {
      zoom = Number(mainWindow.webContents.getZoomFactor() || 1.0) || 1.0;
    } catch {}
    const rects = activityState.interactiveRects;
    if (!Array.isArray(rects) || rects.length === 0) {
      return rx >= 0 && ry >= 0 && rx <= b.width && ry <= b.height;
    }
    for (const r of rects) {
      const left = r.left * zoom;
      const right = r.right * zoom;
      const top = r.top * zoom;
      const bottom = r.bottom * zoom;
      if (
        r.width > 0 &&
        r.height > 0 &&
        rx >= left - 18 &&
        rx <= right + 18 &&
        ry >= top - 18 &&
        ry <= bottom + 18
      ) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

function startHoverSafetyPoll() {
  if (hoverSafetyTimer || !mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return;
  hoverSafetyTimer = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) {
      stopHoverSafetyPoll();
      return;
    }
    if (!activityState.hovering && activityState.ignoreMouse) {
      stopHoverSafetyPoll();
      return;
    }
    if (!isCursorInsideInteractiveHub()) {
      activityState.hovering = false;
      activityState.ignoreMouse = true;
      mainWindow.setIgnoreMouseEvents(true, { forward: true });
      emitHud({ type: "force_hover_leave" });
      stopHoverSafetyPoll();
      markHubActivity("hover_leave_watchdog");
    }
  }, 180);
}

function scheduleInactivityEvaluation() {
  clearTimeout(inactivityTimer);
  inactivityTimer = null;
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return;
  if (activityState.busy || activityState.hovering) return;

  const elapsed = Date.now() - activityState.lastActiveAt;

  // Non-idle states (e.g., opened input/drawer/error/listening without active voice or thinking):
  // auto-collapse cleanly back to Idle after inactivity so Hub never gets permanently stuck open.
  if (activityState.islandState !== "idle" || activityState.drawerOpen || activityState.isEditing) {
    if (activityState.hasDraftText && activityState.isEditing) return;
    const collapseWait = activityState.drawerOpen
      ? COLLAPSE_DRAWER_MS
      : activityState.isEditing
        ? COLLAPSE_EMPTY_EDIT_MS
        : COLLAPSE_NONIDLE_MS;
    const remaining = Math.max(250, collapseWait - elapsed);
    inactivityTimer = setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return;
      if (activityState.busy || activityState.hovering) return;
      if (activityState.hasDraftText && activityState.isEditing) return;
      emitHud({ type: "auto_collapse_idle" });
      activityState.islandState = "idle";
      activityState.drawerOpen = false;
      activityState.isEditing = false;
      activityState.lastActiveAt = Date.now();
      scheduleInactivityEvaluation();
    }, remaining);
    return;
  }

  // Idle state: Step 1 -> Dim at 8s, Step 2 -> Smooth fade-out & hide to Tray at 18s
  if (!activityState.isDimmed) {
    const untilDim = Math.max(150, DIM_AFTER_IDLE_MS - elapsed);
    inactivityTimer = setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return;
      if (activityState.busy || activityState.hovering || activityState.islandState !== "idle") return;
      activityState.isDimmed = true;
      emitHud({ type: "set_dimmed", dimmed: true });
      scheduleInactivityEvaluation();
    }, untilDim);
    return;
  }

  const untilHide = Math.max(200, HIDE_AFTER_IDLE_MS - elapsed);
  inactivityTimer = setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return;
    if (activityState.busy || activityState.hovering || activityState.islandState !== "idle") return;
    activityState.isFadingOut = true;
    emitHud({ type: "prepare_hide" });
    fadeHideTimer = setTimeout(() => {
      fadeHideTimer = null;
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (activityState.busy || activityState.hovering || activityState.islandState !== "idle") {
        activityState.isFadingOut = false;
        emitHud({ type: "set_dimmed", dimmed: false });
        return;
      }
      hideHubWindow();
    }, HIDE_FADE_MS);
  }, untilHide);
}

function markHubActivity(reason = "activity") {
  activityState.lastActiveAt = Date.now();
  if (fadeHideTimer) {
    clearTimeout(fadeHideTimer);
    fadeHideTimer = null;
  }
  if (activityState.isDimmed || activityState.isFadingOut) {
    activityState.isDimmed = false;
    activityState.isFadingOut = false;
    emitHud({ type: "set_dimmed", dimmed: false, reason });
  }
  scheduleInactivityEvaluation();
}

function hideHubWindow() {
  clearInactivityTimers();
  stopHoverSafetyPoll();
  activityState.hovering = false;
  activityState.ignoreMouse = true;
  activityState.isDimmed = false;
  activityState.isFadingOut = false;
  // Always resume wake-word detection whenever Hub hides to System Tray (guard broken pipe so hide NEVER fails)
  try {
    if (hotkeyProc?.stdin?.writable) {
      hotkeyProc.stdin.write('{"cmd":"pause_wake","paused":false}\n');
    }
  } catch {}
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.setIgnoreMouseEvents(true, { forward: true });
      mainWindow.hide();
    } catch {}
  }
  emitHud({ type: "hub_hidden" });
}

function showHubWindow({ focus = false, reason = "show" } = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const wasHidden = !mainWindow.isVisible();
  clearInactivityTimers();
  activityState.isDimmed = false;
  activityState.isFadingOut = false;
  activityState.lastActiveAt = Date.now();
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  positionWindowTopCenter();
  if (focus) {
    mainWindow.show();
    mainWindow.setAlwaysOnTop(true, "screen-saver");
    mainWindow.moveTop();
    mainWindow.focus();
  } else {
    mainWindow.showInactive();
    mainWindow.setAlwaysOnTop(true, "screen-saver");
    mainWindow.moveTop();
  }
  emitHud({ type: "hub_appear", reason, wasHidden });
  scheduleInactivityEvaluation();
}

function recordRecentCommand(text) {
  const clean = String(text || "").trim();
  if (!clean || clean.length > 90) return;
  const filtered = hubState.recentCommands.filter((c) => c.toLowerCase() !== clean.toLowerCase());
  hubState.recentCommands = [clean, ...filtered].slice(0, 5);
  saveHubState(hubState);
  emitHud({ type: "state_sync", ...getPublicState() });
}

function getPublicState() {
  return {
    safetyMode: currentSafetyMode,
    hotkey: hubState.hotkey,
    wakeWordEnabled: hubState.wakeWordEnabled !== false,
    wakeName: sanitizeWakeName(hubState.wakeName || "Luna"),
    wakeSensitivity: sanitizeWakeSensitivity(hubState.wakeSensitivity),
    voiceReplyAlways: hubState.voiceReplyAlways,
    recentCommands: hubState.recentCommands,
    localModelPreset: hubState.localModelPreset || "qwen3.5:4b",
    sakugaEnabled: hubState.sakugaEnabled !== false,
    displayMode: hubState.displayMode || "cursor",
    displays: getAvailableDisplaysInfo(),
    uiLanguage: hubState.uiLanguage === "en" ? "en" : "vi",
    customDictionary: hubState.customDictionary || [],
    installedApps: Array.isArray(agent?.installedApps) ? agent.installedApps.slice(0, 45) : [],
    health: mcpHub ? mcpHub.getHealth() : { fastDesktop: false, playwright: false, filesystem: false },
  };
}

function formatConfirmSummary(toolName, args) {
  if (toolName === "handoff_to_antigravity") {
    return `Xếp hàng sang Antigravity (task_inbox.json & clipboard): "${String(args?.task || "").slice(0, 140)}"`;
  }
  try {
    const preview = JSON.stringify(args || {});
    const shortArgs = preview.length > 120 ? `${preview.slice(0, 120)}...` : preview;
    return `${toolName}(${shortArgs})`;
  } catch {
    return toolName;
  }
}

function requestConfirmation({ toolName, args }) {
  return new Promise((resolve) => {
    const id = String(nextConfirmId++);
    const timer = setTimeout(() => {
      if (pendingConfirms.has(id)) {
        pendingConfirms.delete(id);
        resolve(false);
        emitHud({ type: "confirm_expired", id });
      }
    }, 30000);

    pendingConfirms.set(id, { resolve, timer });
    showHubWindow({ focus: true, reason: "confirm" });
    emitHud({
      type: "confirm_request",
      id,
      toolName,
      summary: formatConfirmSummary(toolName, args),
    });
  });
}

function startHotkeyHelper() {
  const helperCandidates = [
    path.join(__dirname, "..", "runtime", "JarvisWakeHelper.exe"),
    path.join(WORKSPACE_ROOT, "JarvisWakeHelper.exe"),
  ];
  const nativeHelperExe = helperCandidates.find((p) => fs.existsSync(p)) || helperCandidates[0];
  const wakeArgs = [
    "-InitialHotkey",
    hubState.hotkey,
    "-EnableWakeWord",
    hubState.wakeWordEnabled !== false ? "1" : "0",
    "-WakeName",
    sanitizeWakeName(hubState.wakeName || "Luna"),
    "-WakeSensitivity",
    sanitizeWakeSensitivity(hubState.wakeSensitivity),
  ];
  const useNativeExe = !preferPsWakeFallback && fs.existsSync(nativeHelperExe);
  const spawnedAt = Date.now();
  let gotValidEvent = false;
  if (useNativeExe) {
    hotkeyProc = spawn(nativeHelperExe, wakeArgs, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  } else {
    const helperScript = path.join(__dirname, "hotkey-helper.ps1");
    if (!fs.existsSync(helperScript)) return;
    hotkeyProc = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", helperScript, ...wakeArgs],
      { stdio: ["pipe", "pipe", "pipe"], windowsHide: true }
    );
  }

  const procRef = hotkeyProc;
  procRef.on("error", (err) => {
    appendWakeLog(`HELPER_SPAWN_ERROR native=${useNativeExe} msg=${err?.message || err}`);
    if (hotkeyProc === procRef) hotkeyProc = null;
    if (useNativeExe) {
      preferPsWakeFallback = true;
      if (!isQuittingHub) {
        clearTimeout(wakeRestartTimer);
        wakeRestartTimer = setTimeout(() => {
          if (!isQuittingHub && !hotkeyProc) startHotkeyHelper();
        }, 300);
      }
    }
  });

  const rl = readline.createInterface({ input: procRef.stdout });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      return;
    }
    gotValidEvent = true;
    wakeRestartCount = 0;

    if (msg.event === "registered") {
      emitHud({ type: "hotkey_registered", spec: msg.spec, ok: msg.ok });
    } else if (msg.event === "sleep") {
      for (const [cid, entry] of pendingConfirms.entries()) {
        clearTimeout(entry.timer);
        entry.resolve(false);
        pendingConfirms.delete(cid);
      }
      agent?.abortQuietlyForWakeReset();
      if (hotkeyProc?.stdin?.writable) {
        hotkeyProc.stdin.write('{"cmd":"pause_wake","paused":false}\n');
      }
      hideHubWindow();
      emitHud({ type: "hub_sleep", phrase: msg.text });
    } else if (msg.event === "wake") {
      appendWakeLog(`WAKE text="${msg.text}" conf=${msg.confidence} visible=${Boolean(mainWindow?.isVisible())}`);
      if (typeof msg.confidence === "number" && msg.confidence < 0.35) {
        return;
      }
      // Prevent immediate re-wake from canceling user's command when speaking right after wake ("OK Luna mở âm Discord")
      const hasInFlightTask =
        pendingConfirms.size > 0 || activeBackendControllers.size > 0 || Boolean(activityState.busy);
      if (
        !hasInFlightTask &&
        Date.now() - lastWakeAcceptedAt < 2600 &&
        activityState.islandState === "listening"
      ) {
        appendWakeLog(`WAKE_IGNORED_ACTIVE deltaMs=${Date.now() - lastWakeAcceptedAt}`);
        return;
      }
      lastWakeAcceptedAt = Date.now();
      // Pause wake listener while user captures this voice command; App.jsx resumes it as soon as capture ends
      if (hotkeyProc?.stdin?.writable) {
        hotkeyProc.stdin.write('{"cmd":"pause_wake","paused":true}\n');
      }
      // Cancel any in-flight turn/backend request/confirm so saying wake word resets immediately
      for (const [cid, entry] of pendingConfirms.entries()) {
        clearTimeout(entry.timer);
        entry.resolve(false);
        pendingConfirms.delete(cid);
      }
      if (hasInFlightTask) {
        abortInFlightBackendCalls();
        callLocalBackend("/panic", {}, 1500, false).catch(() => {});
      }
      agent?.abortQuietlyForWakeReset();
      showHubWindow({ focus: false, reason: "wake" });
      emitHud({ type: "hotkey_wake", phrase: msg.text, confidence: msg.confidence });
    } else if (msg.event === "wake_debug") {
      appendWakeLog(`DEBUG status=${msg.status} grammar=${msg.grammar} text="${msg.text}" conf=${msg.confidence}`);
    } else if (msg.event === "wake_ready" && !msg.ok) {
      emitHud({ type: "wake_status", ok: false, error: msg.error });
    } else if (msg.event === "down") {
      if (hotkeyProc?.stdin?.writable) {
        hotkeyProc.stdin.write('{"cmd":"pause_wake","paused":true}\n');
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (!mainWindow.isVisible()) {
          showHubWindow({ focus: false, reason: "hotkey_down" });
        } else {
          positionWindowTopCenter();
          markHubActivity("hotkey_down");
        }
      }
      emitHud({ type: "hotkey_down" });
    } else if (msg.event === "tap") {
      if (hotkeyProc?.stdin?.writable) {
        hotkeyProc.stdin.write('{"cmd":"pause_wake","paused":false}\n');
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isVisible() && mainWindow.isFocused()) {
          hideHubWindow();
          emitHud({ type: "hotkey_cancelled" });
        } else {
          showHubWindow({ focus: true, reason: "hotkey_tap" });
          emitHud({ type: "hotkey_tap" });
        }
      }
    } else if (msg.event === "hold_confirmed") {
      markHubActivity("hotkey_hold");
      emitHud({ type: "hotkey_hold_start" });
    } else if (msg.event === "hold_end") {
      markHubActivity("hotkey_hold_end");
      emitHud({ type: "hotkey_hold_end" });
    }
  });

  procRef.on("exit", (code) => {
    if (hotkeyProc === procRef) hotkeyProc = null;
    if (isQuittingHub) return;
    const ranMs = Date.now() - spawnedAt;
    if (useNativeExe && !gotValidEvent && ranMs < 3500) {
      // Native JarvisWakeHelper.exe failed to initialize (e.g. SmartScreen/Antivirus/missing .NET) -> fall back to PowerShell
      preferPsWakeFallback = true;
      appendWakeLog(`NATIVE_HELPER_FAILED code=${code} ranMs=${ranMs} -> switching to PowerShell fallback`);
      clearTimeout(wakeRestartTimer);
      wakeRestartTimer = setTimeout(() => {
        if (!isQuittingHub && !hotkeyProc) startHotkeyHelper();
      }, 350);
      return;
    }
    wakeRestartCount += 1;
    if (wakeRestartCount > 5) {
      appendWakeLog(`HELPER_STOPPED_AFTER_RETRIES count=${wakeRestartCount}`);
      return;
    }
    const backoffMs = Math.min(8000, 900 * wakeRestartCount);
    appendWakeLog(`HELPER_EXIT code=${code} -> restarting in ${backoffMs}ms`);
    clearTimeout(wakeRestartTimer);
    wakeRestartTimer = setTimeout(() => {
      if (!isQuittingHub && !hotkeyProc) startHotkeyHelper();
    }, backoffMs);
  });
}

function switchDisplayMode(mode) {
  hubState.displayMode = String(mode || "cursor");
  saveHubState(hubState);
  positionWindowTopCenter();
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
    markHubActivity("display_switch");
  }
  updateTrayMenu();
  emitHud({ type: "state_sync", ...getPublicState() });
}

function updateTrayMenu() {
  if (!tray) return;
  const currentDisplayMode = hubState.displayMode || "cursor";
  const displays = getAvailableDisplaysInfo();
  const displaySubmenu = [
    {
      label: "Tự động theo con trỏ chuột (Khuyên dùng)",
      type: "radio",
      checked: currentDisplayMode === "cursor",
      click: () => switchDisplayMode("cursor"),
    },
    {
      label: "Màn hình chính (Windows Primary)",
      type: "radio",
      checked: currentDisplayMode === "primary",
      click: () => switchDisplayMode("primary"),
    },
    { type: "separator" },
    ...displays.map((d) => ({
      label: d.label,
      type: "radio",
      checked: currentDisplayMode === `display:${d.id}`,
      click: () => switchDisplayMode(`display:${d.id}`),
    })),
    { type: "separator" },
    {
      label: "Căn giữa lại ngay",
      click: () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        if (!mainWindow.isVisible()) showHubWindow({ focus: false, reason: "tray_recenter" });
        else {
          positionWindowTopCenter();
          markHubActivity("tray_recenter");
        }
      },
    },
  ];

  const menu = Menu.buildFromTemplate([
    {
      label: "Hiện / Ẩn Jarvis Hub",
      click: () => {
        if (!mainWindow) return;
        if (mainWindow.isVisible()) hideHubWindow();
        else showHubWindow({ focus: true, reason: "tray_menu" });
      },
    },
    {
      label: "Màn hình hiển thị / Display",
      submenu: displaySubmenu,
    },
    {
      label: `🌐 Ngôn ngữ / Language (${hubState.uiLanguage === "en" ? "EN" : "VI"})`,
      submenu: [
        {
          label: "Tiếng Việt (VI)",
          type: "radio",
          checked: hubState.uiLanguage !== "en",
          click: () => {
            hubState.uiLanguage = "vi";
            saveHubState(hubState);
            updateTrayMenu();
            emitHud({ type: "state_sync", ...getPublicState() });
          },
        },
        {
          label: "English (EN)",
          type: "radio",
          checked: hubState.uiLanguage === "en",
          click: () => {
            hubState.uiLanguage = "en";
            saveHubState(hubState);
            updateTrayMenu();
            emitHud({ type: "state_sync", ...getPublicState() });
          },
        },
      ],
    },
    {
      label: "⚙️ Thiết lập ban đầu (Setup Wizard)",
      click: () => openSetupWizardWindow(),
    },
    { type: "separator" },
    {
      label: currentSafetyMode === "safe" ? "🛡️ Chế độ: Safe (Đang bật hỏi Allow)" : "⚡ Chế độ: Turbo (Tự động)",
      click: async () => {
        const next = currentSafetyMode === "safe" ? "turbo" : "safe";
        currentSafetyMode = await setSafetyMode(next);
        mcpHub?.setSafetyMode(currentSafetyMode);
        callLocalBackend("/set-safety", { safety_mode: currentSafetyMode }, 2500, false).catch(() => {});
        updateTrayMenu();
        emitHud({ type: "state_sync", ...getPublicState() });
      },
    },
    {
      label:
        hubState.wakeWordEnabled !== false
          ? `🎙️ Gọi 'OK ${sanitizeWakeName(hubState.wakeName || "Luna")}': BẬT`
          : `🎙️ Gọi 'OK ${sanitizeWakeName(hubState.wakeName || "Luna")}': TẮT`,
      click: () => {
        hubState.wakeWordEnabled = !(hubState.wakeWordEnabled !== false);
        saveHubState(hubState);
        if (hotkeyProc?.stdin?.writable) {
          hotkeyProc.stdin.write(`${JSON.stringify({ cmd: "set_wake_word", enabled: hubState.wakeWordEnabled })}\n`);
        }
        updateTrayMenu();
        emitHud({ type: "state_sync", ...getPublicState() });
      },
    },
    {
      label: hubState.voiceReplyAlways ? "🔊 Luôn đọc phản hồi: BẬT" : "🔇 Phản hồi: Text + Bíp (Chỉ đọc khi yêu cầu)",
      click: () => {
        hubState.voiceReplyAlways = !hubState.voiceReplyAlways;
        saveHubState(hubState);
        agent?.setVoiceReplyAlways(hubState.voiceReplyAlways);
        updateTrayMenu();
        emitHud({ type: "state_sync", ...getPublicState() });
      },
    },
    {
      label: "Đổi phím tắt",
      submenu: ["ctrl+alt+space", "f9", "alt+space"].map((spec) => ({
        label: spec.toUpperCase(),
        type: "radio",
        checked: hubState.hotkey === spec,
        click: () => switchHotkey(spec),
      })),
    },
    {
      label: "Mở thư mục Exports",
      click: () => {
        try {
          fs.mkdirSync(EXPORTS_DIR, { recursive: true });
        } catch {}
        execFile("explorer.exe", [EXPORTS_DIR], { windowsHide: true });
      },
    },
    { type: "separator" },
    {
      label: "Thoát Jarvis Hub",
      click: () => forceQuitApp(),
    },
  ]);
  tray.setContextMenu(menu);
}

function switchHotkey(spec) {
  hubState.hotkey = spec;
  saveHubState(hubState);
  if (hotkeyProc?.stdin?.writable) {
    hotkeyProc.stdin.write(`${JSON.stringify({ cmd: "set_hotkey", spec })}\n`);
  }
  updateTrayMenu();
  emitHud({ type: "state_sync", ...getPublicState() });
}

function createWindow() {
  const icoPath = path.join(__dirname, "..", "jarvis.ico");
  const initBounds = computeCenteredBoundsForDisplay(resolveTargetDisplay());
  mainWindow = new BrowserWindow({
    title: "Black Sakura Jarvis-Hub",
    icon: fs.existsSync(icoPath) ? icoPath : undefined,
    x: initBounds.x,
    y: initBounds.y,
    width: initBounds.width,
    height: initBounds.height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (evt, navUrl) => {
    if (!String(navUrl || "").startsWith("file://")) {
      evt.preventDefault();
    }
  });

  mainWindow.setAlwaysOnTop(true, "screen-saver");
  mainWindow.setIgnoreMouseEvents(true, { forward: true });
  mainWindow.on("close", (e) => {
    if (!isQuittingHub) {
      e.preventDefault();
      hideHubWindow();
    }
  });
  const distHtml = path.join(__dirname, "renderer", "dist", "index.html");
  mainWindow.loadFile(fs.existsSync(distHtml) ? distHtml : path.join(__dirname, "renderer", "index.html"));
  positionWindowTopCenter();
}

function emitSetupProgress(payload) {
  if (setupWindow && !setupWindow.isDestroyed()) {
    try {
      setupWindow.webContents.send("setup:progress", payload);
    } catch {}
  }
}

function cancelActiveSetupProc() {
  const proc = activeSetupProc;
  activeSetupProc = null;
  if (!proc) return;
  try {
    if (proc.pid) {
      execFile("taskkill", ["/F", "/T", "/PID", String(proc.pid)], { windowsHide: true }, () => {});
    }
    proc.kill();
  } catch {}
}

function ensureMainHudStarted({ showNow = false, focus = false, reason = "boot" } = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    if (showNow) {
      mainWindow.once("ready-to-show", () => {
        showHubWindow({ focus, reason });
        emitHud({ type: "ready", ...getPublicState() });
      });
    }
  } else if (showNow) {
    showHubWindow({ focus, reason });
    emitHud({ type: "ready", ...getPublicState() });
  }
  if (!hotkeyProc) {
    startHotkeyHelper();
  }
}

function forceQuitApp() {
  if (isQuittingHub) return;
  isQuittingHub = true;
  clearTimeout(wakeRestartTimer);
  clearInactivityTimers();
  stopHoverSafetyPoll();
  clearTimeout(displayDebounceTimer);
  clearTimeout(crossDpiVerifyTimer);
  abortInFlightBackendCalls();
  cancelActiveSetupProc();
  try {
    screen.removeListener("display-added", scheduleDisplayChangeSync);
    screen.removeListener("display-removed", scheduleDisplayChangeSync);
    screen.removeListener("display-metrics-changed", scheduleDisplayChangeSync);
  } catch {}
  try {
    if (setupWindow && !setupWindow.isDestroyed()) setupWindow.destroy();
    setupWindow = null;
  } catch {}
  try {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
    mainWindow = null;
  } catch {}
  try {
    if (hotkeyProc?.stdin?.writable) {
      hotkeyProc.stdin.write('{"cmd":"quit"}\n');
    }
  } catch {}
  if (hotkeyProc?.pid) {
    execFile("taskkill", ["/F", "/T", "/PID", String(hotkeyProc.pid)], { windowsHide: true }, () => {});
  }
  if (localBackendProc?.pid) {
    execFile("taskkill", ["/F", "/T", "/PID", String(localBackendProc.pid)], { windowsHide: true }, () => {});
  }
  try {
    hotkeyProc?.kill();
  } catch {}
  try {
    agent?.closeLive();
  } catch {}
  try {
    mcpHub?.closeAll();
  } catch {}
  try {
    tray?.destroy();
    tray = null;
  } catch {}
  app.quit();
  // Failsafe so Electron NEVER hangs waiting on a stray handle/socket
  setTimeout(() => {
    try {
      app.exit(0);
    } catch {}
  }, 450).unref?.();
}

function openSetupWizardWindow() {
  if (setupWindow && !setupWindow.isDestroyed()) {
    setupWindow.show();
    setupWindow.focus();
    return;
  }
  const primary = screen.getPrimaryDisplay();
  const wa = primary.workArea;
  const w = Math.min(760, Math.max(540, wa.width - 48));
  const h = Math.min(720, Math.max(520, wa.height - 48));
  const icoPath = path.join(__dirname, "..", "jarvis.ico");

  setupWindow = new BrowserWindow({
    title: "Black Sakura Jarvis-Hub — Thiết lập lần đầu",
    icon: fs.existsSync(icoPath) ? icoPath : undefined,
    width: w,
    height: h,
    x: Math.round(wa.x + (wa.width - w) / 2),
    y: Math.round(wa.y + (wa.height - h) / 2),
    minWidth: 520,
    minHeight: 480,
    frame: true,
    autoHideMenuBar: true,
    transparent: false,
    resizable: true,
    backgroundColor: "#f8fafc",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  setupWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  setupWindow.webContents.on("will-navigate", (evt, navUrl) => {
    if (!String(navUrl || "").startsWith("file://")) {
      evt.preventDefault();
    }
  });

  const distHtml = path.join(__dirname, "renderer", "dist", "index.html");
  const targetHtml = fs.existsSync(distHtml) ? distHtml : path.join(__dirname, "renderer", "index.html");
  setupWindow.loadFile(targetHtml, { query: { mode: "setup" } });
  setupWindow.once("ready-to-show", () => {
    if (setupWindow && !setupWindow.isDestroyed()) {
      setupWindow.show();
      setupWindow.focus();
    }
  });
  setupWindow.on("closed", () => {
    cancelActiveSetupProc();
    setupWindow = null;
    // First run closed WITHOUT accepting & completing -> quit cleanly (never open Mini HUD or leave zombie process)
    if (!isQuittingHub && !hubState.onboardingCompleted) {
      forceQuitApp();
      return;
    }
    if (!isQuittingHub && hubState.onboardingCompleted && mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      showHubWindow({ focus: false, reason: "setup_closed" });
    }
  });
}

function registerIpc() {
  ipcMain.handle("hub:get-state", () => getPublicState());
  ipcMain.handle("hub:get-backend-token", () => readBackendSessionToken());
  ipcMain.handle("hub:backend-request", async (_evt, { endpoint, body = null } = {}) => {
    const ep = String(endpoint || "").trim();
    if (!ep.startsWith("/")) return { ok: false, error: "Invalid endpoint" };
    const res = await callLocalBackend(ep, body, 15000, ep === "/status");
    return res || { ok: false, error: `Backend (:${activeBackendPort}) chưa phản hồi` };
  });

  ipcMain.handle("hub:get-setup-diagnostics", async () => {
    const pyExe = resolvePythonExecutable({ preferConsole: true });
    const ollLaunch = resolveOllamaLaunch();
    const wakeExe = [
      path.join(__dirname, "..", "runtime", "JarvisWakeHelper.exe"),
      path.join(WORKSPACE_ROOT, "JarvisWakeHelper.exe"),
    ].find((p) => fs.existsSync(p));
    // Kick off backend boot in background without blocking Setup Wizard UI for 12s
    void ensureLocalBackendRunning(agent?.installedApps || []).catch(() => {});
    const [backendStatus, ollamaDirect] = await Promise.all([
      callLocalBackend("/status", null, 1800, false).catch(() => null),
      probeOllamaDirect(1200).catch(() => ({ online: false, models: [] })),
    ]);
    return {
      ok: true,
      displays: getAvailableDisplaysInfo(),
      displayMode: hubState.displayMode || "cursor",
      safetyMode: currentSafetyMode,
      activeBackendPort,
      workspaceRoot: WORKSPACE_ROOT,
      pythonExe: pyExe,
      pythonFound: Boolean(pyExe),
      wakeHelperBlocked: isZoneBlocked(wakeExe),
      ollamaInstalled: Boolean(ollLaunch || ollamaDirect.online || backendStatus?.ollama_installed),
      ollamaOnline: Boolean(ollamaDirect.online || backendStatus?.ollama_online),
      ollamaModels:
        Array.isArray(backendStatus?.ollama_installed_models) && backendStatus.ollama_installed_models.length > 0
          ? backendStatus.ollama_installed_models
          : ollamaDirect.models,
      backendStatus: backendStatus && backendStatus.ok ? backendStatus : null,
      onboardingCompleted: hubState.onboardingCompleted === true,
      uiLanguage: hubState.uiLanguage === "en" ? "en" : "vi",
    };
  });

  ipcMain.handle("hub:cancel-setup-task", () => {
    cancelActiveSetupProc();
    emitSetupProgress({ task: "cancelled", message: "Đã dừng tác vụ tải/cài đặt." });
    return { ok: true };
  });

  ipcMain.handle("hub:install-ollama", async () => {
    if (activeSetupProc) {
      return { ok: false, error: "Đang có một tiến trình tải/cài đặt khác chạy. Hãy chờ xong hoặc bấm Dừng." };
    }
    const existing = resolveOllamaLaunch();
    if (existing) {
      emitSetupProgress({ task: "install-ollama", message: "Ollama đã có sẵn trên máy — đang khởi động nền..." });
      startOllamaServeHeadless();
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const p = await probeOllamaDirect(1000);
        if (p.online) {
          emitSetupProgress({ task: "install-ollama", done: true, message: "Ollama đã sẵn sàng!" });
          return { ok: true, alreadyInstalled: true, online: true };
        }
      }
      return { ok: true, alreadyInstalled: true, online: false };
    }

    const cleanAnsi = (s) =>
      String(s || "")
        .replace(/\x1B\[[0-9;?]*[ -/]*[@-~]/g, "")
        .replace(/\r/g, "\n")
        .trim();

    // Strategy 1: Silent winget install; Strategy 2: Official OllamaSetup.exe download & run
    emitSetupProgress({ task: "install-ollama", message: "Đang tải & cài đặt Ollama chính chủ (winget / OllamaSetup.exe)..." });
    const runInstallPs = () =>
      new Promise((resolve) => {
        const script = [
          "$ProgressPreference = 'SilentlyContinue'",
          "if (Get-Command winget -ErrorAction SilentlyContinue) {",
          "  Write-Output 'Dang cai Ollama qua Windows Package Manager (winget)...'",
          "  winget install -e --id Ollama.Ollama --silent --accept-package-agreements --accept-source-agreements",
          "  if ($LASTEXITCODE -eq 0) { Write-Output 'WINGET_OK'; exit 0 }",
          "}",
          "$tmp = Join-Path $env:TEMP 'OllamaSetup.exe'",
          "Write-Output 'Dang tai trinh cai dat chinh chu tu ollama.com/download/OllamaSetup.exe...'",
          "Invoke-WebRequest -Uri 'https://ollama.com/download/OllamaSetup.exe' -OutFile $tmp -UseBasicParsing",
          "Write-Output 'Da tai xong OllamaSetup.exe! Dang chay trinh cai dat (vui long cho 30-60 giay)...'",
          "$p = Start-Process -FilePath $tmp -ArgumentList '/VERYSILENT','/NORESTART' -PassThru -Wait",
          "if ($p.ExitCode -ne 0) {",
          "  Write-Output 'Dang mo giao dien cai dat Ollama de ban bam Install...'",
          "  Start-Process -FilePath $tmp -Wait",
          "}",
          "Write-Output 'INSTALL_DONE'",
        ].join("\n");

        const proc = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
        activeSetupProc = proc;
        const onChunk = (buf) => {
          const lines = cleanAnsi(buf.toString("utf8")).split("\n").map((l) => l.trim()).filter(Boolean);
          for (const line of lines.slice(-3)) {
            emitSetupProgress({ task: "install-ollama", message: line.slice(0, 180) });
          }
        };
        proc.stdout?.on("data", onChunk);
        proc.stderr?.on("data", onChunk);
        proc.on("error", (err) => {
          if (activeSetupProc === proc) activeSetupProc = null;
          resolve({ ok: false, error: err.message });
        });
        proc.on("close", (code) => {
          if (activeSetupProc === proc) activeSetupProc = null;
          resolve({ ok: code === 0, code });
        });
      });

    const installRes = await runInstallPs();
    if (!installRes.ok && !resolveOllamaLaunch()) {
      return {
        ok: false,
        error: "Không tự cài được Ollama (có thể thiếu quyền mạng/UAC). Bạn có thể bấm nút mở trang ollama.com/download để cài thủ công.",
      };
    }
    emitSetupProgress({ task: "install-ollama", message: "Cài đặt xong — đang khởi động dịch vụ Ollama nền..." });
    startOllamaServeHeadless();
    for (let i = 0; i < 16; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const p = await probeOllamaDirect(1000);
      if (p.online) {
        emitSetupProgress({ task: "install-ollama", done: true, message: "Ollama đã cài và khởi động thành công!" });
        return { ok: true, online: true };
      }
    }
    return { ok: true, online: false, message: "Đã cài Ollama — hãy bấm Quét lại sau vài giây." };
  });

  ipcMain.handle("hub:pull-ollama-model", async (_evt, rawModel) => {
    if (activeSetupProc) {
      return { ok: false, error: "Đang có tác vụ tải khác chạy. Hãy chờ xong hoặc bấm Dừng." };
    }
    const modelName = String(rawModel || "").trim();
    if (!/^[a-zA-Z0-9._:/-]{2,80}$/.test(modelName)) {
      return { ok: false, error: "Tên model không hợp lệ (ví dụ: qwen3.5:4b, qwen3:1.7b, llama3.2:3b)." };
    }
    const oll = resolveOllamaLaunch();
    const ollExe = oll ? oll.exe : "ollama";
    const direct = await probeOllamaDirect(1000);
    if (!direct.online) {
      startOllamaServeHeadless();
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 500));
        if ((await probeOllamaDirect(900)).online) break;
      }
    }

    const cleanAnsi = (s) =>
      String(s || "")
        .replace(/\x1B\[[0-9;?]*[ -/]*[@-~]/g, "")
        .replace(/\r/g, "\n");

    emitSetupProgress({ task: "pull-model", model: modelName, message: `Đang tải model ${modelName} từ Ollama...` });
    return await new Promise((resolve) => {
      let lastLine = "";
      const proc = spawn(ollExe, ["pull", modelName], {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      activeSetupProc = proc;
      const handleData = (buf) => {
        const lines = cleanAnsi(buf.toString("utf8"))
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);
        if (lines.length > 0) {
          lastLine = lines[lines.length - 1].slice(0, 180);
          emitSetupProgress({ task: "pull-model", model: modelName, message: lastLine });
        }
      };
      proc.stdout?.on("data", handleData);
      proc.stderr?.on("data", handleData);
      proc.on("error", () => {
        if (activeSetupProc === proc) activeSetupProc = null;
        resolve({ ok: false, error: "Không tìm thấy ollama.exe — hãy cài Ollama trước." });
      });
      proc.on("close", (code) => {
        if (activeSetupProc === proc) activeSetupProc = null;
        if (code === 0) {
          emitSetupProgress({ task: "pull-model", model: modelName, done: true, message: `Đã tải xong model ${modelName}!` });
          resolve({ ok: true, model: modelName });
        } else {
          resolve({ ok: false, error: lastLine || `Tải model ${modelName} thất bại (mã ${code}).` });
        }
      });
    });
  });

  ipcMain.handle("hub:install-python-deps", async () => {
    if (activeSetupProc) {
      return { ok: false, error: "Đang có tác vụ cài đặt khác chạy." };
    }
    const reqFile = path.join(WORKSPACE_ROOT, "requirements.txt");
    if (!fs.existsSync(reqFile)) {
      return { ok: false, error: "Không tìm thấy file requirements.txt." };
    }
    let pyExe = resolvePythonExecutable({ preferConsole: true });
    if (!pyExe) {
      return { ok: false, error: "Chưa tìm thấy Python 3.10+ trên máy. Hãy cài Python trước (tích Add python.exe to PATH)." };
    }
    emitSetupProgress({ task: "pip-install", message: `Đang chạy "${pyExe}" -m pip install -r requirements.txt...` });
    const res = await new Promise((resolve) => {
      let lastLine = "";
      const proc = spawn(pyExe, ["-m", "pip", "install", "-r", reqFile], {
        cwd: WORKSPACE_ROOT,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      activeSetupProc = proc;
      const onChunk = (buf) => {
        const lines = String(buf.toString("utf8"))
          .replace(/\r/g, "\n")
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);
        if (lines.length > 0) {
          lastLine = lines[lines.length - 1].slice(0, 180);
          emitSetupProgress({ task: "pip-install", message: lastLine });
        }
      };
      proc.stdout?.on("data", onChunk);
      proc.stderr?.on("data", onChunk);
      proc.on("error", () => {
        if (activeSetupProc === proc) activeSetupProc = null;
        resolve({ ok: false, error: "Không tìm thấy Python 3.10+ trên máy. Hãy cài Python trước." });
      });
      proc.on("close", (code) => {
        if (activeSetupProc === proc) activeSetupProc = null;
        resolve(code === 0 ? { ok: true } : { ok: false, error: lastLine || `pip install lỗi (mã ${code})` });
      });
    });
    if (res.ok) {
      emitSetupProgress({ task: "pip-install", message: "Cài thư viện Python xong — đang khởi động Backend..." });
      await ensureLocalBackendRunning(agent?.installedApps || []).catch(() => {});
      emitSetupProgress({ task: "pip-install", done: true, message: "Backend đã sẵn sàng!" });
    }
    return res;
  });

  ipcMain.handle("hub:open-external", async (_evt, rawUrl) => {
    const u = String(rawUrl || "").trim();
    const allowedPrefixes = [
      "https://ollama.com",
      "https://aistudio.google.com",
      "https://github.com/hohieu112007-byte/black-sakura-jarvis-hub",
      "https://www.python.org",
    ];
    if (!allowedPrefixes.some((p) => u.startsWith(p))) {
      return { ok: false, error: "URL không nằm trong danh sách cho phép." };
    }
    await shell.openExternal(u);
    return { ok: true };
  });

  ipcMain.handle("hub:complete-onboarding", async (_evt, payload = {}) => {
    const nextDisplay = String(payload.displayMode || hubState.displayMode || "cursor");
    const validDisplay =
      nextDisplay === "cursor" || nextDisplay === "primary" || /^display:\d+$/.test(nextDisplay)
        ? nextDisplay
        : "cursor";
    hubState.displayMode = validDisplay;
    hubState.onboardingCompleted = true;
    if (payload.uiLanguage === "en" || payload.uiLanguage === "vi") {
      hubState.uiLanguage = payload.uiLanguage;
    }

    const chosenSafety = payload.safetyMode === "turbo" ? "turbo" : "safe";
    try {
      currentSafetyMode = await setSafetyMode(chosenSafety);
      mcpHub?.setSafetyMode(currentSafetyMode);
    } catch {
      currentSafetyMode = chosenSafety;
    }

    if (payload.selectedModel && typeof payload.selectedModel === "string") {
      hubState.localModelPreset = payload.selectedModel.trim();
      await callLocalBackend("/set-model", { model: hubState.localModelPreset }, 4000, false).catch(() => {});
    }

    const cleanKey = String(payload.apiKey || "").trim();
    if (cleanKey) {
      await callLocalBackend("/set-api-fallback", { enabled: true, api_key: cleanKey }, 4000, false).catch(() => {});
    } else if (typeof payload.enableApiFallback === "boolean") {
      await callLocalBackend("/set-api-fallback", { enabled: payload.enableApiFallback }, 4000, false).catch(() => {});
    }

    await callLocalBackend("/set-safety", { safety_mode: currentSafetyMode }, 2500, false).catch(() => {});
    saveHubState(hubState);
    updateTrayMenu();

    // Close setup wizard first, then create/show the Mini HUD and start global wake/hotkey helper
    if (setupWindow && !setupWindow.isDestroyed()) {
      setupWindow.close();
    }
    ensureMainHudStarted({ showNow: true, focus: true, reason: "onboarding_done" });
    positionWindowTopCenter();
    emitHud({ type: "state_sync", ...getPublicState() });
    return { ok: true };
  });

  ipcMain.handle("hub:reopen-setup", () => {
    openSetupWizardWindow();
    return { ok: true };
  });

  ipcMain.handle("hub:send-prompt", async (_evt, rawPayload) => {
    const isObj = rawPayload && typeof rawPayload === "object";
    const clean = String(isObj ? rawPayload.text : rawPayload || "").trim();
    const ctx = isObj && rawPayload.context && typeof rawPayload.context === "object" ? rawPayload.context : null;
    if (!clean) return { ok: false };
    recordRecentCommand(clean);
    try {
      let localBackendRes = await callLocalBackend(
        "/execute",
        { text: clean, context: ctx, safety_mode: currentSafetyMode },
        95000
      );
      if (localBackendRes?.needs_confirmation) {
        const allowed = await requestConfirmation({
          toolName: localBackendRes.tool || "mcp_action",
          args: localBackendRes.args || {},
        });
        if (!allowed) {
          return { ok: true, cancelled: true, text: "Đã hủy thao tác theo yêu cầu (Safe Mode)." };
        }
        localBackendRes = await callLocalBackend(
          "/execute",
          { text: clean, context: ctx, safety_mode: currentSafetyMode, approved: true },
          95000
        );
      }
      if (localBackendRes?.__cancelled || localBackendRes?.cancelled) {
        return { ok: true, cancelled: true };
      }
      if (localBackendRes && (localBackendRes.__timeout || localBackendRes.__httpError)) {
        return { ok: false, error: localBackendRes.error };
      }
      if (localBackendRes && typeof localBackendRes.ok === "boolean") {
        if (localBackendRes.hub_sleep || localBackendRes.hubSleep) {
          if (hotkeyProc?.stdin?.writable) {
            hotkeyProc.stdin.write('{"cmd":"pause_wake","paused":false}\n');
          }
          hideHubWindow();
          emitHud({ type: "hub_sleep", phrase: clean });
          return {
            ok: true,
            hubSleep: true,
            text: localBackendRes.reply || "Đã ẩn Jarvis xuống khay.",
          };
        }
        const modelLabel =
          localBackendRes.route === "gemini_api_fallback"
            ? `☁️ API ${localBackendRes.model_used || "gemini-2.5-flash"}`
            : localBackendRes.model_used
              ? `🧠 Local ${localBackendRes.model_used}`
              : localBackendRes.route === "antigravity_flash"
                ? "🌉 Antigravity Bridge"
                : "⚡ Fast-Path (0 MB VRAM)";
        const replyText = localBackendRes.reply || "Đã xử lý xong.";
        const ttsExtra = localBackendRes.ok ? await maybeAttachLocalTts(replyText) : {};
        emitHud({ type: "state_sync", ...getPublicState() });
        return {
          ok: localBackendRes.ok,
          text: replyText,
          modelLabel,
          ...localBackendRes,
          ...ttsExtra,
        };
      }

      const fallbackRes = await tryLocalFallbackCommand(clean, (srv, name, args) =>
        mcpHub.executeTool(srv, name, args)
      );
      if (fallbackRes?.handled) {
        emitHud({ type: "state_sync", ...getPublicState() });
        return {
          ok: true,
          text: fallbackRes.text.replace(/^\[Chế độ Dự phòng Offline\]\s*/i, ""),
          modelLabel: "⚡ Local Fast-Path (0 MB VRAM)",
        };
      }
      return {
        ok: false,
        error: "Backend Local chưa chạy. Hãy chạy start_backend.bat để dùng Qwen 2.5 + Whisper.",
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("hub:send-voice-wav", async (_evt, { wavBase64, hintTranscript, context } = {}) => {
    try {
      const cleanHint = String(hintTranscript || "").trim();
      const ctx = context && typeof context === "object" ? context : null;
      let localBackendRes = cleanHint
        ? await callLocalBackend("/execute", { text: cleanHint, context: ctx, safety_mode: currentSafetyMode }, 95000)
        : await callLocalBackend("/voice", { wav_base64: wavBase64, context: ctx }, 95000);

      if (localBackendRes?.needs_confirmation) {
        const allowed = await requestConfirmation({
          toolName: localBackendRes.tool || "mcp_action",
          args: localBackendRes.args || {},
        });
        if (!allowed) {
          return { ok: true, cancelled: true, text: "Đã hủy thao tác theo yêu cầu (Safe Mode)." };
        }
        const retryText = localBackendRes.user_text || cleanHint;
        if (retryText) {
          localBackendRes = await callLocalBackend(
            "/execute",
            { text: retryText, context: ctx, safety_mode: currentSafetyMode, approved: true },
            95000
          );
        }
      }

      if (localBackendRes?.__cancelled || localBackendRes?.cancelled) {
        return { ok: true, cancelled: true };
      }
      if (localBackendRes && (localBackendRes.__timeout || localBackendRes.__httpError)) {
        return { ok: false, error: localBackendRes.error };
      }
      if (localBackendRes && typeof localBackendRes.ok === "boolean") {
        if (localBackendRes.empty_voice) {
          return { ok: true, emptyVoice: true, text: "" };
        }
        if (localBackendRes.hub_sleep || localBackendRes.hubSleep) {
          if (hotkeyProc?.stdin?.writable) {
            hotkeyProc.stdin.write('{"cmd":"pause_wake","paused":false}\n');
          }
          hideHubWindow();
          emitHud({ type: "hub_sleep", phrase: localBackendRes.user_text || cleanHint });
          return {
            ok: true,
            hubSleep: true,
            userText: localBackendRes.user_text,
            text: localBackendRes.reply || "Đã ẩn Jarvis xuống khay.",
          };
        }
        if (localBackendRes.user_text) {
          recordRecentCommand(localBackendRes.user_text);
        }
        const modelLabel =
          localBackendRes.route === "gemini_api_fallback"
            ? `🎙️ Whisper + ☁️ ${localBackendRes.model_used || "Gemini API"}`
            : localBackendRes.model_used
              ? `🎙️ Whisper + ${localBackendRes.model_used}`
              : localBackendRes.route === "antigravity_flash"
                ? "🎙️ Whisper + Antigravity"
                : "🎙️ Whisper + Fast-Path";
        const replyText = localBackendRes.reply || "Đã xử lý xong.";
        const ttsExtra = localBackendRes.ok ? await maybeAttachLocalTts(replyText) : {};
        emitHud({ type: "state_sync", ...getPublicState() });
        return {
          ok: localBackendRes.ok,
          text: replyText,
          userText: localBackendRes.user_text,
          modelLabel,
          ...localBackendRes,
          ...ttsExtra,
        };
      }

      if (cleanHint) {
        const fallbackRes = await tryLocalFallbackCommand(cleanHint, (srv, name, args) =>
          mcpHub.executeTool(srv, name, args)
        );
        if (fallbackRes?.handled) {
          emitHud({ type: "state_sync", ...getPublicState() });
          return {
            ok: true,
            text: fallbackRes.text.replace(/^\[Chế độ Dự phòng Offline\]\s*/i, ""),
            modelLabel: "⚡ Local Fast-Path",
          };
        }
      }
      return {
        ok: false,
        error: "Backend Local (:8765) chưa chạy. Vui lòng khởi chạy start_backend.bat.",
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.on("hub:audio-chunk", async (_evt, base64Pcm) => {
    try {
      await agent.sendAudioChunk(base64Pcm);
    } catch (err) {
      emitHud({ type: "error", message: err.message });
    }
  });

  ipcMain.handle("hub:audio-end", async () => {
    try {
      await agent.endAudioTurn();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("hub:stop-turn", () => {
    abortInFlightBackendCalls();
    callLocalBackend("/panic", {}, 2500, false).catch(() => {});
    for (const [cid, entry] of pendingConfirms.entries()) {
      clearTimeout(entry.timer);
      entry.resolve(false);
      pendingConfirms.delete(cid);
    }
    agent?.stopCurrentTurn();
    return { ok: true };
  });

  ipcMain.handle("hub:resolve-confirm", (_evt, { id, allowed }) => {
    const isAllowed = Boolean(allowed);
    const entry = pendingConfirms.get(id);
    if (entry) {
      pendingConfirms.delete(id);
      clearTimeout(entry.timer);
      entry.resolve(isAllowed);
    }
    if (!isAllowed) {
      for (const [cid, other] of pendingConfirms.entries()) {
        clearTimeout(other.timer);
        other.resolve(false);
        pendingConfirms.delete(cid);
      }
      agent?.cancelTurnOnDenial("thao tác MCP");
    }
    return { ok: true };
  });

  ipcMain.handle("hub:toggle-safety", async () => {
    const next = currentSafetyMode === "safe" ? "turbo" : "safe";
    currentSafetyMode = await setSafetyMode(next);
    mcpHub.setSafetyMode(currentSafetyMode);
    callLocalBackend("/set-safety", { safety_mode: currentSafetyMode }, 2500, false).catch(() => {});
    updateTrayMenu();
    emitHud({ type: "state_sync", ...getPublicState() });
    return currentSafetyMode;
  });

  ipcMain.handle("hub:set-voice-always", (_evt, enabled) => {
    hubState.voiceReplyAlways = Boolean(enabled);
    saveHubState(hubState);
    agent.setVoiceReplyAlways(hubState.voiceReplyAlways);
    updateTrayMenu();
    emitHud({ type: "state_sync", ...getPublicState() });
    return hubState.voiceReplyAlways;
  });

  ipcMain.handle("hub:set-hotkey", (_evt, spec) => {
    switchHotkey(spec);
    return hubState.hotkey;
  });

  ipcMain.handle("hub:set-wake-word", (_evt, enabled) => {
    hubState.wakeWordEnabled = Boolean(enabled);
    saveHubState(hubState);
    if (hotkeyProc?.stdin?.writable) {
      hotkeyProc.stdin.write(`${JSON.stringify({ cmd: "set_wake_word", enabled: hubState.wakeWordEnabled })}\n`);
    }
    updateTrayMenu();
    emitHud({ type: "state_sync", ...getPublicState() });
    return hubState.wakeWordEnabled;
  });

  ipcMain.handle("hub:set-wake-name", (_evt, rawName) => {
    const cleanName = sanitizeWakeName(rawName);
    hubState.wakeName = cleanName;
    saveHubState(hubState);
    if (hotkeyProc?.stdin?.writable) {
      hotkeyProc.stdin.write(`${JSON.stringify({ cmd: "set_wake_name", name: cleanName })}\n`);
    }
    updateTrayMenu();
    emitHud({ type: "state_sync", ...getPublicState() });
    return cleanName;
  });

  ipcMain.handle("hub:set-wake-sensitivity", (_evt, level) => {
    const cleanLevel = sanitizeWakeSensitivity(level);
    hubState.wakeSensitivity = cleanLevel;
    saveHubState(hubState);
    if (hotkeyProc?.stdin?.writable) {
      hotkeyProc.stdin.write(`${JSON.stringify({ cmd: "set_wake_sensitivity", level: cleanLevel })}\n`);
    }
    emitHud({ type: "state_sync", ...getPublicState() });
    return cleanLevel;
  });

  ipcMain.on("hub:pause-wake", (_evt, paused) => {
    if (hotkeyProc?.stdin?.writable) {
      hotkeyProc.stdin.write(`${JSON.stringify({ cmd: "pause_wake", paused: Boolean(paused) })}\n`);
    }
  });

  ipcMain.handle("hub:send-dictation-wav", async (_evt, { wavBase64, autoType = true } = {}) => {
    try {
      const res = await callLocalBackend("/dictate", { wav_base64: wavBase64, auto_type: Boolean(autoType) }, 90000);
      if (!res) {
        return { ok: false, error: "Backend Local (:8765) chưa khởi động xong — hãy thử lại sau 2 giây." };
      }
      if (res.__timeout || res.__httpError) {
        return { ok: false, error: res.error };
      }
      if (res.empty_voice) return { ok: true, emptyVoice: true, text: "" };
      return {
        ok: Boolean(res.ok),
        text: res.reply || res.user_text || "Đã chép lời.",
        userText: res.user_text,
        modelLabel: "✍️ Dictation Local",
        ...res,
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("hub:speak-text", async (_evt, text) => {
    const res = await callLocalBackend("/tts", { text: String(text || "") }, 15000);
    if (res?.ok && res.audio_base64) {
      return { audioWavBase64: res.audio_base64, audioMimeType: res.mime_type || "audio/mpeg" };
    }
    throw new Error(res?.error || "Local TTS không khả dụng.");
  });

  ipcMain.handle("hub:export-word", async (_evt, { title, content }) => {
    const cleanContent = String(content || "").trim();
    if (!cleanContent) return { ok: false, error: "Chưa có nội dung để xuất Word." };
    try {
      const fastRes = await callLocalBackend(
        "/export-word",
        { title: title || "Ghi chú Jarvis", content: cleanContent, open_after: true },
        8000
      );
      if (fastRes?.ok) return fastRes;
    } catch {}
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
    const filename = `jarvis-note-${stamp}.docx`;
    return mcpHub.executeTool("fastDesktop", "export_document", {
      filename,
      title: title || "Ghi chú Jarvis",
      content: cleanContent,
      open_after: true,
    });
  });

  ipcMain.handle("hub:set-local-model", (_evt, presetId) => {
    hubState.localModelPreset = String(presetId || "qwen3.5:4b");
    saveHubState(hubState);
    emitHud({ type: "state_sync", ...getPublicState() });
    return hubState.localModelPreset;
  });

  ipcMain.handle("hub:set-sakuga", (_evt, enabled) => {
    hubState.sakugaEnabled = Boolean(enabled);
    saveHubState(hubState);
    emitHud({ type: "state_sync", ...getPublicState() });
    return hubState.sakugaEnabled;
  });

  ipcMain.handle("hub:set-display-mode", (_evt, mode) => {
    const clean = String(mode || "cursor");
    const valid =
      clean === "cursor" || clean === "primary" || /^display:\d+$/.test(clean) ? clean : "cursor";
    switchDisplayMode(valid);
    return hubState.displayMode;
  });

  ipcMain.handle("hub:set-ui-language", (_evt, lang) => {
    const clean = String(lang || "").trim().toLowerCase() === "en" ? "en" : "vi";
    hubState.uiLanguage = clean;
    saveHubState(hubState);
    updateTrayMenu();
    emitHud({ type: "state_sync", ...getPublicState() });
    return hubState.uiLanguage;
  });

  ipcMain.on("hub:recenter", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!mainWindow.isVisible()) {
      showHubWindow({ focus: false, reason: "recenter" });
    } else {
      positionWindowTopCenter();
      markHubActivity("recenter");
    }
  });

  ipcMain.on("hub:activity-state", (_evt, payload = {}) => {
    const prevHover = activityState.hovering;
    const prevBusy = activityState.busy;
    const prevIsland = activityState.islandState;
    const prevDrawer = activityState.drawerOpen;
    const prevEditing = activityState.isEditing;
    const prevDraft = activityState.hasDraftText;

    if (typeof payload.islandState === "string") activityState.islandState = payload.islandState;
    if (typeof payload.busy === "boolean") activityState.busy = payload.busy;
    if (typeof payload.hovering === "boolean") activityState.hovering = payload.hovering;
    if (typeof payload.drawerOpen === "boolean") activityState.drawerOpen = payload.drawerOpen;
    if (typeof payload.isEditing === "boolean") activityState.isEditing = payload.isEditing;
    if (typeof payload.hasDraftText === "boolean") activityState.hasDraftText = payload.hasDraftText;
    if (Array.isArray(payload.interactiveRects)) {
      activityState.interactiveRects = payload.interactiveRects;
    }

    if (activityState.hovering || !activityState.ignoreMouse) {
      startHoverSafetyPoll();
    } else {
      stopHoverSafetyPoll();
    }

    const activeInteraction =
      activityState.busy ||
      activityState.hovering ||
      (activityState.hasDraftText && activityState.isEditing) ||
      (prevHover && !activityState.hovering) ||
      (prevBusy && !activityState.busy) ||
      (prevIsland !== activityState.islandState && activityState.islandState !== "idle") ||
      (prevDrawer !== activityState.drawerOpen && activityState.drawerOpen) ||
      (prevEditing !== activityState.isEditing && activityState.isEditing) ||
      prevDraft !== activityState.hasDraftText;

    if (activeInteraction) {
      markHubActivity("state_change");
    } else {
      scheduleInactivityEvaluation();
    }
  });

  ipcMain.on("hub:ping-activity", () => {
    markHubActivity("ui_ping");
  });

  ipcMain.handle("hub:pick-context-file", async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return null;
    markHubActivity("pick_file");
    activityState.busy = true;
    try {
      const res = await dialog.showOpenDialog(mainWindow, {
        title: "Chọn ảnh hoặc tài liệu ngữ cảnh cho Jarvis",
        properties: ["openFile", "multiSelections"],
        filters: [
          {
            name: "Ảnh & Tài liệu",
            extensions: ["png", "jpg", "jpeg", "webp", "pdf", "docx", "xlsx", "csv", "txt", "md", "py", "js", "jsx", "ts", "json"],
          },
          { name: "Tất cả file", extensions: ["*"] },
        ],
      });
      if (res.canceled || !res.filePaths?.length) return [];
      return res.filePaths.slice(0, 3).map((fp) => {
        const ext = path.extname(fp).toLowerCase();
        const isImg = [".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"].includes(ext);
        let sizeKb = 0;
        try {
          sizeKb = Math.round((fs.statSync(fp).size / 1024) * 10) / 10;
        } catch {}
        return { path: fp, name: path.basename(fp), kind: isImg ? "image" : "document", sizeKb };
      });
    } finally {
      activityState.busy = false;
      markHubActivity("pick_file_done");
    }
  });

  ipcMain.handle("hub:save-pasted-image", (_evt, base64Data) => {
    try {
      const cacheDir = "C:\\AI-Sandbox\\context_cache";
      fs.mkdirSync(cacheDir, { recursive: true });
      const clean = String(base64Data || "").replace(/^data:image\/[a-z0-9+]+;base64,/i, "");
      const buf = Buffer.from(clean, "base64");
      if (!buf.length) return null;
      const fname = `paste_${Date.now()}.png`;
      const fpath = path.join(cacheDir, fname);
      fs.writeFileSync(fpath, buf);
      return { path: fpath, name: fname, kind: "image", sizeKb: Math.round((buf.length / 1024) * 10) / 10 };
    } catch {
      return null;
    }
  });

  ipcMain.handle("hub:grab-clipboard-context", async () => {
    try {
      const img = clipboard.readImage();
      if (img && !img.isEmpty()) {
        const cacheDir = "C:\\AI-Sandbox\\context_cache";
        fs.mkdirSync(cacheDir, { recursive: true });
        const pngBuf = img.toPNG();
        const fname = `clipboard_${Date.now()}.png`;
        const fpath = path.join(cacheDir, fname);
        fs.writeFileSync(fpath, pngBuf);
        return { ok: true, file: { path: fpath, name: fname, kind: "image", sizeKb: Math.round((pngBuf.length / 1024) * 10) / 10 } };
      }
      const res = await callLocalBackend("/clipboard-context", {}, 4000);
      if (res?.ok && res.path) {
        return {
          ok: true,
          file: { path: res.path, name: res.name || path.basename(res.path), kind: res.kind || "document", sizeKb: 0 },
        };
      }
      return { ok: false, error: res?.error || "Clipboard chưa có ảnh hoặc file." };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("hub:save-dict-word", (_evt, word) => {
    const clean = String(word || "").trim();
    if (!clean) return hubState.customDictionary || [];
    const cur = Array.isArray(hubState.customDictionary) ? hubState.customDictionary : [];
    if (!cur.some((w) => w.toLowerCase() === clean.toLowerCase())) {
      hubState.customDictionary = [clean, ...cur].slice(0, 40);
      saveHubState(hubState);
      emitHud({ type: "state_sync", ...getPublicState() });
    }
    return hubState.customDictionary;
  });

  ipcMain.handle("hub:remove-dict-word", (_evt, word) => {
    const clean = String(word || "").trim().toLowerCase();
    const cur = Array.isArray(hubState.customDictionary) ? hubState.customDictionary : [];
    hubState.customDictionary = cur.filter((w) => w.toLowerCase() !== clean);
    saveHubState(hubState);
    emitHud({ type: "state_sync", ...getPublicState() });
    return hubState.customDictionary;
  });

  ipcMain.handle("hub:open-exports", () => {
    try {
      fs.mkdirSync(EXPORTS_DIR, { recursive: true });
    } catch {}
    execFile("explorer.exe", [EXPORTS_DIR], { windowsHide: true });
    return true;
  });

  ipcMain.on("hub:set-ignore-mouse", (_evt, ignore) => {
    const nextIgnore = Boolean(ignore);
    activityState.ignoreMouse = nextIgnore;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setIgnoreMouseEvents(nextIgnore, { forward: true });
    }
    if (!nextIgnore) {
      startHoverSafetyPoll();
    } else if (!activityState.hovering) {
      stopHoverSafetyPoll();
    }
  });

  ipcMain.on("hub:resize", () => {
    positionWindowTopCenter();
  });

  ipcMain.on("hub:hide", () => {
    hideHubWindow();
  });

  ipcMain.on("hub:quit", () => {
    forceQuitApp();
  });
}

function scheduleDisplayChangeSync() {
  clearTimeout(displayDebounceTimer);
  displayDebounceTimer = setTimeout(() => {
    positionWindowTopCenter();
    updateTrayMenu();
    emitHud({ type: "state_sync", ...getPublicState() });
  }, 140);
}

app.setName("Black Sakura Jarvis-Hub");
if (process.platform === "win32") {
  app.setAppUserModelId("com.blacksakura.jarvishub");
}
// Keep Electron/Chromium V8 heap & cache lean for 24/7 tray residency
app.commandLine.appendSwitch("js-flags", "--max-old-space-size=192");
app.commandLine.appendSwitch("disable-http-cache");

const gotSingleLock = app.requestSingleInstanceLock();
if (!gotSingleLock) {
  app.quit();
  process.exit(0);
}

app.on("second-instance", () => {
  if (!hubState.onboardingCompleted) {
    openSetupWizardWindow();
    return;
  }
  showHubWindow({ focus: true, reason: "second_instance" });
});

app.whenReady().then(async () => {
  // Lazy-start fallback MCP hub only when needed so boot stays lightweight with zero duplicate child processes
  mcpHub = new McpHub({
    safetyMode: currentSafetyMode,
    onConfirmRequest: requestConfirmation,
    onActivity: (act) => emitHud({ type: "activity", ...act }),
  });

  agent = new GeminiAgent({
    mcpHub,
    onHudEvent: (evt) => {
      if (evt.type === "turn_done" && evt.userText) {
        recordRecentCommand(evt.userText);
      }
      if ((evt.type === "turn_done" || evt.type === "error") && mainWindow && !mainWindow.isVisible()) {
        showHubWindow({ focus: false, reason: evt.type });
      }
      emitHud(evt);
    },
  });
  agent.setVoiceReplyAlways(hubState.voiceReplyAlways);

  registerIpc();

  screen.on("display-added", scheduleDisplayChangeSync);
  screen.on("display-removed", scheduleDisplayChangeSync);
  screen.on("display-metrics-changed", scheduleDisplayChangeSync);

  tray = new Tray(createTrayIcon());
  tray.setToolTip(`Black Sakura Jarvis-Hub (${hubState.hotkey.toUpperCase()})`);
  updateTrayMenu();
  tray.on("click", () => {
    if (!hubState.onboardingCompleted) {
      openSetupWizardWindow();
      return;
    }
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isVisible()) hideHubWindow();
    else showHubWindow({ focus: true, reason: "tray_click" });
  });

  void ensureLocalBackendRunning(agent?.installedApps || []).catch(() => {});

  // First-run ONLY: show full Setup Wizard window BEFORE creating Mini HUD or starting wake/hotkey listener.
  // Once accepted & completed (onboardingCompleted === true), Setup Wizard never auto-opens again.
  if (!hubState.onboardingCompleted) {
    openSetupWizardWindow();
  } else {
    ensureMainHudStarted({ showNow: true, focus: false, reason: "boot" });
  }
});

app.on("before-quit", () => {
  forceQuitApp();
});

app.on("window-all-closed", (e) => {
  if (!hubState.onboardingCompleted || isQuittingHub) {
    forceQuitApp();
    return;
  }
  e.preventDefault(); // Stay running in System Tray once onboarding is complete
});
