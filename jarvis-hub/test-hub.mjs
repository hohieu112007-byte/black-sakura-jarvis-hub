import assert from "node:assert/strict";
import path from "node:path";
import {
  loadHubState,
  readSafetyMode,
  FAST_DESKTOP_SERVER,
  resolveGeminiApiKeys,
  discoverInstalledAppNamesSync,
} from "./src/env-loader.mjs";
import { McpHub } from "./src/mcp-hub.mjs";
import { GeminiAgent, buildLiveTools, buildInteractionsTools, sanitizeSchema, FALLBACK_MODELS, isSleepCommandText, isCleanOneShotSuccess } from "./src/gemini-agent.mjs";
import { tryLocalFallbackCommand, tryInstantFastPath } from "./src/local-fallback.mjs";

const st = loadHubState();
assert.equal(typeof st.hotkey, "string");
assert.notEqual(st.hotkey, "ctrl+space");
assert.equal(typeof st.voiceReplyAlways, "boolean");
const installedApps = discoverInstalledAppNamesSync(40);
assert.ok(Array.isArray(installedApps) && installedApps.length > 0, "Should discover installed desktop/start-menu apps");
assert.equal(installedApps.some((n) => /uninstall|error\s*reporter/i.test(n)), false, "Should filter junk updater/uninstall shortcuts");
console.log("STATE_OK:", st.hotkey, "safetyMode=" + readSafetyMode(), "server=" + path.basename(FAST_DESKTOP_SERVER), "apps=" + installedApps.length);

let confirmCalled = false;
const hub = new McpHub({
  safetyMode: "safe",
  onConfirmRequest: async ({ toolName }) => {
    confirmCalled = true;
    assert.equal(toolName, "window_control");
    return false; // deny for test
  },
});

