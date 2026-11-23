using System;
using System.Collections.Generic;
using System.Globalization;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Speech.Recognition;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows.Forms;

[assembly: AssemblyTitle("Jarvis Wake & Hotkey Service")]
[assembly: AssemblyProduct("Jarvis Desktop Hub")]
[assembly: AssemblyDescription("Background hotkey & offline 'Hey Jarvis' wake-word helper for Jarvis Desktop Hub")]
[assembly: AssemblyVersion("1.0.0.0")]

public class HotkeyForm : Form {
    [DllImport("user32.dll")]
    public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

    [DllImport("user32.dll")]
    public static extern bool UnregisterHotKey(IntPtr hWnd, int id);

    [DllImport("user32.dll")]
    public static extern short GetAsyncKeyState(int vKey);

    public const int WM_HOTKEY = 0x0312;
    public const int HOTKEY_ID = 9001;
    public const uint MOD_ALT = 0x0001;
    public const uint MOD_CONTROL = 0x0002;
    public const uint MOD_SHIFT = 0x0004;
    public const uint MOD_NOREPEAT = 0x4000;

    private uint currentMods = MOD_CONTROL | MOD_ALT;
    private int currentVk = 0x20;
    private string currentSpec = "ctrl+alt+space";
    private Timer pollTimer;
    private DateTime downTime;
    private bool holdConfirmed = false;
    private bool isDown = false;

    private SpeechRecognitionEngine recognizer;
    private Grammar wakeGrammar;
    private DictationGrammar dictationGrammar;
    private string currentWakeName = "luna";
    private string currentSensitivity = "balanced";
    private bool wakeEnabled = true;
    private bool wakePaused = false;
    private DateTime lastWakeAt = DateTime.MinValue;

    public HotkeyForm(string spec, bool enableWake, string wakeName, string sensitivity) {
        ShowInTaskbar = false;
        FormBorderStyle = FormBorderStyle.None;
        Opacity = 0;
        Width = 1;
        Height = 1;
        Left = -10000;
        Top = -10000;

        pollTimer = new Timer();
        pollTimer.Interval = 25;
        pollTimer.Tick += OnPollTick;
        SetHotkey(spec);

        wakeEnabled = enableWake;
        currentWakeName = SanitizeWakeName(wakeName);
        currentSensitivity = SanitizeSensitivity(sensitivity);
        InitWakeWord();
    }

    private static string SanitizeSensitivity(string raw) {
        string s = (raw ?? "").Trim().ToLowerInvariant();
        if (s == "high" || s == "strict" || s == "balanced") return s;
        return "balanced";
    }

    private static string SanitizeWakeName(string raw) {
        string clean = Regex.Replace((raw ?? "").Trim().ToLowerInvariant(), @"[^a-z0-9 ]+", " ");
        clean = Regex.Replace(clean, @"\s+", " ").Trim();
        if (clean.Length > 24) clean = clean.Substring(0, 24).Trim();
        return string.IsNullOrEmpty(clean) ? "luna" : clean;
    }

    private static string[] GetNameAliases(string name) {
        List<string> list = new List<string>();
        list.Add(name);
        if (name == "luna") {
            list.Add("lunar");
            list.Add("loona");
            list.Add("nuna");
        } else if (name == "nova") {
            list.Add("novah");
        } else if (name == "alpha") {
            list.Add("alfa");
        } else if (name == "sora") {
            list.Add("sorah");
        } else if (name == "milo") {
            list.Add("mylo");
            list.Add("melo");
        } else if (name == "jarvis") {
            list.Add("javis");
            list.Add("travis");
        }
        return list.ToArray();
    }

