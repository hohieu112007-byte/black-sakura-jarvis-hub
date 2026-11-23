const shell = document.getElementById("hub-shell");
const promptInput = document.getElementById("prompt-input");
const micBtn = document.getElementById("mic-btn");
const stopBtn = document.getElementById("stop-btn");
const wakeToggleBtn = document.getElementById("wake-toggle-btn");
const waveBars = document.getElementById("wave-bars");
const voiceToggleBtn = document.getElementById("voice-toggle-btn");
const safetyBtn = document.getElementById("safety-btn");
const expandBtn = document.getElementById("expand-btn");
const hideBtn = document.getElementById("hide-btn");
const statusStrip = document.getElementById("status-strip");
const statusBadge = document.getElementById("status-badge");
const statusText = document.getElementById("status-text");
const confirmBar = document.getElementById("confirm-bar");
const confirmSummary = document.getElementById("confirm-summary");
const confirmAllow = document.getElementById("confirm-allow");
const confirmDeny = document.getElementById("confirm-deny");
const expandedPanel = document.getElementById("expanded-panel");
const answerMeta = document.getElementById("answer-meta");
const answerBody = document.getElementById("answer-body");
const speakBtn = document.getElementById("speak-btn");
const exportBtn = document.getElementById("export-btn");
const copyBtn = document.getElementById("copy-btn");
const recentRow = document.getElementById("recent-row");
const recentChips = document.getElementById("recent-chips");
const activityRow = document.getElementById("activity-row");
const activityList = document.getElementById("activity-list");
const dotFd = document.getElementById("dot-fd");
const dotAd = document.getElementById("dot-ad");
const dotPw = document.getElementById("dot-pw");
const dotKey = document.getElementById("dot-key");
const hotkeySelect = document.getElementById("hotkey-select");
const liveActPill = document.getElementById("live-act-pill");

let isExpanded = false;
let currentConfirmId = null;
let lastAnswerText = "";
let autoHideTimer = null;
let delayedDispatchTimer = null;
let liveActHideTimer = null;
let audioCtx = null;
let micStream = null;
let micProcessor = null;
let micSource = null;
let preBuffering = false;
let streamingVoice = false;
let preBufferQueue = [];
let pcmPlayTime = 0;
let activePcmSources = [];
let activeWavAudio = null;
let isBusyTurn = false;
let handsFreeVadActive = false;
let vadStartedAt = 0;
let vadLastSpeechAt = 0;
let vadSpeechFrames = 0;
let vadHeardSpeech = false;
const activities = [];

function stopAllAudioPlayback() {
  pcmPlayTime = 0;
  for (const s of activePcmSources) {
    try {
      s.stop();
    } catch {}
  }
  activePcmSources = [];
  if (activeWavAudio) {
    try {
      activeWavAudio.pause();
      activeWavAudio.currentTime = 0;
    } catch {}
    activeWavAudio = null;
  }
}

function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function playBeep(kind = "ok") {
  try {
    const ctx = getAudioCtx();
    const now = ctx.currentTime;
    const playTone = (freq, startOffset, dur, gainVal = 0.08) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + startOffset);
      gain.gain.setValueAtTime(0.001, now + startOffset);
      gain.gain.exponentialRampToValueAtTime(gainVal, now + startOffset + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + startOffset + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + startOffset);
      osc.stop(now + startOffset + dur + 0.02);
    };
    if (kind === "listen") playTone(620, 0, 0.06, 0.06);
    else if (kind === "reset") {
      playTone(780, 0, 0.055, 0.06);
      playTone(1040, 0.07, 0.065, 0.07);
    } else if (kind === "ok") playTone(880, 0, 0.09, 0.08);
    else if (kind === "confirm") {
      playTone(540, 0, 0.08, 0.08);
      playTone(680, 0.1, 0.09, 0.08);
    } else if (kind === "error") {
      playTone(300, 0, 0.14, 0.08);
    }
  } catch {}
}

function playPcm24kChunk(base64Data) {
  try {
    const ctx = getAudioCtx();
    const bin = atob(base64Data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const samples = new Int16Array(bytes.buffer);
    const floatBuf = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) floatBuf[i] = samples[i] / 32768;

    const audioBuf = ctx.createBuffer(1, floatBuf.length, 24000);
    audioBuf.copyToChannel(floatBuf, 0);
    const src = ctx.createBufferSource();
    src.buffer = audioBuf;
    src.connect(ctx.destination);
    activePcmSources.push(src);
    src.onended = () => {
      activePcmSources = activePcmSources.filter((item) => item !== src);
    };
    const t = Math.max(ctx.currentTime + 0.02, pcmPlayTime);
    src.start(t);
    pcmPlayTime = t + audioBuf.duration;
  } catch {}
}

