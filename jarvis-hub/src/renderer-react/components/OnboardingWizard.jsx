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
  Copy,
  Check,
  RefreshCw,
  ArrowRight,
  ArrowLeft,
  Sparkles,
} from "lucide-react";

export function OnboardingWizard() {
  const [step, setStep] = useState(1);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [safetyMode, setSafetyMode] = useState("safe");
  const [displayMode, setDisplayMode] = useState("cursor");
  const [selectedModel, setSelectedModel] = useState("4b");
  const [apiKey, setApiKey] = useState("");
  const [diag, setDiag] = useState(null);
  const [loadingDiag, setLoadingDiag] = useState(true);
  const [copiedCmd, setCopiedCmd] = useState("");
  const [finishing, setFinishing] = useState(false);

  const loadDiagnostics = async () => {
    setLoadingDiag(true);
    try {
      const res = await window.jarvisApi?.getSetupDiagnostics?.();
      if (res?.ok) {
        setDiag(res);
        if (res.displayMode) setDisplayMode(res.displayMode);
        if (res.safetyMode === "turbo" || res.safetyMode === "safe") {
          setSafetyMode(res.safetyMode);
        }
        const models = res.backendStatus?.ollama_installed_models || [];
        if (models.length > 0 && !models.includes("qwen3.5:4b")) {
          setSelectedModel(models[0]);
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
  }, []);

  const copyCommand = async (cmd) => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopiedCmd(cmd);
      setTimeout(() => setCopiedCmd(""), 1800);
    } catch {}
  };

  const openUrl = (url) => {
    window.jarvisApi?.openExternalSafe?.(url);
  };

  const handleFinish = async () => {
    setFinishing(true);
    try {
      await window.jarvisApi?.completeOnboarding?.({
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
  const ollamaOnline = Boolean(backend?.ollama_online);
  const ollamaInstalled = Boolean(diag?.ollamaInstalled || backend?.ollama_installed);
  const installedModels = Array.isArray(backend?.ollama_installed_models) ? backend.ollama_installed_models : [];
  const gpuName = backend?.gpu_name || "Đang kiểm tra GPU...";
  const gpuVram = Number(backend?.gpu_vram_total_gb) || 0;

  return (
    <div className="min-h-screen w-full bg-[#F8FAFC] text-[#0E0E13] flex flex-col select-none">
      {/* Top Banner */}
      <div className="px-6 py-4 bg-[#0E0E13] text-white flex items-center justify-between border-b-4 border-[#F43F5E]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-white text-[#0E0E13] flex items-center justify-center font-black text-base border-2 border-[#F43F5E]">
            ✿
          </div>
          <div>
            <div className="text-sm font-black tracking-wider uppercase">
              BLACK SAKURA // JARVIS-HUB
            </div>
            <div className="text-[11px] text-zinc-300">
              Trợ lý AI điều khiển Windows · Thiết lập lần đầu trước khi bật Mini HUD
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] font-black">
          <span className={`px-2.5 py-1 rounded-lg ${step === 1 ? "bg-[#F43F5E] text-white" : "bg-zinc-800 text-zinc-400"}`}>
            1. Quyền & Cảnh báo
          </span>
          <span className={`px-2.5 py-1 rounded-lg ${step === 2 ? "bg-[#F43F5E] text-white" : "bg-zinc-800 text-zinc-400"}`}>
            2. Màn hình & AI
          </span>
        </div>
      </div>

      {/* Scrollable Body */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
        {step === 1 ? (
          <>
            <div className="p-4 rounded-2xl bg-white border-2 border-[#0E0E13] shadow-[4px_4px_0_#0E0E13] space-y-3">
              <div className="flex items-center gap-2 text-sm font-black">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                <span>Quyền truy cập & Nguyên tắc an toàn</span>
              </div>
              <p className="text-xs text-zinc-700 leading-relaxed">
                Để điều khiển ứng dụng, trình duyệt và nhận lệnh giọng nói trên Windows, <b>Black Sakura Jarvis-Hub</b> cần các quyền sau trên máy cục bộ của bạn:
              </p>
              <div className="grid grid-cols-1 gap-2 text-xs">
                <div className="p-2.5 rounded-xl bg-zinc-50 border border-[#0E0E13]/25">
                  <div className="font-black text-[#0E0E13]">1. Điều khiển Desktop (Win32 / UI Automation)</div>
                  <div className="text-zinc-600 mt-0.5">
                    Dùng để mở/đóng ứng dụng, quản lý tab trình duyệt, di chuyển cửa sổ giữa các màn hình, gửi phím tắt. Hệ thống <b>tự động chặn</b> thao tác lên Task Manager, Registry, PowerShell, trình quản lý mật khẩu và trang ngân hàng/ví điện tử.
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-zinc-50 border border-[#0E0E13]/25">
                  <div className="font-black text-[#0E0E13]">2. Microphone & Xử lý cục bộ</div>
                  <div className="text-zinc-600 mt-0.5">
                    Giọng nói được nhận diện nội bộ bằng Faster-Whisper trên máy bạn. Backend chỉ chạy trên <code>127.0.0.1</code> kèm mã xác thực phiên <code>X-Jarvis-Token</code> chống website bên ngoài truy cập trái phép.
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-zinc-50 border border-[#0E0E13]/25">
                  <div className="font-black text-[#0E0E13]">3. Bảo vệ dữ liệu nhạy cảm</div>
                  <div className="text-zinc-600 mt-0.5">
                    Chặn đọc file <code>.env</code>, private key (<code>.ssh</code>, <code>.pem</code>) và thư mục đăng nhập của trình duyệt. Bạn có thể bấm <b>Panic Stop</b> hoặc tắt từ khay hệ thống bất cứ lúc nào.
                  </div>
                </div>
              </div>
            </div>

            {/* Safety Mode Selection */}
            <div className="p-4 rounded-2xl bg-white border-2 border-[#0E0E13] shadow-[4px_4px_0_#0E0E13] space-y-2.5">
              <div className="text-xs font-black uppercase tracking-wider text-zinc-600">
                Chọn chế độ thực thi mặc định
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
                    <span>Safe Mode (Khuyên dùng)</span>
                  </div>
                  <div className={`text-[11px] mt-1 ${safetyMode === "safe" ? "text-zinc-300" : "text-zinc-600"}`}>
                    Hỏi xác nhận trước các thao tác quan trọng (đóng app, gửi phím, click sâu).
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
                    <span>Turbo Mode (Tự động)</span>
                  </div>
                  <div className={`text-[11px] mt-1 ${safetyMode === "turbo" ? "text-zinc-300" : "text-zinc-600"}`}>
                    Thực thi ngay lập tức không hỏi lại (vẫn giữ nguyên bộ lọc bảo mật chặn cửa sổ nhạy cảm).
                  </div>
                </button>
              </div>
            </div>

            <label className="flex items-start gap-2.5 p-3.5 rounded-xl bg-rose-50 border-2 border-[#0E0E13] cursor-pointer">
              <input
                type="checkbox"
                checked={acceptedTerms}
                onChange={(e) => setAcceptedTerms(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-[#0E0E13] cursor-pointer"
              />
              <span className="text-xs font-bold text-[#0E0E13] leading-snug">
                Tôi đã đọc cảnh báo bảo mật và đồng ý cấp quyền điều khiển desktop cục bộ cho Black Sakura Jarvis-Hub.
              </span>
            </label>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <div className="text-xs font-black uppercase tracking-wider text-zinc-600">
                Kiểm tra hệ thống tự động
              </div>
              <button
                type="button"
                onClick={loadDiagnostics}
                disabled={loadingDiag}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border-2 border-[#0E0E13] text-[11px] font-black cursor-pointer hover:bg-zinc-100"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingDiag ? "animate-spin" : ""}`} />
                <span>Quét lại</span>
              </button>
            </div>

            {/* Display Detection & Adaptive Scaling */}
            <div className="p-3.5 rounded-2xl bg-white border-2 border-[#0E0E13] shadow-[3px_3px_0_#0E0E13] space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-black text-xs">
                  <Monitor className="w-4 h-4 shrink-0" />
                  <span>Màn hình hiển thị (Tự động co giãn mọi tỷ lệ & DPI)</span>
                </div>
                <span className="text-[10.5px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 border border-emerald-400">
                  {displays.length || 1} màn hình
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { id: "cursor", label: "Theo con trỏ chuột (Khuyên dùng)" },
                  { id: "primary", label: "Luôn ở màn hình chính" },
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

            {/* Backend, GPU & Ollama Status */}
            <div className="p-3.5 rounded-2xl bg-white border-2 border-[#0E0E13] shadow-[3px_3px_0_#0E0E13] space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-black text-xs">
                  <Cpu className="w-4 h-4 shrink-0" />
                  <span>Hệ thống AI Local (GPU & Ollama)</span>
                </div>
                <span
                  className={`text-[10.5px] font-black px-2 py-0.5 rounded border ${
                    backend
                      ? "bg-emerald-100 text-emerald-900 border-emerald-400"
                      : "bg-amber-100 text-amber-900 border-amber-400"
                  }`}
                >
                  {backend ? `Backend OK (:${diag?.activeBackendPort || 8765})` : "Đang khởi động Backend..."}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="p-2 rounded-xl bg-zinc-50 border border-[#0E0E13]/20">
                  <div className="text-zinc-500 font-bold">Phần cứng đồ họa</div>
                  <div className="font-black text-[#0E0E13] truncate mt-0.5">
                    {gpuName} {gpuVram > 0 ? `(${gpuVram} GB VRAM)` : ""}
                  </div>
                </div>
                <div className="p-2 rounded-xl bg-zinc-50 border border-[#0E0E13]/20">
                  <div className="text-zinc-500 font-bold">Trạng thái Ollama (Tầng 2)</div>
                  <div className="font-black text-[#0E0E13] mt-0.5 flex items-center gap-1">
                    {ollamaOnline ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span>Sẵn sàng ({installedModels.length} model)</span>
                      </>
                    ) : ollamaInstalled ? (
                      <span>Đã cài · Chưa mở</span>
                    ) : (
                      <span>Chưa cài (Không bắt buộc)</span>
                    )}
                  </div>
                </div>
              </div>

              {ollamaOnline && installedModels.length > 0 ? (
                <div className="space-y-1.5">
                  <div className="text-[11px] font-bold text-zinc-600">Chọn model Ollama mặc định trên máy bạn:</div>
                  <div className="flex flex-wrap gap-1.5">
                    {installedModels.slice(0, 10).map((m) => (
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
              ) : (
                <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-400 text-[11px] space-y-2">
                  <div className="font-bold text-amber-950">
                    Chưa có Ollama? Không sao — Tầng 1 điều khiển nhanh & Cloud Gemini API vẫn chạy bình thường!
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openUrl("https://ollama.com/download")}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#0E0E13] text-white font-black text-[10.5px] cursor-pointer"
                    >
                      <ExternalLink className="w-3 h-3" />
                      <span>Tải Ollama miễn phí</span>
                    </button>
                    {["ollama pull qwen3.5:4b", "ollama pull qwen3:1.7b"].map((cmd) => (
                      <button
                        key={cmd}
                        type="button"
                        onClick={() => copyCommand(cmd)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white border border-[#0E0E13] font-mono text-[10px] font-bold cursor-pointer hover:bg-zinc-100"
                      >
                        {copiedCmd === cmd ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                        <span>{cmd}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {!backend && (
                <div className="p-2 rounded-xl bg-zinc-100 border border-[#0E0E13]/30 text-[10.5px] flex items-center justify-between gap-2">
                  <span>Nếu chạy lần đầu trên máy mới, hãy cài gói Python: <code>pip install -r requirements.txt</code></span>
                  <button
                    type="button"
                    onClick={() => copyCommand("pip install -r requirements.txt")}
                    className="px-2 py-1 rounded bg-white border border-[#0E0E13] font-bold text-[10px] shrink-0 cursor-pointer"
                  >
                    {copiedCmd === "pip install -r requirements.txt" ? "Đã copy ✓" : "Copy"}
                  </button>
                </div>
              )}
            </div>

            {/* Optional Tier 3 Cloud Gemini API Key */}
            <div className="p-3.5 rounded-2xl bg-white border-2 border-[#0E0E13] shadow-[3px_3px_0_#0E0E13] space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-black text-xs">
                  <KeyRound className="w-4 h-4 shrink-0" />
                  <span>Cloud Gemini API Key — Tầng 3 cuối (Tùy chọn)</span>
                </div>
                <button
                  type="button"
                  onClick={() => openUrl("https://aistudio.google.com/apikey")}
                  className="inline-flex items-center gap-1 text-[10.5px] font-black text-rose-600 hover:underline cursor-pointer"
                >
                  <span>Lấy Key miễn phí</span>
                  <ExternalLink className="w-3 h-3" />
                </button>
              </div>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Bỏ trống nếu chưa cần · Có thể dán 1 hoặc nhiều key cách nhau dấu phẩy..."
                className="w-full px-3 py-2 rounded-xl bg-zinc-50 border-2 border-[#0E0E13] text-xs font-medium text-[#0E0E13] placeholder:text-zinc-400 focus:outline-none"
              />
            </div>
          </>
        )}
      </div>

      {/* Footer Actions */}
      <div className="px-6 py-3.5 bg-white border-t-2 border-[#0E0E13] flex items-center justify-between">
        {step === 1 ? (
          <>
            <span className="text-[11px] text-zinc-500 font-medium">
              Bạn có thể mở lại màn hình này bất cứ lúc nào từ Cài đặt hoặc Khay hệ thống.
            </span>
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
              <span>Tiếp tục</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setStep(1)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl font-black text-xs bg-zinc-100 border-2 border-[#0E0E13] cursor-pointer hover:bg-zinc-200"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Quay lại</span>
            </button>
            <button
              type="button"
              disabled={finishing}
              onClick={handleFinish}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl font-black text-xs bg-[#0E0E13] text-white border-2 border-[#0E0E13] shadow-[3px_3px_0_#F43F5E] cursor-pointer hover:bg-zinc-800"
            >
              <Sparkles className="w-4 h-4 text-[#F43F5E]" />
              <span>{finishing ? "Đang khởi chạy..." : "Hoàn tất & Mở Mini HUD"}</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
