const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("jarvisApi", {
  getInitialState: () => ipcRenderer.invoke("hub:get-state"),
  getBackendToken: () => ipcRenderer.invoke("hub:get-backend-token"),
  backendRequest: (endpoint, body = null) => ipcRenderer.invoke("hub:backend-request", { endpoint, body }),
  getSetupDiagnostics: () => ipcRenderer.invoke("hub:get-setup-diagnostics"),
  openExternalSafe: (url) => ipcRenderer.invoke("hub:open-external", url),
  installOllama: () => ipcRenderer.invoke("hub:install-ollama"),
  pullOllamaModel: (modelName) => ipcRenderer.invoke("hub:pull-ollama-model", modelName),
  installPythonDeps: () => ipcRenderer.invoke("hub:install-python-deps"),
  cancelSetupTask: () => ipcRenderer.invoke("hub:cancel-setup-task"),
  onSetupProgress: (callback) => {
    const handler = (_evt, payload) => callback(payload);
    ipcRenderer.on("setup:progress", handler);
    return () => ipcRenderer.removeListener("setup:progress", handler);
  },
  completeOnboarding: (payload) => ipcRenderer.invoke("hub:complete-onboarding", payload),
  reopenSetup: () => ipcRenderer.invoke("hub:reopen-setup"),
  sendPrompt: (text, context = null) => ipcRenderer.invoke("hub:send-prompt", { text, context }),
  sendVoiceWav: (wavBase64, hintTranscript = "", context = null) =>
    ipcRenderer.invoke("hub:send-voice-wav", { wavBase64, hintTranscript, context }),
  sendDictationWav: (wavBase64, autoType = true) =>
    ipcRenderer.invoke("hub:send-dictation-wav", { wavBase64, autoType }),
  pickContextFile: () => ipcRenderer.invoke("hub:pick-context-file"),
  grabClipboardContext: () => ipcRenderer.invoke("hub:grab-clipboard-context"),
  savePastedImage: (base64Data) => ipcRenderer.invoke("hub:save-pasted-image", base64Data),
  getFilePath: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return file?.path || "";
    }
  },
  sendAudioChunk: (base64Pcm) => ipcRenderer.send("hub:audio-chunk", base64Pcm),
  endAudioTurn: () => ipcRenderer.invoke("hub:audio-end"),
  stopTurn: () => ipcRenderer.invoke("hub:stop-turn"),
  resolveConfirm: (id, allowed) => ipcRenderer.invoke("hub:resolve-confirm", { id, allowed }),
  toggleSafetyMode: () => ipcRenderer.invoke("hub:toggle-safety"),
  setVoiceAlways: (enabled) => ipcRenderer.invoke("hub:set-voice-always", enabled),
  setHotkey: (spec) => ipcRenderer.invoke("hub:set-hotkey", spec),
  setWakeWord: (enabled) => ipcRenderer.invoke("hub:set-wake-word", enabled),
  setWakeName: (name) => ipcRenderer.invoke("hub:set-wake-name", name),
  setWakeSensitivity: (level) => ipcRenderer.invoke("hub:set-wake-sensitivity", level),
  setLocalModel: (presetId) => ipcRenderer.invoke("hub:set-local-model", presetId),
  setSakugaEnabled: (enabled) => ipcRenderer.invoke("hub:set-sakuga", Boolean(enabled)),
  setDisplayMode: (mode) => ipcRenderer.invoke("hub:set-display-mode", mode),
  setUiLanguage: (lang) => ipcRenderer.invoke("hub:set-ui-language", lang),
  saveDictionaryWord: (word) => ipcRenderer.invoke("hub:save-dict-word", word),
  removeDictionaryWord: (word) => ipcRenderer.invoke("hub:remove-dict-word", word),
  openExportsDir: () => ipcRenderer.invoke("hub:open-exports"),
  pauseWake: (paused) => ipcRenderer.send("hub:pause-wake", Boolean(paused)),
  speakText: (text) => ipcRenderer.invoke("hub:speak-text", text),
  exportWord: (title, content) => ipcRenderer.invoke("hub:export-word", { title, content }),
  setExpanded: (heightOrExpanded) => ipcRenderer.send("hub:resize", heightOrExpanded),
  recenterWindow: () => ipcRenderer.send("hub:recenter"),
  setIgnoreMouse: (ignore) => ipcRenderer.send("hub:set-ignore-mouse", Boolean(ignore)),
  reportActivityState: (state) => ipcRenderer.send("hub:activity-state", state),
  pingActivity: () => ipcRenderer.send("hub:ping-activity"),
  hideWindow: () => ipcRenderer.send("hub:hide"),
  quitApp: () => ipcRenderer.send("hub:quit"),
  onEvent: (callback) => {
    const handler = (_evt, payload) => callback(payload);
    ipcRenderer.on("hub:event", handler);
    return () => ipcRenderer.removeListener("hub:event", handler);
  },
});
