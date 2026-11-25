import React, { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Link2,
  Keyboard,
  SlidersHorizontal,
  Shield,
  Zap,
  Volume2,
  VolumeX,
  Radio,
  Plus,
  X,
  Cpu,
  FolderOpen,
  Eye,
  EyeOff,
  Globe,
  Check,
  Clock,
  Trash2,
  Sparkles,
  Gamepad2,
  Monitor,
  Languages,
  Mic,
  Download,
} from "lucide-react";
import { useT } from "../i18n.js";

const LOCAL_BACKEND_URL = "http://127.0.0.1:8765";

async function getLocalBackendStatus() {
  if (window.jarvisApi?.backendRequest) {
    const data = await window.jarvisApi.backendRequest("/status", null);
    if (data && data.ok === true && typeof data.mcp_status === "object") return data;
    return null;
  }
  const resp = await fetch(`${LOCAL_BACKEND_URL}/status`);
  if (!resp.ok) return null;
  const data = await resp.json();
  return data && data.ok === true && typeof data.mcp_status === "object" ? data : null;
}

async function postLocalBackend(endpoint, body = null) {
  if (window.jarvisApi?.backendRequest) {
    const data = await window.jarvisApi.backendRequest(endpoint, body === null ? {} : body);
    const ok = Boolean(data && !data.__httpError && !data.__timeout && data.ok !== false);
    return {
      ok,
      status: data?.__httpError || (ok ? 200 : 500),
      json: async () => data,
    };
  }
  const buildOpts = (tok) => {
    const headers = {};
    if (body !== null) headers["Content-Type"] = "application/json";
    if (tok) headers["X-Jarvis-Token"] = tok;
    return {
      method: "POST",
      headers,
      body: body !== null ? JSON.stringify(body) : undefined,
    };
  };
  let token = (await window.jarvisApi?.getBackendToken?.().catch(() => "")) || "";
  let resp = await fetch(`${LOCAL_BACKEND_URL}${endpoint}`, buildOpts(token));
  if (resp.status === 401) {
    token = (await window.jarvisApi?.getBackendToken?.().catch(() => "")) || "";
    resp = await fetch(`${LOCAL_BACKEND_URL}${endpoint}`, buildOpts(token));
  }
  return resp;
}

const TABS = [
  { id: "ai", label: "AI & VRAM", Icon: Cpu },
  { id: "general", label: "Chung", Icon: SlidersHorizontal },
  { id: "pair", label: "Kết nối", Icon: Link2 },
  { id: "shortcuts", label: "Phím & Từ", Icon: Keyboard },
];

const LOCAL_MODELS = [
  { id: "0.6b", short: "0.6B Fast", vram: "~0.5 GB", hint: "Siêu tốc (Game Mode)" },
  { id: "1.7b", short: "1.7B Bal", vram: "~1.3 GB", hint: "Cân bằng tốc độ" },
  { id: "4b", short: "4B Smart", vram: "~3.3 GB", hint: "Thông minh + Vision" },
];

const THINKING_OPTIONS = [
  { id: "auto", label: "Tự động", hint: "Nhanh khi 1 bước · Sâu khi đa bước / đọc UI" },
  { id: "on", label: "Nghĩ sâu", hint: "Luôn bật Deep Thinking cho mọi lệnh" },
  { id: "off", label: "Tắt", hint: "Tắt suy nghĩ hoàn toàn để phản hồi nhanh nhất" },
];

const NUM_CTX_OPTIONS = [
  { id: 4096, label: "4K Nhanh", hint: "Nhẹ VRAM nhất cho lệnh điều khiển" },
  { id: 8192, label: "8K Chuẩn", hint: "Cân bằng cho GPU 6–8GB+ (Mặc định)" },
  { id: 16384, label: "16K Dài", hint: "Đọc/dịch PDF & tài liệu dài mượt hơn" },
];

const KEEP_ALIVE_OPTIONS = [
  { id: "0s", label: "0s", hint: "Xả VRAM ngay sau khi xong" },
  { id: "1m", label: "1m", hint: "Giữ AI 1 phút" },
  { id: "2m", label: "2m", hint: "Giữ AI 2 phút" },
  { id: "5m", label: "5m", hint: "Mặc định · Tự xả sau 5 phút" },
  { id: "15m", label: "15m", hint: "Giữ AI 15 phút" },
  { id: "always", label: "Luôn", hint: "Ghim AI trong VRAM" },
];

const STT_ENGINE_OPTIONS = [
  {
    id: "hybrid",
    labelVi: "Hybrid (Khuyên dùng)",
    labelEn: "Hybrid (Auto)",
    hintVi: "Dùng VietNote 0 MB VRAM cho tiếng Việt/Dictation/Game & giữ Faster-Whisper cho tiếng Anh tự do",
    hintEn: "Uses VietNote 0 MB VRAM for VI/Dictation/Gaming & Faster-Whisper for open English",
  },
  {
    id: "vietnote",
    labelVi: "VietNote (0 MB)",
    labelEn: "VietNote (0 MB)",
    hintVi: "Zipformer 78M ONNX trên CPU + English Hotwords (0 MB VRAM GPU)",
    hintEn: "Zipformer 78M CPU ONNX + English Hotwords (0 MB GPU VRAM)",
  },
  {
    id: "whisper",
    labelVi: "Whisper (CUDA)",
    labelEn: "Whisper (CUDA)",
    hintVi: "Faster-Whisper đa ngôn ngữ (~1.4 GB VRAM CUDA hoặc CPU int8)",
    hintEn: "Multilingual Faster-Whisper (~1.4 GB CUDA VRAM or CPU int8)",
  },
];