    private Grammar BuildWakeGrammar(CultureInfo ci, string name) {
        List<string> phraseList = new List<string>();
        string[] aliases = GetNameAliases(name);
        for (int i = 0; i < aliases.Length; i++) {
            string n = aliases[i];
            phraseList.Add("ok " + n);
            phraseList.Add("okay " + n);
            phraseList.Add("hey " + n);
            phraseList.Add("hello " + n);
            phraseList.Add("ey " + n);
            phraseList.Add("hi " + n);
        }
        phraseList.Add("ok " + name + " sleep");
        phraseList.Add("okay " + name + " sleep");
        phraseList.Add("hey " + name + " sleep");
        phraseList.Add(name + " sleep now");
        phraseList.Add(name + " go to sleep");

        Choices phrases = new Choices(phraseList.ToArray());
        GrammarBuilder gb = new GrammarBuilder(phrases);
        gb.Culture = ci;
        Grammar g = new Grammar(gb);
        g.Name = "jarvis_wake";
        g.Weight = 0.72f;
        g.Priority = 0;
        return g;
    }

    protected override void SetVisibleCore(bool value) {
        base.SetVisibleCore(false);
    }

    private void InitWakeWord() {
        try {
            CultureInfo ci = new CultureInfo("en-US");
            recognizer = new SpeechRecognitionEngine(ci);
            wakeGrammar = BuildWakeGrammar(ci, currentWakeName);
            recognizer.LoadGrammar(wakeGrammar);

            // Balanced background dictation grammar absorbs casual speech fairly so random talk never forces a false wake match
            try {
                dictationGrammar = new DictationGrammar();
                dictationGrammar.Name = "noise_dictation";
                dictationGrammar.Weight = 0.36f;
                dictationGrammar.Priority = 0;
                recognizer.LoadGrammar(dictationGrammar);
            } catch {}

            recognizer.MaxAlternates = 6;
            recognizer.InitialSilenceTimeout = TimeSpan.Zero;
            recognizer.BabbleTimeout = TimeSpan.Zero;
            recognizer.EndSilenceTimeout = TimeSpan.FromMilliseconds(180);
            recognizer.EndSilenceTimeoutAmbiguous = TimeSpan.FromMilliseconds(320);
            recognizer.SpeechRecognized += OnWakeRecognized;
            recognizer.RecognizeCompleted += OnRecognizeCompleted;
            recognizer.SetInputToDefaultAudioDevice();
            EmitJson("{\"event\":\"wake_ready\",\"ok\":true,\"name\":\"" + EscapeJson(currentWakeName) + "\",\"sensitivity\":\"" + currentSensitivity + "\"}");
            if (wakeEnabled) {
                recognizer.RecognizeAsync(RecognizeMode.Multiple);
            }
        } catch (Exception ex) {
            EmitJson("{\"event\":\"wake_ready\",\"ok\":false,\"error\":\"" + EscapeJson(ex.Message) + "\"}");
        }
    }

    public void SetWakeSensitivity(string level) {
        currentSensitivity = SanitizeSensitivity(level);
        EmitJson("{\"event\":\"wake_sensitivity\",\"level\":\"" + currentSensitivity + "\"}");
    }

    public void SetWakeName(string rawName) {
        string next = SanitizeWakeName(rawName);
        if (next == currentWakeName && wakeGrammar != null) {
            EmitJson("{\"event\":\"wake_name\",\"name\":\"" + EscapeJson(currentWakeName) + "\"}");
            return;
        }
        currentWakeName = next;
        if (recognizer == null) {
            EmitJson("{\"event\":\"wake_name\",\"name\":\"" + EscapeJson(currentWakeName) + "\"}");
            return;
        }
        try {
            CultureInfo ci = new CultureInfo("en-US");
            Grammar nextGrammar = BuildWakeGrammar(ci, currentWakeName);
            Grammar prevGrammar = wakeGrammar;
            recognizer.LoadGrammar(nextGrammar);
            wakeGrammar = nextGrammar;
            if (prevGrammar != null) {
                try { recognizer.UnloadGrammar(prevGrammar); } catch {}
            }
            EmitJson("{\"event\":\"wake_name\",\"name\":\"" + EscapeJson(currentWakeName) + "\"}");
        } catch (Exception ex) {
            EmitJson("{\"event\":\"wake_name\",\"ok\":false,\"error\":\"" + EscapeJson(ex.Message) + "\"}");
        }
    }

