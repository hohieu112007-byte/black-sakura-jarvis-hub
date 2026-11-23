import { GoogleGenAI } from "@google/genai";
import {
  resolveGeminiApiKey,
  resolveGeminiApiKeys,
  discoverInstalledAppNamesSync,
  discoverAllInstalledAppsAsync,
} from "./env-loader.mjs";
import { isQuotaOrNetworkError, tryLocalFallbackCommand, tryInstantFastPath } from "./local-fallback.mjs";

export const LIVE_MODEL = "gemini-3.8-live";
export const FAST_LLM_MODEL = "gemini-3.5-flash-lite";
export const DEEP_LLM_MODEL = "gemini-3.8-flash";
export const TRANSCRIBE_MODEL = "gemini-3.5-transcribe";
export const TTS_MODEL = "gemini-3.8-flash-tts";

export const FALLBACK_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.8-flash",
  "gemini-3.1-flash-lite",
];

const VIETNAMESE_CUSTOM_VOCABULARY = [
  "Jarvis",
  "Hey Jarvis",
  "Jarvis sleep",
  "ngủ đi Jarvis",
  "YouTube",
  "Google",
  "Facebook",
  "tắt app Facebook",
  "đóng app Facebook",
  "Gmail",
  "GitHub",
  "ChatGPT",
  "Gemini",
  "Microsoft Edge",
  "Edge",
  "mở Edge",
  "tắt Edge",
  "đóng Edge",
  "Discord",
  "Zalo",
  "Spotify",
  "Steam",
  "Notepad",
  "Calculator",
  "File Explorer",
  "VS Code",
  "Word",
  "Excel",
  "Safe",
  "Turbo",
  "tab mới",
  "giữ lại 1 tab",
  "tắt hết tab",
  "màn hình 1",
  "màn hình 2",
  "độ sáng",
  "âm lượng",
  "video đầu tiên",
  "cuộn xuống",
  "cuộn lên",
  "thu nhỏ",
  "phóng to",
  "tua video",
  "1 tiếng",
  "phút",
  "trắc nghiệm",
  "tự luận",
  "đọc và làm",
  "điền vào",
  "bật mic Discord",
  "tắt mic Discord",
  "tắt tiếng Discord",
  "tua thêm",
  "tua lại",
  "toàn màn hình",
  "tạm dừng",
  "bật phụ đề",
];

const CORE_INSTRUCTION_VI = [
  "Bạn là Jarvis — trợ lý điều khiển Windows 11 qua MCP. Trả lời Tiếng Việt súc tích (1-3 câu), không bịa thông tin.",
  "- Mở app ('mở app <Tên>'): launch_app(app); dời/thu nhỏ/phóng to: window_control (action: 'minimize' cho ẩn/thu nhỏ, 'maximize' cho phóng to/full, với PWA như Facebook truyền title: 'Facebook'). KHÔNG dùng close_app khi nói 'ẩn'.",
  "- Đóng app (kể cả PWA như Facebook, Discord, Steam, Zalo, Spotify) hoặc đóng Edge: close_app(app).",
  "- Quản lý tab Edge ('giữ lại 1 tab...', 'đóng tab khác'): dùng manage_edge_tabs(action: 'close_others'|'list'), KHÔNG dùng close_app.",
  "- Mở URL / tìm YouTube / Google: open_edge_url (truyền từ khóa có dấu vào youtube_search hoặc google_search, không tự bịa tìm kiếm).",
  "- Âm lượng: send_hotkey(combo: 'volume_up'|'volume_down', repeat: 6) hoặc 'volume_mute'. Độ sáng: set_brightness(delta/level). Cuộn: scroll_window. Đọc màn hình: uia_read. Xuất docx/csv: export_document.",
  "- Phân luồng: mặc định gọi trực tiếp fast-desktop; CHỈ gọi delegate_deep_task khi cần chụp ảnh/nhìn màn hình (desktop_screenshot), kéo thả, clipboard/thông báo, Playwright hoặc việc nhiều bước/UIA thất bại. uia_click lỗi 2 lần phải dừng.",
].join("\n");

const DOMAIN_PROMPTS = {
  discordMic:
    "- Mic Discord ('bật/tắt mic discord'): KHÔNG close_app. Gọi uia_click(process:'Discord', name:'Tắt âm', role:'button', exact:true, dry_run:true) (nếu minimized gọi launch_app('discord') trước). toggle_state='On' là ĐANG TẮT MIC -> muốn BẬT thì bấm 1 lần (restore_focus:true); toggle_state='Off' là ĐANG BẬT -> muốn TẮT thì bấm 1 lần; đúng trạng thái rồi thì báo lại, không bấm ngược.",
  videoSlider:
    "- Tua video: đổi mốc ra giây (vd 1h=3600) gọi uia_click(process:'msedge', role:'slider', slider_value:<giây>, content_only:true); tua thêm/lùi dùng slider_delta:<+/-giây>; tua giữa dùng click_ratio:0.5. Không đoán tọa độ. Đọc slider_seek.after_text báo lại.",
  youtubeSelect:
    "- Chọn video trên tab đang mở (KHÔNG mở tab mới): dùng list_windows('msedge') kiểm tra, nếu chưa ở YouTube thì uia_click(role:'tab', name:'YouTube'). Chọn theo tên: uia_click(process:'msedge', name:'<tên>', content_only:true). Chọn thứ N từ trái sang: uia_click(process:'msedge', role:'video', content_only:true, index:<N-1>). Chọn theo HÌNH ẢNH: gọi delegate_deep_task chụp desktop_screenshot.",
  quizForm:
    "- Làm trắc nghiệm/form: (1) uia_read(process:'msedge', content_only:true, include_controls:true, max_items:250, max_chars:18000) (trang dài dùng scroll_window đọc tiếp); (2) dùng uia_click(process:'msedge', steps:[...]) truyền runtime_id (+ text & clear_first:true với EDIT); (3) KHÔNG tự bấm Nộp bài nếu không yêu cầu rõ.",
};