function formatCountdown(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  if (s >= 60) {
    const mins = Math.floor(s / 60);
    const rem = s % 60;
    return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`;
  }
  return `${s}s`;
}

function normalizeShortModel(val) {
  const orig = String(val || "").trim();
  const s = orig.toLowerCase();
  if (!orig || s === "4b" || s === "qwen3.5:4b") return "4b";
  if (s === "0.6b" || s === "0.5b" || s === "qwen3:0.6b" || s === "qwen2.5:0.5b") return "0.6b";
  if (s === "1.7b" || s === "1.5b" || s === "qwen3:1.7b" || s === "qwen2.5:1.5b") return "1.7b";
  return orig;
}

const WAKE_NAME_PRESETS = ["Luna", "Nova", "Alpha", "Sora", "Milo", "Jarvis"];

const DEFAULT_TERMS = [
  "OK Luna",
  "Party mode",
  "Mở app Facebook",
  "Bật mic Discord",
  "Giữ lại 1 tab",
  "Tìm file mới nhất",
];

export function SettingsDrawer({
  hubState,
  onToggleSafety,
  onToggleWake,
  onChangeWakeName,
  onChangeWakeSensitivity,
  onToggleVoiceAlways,
  onToggleSakuga,
  onChangeDisplayMode,
  onChangeUiLanguage,
  onRecenter,
  onVramUnload,
  onPreviewVfx,
  onChangeHotkey,
  onSelectLocalModel,
  onAddDictWord,
  onRemoveDictWord,
  onOpenExports,
  onHideHub,
}) {
  const uiLang = hubState.uiLanguage === "en" ? "en" : "vi";
  const t = useT(uiLang);
  const localizedTabs = [
    { id: "ai", label: t.tabAi, Icon: Cpu },
    { id: "general", label: t.tabGeneral, Icon: SlidersHorizontal },
    { id: "pair", label: t.tabPair, Icon: Link2 },
    { id: "shortcuts", label: t.tabShortcuts, Icon: Keyboard },
  ];
  const [activeTab, setActiveTab] = useState("ai");
  const [dictInput, setDictInput] = useState("");
  const [wakeNameInput, setWakeNameInput] = useState(hubState.wakeName || "Luna");
  const [keepAliveSetting, setKeepAliveSetting] = useState("5m");
  const [thinkingMode, setThinkingMode] = useState("auto");
  const [numCtx, setNumCtx] = useState(8192);
  const [sttEngineMode, setSttEngineMode] = useState("hybrid");
  const [installingVietnote, setInstallingVietnote] = useState(false);
  const [backendStatus, setBackendStatus] = useState(null);
  const [vramNotice, setVramNotice] = useState("");
  const [showApiKeyEdit, setShowApiKeyEdit] = useState(false);
  const [cloudKeyInput, setCloudKeyInput] = useState("");
  const [customModelInput, setCustomModelInput] = useState("");
  const pendingSetRef = useRef(0);

  const isSafe = hubState.safetyMode !== "turbo";
  const wakeOn = hubState.wakeWordEnabled !== false;
  const voiceOn = Boolean(hubState.voiceReplyAlways);
  const sakugaOn = hubState.sakugaEnabled !== false;
  const selectedModel = normalizeShortModel(
    backendStatus?.model_alias || backendStatus?.current_model || hubState.localModelPreset
  );

  const refreshBackendStatus = async () => {
    try {
      const data = await getLocalBackendStatus();
      if (data) {
        setBackendStatus(data);
        if (pendingSetRef.current === 0) {
          if (data?.keep_alive_setting) setKeepAliveSetting(data.keep_alive_setting);
          if (data?.thinking_mode) setThinkingMode(data.thinking_mode);
          if (data?.num_ctx) setNumCtx(Number(data.num_ctx));
          if (data?.stt_engine_mode) setSttEngineMode(data.stt_engine_mode);
        }
      } else {
        setBackendStatus(null);
      }
    } catch {
      setBackendStatus(null);
    }
  };

  useEffect(() => {
    refreshBackendStatus();
    if (activeTab !== "ai") return undefined;
    const timer = setInterval(() => {
      refreshBackendStatus();
    }, 3000);
    return () => clearInterval(timer);
  }, [activeTab]);

  useEffect(() => {
    setWakeNameInput(hubState.wakeName || "Luna");
  }, [hubState.wakeName]);

  const apiFallbackOn = Boolean(backendStatus?.api_fallback_enabled);
  const apiKeyReady = Boolean(backendStatus?.api_key_configured);
  const gamingGuardOn = backendStatus?.gaming_guard_enabled !== false;
  const omniparserOn = Boolean(backendStatus?.omniparser_enabled);
  const omniparserAvail = Boolean(backendStatus?.omniparser_available);
  const omniparserLoaded = Boolean(backendStatus?.omniparser_loaded);
  const omniparserMissing = Array.isArray(backendStatus?.omniparser_missing_deps)
    ? backendStatus.omniparser_missing_deps
    : [];
  const browserUseOn = Boolean(backendStatus?.browser_use_enabled);
  const browserUseAvail = Boolean(backendStatus?.browser_use_available);

  const showToast = (msg, ms = 2200) => {
    setVramNotice(msg);
    setTimeout(() => setVramNotice(""), ms);
  };

  const handleToggleOmniParser = async () => {
    const next = !omniparserOn;
    pendingSetRef.current += 1;
    try {
      const resp = await postLocalBackend("/set-omniparser", { enabled: next });
      if (resp.ok) {
        const data = await resp.json();
        setBackendStatus(data);
        showToast(
          next
            ? data?.omniparser_available
              ? "OmniParser V2: BẬT (Lazy VRAM)"
              : "OmniParser: Đã bật (thiếu gói Python -> dùng lưới 10x10)"
            : "OmniParser V2: TẮT"
        );
      }
    } catch {
      showToast("Chưa kết nối Backend (:8765)");
    } finally {
      pendingSetRef.current = Math.max(0, pendingSetRef.current - 1);
    }
  };

  const handleToggleBrowserUse = async () => {
    const next = !browserUseOn;
    pendingSetRef.current += 1;
    try {
      const resp = await postLocalBackend("/set-browser-use", { enabled: next });
      if (resp.ok) {
        const data = await resp.json();
        setBackendStatus(data);
        showToast(next ? "Browser-Use: BẬT" : "Browser-Use: TẮT");
      }
    } catch {
      showToast("Chưa kết nối Backend (:8765)");
    } finally {
      pendingSetRef.current = Math.max(0, pendingSetRef.current - 1);
    }
  };

  const handleToggleGamingGuard = async () => {
    const next = !gamingGuardOn;
    try {
      const resp = await postLocalBackend("/set-gaming-guard", { enabled: next });
      if (resp.ok) {
        setBackendStatus(await resp.json());
        showToast(next ? "Đã bật Tự quét Game" : "Đã tắt Tự quét Game");
      }
    } catch {
      showToast("Chưa kết nối Backend (:8765)");
    }
  };

  const handleToggleApiFallback = async () => {
    const next = !apiFallbackOn;
    try {
      const resp = await postLocalBackend("/set-api-fallback", { enabled: next });
      if (resp.ok) {
        const data = await resp.json();
        setBackendStatus(data);
        if (next && !data?.api_key_configured) setShowApiKeyEdit(true);
      }
    } catch {}
  };

  const handleSaveCloudKey = async () => {
    const k = cloudKeyInput.trim();
    if (!k) return;
    try {
      const resp = await postLocalBackend("/set-api-fallback", { enabled: true, api_key: k });
      if (resp.ok) {
        setBackendStatus(await resp.json());
        setCloudKeyInput("");
        setShowApiKeyEdit(false);
      } else {
        showToast("API key không hợp lệ");
      }
    } catch {}
  };

  const handleSelectModel = async (modelId) => {
    onSelectLocalModel?.(modelId);
    try {
      const resp = await postLocalBackend("/set-model", { model: modelId });
      if (resp.ok) {
        const data = await resp.json();
        setBackendStatus(data);
        showToast(`Model: ${data.current_model || modelId}`);
      }
    } catch {
      showToast("Đã lưu local");
    }
  };

  const handleSelectKeepAlive = async (value) => {
    setKeepAliveSetting(value);
    pendingSetRef.current += 1;
    try {
      const resp = await postLocalBackend("/set-keep-alive", { keep_alive: value });
      if (resp.ok) {
        setBackendStatus(await resp.json());
        showToast(value === "0s" ? "Đã đặt 0s & xả VRAM" : `Giữ VRAM: ${value}`);
        if (value === "0s") onVramUnload?.();
      }
    } catch {
      showToast("Chưa kết nối Backend (:8765)");
    } finally {
      pendingSetRef.current = Math.max(0, pendingSetRef.current - 1);
    }
  };

  const handleSelectThinking = async (mode) => {
    setThinkingMode(mode);
    pendingSetRef.current += 1;
    try {
      const resp = await postLocalBackend("/set-thinking", { mode });
      if (resp.ok) {
        setBackendStatus(await resp.json());
        showToast(mode === "off" ? "Thinking: TẮT" : mode === "on" ? "Thinking: SÂU" : "Thinking: Tự động");
      }
    } catch {
      showToast("Chưa kết nối Backend (:8765)");
    } finally {
      pendingSetRef.current = Math.max(0, pendingSetRef.current - 1);
    }
  };

  const handleSelectNumCtx = async (val) => {
    setNumCtx(val);
    pendingSetRef.current += 1;
    try {
      const resp = await postLocalBackend("/set-num-ctx", { num_ctx: val });
      if (resp.ok) {
        setBackendStatus(await resp.json());
        showToast(`Ngữ cảnh: ${val / 1024}K`);
      }
    } catch {
      showToast("Chưa kết nối Backend (:8765)");
    } finally {
      pendingSetRef.current = Math.max(0, pendingSetRef.current - 1);
    }
  };

  const handleSelectSttEngine = async (mode) => {
    setSttEngineMode(mode);
    pendingSetRef.current += 1;
    try {
      const resp = await postLocalBackend("/set-stt-engine", { mode });
      if (resp.ok) {
        setBackendStatus(await resp.json());
        showToast(`STT: ${mode.toUpperCase()}`);
      }
    } catch {
      showToast("Chưa kết nối Backend");
    } finally {
      pendingSetRef.current = Math.max(0, pendingSetRef.current - 1);
    }
  };

  const handleInstallVietnote = async () => {
    if (installingVietnote || !window.jarvisApi?.installVietnoteAsr) return;
    setInstallingVietnote(true);
    showToast("Đang tải VietNote ASR (~100MB)...", 4000);
    try {
      const res = await window.jarvisApi.installVietnoteAsr();
      if (res?.ok) {
        showToast("VietNote ASR sẵn sàng (0 MB VRAM) ✓", 3000);
        await refreshBackendStatus();
      } else {
        showToast(res?.error || "Cài VietNote ASR thất bại", 3500);
      }
    } finally {
      setInstallingVietnote(false);
    }
  };

  const handleUnloadVram = async () => {
    try {
      const resp = await postLocalBackend("/unload-vram");
      if (resp.ok) {
        const data = await resp.json();
        if (data?.status) setBackendStatus(data.status);
        onVramUnload?.();
        showToast("Đã xả VRAM về 0 GB ✓", 2500);
      }
    } catch {
      showToast("Chưa kết nối Backend (:8765)");
    }
  };

  const handleAddDict = async (e) => {
    e.preventDefault();
    const clean = dictInput.trim();
    if (!clean) return;
    await onAddDictWord?.(clean);
    setDictInput("");
  };

  const vramGb = backendStatus?.total_vram_gb ?? 0;
  const gpuName = backendStatus?.gpu_name || "GPU VRAM";
  const gpuTotalGb = Number(backendStatus?.gpu_vram_total_gb) || 0;
  const vramCap = gpuTotalGb > 0 ? gpuTotalGb : 8.0;
  const vramPct = Math.min(100, Math.round((vramGb / vramCap) * 100));
  const installedOllamaModels = Array.isArray(backendStatus?.ollama_installed_models)
    ? backendStatus.ollama_installed_models
    : [];
  const ollamaOnline = backendStatus?.ollama_online === true;
  const ollamaInstalled = backendStatus?.ollama_installed !== false;

  const handleApplyCustomModel = async (e) => {
    e.preventDefault();
    const m = customModelInput.trim();
    if (!m) return;
    await handleSelectModel(m);
    setCustomModelInput("");
  };

  return (
    <motion.div
      data-hub-interactive="true"
      initial={{ opacity: 0, y: -8, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.96 }}
      transition={{ duration: 0.12 }}
      className="pointer-events-auto w-[436px] rounded-[16px] sakuga-manga-panel border-[3px] border-[#0E0E13] p-3 mt-2 sakuga-panel-shadow text-[#0E0E13] relative overflow-hidden"
    >
      {/* Crisp B&W Manga Frame Header */}
      <div className="flex items-center justify-between px-0.5 pb-2 mb-2 border-b-2 border-[#0E0E13]">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-block w-2 h-3.5 bg-[#0E0E13] -skew-x-12 shrink-0" />
          <span className="text-[11px] font-black italic tracking-[0.1em] uppercase text-[#0E0E13] truncate">
            BLACK SAKURA // JARVIS-HUB
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {vramNotice && (
            <span className="px-1.5 py-0.5 rounded bg-zinc-100 border border-[#0E0E13] text-[9.5px] font-black text-[#0E0E13]">
              {vramNotice}
            </span>
          )}
          <div className="flex items-center rounded border-2 border-[#0E0E13] overflow-hidden">
            {["vi", "en"].map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => onChangeUiLanguage?.(code)}
                title={code === "en" ? "Switch UI to English" : "Chuyển giao diện sang Tiếng Việt"}
                className={`px-1.5 py-0.5 text-[9px] font-black uppercase cursor-pointer ${
                  uiLang === code ? "bg-[#0E0E13] text-white" : "bg-white text-[#0E0E13] hover:bg-zinc-100"
                }`}
              >
                {code}
              </button>
            ))}
          </div>
          <span
            className={`px-2 py-0.5 rounded text-[9.5px] font-black border-2 border-[#0E0E13] ${
              sakugaOn ? "bg-[#0E0E13] text-white" : "bg-zinc-200 text-zinc-600"
            }`}
          >
            {sakugaOn ? "⚡ VFX ON" : "VFX OFF"}
          </span>
        </div>
      </div>

      {/* Balanced 4-Tab Bar */}
      <div className="grid grid-cols-4 gap-1 p-1 rounded-xl bg-zinc-100 border-2 border-[#0E0E13] mb-2.5">
        {localizedTabs.map(({ id, label, Icon }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={`h-7 flex items-center justify-center gap-1 px-1.5 rounded-lg text-[10.5px] font-extrabold whitespace-nowrap transition-all cursor-pointer border-2 ${
                active
                  ? "bg-[#0E0E13] text-white border-[#0E0E13] shadow-[2px_2px_0_#94a3b8]"
                  : "bg-transparent text-[#0E0E13] border-transparent hover:bg-white hover:border-[#0E0E13]/30"
              }`}
            >
              <Icon className="w-3 h-3 shrink-0" />
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Body */}
      <div className="max-h-[345px] overflow-y-auto jarvis-scroll pr-0.5 space-y-2 text-xs">
        {activeTab === "ai" && (
          <>
            {/* Live VRAM Telemetry + Instant Unload */}
            <div className="p-2.5 rounded-xl bg-white border-2 border-[#0E0E13] sakuga-chip-shadow space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[11px] font-black text-[#0E0E13] flex items-center gap-1.5">
                    <span className="truncate max-w-[140px]" title={gpuName}>{gpuName}:</span>
                    <span className="px-1.5 py-0.2 rounded bg-zinc-100 border border-[#0E0E13] text-[10px] shrink-0">
                      {backendStatus?.is_gaming
                        ? "Game Mode"
                        : gpuTotalGb <= 0 && backendStatus
                          ? "CPU Mode"
                          : backendStatus?.vram_loaded
                            ? `~${vramGb} / ${vramCap} GB`
                            : `0.0 / ${vramCap} GB`}
                    </span>
                  </div>
                  <div className="text-[10px] font-medium text-zinc-600 truncate mt-0.5">
                    {(backendStatus?.ollama_loaded_models || []).length > 0
                      ? `Đang giữ: ${backendStatus.ollama_loaded_models.join(", ")}${backendStatus?.stt_loaded ? " + Whisper" : ""}${
                          backendStatus?.vram_expires_in_sec != null
                            ? ` · Tự xả sau ${formatCountdown(backendStatus.vram_expires_in_sec)}`
                            : keepAliveSetting === "always"
                              ? " · Đang ghim"
                              : ""
                        }`
                      : backendStatus?.stt_loaded
                        ? `Đang giữ: Whisper STT${
                            backendStatus?.vram_expires_in_sec != null
                              ? ` · Tự xả sau ${formatCountdown(backendStatus.vram_expires_in_sec)}`
                              : keepAliveSetting === "always"
                                ? " · Đang ghim"
                                : ""
                          }`
                        : t.noVramModel}
                  </div>
                </div>
                <button
                  type="button"
                  data-sakuga-power="heavy"
                  onClick={handleUnloadVram}
                  className="h-7 shrink-0 inline-flex items-center gap-1 px-2.5 rounded-lg bg-zinc-100 hover:bg-[#0E0E13] hover:text-white sakuga-btn text-[10.5px] font-black text-[#0E0E13] whitespace-nowrap cursor-pointer"
                  title={t.unloadVram}
                >
                  <Trash2 className="w-3 h-3" />
                  <span>{t.unloadVram}</span>
                </button>
              </div>
              <div className="w-full h-1.5 rounded-full bg-zinc-200 overflow-hidden border border-[#0E0E13]">
                <div
                  className="h-full bg-[#0E0E13] transition-all duration-300"
                  style={{ width: `${Math.max(backendStatus?.vram_loaded ? 6 : 0, vramPct)}%` }}
                />
              </div>
              {backendStatus?.external_ai_active && (
                <div className="text-[10px] font-bold px-2 py-1 rounded-lg bg-amber-50 border border-amber-400 text-amber-950">
                  {t.gpuShareWarning}
                  {typeof backendStatus.gpu_vram_free_gb === "number"
                    ? ` (${t.gpuShareFree} ${backendStatus.gpu_vram_free_gb} GB)`
                    : ""}{" "}
                  · {t.gpuShareProtect}
                </div>
              )}
            </div>

            {/* Model Picker (Compact 3-Column Row) */}
            <div className="space-y-1">
              <div className="text-[10.5px] font-black uppercase tracking-wider text-zinc-600 px-0.5">
                {t.localAiSection}
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {LOCAL_MODELS.map((m) => {
                  const active = selectedModel === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      data-sakuga-power="heavy"
                      title={m.hint}
                      onClick={() => handleSelectModel(m.id)}
                      className={`p-2 rounded-xl sakuga-btn text-left cursor-pointer flex flex-col justify-between gap-0.5 ${
                        active ? "bg-[#0E0E13] text-white" : "bg-white text-[#0E0E13] hover:bg-zinc-100"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-black text-[11px]">{m.short}</span>
                        {active && <Check className="w-3 h-3 shrink-0" />}
                      </div>
                      <div className={`text-[9.5px] font-bold ${active ? "text-zinc-300" : "text-zinc-600"}`}>
                        {m.vram}
                      </div>
                      <div className={`text-[9px] truncate ${active ? "text-zinc-400" : "text-zinc-500"}`}>
                        {m.hint}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Notice for users who have not installed or started Ollama yet */}
              {backendStatus && !ollamaOnline && (
                <div className="p-2 rounded-xl bg-amber-50 border-2 border-[#0E0E13] text-[10px] leading-snug text-[#0E0E13] space-y-1">
                  <div className="font-black">
                    {ollamaInstalled ? t.ollamaNotRunning : t.ollamaNotInstalled}
                  </div>
                  <div className="text-zinc-700">{t.ollamaHint}</div>
                </div>
              )}

              {/* Dynamic installed Ollama models + custom model selector for any PC */}
              <div className="p-2 rounded-xl bg-white border-2 border-[#0E0E13] sakuga-chip-shadow space-y-1.5">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[10px] font-black text-[#0E0E13]">
                    {t.otherOllamaModels} ({installedOllamaModels.length})
                  </span>
                  <span className="text-[9.5px] font-bold text-zinc-500 truncate max-w-[130px]" title={backendStatus?.current_model || selectedModel}>
                    {t.usingModel} {backendStatus?.current_model || selectedModel}
                  </span>
                </div>
                {installedOllamaModels.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {installedOllamaModels.slice(0, 10).map((tag) => {
                      const active = (backendStatus?.current_model || "") === tag;
                      return (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => handleSelectModel(tag)}
                          className={`px-2 py-0.5 rounded-lg text-[9.5px] font-bold border border-[#0E0E13] cursor-pointer ${
                            active ? "bg-[#0E0E13] text-white" : "bg-zinc-50 text-[#0E0E13] hover:bg-zinc-200"
                          }`}
                        >
                          {tag}
                        </button>
                      );
                    })}
                  </div>
                )}
                <form onSubmit={handleApplyCustomModel} className="flex items-center gap-1">
                  <input
                    type="text"
                    value={customModelInput}
                    onChange={(e) => setCustomModelInput(e.target.value)}
                    placeholder={t.customModelPlaceholder}
                    className="flex-1 h-6.5 px-2 rounded-lg text-[10px] border border-[#0E0E13]/40 bg-zinc-50 text-[#0E0E13] focus:outline-none focus:border-[#0E0E13]"
                  />
                  <button
                    type="submit"
                    className="h-6.5 px-2 rounded-lg text-[10px] font-black bg-[#0E0E13] text-white cursor-pointer shrink-0"
                  >
                    {t.chooseBtn}
                  </button>
                </form>
              </div>
            </div>

            {/* Context Length & Thinking Mode */}
            <div className="grid grid-cols-1 gap-2">
              <div className="p-2 rounded-xl bg-white border-2 border-[#0E0E13] sakuga-chip-shadow space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10.5px] font-extrabold text-[#0E0E13]">{t.contextTitle}</span>
                  <span className="text-[9.5px] font-black text-zinc-600">{Math.round(numCtx / 1024)}K Tokens</span>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {NUM_CTX_OPTIONS.map((opt) => {
                    const active = numCtx === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        title={opt.hint}
                        onClick={() => handleSelectNumCtx(opt.id)}
                        className={`h-7 px-1.5 rounded-lg text-[10px] font-bold border-2 border-[#0E0E13] whitespace-nowrap transition-colors cursor-pointer ${
                          active ? "bg-[#0E0E13] text-white" : "bg-white text-[#0E0E13] hover:bg-zinc-100"
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="p-2 rounded-xl bg-white border-2 border-[#0E0E13] sakuga-chip-shadow space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10.5px] font-extrabold text-[#0E0E13]">{t.thinkingTitle}</span>
                  <span className="text-[9.5px] font-black text-zinc-600">
                    {THINKING_OPTIONS.find((o) => o.id === thinkingMode)?.label}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {THINKING_OPTIONS.map((opt) => {
                    const active = thinkingMode === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        title={opt.hint}
                        onClick={() => handleSelectThinking(opt.id)}
                        className={`h-7 px-1.5 rounded-lg text-[10px] font-bold border-2 border-[#0E0E13] whitespace-nowrap transition-colors cursor-pointer ${
                          active ? "bg-[#0E0E13] text-white" : "bg-white text-[#0E0E13] hover:bg-zinc-100"
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Keep-Alive Compact 6-Button Row */}
            <div className="p-2 rounded-xl bg-white border-2 border-[#0E0E13] sakuga-chip-shadow space-y-1">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1 text-[10.5px] font-extrabold text-[#0E0E13]">
                  <Clock className="w-3 h-3" />
                  <span>{t.keepAliveTitle}</span>
                </span>
                <span className="text-[9.5px] font-bold text-zinc-600">
                  {KEEP_ALIVE_OPTIONS.find((o) => o.id === keepAliveSetting)?.hint}
                </span>
              </div>
              <div className="grid grid-cols-6 gap-1">
                {KEEP_ALIVE_OPTIONS.map((opt) => {
                  const active = keepAliveSetting === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      title={opt.hint}
                      onClick={() => handleSelectKeepAlive(opt.id)}
                      className={`h-7 rounded-lg text-[10.5px] font-black border-2 border-[#0E0E13] whitespace-nowrap transition-colors cursor-pointer ${
                        active ? "bg-[#0E0E13] text-white" : "bg-white text-[#0E0E13] hover:bg-zinc-100"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Hybrid Dual-STT Engine (VietNote ASR 0 MB VRAM + Faster-Whisper) */}
            <div className="p-2.5 rounded-xl bg-white border-2 border-[#0E0E13] sakuga-chip-shadow space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Mic className="w-3.5 h-3.5 shrink-0 text-[#0E0E13]" />
                  <span className="font-extrabold text-[11px] text-[#0E0E13] truncate">
                    {t.sttEngineTitle}
                  </span>
                </div>
                {!backendStatus?.vietnote_ready && (
                  <button
                    type="button"
                    disabled={installingVietnote}
                    onClick={handleInstallVietnote}
                    className="h-6 inline-flex items-center gap-1 px-2 rounded-lg bg-[#0E0E13] text-white text-[9.5px] font-black shrink-0 cursor-pointer disabled:opacity-50"
                    title="Cài sherpa-onnx & tải Kaisye/VietNote-Zipformer-78M-Streaming (0 MB VRAM)"
                  >
                    <Download className="w-2.5 h-2.5 text-[#F43F5E]" />
                    <span>{installingVietnote ? t.sttInstalling : t.sttInstallBtn}</span>
                  </button>
                )}
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {STT_ENGINE_OPTIONS.map((opt) => {
                  const active = sttEngineMode === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      title={uiLang === "en" ? opt.hintEn : opt.hintVi}
                      onClick={() => handleSelectSttEngine(opt.id)}
                      className={`h-7 px-1.5 rounded-lg text-[10px] font-bold border-2 border-[#0E0E13] whitespace-nowrap transition-colors cursor-pointer ${
                        active ? "bg-[#0E0E13] text-white" : "bg-white text-[#0E0E13] hover:bg-zinc-100"
                      }`}
                    >
                      {uiLang === "en" ? opt.labelEn : opt.labelVi}
                    </button>
                  );
                })}
              </div>
              <div className="text-[9.5px] font-bold text-zinc-600 px-0.5 flex items-center justify-between gap-1">
                <span className="truncate">
                  {backendStatus?.vietnote_ready
                    ? uiLang === "en"
                      ? `VietNote Ready (0 MB VRAM · ${backendStatus?.vietnote_hotwords_count || 0} English hotwords)`
                      : `VietNote Sẵn sàng (0 MB VRAM · ${backendStatus?.vietnote_hotwords_count || 0} hotwords Anh-Việt)`
                    : uiLang === "en"
                      ? "VietNote not installed yet -> auto-using Faster-Whisper"
                      : "Chưa tải VietNote ASR -> đang dùng Faster-Whisper"}
                </span>
              </div>
            </div>

            {/* OmniParser V2 Vision Click Toggle */}
            <div className="p-2.5 rounded-xl bg-white border-2 border-[#0E0E13] sakuga-chip-shadow space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Eye className="w-3.5 h-3.5 shrink-0 text-[#0E0E13]" />
                  <span className="font-extrabold text-[11px] text-[#0E0E13] truncate">
                    {t.omniparserTitle}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleToggleOmniParser}
                  className={`h-7 px-3 rounded-lg text-[10.5px] font-black border-2 border-[#0E0E13] shrink-0 cursor-pointer ${
                    omniparserOn ? "bg-[#0E0E13] text-white" : "bg-zinc-100 text-zinc-600"
                  }`}
                >
                  {omniparserOn ? t.on : t.off}
                </button>
              </div>
              <div className="text-[10px] leading-snug text-zinc-600 bg-zinc-50 border border-[#0E0E13]/20 rounded-lg px-2 py-1.5">
                {t.omniparserDesc}
              </div>
              <div className="flex items-center justify-between text-[9.5px] font-bold text-zinc-600 px-0.5">
                <span>
                  {t.statusLabel}{" "}
                  {omniparserLoaded
                    ? "Đang giữ trong VRAM"
                    : omniparserAvail
                      ? omniparserOn
                        ? "Sẵn sàng (Lazy VRAM)"
                        : "Đang TẮT · Dùng lưới 10×10"
                      : `Chưa cài: ${omniparserMissing.join(", ") || "torch, ultralytics"} (tự fallback lưới 10×10)`}
                </span>
              </div>
            </div>
          </>
        )}

        {activeTab === "general" && (
          <>
            {/* Display Language Selector (Tiếng Việt / English) */}
            <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-white border-2 border-[#0E0E13] sakuga-chip-shadow">
              <div className="flex items-center gap-1.5 min-w-0">
                <Languages className="w-3.5 h-3.5 text-[#0E0E13] shrink-0" />
                <span className="font-extrabold text-[11px] text-[#0E0E13] truncate">{t.uiLanguageLabel}</span>
              </div>
              <div className="grid grid-cols-2 gap-1 shrink-0">
                {[
                  { id: "vi", label: "Tiếng Việt" },
                  { id: "en", label: "English" },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => onChangeUiLanguage?.(opt.id)}
                    className={`h-7 px-2.5 rounded-lg text-[10.5px] font-black border-2 border-[#0E0E13] cursor-pointer ${
                      uiLang === opt.id ? "bg-[#0E0E13] text-white" : "bg-white text-[#0E0E13] hover:bg-zinc-100"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Multi-Monitor Position */}
            <div className="space-y-1.5 p-2.5 rounded-xl bg-white border-2 border-[#0E0E13] sakuga-chip-shadow">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[11px] font-extrabold text-[#0E0E13]">
                  <Monitor className="w-3.5 h-3.5" />
                  <span>{t.displayTitle}</span>
                </span>
                {onRecenter && (
                  <button
                    type="button"
                    onClick={onRecenter}
                    className="px-2 py-0.5 rounded bg-zinc-100 hover:bg-[#0E0E13] hover:text-white border border-[#0E0E13] text-[10px] font-black text-[#0E0E13] cursor-pointer"
                  >
                    {t.recenterBtn}
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { id: "cursor", label: t.displayAutoCursor },
                  { id: "primary", label: t.displayPrimary },
                  ...((hubState.displays || []).length > 1
                    ? (hubState.displays || []).map((d) => ({
                        id: `display:${d.id}`,
                        label: `${uiLang === "en" ? "Display" : "Màn"} ${d.index} · ${d.aspectRatio || `${d.width}×${d.height}`}`,
                        title: d.label || `Display ${d.index} (${d.width}×${d.height})`,
                      }))
                    : []),
                ].map((opt) => {
                  const active = (hubState.displayMode || "cursor") === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      title={opt.title || opt.label}
                      onClick={() => onChangeDisplayMode?.(opt.id)}
                      className={`h-7 px-2 rounded-lg text-[10.5px] font-bold border-2 border-[#0E0E13] transition-colors cursor-pointer truncate ${
                        active ? "bg-[#0E0E13] text-white" : "bg-white text-[#0E0E13] hover:bg-zinc-100"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              {(hubState.displays || []).length > 0 && (
                <div className="text-[9.5px] font-mono text-zinc-600 pt-1 border-t border-zinc-200 space-y-0.5">
                  {(hubState.displays || []).map((d) => (
                    <div key={d.id} className="truncate" title={d.label}>
                      {d.label || `Màn ${d.index} · ${d.width}×${d.height}`}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Unified Sakuga VFX Toggle + Inline Test */}
            <div className="p-2.5 rounded-xl bg-zinc-50 border-2 border-[#0E0E13] sakuga-chip-shadow space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Sparkles className="w-4 h-4 shrink-0 text-[#0E0E13]" />
                  <div className="min-w-0">
                    <div className="font-black text-[#0E0E13] text-[11px]">{t.sakugaVfxTitle}</div>
                    <div className="text-[10px] text-zinc-600 truncate">{t.sakugaVfxSub}</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onToggleSakuga?.(!sakugaOn)}
                  className={`h-7 px-3 rounded-lg text-[10.5px] font-black border-2 border-[#0E0E13] shrink-0 cursor-pointer ${
                    sakugaOn ? "bg-[#0E0E13] text-white" : "bg-white text-zinc-500"
                  }`}
                >
                  {sakugaOn ? t.on : t.off}
                </button>
              </div>
              {onPreviewVfx && (
                <div className="flex items-center justify-between gap-1 pt-1.5 border-t border-[#0E0E13]/15">
                  <span className="text-[9.5px] font-black uppercase text-zinc-600">Test:</span>
                  <div className="flex items-center gap-1">
                    {[
                      { id: "listening", label: "Listen" },
                      { id: "mcp_local", label: "MCP" },
                      { id: "antigravity", label: "Bridge" },
                      { id: "vram_unload", label: "Smoke" },
                      { id: "idle", label: "Idle" },
                    ].map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        data-sakuga-power="heavy"
                        onClick={() => onPreviewVfx(p.id)}
                        className="px-2 py-0.5 rounded bg-white hover:bg-[#0E0E13] hover:text-white border border-[#0E0E13] text-[9.5px] font-bold cursor-pointer"
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Auto Gaming Guard */}
            <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-white border-2 border-[#0E0E13] sakuga-chip-shadow">
              <div className="flex items-center gap-2 min-w-0">
                <Gamepad2 className="w-4 h-4 text-[#0E0E13] shrink-0" />
                <div className="min-w-0">
                  <div className="font-extrabold text-[11px] text-[#0E0E13]">{t.gamingGuardTitle}</div>
                  <div className="text-[10px] text-zinc-600 truncate">
                    {gamingGuardOn ? t.gamingGuardOn : t.gamingGuardOff}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={handleToggleGamingGuard}
                className={`h-7 px-3 rounded-lg text-[10.5px] font-black border-2 border-[#0E0E13] shrink-0 cursor-pointer ${
                  gamingGuardOn ? "bg-[#0E0E13] text-white" : "bg-zinc-100 text-zinc-600"
                }`}
              >
                {gamingGuardOn ? t.on : t.off}
              </button>
            </div>

            {/* Quick System Buttons */}
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={onOpenExports}
                className="h-8 flex items-center justify-center gap-1.5 rounded-xl bg-white hover:bg-zinc-100 border-2 border-[#0E0E13] text-[11px] font-bold text-[#0E0E13] cursor-pointer"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>{t.exportsBtn}</span>
              </button>
              <button
                type="button"
                onClick={onHideHub}
                className="h-8 flex items-center justify-center gap-1.5 rounded-xl bg-white hover:bg-[#0E0E13] hover:text-white border-2 border-[#0E0E13] text-[11px] font-bold text-[#0E0E13] cursor-pointer"
              >
                <EyeOff className="w-3.5 h-3.5" />
                <span>{t.hideTrayBtn}</span>
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => window.jarvisApi?.reopenSetup?.()}
                className="h-8 flex items-center justify-center gap-1.5 rounded-xl bg-zinc-50 hover:bg-[#0E0E13] hover:text-white border-2 border-[#0E0E13] text-[10.5px] font-bold text-[#0E0E13] cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{t.reopenSetupBtn}</span>
              </button>
              <button
                type="button"
                onClick={() => window.jarvisApi?.quitApp?.()}
                className="h-8 flex items-center justify-center gap-1.5 rounded-xl bg-rose-50 hover:bg-rose-600 hover:text-white border-2 border-[#0E0E13] text-[10.5px] font-black text-rose-700 cursor-pointer"
              >
                <span>{t.quitAppBtn}</span>
              </button>
            </div>
          </>
        )}

        {activeTab === "pair" && (
          <>
            <div className="space-y-1.5">
              <div className="text-[10.5px] font-black uppercase tracking-wider text-zinc-600">
                {t.mcpConnTitle}
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { name: "fast-desktop", on: backendStatus?.mcp_status?.fast_desktop ?? hubState.health?.fastDesktop },
                  { name: "Win32 Python", on: Boolean(backendStatus?.mcp_status?.python_native_win32) },
                  { name: "agent-desktop", on: backendStatus?.mcp_status?.agent_desktop ?? hubState.health?.agentDesktop },
                  { name: "playwright", on: backendStatus?.mcp_status?.playwright ?? hubState.health?.playwright },
                  {
                    name: backendStatus?.ollama_online ? `Ollama (${backendStatus.model_alias || "4b"})` : "Ollama Local",
                    on: Boolean(backendStatus?.ollama_online),
                  },
                  {
                    name: "OmniParser V2",
                    on: omniparserOn && omniparserAvail,
                  },
                ].map((srv) => (
                  <div
                    key={srv.name}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white border-2 border-[#0E0E13] sakuga-chip-shadow"
                  >
                    <span
                      className={`w-2.5 h-2.5 rounded-full border border-[#0E0E13] ${
                        srv.on ? "bg-emerald-500" : "bg-amber-400"
                      }`}
                    />
                    <span className="truncate text-[11px] font-bold text-[#0E0E13]">{srv.name}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-xl bg-white border-2 border-[#0E0E13] sakuga-chip-shadow">
              <div>
                <div className="font-extrabold text-[#0E0E13]">{t.mcpProtectTitle}</div>
                <div className="text-[10.5px] font-medium text-zinc-600">
                  {isSafe ? t.mcpSafeDesc : t.mcpTurboDesc}
                </div>
              </div>
              <button
                type="button"
                onClick={onToggleSafety}
                className={`h-7 flex items-center gap-1.5 px-2.5 rounded-lg text-[11px] font-black border-2 border-[#0E0E13] cursor-pointer ${
                  isSafe ? "bg-white text-[#0E0E13] hover:bg-zinc-100" : "bg-[#FF6B00] text-white"
                }`}
              >
                {isSafe ? <Shield className="w-3.5 h-3.5" /> : <Zap className="w-3.5 h-3.5" />}
                <span>{isSafe ? "Safe" : "Turbo"}</span>
              </button>
            </div>

            <div className="p-2.5 rounded-xl bg-white border-2 border-[#0E0E13] sakuga-chip-shadow space-y-1">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Globe className="w-3.5 h-3.5 shrink-0 text-[#0E0E13]" />
                  <span className="font-extrabold text-[11px] text-[#0E0E13] truncate">
                    {t.browserUseTitle}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleToggleBrowserUse}
                  className={`h-7 px-3 rounded-lg text-[10.5px] font-black border-2 border-[#0E0E13] shrink-0 cursor-pointer ${
                    browserUseOn ? "bg-[#0E0E13] text-white" : "bg-zinc-100 text-zinc-600"
                  }`}
                >
                  {browserUseOn ? t.on : t.off}
                </button>
              </div>
              <div className="text-[10px] text-zinc-600 leading-snug">
                {t.browserUseDesc}{" "}
                {browserUseAvail ? "Ready." : ""}
              </div>
            </div>

            <div className="space-y-1.5 p-2.5 rounded-xl bg-white border-2 border-[#0E0E13] sakuga-chip-shadow">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="font-extrabold text-[#0E0E13]">{t.cloudGeminiTitle}</div>
                  <div className="text-[10.5px] font-medium text-zinc-600">
                    {apiFallbackOn
                      ? apiKeyReady
                        ? `${t.on} · ${backendStatus?.api_key_count || 1} key · ${backendStatus?.api_model || "gemini-2.5-flash"}`
                        : t.cloudOnNoKey
                      : t.cloudOffDesc}
                  </div>
                  {backendStatus?.last_api_error && (
                    <div className="text-[9.5px] font-bold text-rose-600 mt-0.5 truncate" title={backendStatus.last_api_error}>
                      {backendStatus.last_api_error}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setShowApiKeyEdit((v) => !v)}
                    className="h-7 px-2 rounded-lg bg-zinc-100 hover:bg-zinc-200 border border-[#0E0E13] text-[10px] font-bold text-[#0E0E13] cursor-pointer"
                  >
                    Key
                  </button>
                  <button
                    type="button"
                    onClick={handleToggleApiFallback}
                    className={`h-7 px-2.5 rounded-lg text-[11px] font-black border-2 border-[#0E0E13] cursor-pointer ${
                      apiFallbackOn ? "bg-[#00B4D8] text-[#0E0E13]" : "bg-white text-[#0E0E13] hover:bg-zinc-100"
                    }`}
                  >
                    {apiFallbackOn ? t.on : t.off}
                  </button>
                </div>
              </div>
              {showApiKeyEdit && (
                <div className="flex gap-1.5 pt-1">
                  <input
                    type="password"
                    value={cloudKeyInput}
                    onChange={(e) => setCloudKeyInput(e.target.value)}
                    placeholder={apiKeyReady ? "Key 1, Key 2..." : "GEMINI_API_KEY (key1,key2...)"}
                    className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-zinc-50 border-2 border-[#0E0E13] text-[11px] font-medium text-[#0E0E13] placeholder:text-zinc-400 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleSaveCloudKey}
                    className="px-3 py-1.5 rounded-lg bg-[#0E0E13] hover:bg-zinc-800 text-white text-[11px] font-black cursor-pointer"
                  >
                    {t.saveBtn}
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        {activeTab === "shortcuts" && (
          <>
            <div className="flex items-center justify-between p-2 rounded-xl bg-white border-2 border-[#0E0E13] sakuga-chip-shadow">
              <div>
                <div className="font-extrabold text-[11px] text-[#0E0E13]">{t.hotkeyTitle}</div>
                <div className="text-[10px] font-medium text-zinc-600">{t.hotkeySub}</div>
              </div>
              <select
                value={hubState.hotkey || "ctrl+alt+space"}
                onChange={(e) => onChangeHotkey?.(e.target.value)}
                className="px-2 py-1 rounded-lg bg-white border-2 border-[#0E0E13] text-[10.5px] font-extrabold text-[#0E0E13] focus:outline-none cursor-pointer"
              >
                <option value="ctrl+alt+space">Ctrl + Alt + Space</option>
                <option value="f9">F9</option>
                <option value="alt+space">Alt + Space</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              <div className="flex items-center justify-between p-2 rounded-xl bg-white border-2 border-[#0E0E13] sakuga-chip-shadow">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Radio className="w-3.5 h-3.5 shrink-0 text-[#0E0E13]" />
                  <span className="font-extrabold text-[10.5px] truncate">Wake '{hubState.wakeName || "Luna"}'</span>
                </div>
                <button
                  type="button"
                  onClick={onToggleWake}
                  className={`px-2 py-0.5 rounded-lg text-[10px] font-black border-2 border-[#0E0E13] cursor-pointer ${
                    wakeOn ? "bg-[#0E0E13] text-white" : "bg-zinc-100 text-zinc-600"
                  }`}
                >
                  {wakeOn ? t.on : t.off}
                </button>
              </div>

              <div className="flex items-center justify-between p-2 rounded-xl bg-white border-2 border-[#0E0E13] sakuga-chip-shadow">
                <div className="flex items-center gap-1.5 min-w-0">
                  {voiceOn ? <Volume2 className="w-3.5 h-3.5 shrink-0" /> : <VolumeX className="w-3.5 h-3.5 shrink-0 text-zinc-500" />}
                  <span className="font-extrabold text-[10.5px] truncate">{t.readTtsLabel}</span>
                </div>
                <button
                  type="button"
                  onClick={onToggleVoiceAlways}
                  className={`px-2 py-0.5 rounded-lg text-[10px] font-black border-2 border-[#0E0E13] cursor-pointer ${
                    voiceOn ? "bg-[#0E0E13] text-white" : "bg-zinc-100 text-zinc-700"
                  }`}
                >
                  {voiceOn ? t.on : t.off}
                </button>
              </div>
            </div>

            {/* Wake Name Selector + Custom Name */}
            <div className="p-2 rounded-xl bg-white border-2 border-[#0E0E13] sakuga-chip-shadow space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10.5px] font-extrabold text-[#0E0E13]">{t.wakeNameTitle}</span>
                <span className="text-[9.5px] font-black px-1.5 py-0.5 rounded bg-zinc-100 border border-[#0E0E13]/30 text-[#0E0E13]">
                  OK {hubState.wakeName || "Luna"}
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {WAKE_NAME_PRESETS.map((preset) => {
                  const active = (hubState.wakeName || "Luna").toLowerCase() === preset.toLowerCase();
                  return (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => {
                        setWakeNameInput(preset);
                        onChangeWakeName?.(preset);
                      }}
                      className={`px-2 py-0.5 rounded-full text-[10px] font-black border-2 border-[#0E0E13] cursor-pointer ${
                        active ? "bg-[#0E0E13] text-white" : "bg-zinc-100 hover:bg-zinc-200 text-[#0E0E13]"
                      }`}
                    >
                      {preset}
                    </button>
                  );
                })}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const clean = wakeNameInput.trim();
                  if (clean) onChangeWakeName?.(clean);
                }}
                className="flex gap-1.5"
              >
                <input
                  type="text"
                  value={wakeNameInput}
                  onChange={(e) => setWakeNameInput(e.target.value)}
                  placeholder="Custom English name (e.g. Kaito)..."
                  className="flex-1 min-w-0 px-2.5 py-1 rounded-lg bg-zinc-50 border-2 border-[#0E0E13] text-[10.5px] font-medium text-[#0E0E13] placeholder:text-zinc-400 focus:outline-none"
                />
                <button
                  type="submit"
                  className="px-2.5 py-1 rounded-lg bg-[#0E0E13] hover:bg-zinc-800 text-white text-[10.5px] font-black cursor-pointer"
                >
                  {t.setNameBtn}
                </button>
              </form>
              <div className="flex items-center justify-between pt-0.5">
                <span className="text-[10px] font-bold text-zinc-700">{t.sensitivityLabel}</span>
                <div className="flex gap-1">
                  {[
                    { id: "high", label: uiLang === "en" ? "High" : "Nhạy" },
                    { id: "balanced", label: uiLang === "en" ? "Balanced" : "Cân bằng" },
                    { id: "strict", label: uiLang === "en" ? "Strict" : "Chặt" },
                  ].map((opt) => {
                    const active = (hubState.wakeSensitivity || "balanced") === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => onChangeWakeSensitivity?.(opt.id)}
                        className={`px-2 py-0.5 rounded-md text-[9.5px] font-black border border-[#0E0E13] cursor-pointer ${
                          active ? "bg-[#0E0E13] text-white" : "bg-zinc-100 hover:bg-zinc-200 text-[#0E0E13]"
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="text-[9.5px] font-medium text-zinc-600">
                {uiLang === "en"
                  ? `Say "OK ${hubState.wakeName || "Luna"}" or "Hey ${hubState.wakeName || "Luna"}" to wake · "${hubState.wakeName || "Luna"} sleep now" to hide.`
                  : `Nói "OK ${hubState.wakeName || "Luna"}" hoặc "Hey ${hubState.wakeName || "Luna"}" để gọi · "${hubState.wakeName || "Luna"} sleep now" để ẩn.`}
              </div>
            </div>

            {/* Custom Voice Dictionary */}
            <div className="p-2 rounded-xl bg-white border-2 border-[#0E0E13] sakuga-chip-shadow space-y-2">
              <div className="text-[10.5px] font-extrabold text-[#0E0E13]">{t.whisperDictTitle}</div>
              <form onSubmit={handleAddDict} className="flex gap-1.5">
                <input
                  type="text"
                  value={dictInput}
                  onChange={(e) => setDictInput(e.target.value)}
                  placeholder={t.addDictPlaceholder}
                  className="flex-1 min-w-0 px-2.5 py-1 rounded-lg bg-zinc-50 border-2 border-[#0E0E13] text-[10.5px] font-medium text-[#0E0E13] placeholder:text-zinc-400 focus:outline-none"
                />
                <button
                  type="submit"
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#0E0E13] hover:bg-zinc-800 text-white text-[10.5px] font-black cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  {t.addBtn}
                </button>
              </form>

              {Array.isArray(hubState.customDictionary) && hubState.customDictionary.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {hubState.customDictionary.map((w) => (
                    <span
                      key={w}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#0E0E13] text-white text-[10px] font-bold"
                    >
                      {w}
                      <button
                        type="button"
                        onClick={() => onRemoveDictWord?.(w)}
                        className="hover:opacity-75 cursor-pointer"
                        title="Xóa"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap gap-1 pt-0.5">
                {[...DEFAULT_TERMS, ...(hubState.installedApps || []).slice(0, 8)].map((item) => (
                  <span
                    key={item}
                    className="px-1.5 py-0.5 rounded-full bg-zinc-100 border border-[#0E0E13]/40 text-[#0E0E13] text-[9.5px] font-semibold"
                  >
                    {item}
                  </span>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}