function playWavBase64(base64Wav) {
  if (!base64Wav) return;
  stopAllAudioPlayback();
  const audio = new Audio(`data:audio/wav;base64,${base64Wav}`);
  activeWavAudio = audio;
  stopBtn.classList.remove("hidden");
  audio.onended = () => {
    if (activeWavAudio === audio) activeWavAudio = null;
    if (!isBusyTurn) stopBtn.classList.add("hidden");
  };
  audio.play().catch(() => {});
}

function downsampleTo16kInt16(float32Arr, inRate) {
  const ratio = inRate / 16000;
  const outLen = Math.max(1, Math.floor(float32Arr.length / ratio));
  const pcm = new Int16Array(outLen);
  let rmsSum = 0;
  for (let i = 0; i < outLen; i++) {
    const idx = Math.min(float32Arr.length - 1, Math.floor(i * ratio));
    const s = Math.max(-1, Math.min(1, float32Arr[idx]));
    pcm[i] = s < 0 ? s * 32768 : s * 32767;
    rmsSum += s * s;
  }
  return {
    pcm,
    rms: Math.sqrt(rmsSum / outLen),
  };
}

function encodeWavBase64FromChunks(int16Chunks, sampleRate = 16000) {
  let totalSamples = 0;
  for (const c of int16Chunks) totalSamples += c.length;
  if (totalSamples === 0) return "";

  const dataByteLen = totalSamples * 2;
  const wavBuf = new ArrayBuffer(44 + dataByteLen);
  const view = new DataView(wavBuf);
  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataByteLen, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataByteLen, true);

  const outInt16 = new Int16Array(wavBuf, 44, totalSamples);
  let offset = 0;
  for (const c of int16Chunks) {
    outInt16.set(c, offset);
    offset += c.length;
  }

  const bytes = new Uint8Array(wavBuf);
  const chunkSize = 0x8000;
  let bin = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(bin);
}

function updateWaveBars(rms) {
  const level = Math.min(1, rms * 16);
  shell?.style.setProperty("--eye-voice", level.toFixed(2));
  const spans = waveBars.querySelectorAll("span");
  const base = Math.min(1, rms * 15);
  const weights = [0.42, 0.72, 0.94, 1.0, 0.94, 0.72, 0.42];
  spans.forEach((sp, idx) => {
    const w = weights[idx] ?? 0.6;
    const h = Math.round(4 + base * 16 * w + Math.random() * 2.5);
    sp.style.height = `${Math.min(22, h)}px`;
  });
}

async function ensureMicReady() {
  const ctx = getAudioCtx();
  if (ctx.state === "suspended") {
    await ctx.resume().catch(() => {});
  }
  if (micStream && micProcessor) return;
  micStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  micSource = ctx.createMediaStreamSource(micStream);

  // 3-Stage Studio Voice Enhancer for Vietnamese clarity
  const highPass = ctx.createBiquadFilter();
  highPass.type = "highpass";
  highPass.frequency.value = 85;
  highPass.Q.value = 0.7;

  const presence = ctx.createBiquadFilter();
  presence.type = "peaking";
  presence.frequency.value = 2800;
  presence.Q.value = 1.1;
  presence.gain.value = 3.5;

  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -28;
  compressor.knee.value = 18;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.2;

  micProcessor = ctx.createScriptProcessor(2048, 1, 1);
  micProcessor.onaudioprocess = (e) => {
    if (!preBuffering && !streamingVoice) return;
    const { pcm, rms } = downsampleTo16kInt16(e.inputBuffer.getChannelData(0), ctx.sampleRate);
    updateWaveBars(rms);
    if (streamingVoice) {
      if (preBufferQueue.length < 380) {
        preBufferQueue.push(pcm);
      }
      if (handsFreeVadActive) {
        const now = Date.now();
        if (rms >= 0.014) {
          vadSpeechFrames++;
          vadLastSpeechAt = now;
          if (vadSpeechFrames >= 2) {
            vadHeardSpeech = true;
          }
        } else if (!vadHeardSpeech) {
          vadSpeechFrames = 0;
        }
        // Balanced pause tolerance (1.25s after speech stops) so natural pauses aren't clipped, 6s initial wait, 18s max utterance
        if (vadHeardSpeech && now - vadLastSpeechAt >= 1250) {
          handsFreeVadActive = false;
          stopPushToTalk();
        } else if (!vadHeardSpeech && now - vadStartedAt >= 6000) {
          handsFreeVadActive = false;
          streamingVoice = false;
          preBufferQueue = [];
          waveBars.classList.add("hidden");
          window.jarvisApi.pauseWake(false);
          showStatus("CHỜ", "Không nghe thấy lệnh nào — đã về chế độ chờ Hey Jarvis.", "idle", 1800);
        } else if (now - vadStartedAt >= 18000) {
          handsFreeVadActive = false;
          stopPushToTalk();
        }
      }
    } else if (preBuffering) {
      if (preBufferQueue.length < 15) preBufferQueue.push(pcm);
    }
  };

  const silentSink = ctx.createGain();
  silentSink.gain.value = 0;

  micSource.connect(highPass);
  highPass.connect(presence);
  presence.connect(compressor);
  compressor.connect(micProcessor);
  micProcessor.connect(silentSink);
  silentSink.connect(ctx.destination);
}