export function selectInstructionForPrompt(text = "", { isVoice = false } = {}) {
  const low = String(text || "").toLowerCase();
  const parts = [CORE_INSTRUCTION_VI];
  if (isVoice || /discord|mic|micro|tắt âm|mute|deafen/.test(low)) {
    parts.push(DOMAIN_PROMPTS.discordMic);
  }
  if (isVoice || /tua|slider|giờ|tiếng|phút|giây|giữa|phụ đề|tạm dừng/.test(low)) {
    parts.push(DOMAIN_PROMPTS.videoSlider);
  }
  if (isVoice || /video|youtube|hình|ảnh|kênh|chọn|bấm/.test(low)) {
    parts.push(DOMAIN_PROMPTS.youtubeSelect);
  }
  if (/trắc nghiệm|tự luận|đọc và làm|điền|form|bài tập|câu hỏi|nộp bài/.test(low)) {
    parts.push(DOMAIN_PROMPTS.quizForm);
  } else if (isVoice) {
    parts.push("- Làm trắc nghiệm/form: uia_read(include_controls:true) rồi điền bằng uia_click(steps:[{runtime_id,text,clear_first:true}]).");
  }
  return parts.join("\n");
}

const SYSTEM_INSTRUCTION_VI = [
  CORE_INSTRUCTION_VI,
  DOMAIN_PROMPTS.discordMic,
  DOMAIN_PROMPTS.videoSlider,
  DOMAIN_PROMPTS.youtubeSelect,
  DOMAIN_PROMPTS.quizForm,
].join("\n");

/**
 * Clean JSON schema object for Gemini tool declarations.
 */
export function sanitizeSchema(schema) {
  if (!schema || typeof schema !== "object") {
    return { type: "object", properties: {} };
  }
  const copy = {};
  if (schema.type) copy.type = schema.type;
  if (schema.description) copy.description = schema.description;
  if (Array.isArray(schema.enum)) copy.enum = schema.enum;
  if (Array.isArray(schema.required)) copy.required = schema.required;
  if (schema.properties && typeof schema.properties === "object") {
    copy.properties = {};
    for (const [k, v] of Object.entries(schema.properties)) {
      copy.properties[k] = sanitizeSchema(v);
    }
  }
  if (schema.items && typeof schema.items === "object") {
    copy.items = sanitizeSchema(schema.items);
  }
  return copy;
}

const CUSTOM_HUB_SCHEMAS = {
  delegate_deep_task: {
    name: "delegate_deep_task",
    description:
      "Delegate complex multi-step tasks (agent-desktop snapshot/screenshot/drag-drop/notifications/clipboard, Playwright public web scraping, reading/writing files inside C:\\AI-Sandbox, or generating formatted .docx/.csv reports) to the background Gemini agent.",
    schema: {
      type: "object",
      properties: {
        goal: { type: "string", description: "Clear task instruction in Vietnamese or English" },
        speak_summary: { type: "boolean", description: "True if user wants the final summary read aloud" },
      },
      required: ["goal"],
    },
  },
  speak_aloud: {
    name: "speak_aloud",
    description:
      "Enable spoken audio reply for this turn. Call ONLY when the user explicitly asks to speak or read aloud ('nói cho tôi nghe', 'đọc lên', 'trả lời bằng giọng nói').",
    schema: {
      type: "object",
      properties: {
        speak: { type: "boolean" },
      },
      required: ["speak"],
    },
  },
  sleep_hub: {
    name: "sleep_hub",
    description:
      "Hide Jarvis Desktop Hub to the Windows System Tray when the user says 'Jarvis sleep', 'sleep', 'ngủ đi Jarvis', 'ẩn Jarvis xuống khay'.",
    schema: {
      type: "object",
      properties: {},
    },
  },
};

export function buildLiveTools(fastDesktopTools, includeSearch = true) {
  const declarations = fastDesktopTools.map((t) => ({
    name: t.name,
    description: t.description || t.name,
    behavior: "NON_BLOCKING",
    parametersJsonSchema: sanitizeSchema(t.inputSchema),
  }));

  for (const extra of Object.values(CUSTOM_HUB_SCHEMAS)) {
    declarations.push({
      name: extra.name,
      description: extra.description,
      behavior: "NON_BLOCKING",
      parametersJsonSchema: extra.schema,
    });
  }

  const tools = [{ functionDeclarations: declarations }];
  if (includeSearch) {
    tools.unshift({ googleSearch: {} });
  }
  return tools;
}

export function buildInteractionsTools(toolPairs, includeDelegate = true, includeSleep = false) {
  const tools = toolPairs.map(({ tool }) => ({
    type: "function",
    name: tool.name,
    description: tool.description || tool.name,
    parameters: sanitizeSchema(tool.inputSchema),
  }));
  if (includeDelegate) {
    const d = CUSTOM_HUB_SCHEMAS.delegate_deep_task;
    tools.push({
      type: "function",
      name: d.name,
      description: d.description,
      parameters: d.schema,
    });
  }
  if (includeSleep) {
    const s = CUSTOM_HUB_SCHEMAS.sleep_hub;
    tools.push({
      type: "function",
      name: s.name,
      description: s.description,
      parameters: s.schema,
    });
  }
  return tools;
}

export function isSleepCommandText(text) {
  const raw = String(text || "").trim();
  if (!raw) return false;
  return /^(?:hey\s+)?(?:jarvis\s+sleep|sleep(?:\s+jarvis)?|ngủ\s*đi(?:\s+jarvis)?|jarvis\s+ngủ(?:\s*đi)?|tạm\s+ẩn\s+jarvis|ẩn\s+jarvis(?:\s+xuống\s+khay)?)[.!?]?$/iu.test(
    raw
  );
}

const ONE_SHOT_ACTION_TOOLS = new Set([
  "open_edge_url",
  "launch_app",
  "close_app",
  "window_control",
  "scroll_window",
  "send_hotkey",
  "set_brightness",
  "manage_edge_tabs",
  "export_document",
  "open_path",
]);

export function isCleanOneShotSuccess(callName, out) {
  if (!ONE_SHOT_ACTION_TOOLS.has(callName)) return false;
  if (!out || out.error || out.cancelled_by_user) return false;
  if (callName === "close_app") {
    return out.already_closed === true || out.remaining_count === 0;
  }
  if (callName === "open_edge_url") {
    return out.focused !== false;
  }
  if (callName === "launch_app") {
    return out.already_running === true || out.window_found !== false;
  }
  return true;
}

