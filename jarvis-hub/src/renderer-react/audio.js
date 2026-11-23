let audioCtx = null;
let micStream = null;
let micProcessor = null;
let micSource = null;
let currentMicCallback = null;
let pcmPlayTime = 0;
let activePcmSources = [];
let activeWavAudio = null;
let wavMeterRaf = 0;
let wavLevelCallback = null;

export function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

export function stopAllAudioPlayback() {
  pcmPlayTime = 0;
  if (wavMeterRaf) {
    cancelAnimationFrame(wavMeterRaf);
    wavMeterRaf = 0;
  }
  if (wavLevelCallback) {
    try {
      wavLevelCallback(0);
    } catch {}
    wavLevelCallback = null;
  }
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

export function hasActiveAudio() {
  return Boolean(activeWavAudio) || activePcmSources.length > 0;
}

export function playBeep(kind = "ok") {
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

export function playPcm24kChunk(base64Data) {
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

export function playWavBase64(base64Audio, onDone, mimeType = "audio/wav", onLevel = null) {
  if (!base64Audio) return;
  stopAllAudioPlayback();
  const safeMime = String(mimeType || "audio/wav").includes("mpeg") ? "audio/mpeg" : "audio/wav";
  const audio = new Audio(`data:${safeMime};base64,${base64Audio}`);
  activeWavAudio = audio;
  wavLevelCallback = typeof onLevel === "function" ? onLevel : null;

  let analyser = null;
  let dataBuf = null;
  if (wavLevelCallback) {
    try {
      const ctx = getAudioCtx();
      const src = ctx.createMediaElementSource(audio);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      dataBuf = new Uint8Array(analyser.frequencyBinCount);
      src.connect(analyser);
      analyser.connect(ctx.destination);
      const tick = () => {
        if (activeWavAudio !== audio) return;
        analyser.getByteTimeDomainData(dataBuf);
        let sumSq = 0;
        for (let i = 0; i < dataBuf.length; i++) {
          const v = (dataBuf[i] - 128) / 128;
          sumSq += v * v;
        }
        const rms = Math.sqrt(sumSq / dataBuf.length);
        wavLevelCallback?.(Math.min(1, rms * 3.8));
        wavMeterRaf = requestAnimationFrame(tick);
      };
      wavMeterRaf = requestAnimationFrame(tick);
    } catch {}
  }

  audio.onended = () => {
    if (wavMeterRaf) {
      cancelAnimationFrame(wavMeterRaf);
      wavMeterRaf = 0;
    }
    wavLevelCallback?.(0);
    wavLevelCallback = null;
    if (activeWavAudio === audio) activeWavAudio = null;
    onDone?.();
  };
  audio.play().catch(() => {});
}

export function downsampleTo16kInt16(float32Arr, inRate) {
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
  return { pcm, rms: Math.sqrt(rmsSum / outLen) };
}

export function encodeWavBase64FromChunks(int16Chunks, sampleRate = 16000) {
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
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
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

export async function ensureMicReady(onAudioFrame) {
  currentMicCallback = onAudioFrame;
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
    const { pcm, rms } = downsampleTo16kInt16(e.inputBuffer.getChannelData(0), ctx.sampleRate);
    currentMicCallback?.({ pcm, rms });
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

export function suspendAudioContext() {
  if (audioCtx && !hasActiveAudio() && audioCtx.state === "running") {
    audioCtx.suspend().catch(() => {});
  }
}