function setShellState(state) {
  shell.className = `hub-shell state-${state}`;
  isBusyTurn = state === "listening" || state === "thinking";
  const hasAudio = Boolean(activeWavAudio) || activePcmSources.length > 0;
  stopBtn.classList.toggle("hidden", !(isBusyTurn || hasAudio));
}

function suspendAudioIfIdle() {
  if (audioCtx && !streamingVoice && !preBuffering && !activeWavAudio && activePcmSources.length === 0) {
    if (audioCtx.state === "running") {
      audioCtx.suspend().catch(() => {});
    }
  }
}

async function handleStopAction() {
  preBuffering = false;
  streamingVoice = false;
  handsFreeVadActive = false;
  preBufferQueue = [];
  promptInput.value = "";
  waveBars.classList.add("hidden");
  stopAllAudioPlayback();
  currentConfirmId = null;
  confirmBar.classList.add("hidden");
  await window.jarvisApi.stopTurn();
  window.jarvisApi.pauseWake(false);
  playBeep("ok");
  setTimeout(suspendAudioIfIdle, 250);
  showStatus("ĐÃ DỪNG", "Đã dừng xử lý theo yêu cầu.", "idle", 2200);
}

function syncWindowHeight() {
  let fallback = 86;
  if (isExpanded) {
    fallback = 540;
  } else if (!confirmBar.classList.contains("hidden")) {
    fallback = 186;
  } else if (!document.getElementById("apikey-bar").classList.contains("hidden")) {
    fallback = 158;
  } else if (!statusStrip.classList.contains("hidden")) {
    fallback = 116;
  }
  const rectH = shell.getBoundingClientRect().height;
  const measured = rectH > 20 ? Math.ceil(rectH + 26) : fallback;
  window.jarvisApi.setExpanded(Math.max(fallback, measured));
}

if (typeof ResizeObserver !== "undefined" && shell) {
  new ResizeObserver(() => syncWindowHeight()).observe(shell);
}
window.addEventListener("focus", () => syncWindowHeight());

function setExpanded(nextExpanded) {
  isExpanded = Boolean(nextExpanded);
  expandedPanel.classList.toggle("hidden", !isExpanded);
  expandBtn.classList.toggle("open", isExpanded);
  syncWindowHeight();
}