function summarizeQuickActions(calls, results) {
  if (!calls.length) return "Đã xong.";
  const first = calls[0];
  const r = results[0] || {};
  if (first.name === "open_edge_url") {
    const urls = Array.isArray(r.urls) ? r.urls.join(", ") : "";
    return urls ? `Đã mở ${urls} trên Edge.` : "Đã mở trang trên Edge.";
  }
  if (first.name === "launch_app") return `Đã mở ${first.arguments?.app || "ứng dụng"}.`;
  if (first.name === "close_app") return `Đã đóng ${first.arguments?.app || "ứng dụng"}.`;
  if (first.name === "window_control") return `Đã cập nhật cửa sổ (${first.arguments?.action || "xong"}).`;
  if (first.name === "set_brightness") return `Đã chỉnh độ sáng màn hình còn ${r.brightness ?? "?"}%.`;
  if (first.name === "send_hotkey") return `Đã thực thi phím (${first.arguments?.combo || "xong"}).`;
  if (first.name === "manage_edge_tabs") {
    if (first.arguments?.action === "close_others") {
      return `Đã giữ lại tab ${r.kept_tab || "đang xem"} và đóng ${r.closed_count ?? 0} tab khác.`;
    }
    return "Đã cập nhật tab Edge.";
  }
  if (first.name === "scroll_window") return "Đã cuộn trang.";
  return "Đã thực hiện xong.";
}

function userExplicitlyWantsVoice(text) {
  return /\b(đọc lên|đọc to|đọc giúp|đọc cho|nói cho|nói nghe|nói đi|trả lời bằng giọng|giọng nói|read aloud|speak)\b/i.test(
    String(text || "")
  );
}

function extractInteractionText(response) {
  if (typeof response?.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }
  if (typeof response?.outputText === "string" && response.outputText.trim()) {
    return response.outputText.trim();
  }
  const chunks = [];
  for (const step of response?.steps || []) {
    if (step?.type === "model_output" && Array.isArray(step.content)) {
      for (const c of step.content) {
        if (c?.type === "text" && c.text) chunks.push(c.text);
      }
    }
  }
  return chunks.join("\n").trim();
}

export class GeminiAgent {
  constructor({ mcpHub, onHudEvent }) {
    this.mcpHub = mcpHub;
    this.onHudEvent = onHudEvent;
    this.voiceReplyAlways = false;
    this.session = null;
    this.sessionConnecting = null;
    this.speakThisTurn = false;
    this.pendingAudioChunks = [];
    this.currentUserTranscript = "";
    this.currentModelTranscript = "";
    this.deepChain = null;
    this.turnEpoch = 0;
    this.uiaFailStreak = 0;
    this.seenToolCalls = new Map();
    this.activeToolCallsCount = 0;
    this.activeKeyIndex = 0;
    this.lastActiveModel = FAST_LLM_MODEL;
    this.hasVerifiedFastModel = false;
    this.modelCooldownUntil = new Map();
    this.recentTurns = [];
    this.installedApps = discoverInstalledAppNamesSync(65);
    discoverAllInstalledAppsAsync(65)
      .then((list) => {
        if (Array.isArray(list) && list.length > 0) this.installedApps = list;
      })
      .catch(() => {});
  }

  recordRecentTurn(userText, assistantText) {
    const u = String(userText || "").trim().slice(0, 120);
    const a = String(assistantText || "").trim().slice(0, 100);
    if (!u) return;
    this.recentTurns.push({ user: u, assistant: a });
    if (this.recentTurns.length > 3) {
      this.recentTurns.shift();
    }
  }

  buildContextualPrompt(cleanPrompt, { isVoice = false } = {}) {
    const sysInst = selectInstructionForPrompt(cleanPrompt, { isVoice });
    const needAppsList =
      isVoice || /mở|bật|chạy|khởi động|tắt|đóng|thoát|ẩn|thu nhỏ|phóng|dời|màn hình|app|ứng dụng/i.test(cleanPrompt);
    const appSlice = isVoice ? (this.installedApps || []).slice(0, 35) : (this.installedApps || []).slice(0, 50);
    const appsLine =
      needAppsList && appSlice.length > 0 ? `\nApp trên máy: ${appSlice.join(", ")}.` : "";
    if (!this.recentTurns.length) {
      return `${sysInst}${appsLine}\n\nYêu cầu:\n${cleanPrompt}`;
    }
    const ctxLines = this.recentTurns
      .map((t, idx) => `${idx + 1}. "${t.user}" -> "${t.assistant}"`)
      .join("\n");
    return `${sysInst}${appsLine}\n\nLượt trước:\n${ctxLines}\n\nYêu cầu hiện tại:\n${cleanPrompt}`;
  }

  abortQuietlyForWakeReset() {
    this.turnEpoch++;
    this.uiaFailStreak = 0;
    this.activeToolCallsCount = 0;
    this.seenToolCalls.clear();
    this.resetTurnBuffers();
    this.closeLive();
  }

  warmupConnection() {
    try {
      fetch("https://generativelanguage.googleapis.com/", { method: "HEAD" }).catch(() => {});
    } catch {}
  }

  stopCurrentTurn() {
    this.turnEpoch++;
    this.uiaFailStreak = 0;
    this.activeToolCallsCount = 0;
    this.seenToolCalls.clear();
    this.resetTurnBuffers();
    this.closeLive();
    this.onHudEvent?.({ type: "turn_stopped" });
  }

  cancelTurnOnDenial(toolName) {
    this.turnEpoch++;
    this.uiaFailStreak = 0;
    this.activeToolCallsCount = 0;
    this.seenToolCalls.clear();
    this.resetTurnBuffers();
    this.closeLive();
    this.onHudEvent?.({
      type: "turn_cancelled",
      toolName,
      message: `Đã hủy "${toolName}" — không thử lại.`,
    });
  }

