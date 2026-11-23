import React, { useState } from "react";
import { motion } from "framer-motion";
import { Sparkles, EyeOff, Eye } from "lucide-react";

const DEMO_STATES = [
  { id: "idle", label: "Idle" },
  { id: "listening", label: "Listening" },
  { id: "speaking", label: "Speaking" },
  { id: "dictation", label: "Dictation" },
];

const DEMO_ROUTES = [
  { id: "mcp_local", label: "MCP", color: "text-orange-300 border-[#FF6B00]/60 bg-[#FF6B00]/15" },
  { id: "antigravity", label: "Bridge", color: "text-amber-200 border-red-500/70 bg-red-600/20" },
  { id: "vram_unload", label: "Smoke", color: "text-violet-200 border-violet-500/70 bg-violet-600/20" },
];

export function DemoToolbar({
  currentState,
  currentVfxMode,
  settingsOpen,
  onSelectState,
  onTriggerVfxDemo,
  onToggleSettings,
}) {
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <div className="fixed bottom-4 right-4 z-50" data-hub-interactive="true">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          title="Hiện thanh Demo animation"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#080a10]/95 border-2 border-cyan-400/50 text-[11px] font-bold text-cyan-200 hover:text-white sakuga-chip-shadow backdrop-blur-md cursor-pointer"
        >
          <Eye className="w-3.5 h-3.5 text-[#FF6B00]" />
          <span>Sakuga Demo</span>
        </button>
      </div>
    );
  }

  return (
    <motion.div
      data-hub-interactive="true"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="fixed bottom-4 right-4 z-50 flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-[#080a10]/95 backdrop-blur-xl border-2 border-white/20 sakuga-panel-shadow"
    >
      <span className="flex items-center gap-1 pl-1 pr-1.5 text-[10.5px] font-black tracking-wide text-cyan-300">
        <Sparkles className="w-3 h-3 text-[#FF6B00]" />
        SAKUGA
      </span>

      {DEMO_STATES.map((st) => {
        const active = currentState === st.id;
        return (
          <button
            key={st.id}
            type="button"
            onClick={() => onSelectState(st.id)}
            className={`px-2 py-1 rounded-full text-[10.5px] font-bold transition-all cursor-pointer border ${
              active
                ? "bg-cyan-500/25 text-cyan-100 border-cyan-400/80 shadow-[0_0_10px_rgba(0,229,255,0.28)]"
                : "text-zinc-400 hover:text-white hover:bg-white/[0.06] border-transparent"
            }`}
          >
            {st.label}
          </button>
        );
      })}

      <div className="w-px h-4 bg-white/15 mx-0.5" />

      {DEMO_ROUTES.map((rt) => {
        const active = currentVfxMode === rt.id && currentState !== "idle";
        return (
          <button
            key={rt.id}
            type="button"
            onClick={() => onTriggerVfxDemo?.(rt.id)}
            className={`px-2 py-0.5 rounded-full text-[10px] font-bold border transition-all cursor-pointer ${
              active
                ? rt.color
                : "text-zinc-400 border-white/10 hover:text-zinc-100 hover:bg-white/[0.06]"
            }`}
          >
            {rt.label}
          </button>
        );
      })}

      <div className="w-px h-4 bg-white/15 mx-0.5" />

      <button
        type="button"
        onClick={onToggleSettings}
        className={`px-2 py-1 rounded-full text-[10.5px] font-bold transition-all cursor-pointer border ${
          settingsOpen
            ? "bg-[#FF6B00]/25 text-orange-200 border-[#FF6B00]/75"
            : "text-zinc-300 hover:text-white hover:bg-white/[0.06] border-transparent"
        }`}
      >
        Settings
      </button>

      <button
        type="button"
        onClick={() => setCollapsed(true)}
        title="Thu gọn thanh Demo"
        className="p-1 rounded-full text-zinc-500 hover:text-zinc-200 hover:bg-white/10 cursor-pointer"
      >
        <EyeOff className="w-3.5 h-3.5" />
      </button>
    </motion.div>
  );
}