function flashLiveActivity(evt) {
  if (!liveActPill) return;
  const labelMap = {
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
  const label = labelMap[evt.toolName] || `⚡ ${evt.toolName}`;
  liveActPill.textContent = evt.ok ? `${label} ✓` : `${label} ✕`;
  liveActPill.className = `live-act-pill ${evt.ok ? "done" : "err"}`;
  clearTimeout(liveActHideTimer);
  liveActHideTimer = setTimeout(() => {
    liveActPill.classList.add("hidden");
  }, 1500);
}

function beginZeroWaitDispatch(fallbackDetail) {
  clearTimeout(autoHideTimer);
  clearTimeout(delayedDispatchTimer);
  shell?.style.setProperty("--eye-voice", "0");
  // Hide status strip immediately for sub-1.25s actions so the pill never bloats or shows a "waiting" bar
  if (!isExpanded && !currentConfirmId) {
    statusStrip.classList.add("hidden");
  }
  setShellState("thinking");
  syncWindowHeight();
  delayedDispatchTimer = setTimeout(() => {
    if (isBusyTurn && !currentConfirmId) {
      statusBadge.textContent = "CHẠY";
      statusText.textContent = fallbackDetail;
      statusStrip.classList.remove("hidden");
      syncWindowHeight();
    }
  }, 1250);
}

function showStatus(badge, text, state = "ok", autoHideMs = 0) {
  clearTimeout(autoHideTimer);
  clearTimeout(delayedDispatchTimer);
  shell?.style.setProperty("--eye-voice", "0");
  // Keep confirm state highlighted while waiting for user's Allow/Deny decision
  setShellState(currentConfirmId ? "confirm" : state);
  statusBadge.textContent = badge;
  statusText.textContent = text;
  statusStrip.classList.remove("hidden");
  syncWindowHeight();

  if (autoHideMs > 0 && !isExpanded && !currentConfirmId) {
    autoHideTimer = setTimeout(() => {
      if (!isExpanded && !currentConfirmId && document.activeElement !== promptInput) {
        window.jarvisApi.hideWindow();
      }
    }, autoHideMs);
  }
}

function renderSafeMarkdown(rawText) {
  const escaped = String(rawText || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const lines = escaped.split(/\r?\n/);
  let html = "";
  let inList = false;
  for (const line of lines) {
    const fmt = line
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    if (/^\s*[-•*]\s+/.test(fmt)) {
      if (!inList) {
        html += "<ul>";
        inList = true;
      }
      html += `<li>${fmt.replace(/^\s*[-•*]\s+/, "")}</li>`;
    } else {
      if (inList) {
        html += "</ul>";
        inList = false;
      }
      if (fmt.trim()) html += `<p>${fmt}</p>`;
    }
  }
  if (inList) html += "</ul>";
  return html || "<p></p>";
}

function displayAnswer(title, text) {
  lastAnswerText = text;
  answerMeta.textContent = title;
  answerBody.innerHTML = renderSafeMarkdown(text);
  const shortLine = text.replace(/\s+/g, " ").trim();
  const isLong = text.length > 110 || text.includes("\n");
  if (isLong) {
    setExpanded(true);
    showStatus("XONG", shortLine.slice(0, 75), "ok", 0);
  } else {
    showStatus("XONG", shortLine, "ok", 3800);
  }
}

const SAFE_ICON_SVG = `<svg class="chip-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2L3 4.2v3.6c0 3.3 2.1 5.6 5 6.4 2.9-.8 5-3.1 5-6.4V4.2L8 2z"/></svg><span>Safe</span>`;
const TURBO_ICON_SVG = `<svg class="chip-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M9.2 1.8L3.8 9h4.1l-.9 5.2L12.4 7H8.3l.9-5.2z"/></svg><span>Turbo</span>`;

function applyStateSync(st) {
  if (!st) return;
  const isSafe = st.safetyMode === "safe";
  safetyBtn.className = `safety-chip ${isSafe ? "safe" : "turbo"}`;
  safetyBtn.innerHTML = isSafe ? SAFE_ICON_SVG : TURBO_ICON_SVG;

  const voiceOn = Boolean(st.voiceReplyAlways);
  voiceToggleBtn.dataset.voice = voiceOn ? "on" : "off";
  voiceToggleBtn.querySelector(".icon-voice-on")?.classList.toggle("hidden", !voiceOn);
  voiceToggleBtn.querySelector(".icon-voice-off")?.classList.toggle("hidden", voiceOn);
  voiceToggleBtn.title = voiceOn
    ? "Đang BẬT luôn đọc bằng giọng nói"
    : "Mặc định: Text + Bíp (Chỉ đọc khi yêu cầu)";

  const wakeOn = st.wakeWordEnabled !== false;
  wakeToggleBtn.className = `wake-chip ${wakeOn ? "active" : ""}`;
  wakeToggleBtn.title = wakeOn
    ? "Đang lắng nghe 'Hey Jarvis' rảnh tay (bấm để tắt)"
    : "Đang TẮT gọi 'Hey Jarvis' (bấm để bật)";

  const prettyHotkey = String(st.hotkey || "ctrl+alt+space")
    .split("+")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" + ");
  if (st.hotkey) hotkeySelect.value = st.hotkey;
  promptInput.placeholder = `Gõ lệnh hoặc giữ ${prettyHotkey} để nói...`;
  const hotkeyHint = document.getElementById("hotkey-hint");
  if (hotkeyHint) hotkeyHint.textContent = prettyHotkey;

  dotFd.className = `dot-item ${st.health?.fastDesktop ? "online" : "warn"}`;
  if (dotAd) dotAd.className = `dot-item ${st.health?.agentDesktop ? "online" : ""}`;
  dotPw.className = `dot-item ${st.health?.playwright ? "online" : ""}`;
  dotKey.className = `dot-item ${st.hasApiKey ? "online" : "warn"}`;
  const dotKeyLabel = document.getElementById("dot-key-label");
  if (dotKeyLabel) {
    dotKeyLabel.textContent =
      st.apiKeyCount && st.apiKeyCount > 1 ? `Gemini 3.8 (${st.apiKeyCount} Keys)` : "Gemini 3.8";
  }

  const apikeyBar = document.getElementById("apikey-bar");
  if (apikeyBar && !apikeyBar.dataset.manualOpen) {
    apikeyBar.classList.toggle("hidden", Boolean(st.hasApiKey));
    syncWindowHeight();
  }

  if (Array.isArray(st.recentCommands) && st.recentCommands.length > 0) {
    recentRow.classList.remove("hidden");
    recentChips.innerHTML = "";
    st.recentCommands.forEach((cmd, idx) => {
      const btn = document.createElement("button");
      btn.className = "recent-chip";
      btn.style.animationDelay = `${idx * 40}ms`;
      btn.textContent = cmd;
      btn.title = cmd;
      btn.onclick = () => submitTextCommand(cmd);
      recentChips.appendChild(btn);
    });
  }
}

document.getElementById("manage-key-btn")?.addEventListener("click", () => {
  const apikeyBar = document.getElementById("apikey-bar");
  if (!apikeyBar) return;
  const willShow = apikeyBar.classList.contains("hidden");
  apikeyBar.classList.toggle("hidden", !willShow);
  if (willShow) {
    apikeyBar.dataset.manualOpen = "1";
    document.getElementById("apikey-input")?.focus();
  } else {
    delete apikeyBar.dataset.manualOpen;
  }
  syncWindowHeight();
});

document.getElementById("apikey-save-btn")?.addEventListener("click", async () => {
  const inputEl = document.getElementById("apikey-input");
  const apikeyBar = document.getElementById("apikey-bar");
  const val = inputEl?.value?.trim() || "";
  if (!val) return;
  const res = await window.jarvisApi.saveApiKey(val);
  if (res?.ok) {
    inputEl.value = "";
    if (apikeyBar) {
      delete apikeyBar.dataset.manualOpen;
      apikeyBar.classList.add("hidden");
    }
    playBeep("ok");
    const total = res.apiKeyCount || 1;
    showStatus("ĐÃ LƯU", `Đã lưu API Key (Tổng cộng ${total} key dự phòng sẵn sàng)!`, "ok", 3000);
  } else {
    playBeep("error");
    showStatus("LỖI", res?.error || "Không thể lưu API Key", "error");
  }
});

async function submitTextCommand(text) {
  const clean = String(text || "").trim();
  if (!clean) return;
  promptInput.value = "";
  beginZeroWaitDispatch(`Đang thực hiện: ${clean}`);
  const res = await window.jarvisApi.sendPrompt(clean);
  clearTimeout(delayedDispatchTimer);
  if (res.cancelled) return;
  if (res.hubSleep) {
    playBeep("ok");
    return;
  }
  if (!res.ok) {
    playBeep("error");
    showStatus("LỖI", res.error || "Không thể xử lý lệnh", "error");
    return;
  }
  if (res.audioWavBase64) {
    playWavBase64(res.audioWavBase64);
  } else {
    playBeep("ok");
  }
  displayAnswer(res.modelLabel || "⚡ Gemini 3.8 Flash", res.text);
}

async function startPushToTalkManual() {
  try {
    await ensureMicReady();
    preBuffering = false;
    preBufferQueue = [];
    promptInput.value = "";
    streamingVoice = true;
    waveBars.classList.remove("hidden");
    showStatus("NGHE", "Đang nghe giọng nói (lọc tạp âm chuẩn Tiếng Việt)...", "listening");
    playBeep("listen");
  } catch (err) {
    playBeep("error");
    showStatus("MIC LỖI", err.message, "error");
  }
}

async function stopPushToTalk() {
  preBuffering = false;
  if (!streamingVoice) return;
  streamingVoice = false;
  waveBars.classList.add("hidden");

  const chunks = preBufferQueue.slice();
  preBufferQueue = [];
  // Measure overall RMS energy so near-silent clips never get hallucinated as fake searches
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
  const wavBase64 = totalCount >= 3200 && clipRms >= 0.0025 ? encodeWavBase64FromChunks(chunks, 16000) : "";
  if (!wavBase64) {
    window.jarvisApi.pauseWake(false);
    showStatus("CHỜ", "Không nghe thấy giọng nói rõ ràng.", "idle", 1800);
    return;
  }

  beginZeroWaitDispatch("Đang thực thi lệnh thoại...");
  const res = await window.jarvisApi.sendVoiceWav(wavBase64, "");
  clearTimeout(delayedDispatchTimer);
  window.jarvisApi.pauseWake(false);
  promptInput.value = "";

  if (res?.cancelled) return;
  if (res?.hubSleep) {
    playBeep("ok");
    return;
  }
  if (res?.emptyVoice) {
    showStatus("CHỜ", "Không nghe rõ câu lệnh — hãy thử nói lại.", "idle", 2200);
    return;
  }
  if (!res?.ok) {
    playBeep("error");
    showStatus("LỖI", res?.error || "Không thể xử lý lệnh thoại", "error");
    return;
  }
  if (res.audioWavBase64) {
    playWavBase64(res.audioWavBase64);
  } else {
    playBeep("ok");
  }
  displayAnswer(res.modelLabel || "🎙️ Gemini 3.5 Transcribe", res.text);
}

// Global Enter / Escape handling for confirmation banner or active turn stop
document.addEventListener("keydown", (e) => {
  if (currentConfirmId) {
    if (e.key === "Enter") {
      e.preventDefault();
      confirmAllow.click();
    } else if (e.key === "Escape") {
      e.preventDefault();
      confirmDeny.click();
    }
    return;
  }
  if (e.key === "Escape" && (isBusyTurn || activeWavAudio || activePcmSources.length > 0)) {
    e.preventDefault();
    handleStopAction();
  }
});

// Button handlers
promptInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (currentConfirmId) {
      confirmAllow.click();
    } else {
      submitTextCommand(promptInput.value);
    }
  } else if (e.key === "Escape") {
    if (currentConfirmId) {
      confirmDeny.click();
    } else if (isBusyTurn || activeWavAudio || activePcmSources.length > 0) {
      handleStopAction();
    } else {
      window.jarvisApi.hideWindow();
    }
  }
});

