// Development-only verification of this plugin's own desktop window.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Automation;

namespace QuotaMini {
  public static class DesktopProbe {
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindow(string cls, string title);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hwnd, int index);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
    [StructLayout(LayoutKind.Sequential)] struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] struct Point { public int X, Y; }
    static AutomationElement Element(AutomationElement root, string id) {
      return root.FindFirst(TreeScope.Descendants, new PropertyCondition(AutomationElement.AutomationIdProperty, id));
    }
    public static string Run(string action, string imagePath, double value) {
      var hwnd = FindWindow(null, "额度小窗 · Work / Codex");
      if (hwnd == IntPtr.Zero) throw new InvalidOperationException("Quota desktop window not found");
      var root = AutomationElement.FromHandle(hwnd);
      if (action == "minimize" || action == "restore") {
        ((InvokePattern)Element(root, action == "minimize" ? "QuotaMinimize" : "QuotaCompactRestore").GetCurrentPattern(InvokePattern.Pattern)).Invoke();
        Thread.Sleep(500);
      }
      if (action == "restore-double-click" || action == "wheel" || action == "drag-compact") {
        Rect bounds; GetWindowRect(hwnd, out bounds);
        Point previous; GetCursorPos(out previous);
        try {
          var x = (bounds.Left + bounds.Right) / 2; var y = (bounds.Top + bounds.Bottom) / 2;
          SetCursorPos(x, y); Thread.Sleep(80);
          if (action == "wheel") mouse_event(0x0800, 0, 0, unchecked((uint)(int)value), UIntPtr.Zero);
          else {
            mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero); Thread.Sleep(60);
            if (action == "drag-compact") { SetCursorPos(x + 18, y + 18); Thread.Sleep(80); }
            mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);
            if (action == "restore-double-click") {
              Thread.Sleep(80); mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero);
              Thread.Sleep(60); mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);
            }
          }
          Thread.Sleep(650);
        } finally { SetCursorPos(previous.X, previous.Y); }
      }
      if (action == "settings") ((InvokePattern)Element(root, "QuotaSettings").GetCurrentPattern(InvokePattern.Pattern)).Invoke();
      IntPtr settingsHandle = IntPtr.Zero;
      for (var attempt = 0; attempt < (action == "settings" ? 40 : 1); attempt++) {
        settingsHandle = FindWindow(null, "额度小窗设置");
        if (settingsHandle != IntPtr.Zero) break;
        if (action == "settings") Thread.Sleep(50);
      }
      if (action == "settings" && settingsHandle == IntPtr.Zero) throw new InvalidOperationException("Settings did not open");
      if (action == "size" || action == "transparency" || action == "defaults" || action == "done" || action == "settings-close") {
        if (settingsHandle == IntPtr.Zero) throw new InvalidOperationException("Settings window not found");
        var settingsRoot = AutomationElement.FromHandle(settingsHandle);
        if (action == "size" || action == "transparency") {
          ((RangeValuePattern)Element(settingsRoot, action == "size" ? "QuotaSize" : "QuotaTransparency").GetCurrentPattern(RangeValuePattern.Pattern)).SetValue(value);
        } else ((InvokePattern)Element(settingsRoot, action == "defaults" ? "QuotaDefaults" : action == "settings-close" ? "QuotaSettingsClose" : "QuotaSettingsDone").GetCurrentPattern(InvokePattern.Pattern)).Invoke();
        Thread.Sleep(650); // Wait for layout and the documented debounce save.
      }
      if (action == "refresh") ((InvokePattern)Element(root, "QuotaRefresh").GetCurrentPattern(InvokePattern.Pattern)).Invoke();
      if (action == "close") ((InvokePattern)Element(root, "QuotaClose").GetCurrentPattern(InvokePattern.Pattern)).Invoke();
      if (action == "move") {
        Rect before; GetWindowRect(hwnd, out before);
        if (!SetWindowPos(hwnd, new IntPtr(-1), before.Left - 12, before.Top + 12, 0, 0, 0x11))
          throw new InvalidOperationException("Could not reposition quota window");
      }
      Rect rect; GetWindowRect(hwnd, out rect);
      uint pid; GetWindowThreadProcessId(hwnd, out pid);
      var report = new Dictionary<string, object> {
        { "visible", IsWindowVisible(hwnd) }, { "alwaysOnTop", (GetWindowLong(hwnd, -20) & 8) != 0 },
        { "foregroundIsAnotherWindow", GetForegroundWindow() != hwnd }, { "pid", pid },
        { "windowBounds", new { left = rect.Left, top = rect.Top, width = rect.Right - rect.Left, height = rect.Bottom - rect.Top } }
      };
      if (action != "close") {
        var compactValue = Element(root, "QuotaCompactValue");
        var compact = compactValue != null && !compactValue.Current.IsOffscreen;
        report["compact"] = compact;
        report["short"] = compact ? compactValue.Current.Name : Element(root, "QuotaShort").Current.Name;
        report["weekly"] = compact ? null : Element(root, "QuotaWeekly").Current.Name;
        report["status"] = compact ? "精简模式（后台刷新）" : Element(root, "QuotaStatus").Current.Name;
        report["lastUpdate"] = compact ? compactValue.Current.HelpText : Element(root, "QuotaStatus").Current.HelpText;
        var shortLabel = Element(root, "QuotaShortLabel");
        report["shortLabel"] = compact || shortLabel == null ? null : shortLabel.Current.Name;
        if (compact) {
          var texts = root.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Text));
          report["visibleTextElements"] = texts.Count;
        }
        report["windowProcessMB"] = Math.Round(Process.GetProcessById((int)pid).WorkingSet64 / 1048576.0, 1);
        report["appearance"] = root.Current.ItemStatus;
        report["hasSettingsButton"] = Element(root, "QuotaSettings") != null;
        settingsHandle = FindWindow(null, "额度小窗设置");
        report["settingsOpen"] = settingsHandle != IntPtr.Zero;
        if (settingsHandle != IntPtr.Zero) {
          var settingsRoot = AutomationElement.FromHandle(settingsHandle);
          report["sizeSetting"] = ((RangeValuePattern)Element(settingsRoot, "QuotaSize").GetCurrentPattern(RangeValuePattern.Pattern)).Current.Value;
          report["transparencySetting"] = ((RangeValuePattern)Element(settingsRoot, "QuotaTransparency").GetCurrentPattern(RangeValuePattern.Pattern)).Current.Value;
          var saveStatus = Element(settingsRoot, "QuotaSettingsStatus");
          if (saveStatus != null) { report["saveStatus"] = saveStatus.Current.Name; report["saveHelp"] = saveStatus.Current.HelpText; }
        }
      }
      if (!String.IsNullOrEmpty(imagePath) && action != "close") {
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(imagePath)));
        Rect capture = rect;
        if (settingsHandle != IntPtr.Zero) GetWindowRect(settingsHandle, out capture);
        using (var bitmap = new Bitmap(capture.Right - capture.Left, capture.Bottom - capture.Top)) {
          using (var graphics = Graphics.FromImage(bitmap)) graphics.CopyFromScreen(capture.Left, capture.Top, 0, 0, bitmap.Size);
          bitmap.Save(imagePath, ImageFormat.Png);
        }
      }
      return new JavaScriptSerializer().Serialize(report);
    }
  }
}
