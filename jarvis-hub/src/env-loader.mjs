import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const HUB_ROOT = path.resolve(__dirname, "..");

function resolveWorkspaceRoot() {
  const directParent = path.resolve(HUB_ROOT, "..");
  if (fs.existsSync(path.join(directParent, "backend"))) {
    return directParent;
  }
  // Packaged standalone Electron app: <portable_root>/resources/app/src -> ../../..
  const packagedRoot = path.resolve(HUB_ROOT, "..", "..");
  if (fs.existsSync(path.join(packagedRoot, "backend"))) {
    return packagedRoot;
  }
  return directParent;
}

export const WORKSPACE_ROOT = resolveWorkspaceRoot();
export const FAST_DESKTOP_SERVER = path.join(WORKSPACE_ROOT, "fast-desktop-mcp", "server.mjs");
export const SANDBOX_ROOT = path.resolve(
  process.env.JARVIS_SANDBOX_DIR ||
    (fs.existsSync("C:\\AI-Sandbox") ? "C:\\AI-Sandbox" : path.join(WORKSPACE_ROOT, "sandbox"))
);
export const SWITCH_MODE_SCRIPT = path.join(SANDBOX_ROOT, ".scripts", "switch-mode.ps1");
export const EXPORTS_DIR = path.join(SANDBOX_ROOT, "exports");
const GLOBAL_SETTINGS_PATH = path.join(os.homedir(), ".gemini", "settings.json");

function resolveStateFilePath() {
  const preferred = fs.existsSync(path.join(WORKSPACE_ROOT, "jarvis-hub"))
    ? path.join(WORKSPACE_ROOT, "jarvis-hub", "state.json")
    : path.join(WORKSPACE_ROOT, "state.json");
  try {
    fs.accessSync(path.dirname(preferred), fs.constants.W_OK);
    return preferred;
  } catch {
    const fallbackDir = path.join(
      process.env.LOCALAPPDATA || os.homedir(),
      "BlackSakuraJarvisHub"
    );
    try {
      fs.mkdirSync(fallbackDir, { recursive: true });
    } catch {}
    return path.join(fallbackDir, "state.json");
  }
}

const STATE_FILE = resolveStateFilePath();

function parseDotEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const k = trimmed.slice(0, eq).trim();
    let v = trimmed.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (k && v && !process.env[k]) {
      process.env[k] = v;
    }
  }
}