  async executeGuardedTool(serverKey, toolName, rawArgs = {}, epoch = this.turnEpoch) {
    if (epoch !== this.turnEpoch) {
      return { cancelled_by_user: true, error: "Người dùng đã bấm dừng." };
    }

    const args = { ...(rawArgs || {}) };
    // Strip redundant new_tab: true when an explicit URL or search query is given
    if (toolName === "open_edge_url") {
      if (args.url || args.youtube_search || args.google_search) {
        delete args.new_tab;
      }
      if (
        args.youtube_search &&
        /^(youtube|ytb|youtube\.com|trang\s*chủ(?:\s*youtube)?|home)$/i.test(String(args.youtube_search).trim())
      ) {
        delete args.youtube_search;
        if (!args.url) args.url = "https://www.youtube.com";
      }
    }

    const sig = `${serverKey}:${toolName}:${JSON.stringify(args)}`;
    const seen = (this.seenToolCalls.get(sig) || 0) + 1;
    this.seenToolCalls.set(sig, seen);
    if (seen > 2) {
      return {
        error: `Đã chặn lệnh lặp lại "${toolName}" để chống spam.`,
        STOP_RETRY: true,
        hint: "Dừng gọi lại lệnh giống nhau và báo gọn trạng thái cho người dùng.",
      };
    }

    if (toolName === "uia_click" && this.uiaFailStreak >= 2) {
      return {
        error: "Đã chặn uia_click sau 2 lần tìm thất bại liên tiếp để tránh spam.",
        STOP_RETRY: true,
        hint: "Dùng uia_read hoặc uia_click(dry_run: true) để đọc màn hình trước, hoặc báo cho người dùng biết.",
      };
    }

    try {
      const result = await this.mcpHub.executeTool(serverKey, toolName, args);
      if (result?.cancelled_by_user) {
        this.cancelTurnOnDenial(toolName);
        return { cancelled_by_user: true, STOP_RETRY: true };
      }
      if (epoch !== this.turnEpoch) {
        return { cancelled_by_user: true, error: "Người dùng đã bấm dừng." };
      }
      if (toolName === "uia_click") {
        this.uiaFailStreak = 0;
      }
      return result;
    } catch (err) {
      if (toolName === "uia_click") {
        this.uiaFailStreak++;
        return {
          error: err.message,
          uia_failures_in_turn: this.uiaFailStreak,
          hint:
            this.uiaFailStreak >= 2
              ? "ĐÃ THẤT BẠI 2 LẦN: KHÔNG đoán tiếp với uia_click. Hãy dùng uia_read(process: 'msedge', max_items: 45) hoặc dừng báo người dùng."
              : "Đừng đoán lại cùng tên. Hãy gọi uia_read hoặc uia_click(role: 'link', content_only: true, dry_run: true, limit: 12) để xem tên thật trên màn hình.",
        };
      }
      throw err;
    }
  }

  getApiClient(apiVersion = null, explicitKey = null) {
    const key = explicitKey || resolveGeminiApiKey();
    if (!key) {
      throw new Error(
        "Chưa tìm thấy GEMINI_API_KEY trong biến môi trường Windows hoặc file .env."
      );
    }
    const opts = { apiKey: key };
    if (apiVersion) {
      opts.apiVersion = apiVersion;
      opts.httpOptions = { apiVersion };
    }
    return new GoogleGenAI(opts);
  }

  /**
   * Multi-Key + Multi-Model Cascade for interactions.create.
   * Automatically rotates across backup API keys and fallback models when 429/Quota or timeout occurs.
   */
  async createInteractionWithFallback({
    input,
    tools,
    models = FALLBACK_MODELS,
    apiVersion = null,
    extraParams = {},
    timeoutMs = 15000,
  }) {
    const keys = resolveGeminiApiKeys();
    if (keys.length === 0) {
      throw new Error("Chưa tìm thấy GEMINI_API_KEY.");
    }

    const now = Date.now();
    let lastError = null;
    for (let kOffset = 0; kOffset < keys.length; kOffset++) {
      const kIdx = (this.activeKeyIndex + kOffset) % keys.length;
      const apiKey = keys[kIdx];
      const ai = this.getApiClient(apiVersion, apiKey);

      const healthy = models.filter((m) => (this.modelCooldownUntil.get(`${kIdx}:${m}`) || 0) <= now);
      const cooled = models.filter((m) => (this.modelCooldownUntil.get(`${kIdx}:${m}`) || 0) > now);
      if (this.hasVerifiedFastModel && healthy.includes(this.lastActiveModel)) {
        healthy.sort((a, b) => (a === this.lastActiveModel ? -1 : b === this.lastActiveModel ? 1 : 0));
      }
      const orderedModels = [...healthy, ...cooled];

      for (const modelName of orderedModels) {
        const cdKey = `${kIdx}:${modelName}`;
        try {
          const payload = {
            model: modelName,
            input,
            ...extraParams,
          };
          if (tools && tools.length > 0) {
            payload.tools = tools;
          }
          const res = await Promise.race([
            ai.interactions.create(payload),
            new Promise((_, rej) =>
              setTimeout(() => rej(new Error(`Timeout after ${timeoutMs}ms on ${modelName}`)), timeoutMs)
            ),
          ]);
          this.activeKeyIndex = kIdx;
          this.lastActiveModel = modelName;
          this.hasVerifiedFastModel = true;
          this.modelCooldownUntil.delete(cdKey);
          return { response: res, modelUsed: modelName, keyIndex: kIdx + 1, totalKeys: keys.length };
        } catch (err) {
          lastError = err;
          const isQuota = isQuotaOrNetworkError(err);
          this.modelCooldownUntil.set(cdKey, Date.now() + (isQuota ? 300_000 : 120_000));
          if (!isQuota) {
            // Non-quota error (e.g., timeout or model mismatch): try next model in cascade
            continue;
          }
          // Quota / 429 error: notify HUD briefly and try next model / next key
          this.onHudEvent?.({
            type: "status",
            state: "thinking",
            detail: `Model ${modelName} (Key #${kIdx + 1}) chạm giới hạn token — đang chuyển sang dự phòng...`,
          });
        }
      }
    }
    throw lastError || new Error("Tất cả API Key và Model đều đã hết hạn mức token.");
  }

  setVoiceReplyAlways(enabled) {
    this.voiceReplyAlways = Boolean(enabled);
  }