try {
  await hub.startCore();
  const fdTools = hub.getFastDesktopTools();
  assert.equal(fdTools.length, 15, `Expected 15 fast-desktop tools, got ${fdTools.length}`);
  const uiaClickTool = fdTools.find((t) => t.name === "uia_click");
  const uiaReadTool = fdTools.find((t) => t.name === "uia_read");
  assert.ok(uiaClickTool.inputSchema.properties.slider_value, "uia_click should expose slider_value");
  assert.ok(uiaClickTool.inputSchema.properties.slider_delta, "uia_click should expose slider_delta");
  assert.ok(uiaClickTool.inputSchema.properties.click_ratio, "uia_click should expose click_ratio");
  assert.ok(uiaClickTool.inputSchema.properties.runtime_id, "uia_click should expose runtime_id");
  assert.ok(uiaClickTool.inputSchema.properties.clear_first, "uia_click should expose clear_first");
  assert.ok(uiaClickTool.inputSchema.properties.sort_by, "uia_click should expose sort_by");
  assert.ok(uiaReadTool.inputSchema.properties.include_controls, "uia_read should expose include_controls");
  assert.ok(uiaReadTool.inputSchema.properties.content_only, "uia_read should expose content_only");
  console.log("MCP_HUB_CORE_OK: tools=" + fdTools.length);

  // Read-only tool executes without confirmation even in safe mode
  const lw = await hub.executeTool("fastDesktop", "list_windows", {});
  assert.equal(typeof lw.count, "number");
  assert.equal(confirmCalled, false);
  console.log("READ_ONLY_SAFE_OK:", lw.count);

  // Action tool triggers confirmation in safe mode and respects denial
  const denied = await hub.executeTool("fastDesktop", "window_control", { action: "minimize", process: "notepad" });
  assert.equal(confirmCalled, true);
  assert.equal(denied.cancelled_by_user, true);
  console.log("SAFE_MODE_CONFIRM_GATE_OK");

  // Schema builders for Live API & Interactions API
  const liveTools = buildLiveTools(fdTools, true);
  assert.ok(liveTools[0].googleSearch);
  assert.equal(liveTools[1].functionDeclarations.length, 18); // 15 + delegate_deep_task + speak_aloud + sleep_hub
  assert.equal(liveTools[1].functionDeclarations[0].behavior, "NON_BLOCKING");

  const interTools = buildInteractionsTools(fdTools.map((tool) => ({ serverKey: "fastDesktop", tool })), true);
  assert.equal(interTools.length, 16);
  assert.equal(interTools[0].type, "function");
  const interToolsWithSleep = buildInteractionsTools(fdTools.map((tool) => ({ serverKey: "fastDesktop", tool })), true, true);
  assert.equal(interToolsWithSleep.length, 17);
  assert.ok(interToolsWithSleep.some((t) => t.name === "sleep_hub"));
  assert.equal(isSleepCommandText("Jarvis sleep"), true);
  assert.equal(isSleepCommandText("ngủ đi Jarvis"), true);
  assert.equal(isSleepCommandText("mở youtube"), false);
  assert.equal(isCleanOneShotSuccess("close_app", { remaining_count: 2 }), false);
  assert.equal(isCleanOneShotSuccess("close_app", { remaining_count: 0 }), true);
  assert.equal(isCleanOneShotSuccess("open_edge_url", { focused: false }), false);
  assert.equal(isCleanOneShotSuccess("open_edge_url", { focused: true }), true);
  assert.equal(isCleanOneShotSuccess("launch_app", { window_found: false, already_running: false }), false);
  assert.equal(typeof sanitizeSchema({ type: "object", additionalProperties: false }).additionalProperties, "undefined");
  console.log("GEMINI_TOOL_SCHEMAS_OK");

  // Anti-spam guard & stopCurrentTurn test
  const fakeHub = {
    executeTool: async () => {
      throw new Error("No UI element matched");
    },
  };
  const testAgent = new GeminiAgent({ mcpHub: fakeHub, onHudEvent: () => {} });
  const r1 = await testAgent.executeGuardedTool("fastDesktop", "uia_click", { name: "foo" }, testAgent.turnEpoch);
  const r2 = await testAgent.executeGuardedTool("fastDesktop", "uia_click", { name: "bar" }, testAgent.turnEpoch);
  const r3 = await testAgent.executeGuardedTool("fastDesktop", "uia_click", { name: "baz" }, testAgent.turnEpoch);
  assert.equal(r1.uia_failures_in_turn, 1);
  assert.equal(r2.uia_failures_in_turn, 2);
  assert.equal(r3.STOP_RETRY, true);

  testAgent.stopCurrentTurn();
  const rAfterStop = await testAgent.executeGuardedTool("fastDesktop", "list_windows", {}, 0);
  assert.equal(rAfterStop.cancelled_by_user, true);

  // Denial cancellation test: denying confirmation cancels turn immediately and prevents retries
  let cancelledEvt = false;
  const denyAgent = new GeminiAgent({
    mcpHub: { executeTool: async () => ({ cancelled_by_user: true, message: "denied" }) },
    onHudEvent: (e) => {
      if (e.type === "turn_cancelled") cancelledEvt = true;
    },
  });
  const eBefore = denyAgent.turnEpoch;
  const denyRes = await denyAgent.executeGuardedTool("fastDesktop", "open_edge_url", { url: "https://www.youtube.com" }, eBefore);
  assert.equal(denyRes.cancelled_by_user, true);
  assert.equal(denyRes.STOP_RETRY, true);
  assert.equal(cancelledEvt, true);
  assert.notEqual(denyAgent.turnEpoch, eBefore);
  console.log("ANTI_SPAM_AND_STOP_TURN_OK");

  // Verify redundant new_tab: true is stripped when url is provided
  let capturedArgs = null;
  const normAgent = new GeminiAgent({
    mcpHub: {
      executeTool: async (_srv, _name, a) => {
        capturedArgs = a;
        return { ok: true };
      },
    },
    onHudEvent: () => {},
  });
  await normAgent.executeGuardedTool("fastDesktop", "open_edge_url", { url: "https://www.youtube.com", new_tab: true });
  assert.equal(typeof capturedArgs.new_tab, "undefined");
  assert.equal(capturedArgs.url, "https://www.youtube.com");

  // Verify hallucinated youtube_search: "youtube" is normalized straight to https://www.youtube.com
  await normAgent.executeGuardedTool("fastDesktop", "open_edge_url", { youtube_search: "youtube" });
  assert.equal(typeof capturedArgs.youtube_search, "undefined");
  assert.equal(capturedArgs.url, "https://www.youtube.com");

  // Verify Zero-Token Local Offline Fallback Engine
  assert.ok(FALLBACK_MODELS.includes("gemini-3.8-flash"));
  assert.ok(FALLBACK_MODELS.includes("gemini-3.5-flash-lite"));
  const recordedCalls = [];
  const fbYt = await tryLocalFallbackCommand("bật một tab YouTube", async (_srv, name, args) => {
    recordedCalls.push({ name, args });
    return { ok: true };
  });
  assert.equal(fbYt.handled, true);
  assert.equal(recordedCalls[0].name, "open_edge_url");
  assert.equal(recordedCalls[0].args.url, "https://www.youtube.com");
  assert.equal(typeof recordedCalls[0].args.new_tab, "undefined");

  const skipComplex = await tryInstantFastPath("mở youtube rồi chọn video đầu tiên", async () => ({ ok: true }));
  assert.equal(skipComplex.handled, false);
  const fastHit = await tryInstantFastPath("mở YouTube", async () => ({ ok: true }));
  assert.equal(fastHit.handled, true);

  // Verify "mở app facebook" launches Facebook app (not Edge tab) and "ẩn edge" minimizes (not closes)
  const appCalls = [];
  const fbAppRes = await tryInstantFastPath("mở app facebook", async (_s, name, args) => {
    appCalls.push({ name, args });
    return { ok: true };
  });
  assert.equal(fbAppRes.handled, true);
  assert.equal(appCalls[0].name, "launch_app");
  assert.equal(appCalls[0].args.app, "facebook");

  const minRes = await tryInstantFastPath("ẩn edge", async (_s, name, args) => {
    appCalls.push({ name, args });
    return { ok: true };
  });
  assert.equal(minRes.handled, true);
  assert.equal(appCalls[1].name, "window_control");
  assert.equal(appCalls[1].args.action, "minimize");

  const maxFbRes = await tryInstantFastPath("cho app facebook full màn hình", async (_s, name, args) => {
    appCalls.push({ name, args });
    return { ok: true };
  });
  assert.equal(maxFbRes.handled, true);
  assert.equal(appCalls[2].name, "window_control");
  assert.equal(appCalls[2].args.title, "Facebook");
  assert.equal(appCalls[2].args.action, "maximize");

  const closeFbRes = await tryInstantFastPath("tắt app facebook", async (_s, name, args) => {
    appCalls.push({ name, args });
    return { ok: true, pwa_window_mode: true, windows_closed: 1, remaining_count: 0 };
  });
  assert.equal(closeFbRes.handled, true);
  assert.equal(appCalls[3].name, "close_app");
  assert.equal(appCalls[3].args.app, "facebook");

  const dynOpenRes = await tryInstantFastPath("mở app capcut", async (_s, name, args) => {
    appCalls.push({ name, args });
    return { ok: true };
  });
  assert.equal(dynOpenRes.handled, true);
  assert.equal(appCalls[4].name, "launch_app");
  assert.equal(appCalls[4].args.app, "capcut");

  const dynCloseRes = await tryInstantFastPath("tắt app chatgpt", async (_s, name, args) => {
    appCalls.push({ name, args });
    return { ok: true, pwa_window_mode: true, windows_closed: 1, remaining_count: 0 };
  });
  assert.equal(dynCloseRes.handled, true);
  assert.equal(appCalls[5].name, "close_app");
  assert.equal(appCalls[5].args.app, "chatgpt");

  const fastHub = new McpHub({ safetyMode: "turbo" });
  const fastAgentCalls = [];
  fastHub.executeTool = async (srv, name, args) => {
    fastAgentCalls.push({ srv, name, args });
    return { ok: true, window_found: true, pwa_window_mode: true, remaining_count: 0 };
  };
  const fastAgent = new GeminiAgent({ mcpHub: fastHub });
  fastAgent.createInteractionWithFallback = async () => {
    throw new Error("Gemini API must NOT be called when Fast-Path handles open/close Facebook!");
  };
  const tOpenStart = Date.now();
  const rFastOpen = await fastAgent.runTextTurn("mở app facebook");
  const rFastClose = await fastAgent.runTextTurn("tắt app facebook");
  assert.ok(Date.now() - tOpenStart < 500, "Fast-Path open+close Facebook should complete instantly");
  assert.equal(rFastOpen.modelLabel, "⚡ Fast-Path (<50ms)");
  assert.equal(rFastClose.modelLabel, "⚡ Fast-Path (<50ms)");
  assert.equal(fastAgentCalls[0].name, "launch_app");
  assert.equal(fastAgentCalls[0].args.app, "facebook");
  assert.equal(fastAgentCalls[1].name, "close_app");
  assert.equal(fastAgentCalls[1].args.app, "facebook");

  // Verify modular prompt compression reduces ~8.9k chars to <1.6k (non-app text) / <3.8k (voice)
  const pBright = fastAgent.buildContextualPrompt("giảm độ sáng");
  const pQuiz = fastAgent.buildContextualPrompt("đọc và làm trắc nghiệm trang này");
  const pMic = fastAgent.buildContextualPrompt("bật mic discord");
  const pVoice = fastAgent.buildContextualPrompt("tìm video mới", { isVoice: true });
  assert.ok(pBright.length < 1600, `Expected compact prompt <1600 chars, got ${pBright.length}`);
  assert.ok(pQuiz.includes("include_controls") && pQuiz.includes("runtime_id"));
  assert.ok(pMic.includes("Tắt âm") && pMic.includes("toggle_state"));
  assert.ok(pVoice.length < 3800, `Expected compact voice prompt <3800 chars, got ${pVoice.length}`);

  // Verify slider seek & Nth YouTube video fast-paths
  const seekCalls = [];
  const seekDeltaRes = await tryInstantFastPath("tua thêm 5 phút", async (_s, name, args) => {
    seekCalls.push({ name, args });
    return { ok: true, slider_seek: { after_text: "05:10" } };
  });
  assert.equal(seekDeltaRes.handled, true);
  assert.equal(seekCalls[0].args.role, "slider");
  assert.equal(seekCalls[0].args.slider_delta, 300);

  const seekAbsRes = await tryInstantFastPath("tua video tới 1 tiếng 15 phút", async (_s, name, args) => {
    seekCalls.push({ name, args });
    return { ok: true, slider_seek: { after_text: "1:15:00" } };
  });
  assert.equal(seekAbsRes.handled, true);
  assert.equal(seekCalls[1].args.slider_value, 4500);

  const nthRes = await tryInstantFastPath("chọn video thứ 2 từ trái sang", async (_s, name, args) => {
    seekCalls.push({ name, args });
    return { ok: true };
  });
  assert.equal(nthRes.handled, true);
  assert.equal(seekCalls[2].args.role, "video");
  assert.equal(seekCalls[2].args.index, 1);

  const micCalls = [];
  let mockMicState = "On";
  const micDiscordEnableRes = await tryInstantFastPath("bật mic discord", async (_s, name, args) => {
    micCalls.push({ name, args });
    if (args.dry_run) {
      return { matches: [{ name: "Tắt âm", role: "button", toggle_state: mockMicState }] };
    }
    mockMicState = "Off";
    return { ok: true };
  });
  assert.equal(micDiscordEnableRes.handled, true);
  assert.equal(micCalls.length, 2);
  assert.equal(micCalls[0].name, "uia_click");
  assert.equal(micCalls[0].args.dry_run, true);
  assert.equal(micCalls[1].name, "uia_click");
  assert.equal(micCalls[1].args.restore_focus, true);

  const micDiscordAlreadyOff = await tryInstantFastPath("tắt mic discord", async (_s, name, args) => {
    if (args.dry_run) return { matches: [{ name: "Tắt âm", role: "button", toggle_state: "On" }] };
    throw new Error("Should not click Tắt âm when mic is already muted (toggle_state On)");
  });
  assert.equal(micDiscordAlreadyOff.handled, true);
  console.log("OFFLINE_FALLBACK_AND_URL_NORMALIZATION_OK: keys=" + resolveGeminiApiKeys().length);

  // Verify agent-desktop Safe Mode policy (read-only vs click) and lazy-load availability
  assert.equal(hub.requiresConfirmation("desktop_snapshot", {}), false);
  assert.equal(hub.requiresConfirmation("desktop_screenshot", {}), false);
  assert.equal(hub.requiresConfirmation("desktop_click", { ref: "e1" }), true);
  assert.equal(hub.clients.agentDesktop.idleTimeoutMs, 0, "agentDesktop should stay warm without idle timeout");
  await hub.clients.agentDesktop.ensureReady();
  assert.ok(hub.clients.agentDesktop.tools.length > 10, "agent-desktop tools should load");
  const shot = await hub.executeTool("agentDesktop", "desktop_screenshot", { screen: 0 });
  assert.ok(Array.isArray(shot.__mcpImages) && shot.__mcpImages.length === 1, "desktop_screenshot should preserve image payload");
  assert.ok(shot.__mcpImages[0].data.length > 1000, "desktop_screenshot image data should be non-empty base64 PNG");
  console.log("AGENT_DESKTOP_LAZY_OK: tools=" + hub.clients.agentDesktop.tools.length);
} finally {
  hub.closeAll();
}