function readWindowsRegistryEnv(regPath, name) {
  try {
    const out = execFileSync("reg.exe", ["query", regPath, "/v", name], {
      encoding: "utf8",
      timeout: 2000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const m = out.match(/REG_(?:EXPAND_)?SZ\s+(.+)/);
    return m ? m[1].trim() : "";
  } catch {
    return "";
  }
}

function splitKeys(raw) {
  return String(raw || "")
    .split(/[,;\r\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 16);
}

/**
 * Resolve all configured Gemini API keys (primary + backup keys) from process.env, .env, or Windows Registry.
 */
export function resolveGeminiApiKeys() {
  parseDotEnvFile(path.join(HUB_ROOT, ".env"));
  parseDotEnvFile(path.join(WORKSPACE_ROOT, ".env"));

  const pool = [];
  const addFrom = (val) => {
    for (const k of splitKeys(val)) {
      if (!pool.includes(k)) pool.push(k);
    }
  };

  addFrom(process.env.GEMINI_API_KEYS);
  addFrom(process.env.GEMINI_API_KEY);
  addFrom(process.env.GEMINI_API_KEY_2);
  addFrom(process.env.GEMINI_API_KEY_3);
  addFrom(process.env.GOOGLE_API_KEY);

  if (pool.length === 0) {
    for (const varName of ["GEMINI_API_KEYS", "GEMINI_API_KEY", "GOOGLE_API_KEY"]) {
      const fromUser = readWindowsRegistryEnv("HKCU\\Environment", varName);
      if (fromUser) {
        process.env[varName] = fromUser;
        addFrom(fromUser);
      }
      const fromMachine = readWindowsRegistryEnv(
        "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment",
        varName
      );
      if (fromMachine) {
        process.env[varName] = fromMachine;
        addFrom(fromMachine);
      }
    }
  }
  return pool;
}

/**
 * Resolve primary Gemini API key cleanly from process.env, .env, or live Windows Registry (HKCU/HKLM).
 */
export function resolveGeminiApiKey() {
  const keys = resolveGeminiApiKeys();
  return keys[0] || "";
}

/**
 * Save one or multiple GEMINI_API_KEYs (comma-separated or appended as backup key) into local workspace .env.
 */
export function saveLocalApiKey(rawKey, appendBackup = true) {
  const incoming = splitKeys(rawKey);
  if (incoming.length === 0) {
    throw new Error("API key không hợp lệ hoặc bị trống.");
  }
  const existing = appendBackup ? resolveGeminiApiKeys() : [];
  const merged = [...incoming];
  for (const k of existing) {
    if (!merged.includes(k)) merged.push(k);
  }

  const envPath = path.join(WORKSPACE_ROOT, ".env");
  let lines = [];
  if (fs.existsSync(envPath)) {
    lines = fs
      .readFileSync(envPath, "utf8")
      .split(/\r?\n/)
      .filter((l) => !l.trim().startsWith("GEMINI_API_KEY=") && !l.trim().startsWith("GEMINI_API_KEYS="));
  }
  lines.push(`GEMINI_API_KEY=${merged[0]}`);
  lines.push(`GEMINI_API_KEYS=${merged.join(",")}`);
  fs.writeFileSync(envPath, `${lines.filter((l) => l.length > 0).join("\n")}\n`, "utf8");
  process.env.GEMINI_API_KEY = merged[0];
  process.env.GEMINI_API_KEYS = merged.join(",");
  return { count: merged.length };
}

export function sanitizeWakeName(raw) {
  const cleaned = String(raw || "")
    .replace(/[^a-zA-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24);
  if (!cleaned) return "Luna";
  return cleaned
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export function sanitizeWakeSensitivity(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (s === "high" || s === "strict" || s === "balanced") return s;
  return "balanced";
}

export function loadHubState() {
  const defaults = {
    hotkey: "ctrl+alt+space",
    wakeWordEnabled: true,
    wakeName: "Luna",
    wakeSensitivity: "balanced",
    voiceReplyAlways: false,
    recentCommands: [],
    localModelPreset: "qwen3.5:4b",
    customDictionary: [],
    sakugaEnabled: true,
    displayMode: "cursor",
    onboardingCompleted: false,
    uiLanguage: "vi",
  };
  try {
    if (!fs.existsSync(STATE_FILE)) return defaults;
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    const loadedHotkey =
      typeof parsed.hotkey === "string" && parsed.hotkey && parsed.hotkey !== "ctrl+space"
        ? parsed.hotkey
        : defaults.hotkey;
    const loadedDisplayMode =
      typeof parsed.displayMode === "string" &&
      (parsed.displayMode === "cursor" ||
        parsed.displayMode === "primary" ||
        /^display:\d+$/.test(parsed.displayMode))
        ? parsed.displayMode
        : defaults.displayMode;
    return {
      hotkey: loadedHotkey,
      wakeWordEnabled: parsed.wakeWordEnabled !== false,
      wakeName: typeof parsed.wakeName === "string" && parsed.wakeName.trim() ? sanitizeWakeName(parsed.wakeName) : defaults.wakeName,
      wakeSensitivity: sanitizeWakeSensitivity(parsed.wakeSensitivity),
      voiceReplyAlways: parsed.voiceReplyAlways === true,
      recentCommands: Array.isArray(parsed.recentCommands) ? parsed.recentCommands.slice(0, 6) : [],
      localModelPreset:
        typeof parsed.localModelPreset === "string" && parsed.localModelPreset
          ? parsed.localModelPreset
          : defaults.localModelPreset,
      customDictionary: Array.isArray(parsed.customDictionary)
        ? parsed.customDictionary.map((w) => String(w || "").trim()).filter(Boolean).slice(0, 40)
        : [],
      sakugaEnabled: parsed.sakugaEnabled !== false,
      displayMode: loadedDisplayMode,
      onboardingCompleted: parsed.onboardingCompleted === true,
      uiLanguage: parsed.uiLanguage === "en" ? "en" : "vi",
    };
  } catch {
    return defaults;
  }
}

export function saveHubState(nextState) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(nextState, null, 2), "utf8");
}

/**
 * Detect current Safe ('safe') vs Turbo ('turbo') mode from ~/.gemini/settings.json.
 */
export function readSafetyMode() {
  try {
    if (!fs.existsSync(GLOBAL_SETTINGS_PATH)) return "safe";
    const parsed = JSON.parse(fs.readFileSync(GLOBAL_SETTINGS_PATH, "utf8"));
    const allow = parsed?.permissions?.allow;
    if (
      Array.isArray(allow) &&
      (allow.includes("mcp(fast-desktop/*)") || allow.includes("mcp(fast-desktop/uia_click)"))
    ) {
      return "turbo";
    }
    return "safe";
  } catch {
    return "safe";
  }
}

/**
 * Sync safety mode with C:\AI-Sandbox\.scripts\switch-mode.ps1 ('safe' -> 'off', 'turbo' -> 'on').
 */
export function setSafetyMode(mode) {
  const targetMode = mode === "turbo" ? "on" : "off";
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(SWITCH_MODE_SCRIPT)) {
      resolve(mode === "turbo" ? "turbo" : "safe");
      return;
    }
    execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", SWITCH_MODE_SCRIPT, "-Mode", targetMode],
      { timeout: 8000, windowsHide: true },
      (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(mode === "turbo" ? "turbo" : "safe");
      }
    );
  });
}

