import React, { useEffect, useState } from "react";
import {
  Shield,
  Zap,
  Monitor,
  Cpu,
  KeyRound,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  RefreshCw,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  Download,
  Square,
  Terminal,
  LogOut,
} from "lucide-react";

const RECOMMENDED_MODELS = [
  { id: "qwen3.5:4b", size: "~3.4 GB", desc: "Khuyên dùng (GPU 6–8GB+)" },
  { id: "qwen3:1.7b", size: "~1.4 GB", desc: "Cân bằng (GPU 4GB / CPU)" },
  { id: "qwen3:0.6b", size: "~520 MB", desc: "Siêu nhẹ (CPU / RAM 8GB)" },
];

export function OnboardingWizard() {
  const [step, setStep] = useState(1);
  const [lang, setLang] = useState("vi");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [safetyMode, setSafetyMode] = useState("safe");
  const [displayMode, setDisplayMode] = useState("cursor");
  const [selectedModel, setSelectedModel] = useState("qwen3.5:4b");
  const [customPullModel, setCustomPullModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [diag, setDiag] = useState(null);
  const [loadingDiag, setLoadingDiag] = useState(true);
  const [finishing, setFinishing] = useState(false);

  // Live 1-click installer / model pull state
  const [taskBusy, setTaskBusy] = useState(false);
  const [taskLabel, setTaskLabel] = useState("");
  const [taskLogs, setTaskLogs] = useState([]);
  const [taskError, setTaskError] = useState("");

  const pushLog = (msg) => {
    const clean = String(msg || "").trim();
    if (!clean) return;
    setTaskLogs((prev) => [...prev.slice(-14), clean]);
  };

  const loadDiagnostics = async () => {
    setLoadingDiag(true);
    try {
      const res = await window.jarvisApi?.getSetupDiagnostics?.();
      if (res?.ok) {
        setDiag(res);
        if (res.uiLanguage === "en" || res.uiLanguage === "vi") setLang(res.uiLanguage);
        if (res.displayMode) setDisplayMode(res.displayMode);
        if (res.safetyMode === "turbo" || res.safetyMode === "safe") {
          setSafetyMode(res.safetyMode);
        }
        const models = res.ollamaModels || res.backendStatus?.ollama_installed_models || [];
        if (models.length > 0 && !models.includes(selectedModel)) {
          setSelectedModel(models.includes("qwen3.5:4b") ? "qwen3.5:4b" : models[0]);
        }
      }
    } catch {
      setDiag(null);
    } finally {
      setLoadingDiag(false);
    }
  };

  useEffect(() => {
    loadDiagnostics();
    // Auto-refresh once after 3s in case backend just finished starting
    const t = setTimeout(() => loadDiagnostics(), 3200);
    const unsub = window.jarvisApi?.onSetupProgress?.((evt) => {
      if (evt?.message) pushLog(evt.message);
    });
    return () => {
      clearTimeout(t);
      if (typeof unsub === "function") unsub();
    };
  }, []);

  const openUrl = (url) => {
    window.jarvisApi?.openExternalSafe?.(url);
  };

  const handleInstallOllama = async () => {
    if (taskBusy) return;
    setTaskBusy(true);
    setTaskError("");
    setTaskLabel("Đang tải & cài Ollama chính chủ...");
    setTaskLogs(["Bắt đầu kiểm tra và cài đặt Ollama..."]);
    try {
      const res = await window.jarvisApi?.installOllama?.();
      if (!res?.ok) {
        setTaskError(res?.error || "Cài đặt Ollama chưa thành công.");
      } else {
        pushLog("Hoàn tất cài đặt Ollama! Đang quét lại hệ thống...");
        await loadDiagnostics();
      }
    } catch (err) {
      setTaskError(err?.message || "Lỗi cài đặt Ollama.");
    } finally {
      setTaskBusy(false);
      setTaskLabel("");
    }
  };

  const handlePullModel = async (modelId) => {
    const clean = String(modelId || "").trim();
    if (!clean || taskBusy) return;
    setTaskBusy(true);
    setTaskError("");
    setTaskLabel(`Đang tải model ${clean}...`);
    setTaskLogs([`Bắt đầu chạy: ollama pull ${clean}`]);
    try {
      const res = await window.jarvisApi?.pullOllamaModel?.(clean);
      if (!res?.ok) {
        setTaskError(res?.error || `Không tải được model ${clean}.`);
      } else {
        setSelectedModel(clean);
        pushLog(`Đã tải xong model ${clean} và đặt làm mặc định!`);
        await loadDiagnostics();
      }
    } catch (err) {
      setTaskError(err?.message || "Lỗi tải model.");
    } finally {
      setTaskBusy(false);
      setTaskLabel("");
    }
  };

  const handleInstallPythonDeps = async () => {
    if (taskBusy) return;
    setTaskBusy(true);
    setTaskError("");
    setTaskLabel("Đang cài thư viện Python (requirements.txt)...");
    setTaskLogs(["Chạy pip install -r requirements.txt..."]);
    try {
      const res = await window.jarvisApi?.installPythonDeps?.();
      if (!res?.ok) {
        setTaskError(res?.error || "Cài thư viện Python thất bại.");
      } else {
        pushLog("Cài đặt thư viện Python xong!");
        await loadDiagnostics();
      }
    } catch (err) {
      setTaskError(err?.message || "Lỗi cài thư viện Python.");
    } finally {
      setTaskBusy(false);
      setTaskLabel("");
    }
  };

  const handleCancelTask = async () => {
    await window.jarvisApi?.cancelSetupTask?.();
    setTaskBusy(false);
    setTaskLabel("");
  };

  const handleFinish = async () => {
    if (!acceptedTerms || finishing || taskBusy) return;
    setFinishing(true);
    try {
      await window.jarvisApi?.completeOnboarding?.({
        uiLanguage: lang,
        displayMode,
        safetyMode,
        selectedModel,
        apiKey: apiKey.trim(),
        enableApiFallback: Boolean(apiKey.trim() || diag?.backendStatus?.api_fallback_enabled),
      });
    } finally {
      setFinishing(false);
    }
  };

  const backend = diag?.backendStatus || null;
  const displays = Array.isArray(diag?.displays) ? diag.displays : [];
  const ollamaOnline = Boolean(diag?.ollamaOnline || backend?.ollama_online);
  const ollamaInstalled = Boolean(diag?.ollamaInstalled || backend?.ollama_installed || ollamaOnline);
  const installedModels = Array.isArray(diag?.ollamaModels)
    ? diag.ollamaModels
    : Array.isArray(backend?.ollama_installed_models)
      ? backend.ollama_installed_models
      : [];
  const gpuName = backend?.gpu_name || "Đang kiểm tra GPU...";
  const gpuVram = Number(backend?.gpu_vram_total_gb) || 0;

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#F8FAFC] text-[#0E0E13] flex flex-col select-none">
      {/* Fixed Header */}
      <div className="shrink-0 px-5 py-3.5 bg-[#0E0E13] text-white flex items-center justify-between gap-3 border-b-4 border-[#F43F5E]">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-white text-[#0E0E13] flex items-center justify-center font-black text-base border-2 border-[#F43F5E] shrink-0">
            ✿
          </div>
          <div className="min-w-0">
            <div className="text-sm font-black tracking-wider uppercase truncate">
              BLACK SAKURA // JARVIS-HUB
            </div>
            <div className="text-[11px] text-zinc-300 truncate">
              {lang === "en"
                ? "Windows AI Desktop Assistant · One-time setup before launching Mini HUD"
                : "Trợ lý AI điều khiển Windows · Thiết lập 1 lần duy nhất trước khi mở Mini HUD"}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] font-black shrink-0">
          <div className="flex items-center rounded-lg border border-zinc-700 overflow-hidden mr-1">
            {["vi", "en"].map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => {
                  setLang(code);
                  window.jarvisApi?.setUiLanguage?.(code);
                }}
                className={`px-2 py-1 text-[10px] font-black uppercase cursor-pointer ${
                  lang === code ? "bg-white text-[#0E0E13]" : "bg-zinc-900 text-zinc-400 hover:text-white"
                }`}
              >
                {code}
              </button>
            ))}
          </div>
          <span className={`px-2.5 py-1 rounded-lg ${step === 1 ? "bg-[#F43F5E] text-white" : "bg-zinc-800 text-zinc-400"}`}>
            {lang === "en" ? "1. Permissions" : "1. Quyền & An toàn"}
          </span>
          <span className={`px-2.5 py-1 rounded-lg ${step === 2 ? "bg-[#F43F5E] text-white" : "bg-zinc-800 text-zinc-400"}`}>
            {lang === "en" ? "2. Display & AI" : "2. Màn hình & Ollama"}
          </span>
        </div>
      </div>

      {/* Scrollable Middle Content (flex-1 min-h-0 guarantees footer is NEVER clipped) */}
      <div className="flex-1 min-h-0 overflow-y-auto jarvis-scroll px-5 py-4 space-y-3.5">
        {step === 1 ? (
          <>
            <div className="p-4 rounded-2xl bg-white border-2 border-[#0E0E13] shadow-[3px_3px_0_#0E0E13] space-y-2.5">
              <div className="flex items-center gap-2 text-sm font-black">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                <span>
                  {lang === "en"
                    ? "Security Notice & System Permissions"
                    : "Cảnh báo bảo mật & Quyền truy cập hệ thống"}
                </span>
              </div>
              <p className="text-xs text-zinc-700 leading-relaxed">
                {lang === "en" ? (
                  <>
                    This setup wizard appears <b>only once on first launch</b>. To automate Windows apps, browser tabs, and local voice commands, <b>Black Sakura Jarvis-Hub</b> requests:
                  </>
                ) : (
                  <>
                    Cửa sổ này <b>chỉ hiển thị 1 lần đầu tiên</b> sau khi tải về. Để điều khiển Windows, trình duyệt và nghe giọng nói cục bộ, <b>Black Sakura Jarvis-Hub</b> cần các quyền sau:
                  </>
                )}
              </p>
              <div className="grid grid-cols-1 gap-2 text-xs">
                <div className="p-2.5 rounded-xl bg-zinc-50 border border-[#0E0E13]/25">
                  <div className="font-black text-[#0E0E13]">
                    {lang === "en"
                      ? "1. Desktop Control (Win32 / UI Automation)"
                      : "1. Điều khiển Desktop (Win32 / UI Automation)"}
                  </div>
                  <div className="text-zinc-600 mt-0.5">
                    {lang === "en" ? (
                      <>
                        Opens/closes apps &amp; browser tabs, moves windows across displays, and sends hotkeys. <b>Automatically blocks</b> Task Manager, Registry Editor, PowerShell, password managers, and banking/crypto pages.
                      </>
                    ) : (
                      <>
                        Mở/đóng ứng dụng, đóng tab trình duyệt, chuyển màn hình, gửi phím tắt. Hệ thống <b>tự động chặn</b> tác động lên Task Manager, Registry, PowerShell, trình quản lý mật khẩu và trang ngân hàng/ví tiền ảo.
                      </>
                    )}
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-zinc-50 border border-[#0E0E13]/25">
                  <div className="font-black text-[#0E0E13]">
                    {lang === "en"
                      ? "2. Microphone, Local Backend & AI Coexistence Guard"
                      : "2. Micro, Backend cục bộ & Chống xung đột app AI khác"}
                  </div>
                  <div className="text-zinc-600 mt-0.5">
                    {lang === "en" ? (
                      <>
                        Binds strictly to <code>127.0.0.1</code> with per-session <code>X-Jarvis-Token</code>. Auto-picks a free port if <code>8765</code> is used by another AI app and protects shared GPU VRAM.
                      </>
                    ) : (
                      <>
                        Chỉ lắng nghe nội bộ <code>127.0.0.1</code> kèm mã phiên <code>X-Jarvis-Token</code> chống website lạ. Nếu cổng <code>8765</code> đang có app AI khác dùng, Hub sẽ <b>tự chuyển sang cổng trống</b> và bảo vệ VRAM khi dùng chung GPU.
                      </>
                    )}
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-zinc-50 border border-[#0E0E13]/25">
                  <div className="font-black text-[#0E0E13]">
                    {lang === "en" ? "3. Sensitive File Protection" : "3. Bảo vệ file nhạy cảm"}
                  </div>
                  <div className="text-zinc-600 mt-0.5">
                    {lang === "en" ? (
                      <>
                        Blocks reading <code>.env</code>, private keys (<code>.ssh</code>, <code>.pem</code>), and browser login profile directories.
                      </>
                    ) : (
                      <>
                        Tự động chặn đọc file <code>.env</code>, khóa <code>.ssh</code>/<code>.pem</code> và dữ liệu đăng nhập trình duyệt.
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Safety Mode Selection */}
            <div className="p-4 rounded-2xl bg-white border-2 border-[#0E0E13] shadow-[3px_3px_0_#0E0E13] space-y-2">
              <div className="text-xs font-black uppercase tracking-wider text-zinc-600">
                {lang === "en" ? "Default Execution Safety Mode" : "Chọn chế độ thực thi mặc định"}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setSafetyMode("safe")}
                  className={`p-3 rounded-xl border-2 border-[#0E0E13] text-left cursor-pointer transition-all ${
                    safetyMode === "safe"
                      ? "bg-[#0E0E13] text-white shadow-[3px_3px_0_#F43F5E]"
                      : "bg-zinc-50 text-[#0E0E13] hover:bg-zinc-100"
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-black text-xs">
                    <Shield className="w-4 h-4 shrink-0" />
                    <span>{lang === "en" ? "Safe Mode (Recommended)" : "Safe Mode (Khuyên dùng)"}</span>
                  </div>
                  <div className={`text-[11px] mt-1 ${safetyMode === "safe" ? "text-zinc-300" : "text-zinc-600"}`}>
                    {lang === "en"
                      ? "Prompts for approval before closing apps, sending hotkeys, or clicking UI."
                      : "Hỏi xác nhận trước thao tác quan trọng (đóng app, gửi phím, click sâu)."}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setSafetyMode("turbo")}
                  className={`p-3 rounded-xl border-2 border-[#0E0E13] text-left cursor-pointer transition-all ${
                    safetyMode === "turbo"
                      ? "bg-[#0E0E13] text-white shadow-[3px_3px_0_#F43F5E]"
                      : "bg-zinc-50 text-[#0E0E13] hover:bg-zinc-100"
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-black text-xs">
                    <Zap className="w-4 h-4 shrink-0 text-amber-400" />
                    <span>{lang === "en" ? "Turbo Mode (Instant)" : "Turbo Mode (Tự động)"}</span>
                  </div>
                  <div className={`text-[11px] mt-1 ${safetyMode === "turbo" ? "text-zinc-300" : "text-zinc-600"}`}>
                    {lang === "en"
                      ? "Executes immediately without confirmation prompts (security blocks remain active)."
                      : "Thực thi ngay lập tức không hỏi lại (vẫn giữ bộ lọc bảo mật hệ thống)."}
                  </div>
                </button>
              </div>
            </div>

            <label className="flex items-start gap-2.5 p-3.5 rounded-xl bg-rose-50 border-2 border-[#0E0E13] cursor-pointer">
              <input
                type="checkbox"
                checked={acceptedTerms}
                onChange={(e) => setAcceptedTerms(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-[#0E0E13] cursor-pointer shrink-0"
              />
              <span className="text-xs font-bold text-[#0E0E13] leading-snug">
                {lang === "en"
                  ? "I have read the security notice and grant local desktop automation permissions to Black Sakura Jarvis-Hub."
                  : "Tôi đã đọc cảnh báo bảo mật và đồng ý cấp quyền điều khiển desktop cục bộ cho Black Sakura Jarvis-Hub."}
              </span>
            </label>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <div className="text-xs font-black uppercase tracking-wider text-zinc-600">
                {lang === "en" ? "Hardware Detection & AI Setup" : "Tự nhận diện phần cứng & Cài đặt AI"}
              </div>
              <button
                type="button"
                onClick={loadDiagnostics}
                disabled={loadingDiag || taskBusy}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border-2 border-[#0E0E13] text-[11px] font-black cursor-pointer hover:bg-zinc-100 disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingDiag ? "animate-spin" : ""}`} />
                <span>{lang === "en" ? "Rescan" : "Quét lại"}</span>
              </button>
            </div>

            {/* Display Detection & Adaptive Scaling */}
            <div className="p-3.5 rounded-2xl bg-white border-2 border-[#0E0E13] shadow-[3px_3px_0_#0E0E13] space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-black text-xs">
                  <Monitor className="w-4 h-4 shrink-0" />
                  <span>
                    {lang === "en"
                      ? "Displays (Auto Aspect-Ratio & DPI Scaling)"
                      : "Màn hình hiển thị (Tự co giãn mọi tỷ lệ & DPI)"}
                  </span>
                </div>
                <span className="text-[10.5px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 border border-emerald-400">
                  {displays.length || 1} {lang === "en" ? "display(s)" : "màn hình"}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { id: "cursor", label: lang === "en" ? "Follow Cursor (Recommended)" : "Theo con trỏ chuột (Khuyên dùng)" },
                  { id: "primary", label: lang === "en" ? "Primary Display Only" : "Luôn ở màn hình chính" },
                  ...displays.map((d) => ({ id: `display:${d.id}`, label: d.label })),
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setDisplayMode(opt.id)}
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border-2 border-[#0E0E13] cursor-pointer ${
                      displayMode === opt.id ? "bg-[#0E0E13] text-white" : "bg-zinc-50 text-[#0E0E13] hover:bg-zinc-100"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Ollama + Model 1-Click Installer */}
            <div className="p-3.5 rounded-2xl bg-white border-2 border-[#0E0E13] shadow-[3px_3px_0_#0E0E13] space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-black text-xs">
                  <Cpu className="w-4 h-4 shrink-0" />
                  <span>{lang === "en" ? "Ollama Local AI & Models (Tier 2)" : "Ollama Local AI & Model (Tầng 2)"}</span>
                </div>
                <span
                  className={`text-[10.5px] font-black px-2 py-0.5 rounded border ${
                    backend
                      ? "bg-emerald-100 text-emerald-900 border-emerald-400"
                      : "bg-amber-100 text-amber-900 border-amber-400"
                  }`}
                >
                  {backend
                    ? `Backend OK (:${diag?.activeBackendPort || 8765})`
                    : lang === "en"
                      ? "Starting Backend..."
                      : "Backend đang khởi động..."}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="p-2 rounded-xl bg-zinc-50 border border-[#0E0E13]/20">
                  <div className="text-zinc-500 font-bold">{lang === "en" ? "GPU / Graphics" : "GPU / Đồ họa"}</div>
                  <div className="font-black text-[#0E0E13] truncate mt-0.5">
                    {gpuName} {gpuVram > 0 ? `(${gpuVram} GB VRAM)` : ""}
                  </div>
                </div>
                <div className="p-2 rounded-xl bg-zinc-50 border border-[#0E0E13]/20">
                  <div className="text-zinc-500 font-bold">{lang === "en" ? "Local Ollama Status" : "Ollama trên máy"}</div>
                  <div className="font-black text-[#0E0E13] mt-0.5 flex items-center gap-1">
                    {ollamaOnline ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span>
                          {lang === "en" ? `Running (${installedModels.length} models)` : `Đang chạy (${installedModels.length} model)`}
                        </span>
                      </>
                    ) : ollamaInstalled ? (
                      <span>{lang === "en" ? "Installed · Not running" : "Đã cài · Bấm khởi động lại"}</span>
                    ) : (
                      <span>{lang === "en" ? "Not installed (1-click below)" : "Chưa cài (có thể cài 1 chạm bên dưới)"}</span>
                    )}
                  </div>
                </div>
              </div>

              {/* 1-Click Install Ollama if not installed/online */}
              {!ollamaOnline && (
                <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-400 text-[11px] space-y-2">
                  <div className="font-bold text-amber-950">
                    {ollamaInstalled
                      ? lang === "en"
                        ? "Ollama is installed on this PC but not running yet."
                        : "Ollama đã có trên máy nhưng chưa chạy nền."
                      : lang === "en"
                        ? "No Ollama yet? Click below for 1-click official Ollama install (or skip to use Tier 1 + Cloud Gemini API)."
                        : "Chưa cài Ollama? Bấm nút bên dưới để tự tải & cài Ollama chính chủ (hoặc bỏ qua nếu chỉ dùng Tầng 1 + Gemini API Key)."}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={taskBusy}
                      onClick={handleInstallOllama}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0E0E13] text-white font-black text-[11px] cursor-pointer hover:bg-zinc-800 disabled:opacity-50"
                    >
                      <Download className="w-3.5 h-3.5 text-[#F43F5E]" />
                      <span>
                        {ollamaInstalled
                          ? lang === "en" ? "Start Ollama Now" : "Khởi động Ollama ngay"
                          : lang === "en" ? "1-Click Install Ollama" : "Tự tải & cài Ollama (1 chạm)"}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => openUrl("https://ollama.com/download")}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-[#0E0E13] font-bold text-[10.5px] cursor-pointer hover:bg-zinc-100"
                    >
                      <ExternalLink className="w-3 h-3" />
                      <span>ollama.com</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Installed models selector */}
              {installedModels.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[11px] font-bold text-zinc-600">
                    {lang === "en" ? "Installed models (click to set default):" : "Model đã có sẵn trên máy (bấm để chọn mặc định):"}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {installedModels.slice(0, 12).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setSelectedModel(m)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border-2 border-[#0E0E13] cursor-pointer ${
                          selectedModel === m ? "bg-[#0E0E13] text-white" : "bg-zinc-50 text-[#0E0E13] hover:bg-zinc-100"
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 1-Click Download Model cards */}
              {ollamaInstalled && (
                <div className="space-y-1.5 pt-1 border-t border-zinc-200">
                  <div className="text-[11px] font-bold text-zinc-600">
                    {lang === "en" ? "1-Click Download Recommended Local Models:" : "Tải nhanh model AI Local trực tiếp (1 chạm):"}
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {RECOMMENDED_MODELS.map((m) => {
                      const already = installedModels.includes(m.id);
                      return (
                        <button
                          key={m.id}
                          type="button"
                          disabled={taskBusy}
                          onClick={() => (already ? setSelectedModel(m.id) : handlePullModel(m.id))}
                          className={`p-2 rounded-xl border-2 border-[#0E0E13] text-left cursor-pointer disabled:opacity-50 ${
                            already
                              ? selectedModel === m.id
                                ? "bg-emerald-950 text-white"
                                : "bg-emerald-50 text-emerald-950 hover:bg-emerald-100"
                              : "bg-zinc-50 text-[#0E0E13] hover:bg-zinc-100"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1 font-black text-[11px]">
                            <span className="truncate">{m.id}</span>
                            {already ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                            ) : (
                              <Download className="w-3 h-3 shrink-0 text-[#F43F5E]" />
                            )}
                          </div>
                          <div className={`text-[9.5px] mt-0.5 ${already && selectedModel === m.id ? "text-emerald-200" : "text-zinc-500"}`}>
                            {m.size} · {already ? (lang === "en" ? "Installed" : "Đã có") : m.desc}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={customPullModel}
                      onChange={(e) => setCustomPullModel(e.target.value)}
                      placeholder={
                        lang === "en"
                          ? "Or enter any Ollama model name (e.g. llama3.2:3b, gemma3:4b)..."
                          : "Hoặc nhập tên model bất kỳ (vd: llama3.2:3b, gemma3:4b, qwen2.5:7b)..."
                      }
                      className="flex-1 px-2.5 py-1.5 rounded-lg bg-zinc-50 border border-[#0E0E13] text-[11px] font-medium focus:outline-none"
                    />
                    <button
                      type="button"
                      disabled={taskBusy || !customPullModel.trim()}
                      onClick={() => handlePullModel(customPullModel)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#0E0E13] text-white text-[11px] font-black cursor-pointer disabled:opacity-40"
                    >
                      <Download className="w-3 h-3" />
                      <span>{lang === "en" ? "Pull Model" : "Tải model"}</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Python deps 1-click helper if backend isn't online yet */}
              {!backend && (
                <div className="p-2.5 rounded-xl bg-zinc-100 border border-[#0E0E13]/30 text-[11px] flex items-center justify-between gap-2">
                  <span>
                    {lang === "en"
                      ? "Fresh Windows PC? Click right to auto-install Python packages."
                      : "Máy mới chưa cài gói Python? Bấm nút bên phải để cài tự động."}
                  </span>
                  <button
                    type="button"
                    disabled={taskBusy}
                    onClick={handleInstallPythonDeps}
                    className="px-2.5 py-1 rounded-lg bg-[#0E0E13] text-white font-black text-[10.5px] shrink-0 cursor-pointer disabled:opacity-50"
                  >
                    {lang === "en" ? "Install Python Deps" : "Cài Python Deps"}
                  </button>
                </div>
              )}

              {/* Live progress console */}
              {(taskBusy || taskLogs.length > 0 || taskError) && (
                <div className="p-2.5 rounded-xl bg-[#0E0E13] text-zinc-100 border-2 border-[#0E0E13] space-y-1.5 text-[10.5px]">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 font-black text-emerald-400">
                      <Terminal className="w-3.5 h-3.5" />
                      <span>
                        {taskBusy
                          ? taskLabel
                          : taskError
                            ? lang === "en" ? "Error" : "Thông báo lỗi"
                            : lang === "en" ? "Completed" : "Tiến trình hoàn tất"}
                      </span>
                    </div>
                    {taskBusy && (
                      <button
                        type="button"
                        onClick={handleCancelTask}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-600 text-white text-[10px] font-black cursor-pointer"
                      >
                        <Square className="w-2.5 h-2.5 fill-current" />
                        <span>{lang === "en" ? "Stop" : "Dừng"}</span>
                      </button>
                    )}
                  </div>
                  <div className="max-h-24 overflow-y-auto font-mono text-[10px] text-zinc-300 space-y-0.5 select-text">
                    {taskLogs.map((line, i) => (
                      <div key={i} className="break-all">
                        {line}
                      </div>
                    ))}
                    {taskError && <div className="text-rose-400 font-bold">{taskError}</div>}
                  </div>
                </div>
              )}
            </div>

            {/* Optional Tier 3 Cloud Gemini API Key */}
            <div className="p-3.5 rounded-2xl bg-white border-2 border-[#0E0E13] shadow-[3px_3px_0_#0E0E13] space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-black text-xs">
                  <KeyRound className="w-4 h-4 shrink-0" />
                  <span>
                    {lang === "en"
                      ? "Cloud Gemini API Key — Tier 3 Fallback (Optional)"
                      : "Cloud Gemini API Key — Tầng 3 cuối (Tùy chọn)"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => openUrl("https://aistudio.google.com/apikey")}
                  className="inline-flex items-center gap-1 text-[10.5px] font-black text-rose-600 hover:underline cursor-pointer"
                >
                  <span>{lang === "en" ? "Get Free Key" : "Lấy Key miễn phí"}</span>
                  <ExternalLink className="w-3 h-3" />
                </button>
              </div>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={
                  lang === "en"
                    ? "Leave empty if not needed · Paste one or comma-separated backup keys..."
                    : "Bỏ trống nếu chưa cần · Có thể dán 1 hoặc nhiều key cách nhau dấu phẩy..."
                }
                className="w-full px-3 py-2 rounded-xl bg-zinc-50 border-2 border-[#0E0E13] text-xs font-medium text-[#0E0E13] placeholder:text-zinc-400 focus:outline-none select-text"
              />
            </div>
          </>
        )}
      </div>

      {/* Fixed Sticky Footer (ALWAYS visible) */}
      <div className="shrink-0 px-5 py-3 bg-white border-t-2 border-[#0E0E13] flex items-center justify-between gap-2">
        {step === 1 ? (
          <>
            <button
              type="button"
              onClick={() => window.jarvisApi?.quitApp?.()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl font-bold text-xs bg-zinc-100 hover:bg-rose-100 text-zinc-700 hover:text-rose-700 border-2 border-[#0E0E13] cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>{lang === "en" ? "Decline & Exit" : "Từ chối & Thoát"}</span>
            </button>
            <button
              type="button"
              disabled={!acceptedTerms}
              onClick={() => setStep(2)}
              className={`inline-flex items-center gap-1.5 px-5 py-2 rounded-xl font-black text-xs border-2 border-[#0E0E13] transition-all ${
                acceptedTerms
                  ? "bg-[#0E0E13] text-white shadow-[3px_3px_0_#F43F5E] cursor-pointer hover:bg-zinc-800"
                  : "bg-zinc-200 text-zinc-400 cursor-not-allowed"
              }`}
            >
              <span>{lang === "en" ? "Continue to AI Setup" : "Tiếp tục cài đặt AI"}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={taskBusy}
              onClick={() => setStep(1)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl font-black text-xs bg-zinc-100 border-2 border-[#0E0E13] cursor-pointer hover:bg-zinc-200 disabled:opacity-40"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>{lang === "en" ? "Back" : "Quay lại"}</span>
            </button>
            <button
              type="button"
              disabled={finishing || taskBusy || !acceptedTerms}
              onClick={handleFinish}
              className={`inline-flex items-center gap-1.5 px-5 py-2 rounded-xl font-black text-xs border-2 border-[#0E0E13] transition-all ${
                !finishing && !taskBusy && acceptedTerms
                  ? "bg-[#0E0E13] text-white shadow-[3px_3px_0_#F43F5E] cursor-pointer hover:bg-zinc-800"
                  : "bg-zinc-200 text-zinc-400 cursor-not-allowed"
              }`}
            >
              <Sparkles className="w-4 h-4 text-[#F43F5E]" />
              <span>
                {finishing
                  ? lang === "en" ? "Launching Mini HUD..." : "Đang mở Mini HUD..."
                  : taskBusy
                    ? lang === "en" ? "Waiting for download..." : "Đang tải xong mới mở..."
                    : lang === "en" ? "Accept & Launch Mini HUD" : "Chấp nhận & Mở Mini HUD"}
              </span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