    private void OnRecognizeCompleted(object sender, RecognizeCompletedEventArgs e) {
        if (wakeEnabled && recognizer != null && !IsDisposed) {
            Task.Delay(250).ContinueWith(_ => {
                if (wakeEnabled && recognizer != null && !IsDisposed) {
                    try {
                        BeginInvoke((Action)(() => {
                            if (wakeEnabled && recognizer != null && !IsDisposed) {
                                try { recognizer.RecognizeAsync(RecognizeMode.Multiple); } catch {}
                            }
                        }));
                    } catch {}
                }
            });
        }
    }

    private float GetMinWakeConf(bool isSleep) {
        if (currentSensitivity == "high") return isSleep ? 0.44f : 0.38f;
        if (currentSensitivity == "strict") return isSleep ? 0.64f : 0.64f;
        return isSleep ? 0.52f : 0.48f;
    }

    private bool TextContainsWakeName(string txt) {
        string[] aliases = GetNameAliases(currentWakeName);
        for (int i = 0; i < aliases.Length; i++) {
            string esc = Regex.Escape(aliases[i]);
            if (Regex.IsMatch(txt, @"\b(?:hey|ok|okay|hello|ey|hi)\s+" + esc + @"\b", RegexOptions.IgnoreCase)) {
                return true;
            }
        }
        return false;
    }

    private void OnWakeRecognized(object sender, SpeechRecognizedEventArgs e) {
        if (e == null || e.Result == null) return;
        string gName = e.Result.Grammar != null ? (e.Result.Grammar.Name ?? "") : "";
        string txt = (e.Result.Text ?? "").Trim().ToLowerInvariant();
        float conf = e.Result.Confidence;
        double durMs = e.Result.Audio != null ? e.Result.Audio.Duration.TotalMilliseconds : 0;

        if (!wakeEnabled || wakePaused) {
            EmitJson("{\"event\":\"wake_debug\",\"status\":\"paused\",\"grammar\":\"" + EscapeJson(gName) + "\",\"text\":\"" + EscapeJson(txt) + "\",\"confidence\":" + conf.ToString("0.00", CultureInfo.InvariantCulture) + "}");
            return;
        }
        if (durMs < 360) return;

        bool matched = (wakeGrammar != null && e.Result.Grammar == wakeGrammar) || TextContainsWakeName(txt);
        string matchedTxt = txt;
        float matchedConf = conf;

        // Also inspect top N-best alternates in case dictation slightly outranked wake phrase
        if (!matched && e.Result.Alternates != null) {
            for (int i = 0; i < e.Result.Alternates.Count; i++) {
                RecognizedPhrase alt = e.Result.Alternates[i];
                if (alt == null) continue;
                string altTxt = (alt.Text ?? "").Trim().ToLowerInvariant();
                if (TextContainsWakeName(altTxt)) {
                    matched = true;
                    matchedTxt = altTxt;
                    matchedConf = Math.Max(alt.Confidence, conf);
                    break;
                }
            }
        }

        if (!matched) {
            EmitJson("{\"event\":\"wake_debug\",\"status\":\"ignored_chatter\",\"grammar\":\"" + EscapeJson(gName) + "\",\"text\":\"" + EscapeJson(txt) + "\",\"confidence\":" + conf.ToString("0.00", CultureInfo.InvariantCulture) + "}");
            return;
        }

        if (matchedTxt.Contains("sleep")) {
            if (matchedConf < GetMinWakeConf(true)) {
                EmitJson("{\"event\":\"wake_debug\",\"status\":\"low_conf_sleep\",\"grammar\":\"" + EscapeJson(gName) + "\",\"text\":\"" + EscapeJson(matchedTxt) + "\",\"confidence\":" + matchedConf.ToString("0.00", CultureInfo.InvariantCulture) + "}");
                return;
            }
            if ((DateTime.UtcNow - lastWakeAt).TotalMilliseconds < 1000) return;
            lastWakeAt = DateTime.UtcNow;
            EmitJson("{\"event\":\"sleep\",\"text\":\"" + EscapeJson(matchedTxt) + "\",\"confidence\":" + matchedConf.ToString("0.00", CultureInfo.InvariantCulture) + "}");
            return;
        }
        if (matchedConf < GetMinWakeConf(false)) {
            EmitJson("{\"event\":\"wake_debug\",\"status\":\"low_conf\",\"grammar\":\"" + EscapeJson(gName) + "\",\"text\":\"" + EscapeJson(matchedTxt) + "\",\"confidence\":" + matchedConf.ToString("0.00", CultureInfo.InvariantCulture) + "}");
            return;
        }
        if ((DateTime.UtcNow - lastWakeAt).TotalMilliseconds < 1300) return;
        lastWakeAt = DateTime.UtcNow;
        EmitJson("{\"event\":\"wake\",\"text\":\"" + EscapeJson(matchedTxt) + "\",\"confidence\":" + matchedConf.ToString("0.00", CultureInfo.InvariantCulture) + "}");
    }