  async speakViaLiveSession(text) {
    const clean = String(text || "").trim();
    if (!clean) return;
    const clipped = clean.length > 1400 ? `${clean.slice(0, 1400)}...` : clean;
    const sess = await this.ensureLiveSession();
    this.flushAudioGateOn();
    sess.sendClientContent({
      turns: `Hãy đọc to nguyên văn nội dung sau bằng giọng tiếng Việt tự nhiên, rõ ràng (không thêm bình luận): ${clipped}`,
      turnComplete: true,
    });
  }

  async synthesizeSpeech(text) {
    const clean = String(text || "").trim();
    if (!clean) return null;
    const clipped = clean.length > 1500 ? `${clean.slice(0, 1500)}...` : clean;
    const keys = resolveGeminiApiKeys();
    for (const apiKey of keys) {
      const ai = this.getApiClient("v1beta", apiKey);
      for (const ttsModel of [TTS_MODEL, "gemini-3.8-flash-lite-tts"]) {
        try {
          const interaction = await ai.interactions.create({
            model: ttsModel,
            input: [
              {
                type: "user_input",
                content: [
                  {
                    type: "text",
                    text: clipped,
                    annotations: [
                      {
                        type: "speech_metadata",
                        style: "clear, concise, natural Vietnamese assistant",
                      },
                    ],
                  },
                ],
              },
            ],
            response_format: { type: "audio" },
            generation_config: {
              speech_config: [{ voice: "Kore" }],
            },
          });
          if (interaction?.output_audio?.data) {
            return interaction.output_audio.data;
          }
        } catch {}
      }
    }

    // Fallback: stream directly through the live audio session
    await this.speakViaLiveSession(clipped);
    return "__STREAMED_VIA_LIVE__";
  }

  async runDeepTask(goal, epoch = this.turnEpoch) {
    const deepPairs = await this.mcpHub.getDeepTaskTools();
    const serverByTool = new Map(deepPairs.map((p) => [p.tool.name, p.serverKey]));
    const tools = buildInteractionsTools(deepPairs, false);

    const deepPrompt = selectInstructionForPrompt(goal, { isVoice: false });
    const needHighRes = /đọc|chữ|trắc nghiệm|tự luận|điền|ocr|nhỏ|text|chi tiết/i.test(String(goal || ""));
    const history = [
      {
        type: "user_input",
        content: [{ type: "text", text: `${deepPrompt}\n\nNhiệm vụ cần xử lý kỹ:\n${goal}` }],
      },
    ];

    let hasLiveImageInHistory = false;
    for (let iter = 0; iter < 8; iter++) {
      if (epoch !== this.turnEpoch) {
        return "Đã dừng xử lý theo yêu cầu.";
      }
      const { response } = await this.createInteractionWithFallback({
        input: history,
        tools,
        apiVersion: "v1beta",
        extraParams: { store: false, generation_config: { thinking_level: "low" } },
        timeoutMs: hasLiveImageInHistory ? 24000 : 16000,
      });
      if (epoch !== this.turnEpoch) {
        return "Đã dừng xử lý theo yêu cầu.";
      }
      if (Array.isArray(response?.steps)) {
        history.push(...response.steps);
      }

      const calls = (response?.steps || []).filter((s) => s.type === "function_call");
      if (calls.length === 0) {
        return extractInteractionText(response) || "Đã hoàn thành tác vụ nền.";
      }

      for (const call of calls) {
        if (epoch !== this.turnEpoch) {
          return "Đã dừng xử lý theo yêu cầu.";
        }
        let out;
        try {
          const serverKey = serverByTool.get(call.name) || "fastDesktop";
          out = await this.executeGuardedTool(serverKey, call.name, call.arguments || {}, epoch);
        } catch (err) {
          out = { error: err.message };
        }
        if (out?.cancelled_by_user || epoch !== this.turnEpoch) {
          return "Đã hủy thao tác theo yêu cầu.";
        }
        const images = Array.isArray(out?.__mcpImages) ? out.__mcpImages : [];
        let cleanOut = out;
        if (out && typeof out === "object" && "__mcpImages" in out) {
          const { __mcpImages: _drop, ...rest } = out;
          cleanOut = rest;
        }
        if (images.length > 0) {
          // Prune older screenshots from prior turns so payload stays light
          for (const hStep of history) {
            if (hStep?.type === "function_result" && Array.isArray(hStep.result)) {
              hStep.result = hStep.result.map((sub) =>
                sub?.type === "image" ? { type: "text", text: "[Ảnh chụp màn hình ở bước trước]" } : sub
              );
            }
          }
          hasLiveImageInHistory = true;
          history.push({
            type: "function_result",
            name: call.name,
            call_id: call.id,
            result: [
              { type: "text", text: JSON.stringify(cleanOut) },
              ...images.map((img) => ({
                type: "image",
                data: img.data,
                mime_type: img.mimeType || "image/png",
                resolution: needHighRes ? "high" : "medium",
              })),
            ],
          });
        } else {
          hasLiveImageInHistory = false;
          history.push({
            type: "function_result",
            name: call.name,
            call_id: call.id,
            result: JSON.stringify(cleanOut),
          });
        }
      }
    }
    return "Đã đạt giới hạn 8 bước xử lý tự động cho tác vụ này.";
  }