stopBtn.addEventListener("click", () => handleStopAction());
micBtn.addEventListener("mousedown", () => startPushToTalkManual());
micBtn.addEventListener("mouseup", () => stopPushToTalk());

safetyBtn.addEventListener("click", async () => {
  await window.jarvisApi.toggleSafetyMode();
});

voiceToggleBtn.addEventListener("click", async () => {
  const next = voiceToggleBtn.dataset.voice !== "on";
  await window.jarvisApi.setVoiceAlways(next);
});

wakeToggleBtn.addEventListener("click", async () => {
  const next = !wakeToggleBtn.classList.contains("active");
  await window.jarvisApi.setWakeWord(next);
});

expandBtn.addEventListener("click", () => setExpanded(!isExpanded));
hideBtn.addEventListener("click", () => window.jarvisApi.hideWindow());

hotkeySelect.addEventListener("change", async () => {
  await window.jarvisApi.setHotkey(hotkeySelect.value);
});

confirmAllow.addEventListener("click", async () => {
  if (!currentConfirmId) return;
  const id = currentConfirmId;
  currentConfirmId = null;
  confirmBar.classList.add("hidden");
  showStatus("CHẠY", "Đang thực thi thao tác đã duyệt...", "thinking");
  await window.jarvisApi.resolveConfirm(id, true);
});

