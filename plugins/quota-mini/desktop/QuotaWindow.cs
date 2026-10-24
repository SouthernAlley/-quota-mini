using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Data;
using System.Windows.Input;
using System.Windows.Markup;
using System.Windows.Media;
using System.Windows.Threading;

namespace QuotaMini {
  public static class QuotaDisplay {
    public static string ShortLabel(double minutes) {
      if (Double.IsNaN(minutes) || Double.IsInfinity(minutes) || minutes <= 0) return "短时";
      return minutes >= 60 ? (minutes / 60).ToString("0.#", CultureInfo.InvariantCulture) + " 小时"
        : minutes.ToString("0.#", CultureInfo.InvariantCulture) + " 分钟";
    }
  }

  public class WindowPreferences {
    public double Scale = 1;
    public double Transparency = 0;
    public bool Compact = false;
    public double CompactScale = 1;
    public double? Left;
    public double? Top;
    public double Opacity { get { return 1 - Transparency / 100; } }
    public static double Bound(double value, double minimum, double maximum, double fallback) {
      return Double.IsNaN(value) || Double.IsInfinity(value) ? fallback : Math.Max(minimum, Math.Min(maximum, value));
    }
    public void SetAppearance(double scale, double transparency) {
      Scale = Bound(scale, 0.75, 1.60, 1);
      Transparency = Bound(transparency, 0, 70, 0);
    }
    public void SetCompactScale(double value) { CompactScale = Bound(value, 0.60, 2.00, 1); }
    public static WindowPreferences Parse(string text) {
      var result = new WindowPreferences();
      try {
        var saved = new JavaScriptSerializer().Deserialize<Dictionary<string, double>>(text);
        if (saved == null) return result;
        double scale, transparency, left, top, compact, compactScale;
        result.SetAppearance(saved.TryGetValue("scale", out scale) ? scale : 1, saved.TryGetValue("transparency", out transparency) ? transparency : 0);
        if (saved.TryGetValue("left", out left) && !Double.IsNaN(left) && !Double.IsInfinity(left)) result.Left = left;
        if (saved.TryGetValue("top", out top) && !Double.IsNaN(top) && !Double.IsInfinity(top)) result.Top = top;
        result.Compact = saved.TryGetValue("compact", out compact) && compact == 1;
        result.SetCompactScale(saved.TryGetValue("compactScale", out compactScale) ? compactScale : result.Scale);
      } catch (Exception) { }
      return result;
    }
    public string Serialize() {
      return new JavaScriptSerializer().Serialize(new { left = Left, top = Top, scale = Scale, transparency = Transparency, compact = Compact ? 1 : 0, compactScale = CompactScale });
    }
  }

  public static class DesktopHost {
    const string MutexName = "Local\\QuotaMini.Desktop.v1";
    const string RaiseName = "Local\\QuotaMini.Raise.v1";
    const string CloseName = "Local\\QuotaMini.Close.v1";
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    public static void Emit(string type) {
      Console.Out.WriteLine(Json.Serialize(new { type = type }));
      Console.Out.Flush();
    }
    public static void Run(string action) {
      if (action == "close") {
        try { using (var signal = EventWaitHandle.OpenExisting(CloseName)) signal.Set(); Emit("closed"); }
        catch (WaitHandleCannotBeOpenedException) { Emit("not-open"); }
        return;
      }
      bool created;
      using (var mutex = new Mutex(true, MutexName, out created)) {
        if (!created) {
          try { using (var signal = EventWaitHandle.OpenExisting(RaiseName)) signal.Set(); }
          catch (WaitHandleCannotBeOpenedException) { }
          Emit("already-open"); return;
        }
        try {
          using (var raise = new EventWaitHandle(false, EventResetMode.AutoReset, RaiseName))
          using (var close = new EventWaitHandle(false, EventResetMode.AutoReset, CloseName)) {
            var window = new QuotaWindow(raise, close);
            var app = new Application { ShutdownMode = ShutdownMode.OnMainWindowClose };
            app.Run(window);
          }
        } finally { mutex.ReleaseMutex(); }
      }
    }
  }