  async runTextTurn(prompt, sharedEpoch = null) {
    const cleanPrompt = String(prompt || "").trim();
    if (!cleanPrompt) return { text: "", audioWavBase64: null };

    if (isSleepCommandText(cleanPrompt)) {
      return { text: "Đã ẩn Jarvis xuống khay.", hubSleep: true, audioWavBase64: null };
    }

    const epoch = sharedEpoch !== null ? sharedEpoch : ++this.turnEpoch;
    this.uiaFailStreak = 0;
    this.seenToolCalls.clear();

    const fastHit = await tryInstantFastPath(cleanPrompt, (srv, name, args) =>
      this.executeGuardedTool(srv, name, args, epoch)
    ).catch(() => ({ handled: false }));
    if (fastHit?.cancelled || epoch !== this.turnEpoch) {
      return { cancelled: true, text: "Đã hủy.", audioWavBase64: null };
    }
    if (fastHit?.handled) {
      this.recordRecentTurn(cleanPrompt, fastHit.text);
      let audioWavBase64 = null;
      if (this.voiceReplyAlways || userExplicitlyWantsVoice(cleanPrompt)) {
        try {
          audioWavBase64 = await this.synthesizeSpeech(fastHit.text);
        } catch {}
      }
      return { text: fastHit.text, modelLabel: "⚡ Fast-Path (<50ms)", audioWavBase64 };
    }

    const fastTools = this.mcpHub.getFastDesktopTools().map((tool) => ({ serverKey: "fastDesktop", tool }));
    const tools = buildInteractionsTools(fastTools, true, true);

    const history = [
      {
        type: "user_input",
        content: [{ type: "text", text: this.buildContextualPrompt(cleanPrompt) }],
      },
    ];

    let finalText = "";
    let modelLabel = "⚡ Gemini 3.5 Flash-Lite";
    try {
      for (let iter = 0; iter < 10; iter++) {
        if (epoch !== this.turnEpoch) {
          return { cancelled: true, text: "Đã dừng.", audioWavBase64: null };
        }
        const { response, modelUsed, keyIndex, totalKeys } = await this.createInteractionWithFallback({
          input: history,
          tools,
          apiVersion: "v1beta",
          extraParams: { store: false, generation_config: { thinking_level: "low" } },
          timeoutMs: 8500,
        });
        modelLabel =
          totalKeys > 1
            ? `⚡ ${modelUsed} (Key #${keyIndex})`
            : `⚡ ${modelUsed}`;

        if (epoch !== this.turnEpoch) {
          return { cancelled: true, text: "Đã dừng.", audioWavBase64: null };
        }
        if (Array.isArray(response?.steps)) {
          history.push(...response.steps);
        }

        const calls = (response?.steps || []).filter((s) => s.type === "function_call");
        if (calls.length === 0) {
          finalText = extractInteractionText(response);
          break;
        }

        const toolOutputs = [];
        for (const call of calls) {
          if (epoch !== this.turnEpoch) {
            return { cancelled: true, text: "Đã dừng.", audioWavBase64: null };
          }
          let out;
          try {
            if (call.name === "sleep_hub") {
              return { text: "Đã ẩn Jarvis xuống khay.", hubSleep: true, audioWavBase64: null };
            } else if (call.name === "delegate_deep_task") {
              this.onHudEvent?.({ type: "status", state: "thinking", detail: "Đang chạy tác vụ sâu..." });
              out = { summary: await this.runDeepTask(call.arguments?.goal || cleanPrompt, epoch) };
            } else {
              out = await this.executeGuardedTool("fastDesktop", call.name, call.arguments || {}, epoch);
            }
          } catch (err) {
            out = { error: err.message };
          }
          if (out?.cancelled_by_user || epoch !== this.turnEpoch) {
            return { cancelled: true, text: "Đã hủy.", audioWavBase64: null };
          }
          toolOutputs.push(out);
          history.push({
            type: "function_result",
            name: call.name,
            call_id: call.id,
            result: JSON.stringify(out),
          });
        }

        // Fast-finish optimization: skip Turn-2 confirmation LLM call only when every one-shot tool truly succeeded
        const allSucceededOneShot =
          calls.length >= 1 &&
          calls.every((c, idx) => isCleanOneShotSuccess(c.name, toolOutputs[idx])) &&
          !/[?？]|(?<![\p{L}\p{N}_])(?:rồi|và|sau\s*đó|tóm\s*tắt|đọc|chọn\s*video|bao\s*nhiêu)(?![\p{L}\p{N}_])/iu.test(cleanPrompt);
        if (allSucceededOneShot) {
          finalText = summarizeQuickActions(calls, toolOutputs);
          break;
        }
      }
    } catch (apiErr) {
      // Zero-Token Offline Fallback Engine when all API keys/models hit quota or network is down
      const localRes = await tryLocalFallbackCommand(cleanPrompt, (srv, name, args) =>
        this.executeGuardedTool(srv, name, args, epoch)
      );
      if (localRes.cancelled || epoch !== this.turnEpoch) {
        return { cancelled: true, text: "Đã hủy.", audioWavBase64: null };
      }
      if (localRes.handled) {
        return {
          text: localRes.text,
          modelLabel: "🛡️ Dự phòng Offline (0 Token)",
          audioWavBase64: null,
        };
      }
      throw apiErr;
    }

    if (epoch !== this.turnEpoch) {
      return { cancelled: true, text: "Đã dừng.", audioWavBase64: null };
    }
    if (!finalText) {
      finalText = "Đã xử lý xong.";
    }
    this.recordRecentTurn(cleanPrompt, finalText);

    let audioWavBase64 = null;
    if (this.voiceReplyAlways || userExplicitlyWantsVoice(cleanPrompt)) {
      try {
        audioWavBase64 = await this.synthesizeSpeech(finalText);
      } catch {}
    }

    return { text: finalText, modelLabel, audioWavBase64 };
  }