confirmDeny.addEventListener("click", async () => {
  if (!currentConfirmId) return;
  const id = currentConfirmId;
  currentConfirmId = null;
  promptInput.value = "";
  confirmBar.classList.add("hidden");
  showStatus("ĐÃ HỦY", "Đã từ chối thao tác — không thử lại.", "idle", 2200);
  await window.jarvisApi.resolveConfirm(id, false);
});

speakBtn.addEventListener("click", async () => {
  if (!lastAnswerText) return;
  showStatus("TTS", "Đang chuẩn bị đọc thành tiếng...", "thinking");
  try {
    const res = await window.jarvisApi.speakText(lastAnswerText);
    if (res?.audioWavBase64 && res.audioWavBase64 !== "__STREAMED_VIA_LIVE__") {
      playWavBase64(res.audioWavBase64);
    }
    showStatus("ĐANG ĐỌC", "Đang phát giọng nói.", "ok");
  } catch (err) {
    playBeep("error");
    showStatus("LỖI TTS", err.message, "error");
  }
});

exportBtn.addEventListener("click", async () => {
  if (!lastAnswerText) return;
  try {
    const res = await window.jarvisApi.exportWord("Ghi chú Jarvis", lastAnswerText);
    if (res?.path) {
      playBeep("ok");
      showStatus("ĐÃ XUẤT", `Đã mở file Word: ${res.path}`, "ok");
    }
  } catch (err) {
    playBeep("error");
    showStatus("LỖI XUẤT", err.message, "error");
  }
});