const APP_JUNK_RE = /(?:uninstall|remove|error\s*reporter|updater|check\s*for|manual|readme|help|repair|setup|console|command\s*prompt|powershell|terminal|registry|task\s*manager|resource\s*monitor|event\s*viewer|defragment|disk\s*cleanup|character\s*map|component\s*services|computer\s*management)/i;

function scanLnkNames(dir, maxDepth = 2, depth = 0, out = []) {
  if (!dir || depth > maxDepth || !fs.existsSync(dir)) return out;
  try {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        scanLnkNames(full, maxDepth, depth + 1, out);
      } else if (ent.isFile() && ent.name.toLowerCase().endsWith(".lnk")) {
        const base = ent.name.slice(0, -4).trim();
        if (base && !APP_JUNK_RE.test(base)) {
          out.push(base);
        }
      }
    }
  } catch {}
  return out;
}

/**
 * Fast (<5ms) synchronous scan of installed desktop & Start Menu shortcuts.
 */
export function discoverInstalledAppNamesSync(limit = 65) {
  const dirs = [
    path.join(os.homedir(), "Desktop"),
    process.env.PUBLIC ? path.join(process.env.PUBLIC, "Desktop") : "",
    process.env.APPDATA ? path.join(process.env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs") : "",
    process.env.ProgramData ? path.join(process.env.ProgramData, "Microsoft", "Windows", "Start Menu", "Programs") : "",
  ];
  const seen = new Set();
  const names = [];
  for (const d of dirs) {
    for (const nm of scanLnkNames(d, 2)) {
      const key = nm.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        names.push(nm);
        if (names.length >= limit) return names;
      }
    }
  }
  return names;
}

/**
 * Background enrichment merging Desktop/Start Menu shortcuts with Windows Get-StartApps.
 */
export function discoverAllInstalledAppsAsync(limit = 65) {
  const baseNames = discoverInstalledAppNamesSync(limit);
  const seen = new Set(baseNames.map((n) => n.toLowerCase()));
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); (Get-StartApps | Select-Object -ExpandProperty Name) -join \"`n\"",
      ],
      { encoding: "utf8", timeout: 4500, windowsHide: true },
      (err, stdout) => {
        if (err || !stdout) {
          resolve(baseNames);
          return;
        }
        const merged = [...baseNames];
        for (const raw of stdout.split(/\r?\n/)) {
          const nm = raw.trim();
          if (!nm || APP_JUNK_RE.test(nm)) continue;
          const key = nm.toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            merged.push(nm);
            if (merged.length >= limit) break;
          }
        }
        resolve(merged);
      }
    );
  });
}