  /**
   * Fast & Smart 1-Hop Vietnamese Voice Execution (~1.9s end-to-end).
   * Avoids gemini-3.5-transcribe (25 RPD Free Tier limit causes 11s+ 429 stalls)
   * and feeds WAV directly to gemini-3.5-flash-lite with thinking_level: "low",
   * verified 1-turn fast-finish (isCleanOneShotSuccess), and contextual vocabulary.
   */
  async runVoiceWavTurn(wavBase64, hintTranscript = "") {
    const cleanHint = String(hintTranscript || "").trim();
    if (!wavBase64) {
      if (cleanHint) return this.runTextTurn(cleanHint);
      return { ok: false, error: "Không thu được âm thanh." };
    }
    if (cleanHint) {
      return this.runTextTurn(cleanHint);
    }

    const epoch = ++this.turnEpoch;
    this.uiaFailStreak = 0;
    this.seenToolCalls.clear();

    const fastTools = this.mcpHub.getFastDesktopTools().map((tool) => ({ serverKey: "fastDesktop", tool }));
    const tools = buildInteractionsTools(fastTools, true, true);

    const voicePrompt = this.buildContextualPrompt(
      [
        "[LỆNH GIỌNG NÓI TIẾNG VIỆT]",
        `Từ khóa hay dùng: ${VIETNAMESE_CUSTOM_VOCABULARY.slice(0, 32).join(", ")}.`,
        "- Nghe lệnh tiếng Việt và gọi NGAY function_call phù hợp. Nếu 'Jarvis sleep'/'ngủ đi Jarvis'/'ẩn Jarvis' -> gọi sleep_hub().",
        "- KHÔNG tự bịa thêm youtube_search nếu người nói không đọc từ khóa. Nếu im lặng/tạp âm -> chỉ trả đúng 1 từ: SILENT.",
      ].join("\n"),
      { isVoice: true }
    );

    const history = [
      {
        type: "user_input",
        content: [
          { type: "text", text: voicePrompt },
          { type: "audio", data: wavBase64, mime_type: "audio/wav" },
        ],
      },
    ];

    const voiceModels = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.8-flash"];
    let finalText = "";
    let modelLabel = "🎙️ Gemini 3.5 Flash-Lite";

    for (let iter = 0; iter < 10; iter++) {
      if (epoch !== this.turnEpoch) {
        return { cancelled: true, text: "Đã dừng.", audioWavBase64: null };
      }
      const { response, modelUsed, keyIndex, totalKeys } = await this.createInteractionWithFallback({
        models: voiceModels,
        apiVersion: "v1beta",
        input: history,
        tools,
        extraParams: { store: false, generation_config: { thinking_level: "low" } },
        timeoutMs: 8500,
      });
      modelLabel = totalKeys > 1 ? `🎙️ ${modelUsed} (Key #${keyIndex})` : `🎙️ ${modelUsed}`;

      if (epoch !== this.turnEpoch) {
        return { cancelled: true, text: "Đã dừng.", audioWavBase64: null };
      }
      if (Array.isArray(response?.steps)) {
        history.push(...response.steps);
      }

      const calls = (response?.steps || []).filter((s) => s.type === "function_call");
      if (calls.length === 0) {
        finalText = extractInteractionText(response);
        if (iter === 0 && finalText && !/^(SILENT|IM LẶNG|NONE|EMPTY)\.?$/i.test(finalText.trim())) {
          if (isSleepCommandText(finalText)) {
            return { text: "Đã ẩn Jarvis xuống khay.", hubSleep: true, audioWavBase64: null };
          }
          const localHit = await tryLocalFallbackCommand(finalText, (srv, name, args) =>
            this.executeGuardedTool(srv, name, args, epoch)
          ).catch(() => ({ handled: false }));
          if (localHit?.cancelled || epoch !== this.turnEpoch) {
            return { cancelled: true, text: "Đã hủy.", audioWavBase64: null };
          }
          if (localHit?.handled) {
            finalText = localHit.text.replace(/^\[Chế độ Dự phòng Offline\]\s*/i, "");
          }
        }
        break;
      }

      const toolOutputs = [];
      for (const call of calls) {
        if (epoch !== this.turnEpoch) {
          return { cancelled: true, text: "Đã dừng.", audioWavBase64: null };
        }
        let out;
        try {
          if (call.name === "sleep_hub") {
            return { text: "Đã ẩn Jarvis xuống khay.", hubSleep: true, audioWavBase64: null };
          } else if (call.name === "delegate_deep_task") {
            this.onHudEvent?.({ type: "status", state: "thinking", detail: "Đang chạy tác vụ sâu..." });
            out = { summary: await this.runDeepTask(call.arguments?.goal || "Xử lý tác vụ", epoch) };
          } else {
            out = await this.executeGuardedTool("fastDesktop", call.name, call.arguments || {}, epoch);
          }
        } catch (err) {
          out = { error: err.message };
        }
        if (out?.cancelled_by_user || epoch !== this.turnEpoch) {
          return { cancelled: true, text: "Đã hủy.", audioWavBase64: null };
        }
        toolOutputs.push(out);
        history.push({
          type: "function_result",
          name: call.name,
          call_id: call.id,
          result: JSON.stringify(out),
        });
      }

      const allSucceededOneShot =
        calls.length >= 1 && calls.every((c, idx) => isCleanOneShotSuccess(c.name, toolOutputs[idx]));
      if (allSucceededOneShot) {
        finalText = summarizeQuickActions(calls, toolOutputs);
        break;
      }
    }

    if (epoch !== this.turnEpoch) {
      return { cancelled: true, text: "Đã dừng.", audioWavBase64: null };
    }
    if (!finalText || /^(SILENT|IM LẶNG|NONE|EMPTY)\.?$/i.test(finalText.trim())) {
      return { emptyVoice: true, text: "" };
    }

    this.recordRecentTurn(`[Voice] ${finalText.slice(0, 60)}`, finalText);

    let audioWavBase64 = null;
    if (this.voiceReplyAlways || userExplicitlyWantsVoice(finalText)) {
      try {
        audioWavBase64 = await this.synthesizeSpeech(finalText);
      } catch {}
    }

    return { text: finalText, modelLabel, audioWavBase64 };
  }

  async ensureLiveSession() {
    if (this.session) return this.session;
    if (this.sessionConnecting) return this.sessionConnecting;

    this.sessionConnecting = (async () => {
      const fastTools = this.mcpHub.getFastDesktopTools();
      const keys = resolveGeminiApiKeys();
      if (keys.length === 0) {
        throw new Error("Chưa tìm thấy GEMINI_API_KEY.");
      }

      const connectWithTools = async (apiKey, apiVersion, includeSearch) => {
        const ai = this.getApiClient(apiVersion, apiKey);
        const tools = buildLiveTools(fastTools, includeSearch);
        let opened = false;
        return ai.live.connect({
          model: LIVE_MODEL,
          config: {
            responseModalities: ["AUDIO"],
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION_VI }] },
            tools,
          },
          callbacks: {
            onopen: () => {
              opened = true;
              this.onHudEvent?.({ type: "live_state", connected: true });
            },
            onmessage: (msg) => this.handleLiveMessage(msg),
            onerror: (err) => {
              if (opened) {
                this.onHudEvent?.({
                  type: "error",
                  message: err?.message || "Lỗi kết nối Gemini Live.",
                });
              }
            },
            onclose: () => {
              this.session = null;
              this.onHudEvent?.({ type: "live_state", connected: false });
            },
          },
        });
      };

