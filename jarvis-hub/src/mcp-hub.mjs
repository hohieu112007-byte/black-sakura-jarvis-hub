import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { spawn, execFile } from "node:child_process";
import { FAST_DESKTOP_SERVER, SANDBOX_ROOT } from "./env-loader.mjs";

function resolveNodeCommandAndEnv() {
  for (const dir of String(process.env.PATH || "").split(path.delimiter)) {
    const clean = dir.trim().replace(/^"|"$/g, "");
    if (!clean) continue;
    const cand = path.join(clean, "node.exe");
    if (fs.existsSync(cand)) return { cmd: cand, extraEnv: {} };
  }
  const progNode = "C:\\Program Files\\nodejs\\node.exe";
  if (fs.existsSync(progNode)) return { cmd: progNode, extraEnv: {} };
  return { cmd: process.execPath, extraEnv: { ELECTRON_RUN_AS_NODE: "1" } };
}

function findCachedNpxEntry(...relParts) {
  try {
    const npxRoot = path.join(process.env.LOCALAPPDATA || "", "npm-cache", "_npx");
    if (!fs.existsSync(npxRoot)) return "";
    for (const ent of fs.readdirSync(npxRoot, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const cand = path.join(npxRoot, ent.name, "node_modules", ...relParts);
      if (fs.existsSync(cand)) return cand;
    }
  } catch {}
  return "";
}

function resolveDirectAgentDesktop() {
  const exe = path.join(
    process.env.APPDATA || "",
    "npm",
    "node_modules",
    "agent-desktop",
    "bin",
    "agent-desktop-win32-x64.exe"
  );
  if (fs.existsSync(exe)) return { cmd: exe, args: ["mcp"] };
  return { cmd: "cmd.exe", args: ["/c", "agent-desktop", "mcp"] };
}

function resolveDirectNpxNode(relParts, tailArgs, pkgFallback) {
  const entry = findCachedNpxEntry(...relParts);
  if (entry) {
    const rt = resolveNodeCommandAndEnv();
    return { cmd: rt.cmd, args: [entry, ...tailArgs], extraEnv: rt.extraEnv };
  }
  return { cmd: "cmd.exe", args: ["/c", "npx", "-y", pkgFallback, ...tailArgs], extraEnv: {} };
}

const READ_ONLY_TOOLS = new Set([
  "list_windows",
  "uia_read",
  "browser_snapshot",
  "browser_console_messages",
  "browser_network_requests",
  "read_text_file",
  "read_file",
  "list_directory",
  "list_directory_with_sizes",
  "search_files",
  "get_file_info",
  "list_allowed_directories",
  "desktop_snapshot",
  "desktop_find",
  "desktop_screenshot",
  "desktop_get",
  "desktop_is",
  "desktop_list_windows",
  "desktop_list_displays",
  "desktop_list_apps",
  "desktop_list_notifications",
  "desktop_list_surfaces",
  "desktop_clipboard_get",
  "desktop_status",
]);

class StdioMcpClient {
  constructor(name, command, args, timeoutMs = 25000, idleTimeoutMs = 0, extraEnv = {}) {
    this.name = name;
    this.command = command;
    this.args = args;
    this.extraEnv = extraEnv || {};
    this.timeoutMs = timeoutMs;
    this.idleTimeoutMs = idleTimeoutMs;
    this.idleTimer = null;
    this.proc = null;
    this.rl = null;
    this.nextId = 1;
    this.pending = new Map();
    this.tools = [];
    this.readyPromise = null;
  }

  touchIdleTimer() {
    if (!this.idleTimeoutMs || this.idleTimeoutMs <= 0) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.pending.size === 0 && this.proc) {
        this.close();
      }
    }, this.idleTimeoutMs);
  }

  async ensureReady() {
    if (this.proc && !this.proc.killed && this.tools.length > 0) return;
    if (this.readyPromise) return this.readyPromise;

    this.readyPromise = (async () => {
      this.proc = spawn(this.command, this.args, {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        env: { ...process.env, ...this.extraEnv },
      });

      this.rl = readline.createInterface({ input: this.proc.stdout });
      this.rl.on("line", (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let msg;
        try {
          msg = JSON.parse(trimmed);
        } catch {
          return;
        }
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const entry = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          clearTimeout(entry.timer);
          if (msg.error) {
            entry.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          } else {
            entry.resolve(msg.result);
          }
        }
      });

      this.proc.on("exit", () => {
        for (const entry of this.pending.values()) {
          clearTimeout(entry.timer);
          entry.reject(new Error(`MCP server "${this.name}" exited unexpectedly`));
        }
        this.pending.clear();
        this.proc = null;
        this.tools = [];
        this.readyPromise = null;
      });

      await this.rpc("initialize", {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "jarvis-desktop-hub", version: "1.0.0" },
      });
      this.notify("notifications/initialized", {});
      const listRes = await this.rpc("tools/list", {});
      this.tools = Array.isArray(listRes?.tools) ? listRes.tools : [];
    })();

    try {
      await this.readyPromise;
    } finally {
      this.readyPromise = null;
    }
  }

  notify(method, params = {}) {
    if (!this.proc || !this.proc.stdin.writable) return;
    this.proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  rpc(method, params = {}, customTimeoutMs = this.timeoutMs) {
    return new Promise((resolve, reject) => {
      if (!this.proc || !this.proc.stdin.writable) {
        reject(new Error(`MCP server "${this.name}" is not running`));
        return;
      }
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP ${this.name}.${method} timed out after ${customTimeoutMs}ms`));
      }, customTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  async callTool(name, args = {}) {
    await this.ensureReady();
    this.touchIdleTimer();
    const res = await this.rpc("tools/call", { name, arguments: args }, 40000);
    this.touchIdleTimer();
    const parts = Array.isArray(res?.content) ? res.content : [];
    const text = parts.map((c) => (c?.type === "text" || typeof c?.text === "string" ? c.text || "" : "")).filter(Boolean).join("\n") || "";
    const images = parts
      .filter((c) => c?.type === "image" && typeof c.data === "string" && c.data.length > 0)
      .map((c) => ({ data: c.data, mimeType: c.mimeType || "image/png" }));
    if (res?.isError) {
      throw new Error(text || `${this.name}.${name} failed`);
    }
    let parsedObj;
    try {
      const parsed = JSON.parse(text);
      parsedObj = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : { data: parsed };
    } catch {
      parsedObj = { text };
    }
    if (images.length > 0) {
      return { ...parsedObj, __mcpImages: images };
    }
    return parsedObj;
  }

  close() {
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
    if (this.proc && !this.proc.killed) {
      try {
        this.proc.stdin?.end();
      } catch {}
      try {
        // Kill only the MCP worker process itself; NEVER use /T (Tree kill) so user apps/browsers launched via MCP stay open
        execFile("taskkill", ["/F", "/PID", String(this.proc.pid)], { windowsHide: true }, () => {});
      } catch {}
      this.proc.kill();
    }
    this.proc = null;
    this.tools = [];
  }
}

export class McpHub {
  constructor({ safetyMode = "safe", onConfirmRequest = null, onActivity = null } = {}) {
    this.safetyMode = safetyMode;
    this.onConfirmRequest = onConfirmRequest;
    this.onActivity = onActivity;

    const nodeRT = resolveNodeCommandAndEnv();
    const agentTarget = resolveDirectAgentDesktop();
    const pwTarget = resolveDirectNpxNode(
      ["@playwright", "mcp", "cli.js"],
      ["--user-data-dir", path.join(SANDBOX_ROOT, "browser-profile")],
      "@playwright/mcp@latest"
    );
    const fsTarget = resolveDirectNpxNode(
      ["@modelcontextprotocol", "server-filesystem", "dist", "index.js"],
      [SANDBOX_ROOT],
      "@modelcontextprotocol/server-filesystem"
    );

    this.clients = {
      fastDesktop: new StdioMcpClient("fast-desktop", nodeRT.cmd, [FAST_DESKTOP_SERVER], 35000, 0, nodeRT.extraEnv),
      // Keep native agent-desktop (~11MB RAM) warm permanently without cmd.exe wrapper (prevents console flashes)
      agentDesktop: new StdioMcpClient("agent-desktop", agentTarget.cmd, agentTarget.args, 35000, 0),
      // Auto-reap heavy Node MCP servers after 3 minutes of inactivity to keep RAM lean
      playwright: new StdioMcpClient("playwright", pwTarget.cmd, pwTarget.args, 45000, 180000, pwTarget.extraEnv),
      filesystem: new StdioMcpClient("filesystem", fsTarget.cmd, fsTarget.args, 25000, 180000, fsTarget.extraEnv),
    };
  }

  async startCore() {
    await this.clients.fastDesktop.ensureReady();
    // Warm lightweight native agent-desktop (~11MB) asynchronously in background without blocking core startup
    void this.clients.agentDesktop.ensureReady().catch(() => {});
  }

  getFastDesktopTools() {
    return this.clients.fastDesktop.tools;
  }

  async getDeepTaskTools() {
    const out = [];
    for (const t of this.clients.fastDesktop.tools) {
      out.push({ serverKey: "fastDesktop", tool: t });
    }
    try {
      await this.clients.agentDesktop.ensureReady();
      const allowedAgentDesktop = new Set([
        "desktop_snapshot",
        "desktop_find",
        "desktop_screenshot",
        "desktop_get",
        "desktop_click",
        "desktop_double_click",
        "desktop_right_click",
        "desktop_type",
        "desktop_scroll",
        "desktop_press",
        "desktop_drag",
        "desktop_hover",
        "desktop_focus_window",
        "desktop_list_notifications",
        "desktop_clipboard_get",
        "desktop_clipboard_set",
        "desktop_wait",
      ]);
      for (const t of this.clients.agentDesktop.tools) {
        if (allowedAgentDesktop.has(t.name)) {
          out.push({ serverKey: "agentDesktop", tool: t });
        }
      }
    } catch {}
    try {
      await this.clients.filesystem.ensureReady();
      for (const t of this.clients.filesystem.tools) {
        if (["read_text_file", "write_file", "list_directory", "search_files"].includes(t.name)) {
          out.push({ serverKey: "filesystem", tool: t });
        }
      }
    } catch {}
    try {
      await this.clients.playwright.ensureReady();
      for (const t of this.clients.playwright.tools) {
        if (
          ["browser_navigate", "browser_snapshot", "browser_click", "browser_type", "browser_fill_form", "browser_press_key", "browser_wait_for"].includes(
            t.name
          )
        ) {
          out.push({ serverKey: "playwright", tool: t });
        }
      }
    } catch {}
    return out;
  }

  getHealth() {
    return {
      fastDesktop: this.clients.fastDesktop.tools.length > 0,
      agentDesktop: this.clients.agentDesktop.tools.length > 0,
      playwright: this.clients.playwright.tools.length > 0,
      filesystem: this.clients.filesystem.tools.length > 0,
    };
  }

  setSafetyMode(mode) {
    this.safetyMode = mode === "turbo" ? "turbo" : "safe";
  }

  requiresConfirmation(toolName, args) {
    if (READ_ONLY_TOOLS.has(toolName)) return false;
    if (toolName === "uia_click" && args?.dry_run === true) return false;
    if (toolName === "manage_edge_tabs" && args?.action === "list") return false;
    if (this.safetyMode === "safe") return true;
    if (toolName === "close_app" && args?.force === true) return true;
    return false;
  }

  async executeTool(serverKey, toolName, args = {}) {
    const client = this.clients[serverKey];
    if (!client) {
      throw new Error(`Unknown MCP server key: ${serverKey}`);
    }

    if (this.requiresConfirmation(toolName, args)) {
      if (typeof this.onConfirmRequest !== "function") {
        throw new Error(`Safe Mode blocked "${toolName}" (no confirmation handler available).`);
      }
      const allowed = await this.onConfirmRequest({ serverKey, toolName, args });
      if (!allowed) {
        return { cancelled_by_user: true, message: `Người dùng đã hủy thao tác "${toolName}".` };
      }
    }

    const t0 = Date.now();
    try {
      const result = await client.callTool(toolName, args);
      this.onActivity?.({ toolName, serverKey, ok: true, ms: Date.now() - t0, args });
      return result;
    } catch (err) {
      this.onActivity?.({ toolName, serverKey, ok: false, ms: Date.now() - t0, error: err.message });
      throw err;
    }
  }

  closeAll() {
    for (const c of Object.values(this.clients)) {
      c.close();
    }
  }
}
