import React, { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mic,
  Pencil,
  Settings,
  X,
  Radio,
  Volume2,
  VolumeX,
  Shield,
  Zap,
  ChevronDown,
  ChevronUp,
  Square,
  AlertTriangle,
  Copy,
  Check,
  Send,
  Paperclip,
  ClipboardPaste,
  Image as ImageIcon,
  FileText,
} from "lucide-react";
import { MascotFace } from "./components/MascotFace.jsx";
import { SakugaCanvas } from "./components/SakugaCanvas.jsx";
import { SakugaClickOverlay } from "./components/SakugaClickOverlay.jsx";
import { SakugaWaveform } from "./components/SakugaWaveform.jsx";
import { SettingsDrawer } from "./components/SettingsDrawer.jsx";
import { ExpandedPanel } from "./components/ExpandedPanel.jsx";
import { useT } from "./i18n.js";
import { resolveSakugaPalette, resolveMoodTheme, routeToVfxMode } from "./sakugaVfxEngine.js";
import {
  playBeep,
  playPcm24kChunk,
  playWavBase64,
  stopAllAudioPlayback,
  hasActiveAudio,
  encodeWavBase64FromChunks,
  ensureMicReady,
  suspendAudioContext,
} from "./audio.js";

const TOOL_LABEL_MAP = {
  open_edge_url: "⚡ Edge",
  launch_app: "⚡ Mở app",
  close_app: "⚡ Tắt app",
  window_control: "⚡ Cửa sổ",
  manage_edge_tabs: "⚡ Tab Edge",
  uia_click: "⚡ Bấm UI",
  uia_read: "⚡ Đọc trang",
  scroll_window: "⚡ Cuộn",
  send_hotkey: "⚡ Phím tắt",
  set_brightness: "⚡ Độ sáng",
  export_document: "⚡ Xuất file",
  desktop_screenshot: "⚡ Nhìn màn hình",
  desktop_snapshot: "⚡ Quét UI",
};