      const attempts = [
        ["v1beta", true],
        ["v1beta", false],
        ["v1alpha", false],
      ];
      let lastErr = null;
      for (let kOffset = 0; kOffset < keys.length; kOffset++) {
        const kIdx = (this.activeKeyIndex + kOffset) % keys.length;
        const apiKey = keys[kIdx];
        for (const [ver, withSearch] of attempts) {
          try {
            this.session = await connectWithTools(apiKey, ver, withSearch);
            this.activeKeyIndex = kIdx;
            return this.session;
          } catch (err) {
            lastErr = err;
          }
        }
      }
      throw lastErr || new Error("Không thể kết nối Gemini Live.");
    })();

    try {
      return await this.sessionConnecting;
    } finally {
      this.sessionConnecting = null;
    }
  }

  async handleLiveMessage(message) {
    // Process toolCall FIRST so activeToolCallsCount is incremented before any serverContent.turnComplete check
    if (message?.toolCall?.functionCalls?.length) {
      const epoch = this.turnEpoch;
      const calls = message.toolCall.functionCalls;
      this.activeToolCallsCount += calls.length;
      const responses = [];
      try {
        for (const call of calls) {
          if (epoch !== this.turnEpoch) return;
          if (call.name === "speak_aloud") {
            if (call.args?.speak !== false) {
              this.flushAudioGateOn();
            }
            responses.push({
              id: call.id,
              name: call.name,
              response: { output: { ok: true, voice_enabled: this.speakThisTurn } },
            });
            continue;
          }

          if (call.name === "delegate_deep_task") {
            const goal = call.args?.goal || this.currentUserTranscript || "Xử lý tác vụ";
            const wantSpokenSummary = Boolean(call.args?.speak_summary);
            if (wantSpokenSummary) {
              this.flushAudioGateOn();
            }
            this.onHudEvent?.({ type: "status", state: "thinking", detail: "Gemini 3.8 Flash đang xử lý sâu..." });
            this.runDeepTask(goal, epoch)
              .then((summary) => {
                if (epoch !== this.turnEpoch) return;
                if (wantSpokenSummary) this.flushAudioGateOn();
                this.session?.sendToolResponse({
                  functionResponses: [{ id: call.id, name: call.name, response: { output: { summary } } }],
                });
              })
              .catch((err) => {
                if (epoch !== this.turnEpoch) return;
                this.session?.sendToolResponse({
                  functionResponses: [{ id: call.id, name: call.name, response: { error: err.message } }],
                });
              });
            continue;
          }

          let resObj;
          try {
            const result = await this.executeGuardedTool("fastDesktop", call.name, call.args || {}, epoch);
            resObj = result?.error ? result : { output: result };
          } catch (err) {
            resObj = { error: err.message };
          }
          if (epoch !== this.turnEpoch) return;
          responses.push({
            id: call.id,
            name: call.name,
            response: resObj,
          });
        }

        if (responses.length > 0 && epoch === this.turnEpoch) {
          this.session?.sendToolResponse({ functionResponses: responses });
        }
      } finally {
        if (epoch === this.turnEpoch) {
          this.activeToolCallsCount = Math.max(0, this.activeToolCallsCount - calls.length);
        }
      }
    }

    const sc = message?.serverContent;
    if (sc) {
      if (sc.inputTranscription?.text) {
        this.currentUserTranscript += sc.inputTranscription.text;
        if (userExplicitlyWantsVoice(this.currentUserTranscript)) {
          this.flushAudioGateOn();
        }
        this.onHudEvent?.({
          type: "user_transcript",
          text: this.currentUserTranscript.trim(),
        });
      }

      if (sc.outputTranscription?.text) {
        this.currentModelTranscript += sc.outputTranscription.text;
        this.onHudEvent?.({
          type: "assistant_stream",
          text: this.currentModelTranscript.trim(),
        });
      }

      if (sc.modelTurn?.parts) {
        for (const part of sc.modelTurn.parts) {
          if (part?.inlineData?.data) {
            if (this.speakThisTurn || this.voiceReplyAlways) {
              this.onHudEvent?.({ type: "audio_pcm_chunk", data: part.inlineData.data });
            } else if (this.pendingAudioChunks.length < 180) {
              this.pendingAudioChunks.push(part.inlineData.data);
            }
          } else if (part?.text) {
            this.currentModelTranscript += part.text;
            this.onHudEvent?.({
              type: "assistant_stream",
              text: this.currentModelTranscript.trim(),
            });
          }
        }
      }

      if (sc.interrupted) {
        this.pendingAudioChunks = [];
        this.onHudEvent?.({ type: "audio_clear" });
      }

      // Never emit premature turn_done while a tool call / Safe Mode confirmation is still waiting!
      if (sc.turnComplete && this.activeToolCallsCount === 0) {
        const finalAnswer = this.currentModelTranscript.trim() || "Đã xong.";
        const didSpeak = this.speakThisTurn || this.voiceReplyAlways;
        this.onHudEvent?.({
          type: "turn_done",
          userText: this.currentUserTranscript.trim(),
          text: finalAnswer,
          didSpeak,
        });
        this.resetTurnBuffers();
      }
    }
  }

  flushAudioGateOn() {
    if (!this.speakThisTurn) {
      this.speakThisTurn = true;
      for (const chunk of this.pendingAudioChunks) {
        this.onHudEvent?.({ type: "audio_pcm_chunk", data: chunk });
      }
      this.pendingAudioChunks = [];
    }
  }

  resetTurnBuffers() {
    this.speakThisTurn = false;
    this.pendingAudioChunks = [];
    this.currentUserTranscript = "";
    this.currentModelTranscript = "";
    this.uiaFailStreak = 0;
    this.seenToolCalls.clear();
  }

  async sendAudioChunk(base64Pcm16k) {
    const sess = await this.ensureLiveSession();
    sess.sendRealtimeInput({
      audio: { data: base64Pcm16k, mimeType: "audio/pcm;rate=16000" },
    });
  }

  async endAudioTurn() {
    if (!this.session) return;
    this.session.sendRealtimeInput({ audioStreamEnd: true });
  }

  closeLive() {
    if (this.session) {
      try {
        this.session.close();
      } catch {}
      this.session = null;
    }
  }
}
