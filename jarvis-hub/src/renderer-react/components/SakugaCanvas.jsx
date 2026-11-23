import React, { useEffect, useImperativeHandle, useRef } from "react";
import { SakugaVfxEngine } from "../sakugaVfxEngine.js";

/**
 * Transparent full-overlay Sakuga VFX canvas layer.
 * Tracks live DOM Pill bounds on every frame (zero lag during spring expansion).
 * Automatically cancels requestAnimationFrame on IDLE or isGaming === true.
 */
export const SakugaCanvas = React.forwardRef(function SakugaCanvas(
  { enabled, isGaming, pillState, vfxMode, mood, voiceLevel, pillRef, onLoopChange },
  ref
) {
  const canvasRef = useRef(null);
  const engineRef = useRef(null);

  if (!engineRef.current) {
    engineRef.current = new SakugaVfxEngine();
  }

  const measurePill = () => {
    const el = pillRef?.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!r || r.width <= 0 || r.height <= 0) return null;
    const cs = typeof window !== "undefined" ? window.getComputedStyle(el) : null;
    const parsedRx = cs ? parseFloat(cs.borderTopLeftRadius) : NaN;
    return {
      cx: r.left + r.width / 2,
      cy: r.top + r.height / 2,
      w: r.width,
      h: r.height,
      rx: Number.isFinite(parsedRx) ? Math.min(parsedRx, r.height / 2) : Math.min(r.height / 2, 16),
    };
  };

  useImperativeHandle(
    ref,
    () => ({
      triggerBurst(mode = "listening", intensity = 1) {
        const rect = measurePill();
        if (!rect) return;
        engineRef.current.updateConfig({ pillRect: rect, pillElement: pillRef?.current || null });
        engineRef.current.spawnImpactBurst(rect.cx, rect.cy, mode, intensity);
      },
      triggerSlash(mode = "antigravity") {
        const rect = measurePill();
        if (!rect) return;
        engineRef.current.updateConfig({ pillRect: rect, pillElement: pillRef?.current || null });
        engineRef.current.spawnActionSlash(rect.cx, rect.cy, mode);
      },
      triggerVramDissolve() {
        const rect = measurePill();
        if (!rect) return;
        engineRef.current.updateConfig({ pillRect: rect, pillElement: pillRef?.current || null });
        engineRef.current.spawnVramSmokeDissolve(rect.cx, rect.cy, rect.w);
      },
      isRunning() {
        return engineRef.current.isRunning();
      },
    }),
    [pillRef]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const engine = engineRef.current;
    if (!canvas) return;
    engine.onLoopStateChange = onLoopChange || null;
    engine.attach(canvas);

    window.__sakugaEngineDebug = {
      isRunning: () => engine.isRunning(),
      getLiveCount: () => engine.live.length,
      getState: () => ({
        enabled: engine.enabled,
        isGaming: engine.isGaming,
        pillState: engine.pillState,
        vfxMode: engine.vfxMode,
      }),
    };

    const onResize = () => {
      engine.resize();
      const rect = measurePill();
      if (rect) engine.updateConfig({ pillRect: rect, pillElement: pillRef?.current || null });
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      engine.detach();
      delete window.__sakugaEngineDebug;
    };
  }, []);

  useEffect(() => {
    const engine = engineRef.current;
    const syncRect = () => {
      const rect = measurePill();
      engine.updateConfig({
        enabled: Boolean(enabled),
        isGaming: Boolean(isGaming),
        pillState,
        vfxMode,
        mood,
        voiceLevel,
        pillRect: rect,
        pillElement: pillRef?.current || null,
      });
    };
    syncRect();

    let ro = null;
    if (pillRef?.current && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(syncRect);
      ro.observe(pillRef.current);
    }
    return () => ro?.disconnect();
  }, [enabled, isGaming, pillState, vfxMode, mood, voiceLevel, pillRef]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="fixed inset-0 w-full h-full pointer-events-none z-[24]"
    />
  );
});
