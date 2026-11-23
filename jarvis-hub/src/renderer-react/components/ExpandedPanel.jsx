import React, { useState } from "react";
import { motion } from "framer-motion";
import { Volume2, FileText, Copy, Check, History, Activity } from "lucide-react";

function renderInlineMarkdown(text) {
  const parts = String(text || "").split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={idx} className="font-semibold text-white">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={idx} className="px-1 py-0.5 rounded bg-white/10 text-cyan-200 text-[10.5px] font-mono">
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

function SafeMarkdown({ text }) {
  const lines = String(text || "").split(/\r?\n/);
  return (
    <div className="space-y-1.5 text-[12px] leading-relaxed text-zinc-200">
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return null;
        if (/^[-•*]\s+/.test(trimmed)) {
          return (
            <div key={i} className="flex gap-1.5 pl-1">
              <span className="text-amber-400">•</span>
              <span>{renderInlineMarkdown(trimmed.replace(/^[-•*]\s+/, ""))}</span>
            </div>
          );
        }
        return <p key={i}>{renderInlineMarkdown(trimmed)}</p>;
      })}
    </div>
  );
}

export function ExpandedPanel({
  answerMeta,
  answerText,
  recentCommands,
  activities,
  hotkeyLabel,
  onSpeak,
  onExportWord,
  onRunCommand,
}) {
  const [copied, setCopied] = useState(false);
  const [speakingBusy, setSpeakingBusy] = useState(false);
  const [wordStatus, setWordStatus] = useState("");

  const handleCopy = () => {
    if (!answerText) return;
    navigator.clipboard.writeText(answerText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleSpeak = async () => {
    if (!answerText || speakingBusy) return;
    setSpeakingBusy(true);
    try {
      await onSpeak?.();
    } catch {}
    setSpeakingBusy(false);
  };

  const handleExportWord = async () => {
    if (!answerText || wordStatus === "busy") return;
    setWordStatus("busy");
    try {
      const res = await onExportWord?.();
      setWordStatus(res?.ok === false ? "err" : "ok");
    } catch {
      setWordStatus("err");
    }
    setTimeout(() => setWordStatus(""), 1800);
  };

  return (
    <motion.div
      data-hub-interactive="true"
      initial={{ opacity: 0, y: -8, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.96 }}
      transition={{ duration: 0.12 }}
      className="pointer-events-auto w-[436px] rounded-[16px] sakuga-manga-panel border-[3px] border-[#0E0E13] p-3.5 mt-2.5 sakuga-panel-shadow text-[#0E0E13] space-y-3"
    >
      {/* Answer Header */}
      <div className="flex items-center justify-between gap-2 pb-2 border-b-2 border-[#0E0E13]">
        <span className="text-[11px] font-black uppercase tracking-wide text-[#0E0E13] truncate">
          {answerMeta || "✨ Jarvis Hub • Sẵn sàng"}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={handleSpeak}
            disabled={!answerText || speakingBusy}
            title={answerText ? "Đọc thành tiếng bằng TTS Local" : "Chưa có câu trả lời để đọc"}
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-zinc-100 hover:bg-[#0E0E13] hover:text-white border-2 border-[#0E0E13] disabled:opacity-35 text-[10.5px] font-bold cursor-pointer transition-colors"
          >
            <Volume2 className="w-3 h-3" />
            <span>{speakingBusy ? "Đang tải..." : "Đọc"}</span>
          </button>
          <button
            type="button"
            onClick={handleExportWord}
            disabled={!answerText || wordStatus === "busy"}
            title={answerText ? "Xuất câu trả lời ra file Word (.docx)" : "Chưa có câu trả lời để xuất Word"}
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-zinc-100 hover:bg-[#0E0E13] hover:text-white border-2 border-[#0E0E13] disabled:opacity-35 text-[10.5px] font-bold cursor-pointer transition-colors"
          >
            {wordStatus === "ok" ? <Check className="w-3 h-3 text-emerald-600" /> : <FileText className="w-3 h-3" />}
            <span>{wordStatus === "busy" ? "Đang xuất..." : wordStatus === "ok" ? "Đã xuất" : wordStatus === "err" ? "Lỗi" : "Word"}</span>
          </button>
          <button
            type="button"
            onClick={handleCopy}
            disabled={!answerText}
            title={answerText ? "Sao chép vào Clipboard" : "Chưa có câu trả lời để sao chép"}
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-zinc-100 hover:bg-[#0E0E13] hover:text-white border-2 border-[#0E0E13] disabled:opacity-35 text-[10.5px] font-bold cursor-pointer transition-colors"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
            <span>{copied ? "Đã chép" : "Copy"}</span>
          </button>
        </div>
      </div>

      {/* Answer Body */}
      <div className="max-h-[190px] overflow-y-auto jarvis-scroll pr-1 text-[#0E0E13] [&_p]:text-[#0E0E13] [&_strong]:text-black [&_code]:bg-zinc-200 [&_code]:text-[#0E0E13] [&_span]:text-[#0E0E13]">
        {answerText ? (
          <SafeMarkdown text={answerText} />
        ) : (
          <p className="text-[11.5px] text-zinc-600 leading-relaxed">
            Nói <strong className="text-[#0E0E13]">"Hey Jarvis"</strong> bất kỳ lúc nào hoặc giữ{" "}
            <strong className="text-[#0E0E13]">{hotkeyLabel}</strong> để ra lệnh trực tiếp (bấm nháy để gõ nhanh).
          </p>
        )}
      </div>

      {/* Recent Commands */}
      {Array.isArray(recentCommands) && recentCommands.length > 0 && (
        <div className="pt-2 border-t-2 border-[#0E0E13]/15 space-y-1.5">
          <div className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-zinc-600">
            <History className="w-3 h-3" />
            <span>Lệnh gần đây</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {recentCommands.map((cmd) => (
              <button
                key={cmd}
                type="button"
                onClick={() => onRunCommand?.(cmd)}
                title={cmd}
                className="max-w-[190px] truncate px-2 py-1 rounded-full bg-zinc-100 hover:bg-[#0E0E13] hover:text-white border-2 border-[#0E0E13] text-[10.5px] font-bold text-[#0E0E13] cursor-pointer transition-colors"
              >
                {cmd}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* MCP Activity Log */}
      {Array.isArray(activities) && activities.length > 0 && (
        <div className="pt-2 border-t-2 border-[#0E0E13]/15 space-y-1">
          <div className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-zinc-600">
            <Activity className="w-3 h-3" />
            <span>Tiến trình MCP</span>
          </div>
          <div className="space-y-1">
            {activities.slice(0, 3).map((act, idx) => (
              <div key={`${act.toolName}-${idx}`} className="flex items-center justify-between text-[10.5px] font-semibold">
                <span className="flex items-center gap-1.5 text-[#0E0E13]">
                  <span className={act.ok ? "text-emerald-700 font-black" : "text-red-600 font-black"}>
                    {act.ok ? "✓" : "✕"}
                  </span>
                  <span className="font-mono">{act.toolName}</span>
                </span>
                <span className="text-zinc-500">{act.ms}ms</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}