copyBtn.addEventListener("click", () => {
  if (!lastAnswerText) return;
  navigator.clipboard.writeText(lastAnswerText);
  playBeep("ok");
  const copyLabel = document.getElementById("copy-label");
  copyBtn.classList.add("copied");
  if (copyLabel) copyLabel.textContent = "Đã chép";
  setTimeout(() => {
    copyBtn.classList.remove("copied");
    if (copyLabel) copyLabel.textContent = "Copy";
  }, 1500);
  showStatus("COPY", "Đã sao chép vào clipboard.", "ok", 2000);
});

window.jarvisApi.onEvent(async (evt) => {
  if (evt.type === "ready" || evt.type === "state_sync") {
    applyStateSync(evt);
    if (evt.type === "ready") {
      const wakeTip = evt.wakeWordEnabled !== false ? "Nói 'Hey Jarvis' hoặc giữ" : "Giữ";
      showStatus(
        evt.hasApiKey ? "SẴN SÀNG" : "THIẾU KEY",
        evt.hasApiKey
          ? `${wakeTip} ${String(evt.hotkey || "ctrl+alt+space").toUpperCase()} để ra lệnh`
          : "Hãy đặt biến môi trường GEMINI_API_KEY",
        evt.hasApiKey ? "ok" : "error",
        evt.hasApiKey ? 3400 : 0
      );
    }
  } else if (evt.type === "hotkey_registered" && !evt.ok) {
    setExpanded(true);
    showStatus("PHÍM BẬN", `${evt.spec} đang bị app khác chiếm — hãy đổi phím ở góc dưới.`, "error");
  } else if (evt.type === "wake_status" && !evt.ok) {
    showStatus("WAKE LỖI", `Không bật được Hey Jarvis: ${evt.error || "lỗi micro"}`, "error");
  } else if (evt.type === "hotkey_wake") {
    try {
      const wasActive = streamingVoice || handsFreeVadActive || isBusyTurn || Boolean(currentConfirmId);
      if (wasActive) {
        streamingVoice = false;
        handsFreeVadActive = false;
        currentConfirmId = null;
        confirmBar.classList.add("hidden");
        confirmBar.innerHTML = "";
        stopAllAudioPlayback();
      }
      await ensureMicReady();
      preBuffering = false;
      preBufferQueue = [];
      promptInput.value = "";
      handsFreeVadActive = true;
      vadSpeechFrames = 0;
      vadHeardSpeech = false;
      vadStartedAt = Date.now();
      vadLastSpeechAt = vadStartedAt;
      streamingVoice = true;
      waveBars.classList.remove("hidden");
      showStatus(
        wasActive ? "ĐÃ RESET" : "NGHE",
        wasActive
          ? "Đã hủy lệnh cũ — hãy đọc lại lệnh mới..."
          : "Hey Jarvis đã bật! Hãy nói yêu cầu của bạn...",
        "listening"
      );
      playBeep(wasActive ? "reset" : "listen");
    } catch (err) {
      handsFreeVadActive = false;
      streamingVoice = false;
      window.jarvisApi.pauseWake(false);
      playBeep("error");
      showStatus("MIC LỖI", err.message, "error");
    }
  } else if (evt.type === "hub_sleep") {
    clearTimeout(delayedDispatchTimer);
    streamingVoice = false;
    handsFreeVadActive = false;
    preBuffering = false;
    preBufferQueue = [];
    currentConfirmId = null;
    waveBars.classList.add("hidden");
    liveActPill?.classList.add("hidden");
    confirmBar.classList.add("hidden");
    confirmBar.innerHTML = "";
    promptInput.value = "";
    stopAllAudioPlayback();
  } else if (evt.type === "hotkey_down") {
    preBufferQueue = [];
    preBuffering = true;
    streamingVoice = false;
    handsFreeVadActive = false;
    try {
      await ensureMicReady();
    } catch {}
  } else if (evt.type === "hotkey_tap") {
    preBuffering = false;
    streamingVoice = false;
    handsFreeVadActive = false;
    preBufferQueue = [];
    waveBars.classList.add("hidden");
    clearTimeout(autoHideTimer);
    if (!isExpanded && !currentConfirmId) {
      statusStrip.classList.add("hidden");
    }
    setShellState(currentConfirmId ? "confirm" : "idle");
    syncWindowHeight();
    promptInput.focus();
  } else if (evt.type === "hotkey_hold_start") {
    preBuffering = false;
    handsFreeVadActive = false;
    promptInput.value = "";
    streamingVoice = true;
    waveBars.classList.remove("hidden");
    showStatus("NGHE", "Đang thu giọng nói (thả phím để gửi)...", "listening");
    playBeep("listen");
  } else if (evt.type === "hotkey_hold_end") {
    await stopPushToTalk();
  } else if (evt.type === "hotkey_cancelled") {
    preBuffering = false;
    streamingVoice = false;
    handsFreeVadActive = false;
    preBufferQueue = [];
    window.jarvisApi.pauseWake(false);
  } else if (evt.type === "user_transcript") {
    promptInput.value = evt.text;
  } else if (evt.type === "status") {
    showStatus("XỬ LÝ", evt.detail || "Đang xử lý...", evt.state || "thinking");
  } else if (evt.type === "assistant_stream") {
    if (isExpanded) answerBody.innerHTML = renderSafeMarkdown(evt.text);
  } else if (evt.type === "audio_pcm_chunk") {
    playPcm24kChunk(evt.data);
  } else if (evt.type === "audio_clear") {
    stopAllAudioPlayback();
  } else if (evt.type === "turn_stopped" || evt.type === "turn_cancelled") {
    preBuffering = false;
    streamingVoice = false;
    handsFreeVadActive = false;
    preBufferQueue = [];
    promptInput.value = "";
    currentConfirmId = null;
    confirmBar.classList.add("hidden");
    waveBars.classList.add("hidden");
    stopAllAudioPlayback();
    window.jarvisApi.pauseWake(false);
    const badge = evt.type === "turn_cancelled" ? "ĐÃ HỦY" : "ĐÃ DỪNG";
    const msg = evt.message || (evt.type === "turn_cancelled" ? "Đã hủy thao tác." : "Đã dừng xử lý theo yêu cầu.");
    showStatus(badge, msg, "idle", 2200);
  } else if (evt.type === "turn_done") {
    handsFreeVadActive = false;
    promptInput.value = "";
    window.jarvisApi.pauseWake(false);
    if (!evt.didSpeak) playBeep("ok");
    displayAnswer("🎙️ Gemini 3.8 Live", evt.text);
  } else if (evt.type === "confirm_request") {
    currentConfirmId = evt.id;
    confirmSummary.textContent = evt.summary;
    confirmBar.classList.remove("hidden");
    playBeep("confirm");
    setShellState("confirm");
    syncWindowHeight();
    confirmAllow.focus();
  } else if (evt.type === "confirm_expired") {
    if (currentConfirmId === evt.id) {
      currentConfirmId = null;
      confirmBar.classList.add("hidden");
      showStatus("HẾT HẠN", "Đã tự hủy yêu cầu xác nhận.", "idle", 2200);
    }
  } else if (evt.type === "activity") {
    flashLiveActivity(evt);
    activities.unshift(evt);
    if (activities.length > 3) activities.length = 3;
    activityRow.classList.remove("hidden");
    activityList.innerHTML = activities
      .map(
        (a) =>
          `<div class="act-item"><span class="act-name"><span class="${a.ok ? "act-status-ok" : "act-status-err"}">${a.ok ? "✓" : "✕"}</span>${a.toolName}</span><span class="act-time">${a.ms}ms</span></div>`
      )
      .join("");
    if (isExpanded) syncWindowHeight();
  } else if (evt.type === "error") {
    preBuffering = false;
    streamingVoice = false;
    handsFreeVadActive = false;
    preBufferQueue = [];
    waveBars.classList.add("hidden");
    window.jarvisApi.pauseWake(false);
    playBeep("error");
    showStatus("LỖI", evt.message, "error");
  }
});

window.jarvisApi.getInitialState().then(applyStateSync).catch(() => {});
