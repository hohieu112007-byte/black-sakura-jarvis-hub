[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ErrorActionPreference = "Stop"

Add-Type -ReferencedAssemblies UIAutomationClient, UIAutomationTypes, WindowsBase -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows;
using System.Windows.Automation;

public static class Win32FastDesktop {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsZoomed(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder strText, int maxCount);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool BringWindowToTop(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    [DllImport("kernel32.dll")]
    public static extern uint GetCurrentThreadId();

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

    [DllImport("user32.dll")]
    public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern long GetWindowLongPtr(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll")]
    public static extern bool GetCursorPos(out POINT lpPoint);

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT {
        public int X;
        public int Y;
    }

    [DllImport("user32.dll")]
    public static extern bool SetProcessDpiAwarenessContext(IntPtr dpiFlag);

    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();

    public static void EnablePerMonitorDpi() {
        try {
            // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4
            if (!SetProcessDpiAwarenessContext(new IntPtr(-4))) {
                SetProcessDPIAware();
            }
        } catch {
            try { SetProcessDPIAware(); } catch {}
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct HARDWAREINPUT {
        public uint uMsg;
        public ushort wParamL;
        public ushort wParamH;
    }

    [StructLayout(LayoutKind.Explicit)]
    public struct InputUnion {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
        [FieldOffset(0)] public HARDWAREINPUT hi;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT {
        public uint type;
        public InputUnion U;
    }

    public const uint INPUT_MOUSE = 0;
    public const uint INPUT_KEYBOARD = 1;
    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP = 0x0004;
    public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    public const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    public const uint MOUSEEVENTF_WHEEL = 0x0800;
    public const uint MOUSEEVENTF_HWHEEL = 0x1000;
    public const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
    public const uint KEYEVENTF_KEYUP = 0x0002;
    public const uint KEYEVENTF_UNICODE = 0x0004;
    public const ushort VK_RETURN = 0x0D;
    public const uint MONITOR_DEFAULTTONEAREST = 0x00000002;
    public const uint MONITORINFOF_PRIMARY = 0x00000001;

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MONITORINFO {
        public int cbSize;
        public RECT rcMonitor;
        public RECT rcWork;
        public uint dwFlags;
    }

    public delegate bool MonitorEnumProc(IntPtr hMonitor, IntPtr hdcMonitor, ref RECT lprcMonitor, IntPtr dwData);

    [DllImport("user32.dll")]
    public static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr lprcClip, MonitorEnumProc lpfnEnum, IntPtr dwData);

    [DllImport("user32.dll")]
    public static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);

    [DllImport("user32.dll")]
    public static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint dwFlags);

    public static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
    public static readonly IntPtr HWND_NOTOPMOST = new IntPtr(-2);
    public const int SW_MAXIMIZE = 3;
    public const int SW_SHOW = 5;
    public const int SW_MINIMIZE = 6;
    public const int SW_RESTORE = 9;
    public const uint WM_CLOSE = 0x0010;
    public const uint SWP_NOSIZE = 0x0001;
    public const uint SWP_NOMOVE = 0x0002;
    public const uint SWP_NOZORDER = 0x0004;
    public const uint SWP_NOACTIVATE = 0x0010;
    public const uint SWP_SHOWWINDOW = 0x0040;
    public const int GWL_EXSTYLE = -20;
    public const long WS_EX_TOOLWINDOW = 0x00000080L;

    public class WindowInfo {
        public string hwnd;
        public int pid;
        public string process;
        public string title;
        public int x;
        public int y;
        public int width;
        public int height;
        public bool minimized;
        public bool maximized;
        public bool focused;
    }

    public static List<WindowInfo> ListWindows() {
        var list = new List<WindowInfo>();
        IntPtr fg = GetForegroundWindow();
        var procCache = new Dictionary<int, string>();

        EnumWindows((hWnd, lParam) => {
            if (!IsWindowVisible(hWnd)) return true;
            int len = GetWindowTextLength(hWnd);
            if (len <= 0) return true;

            long exStyle = GetWindowLongPtr(hWnd, GWL_EXSTYLE);
            if ((exStyle & WS_EX_TOOLWINDOW) != 0) return true;

            var sb = new StringBuilder(len + 1);
            GetWindowText(hWnd, sb, sb.Capacity);
            string title = sb.ToString();
            if (string.IsNullOrWhiteSpace(title)) return true;

            uint pidUint;
            GetWindowThreadProcessId(hWnd, out pidUint);
            int pid = (int)pidUint;

            string procName;
            if (!procCache.TryGetValue(pid, out procName)) {
                try {
                    procName = Process.GetProcessById(pid).ProcessName;
                } catch {
                    procName = "unknown";
                }
                procCache[pid] = procName;
            }

            if (procName.Equals("TextInputHost", StringComparison.OrdinalIgnoreCase)) return true;

            RECT rect;
            GetWindowRect(hWnd, out rect);

            list.Add(new WindowInfo {
                hwnd = hWnd.ToInt64().ToString(),
                pid = pid,
                process = procName,
                title = title,
                x = rect.Left,
                y = rect.Top,
                width = rect.Right - rect.Left,
                height = rect.Bottom - rect.Top,
                minimized = IsIconic(hWnd),
                maximized = IsZoomed(hWnd),
                focused = (hWnd == fg)
            });
            return true;
        }, IntPtr.Zero);

        return list;
    }

    public static bool FocusWindow(IntPtr hWnd) {
        if (!IsWindow(hWnd)) return false;
        if (IsIconic(hWnd)) {
            ShowWindow(hWnd, SW_RESTORE);
            System.Threading.Thread.Sleep(60);
        }

        if (GetForegroundWindow() == hWnd) return true;

        SetForegroundWindow(hWnd);
        if (GetForegroundWindow() == hWnd) return true;

        IntPtr fg = GetForegroundWindow();
        uint dummy;
        uint fgThread = fg != IntPtr.Zero ? GetWindowThreadProcessId(fg, out dummy) : 0;
        uint curThread = GetCurrentThreadId();

        bool attachedFg = false;
        try {
            if (fgThread != 0 && fgThread != curThread) {
                attachedFg = AttachThreadInput(curThread, fgThread, true);
            }
            BringWindowToTop(hWnd);
            SetForegroundWindow(hWnd);
        } finally {
            if (attachedFg) AttachThreadInput(curThread, fgThread, false);
        }

        if (GetForegroundWindow() != hWnd) {
            // Bypass Windows foreground lock cleanly from background worker via transient ALT tap + TOPMOST raise
            try {
                keybd_event(0x12, 0, 0, UIntPtr.Zero);
                keybd_event(0x12, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
                SetWindowPos(hWnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
                SetWindowPos(hWnd, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
                BringWindowToTop(hWnd);
                SetForegroundWindow(hWnd);
            } catch {}
        }

        return GetForegroundWindow() == hWnd;
    }

    public static uint SendUnicodeText(IntPtr hWnd, string text, bool pressEnter) {
        if (GetForegroundWindow() != hWnd) {
            return 0;
        }
        int cbSize = Marshal.SizeOf(typeof(INPUT));
        uint sentEvents = 0;

        foreach (char ch in text) {
            if (ch == '\r') continue;
            if (ch == '\n') {
                var enterInputs = new INPUT[2];
                enterInputs[0].type = INPUT_KEYBOARD;
                enterInputs[0].U.ki.wVk = VK_RETURN;
                enterInputs[1].type = INPUT_KEYBOARD;
                enterInputs[1].U.ki.wVk = VK_RETURN;
                enterInputs[1].U.ki.dwFlags = KEYEVENTF_KEYUP;
                sentEvents += SendInput(2, enterInputs, cbSize);
                System.Threading.Thread.Sleep(5);
                continue;
            }

            var inputs = new INPUT[2];
            inputs[0].type = INPUT_KEYBOARD;
            inputs[0].U.ki.wVk = 0;
            inputs[0].U.ki.wScan = (ushort)ch;
            inputs[0].U.ki.dwFlags = KEYEVENTF_UNICODE;

            inputs[1].type = INPUT_KEYBOARD;
            inputs[1].U.ki.wVk = 0;
            inputs[1].U.ki.wScan = (ushort)ch;
            inputs[1].U.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;

            sentEvents += SendInput(2, inputs, cbSize);
            System.Threading.Thread.Sleep(2);
        }

        if (pressEnter) {
            System.Threading.Thread.Sleep(60);
            var retInputs = new INPUT[2];
            retInputs[0].type = INPUT_KEYBOARD;
            retInputs[0].U.ki.wVk = VK_RETURN;
            retInputs[1].type = INPUT_KEYBOARD;
            retInputs[1].U.ki.wVk = VK_RETURN;
            retInputs[1].U.ki.dwFlags = KEYEVENTF_KEYUP;
            sentEvents += SendInput(2, retInputs, cbSize);
        }

        return sentEvents;
    }

    public static string ClickWindowPoint(IntPtr hWnd, int x, int y, string button, int count, bool restoreCursor) {
        if (GetForegroundWindow() != hWnd) {
            return "ERR_NOT_FOREGROUND";
        }
        RECT rect;
        if (!GetWindowRect(hWnd, out rect)) {
            return "ERR_GET_RECT";
        }
        if (x < rect.Left || x >= rect.Right || y < rect.Top || y >= rect.Bottom) {
            return string.Format("ERR_OUT_OF_BOUNDS:({0},{1}) outside [{2},{3}..{4},{5})", x, y, rect.Left, rect.Top, rect.Right, rect.Bottom);
        }

        POINT savedPos;
        bool hasSavedPos = GetCursorPos(out savedPos);

        SetCursorPos(x, y);
        System.Threading.Thread.Sleep(8);

        uint downFlag = button == "right" ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_LEFTDOWN;
        uint upFlag = button == "right" ? MOUSEEVENTF_RIGHTUP : MOUSEEVENTF_LEFTUP;
        int cbSize = Marshal.SizeOf(typeof(INPUT));
        int clicks = Math.Max(1, Math.Min(2, count));
        uint sent = 0;

        try {
            for (int i = 0; i < clicks; i++) {
                var inputs = new INPUT[2];
                inputs[0].type = INPUT_MOUSE;
                inputs[0].U.mi.dwFlags = downFlag;
                inputs[1].type = INPUT_MOUSE;
                inputs[1].U.mi.dwFlags = upFlag;
                sent += SendInput(2, inputs, cbSize);
                if (i + 1 < clicks) System.Threading.Thread.Sleep(25);
            }
        } finally {
            if (restoreCursor && hasSavedPos) {
                System.Threading.Thread.Sleep(5);
                SetCursorPos(savedPos.X, savedPos.Y);
            }
        }
        return sent > 0 ? "OK:" + sent.ToString() : "ERR_SENDINPUT_ZERO";
    }

    public static string ScrollWindow(IntPtr hWnd, int x, int y, int dx, int dy, bool restoreCursor) {
        if (GetForegroundWindow() != hWnd) {
            return "ERR_NOT_FOREGROUND";
        }
        RECT rect;
        if (!GetWindowRect(hWnd, out rect)) {
            return "ERR_GET_RECT";
        }
        if (x < rect.Left || x >= rect.Right || y < rect.Top || y >= rect.Bottom) {
            return string.Format("ERR_OUT_OF_BOUNDS:({0},{1}) outside [{2},{3}..{4},{5})", x, y, rect.Left, rect.Top, rect.Right, rect.Bottom);
        }

        POINT savedPos;
        bool hasSavedPos = GetCursorPos(out savedPos);
        SetCursorPos(x, y);
        System.Threading.Thread.Sleep(8);

        int cbSize = Marshal.SizeOf(typeof(INPUT));
        uint sent = 0;
        try {
            if (dy != 0) {
                var inputs = new INPUT[1];
                inputs[0].type = INPUT_MOUSE;
                inputs[0].U.mi.dwFlags = MOUSEEVENTF_WHEEL;
                inputs[0].U.mi.mouseData = unchecked((uint)(dy * 120));
                sent += SendInput(1, inputs, cbSize);
            }
            if (dx != 0) {
                var inputs = new INPUT[1];
                inputs[0].type = INPUT_MOUSE;
                inputs[0].U.mi.dwFlags = MOUSEEVENTF_HWHEEL;
                inputs[0].U.mi.mouseData = unchecked((uint)(dx * 120));
                sent += SendInput(1, inputs, cbSize);
            }
        } finally {
            if (restoreCursor && hasSavedPos) {
                System.Threading.Thread.Sleep(5);
                SetCursorPos(savedPos.X, savedPos.Y);
            }
        }
        return sent > 0 ? "OK:" + sent.ToString() : "ERR_SENDINPUT_ZERO";
    }

    public class MonitorItem {
        public bool isPrimary;
        public int workLeft;
        public int workTop;
        public int workRight;
        public int workBottom;
        public int workWidth;
        public int workHeight;
    }

    public static List<MonitorItem> ListMonitors() {
        var raw = new List<MonitorItem>();
        EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, delegate(IntPtr hMon, IntPtr hdc, ref RECT lprc, IntPtr data) {
            MONITORINFO mi = new MONITORINFO();
            mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
            if (GetMonitorInfo(hMon, ref mi)) {
                raw.Add(new MonitorItem {
                    isPrimary = (mi.dwFlags & MONITORINFOF_PRIMARY) != 0,
                    workLeft = mi.rcWork.Left,
                    workTop = mi.rcWork.Top,
                    workRight = mi.rcWork.Right,
                    workBottom = mi.rcWork.Bottom,
                    workWidth = mi.rcWork.Right - mi.rcWork.Left,
                    workHeight = mi.rcWork.Bottom - mi.rcWork.Top
                });
            }
            return true;
        }, IntPtr.Zero);

        raw.Sort(delegate(MonitorItem a, MonitorItem b) {
            if (a.isPrimary != b.isPrimary) return a.isPrimary ? -1 : 1;
            return a.workLeft.CompareTo(b.workLeft);
        });
        return raw;
    }

    public static MonitorItem GetWindowMonitor(IntPtr hWnd) {
        IntPtr hMon = MonitorFromWindow(hWnd, MONITOR_DEFAULTTONEAREST);
        if (hMon != IntPtr.Zero) {
            MONITORINFO mi = new MONITORINFO();
            mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
            if (GetMonitorInfo(hMon, ref mi)) {
                return new MonitorItem {
                    isPrimary = (mi.dwFlags & MONITORINFOF_PRIMARY) != 0,
                    workLeft = mi.rcWork.Left,
                    workTop = mi.rcWork.Top,
                    workRight = mi.rcWork.Right,
                    workBottom = mi.rcWork.Bottom,
                    workWidth = mi.rcWork.Right - mi.rcWork.Left,
                    workHeight = mi.rcWork.Bottom - mi.rcWork.Top
                };
            }
        }
        var all = ListMonitors();
        return all.Count > 0 ? all[0] : null;
    }

    public static bool SnapWindow(IntPtr hWnd, string mode) {
        return SnapWindow(hWnd, mode, 0);
    }

    public static bool SnapWindow(IntPtr hWnd, string mode, int targetMonitor) {
        if (!IsWindow(hWnd)) return false;
        if (IsIconic(hWnd) || IsZoomed(hWnd)) {
            ShowWindow(hWnd, SW_RESTORE);
            System.Threading.Thread.Sleep(40);
        }

        var monitors = ListMonitors();
        if (monitors.Count == 0) return false;

        MonitorItem curMon = GetWindowMonitor(hWnd);
        MonitorItem mon = curMon;
        if (mode == "move_monitor_1" || targetMonitor == 1) {
            mon = monitors[0];
        } else if (mode == "move_monitor_2" || targetMonitor == 2) {
            mon = monitors.Count > 1 ? monitors[1] : monitors[0];
        } else if (mode == "move_smaller_monitor") {
            mon = monitors[0];
            long bestArea = (long)mon.workWidth * (long)mon.workHeight;
            foreach (var cand in monitors) {
                long area = (long)cand.workWidth * (long)cand.workHeight;
                if (area > 0 && area < bestArea) {
                    bestArea = area;
                    mon = cand;
                }
            }
        } else if (mode == "move_larger_monitor") {
            mon = monitors[0];
            long bestArea = (long)mon.workWidth * (long)mon.workHeight;
            foreach (var cand in monitors) {
                long area = (long)cand.workWidth * (long)cand.workHeight;
                if (area > bestArea) {
                    bestArea = area;
                    mon = cand;
                }
            }
        }
        if (mon == null) return false;

        bool crossedMonitor = (curMon == null) || (curMon.workLeft != mon.workLeft || curMon.workTop != mon.workTop);

        if (mode == "maximize") {
            if (crossedMonitor) {
                int tmpW = Math.Min(960, Math.Max(400, mon.workWidth - 120));
                int tmpH = Math.Min(680, Math.Max(320, mon.workHeight - 120));
                int tmpX = mon.workLeft + Math.Max(0, (mon.workWidth - tmpW) / 2);
                int tmpY = mon.workTop + Math.Max(0, (mon.workHeight - tmpH) / 2);
                SetWindowPos(hWnd, IntPtr.Zero, tmpX, tmpY, tmpW, tmpH, SWP_NOZORDER | SWP_NOACTIVATE);
                System.Threading.Thread.Sleep(50);
            }
            return ShowWindow(hWnd, SW_MAXIMIZE);
        }

        int x = mon.workLeft;
        int y = mon.workTop;
        int w = mon.workWidth;
        int h = mon.workHeight;

        if (mode == "snap_left") {
            w = mon.workWidth / 2;
        } else if (mode == "snap_right") {
            w = mon.workWidth / 2;
            x = mon.workLeft + (mon.workWidth - w);
        } else if (mode == "snap_top") {
            h = mon.workHeight / 2;
        } else if (mode == "snap_bottom") {
            h = mon.workHeight / 2;
            y = mon.workTop + (mon.workHeight - h);
        } else if (mode == "move_monitor_1" || mode == "move_monitor_2" || mode == "move_smaller_monitor" || mode == "move_larger_monitor") {
            RECT cur;
            if (GetWindowRect(hWnd, out cur)) {
                int cw = cur.Right - cur.Left;
                int ch = cur.Bottom - cur.Top;
                if (cw > 200 && ch > 150) {
                    w = Math.Min(cw, mon.workWidth);
                    h = Math.Min(ch, mon.workHeight);
                    x = mon.workLeft + Math.Max(0, (mon.workWidth - w) / 2);
                    y = mon.workTop + Math.Max(0, (mon.workHeight - h) / 2);
                }
            }
        }

        bool ok = SetWindowPos(hWnd, IntPtr.Zero, x, y, w, h, SWP_NOZORDER | SWP_NOACTIVATE);
        if (ok && crossedMonitor) {
            // Re-apply bounds once after OS Per-Monitor DPI rescale completes
            System.Threading.Thread.Sleep(40);
            SetWindowPos(hWnd, IntPtr.Zero, x, y, w, h, SWP_NOZORDER | SWP_NOACTIVATE);
        }
        return ok;
    }

    public static uint SendVirtualKeyCombo(ushort[] modifiers, bool[] modExtended, ushort keyVk, bool keyExtended) {
        int modCount = modifiers != null ? modifiers.Length : 0;
        var list = new List<INPUT>();

        for (int i = 0; i < modCount; i++) {
            INPUT down = new INPUT();
            down.type = INPUT_KEYBOARD;
            down.U.ki.wVk = modifiers[i];
            down.U.ki.dwFlags = (modExtended != null && modExtended[i]) ? KEYEVENTF_EXTENDEDKEY : 0;
            list.Add(down);
        }

        if (keyVk != 0) {
            INPUT kDown = new INPUT();
            kDown.type = INPUT_KEYBOARD;
            kDown.U.ki.wVk = keyVk;
            kDown.U.ki.dwFlags = keyExtended ? KEYEVENTF_EXTENDEDKEY : 0;
            list.Add(kDown);

            INPUT kUp = new INPUT();
            kUp.type = INPUT_KEYBOARD;
            kUp.U.ki.wVk = keyVk;
            kUp.U.ki.dwFlags = KEYEVENTF_KEYUP | (keyExtended ? KEYEVENTF_EXTENDEDKEY : 0);
            list.Add(kUp);
        }

        for (int i = modCount - 1; i >= 0; i--) {
            INPUT up = new INPUT();
            up.type = INPUT_KEYBOARD;
            up.U.ki.wVk = modifiers[i];
            up.U.ki.dwFlags = KEYEVENTF_KEYUP | ((modExtended != null && modExtended[i]) ? KEYEVENTF_EXTENDEDKEY : 0);
            list.Add(up);
        }

        if (list.Count == 0) return 0;
        INPUT[] arr = list.ToArray();
        return SendInput((uint)arr.Length, arr, Marshal.SizeOf(typeof(INPUT)));
    }
}

public static class UiaFastDesktop {
    public class UiaMatch {
        public string runtime_id;
        public string name;
        public string role;
        public string automation_id;
        public string value_text;
        public bool has_range;
        public double range_min;
        public double range_max;
        public double range_value;
        public int x;
        public int y;
        public int width;
        public int height;
        public int center_x;
        public int center_y;
        public bool is_offscreen;
        public bool is_selected;
        public string toggle_state;
    }

    private static string ControlTypeToRole(ControlType ct) {
        if (ct == null) return "unknown";
        if (ct == ControlType.Button) return "button";
        if (ct == ControlType.Edit) return "edit";
        if (ct == ControlType.CheckBox) return "checkbox";
        if (ct == ControlType.RadioButton) return "radiobutton";
        if (ct == ControlType.ComboBox) return "combobox";
        if (ct == ControlType.ListItem) return "listitem";
        if (ct == ControlType.MenuItem) return "menuitem";
        if (ct == ControlType.TabItem) return "tabitem";
        if (ct == ControlType.Tab) return "tab";
        if (ct == ControlType.Hyperlink) return "link";
        if (ct == ControlType.Document) return "document";
        if (ct == ControlType.Slider) return "slider";
        if (ct == ControlType.Text) return "text";
        if (ct == ControlType.Header) return "heading";
        if (ct == ControlType.Custom) return "custom";
        return ct.ProgrammaticName.Replace("ControlType.", "").ToLowerInvariant();
    }

    private static bool IsInteractiveFormControl(ControlType ct) {
        return (ct == ControlType.Button || ct == ControlType.Edit || ct == ControlType.CheckBox ||
                ct == ControlType.RadioButton || ct == ControlType.ComboBox || ct == ControlType.Slider);
    }

    private static bool RoleMatches(ControlType ct, string roleFilter) {
        if (string.IsNullOrWhiteSpace(roleFilter)) return true;
        string r = roleFilter.Trim().ToLowerInvariant();
        string actual = ControlTypeToRole(ct);
        if (r == "switch") return (ct == ControlType.Button || ct == ControlType.CheckBox);
        if (r == "textbox" || r == "input" || r == "textarea") return (ct == ControlType.Edit || ct == ControlType.Document || ct == ControlType.ComboBox);
        if (r == "link" || r == "hyperlink" || r == "video" || r == "video_link" || r == "card") return (ct == ControlType.Hyperlink);
        if (r == "radio" || r == "radiobutton") return (ct == ControlType.RadioButton);
        if (r == "checkbox" || r == "check") return (ct == ControlType.CheckBox);
        if (r == "tab") return (ct == ControlType.TabItem);
        if (r == "tabbar" || r == "tablist") return (ct == ControlType.Tab);
        return actual == r;
    }

    public static string ReadToggleState(AutomationElement el) {
        try {
            object pat;
            if (el.TryGetCurrentPattern(TogglePattern.Pattern, out pat)) {
                TogglePattern tp = (TogglePattern)pat;
                return tp.Current.ToggleState.ToString();
            }
        } catch {}
        return "";
    }

    private static bool TryReadRange(AutomationElement el, out double minVal, out double maxVal, out double curVal) {
        minVal = 0; maxVal = 0; curVal = 0;
        try {
            object pat;
            if (el.TryGetCurrentPattern(RangeValuePattern.Pattern, out pat)) {
                RangeValuePattern rv = (RangeValuePattern)pat;
                minVal = rv.Current.Minimum;
                maxVal = rv.Current.Maximum;
                curVal = rv.Current.Value;
                return true;
            }
        } catch {}
        return false;
    }

    private static string TryReadNearestLabel(AutomationElement el, TreeWalker walker) {
        try {
            AutomationElement ch = walker.GetFirstChild(el);
            int lim = 0;
            while (ch != null && lim < 6) {
                lim++;
                string cn = (ch.Current.Name ?? "").Trim();
                if (cn.Length > 0) return cn;
                ch = walker.GetNextSibling(ch);
            }
            AutomationElement next = walker.GetNextSibling(el);
            if (next != null) {
                ControlType nct = next.Current.ControlType;
                if (nct == ControlType.Text || nct == ControlType.Group || nct == ControlType.Custom) {
                    string nn = (next.Current.Name ?? "").Trim();
                    if (nn.Length > 0 && nn.Length <= 220) return nn;
                    AutomationElement nch = walker.GetFirstChild(next);
                    if (nch != null) {
                        string nchn = (nch.Current.Name ?? "").Trim();
                        if (nchn.Length > 0 && nchn.Length <= 220) return nchn;
                    }
                }
            }
        } catch {}
        return "";
    }

    private static UiaMatch BuildMatch(AutomationElement el, TreeWalker walker) {
        AutomationElement.AutomationElementInformation info = el.Current;
        System.Windows.Rect r = info.BoundingRectangle;
        if (r.IsEmpty || r.Width <= 1 || r.Height <= 1 || double.IsInfinity(r.Left) || double.IsInfinity(r.Top)) {
            return null;
        }
        int x = (int)Math.Round(r.Left);
        int y = (int)Math.Round(r.Top);
        int w = (int)Math.Round(r.Width);
        int h = (int)Math.Round(r.Height);
        ControlType ct = info.ControlType;
        string elName = (info.Name ?? "").Trim();
        if (elName.Length == 0 && (ct == ControlType.RadioButton || ct == ControlType.CheckBox || ct == ControlType.Edit)) {
            elName = TryReadNearestLabel(el, walker);
        }
        double rMin = 0, rMax = 0, rVal = 0;
        bool hasRange = (ct == ControlType.Slider) ? TryReadRange(el, out rMin, out rMax, out rVal) : false;
        string valText = (ct == ControlType.Slider || ct == ControlType.Edit || ct == ControlType.ComboBox) ? TryReadValue(el) : "";
        bool isSel = (ct == ControlType.RadioButton || ct == ControlType.TabItem || ct == ControlType.ListItem) ? ReadIsSelected(el) : false;
        string togState = (ct == ControlType.Button || ct == ControlType.CheckBox || ct == ControlType.RadioButton) ? ReadToggleState(el) : "";
        return new UiaMatch {
            runtime_id = GetRuntimeIdKey(el),
            name = elName,
            role = ControlTypeToRole(ct),
            automation_id = info.AutomationId ?? "",
            value_text = valText,
            has_range = hasRange,
            range_min = rMin,
            range_max = rMax,
            range_value = rVal,
            x = x,
            y = y,
            width = w,
            height = h,
            center_x = x + (w / 2),
            center_y = y + (h / 2),
            is_offscreen = info.IsOffscreen,
            is_selected = isSel,
            toggle_state = togState
        };
    }

    private static AutomationElement FindFirstDocument(AutomationElement root, TreeWalker walker, int maxNodes, int timeoutMs) {
        var sw = Stopwatch.StartNew();
        var queue = new Queue<AutomationElement>();
        queue.Enqueue(root);
        int visited = 0;
        AutomationElement bestDoc = null;
        double bestArea = 0;
        while (queue.Count > 0) {
            if (visited >= maxNodes || sw.ElapsedMilliseconds >= timeoutMs) break;
            AutomationElement cur = queue.Dequeue();
            visited++;
            try {
                AutomationElement.AutomationElementInformation info = cur.Current;
                if (cur != root && info.ControlType == ControlType.Document && !info.IsOffscreen) {
                    System.Windows.Rect r = info.BoundingRectangle;
                    if (!r.IsEmpty && r.Width > 260 && r.Height > 220) {
                        double area = r.Width * r.Height;
                        if (area > bestArea) {
                            bestArea = area;
                            bestDoc = cur;
                        }
                        if (r.Width > 700 && r.Height > 450) {
                            return cur;
                        }
                    }
                }
                AutomationElement child = walker.GetFirstChild(cur);
                while (child != null) {
                    queue.Enqueue(child);
                    child = walker.GetNextSibling(child);
                }
            } catch {}
        }
        return bestDoc;
    }

    private static AutomationElement FindRawElementByRuntimeId(IntPtr hWnd, string runtimeIdKey, int maxNodes, int timeoutMs) {
        if (hWnd == IntPtr.Zero || string.IsNullOrWhiteSpace(runtimeIdKey)) return null;
        AutomationElement root = AutomationElement.FromHandle(hWnd);
        if (root == null) return null;
        string targetRid = runtimeIdKey.Trim();
        TreeWalker walker = TreeWalker.ControlViewWalker;
        AutomationElement startRoot = FindFirstDocument(root, walker, 800, 450) ?? root;

        for (int pass = 0; pass < 2; pass++) {
            AutomationElement sNode = (pass == 0) ? startRoot : root;
            if (pass == 1 && sNode == startRoot) break;
            var sw = Stopwatch.StartNew();
            var queue = new Queue<AutomationElement>();
            queue.Enqueue(sNode);
            int visited = 0;
            while (queue.Count > 0 && visited < maxNodes && sw.ElapsedMilliseconds < timeoutMs) {
                AutomationElement cur = queue.Dequeue();
                visited++;
                try {
                    if (GetRuntimeIdKey(cur) == targetRid) {
                        return cur;
                    }
                    AutomationElement child = walker.GetFirstChild(cur);
                    while (child != null) {
                        queue.Enqueue(child);
                        child = walker.GetNextSibling(child);
                    }
                } catch {}
            }
        }
        return null;
    }

    public static UiaMatch ScrollElementIntoViewAndRead(IntPtr hWnd, string runtimeIdKey) {
        AutomationElement el = FindRawElementByRuntimeId(hWnd, runtimeIdKey, 15000, 2200);
        if (el == null) return null;
        try {
            if (el.Current.IsOffscreen) {
                object pat;
                if (el.TryGetCurrentPattern(ScrollItemPattern.Pattern, out pat)) {
                    ((ScrollItemPattern)pat).ScrollIntoView();
                    System.Threading.Thread.Sleep(130);
                }
            }
        } catch {}
        return BuildMatch(el, TreeWalker.ControlViewWalker);
    }

    public static UiaMatch ReadMatchByRuntimeId(IntPtr hWnd, string runtimeIdKey) {
        AutomationElement el = FindRawElementByRuntimeId(hWnd, runtimeIdKey, 15000, 1800);
        if (el == null) return null;
        return BuildMatch(el, TreeWalker.ControlViewWalker);
    }

    public static List<UiaMatch> FindElements(IntPtr hWnd, string nameQuery, bool exact, string roleFilter, bool contentOnly, string excludeName, string runtimeIdFilter, int maxMatches, int maxNodes, int timeoutMs) {
        return FindElements(hWnd, nameQuery, exact, roleFilter, contentOnly, excludeName, runtimeIdFilter, maxMatches, maxNodes, timeoutMs, "dom");
    }

    public static List<UiaMatch> FindElements(IntPtr hWnd, string nameQuery, bool exact, string roleFilter, bool contentOnly, string excludeName, string runtimeIdFilter, int maxMatches, int maxNodes, int timeoutMs, string sortBy) {
        var results = new List<UiaMatch>();
        if (hWnd == IntPtr.Zero) return results;
        AutomationElement root = AutomationElement.FromHandle(hWnd);
        if (root == null) return results;

        if (!string.IsNullOrWhiteSpace(runtimeIdFilter)) {
            AutomationElement exactEl = FindRawElementByRuntimeId(hWnd, runtimeIdFilter, maxNodes, timeoutMs);
            if (exactEl != null) {
                UiaMatch m = BuildMatch(exactEl, TreeWalker.ControlViewWalker);
                if (m != null) results.Add(m);
            }
            return results;
        }

        string normRole = (roleFilter ?? "").Trim().ToLowerInvariant();
        bool isVideoRole = (normRole == "video" || normRole == "video_link" || normRole == "card");
        if (isVideoRole) {
            contentOnly = true;
        }
        bool spatialSort = isVideoRole || string.Equals(sortBy, "position", StringComparison.OrdinalIgnoreCase);
        int collectCap = spatialSort ? Math.Max(maxMatches * 4, 80) : maxMatches;

        string needle = string.IsNullOrEmpty(nameQuery) ? "" : nameQuery.Trim().ToLowerInvariant();
        bool hasName = needle.Length > 0;
        string exclNeedle = string.IsNullOrEmpty(excludeName) ? "" : excludeName.Trim().ToLowerInvariant();
        bool hasExcl = exclNeedle.Length > 0;

        TreeWalker walker = TreeWalker.ControlViewWalker;
        AutomationElement startRoot = root;
        if (contentOnly) {
            AutomationElement doc = FindFirstDocument(root, walker, 800, 600);
            if (doc != null) startRoot = doc;
        }

        double docLeft = 0, docTop = 0, docWidth = 0;
        try {
            System.Windows.Rect sr = startRoot.Current.BoundingRectangle;
            if (!sr.IsEmpty) {
                docLeft = sr.Left;
                docTop = sr.Top;
                docWidth = sr.Width;
            }
        } catch {}

        var sw = Stopwatch.StartNew();
        var queue = new Queue<AutomationElement>();
        queue.Enqueue(startRoot);
        int visited = 0;

        while (queue.Count > 0) {
            if (visited >= maxNodes || sw.ElapsedMilliseconds >= timeoutMs) break;
            AutomationElement cur = queue.Dequeue();
            visited++;

            try {
                AutomationElement.AutomationElementInformation info = cur.Current;
                string elName = info.Name ?? "";
                string autoId = info.AutomationId ?? "";
                ControlType ct = info.ControlType;
                bool isFormCtrl = IsInteractiveFormControl(ct);

                // Prune embedded sub-documents (Live Chat / ad iframes), offscreen subtrees, and YouTube navigation/sidebar containers
                if (cur != startRoot && contentOnly) {
                    if (ct == ControlType.Document && (spatialSort || !hasName)) continue;
                    if (!isFormCtrl && info.IsOffscreen && (spatialSort || isVideoRole)) continue;
                    if (isVideoRole && (ct == ControlType.Pane || ct == ControlType.Group || ct == ControlType.Custom || ct == ControlType.List || ct == ControlType.ToolBar)) {
                        string lowId = autoId.ToLowerInvariant();
                        string lowNm = elName.Trim().ToLowerInvariant();
                        if (lowId.Contains("guide") || lowId.Contains("masthead") || lowId.Contains("chips") || lowId.Contains("footer") ||
                            lowNm == "guide" || lowNm == "hướng dẫn" || lowNm == "điều hướng" || lowNm == "navigation" || lowNm == "kênh đăng ký" || lowNm == "subscriptions") {
                            continue;
                        }
                    }
                }

                string effName = elName;
                if (string.IsNullOrWhiteSpace(effName) && (ct == ControlType.RadioButton || ct == ControlType.CheckBox || ct == ControlType.Edit)) {
                    effName = TryReadNearestLabel(cur, walker);
                }

                bool skipChrome = (cur == startRoot) || (contentOnly && (autoId.StartsWith("view_") || (!isFormCtrl && info.IsOffscreen) || (!hasName && !isFormCtrl && effName.Trim().Length < 3)));
                bool skipContainer = hasName && string.IsNullOrEmpty(roleFilter) && (ct == ControlType.Document || ct == ControlType.Window || ct == ControlType.Pane);
                bool excluded = hasExcl && effName.ToLowerInvariant().Contains(exclNeedle);

                bool nameOk = !hasName;
                if (hasName) {
                    string lowerName = effName.ToLowerInvariant();
                    nameOk = exact ? (lowerName == needle) : lowerName.Contains(needle);
                }

                if (!skipChrome && !skipContainer && !excluded && nameOk && RoleMatches(ct, roleFilter)) {
                    UiaMatch m = BuildMatch(cur, walker);
                    if (m != null) {
                        bool rejectVideoNoise = false;
                        if (isVideoRole) {
                            string lowV = m.name.ToLowerInvariant();
                            bool inTopBar = (docWidth > 0) && (m.y < (int)Math.Round(docTop) + 125);
                            bool inLeftSidebar = (docWidth >= 980) && (m.x < (int)Math.Round(docLeft) + 245) && (m.width <= 238);
                            bool isUiOrAd = lowV == "trang chủ youtube" || lowV == "youtube home" || lowV == "tìm hiểu thêm" || lowV == "learn more" ||
                                            lowV == "truy cập trang web" || lowV == "visit site" || lowV == "bỏ qua" || lowV == "đăng ký" ||
                                            lowV.StartsWith("#") || lowV.StartsWith("@") || lowV.StartsWith("chính sách") || lowV.StartsWith("điều khoản");
                            if (m.width < 145 || m.height < 20 || m.name.Length < 10 || inTopBar || inLeftSidebar || isUiOrAd) {
                                rejectVideoNoise = true;
                            }
                        }
                        if (contentOnly && !hasName && !isFormCtrl && (m.width < 40 || m.height < 12)) {
                            // Skip tiny unnamed decorative elements, while keeping all radios/checkboxes/edits/sliders
                        } else if (rejectVideoNoise) {
                            // Skip sidebar subscription items, top bar, hashtags, channel handles, and ads
                        } else if (spatialSort && m.is_offscreen) {
                            // Spatial visual ordering only keeps currently visible on-screen items
                        } else {
                            bool isDup = false;
                            if (spatialSort && !string.IsNullOrWhiteSpace(m.name)) {
                                for (int di = 0; di < results.Count; di++) {
                                    UiaMatch prev = results[di];
                                    if (!string.IsNullOrWhiteSpace(prev.name) &&
                                        string.Equals(prev.name.Trim(), m.name.Trim(), StringComparison.OrdinalIgnoreCase) &&
                                        Math.Abs(prev.x - m.x) < 220 && Math.Abs(prev.y - m.y) < 220) {
                                        isDup = true;
                                        break;
                                    }
                                }
                            }
                            if (!isDup) {
                                results.Add(m);
                                if (results.Count >= collectCap) break;
                            }
                        }
                    }
                }

                AutomationElement child = walker.GetFirstChild(cur);
                while (child != null) {
                    queue.Enqueue(child);
                    child = walker.GetNextSibling(child);
                }
            } catch {
                // Skip transient/stale UIA nodes safely
            }
        }

        if (spatialSort && results.Count > 1) {
            results.Sort(delegate(UiaMatch a, UiaMatch b) {
                int cy = a.y.CompareTo(b.y);
                return cy != 0 ? cy : a.x.CompareTo(b.x);
            });
            var ordered = new List<UiaMatch>(results.Count);
            var row = new List<UiaMatch>();
            int rowAnchorY = results[0].y;
            for (int i = 0; i < results.Count; i++) {
                UiaMatch item = results[i];
                if (Math.Abs(item.y - rowAnchorY) <= 85) {
                    row.Add(item);
                } else {
                    row.Sort(delegate(UiaMatch a, UiaMatch b) { return a.x.CompareTo(b.x); });
                    ordered.AddRange(row);
                    row.Clear();
                    row.Add(item);
                    rowAnchorY = item.y;
                }
            }
            if (row.Count > 0) {
                row.Sort(delegate(UiaMatch a, UiaMatch b) { return a.x.CompareTo(b.x); });
                ordered.AddRange(row);
            }
            if (ordered.Count > maxMatches) {
                ordered.RemoveRange(maxMatches, ordered.Count - maxMatches);
            }
            return ordered;
        }
        return results;
    }

    public class UiaReadResult {
        public bool scope_found;
        public string scope_name;
        public int line_count;
        public int total_chars;
        public string text;
        public List<string> lines;
    }

    private static string TryReadValue(AutomationElement el) {
        try {
            object pat;
            if (el.TryGetCurrentPattern(ValuePattern.Pattern, out pat)) {
                ValuePattern vp = (ValuePattern)pat;
                return vp.Current.Value ?? "";
            }
        } catch {}
        return "";
    }

    private static bool IsTooLargeContainer(AutomationElement el, double rootW, double rootH) {
        try {
            AutomationElement.AutomationElementInformation info = el.Current;
            ControlType ct = info.ControlType;
            if (ct == ControlType.Document || ct == ControlType.Window) return true;
            System.Windows.Rect r = info.BoundingRectangle;
            if (!r.IsEmpty && rootW > 200 && rootH > 200) {
                if (r.Width >= rootW * 0.78 && r.Height >= rootH * 0.78) return true;
            }
        } catch {}
        return false;
    }

    private static bool HasRichSubtree(AutomationElement node, TreeWalker walker) {
        try {
            int count = 0;
            var q = new Queue<AutomationElement>();
            q.Enqueue(node);
            while (q.Count > 0 && count < 20) {
                AutomationElement c = q.Dequeue();
                AutomationElement ch = walker.GetFirstChild(c);
                while (ch != null) {
                    count++;
                    if (count >= 4) return true;
                    q.Enqueue(ch);
                    ch = walker.GetNextSibling(ch);
                }
            }
        } catch {}
        return false;
    }

    private static AutomationElement FindScopeContainer(AutomationElement root, TreeWalker walker, string scopeName, double rootW, double rootH, int maxNodes, int timeoutMs) {
        string needle = scopeName.Trim().ToLowerInvariant();
        var sw = Stopwatch.StartNew();
        var queue = new Queue<AutomationElement>();
        queue.Enqueue(root);
        int visited = 0;

        while (queue.Count > 0) {
            if (visited >= maxNodes || sw.ElapsedMilliseconds >= timeoutMs) break;
            AutomationElement cur = queue.Dequeue();
            visited++;
            try {
                if (cur != root) {
                    AutomationElement.AutomationElementInformation info = cur.Current;
                    string elName = info.Name ?? "";
                    if (!info.IsOffscreen && elName.ToLowerInvariant().Contains(needle)) {
                        if (!IsTooLargeContainer(cur, rootW, rootH) && HasRichSubtree(cur, walker)) {
                            return cur;
                        }
                        AutomationElement p1 = walker.GetParent(cur);
                        if (p1 != null && p1 != root && !IsTooLargeContainer(p1, rootW, rootH)) {
                            if (HasRichSubtree(p1, walker)) return p1;
                            AutomationElement p2 = walker.GetParent(p1);
                            if (p2 != null && p2 != root && !IsTooLargeContainer(p2, rootW, rootH) && HasRichSubtree(p2, walker)) {
                                return p2;
                            }
                        }
                    }
                }
                AutomationElement child = walker.GetFirstChild(cur);
                while (child != null) {
                    queue.Enqueue(child);
                    child = walker.GetNextSibling(child);
                }
            } catch {}
        }
        return null;
    }

    public static UiaReadResult ReadTextLines(IntPtr hWnd, string scopeName, bool includeButtons, int maxItems, int maxChars, int maxNodes, int timeoutMs) {
        return ReadTextLines(hWnd, scopeName, includeButtons, maxItems, maxChars, maxNodes, timeoutMs, false, false);
    }

    public static UiaReadResult ReadTextLines(IntPtr hWnd, string scopeName, bool includeButtons, int maxItems, int maxChars, int maxNodes, int timeoutMs, bool contentOnly, bool includeControls) {
        var res = new UiaReadResult {
            scope_found = false,
            scope_name = scopeName ?? "",
            line_count = 0,
            total_chars = 0,
            text = "",
            lines = new List<string>()
        };
        if (hWnd == IntPtr.Zero) return res;
        AutomationElement root = AutomationElement.FromHandle(hWnd);
        if (root == null) return res;

        double rootW = 0;
        double rootH = 0;
        try {
            System.Windows.Rect rr = root.Current.BoundingRectangle;
            if (!rr.IsEmpty) {
                rootW = rr.Width;
                rootH = rr.Height;
            }
        } catch {}

        TreeWalker walker = TreeWalker.ControlViewWalker;
        AutomationElement startNode = root;
        if (contentOnly && string.IsNullOrWhiteSpace(scopeName)) {
            AutomationElement doc = FindFirstDocument(root, walker, 800, 600);
            if (doc != null) startNode = doc;
        }
        string anchorNeedle = "";
        bool collecting = true;

        if (!string.IsNullOrWhiteSpace(scopeName)) {
            AutomationElement scoped = FindScopeContainer(root, walker, scopeName, rootW, rootH, 5000, 1500);
            if (scoped != null) {
                startNode = scoped;
                res.scope_found = true;
                try {
                    string actualScope = scoped.Current.Name;
                    if (!string.IsNullOrWhiteSpace(actualScope)) res.scope_name = actualScope;
                } catch {}
            } else {
                anchorNeedle = scopeName.Trim().ToLowerInvariant();
                collecting = false;
            }
        } else {
            res.scope_found = true;
        }

        var sw = Stopwatch.StartNew();
        var stack = new Stack<AutomationElement>();
        stack.Push(startNode);
        int visited = 0;
        string lastAdded = "";

        while (stack.Count > 0) {
            if (visited >= maxNodes || sw.ElapsedMilliseconds >= timeoutMs) break;
            if (res.lines.Count >= maxItems || res.total_chars >= maxChars) break;

            AutomationElement cur = stack.Pop();
            visited++;

            try {
                AutomationElement.AutomationElementInformation info = cur.Current;
                ControlType ct = info.ControlType;
                string rawName = (info.Name ?? "").Trim();
                string autoId = info.AutomationId ?? "";

                if (contentOnly && autoId.StartsWith("view_")) {
                    continue;
                }

                if (!collecting && anchorNeedle.Length > 0) {
                    if (!info.IsOffscreen && rawName.ToLowerInvariant().Contains(anchorNeedle)) {
                        collecting = true;
                        res.scope_found = true;
                    }
                }

                if (collecting) {
                    string lineOut = null;

                    if (includeControls && ct == ControlType.RadioButton) {
                        string lbl = rawName.Length > 0 ? rawName : TryReadNearestLabel(cur, walker);
                        string rid = GetRuntimeIdKey(cur);
                        bool sel = ReadIsSelected(cur) || ReadToggleState(cur).Equals("On", StringComparison.OrdinalIgnoreCase);
                        lineOut = string.Format("[RADIO id={0} selected={1}] {2}", rid, sel ? "true" : "false", lbl);
                    } else if (includeControls && ct == ControlType.CheckBox) {
                        string lbl = rawName.Length > 0 ? rawName : TryReadNearestLabel(cur, walker);
                        string rid = GetRuntimeIdKey(cur);
                        string tst = ReadToggleState(cur);
                        lineOut = string.Format("[CHECKBOX id={0} state={1}] {2}", rid, string.IsNullOrEmpty(tst) ? "Off" : tst, lbl);
                    } else if (includeControls && ct == ControlType.ListItem && ReadIsSelected(cur)) {
                        string rid = GetRuntimeIdKey(cur);
                        string lbl = rawName.Length > 0 ? rawName : TryReadNearestLabel(cur, walker);
                        if (lbl.Length > 0) lineOut = string.Format("[OPTION id={0} selected=true] {1}", rid, lbl);
                    } else if (includeControls && ct == ControlType.Custom && !string.IsNullOrEmpty(ReadToggleState(cur))) {
                        string rid = GetRuntimeIdKey(cur);
                        string lbl = rawName.Length > 0 ? rawName : TryReadNearestLabel(cur, walker);
                        lineOut = string.Format("[TOGGLE id={0} state={1}] {2}", rid, ReadToggleState(cur), lbl);
                    } else if (ct == ControlType.Edit || (includeControls && ct == ControlType.ComboBox)) {
                        string val = TryReadValue(cur).Trim();
                        string lbl = rawName.Length > 0 ? rawName : TryReadNearestLabel(cur, walker);
                        bool isUrlAddr = (val.StartsWith("http://") || val.StartsWith("https://")) && !includeControls;
                        if (includeControls) {
                            string rid = GetRuntimeIdKey(cur);
                            string tag = (ct == ControlType.ComboBox) ? "COMBOBOX" : "EDIT";
                            string clipVal = val.Length > 160 ? val.Substring(0, 160) + "..." : val;
                            lineOut = string.Format("[{0} id={1} label=\"{2}\" val=\"{3}\"]", tag, rid, lbl.Replace("\"", "'"), clipVal.Replace("\"", "'"));
                        } else if (val.Length > 0 && !isUrlAddr) {
                            lineOut = val;
                        }
                    } else if (includeControls && ct == ControlType.Slider) {
                        string rid = GetRuntimeIdKey(cur);
                        string valTxt = TryReadValue(cur).Trim();
                        double rMin, rMax, rVal;
                        bool hasR = TryReadRange(cur, out rMin, out rMax, out rVal);
                        lineOut = hasR
                            ? string.Format("[SLIDER id={0} label=\"{1}\" val={2} range={3}..{4} text=\"{5}\"]", rid, rawName.Replace("\"", "'"), rVal, rMin, rMax, valTxt.Replace("\"", "'"))
                            : string.Format("[SLIDER id={0} label=\"{1}\" text=\"{2}\"]", rid, rawName.Replace("\"", "'"), valTxt.Replace("\"", "'"));
                    } else if ((includeControls || includeButtons) && ct == ControlType.Button) {
                        if (rawName.Length > 0) {
                            if (includeControls) {
                                string rid = GetRuntimeIdKey(cur);
                                string tst = ReadToggleState(cur);
                                string stPart = string.IsNullOrEmpty(tst) ? "" : (" state=" + tst);
                                lineOut = string.Format("[BUTTON id={0}{1}] {2}", rid, stPart, rawName);
                            } else {
                                lineOut = rawName;
                            }
                        }
                    } else {
                        bool isTextControl = (ct == ControlType.Text || ct == ControlType.Hyperlink || ct == ControlType.ListItem || ct == ControlType.Header || ct == ControlType.HeaderItem);
                        if (isTextControl && rawName.Length > 0) {
                            lineOut = rawName;
                        }
                    }

                    if (!string.IsNullOrEmpty(lineOut) && lineOut != lastAdded) {
                        if (res.total_chars + lineOut.Length <= maxChars || res.lines.Count == 0) {
                            res.lines.Add(lineOut);
                            res.total_chars += lineOut.Length + 1;
                            lastAdded = lineOut;
                        }
                    }
                }

                var children = new List<AutomationElement>();
                AutomationElement child = walker.GetFirstChild(cur);
                while (child != null) {
                    children.Add(child);
                    child = walker.GetNextSibling(child);
                }
                for (int ci = children.Count - 1; ci >= 0; ci--) {
                    stack.Push(children[ci]);
                }
            } catch {}
        }

        res.line_count = res.lines.Count;
        res.text = string.Join("\n", res.lines.ToArray());
        res.total_chars = res.text.Length;
        return res;
    }

    public class EdgeTabInfo {
        public string runtime_id;
        public string name;
        public bool is_selected;
        public int x;
        public int y;
        public int width;
        public int height;
        public int center_x;
        public int center_y;
    }

    private static string GetRuntimeIdKey(AutomationElement el) {
        try {
            int[] rid = el.GetRuntimeId();
            if (rid != null && rid.Length > 0) {
                var sb = new StringBuilder();
                for (int i = 0; i < rid.Length; i++) {
                    if (i > 0) sb.Append("-");
                    sb.Append(rid[i]);
                }
                return sb.ToString();
            }
        } catch {}
        return "";
    }

    private static bool ReadIsSelected(AutomationElement el) {
        try {
            object pat;
            if (el.TryGetCurrentPattern(SelectionItemPattern.Pattern, out pat)) {
                return ((SelectionItemPattern)pat).Current.IsSelected;
            }
        } catch {}
        return false;
    }

    private static AutomationElement GetRootElementSafe(IntPtr hWnd) {
        if (hWnd == IntPtr.Zero || !Win32FastDesktop.IsWindow(hWnd)) return null;
        for (int attempt = 0; attempt < 3; attempt++) {
            try {
                AutomationElement el = AutomationElement.FromHandle(hWnd);
                if (el != null) return el;
            } catch {}
            try {
                int hwnd32 = unchecked((int)hWnd.ToInt64());
                AutomationElement byProp = AutomationElement.RootElement.FindFirst(
                    TreeScope.Children,
                    new PropertyCondition(AutomationElement.NativeWindowHandleProperty, hwnd32)
                );
                if (byProp != null) return byProp;
            } catch {}
            if (attempt < 2) {
                System.Threading.Thread.Sleep(90);
            }
        }
        return null;
    }

    public static List<EdgeTabInfo> ListEdgeTabs(IntPtr hWnd) {
        var list = new List<EdgeTabInfo>();
        if (hWnd == IntPtr.Zero) return list;
        AutomationElement root = GetRootElementSafe(hWnd);
        if (root == null) return list;

        TreeWalker walker = TreeWalker.ControlViewWalker;
        var queue = new Queue<AutomationElement>();
        queue.Enqueue(root);
        var sw = Stopwatch.StartNew();
        int visited = 0;

        while (queue.Count > 0 && visited < 1800 && sw.ElapsedMilliseconds < 1500) {
            AutomationElement cur = queue.Dequeue();
            visited++;
            try {
                AutomationElement.AutomationElementInformation info = cur.Current;
                if (cur != root && info.ControlType == ControlType.Document) {
                    continue; // Never descend into web page DOM while reading browser tab strip
                }
                if (info.ControlType == ControlType.TabItem && !info.IsOffscreen) {
                    System.Windows.Rect r = info.BoundingRectangle;
                    if (!r.IsEmpty && r.Width >= 16 && r.Height >= 12 && !double.IsInfinity(r.Left) && !double.IsInfinity(r.Top)) {
                        int x = (int)Math.Round(r.Left);
                        int y = (int)Math.Round(r.Top);
                        int w = (int)Math.Round(r.Width);
                        int h = (int)Math.Round(r.Height);
                        string title = (info.Name ?? "").Trim();
                        // Skip Edge "New tab" / "+" add button if it lacks TabItem SelectionItemPattern
                        object selPat;
                        bool hasSel = cur.TryGetCurrentPattern(SelectionItemPattern.Pattern, out selPat);
                        if (hasSel && !string.IsNullOrEmpty(title)) {
                            list.Add(new EdgeTabInfo {
                                runtime_id = GetRuntimeIdKey(cur),
                                name = title,
                                is_selected = ((SelectionItemPattern)selPat).Current.IsSelected,
                                x = x,
                                y = y,
                                width = w,
                                height = h,
                                center_x = x + (w / 2),
                                center_y = y + (h / 2)
                            });
                        }
                    }
                    continue;
                }
                AutomationElement child = walker.GetFirstChild(cur);
                while (child != null) {
                    queue.Enqueue(child);
                    child = walker.GetNextSibling(child);
                }
            } catch {}
        }
        return list;
    }

    public static bool SelectEdgeTab(IntPtr hWnd, string runtimeIdKey) {
        if (hWnd == IntPtr.Zero || string.IsNullOrEmpty(runtimeIdKey)) return false;
        AutomationElement root = GetRootElementSafe(hWnd);
        if (root == null) return false;

        TreeWalker walker = TreeWalker.ControlViewWalker;
        var queue = new Queue<AutomationElement>();
        queue.Enqueue(root);
        int visited = 0;
        var sw = Stopwatch.StartNew();

        while (queue.Count > 0 && visited < 3500 && sw.ElapsedMilliseconds < 2200) {
            AutomationElement cur = queue.Dequeue();
            visited++;
            try {
                AutomationElement.AutomationElementInformation info = cur.Current;
                if (
                    cur != root && (
                        info.ControlType == ControlType.Document
                        || info.ControlType == ControlType.Edit
                        || info.ControlType == ControlType.Menu
                        || info.ControlType == ControlType.MenuBar
                        || info.ControlType == ControlType.List
                        || info.ControlType == ControlType.Tree
                        || info.ControlType == ControlType.DataGrid
                        || info.ControlType == ControlType.Table
                        || info.ControlType == ControlType.ScrollBar
                    )
                ) continue;
                if (info.ControlType == ControlType.TabItem && GetRuntimeIdKey(cur) == runtimeIdKey) {
                    object pat;
                    if (cur.TryGetCurrentPattern(SelectionItemPattern.Pattern, out pat)) {
                        ((SelectionItemPattern)pat).Select();
                        return true;
                    }
                    return false;
                }
                AutomationElement child = walker.GetFirstChild(cur);
                while (child != null) {
                    queue.Enqueue(child);
                    child = walker.GetNextSibling(child);
                }
            } catch {}
        }
        return false;
    }
}
"@

[Win32FastDesktop]::EnablePerMonitorDpi()

function Get-FilteredWindows {
    param([string]$Filter)
    $wins = [Win32FastDesktop]::ListWindows()
    if (-not [string]::IsNullOrWhiteSpace($Filter)) {
        $f = $Filter.ToLowerInvariant()
        $wins = @($wins | Where-Object {
            $_.title.ToLowerInvariant().Contains($f) -or $_.process.ToLowerInvariant().Contains($f)
        })
    }
    return ,@($wins)
}

function Resolve-TargetWindow {
    param($Req)
    $wins = [Win32FastDesktop]::ListWindows()

    if ($null -ne $Req.hwnd -and -not [string]::IsNullOrWhiteSpace([string]$Req.hwnd)) {
        $targetHwnd = [string]$Req.hwnd
        $hit = $wins | Where-Object { $_.hwnd -eq $targetHwnd } | Select-Object -First 1
        return $hit
    }

    $candidates = $wins
    if ($null -ne $Req.process -and -not [string]::IsNullOrWhiteSpace([string]$Req.process)) {
        $p = ([string]$Req.process).ToLowerInvariant().Replace(".exe", "")
        $candidates = @($candidates | Where-Object { $_.process.ToLowerInvariant().Contains($p) })
    }
    if ($null -ne $Req.title -and -not [string]::IsNullOrWhiteSpace([string]$Req.title)) {
        $t = ([string]$Req.title).ToLowerInvariant()
        $candidates = @($candidates | Where-Object { $_.title.ToLowerInvariant().Contains($t) })
    }

    return ($candidates | Sort-Object @{ Expression = { if ($_.minimized) { 1 } else { 0 } } }, @{ Expression = { -([long]$_.width * [long]$_.height) } } | Select-Object -First 1)
}

function Invoke-ClickAndOptionalType {
    param(
        [IntPtr]$Hwnd,
        [IntPtr]$PrevFg,
        $TargetObj,
        [int]$AbsX,
        [int]$AbsY,
        [string]$Button = "left",
        [int]$Count = 1,
        [bool]$RestoreCursor = $true,
        [string]$Text = "",
        [bool]$PressEnter = $false,
        [bool]$RestoreFocus = $false,
        [bool]$ClearFirst = $false
    )

    $resStr = [Win32FastDesktop]::ClickWindowPoint($Hwnd, $AbsX, $AbsY, $Button, $Count, $RestoreCursor)
    if (-not $resStr.StartsWith("OK:")) {
        return @{ ok = $false; error = $resStr }
    }

    $typedChars = 0
    $sentTextEvents = [uint32]0
    $didEnter = $false
    if (-not [string]::IsNullOrEmpty($Text)) {
        Start-Sleep -Milliseconds 60
        if ([Win32FastDesktop]::GetForegroundWindow() -ne $Hwnd) {
            return @{ ok = $false; error = "Clicked ok, but target window lost foreground before typing" }
        }
        if ($ClearFirst) {
            [Win32FastDesktop]::SendVirtualKeyCombo([uint16[]]@(0x11), [bool[]]@($false), [uint16]0x41, $false) | Out-Null
            Start-Sleep -Milliseconds 35
            [Win32FastDesktop]::SendVirtualKeyCombo([uint16[]]@(), [bool[]]@(), [uint16]0x08, $false) | Out-Null
            Start-Sleep -Milliseconds 30
        }
        $didEnter = $PressEnter
        $sentTextEvents = [Win32FastDesktop]::SendUnicodeText($Hwnd, $Text, $didEnter)
        $typedChars = $Text.Length
    }

    $restoredFocus = $false
    if ($RestoreFocus -and $PrevFg -ne [IntPtr]::Zero -and $PrevFg -ne $Hwnd) {
        Start-Sleep -Milliseconds 30
        $restoredFocus = [Win32FastDesktop]::FocusWindow($PrevFg)
    }

    return @{
        ok = $true
        data = @{
            clicked = @{ x = $AbsX; y = $AbsY; button = $Button; count = $Count; cursor_restored = $RestoreCursor }
            typed_chars = $typedChars
            sent_text_events = $sentTextEvents
            press_enter = $didEnter
            focus_restored = $restoredFocus
            target = $TargetObj
        }
    }
}

$script:ModifierMap = @{
    "ctrl"    = @{ vk = [uint16]0x11; ext = $false }
    "control" = @{ vk = [uint16]0x11; ext = $false }
    "alt"     = @{ vk = [uint16]0x12; ext = $false }
    "menu"    = @{ vk = [uint16]0x12; ext = $false }
    "shift"   = @{ vk = [uint16]0x10; ext = $false }
    "win"     = @{ vk = [uint16]0x5B; ext = $true }
    "lwin"    = @{ vk = [uint16]0x5B; ext = $true }
}

$script:KeyMap = @{
    "media_play_pause" = @{ vk = [uint16]0xB3; ext = $false; global = $true }
    "media_next"       = @{ vk = [uint16]0xB0; ext = $false; global = $true }
    "media_prev"       = @{ vk = [uint16]0xB1; ext = $false; global = $true }
    "media_stop"       = @{ vk = [uint16]0xB2; ext = $false; global = $true }
    "volume_mute"      = @{ vk = [uint16]0xAD; ext = $false; global = $true }
    "volume_down"      = @{ vk = [uint16]0xAE; ext = $false; global = $true }
    "volume_up"        = @{ vk = [uint16]0xAF; ext = $false; global = $true }
    "enter"            = @{ vk = [uint16]0x0D; ext = $false }
    "return"           = @{ vk = [uint16]0x0D; ext = $false }
    "esc"              = @{ vk = [uint16]0x1B; ext = $false }
    "escape"           = @{ vk = [uint16]0x1B; ext = $false }
    "space"            = @{ vk = [uint16]0x20; ext = $false }
    "tab"              = @{ vk = [uint16]0x09; ext = $false }
    "backspace"        = @{ vk = [uint16]0x08; ext = $false }
    "back"             = @{ vk = [uint16]0x08; ext = $false }
    "delete"           = @{ vk = [uint16]0x2E; ext = $true }
    "del"              = @{ vk = [uint16]0x2E; ext = $true }
    "insert"           = @{ vk = [uint16]0x2D; ext = $true }
    "ins"              = @{ vk = [uint16]0x2D; ext = $true }
    "home"             = @{ vk = [uint16]0x24; ext = $true }
    "end"              = @{ vk = [uint16]0x23; ext = $true }
    "pageup"           = @{ vk = [uint16]0x21; ext = $true }
    "pgup"             = @{ vk = [uint16]0x21; ext = $true }
    "pagedown"         = @{ vk = [uint16]0x22; ext = $true }
    "pgdn"             = @{ vk = [uint16]0x22; ext = $true }
    "up"               = @{ vk = [uint16]0x26; ext = $true }
    "down"             = @{ vk = [uint16]0x28; ext = $true }
    "left"             = @{ vk = [uint16]0x25; ext = $true }
    "right"            = @{ vk = [uint16]0x27; ext = $true }
    "plus"             = @{ vk = [uint16]0xBB; ext = $false }
    "="                = @{ vk = [uint16]0xBB; ext = $false }
    "minus"            = @{ vk = [uint16]0xBD; ext = $false }
    "-"                = @{ vk = [uint16]0xBD; ext = $false }
    "["                = @{ vk = [uint16]0xDB; ext = $false }
    "]"                = @{ vk = [uint16]0xDD; ext = $false }
    "/"                = @{ vk = [uint16]0xBF; ext = $false }
    "."                = @{ vk = [uint16]0xBE; ext = $false }
    ","                = @{ vk = [uint16]0xBC; ext = $false }
}
for ($ci = [int][char]'a'; $ci -le [int][char]'z'; $ci++) {
    $ch = [string][char]$ci
    $script:KeyMap[$ch] = @{ vk = [uint16]([int][char]$ch.ToUpperInvariant()); ext = $false }
}
for ($di = 0; $di -le 9; $di++) {
    $script:KeyMap[[string]$di] = @{ vk = [uint16](0x30 + $di); ext = $false }
}
for ($fi = 1; $fi -le 12; $fi++) {
    $script:KeyMap["f$fi"] = @{ vk = [uint16](0x6F + $fi); ext = $false }
}

function Resolve-HotkeySpec {
    param([string]$Combo)
    $parts = @($Combo.ToLowerInvariant().Split('+') | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" })
    if ($parts.Count -eq 0) { throw "Empty key combo" }

    $mods = New-Object System.Collections.Generic.List[uint16]
    $modExt = New-Object System.Collections.Generic.List[bool]
    $mainKey = $null

    for ($i = 0; $i -lt $parts.Count; $i++) {
        $tok = $parts[$i]
        if ($i -lt ($parts.Count - 1) -and $script:ModifierMap.ContainsKey($tok)) {
            $m = $script:ModifierMap[$tok]
            $mods.Add($m.vk)
            $modExt.Add($m.ext)
        } elseif ($i -eq ($parts.Count - 1)) {
            if ($script:KeyMap.ContainsKey($tok)) {
                $mainKey = $script:KeyMap[$tok]
            } elseif ($script:ModifierMap.ContainsKey($tok)) {
                $m = $script:ModifierMap[$tok]
                $mainKey = @{ vk = $m.vk; ext = $m.ext; global = $false }
            } else {
                throw "Unsupported key token: $tok"
            }
        } else {
            throw "Unsupported modifier token: $tok"
        }
    }

    return @{
        mods = [uint16[]]$mods.ToArray()
        modExt = [bool[]]$modExt.ToArray()
        keyVk = [uint16]$mainKey.vk
        keyExt = [bool]$mainKey.ext
        isGlobalMedia = ($mods.Count -eq 0 -and $mainKey.global -eq $true)
    }
}

function Invoke-WindowAction {
    param(
        [IntPtr]$Hwnd,
        $TargetObj,
        [string]$Action,
        [int]$Monitor = 0,
        $Req = $null
    )
    switch ($Action) {
        "focus" {
            if ($Monitor -gt 0) {
                [Win32FastDesktop]::SnapWindow($Hwnd, "move_monitor_$Monitor", $Monitor) | Out-Null
            }
            return [Win32FastDesktop]::FocusWindow($Hwnd)
        }
        "minimize" {
            return [Win32FastDesktop]::ShowWindow($Hwnd, [Win32FastDesktop]::SW_MINIMIZE)
        }
        "maximize" {
            $okMax = [Win32FastDesktop]::SnapWindow($Hwnd, "maximize", $Monitor)
            [Win32FastDesktop]::FocusWindow($Hwnd) | Out-Null
            return $okMax
        }
        "restore" {
            return [Win32FastDesktop]::ShowWindow($Hwnd, [Win32FastDesktop]::SW_RESTORE)
        }
        "close" {
            return [Win32FastDesktop]::PostMessage($Hwnd, [Win32FastDesktop]::WM_CLOSE, [IntPtr]::Zero, [IntPtr]::Zero)
        }
        "move" {
            if ([Win32FastDesktop]::IsIconic($Hwnd) -or [Win32FastDesktop]::IsZoomed($Hwnd)) {
                [Win32FastDesktop]::ShowWindow($Hwnd, [Win32FastDesktop]::SW_RESTORE) | Out-Null
            }
            $x = if ($null -ne $Req -and $null -ne $Req.x) { [int]$Req.x } else { $TargetObj.x }
            $y = if ($null -ne $Req -and $null -ne $Req.y) { [int]$Req.y } else { $TargetObj.y }
            $hasSize = ($null -ne $Req -and $null -ne $Req.width -and [int]$Req.width -gt 0 -and $null -ne $Req.height -and [int]$Req.height -gt 0)
            $w = if ($hasSize) { [int]$Req.width } else { $TargetObj.width }
            $hh = if ($hasSize) { [int]$Req.height } else { $TargetObj.height }
            $flags = [Win32FastDesktop]::SWP_NOZORDER -bor [Win32FastDesktop]::SWP_NOACTIVATE
            if (-not $hasSize) { $flags = $flags -bor [Win32FastDesktop]::SWP_NOSIZE }
            return [Win32FastDesktop]::SetWindowPos($Hwnd, [IntPtr]::Zero, $x, $y, $w, $hh, $flags)
        }
        { $_ -in @("snap_left", "snap_right", "snap_top", "snap_bottom", "move_monitor_1", "move_monitor_2", "move_smaller_monitor", "move_larger_monitor") } {
            return [Win32FastDesktop]::SnapWindow($Hwnd, $Action, $Monitor)
        }
        default {
            throw "Unsupported action: $Action"
        }
    }
}

$script:AppWindowAliases = @{
    "chrome"                = @("chrome", "google chrome")
    "google chrome"         = @("chrome", "google chrome")
    "vscode"                = @("code", "visual studio code")
    "vs code"               = @("code", "visual studio code")
    "code"                  = @("code", "visual studio code")
    "visual studio code"    = @("code", "visual studio code")
    "word"                  = @("winword", "word")
    "winword"               = @("winword", "word")
    "excel"                 = @("excel")
    "powerpoint"            = @("powerpnt", "powerpoint")
    "powerpnt"              = @("powerpnt", "powerpoint")
    "calc"                  = @("applicationframehost", "calculator", "calc")
    "calculator"            = @("applicationframehost", "calculator", "calc")
    "epic"                  = @("epicgameslauncher", "epic games")
    "epic games"            = @("epicgameslauncher", "epic games")
    "legion"                = @("lenovo legion toolkit", "lenovolegiontoolkit")
    "legion toolkit"        = @("lenovo legion toolkit", "lenovolegiontoolkit")
    "nvidia"                = @("nvidia", "nvidia app")
    "zalo"                  = @("zalo")
    "unikey"                = @("unikey")
    "curseforge"            = @("curseforge")
    "zotero"                = @("zotero")
    "zoom"                  = @("zoom", "zoom workplace")
    "chatgpt"               = @("chatgpt")
    "obs"                   = @("obs64", "obs studio")
}

$script:AppIndexCache = $null
$script:AppIndexLoadedAt = [DateTime]::MinValue

function Normalize-AppCompact {
    param([string]$Text)
    if ([string]::IsNullOrWhiteSpace($Text)) { return "" }
    $formD = $Text.ToLowerInvariant().Normalize([System.Text.NormalizationForm]::FormD)
    $sb = New-Object System.Text.StringBuilder
    foreach ($ch in $formD.ToCharArray()) {
        $cat = [System.Globalization.CharUnicodeInfo]::GetUnicodeCategory($ch)
        if ($cat -ne [System.Globalization.UnicodeCategory]::NonSpacingMark) {
            $mapped = if ($ch -eq 'đ') { 'd' } else { $ch }
            if ([char]::IsLetterOrDigit($mapped)) {
                [void]$sb.Append($mapped)
            }
        }
    }
    return $sb.ToString()
}

function Get-AppIndex {
    param([switch]$ForceRefresh)
    if (-not $ForceRefresh -and $null -ne $script:AppIndexCache -and ((Get-Date) - $script:AppIndexLoadedAt).TotalMinutes -lt 5) {
        return $script:AppIndexCache
    }
    $entries = New-Object System.Collections.Generic.List[object]
    $blockedNames = @("command prompt", "powershell", "windows powershell", "windows terminal", "registry editor", "task manager", "antigravity", "run")

    try {
        foreach ($sa in @(Get-StartApps)) {
            $nm = ([string]$sa.Name).Trim()
            if ([string]::IsNullOrWhiteSpace($nm) -or [string]::IsNullOrWhiteSpace([string]$sa.AppID)) { continue }
            $low = $nm.ToLowerInvariant()
            if ($blockedNames -contains $low) { continue }
            $entries.Add([pscustomobject]@{
                Name    = $nm
                Low     = $low
                Compact = (Normalize-AppCompact -Text $nm)
                Source  = "startapp"
                Target  = [string]$sa.AppID
            })
        }
    } catch {}

    $lnkDirs = @(
        (Join-Path $env:USERPROFILE "Desktop"),
        (Join-Path $env:PUBLIC "Desktop"),
        (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"),
        (Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs")
    )
    foreach ($dir in $lnkDirs) {
        if (-not (Test-Path -LiteralPath $dir)) { continue }
        try {
            $isDesk = $dir.ToLowerInvariant().EndsWith("desktop")
            $lnks = Get-ChildItem -LiteralPath $dir -Filter *.lnk -Recurse -Depth 2 -ErrorAction SilentlyContinue
            foreach ($f in $lnks) {
                $bn = $f.BaseName.Trim()
                if ([string]::IsNullOrWhiteSpace($bn)) { continue }
                $low = $bn.ToLowerInvariant()
                if ($blockedNames -contains $low) { continue }
                $entries.Add([pscustomobject]@{
                    Name    = $bn
                    Low     = $low
                    Compact = (Normalize-AppCompact -Text $bn)
                    Source  = if ($isDesk) { "desktop_lnk" } else { "startmenu_lnk" }
                    Target  = $f.FullName
                })
            }
        } catch {}
    }

    $script:AppIndexCache = $entries.ToArray()
    $script:AppIndexLoadedAt = Get-Date
    return ,$script:AppIndexCache
}

function Resolve-BestAppEntry {
    param([string]$Query)
    $rawQ = ([string]$Query).Trim()
    if ([string]::IsNullOrWhiteSpace($rawQ)) { return $null }

    $qLower = $rawQ.ToLowerInvariant()
    $aliasQueries = New-Object System.Collections.Generic.List[string]
    $aliasQueries.Add($qLower)
    if ($qLower -eq "vscode" -or $qLower -eq "vs code") { $aliasQueries.Add("visual studio code") }
    elseif ($qLower -eq "chrome") { $aliasQueries.Add("google chrome") }
    elseif ($qLower -eq "epic") { $aliasQueries.Add("epic games launcher") }
    elseif ($qLower -eq "legion") { $aliasQueries.Add("lenovo legion toolkit") }
    elseif ($qLower -eq "nvidia") { $aliasQueries.Add("nvidia app") }
    elseif ($qLower -eq "zoom") { $aliasQueries.Add("zoom workplace") }

    $idx = Get-AppIndex
    $best = $null
    $bestScore = -9999
    $junkPattern = 'uninstall|remove|error\s*reporter|updater|check\s*for|manual|readme|help|repair|setup'

    foreach ($item in $idx) {
        $score = -9999
        foreach ($candQ in $aliasQueries) {
            $cq = Normalize-AppCompact -Text $candQ
            if ([string]::IsNullOrEmpty($cq)) { continue }
            $s = 0
            if ($item.Low -eq $candQ -or $item.Compact -eq $cq) {
                $s = 120
            } elseif ($item.Low.StartsWith($candQ) -or $item.Compact.StartsWith($cq)) {
                $s = 85
            } elseif ($item.Low.Contains($candQ) -or $item.Compact.Contains($cq)) {
                $s = 55
            } else {
                $toks = @($candQ -split '\s+' | Where-Object { $_.Length -ge 2 })
                if ($toks.Count -gt 1) {
                    $allHit = $true
                    foreach ($tk in $toks) {
                        if (-not $item.Low.Contains($tk)) { $allHit = $false; break }
                    }
                    if ($allHit) { $s = 48 }
                }
            }
            if ($s -gt $score) { $score = $s }
        }
        if ($score -le 0) { continue }
        if ($item.Low -match $junkPattern) { $score -= 85 }
        if ($item.Source -eq "desktop_lnk") { $score += 10 }
        elseif ($item.Source -eq "startapp") { $score += 6 }
        # Prefer concise primary app names over long secondary tools
        $score -= [Math]::Min(15, [int]($item.Name.Length / 8))

        if ($score -gt $bestScore) {
            $bestScore = $score
            $best = $item
        }
    }
    if ($bestScore -ge 25) { return $best }
    return $null
}

function Find-LaunchedAppWindow {
    param(
        [string]$Alias,
        [string[]]$ExtraNeedles = @()
    )
    $lowAlias = ([string]$Alias).ToLowerInvariant().Trim()
    $isBrowser = ($lowAlias -eq "edge" -or $lowAlias -eq "msedge")
    $needleSet = New-Object System.Collections.Generic.List[string]
    if ($isBrowser) {
        $needleSet.Add("msedge"); $needleSet.Add("edge")
    } else {
        if (-not [string]::IsNullOrWhiteSpace($lowAlias)) { $needleSet.Add($lowAlias) }
        if ($script:AppWindowAliases.ContainsKey($lowAlias)) {
            foreach ($an in $script:AppWindowAliases[$lowAlias]) { $needleSet.Add($an) }
        }
        foreach ($en in $ExtraNeedles) {
            if (-not [string]::IsNullOrWhiteSpace($en)) { $needleSet.Add($en.ToLowerInvariant()) }
        }
    }

    $wins = [Win32FastDesktop]::ListWindows()
    $hit = $wins | Where-Object {
        $procLow = $_.process.ToLowerInvariant()
        $titleLow = $_.title.ToLowerInvariant()
        $compactTitle = Normalize-AppCompact -Text $_.title
        $isEdgeBrowserWin = ($procLow -eq "msedge") -and (
            ($titleLow.Contains("microsoft") -and $titleLow.Contains("edge")) -or
            $titleLow.Contains("new tab") -or
            $titleLow.Contains("tab mới") -or
            $titleLow.Contains("inprivate")
        )
        if ($isBrowser) {
            return $isEdgeBrowserWin -and ($_.minimized -or ($_.width -ge 280 -and $_.height -ge 240))
        }
        if ($isEdgeBrowserWin) {
            return $false
        }
        $matchesAlias = $false
        foreach ($n in $needleSet) {
            $cn = Normalize-AppCompact -Text $n
            if ($procLow.Contains($n) -or $titleLow.Contains($n) -or ($cn.Length -ge 3 -and $compactTitle.Contains($cn))) {
                $matchesAlias = $true
                break
            }
        }
        $matchesAlias -and ($_.minimized -or ($_.width -ge 280 -and $_.height -ge 240)) -and -not $titleLow.Contains("updater")
    } | Sort-Object -Property width -Descending | Select-Object -First 1
    return $hit
}

function Get-TotalDurationSecondsFromText {
    param([string]$Text)
    if ([string]::IsNullOrWhiteSpace($Text)) { return 0 }
    # Extract the portion after 'of ' / 'cua ' / 'của ' / '/' if present (total duration)
    $targetPart = $Text
    if ($Text -match '(?:^|\s)(?:of|cua|của|\/)\s+(.+)$') {
        $targetPart = $Matches[1]
    }
    if ($targetPart -match '(\d+)\s*:\s*(\d{1,2})\s*:\s*(\d{1,2})') {
        return ([int]$Matches[1] * 3600) + ([int]$Matches[2] * 60) + [int]$Matches[3]
    }
    if ($targetPart -match '(\d+)\s*:\s*(\d{1,2})') {
        return ([int]$Matches[1] * 60) + [int]$Matches[2]
    }
    $sec = 0
    $matchedAny = $false
    if ($targetPart -match '(\d+)\s*(?:hours?|hrs?|giờ|tiếng|h)\b') { $sec += ([int]$Matches[1] * 3600); $matchedAny = $true }
    if ($targetPart -match '(\d+)\s*(?:minutes?|mins?|phút|p)\b') { $sec += ([int]$Matches[1] * 60); $matchedAny = $true }
    if ($targetPart -match '(\d+)\s*(?:seconds?|secs?|giây|s)\b') { $sec += [int]$Matches[1]; $matchedAny = $true }
    if ($matchedAny) { return $sec }
    return 0
}

function Invoke-UiaReadWithWait {
    param(
        [IntPtr]$Hwnd,
        [string]$ScopeName,
        [bool]$IncludeButtons,
        [int]$MaxItems,
        [int]$MaxChars,
        [string]$WaitForText,
        [int]$WaitStableMs,
        [int]$MinChars,
        [int]$WaitTimeoutMs,
        [bool]$ContentOnly = $false,
        [bool]$IncludeControls = $false
    )
    $safeMaxItems = [Math]::Max(1, [Math]::Min(400, $MaxItems))
    $safeMaxChars = [Math]::Max(200, [Math]::Min(24000, $MaxChars))
    $safeMinChars = [Math]::Max(0, $MinChars)
    $safeStableMs = [Math]::Max(0, [Math]::Min(6000, $WaitStableMs))
    $effTimeout = [Math]::Max(0, [Math]::Min(10000, $WaitTimeoutMs))
    if ($effTimeout -eq 0 -and ($safeStableMs -gt 0 -or -not [string]::IsNullOrWhiteSpace($WaitForText) -or $safeMinChars -gt 0)) {
        $effTimeout = if ($safeStableMs -gt 0) { [Math]::Min(10000, $safeStableMs + 4000) } else { 5000 }
    }

    $needle = if (-not [string]::IsNullOrWhiteSpace($WaitForText)) { $WaitForText.Trim().ToLowerInvariant() } else { "" }
    $needLoop = ($effTimeout -gt 0)

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $stableSw = $null
    $lastSnapshot = $null
    $res = $null
    $timedOut = $false

    while ($true) {
        $res = [UiaFastDesktop]::ReadTextLines($Hwnd, $ScopeName, $IncludeButtons, $safeMaxItems, $safeMaxChars, 12000, 2800, $ContentOnly, $IncludeControls)
        if (-not $needLoop) {
            break
        }

        $textVal = if ($null -ne $res.text) { [string]$res.text } else { "" }
        if ($null -eq $lastSnapshot -or $textVal -ne $lastSnapshot) {
            $lastSnapshot = $textVal
            $stableSw = [System.Diagnostics.Stopwatch]::StartNew()
        }

        $hasNeedle = ([string]::IsNullOrEmpty($needle) -or $textVal.ToLowerInvariant().Contains($needle))
        $hasMinChars = ($res.total_chars -ge $safeMinChars)
        $isStable = ($safeStableMs -le 0 -or ($null -ne $stableSw -and $stableSw.ElapsedMilliseconds -ge $safeStableMs -and $res.total_chars -gt 0))

        if ($hasNeedle -and $hasMinChars -and $isStable) {
            break
        }
        if ($sw.ElapsedMilliseconds -ge $effTimeout) {
            $timedOut = $true
            break
        }
        Start-Sleep -Milliseconds 280
    }

    return @{
        scope_found = $res.scope_found
        scope_name = $res.scope_name
        line_count = $res.line_count
        total_chars = $res.total_chars
        text = $res.text
        lines = @($res.lines)
        waited_ms = [int]$sw.ElapsedMilliseconds
        timed_out = $timedOut
    }
}

function Invoke-SingleUiaStep {
    param(
        [IntPtr]$Hwnd,
        [IntPtr]$PrevFg,
        [object]$TargetObj,
        [object]$StepReq,
        [bool]$DryRun,
        [bool]$RestoreCursor,
        [int]$WaitMs
    )
    $nameQuery = if ($null -ne $StepReq.name) { [string]$StepReq.name } else { "" }
    $roleFilter = if ($null -ne $StepReq.role) { [string]$StepReq.role } else { "" }
    $excludeName = if ($null -ne $StepReq.exclude_name) { [string]$StepReq.exclude_name } else { "" }
    $runtimeIdFilter = if ($null -ne $StepReq.runtime_id) { [string]$StepReq.runtime_id } else { "" }
    $contentOnly = ($StepReq.content_only -eq $true)
    $exactMatch = ($StepReq.exact -eq $true)
    $maxRes = if ($null -ne $StepReq.limit -and [int]$StepReq.limit -gt 0) { [Math]::Min(40, [int]$StepReq.limit) } else { 10 }
    $idx = if ($null -ne $StepReq.index) { [int]$StepReq.index } else { 0 }
    $sortBy = if ($null -ne $StepReq.sort_by) { [string]$StepReq.sort_by } else { "dom" }
    $clearFirst = ($StepReq.clear_first -eq $true)
    $hasSliderVal = ($null -ne $StepReq.slider_value)
    $hasSliderDelta = ($null -ne $StepReq.slider_delta)
    $hasClickRatio = ($null -ne $StepReq.click_ratio)

    $retryTimeout = [Math]::Max(0, [Math]::Min(8000, $WaitMs))
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $matches = $null
    $wokePlayer = $false
    $isPlayerCtrlQuery = ($roleFilter -ieq "slider" -or $hasSliderVal -or $hasSliderDelta -or $nameQuery -match 'fullscreen|toàn màn hình|phóng to|phụ đề|subtitle|caption|tạm dừng|pause|phát|play|mute|tắt tiếng|theater|rạp|tiếp theo|next')
    while ($true) {
        $matches = [UiaFastDesktop]::FindElements($Hwnd, $nameQuery, $exactMatch, $roleFilter, $contentOnly, $excludeName, $runtimeIdFilter, $maxRes, 15000, 2800, $sortBy)
        if (($null -ne $matches -and $matches.Count -gt $idx) -or $DryRun) {
            break
        }
        # Wake auto-hidden HTML5/YouTube video controls once by gently nudging cursor into video pane
        if (-not $wokePlayer -and $isPlayerCtrlQuery -and $null -ne $TargetObj -and $TargetObj.width -gt 300) {
            $wokePlayer = $true
            $savedCur = New-Object Win32FastDesktop+POINT
            $hadCur = [Win32FastDesktop]::GetCursorPos([ref]$savedCur)
            $hoverX = [int]$TargetObj.x + [int]([Math]::Floor($TargetObj.width / 2))
            $hoverY = [int]$TargetObj.y + [int]([Math]::Floor($TargetObj.height * 0.45))
            [Win32FastDesktop]::SetCursorPos($hoverX, $hoverY) | Out-Null
            Start-Sleep -Milliseconds 110
            [Win32FastDesktop]::SetCursorPos($hoverX + 8, $hoverY) | Out-Null
            Start-Sleep -Milliseconds 140
            if ($hadCur) { [Win32FastDesktop]::SetCursorPos($savedCur.X, $savedCur.Y) | Out-Null }
            continue
        }
        if ($sw.ElapsedMilliseconds -ge $retryTimeout) {
            break
        }
        Start-Sleep -Milliseconds 180
    }

    if ($null -eq $matches -or $matches.Count -eq 0) {
        return @{ ok = $false; error = "No UI element matched name='$nameQuery' role='$roleFilter' runtime_id='$runtimeIdFilter'" }
    }
    if ($DryRun) {
        return @{
            ok = $true
            data = @{
                dry_run = $true
                matches_count = $matches.Count
                matches = @($matches)
                target = $TargetObj
            }
        }
    }
    if ($idx -lt 0 -or $idx -ge $matches.Count) {
        return @{ ok = $false; error = "Matched index $idx out of range (found $($matches.Count) elements)" }
    }

    $chosen = $matches[$idx]
    # Auto-scroll element into viewport when offscreen or outside visible window bounds
    $winTopBound = if ($null -ne $TargetObj) { [int]$TargetObj.y + 75 } else { 0 }
    $winBotBound = if ($null -ne $TargetObj) { [int]$TargetObj.y + [int]$TargetObj.height - 20 } else { 99999 }
    if ($chosen.runtime_id -and ($chosen.is_offscreen -or $chosen.center_y -lt $winTopBound -or $chosen.center_y -gt $winBotBound)) {
        $scrolled = [UiaFastDesktop]::ScrollElementIntoViewAndRead($Hwnd, $chosen.runtime_id)
        if ($null -ne $scrolled) { $chosen = $scrolled }
        if (($chosen.is_offscreen -or $chosen.center_y -lt $winTopBound -or $chosen.center_y -gt $winBotBound) -and $null -ne $TargetObj) {
            $scrollDir = if ($chosen.center_y -gt $winBotBound) { -6 } else { 6 }
            $midX = [int]$TargetObj.x + [int]([Math]::Floor($TargetObj.width / 2))
            $midY = [int]$TargetObj.y + [int]([Math]::Floor($TargetObj.height / 2))
            [Win32FastDesktop]::ScrollWindow($Hwnd, $midX, $midY, 0, $scrollDir, $true) | Out-Null
            Start-Sleep -Milliseconds 140
            $reRead = [UiaFastDesktop]::ReadMatchByRuntimeId($Hwnd, $chosen.runtime_id)
            if ($null -ne $reRead) { $chosen = $reRead }
        }
    }

    $btn = if ($null -ne $StepReq.button) { ([string]$StepReq.button).ToLowerInvariant() } else { "left" }
    $cnt = if ($null -ne $StepReq.count) { [int]$StepReq.count } else { 1 }
    $txt = if ($null -ne $StepReq.text) { [string]$StepReq.text } else { "" }
    $didEnter = ($StepReq.press_enter -eq $true)

    $clickX = [int]$chosen.center_x
    $clickY = [int]$chosen.center_y
    $sliderMeta = $null

    if (($hasSliderVal -or $hasSliderDelta) -and $chosen.width -gt 12) {
        $effMin = if ($chosen.has_range) { [double]$chosen.range_min } else { 0.0 }
        $effMax = if ($chosen.has_range) { [double]$chosen.range_max } else { 0.0 }
        if ($effMax -le 105) {
            $parsedDur = Get-TotalDurationSecondsFromText -Text ($chosen.value_text + " " + $chosen.name)
            if ($parsedDur -gt 0) {
                $effMin = 0.0
                $effMax = [double]$parsedDur
            }
        }
        $targetSec = if ($hasSliderVal) {
            [double]$StepReq.slider_value
        } else {
            $curSec = if ($chosen.has_range -and $chosen.range_max -gt 105) { [double]$chosen.range_value } else { 0.0 }
            $curSec + [double]$StepReq.slider_delta
        }
        if ($effMax -gt $effMin) {
            $outOfRange = ($targetSec -gt $effMax -or $targetSec -lt $effMin)
            $clampedTarget = [Math]::Max($effMin, [Math]::Min($effMax, $targetSec))
            $ratio = ($clampedTarget - $effMin) / ($effMax - $effMin)
            $ratio = [Math]::Max(0.004, [Math]::Min(0.996, $ratio))
            $trackPad = [Math]::Min(4, [int]([Math]::Floor($chosen.width / 20)))
            $usableW = [Math]::Max(4, $chosen.width - ($trackPad * 2))
            $clickX = [int]$chosen.x + $trackPad + [int][Math]::Round($usableW * $ratio)

            $clickRes = Invoke-ClickAndOptionalType -Hwnd $Hwnd -PrevFg $PrevFg -TargetObj $TargetObj -AbsX $clickX -AbsY $clickY -Button $btn -Count $cnt -RestoreCursor $RestoreCursor -Text "" -PressEnter $false -RestoreFocus $false
            if (-not $clickRes.ok) { return $clickRes }

            # Read back actual slider position and perform 1 micro-adjustment if padding shifted timestamp
            $adjusted = $false
            Start-Sleep -Milliseconds 190
            $after = if ($chosen.runtime_id) { [UiaFastDesktop]::ReadMatchByRuntimeId($Hwnd, $chosen.runtime_id) } else { $null }
            if ($null -ne $after -and $chosen.has_range -and $chosen.range_max -gt $chosen.range_min) {
                $curActual = [double]$after.range_value
                $scaleSpan = [double]($chosen.range_max - $chosen.range_min)
                $mappedTarget = if ($effMax -ne $chosen.range_max -and $chosen.range_max -gt 0) {
                    ($clampedTarget / $effMax) * $chosen.range_max
                } else {
                    $clampedTarget
                }
                $tol = [Math]::Max(6.0, $scaleSpan * 0.01)
                if ([Math]::Abs($curActual - $mappedTarget) -gt $tol) {
                    $deltaRatio = ($mappedTarget - $curActual) / $scaleSpan
                    $adjX = $clickX + [int][Math]::Round($usableW * $deltaRatio)
                    $adjX = [Math]::Max([int]$chosen.x + $trackPad, [Math]::Min([int]$chosen.x + [int]$chosen.width - $trackPad - 1, $adjX))
                    if ([Math]::Abs($adjX - $clickX) -ge 2) {
                        $adjusted = $true
                        $clickX = $adjX
                        [Win32FastDesktop]::ClickWindowPoint($Hwnd, $adjX, $clickY, "left", 1, $RestoreCursor) | Out-Null
                        Start-Sleep -Milliseconds 150
                        $after2 = [UiaFastDesktop]::ReadMatchByRuntimeId($Hwnd, $chosen.runtime_id)
                        if ($null -ne $after2) { $after = $after2 }
                    }
                }
            }
            $sliderMeta = @{
                target_value = $targetSec
                clamped_target = $clampedTarget
                min = $effMin
                max = $effMax
                ratio_used = [Math]::Round($ratio, 4)
                after_value = if ($null -ne $after -and $after.has_range) { $after.range_value } else { $null }
                after_text = if ($null -ne $after) { $after.value_text } else { "" }
                adjusted = $adjusted
                out_of_range = $outOfRange
            }
            $clickRes.data.matched = if ($null -ne $after) { $after } else { $chosen }
            $clickRes.data.matches_count = $matches.Count
            $clickRes.data.slider_seek = $sliderMeta
            return $clickRes
        }
    } elseif ($hasClickRatio -and $chosen.width -gt 4) {
        $ratio = [Math]::Max(0.0, [Math]::Min(1.0, [double]$StepReq.click_ratio))
        $trackPad = [Math]::Min(4, [int]([Math]::Floor($chosen.width / 20)))
        $usableW = [Math]::Max(2, $chosen.width - ($trackPad * 2))
        $clickX = [int]$chosen.x + $trackPad + [int][Math]::Round($usableW * $ratio)
    }

    $clickRes = Invoke-ClickAndOptionalType -Hwnd $Hwnd -PrevFg $PrevFg -TargetObj $TargetObj -AbsX $clickX -AbsY $clickY -Button $btn -Count $cnt -RestoreCursor $RestoreCursor -Text $txt -PressEnter $didEnter -RestoreFocus $false -ClearFirst $clearFirst
    if ($clickRes.ok) {
        $clickRes.data.matched = $chosen
        $clickRes.data.matches_count = $matches.Count
    }
    return $clickRes
}

while ($null -ne ($line = [Console]::In.ReadLine())) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $resp = $null
    try {
        $req = $line | ConvertFrom-Json
        switch ($req.cmd) {
            "ping" {
                $resp = @{ ok = $true; data = @{ pong = $true } }
            }
            "list_windows" {
                $wins = Get-FilteredWindows -Filter ([string]$req.filter)
                $resp = @{ ok = $true; data = @($wins) }
            }
            "open_edge_url" {
                $urlList = if ($null -ne $req.urls -and @($req.urls).Count -gt 0) {
                    @($req.urls | ForEach-Object { [string]$_ })
                } else {
                    @([string]$req.url)
                }
                $quotedArgs = @($urlList | ForEach-Object { '"' + ($_ -replace '"', '%22') + '"' }) -join ' '
                Start-Process -FilePath "msedge.exe" -ArgumentList $quotedArgs | Out-Null

                $focused = $false
                if ($req.focus -ne $false) {
                    $swEdge = [System.Diagnostics.Stopwatch]::StartNew()
                    $edgeWin = $null
                    while ($swEdge.ElapsedMilliseconds -lt 1500) {
                        Start-Sleep -Milliseconds 120
                        $allWins = [Win32FastDesktop]::ListWindows()
                        $edgeWin = $allWins |
                            Where-Object {
                                $tl = $_.title.ToLowerInvariant()
                                $_.process -ieq "msedge" -and $_.width -gt 300 -and -not $_.minimized -and (
                                    ($tl.Contains("microsoft") -and $tl.Contains("edge")) -or $tl.Contains("new tab") -or $tl.Contains("tab mới")
                                )
                            } |
                            Sort-Object -Property width -Descending |
                            Select-Object -First 1
                        if ($null -eq $edgeWin) {
                            $edgeWin = $allWins |
                                Where-Object {
                                    $tl = $_.title.ToLowerInvariant()
                                    $_.process -ieq "msedge" -and $_.width -gt 300 -and ($tl.Contains("microsoft") -and $tl.Contains("edge"))
                                } |
                                Sort-Object -Property width -Descending |
                                Select-Object -First 1
                        }
                        if ($null -eq $edgeWin) {
                            $edgeWin = $allWins |
                                Where-Object { $_.process -ieq "msedge" -and $_.width -gt 300 } |
                                Sort-Object -Property width -Descending |
                                Select-Object -First 1
                        }
                        if ($null -ne $edgeWin) { break }
                    }
                    if ($null -ne $edgeWin) {
                        $focused = [Win32FastDesktop]::FocusWindow([IntPtr]::new([long]$edgeWin.hwnd))
                    }
                }
                $resp = @{ ok = $true; data = @{ urls = $urlList; count = $urlList.Count; focused = $focused } }
            }
            "window_control" {
                $target = Resolve-TargetWindow -Req $req
                if ($null -eq $target) {
                    $resp = @{ ok = $false; error = "Window not found matching target criteria" }
                } else {
                    $h = [IntPtr]::new([long]$target.hwnd)
                    $act = [string]$req.action
                    $monNum = if ($null -ne $req.monitor) { [int]$req.monitor } else { 0 }
                    $result = Invoke-WindowAction -Hwnd $h -TargetObj $target -Action $act -Monitor $monNum -Req $req
                    $resp = @{
                        ok = $true
                        data = @{
                            action = $act
                            monitor = $monNum
                            executed = $result
                            target = $target
                        }
                    }
                }
            }
            "type_unicode_text" {
                $target = Resolve-TargetWindow -Req $req
                if ($null -eq $target) {
                    $resp = @{ ok = $false; error = "Window not found matching target criteria" }
                } else {
                    $h = [IntPtr]::new([long]$target.hwnd)
                    $prevFg = [Win32FastDesktop]::GetForegroundWindow()
                    $focused = [Win32FastDesktop]::FocusWindow($h)
                    Start-Sleep -Milliseconds 120
                    if ([Win32FastDesktop]::GetForegroundWindow() -ne $h) {
                        $resp = @{ ok = $false; error = "Target window did not become foreground before typing (aborted for safety)" }
                    } else {
                        $text = [string]$req.text
                        $pressEnter = ($req.press_enter -eq $true)
                        $sent = [Win32FastDesktop]::SendUnicodeText($h, $text, $pressEnter)
                        $restoredFocus = $false
                        if ($req.restore_focus -eq $true -and $prevFg -ne [IntPtr]::Zero -and $prevFg -ne $h) {
                            Start-Sleep -Milliseconds 30
                            $restoredFocus = [Win32FastDesktop]::FocusWindow($prevFg)
                        }
                        $resp = @{
                            ok = ($sent -gt 0)
                            data = @{
                                typed_chars = $text.Length
                                sent_events = $sent
                                press_enter = $pressEnter
                                focus_restored = $restoredFocus
                                target = $target
                            }
                        }
                        if ($sent -eq 0) {
                            $resp.error = "SendInput returned 0 events"
                        }
                    }
                }
            }
            "click_window_point" {
                $target = Resolve-TargetWindow -Req $req
                if ($null -eq $target) {
                    $resp = @{ ok = $false; error = "Window not found matching target criteria" }
                } else {
                    $h = [IntPtr]::new([long]$target.hwnd)
                    $prevFg = [Win32FastDesktop]::GetForegroundWindow()
                    $focused = [Win32FastDesktop]::FocusWindow($h)
                    Start-Sleep -Milliseconds 100
                    if ([Win32FastDesktop]::GetForegroundWindow() -ne $h) {
                        $resp = @{ ok = $false; error = "Target window did not become foreground before clicking (aborted for safety)" }
                    } else {
                        $rect = New-Object Win32FastDesktop+RECT
                        [Win32FastDesktop]::GetWindowRect($h, [ref]$rect) | Out-Null
                        if ($null -ne $req.rel_x -and $null -ne $req.rel_y) {
                            $rx = [int]$req.rel_x
                            $ry = [int]$req.rel_y
                            if ($null -ne $req.image_width -and [int]$req.image_width -gt 0 -and $null -ne $req.image_height -and [int]$req.image_height -gt 0) {
                                $winW = $rect.Right - $rect.Left
                                $winH = $rect.Bottom - $rect.Top
                                $rx = [int][Math]::Round($rx * $winW / [double]$req.image_width)
                                $ry = [int][Math]::Round($ry * $winH / [double]$req.image_height)
                            }
                            $absX = $rect.Left + $rx
                            $absY = $rect.Top + $ry
                        } else {
                            $absX = [int]$req.x
                            $absY = [int]$req.y
                        }
                        $btn = if ($null -ne $req.button) { ([string]$req.button).ToLowerInvariant() } else { "left" }
                        $cnt = if ($null -ne $req.count) { [int]$req.count } else { 1 }
                        $restoreCur = ($req.restore_cursor -ne $false)
                        $txt = if ($null -ne $req.text) { [string]$req.text } else { "" }
                        $didEnter = ($req.press_enter -eq $true)
                        $restoreFoc = ($req.restore_focus -eq $true)
                        $resp = Invoke-ClickAndOptionalType -Hwnd $h -PrevFg $prevFg -TargetObj $target -AbsX $absX -AbsY $absY -Button $btn -Count $cnt -RestoreCursor $restoreCur -Text $txt -PressEnter $didEnter -RestoreFocus $restoreFoc
                    }
                }
            }
            "uia_click" {
                $target = Resolve-TargetWindow -Req $req
                if ($null -eq $target) {
                    $resp = @{ ok = $false; error = "Window not found matching target criteria" }
                } else {
                    $h = [IntPtr]::new([long]$target.hwnd)
                    $dryRun = ($req.dry_run -eq $true)
                    $prevFg = [Win32FastDesktop]::GetForegroundWindow()
                    if ($dryRun -and $target.minimized) {
                        $resp = @{ ok = $false; error = "Target window '$($target.title)' is minimized; restore/focus it (or call launch_app) before inspecting UI elements." }
                        [Console]::Out.WriteLine(($resp | ConvertTo-Json -Compress -Depth 6))
                        [Console]::Out.Flush()
                        continue
                    }
                    if (-not $dryRun) {
                        [Win32FastDesktop]::FocusWindow($h) | Out-Null
                        Start-Sleep -Milliseconds 100
                        if ([Win32FastDesktop]::GetForegroundWindow() -ne $h) {
                            Start-Sleep -Milliseconds 90
                            [Win32FastDesktop]::FocusWindow($h) | Out-Null
                            Start-Sleep -Milliseconds 90
                        }
                        if ([Win32FastDesktop]::GetForegroundWindow() -ne $h) {
                            $resp = @{ ok = $false; error = "Target window did not become foreground before uia_click (aborted for safety)" }
                            [Console]::Out.WriteLine(($resp | ConvertTo-Json -Compress -Depth 6))
                            [Console]::Out.Flush()
                            continue
                        }
                        if ($target.minimized) {
                            $refreshed = Resolve-TargetWindow -Req @{ hwnd = $target.hwnd }
                            if ($null -ne $refreshed) { $target = $refreshed }
                        }
                    }

                    $restoreCur = ($req.restore_cursor -ne $false)
                    $restoreFoc = ($req.restore_focus -eq $true)
                    $stepsList = if ($null -ne $req.steps) { @($req.steps) } else { @() }

                    if ($stepsList.Count -gt 0) {
                        $stepResults = @()
                        $stepFailed = $null
                        for ($si = 0; $si -lt $stepsList.Count; $si++) {
                            $st = $stepsList[$si]
                            $isLast = ($si -eq ($stepsList.Count - 1))
                            $stepWait = if ($null -ne $st.wait_ms) { [int]$st.wait_ms } elseif ($si -gt 0) { 2500 } else { 0 }
                            if ($null -eq $st.content_only -and $req.content_only -eq $true) {
                                $st | Add-Member -NotePropertyName "content_only" -NotePropertyValue $true -Force
                            }
                            if ($null -eq $st.exclude_name -and -not [string]::IsNullOrEmpty([string]$req.exclude_name)) {
                                $st | Add-Member -NotePropertyName "exclude_name" -NotePropertyValue ([string]$req.exclude_name) -Force
                            }
                            $sRes = Invoke-SingleUiaStep -Hwnd $h -PrevFg $prevFg -TargetObj $target -StepReq $st -DryRun $dryRun -RestoreCursor ($restoreCur -and $isLast) -WaitMs $stepWait
                            if (-not $sRes.ok) {
                                $stepFailed = @{
                                    ok = $false
                                    error = "Step $si failed: $($sRes.error)"
                                    failed_step_index = $si
                                    completed_steps = @($stepResults)
                                }
                                break
                            }
                            $stepResults += @{
                                step_index = $si
                                matched = $sRes.data.matched
                                matches_count = $sRes.data.matches_count
                                typed_chars = $sRes.data.typed_chars
                                pressed_enter = $sRes.data.pressed_enter
                                slider_seek = $sRes.data.slider_seek
                            }
                            if ((-not $dryRun) -and (-not $isLast)) {
                                $stepDelay = if ($null -ne $st.delay_ms) { [Math]::Max(0, [Math]::Min(2000, [int]$st.delay_ms)) } else { 120 }
                                if ($stepDelay -gt 0) { Start-Sleep -Milliseconds $stepDelay }
                            }
                        }
                        if ($null -ne $stepFailed) {
                            if ($restoreFoc -and (-not $dryRun) -and $prevFg -ne [IntPtr]::Zero -and $prevFg -ne $h) {
                                [Win32FastDesktop]::FocusWindow($prevFg) | Out-Null
                            }
                            $resp = $stepFailed
                        } else {
                            $resp = @{
                                ok = $true
                                data = @{
                                    steps_count = $stepsList.Count
                                    steps = @($stepResults)
                                    target = $target
                                    dry_run = $dryRun
                                }
                            }
                        }
                    } else {
                        $singleWait = if ($null -ne $req.wait_ms) { [int]$req.wait_ms } else { 0 }
                        $resp = Invoke-SingleUiaStep -Hwnd $h -PrevFg $prevFg -TargetObj $target -StepReq $req -DryRun $dryRun -RestoreCursor $restoreCur -WaitMs $singleWait
                    }

                    if ($resp.ok -and (-not $dryRun)) {
                        $waitAfter = if ($null -ne $req.wait_after_ms) { [Math]::Max(0, [Math]::Min(8000, [int]$req.wait_after_ms)) } else { 0 }
                        if ($waitAfter -gt 0) { Start-Sleep -Milliseconds $waitAfter }

                        $doRead = ($req.read_after -eq $true) -or (-not [string]::IsNullOrWhiteSpace([string]$req.read_scope))
                        if ($doRead) {
                            $rScope = if ($null -ne $req.read_scope) { [string]$req.read_scope } else { "" }
                            $rIncBtn = ($req.read_include_buttons -eq $true)
                            $rMaxItems = if ($null -ne $req.read_max_items) { [int]$req.read_max_items } else { 120 }
                            $rMaxChars = if ($null -ne $req.read_max_chars) { [int]$req.read_max_chars } else { 8000 }
                            $rWaitFor = if ($null -ne $req.read_wait_for_text) { [string]$req.read_wait_for_text } else { "" }
                            $rStableMs = if ($null -ne $req.read_stable_ms) { [int]$req.read_stable_ms } else { 0 }
                            $rMinChars = if ($null -ne $req.read_min_chars) { [int]$req.read_min_chars } else { 0 }
                            $rTimeout = if ($null -ne $req.read_wait_timeout_ms) { [int]$req.read_wait_timeout_ms } else { 0 }
                            $rContentOnly = ($req.content_only -eq $true)
                            $rIncControls = ($req.read_include_controls -eq $true)
                            $resp.data.read_result = Invoke-UiaReadWithWait -Hwnd $h -ScopeName $rScope -IncludeButtons $rIncBtn -MaxItems $rMaxItems -MaxChars $rMaxChars -WaitForText $rWaitFor -WaitStableMs $rStableMs -MinChars $rMinChars -WaitTimeoutMs $rTimeout -ContentOnly $rContentOnly -IncludeControls $rIncControls
                        }

                        if ($restoreFoc -and $prevFg -ne [IntPtr]::Zero -and $prevFg -ne $h) {
                            [Win32FastDesktop]::FocusWindow($prevFg) | Out-Null
                            $resp.data.focus_restored = $true
                        } else {
                            $resp.data.focus_restored = $false
                        }
                    }
                }
            }
            "uia_read" {
                $target = Resolve-TargetWindow -Req $req
                if ($null -eq $target) {
                    $resp = @{ ok = $false; error = "Window not found matching target criteria" }
                } elseif ($target.minimized -and ($req.focus -ne $true)) {
                    $resp = @{ ok = $false; error = "Target window is minimized; focus/restore it or pass focus=true before uia_read" }
                } else {
                    $h = [IntPtr]::new([long]$target.hwnd)
                    $prevFg = [Win32FastDesktop]::GetForegroundWindow()
                    $didFocus = $false
                    if ($req.focus -eq $true) {
                        [Win32FastDesktop]::FocusWindow($h) | Out-Null
                        Start-Sleep -Milliseconds 90
                        if ([Win32FastDesktop]::GetForegroundWindow() -ne $h) {
                            $resp = @{ ok = $false; error = "Target window did not become foreground before uia_read (aborted for safety)" }
                            [Console]::Out.WriteLine(($resp | ConvertTo-Json -Compress -Depth 6))
                            [Console]::Out.Flush()
                            continue
                        }
                        $didFocus = $true
                    }

                    $rScope = if ($null -ne $req.scope_name) { [string]$req.scope_name } else { "" }
                    $rIncBtn = ($req.include_buttons -eq $true)
                    $rContentOnly = ($req.content_only -eq $true)
                    $rIncControls = ($req.include_controls -eq $true)
                    $rMaxItems = if ($null -ne $req.max_items) { [int]$req.max_items } else { 120 }
                    $rMaxChars = if ($null -ne $req.max_chars) { [int]$req.max_chars } else { 8000 }
                    $rWaitFor = if ($null -ne $req.wait_for_text) { [string]$req.wait_for_text } else { "" }
                    $rStableMs = if ($null -ne $req.wait_stable_ms) { [int]$req.wait_stable_ms } else { 0 }
                    $rMinChars = if ($null -ne $req.min_chars) { [int]$req.min_chars } else { 0 }
                    $rTimeout = if ($null -ne $req.wait_timeout_ms) { [int]$req.wait_timeout_ms } else { 0 }

                    $readData = Invoke-UiaReadWithWait -Hwnd $h -ScopeName $rScope -IncludeButtons $rIncBtn -MaxItems $rMaxItems -MaxChars $rMaxChars -WaitForText $rWaitFor -WaitStableMs $rStableMs -MinChars $rMinChars -WaitTimeoutMs $rTimeout -ContentOnly $rContentOnly -IncludeControls $rIncControls

                    if ($didFocus -and ($req.restore_focus -eq $true) -and $prevFg -ne [IntPtr]::Zero -and $prevFg -ne $h) {
                        [Win32FastDesktop]::FocusWindow($prevFg) | Out-Null
                        $readData.focus_restored = $true
                    } else {
                        $readData.focus_restored = $false
                    }
                    $readData.target = $target
                    $resp = @{ ok = $true; data = $readData }
                }
            }
            "scroll_window" {
                $target = Resolve-TargetWindow -Req $req
                if ($null -eq $target) {
                    $resp = @{ ok = $false; error = "Window not found matching target criteria" }
                } else {
                    $h = [IntPtr]::new([long]$target.hwnd)
                    $prevFg = [Win32FastDesktop]::GetForegroundWindow()
                    [Win32FastDesktop]::FocusWindow($h) | Out-Null
                    Start-Sleep -Milliseconds 85
                    if ([Win32FastDesktop]::GetForegroundWindow() -ne $h) {
                        $resp = @{ ok = $false; error = "Target window did not become foreground before scroll (aborted for safety)" }
                    } else {
                        if ($target.minimized) {
                            $refreshed = Resolve-TargetWindow -Req @{ hwnd = $target.hwnd }
                            if ($null -ne $refreshed) { $target = $refreshed }
                        }
                        if ($null -ne $req.rel_x -and $null -ne $req.rel_y) {
                            $absX = [int]$target.x + [int]$req.rel_x
                            $absY = [int]$target.y + [int]$req.rel_y
                        } else {
                            $absX = [int]$target.x + [int]([Math]::Floor($target.width / 2))
                            $absY = [int]$target.y + [int]([Math]::Floor($target.height / 2))
                        }

                        $dx = if ($null -ne $req.dx) { [Math]::Max(-50, [Math]::Min(50, [int]$req.dx)) } else { 0 }
                        $dy = if ($null -ne $req.dy) { [Math]::Max(-50, [Math]::Min(50, [int]$req.dy)) } else { 0 }
                        $restoreCur = ($req.restore_cursor -ne $false)

                        $scrollStatus = [Win32FastDesktop]::ScrollWindow($h, $absX, $absY, $dx, $dy, $restoreCur)
                        if (-not $scrollStatus.StartsWith("OK:")) {
                            $resp = @{ ok = $false; error = "ScrollWindow failed: $scrollStatus" }
                        } else {
                            $restoredFocus = $false
                            if (($req.restore_focus -eq $true) -and $prevFg -ne [IntPtr]::Zero -and $prevFg -ne $h) {
                                [Win32FastDesktop]::FocusWindow($prevFg) | Out-Null
                                $restoredFocus = $true
                            }
                            $resp = @{
                                ok = $true
                                data = @{
                                    scrolled = $scrollStatus
                                    dx = $dx
                                    dy = $dy
                                    x = $absX
                                    y = $absY
                                    target = $target
                                    focus_restored = $restoredFocus
                                }
                            }
                        }
                    }
                }
            }
            "send_hotkey" {
                $rawList = if ($null -ne $req.combos -and @($req.combos).Count -gt 0) { @($req.combos) } else { @([string]$req.combo) }
                $specs = @($rawList | ForEach-Object { Resolve-HotkeySpec -Combo ([string]$_) })
                $allGlobal = ($specs | Where-Object { -not $_.isGlobalMedia }).Count -eq 0
                $delayMs = if ($null -ne $req.delay_ms) { [Math]::Max(20, [Math]::Min(500, [int]$req.delay_ms)) } else { 65 }

                if ($allGlobal) {
                    $totalSent = [uint32]0
                    for ($si = 0; $si -lt $specs.Count; $si++) {
                        $sp = $specs[$si]
                        $totalSent += [Win32FastDesktop]::SendVirtualKeyCombo($sp.mods, $sp.modExt, $sp.keyVk, $sp.keyExt)
                        if ($si + 1 -lt $specs.Count) { Start-Sleep -Milliseconds $delayMs }
                    }
                    $resp = @{
                        ok = ($totalSent -gt 0)
                        data = @{
                            combos = $rawList
                            count = $specs.Count
                            global_media = $true
                            sent_events = $totalSent
                        }
                    }
                    if ($totalSent -eq 0) { $resp.error = "SendInput returned 0 events" }
                } else {
                    $target = Resolve-TargetWindow -Req $req
                    if ($null -eq $target) {
                        $resp = @{ ok = $false; error = "Window not found matching target criteria" }
                    } else {
                        $h = [IntPtr]::new([long]$target.hwnd)
                        $prevFg = [Win32FastDesktop]::GetForegroundWindow()
                        [Win32FastDesktop]::FocusWindow($h) | Out-Null
                        Start-Sleep -Milliseconds 90
                        if ([Win32FastDesktop]::GetForegroundWindow() -ne $h) {
                            $resp = @{ ok = $false; error = "Target window did not become foreground before hotkey (aborted for safety)" }
                        } else {
                            $totalSent = [uint32]0
                            for ($si = 0; $si -lt $specs.Count; $si++) {
                                $sp = $specs[$si]
                                $totalSent += [Win32FastDesktop]::SendVirtualKeyCombo($sp.mods, $sp.modExt, $sp.keyVk, $sp.keyExt)
                                if ($si + 1 -lt $specs.Count) { Start-Sleep -Milliseconds $delayMs }
                            }
                            Start-Sleep -Milliseconds 40
                            $lenAfter = [Win32FastDesktop]::GetWindowTextLength($h)
                            if ($lenAfter -gt 0) {
                                $sbAfter = New-Object System.Text.StringBuilder($lenAfter + 1)
                                [Win32FastDesktop]::GetWindowText($h, $sbAfter, $sbAfter.Capacity) | Out-Null
                                $target.title = $sbAfter.ToString()
                            }
                            $restoredFocus = $false
                            if ($req.restore_focus -eq $true -and $prevFg -ne [IntPtr]::Zero -and $prevFg -ne $h) {
                                Start-Sleep -Milliseconds 30
                                $restoredFocus = [Win32FastDesktop]::FocusWindow($prevFg)
                            }
                            $resp = @{
                                ok = ($totalSent -gt 0)
                                data = @{
                                    combos = $rawList
                                    count = $specs.Count
                                    global_media = $false
                                    sent_events = $totalSent
                                    focus_restored = $restoredFocus
                                    target = $target
                                }
                            }
                            if ($totalSent -eq 0) { $resp.error = "SendInput returned 0 events" }
                        }
                    }
                }
            }
            "open_path" {
                $targetPath = [string]$req.path
                if (-not (Test-Path -LiteralPath $targetPath)) {
                    $resp = @{ ok = $false; error = "Path does not exist: $targetPath" }
                } else {
                    Start-Process -FilePath $targetPath | Out-Null
                    $resp = @{ ok = $true; data = @{ opened = $targetPath } }
                }
            }
            "launch_app" {
                $alias = ([string]$req.alias).ToLowerInvariant().Trim()
                $launched = $false
                $method = ""
                $extraWinNeedles = @()
                switch ($alias) {
                    "edge" { Start-Process "msedge.exe" | Out-Null; $launched = $true; $method = "exe" }
                    "msedge" { Start-Process "msedge.exe" | Out-Null; $launched = $true; $method = "exe" }
                    "notepad" { Start-Process "notepad.exe" | Out-Null; $launched = $true; $method = "exe" }
                    "calc" { Start-Process "calc.exe" | Out-Null; $launched = $true; $method = "exe" }
                    "calculator" { Start-Process "calc.exe" | Out-Null; $launched = $true; $method = "exe" }
                    "explorer" { Start-Process "explorer.exe" | Out-Null; $launched = $true; $method = "exe" }
                    "chrome" {
                        $chromePaths = @(
                            (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
                            (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
                            (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe")
                        )
                        $cp = $chromePaths | Where-Object { Test-Path $_ } | Select-Object -First 1
                        if ($cp) { Start-Process -FilePath $cp | Out-Null; $launched = $true; $method = "exe:chrome" }
                    }
                    "discord" {
                        $discUpd = Join-Path $env:LOCALAPPDATA "Discord\Update.exe"
                        if (Test-Path $discUpd) {
                            Start-Process -FilePath $discUpd -ArgumentList "--processStart", "Discord.exe" | Out-Null
                            $launched = $true; $method = "localappdata"
                        }
                    }
                    "steam" {
                        $steamPaths = @(
                            (Join-Path ${env:ProgramFiles(x86)} "Steam\steam.exe"),
                            (Join-Path $env:ProgramFiles "Steam\steam.exe")
                        )
                        $sp = $steamPaths | Where-Object { Test-Path $_ } | Select-Object -First 1
                        if ($sp) {
                            Start-Process -FilePath $sp | Out-Null
                            $launched = $true; $method = "programfiles"
                        } else {
                            Start-Process "steam://open/main" | Out-Null
                            $launched = $true; $method = "protocol"
                        }
                    }
                }
                if (-not $launched) {
                    $resolvedApp = Resolve-BestAppEntry -Query $alias
                    if ($null -ne $resolvedApp) {
                        $extraWinNeedles += $resolvedApp.Name
                        if ($resolvedApp.Source -eq "startapp") {
                            Start-Process "explorer.exe" -ArgumentList ("shell:AppsFolder\" + $resolvedApp.Target) | Out-Null
                            $launched = $true; $method = "startapp:" + $resolvedApp.Name
                        } else {
                            Start-Process -FilePath $resolvedApp.Target | Out-Null
                            $launched = $true; $method = $resolvedApp.Source + ":" + $resolvedApp.Name
                        }
                    }
                }
                if (-not $launched) {
                    $resp = @{ ok = $false; error = "App not found in safe launcher: $alias" }
                } else {
                    $monNum = if ($null -ne $req.monitor) { [int]$req.monitor } else { 0 }
                    $winAct = if ($null -ne $req.window_action) { ([string]$req.window_action).Trim().ToLowerInvariant() } else { "" }
                    $shouldWait = ($req.wait_window -ne $false)
                    $foundWin = $null
                    $actionApplied = $false

                    if ($shouldWait) {
                        $maxWait = if ($null -ne $req.wait_timeout_ms) { [Math]::Max(1000, [Math]::Min(15000, [int]$req.wait_timeout_ms)) } elseif ($method.StartsWith("startapp:")) { 12000 } else { 9000 }
                        $sw = [System.Diagnostics.Stopwatch]::StartNew()
                        while ($sw.ElapsedMilliseconds -lt $maxWait) {
                            $foundWin = Find-LaunchedAppWindow -Alias $alias -ExtraNeedles $extraWinNeedles
                            if ($null -ne $foundWin) { break }
                            Start-Sleep -Milliseconds 200
                        }
                        if ($null -ne $foundWin) {
                            $h = [IntPtr]::new([long]$foundWin.hwnd)
                            $effectiveAct = if (-not [string]::IsNullOrEmpty($winAct)) { $winAct } elseif ($monNum -gt 0) { "move_monitor_$monNum" } elseif ($req.focus -ne $false) { "focus" } else { "" }
                            if (-not [string]::IsNullOrEmpty($effectiveAct)) {
                                $actionApplied = Invoke-WindowAction -Hwnd $h -TargetObj $foundWin -Action $effectiveAct -Monitor $monNum
                                if ($req.focus -ne $false) {
                                    [Win32FastDesktop]::FocusWindow($h) | Out-Null
                                }
                            }
                            $refreshedWin = Find-LaunchedAppWindow -Alias $alias -ExtraNeedles $extraWinNeedles
                            if ($null -ne $refreshedWin) { $foundWin = $refreshedWin }
                        }
                    }

                    $resp = @{
                        ok = $true
                        data = @{
                            alias = $alias
                            method = $method
                            window_found = ($null -ne $foundWin)
                            window = $foundWin
                            monitor = $monNum
                            window_action = $winAct
                            action_applied = $actionApplied
                        }
                    }
                }
            }
            "manage_edge_tabs" {
                $target = Resolve-TargetWindow -Req $req
                if ($null -eq $target) {
                    $resp = @{ ok = $false; error = "No matching Microsoft Edge window found" }
                } else {
                    $h = [IntPtr]::new([long]$target.hwnd)
                    $act = ([string]$req.action).Trim().ToLowerInvariant()
                    $keepTitle = if ($null -ne $req.keep_title) { ([string]$req.keep_title).Trim().ToLowerInvariant() } else { "" }
                    $matchTitle = if ($null -ne $req.match_title) { ([string]$req.match_title).Trim().ToLowerInvariant() } else { "" }

                    $wasMinimized = [bool]$target.minimized
                    [Win32FastDesktop]::FocusWindow($h) | Out-Null
                    Start-Sleep -Milliseconds $(if ($wasMinimized) { 180 } else { 90 })
                    $tabs = @([UiaFastDesktop]::ListEdgeTabs($h))
                    if ($tabs.Count -eq 0) {
                        Start-Sleep -Milliseconds 160
                        $tabs = @([UiaFastDesktop]::ListEdgeTabs($h))
                    }

                    if ($act -eq "list") {
                        $resp = @{
                            ok = $true
                            data = @{
                                count = $tabs.Count
                                tabs = @($tabs)
                                target = $target
                            }
                        }
                    } elseif ($act -eq "switch") {
                        $pick = $tabs | Where-Object { $matchTitle -eq "" -or $_.name.ToLowerInvariant().Contains($matchTitle) } | Select-Object -First 1
                        if ($null -eq $pick) {
                            $resp = @{ ok = $false; error = "No tab matched '$matchTitle'" }
                        } else {
                            $selOk = [UiaFastDesktop]::SelectEdgeTab($h, $pick.runtime_id)
                            if (-not $selOk) {
                                $safeX = $pick.x + [Math]::Max(8, [Math]::Min(28, [int]($pick.width / 4)))
                                [Win32FastDesktop]::ClickWindowPoint($h, $safeX, $pick.center_y, "left", 1, $true) | Out-Null
                            }
                            $resp = @{ ok = $true; data = @{ switched_to = $pick.name; total_tabs = $tabs.Count } }
                        }
                    } elseif ($act -eq "close_others") {
                        $keepTab = $null
                        if (-not [string]::IsNullOrEmpty($keepTitle)) {
                            $keepTab = $tabs | Where-Object { $_.name.ToLowerInvariant().Contains($keepTitle) -and $_.is_selected } | Select-Object -First 1
                            if ($null -eq $keepTab) {
                                $keepTab = $tabs | Where-Object { $_.name.ToLowerInvariant().Contains($keepTitle) } | Select-Object -First 1
                            }
                        } else {
                            $keepTab = $tabs | Where-Object { $_.is_selected } | Select-Object -First 1
                        }

                        if ($null -eq $keepTab) {
                            $resp = @{ ok = $false; error = "Could not identify the tab to keep; aborted safely without closing tabs." }
                        } else {
                            $closedList = New-Object System.Collections.Generic.List[string]
                            for ($pass = 0; $pass -lt 25; $pass++) {
                                $curTabs = @([UiaFastDesktop]::ListEdgeTabs($h))
                                if ($curTabs.Count -le 1) { break }
                                $victim = $curTabs | Where-Object { $_.runtime_id -ne $keepTab.runtime_id } | Select-Object -First 1
                                if ($null -eq $victim) { break }
                                $selOk = [UiaFastDesktop]::SelectEdgeTab($h, $victim.runtime_id)
                                if (-not $selOk) {
                                    $safeX = $victim.x + [Math]::Max(8, [Math]::Min(28, [int]($victim.width / 4)))
                                    [Win32FastDesktop]::ClickWindowPoint($h, $safeX, $victim.center_y, "left", 1, $true) | Out-Null
                                }
                                Start-Sleep -Milliseconds 65
                                if ([Win32FastDesktop]::GetForegroundWindow() -ne $h) {
                                    [Win32FastDesktop]::FocusWindow($h) | Out-Null
                                    Start-Sleep -Milliseconds 60
                                }
                                [Win32FastDesktop]::SendVirtualKeyCombo([uint16[]]@(0x11), [bool[]]@($false), [uint16]0x57, $false) | Out-Null
                                $closedList.Add($victim.name)
                                Start-Sleep -Milliseconds 95
                            }
                            [UiaFastDesktop]::SelectEdgeTab($h, $keepTab.runtime_id) | Out-Null
                            $remTabs = @([UiaFastDesktop]::ListEdgeTabs($h))
                            $resp = @{
                                ok = $true
                                data = @{
                                    kept_tab = $keepTab.name
                                    closed_count = $closedList.Count
                                    closed_tabs = @($closedList.ToArray())
                                    remaining_count = $remTabs.Count
                                }
                            }
                        }
                    } elseif ($act -eq "close_matching") {
                        $closedList = New-Object System.Collections.Generic.List[string]
                        if ([string]::IsNullOrEmpty($matchTitle)) {
                            $resp = @{ ok = $false; error = "Provide match_title for action='close_matching'" }
                        } else {
                            for ($pass = 0; $pass -lt 20; $pass++) {
                                $curTabs = @([UiaFastDesktop]::ListEdgeTabs($h))
                                if ($curTabs.Count -le 1) { break }
                                $victim = $curTabs | Where-Object { $_.name.ToLowerInvariant().Contains($matchTitle) } | Select-Object -First 1
                                if ($null -eq $victim) { break }
                                $selOk = [UiaFastDesktop]::SelectEdgeTab($h, $victim.runtime_id)
                                if (-not $selOk) {
                                    $safeX = $victim.x + [Math]::Max(8, [Math]::Min(28, [int]($victim.width / 4)))
                                    [Win32FastDesktop]::ClickWindowPoint($h, $safeX, $victim.center_y, "left", 1, $true) | Out-Null
                                }
                                Start-Sleep -Milliseconds 65
                                [Win32FastDesktop]::SendVirtualKeyCombo([uint16[]]@(0x11), [bool[]]@($false), [uint16]0x57, $false) | Out-Null
                                $closedList.Add($victim.name)
                                Start-Sleep -Milliseconds 95
                            }
                            $remTabs = @([UiaFastDesktop]::ListEdgeTabs($h))
                            $resp = @{
                                ok = $true
                                data = @{
                                    closed_count = $closedList.Count
                                    closed_tabs = @($closedList.ToArray())
                                    remaining_count = $remTabs.Count
                                }
                            }
                        }
                    } elseif ($act -eq "close_latest_matching") {
                        $curTabs = @([UiaFastDesktop]::ListEdgeTabs($h))
                        if ($curTabs.Count -le 1) {
                            $resp = @{
                                ok = $true
                                data = @{
                                    closed_count = 0
                                    only_one_tab = $true
                                    remaining_count = $curTabs.Count
                                }
                            }
                        } else {
                            $victim = $null
                            if (-not [string]::IsNullOrEmpty($matchTitle)) {
                                $victim = $curTabs | Where-Object { $_.name.ToLowerInvariant().Contains($matchTitle) } | Select-Object -Last 1
                            } else {
                                $victim = $curTabs | Where-Object { $_.is_selected } | Select-Object -First 1
                                if ($null -eq $victim) { $victim = $curTabs | Select-Object -Last 1 }
                            }
                            if ($null -eq $victim) {
                                $resp = @{
                                    ok = $true
                                    data = @{
                                        closed_count = 0
                                        remaining_count = $curTabs.Count
                                    }
                                }
                            } else {
                                $selOk = [UiaFastDesktop]::SelectEdgeTab($h, $victim.runtime_id)
                                if (-not $selOk) {
                                    $safeX = $victim.x + [Math]::Max(8, [Math]::Min(28, [int]($victim.width / 4)))
                                    [Win32FastDesktop]::ClickWindowPoint($h, $safeX, $victim.center_y, "left", 1, $true) | Out-Null
                                }
                                Start-Sleep -Milliseconds 65
                                if ([Win32FastDesktop]::GetForegroundWindow() -ne $h) {
                                    [Win32FastDesktop]::FocusWindow($h) | Out-Null
                                    Start-Sleep -Milliseconds 60
                                }
                                [Win32FastDesktop]::SendVirtualKeyCombo([uint16[]]@(0x11), [bool[]]@($false), [uint16]0x57, $false) | Out-Null
                                Start-Sleep -Milliseconds 95
                                $remTabs = @([UiaFastDesktop]::ListEdgeTabs($h))
                                $resp = @{
                                    ok = $true
                                    data = @{
                                        closed_count = 1
                                        closed_tabs = @($victim.name)
                                        remaining_count = $remTabs.Count
                                    }
                                }
                            }
                        }
                    } else {
                        $resp = @{ ok = $false; error = "Unsupported manage_edge_tabs action: $act" }
                    }
                }
            }
            "set_brightness" {
                $curObjs = @(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction SilentlyContinue)
                $methObjs = @(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction SilentlyContinue)
                if ($curObjs.Count -eq 0 -or $methObjs.Count -eq 0) {
                    $resp = @{ ok = $false; error = "Monitor does not support WMI brightness control on this device" }
                } else {
                    $curLevel = [int]$curObjs[0].CurrentBrightness
                    $targetLevel = if ($null -ne $req.level) {
                        [int]$req.level
                    } elseif ($null -ne $req.delta) {
                        $curLevel + [int]$req.delta
                    } else {
                        $curLevel
                    }
                    $targetLevel = [Math]::Max(5, [Math]::Min(100, $targetLevel))
                    Invoke-CimMethod -InputObject $methObjs[0] -MethodName WmiSetBrightness -Arguments @{ Timeout = [uint32]1; Brightness = [byte]$targetLevel } | Out-Null
                    $resp = @{
                        ok = $true
                        data = @{
                            previous_brightness = $curLevel
                            brightness = $targetLevel
                        }
                    }
                }
            }
            "close_app" {
                $alias = ([string]$req.alias).ToLowerInvariant().Trim() -replace '\.exe$', ''
                $graceMs = if ($null -ne $req.grace_ms) { [Math]::Max(200, [Math]::Min(3000, [int]$req.grace_ms)) } else { 700 }
                $forceQuit = ($req.force -ne $false)

                $blockedProcs = @(
                    "taskmgr", "regedit", "mmc", "sechealthui", "bitwarden", "1password", "keepass", "keepassxc",
                    "antigravity", "consent", "cmd", "powershell", "pwsh", "windowsterminal", "wt", "msconfig",
                    "control", "explorer", "shellexperiencehost", "searchhost", "startmenuexperiencehost",
                    "applicationframehost", "system", "idle", "svchost", "csrss", "wininit", "winlogon",
                    "lsass", "services", "dwm", "smss", "runtimebroker", "conhost", "node", "code",
                    "cursor", "claude", "language_server", "language_server_windows_x64"
                )

                $procTargets = switch ($alias) {
                    "edge" { @("msedge") }
                    "msedge" { @("msedge") }
                    "discord" { @("discord") }
                    "steam" { @("steam", "steamwebhelper") }
                    "zalo" { @("zalo") }
                    "spotify" { @("spotify") }
                    "telegram" { @("telegram") }
                    "teams" { @("ms-teams", "teams") }
                    "viber" { @("viber") }
                    "calc" { @("calculatorapp", "calc") }
                    "calculator" { @("calculatorapp", "calc") }
                    "notepad" { @("notepad") }
                    "word" { @("winword") }
                    "winword" { @("winword") }
                    "excel" { @("excel") }
                    "powerpoint" { @("powerpnt") }
                    "powerpnt" { @("powerpnt") }
                    "chrome" { @("chrome") }
                    "google chrome" { @("chrome") }
                    default { @($alias) }
                }

                $getMatchingProcs = {
                    $allP = Get-Process -ErrorAction SilentlyContinue
                    $exactHits = @($allP | Where-Object {
                        $pn = $_.ProcessName.ToLowerInvariant()
                        ($_.Id -ne $PID) -and ($blockedProcs -notcontains $pn) -and ($procTargets -contains $pn)
                    })
                    return ,$exactHits
                }

                $initialProcs = & $getMatchingProcs
                $winHits = @([Win32FastDesktop]::ListWindows() | Where-Object {
                    $wp = $_.process.ToLowerInvariant() -replace '\.exe$', ''
                    ($blockedProcs -notcontains $wp) -and ($procTargets -contains $wp)
                })

                $pwaWindowMode = $false
                $isBrowserAlias = $alias -in @("edge", "msedge", "microsoft edge", "chrome", "google chrome")
                if ($initialProcs.Count -eq 0 -and $winHits.Count -eq 0 -and -not $isBrowserAlias -and $alias.Length -ge 3) {
                    $compactAlias = Normalize-AppCompact -Text $alias
                    $winHits = @([Win32FastDesktop]::ListWindows() | Where-Object {
                        $wp = $_.process.ToLowerInvariant() -replace '\.exe$', ''
                        $wt = $_.title.ToLowerInvariant()
                        $isEdgeTab = ($wp -eq "msedge") -and (($wt.Contains("microsoft") -and $wt.Contains("edge")) -or $wt.Contains("new tab") -or $wt.Contains("tab mới") -or $wt.Contains("inprivate"))
                        $isChromeTab = ($wp -eq "chrome") -and ($wt.Contains("google chrome"))
                        if ($blockedProcs -contains $wp -or $isEdgeTab -or $isChromeTab) { return $false }
                        $wt.Contains($alias) -or ($compactAlias.Length -ge 3 -and (Normalize-AppCompact -Text $_.title).Contains($compactAlias))
                    })
                    if ($winHits.Count -gt 0) {
                        $pwaWindowMode = $true
                    }
                }

                if ($initialProcs.Count -eq 0 -and $winHits.Count -eq 0) {
                    $resp = @{
                        ok = $true
                        data = @{
                            alias = $alias
                            already_closed = $true
                            windows_closed = 0
                            graceful_exited = $true
                            force_allowed = $forceQuit
                            force_applied = $false
                            safe_skipped_force = $false
                            force_terminated = 0
                            remaining_count = 0
                            pwa_window_mode = $false
                        }
                    }
                } else {
                    $windowsClosed = 0
                    $targetHwnds = @($winHits | ForEach-Object { [string]$_.hwnd })
                    foreach ($w in $winHits) {
                        $wh = [IntPtr]::new([long]$w.hwnd)
                        [Win32FastDesktop]::PostMessage($wh, [Win32FastDesktop]::WM_CLOSE, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
                        $windowsClosed++
                    }

                    if ($pwaWindowMode) {
                        $sw = [System.Diagnostics.Stopwatch]::StartNew()
                        $remWins = @($winHits)
                        while ($sw.ElapsedMilliseconds -lt $graceMs) {
                            $remWins = @([Win32FastDesktop]::ListWindows() | Where-Object { $targetHwnds -contains ([string]$_.hwnd) })
                            if ($remWins.Count -eq 0) { break }
                            Start-Sleep -Milliseconds 100
                        }
                        $remWins = @([Win32FastDesktop]::ListWindows() | Where-Object { $targetHwnds -contains ([string]$_.hwnd) })
                        $gracefulExited = ($remWins.Count -eq 0)
                        $resp = @{
                            ok = $true
                            data = @{
                                alias = $alias
                                already_closed = $false
                                windows_closed = $windowsClosed
                                graceful_exited = $gracefulExited
                                force_allowed = $false
                                force_applied = $false
                                safe_skipped_force = $false
                                force_terminated = 0
                                remaining_count = $remWins.Count
                                pwa_window_mode = $true
                            }
                        }
                    } else {
                        $sw = [System.Diagnostics.Stopwatch]::StartNew()
                        while ($sw.ElapsedMilliseconds -lt $graceMs) {
                            $rem = & $getMatchingProcs
                            if ($rem.Count -eq 0) { break }
                            Start-Sleep -Milliseconds 100
                        }

                        $afterGrace = & $getMatchingProcs
                        $gracefulExited = ($afterGrace.Count -eq 0)
                        $forceTerminated = 0
                        $safeSkippedForce = $false

                        if (-not $gracefulExited) {
                            if ($forceQuit) {
                                foreach ($p in $afterGrace) {
                                    try {
                                        Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
                                        $forceTerminated++
                                    } catch {}
                                }
                                Start-Sleep -Milliseconds 120
                            } else {
                                $safeSkippedForce = $true
                            }
                        }

                        $finalRem = & $getMatchingProcs
                        $resp = @{
                            ok = $true
                            data = @{
                                alias = $alias
                                already_closed = $false
                                windows_closed = $windowsClosed
                                graceful_exited = $gracefulExited
                                force_allowed = $forceQuit
                                force_applied = ($forceQuit -and $forceTerminated -gt 0)
                                safe_skipped_force = $safeSkippedForce
                                force_terminated = $forceTerminated
                                remaining_count = $finalRem.Count
                                pwa_window_mode = $false
                            }
                        }
                    }
                }
            }
            default {
                $resp = @{ ok = $false; error = "Unknown worker command: $($req.cmd)" }
            }
        }
    } catch {
        $resp = @{ ok = $false; error = $_.Exception.Message }
    }

    [Console]::Out.WriteLine(($resp | ConvertTo-Json -Compress -Depth 6))
    [Console]::Out.Flush()
}