function formatSeconds(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function App() {
  // Core 4-state UI machine: 'idle' | 'listening' | 'speaking' | 'dictation'
  const [islandState, setIslandState] = useState("idle");
  const [isVoiceCapturing, setIsVoiceCapturing] = useState(false);
  const [isBusyThinking, setIsBusyThinking] = useState(false);
  const [isErrorFace, setIsErrorFace] = useState(false);

  const [transcript, setTranscript] = useState("");
  const [inputText, setInputText] = useState("");
  const [isEditing, setIsEditing] = useState(false);

  const [speakingText, setSpeakingText] = useState("Consider it done, sir.");
  const [answerMeta, setAnswerMeta] = useState("✨ Jarvis Hub • Sẵn sàng");
  const [lastAnswerText, setLastAnswerText] = useState("");
  const [copiedShort, setCopiedShort] = useState(false);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [expandedOpen, setExpandedOpen] = useState(false);
  const [confirmReq, setConfirmReq] = useState(null);
  const [liveAct, setLiveAct] = useState(null);
  const [activities, setActivities] = useState([]);
  const [speakingBurst, setSpeakingBurst] = useState(false);

  const [voiceLevel, setVoiceLevel] = useState(0);
  const [dictationSec, setDictationSec] = useState(0);
  const [vfxMode, setVfxMode] = useState("idle");
  const [impactFlash, setImpactFlash] = useState(false);
  const [hubShake, setHubShake] = useState(false);
  const [isGaming, setIsGaming] = useState(false);
  const [isDimmed, setIsDimmed] = useState(false);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const [isAppearing, setIsAppearing] = useState(true);
  const [isHoveringHub, setIsHoveringHub] = useState(false);
  const [stagedFiles, setStagedFiles] = useState([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const stagedFilesRef = useRef([]);
  stagedFilesRef.current = stagedFiles;
  const appearTimerRef = useRef(null);
  const lastHoverStateRef = useRef(false);

  const [hubState, setHubState] = useState({
    safetyMode: "safe",
    hotkey: "ctrl+alt+space",
    wakeWordEnabled: true,
    wakeName: "Luna",
    wakeSensitivity: "balanced",
    voiceReplyAlways: false,
    recentCommands: [],
    localModelPreset: "qwen3.5:4b",
    sakugaEnabled: true,
    displayMode: "cursor",
    displays: [],
    uiLanguage: "vi",
    customDictionary: [],
    installedApps: [],
    health: { fastDesktop: true, agentDesktop: false, playwright: false },
  });
  const t = useT(hubState.uiLanguage);
  const wakeNameRef = useRef("Luna");
  wakeNameRef.current = hubState.wakeName || "Luna";
  const lastWakeClientRef = useRef(0);

  // Audio & Sakuga VFX mutable refs (kept out of React render churn)
  const pillRef = useRef(null);
  const sakugaCanvasRef = useRef(null);
  const clickOverlayRef = useRef(null);
  const prevIslandRef = useRef("idle");
  const impactTimerRef = useRef(null);
  const shakeTimerRef = useRef(null);
  const lastBurstStampRef = useRef({ el: null, ts: 0 });
  const prevGamingRef = useRef(false);
  const preBufferingRef = useRef(false);
  const streamingVoiceRef = useRef(false);
  const handsFreeVadRef = useRef(false);
  const preBufferQueueRef = useRef([]);
  const vadStartedAtRef = useRef(0);
  const vadLastSpeechAtRef = useRef(0);
  const vadSpeechFramesRef = useRef(0);
  const vadHeardSpeechRef = useRef(false);
  const autoIdleTimerRef = useRef(null);
  const liveActTimerRef = useRef(null);
  const micDownAtRef = useRef(0);
  const inputRef = useRef(null);
  const confirmReqRef = useRef(null);
  confirmReqRef.current = confirmReq;
  const settingsOpenRef = useRef(false);
  settingsOpenRef.current = settingsOpen;
  const expandedOpenRef = useRef(false);
  expandedOpenRef.current = expandedOpen;
  const isBusyRef = useRef(false);
  isBusyRef.current = isBusyThinking || streamingVoiceRef.current || islandState === "dictation";
  const turnEpochRef = useRef(0);

  // Lock top Hub pill open whenever Settings or Chi tiet drawer is visible
  useEffect(() => {
    if (settingsOpen || expandedOpen) {
      clearAutoIdle();
      if (islandState === "idle") {
        setIslandState("listening");
      }
    }
  }, [settingsOpen, expandedOpen, islandState]);

  const clearAutoIdle = () => {
    if (autoIdleTimerRef.current) {
      clearTimeout(autoIdleTimerRef.current);
      autoIdleTimerRef.current = null;
    }
  };

  const scheduleReturnIdle = useCallback(
    (delayMs = 6500) => {
      clearAutoIdle();
      autoIdleTimerRef.current = setTimeout(() => {
        if (
          !settingsOpenRef.current &&
          !expandedOpenRef.current &&
          !confirmReqRef.current &&
          !streamingVoiceRef.current &&
          document.activeElement !== inputRef.current
        ) {
          setIsEditing(false);
          setIsBusyThinking(false);
          setIsErrorFace(false);
          setIslandState("idle");
        }
      }, delayMs);
    },
    []
  );

  const sakugaOn = hubState.sakugaEnabled !== false;

  const triggerImpactFrame = useCallback(
    (mode = "listening", intensity = 1, withSlash = false) => {
      if (!sakugaOn || isGaming) return;
      clearTimeout(impactTimerRef.current);
      setImpactFlash(true);
      impactTimerRef.current = setTimeout(() => setImpactFlash(false), 40);
      requestAnimationFrame(() => {
        sakugaCanvasRef.current?.triggerBurst?.(mode, intensity);
        if (withSlash) sakugaCanvasRef.current?.triggerSlash?.(mode);
      });
    },
    [sakugaOn, isGaming]
  );

  const triggerSakugaBurst = useCallback(
    (eventOrTarget, options = {}) => {
      if (!sakugaOn || isGaming) return;
      const now = performance.now();
      const targetEl =
        eventOrTarget?.currentTarget ||
        (eventOrTarget instanceof Element ? eventOrTarget : null) ||
        eventOrTarget?.target?.closest?.("button") ||
        pillRef.current;

      // Deduplicate capture + explicit handler firing for the same click event
      if (
        !options.force &&
        targetEl &&
        lastBurstStampRef.current.el === targetEl &&
        now - lastBurstStampRef.current.ts < 80
      ) {
        return;
      }
      lastBurstStampRef.current = { el: targetEl, ts: now };

      const power =
        options.power === "heavy" || targetEl?.dataset?.sakugaPower === "heavy"
          ? "heavy"
          : "normal";

      // 1. 50ms B&W button invert flash + stepped 3-frame squash & bounce
      if (targetEl && targetEl !== pillRef.current && targetEl.classList) {
        targetEl.classList.add("sakuga-btn-invert");
        setTimeout(() => targetEl.classList?.remove("sakuga-btn-invert"), 50);

        targetEl.classList.remove("sakuga-btn-squash");
        void targetEl.offsetWidth;
        targetEl.classList.add("sakuga-btn-squash");
      }

      // 2. 90ms manga shake (2.5px) on main Hub container
      clearTimeout(shakeTimerRef.current);
      setHubShake(false);
      requestAnimationFrame(() => {
        setHubShake(true);
        shakeTimerRef.current = setTimeout(() => setHubShake(false), 90);
      });

      // 3. Fire 12fps 4-layer 2D burst at exact center of button (or Hub center)
      const rect = targetEl?.getBoundingClientRect?.();
      const cx = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
      const cy = rect ? rect.top + rect.height / 2 : 58;
      const pRect = pillRef.current?.getBoundingClientRect?.() || null;
      const fx = options.fx || targetEl?.dataset?.sakugaFx || "burst";

      clickOverlayRef.current?.spawnBurst?.(cx, cy, {
        power,
        fx,
        pillRect: pRect
          ? { left: pRect.left, top: pRect.top, width: pRect.width, height: pRect.height }
          : null,
      });
    },
    [sakugaOn, isGaming]
  );

  const triggerSakugaBurstRef = useRef(triggerSakugaBurst);
  triggerSakugaBurstRef.current = triggerSakugaBurst;

  const triggerVramDissolveFlow = useCallback(() => {
    if (!sakugaOn) return;
    setVfxMode("vram_unload");
    requestAnimationFrame(() => {
      sakugaCanvasRef.current?.triggerVramDissolve?.();
    });
  }, [sakugaOn]);

  // Fire 40ms Impact Frame + speedlines ONLY on active voice/dictation/speaking; keep standby panel calm
  useEffect(() => {
    const prev = prevIslandRef.current;
    prevIslandRef.current = islandState;
    if (islandState === "idle") {
      setVfxMode("idle");
      setImpactFlash(false);
    } else if (islandState === "dictation") {
      setVfxMode("dictation");
      if (prev === "idle") triggerImpactFrame("dictation", 1.08, false);
    } else if (islandState === "speaking") {
      setVfxMode("speaking");
      if (prev === "idle") triggerImpactFrame("speaking", 0.95, false);
    } else if (islandState === "listening") {
      if (isVoiceCapturing || isBusyThinking) {
        setVfxMode("listening");
        if (prev === "idle") triggerImpactFrame("listening", 1.08, false);
      } else {
        setVfxMode("idle");
        setImpactFlash(false);
      }
    }
  }, [islandState, isVoiceCapturing, isBusyThinking, triggerImpactFrame]);

  const lastStatusCheckAtRef = useRef(0);

  // Check backend /status ONLY when Hub is opened, throttled to once per 60s on repeated/continuous calls
  useEffect(() => {
    if (islandState === "idle") return undefined;
    let alive = true;
    let repeatId = null;
    let delayId = null;
    const INTERVAL_MS = 60000;

    const checkGaming = async () => {
      lastStatusCheckAtRef.current = Date.now();
      try {
        let data = null;
        if (window.jarvisApi?.backendRequest) {
          data = await window.jarvisApi.backendRequest("/status", null);
        }
        if (!data?.ok || !alive) return;
        const nextGaming = Boolean(data?.is_gaming);
        if (nextGaming && !prevGamingRef.current && sakugaOn) {
          sakugaCanvasRef.current?.triggerVramDissolve?.();
        }
        prevGamingRef.current = nextGaming;
        setIsGaming(nextGaming);
      } catch {}
    };

    const elapsed = Date.now() - lastStatusCheckAtRef.current;
    if (elapsed >= INTERVAL_MS) {
      checkGaming();
      repeatId = setInterval(checkGaming, INTERVAL_MS);
    } else {
      delayId = setTimeout(() => {
        if (!alive) return;
        checkGaming();
        repeatId = setInterval(checkGaming, INTERVAL_MS);
      }, INTERVAL_MS - elapsed);
    }

    return () => {
      alive = false;
      clearTimeout(delayId);
      clearInterval(repeatId);
    };
  }, [islandState, sakugaOn]);

  const collectInteractiveRects = useCallback(() => {
    const nodes = document.querySelectorAll('[data-hub-interactive="true"]');
    const rects = [];
    for (const el of nodes) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        rects.push({
          left: Math.round(r.left),
          top: Math.round(r.top),
          right: Math.round(r.right),
          bottom: Math.round(r.bottom),
          width: Math.round(r.width),
          height: Math.round(r.height),
        });
      }
    }
    return rects;
  }, []);

  const addStagedFiles = useCallback((incomingList) => {
    const items = (Array.isArray(incomingList) ? incomingList : [incomingList]).filter((f) => f && f.path);
    if (!items.length) return;
    window.jarvisApi?.pingActivity?.();
    setStagedFiles((prev) => {
      const merged = [...prev];
      for (const item of items) {
        if (!merged.some((x) => x.path.toLowerCase() === item.path.toLowerCase())) {
          merged.push(item);
        }
      }
      return merged.slice(-3);
    });
  }, []);

  const handlePickContextFile = useCallback(async () => {
    clearAutoIdle();
    const picked = await window.jarvisApi?.pickContextFile?.();
    if (Array.isArray(picked) && picked.length > 0) {
      addStagedFiles(picked);
      setVfxMode("idle");
      setIsVoiceCapturing(false);
      setIslandState("listening");
      setIsEditing(true);
      setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [addStagedFiles]);

  const handleGrabClipboard = useCallback(async () => {
    clearAutoIdle();
    const res = await window.jarvisApi?.grabClipboardContext?.();
    if (res?.ok && res.file) {
      addStagedFiles(res.file);
      setVfxMode("idle");
      setIsVoiceCapturing(false);
      setIslandState("listening");
      setIsEditing(true);
      setTimeout(() => inputRef.current?.focus(), 60);
    } else {
      setIsErrorFace(false);
      setSpeakingText(res?.error || "Clipboard chưa có ảnh hoặc file để gắn.");
      setIslandState("speaking");
      scheduleReturnIdle(3200);
    }
  }, [addStagedFiles, scheduleReturnIdle]);

  // Global Ctrl+V paste support for screenshots / copied files when Hub is active
  useEffect(() => {
    const onPaste = async (e) => {
      const dt = e.clipboardData;
      if (!dt) return;
      const files = Array.from(dt.files || []);
      if (files.length > 0) {
        const mapped = files
          .map((f) => {
            const fp = window.jarvisApi?.getFilePath?.(f) || f.path || "";
            if (!fp) return null;
            const isImg = /\.(png|jpe?g|webp|bmp|gif)$/i.test(f.name || fp);
            return { path: fp, name: f.name || fp.split(/[\\/]/).pop(), kind: isImg ? "image" : "document", sizeKb: Math.round((f.size / 1024) * 10) / 10 };
          })
          .filter(Boolean);
        if (mapped.length > 0) {
          e.preventDefault();
          addStagedFiles(mapped);
          return;
        }
      }
      const imgItem = Array.from(dt.items || []).find((it) => it.type && it.type.startsWith("image/"));
      if (imgItem) {
        const blob = imgItem.getAsFile();
        if (blob) {
          e.preventDefault();
          const reader = new FileReader();
          reader.onload = async () => {
            const saved = await window.jarvisApi?.savePastedImage?.(String(reader.result || ""));
            if (saved?.path) addStagedFiles(saved);
          };
          reader.readAsDataURL(blob);
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addStagedFiles]);

  useEffect(() => {
    const hasTypedDraft = Boolean(isEditing && inputText.trim());
    const pauseForUi = Boolean(settingsOpen || hasTypedDraft);
    if (pauseForUi && (streamingVoiceRef.current || handsFreeVadRef.current)) {
      streamingVoiceRef.current = false;
      handsFreeVadRef.current = false;
      preBufferingRef.current = false;
      setIsVoiceCapturing(false);
      setVoiceLevel(0);
    }
    if (pauseForUi || isVoiceCapturing) {
      window.jarvisApi?.pauseWake?.(true);
    } else {
      window.jarvisApi?.pauseWake?.(false);
    }
  }, [inputText, isEditing, isVoiceCapturing, settingsOpen]);

  // Transparent overlay hit-testing so clicks outside Island/Drawer pass cleanly to desktop
  useEffect(() => {
    let lastIgnored = true;
    const isInsideInteractive = (x, y) => {
      const nodes = document.querySelectorAll('[data-hub-interactive="true"]');
      for (const el of nodes) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && x >= r.left - 8 && x <= r.right + 8 && y >= r.top - 8 && y <= r.bottom + 8) {
          return true;
        }
      }
      return false;
    };
    const clearHoverAndIgnore = () => {
      if (lastHoverStateRef.current) {
        lastHoverStateRef.current = false;
        setIsHoveringHub(false);
      }
      if (!lastIgnored) {
        lastIgnored = true;
        window.jarvisApi?.setIgnoreMouse?.(true);
      }
    };
    const syncHit = (x, y) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const inside = isInsideInteractive(x, y);
      const nextIgnore = !inside;
      if (inside !== lastHoverStateRef.current) {
        lastHoverStateRef.current = inside;
        setIsHoveringHub(inside);
        if (inside) {
          setIsDimmed(false);
          setIsFadingOut(false);
        }
      }
      if (nextIgnore !== lastIgnored) {
        lastIgnored = nextIgnore;
        window.jarvisApi?.setIgnoreMouse?.(nextIgnore);
      }
    };
    const onMove = (e) => syncHit(e.clientX, e.clientY);
    const onPointerDown = (e) => {
      // Ensure immediate capture if user clicks/taps rapidly without prior hover ticks
      if (isInsideInteractive(e.clientX, e.clientY) && lastIgnored) {
        lastIgnored = false;
        window.jarvisApi?.setIgnoreMouse?.(false);
      }
    };
    const onBlur = () => {
      // Only release mouse capture on blur if hover already ended; never drop capture while user is clicking inside HUD
      if (!lastHoverStateRef.current) {
        clearHoverAndIgnore();
      }
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onPointerDown, { capture: true, passive: true });
    document.addEventListener("mouseleave", clearHoverAndIgnore);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onPointerDown, { capture: true });
      document.removeEventListener("mouseleave", clearHoverAndIgnore);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  const triggerHubAppear = useCallback(() => {
    setIsFadingOut(false);
    setIsDimmed(false);
    setIsAppearing(false);
    clearTimeout(appearTimerRef.current);
    requestAnimationFrame(() => {
      setIsAppearing(true);
      appearTimerRef.current = setTimeout(() => setIsAppearing(false), 320);
    });
  }, []);

  useEffect(() => {
    appearTimerRef.current = setTimeout(() => setIsAppearing(false), 320);
    return () => clearTimeout(appearTimerRef.current);
  }, []);

  // Authoritative Main-Process Watchdog sync (never throttled by Chromium unfocused timers!)
  useEffect(() => {
    const busy =
      Boolean(confirmReq) ||
      isBusyThinking ||
      streamingVoiceRef.current ||
      islandState === "dictation" ||
      hasActiveAudio();
    const drawerOpen = Boolean(settingsOpen || expandedOpen);
    const hasDraftText = Boolean(inputText.trim());
    const syncState = () => {
      window.jarvisApi?.reportActivityState?.({
        islandState,
        busy,
        hovering: isHoveringHub,
        drawerOpen,
        isEditing,
        hasDraftText,
        interactiveRects: collectInteractiveRects(),
      });
    };
    syncState();
    const rafId = requestAnimationFrame(syncState);
    // Re-sync after Framer Motion spring/collapse animations finish so interactiveRects never stay stale
    const animTimer1 = setTimeout(syncState, 160);
    const animTimer2 = setTimeout(syncState, 350);
    let ro = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => syncState());
      for (const el of document.querySelectorAll('[data-hub-interactive="true"]')) {
        ro.observe(el);
      }
    }
    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(animTimer1);
      clearTimeout(animTimer2);
      ro?.disconnect();
    };
  }, [
    collectInteractiveRects,
    confirmReq,
    expandedOpen,
    inputText,
    isBusyThinking,
    isEditing,
    isHoveringHub,
    islandState,
    settingsOpen,
    voiceLevel,
  ]);

  // Dictation seconds timer
  useEffect(() => {
    if (islandState !== "dictation") {
      setDictationSec(0);
      return;
    }
    const id = setInterval(() => {
      setDictationSec((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [islandState]);

  const finishVoiceRecording = useCallback(async () => {
    preBufferingRef.current = false;
    if (!streamingVoiceRef.current) {
      setIsVoiceCapturing(false);
      return;
    }
    streamingVoiceRef.current = false;
    handsFreeVadRef.current = false;
    setIsVoiceCapturing(false);

    const chunks = preBufferQueueRef.current.slice();
    preBufferQueueRef.current = [];

    let sumSq = 0;
    let totalCount = 0;
    for (const ch of chunks) {
      for (let i = 0; i < ch.length; i++) {
        const s = ch[i] / 32768;
        sumSq += s * s;
      }
      totalCount += ch.length;
    }
    const clipRms = totalCount > 0 ? Math.sqrt(sumSq / totalCount) : 0;
    const wavBase64 = totalCount >= 2400 && clipRms >= 0.003 ? encodeWavBase64FromChunks(chunks, 16000) : "";

    if (!wavBase64) {
      window.jarvisApi?.pauseWake?.(false);
      setVoiceLevel(0);
      setSpeakingText("Không nghe thấy giọng nói rõ ràng.");
      setIslandState("speaking");
      scheduleReturnIdle(2000);
      return;
    }

    clearAutoIdle();
    const myEpoch = ++turnEpochRef.current;
    const isDictationCapture = islandState === "dictation";
    setIsBusyThinking(true);
    setIsErrorFace(false);
    setIslandState("listening");
    setTranscript(isDictationCapture ? "Đang chép lời vào ô nhập..." : "Đang thực thi lệnh thoại...");
    // Re-enable wake word during execution so user can say "Hey Luna" to interrupt & override
    window.jarvisApi?.pauseWake?.(false);

    const voiceCtx = stagedFilesRef.current.length > 0 ? { files: stagedFilesRef.current } : null;
    const res = isDictationCapture
      ? await window.jarvisApi?.sendDictationWav?.(wavBase64, true)
      : await window.jarvisApi?.sendVoiceWav?.(wavBase64, "", voiceCtx);
    if (turnEpochRef.current !== myEpoch) return;
    window.jarvisApi?.pauseWake?.(false);
    setIsBusyThinking(false);
    setVoiceLevel(0);

    if (res?.cancelled) return;
    if (res?.hubSleep) {
      playBeep("ok");
      setIslandState("idle");
      return;
    }
    if (res?.emptyVoice) {
      setSpeakingText("Không nghe rõ câu lệnh — hãy thử nói lại.");
      setIslandState("speaking");
      scheduleReturnIdle(2200);
      return;
    }
    if (!res?.ok) {
      playBeep("error");
      const errMsg = res?.error || res?.reply || res?.text || "Không thể xử lý lệnh thoại";
      setIsErrorFace(true);
      setLastAnswerText(errMsg);
      setSpeakingText(errMsg);
      setIslandState("speaking");
      scheduleReturnIdle(4500);
      return;
    }
    if (res.audioWavBase64) {
      playWavBase64(
        res.audioWavBase64,
        () => {
          setVoiceLevel(0);
          if (!isBusyRef.current) scheduleReturnIdle(1800);
        },
        res.audioMimeType || "audio/wav",
        (lvl) => setVoiceLevel(lvl)
      );
    } else {
      setVoiceLevel(0);
      playBeep("ok");
    }

    const answer = res.text || "Đã xử lý xong.";
    const resMode = routeToVfxMode(res.route) || "speaking";
    setVfxMode(resMode);
    if (resMode === "vram_unload") {
      triggerVramDissolveFlow();
    } else {
      triggerImpactFrame(resMode, resMode === "antigravity" ? 1.25 : 1.05, resMode === "antigravity" || resMode === "mcp_local");
    }
    setLastAnswerText(answer);
    setAnswerMeta(res.modelLabel || "🎙️ Whisper Local");
    setSpeakingText(answer.replace(/\s+/g, " ").trim());
    setIslandState("speaking");
    if (answer.length > 110 || answer.includes("\n")) {
      setExpandedOpen(true);
    } else {
      scheduleReturnIdle(6500);
    }
  }, [islandState, scheduleReturnIdle, triggerImpactFrame, triggerVramDissolveFlow]);

  const initMicWithCallbacks = useCallback(async () => {
    await ensureMicReady(({ pcm, rms }) => {
      if (!preBufferingRef.current && !streamingVoiceRef.current) return;
      setVoiceLevel(Math.min(1, rms * 22));
      if (streamingVoiceRef.current) {
        if (preBufferQueueRef.current.length < 380) {
          preBufferQueueRef.current.push(pcm);
        }
        if (handsFreeVadRef.current) {
          const now = Date.now();
          if (rms >= 0.011) {
            vadSpeechFramesRef.current += 1;
            vadLastSpeechAtRef.current = now;
            if (vadSpeechFramesRef.current >= 3) vadHeardSpeechRef.current = true;
          } else if (!vadHeardSpeechRef.current) {
            vadSpeechFramesRef.current = 0;
          }
          if (vadHeardSpeechRef.current && now - vadLastSpeechAtRef.current >= 1250) {
            handsFreeVadRef.current = false;
            finishVoiceRecording();
          } else if (!vadHeardSpeechRef.current && now - vadStartedAtRef.current >= 6000) {
            handsFreeVadRef.current = false;
            streamingVoiceRef.current = false;
            setIsVoiceCapturing(false);
            preBufferQueueRef.current = [];
            setVoiceLevel(0);
            window.jarvisApi?.pauseWake?.(false);
            setSpeakingText("Không nghe thấy lệnh — quay về chờ.");
            setIslandState("speaking");
            scheduleReturnIdle(1800);
          } else if (now - vadStartedAtRef.current >= 18000) {
            handsFreeVadRef.current = false;
            finishVoiceRecording();
          }
        }
      } else if (preBufferingRef.current) {
        if (preBufferQueueRef.current.length < 15) preBufferQueueRef.current.push(pcm);
      }
    });
  }, [finishVoiceRecording, scheduleReturnIdle]);

  const startManualVoice = async () => {
    try {
      clearAutoIdle();
      window.jarvisApi?.pauseWake?.(true);
      micDownAtRef.current = Date.now();
      await initMicWithCallbacks();
      preBufferingRef.current = false;
      preBufferQueueRef.current = [];
      handsFreeVadRef.current = false;
      streamingVoiceRef.current = true;
      setIsVoiceCapturing(true);
      setIsEditing(false);
      setIsErrorFace(false);
      setVfxMode("listening");
      setTranscript("Đang nghe giọng nói...");
      setIslandState("listening");
      playBeep("listen");
    } catch (err) {
      setIsVoiceCapturing(false);
      window.jarvisApi?.pauseWake?.(false);
      playBeep("error");
      setIsErrorFace(true);
      setSpeakingText(err.message || "Lỗi Micro");
      setIslandState("speaking");
      scheduleReturnIdle(5000);
    }
  };

  const stopManualVoice = async () => {
    if (!streamingVoiceRef.current) return;
    const heldMs = Date.now() - micDownAtRef.current;
    if (heldMs < 350) {
      // Quick click switches cleanly into hands-free VAD mode instead of clipping short press
      handsFreeVadRef.current = true;
      vadSpeechFramesRef.current = 0;
      vadHeardSpeechRef.current = false;
      vadStartedAtRef.current = Date.now();
      vadLastSpeechAtRef.current = Date.now();
      setTranscript("Đang nghe (nói xong tự gửi)...");
      return;
    }
    if (!handsFreeVadRef.current) {
      await finishVoiceRecording();
    }
  };

  const handleStopAction = useCallback(async () => {
    clearAutoIdle();
    turnEpochRef.current += 1;
    preBufferingRef.current = false;
    streamingVoiceRef.current = false;
    handsFreeVadRef.current = false;
    setIsVoiceCapturing(false);
    preBufferQueueRef.current = [];
    setVoiceLevel(0);
    setIsBusyThinking(false);
    setIsErrorFace(false);
    setConfirmReq(null);
    stopAllAudioPlayback();
    await window.jarvisApi?.stopTurn?.();
    window.jarvisApi?.pauseWake?.(false);
    playBeep("ok");
    setTimeout(suspendAudioContext, 250);
    setSpeakingText("Đã dừng xử lý theo yêu cầu.");
    setIslandState("speaking");
    scheduleReturnIdle(2000);
  }, [scheduleReturnIdle]);

  const submitTextCommand = useCallback(
    async (rawCmd) => {
      const clean = String(rawCmd || "").trim();
      if (!clean) return;
      clearAutoIdle();
      const myEpoch = ++turnEpochRef.current;
      setInputText("");
      setIsEditing(false);
      setIsBusyThinking(true);
      setIsErrorFace(false);
      setVfxMode("listening");
      setTranscript(clean);
      setIslandState("listening");

      const promptCtx = stagedFilesRef.current.length > 0 ? { files: stagedFilesRef.current } : null;
      const res = await window.jarvisApi?.sendPrompt?.(clean, promptCtx);
      if (turnEpochRef.current !== myEpoch) return;
      setIsBusyThinking(false);

      if (res?.cancelled) return;
      if (res?.hubSleep) {
        playBeep("ok");
        setIslandState("idle");
        return;
      }
      if (!res?.ok) {
        playBeep("error");
        const errMsg = res?.error || res?.reply || res?.text || "Không thể xử lý lệnh";
        setIsErrorFace(true);
        setAnswerMeta(res?.modelLabel || "");
        setLastAnswerText(errMsg);
        setSpeakingText(errMsg);
        setIslandState("speaking");
        scheduleReturnIdle(4500);
        return;
      }
      if (res.audioWavBase64) {
        playWavBase64(
          res.audioWavBase64,
          () => {
            setVoiceLevel(0);
            if (!isBusyRef.current) scheduleReturnIdle(1800);
          },
          res.audioMimeType || "audio/wav",
          (lvl) => setVoiceLevel(lvl)
        );
      } else {
        setVoiceLevel(0);
        playBeep("ok");
      }

      const answer = res.text || "Consider it done, sir.";
      const resMode = routeToVfxMode(res.route) || "speaking";
      setVfxMode(resMode);
      if (resMode === "vram_unload") {
        triggerVramDissolveFlow();
      } else {
        triggerImpactFrame(resMode, resMode === "antigravity" ? 1.25 : 1.05, resMode === "antigravity" || resMode === "mcp_local");
      }
      setLastAnswerText(answer);
      setAnswerMeta(res.modelLabel || "⚡ Jarvis");
      setSpeakingText(answer.replace(/\s+/g, " ").trim());
      setIslandState("speaking");
      if (answer.length > 110 || answer.includes("\n")) {
        setExpandedOpen(true);
      } else {
        scheduleReturnIdle(6500);
      }
    },
    [scheduleReturnIdle, triggerImpactFrame, triggerVramDissolveFlow]
  );

  // Subscribe to Electron mainWindow IPC events
  useEffect(() => {
    window.jarvisApi?.getInitialState?.().then((st) => {
      if (st) setHubState((prev) => ({ ...prev, ...st }));
    });
    const unsub = window.jarvisApi?.onEvent?.(async (evt) => {
      if (evt.type === "ready" || evt.type === "state_sync") {
        setHubState((prev) => ({ ...prev, ...evt }));
      } else if (evt.type === "hub_appear") {
        triggerHubAppear();
        if (evt.wasHidden) {
          triggerSakugaBurstRef.current?.(pillRef.current, { power: "normal", force: true });
        }
      } else if (evt.type === "set_dimmed") {
        setIsFadingOut(false);
        setIsDimmed(Boolean(evt.dimmed));
      } else if (evt.type === "prepare_hide") {
        setIsFadingOut(true);
      } else if (evt.type === "force_hover_leave") {
        lastHoverStateRef.current = false;
        setIsHoveringHub(false);
        window.jarvisApi?.setIgnoreMouse?.(true);
      } else if (evt.type === "auto_collapse_idle" || evt.type === "hub_hidden") {
        clearAutoIdle();
        preBufferingRef.current = false;
        streamingVoiceRef.current = false;
        handsFreeVadRef.current = false;
        preBufferQueueRef.current = [];
        setIsVoiceCapturing(false);
        setIsFadingOut(false);
        setIsDimmed(false);
        setSettingsOpen(false);
        setExpandedOpen(false);
        setIsEditing(false);
        setIsBusyThinking(false);
        setIsErrorFace(false);
        setIslandState("idle");
      } else if (evt.type === "hotkey_wake") {
        try {
          if (streamingVoiceRef.current && Date.now() - lastWakeClientRef.current < 2600) {
            return;
          }
          lastWakeClientRef.current = Date.now();
          window.jarvisApi?.pauseWake?.(true);
          const wasActive =
            streamingVoiceRef.current ||
            handsFreeVadRef.current ||
            isBusyRef.current ||
            Boolean(confirmReqRef.current) ||
            hasActiveAudio();
          turnEpochRef.current += 1;
          if (wasActive) {
            streamingVoiceRef.current = false;
            handsFreeVadRef.current = false;
            setIsVoiceCapturing(false);
            setIsBusyThinking(false);
            setLiveAct(null);
            setConfirmReq(null);
            stopAllAudioPlayback();
          } else {
            setIsBusyThinking(false);
            setLiveAct(null);
          }
          clearAutoIdle();
          setIsFadingOut(false);
          setIsDimmed(false);
          setIsEditing(false);
          setIsErrorFace(false);
          setVfxMode("listening");
          setTranscript(
            wasActive
              ? "Đã hủy lệnh cũ — đọc lại lệnh mới..."
              : `${wakeNameRef.current} đang nghe...`
          );
          setIslandState("listening");
          triggerSakugaBurstRef.current?.(pillRef.current, { power: "heavy", force: true });
          playBeep(wasActive ? "reset" : "listen");

          await initMicWithCallbacks();
          preBufferingRef.current = false;
          preBufferQueueRef.current = [];
          handsFreeVadRef.current = true;
          vadSpeechFramesRef.current = 0;
          vadHeardSpeechRef.current = false;
          vadStartedAtRef.current = Date.now();
          vadLastSpeechAtRef.current = Date.now();
          streamingVoiceRef.current = true;
          setIsVoiceCapturing(true);
        } catch (err) {
          handsFreeVadRef.current = false;
          streamingVoiceRef.current = false;
          setIsVoiceCapturing(false);
          window.jarvisApi?.pauseWake?.(false);
          playBeep("error");
          setIsErrorFace(true);
          setSpeakingText(err.message || "Lỗi Micro");
          setIslandState("speaking");
        }
      } else if (evt.type === "hub_sleep") {
        clearAutoIdle();
        turnEpochRef.current += 1;
        preBufferingRef.current = false;
        streamingVoiceRef.current = false;
        handsFreeVadRef.current = false;
        setIsVoiceCapturing(false);
        setIsBusyThinking(false);
        preBufferQueueRef.current = [];
        setConfirmReq(null);
        setLiveAct(null);
        setSettingsOpen(false);
        setExpandedOpen(false);
        setIsEditing(false);
        stopAllAudioPlayback();
        setIslandState("idle");
      } else if (evt.type === "hotkey_down") {
        preBufferQueueRef.current = [];
        preBufferingRef.current = true;
        streamingVoiceRef.current = false;
        handsFreeVadRef.current = false;
        setIsVoiceCapturing(false);
        try {
          await initMicWithCallbacks();
        } catch {}
      } else if (evt.type === "hotkey_tap") {
        clearAutoIdle();
        preBufferingRef.current = false;
        streamingVoiceRef.current = false;
        handsFreeVadRef.current = false;
        setIsVoiceCapturing(false);
        preBufferQueueRef.current = [];
        setIsErrorFace(false);
        setVfxMode("idle");
        setTranscript("");
        setIslandState("listening");
        setIsEditing(true);
        setTimeout(() => inputRef.current?.focus(), 60);
      } else if (evt.type === "hotkey_hold_start") {
        clearAutoIdle();
        preBufferingRef.current = false;
        handsFreeVadRef.current = false;
        streamingVoiceRef.current = true;
        setIsVoiceCapturing(true);
        setIsEditing(false);
        setIsErrorFace(false);
        setTranscript("Đang thu giọng nói (thả phím để gửi)...");
        setIslandState("dictation");
        triggerSakugaBurstRef.current?.(pillRef.current, { power: "heavy", force: true });
        playBeep("listen");
      } else if (evt.type === "hotkey_hold_end") {
        await finishVoiceRecording();
      } else if (evt.type === "hotkey_cancelled") {
        preBufferingRef.current = false;
        streamingVoiceRef.current = false;
        handsFreeVadRef.current = false;
        setIsVoiceCapturing(false);
        preBufferQueueRef.current = [];
        window.jarvisApi?.pauseWake?.(false);
      } else if (evt.type === "user_transcript") {
        setTranscript(evt.text || "");
        setInputText(evt.text || "");
      } else if (evt.type === "status") {
        setIsBusyThinking(evt.state === "thinking");
        if (evt.detail) setTranscript(evt.detail);
        if (evt.state === "error") setIsErrorFace(true);
      } else if (evt.type === "assistant_stream") {
        setLastAnswerText(evt.text || "");
      } else if (evt.type === "audio_pcm_chunk") {
        playPcm24kChunk(evt.data);
      } else if (evt.type === "audio_clear") {
        stopAllAudioPlayback();
      } else if (evt.type === "turn_stopped" || evt.type === "turn_cancelled") {
        preBufferingRef.current = false;
        streamingVoiceRef.current = false;
        handsFreeVadRef.current = false;
        setIsVoiceCapturing(false);
        preBufferQueueRef.current = [];
        setIsBusyThinking(false);
        setConfirmReq(null);
        stopAllAudioPlayback();
        window.jarvisApi?.pauseWake?.(false);
        setSpeakingText(evt.message || "Đã dừng thao tác.");
        setIslandState("speaking");
        scheduleReturnIdle(2200);
      } else if (evt.type === "turn_done") {
        handsFreeVadRef.current = false;
        setIsVoiceCapturing(false);
        window.jarvisApi?.pauseWake?.(false);
        if (!evt.didSpeak) playBeep("ok");
        const txt = evt.text || "Consider it done, sir.";
        const resMode = routeToVfxMode(evt.route) || "speaking";
        setVfxMode(resMode);
        triggerImpactFrame(resMode, 1.05, resMode === "antigravity" || resMode === "mcp_local");
        setLastAnswerText(txt);
        setAnswerMeta("🎙️ Gemini 3.8 Live");
        setSpeakingText(txt.replace(/\s+/g, " ").trim());
        setIslandState("speaking");
        if (txt.length > 110 || txt.includes("\n")) setExpandedOpen(true);
        else scheduleReturnIdle(6500);
      } else if (evt.type === "confirm_request") {
        setConfirmReq(evt);
        playBeep("confirm");
        setVfxMode("mcp_local");
        setIslandState("listening");
      } else if (evt.type === "confirm_expired") {
        if (confirmReqRef.current?.id === evt.id) {
          setConfirmReq(null);
          setSpeakingText("Đã tự hủy yêu cầu xác nhận.");
          setIslandState("speaking");
          scheduleReturnIdle(2000);
        }
      } else if (evt.type === "activity") {
        setActivities((prev) => [evt, ...prev].slice(0, 3));
        setVfxMode("mcp_local");
        const label = TOOL_LABEL_MAP[evt.toolName] || `⚡ ${evt.toolName}`;
        setLiveAct({ text: evt.ok ? `${label} ✓` : `${label} ✕`, ok: evt.ok, toolName: evt.toolName });
        clearTimeout(liveActTimerRef.current);
        liveActTimerRef.current = setTimeout(() => setLiveAct(null), 1600);
      } else if (evt.type === "error") {
        preBufferingRef.current = false;
        streamingVoiceRef.current = false;
        handsFreeVadRef.current = false;
        setIsVoiceCapturing(false);
        preBufferQueueRef.current = [];
        setIsBusyThinking(false);
        setIsErrorFace(true);
        window.jarvisApi?.pauseWake?.(false);
        playBeep("error");
        setSpeakingText(evt.message || "Đã xảy ra lỗi.");
        setIslandState("speaking");
        scheduleReturnIdle(4500);
      }
    });
    return () => unsub?.();
  }, [finishVoiceRecording, initMicWithCallbacks, scheduleReturnIdle]);

  // Global Enter / Escape shortcuts
  useEffect(() => {
    const onKey = (e) => {
      if (confirmReqRef.current) {
        if (e.key === "Enter") {
          e.preventDefault();
          const id = confirmReqRef.current.id;
          setConfirmReq(null);
          setIsBusyThinking(true);
          setTranscript("Đang thực thi thao tác đã duyệt...");
          window.jarvisApi?.resolveConfirm?.(id, true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          const id = confirmReqRef.current.id;
          setConfirmReq(null);
          window.jarvisApi?.resolveConfirm?.(id, false);
          setSpeakingText("Đã từ chối thao tác — không thử lại.");
          setIslandState("speaking");
          scheduleReturnIdle(2000);
        }
        return;
      }
      if (e.key === "Escape") {
        if (isBusyRef.current || hasActiveAudio()) {
          e.preventDefault();
          handleStopAction();
        } else if (settingsOpen) {
          setSettingsOpen(false);
        } else if (expandedOpen) {
          setExpandedOpen(false);
        } else if (islandState !== "idle") {
          setIsEditing(false);
          setIslandState("idle");
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [expandedOpen, handleStopAction, islandState, scheduleReturnIdle, settingsOpen]);

  // Preview trigger callable cleanly from SettingsDrawer ("Test VFX")
  const handlePreviewVfx = (demoMode) => {
    clearAutoIdle();
    setIsErrorFace(false);
    setIsBusyThinking(false);
    if (demoMode === "idle") {
      setIsEditing(false);
      setSettingsOpen(false);
      setExpandedOpen(false);
      setVfxMode("idle");
      setIslandState("idle");
      return;
    }
    if (demoMode === "vram_unload") {
      triggerVramDissolveFlow();
      setSpeakingText("Đã xả VRAM — Sakuga VFX tắt (0% GPU)");
      setIslandState("speaking");
      scheduleReturnIdle(1400);
      return;
    }
    setVfxMode(demoMode);
    setIsEditing(false);
    if (demoMode === "listening") {
      setTranscript("Open Notepad...");
      setIslandState("listening");
      triggerImpactFrame("listening", 1.1, false);
    } else if (demoMode === "mcp_local") {
      setTranscript("⚡ MCP Local: fast-desktop / playwright");
      setIslandState("listening");
      triggerImpactFrame("mcp_local", 1.15, true);
    } else if (demoMode === "antigravity") {
      setTranscript("🗡️ Bridge: Antigravity Deep Action");
      setIslandState("listening");
      triggerImpactFrame("antigravity", 1.28, true);
    }
  };

  const prettyHotkey = String(hubState.hotkey || "ctrl+alt+space")
    .split("+")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" + ");

  const isSafe = hubState.safetyMode !== "turbo";
  const wakeOn = hubState.wakeWordEnabled !== false;
  const voiceOn = Boolean(hubState.voiceReplyAlways);
  const showStop = isBusyThinking || isVoiceCapturing || hasActiveAudio();

  useEffect(() => {
    if (islandState !== "speaking") {
      setSpeakingBurst(false);
      return;
    }
    setSpeakingBurst(true);
    const t = setTimeout(() => setSpeakingBurst(false), 1200);
    return () => clearTimeout(t);
  }, [islandState, speakingText]);

  const isSearchIntent = Boolean(
    (liveAct?.toolName &&
      ["desktop_snapshot", "desktop_find", "uia_read", "open_edge_url", "desktop_screenshot"].includes(liveAct.toolName)) ||
      /\b(?:tìm|search|tra\s|google|youtube|quét|đọc|chụp|nhìn)\b/i.test(transcript)
  );

  const mascotMood = isErrorFace
    ? "error"
    : islandState === "idle"
      ? isDimmed && !isHoveringHub
        ? "sleeping"
        : "idle"
      : islandState === "dictation"
        ? "listening"
        : islandState === "speaking"
          ? voiceLevel > 0.035 || speakingBurst || hasActiveAudio()
            ? "speaking"
            : "happy"
          : liveAct || vfxMode === "mcp_local" || vfxMode === "antigravity"
            ? isSearchIntent
              ? "searching"
              : "working"
            : isBusyThinking
              ? isSearchIntent
                ? "searching"
                : "thinking"
              : isVoiceCapturing
                ? "listening"
                : "idle";

  const activePal = resolveSakugaPalette(vfxMode, islandState);
  const activeMoodTheme = resolveMoodTheme(mascotMood, vfxMode);

  const pillBorderStyle =
    islandState === "idle"
      ? mascotMood === "sleeping"
        ? {
            boxShadow: "4px 4px 0px #000000, 0 0 11px rgba(124, 58, 237, 0.22)",
            transition: "box-shadow 220ms ease",
          }
        : { transition: "box-shadow 220ms ease" }
      : {
          boxShadow: `5px 5px 0px #000000, 0 0 10px ${activeMoodTheme.glow}`,
          transition: "box-shadow 220ms ease",
        };

  // Monochrome Comic Action Panel classes (gentle glow when shrunk, Minecraft pixel fire aura when expanded!)
  const pillClasses =
    islandState === "idle"
      ? `w-[138px] h-[42px] rounded-full sakuga-idle-pill border-[3px] border-[#0E0E13] sakuga-pill-shadow ${
          !isGaming && mascotMood !== "sleeping" ? "sakuga-idle-glow" : ""
        } cursor-pointer flex items-center justify-center hover:scale-[1.03] transition-transform`
      : islandState === "dictation"
        ? "w-[116px] h-[64px] rounded-[16px] sakuga-manga-panel border-[3px] border-[#0E0E13] sakuga-pill-shadow cursor-pointer flex flex-col items-center justify-center gap-1 px-2"
        : "w-[436px] min-h-[88px] rounded-[16px] sakuga-manga-panel border-[3px] border-[#0E0E13] px-3.5 py-2.5 flex flex-col justify-between gap-2";

  return (
    <div className="w-full h-full pointer-events-none relative">
      {/* Transparent Full-Overlay Sakuga VFX Canvas (tracks real-time Pill bounds, 0% GPU in IDLE/Gaming) */}
      <SakugaCanvas
        ref={sakugaCanvasRef}
        enabled={sakugaOn}
        isGaming={isGaming}
        pillState={
          islandState === "listening" && !isVoiceCapturing && !isBusyThinking && !liveAct && !confirmReq
            ? "idle"
            : islandState
        }
        vfxMode={vfxMode}
        mood={mascotMood}
        voiceLevel={voiceLevel}
        pillRef={pillRef}
      />

      {/* 12fps Interactive Button Click VFX Canvas Overlay (~420ms per burst, 0% GPU at rest) */}
      <SakugaClickOverlay ref={clickOverlayRef} />

      {/* Unified Top-Center Floating Dynamic Island + Attached Drawers (24px clear headroom from top edge) */}
      <div
        onClickCapture={(e) => {
          setIsDimmed(false);
          setIsFadingOut(false);
          window.jarvisApi?.pingActivity?.();
          const btn = e.target?.closest?.("button");
          if (btn && btn.dataset?.noSakuga !== "true") triggerSakugaBurst(btn);
        }}
        className={`fixed top-6 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center pointer-events-none transition-[opacity,transform,filter] duration-300 ${
          hubShake ? "sakuga-hub-shake" : ""
        } ${isAppearing ? "sakuga-hub-appear" : ""} ${
          isFadingOut
            ? "opacity-0 scale-90"
            : isDimmed && islandState === "idle" && !isHoveringHub
              ? "opacity-25 scale-[0.95] saturate-75"
              : "opacity-100 scale-100"
        }`}
      >
        <motion.div
          ref={pillRef}
          layout
          data-hub-interactive="true"
          transition={{ type: "spring", stiffness: 450, damping: 28 }}
          style={pillBorderStyle}
          onDragEnter={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDragOver(true);
            setIsDimmed(false);
            window.jarvisApi?.pingActivity?.();
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!isDragOver) setIsDragOver(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            if (!e.currentTarget.contains(e.relatedTarget)) {
              setIsDragOver(false);
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDragOver(false);
            const files = Array.from(e.dataTransfer?.files || []);
            const mapped = files
              .map((f) => {
                const fp = window.jarvisApi?.getFilePath?.(f) || f.path || "";
                if (!fp) return null;
                const isImg = /\.(png|jpe?g|webp|bmp|gif)$/i.test(f.name || fp);
                return {
                  path: fp,
                  name: f.name || fp.split(/[\\/]/).pop(),
                  kind: isImg ? "image" : "document",
                  sizeKb: Math.round((f.size / 1024) * 10) / 10,
                };
              })
              .filter(Boolean);
            if (mapped.length > 0) {
              addStagedFiles(mapped);
              clearAutoIdle();
              setVfxMode("idle");
              setIsVoiceCapturing(false);
              setIslandState("listening");
              setIsEditing(true);
              setTimeout(() => inputRef.current?.focus(), 60);
            }
          }}
          onClick={(e) => {
            if (islandState === "idle") {
              triggerSakugaBurst(e, { power: "heavy" });
              clearAutoIdle();
              setVfxMode("idle");
              setIsVoiceCapturing(false);
              setTranscript("");
              setIslandState("listening");
              setIsEditing(true);
              setTimeout(() => inputRef.current?.focus(), 60);
            } else if (islandState === "dictation") {
              triggerSakugaBurst(e);
              if (streamingVoiceRef.current) finishVoiceRecording();
              else setIslandState("idle");
            }
          }}
          className={`${pillClasses} ${impactFlash ? "sakuga-impact-invert" : ""} ${
            isDragOver ? "ring-4 ring-[#0E0E13] border-dashed scale-[1.03]" : ""
          } pointer-events-auto relative overflow-hidden text-[#0E0E13]`}
        >
          {/* Drag-Over Manga Dropzone Banner */}
          {isDragOver && (
            <div className="absolute inset-0 z-30 bg-white/95 flex items-center justify-center gap-1.5 text-[11px] font-black uppercase tracking-wide text-[#0E0E13] border-2 border-dashed border-[#0E0E13] rounded-[14px]">
              <Paperclip className="w-3.5 h-3.5" />
              <span>{t.dropFilesHere}</span>
            </div>
          )}

          {/* Retro Monochrome CRT Glass Sheen & Slow Scan Beam (zero GPU when Idle/Gaming) */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 crt-glass-sheen" />
          {islandState !== "idle" && sakugaOn && !isGaming && (
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 h-8 crt-scan-beam" />
          )}

          {/* STATE: IDLE */}
          {islandState === "idle" && (
            <div className="flex items-center justify-center w-full h-full relative">
              <MascotFace state={mascotMood} vfxMode="idle" sakugaEnabled={sakugaOn} voiceLevel={voiceLevel} />
              {stagedFiles.length > 0 && (
                <span
                  title={`Đang gắn ${stagedFiles.length} file ngữ cảnh`}
                  className="absolute right-2 flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-[#0E0E13] text-white text-[9px] font-black"
                >
                  <Paperclip className="w-2.5 h-2.5" />
                  {stagedFiles.length}
                </span>
              )}
            </div>
          )}

          {/* STATE: DICTATION */}
          {islandState === "dictation" && (
            <>
              <MascotFace
                state="dictation"
                vfxMode={vfxMode}
                sakugaEnabled={sakugaOn}
                voiceLevel={voiceLevel}
              />
              <SakugaWaveform
                voiceLevel={voiceLevel}
                vfxMode={vfxMode}
                pillState={islandState}
                sakugaEnabled={sakugaOn}
                isGaming={isGaming}
              />
              <div className="flex items-center gap-1.5 text-[11px] font-mono font-black text-[#0E0E13]">
                <span className="w-2 h-2 rounded-full bg-red-600 animate-pulse border border-[#0E0E13]" />
                <span>{formatSeconds(dictationSec)}</span>
              </div>
            </>
          )}

          {/* STATE: LISTENING (Option 1 Spotlight Bar + Anime Manga Buttons + 3-Color Outer Border Aura) */}
          {islandState === "listening" && (
            <>
              {/* Row 1: Anime Safe/Turbo | Center Mascot | Anime Settings + Close (or Stop) */}
              <div className="relative flex items-center justify-between w-full min-h-[30px]">
                <div className="flex items-center gap-1.5 z-10">
                  {liveAct ? (
                    <span
                      className="h-[22px] inline-flex items-center px-2.5 rounded-full sakuga-btn-sm text-[9.5px] font-black text-white"
                      style={{ backgroundColor: liveAct.ok ? "#FF6B00" : "#0E0E13" }}
                    >
                      {liveAct.text}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        triggerSakugaBurst(e, { power: "heavy", fx: "lightning" });
                        window.jarvisApi?.toggleSafetyMode?.();
                      }}
                      title="Chuyển Safe / Turbo"
                      className={`h-[22px] inline-flex items-center gap-1 px-2.5 rounded-full sakuga-btn-sm text-[9.5px] font-black cursor-pointer ${
                        isSafe
                          ? "bg-white hover:bg-zinc-100 text-[#0E0E13]"
                          : "bg-[#FF6B00] text-white"
                      }`}
                    >
                      {isSafe ? <Shield className="w-2.5 h-2.5" /> : <Zap className="w-2.5 h-2.5" />}
                      <span>{isSafe ? "Safe" : "Turbo"}</span>
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    if (settingsOpen || expandedOpen) {
                      setSettingsOpen(false);
                      setExpandedOpen(false);
                    } else {
                      setIslandState("idle");
                    }
                  }}
                  title={settingsOpen || expandedOpen ? "Đóng bảng" : "Thu về Idle"}
                  className="absolute left-1/2 -translate-x-1/2 cursor-pointer focus:outline-none"
                >
                  <MascotFace
                    state={mascotMood}
                    vfxMode={vfxMode}
                    sakugaEnabled={sakugaOn}
                    voiceLevel={voiceLevel}
                  />
                </button>

                <div className="flex items-center gap-1.5 z-10">
                  {showStop ? (
                    <button
                      type="button"
                      data-sakuga-power="heavy"
                      onClick={(e) => {
                        triggerSakugaBurst(e, { power: "heavy" });
                        handleStopAction();
                      }}
                      title="Dừng ngay (Esc)"
                      className="h-6 flex items-center gap-1 px-2.5 rounded-full sakuga-btn-sm bg-[#FF6B00] hover:bg-orange-600 text-white text-[10px] font-black cursor-pointer"
                    >
                      <Square className="w-2.5 h-2.5 fill-current" />
                      <span>Dừng</span>
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        data-sakuga-fx="smoke"
                        onClick={(e) => {
                          triggerSakugaBurst(e, { fx: "smoke" });
                          clearAutoIdle();
                          setAttachMenuOpen(false);
                          setSettingsOpen((s) => {
                            const next = !s;
                            if (next) setExpandedOpen(false);
                            return next;
                          });
                        }}
                        title="Cài đặt (Settings)"
                        className={`w-6 h-6 inline-flex items-center justify-center rounded-full sakuga-btn-sm cursor-pointer ${
                          settingsOpen
                            ? "bg-[#0E0E13] text-white"
                            : "bg-white text-[#0E0E13] hover:bg-[#0E0E13] hover:text-white"
                        }`}
                      >
                        <Settings className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        data-no-sakuga="true"
                        onPointerDown={(e) => {
                          e.stopPropagation();
                        }}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          clearAutoIdle();
                          setAttachMenuOpen(false);
                          setSettingsOpen(false);
                          setExpandedOpen(false);
                          stopAllAudioPlayback();
                          if (e.shiftKey) {
                            window.jarvisApi?.quitApp?.();
                          } else {
                            window.jarvisApi?.hideWindow?.();
                          }
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          window.jarvisApi?.quitApp?.();
                        }}
                        title={t.hideTitle}
                        aria-label="Hide Hub"
                        className="relative z-30 w-7 h-7 inline-flex items-center justify-center rounded-full sakuga-btn-sm bg-white text-[#0E0E13] hover:bg-[#0E0E13] hover:text-white cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5 pointer-events-none" />
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Row 2: Crisp Manga Spotlight Bar (📎 inside left, ▶ inside right on text) + Hero Anime Mic */}
              <div className="flex items-center gap-2 w-full">
                <SakugaWaveform
                  voiceLevel={voiceLevel}
                  vfxMode={vfxMode}
                  mood={mascotMood}
                  pillState={islandState}
                  sakugaEnabled={sakugaOn}
                  isGaming={isGaming}
                />

                <div className="flex-1 min-w-0 h-8 bg-white border-2 border-[#0E0E13] rounded-full pl-1 pr-1 flex items-center gap-1 shadow-[2px_2px_0_#000000]">
                  <button
                    type="button"
                    onClick={() => setAttachMenuOpen((v) => !v)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setAttachMenuOpen(false);
                      handleGrabClipboard();
                    }}
                    title="Đính kèm File / Ảnh (Chuột phải: dán Clipboard)"
                    className={`w-6 h-6 shrink-0 inline-flex items-center justify-center rounded-full border-[1.5px] border-[#0E0E13] transition-colors cursor-pointer ${
                      stagedFiles.length > 0 || attachMenuOpen
                        ? "bg-[#0E0E13] text-white"
                        : "bg-white text-[#0E0E13] hover:bg-zinc-100"
                    }`}
                  >
                    <Paperclip className="w-3 h-3" />
                  </button>

                  {isEditing ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        setAttachMenuOpen(false);
                        triggerSakugaBurst(e.currentTarget.querySelector('button[type="submit"]') || pillRef.current, {
                          power: "heavy",
                        });
                        submitTextCommand(inputText);
                      }}
                      className="flex-1 min-w-0 flex items-center gap-1"
                    >
                      <input
                        ref={inputRef}
                        type="text"
                        value={inputText}
                        onChange={(e) => {
                          setInputText(e.target.value);
                          window.jarvisApi?.pingActivity?.();
                        }}
                        onBlur={() => {
                          setTimeout(() => {
                            if (
                              !inputRef.current?.value?.trim() &&
                              !lastHoverStateRef.current &&
                              !settingsOpenRef.current &&
                              !expandedOpenRef.current &&
                              !confirmReqRef.current &&
                              !isBusyRef.current
                            ) {
                              scheduleReturnIdle(2200);
                            }
                          }, 180);
                        }}
                        placeholder={
                          wakeOn
                            ? t.typePlaceholderWake(hubState.wakeName || "Luna")
                            : t.typePlaceholderNoWake
                        }
                        className="w-full min-w-0 bg-transparent px-1 text-[12px] font-bold text-[#0E0E13] placeholder:text-zinc-400 focus:outline-none"
                      />
                      {inputText.trim().length > 0 && (
                        <button
                          type="submit"
                          data-sakuga-power="heavy"
                          onClick={(e) => triggerSakugaBurst(e, { power: "heavy" })}
                          title={t.sendTitle}
                          className="w-6 h-6 shrink-0 inline-flex items-center justify-center rounded-full bg-[#0E0E13] hover:opacity-85 text-white border border-[#0E0E13] cursor-pointer"
                        >
                          <Send className="w-3 h-3" />
                        </button>
                      )}
                    </form>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        triggerSakugaBurst(e);
                        clearAutoIdle();
                        setIsEditing(true);
                        setTimeout(() => inputRef.current?.focus(), 40);
                      }}
                      className="flex-1 min-w-0 text-left truncate px-1 text-[12px] font-bold italic text-[#0E0E13] hover:opacity-75 cursor-text"
                      title={t.typePlaceholderNoWake}
                    >
                      {isVoiceCapturing || isBusyThinking
                        ? transcript || t.listeningFallback
                        : transcript ||
                          (wakeOn
                            ? t.readyWakeHint(hubState.wakeName || "Luna")
                            : t.typePlaceholderNoWake)}
                    </button>
                  )}
                </div>

                {/* Single Hero Anime Mic Button */}
                <button
                  type="button"
                  data-sakuga-power="heavy"
                  onMouseDown={(e) => {
                    triggerSakugaBurst(e, { power: "heavy" });
                    startManualVoice();
                  }}
                  onMouseUp={stopManualVoice}
                  onClick={(e) => triggerSakugaBurst(e)}
                  title={t.holdMicTitle}
                  className={`w-8 h-8 shrink-0 inline-flex items-center justify-center rounded-full sakuga-btn cursor-pointer ${
                    isVoiceCapturing
                      ? "bg-[#0E0E13] text-white"
                      : "bg-white hover:bg-[#0E0E13] hover:text-white text-[#0E0E13]"
                  }`}
                >
                  <Mic className="w-4 h-4" />
                </button>
              </div>

              {/* Row 3: Decluttered Anime Pill Footer */}
              <div className="flex items-center justify-between pt-1.5 border-t border-[#0E0E13]/15 text-[10px]">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={(e) => {
                      triggerSakugaBurst(e, { fx: "lightning" });
                      const nextWake = !wakeOn;
                      window.jarvisApi?.setWakeWord?.(nextWake);
                      if (nextWake && !isVoiceCapturing && !isBusyThinking && !confirmReq) {
                        setIsEditing(false);
                        setVfxMode("idle");
                        setTranscript(`Wake ${t.on} — 'Hey ${hubState.wakeName || "Luna"}'`);
                        if (!settingsOpen && !expandedOpen) {
                          scheduleReturnIdle(2000);
                        }
                      }
                    }}
                    className={`h-[22px] inline-flex items-center gap-1 px-2.5 rounded-full sakuga-btn-sm font-black cursor-pointer ${
                      wakeOn ? "bg-[#0E0E13] text-white" : "bg-white text-[#0E0E13] hover:bg-zinc-100"
                    }`}
                    title={`Wake 'OK ${hubState.wakeName || "Luna"}'`}
                  >
                    <Radio className="w-2.5 h-2.5" />
                    <span>Wake</span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      triggerSakugaBurst(e, { fx: "smoke" });
                      window.jarvisApi?.setVoiceAlways?.(!voiceOn);
                    }}
                    className={`h-[22px] inline-flex items-center gap-1 px-2.5 rounded-full sakuga-btn-sm font-black cursor-pointer ${
                      voiceOn ? "bg-[#0E0E13] text-white" : "bg-white text-[#0E0E13] hover:bg-zinc-100"
                    }`}
                    title={t.voiceToggleTitle}
                  >
                    {voiceOn ? <Volume2 className="w-2.5 h-2.5" /> : <VolumeX className="w-2.5 h-2.5" />}
                    <span>{voiceOn ? t.voiceLabel : t.muteLabel}</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={(e) => {
                    triggerSakugaBurst(e, { fx: "slash" });
                    clearAutoIdle();
                    setAttachMenuOpen(false);
                    setExpandedOpen((v) => {
                      const next = !v;
                      if (next) setSettingsOpen(false);
                      return next;
                    });
                  }}
                  className={`h-[22px] inline-flex items-center gap-1 px-2.5 rounded-full sakuga-btn-sm font-black whitespace-nowrap cursor-pointer ${
                    expandedOpen ? "bg-[#0E0E13] text-white" : "bg-white text-[#0E0E13] hover:bg-zinc-100"
                  }`}
                  title={t.detailsTitle}
                >
                  <span>{t.details}</span>
                  {expandedOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
              </div>
            </>
          )}

          {/* STATE: SPEAKING (Option 1 Spotlight Bar + Anime Manga Buttons + 3-Color Outer Border Aura) */}
          {islandState === "speaking" && (
            <>
              <div className="relative flex items-center justify-between w-full min-h-[30px]">
                <button
                  type="button"
                  onClick={(e) => {
                    triggerSakugaBurst(e, { power: "heavy", fx: "lightning" });
                    window.jarvisApi?.toggleSafetyMode?.();
                  }}
                  title="Chuyển Safe / Turbo"
                  className={`h-[22px] inline-flex items-center gap-1 px-2.5 rounded-full sakuga-btn-sm text-[9.5px] font-black z-10 cursor-pointer ${
                    isSafe
                      ? "bg-white hover:bg-zinc-100 text-[#0E0E13]"
                      : "bg-[#FF6B00] text-white"
                  }`}
                >
                  {isSafe ? <Shield className="w-2.5 h-2.5" /> : <Zap className="w-2.5 h-2.5" />}
                  <span>{isSafe ? "Safe" : "Turbo"}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (settingsOpen || expandedOpen) {
                      setSettingsOpen(false);
                      setExpandedOpen(false);
                    } else {
                      setIslandState("idle");
                    }
                  }}
                  title={settingsOpen || expandedOpen ? "Đóng bảng" : "Thu về Idle"}
                  className="absolute left-1/2 -translate-x-1/2 cursor-pointer focus:outline-none"
                >
                  <MascotFace
                    state={mascotMood}
                    vfxMode={vfxMode}
                    sakugaEnabled={sakugaOn}
                    voiceLevel={voiceLevel}
                  />
                </button>

                <div className="flex items-center gap-1.5 z-10">
                  {showStop ? (
                    <button
                      type="button"
                      data-sakuga-power="heavy"
                      onClick={(e) => {
                        triggerSakugaBurst(e, { power: "heavy" });
                        handleStopAction();
                      }}
                      className="h-6 flex items-center gap-1 px-2.5 rounded-full sakuga-btn-sm bg-[#FF6B00] hover:bg-orange-600 text-white text-[10px] font-black cursor-pointer"
                    >
                      <Square className="w-2.5 h-2.5 fill-current" />
                      <span>Dừng</span>
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        data-sakuga-fx="smoke"
                        onClick={(e) => {
                          triggerSakugaBurst(e, { fx: "smoke" });
                          clearAutoIdle();
                          setAttachMenuOpen(false);
                          setSettingsOpen((s) => {
                            const next = !s;
                            if (next) setExpandedOpen(false);
                            return next;
                          });
                        }}
                        title="Settings"
                        className={`w-6 h-6 inline-flex items-center justify-center rounded-full sakuga-btn-sm cursor-pointer ${
                          settingsOpen
                            ? "bg-[#0E0E13] text-white"
                            : "bg-white text-[#0E0E13] hover:bg-[#0E0E13] hover:text-white"
                        }`}
                      >
                        <Settings className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        data-no-sakuga="true"
                        onPointerDown={(e) => {
                          e.stopPropagation();
                        }}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          clearAutoIdle();
                          setAttachMenuOpen(false);
                          setSettingsOpen(false);
                          setExpandedOpen(false);
                          stopAllAudioPlayback();
                          if (e.shiftKey) {
                            window.jarvisApi?.quitApp?.();
                          } else {
                            window.jarvisApi?.hideWindow?.();
                          }
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          window.jarvisApi?.quitApp?.();
                        }}
                        title={t.hideTitle}
                        aria-label="Hide Hub"
                        className="relative z-30 w-7 h-7 inline-flex items-center justify-center rounded-full sakuga-btn-sm bg-white text-[#0E0E13] hover:bg-[#0E0E13] hover:text-white cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5 pointer-events-none" />
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 w-full">
                <SakugaWaveform
                  voiceLevel={voiceLevel}
                  vfxMode={vfxMode}
                  mood={mascotMood}
                  pillState={islandState}
                  sakugaEnabled={sakugaOn}
                  isGaming={isGaming}
                />

                <div className="flex-1 min-w-0 h-8 bg-white border-2 border-[#0E0E13] rounded-full pl-1 pr-1.5 flex items-center gap-1.5 shadow-[2px_2px_0_#000000]">
                  <button
                    type="button"
                    onClick={() => setAttachMenuOpen((v) => !v)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setAttachMenuOpen(false);
                      handleGrabClipboard();
                    }}
                    title="Đính kèm File / Ảnh"
                    className={`w-6 h-6 shrink-0 inline-flex items-center justify-center rounded-full border-[1.5px] border-[#0E0E13] transition-colors cursor-pointer ${
                      stagedFiles.length > 0 || attachMenuOpen
                        ? "bg-[#0E0E13] text-white"
                        : "bg-white text-[#0E0E13] hover:bg-zinc-100"
                    }`}
                  >
                    <Paperclip className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      clearAutoIdle();
                      setExpandedOpen((v) => {
                        const next = !v;
                        if (next) setSettingsOpen(false);
                        return next;
                      });
                    }}
                    className="flex-1 min-w-0 text-left truncate text-[12px] font-bold italic text-[#0E0E13] hover:opacity-75 cursor-pointer"
                    title={speakingText}
                  >
                    {speakingText || "Consider it done, sir."}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      triggerSakugaBurst(e);
                      navigator.clipboard.writeText(lastAnswerText || speakingText);
                      setCopiedShort(true);
                      setTimeout(() => setCopiedShort(false), 1200);
                    }}
                    title="Sao chép nhanh"
                    className="w-6 h-6 shrink-0 inline-flex items-center justify-center rounded-full border-[1.5px] border-[#0E0E13] bg-white text-[#0E0E13] hover:bg-[#0E0E13] hover:text-white cursor-pointer"
                  >
                    {copiedShort ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  </button>
                </div>

                <button
                  type="button"
                  data-sakuga-power="heavy"
                  onMouseDown={(e) => {
                    triggerSakugaBurst(e, { power: "heavy" });
                    startManualVoice();
                  }}
                  onMouseUp={stopManualVoice}
                  onClick={(e) => triggerSakugaBurst(e)}
                  title="Nói tiếp"
                  className="w-8 h-8 shrink-0 inline-flex items-center justify-center rounded-full bg-white hover:bg-[#0E0E13] hover:text-white sakuga-btn text-[#0E0E13] cursor-pointer"
                >
                  <Mic className="w-4 h-4" />
                </button>
              </div>

              <div className="flex items-center justify-between pt-1.5 border-t border-[#0E0E13]/15 text-[10px]">
                <button
                  type="button"
                  onClick={(e) => {
                    triggerSakugaBurst(e, { fx: "slash" });
                    clearAutoIdle();
                    setVfxMode("idle");
                    setIsVoiceCapturing(false);
                    setTranscript("");
                    setIslandState("listening");
                    setIsEditing(true);
                    setTimeout(() => inputRef.current?.focus(), 40);
                  }}
                  className="h-[22px] inline-flex items-center gap-1 px-2.5 rounded-full sakuga-btn-sm bg-white hover:bg-zinc-100 font-black text-[#0E0E13] cursor-pointer"
                >
                  <span>{t.newCommand}</span>
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    triggerSakugaBurst(e, { fx: "slash" });
                    clearAutoIdle();
                    setAttachMenuOpen(false);
                    setExpandedOpen((v) => {
                      const next = !v;
                      if (next) setSettingsOpen(false);
                      return next;
                    });
                  }}
                  className={`h-[22px] inline-flex items-center gap-1 px-2.5 rounded-full sakuga-btn-sm font-black whitespace-nowrap cursor-pointer ${
                    expandedOpen ? "bg-[#0E0E13] text-white" : "bg-white hover:bg-zinc-100 text-[#0E0E13]"
                  }`}
                >
                  <span>{t.details}</span>
                  {expandedOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
              </div>
            </>
          )}
        </motion.div>

        {/* Mini Attach Menu Popover (Chọn File từ máy / Dán từ Clipboard) */}
        <AnimatePresence>
          {attachMenuOpen && islandState !== "idle" && (
            <motion.div
              data-hub-interactive="true"
              initial={{ opacity: 0, y: -4, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.96 }}
              transition={{ duration: 0.1 }}
              className="w-[436px] mt-1.5 p-1.5 rounded-xl bg-white border-2 border-[#0E0E13] sakuga-chip-shadow flex items-center gap-1.5 pointer-events-auto"
            >
              <button
                type="button"
                onClick={() => {
                  setAttachMenuOpen(false);
                  handlePickContextFile();
                }}
                className="flex-1 h-7 inline-flex items-center justify-center gap-1.5 rounded-lg bg-zinc-100 hover:bg-[#0E0E13] hover:text-white border border-[#0E0E13]/30 text-[11px] font-bold text-[#0E0E13] cursor-pointer transition-colors"
              >
                <Paperclip className="w-3 h-3" />
                <span>{t.pickFileFromPc}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setAttachMenuOpen(false);
                  handleGrabClipboard();
                }}
                className="flex-1 h-7 inline-flex items-center justify-center gap-1.5 rounded-lg bg-zinc-100 hover:bg-[#0E0E13] hover:text-white border border-[#0E0E13]/30 text-[11px] font-bold text-[#0E0E13] cursor-pointer transition-colors"
              >
                <ClipboardPaste className="w-3 h-3" />
                <span>{t.pasteClipboard}</span>
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Staged Context Files Chip Bar (Dropzone / Ctrl+V / Attach) */}
        <AnimatePresence>
          {stagedFiles.length > 0 && islandState !== "idle" && (
            <motion.div
              data-hub-interactive="true"
              initial={{ opacity: 0, y: -4, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.97 }}
              transition={{ duration: 0.12 }}
              className="w-[436px] mt-1.5 px-2.5 py-1.5 rounded-xl bg-white border-2 border-[#0E0E13] sakuga-chip-shadow flex items-center justify-between gap-2 pointer-events-auto"
            >
              <div className="flex items-center gap-1.5 min-w-0 overflow-x-auto jarvis-scroll">
                {stagedFiles.map((f) => (
                  <span
                    key={f.path}
                    title={f.path}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-[#0E0E13] text-white text-[10px] font-bold max-w-[230px] shrink-0"
                  >
                    {f.kind === "image" ? <ImageIcon className="w-2.5 h-2.5 shrink-0" /> : <FileText className="w-2.5 h-2.5 shrink-0" />}
                    <span className="truncate">{f.name}</span>
                    <button
                      type="button"
                      onClick={() => setStagedFiles((prev) => prev.filter((x) => x.path !== f.path))}
                      className="ml-0.5 hover:text-red-400 cursor-pointer"
                      title="Gỡ file này"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setStagedFiles([])}
                className="text-[10px] font-black text-zinc-500 hover:text-[#0E0E13] shrink-0 cursor-pointer"
              >
                Xóa hết
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Inline Safe Mode Confirmation Banner */}
        <AnimatePresence>
          {confirmReq && (
            <motion.div
              data-hub-interactive="true"
              initial={{ opacity: 0, y: -8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.96 }}
              className="w-[436px] rounded-[16px] sakuga-manga-panel border-[3px] border-[#0E0E13] p-3 mt-2.5 sakuga-panel-shadow text-[#0E0E13] pointer-events-auto"
            >
              <div className="flex items-center gap-1.5 text-xs font-black text-[#0E0E13] mb-1.5">
                <AlertTriangle className="w-4 h-4 text-[#FF6B00]" />
                <span>{t.confirmMcpSafe}</span>
              </div>
              <code className="block w-full p-2 rounded-lg bg-white border-2 border-[#0E0E13] text-[10.5px] font-bold text-[#0E0E13] break-all mb-2.5">
                {confirmReq.summary}
              </code>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={(e) => {
                    triggerSakugaBurst(e);
                    const id = confirmReq.id;
                    setConfirmReq(null);
                    window.jarvisApi?.resolveConfirm?.(id, false);
                    setSpeakingText("Đã từ chối thao tác.");
                    setIslandState("speaking");
                    scheduleReturnIdle(2000);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-white hover:bg-zinc-100 sakuga-btn text-xs font-black text-[#0E0E13] cursor-pointer"
                >
                  {t.confirmReject}
                </button>
                <button
                  type="button"
                  data-sakuga-power="heavy"
                  onClick={(e) => {
                    triggerSakugaBurst(e, { power: "heavy" });
                    const id = confirmReq.id;
                    setConfirmReq(null);
                    setIsBusyThinking(true);
                    setTranscript("Đang thực thi thao tác đã duyệt...");
                    window.jarvisApi?.resolveConfirm?.(id, true);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-[#0E0E13] hover:bg-zinc-800 sakuga-btn text-xs font-black text-white cursor-pointer"
                >
                  {t.confirmAllow}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Unified Mutually-Exclusive Drawer Slot (prevents Settings + Chi tiết overlapping!) */}
        <AnimatePresence mode="wait">
          {settingsOpen ? (
            <SettingsDrawer
              key="settings-drawer"
              hubState={hubState}
              lastAnswerText={lastAnswerText || speakingText}
              onToggleSafety={() => window.jarvisApi?.toggleSafetyMode?.()}
              onToggleWake={() => window.jarvisApi?.setWakeWord?.(!wakeOn)}
              onChangeWakeName={(name) => window.jarvisApi?.setWakeName?.(name)}
              onChangeWakeSensitivity={(lvl) => window.jarvisApi?.setWakeSensitivity?.(lvl)}
              onToggleVoiceAlways={() => window.jarvisApi?.setVoiceAlways?.(!voiceOn)}
              onToggleSakuga={(next) => window.jarvisApi?.setSakugaEnabled?.(Boolean(next))}
              onChangeDisplayMode={(mode) => window.jarvisApi?.setDisplayMode?.(mode)}
              onChangeUiLanguage={(lang) => window.jarvisApi?.setUiLanguage?.(lang)}
              onRecenter={() => window.jarvisApi?.recenterWindow?.()}
              onVramUnload={triggerVramDissolveFlow}
              onPreviewVfx={handlePreviewVfx}
              onChangeHotkey={(spec) => window.jarvisApi?.setHotkey?.(spec)}
              onSelectLocalModel={(preset) => window.jarvisApi?.setLocalModel?.(preset)}
              onAddDictWord={(w) => window.jarvisApi?.saveDictionaryWord?.(w)}
              onRemoveDictWord={(w) => window.jarvisApi?.removeDictionaryWord?.(w)}
              onOpenExports={() => window.jarvisApi?.openExportsDir?.()}
              onSpeakLast={async () => {
                const text = lastAnswerText || speakingText;
                if (!text) return;
                const res = await window.jarvisApi?.speakText?.(text);
                if (res?.audioWavBase64 && res.audioWavBase64 !== "__STREAMED_VIA_LIVE__") {
                  playWavBase64(res.audioWavBase64, () => setVoiceLevel(0), res.audioMimeType || "audio/wav", (lvl) => setVoiceLevel(lvl));
                }
              }}
              onExportWord={() => window.jarvisApi?.exportWord?.("Ghi chú Jarvis", lastAnswerText || speakingText)}
              onHideHub={() => window.jarvisApi?.hideWindow?.()}
            />
          ) : expandedOpen ? (
            <ExpandedPanel
              key="expanded-panel"
              answerMeta={answerMeta}
              answerText={lastAnswerText}
              recentCommands={hubState.recentCommands}
              activities={activities}
              hotkeyLabel={prettyHotkey}
              uiLanguage={hubState.uiLanguage}
              onSpeak={async () => {
                if (!lastAnswerText) return;
                const res = await window.jarvisApi?.speakText?.(lastAnswerText);
                if (res?.audioWavBase64 && res.audioWavBase64 !== "__STREAMED_VIA_LIVE__") {
                  playWavBase64(res.audioWavBase64, () => setVoiceLevel(0), res.audioMimeType || "audio/wav", (lvl) => setVoiceLevel(lvl));
                }
              }}
              onExportWord={() => {
                if (lastAnswerText) return window.jarvisApi?.exportWord?.("Ghi chú Jarvis", lastAnswerText);
                return null;
              }}
              onRunCommand={(cmd) => submitTextCommand(cmd)}
            />
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}