  public class QuotaWindow : Window {
    readonly JavaScriptSerializer json = new JavaScriptSerializer();
    readonly ConcurrentQueue<string> incoming = new ConcurrentQueue<string>();
    readonly TextBlock shortValue, weekValue, shortReset, weekReset, status, shortLabel;
    readonly ProgressBar shortBar, weekBar;
    readonly Button refresh;
    readonly FrameworkElement fullCard, compactCard;
    readonly TextBlock compactValue;
    bool hasShortQuota;
    readonly DispatcherTimer timer;
    readonly EventWaitHandle raiseSignal, closeSignal;
    readonly string positionPath;
    readonly WindowPreferences preferences;
    readonly DispatcherTimer saveTimer;
    Window settingsWindow;
    TextBlock settingsStatus;
    volatile bool inputEnded;
    string lastUpdate;
    string snapshotStatus;
    string message;
    int ticks;
    static readonly Brush Ink = new SolidColorBrush(Color.FromRgb(237, 243, 239));
    static readonly Brush Muted = new SolidColorBrush(Color.FromRgb(151, 167, 158));
    static readonly Brush Accent = new SolidColorBrush(Color.FromRgb(124, 211, 176));
    static readonly Brush Warning = new SolidColorBrush(Color.FromRgb(234, 189, 112));
    static readonly Brush Surface = new SolidColorBrush(Color.FromRgb(36, 42, 38));
    static readonly Brush Outline = new SolidColorBrush(Color.FromRgb(67, 79, 71));
    static readonly ControlTemplate DarkButtonTemplate = (ControlTemplate)XamlReader.Parse(@"
      <ControlTemplate xmlns='http://schemas.microsoft.com/winfx/2006/xaml/presentation'
                       xmlns:x='http://schemas.microsoft.com/winfx/2006/xaml' TargetType='{x:Type Button}'>
        <Border x:Name='Surface' Background='{TemplateBinding Background}' BorderBrush='{TemplateBinding BorderBrush}'
                BorderThickness='{TemplateBinding BorderThickness}' CornerRadius='7' Padding='{TemplateBinding Padding}'>
          <ContentPresenter HorizontalAlignment='Center' VerticalAlignment='Center' RecognizesAccessKey='True'/>
        </Border>
        <ControlTemplate.Triggers>
          <Trigger Property='IsMouseOver' Value='True'>
            <Setter TargetName='Surface' Property='Background' Value='#35463C'/>
            <Setter Property='Foreground' Value='#EDF3EF'/>
          </Trigger>
          <Trigger Property='IsPressed' Value='True'><Setter TargetName='Surface' Property='Background' Value='#40584A'/></Trigger>
          <Trigger Property='IsKeyboardFocused' Value='True'><Setter TargetName='Surface' Property='BorderBrush' Value='#7CD3B0'/></Trigger>
          <Trigger Property='IsEnabled' Value='False'><Setter TargetName='Surface' Property='Opacity' Value='0.35'/></Trigger>
        </ControlTemplate.Triggers>
      </ControlTemplate>");
    static readonly ControlTemplate DarkSliderTemplate = (ControlTemplate)XamlReader.Parse(@"
      <ControlTemplate xmlns='http://schemas.microsoft.com/winfx/2006/xaml/presentation'
                       xmlns:x='http://schemas.microsoft.com/winfx/2006/xaml' TargetType='{x:Type Slider}'>
        <Grid Height='26' Background='Transparent'>
          <Border Height='4' Background='#39463E' CornerRadius='2' VerticalAlignment='Center'/>
          <Track x:Name='PART_Track' Height='18' VerticalAlignment='Center'
                 Minimum='{TemplateBinding Minimum}' Maximum='{TemplateBinding Maximum}'
                 IsDirectionReversed='{TemplateBinding IsDirectionReversed}'
                 Value='{Binding Value, RelativeSource={RelativeSource TemplatedParent}, Mode=TwoWay}'>
            <Track.DecreaseRepeatButton>
              <RepeatButton Command='{x:Static Slider.DecreaseLarge}' Focusable='False' IsTabStop='False'>
                <RepeatButton.Template><ControlTemplate TargetType='{x:Type RepeatButton}'>
                  <Grid Background='Transparent'><Border Height='4' Background='#7CD3B0' CornerRadius='2' VerticalAlignment='Center'/></Grid>
                </ControlTemplate></RepeatButton.Template>
              </RepeatButton>
            </Track.DecreaseRepeatButton>
            <Track.Thumb>
              <Thumb Width='14' Height='14' Cursor='Hand'>
                <Thumb.Template><ControlTemplate TargetType='{x:Type Thumb}'>
                  <Border x:Name='Knob' Background='#7CD3B0' CornerRadius='7' BorderBrush='#A7E8CB' BorderThickness='1'/>
                  <ControlTemplate.Triggers>
                    <Trigger Property='IsMouseOver' Value='True'><Setter TargetName='Knob' Property='Background' Value='#A7E8CB'/></Trigger>
                    <Trigger Property='IsDragging' Value='True'><Setter TargetName='Knob' Property='Background' Value='#B5F1D7'/></Trigger>
                  </ControlTemplate.Triggers>
                </ControlTemplate></Thumb.Template>
              </Thumb>
            </Track.Thumb>
            <Track.IncreaseRepeatButton>
              <RepeatButton Command='{x:Static Slider.IncreaseLarge}' Focusable='False' IsTabStop='False'>
                <RepeatButton.Template><ControlTemplate TargetType='{x:Type RepeatButton}'><Border Background='Transparent'/></ControlTemplate></RepeatButton.Template>
              </RepeatButton>
            </Track.IncreaseRepeatButton>
          </Track>
          <Border x:Name='FocusRing' BorderBrush='Transparent' BorderThickness='1' CornerRadius='6' IsHitTestVisible='False'/>
        </Grid>
        <ControlTemplate.Triggers>
          <Trigger Property='IsKeyboardFocused' Value='True'><Setter TargetName='FocusRing' Property='BorderBrush' Value='#527662'/></Trigger>
        </ControlTemplate.Triggers>
      </ControlTemplate>");

    public QuotaWindow(EventWaitHandle raise, EventWaitHandle close) {
      raiseSignal = raise; closeSignal = close;
      Title = "额度小窗 · Work / Codex";
      Width = 252; Height = 196; ResizeMode = ResizeMode.NoResize;
      WindowStyle = WindowStyle.None; AllowsTransparency = true;
      Background = Brushes.Transparent; Topmost = true; ShowInTaskbar = false;
      ShowActivated = false; UseLayoutRounding = true;
      FontFamily = new FontFamily("Segoe UI, Microsoft YaHei"); FontSize = 12;
      positionPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "QuotaMini", "window.json");
      try { preferences = WindowPreferences.Parse(File.ReadAllText(positionPath)); }
      catch (Exception) { preferences = new WindowPreferences(); }
      ApplyAppearance();
      RestorePosition();
      var border = new Border { Width = 252, Height = 196, CornerRadius = new CornerRadius(14), BorderThickness = new Thickness(1),
        BorderBrush = new SolidColorBrush(Color.FromRgb(67, 79, 71)),
        Background = new SolidColorBrush(Color.FromRgb(36, 42, 38)), Padding = new Thickness(15, 10, 15, 11) };
      var root = new StackPanel(); border.Child = root;
      fullCard = new Viewbox { Stretch = Stretch.Uniform, StretchDirection = StretchDirection.Both, Child = border };
      compactValue = Text("—", 16, Accent); compactValue.FontWeight = FontWeights.SemiBold;
      AutomationProperties.SetAutomationId(compactValue, "QuotaCompactValue");
      var compactButton = new Button { Width = 44, Height = 44, Background = Surface, Foreground = Accent,
        BorderBrush = Outline, BorderThickness = new Thickness(1), Padding = new Thickness(5),
        Template = DarkButtonTemplate, FocusVisualStyle = null,
        Content = new Viewbox { Stretch = Stretch.Uniform, StretchDirection = StretchDirection.DownOnly, Child = compactValue } };
      AutomationProperties.SetAutomationId(compactButton, "QuotaCompactRestore");
      AutomationProperties.SetName(compactButton, "恢复完整额度窗口");
      // Pointer clicks are reserved for dragging/double-clicking; invoke/keyboard remains accessible.
      compactButton.Click += delegate { SetCompact(false); };
      bool pointerDown = false, pointerDragging = false;
      Point pointerStart = new Point(); double pointerLeft = 0, pointerTop = 0;
      compactButton.PreviewMouseLeftButtonDown += delegate(object sender, MouseButtonEventArgs e) {
        e.Handled = true;
        if (e.ClickCount >= 2) { pointerDown = false; compactButton.ReleaseMouseCapture(); SetCompact(false); return; }
        pointerDown = true; pointerDragging = false;
        pointerStart = PointToScreen(e.GetPosition(this)); pointerLeft = Left; pointerTop = Top;
        compactButton.CaptureMouse();
      };
      compactButton.PreviewMouseMove += delegate(object sender, MouseEventArgs e) {
        if (!pointerDown || e.LeftButton != MouseButtonState.Pressed) return;
        var delta = PointToScreen(e.GetPosition(this)) - pointerStart;
        var source = PresentationSource.FromVisual(this);
        if (source != null && source.CompositionTarget != null) delta = source.CompositionTarget.TransformFromDevice.Transform(delta);
        pointerDragging = pointerDragging || Math.Abs(delta.X) >= SystemParameters.MinimumHorizontalDragDistance || Math.Abs(delta.Y) >= SystemParameters.MinimumVerticalDragDistance;
        if (pointerDragging) { Left = pointerLeft + delta.X; Top = pointerTop + delta.Y; }
        e.Handled = true;
      };
      compactButton.PreviewMouseLeftButtonUp += delegate(object sender, MouseButtonEventArgs e) {
        var moved = pointerDragging; pointerDown = false; pointerDragging = false;
        compactButton.ReleaseMouseCapture(); e.Handled = true;
        if (moved) SavePosition();
      };
      compactButton.LostMouseCapture += delegate { pointerDown = false; };
      compactButton.PreviewMouseWheel += delegate(object sender, MouseWheelEventArgs e) {
        preferences.SetCompactScale(preferences.CompactScale + e.Delta / 120.0 * 0.10);
        ApplyAppearance(); saveTimer.Stop(); saveTimer.Start(); e.Handled = true;
      };
      compactCard = new Viewbox { Stretch = Stretch.Uniform, StretchDirection = StretchDirection.Both, Child = compactButton };
      ApplyAppearance();
      var header = new DockPanel { LastChildFill = true, Margin = new Thickness(0, 0, 0, 8) };
      var controls = new StackPanel { Orientation = Orientation.Horizontal };
      refresh = IconButton("refresh", "刷新额度", "QuotaRefresh");
      refresh.Click += delegate { refresh.IsEnabled = false; status.Text = "正在刷新…"; DesktopHost.Emit("refresh"); };
      var settings = IconButton("settings", "窗口设置", "QuotaSettings"); settings.Click += delegate { OpenSettings(); };
      var minimize = IconButton("minimize", "缩成小方块", "QuotaMinimize"); minimize.Click += delegate { SetCompact(true); };
      var exit = IconButton("close", "关闭悬浮窗", "QuotaClose"); exit.Click += delegate { Close(); };
      controls.Children.Add(minimize); controls.Children.Add(settings); controls.Children.Add(refresh); controls.Children.Add(exit); DockPanel.SetDock(controls, Dock.Right);
      header.Children.Add(controls);
      var title = Text("●  剩余额度", 11, Accent); title.VerticalAlignment = VerticalAlignment.Center;
      header.Children.Add(title); root.Children.Add(header);
      shortValue = Text("—", 20, Ink); weekValue = Text("—", 20, Ink);
      shortReset = Text("正在读取…", 10, Muted); weekReset = Text("正在读取…", 10, Muted);
      shortBar = Bar(); weekBar = Bar();
      shortLabel = Text("短时", 11, Ink);
      AutomationProperties.SetAutomationId(shortLabel, "QuotaShortLabel");
      root.Children.Add(Row(shortLabel, shortValue, shortBar, shortReset));
      var second = Row("本周", weekValue, weekBar, weekReset); second.Margin = new Thickness(0, 9, 0, 0); root.Children.Add(second);
      status = Text("连接中 · Work / Codex", 9, Muted); status.Margin = new Thickness(0, 9, 0, 0);
      status.TextTrimming = TextTrimming.CharacterEllipsis; root.Children.Add(status);
      AutomationProperties.SetAutomationId(shortValue, "QuotaShort");
      AutomationProperties.SetAutomationId(weekValue, "QuotaWeekly");
      AutomationProperties.SetAutomationId(status, "QuotaStatus");
      border.MouseLeftButtonDown += delegate(object sender, MouseButtonEventArgs e) {
        if (e.OriginalSource is TextBlock || e.OriginalSource is Border || e.OriginalSource is ProgressBar) {
          try { DragMove(); } catch (InvalidOperationException) { }
        }
      };
      Loaded += delegate { DesktopHost.Emit("ready"); };
      timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(200) };
      timer.Tick += Tick; timer.Start();
      saveTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(450) };
      saveTimer.Tick += delegate { saveTimer.Stop(); SavePosition(); };
      Closed += delegate { timer.Stop(); saveTimer.Stop(); SavePosition(); DesktopHost.Emit("window-closed"); };
      Task.Run(() => {
        try { string line; while ((line = Console.In.ReadLine()) != null) { if (line.Length <= 8192) incoming.Enqueue(line); } }
        catch (IOException) { }
        finally { inputEnded = true; }
      });
    }
    static TextBlock Text(string value, double size, Brush color) {
      return new TextBlock { Text = value, FontSize = size, Foreground = color };
    }
    static Button IconButton(string icon, string tooltip, string id) {
      var data = icon == "settings" ? "M3,7 H8 M12,7 H21 M10,4 V10 M3,17 H14 M18,17 H21 M16,14 V20"
        : icon == "refresh" ? "M20,10 A8,8 0 1 0 20,15 M20,4 V10 H14" : icon == "minimize" ? "M5,17 H19" : "M6,6 L18,18 M18,6 L6,18";
      var path = new System.Windows.Shapes.Path { Data = Geometry.Parse(data), StrokeThickness = 1.6,
        StrokeStartLineCap = PenLineCap.Round, StrokeEndLineCap = PenLineCap.Round, StrokeLineJoin = PenLineJoin.Round };
      path.SetBinding(System.Windows.Shapes.Shape.StrokeProperty, new Binding("Foreground") {
        RelativeSource = new RelativeSource(RelativeSourceMode.FindAncestor, typeof(Button), 1) });
      var canvas = new Canvas { Width = 24, Height = 24 }; canvas.Children.Add(path);
      var button = new Button { Content = new Viewbox { Width = 15, Height = 15, Child = canvas }, ToolTip = tooltip, Width = 24, Height = 24,
        Foreground = Muted, Background = Brushes.Transparent, BorderThickness = new Thickness(0), Cursor = Cursors.Hand,
        Padding = new Thickness(0), Focusable = false, Template = DarkButtonTemplate, FocusVisualStyle = null };
      AutomationProperties.SetAutomationId(button, id);
      AutomationProperties.SetName(button, tooltip);
      return button;
    }
    static Button ActionButton(string text, string id, bool primary) {
      var button = new Button { Content = text, MinWidth = 74, Height = 32,
        Padding = new Thickness(13, 0, 13, 0), FontSize = 11, Cursor = Cursors.Hand,
        Foreground = primary ? Accent : Muted, Background = primary ? new SolidColorBrush(Color.FromRgb(47, 66, 55)) : Brushes.Transparent,
        BorderBrush = primary ? new SolidColorBrush(Color.FromRgb(74, 106, 86)) : Outline,
        BorderThickness = new Thickness(1), Template = DarkButtonTemplate, FocusVisualStyle = null };
      AutomationProperties.SetAutomationId(button, id);
      return button;
    }
    static ProgressBar Bar() {
      return new ProgressBar { Minimum = 0, Maximum = 100, Height = 3, Foreground = Accent,
        Background = new SolidColorBrush(Color.FromRgb(60, 75, 65)), BorderThickness = new Thickness(0),
        Margin = new Thickness(0, 3, 0, 4) };
    }
    static StackPanel Row(string label, TextBlock value, ProgressBar bar, TextBlock reset) {
      return Row(Text(label, 11, Ink), value, bar, reset);
    }
    static StackPanel Row(TextBlock name, TextBlock value, ProgressBar bar, TextBlock reset) {
      var panel = new StackPanel(); var line = new DockPanel { LastChildFill = true };
      DockPanel.SetDock(value, Dock.Right); line.Children.Add(value);
      name.VerticalAlignment = VerticalAlignment.Center; line.Children.Add(name);
      panel.Children.Add(line); panel.Children.Add(bar); panel.Children.Add(reset); return panel;
    }
    void ApplyAppearance() {
      var scale = preferences.Compact ? preferences.CompactScale : preferences.Scale;
      Width = (preferences.Compact ? 44 : 252) * scale; Height = (preferences.Compact ? 44 : 196) * scale;
      Opacity = preferences.Opacity;
      if (fullCard != null && compactCard != null) Content = preferences.Compact ? compactCard : fullCard;
      AutomationProperties.SetItemStatus(this, "大小 " + (scale * 100).ToString("0") + "%；透明度 " + preferences.Transparency.ToString("0") + "%；" + (preferences.Compact ? "精简模式" : "完整模式"));
      if (IsLoaded) {
        var area = SystemParameters.WorkArea;
        // Keep the controls reachable when enlarging a window near a screen edge.
        Left = Math.Max(area.Left, Math.Min(area.Right - Width, Left));
        Top = Math.Max(area.Top, Math.Min(area.Bottom - Height, Top));
      }
    }
    void SetCompact(bool compact) {
      if (settingsWindow != null) settingsWindow.Close();
      preferences.Compact = compact; ApplyAppearance(); SavePosition();
    }
    static Slider SettingSlider(double minimum, double maximum, double value, double step, string name, string id) {
      var slider = new Slider { Minimum = minimum, Maximum = maximum, Value = value,
        TickFrequency = step, SmallChange = step, LargeChange = step * 2, IsSnapToTickEnabled = true,
        Margin = new Thickness(0, 6, 0, 14), Foreground = Accent, IsMoveToPointEnabled = true,
        Template = DarkSliderTemplate, FocusVisualStyle = null };
      AutomationProperties.SetAutomationId(slider, id); AutomationProperties.SetName(slider, name);
      return slider;
    }
    void OpenSettings() {
      if (settingsWindow != null) { settingsWindow.Activate(); return; }
      var dialog = new Window { Title = "额度小窗设置", Width = 304, SizeToContent = SizeToContent.Height,
        ResizeMode = ResizeMode.NoResize, WindowStyle = WindowStyle.None, AllowsTransparency = true, Owner = this,
        ShowInTaskbar = false, Topmost = true, Background = Brushes.Transparent,
        BorderBrush = Brushes.Transparent, BorderThickness = new Thickness(0), UseLayoutRounding = true, SnapsToDevicePixels = true,
        Foreground = Ink, FontFamily = FontFamily, FontSize = 12, WindowStartupLocation = WindowStartupLocation.Manual };
      settingsWindow = dialog;
      // A separate, fully opaque settings window remains usable even at high transparency.
      var area = SystemParameters.WorkArea;
      dialog.Left = Math.Max(area.Left, Math.Min(area.Right - dialog.Width, Left - dialog.Width - 10));
      dialog.Top = Math.Max(area.Top, Math.Min(area.Bottom - 320, Top));
      var panel = new StackPanel { Margin = new Thickness(18, 12, 18, 18) };
      dialog.Content = new Border { Background = Surface, BorderBrush = Outline, BorderThickness = new Thickness(1),
        CornerRadius = new CornerRadius(14), Child = panel };
      var header = new DockPanel { LastChildFill = true, Background = Brushes.Transparent, Margin = new Thickness(0, 0, 0, 18), Cursor = Cursors.SizeAll };
      var close = IconButton("close", "关闭设置", "QuotaSettingsClose"); close.Click += delegate { dialog.Close(); };
      DockPanel.SetDock(close, Dock.Right); header.Children.Add(close);
      var heading = Text("窗口设置", 12, Ink); heading.VerticalAlignment = VerticalAlignment.Center; header.Children.Add(heading);
      header.MouseLeftButtonDown += delegate(object sender, MouseButtonEventArgs e) {
        DependencyObject current = e.OriginalSource as DependencyObject;
        while (current != null && current != header) { if (current is ButtonBase) return; current = VisualTreeHelper.GetParent(current); }
        try { dialog.DragMove(); } catch (InvalidOperationException) { }
      };
      panel.Children.Add(header);
      var sizeLabel = Text("", 12, Accent); var opacityLabel = Text("", 12, Accent);
      var size = SettingSlider(75, 160, preferences.Scale * 100, 5, "窗口大小", "QuotaSize");
      var transparency = SettingSlider(0, 70, preferences.Transparency, 5, "窗口透明度", "QuotaTransparency");
      Action updateLabels = delegate {
        sizeLabel.Text = size.Value.ToString("0") + "%";
        opacityLabel.Text = transparency.Value.ToString("0") + "%";
      };
      Action apply = delegate {
        preferences.SetAppearance(size.Value / 100, transparency.Value); ApplyAppearance(); updateLabels();
        settingsStatus.Text = "实时预览 · 自动保存"; saveTimer.Stop(); saveTimer.Start();
      };
      size.ValueChanged += delegate { apply(); }; transparency.ValueChanged += delegate { apply(); };
      updateLabels(); panel.Children.Add(SettingHeading("窗口大小", sizeLabel)); panel.Children.Add(size);
      panel.Children.Add(SettingHeading("透明度", opacityLabel)); panel.Children.Add(transparency);
      panel.Children.Add(Text("0% 为完全不透明，数值越大越透明", 10, Muted));
      settingsStatus = Text("调整后立即生效，并自动保存", 10, Muted); settingsStatus.Margin = new Thickness(0, 10, 0, 14);
      AutomationProperties.SetAutomationId(settingsStatus, "QuotaSettingsStatus");
      panel.Children.Add(settingsStatus);
      var buttons = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right };
      var reset = ActionButton("恢复默认", "QuotaDefaults", false); reset.Margin = new Thickness(0, 0, 8, 0);
      reset.Click += delegate { size.Value = 100; transparency.Value = 0; apply(); };
      var done = ActionButton("完成", "QuotaSettingsDone", true); done.IsDefault = true;
      done.Click += delegate { dialog.Close(); };
      buttons.Children.Add(reset); buttons.Children.Add(done); panel.Children.Add(buttons);
      dialog.Closed += delegate { SavePosition(); settingsWindow = null; settingsStatus = null; };
      dialog.Show();
    }
    static DockPanel SettingHeading(string name, TextBlock value) {
      var row = new DockPanel { LastChildFill = true };
      DockPanel.SetDock(value, Dock.Right); row.Children.Add(value); row.Children.Add(Text(name, 12, Ink));
      return row;
    }
    void Tick(object sender, EventArgs args) {
      if (inputEnded || closeSignal.WaitOne(0)) { Close(); return; }
      if (raiseSignal.WaitOne(0)) { Topmost = false; Topmost = true; DesktopHost.Emit("refresh"); }
      string line;
      while (incoming.TryDequeue(out line)) {
        try { Apply(json.Deserialize<Dictionary<string, object>>(line)); }
        catch (Exception) { snapshotStatus = "stale"; message = "暂时无法更新，稍后重试"; }
      }
      if (++ticks % 5 == 0) UpdateStatus();
    }
    static object Get(Dictionary<string, object> data, string key) { object value; return data != null && data.TryGetValue(key, out value) ? value : null; }
    void Apply(Dictionary<string, object> data) {
      var state = Get(data, "status") as string;
      if (state != "ok" && state != "stale" && state != "error") return;
      snapshotStatus = state; lastUpdate = Get(data, "updatedAt") as string;
      // Display fixed text only; upstream error messages never reach this window.
      message = state == "ok" ? "" : "暂未更新，显示上次结果";
      Draw(Get(data, "short") as Dictionary<string, object>, shortValue, shortBar, shortReset);
      Draw(Get(data, "weekly") as Dictionary<string, object>, weekValue, weekBar, weekReset);
      var shortWindow = Get(data, "short") as Dictionary<string, object>;
      double duration;
      var hasDuration = Double.TryParse(Convert.ToString(Get(shortWindow, "windowMinutes"), CultureInfo.InvariantCulture), NumberStyles.Float, CultureInfo.InvariantCulture, out duration);
      shortLabel.Text = QuotaDisplay.ShortLabel(hasDuration ? duration : Double.NaN);
      // The compact view follows the same validated short-term value as the full view.
      // Window length changes its label, never whether a valid percentage is shown.
      compactValue.Text = shortValue.Text;
      hasShortQuota = compactValue.Text != "—";
      refresh.IsEnabled = true; UpdateStatus();
    }
    void Draw(Dictionary<string, object> data, TextBlock value, ProgressBar bar, TextBlock reset) {
      var raw = Get(data, "remainingPercent"); double percent = 0;
      bool valid = raw != null && Double.TryParse(Convert.ToString(raw, CultureInfo.InvariantCulture), NumberStyles.Float, CultureInfo.InvariantCulture, out percent);
      if (!valid || Double.IsNaN(percent) || percent < 0 || percent > 100) {
        value.Text = "—"; bar.Value = 0; reset.Text = "未提供此项额度"; return;
      }
      value.Text = percent.ToString("0.#", CultureInfo.InvariantCulture) + "%";
      bar.Value = percent; bar.Foreground = percent <= 15 ? Warning : Accent;
      reset.Text = "暂未提供重置时间";
      double epoch;
      if (Double.TryParse(Convert.ToString(Get(data, "resetsAt"), CultureInfo.InvariantCulture), out epoch)) {
        try {
          var date = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc).AddSeconds(epoch).ToLocalTime();
          reset.Text = date <= DateTime.Now ? "等待额度重置" : date.ToString(date.Date == DateTime.Today ? "HH:mm" : "MM/dd HH:mm") + " 重置";
        } catch (ArgumentOutOfRangeException) { }
      }
    }
    void UpdateStatus() {
      DateTime update;
      var valid = DateTime.TryParse(lastUpdate, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out update);
      if (!valid) status.Text = snapshotStatus == "error" ? "暂时无法读取 · 请检查登录或网络" : "正在读取 · Work / Codex";
      else {
        var age = Math.Max(0, (int)(DateTime.UtcNow - update.ToUniversalTime()).TotalMinutes);
        var fresh = snapshotStatus == "ok" && age < 2;
        status.Text = fresh ? "每分钟刷新 · Work / Codex" : "上次 " + update.ToLocalTime().ToString("HH:mm") + " · 暂未更新";
      }
      status.Foreground = snapshotStatus == "ok" ? Muted : Warning;
      status.ToolTip = valid ? "上次成功：" + update.ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss") + (String.IsNullOrEmpty(message) ? "" : "\n" + message) : "正在尝试读取额度";
      bool current = snapshotStatus == "ok" && valid && (DateTime.UtcNow - update.ToUniversalTime()).TotalMinutes < 2;
      compactValue.Foreground = current ? shortBar.Foreground : Warning;
      var compactTip = compactCard.ToolTip as ToolTip;
      if (compactTip == null) { compactTip = new ToolTip { Background = Surface, Foreground = Muted, BorderBrush = Outline }; compactCard.ToolTip = compactTip; }
      var compactSummary = hasShortQuota ? shortLabel.Text + "剩余：" + compactValue.Text : "未提供短时额度";
      compactTip.Content = compactSummary + "\n" +
          "双击展开 · 拖动移动 · 滚轮缩放\n" + Convert.ToString(status.ToolTip, CultureInfo.InvariantCulture);
      AutomationProperties.SetHelpText(compactValue, compactSummary + "\n" + Convert.ToString(status.ToolTip, CultureInfo.InvariantCulture));
    }
    void RestorePosition() {
      var area = SystemParameters.WorkArea; Left = area.Right - Width - 20; Top = area.Top + 80;
      if (preferences.Left.HasValue && preferences.Top.HasValue) {
        Left = Math.Max(area.Left, Math.Min(area.Right - Width, preferences.Left.Value));
        Top = Math.Max(area.Top, Math.Min(area.Bottom - Height, preferences.Top.Value));
      }
    }
    void SavePosition() {
      try {
        preferences.Left = Left; preferences.Top = Top;
        Directory.CreateDirectory(Path.GetDirectoryName(positionPath));
        var temporary = positionPath + ".tmp";
        var serialized = preferences.Serialize();
        File.WriteAllText(temporary, serialized);
        try {
          if (File.Exists(positionPath)) File.Replace(temporary, positionPath, null);
          else File.Move(temporary, positionPath);
        } catch (Exception replacementError) {
          if (!(replacementError is IOException) && !(replacementError is UnauthorizedAccessException) && !(replacementError is ArgumentException)) throw;
          // Some redirected/reparse-point profile files do not support Replace.
          File.WriteAllText(positionPath, serialized);
          try { File.Delete(temporary); } catch (IOException) { }
        }
        if (settingsStatus != null) { settingsStatus.Text = "已自动保存"; settingsStatus.ToolTip = null; }
      } catch (Exception error) {
        if (settingsStatus != null) { settingsStatus.Text = "本次已生效，暂未保存"; settingsStatus.ToolTip = "保存错误类型：" + error.GetType().Name; }
      }
    }
  }
}