    public void SetWakeEnabled(bool enabled) {
        wakeEnabled = enabled;
        SyncWakeEngine();
        EmitJson("{\"event\":\"wake_state\",\"enabled\":" + (wakeEnabled ? "true" : "false") + "}");
    }

    public void SetWakePaused(bool paused) {
        wakePaused = paused;
        if (wakeEnabled && !wakePaused) {
            SyncWakeEngine();
        }
    }

    private void SyncWakeEngine() {
        if (recognizer == null) return;
        try {
            if (wakeEnabled) {
                recognizer.RecognizeAsync(RecognizeMode.Multiple);
            } else {
                recognizer.RecognizeAsyncCancel();
            }
        } catch {}
    }

    private static bool IsVkPressed(int vk) {
        return (GetAsyncKeyState(vk) & 0x8000) != 0;
    }

    private bool AreKeysStillHeld() {
        if (!IsVkPressed(currentVk)) return false;
        if ((currentMods & MOD_CONTROL) != 0 && !IsVkPressed(0x11)) return false;
        if ((currentMods & MOD_ALT) != 0 && !IsVkPressed(0x12)) return false;
        if ((currentMods & MOD_SHIFT) != 0 && !IsVkPressed(0x10)) return false;
        return true;
    }

    private void OnPollTick(object sender, EventArgs e) {
        if (!isDown) {
            pollTimer.Stop();
            return;
        }
        double elapsedMs = (DateTime.UtcNow - downTime).TotalMilliseconds;
        if (!AreKeysStillHeld()) {
            pollTimer.Stop();
            isDown = false;
            if (holdConfirmed) {
                EmitJson("{\"event\":\"hold_end\"}");
            } else {
                EmitJson("{\"event\":\"tap\"}");
            }
            holdConfirmed = false;
            return;
        }
        if (!holdConfirmed && elapsedMs >= 230) {
            holdConfirmed = true;
            EmitJson("{\"event\":\"hold_confirmed\"}");
        }
    }

    public bool SetHotkey(string spec) {
        uint mods = 0;
        int vk = 0x20;
        string clean = (spec ?? "ctrl+alt+space").Trim().ToLowerInvariant();
        string[] parts = clean.Split('+');
        foreach (string raw in parts) {
            string p = raw.Trim();
            if (p == "ctrl" || p == "control") mods |= MOD_CONTROL;
            else if (p == "alt") mods |= MOD_ALT;
            else if (p == "shift") mods |= MOD_SHIFT;
            else if (p == "space") vk = 0x20;
            else if (p == "f9") vk = 0x78;
            else if (p == "f8") vk = 0x77;
            else if (p == "f10") vk = 0x79;
            else if (p == "grave" || p == "tilde") vk = 0xC0;
        }

        if (IsHandleCreated) {
            UnregisterHotKey(Handle, HOTKEY_ID);
        }
        currentMods = mods;
        currentVk = vk;
        currentSpec = clean;

        if (!IsHandleCreated) CreateHandle();
        bool ok = RegisterHotKey(Handle, HOTKEY_ID, currentMods | MOD_NOREPEAT, (uint)currentVk);
        EmitJson("{\"event\":\"registered\",\"spec\":\"" + currentSpec + "\",\"ok\":" + (ok ? "true" : "false") + "}");
        return ok;
    }

    protected override void WndProc(ref Message m) {
        if (m.Msg == WM_HOTKEY && m.WParam.ToInt32() == HOTKEY_ID) {
            if (!isDown) {
                isDown = true;
                holdConfirmed = false;
                downTime = DateTime.UtcNow;
                EmitJson("{\"event\":\"down\",\"spec\":\"" + currentSpec + "\"}");
                pollTimer.Start();
            }
            return;
        }
        base.WndProc(ref m);
    }

    protected override void OnFormClosed(FormClosedEventArgs e) {
        UnregisterHotKey(Handle, HOTKEY_ID);
        if (recognizer != null) {
            try { recognizer.RecognizeAsyncCancel(); recognizer.Dispose(); } catch {}
        }
        base.OnFormClosed(e);
    }

    private static string EscapeJson(string s) {
        return (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", " ").Replace("\n", " ");
    }

    private static void EmitJson(string json) {
        Console.Out.WriteLine(json);
        Console.Out.Flush();
    }

    [STAThread]
    public static void Main(string[] args) {
        string spec = "ctrl+alt+space";
        bool wake = true;
        string wakeName = "luna";
        string sensitivity = "balanced";
        for (int i = 0; i < args.Length; i++) {
            if (args[i] == "-InitialHotkey" && i + 1 < args.Length) {
                spec = args[++i];
            } else if (args[i] == "-EnableWakeWord" && i + 1 < args.Length) {
                wake = args[++i] != "0";
            } else if (args[i] == "-WakeName" && i + 1 < args.Length) {
                wakeName = args[++i];
            } else if (args[i] == "-WakeSensitivity" && i + 1 < args.Length) {
                sensitivity = args[++i];
            }
        }

        HotkeyForm form = new HotkeyForm(spec, wake, wakeName, sensitivity);

        Task.Run(() => {
            string line;
            while ((line = Console.In.ReadLine()) != null) {
                string trimmed = line.Trim();
                if (trimmed.Length == 0) continue;
                try {
                    Match cmdM = Regex.Match(trimmed, "\"cmd\"\\s*:\\s*\"([^\"]+)\"");
                    if (!cmdM.Success) continue;
                    string cmd = cmdM.Groups[1].Value;

                    if (cmd == "set_hotkey") {
                        Match specM = Regex.Match(trimmed, "\"spec\"\\s*:\\s*\"([^\"]+)\"");
                        if (specM.Success) {
                            string s = specM.Groups[1].Value;
                            form.BeginInvoke((Action)(() => form.SetHotkey(s)));
                        }
                    } else if (cmd == "set_wake_word") {
                        bool val = Regex.IsMatch(trimmed, "\"enabled\"\\s*:\\s*true", RegexOptions.IgnoreCase);
                        form.BeginInvoke((Action)(() => form.SetWakeEnabled(val)));
                    } else if (cmd == "set_wake_name") {
                        Match nameM = Regex.Match(trimmed, "\"name\"\\s*:\\s*\"([^\"]+)\"");
                        if (nameM.Success) {
                            string wn = nameM.Groups[1].Value;
                            form.BeginInvoke((Action)(() => form.SetWakeName(wn)));
                        }
                    } else if (cmd == "set_wake_sensitivity") {
                        Match lvlM = Regex.Match(trimmed, "\"level\"\\s*:\\s*\"([^\"]+)\"");
                        if (lvlM.Success) {
                            string lv = lvlM.Groups[1].Value;
                            form.BeginInvoke((Action)(() => form.SetWakeSensitivity(lv)));
                        }
                    } else if (cmd == "pause_wake") {
                        bool val = Regex.IsMatch(trimmed, "\"paused\"\\s*:\\s*true", RegexOptions.IgnoreCase);
                        form.BeginInvoke((Action)(() => form.SetWakePaused(val)));
                    } else if (cmd == "quit") {
                        form.BeginInvoke((Action)(() => form.Close()));
                        break;
                    }
                } catch {}
            }
        });

        Application.Run(form);
    }
}
